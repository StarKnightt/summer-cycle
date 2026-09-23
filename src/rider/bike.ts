import * as THREE from "three";
import { ID, M, box, merge, prep, sphere, xf } from "../world/geo";
import { uber, uberWith } from "../render/materials";

/**
 * Mamachari (Japanese city bicycle). Bike local frame: forward = -Z, up = +Y, right = +X.
 * Hierarchy: group (lean space) → frame, rear fender, kickstand, rear wheel, crank → pedals,
 * steer (rotates about the head tube; origin HEAD_BOT) → fork/bars, bell, cables, front fender,
 * front wheel, basket → basketContents.
 *
 * Static parts are merged per (parent, outline weight), so the whole bike is ~20 draw calls.
 */

export const WHEEL_R = 0.34;
export const REAR = new THREE.Vector3(0, WHEEL_R, 0.52);
export const FRONT = new THREE.Vector3(0, WHEEL_R, -0.53);
export const BB = new THREE.Vector3(0, 0.3, 0.06);
export const CRANK = 0.165;
export const HEAD_TOP = new THREE.Vector3(0, 0.98, -0.4);
export const HEAD_BOT = new THREE.Vector3(0, 0.74, -0.46);
export const SEAT = new THREE.Vector3(0, 0.9, 0.27);
const KICK_PIVOT = new THREE.Vector3(-0.05, 0.31, 0.32);
const KICK_LEN = 0.32;
const KICK_FOLDED = new THREE.Vector3(-0.06, -0.06, 1).normalize();
/** Deployed leg direction: reaches the ground with the bike leaning PARK_LEAN onto it. */
const KICK_DOWN = new THREE.Vector3(-0.4, -0.9, 0.15).normalize();
/** Parked roll (toward the kickstand, her left) and bar angle. */
export const PARK_LEAN = 0.12;
export const PARK_STEER = 0.32;
export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };

/** Bike-only surface modes of the uber shader (see materials.ts). */
const MT = { chrome: 26, lens: 27, spoke: 28, gloss: 29 } as const;

const RED = "#c42f36";
const CHROME = "#e3e6ea";
const STEEL = "#8e949b";
const BLACK = "#222326";
const TYRE = "#2a2522";
const TREAD = "#121010";
const SIDEWALL = "#4a423b";
const GRIP = "#4d3327";
const SADDLE = "#40271f";
const CASE = RED;
const PIN = "#efe8d8";
const BASKET = "#34373d";
const CABLE = "#1c1c1f";
const REFL = "#d9232b";
const AMBER = "#f39a1c";
const LENS = "#fff3d2";
const GOLD = "#d9b057";

const SEAT_TOP = new THREE.Vector3(0, 0.84, 0.25);
/** Basket: top rim and floor rounded rectangles (x half-width, z range, y), steer-space pivot. */
const BASKET_TOP = { hx: 0.182, z0: -0.835, z1: -0.525, y: 1.01, r: 0.035 };
const BASKET_BOT = { hx: 0.16, z0: -0.815, z1: -0.548, y: 0.768, r: 0.03 };
const BASKET_PIVOT = new THREE.Vector3(0, 0.77, -0.55);

type Geo = THREE.BufferGeometry;
type Col = THREE.ColorRepresentation;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function indexed(pos: number[], nrm: number[], idx: number[], color: Col | number[], mat: number): Geo {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  if (Array.isArray(color)) {
    g.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
    return prep(g, null, mat);
  }
  return prep(g, color, mat);
}

/**
 * Tube swept along a smooth curve through `pts` with a radius profile r(t) (t 0…1 along the
 * curve), `seg` sides, flat end caps. `sq` squashes the section along the curve normal.
 */
function tube(pts: THREE.Vector3[], r: number | ((t: number) => number), color: Col, mat: number, seg = 8, n = 0, sq = 1, caps = true): Geo {
  const curve: THREE.Curve<THREE.Vector3> = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, "centripetal") : new THREE.LineCurve3(pts[0], pts[1]);
  n ||= pts.length > 2 ? Math.max(6, Math.round(curve.getLength() / 0.02)) : 1;
  const fr = curve.computeFrenetFrames(n, false);
  const rf = typeof r === "number" ? () => r : r;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const P = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    curve.getPointAt(t, P);
    const rr = rf(t);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU;
      d.copy(fr.normals[i]).multiplyScalar(Math.cos(a) * sq).addScaledVector(fr.binormals[i], Math.sin(a));
      pos.push(P.x + d.x * rr, P.y + d.y * rr, P.z + d.z * rr);
      d.normalize();
      nrm.push(d.x, d.y, d.z);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * row + j, b = a + 1, c = a + row, e = c + 1;
      idx.push(a, b, c, b, e, c);
    }
  if (caps)
    for (const end of [0, 1]) {
      const i = end * n;
      const T = fr.tangents[i].clone().multiplyScalar(end ? 1 : -1);
      curve.getPointAt(end, P);
      const c0 = pos.length / 3;
      pos.push(P.x, P.y, P.z);
      nrm.push(T.x, T.y, T.z);
      for (let j = 0; j <= seg; j++) {
        const k = (i * row + j) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        nrm.push(T.x, T.y, T.z);
      }
      for (let j = 0; j < seg; j++) {
        if (end) idx.push(c0, c0 + 1 + j, c0 + 2 + j);
        else idx.push(c0, c0 + 2 + j, c0 + 1 + j);
      }
    }
  return indexed(pos, nrm, idx, color, mat);
}

/**
 * Surface of revolution about the bike X axis (wheel axles). Profile points are (lat = x, r); the
 * angle phi runs from the front (-Z) over the top (+Y) to the back (+Z): p = (lat, r sin, -r cos).
 * Hard creases between profile edges unless `soft`. Faces are oriented outward automatically.
 */
