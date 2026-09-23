import * as THREE from "three";
import { ID, M, merge, prep } from "./geo";
import { roadX, roadYaw } from "./road";
import { uber } from "../render/materials";
import { LAYER_REFLECT } from "../render/lightpasses";
import { mulberry32, range } from "../core/rng";

/**
 * Birds, all CPU-animated instances (one body + two wing instances each, wings hinged at the
 * shoulder): loose flocks and a V of egrets drifting across the sky, a pair of swallows skimming
 * the paddies, a kite (tobi) circling high, and sparrows perched on the power lines ahead that
 * scatter when the bike or the walker comes close.
 */
type Kind = "flock" | "egret" | "swallow" | "kite" | "perch";

interface Bird {
  kind: Kind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  ph: number;
  /** flock / group index, or perch slot. */
  g: number;
  off: THREE.Vector3;
  /** perch: 0 sitting, 1 flying off, 2 gone (waiting for a new span). */
  mode: number;
  timer: number;
  face: number;
}

interface Flock {
  c: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  alt: number;
  kind: "flock" | "egret";
}

const POLE_SPACING = 40, POLE_U = 3.95, TIP_Y = 8.6 - 0.28, SAG = 0.55;
const TIPS = [-0.7, 0, 0.7];

function bodyGeo(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.05, 8, 6);
  body.scale(1, 0.85, 2.6);
  const head = new THREE.SphereGeometry(0.036, 8, 6);
  head.translate(0, 0.02, 0.12);
  const beak = new THREE.ConeGeometry(0.012, 0.04, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.015, 0.165);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute("position", new THREE.Float32BufferAttribute([-0.05, 0, -0.2, 0.05, 0, -0.2, 0, 0.01, -0.1, -0.05, 0, -0.2, 0, 0.01, -0.1, 0.05, 0, -0.2], 3));
  tail.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  tail.computeVertexNormals();
  return merge([prep(body, "#ffffff", M.plain), prep(head, "#ffffff", M.plain), prep(beak, "#6a5a3a", M.plain), prep(tail, "#ffffff", M.plain)]);
}

/** Left-to-right tapered swept wing from the hinge at x = 0 to the tip at x = 0.3 (+x). */
function wingGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.05);
  s.lineTo(0.14, 0.035);
  s.lineTo(0.3, -0.05);
  s.lineTo(0.26, -0.085);
  s.lineTo(0.12, -0.07);
  s.lineTo(0, -0.06);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return prep(g, "#ffffff", M.plain);
}

