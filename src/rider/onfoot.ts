import * as THREE from "three";
import { G } from "../render/materials";
import { LAYOUT, type World } from "../world/chunks";
import { L, RIBBON_HALF, ROAD_HALF, groundH, pnoise, roadX, roadYaw } from "../world/road";
import { PARK_LEAN, PARK_STEER, gaitCycle, type FootState, type Rider } from "./rider";
import type { Controller } from "./controller";
import type { CamMode, ChaseCam } from "./camera";
import type { Input } from "../core/input";
import type { RideAudio, StepSurface } from "../audio";
import { clamp, damp } from "../core/rng";

/**
 * F = get off and explore on foot; F next to the bike = get back on.
 *
 * ride → (braking) → dismount → walk ⇄ (approach → mount) → ride
 *
 * The same character mesh is used: the body is re-parented from the bike to `rider.walker` and
 * blended limb by limb between the seated and standing poses. While she walks the bike stays
 * parked on its kickstand where she left it; chunk streaming follows her. Pressing F more than
 * 60 m away from the bike wheels it over: it reappears parked at the road edge nearest to her.
 */
export type FootMode = "ride" | "braking" | "dismount" | "walk" | "approach" | "mount";

const WALK = 1.3;
const RUN = 3.0;
const BODY_R = 0.24;
const MOUNT_RANGE = 2.2;
const SUMMON_RANGE = 60;
const DISMOUNT_T = 1.0;
const MOUNT_T = 0.9;
/** Where she stands beside the bike (bike-local): to the side of the saddle, a touch forward of it. */
const STAND_X = 0.6;
const STAND_Z = 0.12;
/** Explorable band: the far terrace bank on the paddy side, the foot of the wooded hills on the other. */
const U_MAX = 42;
const PIVOT_DROP = 0.1;

const { ROW_P, COL_P, NROWS, BERM0, HOUSES, FENCES_LEFT, GUARDRAIL_RIGHT, paddyLevel } = LAYOUT;
const U_FAR = BERM0 - NROWS * ROW_P;
const NCOL = Math.round(L / COL_P);
/** Chunk content is periodic in z; map any world z into the canonical (-L, 0] layout range. */
const canon = (z: number) => z - L * Math.ceil(z / L);
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Ground {
  h: number;
  kind: StepSurface;
}

/** Walkable surface at road-relative (u, z): height + footstep surface, or null (water, walls, edge). */
export function groundAt(u: number, z: number): Ground | null {
  if (u > U_MAX || u < U_FAR - 0.45) return null;
  const zc = canon(z);
  for (const [a, b] of FENCES_LEFT) if (zc <= a + 0.05 && zc >= b - 0.05 && Math.abs(u + 4.27) < 0.2) return null;
  for (const [a, b] of GUARDRAIL_RIGHT) if (zc <= a + 0.05 && zc >= b - 0.05 && Math.abs(u - 3.22) < 0.17) return null;
  if (u >= -4.55) {
    const au = Math.abs(u);
    const h = au < RIBBON_HALF ? 0.02 : groundH(u, zc);
    let kind: StepSurface = au < ROAD_HALF ? "asphalt" : au < 3.0 ? "dirt" : "grass";
    if (kind === "grass" && u > 0 && houseNear(u, zc)) kind = "dirt";
    return { h, kind };
  }
  const c = clamp(Math.floor(-zc / COL_P), 0, NCOL - 1);
  for (let rr = 0; rr < NROWS; rr++) {
    const uIn = BERM0 - rr * ROW_P;
    if (Math.abs(u - uIn) < (rr === 0 ? 0.8 : 0.7) / 2 - 0.05) {
      if (rr === 1) {
        // Bamboo fence standing on some inner banks.
        const za = -c * COL_P;
        if (pnoise(0, za, 11) > 0.6 && zc < za - 0.85 && zc > za - 1 - (COL_P - 2) - 0.15) return null;
      }
      return { h: rr === 0 ? 0 : Math.max(paddyLevel(rr - 1, c), paddyLevel(rr, c)) + 0.24, kind: "dirt" };
    }
  }
  if (Math.abs(u - U_FAR) < 0.45) return { h: 0.95, kind: "grass" };
  const rr = Math.floor((BERM0 - u) / ROW_P);
  if (rr >= 0 && rr < NROWS) {
    const cb = Math.round(-zc / COL_P);
    if (Math.abs(zc + cb * COL_P) < 0.26) {
      const k = cb % NCOL;
      return { h: Math.max(paddyLevel(rr, k - 1), paddyLevel(rr, k)) + 0.2, kind: "dirt" };
    }
  }
  return null;
}

