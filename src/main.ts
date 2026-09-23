import * as THREE from "three";
import { G } from "./render/materials";
import { Post } from "./render/post";
import { LAYER_REFLECT, LAYER_SHADOW, PaddyReflection, SunShadow, onLayers } from "./render/lightpasses";
import { World, protoSteps, type Contact } from "./world/chunks";
import { Sky } from "./world/sky";
import { L, roadX, roadYaw } from "./world/road";
import { Rider } from "./rider/rider";
import { Controller } from "./rider/controller";
import { ChaseCam, type CamMode } from "./rider/camera";
import { Input } from "./core/input";
import { RideAudio } from "./audio";
import { Loader, type Stage } from "./loader";
import { precompile, warmDraws } from "./render/precompile";

const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has("autoplay") && params.get("autoplay") !== "0";
const KUWA = params.get("kuwahara") !== "0";
/** Go straight into the ride once built (no "click to ride" wait) — for automated captures. */
const SKIP_INTRO = params.has("skipintro") && params.get("skipintro") !== "0";
// Loader progress weights (sum 1), proportional to measured build time on a desktop GPU.
const W_BOOT = 0.03, W_SKY = 0.04, W_PROTOS = 0.05, W_CHUNKS = 0.06, W_RIDER = 0.01, W_COMPILE = 0.15, W_DRAW = 0.6, W_WARM = 0.06;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = true;
renderer.info.autoReset = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const loader = new Loader(SKIP_INTRO);
(window as unknown as { __loader: Loader }).__loader = loader;
loader.advance(W_BOOT, "trees");
// Build in small steps, handing the main thread back between them so the loader keeps painting.
const bootLog: [string, number][] = [];
const bootT0 = performance.now();
const yieldToPaint = () =>
  new Promise<void>((res) => {
    const to = setTimeout(res, 120); // hidden tabs never fire rAF
    requestAnimationFrame(() => setTimeout(() => (clearTimeout(to), res()), 0));
  });
async function step<T>(label: string, stage: Stage, weight: number, fn: () => T): Promise<T> {
  const s = performance.now();
  const out = fn();
  bootLog.push([label, Math.round(performance.now() - s)]);
  loader.advance(weight, stage);
  await yieldToPaint();
  return out;
}
await yieldToPaint();

const scene = new THREE.Scene();
const protoSteps_ = protoSteps();
for (let i = 0; i < protoSteps_.length; i++)
  await step(`proto${i}`, i < protoSteps_.length * 0.55 ? "trees" : "grass", W_PROTOS / protoSteps_.length, protoSteps_[i]);
const world = new World(false);
const CHUNK_STAGES: Stage[] = ["rice", "houses", "poles", "road"];
for (let k = 0; k < World.CHUNKS; k++)
  await step(`chunk${k}`, CHUNK_STAGES[Math.floor((k / World.CHUNKS) * CHUNK_STAGES.length)], W_CHUNKS / World.CHUNKS, () => world.addChunk(k));
scene.add(world.root);
// Created after the world on purpose: opaque draws sort by material id first, and the sky dome must
// draw after the scenery so early-z rejects most of its pixels.
const sky = await step("sky", "sky", W_SKY, () => new Sky());
scene.add(sky.group);
scene.add(sky.motes);
const rider = await step("rider", "rider", W_RIDER, () => new Rider());
onLayers(rider.lean, LAYER_SHADOW, LAYER_REFLECT);
scene.add(rider.root);

const shadow = new SunShadow(2048, 55);
const reflection = new PaddyReflection(Math.floor(innerWidth * 0.5), Math.floor(innerHeight * 0.5));

