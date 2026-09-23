import * as THREE from "three";
import { G } from "./render/materials";
import { Post } from "./render/post";
import { LAYER_REFLECT, LAYER_SHADOW, PaddyReflection, SunShadow, onLayers } from "./render/lightpasses";
import { World, protoSteps, type Contact } from "./world/chunks";
import { Sky } from "./world/sky";
import { Birds } from "./world/birds";
import { L, roadX, roadYaw } from "./world/road";
import { Rider } from "./rider/rider";
import { Controller } from "./rider/controller";
import { ChaseCam, type CamMode } from "./rider/camera";
import { Explore, houseAt } from "./rider/onfoot";
import { Input } from "./core/input";
import { RideAudio } from "./audio";
import { Loader, type Stage } from "./loader";
import { precompile, warmDraws } from "./render/precompile";
import { leafAtlas } from "./render/leafAtlas";
import { signAtlas } from "./render/signAtlas";
import { TimeOfDay, type Preset } from "./world/timeofday";
import { Fireflies } from "./world/fireflies";

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
G.uLeafTex.value = leafAtlas(renderer);
G.uSignTex.value = signAtlas(renderer);

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
scene.add(rider.walker);
const birds = new Birds();
scene.add(birds.group);
const fireflies = new Fireflies();
scene.add(fireflies.mesh);

const shadow = new SunShadow(2048, 55);
const reflection = new PaddyReflection(Math.floor(innerWidth * 0.5), Math.floor(innerHeight * 0.5));

const startParam = params.get("start");
const ctl = new Controller(AUTOPLAY, startParam !== null && Number.isFinite(Number(startParam)) ? Number(startParam) : undefined);
const chase = new ChaseCam(innerWidth / innerHeight);
const camParam = params.get("cam");
if (camParam === "fpp") {
  chase.fpp = 1;
} else if (camParam) chase.mode = camParam as CamMode;
const post = new Post(renderer, innerWidth, innerHeight, { kuwahara: KUWA, msaa: Number(params.get("msaa") ?? 4) });
const MSAA_PINNED = params.has("msaa");
let msaaStepAt = 0;
// T cycles afternoon → golden → sunset → dusk; ?time=… picks one, &timelapse=1 sets the sun over 40 s.
const tod = new TimeOfDay(post, shadow, params);
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
  const parts = [...first.children, ...rest, sky.group, sky.motes, rider.root, birds.group];
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
  () => {
    if (!explore.onFoot) chase.toggle();
  },
);
// B = bicycle bell, M = mute (both also count as the first gesture that starts audio).
audio.bindKeys();
addEventListener("keydown", (e) => {
  if (e.code === "KeyB" && !e.repeat) rider.bike.ringBell();
});