function houseNear(u: number, zc: number): boolean {
  for (const h of HOUSES) if (Math.abs(zc - h.z) < h.d / 2 + 4 && u > h.u - 3 && u < h.u + h.w + 3) return true;
  return false;
}

/** Inside a house footprint (oriented box, grown by `pad`)? Returns the roof height or 0. */
export function houseAt(x: number, z: number, pad: number): number {
  for (const h of HOUSES) {
    const hz = h.z + L * Math.round((z - h.z) / L);
    const cx = roadX(h.z) + h.u + h.w / 2;
    const yaw = roadYaw(h.z) + (h.tilt ?? -0.25);
    const dx = x - cx, dz = z - hz;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < h.w / 2 + 0.2 + pad && Math.abs(lz) < h.d / 2 + 0.2 + pad) return h.floors === 2 ? 7.6 : 5.2;
  }
  return 0;
}

export class Explore {
  mode: FootMode = "ride";
  /** Walker position (feet), heading (forward = (-sin, -cos) like the bike), ground speed. */
  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  speed = 0;
  private run = 0;
  private phase = 0;
  private turn = 0;
  private k = 0;
  private side = 1;
  private shiftKey = false;
  private look = 0;
  private lookUp = 0;
  private lookT = 0;
  private lookTarget = 0;
  private idleT = 0;
  private approachT = 0;
  private prevCam: CamMode = "chase";
  private stepCount = 0;
  private surface: StepSurface = "asphalt";
  /** Parked-bike presentation (kickstand, lean onto it, bars turned). */
  kick = 0;
  // Orbit camera.
  private oYaw = 0;
  private oPitch = 0.16;
  private oDist = 3.4;
  private dCur = 3.4;
  private pivot = new THREE.Vector3();
  private touched = 0;
  private dragging = false;
  private dragMoved = 0;
  private dragT = 0;
  private lastX = 0;
  private lastY = 0;
  private hint: HTMLDivElement;
  private hintOn = false;
  readonly foot: FootState = { blend: 0, side: 1, speed: 0, phase: 0, run: 0, turn: 0, look: 0, lookUp: 0, time: 0 };
  /** Test hook: walk in a fixed world direction instead of reading the keys. */
  autoWalk: { dx: number; dz: number; run: boolean } | null = null;
  /** Idle glances around (off for posed test shots). */
  lookAround = true;

  constructor(
    private world: World,
    private rider: Rider,
    private ctl: Controller,
    private chase: ChaseCam,
    private audio: RideAudio,
    private canvas: HTMLCanvasElement,
    showHint: boolean,
  ) {
    this.hint = document.createElement("div");
    this.hint.textContent = "F — ride";
    Object.assign(this.hint.style, {
      position: "fixed",
      left: "50%",
      bottom: "7%",
      transform: "translateX(-50%)",
      font: '400 13px/1 "Georgia", "Times New Roman", serif',
      letterSpacing: "0.22em",
      color: "rgba(255, 252, 240, 0.82)",
      textShadow: "0 1px 3px rgba(40, 30, 20, 0.45)",
      pointerEvents: "none",
      userSelect: "none",
      opacity: "0",
      transition: "opacity 0.6s ease",
      display: showHint ? "block" : "none",
    });
    document.body.appendChild(this.hint);

    addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftKey = true;
      if (e.repeat) return;
      if (e.code === "KeyF") this.pressF();
      else if (e.code === "KeyC" && this.mode === "ride") this.chase.cycle();
    });
    addEventListener("keyup", (e) => {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftKey = false;
    });
    addEventListener("blur", () => {
      this.shiftKey = false;
      this.dragging = false;
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragMoved = 0;
      this.dragT = performance.now();
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener("pointermove", (e) => {
      const locked = document.pointerLockElement === canvas;
      let mx = 0, my = 0;
      if (locked) {
        mx = e.movementX;
        my = e.movementY;
      } else if (this.dragging) {
        mx = e.clientX - this.lastX;
        my = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.dragMoved += Math.abs(mx) + Math.abs(my);
      }
      if ((mx || my) && this.onFoot) this.orbitBy(mx, my);
    });
    addEventListener("pointerup", () => {
      if (this.dragging && this.dragMoved < 5 && performance.now() - this.dragT < 350 && this.onFoot && document.pointerLockElement !== canvas) {
        // A plain click captures the mouse for free look (Esc releases it).
        try {
          const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch {
          /* not allowed here */
        }
      }
      this.dragging = false;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.onFoot) return;
        this.oDist = clamp(this.oDist * Math.exp(e.deltaY * 0.0011), 1.4, 7);
        this.touched = 3;
      },
      { passive: true },
    );
  }

  /** Is she off the bike (the body lives on the walker root and the orbit camera is in charge)? */
  get onFoot(): boolean {
    return this.mode === "dismount" || this.mode === "walk" || this.mode === "approach" || this.mode === "mount";
  }

  /** Should the bike controller run this frame? */
  get bikeActive(): boolean {
    return this.mode === "ride" || this.mode === "braking";
  }

  /** z that world streaming should follow (the bike while riding, her while on foot). */
  get playerZ(): number {
    return this.onFoot ? this.z : this.ctl.z;
  }
  get playerX(): number {
    return this.onFoot ? this.x : this.ctl.x;
  }

  get bikeDistance(): number {
    return Math.hypot(this.x - this.ctl.x, this.z - this.ctl.z);
  }

  shift(dz: number): void {
    this.z += dz;
    this.pivot.z += dz;
    this.rider.walker.position.z += dz;
  }

  pressF(): void {
    switch (this.mode) {
      case "ride":
        if (Math.abs(this.ctl.speed) > 0.3) {
          this.mode = "braking";
          this.ctl.hold = true;
        } else this.startDismount();
        return;
      case "walk": {
        const d = this.bikeDistance;
        if (d > SUMMON_RANGE) this.summon();
        if (this.bikeDistance < MOUNT_RANGE) this.startApproach();
        return;
      }
      default:
        return;
    }
  }

  private standSpot(side: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.ctl, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const lx = -STAND_X * side, lz = STAND_Z;
    return out.set(c.x + lx * cy + lz * sy, 0, c.z - lx * sy + lz * cy);
  }

  private startDismount(): void {
    const c = this.ctl;
    c.hold = true;
    c.speed = 0;
    this.prevCam = this.chase.mode === "front" || this.chase.mode === "flank" ? this.chase.mode : "chase";
    this.chase.forceThirdPerson(this.rider);
    const left = this.standSpot(1);
    this.side = this.free(left.x, left.z) ? 1 : -1;
    const p = this.standSpot(this.side);
    this.x = p.x;
    this.z = p.z;
    this.yaw = c.yaw;
    this.speed = 0;
    this.y = groundAt(this.x - roadX(this.z), this.z)?.h ?? 0.02;
    this.mode = "dismount";
    this.k = 0;
    // Orbit camera picks up from wherever the ride camera is (behind, or a cinematic front shot).
    const cam = this.chase.cam.position;
    this.rider.headWorld(this.pivot);
    this.pivot.y -= PIVOT_DROP;
    const dx = cam.x - this.pivot.x, dy = cam.y - this.pivot.y, dz = cam.z - this.pivot.z;
    const d = Math.max(0.5, Math.hypot(dx, dy, dz));
    this.oYaw = Math.atan2(dx, dz);
    this.oPitch = clamp(Math.asin(clamp(dy / d, -1, 1)), -0.12, 1.2);
    this.oDist = clamp(d, 1.4, 7);
    this.dCur = this.oDist;
    this.touched = 0;
  }

  private startApproach(): void {
    const c = this.ctl;
    const dx = this.x - c.x, dz = this.z - c.z;
    const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
    this.side = lx <= 0 ? 1 : -1;
    this.mode = "approach";
    this.approachT = 0;
  }

  /** Far from the bike: it reappears parked at the road edge nearest to her. */
  private summon(): void {
    const c = this.ctl;
    const u = this.x - roadX(this.z);
    for (let i = 0; i < 6; i++) {
      const z = this.z - i * 1.6;
      const yaw = roadYaw(z);
      // To her right, so she ends up at its left-hand stand spot when she's on the road.
      const ub = clamp(u + STAND_X, -2.3, 2.3);
      const x = roadX(z) + ub;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let clear = this.world.contact(x, z, 0.4).pen <= 0;
      for (const d of [0.75, -0.45]) clear &&= this.world.contact(x + fx * d, z + fz * d, 0.3).pen <= 0;
      if (clear || i === 5) {
        c.x = x;
        c.z = z;
        c.yaw = yaw;
        c.speed = 0;
        c.steer = 0;
        c.lean = 0;
        return;
      }
    }
  }

  private finishMount(): void {
    const c = this.ctl;
    this.mode = "ride";
    this.k = 0;
    this.kick = 0;
    c.hold = false;
    c.speed = 0;
    c.steer = 0;
    c.lean = 0;
    this.speed = 0;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.chase.handoff(this.prevCam);
  }

  /** Circle obstacles (trunks, poles, signs, posts) + the parked bike; houses are boxes, see free(). */
  private circles(x: number, z: number, withBike: boolean): { pen: number; nx: number; nz: number } {
    const out = { pen: 0, nx: 0, nz: 0 };
    const test = (cx: number, cz: number, r: number) => {
      const dx = x - cx, dz = z - cz;
      const rr = r + BODY_R;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2);
        if (rr - d > out.pen) {
          out.pen = rr - d;
          out.nx = d > 1e-5 ? dx / d : 1;
          out.nz = d > 1e-5 ? dz / d : 0;
        }
      }
    };
    for (const ch of this.world.chunks) {
      const oz = ch.group.position.z;
      for (const k of ch.colliders) if (k.r <= 1.2 && Math.abs(k.z + oz - z) < 3 && Math.abs(k.x - x) < 3) test(k.x, k.z + oz, k.r);
    }
    if (withBike) {
      const c = this.ctl, fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      for (const d of [0.55, 0, -0.5]) test(c.x + fx * d, c.z + fz * d, 0.2);
    }
    return out;
  }

  private free(x: number, z: number): boolean {
    return groundAt(x - roadX(z), z) !== null && houseAt(x, z, BODY_R) === 0;
  }

  private move(dx: number, dz: number): void {
    let nx = this.x + dx, nz = this.z + dz;
    for (let it = 0; it < 2; it++) {
      const c = this.circles(nx, nz, true);
      if (c.pen <= 0) break;
      nx += c.nx * c.pen;
      nz += c.nz * c.pen;
    }
    // Stuck somewhere odd (teleport, summoned bike): let her walk out.
    if (this.free(nx, nz) || !this.free(this.x, this.z)) {
      this.x = nx;
      this.z = nz;
      return;
    }
    // Slide along walls and bank edges: keep the road-relative lateral fixed, or keep z fixed.
    const u0 = this.x - roadX(this.z);
    const tries: [number, number][] = [[roadX(this.z + dz) + u0, this.z + dz], [this.x + dx, this.z], [this.x, this.z + dz]];
    for (const [tx, tz] of tries) {
      if (this.free(tx, tz) && this.circles(tx, tz, true).pen < 0.002) {
        this.x = tx;
        this.z = tz;
        return;
      }
    }
    this.speed *= 0.6;
  }

  update(dt: number, input: Input, time: number): void {
    const c = this.ctl;
    switch (this.mode) {
      case "braking":
        if (Math.abs(c.speed) <= 0.25) this.startDismount();
        break;
      case "dismount":
        this.k = Math.min(1, this.k + dt / DISMOUNT_T);
        if (this.k >= 1) this.mode = "walk";
        break;
      case "walk":
        this.locomotion(dt, input);
        break;
      case "approach": {
        this.approachT += dt;
        const p = this.standSpot(this.side);
        const dx = p.x - this.x, dz = p.z - this.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05 && this.approachT < 4) {
          this.steerToward(Math.atan2(-dx, -dz), dt, 9);
          this.speed = damp(this.speed, Math.min(1.1, d * 2.2 + 0.25), 6, dt);
          const step = Math.min(d, this.speed * dt);
          this.x += (dx / d) * step;
          this.z += (dz / d) * step;
        } else {
          this.speed = damp(this.speed, 0, 10, dt);
          const err = this.steerToward(c.yaw, dt, 7);
          if ((Math.abs(err) < 0.06 && this.speed < 0.15) || this.approachT > 5) {
            this.x = p.x;
            this.z = p.z;
            this.mode = "mount";
            this.k = 1;
            this.speed = 0;
          }
        }
        this.advancePhase(dt);
        break;
      }
      case "mount":
        this.speed = 0;
        this.yaw = damp(this.yaw, c.yaw, 12, dt);
        this.k = Math.max(0, this.k - dt / MOUNT_T);
        if (this.k <= 0) this.finishMount();
        break;
    }
    const onFoot = this.onFoot;
    // Parked bike: kickstand swings down as she steps off, the bike settles onto it, bars turn in.
    const park = this.mode === "dismount" ? smooth01(this.k / 0.55) : this.mode === "mount" ? smooth01((this.k - 0.35) / 0.5) : onFoot ? 1 : 0;
    this.kick = park;
    if (onFoot) {
      const g = groundAt(this.x - roadX(this.z), this.z);
      if (g) {
        this.y = damp(this.y, g.h, 12, dt);
        this.surface = g.kind;
      }
      this.rider.walker.position.set(this.x, this.y, this.z);
      this.rider.walker.rotation.y = this.yaw;
      this.idleLook(dt);
    }
    const f = this.foot;
    f.blend = this.mode === "dismount" || this.mode === "mount" ? this.k : onFoot ? 1 : 0;
    f.side = this.side;
    f.speed = this.speed;
    f.phase = this.phase;
    f.run = this.run;
    f.turn = this.turn;
    f.look = this.look;
    f.lookUp = this.lookUp;
    f.time = time;
    G.uPush.value.set(this.x, this.z, 0.85, onFoot ? 1 : 0);
    // Keep the bike drawn only while its chunk is still streamed in around her.
    const bz = c.z - this.playerZ;
    this.rider.root.visible = !onFoot || (bz < 105 && bz > -480);
    const near = this.mode === "walk" && this.bikeDistance < MOUNT_RANGE;
    if (near !== this.hintOn) {
      this.hintOn = near;
      this.hint.style.opacity = near ? "1" : "0";
    }
  }

  /** Bike overrides while parked: kickstand, lean onto it, bars turned in. */
  get parkLean(): number {
    return PARK_LEAN * this.kick;
  }
  get parkSteer(): number {
    return PARK_STEER * this.kick * this.side;
  }

  private steerToward(target: number, dt: number, rate: number): number {
    const err = wrapA(target - this.yaw);
    const dy = err * (1 - Math.exp(-rate * dt));
    this.yaw = wrapA(this.yaw + dy);
    this.turn = damp(this.turn, dt > 0 ? dy / dt : 0, 8, dt);
    return err;
  }

  private advancePhase(dt: number): void {
    this.run = clamp((this.speed - WALK) / (RUN - WALK), 0, 1);
    this.phase += ((this.speed * dt) / gaitCycle(this.run)) * Math.PI * 2;
    // Footfalls: each foot lands when the phase passes a multiple of π.
    const n = Math.floor(this.phase / Math.PI);
    if (n !== this.stepCount) {
      if (this.speed > 0.35) this.audio.footstep(this.surface, 0.5 + 0.55 * this.run + 0.15 * Math.min(1, this.speed / WALK));
      this.stepCount = n;
    }
  }

  private locomotion(dt: number, input: Input): void {
    let fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    let str = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sy = Math.sin(this.oYaw), cy = Math.cos(this.oYaw);
    let wx = -sy * fwd + cy * str;
    let wz = -cy * fwd - sy * str;
    let runKey = this.shiftKey;
    if (this.autoWalk) {
      wx = this.autoWalk.dx;
      wz = this.autoWalk.dz;
      runKey = this.autoWalk.run;
      fwd = 1;
      str = 0;
    }
    const len = Math.hypot(wx, wz);
    let want = 0;
    if (len > 0.01) {
      wx /= len;
      wz /= len;
      want = runKey ? RUN : WALK;
      const err = this.steerToward(Math.atan2(-wx, -wz), dt, want > WALK ? 7 : 9);
      // Turn on the spot for big direction changes, then set off.
      want *= clamp(Math.cos(err) * 1.2, 0.1, 1);
    } else this.turn = damp(this.turn, 0, 6, dt);
    const acc = want > this.speed ? (want > WALK ? 3.2 : 3.6) : 6.5;
    this.speed = Math.max(0, this.speed + clamp(want - this.speed, -acc * dt, acc * dt));
    if (this.speed > 1e-3) this.move(-Math.sin(this.yaw) * this.speed * dt, -Math.cos(this.yaw) * this.speed * dt);
    this.advancePhase(dt);
    // Lazy camera follow: while pushing forward, the orbit slowly swings in behind her.
    this.touched = Math.max(0, this.touched - dt);
    if (fwd > 0 && this.touched <= 0 && this.speed > 0.2) {
      const behind = this.yaw;
      this.oYaw = wrapA(this.oYaw + wrapA(behind - this.oYaw) * (1 - Math.exp(-0.35 * dt * (this.speed / WALK))));
    }
  }

  private idleLook(dt: number): void {
    if (this.mode === "walk" && this.speed < 0.08 && this.lookAround) this.idleT += dt;
    else {
      this.idleT = 0;
      this.lookTarget = 0;
    }
    if (this.idleT > 2.2) {
      this.lookT -= dt;
      if (this.lookT <= 0) {
        // Glance around: over a shoulder, at the sky, back ahead.
        const r = Math.random();
        this.lookTarget = this.lookTarget !== 0 && r < 0.55 ? 0 : (r < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.35);
        this.lookT = 1.6 + Math.random() * 2.6;
      }
    }
    this.look = damp(this.look, this.lookTarget, 2.4, dt);
    this.lookUp = damp(this.lookUp, this.lookTarget !== 0 ? -0.08 + 0.05 * Math.sin(this.idleT * 0.7) : 0, 1.5, dt);
  }

  private orbitBy(mx: number, my: number): void {
    this.oYaw = wrapA(this.oYaw - mx * 0.0055);
    this.oPitch = clamp(this.oPitch + my * 0.004, -0.12, 1.2);
    this.touched = 3;
  }

  /** Test / script hook: camera bearing relative to her facing (0 = behind, π = in front), pitch, distance. */
  setOrbit(rel: number, pitch: number, dist: number): void {
    this.oYaw = wrapA(this.yaw + rel);
    this.oPitch = clamp(pitch, -0.12, 1.2);
    this.oDist = clamp(dist, 1.4, 7);
    this.dCur = this.oDist;
    this.touched = 1e9;
  }

  /** Test hook: stand at road-relative (u, z) facing `yaw`. */
  teleport(u: number, z: number, yaw = roadYaw(z)): void {
    this.x = roadX(z) + u;
    this.z = z;
    this.yaw = yaw;
    this.y = groundAt(u, z)?.h ?? 0;
    this.speed = 0;
    this.rider.headWorld(this.pivot);
  }

  updateCamera(dt: number, cam: THREE.PerspectiveCamera): void {
    const head = this.rider.headWorld(new THREE.Vector3());
    head.y -= PIVOT_DROP;
    this.pivot.x = damp(this.pivot.x, head.x, 9, dt);
    this.pivot.z = damp(this.pivot.z, head.z, 9, dt);
    this.pivot.y = damp(this.pivot.y, head.y, 5, dt);
    if (this.mode === "dismount" && this.touched <= 0) {
      this.oDist = damp(this.oDist, 3.4, 1.6, dt);
      this.oPitch = damp(this.oPitch, 0.16, 1.6, dt);
    }
    const cp = Math.cos(this.oPitch);
    const dir = new THREE.Vector3(Math.sin(this.oYaw) * cp, Math.sin(this.oPitch), Math.cos(this.oYaw) * cp);
    // Pull in ahead of houses, trunks and the ground; ease back out.
    let lim = this.oDist;
    const p = new THREE.Vector3();
    for (let i = 1; i <= 14; i++) {
      const d = (i / 14) * this.oDist;
      p.copy(this.pivot).addScaledVector(dir, d);
      const u = p.x - roadX(p.z);
      const roof = houseAt(p.x, p.z, 0.3);
      const gnd = u >= -4.6 ? groundH(u, canon(p.z)) : -0.1;
      let hit = (roof > 0 && p.y < roof) || p.y < gnd + 0.25;
      if (!hit && p.y < 3.2) {
        for (const ch of this.world.chunks) {
          const oz = ch.group.position.z;
          for (const k of ch.colliders)
            if (k.r >= 0.35 && k.r <= 1.2 && Math.hypot(p.x - k.x, p.z - k.z - oz) < k.r * 0.7 + 0.2) {
              hit = true;
              break;
            }
          if (hit) break;
        }
      }
      if (hit) {
        lim = Math.max(0.7, d - 0.35);
        break;
      }
    }
    this.dCur = lim < this.dCur ? lim : damp(this.dCur, lim, 2.5, dt);
    cam.position.copy(this.pivot).addScaledVector(dir, this.dCur);
    cam.fov = 45;
    cam.near = 0.1;
    cam.updateProjectionMatrix();
    cam.lookAt(this.pivot.x, this.pivot.y + 0.05, this.pivot.z);
    cam.updateMatrixWorld();
  }
}

const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
