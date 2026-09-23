import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { ID, M, beam, box, cyl, merge, prep, sphere, xf } from "../world/geo";
import { uber } from "../render/materials";
import { LAYER_SHADOW } from "../render/lightpasses";

/**
 * Mamachari (city bicycle) + schoolgirl rider. Bike local frame: forward = -Z, up = +Y, right = +X.
 * Hierarchy: root (world pos, yaw) → lean (roll) → frame, steer, wheels, crank, body.
 */

const WHEEL_R = 0.34;
const REAR = new THREE.Vector3(0, WHEEL_R, 0.52);
const FRONT = new THREE.Vector3(0, WHEEL_R, -0.53);
const BB = new THREE.Vector3(0, 0.3, 0.06);
const CRANK = 0.165;
const HEAD_TOP = new THREE.Vector3(0, 0.98, -0.4);
const HEAD_BOT = new THREE.Vector3(0, 0.74, -0.46);
const SEAT = new THREE.Vector3(0, 0.9, 0.27);
const KICK_PIVOT = new THREE.Vector3(-0.05, 0.31, 0.32);
const KICK_LEN = 0.32;
const KICK_FOLDED = new THREE.Vector3(-0.06, -0.06, 1).normalize();
/** Deployed leg direction: reaches the ground with the bike leaning PARK_LEAN onto it. */
const KICK_DOWN = new THREE.Vector3(-0.4, -0.9, 0.15).normalize();
/** Parked roll (toward the kickstand, her left) and bar angle. */
export const PARK_LEAN = 0.12;
export const PARK_STEER = 0.32;

const FRAME = "#c7353a";
const CHROME = "#a3a8ae";
const TYRE = "#26221f";
const SKIN = "#fae3d3";
const HAIR = "#2a1e22";
const SHORTS = "#1b2034";
const BLOUSE = "#f4f2ec";
const NAVY = "#27335c";
const SOCK = "#f2f0ea";
const SHOE = "#5a3526";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mk(g: THREE.BufferGeometry, id: number): THREE.Mesh {
  const m = new THREE.Mesh(g, uber(id, 1));
  return m;
}

function wheel(): THREE.Group {
  const g = new THREE.Group();
  const bike = ID.bike;
  const tyre = prep(new THREE.TorusGeometry(WHEEL_R - 0.02, 0.028, 8, 36), TYRE, M.plain);
  tyre.rotateY(Math.PI / 2);
  g.add(mk(tyre, bike));
  const rim = prep(new THREE.TorusGeometry(WHEEL_R - 0.05, 0.012, 6, 36), CHROME, M.metal);
  rim.rotateY(Math.PI / 2);
  g.add(mk(rim, bike));
  const hub = cyl(0.035, 0.035, 0.12, CHROME, M.metal, 10);
  hub.rotateZ(Math.PI / 2);
  g.add(mk(hub, bike));
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const side = i % 2 ? 0.035 : -0.035;
    spokes.push(beam(V(side, 0, 0), V(0, Math.sin(a) * (WHEEL_R - 0.055), Math.cos(a) * (WHEEL_R - 0.055)), 0.0045, "#b8bbc0", M.metal, 3));
  }
  for (const s of spokes) g.add(mk(s, bike));
  return g;
}

/** Two-bone IK. Writes the joint position into `mid`. */
function ik(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, mid: THREE.Vector3): void {
  const d = new THREE.Vector3().subVectors(c, a);
  let len = d.length();
  len = Math.min(Math.max(len, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  d.normalize();
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  mid.copy(a).addScaledVector(d, l1 * cosA).addScaledVector(perp, l1 * sinA);
}

/**
 * A limb segment: unit-height open tube oriented between two points each frame. `radii` is the
 * profile from a (first) to b (last), so muscles bulge and wrists/ankles taper; joints are spheres.
 */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, radii: number[], color: string, mat: number, id: number) {
    const n = radii.length;
    const g = new THREE.CylinderGeometry(1, 1, 1, 12, (n - 1) * 2, true);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) * (n - 1);
      const k = Math.min(n - 2, Math.floor(t));
      const f = t - k;
      const r = radii[k] + (radii[k + 1] - radii[k]) * (f * f * (3 - 2 * f));
      p.setXYZ(i, p.getX(i) * r, p.getY(i), p.getZ(i) * r);
    }
    this.mesh = mk(prep(weld(g), color, mat), id);
    parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    this.mesh.scale.set(1, len, 1);
  }
}

/** Weld seams (drops uv/normal) and recompute smooth normals. */
function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const w = mergeVertices(g, 1e-5);
  w.computeVertexNormals();
  return w;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- head shape (head-local units)

const HEAD_R = 0.125;
const HEAD_SCALE = 1.18;
/** Unit direction from head centre: az 0 = front (-Z), +az toward +X; el up. */
const dirOf = (az: number, el: number) => V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
const CHIN = V(0, -0.72, -0.69).normalize();
const CHEEK_L = V(0.55, -0.3, -0.78).normalize();
const CHEEK_R = V(-0.55, -0.3, -0.78).normalize();
const TEMPLE_L = V(0.8, 0.25, -0.55).normalize();
const TEMPLE_R = V(-0.8, 0.25, -0.55).normalize();
const JAW_L = V(0.72, -0.62, -0.32).normalize();
const JAW_R = V(-0.72, -0.62, -0.32).normalize();

/** Radial face surface: ellipsoid with a flatter front, narrowing jaw, soft pointed chin, round cheeks. */
function faceR(d: THREE.Vector3): number {
  const cz = d.z < 0 ? 0.88 : 1.0;
  const cy = d.y < 0 ? 0.92 : 1.01;
  let r = HEAD_R / Math.sqrt((d.x / 0.93) ** 2 + (d.y / cy) ** 2 + (d.z / cz) ** 2);
  // Oval: the lower face tapers to a soft, slightly pointed chin.
  const lower = smooth(-0.05, -0.8, d.y);
  r *= 1 - 0.2 * lower * Math.abs(d.x);
  r *= 1 - 0.16 * smooth(-0.2, -0.9, d.y) * Math.max(0, d.z);
  r *= 1 + 0.085 * Math.exp(-(1 - d.dot(CHIN)) / 0.03);
  r *= 1 + 0.035 * (Math.exp(-(1 - d.dot(CHEEK_L)) / 0.05) + Math.exp(-(1 - d.dot(CHEEK_R)) / 0.05));
  // Soft temples above the cheekbones and a gentle jaw line under them: the face isn't a flat disc.
  r *= 1 - 0.03 * (Math.exp(-(1 - d.dot(TEMPLE_L)) / 0.03) + Math.exp(-(1 - d.dot(TEMPLE_R)) / 0.03));
  r *= 1 - 0.035 * (Math.exp(-(1 - d.dot(JAW_L)) / 0.04) + Math.exp(-(1 - d.dot(JAW_R)) / 0.04));
  return r;
}

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Outward surface normal of `surf` (radial function) at unit direction d. */
function radialNormal(d: THREE.Vector3, surf: (d: THREE.Vector3) => number): THREE.Vector3 {
  _t1.set(0, 1, 0).cross(d);
  if (_t1.lengthSq() < 1e-6) _t1.set(1, 0, 0);
  _t1.normalize();
  _t2.crossVectors(d, _t1).normalize();
  const e = 0.01;
  const p = (u: number, v: number, out: THREE.Vector3) => {
    const q = d.clone().addScaledVector(_t1, u).addScaledVector(_t2, v).normalize();
    return out.copy(q).multiplyScalar(surf(q));
  };
  const du = p(e, 0, _a).sub(p(-e, 0, new THREE.Vector3()));
  const dv = p(0, e, _b).sub(p(0, -e, new THREE.Vector3()));
  const n = new THREE.Vector3().crossVectors(du, dv).normalize();
  return n.dot(d) < 0 ? n.negate() : n;
}

/** Lower edge of the hair shell (elevation) as a function of |azimuth|: forehead → temple → ear → nape. */
const HAIRLINE: [number, number][] = [[0, 0.8], [0.72, 0.74], [1.08, 0.22], [1.38, -0.18], [1.75, -0.6], [2.35, -0.92], [Math.PI, -0.98]];
function hairline(az: number): number {
  const a = Math.abs(az);
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a0, e0] = HAIRLINE[i - 1], [a1, e1] = HAIRLINE[i];
    if (a <= a1) {
      const f = (a - a0) / (a1 - a0);
      return e0 + (e1 - e0) * (0.5 - 0.5 * Math.cos(f * Math.PI));
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}
/**
 * Wrap a decal onto the face surface at azimuth az (0 = front, +x = her left) / elevation el, so
 * wide pieces never sink into the skin; local +z = outward, `lift` above skin. Returns head space.
 */
function placeOnHead(g: THREE.BufferGeometry, az: number, el: number, lift: number): THREE.BufferGeometry {
  const d = dirOf(az, el);
  const n = radialNormal(d, faceR);
  const p = d.clone().multiplyScalar(faceR(d));
  const m = new THREE.Matrix4().lookAt(p.clone().add(n), p, V(0, 1, 0));
  m.setPosition(p);
  g.applyMatrix4(m);
  const pa = g.attributes.position;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    const z = v.clone().sub(p).dot(n);
    q.copy(v).addScaledVector(n, -z).normalize();
    const ns = radialNormal(q, faceR);
    v.copy(q).multiplyScalar(faceR(q)).addScaledVector(ns, lift + z);
    pa.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Hair volume above the skin: fuller on the crown and the back. */
const shellOff = (d: THREE.Vector3) => 0.011 + 0.012 * Math.max(0, d.y) + 0.008 * Math.max(0, d.z);

/**
 * Tapered clump / ribbon along a path: diamond cross-section (sides ±w, ridge +th along `ups`,
 * a flatter belly underneath), smooth normals, closed ends, all faces wound outward.
 */
function ribbon(pts: THREE.Vector3[], ups: THREE.Vector3[], w: number[], th: number[], color: string, mat: number, belly = 0.35): THREE.BufferGeometry {
  const n = pts.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const T: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const t = new THREE.Vector3().subVectors(pts[Math.min(k + 1, n - 1)], pts[Math.max(k - 1, 0)]).normalize();
    const b = new THREE.Vector3().crossVectors(t, ups[k]).normalize();
    const nn = new THREE.Vector3().crossVectors(b, t).normalize();
    const P = pts[k];
    for (const q of [
      P.clone().addScaledVector(b, w[k]),
      P.clone().addScaledVector(nn, th[k]),
      P.clone().addScaledVector(b, -w[k]),
      P.clone().addScaledVector(nn, -th[k] * belly),
    ])
      pos.push(q.x, q.y, q.z);
    T.push(t);
  }
  const vp = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const tri = (a: number, b: number, c: number, ref: THREE.Vector3) => {
    const A = vp(a), B = vp(b), C = vp(c);
    const fn = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    if (fn.dot(ref) < 0) idx.push(a, c, b);
    else idx.push(a, b, c);
  };
  for (let k = 0; k < n - 1; k++) {
    const mid = pts[k].clone().add(pts[k + 1]).multiplyScalar(0.5);
    for (let e = 0; e < 4; e++) {
      const a = k * 4 + e, b = k * 4 + ((e + 1) % 4), c = a + 4, d = b + 4;
      const ref = vp(a).add(vp(b)).add(vp(c)).add(vp(d)).multiplyScalar(0.25).sub(mid);
      tri(a, b, c, ref);
      tri(b, d, c, ref);
    }
  }
  const s0 = T[0].clone().negate(), s1 = T[n - 1];
  tri(0, 1, 2, s0);
  tri(0, 2, 3, s0);
  const l = (n - 1) * 4;
  tri(l, l + 1, l + 2, s1);
  tri(l, l + 2, l + 3, s1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, color, mat);
}

