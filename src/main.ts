import * as THREE from "three";
import { G } from "./render/materials";
import { Post } from "./render/post";
import { LAYER_REFLECT, LAYER_SHADOW, PaddyReflection, SunShadow, onLayers } from "./render/lightpasses";
import { World } from "./world/chunks";
import { Sky } from "./world/sky";
import { L, roadX, roadYaw } from "./world/road";
import { Rider } from "./rider/rider";
import { Controller } from "./rider/controller";
import { ChaseCam, type CamMode } from "./rider/camera";
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
scene.add(sky.motes);
const rider = new Rider();
onLayers(rider.lean, LAYER_SHADOW, LAYER_REFLECT);
scene.add(rider.root);

const shadow = new SunShadow(2048, 55);
const reflection = new PaddyReflection(Math.floor(innerWidth * 0.5), Math.floor(innerHeight * 0.5));

const ctl = new Controller(AUTOPLAY);
const chase = new ChaseCam(innerWidth / innerHeight);
const camParam = params.get("cam");
if (camParam === "fpp") {
  chase.fpp = 1;
} else if (camParam) chase.mode = camParam as CamMode;
const post = new Post(renderer, innerWidth, innerHeight, { kuwahara: KUWA });
const audio = new RideAudio();
const input = new Input(
  () => audio.start(),
  () => chase.toggle(),
);
// B = bicycle bell, M = mute (both also count as the first gesture that starts audio).
audio.bindKeys();

const hud = document.getElementById("hud")!;
if (AUTOPLAY || params.has("nohud")) hud.style.display = "none";

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  chase.cam.aspect = innerWidth / innerHeight;
  chase.cam.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
  reflection.setSize(Math.floor(innerWidth * 0.5), Math.floor(innerHeight * 0.5));
});

let frames = 0;
let fpsT = 0;
let fps = 0;
const fpsLog: number[] = [];

let last = performance.now();
let t = 0;
const shadowCenter = new THREE.Vector3();
let near = { trees: 0, houses: 0 };
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  t += dt;
  G.uTime.value = t;

  // Sub-step so a frame hitch can never tunnel the bike through a thin obstacle.
  const steps = Math.max(1, Math.ceil((Math.abs(ctl.speed) * dt) / 0.15));
  let bumpMax = 0;
  for (let i = 0; i < steps; i++) {
    ctl.update(dt / steps, input, (x, z) => world.contact(x, z, 0.35));
    bumpMax = Math.max(bumpMax, ctl.bumpImpulse);
  }
  ctl.bumpImpulse = bumpMax;
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
    crank: ctl.crank,
    wheel: ctl.wheel,
    pedaling: ctl.pedaling,
    time: t,
  });
  chase.update(dt, ctl, t, rider);
  sky.follow(chase.cam.position);
  if (audio.state === "running") {
    near = world.closeness(ctl.x, ctl.z);
    const u = ctl.x - roadX(ctl.z);
    // Paddies line the left side; the village side on the right is drier.
    const water = Math.max(0, Math.min(1, 1 - (u + 4.9) / 12)) * (1 - near.houses * 0.5);
    const roughness = 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(ctl.z * 0.037) * Math.sin(ctl.z * 0.011));
    audio.update(dt, Math.abs(ctl.speed), Math.abs(ctl.cadence), Math.abs(ctl.wheelRate), ctl.pedaling, ctl.brakePressure, {
      steer: Math.max(-1, Math.min(1, ctl.steer / 0.3)),
      bump: ctl.bumpImpulse,
      roughness,
      water,
      trees: near.trees,
      houses: near.houses,
      evening: 0.65,
    });
  }

  // Sun shadow frustum centred ~30 m ahead of the rider (where the camera looks).
  shadowCenter.set(ctl.x - Math.sin(ctl.yaw) * 30, 0, ctl.z - Math.cos(ctl.yaw) * 30);
  renderer.info.reset();
  shadow.update(renderer, scene, shadowCenter);
  reflection.update(renderer, scene, chase.cam, -0.22);
  post.setNear(chase.cam.near);
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
  get audio() {
    return audio.state;
  },
  setCam(mode: CamMode | "fpp" | "tpp") {
    if (mode === "fpp") {
      chase.mode = "chase";
      chase.fpp = 1;
    } else if (mode === "tpp") {
      chase.mode = "chase";
      chase.fpp = 0;
    } else {
      chase.fpp = 0;
      chase.mode = mode;
    }
  },
  toggleView() {
    chase.toggle();
  },
  get fppBlend() {
    return chase.fppBlend;
  },
  /** Teleport (road-relative u, z) facing along the road, with a speed. For collision tests. */
  place(u: number, z: number, speed: number, yawOff = 0) {
    ctl.x = roadX(z) + u;
    ctl.z = z;
    ctl.yaw = roadYaw(z) + yawOff;
    ctl.speed = speed;
  },
  setAutoplay(on: boolean) {
    ctl.autoplay = on;
  },
  obstacles() {
    return world.obstacles().map((o) => ({ u: o.x - roadX(o.z), z: o.z, r: o.r }));
  },
  get ctl() {
    return { x: ctl.x, z: ctl.z, u: ctl.x - roadX(ctl.z), speed: ctl.speed, bumped: ctl.bumped };
  },
  stats() {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      sceneCalls: post.sceneCalls,
      sceneTris: post.sceneTris,
      geometries: renderer.info.memory.geometries,
      fps: Math.round(fps),
      speed: ctl.speed,
      z: ctl.z,
    };
  },
};