export class Birds {
  readonly group = new THREE.Group();
  private readonly birds: Bird[] = [];
  private readonly flocks: Flock[] = [];
  private readonly body: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly r = mulberry32(4242);
  private kiteC = new THREE.Vector3();
  private readonly perchSpans: { z: number; tip: number }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly w4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    const r = this.r;
    const add = (kind: Kind, n: number, g: number, scale: [number, number], color: string) => {
      for (let i = 0; i < n; i++)
        this.birds.push({ kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -1), scale: range(r, scale[0], scale[1]), ph: r() * 20, g, off: new THREE.Vector3(), mode: 2, timer: 0, face: r() > 0.5 ? 1 : -1, _c: color } as Bird & { _c: string });
    };
    this.flocks.push({ c: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 11, alt: 40, kind: "flock" });
    this.flocks.push({ c: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 12, alt: 28, kind: "flock" });
    this.flocks.push({ c: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 7.5, alt: 34, kind: "egret" });
    this.flocks.push({ c: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 10, alt: 55, kind: "flock" });
    add("flock", 11, 0, [1.7, 2.3], "#2b2d36");
    add("flock", 8, 1, [1.5, 2.0], "#33313a");
    add("egret", 7, 2, [3.2, 3.8], "#f4f2ea");
    add("flock", 14, 3, [1.8, 2.4], "#2b2d36");
    add("swallow", 2, 0, [1.05, 1.15], "#1c2438");
    add("kite", 1, 0, [4.2, 4.2], "#5a463a");
    add("perch", 12, 0, [0.95, 1.1], "#5a4a3e");
    const n = this.birds.length;
    const mat = uber(ID.wire, 0.8, THREE.DoubleSide);
    this.body = new THREE.InstancedMesh(bodyGeo(), mat, n);
    this.wings = new THREE.InstancedMesh(wingGeo(), mat, n * 2);
    const c = new THREE.Color();
    this.birds.forEach((b, i) => {
      c.set((b as Bird & { _c: string })._c);
      this.body.setColorAt(i, c);
      this.wings.setColorAt(i * 2, c);
      this.wings.setColorAt(i * 2 + 1, c);
      // Kite: pale underwing bands would be lost at distance; keep one flat brown.
    });
    for (const m of [this.body, this.wings]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.layers.enable(LAYER_REFLECT);
      this.group.add(m);
    }
    this.flocks.forEach((f, i) => (f.c.set(1e6, 0, 0), (f.alt = [40, 26, 32, 58][i])));
    for (const b of this.birds) {
      if (b.kind === "egret") {
        const k = Math.ceil(b.ph % 7);
        b.off.set((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.4, range(r, -0.3, 0.3), Math.ceil(k / 2) * 2.1);
      } else if (b.kind === "flock") b.off.set(range(r, -9, 9), range(r, -2.5, 2.5), range(r, -7, 7));
    }
  }

  /** Debug/capture: where things are (world coords). */
  info(): { flocks: number[][]; kite: number[]; perched: number[][]; flying: number } {
    return {
      flocks: this.flocks.map((f) => [f.c.x, f.c.y, f.c.z]),
      kite: [this.kiteC.x, 78, this.kiteC.z],
      perched: this.birds.filter((b) => b.kind === "perch" && b.mode === 0).map((b) => [b.pos.x, b.pos.y, b.pos.z]),
      flying: this.birds.filter((b) => b.kind === "perch" && b.mode === 1).length,
    };
  }

  /** The world wrapped by +dz (rider crossed the period): keep every bird where it is visually. */
  shift(dz: number): void {
    for (const b of this.birds) b.pos.z += dz;
    for (const f of this.flocks) f.c.z += dz;
    this.kiteC.z += dz;
    for (const s of this.perchSpans) s.z += dz;
    for (const b of this.birds) if (b.kind === "perch") b.off.x += dz;
  }

  update(dt: number, t: number, cam: THREE.Camera, actor: THREE.Vector3): void {
    const r = this.r;
    const cp = cam.position;
    const fwd = this.tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const fx = fwd.x, fz = fwd.z;
    const side = new THREE.Vector3(-fz, 0, fx);

    // Flocks: respawn off to one side, ahead of the camera, crossing the view.
    for (const f of this.flocks) {
      if (f.c.distanceTo(cp) > 280) {
        const s = r() > 0.5 ? 1 : -1;
        const ahead = range(r, 70, 170);
        f.c.set(cp.x + fx * ahead + side.x * s * 150, f.alt + range(r, -6, 6), cp.z + fz * ahead + side.z * s * 150);
        f.dir.set(-side.x * s + fx * range(r, -0.3, 0.5), 0, -side.z * s + fz * range(r, -0.3, 0.5)).normalize();
      }
      f.c.addScaledVector(f.dir, f.speed * dt);
    }
    // Kite circles a slowly drifting centre ahead and to the left.
    const kt = new THREE.Vector3(cp.x + fx * 150 + side.x * -45, 0, cp.z + fz * 150 + side.z * -45);
    if (this.kiteC.distanceTo(kt) > 200) this.kiteC.copy(kt);
    this.kiteC.lerp(kt, 1 - Math.exp(-dt * 0.08));
    this.updatePerches(actor);

    let i = 0;
    for (const b of this.birds) {
      let flap = 0, amp = 1, fold = 1, bank = 0;
      const prev = this.s.copy(b.pos);
      if (b.kind === "flock" || b.kind === "egret") {
        const f = this.flocks[b.g];
        const w = t * 0.3 + b.ph;
        const ox = b.off.x + Math.sin(w) * 1.2, oy = b.off.y + Math.sin(w * 1.7) * 0.6, oz = b.off.z + Math.cos(w * 0.8) * 1.2;
        // Offsets in the flock's own frame (x = right of heading, z = behind).
        const dx = f.dir.x, dz = f.dir.z;
        b.pos.set(f.c.x - dz * ox - dx * oz, f.c.y + oy, f.c.z + dx * ox - dz * oz);
        if (b.kind === "egret") {
          flap = Math.sin(t * 2.6 * Math.PI * 2 * 0.45 + b.ph) * 0.75;
        } else {
          // Bounding flight: bursts of quick beats, then a short glide with wings spread.
          const cyc = (t * 0.9 + b.ph) % 1.6;
          flap = cyc < 1.0 ? Math.sin(t * 58 + b.ph * 5) * 0.9 : 0.12;
        }
      } else if (b.kind === "swallow") {
        // Low swoops over the paddies to the rider's left, never over the road itself.
        const k = b.ph;
        const a = t * 0.55 + k;
        const cx = actor.x - 12 + Math.sin(a * 0.4) * 3, cz = actor.z - 10;
        b.pos.set(cx + Math.sin(a) * 9 + Math.sin(a * 2.3) * 2.5, 1.3 + Math.sin(a * 1.9 + k) * 0.9 + Math.sin(a * 0.7) * 0.5, cz + Math.cos(a * 0.83) * 16);
        const burst = Math.sin(t * 1.4 + k * 3) > 0.35;
        flap = burst ? Math.sin(t * 60 + k) * 0.85 : -0.15;
        fold = burst ? 1 : 1.2;
      } else if (b.kind === "kite") {
        const a = t * 0.17;
        b.pos.set(this.kiteC.x + Math.cos(a) * 42, 78 + Math.sin(a * 0.5) * 4, this.kiteC.z + Math.sin(a) * 42);
        flap = 0.1 + Math.sin(t * 0.9) * 0.05;
        bank = -0.38;
      } else {
        this.perchStep(b, dt, t, actor);
        if (b.mode === 0) {
          flap = -1.25;
          amp = 0.55;
        } else if (b.mode === 1) flap = Math.sin(t * 70 + b.ph * 7) * 1.0;
        else amp = 0;
      }
      if (b.kind !== "perch" || b.mode === 1) {
        if (dt > 0) b.vel.subVectors(b.pos, prev).divideScalar(Math.max(dt, 1e-3));
      }
      this.write(i++, b, flap, amp, fold, bank);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
  }

  private write(i: number, b: Bird, flap: number, amp: number, fold: number, bank: number) {
    const sc = b.scale * (amp > 0 ? 1 : 0);
    let yaw: number, pitch = 0;
    if (b.kind === "perch" && b.mode === 0) {
      yaw = roadYaw(b.pos.z) + (b.face > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(b.ph) * 0.4;
    } else {
      const v = b.vel;
      yaw = Math.atan2(v.x, v.z);
      pitch = -Math.atan2(v.y, Math.hypot(v.x, v.z)) * 0.6;
    }
    this.e.set(pitch, yaw, bank, "YXZ");
    this.q.setFromEuler(this.e);
    this.m4.compose(b.pos, this.q, this.s.set(sc, sc, sc));
    this.body.setMatrixAt(i, this.m4);
    const wscale = b.kind === "perch" && b.mode === 0 ? 0.5 : 1;
    for (const sgn of [1, -1]) {
      this.w4.makeRotationZ(sgn * flap);
      this.w4.premultiply(new THREE.Matrix4().makeTranslation(sgn * 0.035, 0.02, 0.02));
      this.w4.multiply(new THREE.Matrix4().makeScale(sgn * wscale * fold, wscale, wscale));
      this.w4.premultiply(this.m4);
      this.wings.setMatrixAt(i * 2 + (sgn > 0 ? 0 : 1), this.w4);
    }
  }

  // --------------------------------------------------------------- perched on the power lines

  private wirePoint(z: number, tip: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const za = z, zb = z - POLE_SPACING;
    const ax = roadX(za) + POLE_U + TIPS[tip] * Math.cos(roadYaw(za)), azz = za - TIPS[tip] * Math.sin(roadYaw(za));
    const bx = roadX(zb) + POLE_U + TIPS[tip] * Math.cos(roadYaw(zb)), bzz = zb - TIPS[tip] * Math.sin(roadYaw(zb));
    return out.set(ax + (bx - ax) * t, TIP_Y - SAG * 4 * t * (1 - t) + 0.07, azz + (bzz - azz) * t);
  }

  /** Keep 3 spans stocked ahead of the actor; a span behind is freed for a new one. */
  private updatePerches(actor: THREE.Vector3): void {
    const r = this.r;
    for (let k = this.perchSpans.length - 1; k >= 0; k--) {
      const s = this.perchSpans[k];
      if (s.z - POLE_SPACING > actor.z + 15) {
        this.perchSpans.splice(k, 1);
        for (const b of this.birds) if (b.kind === "perch" && b.off.x === s.z && b.mode === 0) b.mode = 2;
      }
    }
    const free = this.birds.filter((b) => b.kind === "perch" && b.mode === 2 && b.timer <= 0);
    while (this.perchSpans.length < 3 && free.length >= 3) {
      const last = this.perchSpans.length ? Math.min(...this.perchSpans.map((s) => s.z)) : actor.z - 20;
      // Next pole-span start (poles at z = -12 - 40 i) at least 25 m past the last stocked one.
      let z = Math.floor((last - 25 + 12) / POLE_SPACING) * POLE_SPACING - 12;
      if (z > actor.z - 25) z -= POLE_SPACING;
      const span = { z, tip: Math.floor(r() * 3) };
      this.perchSpans.push(span);
      const n = 3 + Math.floor(r() * 2);
      let t0 = range(r, 0.2, 0.45);
      for (let j = 0; j < n && free.length; j++) {
        const b = free.shift()!;
        b.mode = 0;
        b.off.set(span.z, span.tip, 0);
        b.face = r() > 0.35 ? 1 : -1;
        b.timer = t0;
        this.wirePoint(span.z, span.tip, t0, b.pos);
        b.vel.set(0, 0, 0);
        t0 += range(r, 0.03, 0.09);
      }
    }
  }

  private perchStep(b: Bird, dt: number, t: number, actor: THREE.Vector3): void {
    if (b.mode === 0) {
      const d = Math.hypot(b.pos.x - actor.x, b.pos.z - actor.z);
      if (d < 13 + (b.ph % 1) * 4) {
        // Scatter: up and away from her, each at its own moment.
        b.mode = 1;
        b.timer = 0;
        const ax = b.pos.x - actor.x, az = b.pos.z - actor.z;
        const l = Math.max(0.1, Math.hypot(ax, az));
        const s = range(this.r, 4, 7);
        b.vel.set((ax / l) * s + range(this.r, -2, 2), range(this.r, 2.5, 4), (az / l) * s + range(this.r, -3, 1));
      }
      // Little hop / turn on the wire now and then.
      b.ph += dt * (Math.sin(t * 0.7 + b.timer * 30) > 0.97 ? 3 : 0);
      return;
    }
    if (b.mode === 1) {
      b.timer += dt;
      b.vel.y += dt * (1.5 - b.timer * 0.3);
      b.vel.x += Math.sin(t * 1.3 + b.ph) * dt * 2;
      b.pos.addScaledVector(b.vel, dt);
      if (b.timer > 9 || b.pos.distanceTo(actor) > 120) {
        b.mode = 2;
        b.timer = 4;
      }
      return;
    }
    b.timer -= dt;
  }
}