const startParam = params.get("start");
const ctl = new Controller(AUTOPLAY, startParam !== null && Number.isFinite(Number(startParam)) ? Number(startParam) : undefined);
const chase = new ChaseCam(innerWidth / innerHeight);
const camParam = params.get("cam");
if (camParam === "fpp") {
  chase.fpp = 1;
} else if (camParam) chase.mode = camParam as CamMode;
const post = new Post(renderer, innerWidth, innerHeight, { kuwahara: KUWA });
{
  const s = performance.now();
  let done = 0;
  await precompile(renderer, scene, chase.cam, post, shadow, (f) => {
    loader.advance((f - done) * W_COMPILE, "paint");
    done = f;
  }, yieldToPaint);
  bootLog.push(["compile", Math.round(performance.now() - s)]);
  // The first chunk meets every shader for the first time, so it goes mesh by mesh.
  const [first, ...rest] = world.root.children;
  const parts = [...first.children, ...rest, sky.group, sky.motes, rider.root];
  let tp = performance.now();
  await warmDraws(renderer, scene, chase.cam, post, shadow, parts, (i) => {
    const n = performance.now();
    bootLog.push([`draw${i}`, Math.round(n - tp)]);
    tp = n;
    loader.advance(W_DRAW / parts.length, i < parts.length - 3 ? "paint" : "cicadas");
  }, yieldToPaint);
}
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
/** The bike as three circles: body at the saddle, front wheel + basket ahead, rear wheel behind. */
function bikeContact(x: number, z: number): Contact {
  const fx = -Math.sin(ctl.yaw), fz = -Math.cos(ctl.yaw);
  let best = world.contact(x, z, 0.35);
  for (const [d, r] of [[0.75, 0.28], [-0.45, 0.25]]) {
    const c = world.contact(x + fx * d, z + fz * d, r);
    if (c.pen > best.pen) best = c;
  }
  return best;
}
// Warm-up: render a few frames behind the cream veil with the clock frozen (shader compile,
// shadow map + paddy reflection filled), then start time and fade the veil out.
const WARM_FRAMES = 8;
const FADE = 0.45;
const fadeEl = document.getElementById("fade")!;
let warm = 0;
/** Intro mode: the finished frame waits (clock frozen, loop idle) behind the loader for a gesture. */
let waiting = false;
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (warm < WARM_FRAMES) {
    warm++;
    dt = 0;
    loader.advance(W_WARM / WARM_FRAMES, "cicadas");
  } else if (SKIP_INTRO) {
    const k = Math.min(1, t / FADE);
    fadeEl.style.opacity = String(1 - k * k * (3 - 2 * k));
    if (k >= 1 && fadeEl.style.display !== "none") fadeEl.style.display = "none";
  }
  t += dt;
  G.uTime.value = t;

  // Sub-step so a frame hitch can never tunnel the bike through a thin obstacle.
  const steps = Math.max(1, Math.ceil((Math.abs(ctl.speed) * dt) / 0.15));
  let bumpMax = 0;
  for (let i = 0; i < steps; i++) {
    ctl.update(dt / steps, input, bikeContact);
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
  if (!started) bootLog.push([`warm${warm}`, Math.round(performance.now() - now)]);
  if (warm === WARM_FRAMES && !started) {
    started = true;
    bootLog.push(["total", Math.round(performance.now() - bootT0)]);
    if (SKIP_INTRO) loader.remove();
    else {
      // The gesture that dismisses the loader also starts the audio (autoplay policy).
      fadeEl.style.display = "none";
      waiting = true;
      loader.ready(() => {
        audio.start();
        waiting = false;
        last = performance.now();
        loader.dissolve();
        requestAnimationFrame(frame);
      });
      return;
    }
  }
  requestAnimationFrame(frame);
}
let started = false;
requestAnimationFrame(frame);

declare global {
  interface Window {
    __ride: unknown;
  }
}
window.__ride = {
  get ready() {
    return warm >= WARM_FRAMES;
  },
  get fps() {
    return fps;
  },
  /** Intro loader: waiting = built and showing "click to ride"; progress 0…1; boot step timings (ms). */
  get waiting() {
    return waiting;
  },
  get loadProgress() {
    return loader.progress;
  },
  bootLog,
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