const hud = document.getElementById("hud")!;
if (AUTOPLAY || params.has("nohud")) hud.style.display = "none";
// F = get off and explore on foot / get back on; C = cinematic ride cameras.
const explore = new Explore(world, rider, ctl, chase, audio, renderer.domElement, !(AUTOPLAY || params.has("nohud")));
// Mouse look: the "to ride" click captures the pointer; a canvas click re-captures it after Esc.
// Autoplay keeps its scripted camera and never captures.
chase.mouseLook = !AUTOPLAY;
explore.lockRiding = !AUTOPLAY;
const canvasEl = renderer.domElement;
const lockPointer = () => {
  try {
    const p = canvasEl.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  } catch {
    /* not allowed here */
  }
};
addEventListener("pointermove", (e) => {
  if (document.pointerLockElement === canvasEl && !explore.onFoot) chase.lookBy(e.movementX, e.movementY);
});
const lookHint = document.createElement("div");
lookHint.textContent = "click to look around";
Object.assign(lookHint.style, {
  position: "fixed",
  left: "50%",
  bottom: "3.5%",
  transform: "translateX(-50%)",
  font: '400 12px/1 "Georgia", "Times New Roman", serif',
  letterSpacing: "0.2em",
  color: "rgba(255, 252, 240, 0.7)",
  textShadow: "0 1px 3px rgba(40, 30, 20, 0.45)",
  pointerEvents: "none",
  userSelect: "none",
  opacity: "0",
  transition: "opacity 0.8s ease",
  display: AUTOPLAY || params.has("nohud") ? "none" : "block",
});
document.body.appendChild(lookHint);
let lookHintTimer = 0;
const showLookHint = () => {
  if (AUTOPLAY || explore.onFoot) return;
  lookHint.style.opacity = "1";
  clearTimeout(lookHintTimer);
  lookHintTimer = window.setTimeout(() => (lookHint.style.opacity = "0"), 2000);
};
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvasEl) lookHint.style.opacity = "0";
  else showLookHint();
});

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
const _actor = new THREE.Vector3();
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
  explore.enabled = started && !waiting;

  if (explore.bikeActive) {
    // Sub-step so a frame hitch can never tunnel the bike through a thin obstacle.
    const steps = Math.max(1, Math.ceil((Math.abs(ctl.speed) * dt) / 0.15));
    let bumpMax = 0;
    for (let i = 0; i < steps; i++) {
      ctl.update(dt / steps, input, bikeContact);
      bumpMax = Math.max(bumpMax, ctl.bumpImpulse);
    }
    ctl.bumpImpulse = bumpMax;
  } else ctl.bumpImpulse = 0;
  explore.update(dt, input, t);
  // Streaming (and the periodic wrap) follows whoever is active: the bike, or her on foot.
  if (explore.playerZ < -L) {
    ctl.z += L;
    explore.shift(L);
    chase.shift(L);
    birds.shift(L);
  }
  const px = explore.playerX, pz = explore.playerZ;
  world.update(pz);
  // Wheels stand on the road surface (0.02 above the ground plane).
  rider.root.position.set(ctl.x, 0.02, ctl.z);
  rider.root.rotation.y = ctl.yaw;
  const onFoot = explore.onFoot;
  rider.update(
    dt,
    {
      speed: ctl.speed,
      steer: onFoot ? ctl.steer * 1.6 * (1 - explore.kick) + explore.parkSteer : ctl.steer * 1.6,
      lean: onFoot ? ctl.lean * (1 - explore.kick) + explore.parkLean : ctl.lean,
      crank: ctl.crank,
      wheel: ctl.wheel,
      pedaling: onFoot ? 0 : ctl.pedaling,
      time: t,
      kick: explore.kick,
    },
    onFoot ? explore.foot : undefined,
  );
  rider.bike.bump(ctl.bumpImpulse);
  if (onFoot && chase.mode !== "custom") explore.updateCamera(dt, chase.cam);
  else chase.update(dt, ctl, t, rider);
  sky.follow(chase.cam.position);
  tod.update(dt);
  birds.activity = tod.birds;
  birds.update(dt, t, chase.cam, _actor.set(px, 0, pz));
  fireflies.update(pz, tod.night);
  rider.bike.setLamp(tod.night);
  if (audio.state === "running") {
    near = world.closeness(px, pz);
    const u = px - roadX(pz);
    // Paddies line the left side; the village side on the right is drier.
    const water = Math.max(0, Math.min(1, 1 - (u + 4.9) / 12)) * (1 - near.houses * 0.5);
    const roughness = 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(pz * 0.037) * Math.sin(pz * 0.011));
    audio.update(dt, Math.abs(ctl.speed), Math.abs(ctl.cadence), Math.abs(ctl.wheelRate), ctl.pedaling, ctl.brakePressure, {
      steer: Math.max(-1, Math.min(1, ctl.steer / 0.3)),
      bump: ctl.bumpImpulse,
      roughness,
      water,
      trees: near.trees,
      houses: near.houses,
      evening: tod.evening,
    });
  }

  // Sun shadow frustum centred ~30 m ahead of the rider (where the camera looks).
  if (onFoot) {
    chase.cam.getWorldDirection(shadowCenter);
    const l = Math.hypot(shadowCenter.x, shadowCenter.z) || 1;
    shadowCenter.set(px + (shadowCenter.x / l) * 22, 0, pz + (shadowCenter.z / l) * 22);
  } else shadowCenter.set(ctl.x - Math.sin(ctl.yaw) * 30, 0, ctl.z - Math.cos(ctl.yaw) * 30);
  renderer.info.reset();
  shadow.update(renderer, scene, shadowCenter);
  reflection.update(renderer, scene, chase.cam, -0.22);
  post.setNear(chase.cam.near);
  post.render(scene, chase.cam, t);

  hud.textContent = onFoot ? "" : `${Math.round(ctl.speed * 3.6)} km/h`;
  frames++;
  fpsT += dt;
  if (fpsT >= 1) {
    fps = frames / fpsT;
    fpsLog.push(Math.round(fps));
    // Adaptive AA: MSAA x4 while the GPU keeps up; step down (x2, then SMAA only) if a
    // 3-second window stays under the frame target. Pinned with ?msaa=N.
    if (!MSAA_PINNED && fpsLog.length > 3 && fpsLog.length - msaaStepAt >= 3) {
      const last = fpsLog.slice(-3).reduce((a, c) => a + c, 0) / 3;
      if (last < 72 && post.msaa > 0) {
        post.setMsaa(post.msaa > 2 ? 2 : 0);
        msaaStepAt = fpsLog.length;
      }
    }
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
      loader.ready((viaPointer) => {
        audio.start();
        if (!AUTOPLAY) {
          if (viaPointer) lockPointer();
          else showLookHint();
        }
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
  scene,
  bike: rider.bike,
  post,
  birds,
  get msaa() {
    return post.msaa;
  },
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
  /** Test hook: feed locked-mouse deltas (enables mouse look even under autoplay). */
  mouseLook(mx: number, my: number) {
    chase.mouseLook = true;
    chase.lookBy(mx, my);
  },
  get look() {
    return { enabled: chase.mouseLook, ...chase.lookState, locked: document.pointerLockElement === canvasEl };
  },
  /** Exact framing for captures: eye and target as world offsets from the rider (ground level). */
  view(px: number, py: number, pz: number, lx: number, ly: number, lz: number) {
    chase.fpp = 0;
    chase.mode = "custom";
    chase.customPos.set(px, py, pz);
    chase.customLook.set(lx, ly, lz);
  },
  /** Absolute world X of the road centre at z (to aim captures at roadside things). */
  roadX(z: number) {
    return roadX(z);
  },
  cycleCam() {
    chase.cycle();
  },
  get camMode() {
    return chase.mode;
  },
  /** Her head in screen pixels (for face crops in the screenshot script). */
  headScreen() {
    const v = rider.headWorld(new THREE.Vector3()).project(chase.cam);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, z: v.z };
  },
  /** On-foot test hooks. */
  explore: {
    get state() {
      return {
        mode: explore.mode,
        x: explore.x,
        z: explore.z,
        u: explore.x - roadX(explore.z),
        y: explore.y,
        yaw: explore.yaw,
        speed: explore.speed,
        bikeDist: explore.bikeDistance,
        bikeVisible: rider.root.visible,
        inHouse: houseAt(explore.x, explore.z, 0) > 0,
      };
    },
    pressF() {
      explore.pressF();
    },
    teleport(u: number, z: number, yaw?: number) {
      explore.teleport(u, z, yaw);
    },
    orbit(rel: number, pitch: number, dist: number) {
      explore.setOrbit(rel, pitch, dist);
    },
    walk(dx: number, dz: number, run = false) {
      explore.autoWalk = dx || dz ? { dx, dz, run } : null;
    },
    faceYaw(yaw: number) {
      explore.yaw = yaw;
    },
    lookAround(on: boolean) {
      explore.lookAround = on;
    },
  },
  get timeOfDay() {
    return tod.preset;
  },
  setTime(p: Preset, instant = false) {
    tod.set(p, instant);
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
    return { x: ctl.x, z: ctl.z, u: ctl.x - roadX(ctl.z), yaw: ctl.yaw, speed: ctl.speed, bumped: ctl.bumped };
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