/** Hair clump lying on the head: follows (az, el) from root to tip, `off` above the skin. */
function hairClump(az0: number, el0: number, az1: number, el1: number, width: number, tipW: number, thick: number, n = 7, bend = 1.6): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const az = az0 + (az1 - az0) * Math.pow(t, bend);
    const el = el0 + (el1 - el0) * t;
    const d = dirOf(az, el);
    // Ride just under the shell surface where the shell exists, then settle onto the skin.
    const f = smooth(hairline(az) - 0.3, hairline(az) + 0.02, el);
    const off = 0.006 + (shellOff(d) - 0.004 - 0.006) * f;
    pts.push(d.clone().multiplyScalar(faceR(d) + off));
    ups.push(radialNormal(d, faceR));
    const ww = width * (1 - (1 - tipW) * Math.pow(t, 2.2));
    w.push(ww);
    th.push(thick * (0.45 + 0.55 * ww / width));
  }
  return ribbon(pts, ups, w, th, HAIR, M.hair, 0.5);
}

/**
 * Curved, tapered hair strand from (az0, el0) to (az1, el1): `curve` bows it sideways (in az),
 * `lift` raises the tip off the surface (to fall over the glasses), `over` keeps it on top of the
 * scalp shell instead of tucking under it. Tip is narrow but rounded.
 */
function hairStrand(az0: number, el0: number, az1: number, el1: number, width: number, thick: number, curve: number, lift = 0, over = false, n = 11): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const az = az0 + (az1 - az0) * Math.pow(t, 1.25) + curve * Math.sin(Math.PI * t);
    const el = el0 + (el1 - el0) * t;
    const d = dirOf(az, el);
    const f = over ? 1 : smooth(hairline(az) - 0.3, hairline(az) + 0.02, el);
    const off = (over ? 0.0022 + shellOff(d) : 0.006 + (shellOff(d) - 0.01) * f) + lift * t * t;
    pts.push(d.clone().multiplyScalar(faceR(d) + off));
    ups.push(radialNormal(d, faceR));
    const ww = width * (0.28 + 0.72 * (1 - Math.pow(t, 1.8))) * (1 - 0.6 * Math.pow(t, 8));
    w.push(ww);
    th.push(thick * (0.4 + 0.6 * ww / width));
  }
  return ribbon(pts, ups, w, th, HAIR, M.hair, 0.5);
}

// ---------------------------------------------------------------- torso surface (torso-local)

/** |z| of the blouse surface (chest elliptic cylinder ∪ shoulder yoke) at (x, y). */
function torsoMag(x: number, y: number): number {
  let m = 0;
  const cy = y - 0.25;
  if (cy >= -0.22 && cy <= 0.22) {
    const t = (cy + 0.22) / 0.44;
    const rb = (0.11 + 0.025 * t) * (1 + 0.12 * Math.sin(t * Math.PI));
    if (Math.abs(x) < rb) m = 0.7 * Math.sqrt(rb * rb - x * x);
  }
  const q = 1 - (x / 0.1458) ** 2 - ((y - 0.46) / 0.0567) ** 2;
  if (q > 0) m = Math.max(m, 0.0972 * Math.sqrt(q));
  return m;
}
/** Point on the blouse, front (side = -1) or back (side = +1), lifted along the surface normal. */
function torsoPt(x: number, y: number, side: number, lift: number): THREE.Vector3 {
  const e = 0.004;
  const z = side * torsoMag(x, y);
  const dx = (side * torsoMag(x + e, y) - side * torsoMag(x - e, y)) / (2 * e);
  const dy = (side * torsoMag(x, y + e) - side * torsoMag(x, y - e)) / (2 * e);
  const n = V(-dx, -dy, 1).multiplyScalar(side).normalize();
  return V(x, y, z).addScaledVector(n, lift);
}
/** Grid patch conforming to the blouse (sailor collar pieces, stripes). */
function torsoPatch(x0: number, x1: number, y0: number, y1: number, side: number, lift: number, color: string, nx = 8, ny = 5): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const p = torsoPt(x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny, side, lift);
      pos.push(p.x, p.y, p.z);
    }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, color, M.cloth);
}
/** Flat strip lying on the blouse along a polyline of (x, y) points. */
function torsoStrip(xy: [number, number][], side: number, lift: number, w0: number, w1: number, color: string, thick = 0.003): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
  xy.forEach(([x, y], k) => {
    const t = k / (xy.length - 1);
    const p = torsoPt(x, y, side, lift);
    const q = torsoPt(x, y, side, lift + 0.01);
    pts.push(p);
    ups.push(q.sub(p).normalize());
    w.push(w0 + (w1 - w0) * t);
    th.push(thick);
  });
  return ribbon(pts, ups, w, th, color, M.cloth, 1);
}

export interface RiderState {
  speed: number;
  steer: number;
  lean: number;
  crank: number;
  wheel: number;
  pedaling: number;
  time: number;
  /** 0 folded … 1 kickstand down (parked). */
  kick?: number;
}

/** On-foot animation input. The body lives under `walker` whenever blend > 0. */
export interface FootState {
  /** 0 seated on the bike … 1 standing / walking (raw transition time, staggered per limb inside). */
  blend: number;
  /** +1 she steps off / on at the bike's left, -1 at its right. */
  side: number;
  /** Ground speed (m/s), gait phase (radians, one stride per 2π), 0 walk … 1 run. */
  speed: number;
  phase: number;
  run: number;
  /** Yaw rate (rad/s) for leaning into turns. */
  turn: number;
  /** Idle head look-around (yaw, pitch offsets). */
  look: number;
  lookUp: number;
  time: number;
}

/** Joint targets for one frame, in the body's parent frame (bike lean space or walker space). */
interface Pose {
  torsoP: THREE.Vector3;
  torsoQ: THREE.Quaternion;
  head: THREE.Vector3;
  ponyX: number[];
  ponyZ: number[];
  hip: THREE.Vector3[];
  ankle: THREE.Vector3[];
  kneePole: THREE.Vector3[];
  legL: number[];
  footQ: THREE.Quaternion[];
  wrist: THREE.Vector3[];
  elbowPole: THREE.Vector3[];
  armL: number[][];
}

const newPose = (): Pose => ({
  torsoP: new THREE.Vector3(),
  torsoQ: new THREE.Quaternion(),
  head: new THREE.Vector3(),
  ponyX: [0, 0, 0, 0],
  ponyZ: [0, 0, 0, 0],
  hip: [new THREE.Vector3(), new THREE.Vector3()],
  ankle: [new THREE.Vector3(), new THREE.Vector3()],
  kneePole: [new THREE.Vector3(), new THREE.Vector3()],
  legL: [0.43, 0.42],
  footQ: [new THREE.Quaternion(), new THREE.Quaternion()],
  wrist: [new THREE.Vector3(), new THREE.Vector3()],
  elbowPole: [new THREE.Vector3(), new THREE.Vector3()],
  armL: [[0.27, 0.26], [0.27, 0.26]],
});

const SHOULDER = (side: number) => V(side * 0.165, 0.41, -0.01);
/** Walking leg: thigh + shin (slightly shorter than the pedalling IK so she stands nearly straight). */
const WALK_LEG = [0.41, 0.4];
/** Gait: stance fraction and half step (m) for walk (0) … jog (1); cycle = ground covered per stride. */
const gaitDuty = (run: number) => 0.55 - 0.17 * run;
const gaitA = (run: number) => 0.3 + 0.08 * run;
export const gaitCycle = (run: number) => (2 * gaitA(run)) / gaitDuty(run);
const _e1 = new THREE.Euler();
const frac = (x: number) => x - Math.floor(x);

function blobShadow(w: number, d: number): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `in vec2 vUv; layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
        void main(){ vec2 d = (vUv - 0.5) * 2.0; float a = 1.0 - smoothstep(0.35, 1.0, length(d));
          gColor = vec4(0.035, 0.035, 0.05, a * 0.42); gNormal = vec4(0.5, 1.0, 1.0/32.0, 0.0) * a; }`,
    }),
  );
  shadow.position.y = 0.035;
  shadow.renderOrder = 1;
  return shadow;
}

/**
 * Soft painted decal (blush, shade, highlights): flat colour with an alpha falloff, no ink.
 * mode 0: radial oval; 1: strongest at the top edge fading down; 2: same with a soft cel step;
 * 4: like 1 without the side fade (wrapped bands).
 */
const softCache = new Map<string, THREE.ShaderMaterial>();
function softDecal(rgb: [number, number, number], alpha: number, mode: number): THREE.ShaderMaterial {
  const key = rgb.join() + "|" + alpha + "|" + mode;
  let m = softCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: { uCol: { value: new THREE.Vector3(...rgb) }, uA: { value: alpha }, uMode: { value: mode } },
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uCol; uniform float uA; uniform int uMode; in vec2 vUv;
        layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
        void main(){
          float a;
          float side = 1.0 - smoothstep(0.6, 1.0, abs(vUv.x - 0.5) * 2.0);
          if (uMode == 0) a = 1.0 - smoothstep(0.15, 1.0, length((vUv - 0.5) * 2.0));
          else if (uMode == 1) a = pow(clamp(vUv.y, 0.0, 1.0), 1.6) * side;
          else if (uMode == 2) a = smoothstep(0.35, 0.62, vUv.y) * side;
          else a = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
          gColor = vec4(uCol, a * uA); gNormal = vec4(0.0);
        }`,
    });
    softCache.set(key, m);
  }
  return m;
}

/** Glasses lens: faint cool tint, a soft rim and a painted white glint (no refraction, no outline). */
let lensMat: THREE.ShaderMaterial | null = null;
function lensMaterial(): THREE.ShaderMaterial {
  lensMat ??= new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: `out vec2 vUv; out vec3 vN; out vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `in vec2 vUv; in vec3 vN; in vec3 vV; layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        // Two parallel diagonal glint strokes in the upper-left, clipped to the lens.
        vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (p - vec2(-0.3, 0.32));
        float s1 = (1.0 - smoothstep(0.07, 0.11, abs(q.x))) * (1.0 - smoothstep(0.22, 0.3, abs(q.y)));
        vec2 q2 = q - vec2(0.2, 0.0);
        float s2 = (1.0 - smoothstep(0.025, 0.05, abs(q2.x))) * (1.0 - smoothstep(0.1, 0.16, abs(q2.y)));
        float glint = max(s1, s2 * 0.85) * (1.0 - smoothstep(0.8, 0.92, r));
        float a = 0.02 + 0.04 * fres;
        vec3 tint = vec3(0.82, 0.92, 1.0);
        vec3 col = mix(tint, vec3(1.0), glint);
        gColor = vec4(col, clamp(a + glint * 0.35, 0.0, 0.6));
        gNormal = vec4(0.0);
      }`,
  });
  return lensMat;
}

export class Rider {
  readonly root = new THREE.Group();
  readonly lean = new THREE.Group();
  /** On-foot root: her feet on the ground, facing -Z. Add to the scene next to `root`. */
  readonly walker = new THREE.Group();
  private kick = new THREE.Group();
  private gripHands: THREE.Mesh[] = [];
  private walkHands: THREE.Group[] = [];
  private lenses: THREE.Mesh[] = [];
  private eyes: THREE.Group[] = [];
  private blinkT = 2.5;
  private blinkK = -1;
  private skirtCap!: THREE.Mesh;
  private pelvis!: THREE.Mesh;
  private shortLegs: Limb[] = [];
  private fringe: { g: THREE.Group; radial: THREE.Vector3; side: THREE.Vector3; gain: number; ph: number; long: number }[] = [];
  private sway = { a: 0, va: 0, l: 0, vl: 0, yaw: 0, pitch: 0 };
  private walkShadow!: THREE.Mesh;
  private onFoot = false;
  private poseA = newPose();
  private poseB = newPose();
  private standK = 0;
  private steer = new THREE.Group();
  private frontWheel = wheel();
  private rearWheel = wheel();
  private crank = new THREE.Group();
  private pedals: THREE.Group[] = [];
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private pony: THREE.Group[] = [];
  private skirt!: THREE.Mesh;
  private skirtGeo!: THREE.BufferGeometry;
  private skirtWaist = new THREE.Vector3();
  private waistNow = new THREE.Vector3();
  private thighA: THREE.Vector3[] = [];
  private thighB: THREE.Vector3[] = [];
  private thigh: Limb[] = [];
  private shin: Limb[] = [];
  private upperArm: Limb[] = [];
  private foreArm: Limb[] = [];
  private knees: THREE.Mesh[] = [];
  private elbows: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  /** Wrist points in steer space (hands are modelled on the grips). */
  private wrists: THREE.Vector3[] = [];
  private steerAxis = new THREE.Vector3().subVectors(HEAD_TOP, HEAD_BOT).normalize();