function revolve(prof: [number, number][], closed: boolean, color: Col | ((k: number) => Col), mat: number, n = 48, phi0 = 0, phi1 = TAU, soft = false): Geo {
  const m = prof.length;
  const E = closed ? m : m - 1;
  // Outward 2D normal per profile edge (signed area picks the side for closed profiles).
  let area = 0;
  for (let k = 0; k < m; k++) {
    const [a0, b0] = prof[k], [a1, b1] = prof[(k + 1) % m];
    area += a0 * b1 - a1 * b0;
  }
  // Open profiles run with the outside on their left (lat increasing along an outer surface).
  const s = closed ? (area > 0 ? 1 : -1) : -1;
  const en: [number, number][] = [];
  for (let k = 0; k < E; k++) {
    const [a0, b0] = prof[k], [a1, b1] = prof[(k + 1) % m];
    const dl = a1 - a0, dr = b1 - b0, l = Math.hypot(dl, dr) || 1;
    en.push([(dr / l) * s, (-dl / l) * s]);
  }
  const vn = (k: number): [number, number] => {
    const kk = ((k % m) + m) % m;
    const prev = en[(kk - 1 + E) % E], next = en[Math.min(kk, E - 1)];
    if (!closed && kk === 0) return en[0];
    if (!closed && kk === m - 1) return en[E - 1];
    const x = prev[0] + next[0], y = prev[1] + next[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const cf = typeof color === "function" ? color : () => color;
  const cols = n + 1;
  const put = (lat: number, r: number, nl: number, nr: number, k: number) => {
    c.set(cf(k));
    for (let i = 0; i <= n; i++) {
      const ph = phi0 + ((phi1 - phi0) * i) / n;
      const sn = Math.sin(ph), cs = Math.cos(ph);
      pos.push(lat, r * sn, -r * cs);
      nrm.push(nl, nr * sn, -nr * cs);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let k = 0; k < E; k++) {
    const k1 = (k + 1) % m;
    const na = soft ? vn(k) : en[k], nb = soft ? vn(k1) : en[k];
    const base = pos.length / 3;
    put(prof[k][0], prof[k][1], na[0], na[1], k);
    put(prof[k1][0], prof[k1][1], nb[0], nb[1], k1);
    for (let i = 0; i < n; i++) {
      const a = base + i, b = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  // Orient: first triangle's winding must agree with its normal.
  const A = V(pos[idx[0] * 3], pos[idx[0] * 3 + 1], pos[idx[0] * 3 + 2]);
  const B = V(pos[idx[1] * 3], pos[idx[1] * 3 + 1], pos[idx[1] * 3 + 2]);
  const C = V(pos[idx[2] * 3], pos[idx[2] * 3 + 1], pos[idx[2] * 3 + 2]);
  const fn = B.sub(A).cross(C.sub(A));
  const N0 = V(nrm[idx[0] * 3], nrm[idx[0] * 3 + 1], nrm[idx[0] * 3 + 2]);
  if (fn.dot(N0) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  return indexed(pos, nrm, idx, col, mat);
}

/** Rotate a geometry built around the X axis so that axis points along `dir`, then place it. */
function orientX(g: Geo, dir: THREE.Vector3, at: THREE.Vector3): Geo {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir.clone().normalize()));
  return g.translate(at.x, at.y, at.z);
}

/** Coil spring from a to b. */
function helix(a: THREE.Vector3, b: THREE.Vector3, r: number, turns: number, wire: number, color: Col, mat: number): Geo {
  const ax = b.clone().sub(a);
  const len = ax.length();
  ax.normalize();
  const u = Math.abs(ax.y) < 0.9 ? V(0, 1, 0).cross(ax).normalize() : V(1, 0, 0).cross(ax).normalize();
  const w = ax.clone().cross(u);
  const pts: THREE.Vector3[] = [];
  const n = Math.round(turns * 12);
  for (let i = 0; i <= n; i++) {
    const t = i / n, ang = t * turns * TAU;
    pts.push(a.clone().addScaledVector(ax, t * len).addScaledVector(u, Math.cos(ang) * r).addScaledVector(w, Math.sin(ang) * r));
  }
  return tube(pts, wire, color, mat, 5, n * 2);
}

/** Rounded rectangle perimeter point at arc fraction u (0…1), CCW seen from above. */
function rrect(R: { hx: number; z0: number; z1: number; r: number }, u: number): [number, number, number, number] {
  const w = R.hx * 2 - 2 * R.r, d = R.z1 - R.z0 - 2 * R.r;
  const arc = (Math.PI / 2) * R.r;
  const P = 2 * w + 2 * d + 4 * arc;
  let s = (((u % 1) + 1) % 1) * P;
  // Start at the middle of the front edge (-z), go toward +x.
  const segs: [number, (t: number) => [number, number, number, number]][] = [
    [w / 2, (t) => [t, R.z0, 0, -1]],
    [arc, (t) => { const a = -Math.PI / 2 + (t / arc) * (Math.PI / 2); return [w / 2 + Math.cos(a) * R.r, R.z0 + R.r + Math.sin(a) * R.r, Math.cos(a), Math.sin(a)]; }],
    [d, (t) => [R.hx, R.z0 + R.r + t, 1, 0]],
    [arc, (t) => { const a = (t / arc) * (Math.PI / 2); return [w / 2 + Math.cos(a) * R.r, R.z1 - R.r + Math.sin(a) * R.r, Math.cos(a), Math.sin(a)]; }],
    [w, (t) => [w / 2 - t, R.z1, 0, 1]],
    [arc, (t) => { const a = Math.PI / 2 + (t / arc) * (Math.PI / 2); return [-w / 2 + Math.cos(a) * R.r, R.z1 - R.r + Math.sin(a) * R.r, Math.cos(a), Math.sin(a)]; }],
    [d, (t) => [-R.hx, R.z1 - R.r - t, -1, 0]],
    [arc, (t) => { const a = Math.PI + (t / arc) * (Math.PI / 2); return [-w / 2 + Math.cos(a) * R.r, R.z0 + R.r + Math.sin(a) * R.r, Math.cos(a), Math.sin(a)]; }],
    [w / 2, (t) => [-w / 2 + t, R.z0, 0, -1]],
  ];
  for (const [l, f] of segs) {
    if (s <= l) return f(s);
    s -= l;
  }
  return segs[segs.length - 1][1](segs[segs.length - 1][0]);
}

/** Point on the basket wall at perimeter fraction u, height fraction v (0 floor … 1 rim), pushed out by `out`. */
function basketPt(u: number, v: number, out = 0): THREE.Vector3 {
  const [xb, zb, nxb, nzb] = rrect(BASKET_BOT, u);
  const [xt, zt] = rrect(BASKET_TOP, u);
  return V(xb + (xt - xb) * v + nxb * out, BASKET_BOT.y + (BASKET_TOP.y - BASKET_BOT.y) * v, zb + (zt - zb) * v + nzb * out);
}

/** Collects geometry for one merged mesh. */
class Bucket {
  list: Geo[] = [];
  push(...g: Geo[]): this {
    this.list.push(...g);
    return this;
  }
}

export interface BikeState {
  steer: number;
  wheel: number;
  crank: number;
  /** 0 folded … 1 kickstand down (parked). */
  kick?: number;
  /** Ground speed (m/s) and clock (s): drive rattle, cable sway and spoke blur. */
  speed?: number;
  time?: number;
}

export class Bike {
  /** Everything of the bike; add to the rider's lean group (identity transform). */
  readonly group = new THREE.Group();
  /** Fork, bars, basket and front wheel: rotates about the head tube. Origin at HEAD_BOT. */
  readonly steer = new THREE.Group();
  /** Front basket (rattles on bumps; pivots at its rear lower mount). */
  readonly basket = new THREE.Group();
  /**
   * Child of `basket` whose local frame equals steer space (bike coordinates minus HEAD_BOT), so
   * loads modelled in bike coordinates can be added directly and ride along with the basket.
   */
  readonly basketContents = new THREE.Group();
  /** Attach point on the middle of the basket floor (local +Y up, -Z forward). */
  readonly basketFloor = new THREE.Object3D();
  private kick = new THREE.Group();
  private frontWheel = new THREE.Group();
  private rearWheel = new THREE.Group();
  private crank = new THREE.Group();
  private pedals: THREE.Group[] = [];
  private bell = new THREE.Group();
  private bellLever = new THREE.Group();
  private cables = new THREE.Group();
  private frontFender = new THREE.Group();
  private rearFender = new THREE.Group();
  private steerAxis = new THREE.Vector3().subVectors(HEAD_TOP, HEAD_BOT).normalize();
  private lampMat = uberWith(ID.bike, 0.5, { uLamp: { value: 0 } });
  private spokeMats: THREE.ShaderMaterial[] = [];
  private lastWheel = NaN;
  private blur = 0;
  private bellT = -1;
  private bumpIn = 0;
  private rat = { b: 0, vb: 0, bz: 0, vbz: 0, f: 0, vf: 0, r: 0, vr: 0, c: 0, vc: 0, cz: 0, vcz: 0 };
  private lastSteer = 0;
  private lastSpeed = 0;
  private frameF = new Bucket();
  private frameT = new Bucket();

  constructor() {
    this.buildFrame();
    this.buildRear();
    this.buildSteer();
    this.buildBasket();
    this.buildCrank();
    this.group.add(this.rearWheel, this.crank, this.kick);
    this.rearWheel.position.copy(REAR);
    this.buildWheel(this.rearWheel, true);
    this.buildWheel(this.frontWheel, false);
    this.setKick(0);
  }

  /** Dynamo headlamp glow, 0 off … 1 full (for dusk / night). */
  setLamp(k: number): void {
    this.lampMat.uniforms.uLamp.value = Math.min(1, Math.max(0, k));
  }

  /** Thumb-bell "chirin": flicks the striker and shivers the dome (the sound is the audio's job). */
  ringBell(): void {
    this.bellT = 0;
  }

  /** Jolt (0…1) from a kerb / collision: rattles basket, fenders and cables. */
  bump(k: number): void {
    this.bumpIn = Math.max(this.bumpIn, k);
  }

  private mesh(b: Bucket | Geo[], parent: THREE.Object3D, mask = 1, mat?: THREE.Material): THREE.Mesh {
    const list = b instanceof Bucket ? b.list : b;
    const m = new THREE.Mesh(merge(list), mat ?? uber(ID.bike, mask));
    m.userData.bike = true;
    parent.add(m);
    return m;
  }

  private setKick(k: number): void {
    const d = KICK_FOLDED.clone().lerp(KICK_DOWN, k * k * (3 - 2 * k)).normalize();
    this.kick.quaternion.setFromUnitVectors(V(0, -1, 0), d);
  }

  update(dt: number, s: BikeState): void {
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level
    this.setKick(s.kick ?? 0);
    const h = Math.min(Math.max(dt, 0), 1 / 30);
    // Spokes resolve into a soft blur disc once they'd strobe (a few rad/s is plenty).
    const w = Number.isNaN(this.lastWheel) || h <= 0 ? 0 : Math.abs(s.wheel - this.lastWheel) / h;
    this.lastWheel = s.wheel;
    if (h > 0) this.blur += (smooth(2.5, 7, w) - this.blur) * Math.min(1, h * 12);
    for (const m of this.spokeMats) m.uniforms.uBlur.value = this.blur;

    // Rattle: damped springs kicked by road buzz, random seams and jolts.
    if (h > 0) {
      const sp = Math.abs(s.speed ?? 0), t = s.time ?? 0;
      const buzz = Math.min(1, sp / 6);
      const r = this.rat;
      let kick = this.bumpIn * 9;
      if (Math.random() < sp * h * 0.35) kick += (0.6 + Math.random()) * buzz * 2.2;
      this.bumpIn = 0;
      const road = (Math.sin(t * 31.7) * Math.sin(t * 12.3 + 1.3) + 0.5 * Math.sin(t * 47.1 + 0.4)) * buzz;
      const acc = (sp - this.lastSpeed) / h;
      const steerRate = (s.steer - this.lastSteer) / h;
      this.lastSpeed = sp;
      this.lastSteer = s.steer;
      const spring = (x: number, v: number, k: number, c: number, f: number) => {
        v += (-k * x - c * v + f) * h;
        return [x + v * h, v];
      };
      [r.b, r.vb] = spring(r.b, r.vb, 900, 16, road * 40 + kick * 60 * (Math.random() - 0.3));
      [r.bz, r.vbz] = spring(r.bz, r.vbz, 700, 14, kick * 30 * (Math.random() - 0.5) - steerRate * 3);
      [r.f, r.vf] = spring(r.f, r.vf, 1600, 20, road * 60 + kick * 90 * (Math.random() - 0.5));
      [r.r, r.vr] = spring(r.r, r.vr, 1400, 20, road * 50 + kick * 90 * (Math.random() - 0.5));
      [r.c, r.vc] = spring(r.c, r.vc, 60, 5, -acc * 2.5 + road * 6 + kick * 25 * (Math.random() - 0.5));
      [r.cz, r.vcz] = spring(r.cz, r.vcz, 50, 4, -steerRate * 4);
      const cl = (x: number, a: number) => Math.max(-a, Math.min(a, x));
      this.basket.rotation.set(cl(r.b * 0.006, 0.03), 0, cl(r.bz * 0.006, 0.03));
      this.frontFender.rotation.x = cl(r.f * 0.004, 0.02);
      this.rearFender.rotation.x = cl(r.r * 0.004, 0.02);
      this.cables.rotation.set(cl(r.c * 0.01, 0.07), 0, cl(r.cz * 0.01, 0.05));
    }

    // Bell: striker flick, dome shiver.
    if (this.bellT >= 0) {
      this.bellT += h;
      const t = this.bellT;
      const flick = t < 0.28 ? Math.sin((t / 0.28) * Math.PI) : 0;
      this.bellLever.rotation.y = -flick * 0.7;
      const shiver = Math.exp(-t * 7) * Math.sin(t * 95);
      this.bell.rotation.set(shiver * 0.06, 0, shiver * 0.05);
      if (t > 0.9) {
        this.bellT = -1;
        this.bell.rotation.set(0, 0, 0);
        this.bellLever.rotation.y = 0;
      }
    }
  }

  // ------------------------------------------------------------------ frame

  private buildFrame(): void {
    const F = new Bucket(); // painted frame + chrome fittings (full outline)
    const T = new Bucket(); // thin fittings (light outline)
    const G = MT.gloss, C = MT.chrome;
    const lug = (at: THREE.Vector3, dir: THREE.Vector3, r: number, len: number, color = RED, mat: number = G) =>
      F.push(orientX(revolve([[-len / 2, r * 0.9], [-len / 2 + 0.004, r], [len / 2 - 0.004, r], [len / 2, r * 0.9]], false, color, mat, 20, 0, TAU, true), dir, at));

    // Head tube with lugs, headset cups and a little gold head badge.
    const hAx = HEAD_TOP.clone().sub(HEAD_BOT).normalize();
    F.push(tube([HEAD_BOT, HEAD_TOP], 0.025, RED, G, 16));
    lug(HEAD_BOT.clone().addScaledVector(hAx, 0.02), hAx, 0.029, 0.04);
    lug(HEAD_TOP.clone().addScaledVector(hAx, -0.018), hAx, 0.029, 0.036);
    const fwd = V(0, -hAx.z, hAx.y).multiplyScalar(-1); // perpendicular to the head tube, facing -Z
    if (fwd.z > 0) fwd.negate();
    const mid = HEAD_BOT.clone().lerp(HEAD_TOP, 0.52);
    const badge = prep(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 16), GOLD, C);
    badge.scale(1, 1, 1.35);
    badge.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), fwd));
    badge.translate(mid.x + fwd.x * 0.025, mid.y + fwd.y * 0.025, mid.z + fwd.z * 0.025);
    F.push(badge);
    const badgeIn = prep(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), RED, G);
    badgeIn.scale(1, 1, 1.35);
    badgeIn.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), fwd));
    badgeIn.translate(mid.x + fwd.x * 0.0268, mid.y + fwd.y * 0.0268, mid.z + fwd.z * 0.0268);
    F.push(badgeIn);

    // Step-through: one big swooping down tube + a slimmer upper tube into the seat tube.
    const down = [V(0, 0.8, -0.442), V(0, 0.7, -0.365), V(0, 0.57, -0.235), V(0, 0.43, -0.115), V(0, 0.335, -0.01), V(0, BB.y, BB.z)];
    F.push(tube(down, (t) => 0.027 - 0.003 * t, RED, G, 14));
    const upper = [V(0, 0.885, -0.418), V(0, 0.8, -0.3), V(0, 0.7, -0.1), V(0, 0.635, 0.07), V(0, 0.605, 0.162)];
    F.push(tube(upper, (t) => 0.019 - 0.002 * t, RED, G, 12));
    // Seat tube, lugs, BB shell.
    const stAx = SEAT_TOP.clone().sub(BB).normalize();
    F.push(tube([BB, SEAT_TOP], (t) => 0.021 - 0.002 * t, RED, G, 14));
    lug(SEAT_TOP.clone().addScaledVector(stAx, -0.022), stAx, 0.024, 0.045);
    F.push(orientX(revolve([[-0.024, 0.029], [-0.04, 0.026], [0.04, 0.026], [0.024, 0.029]], false, CHROME, C, 18, 0, TAU, true), stAx, SEAT_TOP.clone().addScaledVector(stAx, -0.004)));
    F.push(orientX(revolve([[0.0, 0.0], [0.0, 0.006], [0.018, 0.006], [0.018, 0.0]], false, CHROME, C, 8), V(1, 0, 0), SEAT_TOP.clone().add(V(0.02, -0.006, 0.012))));
    F.push(orientX(revolve([[-0.042, 0.022], [-0.04, 0.026], [0.04, 0.026], [0.042, 0.022]], false, RED, G, 18, 0, TAU, true), V(1, 0, 0), BB));
    // Chain- and seat stays (tapered, flattened a touch) with a bridge above the tyre.
    for (const s of [-1, 1]) {
      F.push(tube([V(s * 0.052, 0.342, 0.515), V(s * 0.04, 0.33, 0.3), V(s * 0.03, 0.308, 0.09)], (t) => 0.0105 + 0.003 * t, RED, G, 10));
      F.push(tube([V(s * 0.05, 0.352, 0.505), V(s * 0.038, 0.58, 0.37), V(s * 0.022, 0.8, 0.238)], (t) => 0.0092 + 0.002 * t, RED, G, 10));
      // Dropout plate + axle nut.
      F.push(xf(box(0.006, 0.04, 0.05, RED, G), s * 0.054, 0.345, 0.515, -0.3));
      F.push(orientX(revolve([[0, 0], [0, 0.009], [0.007, 0.009], [0.007, 0]], false, CHROME, C, 6), V(s, 0, 0), V(s * 0.06, REAR.y, REAR.z)));
    }
    F.push(tube([V(-0.036, 0.66, 0.325), V(0.036, 0.66, 0.325)], 0.006, RED, G, 8));
    // Registration sticker (防犯登録) wrapped on the seat tube: white, blue header, number strip.
    const stick = (r: number, h: number, dy: number, color: Col, th0: number, thL: number) => {
      const g = prep(new THREE.CylinderGeometry(r, r, h, 12, 1, true, th0, thL), color, M.plain);
      g.translate(0, dy, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), stAx));
      const c = BB.clone().addScaledVector(stAx, 0.34);
      F.push(g.translate(c.x, c.y, c.z));
    };
    stick(0.0212, 0.052, 0, "#f4f3ee", Math.PI / 2 - 0.75, 1.5);
    stick(0.0215, 0.012, 0.019, "#2f5da6", Math.PI / 2 - 0.75, 1.5);
    stick(0.0215, 0.009, -0.004, "#262a33", Math.PI / 2 - 0.45, 0.9);
    stick(0.0215, 0.004, -0.017, "#c23a3a", Math.PI / 2 - 0.45, 0.35);

    // Full chain case (right side): stadium around chainring and rear sprocket, enamelled in the
    // frame colour with a cream pinstripe and a silver maker's label.
    const hull = (pad: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        pts.push([-BB.z + Math.cos(a) * (0.108 + pad), BB.y + Math.sin(a) * (0.108 + pad)]);
        pts.push([-REAR.z + Math.cos(a) * (0.062 + pad), REAR.y + Math.sin(a) * (0.062 + pad)]);
      }
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo: [number, number][] = [], hi: [number, number][] = [];
      for (const p of pts) {
        while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
        hi.push(p);
      }
      const h = lo.slice(0, -1).concat(hi.slice(0, -1));
      return new THREE.Shape(h.map(([x, y]) => new THREE.Vector2(x, y)));
    };
    const caseG = prep(new THREE.ExtrudeGeometry(hull(0), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 2, curveSegments: 4 }), CASE, G);
    caseG.rotateY(Math.PI / 2);
    F.push(caseG.translate(0.074, 0, 0));
    const stripe = prep(new THREE.ExtrudeGeometry(hull(-0.012), { depth: 0.0005, bevelEnabled: false, curveSegments: 4 }), PIN, G);
    const inner = prep(new THREE.ExtrudeGeometry(hull(-0.016), { depth: 0.0008, bevelEnabled: false, curveSegments: 4 }), CASE, G);
    stripe.rotateY(Math.PI / 2);
    inner.rotateY(Math.PI / 2);
    F.push(stripe.translate(0.0905, 0, 0), inner.translate(0.0908, 0, 0));
    F.push(xf(box(0.002, 0.022, 0.1, CHROME, C), 0.0918, 0.322, 0.27));
    for (let i = 0; i < 4; i++) F.push(xf(box(0.002, 0.008, 0.012, "#1f3f7a", M.plain), 0.0925, 0.322, 0.235 + i * 0.022));

    // Rear band-brake drum (left of the hub, fixed to the frame).
    F.push(orientX(revolve([[-0.006, 0.02], [-0.006, 0.048], [0.006, 0.052], [0.008, 0.02]], false, STEEL, M.metal, 28, 0, TAU, false), V(-1, 0, 0), V(-0.06, REAR.y, REAR.z)));
    F.push(xf(box(0.006, 0.012, 0.09, STEEL, M.metal), -0.066, REAR.y - 0.01, REAR.z - 0.05, 0.25));

    // Horseshoe ring lock (馬蹄錠) straddling the rear tyre on the seat stays, key in the lock.
    const lockP: [number, number][] = [[-0.04, 0.352], [-0.04, 0.384], [-0.034, 0.39], [0.034, 0.39], [0.04, 0.384], [0.04, 0.352], [0.032, 0.352], [0.032, 0.38], [-0.032, 0.38], [-0.032, 0.352]];
    const lock = revolve(lockP, true, CHROME, C, 14, 0.24 * Math.PI, 0.41 * Math.PI);
    F.push(lock.translate(0, REAR.y, REAR.z));
    const lockFace = (s: number, color: Col) => {
      const g = revolve([[0, 0.382], [0, 0.356]], false, color, M.metal, 10, 0.255 * Math.PI, 0.395 * Math.PI);
      if (s < 0) mirrorX(g);
      return g.translate(s * 0.0412, REAR.y, REAR.z);
    };
    F.push(lockFace(1, STEEL));
    F.push(lockFace(-1, STEEL));
    const ka = 0.33 * Math.PI, kr = 0.369;
    const kp = V(0.042, REAR.y + kr * Math.sin(ka), REAR.z - kr * Math.cos(ka));
    F.push(orientX(revolve([[0, 0.0085], [0.003, 0.0085], [0.003, 0.004], [0.0035, 0]], false, CHROME, C, 14), V(1, 0, 0), kp));
    F.push(xf(box(0.004, 0.016, 0.012, GOLD, C), kp.x + 0.008, kp.y - 0.004, kp.z, 0, 0, 0.2));
    T.push(xf(box(0.002, 0.03, 0.016, "#e04848", M.plain), kp.x + 0.011, kp.y - 0.03, kp.z + 0.004, 0, 0, 0.12));

    this.frameF = F;
    this.frameT = T;

    // Side kickstand on the left chainstay: tapered leg with a foot, swings down when parked.
    this.kick.position.copy(KICK_PIVOT);
    const K = new Bucket();
    K.push(tube([V(0, 0.01, 0), V(0, -KICK_LEN * 0.5, 0.004), V(0, -KICK_LEN + 0.008, 0)], (t) => 0.012 - 0.004 * t, CHROME, C, 8));
    K.push(orientX(revolve([[-0.014, 0.013], [0.014, 0.013]], false, STEEL, M.metal, 10), V(1, 0, 0), V(0, 0, 0)));
    K.push(xf(box(0.03, 0.01, 0.05, BLACK, M.metal), 0, -KICK_LEN, 0.004));
    this.mesh(K, this.kick, 1);
  }

  /** Rear rack with spring clamp, rear fender with its stays and reflectors, the saddle on springs. */
  private buildRear(): void {
    const F = this.frameF, T = this.frameT;
    const C = MT.chrome;
    // Rack platform: U-loop rails, cross bars, centre rails.
    const y = 0.785, z0 = 0.37, z1 = 0.72, hx = 0.075;
    const loop: THREE.Vector3[] = [V(-hx, y, z0), V(-hx, y, z1 - 0.03), V(-hx * 0.7, y, z1 - 0.004), V(0, y, z1 + 0.004), V(hx * 0.7, y, z1 - 0.004), V(hx, y, z1 - 0.03), V(hx, y, z0)];
    F.push(tube(loop, 0.0058, CHROME, C, 8));
    for (const z of [0.39, 0.48, 0.57, 0.66]) F.push(tube([V(-hx, y, z), V(hx, y, z)], 0.0042, CHROME, C, 6));
    for (const x of [-0.026, 0.026]) F.push(tube([V(x, y + 0.001, z0), V(x, y + 0.001, z1 - 0.004)], 0.0042, CHROME, C, 6));
    for (const s of [-1, 1]) {
      // Two stays per side converging on the dropout; front struts to the seat stays.
      F.push(tube([V(s * hx, y, 0.66), V(s * 0.072, 0.56, 0.6), V(s * 0.06, 0.352, 0.522)], 0.0055, CHROME, C, 6));
      F.push(tube([V(s * hx, y, 0.5), V(s * 0.06, 0.352, 0.518)], 0.005, CHROME, C, 6));
      F.push(tube([V(s * hx, y, z0), V(s * 0.035, 0.755, 0.285)], 0.0045, CHROME, C, 6));
    }
    // Spring clamp: a hinged bar lying on top, coil springs at the hinge.
    const cy = y + 0.013;
    F.push(tube([V(-0.05, cy, 0.41), V(-0.05, cy, 0.68), V(-0.035, cy, 0.7), V(0.035, cy, 0.7), V(0.05, cy, 0.68), V(0.05, cy, 0.41)], 0.004, CHROME, C, 6));
    for (const s of [-1, 1]) T.push(helix(V(s * 0.03, cy - 0.004, 0.405), V(s * 0.062, cy - 0.004, 0.405), 0.0075, 4.5, 0.0017, CHROME, C));
    T.push(tube([V(-0.07, cy - 0.004, 0.405), V(0.07, cy - 0.004, 0.405)], 0.0022, CHROME, C, 6));
    // Rear reflector under the rack's back edge.
    F.push(xf(box(0.075, 0.034, 0.012, REFL, M.lantern), 0, y - 0.03, z1 + 0.004));
    F.push(xf(box(0.08, 0.04, 0.008, BLACK, M.metal), 0, y - 0.03, z1 - 0.004));
    F.push(tube([V(0, y, z1 - 0.004), V(0, y - 0.012, z1 - 0.004)], 0.004, CHROME, C, 6));

    // Saddle: sculpted, wide at the back, glossy leatherette, on two coil springs.
    const sad = new THREE.SphereGeometry(1, 28, 14);
    const p = sad.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
      const w = 0.045 + 0.063 * smooth(-0.75, 0.55, z);
      // Domed top with a slight rear kick-up, rolled sides, deep skirt down to the rails.
      const up = yy > 0 ? 0.04 * (1 - 0.3 * smooth(0.45, 1, Math.abs(x))) + 0.008 * smooth(0.5, 1, z) : 0.034 - 0.012 * smooth(-0.2, -1, z);
      const bulge = 1 + 0.06 * Math.max(0, 1 - Math.abs(yy) * 2);
      p.setXYZ(i, x * w * bulge, yy * up + 0.012 * z * z, z * 0.135);
    }
    sad.deleteAttribute("normal");
    sad.computeVertexNormals();
    F.push(prep(sad, SADDLE, MT.gloss).translate(SEAT.x, SEAT.y - 0.004, SEAT.z - 0.03));
    // Piping around the saddle's edge.
    const pipe: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * TAU;
      const z = Math.cos(a), x = Math.sin(a);
      const w = 0.045 + 0.063 * smooth(-0.75, 0.55, z);
      pipe.push(V(x * w * 1.06, SEAT.y - 0.004 + 0.012 * z * z, SEAT.z - 0.03 + z * 0.135));
    }
    T.push(tube(pipe, 0.0035, "#2a1914", M.plain, 5, 80, 1, false));
    // Seat post + clamp + rails + springs.
    const stAx = SEAT_TOP.clone().sub(BB).normalize();
    const postTop = SEAT_TOP.clone().addScaledVector(stAx, 0.03);
    F.push(tube([SEAT_TOP.clone().addScaledVector(stAx, -0.02), postTop], 0.0135, CHROME, C, 12));
    F.push(xf(box(0.03, 0.018, 0.03, CHROME, C), postTop.x, postTop.y + 0.004, postTop.z));
    for (const s of [-1, 1]) {
      F.push(tube([V(0, SEAT.y - 0.012, SEAT.z - 0.14), V(s * 0.026, SEAT.y - 0.02, SEAT.z - 0.06), V(s * 0.055, SEAT.y - 0.018, SEAT.z + 0.045)], 0.0035, CHROME, C, 6));
      F.push(tube([V(s * 0.058, postTop.y + 0.002, SEAT.z + 0.05), V(s * 0.02, postTop.y + 0.004, postTop.z - 0.005), V(0, postTop.y + 0.006, postTop.z - 0.03)], 0.0038, CHROME, C, 6));
      T.push(helix(V(s * 0.058, postTop.y + 0.002, SEAT.z + 0.05), V(s * 0.056, SEAT.y - 0.018, SEAT.z + 0.048), 0.0105, 4.5, 0.0024, CHROME, C));
    }
    this.mesh(F, this.group, 1);
    this.mesh(T, this.group, 0.4);

    // Rear fender (rattles about the stay bridge): chrome C-channel with a painted sky highlight,
    // tail reflector and a pair of thin stays to the dropouts.
    const pivot = V(0, 0.66, 0.325);
    this.rearFender.position.copy(pivot);
    this.group.add(this.rearFender);
    const RF = new Bucket();
    const fprof: [number, number][] = [[-0.041, 0.355], [-0.034, 0.37], [-0.018, 0.3765], [0, 0.378], [0.018, 0.3765], [0.034, 0.37], [0.041, 0.355], [0.037, 0.3545], [0.031, 0.367], [0.016, 0.3725], [0, 0.374], [-0.016, 0.3725], [-0.031, 0.367], [-0.037, 0.3545]];
    RF.push(revolve(fprof, true, CHROME, C, 40, 0.445 * Math.PI, 1.12 * Math.PI, true).translate(0, REAR.y, REAR.z));
    const ta = 1.08 * Math.PI;
    const tp = V(0, REAR.y + 0.382 * Math.sin(ta), REAR.z - 0.382 * Math.cos(ta));
    RF.push(xf(sphere(1, REFL, M.lantern, 14, 8), tp.x, tp.y, tp.z, 0, 0, 0, 0.022, 0.022, 0.009));
    for (const s of [-1, 1]) {
      const a = 1.02 * Math.PI;
      RF.push(tube([V(s * 0.04, REAR.y + 0.36 * Math.sin(a), REAR.z - 0.36 * Math.cos(a)), V(s * 0.06, REAR.y + 0.008, REAR.z + 0.012)], 0.0032, CHROME, C, 5));
    }
    for (const g of RF.list) g.translate(-pivot.x, -pivot.y, -pivot.z);
    this.mesh(RF, this.rearFender, 1);
  }

  // ------------------------------------------------------------------ steer

  private buildSteer(): void {
    this.steer.position.copy(HEAD_BOT);
    this.group.add(this.steer);
    const S = new Bucket(), T = new Bucket();
    const G = MT.gloss, C = MT.chrome;
    const hAx = HEAD_TOP.clone().sub(HEAD_BOT).normalize();
    // Headset cups + lock nut, quill stem.
    S.push(orientX(revolve([[0, 0.027], [0.012, 0.029], [0.016, 0.022]], false, CHROME, C, 20, 0, TAU, true), hAx.clone().negate(), HEAD_BOT));
    S.push(orientX(revolve([[0, 0.027], [0.01, 0.029], [0.02, 0.03], [0.026, 0.024], [0.03, 0.016]], false, CHROME, C, 20, 0, TAU, true), hAx, HEAD_TOP));
    const stemTop = V(0, 1.066, -0.382);
    S.push(tube([HEAD_TOP, V(0, 1.03, -0.39), stemTop], 0.0142, CHROME, C, 12));
    S.push(orientX(revolve([[-0.022, 0.012], [-0.02, 0.018], [0.02, 0.018], [0.022, 0.012]], false, CHROME, C, 16, 0, TAU, true), V(1, 0, 0), stemTop));
    // Fork: chrome crown, tapered red blades with a gentle forward bow.
    const crown = V(0, 0.722, -0.466);
    S.push(xf(box(0.118, 0.026, 0.042, CHROME, C), crown.x, crown.y, crown.z, Math.atan2(hAx.z, hAx.y)));
    for (const s of [-1, 1]) {
      S.push(tube([V(s * 0.047, 0.72, -0.466), V(s * 0.047, 0.6, -0.49), V(s * 0.046, 0.46, -0.522), V(s * 0.045, 0.345, -0.532)], (t) => 0.0135 - 0.005 * t, RED, G, 10));
      S.push(xf(box(0.006, 0.035, 0.03, RED, G), s * 0.046, FRONT.y, FRONT.z));
      S.push(orientX(revolve([[0, 0], [0, 0.009], [0.007, 0.009], [0.007, 0]], false, CHROME, C, 6), V(s, 0, 0), V(s * 0.052, FRONT.y, FRONT.z)));
    }
    // Front caliper brake peeking over the fender.
    S.push(tube([V(-0.03, 0.735, -0.49), V(-0.035, 0.705, -0.5), V(-0.024, 0.66, -0.497)], 0.004, CHROME, C, 6));
    S.push(tube([V(0.03, 0.735, -0.49), V(0.035, 0.705, -0.5), V(0.024, 0.66, -0.497)], 0.004, CHROME, C, 6));
    S.push(xf(box(0.03, 0.012, 0.014, CHROME, C), 0, 0.738, -0.492));

    // Swept-back city bar, grips, brake levers.
    const bar: THREE.Vector3[] = [];
    const half = [V(0.345, 1.05, -0.17), V(0.24, 1.05, -0.17), V(0.2, 1.055, -0.215), V(0.15, 1.064, -0.305), V(0.075, 1.067, -0.372), V(0, 1.067, -0.384)];
    for (const p of half) bar.push(p.clone().setX(-p.x));
    for (let i = half.length - 2; i >= 0; i--) bar.push(half[i].clone());
    S.push(tube(bar, 0.011, CHROME, C, 10));
    const gripProf: [number, number][] = [[-0.056, 0.0], [-0.056, 0.019], [-0.052, 0.021]];
    for (let i = 0; i <= 8; i++) gripProf.push([-0.048 + i * 0.011, i % 2 ? 0.0195 : 0.0182]);
    gripProf.push([0.051, 0.022], [0.056, 0.024], [0.059, 0.02], [0.059, 0.0]);
    for (const s of [-1, 1]) {
      const g = revolve(gripProf, false, GRIP, M.plain, 16, 0, TAU, true);
      if (s < 0) mirrorX(g);
      S.push(g.translate(s * 0.29, 1.05, -0.17));
      // Lever bracket + lever blade reaching out in front of her fingers.
      S.push(orientX(revolve([[-0.009, 0.013], [-0.007, 0.016], [0.007, 0.016], [0.009, 0.013]], false, CHROME, C, 12, 0, TAU, true), V(1, 0, 0), V(s * 0.226, 1.051, -0.186)));
      S.push(tube([V(s * 0.228, 1.046, -0.2), V(s * 0.245, 1.04, -0.222), V(s * 0.3, 1.036, -0.228), V(s * 0.335, 1.037, -0.222)], (t) => 0.0055 - 0.0015 * t, CHROME, C, 6, 0, 0.55));
      S.push(xf(sphere(0.006, CHROME, C, 8, 6), s * 0.337, 1.037, -0.221));
    }

    // Block dynamo headlamp on the left fork blade: round chrome shell, lens, roller on the tyre.
    const lampAt = V(-0.082, 0.63, -0.505);
    S.push(orientX(revolve([[-0.035, 0.0], [-0.035, 0.012], [-0.03, 0.022], [-0.012, 0.028], [0.018, 0.03], [0.024, 0.033], [0.028, 0.032], [0.028, 0.026]], false, CHROME, C, 22, 0, TAU, true), V(0, 0, -1), lampAt));
    S.push(xf(box(0.034, 0.012, 0.018, CHROME, C), -0.064, 0.63, -0.5));
    S.push(tube([V(-0.064, 0.618, -0.488), V(-0.036, 0.63, -0.47), V(-0.024, 0.636, -0.44)], 0.004, STEEL, M.metal, 6));
    S.push(orientX(revolve([[-0.006, 0.0], [-0.006, 0.008], [0.006, 0.008], [0.006, 0.0]], false, BLACK, M.plain, 12), V(0, 0, 1), V(-0.022, 0.638, -0.435)));
    const lens = orientX(revolve([[0, 0.0], [0, 0.027], [0.004, 0.02], [0.006, 0.0]], false, LENS, MT.lens, 22, 0, TAU, true), V(0, 0, -1), lampAt.clone().add(V(0, 0, -0.028)));
    this.mesh([st(lens)], this.steer, 1, this.lampMat);

    // Basket stays: down to the fork ends, flat bracket back to the crown.
    for (const s of [-1, 1]) S.push(tube([V(s * 0.13, 0.768, -0.8), V(s * 0.09, 0.56, -0.66), V(s * 0.056, FRONT.y + 0.01, FRONT.z)], 0.0048, CHROME, C, 6));
    S.push(tube([V(0, 0.77, -0.56), V(0, 0.742, -0.5)], 0.006, CHROME, C, 6, 0, 0.4));

    this.mesh(S.list.map(st), this.steer, 1);

    // Brake cables (sway on a soft spring about the lever line): right = front caliper, left = rear.
    const pivot = V(0, 1.045, -0.2);
    this.cables.position.copy(pivot.clone().sub(HEAD_BOT));
    this.steer.add(this.cables);
    const cab = [
      tube([V(0.226, 1.043, -0.2), V(0.222, 1.03, -0.26), V(0.16, 0.99, -0.42), V(0.07, 0.905, -0.505), V(0.02, 0.8, -0.505), V(0.004, 0.745, -0.494)], 0.0033, CABLE, M.plain, 5),
      tube([V(-0.226, 1.043, -0.2), V(-0.222, 1.03, -0.26), V(-0.15, 0.985, -0.41), V(-0.06, 0.89, -0.48), V(-0.034, 0.8, -0.462), V(-0.03, 0.782, -0.452)], 0.0033, CABLE, M.plain, 5),
    ];
    T.push(...cab);
    this.mesh(T.list.map((g) => g.translate(-pivot.x, -pivot.y, -pivot.z)), this.cables, 0.45);

    // Thumb bell on the left bar: chrome dome that shivers, striker lever that flicks.
    const bellAt = V(-0.19, 1.078, -0.228);
    this.bell.position.copy(bellAt.clone().sub(HEAD_BOT));
    this.steer.add(this.bell);
    const B = new Bucket();
    const dome = revolve([[0, 0.0], [0.002, 0.031], [0.009, 0.03], [0.017, 0.025], [0.023, 0.015], [0.026, 0.005], [0.0265, 0.0]], false, CHROME, C, 28, 0, TAU, true);
    dome.rotateZ(Math.PI / 2); // axis X → Y, dome opens downward
    B.push(dome.translate(0, -0.012, 0));
    B.push(xf(sphere(0.0055, CHROME, C, 8, 6), 0, 0.0155, 0));
    B.push(orientX(revolve([[-0.008, 0.0125], [0.008, 0.0125]], false, BLACK, M.metal, 12), V(0.05, 0.009, -0.09), V(0, -0.024, 0.0)));
    this.mesh(B, this.bell, 1);
    this.bellLever.position.set(0.012, -0.008, 0.012);
    this.bell.add(this.bellLever);
    const BL = [tube([V(0, 0, 0), V(-0.018, 0.0, 0.018), V(-0.034, 0.002, 0.028)], 0.0028, CHROME, C, 6, 0, 0.5), xf(sphere(0.006, CHROME, C, 10, 6), -0.035, 0.002, 0.029)];
    this.mesh(BL, this.bellLever, 1);

    // Front fender (rattles about the crown) with a white mud flap.
    const fp = V(0, 0.71, -0.47);
    this.frontFender.position.copy(fp.clone().sub(HEAD_BOT));
    this.steer.add(this.frontFender);
    const FF = new Bucket();
    const fprof: [number, number][] = [[-0.039, 0.352], [-0.032, 0.365], [-0.017, 0.3715], [0, 0.373], [0.017, 0.3715], [0.032, 0.365], [0.039, 0.352], [0.035, 0.3515], [0.029, 0.362], [0.015, 0.3675], [0, 0.369], [-0.015, 0.3675], [-0.029, 0.362], [-0.035, 0.3515]];
    FF.push(revolve(fprof, true, CHROME, C, 34, 0.08 * Math.PI, 0.64 * Math.PI, true).translate(0, FRONT.y, FRONT.z));
    const fa = 0.08 * Math.PI;
    const flapTop = V(0, FRONT.y + 0.36 * Math.sin(fa), FRONT.z - 0.36 * Math.cos(fa));
    FF.push(xf(box(0.06, 0.07, 0.003, "#f1efe8", M.plain), flapTop.x, flapTop.y - 0.03, flapTop.z - 0.004, 0.2));
    for (const s of [-1, 1]) {
      const a = 0.2 * Math.PI;
      FF.push(tube([V(s * 0.038, FRONT.y + 0.355 * Math.sin(a), FRONT.z - 0.355 * Math.cos(a)), V(s * 0.052, FRONT.y + 0.006, FRONT.z - 0.01)], 0.003, CHROME, C, 5));
    }
    for (const g of FF.list) g.translate(-fp.x, -fp.y, -fp.z);
    this.mesh(FF, this.frontFender, 1);

    this.frontWheel.position.copy(FRONT.clone().sub(HEAD_BOT));
    this.steer.add(this.frontWheel);
  }

  /** Woven wire basket: rolled rim, diamond lattice walls, grid floor. Pivots at its rear mount. */
  private buildBasket(): void {
    const piv = BASKET_PIVOT.clone().sub(HEAD_BOT);
    this.basket.position.copy(piv);
    this.steer.add(this.basket);
    this.basketContents.position.copy(piv).negate();
    this.basket.add(this.basketContents);
    this.basketFloor.position.set(0, BASKET_BOT.y + 0.006, (BASKET_BOT.z0 + BASKET_BOT.z1) / 2).sub(HEAD_BOT);
    this.basketContents.add(this.basketFloor);
    const C = MT.chrome;
    const rim: THREE.Vector3[] = [], mid: THREE.Vector3[] = [], bot: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      rim.push(basketPt(i / 96, 1, 0.002));
      mid.push(basketPt(i / 96, 0.52, 0.002));
      bot.push(basketPt(i / 96, 0, 0.001));
    }
    const R = [tube(rim, 0.0068, BASKET, C, 8, 192, 1, false), tube(bot, 0.0048, BASKET, C, 6, 192, 1, false)];
    const W: Geo[] = [tube(mid, 0.0032, BASKET, C, 5, 192, 1, false)];
    // Diamond lattice: two families of diagonal wires wrapping round the walls.
    const n = 34, slope = 0.12;
    for (const dir of [-1, 1])
      for (let k = 0; k < n; k++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j <= 10; j++) {
          const v = j / 10;
          pts.push(basketPt(k / n + dir * slope * v, 0.02 + v * 0.96, dir * 0.0012));
        }
        W.push(tube(pts, 0.0021, BASKET, C, 4, 10, 1, false));
      }
    // Floor grid.
    const fy = BASKET_BOT.y - 0.002;
    for (let x = -0.12; x <= 0.121; x += 0.04) W.push(tube([V(x, fy, BASKET_BOT.z0 + 0.012), V(x, fy, BASKET_BOT.z1 - 0.012)], 0.0026, BASKET, C, 4));
    for (let z = BASKET_BOT.z0 + 0.045; z < BASKET_BOT.z1 - 0.02; z += 0.045) W.push(tube([V(-BASKET_BOT.hx + 0.01, fy, z), V(BASKET_BOT.hx - 0.01, fy, z)], 0.0026, BASKET, C, 4));
    this.mesh(R.map(st), this.basketContents, 1);
    this.mesh(W.map(st), this.basketContents, 0.3);
  }

  // ------------------------------------------------------------------ crank + wheels

  private buildCrank(): void {
    this.crank.position.copy(BB);
    const Cm = MT.chrome;
    const K = new Bucket();
    // Chainring: 38 teeth, five spider windows, outside the case.
    const ring = new THREE.Shape();
    const nT = 38;
    for (let i = 0; i < nT * 4; i++) {
      const a = (i / (nT * 4)) * TAU;
      const r = [0.1, 0.1, 0.094, 0.094][i % 4];
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ring.moveTo(x, y);
      else ring.lineTo(x, y);
    }
    ring.closePath();
    for (let w = 0; w < 5; w++) {
      const h = new THREE.Path();
      const a0 = (w / 5) * TAU + 0.18, a1 = a0 + TAU / 5 - 0.36;
      h.absarc(0, 0, 0.078, a0, a1, false);
      h.absarc(0, 0, 0.04, a1, a0, true);
      h.closePath();
      ring.holes.push(h);
    }
    const rg = prep(new THREE.ExtrudeGeometry(ring, { depth: 0.004, bevelEnabled: false, curveSegments: 6 }), CHROME, Cm);
    rg.rotateY(Math.PI / 2);
    K.push(rg.translate(0.094, 0, 0));
    K.push(orientX(revolve([[-0.1, 0.012], [0.1, 0.012]], false, STEEL, M.metal, 12), V(1, 0, 0), V(0, 0, 0)));
    for (const s of [1, -1]) {
      // Tapered crank arm with a boss at each end.
      const arm = new THREE.Shape();
      arm.moveTo(-0.017, 0);
      arm.lineTo(-0.011, -CRANK);
      arm.absarc(0, -CRANK, 0.011, Math.PI, 0, false);
      arm.lineTo(0.017, 0);
      arm.absarc(0, 0, 0.017, 0, Math.PI, false);
      const ag = prep(new THREE.ExtrudeGeometry(arm, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 8 }), "#d5d9de", M.metal);
      ag.rotateY(Math.PI / 2);
      if (s < 0) ag.rotateX(Math.PI);
      K.push(ag.translate(s * 0.104 - 0.005, 0, 0));
      K.push(orientX(revolve([[0, 0.009], [0.004, 0.007]], false, CHROME, Cm, 10), V(s, 0, 0), V(s * 0.112, 0, 0)));
      const pedal = new THREE.Group();
      pedal.position.set(s * 0.14, -s * CRANK, 0);
      this.crank.add(pedal);
      // Block pedal: spindle, dark frame, rubber treads, amber reflectors front and back.
      const P = new Bucket();
      P.push(orientX(revolve([[-0.032, 0.006], [0.05, 0.006]], false, CHROME, Cm, 8), V(s, 0, 0), V(0, 0, 0)));
      P.push(xf(box(0.09, 0.02, 0.012, BLACK, M.metal), s * 0.008, 0, -0.03));
      P.push(xf(box(0.09, 0.02, 0.012, BLACK, M.metal), s * 0.008, 0, 0.03));
      for (const sx of [-1, 1]) P.push(xf(box(0.006, 0.022, 0.07, STEEL, M.metal), s * 0.008 + sx * 0.045, 0, 0));
      P.push(xf(box(0.08, 0.012, 0.05, "#141414", M.plain), s * 0.008, 0.004, 0));
      for (const z of [-0.037, 0.037]) P.push(xf(box(0.05, 0.012, 0.004, AMBER, M.lantern), s * 0.008, 0, z));
      this.mesh(P, pedal, 1);
      this.pedals.push(pedal);
    }
    this.mesh(K, this.crank, 1);
  }

  /** Tyre (tread line), chrome rim, hub, valve; 36 tangent-laced spokes + motion-blur disc. */
  private buildWheel(g: THREE.Group, rear: boolean): void {
    const C = MT.chrome;
    const W = new Bucket();
    const tyre: [number, number][] = [];
    const nt = 20;
    for (let i = 0; i < nt; i++) {
      const a = (i / nt) * TAU;
      tyre.push([Math.cos(a) * 0.0195, WHEEL_R - 0.022 + Math.sin(a) * 0.022]);
    }
    // Profile index 5 = crown (a = 90°): dark tread line; a band on each sidewall.
    W.push(revolve(tyre, true, (k) => (k === 5 ? TREAD : k === 0 || k === 10 ? SIDEWALL : TYRE), M.plain, 72, 0, TAU, true));
    const rim: [number, number][] = [[-0.0115, WHEEL_R - 0.058], [0.0115, WHEEL_R - 0.058], [0.0125, WHEEL_R - 0.05], [0.0122, WHEEL_R - 0.036], [0.0095, WHEEL_R - 0.031], [-0.0095, WHEEL_R - 0.031], [-0.0122, WHEEL_R - 0.036], [-0.0125, WHEEL_R - 0.05]];
    W.push(revolve(rim, true, CHROME, C, 72));
    const hub: [number, number][] = [[-0.075, 0.005], [-0.075, 0.009], [-0.042, 0.009], [-0.04, 0.014], [-0.037, 0.031], [-0.032, 0.031], [-0.029, 0.017], [0.029, 0.017], [0.032, 0.031], [0.037, 0.031], [0.04, 0.014], [0.042, 0.009], [0.075, 0.009], [0.075, 0.005]];
    W.push(revolve(hub, true, CHROME, C, 20));
    if (rear) W.push(revolve([[0.04, 0.01], [0.04, 0.034], [0.05, 0.03], [0.05, 0.01]], true, STEEL, M.metal, 16));
    // Valve (English valve with a black cap) between spokes: a moving cue even when blurred.
    const va = 0.5 * (TAU / 36);
    const vr = WHEEL_R - 0.06;
    const vdir = V(0, Math.sin(va), -Math.cos(va));
    W.push(orientX(revolve([[0, 0.0032], [0.022, 0.0032]], false, CHROME, C, 6), vdir.clone().negate(), vdir.clone().multiplyScalar(vr + 0.004)));
    W.push(orientX(revolve([[0, 0.0048], [0.012, 0.0048], [0.014, 0.003]], false, BLACK, M.plain, 8), vdir.clone().negate(), vdir.clone().multiplyScalar(vr - 0.018)));
    this.mesh(W, g, 1);

    const S: Geo[] = [];
    const rr = WHEEL_R - 0.058;
    for (let k = 0; k < 36; k++) {
      const side = k % 2 ? 1 : -1;
      const j = Math.floor(k / 2);
      const aRim = (k / 36) * TAU;
      const aHub = aRim + (j % 2 ? 1 : -1) * 0.95;
      const hubP = V(side * 0.034, Math.sin(aHub) * 0.026, -Math.cos(aHub) * 0.026);
      const rimP = V(side * 0.004, Math.sin(aRim) * rr, -Math.cos(aRim) * rr);
      S.push(tube([hubP, rimP], 0.0016, "#d9dce0", MT.spoke, 4, 1, 1, false));
      const nip = rimP.clone().lerp(hubP, 0.035);
      S.push(tube([rimP, nip], 0.0028, "#e8eaed", MT.spoke, 5, 1, 1, false));
    }
    for (const s of [-1, 1]) {
      const d = prep(new THREE.RingGeometry(0.032, rr - 0.004, 48, 2), "#c7ccd2", MT.spoke);
      d.rotateY(s * Math.PI / 2);
      d.translate(s * 0.02, 0, 0);
      const uv = d.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 1);
      S.push(d);
    }
    const mat = uberWith(ID.bike, 0, { uBlur: { value: 0 } });
    this.spokeMats.push(mat);
    this.mesh(S, g, 0, mat);
  }
}

/** Mirror across x = 0, keeping faces outward. */
function mirrorX(g: Geo): Geo {
  g.scale(-1, 1, 1);
  const ix = g.index!;
  for (let i = 0; i < ix.count; i += 3) {
    const b = ix.getX(i + 1);
    ix.setX(i + 1, ix.getX(i + 2));
    ix.setX(i + 2, b);
  }
  return g;
}

/** Bike coordinates → steer space. */
function st(g: Geo): Geo {
  return g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z);
}

