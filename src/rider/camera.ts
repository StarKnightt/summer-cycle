import * as THREE from "three";
import type { Controller } from "./controller";
import type { Rider } from "./rider";
import { damp } from "../core/rng";
import { roadX } from "../world/road";

export type CamMode = "chase" | "front" | "flank" | "overhead" | "closeup" | "side" | "paddy" | "houses" | "face" | "faceside" | "back" | "custom";

const TPP_FOV = 45;
const FPP_FOV = 70;
const TPP_NEAR = 0.15;
const FPP_NEAR = 0.03;

/** C cycles these (chase → front tracking → side tracking → chase), orbiting clockwise seen from above. */
const CYCLE: CamMode[] = ["chase", "front", "flank"];
/**
 * Tracking rigs in the bike's smoothed-heading frame. `az` is the camera's bearing around the bike
 * (0 = behind, +π/2 = her right, ±π = ahead); look = (forward, right, height) of the aim point.
 */
const RIG = {
  // Ahead and a little to her left (clear of the leeks), low: she rides toward the lens, road behind her.
  front: { az: -2.84, r: 2.05, y: 1.47, look: [0.02, 0.04, 1.52], fov: 35 },
  // Right-hand profile, paddies and mountains behind her.
  flank: { az: -Math.PI * 1.5 + 0.12, r: 2.75, y: 1.34, look: [0.3, 0, 1.18], fov: 40 },
} as const;
const BLEND_T = 1.8;

interface Polar {
  az: number;
  r: number;
  y: number;
  lf: number;
  lr: number;
  ly: number;
  fov: number;
}

/**
 * Third-person chase camera (low, behind, rider on the left-third line) with an eased blend into
 * a first-person view at her eye point. V toggles; `fpp` is the blend target (0 = TPP, 1 = FPP).
 * C cycles cinematic tracking shots; every switch swings around her on an arc (never through her).
 */
export class ChaseCam {
  readonly cam: THREE.PerspectiveCamera;
  mode: CamMode = "chase";
  fpp = 0;
  /** "custom" mode eye / target, as offsets from the rider's ground position. */
  readonly customPos = new THREE.Vector3();
  readonly customLook = new THREE.Vector3();
  private blend = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private init = false;
  private qT = new THREE.Quaternion();
  private qF = new THREE.Quaternion();
  private eye = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  /** Active arc transition: from-pose captured at the start, progress 0..1. */
  private tr: { from: Polar; k: number } | null = null;
  /** Mode to swing to once the first-person blend has fully backed out. */
  private pending: CamMode | null = null;
  private fov = TPP_FOV;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(TPP_FOV, aspect, TPP_NEAR, 4200);
  }

  toggle(): void {
    if (this.mode !== "chase" || this.tr) {
      // From a cinematic shot V goes straight to first person; V again returns to the chase cam.
      this.pos.copy(this.cam.position);
      this.look.copy(this.cam.position).add(new THREE.Vector3(0, 0, -4).applyQuaternion(this.cam.quaternion));
      this.mode = "chase";
      this.tr = null;
      this.pending = null;
      this.fpp = 1;
      return;
    }
    this.fpp = this.fpp > 0.5 ? 0 : 1;
  }

  /** C: chase → front → side → chase. From first person it backs out, then swings to the front shot. */
  cycle(): void {
    if (this.fpp > 0.5 || this.blend > 0.05) {
      this.fpp = 0;
      this.pending = "front";
      return;
    }
    const i = CYCLE.indexOf(this.mode);
    this.swingTo(CYCLE[(i < 0 ? 0 : i + 1) % CYCLE.length]);
  }

  /** Continue from wherever the camera is now (e.g. the on-foot orbit cam) with an arc into `mode`. */
  handoff(mode: CamMode = this.mode): void {
    this.fpp = 0;
    this.blend = 0;
    this.pending = null;
    this.swingTo(mode === "front" || mode === "flank" ? mode : "chase");
  }

  /** Snap out of first person (on-foot mode shows the whole body). */
  forceThirdPerson(rider: Rider): void {
    this.fpp = 0;
    this.blend = 0;
    this.pending = null;
    rider.setFirstPerson(false);
    rider.setSkirtHidden(false);
  }

  private swingTo(mode: CamMode): void {
    this.mode = mode;
    this.tr = { from: { az: 0, r: 0, y: 0, lf: 0, lr: 0, ly: 0, fov: this.fov }, k: -1 };
  }

  /** Current first-person blend (eased), for hiding the head and tuning post. */
  get fppBlend(): number {
    return this.blend;
  }

  get cinematic(): boolean {
    return this.mode === "front" || this.mode === "flank" || this.tr !== null;
  }

  shift(dz: number): void {
    this.pos.z += dz;
    this.look.z += dz;
  }

  update(dt: number, c: Controller, t: number, rider: Rider): void {
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw); // rider's right
    if (!this.init) this.yaw = c.yaw;
    this.yaw = damp(this.yaw, c.yaw, 2.2, dt);
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
    const cxr = Math.cos(this.yaw), czr = -Math.sin(this.yaw);
    const sway = Math.sin(t * 0.7) * 0.05 + Math.sin(t * 1.9) * 0.015;
    const bob = Math.sin(t * 1.1) * 0.025;
    if (this.pending && this.blend < 0.02) {
      const m = this.pending;
      this.pending = null;
      this.pos.copy(this.cam.position);
      this.swingTo(m);
    }
    let tp: THREE.Vector3;
    let tl: THREE.Vector3;
    let hard = this.mode !== "chase";
    const head = rider.eyeWorld(new THREE.Vector3());
    let fov = TPP_FOV;
    // Chase steady state (also the target of arcs back into the chase cam).
    const chaseP = () => new THREE.Vector3(c.x + bx * 4.2 + cxr * (sway + 0.35), 1.5 + bob, c.z + bz * 4.2 + czr * (sway + 0.35));
    const chaseL = () => new THREE.Vector3(c.x + fx * 7 + cxr * 1.9, 1.25, c.z + fz * 7 + czr * 1.9);
    // Bike-frame polar ↔ world, in the smoothed heading (so tracking shots glide through bends).
    const sfx = -bx, sfz = -bz;
    const toPolar = (p: THREE.Vector3, l: THREE.Vector3, fv: number): Polar => {
      const dx = p.x - c.x, dz = p.z - c.z;
      const lf = dx * sfx + dz * sfz, lr = dx * cxr + dz * czr;
      const ldx = l.x - c.x, ldz = l.z - c.z;
      return { az: Math.atan2(lr, -lf), r: Math.hypot(lf, lr), y: p.y, lf: ldx * sfx + ldz * sfz, lr: ldx * cxr + ldz * czr, ly: l.y, fov: fv };
    };
    const fromPolar = (q: Polar, p: THREE.Vector3, l: THREE.Vector3) => {
      const ca = Math.cos(q.az), sa = Math.sin(q.az);
      p.set(c.x + (bx * ca + cxr * sa) * q.r, q.y, c.z + (bz * ca + czr * sa) * q.r);
      l.set(c.x + sfx * q.lf + cxr * q.lr, q.ly, c.z + sfz * q.lf + czr * q.lr);
    };
    const rigPolar = (m: "front" | "flank"): Polar => {
      const g = RIG[m];
      const drift = m === "front" ? Math.sin(t * 0.43) * 0.05 : Math.sin(t * 0.37) * 0.06;
      return { az: g.az + drift * 0.3, r: g.r + Math.sin(t * 0.29) * 0.04, y: g.y + bob * 0.6, lf: g.look[0], lr: g.look[1], ly: g.look[2] + Math.sin(t * 0.8) * 0.01, fov: g.fov };
    };
    switch (this.mode) {
      case "front":
      case "flank": {
        hard = true;
        const q = rigPolar(this.mode);
        tp = new THREE.Vector3();
        tl = new THREE.Vector3();
        fromPolar(q, tp, tl);
        fov = q.fov;
        break;
      }
      case "face": // 3/4 front, close on the head
        tp = new THREE.Vector3(head.x + fx * 0.85 + rx * 0.45, head.y + 0.02, head.z + fz * 0.85 + rz * 0.45);
        tl = head.clone().setY(head.y - 0.06);
        break;
      case "faceside":
        tp = new THREE.Vector3(head.x + rx * 0.95 + fx * 0.05, head.y + 0.0, head.z + rz * 0.95 + fz * 0.05);
        tl = head.clone().setY(head.y - 0.06);
        break;
      case "back":
        tp = new THREE.Vector3(head.x - fx * 1.3 + rx * 0.2, head.y + 0.1, head.z - fz * 1.3 + rz * 0.2);
        tl = head.clone().setY(head.y - 0.25);
        break;
      case "overhead": {
        // Steepest allowed look-down (55°), behind her: an outfit / modesty check view.
        const r = 2.4, pitch = 0.96;
        tp = new THREE.Vector3(c.x - fx * r * Math.cos(pitch), 1.25 + r * Math.sin(pitch), c.z - fz * r * Math.cos(pitch));
        tl = new THREE.Vector3(c.x, 1.25, c.z);
        break;
      }
      case "closeup":
        tp = new THREE.Vector3(c.x + rx * 2.1 + fx * 1.5, 1.2, c.z + rz * 2.1 + fz * 1.5);
        tl = new THREE.Vector3(c.x + fx * 0.05, 0.95, c.z + fz * 0.05);
        break;
      case "side":
        tp = new THREE.Vector3(c.x - rx * 3.0 + fx * 0.6, 1.25, c.z - rz * 3.0 + fz * 0.6);
        tl = new THREE.Vector3(c.x, 0.9, c.z);
        break;
      case "paddy": {
        // Low over the left verge, looking across the mirror paddies toward the far trees.
        const z = c.z - 6;
        tp = new THREE.Vector3(roadX(z) - 3.2, 0.9, z);
        tl = new THREE.Vector3(roadX(z - 26) - 30, -0.4, z - 26);
        break;
      }
      case "custom": // capture tooling: an exact eye + target, relative to the rider
        tp = this.customPos.clone().add(new THREE.Vector3(c.x, 0, c.z));
        tl = this.customLook.clone().add(new THREE.Vector3(c.x, 0, c.z));
        break;
      case "houses": {
        const z = c.z;
        tp = new THREE.Vector3(roadX(z) - 1.0, 1.6, z);
        tl = new THREE.Vector3(roadX(z - 22) + 10, 2.6, z - 22);
        break;
      }
      default:
        hard = false;
        // Low chase: 1.5 m high, 4.2 m back, aimed 0.6 m right so she sits on the left third.
        tp = chaseP();
        tl = chaseL();
    }
    if (this.tr) {
      // Arc transition: interpolate bearing / radius / height around the bike, never the straight line.
      const tr = this.tr;
      if (tr.k < 0) {
        const l = this.cam.position.clone().add(new THREE.Vector3(0, 0, -4).applyQuaternion(this.cam.quaternion));
        tr.from = toPolar(this.cam.position, l, this.fov);
        tr.k = 0;
      }
      tr.k = Math.min(1, tr.k + dt / BLEND_T);
      let to: Polar;
      if (this.mode === "front" || this.mode === "flank") to = rigPolar(this.mode);
      else {
        // Chase target including its steady trailing lag (exponential follow lags by v / rate).
        const v = Math.max(0, c.speed);
        const p = chaseP(), l = chaseL();
        p.x -= (fx * v) / 4.5;
        p.z -= (fz * v) / 4.5;
        l.x -= (fx * v) / 6;
        l.z -= (fz * v) / 6;
        to = toPolar(p, l, TPP_FOV);
      }
      let a1 = to.az;
      while (a1 > tr.from.az) a1 -= Math.PI * 2;
      while (a1 < tr.from.az - Math.PI * 2) a1 += Math.PI * 2;
      const k = tr.k, e = k * k * k * (k * (k * 6 - 15) + 10);
      const q: Polar = {
        az: tr.from.az + (a1 - tr.from.az) * e,
        r: tr.from.r + (to.r - tr.from.r) * e,
        // Lift a little mid-swing so the arc clears the handlebars and basket.
        y: tr.from.y + (to.y - tr.from.y) * e + Math.sin(Math.PI * e) * 0.18,
        lf: tr.from.lf + (to.lf - tr.from.lf) * e,
        lr: tr.from.lr + (to.lr - tr.from.lr) * e,
        ly: tr.from.ly + (to.ly - tr.from.ly) * e,
        fov: tr.from.fov + (to.fov - tr.from.fov) * e,
      };
      // Keep a minimum radius mid-arc so the camera never grazes her.
      q.r = Math.max(q.r, Math.min(tr.from.r, to.r, 1.6) + Math.sin(Math.PI * e) * 0.4);
      fromPolar(q, this.pos, this.look);
      fov = q.fov;
      if (tr.k >= 1) this.tr = null;
      this.init = true;
    } else if (!this.init || hard) {
      this.pos.copy(tp);
      this.look.copy(tl);
      if (!this.init && !hard) {
        // Start at the steady chase pose: an exponential follow trails a moving target by v / rate.
        const v = Math.max(0, c.speed);
        this.pos.x -= (fx * v) / 4.5;
        this.pos.z -= (fz * v) / 4.5;
        this.look.x -= (fx * v) / 6;
        this.look.z -= (fz * v) / 6;
      }
      this.init = true;
    } else {
      this.pos.x = damp(this.pos.x, tp.x, 4.5, dt);
      this.pos.y = damp(this.pos.y, tp.y, 3, dt);
      this.pos.z = damp(this.pos.z, tp.z, 4.5, dt);
      this.look.x = damp(this.look.x, tl.x, 6, dt);
      this.look.y = damp(this.look.y, tl.y, 6, dt);
      this.look.z = damp(this.look.z, tl.z, 6, dt);
    }
    this.fov = fov;
    // TPP orientation.
    this.m4.lookAt(this.pos, this.look, new THREE.Vector3(0, 1, 0));
    this.qT.setFromRotationMatrix(this.m4);
    if (this.mode === "chase") this.qT.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -c.lean * 0.12));

    // FPP: at her eyes, looking down the road; bob with the pedal stroke, roll into turns.
    const target = this.mode === "chase" && !this.tr ? this.fpp : 0;
    const k = 1 - Math.exp(-dt / 0.14);
    this.blend += (target - this.blend) * k;
    if (Math.abs(target - this.blend) < 0.002) this.blend = target;
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    // Upright eye point over the saddle (her leaning head would put the bars straight below).
    rider.eyeWorld(this.eye);
    this.eye.x -= fx * 0.22;
    this.eye.z -= fz * 0.22;
    // ±2 cm bob on each downstroke, and a small side-to-side weight shift per crank revolution.
    this.eye.y = 1.52 + Math.sin(c.crank * 2) * 0.02 * c.pedaling;
    const shift = Math.sin(c.crank) * 0.012 * c.pedaling;
    this.eye.x += fz * shift;
    this.eye.z -= fx * shift;
    const fl = new THREE.Vector3(this.eye.x + fx * 10, this.eye.y - 4.2, this.eye.z + fz * 10);
    this.m4.lookAt(this.eye, fl, new THREE.Vector3(0, 1, 0));
    this.qF.setFromRotationMatrix(this.m4);
    this.qF.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.lean * 0.8 + Math.sin(c.crank) * 0.008 * c.pedaling));

    this.cam.position.lerpVectors(this.pos, this.eye, e);
    // Arc up over her head mid-blend rather than flying through her back.
    this.cam.position.y += Math.sin(Math.PI * e) * 0.45;
    this.cam.quaternion.slerpQuaternions(this.qT, this.qF, e);
    this.cam.fov = fov + (FPP_FOV - fov) * e;
    this.cam.near = TPP_NEAR + (FPP_NEAR - TPP_NEAR) * e;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    rider.setFirstPerson(e > 0.12, e > 0.93);
    rider.setSkirtHidden(e > 0.3 && e < 0.97);
  }
}