  constructor() {
    this.root.add(this.lean);
    this.buildFrame();
    this.buildSteer();
    this.buildCrank();
    this.buildBody();
    // Blob shadows under the bike and under her feet when she's walking.
    this.root.add(blobShadow(0.9, 1.9));
    this.walkShadow = blobShadow(0.75, 0.75);
    this.walkShadow.visible = false;
    this.walker.add(this.walkShadow);
  }

  private add(g: THREE.BufferGeometry, parent: THREE.Object3D = this.lean, id: number = ID.bike): THREE.Mesh {
    const m = mk(g, id);
    parent.add(m);
    return m;
  }

  private setKick(k: number): void {
    const d = KICK_FOLDED.clone().lerp(KICK_DOWN, k * k * (3 - 2 * k)).normalize();
    this.kick.quaternion.setFromUnitVectors(V(0, -1, 0), d);
  }

  private buildFrame(): void {
    const r = 0.022;
    const seatTop = V(0, 0.84, 0.25);
    // Step-through mamachari frame: low curved down tube.
    const low = V(0, 0.42, -0.12);
    this.add(beam(HEAD_BOT, low, r * 1.2, FRAME, M.metal));
    this.add(beam(low, BB, r * 1.2, FRAME, M.metal));
    this.add(beam(BB, seatTop, r, FRAME, M.metal));
    this.add(beam(V(0, 0.84, -0.4), V(0, 0.6, 0.12), r * 0.9, FRAME, M.metal));
    for (const s of [-1, 1]) {
      this.add(beam(V(s * 0.05, WHEEL_R, REAR.z), V(0, BB.y, BB.z), r * 0.7, FRAME, M.metal));
      this.add(beam(V(s * 0.05, WHEEL_R, REAR.z), seatTop, r * 0.7, FRAME, M.metal));
    }
    this.add(beam(HEAD_BOT, HEAD_TOP, r * 1.6, FRAME, M.metal));
    // Seat post + saddle.
    this.add(beam(seatTop, SEAT, 0.014, CHROME, M.metal));
    const saddle = sphere(0.1, "#4a2e22", M.plain, 12, 8);
    saddle.scale(0.8, 0.32, 1.1);
    saddle.translate(SEAT.x, SEAT.y + 0.0, SEAT.z - 0.06);
    this.add(saddle);
    // Rear rack + fender + chain guard.
    this.add(xf(box(0.16, 0.02, 0.36, CHROME, M.metal), 0, 0.78, 0.5));
    this.add(beam(V(0.07, 0.78, 0.66), V(0.05, WHEEL_R, REAR.z), 0.008, CHROME, M.metal, 4));
    this.add(beam(V(-0.07, 0.78, 0.66), V(-0.05, WHEEL_R, REAR.z), 0.008, CHROME, M.metal, 4));
    const fender = prep(new THREE.TorusGeometry(WHEEL_R + 0.03, 0.03, 4, 20, Math.PI * 0.75), CHROME, M.metal);
    fender.rotateY(Math.PI / 2);
    fender.rotateX(Math.PI * 0.12);
    fender.translate(0, REAR.y, REAR.z);
    this.add(fender);
    const guard = box(0.03, 0.14, 0.62, FRAME, M.metal);
    xf(guard, 0.09, 0.32, 0.28, 0.05);
    this.add(guard);
    // Side kickstand on the left chainstay: folded along the stay, swings down when parked.
    this.kick.position.copy(KICK_PIVOT);
    this.lean.add(this.kick);
    this.add(beam(V(0, 0, 0), V(0, -KICK_LEN, 0), 0.011, CHROME, M.metal, 5, 0.009), this.kick);
    this.add(xf(box(0.035, 0.012, 0.05, "#8d9094", M.metal), 0, -KICK_LEN, 0), this.kick);
    this.setKick(0);
    this.rearWheel.position.copy(REAR);
    this.lean.add(this.rearWheel);
  }

