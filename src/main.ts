import * as THREE from "three";
import { G } from "./render/materials";
import { Post } from "./render/post";
import { World } from "./world/chunks";
import { Sky } from "./world/sky";
import { L } from "./world/road";
import { Rider } from "./rider/rider";
import { Controller } from "./rider/controller";
import { ChaseCam } from "./rider/camera";
import { Input } from "./core/input";
import { RideAudio } from "./audio";

const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has("autoplay") && params.get("autoplay") !== "0";
const KUWA = params.get("kuwahara") !== "0";

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = true;
renderer.info.autoReset = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const world = new World();
scene.add(world.root);
const sky = new Sky();
scene.add(sky.group);
const rider = new Rider();
scene.add(rider.root);

const ctl = new Controller(AUTOPLAY);
const chase = new ChaseCam(innerWidth / innerHeight);
if (params.get("cam") === "closeup" || params.get("cam") === "side") chase.mode = params.get("cam") as "closeup" | "side";
const post = new Post(renderer, innerWidth, innerHeight, { kuwahara: KUWA });
const audio = new RideAudio();
const input = new Input(() => audio.start());

const hud = document.getElementById("hud")!;
if (AUTOPLAY || params.has("nohud")) hud.style.display = "none";

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  chase.cam.aspect = innerWidth / innerHeight;
  chase.cam.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
});

// FPS tracking (exposed for the capture script).
let frames = 0;
let fpsT = 0;
let fps = 0;
const fpsLog: number[] = [];

let last = performance.now();
let t = 0;
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  t += dt;
  G.uTime.value = t;

  ctl.update(dt, input, (x, z) => world.hit(x, z, 0.35));
  // Rebase far along the loop so float precision stays good (world content is L-periodic).
  if (ctl.z < -L) {
    ctl.z += L;
    chase.shift(L);
  }
  world.update(ctl.z);
  rider.root.position.set(ctl.x, 0, ctl.z);
  rider.root.rotation.y = ctl.yaw;
  rider.update(dt, {
    speed: ctl.speed,
    steer: ctl.steer * 1.6,
    lean: ctl.lean,
    crank: ctl.crank * Math.PI * 2 / (Math.PI * 2),
    wheel: ctl.wheel,
    pedaling: ctl.pedaling,
    time: t,
  });
  chase.update(dt, ctl, t);
  sky.follow(chase.cam.position);
  audio.update(dt, ctl.speed, ctl.cadence, ctl.wheelRate, ctl.pedaling, ctl.braking);

  post.render(scene, chase.cam, t);

  hud.textContent = `${Math.round(ctl.speed * 3.6)} km/h`;
  frames++;
  fpsT += dt;
  if (fpsT >= 1) {
    fps = frames / fpsT;
    fpsLog.push(Math.round(fps));
    frames = 0;
    fpsT = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global {
  interface Window {
    __ride: unknown;
  }
}
window.__ride = {
  ready: true,
  get fps() {
    return fps;
  },
  fpsLog,
  get time() {
    return t;
  },
  setCam(mode: "chase" | "closeup" | "side") {
    chase.mode = mode;
  },
  stats() {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      calls: post.sceneCalls,
      triangles: post.sceneTris,
      geometries: renderer.info.memory.geometries,
      fps: Math.round(fps),
      speed: ctl.speed,
      z: ctl.z,
    };
  },
};