  private buildSteer(): void {
    this.steer.position.copy(HEAD_BOT);
    this.lean.add(this.steer);
    const rel = (v: THREE.Vector3) => v.clone().sub(HEAD_BOT);
    for (const s of [-1, 1]) this.add(beam(rel(V(s * 0.045, 0.72, -0.46)), rel(V(s * 0.045, WHEEL_R, FRONT.z)), 0.013, CHROME, M.metal), this.steer);
    // Stem + swept city handlebar.
    const stemTop = V(0, 1.06, -0.38);
    this.add(beam(rel(HEAD_TOP), rel(stemTop), 0.016, CHROME, M.metal), this.steer);
    const gripL = V(-0.27, 1.05, -0.17), gripR = V(0.27, 1.05, -0.17);
    for (const g of [gripL, gripR]) {
      const mid = V(g.x * 0.55, 1.07, -0.33);
      this.add(beam(rel(stemTop), rel(mid), 0.012, CHROME, M.metal), this.steer);
      this.add(beam(rel(mid), rel(g), 0.012, CHROME, M.metal), this.steer);
      const grip = cyl(0.02, 0.02, 0.1, "#3a2a24", M.plain, 8);
      grip.rotateZ(Math.PI / 2);
      grip.translate(g.x + Math.sign(g.x) * 0.02, g.y, g.z);
      this.add(grip.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    }
    // Front basket with a school bag.
    const bz = -0.68, by = 0.88;
    const bars: THREE.BufferGeometry[] = [];
    bars.push(xf(box(0.36, 0.02, 0.3, "#2d2d2d", M.metal), 0, by - 0.12, bz));
    for (const s of [-1, 1]) {
      bars.push(xf(box(0.02, 0.02, 0.32, "#2d2d2d", M.metal), s * 0.18, by + 0.13, bz));
      bars.push(xf(box(0.38, 0.02, 0.02, "#2d2d2d", M.metal), 0, by + 0.13, bz + s * 0.15));
      bars.push(xf(box(0.38, 0.015, 0.015, "#2d2d2d", M.metal), 0, by, bz + s * 0.15));
    }
    for (let x = -0.12; x <= 0.13; x += 0.06) for (const s of [-1, 1]) bars.push(xf(box(0.008, 0.26, 0.01, "#2d2d2d", M.metal), x, by, bz + s * 0.15));
    for (let z = -0.1; z <= 0.11; z += 0.07) for (const s of [-1, 1]) bars.push(xf(box(0.01, 0.26, 0.008, "#2d2d2d", M.metal), s * 0.18, by, bz + z));
    for (const b of bars) this.add(b.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    this.buildBasketLoad(by - 0.11, bz);
    this.buildHands();
    // Headlamp.
    const lamp = cyl(0.045, 0.05, 0.08, CHROME, M.metal, 10);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(0, 0.72, -0.53);
    this.add(lamp.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    const fender = prep(new THREE.TorusGeometry(WHEEL_R + 0.03, 0.03, 4, 18, Math.PI * 0.55), CHROME, M.metal);
    fender.rotateY(Math.PI / 2);
    fender.rotateX(-Math.PI * 0.05);
    fender.translate(0, FRONT.y, FRONT.z);
    this.add(fender.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    this.frontWheel.position.copy(rel(FRONT));
    this.steer.add(this.frontWheel);
  }

  /** School satchel (flap, buckle, handle, strap over the rim) + a leek bundle poking out the front. */
  private buildBasketLoad(floor: number, bz: number): void {
    const parts: [THREE.BufferGeometry, number][] = [];
    const BAG = "#6a4630", FLAP = "#553622", STRAP = "#2e1f16";
    const zc = bz + 0.05, h = 0.235, top = floor + h;
    const bag = new THREE.Group();
    bag.position.set(0.01, floor, zc);
    bag.rotation.set(-0.06, 0.1, 0);
    const bp: [THREE.BufferGeometry, number][] = [];
    bp.push([xf(box(0.28, h, 0.1, BAG, M.cloth), 0, h / 2, 0), ID.bike]);
    bp.push([xf(box(0.286, 0.014, 0.108, FLAP, M.cloth), 0, h + 0.004, 0), ID.rider]);
    const fs = new THREE.Shape();
    const fw = 0.143, fh = 0.13, rr = 0.035;
    fs.moveTo(-fw, 0);
    fs.lineTo(fw, 0);
    fs.lineTo(fw, -fh + rr);
    fs.quadraticCurveTo(fw, -fh, fw - rr, -fh);
    fs.lineTo(-fw + rr, -fh);
    fs.quadraticCurveTo(-fw, -fh, -fw, -fh + rr);
    fs.closePath();
    const flap = prep(new THREE.ExtrudeGeometry(fs, { depth: 0.01, bevelEnabled: false, curveSegments: 3 }), FLAP, M.cloth);
    bp.push([xf(flap, 0, h + 0.01, 0.05), ID.rider]);
    bp.push([xf(box(0.036, 0.03, 0.01, "#c9a45a", M.metal), 0, h - 0.09, 0.063), ID.bike]);
    bp.push([xf(box(0.012, 0.05, 0.006, STRAP, M.cloth), 0, h - 0.06, 0.063), ID.bike]);
    const handle = prep(new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI), STRAP, M.cloth);
    bp.push([xf(handle, 0, h + 0.01, 0), ID.bike]);
    for (const [g, id] of bp) this.add(g, bag, id);
    bag.position.sub(HEAD_BOT);
    this.steer.add(bag);
    // Shoulder strap looped over the basket rim on both sides.
    for (const s of [-1, 1]) {
      const a = V(s * 0.135, top - 0.03, zc), b = V(s * 0.172, top + 0.075, zc + 0.01), c = V(s * 0.2, top - 0.02, zc + 0.03);
      parts.push([beam(a, b, 0.007, STRAP, M.cloth, 5), ID.rider], [beam(b, c, 0.007, STRAP, M.cloth, 5), ID.rider]);
    }
    // Leeks: white stalks, pale neck, split green tops.
    const leeks: [number, number, number, number][] = [[0.09, -0.1, 0.2, -0.75], [0.125, -0.085, 0.36, -0.7], [0.055, -0.09, 0.05, -0.8]];
    leeks.forEach(([x, dz, dx, dzz], k) => {
      const base = V(x, floor + 0.02, bz + dz);
      const dir = V(dx, 1, dzz).normalize();
      const white = base.clone().addScaledVector(dir, 0.3 - k * 0.015);
      const neck = white.clone().addScaledVector(dir, 0.035);
      parts.push([xf(sphere(0.014, "#d9ceb0", M.plain, 6, 4), base.x, base.y, base.z), ID.rider]);
      parts.push([beam(base, white, 0.013, "#f3f1e6", M.plain, 7, 0.012), ID.rider]);
      parts.push([beam(white, neck, 0.012, "#cfe08f", M.plain, 7, 0.011), ID.flower]);
      for (let j = 0; j < 3; j++) {
        const sp = (j - 1) * 0.3 + k * 0.1;
        const tdir = dir.clone().applyAxisAngle(V(0, 0, 1), sp).applyAxisAngle(V(1, 0, 0), -0.2 - 0.12 * j).normalize();
        const tip = neck.clone().addScaledVector(tdir, 0.13 + 0.03 * ((j + k) % 2));
        parts.push([beam(neck, tip, 0.009, j === 1 ? "#4f8a34" : "#3f7a2c", M.plain, 5, 0.0015), ID.flower]);
      }
    });
    for (const [g, id] of parts) this.add(g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer, id);
  }

  /** Mitten hands closed around the grips (steer-space, so they follow the bars exactly). */
  private buildHands(): void {
    for (const side of [1, -1]) {
      const G = V(side * 0.29, 1.05, -0.17);
      const parts: THREE.BufferGeometry[] = [];
      const palm = sphere(1, SKIN, M.skin, 14, 10);
      palm.scale(0.046, 0.032, 0.034);
      parts.push(palm.translate(G.x, G.y + 0.01, G.z + 0.003));
      const fingers = sphere(1, SKIN, M.skin, 12, 8);
      fingers.scale(0.043, 0.023, 0.021);
      parts.push(fingers.translate(G.x + side * 0.002, G.y - 0.004, G.z - 0.024));
      const thumb = sphere(1, SKIN, M.skin, 10, 6);
      thumb.scale(0.013, 0.012, 0.025);
      thumb.rotateY(side * 0.45);
      thumb.rotateX(0.35);
      parts.push(thumb.translate(G.x - side * 0.04, G.y + 0.016, G.z - 0.015));
      const W = V(side * 0.012, 0.026, 0.034).add(G);
      parts.push(xf(sphere(0.021, SKIN, M.skin, 10, 6), W.x, W.y, W.z));
      for (const g of parts) this.gripHands.push(this.add(g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer, ID.skin));
      this.wrists.push(W.sub(HEAD_BOT));
    }
  }

  private buildCrank(): void {
    this.crank.position.copy(BB);
    this.lean.add(this.crank);
    const ring = prep(new THREE.TorusGeometry(0.1, 0.012, 6, 28), CHROME, M.metal);
    ring.rotateY(Math.PI / 2);
    ring.translate(0.075, 0, 0);
    this.add(ring, this.crank);
    const disc = cyl(0.09, 0.09, 0.01, "#8d9094", M.metal, 16);
    disc.rotateZ(Math.PI / 2);
    disc.translate(0.075, 0, 0);
    this.add(disc, this.crank);
    for (const s of [1, -1]) {
      const arm = box(0.02, CRANK, 0.03, "#b0b3b8", M.metal);
      arm.translate(s * 0.1, (-s * CRANK) / 2, 0);
      this.add(arm, this.crank);
      const pedal = new THREE.Group();
      pedal.position.set(s * 0.14, -s * CRANK, 0);
      this.crank.add(pedal);
      this.add(box(0.1, 0.02, 0.07, "#2a2a2a", M.metal), pedal);
      this.pedals.push(pedal);
    }
    // Chain (static loop between chainring and rear hub).
    for (const y of [0.1, -0.1]) this.add(beam(V(0.075, BB.y + y, BB.z), V(0.075, REAR.y + y * 0.4, REAR.z), 0.006, "#4a4a4a", M.metal, 4));
  }

  // ---------------------------------------------------------------- body

  /**
   * Decal on the face surface at azimuth az (0 = front, +x = her left) / elevation el, wrapped onto
   * the curvature so wide pieces never sink into the skin; local +z = outward, `lift` above skin.
   */
  private onHead(g: THREE.BufferGeometry, az: number, el: number, lift: number, id: number, parent: THREE.Object3D = this.head, mask = 1): THREE.Mesh {
    const m = new THREE.Mesh(placeOnHead(g, az, el, lift), uber(id, mask));
    parent.add(m);
    return m;
  }

  private disc(rx: number, ry: number, color: string, mat: number = M.plain): THREE.BufferGeometry {
    const g = prep(new THREE.CylinderGeometry(1, 1, 0.003, 20, 1), color, mat);
    g.rotateX(Math.PI / 2);
    g.scale(rx, ry, 1);
    return g;
  }

  private buildBody(): void {
    const b = this.body;
    this.lean.add(b);
    const rid = ID.rider;
    const hip = V(0, SEAT.y + 0.1, SEAT.z - 0.02);

    // Pleated A-line skirt, rebuilt each frame so it drapes over the thighs/saddle and flutters.
    const cols = SKIRT_N * 2;
    const rings = 4;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((cols + 1) * rings * 3);
    const col = new Float32Array((cols + 1) * rings * 3);
    const uv = new Float32Array((cols + 1) * rings * 2);
    const navy = new THREE.Color(NAVY);
    for (let j = 0; j < rings; j++)
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        const shade = i % 2 ? 0.72 : 1.0;
        col[k * 3] = navy.r * shade;
        col[k * 3 + 1] = navy.g * shade;
        col[k * 3 + 2] = navy.b * shade;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = j / (rings - 1);
      }
    const idx: number[] = [];
    for (let j = 0; j < rings - 1; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, bb = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, bb, bb, c, d);
      }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    prep(g, null, M.cloth);
    this.skirtGeo = g;
    // Waist ring at the blouse band: high enough that the thigh tops never rise above the hem line.
    this.skirtWaist.copy(hip).add(V(0, 0.005, 0.0));
    this.waistNow.copy(this.skirtWaist);
    this.skirt = new THREE.Mesh(g, uber(rid, 1, THREE.DoubleSide));
    this.skirt.frustumCulled = false;
    b.add(this.skirt);
    // Closed waistband: a navy cap over the skirt's waist ring, so no angle sees down inside.
    const cap = prep(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(0.15 * 1.12, 1, 0.15 * 0.9), NAVY, M.cloth);
    this.skirtCap = new THREE.Mesh(cap, uber(rid, 1, THREE.DoubleSide));
    b.add(this.skirtCap);
    // Modest dark safety shorts under the skirt (hips + short legs over the thighs).
    const pel = sphere(1, SHORTS, M.cloth, 16, 10);
    pel.scale(0.135, 0.085, 0.11);
    this.pelvis = this.add(pel, b, rid);
    for (let i = 0; i < 2; i++) this.shortLegs.push(new Limb(b, [0.078, 0.076, 0.074], SHORTS, M.cloth, rid));
    this.drapeSkirt(0, 0);
    const seat = sphere(0.15, NAVY, M.cloth, 16, 10);
    seat.scale(1.05, 0.55, 1.0);
    seat.translate(hip.x, hip.y - 0.06, hip.z + 0.03);
    this.seatCover = this.add(seat, b, rid);

    // Torso (leans forward from the hips).
    this.torso.position.copy(hip);
    this.torso.rotation.x = -0.28;
    b.add(this.torso);
    const chest = prep(new THREE.CylinderGeometry(0.135, 0.11, 0.44, 28, 4), BLOUSE, M.cloth);
    const cp = chest.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      const bulge = 1 + 0.12 * Math.sin(((y + 0.22) / 0.44) * Math.PI);
      cp.setXYZ(i, cp.getX(i) * bulge, y, cp.getZ(i) * 0.7 * bulge);
    }
    chest.computeVertexNormals();
    chest.translate(0, 0.25, 0);
    this.add(chest, this.torso, rid);
    const yoke = sphere(0.135, BLOUSE, M.cloth, 16, 8);
    yoke.scale(1.08, 0.42, 0.72);
    yoke.translate(0, 0.46, 0);
    this.add(yoke, this.torso, rid);
    // Blouse hem flaring out over the skirt waistband (overlaps it at every torso angle).
    {
      const segs = 28;
      const hem = new THREE.CylinderGeometry(1, 1, 1, segs, 1, true);
      const hp = hem.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const top = hp.getY(i) > 0;
        const a = Math.atan2(hp.getX(i), hp.getZ(i));
        const rx = top ? 0.12 : 0.19, rz = top ? 0.085 : 0.156;
        hp.setXYZ(i, Math.sin(a) * rx, top ? 0.09 : -0.045, Math.cos(a) * rz);
      }
      this.add(prep(weld(hem), BLOUSE, M.cloth), this.torso, rid).material = uber(rid, 1, THREE.DoubleSide);
    }
    for (const s of [-1, 1]) {
      const sleeve = sphere(0.058, BLOUSE, M.cloth, 12, 8);
      sleeve.scale(1, 1.1, 1);
      sleeve.translate(s * 0.162, 0.41, -0.005);
      this.add(sleeve, this.torso, rid);
      // Navy sleeve cuff stripe.
      // Hem band wraps the sleeve horizontally (a ring facing sideways read as a stray letter).
      const cuff = prep(new THREE.TorusGeometry(0.043, 0.0075, 5, 16), NAVY, M.cloth);
      cuff.rotateX(Math.PI / 2);
      cuff.translate(s * 0.165, 0.366, -0.005);
      this.add(cuff, this.torso, rid);
    }
    // Square sailor collar lying on the back with two white stripes (reads from the chase cam).
    const WHITE = "#f4f2ec", RED = "#c8363a";
    const tp = this.torso;
    this.add(torsoPatch(-0.116, 0.116, 0.27, 0.48, 1, 0.0035, NAVY, 14, 8), tp, rid);
    // One white stripe inset along the collar's three edges (a single connected U, corners overlap).
    const sy = 0.29, sx = 0.098, sw = 0.012;
    this.add(torsoPatch(-sx, sx, sy, sy + sw, 1, 0.0055, WHITE, 14, 1), tp, rid);
    for (const s of [-1, 1]) this.add(torsoPatch(Math.min(s * sx, s * (sx - sw)), Math.max(s * sx, s * (sx - sw)), sy, 0.478, 1, 0.0055, WHITE, 1, 8), tp, rid);
    // Collar bands over the shoulder tops, joining the back panel to the front lapels.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
      const A = 0.1458, B = 0.0567, C = 0.0972;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const x = s * (0.108 + (0.078 - 0.108) * t);
        const q = Math.sqrt(1 - (x / A) ** 2);
        const phi = 1.25 - 2.45 * t; // back (+z) over the top to the front (-z)
        const n = V(x / (A * A), (q * Math.cos(phi)) / B, (q * Math.sin(phi)) / C).normalize();
        pts.push(V(x, 0.46 + B * q * Math.cos(phi), C * q * Math.sin(phi)).addScaledVector(n, 0.006));
        ups.push(n);
        w.push(0.03 - 0.008 * t);
        th.push(0.003);
      }
      this.add(ribbon(pts, ups, w, th, NAVY, M.cloth, 1), tp, rid);
    }
    // Front lapels forming a V, then the red sailor scarf: triangular knot + two hanging tails.
    for (const s of [-1, 1]) {
      this.add(torsoStrip([[s * 0.078, 0.482], [s * 0.062, 0.43], [s * 0.038, 0.38], [s * 0.012, 0.338]], -1, 0.004, 0.03, 0.014, NAVY), tp, rid);
      this.add(torsoStrip([[s * 0.006, 0.322], [s * 0.016, 0.275], [s * 0.028, 0.222]], -1, 0.011, 0.01, 0.017, RED, 0.0025), tp, ID.flower);
    }
    const knotP = torsoPt(0, 0.33, -1, 0.011);
    const knot = prep(new THREE.ConeGeometry(0.026, 0.036, 3, 1), RED, M.cloth);
    knot.rotateZ(Math.PI);
    knot.scale(1, 1, 0.55);
    this.add(xf(knot, knotP.x, knotP.y, knotP.z, -0.12), tp, ID.flower);

    // Neck + head (head scaled up so the face reads from the chase cam).
    this.add(xf(cyl(0.036, 0.045, 0.2, SKIN, M.skin, 14), 0, 0.55, 0), tp, ID.skin);
    this.head.position.set(0, 0.675, -0.012);
    this.head.scale.setScalar(HEAD_SCALE);
    tp.add(this.head);
    const face = new THREE.SphereGeometry(1, 36, 24);
    const fp = face.attributes.position;
    const fd = new THREE.Vector3();
    for (let i = 0; i < fp.count; i++) {
      fd.fromBufferAttribute(fp, i).normalize();
      fd.multiplyScalar(faceR(fd));
      fp.setXYZ(i, fd.x, fd.y, fd.z);
    }
    this.add(prep(weld(face), SKIN, M.skin), this.head, ID.skin);
    this.buildFace();
    this.buildHair();
    this.buildLimbs();
  }

  /**
   * Fringe sway: a damped spring driven by head turns/nods, travel speed (air lifts the strands)
   * and a gentle gusting breeze; each strand gets its own gain and phase.
   */
  private swayFringe(dt: number, time: number, speed: number): void {
    const w = this.sway;
    const h = dt > 0 ? Math.min(dt, 0.05) : 0;
    if (h === 0) return;
    const yaw = this.head.rotation.y, pitch = this.head.rotation.x;
    const yawRate = (yaw - w.yaw) / h, pitchRate = (pitch - w.pitch) / h;
    w.yaw = yaw;
    w.pitch = pitch;
    const gust = Math.sin(time * 1.7) * 0.6 + Math.sin(time * 3.1 + 1.3) * 0.4;
    const tA = clamp(-yawRate * 0.05, -0.12, 0.12) + gust * (0.02 + 0.004 * speed);
    const tL = clamp(0.006 * speed + pitchRate * 0.03, 0, 0.1) + (0.5 + 0.5 * gust) * 0.01;
    w.va += (60 * (tA - w.a) - 7 * w.va) * h;
    w.a += w.va * h;
    w.vl += (60 * (tL - w.l) - 7 * w.vl) * h;
    w.l = Math.max(0, w.l + w.vl * h);
    for (const st of this.fringe) {
      const flut = Math.sin(time * 4.3 + st.ph) * 0.012 * (0.3 + 0.1 * speed);
      _q1.setFromAxisAngle(st.radial, (w.a + flut) * st.gain * (st.long ? 1.4 : 1));
      _q2.setFromAxisAngle(st.side, -w.l * st.gain);
      st.g.quaternion.copy(_q1).multiply(_q2);
    }
  }

  /**
   * Ghibli-heroine face: large eyes (dark iris with a warm lower glow and a lid shadow, big
   * catch-light + a small one, a tapered upper lash heavier at the outer corner with a flick, a
   * thin lower lash, warm lid shade, soft crease), thin tapered brows well above the frames, tiny
   * nose with a bridge highlight, a small soft smile, gradient blush, and soft painted shade under
   * the fringe, on the cheeks' outer edge and under the chin. Each eye sits in its own group so it
   * can blink.
   */
  private buildFace(): void {
    const EYE_AZ = 0.4, EYE_EL = -0.09;
    const faint = 0.55;
    /** Tapered strip on the face surface along (az, el) samples. */
    const stroke = (az: number[], el: number[], w: number[], lift: number, color: string) => {
      const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], th: number[] = [];
      for (let k = 0; k < az.length; k++) {
        const d = dirOf(az[k], el[k]);
        const n = radialNormal(d, faceR);
        pts.push(d.clone().multiplyScalar(faceR(d)).addScaledVector(n, lift));
        ups.push(n);
        th.push(0.0006);
      }
      return ribbon(pts, ups, w, th, color, M.plain, 1);
    };
    const soft = (g: THREE.BufferGeometry, rgb: [number, number, number], alpha: number, mode: number, parent: THREE.Object3D = this.head) => {
      const m = new THREE.Mesh(g, softDecal(rgb, alpha, mode));
      m.renderOrder = 2;
      parent.add(m);
      this.lenses.push(m);
      return m;
    };
    const SHADE: [number, number, number] = [0.8, 0.5, 0.52];
    for (const s of [-1, 1]) {
      const az = s * EYE_AZ;
      const eye = new THREE.Group();
      const d0 = dirOf(az, EYE_EL);
      const r0 = faceR(d0);
      const P = d0.clone().multiplyScalar(r0);
      eye.position.copy(P);
      this.head.add(eye);
      this.eyes.push(eye);
      const local = (g: THREE.BufferGeometry) => g.translate(-P.x, -P.y, -P.z);
      const deco = (g: THREE.BufferGeometry, a: number, e: number, lift: number, id: number, mask = faint) => {
        const m = new THREE.Mesh(local(placeOnHead(g, a, e, lift)), uber(id, mask));
        eye.add(m);
        return m;
      };
      // Eye white, iris, warm lower glow, pupil, catch-lights (both eyes lit from the same side).
      deco(this.disc(0.0205, 0.0218, "#fdfbf7"), az, EYE_EL, 0.001, ID.skin, 0);
      deco(this.disc(0.0166, 0.0212, "#3a1f15"), az - s * 0.01, EYE_EL - 0.008, 0.003, ID.eye);
      deco(this.disc(0.0122, 0.0088, "#a06a44"), az - s * 0.01, EYE_EL - 0.104, 0.0035, ID.eye);
      deco(this.disc(0.0078, 0.0114, "#120806"), az - s * 0.01, EYE_EL - 0.014, 0.004, ID.eye);
      deco(this.disc(0.0064, 0.0074, "#ffffff"), az - s * 0.01 - 0.044, EYE_EL + 0.048, 0.006, ID.eye);
      deco(this.disc(0.0027, 0.0027, "#ffffff"), az - s * 0.01 + 0.04, EYE_EL - 0.115, 0.006, ID.eye);
      // Soft shadow of the upper lid across the top of the eye (under the catch-lights).
      soft(local(placeOnHead(new THREE.PlaneGeometry(0.043, 0.02), az, EYE_EL + 0.09, 0.0048)), [0.2, 0.09, 0.08], 0.55, 1, eye);
      // Upper lash: tapered arc hugging the top of the eye, heaviest at the outer corner.
      const aw = (0.0205 / r0) * 1.14, ah = (0.0218 / r0) * 1.06;
      const la: number[] = [], le: number[] = [], lw: number[] = [];
      for (let k = 0; k <= 12; k++) {
        const phi = 0.1 + (k / 12) * (Math.PI * 0.9 - 0.1);
        la.push(az + s * Math.cos(phi) * aw);
        le.push(EYE_EL + Math.sin(phi) * ah - 0.006 * (1 - k / 12));
        lw.push(0.0014 + 0.0032 * Math.pow(1 - k / 12, 1.4));
      }
      // Outer-corner flick.
      la.unshift(az + s * aw * 1.28);
      le.unshift(EYE_EL + ah * 0.42);
      lw.unshift(0.0009);
      eye.add(new THREE.Mesh(local(stroke(la, le, lw, 0.0045, "#1a0f0c")), uber(ID.eye, faint)));
      // Thin lower lash at the outer half.
      const ba: number[] = [], be: number[] = [], bw: number[] = [];
      for (let k = 0; k <= 6; k++) {
        const phi = -0.15 - (k / 6) * 0.95;
        ba.push(az + s * Math.cos(phi) * aw * 0.98);
        be.push(EYE_EL + Math.sin(phi) * ah * 0.95);
        bw.push(0.0011 * (1 - k / 7) + 0.0003);
      }
      eye.add(new THREE.Mesh(local(stroke(ba, be, bw, 0.0025, "#6e4234")), uber(ID.skin, 0)));
      // Warm lid shade and a soft crease above the lash.
      soft(local(placeOnHead(new THREE.CircleGeometry(1, 20).scale(0.024, 0.0085, 1), az + s * 0.03, EYE_EL + 0.2, 0.0015)), [0.86, 0.5, 0.42], 0.4, 0, eye);
      const ca: number[] = [], ce: number[] = [], cw: number[] = [];
      for (let k = 0; k <= 8; k++) {
        const phi = 0.25 + (k / 8) * (Math.PI - 0.8);
        ca.push(az + s * Math.cos(phi) * aw * 1.02);
        ce.push(EYE_EL + Math.sin(phi) * ah * 1.3);
        cw.push(0.0008 * Math.sin(Math.PI * (k / 8)) + 0.0002);
      }
      eye.add(new THREE.Mesh(local(stroke(ca, ce, cw, 0.002, "#c68f80")), uber(ID.skin, 0)));
      // Thin, softly arched brow well above the frame, tapering to the tail; partly under bangs.
      const ra: number[] = [], re: number[] = [], rw: number[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        ra.push(s * (0.19 + 0.47 * t));
        re.push(0.395 + 0.04 * Math.sin(Math.PI * (0.15 + 0.8 * t)) - 0.035 * t * t);
        rw.push(0.0019 * (1 - 0.72 * Math.pow(t, 1.3)) * (0.75 + 0.25 * smooth(0, 0.2, t)));
      }
      this.head.add(new THREE.Mesh(stroke(ra, re, rw, 0.0035, "#4a3026"), uber(ID.eye, 0.45)));
      // Gradient blush, and soft shade toward the outer cheek/jaw.
      soft(placeOnHead(new THREE.CircleGeometry(1, 24).scale(0.021, 0.0115, 1), s * 0.68, -0.37, 0.0016), [0.95, 0.44, 0.47], 0.62, 0);
      soft(placeOnHead(new THREE.PlaneGeometry(0.04, 0.085, 4, 6), s * 0.86, -0.36, 0.0012), SHADE, 0.4, 0);
    }
    // Soft shade under the chin (the head's underside reads as the top of the neck).
    soft(placeOnHead(new THREE.CircleGeometry(1, 24).scale(0.05, 0.05, 1), 0, -1.12, 0.0015), SHADE, 0.6, 0);
    // Soft cel shade under the fringe onto the forehead (strongest right under the hair).
    soft(placeOnHead(new THREE.PlaneGeometry(0.2, 0.05, 16, 6), 0, 0.5, 0.0013), SHADE, 0.6, 2);
    // Nose: a tiny soft tip, a faint shadow line and a bridge highlight.
    const nose = sphere(1, SKIN, M.skin, 12, 8);
    nose.scale(0.0068, 0.006, 0.0095);
    this.onHead(nose, 0, -0.33, -0.001, ID.skin);
    const noseShade = this.disc(0.0048, 0.0016, "#dca08e", M.skin);
    noseShade.rotateZ(-0.35);
    this.onHead(noseShade, -0.03, -0.38, 0.0012, ID.skin, this.head, 0);
    soft(placeOnHead(new THREE.CircleGeometry(1, 16).scale(0.0028, 0.011, 1), 0.012, -0.24, 0.0012), [1.0, 0.97, 0.94], 0.45, 0);
    // Small soft smile, slightly wider with lifted corners, and a light lip tint.
    {
      const ma: number[] = [], me: number[] = [], mw: number[] = [];
      for (let k = 0; k <= 10; k++) {
        const x = -1 + (k / 10) * 2;
        ma.push(x * 0.17);
        me.push(-0.5 - 0.018 * (1 - x * x) + 0.014 * Math.pow(x, 4));
        mw.push(0.0021 * (1 - 0.6 * x * x) + 0.0005);
      }
      this.head.add(new THREE.Mesh(stroke(ma, me, mw, 0.0012, "#843636"), uber(ID.skin, faint)));
      soft(placeOnHead(new THREE.CircleGeometry(1, 16).scale(0.0085, 0.0032, 1), 0, -0.542, 0.001), [0.92, 0.46, 0.46], 0.45, 0);
    }
    this.buildGlasses();
  }

  /**
   * Rectangular black acetate frames: rounded-rectangle lenses (wider than tall), a heavier
   * browline, a clean bridge and temples that run back under the hair. Flat lacquer material (no
   * brush texture) with one soft highlight line on each top rim; faint lenses with painted glints.
   */
  private buildGlasses(): void {
    const FR = "#141216", HI = "#5d5963";
    const W = 0.064, H = 0.048, RC = 0.012;
    const SIDE = 0.0036, TOP = 0.006, BOT = 0.0027, DEPTH = 0.0038, CLEAR = 0.0085;
    const rrect = <T extends THREE.Path>(shape: T, x0: number, y0: number, x1: number, y1: number, r: number): T => {
      shape.moveTo(x0 + r, y0);
      shape.lineTo(x1 - r, y0);
      shape.quadraticCurveTo(x1, y0, x1, y0 + r);
      shape.lineTo(x1, y1 - r);
      shape.quadraticCurveTo(x1, y1, x1 - r, y1);
      shape.lineTo(x0 + r, y1);
      shape.quadraticCurveTo(x0, y1, x0, y1 - r);
      shape.lineTo(x0, y0 + r);
      shape.quadraticCurveTo(x0, y0, x0 + r, y0);
      return shape;
    };
    const parts: THREE.BufferGeometry[] = [];
    const clearance = (q: THREE.Vector3) => q.length() - faceR(q.clone().normalize());
    const bridgeEnds: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const d = dirOf(s * 0.395, -0.088);
      const n = dirOf(s * 0.18, 0.0);
      const ex = V(0, 1, 0).cross(n).normalize(); // ≈ -X
      const ey = n.clone().cross(ex).normalize();
      const C = d.clone().multiplyScalar(faceR(d));
      const samples: number[][] = [];
      for (let i = 0; i <= 6; i++)
        for (let j = 0; j <= 4; j++) samples.push([(-0.5 + i / 6) * (W + 2 * SIDE), -H / 2 - BOT + (j / 4) * (H + TOP + BOT)]);
      for (let it = 0; it < 10; it++) {
        let minC = Infinity;
        for (const [x, y] of samples) minC = Math.min(minC, clearance(C.clone().addScaledVector(ex, x).addScaledVector(ey, y).addScaledVector(n, -DEPTH / 2)));
        if (minC >= CLEAR - 1e-4) break;
        C.addScaledVector(n, CLEAR - minC);
      }
      const basis = new THREE.Matrix4().makeBasis(ex, ey, n).setPosition(C);
      const shape = rrect(new THREE.Shape(), -W / 2 - SIDE, -H / 2 - BOT, W / 2 + SIDE, H / 2 + TOP, RC + SIDE);
      shape.holes.push(rrect(new THREE.Path(), -W / 2, -H / 2, W / 2, H / 2, RC));
      const rim = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, curveSegments: 6 });
      rim.translate(0, 0, -DEPTH / 2);
      parts.push(prep(rim, FR, M.lacquer).applyMatrix4(basis));
      // One soft highlight line along the top rim.
      const hi = new THREE.ExtrudeGeometry(rrect(new THREE.Shape(), -W / 2 + RC * 0.6, H / 2 + TOP * 0.42, W / 2 - RC * 0.6, H / 2 + TOP * 0.62, 0.0009), { depth: 0.0006, bevelEnabled: false, curveSegments: 2 });
      hi.translate(0, 0, DEPTH / 2);
      parts.push(prep(hi, HI, M.lacquer).applyMatrix4(basis));
      // Lens (uv 0..1 over the lens rectangle for the tint shader).
      const lensG = new THREE.ShapeGeometry(rrect(new THREE.Shape(), -W / 2, -H / 2, W / 2, H / 2, RC), 6);
      const lp = lensG.attributes.position, luv = lensG.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < lp.count; i++) luv.setXY(i, lp.getX(i) / W + 0.5, lp.getY(i) / H + 0.5);
      const lens = new THREE.Mesh(lensG.applyMatrix4(basis), lensMaterial());
      lens.renderOrder = 2;
      this.head.add(lens);
      this.lenses.push(lens);
      // Painted glints: two slanted strokes, upper-left as seen from the front.
      const strokes: THREE.BufferGeometry[] = [];
      const R = H / 2;
      for (const [cx, cy, len, w] of [[-0.62, 0.28, 0.95, 0.22], [-0.12, 0.12, 0.55, 0.1]]) {
        const ax = 0.7071 * (len / 2) * R, ay = 0.7071 * (len / 2) * R;
        const px = -0.7071 * (w / 2) * R, py = 0.7071 * (w / 2) * R;
        const c0 = V(cx * R, cy * R, 0.0012);
        const pts = [
          c0.clone().add(V(-ax, -ay, 0)),
          c0.clone().add(V(-ax * 0.6 + px, -ay * 0.6 + py, 0)),
          c0.clone().add(V(ax * 0.6 + px, ay * 0.6 + py, 0)),
          c0.clone().add(V(ax, ay, 0)),
          c0.clone().add(V(ax * 0.6 - px, ay * 0.6 - py, 0)),
          c0.clone().add(V(-ax * 0.6 - px, -ay * 0.6 - py, 0)),
        ];
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        g.setIndex([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 5, 4]);
        g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(6).fill([0, 0, 1]).flat(), 3));
        strokes.push(prep(g, "#ffffff", M.distant).applyMatrix4(basis));
      }
      const glint = new THREE.Mesh(merge(strokes), uber(ID.eye, -1, THREE.DoubleSide));
      this.head.add(glint);
      this.lenses.push(glint);
      // ex ≈ -X: the nose-side edge of lens s is at local x = +s·W/2.
      bridgeEnds.push(V(s * (W / 2 + SIDE * 0.4), H / 2 - 0.001, 0).applyMatrix4(basis));
      // Hinge at the outer top corner, temple back along the head under the hair.
      const hinge = V(-s * (W / 2 + SIDE * 0.5), H / 2 + TOP * 0.35, -DEPTH / 2).applyMatrix4(basis);
      let prev = hinge.clone().addScaledVector(n, -0.004);
      parts.push(beam(hinge, prev, 0.0022, FR, M.lacquer, 6));
      for (let k = 0; k <= 7; k++) {
        const a = s * (0.98 + (k / 7) * 0.7);
        const dd = dirOf(a, -0.03 - k * 0.012);
        const p = dd.clone().multiplyScalar(faceR(dd) + 0.0032);
        parts.push(beam(prev, p, 0.0019, FR, M.lacquer, 6));
        prev = p;
      }
    }
    // Clean, slightly arched bridge over the nose.
    const [bA, bB] = bridgeEnds;
    const mid = bA.clone().add(bB).multiplyScalar(0.5).add(V(0, 0.0035, -0.001));
    parts.push(beam(bA, mid, 0.0021, FR, M.lacquer, 6), beam(mid, bB, 0.0021, FR, M.lacquer, 6));
    // Black acetate is its own line: excluded from the ink pass so it never doubles up.
    const frames = new THREE.Mesh(merge(parts), uber(ID.eye, -1));
    this.head.add(frames);
    this.lenses.push(frames);
  }

  /**
   * Hair: scalp shell with a curved hairline that tucks under the skin, bangs + side locks lying
   * over the face edges (no visible face-plane seam), and a low ponytail hanging from the nape.
   */
  private buildHair(): void {
    const C = 40, NR = 14;
    const pos: number[] = [];
    for (let i = 0; i < C; i++) {
      const az = -Math.PI + (i / C) * Math.PI * 2;
      const e0 = hairline(az);
      for (let j = 0; j < NR; j++) {
        const el = j === 0 ? e0 : e0 + 0.05 + (Math.PI / 2 - 0.03 - e0 - 0.05) * ((j - 1) / (NR - 1));
        const d = dirOf(az, el);
        const p = d.clone().multiplyScalar(faceR(d) + (j === 0 ? -0.005 : shellOff(d)));
        pos.push(p.x, p.y, p.z);
      }
    }
    const pole = V(0, 1, 0);
    const pp = pole.clone().multiplyScalar(faceR(pole) + shellOff(pole));
    pos.push(pp.x, pp.y, pp.z);
    const idx: number[] = [];
    for (let i = 0; i < C; i++) {
      const i2 = (i + 1) % C;
      for (let j = 0; j < NR - 1; j++) {
        const a = i * NR + j, b = i2 * NR + j, c = a + 1, d = b + 1;
        idx.push(a, c, b, b, c, d);
      }
      idx.push(i * NR + NR - 1, C * NR, i2 * NR + NR - 1);
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    shell.setIndex(idx);
    shell.computeVertexNormals();
    this.add(prep(shell, HAIR, M.hair), this.head, ID.hair);

    // Soft, airy fringe: 9 curved tapered strands of varied length/width parted slightly off
    // centre, gaps showing the forehead, the two outer ones falling over the frame corners. Each
    // strand pivots at its root and sways on a spring in update().
    const fringe: [number, number, number, number, number][] = [
      // az tip, el tip, half-width, sideways curve, tip lift
      [-0.8, 0.1, 0.016, -0.06, 0.013], [-0.6, 0.42, 0.021, -0.05, 0], [-0.4, 0.57, 0.017, -0.04, 0],
      [-0.2, 0.38, 0.021, -0.03, 0], [-0.01, 0.55, 0.016, -0.01, 0], [0.2, 0.4, 0.02, 0.03, 0],
      [0.39, 0.59, 0.017, 0.04, 0], [0.58, 0.37, 0.021, 0.05, 0], [0.8, 0.08, 0.016, 0.06, 0.014],
    ];
    fringe.forEach(([az, tip, w, curve, lift], k) => {
      const az0 = 0.12 + (az - 0.12) * 0.72, el0 = 1.22;
      const g = hairStrand(az0, el0, az, tip, w, 0.0095, curve, lift);
      const rd = dirOf(az0, el0);
      const root = rd.clone().multiplyScalar(faceR(rd) + shellOff(rd));
      const grp = new THREE.Group();
      grp.position.copy(root);
      this.head.add(grp);
      const m = new THREE.Mesh(g.translate(-root.x, -root.y, -root.z), uber(ID.hair, 0.6));
      grp.add(m);
      this.fringe.push({ g: grp, radial: rd, side: V(0, 1, 0).cross(rd).normalize(), gain: 0.75 + 0.5 * Math.abs(Math.sin(k * 2.7)), ph: k * 1.37, long: lift > 0 ? 1 : 0 });
    });
    // Back and crown: soft layered clumps over the shell, gathering toward the ponytail tie.
    {
      const back: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 13; k++) {
        const az0 = Math.PI + (k - 6) * 0.27;
        const az1 = Math.PI + (k - 6) * 0.1;
        back.push(hairStrand(az0, 1.3 - 0.04 * Math.abs(k - 6), az1, -0.42 + 0.05 * Math.sin(k * 1.9), 0.03, 0.009, 0.04 * Math.sin(k * 2.1), 0, true, 12));
      }
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const az0 = s * (1.35 + k * 0.25);
          back.push(hairStrand(az0, 1.05 - k * 0.08, az0 + s * 0.12, -0.5 + k * 0.08, 0.026, 0.009, s * 0.05, 0, true, 11));
        }
      this.head.add(new THREE.Mesh(merge(back), uber(ID.hair, 0.5)));
    }
    // Glossy "angel ring" band around the crown (toon highlight, no ink).
    {
      const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
      const N = 28;
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        const az = -0.95 + 1.9 * t;
        const d = dirOf(az, 1.12 + 0.04 * Math.cos(az * 2));
        pts.push(d.clone().multiplyScalar(faceR(d) + shellOff(d) + 0.0012));
        ups.push(d);
        w.push(0.0095 * Math.pow(Math.sin(Math.PI * t), 1.2) + 0.0003);
        th.push(0.0006);
      }
      this.head.add(new THREE.Mesh(ribbon(pts, ups, w, th, "#65576a", M.hair, 1), uber(ID.hair, -1)));
    }
    for (const s of [-1, 1]) {
      // Face-framing side bangs, cheek locks over the face edge, and a fuller clump behind the ear.
      this.add(hairClump(s * 1.0, 1.0, s * 1.12, 0.22, 0.018, 0.22, 0.009), this.head, ID.hair);
      // Bob locks hanging in front of the ears to the jaw line, framing the face.
      this.add(hairClump(s * 0.98, 0.92, s * 1.0, -0.55, 0.021, 0.3, 0.0095, 10, 1), this.head, ID.hair);
      this.add(hairClump(s * 1.12, 0.85, s * 1.14, -0.62, 0.022, 0.28, 0.0095, 10, 1), this.head, ID.hair);
      this.add(hairClump(s * 1.3, 0.72, s * 1.25, -0.56, 0.02, 0.25, 0.01, 9, 1), this.head, ID.hair);
      this.add(hairClump(s * 1.5, 0.5, s * 1.58, -0.42, 0.026, 0.3, 0.01, 8, 1), this.head, ID.hair);
    }

    // Low ponytail from a red scrunchie + small bow at the nape; segments sway in update().
    const nd = dirOf(Math.PI, -0.5);
    const tie = nd.clone().multiplyScalar(faceR(nd) + shellOff(nd) + 0.002);
    const L = [0.05, 0.05, 0.046, 0.044];
    const RT = [0.02, 0.028, 0.027, 0.02], RB = [0.028, 0.027, 0.02, 0.003];
    let parent: THREE.Object3D = this.head;
    for (let i = 0; i < L.length; i++) {
      const seg = new THREE.Group();
      if (i === 0) seg.position.copy(tie);
      else seg.position.set(0, -L[i - 1], 0);
      parent.add(seg);
      const rt = RT[i], rb = RB[i], len = L[i];
      const prof = [
        new THREE.Vector2(0.0005, -len - rb * 0.8),
        new THREE.Vector2(rb * 0.75, -len - rb * 0.55),
        new THREE.Vector2(rb, -len),
        new THREE.Vector2((rt + rb) * 0.54, -len * 0.5),
        new THREE.Vector2(rt, 0),
        new THREE.Vector2(rt * 0.7, rt * 0.55),
        new THREE.Vector2(0.0005, rt * 0.75),
      ];
      const lg = weld(new THREE.LatheGeometry(prof, 10));
      lg.scale(1, 1, 0.85);
      this.add(prep(lg, HAIR, M.hair), seg, ID.hair);
      this.pony.push(seg);
      parent = seg;
    }
    const p0 = this.pony[0];
    const band = prep(new THREE.TorusGeometry(0.019, 0.009, 6, 12), "#c8363a", M.cloth);
    band.rotateX(Math.PI / 2);
    this.add(band.translate(0, -0.004, 0), p0, ID.flower);
    for (const s of [-1, 1]) {
      const loop = sphere(1, "#c8363a", M.cloth, 8, 6);
      loop.scale(0.022, 0.012, 0.007);
      this.add(xf(loop, s * 0.022, 0.002, 0.024, 0, 0, s * 0.35), p0, ID.flower);
      this.add(beam(V(s * 0.004, -0.002, 0.026), V(s * 0.014, -0.04, 0.03), 0.005, "#c8363a", M.cloth, 4, 0.004), p0, ID.flower);
    }
    this.add(xf(sphere(0.009, "#b02e33", M.cloth, 8, 6), 0, 0, 0.028), p0, ID.flower);
  }

  private buildLimbs(): void {
    const b = this.body;
    const rid = ID.rider;

    // Limbs (updated every frame via IK): profiled tubes (calf/forearm bulge, thin wrists/ankles).
    for (let s = 0; s < 2; s++) {
      this.thigh.push(new Limb(b, [0.068, 0.066, 0.058, 0.05], SKIN, M.skin, ID.skin));
      this.shin.push(new Limb(b, [0.046, 0.05, 0.042, 0.03], SOCK, M.cloth, rid));
      this.upperArm.push(new Limb(b, [0.045, 0.041, 0.035, 0.029], SKIN, M.skin, ID.skin));
      this.foreArm.push(new Limb(b, [0.028, 0.031, 0.026, 0.02, 0.016], SKIN, M.skin, ID.skin));
      const knee = mk(sphere(0.049, SKIN, M.skin, 12, 8), ID.skin);
      const elbow = mk(sphere(0.031, SKIN, M.skin, 10, 8), ID.skin);
      const footG = sphere(0.05, SHOE, M.plain, 10, 6);
      footG.scale(0.8, 0.6, 1.7);
      footG.translate(0, 0, -0.04);
      const foot = mk(footG, rid);
      b.add(knee, elbow, foot);
      this.knees.push(knee);
      this.elbows.push(elbow);
      this.feet.push(foot);
    }
    // Relaxed hands for walking (the riding hands are modelled on the grips): local -Y runs down the
    // fingers, the palm faces her thigh.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hand = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      parts.push(xf(sphere(0.021, SKIN, M.skin, 10, 6), 0, 0, 0));
      const palm = sphere(1, SKIN, M.skin, 14, 10);
      palm.scale(0.019, 0.04, 0.032);
      parts.push(palm.translate(0, -0.038, 0));
      const fingers = sphere(1, SKIN, M.skin, 12, 8);
      fingers.scale(0.016, 0.03, 0.028);
      fingers.rotateX(-0.25);
      parts.push(fingers.translate(-side * 0.005, -0.076, -0.004));
      const thumb = sphere(1, SKIN, M.skin, 10, 6);
      thumb.scale(0.012, 0.024, 0.012);
      thumb.rotateX(0.35);
      parts.push(thumb.translate(-side * 0.008, -0.04, -0.03));
      for (const g of parts) this.add(g, hand, ID.skin);
      hand.visible = false;
      b.add(hand);
      this.walkHands.push(hand);
    }
  }

  /** Recompute skirt vertices: pleated A-line that lies on the thighs in front, hangs behind. */
  /**
   * `stand` 0 = seated drape, 1 = hanging straight while standing/walking; `gait` = [move 0..1,
   * stride phase, run 0..1] for the walking sway (hem trails back and swings with the hips).
   */
  private drapeSkirt(speed: number, time: number, stand = 0, gait: number[] = [0, 0, 0]): void {
    const g = this.skirtGeo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const cols = SKIRT_N * 2;
    const rings = 4;
    const W = this.waistNow;
    const [mv, ph, run] = gait;
    const sp = stand > 0 ? Math.min(1.3, (0.25 * mv + 0.55 * run) * stand + (Math.min(speed / 8, 1.3)) * (1 - stand)) : Math.min(speed / 8, 1.3);
    const fwd = V(0, -0.4, -1).normalize();
    const back = V(0, -1, 0.3).normalize();
    const down = V(0, -1, 0);
    const d = new THREE.Vector3();
    for (let j = 0; j < rings; j++) {
      const t = j / (rings - 1);
      for (let i = 0; i <= cols; i++) {
        const a = (i / cols) * Math.PI * 2;
        const rx = Math.sin(a), rz = Math.cos(a);
        const f = (1 - rz) / 2; // 0 back, 1 front
        d.copy(back).lerp(fwd, f).normalize().lerp(down, stand).normalize();
        const pleat = i % 2 ? 0.84 : 1.0;
        const rWaist = 0.15;
        const flare = 0.13 * pleat * (1 - 0.25 * stand);
        const rad = rWaist * (1 - t) + (rWaist + flare) * t;
        const len = 0.335 * (f > 0.6 ? 0.9 : 1.0) * (1 - stand) + 0.4 * stand;
        const flut = Math.sin(time * 9 + a * 3 + j) * 0.012 * sp * t * t;
        const drift = 0.05 * sp * t * t * (1 - f) * (1 - stand) + (0.035 * mv + 0.05 * run) * t * t * stand;
        const swing = Math.sin(ph) * 0.014 * mv * t * t * stand;
        const k = j * (cols + 1) + i;
        _sp.set(
          W.x + rx * rad * 1.12 + rx * flut + swing,
          W.y + d.y * len * t + flut * 0.6,
          W.z + rz * rad * 0.9 + d.z * len * t + drift,
        );
        // Standing: push the cloth radially off the thighs (a stepping knee nudges the hem forward,
        // never lifts it).
        if (j > 0 && stand > 0.5)
          for (let l = 0; l < this.thighA.length; l++) {
            const A = this.thighA[l], B = this.thighB[l];
            _sr.subVectors(B, A);
            const u = Math.min(1, Math.max(0, _sq.subVectors(_sp, A).dot(_sr) / (_sr.lengthSq() + 1e-6)));
            _sr.multiplyScalar(u).add(A);
            _sq.subVectors(_sp, _sr);
            _sq.y = 0;
            const lat = _sq.length();
            const R = 0.088;
            if (lat < R && lat > 1e-5) _sp.addScaledVector(_sq, (R - lat) / lat);
          }
        // Keep the cloth outside both thighs (the knee rises through the hem at the top of the stroke).
        // Front half only lifts (never tucks under the leg); the lift fades toward the sides.
        if (j > 0 && f > 0.3 && stand <= 0.5)
          for (let l = 0; l < this.thighA.length; l++) {
            const A = this.thighA[l], B = this.thighB[l];
            const ax = B.x - A.x, az = B.z - A.z;
            const u = Math.min(1, Math.max(0, ((_sp.x - A.x) * ax + (_sp.z - A.z) * az) / (ax * ax + az * az + 1e-6)));
            _sr.copy(A).lerp(B, u);
            const lat = Math.hypot(_sp.x - _sr.x, _sp.z - _sr.z);
            const R = 0.09;
            if (lat < R) {
              // Faded out toward the hip so the waistband never folds up over the blouse hem.
              const minY = _sr.y + Math.sqrt(R * R - lat * lat) * smooth(0.3, 0.55, f) * smooth(0.0, 0.3, u);
              if (_sp.y < minY) _sp.y = minY;
            }
          }
        p.setXYZ(k, _sp.x, _sp.y, _sp.z);
      }
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Hide head/hair (first-person view) or show them. */
  setFirstPerson(on: boolean): void {
    if (on === this.fppOn) return;
    this.fppOn = on;
    // Only drop the main-view layer: head, hair, ponytail and decals keep casting their shadow.
    const set = (o: THREE.Object3D) =>
      o.traverse((c) => {
        c.layers.enable(LAYER_SHADOW);
        if (on) c.layers.disable(0);
        else c.layers.enable(0);
      });
    set(this.torso);
    for (const l of [...this.upperArm, ...this.thigh, ...this.shin, ...this.shortLegs]) set(l.mesh);
    for (const m of [...this.elbows, ...this.knees, ...this.feet]) set(m);
  }
  private fppOn = false;

  /** Hide the skirt from the main view only (keeps its shadow) while the camera swoops in. */
  setSkirtHidden(on: boolean): void {
    for (const m of [this.skirt, this.seatCover, this.skirtCap, this.pelvis]) {
      if (on) m.layers.disable(0);
      else m.layers.enable(0);
    }
  }
  private seatCover!: THREE.Mesh;

  /** World-space eye point (between the eyes, slightly forward). */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return out.set(0, -0.003, -0.061).applyMatrix4(this.head.matrixWorld);
  }

  /** World-space point at the middle of her head (orbit-camera pivot). */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return out.set(0, 0, 0).applyMatrix4(this.head.matrixWorld);
  }

  update(dt: number, s: RiderState, f?: FootState): void {
    this.lean.rotation.z = s.lean;
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level
    this.setKick(s.kick ?? 0);
    const fb = f ? Math.min(1, Math.max(0, f.blend)) : 0;
    this.setOnFoot(fb > 0);
    this.root.updateMatrixWorld(true);
    const P = this.poseA;
    this.ridePose(s, P);
    let stand = 0;
    let gait = [0, 0, 0];
    if (f && fb > 0) {
      // Ride pose → walker space, then blend limb by limb: the stand-side foot goes down first, the
      // body slides off the saddle, and the far foot steps through the low frame last.
      this.walker.updateMatrixWorld(true);
      const M = _m1.copy(this.walker.matrixWorld).invert().multiply(this.lean.matrixWorld);
      _q1.setFromRotationMatrix(M);
      P.torsoP.applyMatrix4(M);
      P.torsoQ.premultiply(_q1);
      for (let i = 0; i < 2; i++) {
        P.hip[i].applyMatrix4(M);
        P.ankle[i].applyMatrix4(M);
        P.wrist[i].applyMatrix4(M);
        P.kneePole[i].transformDirection(M);
        P.elbowPole[i].transformDirection(M);
        P.footQ[i].premultiply(_q1);
      }
      const W = this.poseB;
      this.walkPose(f, W);
      const near = f.side > 0 ? 1 : 0;
      const wNear = smooth(0, 0.45, fb), wFar = smooth(0.35, 1, fb), wBody = smooth(0.12, 0.82, fb), wArm = smooth(0.05, 0.62, fb);
      P.torsoP.lerp(W.torsoP, wBody);
      P.torsoQ.slerp(W.torsoQ, wBody);
      P.head.lerp(W.head, wBody);
      for (let i = 0; i < P.ponyX.length; i++) {
        P.ponyX[i] += (W.ponyX[i] - P.ponyX[i]) * wBody;
        P.ponyZ[i] += (W.ponyZ[i] - P.ponyZ[i]) * wBody;
      }
      for (let k = 0; k < 2; k++) P.legL[k] += (W.legL[k] - P.legL[k]) * wBody;
      for (let i = 0; i < 2; i++) {
        const w = i === near ? wNear : wFar;
        P.hip[i].lerp(W.hip[i], wBody);
        if (i === near || w <= 0 || w >= 1) {
          P.ankle[i].lerp(W.ankle[i], w);
          if (i === near) P.ankle[i].y += Math.sin(Math.PI * w) * 0.05;
        } else {
          // Arc up through the step-through frame.
          _v1.copy(P.ankle[i]).add(W.ankle[i]).multiplyScalar(0.5);
          _v1.y += 0.62;
          _v1.z -= 0.12;
          _v2.copy(P.ankle[i]);
          P.ankle[i].copy(_v2.multiplyScalar((1 - w) * (1 - w))).addScaledVector(_v1, 2 * w * (1 - w)).addScaledVector(W.ankle[i], w * w);
        }
        P.kneePole[i].lerp(W.kneePole[i], w).normalize();
        P.footQ[i].slerp(W.footQ[i], w);
        P.wrist[i].lerp(W.wrist[i], wArm);
        P.elbowPole[i].lerp(W.elbowPole[i], wArm).normalize();
        for (let k = 0; k < 2; k++) P.armL[i][k] += (W.armL[i][k] - P.armL[i][k]) * wArm;
      }
      stand = wBody;
      gait = [Math.min(1, f.speed / 1.1), f.phase, f.run];
      this.waistNow.copy(P.torsoP).add(_v1.set(0, 0.005, 0));
    } else this.waistNow.copy(this.skirtWaist);
    this.standK = stand;
    this.applyPose(P, fb === 0 && this.fppOn);
    this.seatCover.visible = fb === 0;
    for (const l of this.lenses) l.layers.mask = this.fppOn ? 0 : 1;
    this.drapeSkirt(f && fb > 0 ? f.speed : s.speed, s.time, stand, gait);
    this.skirtCap.position.copy(this.waistNow);
    // Shorts: hips just under the waistband, legs over the top of each thigh.
    this.pelvis.position.copy(P.torsoP).add(_v1.set(0, -0.07, 0.005));
    for (let i = 0; i < 2; i++) this.shortLegs[i].set(this.thighA[i].clone().add(_v1.set(0, 0.02, 0)), _v2.copy(this.thighA[i]).lerp(this.thighB[i], 0.3));
    // Natural blink every few seconds.
    this.blinkT -= dt;
    if (this.blinkT <= 0 && this.blinkK < 0) {
      this.blinkK = 0;
      this.blinkT = 2.4 + Math.random() * 3.2;
    }
    let lid = 0;
    if (this.blinkK >= 0) {
      this.blinkK += dt / 0.15;
      lid = Math.sin(Math.PI * Math.min(1, this.blinkK));
      if (this.blinkK >= 1) this.blinkK = -1;
    }
    for (const e of this.eyes) e.scale.y = 1 - 0.9 * lid;
    this.swayFringe(dt, s.time, f && fb > 0 ? f.speed : s.speed);
  }

  /** 0 seated … 1 standing (how far the dismount has got). */
  get standing(): number {
    return this.standK;
  }

  /** Move the body between the bike (lean space) and the walker root. */
  private setOnFoot(on: boolean): void {
    if (on === this.onFoot) return;
    this.onFoot = on;
    (on ? this.walker : this.lean).add(this.body);
    for (const h of this.gripHands) h.visible = !on;
    for (const h of this.walkHands) h.visible = on;
    this.walkShadow.visible = on;
  }

  /** Seated pedalling pose in lean space (the original riding animation). */
  private ridePose(s: RiderState, P: Pose): void {
    const bob = Math.sin(s.crank * 2) * 0.008 * s.pedaling;
    P.torsoP.set(0, SEAT.y + 0.1 + bob, SEAT.z - 0.02);
    P.torsoQ.setFromEuler(_e1.set(-0.28 - Math.min(s.speed / 12, 1) * 0.08, 0, Math.sin(s.crank) * 0.025 * s.pedaling, "XYZ"));
    P.head.set(0.14 + Math.sin(s.time * 0.21) * 0.04, Math.sin(s.time * 0.37) * 0.12 + Math.sin(s.time * 0.13) * 0.1, -s.lean * 0.5);
    const sp = Math.min(s.speed / 8, 1.2);
    // Low ponytail: hangs from the nape (undoing the head nod so it stays off her back), wind
    // lifts it slightly with speed, and a travelling wave sways it.
    for (let i = 0; i < P.ponyX.length; i++) {
      const wave = Math.sin(s.time * 3.6 - i * 0.9) * 0.07 * (0.4 + sp);
      P.ponyX[i] = (i === 0 ? -P.head.x - 0.22 - sp * 0.22 : -0.05 - sp * 0.08) + wave;
      P.ponyZ[i] = Math.sin(s.time * 2.4 - i * 1.1) * 0.09 * (0.4 + sp) + (i === 0 ? s.steer * 0.3 + s.lean * 0.35 : 0);
    }
    // Hip joints sit just under the skirt's waist ring so the open thigh tube never shows above it.
    const hipBase = _v2.set(0, SEAT.y + 0.035, SEAT.z - 0.03);
    P.legL[0] = 0.43;
    P.legL[1] = 0.42;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const a = s.crank + (i === 0 ? 0 : Math.PI);
      P.ankle[i].set(side * 0.14, BB.y - Math.cos(a) * CRANK + 0.06, BB.z + Math.sin(a) * CRANK + 0.03);
      P.hip[i].copy(hipBase).add(_v1.set(side * 0.085, 0, 0));
      P.kneePole[i].set(side * 0.12, 0.4, -1).normalize();
      P.footQ[i].setFromEuler(_e1.set(-0.15 + Math.sin(a) * 0.25, 0, 0, "XYZ"));
      const shoulder = SHOULDER(side).applyQuaternion(P.torsoQ).add(P.torsoP);
      P.wrist[i].copy(this.wrists[i]).applyMatrix4(this.steer.matrix);
      // Segment lengths follow the reach so the elbow always keeps a relaxed ~18° bend.
      const reach = shoulder.distanceTo(P.wrist[i]) / (2 * Math.cos((9 * Math.PI) / 180));
      P.armL[i][0] = reach * 1.04;
      P.armL[i][1] = reach * 0.96;
      P.elbowPole[i].set(side * 0.45, -0.8, 0.45).normalize();
    }
  }

  /** Standing / walking / jogging pose in walker space (feet on y = 0, facing -Z). */
  private walkPose(f: FootState, P: Pose): void {
    const mv = Math.min(1, f.speed / 1.1), run = f.run, ph = f.phase, t = f.time;
    const duty = gaitDuty(run);
    const A = gaitA(run) * mv;
    const lift = (0.07 + 0.1 * run) * mv;
    const legSum = WALK_LEG[0] + WALK_LEG[1];
    const reach = legSum * (0.99 - 0.05 * run);
    let hj = 0.07 + legSum * 0.99;
    const sPh = [0, 0];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const s = frac(ph / (Math.PI * 2) + (i === 0 ? 0 : 0.5));
      sPh[i] = s;
      let z: number, y: number, rot: number;
      if (s < duty) {
        const u = s / duty;
        z = -A + 2 * A * u;
        y = 0.035 * smooth(0.72, 1, u) * mv;
        rot = (0.22 * (1 - smooth(0, 0.18, u)) - 0.5 * smooth(0.7, 1, u)) * mv;
      } else {
        const u = (s - duty) / (1 - duty);
        const e = u * u * (3 - 2 * u);
        z = A - 2 * A * e + 0.13 * run * mv * Math.sin(Math.PI * u);
        y = lift * Math.sin(Math.PI * u) + 0.035 * (1 - smooth(0, 0.3, u)) * mv;
        rot = (-0.5 + 0.72 * e) * mv;
      }
      // Idle: right foot a touch forward, toes slightly in.
      z += (i === 0 ? -0.05 : 0.02) * (1 - mv);
      P.ankle[i].set(side * (0.09 - 0.015 * run), 0.07 + y, z);
      P.footQ[i].setFromEuler(_e1.set(rot, side * 0.14 * (1 - mv), 0, "YXZ"));
      const dx = P.ankle[i].x - side * 0.085;
      hj = Math.min(hj, P.ankle[i].y + Math.sqrt(Math.max(0, reach * reach - z * z - dx * dx)));
    }
    const breath = Math.sin(t * 1.8) * 0.0035 * (1 - mv);
    const pitch = -(0.02 + 0.035 * mv + 0.13 * run);
    const yaw = -0.07 * mv * Math.cos(ph) * (1 - 0.3 * run);
    const roll = -0.015 * mv * Math.cos(ph - 1.9) - Math.max(-0.1, Math.min(0.1, f.turn * f.speed * 0.03));
    P.torsoP.set(0.012 * mv * Math.cos(ph - 1.9), hj + 0.065 + breath + 0.015 * run * mv, 0);
    P.torsoQ.setFromEuler(_e1.set(pitch, yaw, roll, "YXZ"));
    P.head.set(-pitch * 0.8 - 0.03 + f.lookUp, f.look - yaw * 0.8, -roll * 0.6 + 0.035 * Math.sin(t * 0.31) * (1 - mv));
    for (let i = 0; i < P.ponyX.length; i++) {
      const wave = Math.sin(2 * ph - i * 0.9) * 0.05 * mv + Math.sin(t * 1.4 - i * 0.8) * 0.025;
      P.ponyX[i] = (i === 0 ? -(pitch + P.head.x) - 0.14 - 0.08 * mv - 0.12 * run : -0.03 - 0.05 * run) + wave;
      P.ponyZ[i] = Math.sin(ph - i * 0.8) * 0.06 * mv + Math.sin(t * 1.9 - i * 1.1) * 0.03;
    }
    P.legL[0] = WALK_LEG[0];
    P.legL[1] = WALK_LEG[1];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      P.hip[i].copy(P.torsoP).add(_v1.set(side * 0.085, -0.065, 0));
      P.kneePole[i].set(side * 0.08, 0.05, -1).normalize();
      const shoulder = SHOULDER(side).applyQuaternion(P.torsoQ).add(P.torsoP);
      // Arms swing opposite to the same-side leg; jogging bends the elbows and pumps.
      const k = mv * (0.15 + 0.05 * run);
      const armZ = k * Math.cos(2 * Math.PI * sPh[i]);
      const walkW = _v1.set(side * 0.075, -0.495 + Math.max(0, -armZ) * 0.25, 0.035 + armZ);
      const runW = _v2.set(side * 0.01, -0.3, -0.08 + armZ * 1.3);
      P.wrist[i].copy(walkW).lerp(runW, run).add(shoulder);
      P.elbowPole[i].set(side * (0.3 + 0.2 * run), -0.2 * run, 1).normalize();
      P.armL[i][0] = 0.27;
      P.armL[i][1] = 0.255;
    }
  }

  private applyPose(P: Pose, fppForearm: boolean): void {
    this.torso.position.copy(P.torsoP);
    this.torso.quaternion.copy(P.torsoQ);
    this.head.rotation.set(P.head.x, P.head.y, P.head.z);
    for (let i = 0; i < this.pony.length; i++) {
      this.pony[i].rotation.x = P.ponyX[i];
      this.pony[i].rotation.z = P.ponyZ[i];
    }
    const mid = _v3;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hip = P.hip[i], ankle = P.ankle[i];
      ik(hip, ankle, P.legL[0], P.legL[1], P.kneePole[i], mid);
      this.thigh[i].set(hip, mid);
      (this.thighA[i] ??= new THREE.Vector3()).copy(hip);
      (this.thighB[i] ??= new THREE.Vector3()).copy(mid);
      this.shin[i].set(mid, ankle);
      this.knees[i].position.copy(mid);
      this.feet[i].position.copy(ankle).add(_v1.set(0, -0.03, 0));
      this.feet[i].quaternion.copy(P.footQ[i]);

      const shoulder = SHOULDER(side).applyQuaternion(P.torsoQ).add(P.torsoP);
      const wrist = P.wrist[i];
      ik(shoulder, wrist, P.armL[i][0], P.armL[i][1], P.elbowPole[i], mid);
      this.upperArm[i].set(shoulder, mid);
      // First person: the elbow is hidden, so run the forearm on past the near plane (no cut end).
      if (fppForearm) this.foreArm[i].set(mid.clone().lerp(wrist, -1.2), wrist);
      else this.foreArm[i].set(mid, wrist);
      this.elbows[i].position.copy(mid);
      const hand = this.walkHands[i];
      if (hand.visible) {
        hand.position.copy(wrist);
        hand.quaternion.setFromUnitVectors(_v1.set(0, -1, 0), _v2.subVectors(wrist, mid).normalize());
      }
    }
  }
}

const SKIRT_N = 14;
const _sp = new THREE.Vector3(), _sr = new THREE.Vector3(), _sq = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };
