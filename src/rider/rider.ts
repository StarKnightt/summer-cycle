import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { ID, M, beam, box, cyl, merge, prep, sphere, xf } from "../world/geo";
import { G, uber } from "../render/materials";
import { LAYER_SHADOW } from "../render/lightpasses";
import { BB, Bike, CRANK, HEAD_BOT, SEAT } from "./bike";

export { BIKE, PARK_LEAN, PARK_STEER } from "./bike";

/**
 * Schoolgirl rider on her mamachari (the bicycle itself lives in bike.ts). Bike local frame:
 * forward = -Z, up = +Y, right = +X. Hierarchy: root (world pos, yaw) → lean (roll) → bike, body.
 */

const SKIN = "#f2cdb0";
const HAIR = "#3b2c26";
const SHORTS = "#1d2233";
const BLOUSE = "#f6f4ef";
/** Dusty navy-blue midi skirt. */
const SKIRT = "#39486e";
const SOCK = "#f3f1ea";
const SHOE = "#6b4028";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mk(g: THREE.BufferGeometry, id: number): THREE.Mesh {
  const m = new THREE.Mesh(g, uber(id, 1));
  return m;
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

const HEAD_SCALE = 1.0;
/** Unit direction from head centre: az 0 = front (-Z), +az toward +X; el up. */
const dirOf = (az: number, el: number) => V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

/**
 * Sculpted head (head-local m, before HEAD_SCALE). Every height y has a horizontal cross-section:
 * half-width W (front-view outline), front depth F and back depth B (profile; B < 0 under the jaw,
 * where only the chin is left in front of the neck). Above y = 0.03 the cranium closes as a round
 * cap. The front half is a flatter superellipse so the face reads as a soft oval plate.
 */
const CAP_Y = 0.03, TOP_Y = 0.132, CHIN_Y = -0.105;
const PROF: [number, number, number, number][] = [
  // y       W       F       B
  [0.03, 0.088, 0.099, 0.112],
  [0.01, 0.087, 0.1, 0.11],
  [-0.012, 0.085, 0.099, 0.103],
  [-0.028, 0.081, 0.099, 0.093],
  [-0.042, 0.0752, 0.098, 0.079],
  // Jaw angle just below the ear, then a straight jaw line running forward to a small rounded chin.
  [-0.053, 0.0675, 0.096, 0.061],
  [-0.062, 0.06, 0.0945, 0.036],
  [-0.071, 0.0515, 0.0935, 0.013],
  [-0.08, 0.042, 0.093, -0.01],
  [-0.088, 0.033, 0.092, -0.031],
  [-0.095, 0.0245, 0.09, -0.049],
  [-0.1, 0.016, 0.086, -0.062],
  [CHIN_Y, 0.0, 0.079, -0.07],
];
/** Dense lookup of the Catmull-Rom interpolated profile (W, F, B) from CAP_Y down to CHIN_Y. */
const PROF_N = 1024;
const PROF_T = (() => {
  const out = new Float32Array((PROF_N + 1) * 3);
  const n = PROF.length;
  for (let s = 0; s <= PROF_N; s++) {
    const y = CAP_Y + ((CHIN_Y - CAP_Y) * s) / PROF_N;
    let i = 0;
    while (i < n - 2 && y < PROF[i + 1][0]) i++;
    const y0 = PROF[i][0], y1 = PROF[i + 1][0];
    const f = (y - y0) / (y1 - y0);
    for (let c = 1; c <= 3; c++) {
      const p0 = PROF[i][c], p1 = PROF[i + 1][c];
      const m0 = i > 0 ? ((p1 - PROF[i - 1][c]) / (y1 - PROF[i - 1][0])) * (y1 - y0) : c === 3 ? 0 : (p1 - p0) * 0.3;
      const m1 = i < n - 2 ? ((PROF[i + 2][c] - p0) / (PROF[i + 2][0] - y0)) * (y1 - y0) : p1 - p0;
      const f2 = f * f, f3 = f2 * f;
      out[s * 3 + c - 1] = (2 * f3 - 3 * f2 + 1) * p0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * p1 + (f3 - f2) * m1;
    }
  }
  return out;
})();
const _prof: [number, number, number] = [0, 0, 0];
function profAt(y: number): [number, number, number] {
  if (y >= CAP_Y) {
    const s = Math.min(1, (y - CAP_Y) / (TOP_Y - CAP_Y));
    const k = Math.sqrt(Math.max(0, 1 - s * s));
    _prof[0] = PROF_T[0] * k;
    _prof[1] = PROF_T[1] * Math.sqrt(Math.max(0, 1 - Math.pow(s, 1.7)));
    _prof[2] = PROF_T[2] * k;
    return _prof;
  }
  const u = ((y - CAP_Y) / (CHIN_Y - CAP_Y)) * PROF_N;
  const i = Math.min(PROF_N - 1, Math.max(0, Math.floor(u))), f = Math.min(1, Math.max(0, u - i));
  for (let c = 0; c < 3; c++) _prof[c] = PROF_T[i * 3 + c] * (1 - f) + PROF_T[i * 3 + 3 + c] * f;
  return _prof;
}
function inHead(x: number, y: number, z: number): boolean {
  if (y > TOP_Y || y < CHIN_Y) return false;
  const [W, F, B] = profAt(y);
  const D = (F + B) / 2;
  if (W <= 1e-5 || D <= 1e-5) return false;
  const v = (z - (B - F) / 2) / D, u = Math.abs(x) / W;
  const p = v < 0 ? 2 + 0.55 * smooth(0.06, 0.0, y) * smooth(-0.098, -0.066, y) : 2;
  return Math.pow(u, p) + v * v < 1;
}
/** Nose tip / bridge, cheekbones and lips as soft radial bumps (angles from the front axis). */
const NOSE_EL = Math.atan2(-0.0435, 0.1), LIP_EL = Math.atan2(-0.061, 0.096);
function faceBumps(d: THREE.Vector3): number {
  const az = Math.atan2(d.x, -d.z), el = Math.asin(Math.max(-1, Math.min(1, d.y)));
  if (Math.abs(az) > 1.2) return 0;
  const de = el - NOSE_EL;
  let b = 0.0092 * Math.exp(-((az / (0.062 + 0.05 * Math.max(0, -de))) ** 2) - (de / (de > 0 ? 0.13 : 0.04)) ** 2);
  b += 0.0026 * Math.exp(-((az / 0.055) ** 2)) * smooth(-0.02, 0.08, de) * smooth(0.4, 0.22, de);
  b -= 0.0022 * Math.exp(-((az / 0.25) ** 2) - ((el - LIP_EL - 0.075) / 0.05) ** 2);
  b += 0.0014 * Math.exp(-((az / 0.16) ** 2) - ((el - LIP_EL - 0.028) / 0.026) ** 2);
  b += 0.001 * Math.exp(-((az / 0.14) ** 2) - ((el - LIP_EL + 0.035) / 0.03) ** 2);
  b -= 0.0012 * Math.exp(-((az / 0.3) ** 2) - ((el - LIP_EL + 0.085) / 0.035) ** 2);
  b += 0.0016 * Math.exp(-((az / 0.28) ** 2) - ((el - LIP_EL + 0.17) / 0.07) ** 2);
  for (const s of [-1, 1]) b += 0.0026 * Math.exp(-(((az - s * 0.72) / 0.22) ** 2) - ((el + 0.2) / 0.16) ** 2);
  return b;
}
/** Radial face surface: distance from the head centre along unit direction d. */
function faceR(d: THREE.Vector3): number {
  let lo = 0, hi = 0.2;
  for (let it = 0; it < 19; it++) {
    const t = (lo + hi) / 2;
    if (inHead(d.x * t, d.y * t, d.z * t)) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2 + faceBumps(d);
}
/** Direction [az, el] of the face-surface point whose (x, y) is given (front half). */
function faceAt(x: number, y: number): [number, number] {
  // Features below the eyes were laid out on a longer lower face; map them onto the shorter one.
  if (y < -0.012) y = -0.012 + (y + 0.012) * 0.9;
  let az = Math.asin(Math.max(-0.99, Math.min(0.99, x / 0.1))), el = Math.atan2(y, 0.1);
  for (let it = 0; it < 8; it++) {
    const d = dirOf(az, el);
    const r = faceR(d);
    az += (x - d.x * r) / (r * Math.cos(el) * Math.cos(az) + 1e-4);
    el += (y - d.y * r) / r;
  }
  return [az, el];
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
const HAIRLINE: [number, number][] = [[0, 0.72], [0.7, 0.64], [1.05, 0.3], [1.3, 0.14], [1.55, 0.08], [1.8, 0.06], [2.05, -0.2], [2.4, -0.5], [Math.PI, -0.6]];
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
const shellOff = (d: THREE.Vector3) => 0.014 + 0.042 * Math.pow(Math.max(0, d.y), 1.1) + 0.022 * Math.max(0, d.z) * (0.6 + 0.4 * Math.max(0, d.y + 0.3)) + 0.008 * Math.abs(d.x) * smooth(-0.1, 0.5, d.y);

/** Shell offset thinning to the skin over the last stretch above the hairline (no ledge at the edge). */
function shellTap(d: THREE.Vector3): number {
  const az = Math.atan2(d.x, -d.z), el = Math.asin(Math.max(-1, Math.min(1, d.y)));
  return -0.005 + (shellOff(d) + 0.005) * smooth(0, 0.32, el - hairline(az));
}

/**
 * Tapered clump / ribbon along a path: diamond cross-section (sides ±w, ridge +th along `ups`,
 * a flatter belly underneath), smooth normals, closed ends, all faces wound outward.
 */
function ribbon(pts: THREE.Vector3[], ups: THREE.Vector3[], w: number[], th: number[], color: string, mat: number, belly = 0.35, radialN = 0): THREE.BufferGeometry {
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
  // Hair lights as one mass: bend the strand normals toward the head's radial direction so the
  // cel step runs as a smooth band over the hair instead of stair-stepping strand by strand.
  if (radialN > 0) {
    const na = g.attributes.normal, pa = g.attributes.position;
    const nv = new THREE.Vector3(), rv = new THREE.Vector3();
    for (let i = 0; i < na.count; i++) {
      nv.fromBufferAttribute(na, i);
      rv.fromBufferAttribute(pa, i).normalize();
      nv.lerp(rv, radialN).normalize();
      na.setXYZ(i, nv.x, nv.y, nv.z);
    }
  }
  return prep(g, color, mat);
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
    const off = (over ? 0.0022 + Math.max(0.004, shellTap(d)) : 0.006 + (shellOff(d) - 0.01) * f) + lift * t * t;
    pts.push(d.clone().multiplyScalar(faceR(d) + off));
    ups.push(radialNormal(d, faceR));
    const ww = width * (0.12 + 0.88 * (1 - Math.pow(t, 1.6))) * (1 - 0.6 * Math.pow(t, 8));
    w.push(ww);
    th.push(thick * (0.4 + 0.6 * ww / width));
  }
  return ribbon(pts, ups, w, th, HAIR, M.hair, 0.5, 0.8);
}

/** Push a head-space point out to at least `off` above the skin. */
function offHead(p: THREE.Vector3, off: number): THREE.Vector3 {
  const d = p.clone().normalize();
  const r = faceR(d) + off;
  return p.length() < r ? d.multiplyScalar(r) : p;
}

/**
 * Side lock: follows the scalp from (az0, el0) to (az1, el1) (tucked under the shell above the
 * hairline), then hangs straight down to yEnd past the cheek (never hugging the jaw), drifting
 * `fwd` in z; tapered to a narrow tip.
 */
function hangLock(az0: number, el0: number, az1: number, el1: number, yEnd: number, width: number, fwd: number, curl = 0): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
  const N1 = 8, N2 = 7, N = N1 + N2;
  for (let k = 0; k < N1; k++) {
    const t = k / (N1 - 1);
    const az = az0 + (az1 - az0) * Math.pow(t, 1.2);
    const el = el0 + (el1 - el0) * t;
    const d = dirOf(az, el);
    const f = smooth(hairline(az) - 0.3, hairline(az) + 0.02, el);
    pts.push(d.clone().multiplyScalar(faceR(d) + 0.006 + (shellOff(d) - 0.009) * f));
    ups.push(radialNormal(d, faceR));
  }
  const p1 = pts[N1 - 1].clone(), sx = Math.sign(p1.x);
  for (let k = 1; k <= N2; k++) {
    const t = k / N2;
    const p = V(p1.x - sx * (0.005 + curl) * t * t, p1.y + (yEnd - p1.y) * t, p1.z + fwd * t);
    pts.push(offHead(p, 0.0045));
    ups.push(V(p.x, 0, p.z * 0.5).normalize());
  }
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1);
    const ww = width * (0.1 + 0.9 * (1 - Math.pow(t, 1.5))) * (0.8 + 0.2 * smooth(0, 0.15, t));
    w.push(ww);
    th.push(0.004 * (0.4 + 0.6 * ww / width));
  }
  return ribbon(pts, ups, w, th, HAIR, M.hair, 0.5, 0.8);
}

/**
 * Simple brown loafer around the ankle point (mesh origin 3 cm under the ankle, -Z forward): a
 * rounded upper with a flat bottom, a darker sole and a saddle strap over the instep.
 */
function loafer(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = sphere(1, SHOE, M.plain, 18, 12);
  const pa = up.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const zz = z * 0.118 - 0.07;
    // Wider at the ball of the foot, a rounded toe box, heel a touch narrower; low vamp.
    const wx = 0.041 * (1 + 0.1 * smooth(0.02, -0.12, zz) - 0.12 * smooth(-0.14, -0.19, zz));
    const top = 0.03 - 0.018 * smooth(-0.06, -0.18, zz);
    pa.setXYZ(i, x * wx, y > 0 ? y * top : Math.max(y * 0.05, -0.03), zz);
  }
  up.computeVertexNormals();
  parts.push(up);
  const sole = sphere(1, "#2c1b13", M.plain, 18, 6);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setXYZ(i, sp.getX(i) * 0.044, -0.034 + sp.getY(i) * 0.0055, sp.getZ(i) * 0.121 - 0.07);
  sole.computeVertexNormals();
  parts.push(sole);
  const strap = box(0.07, 0.006, 0.014, "#4a2a1a", M.plain);
  strap.rotateX(-0.28);
  parts.push(strap.translate(0, 0.024, -0.075));
  return merge(parts);
}

// ---------------------------------------------------------------- torso surface (torso-local)

/**
 * Blouse-over-body cross-sections, torso-local (y up the spine from the hip-joint line, front
 * -z): half-width, front and back depth. Waist at the natural height, hips a little wider, soft
 * shoulders; the loose blouse drapes from a modest bust instead of clinging.
 */
const TORSO: [number, number, number, number][] = [
  [-0.03, 0.15, 0.1, 0.104],
  [0.04, 0.14, 0.09, 0.096],
  [0.125, 0.114, 0.08, 0.078],
  [0.2, 0.124, 0.086, 0.082],
  [0.26, 0.137, 0.093, 0.086],
  [0.32, 0.143, 0.095, 0.089],
  [0.37, 0.149, 0.092, 0.089],
  [0.41, 0.156, 0.085, 0.084],
  [0.44, 0.157, 0.075, 0.076],
  [0.465, 0.136, 0.064, 0.067],
  [0.482, 0.092, 0.05, 0.055],
  [0.494, 0.056, 0.042, 0.047],
  [0.5, 0.03, 0.036, 0.04],
];
const TORSO_TOP = 0.5, TORSO_BOT = -0.03;
const _sec: [number, number, number] = [0, 0, 0];
function torsoSec(y: number): [number, number, number] {
  const T = TORSO, n = T.length;
  y = Math.min(TORSO_TOP, Math.max(TORSO_BOT, y));
  let i = 0;
  while (i < n - 2 && y > T[i + 1][0]) i++;
  const y0 = T[i][0], y1 = T[i + 1][0], f = (y - y0) / (y1 - y0), f2 = f * f, f3 = f2 * f;
  for (let c = 1; c <= 3; c++) {
    const p0 = T[i][c], p1 = T[i + 1][c];
    const m0 = i > 0 ? ((p1 - T[i - 1][c]) / (y1 - T[i - 1][0])) * (y1 - y0) : p1 - p0;
    const m1 = i < n - 2 ? ((T[i + 2][c] - p0) / (T[i + 2][0] - y0)) * (y1 - y0) : p1 - p0;
    _sec[c - 1] = (2 * f3 - 3 * f2 + 1) * p0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * p1 + (f3 - f2) * m1;
  }
  return _sec;
}
/** Soft drape of the blouse over a modest bust (front only), easing into the waist tuck. */
function bust(x: number, y: number): number {
  const dy = y - 0.315;
  return 0.014 * Math.exp(-(((Math.abs(x) - 0.054) / 0.05) ** 2)) * Math.exp(-((dy / (dy > 0 ? 0.055 : 0.1)) ** 2)) * smooth(0.13, 0.2, y);
}
const TORSO_P = 2.4;
/** Half-width of the open V neckline at torso height y. */
const vEdge = (y: number) => 0.002 + 0.038 * Math.min(1, Math.max(0, (y - 0.402) / 0.092));
/** |z| of the blouse surface at (x, y): back (side = +1) or front (side = -1). */
function torsoMag(x: number, y: number, side = 1): number {
  const [hw, F, B] = torsoSec(y);
  const q = 1 - Math.pow(Math.min(1, Math.abs(x) / hw), TORSO_P);
  if (q <= 0) return 0;
  return side > 0 ? B * Math.sqrt(q) : F * Math.sqrt(q) + bust(x, y) * q;
}
/** Point on the torso cross-section at height y, angle a (0 = back, π/2 = +x), scaled by `ease`. */
function torsoRing(y: number, a: number, ease: number): THREE.Vector3 {
  const [hw] = torsoSec(y);
  const sa = Math.sin(a), ca = Math.cos(a);
  const x = hw * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / TORSO_P);
  const side = ca >= 0 ? 1 : -1;
  return V(x * ease, y, side * torsoMag(x, y, side) * ease);
}
/** Point on the blouse, front (side = -1) or back (side = +1), lifted along the surface normal. */
function torsoPt(x: number, y: number, side: number, lift: number): THREE.Vector3 {
  const e = 0.004;
  const z = side * torsoMag(x, y, side);
  const dx = (side * torsoMag(x + e, y, side) - side * torsoMag(x - e, y, side)) / (2 * e);
  const dy = (side * torsoMag(x, y + e, side) - side * torsoMag(x, y - e, side)) / (2 * e);
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
  /** 0..1 smoothed sprint (Shift while riding), for a standing-pedal pose. */
  sprint?: number;
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

/** Ponytail joints: 7 main segments + a 4-segment secondary strand (from main segment 3). */
const PONY_N = 11;
/** Rest bends: a slight wave toward the end, the secondary strand splaying off to one side. */
const PONY_REST_X = [0, 0, 0, 0, 0.04, 0.08, 0.1, -0.12, 0.05, 0.08, 0.1];
const PONY_REST_Z = [0, 0, 0, 0, 0.08, -0.1, 0.12, 0.32, -0.12, 0.1, -0.12];
const newPose = (): Pose => ({
  torsoP: new THREE.Vector3(),
  torsoQ: new THREE.Quaternion(),
  head: new THREE.Vector3(),
  ponyX: new Array(PONY_N).fill(0),
  ponyZ: new Array(PONY_N).fill(0),
  hip: [new THREE.Vector3(), new THREE.Vector3()],
  ankle: [new THREE.Vector3(), new THREE.Vector3()],
  kneePole: [new THREE.Vector3(), new THREE.Vector3()],
  legL: [0.43, 0.42],
  footQ: [new THREE.Quaternion(), new THREE.Quaternion()],
  wrist: [new THREE.Vector3(), new THREE.Vector3()],
  elbowPole: [new THREE.Vector3(), new THREE.Vector3()],
  armL: [[0.27, 0.26], [0.27, 0.26]],
});

const SHOULDER = (side: number) => V(side * 0.158, 0.415, -0.006);
/** Walking leg: thigh + shin (slightly shorter than the pedalling IK so she stands nearly straight). */
const WALK_LEG = [0.43, 0.42];
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
 * 4: like 1 without the side fade (wrapped bands); 5: solid (flat painted eye layers).
 */
const softCache = new Map<string, THREE.ShaderMaterial>();
/** Unlit face decals follow the time-of-day light, normalised so daytime looks as authored. */
const DAY_LIGHT = new THREE.Color("#8a90b0").lerp(new THREE.Color("#fff1dc"), 0.75);
const LIGHT_GLSL = `uniform vec3 uSunColor; uniform vec3 uShadowTint;
  vec3 todLight(){ return clamp(mix(uShadowTint, uSunColor, 0.75) / vec3(${DAY_LIGHT.r.toFixed(4)}, ${DAY_LIGHT.g.toFixed(4)}, ${DAY_LIGHT.b.toFixed(4)}), 0.0, 1.2); }`;
function softDecal(rgb: [number, number, number], alpha: number, mode: number): THREE.ShaderMaterial {
  const key = rgb.join() + "|" + alpha + "|" + mode;
  let m = softCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      uniforms: { uCol: { value: new THREE.Vector3(...rgb) }, uA: { value: alpha }, uMode: { value: mode }, uSunColor: G.uSunColor, uShadowTint: G.uShadowTint },
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `${LIGHT_GLSL}
        uniform vec3 uCol; uniform float uA; uniform int uMode; in vec2 vUv;
        layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
        void main(){
          float a;
          float side = 1.0 - smoothstep(0.6, 1.0, abs(vUv.x - 0.5) * 2.0);
          if (uMode == 0) a = 1.0 - smoothstep(0.15, 1.0, length((vUv - 0.5) * 2.0));
          else if (uMode == 1) a = pow(clamp(vUv.y, 0.0, 1.0), 1.6) * side;
          else if (uMode == 2) a = smoothstep(0.35, 0.62, vUv.y) * side;
          else if (uMode == 5) a = 1.0;
          else a = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
          gColor = vec4(uCol * todLight(), a * uA); gNormal = vec4(0.0);
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
    uniforms: { uSunColor: G.uSunColor, uShadowTint: G.uShadowTint },
    vertexShader: `out vec2 vUv; out vec3 vN; out vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIGHT_GLSL}
      in vec2 vUv; in vec3 vN; in vec3 vV; layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
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
        gColor = vec4(col * todLight(), clamp(a + glint * 0.35, 0.0, 0.6));
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
  private readonly bouquet = new THREE.Group();
  private bq = { x: 0, vx: 0, z: 0, vz: 0 };
  private walkShadow!: THREE.Mesh;
  private onFoot = false;
  private poseA = newPose();
  private poseB = newPose();
  private standK = 0;
  /** The bicycle (frame, wheels, crank, steer + basket). */
  readonly bike = new Bike();
  private steer = this.bike.steer;
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private pony: THREE.Group[] = [];
  private ponyLen: number[] = [];
  private ponyS: { x: number; vx: number; z: number; vz: number }[] | null = null;
  private skirt!: THREE.Mesh;
  private skirtGeo!: THREE.BufferGeometry;
  private thighA: THREE.Vector3[] = [];
  private thighB: THREE.Vector3[] = [];
  private thigh: Limb[] = [];
  private shin: Limb[] = [];
  private socks: Limb[] = [];
  private shinA: THREE.Vector3[] = [];
  private shinB: THREE.Vector3[] = [];
  private upperArm: Limb[] = [];
  private foreArm: Limb[] = [];
  private knees: THREE.Mesh[] = [];
  private elbows: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  /** Wrist points in steer space (hands are modelled on the grips). */
  private wrists: THREE.Vector3[] = [];

  constructor() {
    this.root.add(this.lean);
    this.lean.add(this.bike.group);
    this.buildBasketLoad(0.77, -0.68);
    this.buildHands();
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
    this.bike.basketContents.add(bag);
    // Shoulder strap looped over the basket rim on both sides.
    for (const s of [-1, 1]) {
      const a = V(s * 0.135, top - 0.03, zc), b = V(s * 0.172, top + 0.075, zc + 0.01), c = V(s * 0.2, top - 0.02, zc + 0.03);
      parts.push([beam(a, b, 0.007, STRAP, M.cloth, 5), ID.rider], [beam(b, c, 0.007, STRAP, M.cloth, 5), ID.rider]);
    }
    // Leeks: white stalks, pale neck, split green tops.
    const leeks: [number, number, number, number][] = [[0.125, -0.085, 0.36, -0.7]];
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
    for (const [g, id] of parts) this.add(g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.bike.basketContents, id);
    this.buildBouquet(V(-0.075, floor + 0.01, bz - 0.075));
  }

  /**
   * Little summer bouquet in kraft paper: two sunflowers, cosmos and baby's breath. Its own group
   * pivots at the basket floor so it can sway on a spring (see update()).
   */
  private buildBouquet(base: THREE.Vector3): void {
    const g = this.bouquet;
    g.position.copy(base).sub(HEAD_BOT);
    this.bike.basketContents.add(g);
    const parts: [THREE.BufferGeometry, number][] = [];
    const wrap = prep(new THREE.CylinderGeometry(0.058, 0.022, 0.2, 12, 1, true), "#d6c49a", M.cloth);
    wrap.translate(0, 0.12, 0);
    wrap.rotateX(-0.12);
    parts.push([wrap, ID.bike]);
    parts.push([xf(cyl(0.033, 0.033, 0.018, "#c8342c", M.cloth, 12), 0, 0.075, -0.004), ID.rider]);
    const flower = (tip: THREE.Vector3, kind: 0 | 1 | 2, tint: string) => {
      parts.push([beam(V(0, 0.02, 0), tip, 0.0035, "#4a7a30", M.plain, 4), ID.flower]);
      const dir = tip.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().lerp(V(0, 0, 1), 0.35).normalize());
      const head: THREE.BufferGeometry[] = [];
      if (kind === 0) {
        head.push(xf(cyl(0.022, 0.022, 0.012, "#5a3a1a", M.plain, 12), 0, 0.004, 0));
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const p = box(0.024, 0.004, 0.011, "#f2c230", M.plain);
          p.translate(0.031, 0, 0);
          p.rotateY(a);
          head.push(p);
        }
      } else if (kind === 1) {
        head.push(xf(sphere(0.007, "#f2c230", M.plain, 6, 4), 0, 0.004, 0));
        for (let i = 0; i < 8; i++) {
          const p = box(0.02, 0.003, 0.011, tint, M.plain);
          p.translate(0.014, 0, 0);
          p.rotateY((i / 8) * Math.PI * 2);
          head.push(p);
        }
      } else {
        for (let i = 0; i < 7; i++) head.push(xf(sphere(0.0055, "#fbfaf4", M.plain, 5, 3), Math.cos(i * 2.4) * 0.016 * Math.sqrt(i / 7), 0.004 * (i % 3), Math.sin(i * 2.4) * 0.016 * Math.sqrt(i / 7)));
      }
      for (const h of head) {
        h.applyQuaternion(q);
        h.translate(tip.x, tip.y, tip.z);
        parts.push([h, kind === 2 ? ID.flower : ID.rider]);
      }
    };
    flower(V(0.004, 0.3, 0.02), 0, "");
    flower(V(-0.04, 0.25, 0.035), 0, "");
    flower(V(0.045, 0.27, 0.01), 1, "#f2a0c0");
    flower(V(-0.022, 0.285, -0.03), 1, "#fbf6f0");
    flower(V(0.03, 0.23, 0.05), 1, "#e070a0");
    for (const [x, y, z] of [[-0.06, 0.24, 0.0], [0.06, 0.24, 0.035], [0.015, 0.27, -0.045], [-0.03, 0.22, 0.06], [0.055, 0.21, -0.02]]) flower(V(x, y, z), 2, "");
    for (const [geo, id] of parts) this.add(geo.scale(1.35, 1.35, 1.35), g, id);
  }

  /** Mitten hands closed around the grips (steer-space, so they follow the bars exactly). */
  private buildHands(): void {
    for (const side of [1, -1]) {
      const G = V(side * 0.29, 1.05, -0.17);
      const parts: THREE.BufferGeometry[] = [];
      const palm = sphere(1, SKIN, M.skin, 14, 10);
      palm.scale(0.05, 0.035, 0.037);
      parts.push(palm.translate(G.x, G.y + 0.01, G.z + 0.003));
      const fingers = sphere(1, SKIN, M.skin, 12, 8);
      fingers.scale(0.047, 0.025, 0.023);
      parts.push(fingers.translate(G.x + side * 0.002, G.y - 0.004, G.z - 0.024));
      const thumb = sphere(1, SKIN, M.skin, 10, 6);
      thumb.scale(0.014, 0.013, 0.027);
      thumb.rotateY(side * 0.45);
      thumb.rotateX(0.35);
      parts.push(thumb.translate(G.x - side * 0.04, G.y + 0.016, G.z - 0.015));
      const W = V(side * 0.012, 0.026, 0.034).add(G);
      parts.push(xf(sphere(0.025, SKIN, M.skin, 10, 6), W.x, W.y, W.z));
      for (const g of parts) this.gripHands.push(this.add(g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer, ID.skin));
      this.wrists.push(W.sub(HEAD_BOT));
    }
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

    // Torso (leans forward from the hips); the skirt below is attached to its waist every frame.
    this.torso.position.copy(hip);
    this.torso.rotation.x = -0.28;
    b.add(this.torso);
    const tp = this.torso;

    // High-waisted midi A-line skirt, rebuilt each frame (waistband ring on the torso, soft pleats
    // that drape over the thighs when seated and hang and swing when she walks).
    const cols = SKIRT_N * 2;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((cols + 1) * SKIRT_R * 3);
    const col = new Float32Array((cols + 1) * SKIRT_R * 3);
    const uv = new Float32Array((cols + 1) * SKIRT_R * 2);
    const sc = new THREE.Color(SKIRT);
    for (let j = 0; j < SKIRT_R; j++)
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        const shade = (i % 2 ? 0.8 : 1.0) * (j < 2 ? 1 : 1 - 0.04 * (j / SKIRT_R));
        col[k * 3] = sc.r * shade;
        col[k * 3 + 1] = sc.g * shade;
        col[k * 3 + 2] = sc.b * shade;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = j / (SKIRT_R - 1);
      }
    const idx: number[] = [];
    for (let j = 0; j < SKIRT_R - 1; j++)
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
    this.skirt = new THREE.Mesh(g, uber(rid, 1, THREE.DoubleSide));
    this.skirt.frustumCulled = false;
    b.add(this.skirt);
    // Closed hip line inside the skirt, so no angle sees up into the blouse.
    {
      const cap = new THREE.CircleGeometry(1, 32).rotateX(Math.PI / 2);
      const cp = cap.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), z = cp.getZ(i);
        const r = Math.hypot(x, z);
        if (r < 1e-4) continue;
        const pt = torsoRing(SKIRT_HIP_Y, Math.atan2(x, z), 1.08);
        cp.setXYZ(i, pt.x * r, SKIRT_HIP_Y, pt.z * r);
      }
      this.skirtCap = new THREE.Mesh(prep(cap, SKIRT, M.cloth), uber(rid, 1, THREE.DoubleSide));
      tp.add(this.skirtCap);
    }
    // Modest dark safety shorts under the skirt (hips + short legs over the thighs).
    const pel = sphere(1, SHORTS, M.cloth, 16, 10);
    pel.scale(0.145, 0.09, 0.115);
    this.pelvis = this.add(pel, b, rid);
    for (let i = 0; i < 2; i++) this.shortLegs.push(new Limb(b, [0.093, 0.092, 0.091], SHORTS, M.cloth, rid));
    const seat = sphere(0.15, SKIRT, M.cloth, 16, 10);
    seat.scale(1.05, 0.55, 1.0);
    seat.translate(hip.x, hip.y - 0.06, hip.z + 0.03);
    this.seatCover = this.add(seat, b, rid);

    // Blouse body: lofted cross-sections (waist, soft bust drape, rounded shoulders).
    {
      const NY = 40, NA = 48;
      const P: number[] = [];
      for (let j = 0; j <= NY; j++) {
        const y = TORSO_BOT + ((TORSO_TOP - TORSO_BOT) * j) / NY;
        for (let i = 0; i < NA; i++) {
          const p = torsoRing(y, (i / NA) * Math.PI * 2, 1);
          P.push(p.x, y, p.z);
        }
      }
      P.push(0, TORSO_BOT - 0.01, 0, 0, TORSO_TOP + 0.006, 0);
      const I: number[] = [];
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NA; i++) {
          const i2 = (i + 1) % NA;
          const a = j * NA + i, bb = j * NA + i2, c = a + NA, d = bb + NA;
          I.push(a, bb, c, bb, d, c);
        }
      const bot = (NY + 1) * NA, top = bot + 1;
      for (let i = 0; i < NA; i++) {
        const i2 = (i + 1) % NA;
        I.push(bot, i2, i, top, NY * NA + i, NY * NA + i2);
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      tg.setIndex(I);
      tg.computeVertexNormals();
      // Face winding outward (a is +x side of the ring, so check one normal).
      const nx = tg.attributes.normal.getZ(20 * NA);
      if (nx < 0) {
        for (let k = 0; k < I.length; k += 3) [I[k + 1], I[k + 2]] = [I[k + 2], I[k + 1]];
        tg.setIndex(I);
        tg.computeVertexNormals();
      }
      this.add(prep(tg, BLOUSE, M.cloth), tp, rid);
    }
    // Waistband of the skirt over the tuck.
    {
      const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
      const N = 48;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2 + 0.001;
        const p = torsoRing(SKIRT_WAIST_Y + 0.012, a, 1.035);
        pts.push(p);
        ups.push(V(p.x, 0, p.z).normalize());
        w.push(0.013);
        th.push(0.003);
      }
      this.add(ribbon(pts, ups, w, th, SKIRT, M.cloth, 1), tp, rid);
    }
    // V neckline (skin), soft open collar, placket with small buttons, a few loose folds.
    {
      const pos2: number[] = [], id2: number[] = [];
      const NX = 6, NYv = 6;
      for (let j = 0; j <= NYv; j++) {
        const y = 0.405 + (0.095 * j) / NYv;
        const hwv = vEdge(y);
        for (let i = 0; i <= NX; i++) {
          const p = torsoPt((2 * i / NX - 1) * hwv, y, -1, 0.0012);
          pos2.push(p.x, p.y, p.z);
        }
      }
      for (let j = 0; j < NYv; j++)
        for (let i = 0; i < NX; i++) {
          const a = j * (NX + 1) + i, bb = a + 1, c = a + NX + 1, d = c + 1;
          id2.push(a, c, bb, bb, c, d);
        }
      const vg = new THREE.BufferGeometry();
      vg.setAttribute("position", new THREE.Float32BufferAttribute(pos2, 3));
      vg.setIndex(id2);
      vg.computeVertexNormals();
      tp.add(new THREE.Mesh(prep(vg, SKIN, M.skin), uber(ID.skin, 0)));
    }
    for (const s of [-1, 1]) {
      // Lapel flap folding out from the V edge.
      this.add(torsoStrip([0.494, 0.47, 0.445, 0.422, 0.404].map((y, k) => [s * (vEdge(y) + (0.009 - 0.0015 * k)), y] as [number, number]), -1, 0.003, 0.011, 0.005, BLOUSE, 0.002), tp, rid);
    }
    this.add(torsoPatch(-0.085, 0.085, 0.44, 0.502, 1, 0.003, BLOUSE, 10, 4), tp, rid);
    this.add(torsoStrip([[0, 0.402], [0, 0.33], [0, 0.25], [0, 0.18], [0, SKIRT_WAIST_Y + 0.02]], -1, 0.0012, 0.0055, 0.0055, "#e9e6de", 0.0008), tp, rid);
    {
      const btn: THREE.BufferGeometry[] = [];
      for (const y of [0.372, 0.305, 0.238, 0.172]) {
        const p = torsoPt(0, y, -1, 0.0022), q = torsoPt(0, y, -1, 0.01);
        const bg = new THREE.CylinderGeometry(0.0048, 0.0048, 0.0018, 10);
        bg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), q.sub(p).normalize()));
        btn.push(prep(bg.translate(p.x, p.y, p.z), "#e4ddcc", M.plain));
      }
      tp.add(new THREE.Mesh(merge(btn), uber(rid, 0.5)));
    }
    {
      const folds: THREE.BufferGeometry[] = [];
      const fold = (x0: number, y0: number, x1: number, y1: number, side: number, wd = 0.0026) => {
        const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], w: number[] = [], th: number[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          const p = torsoPt(x, y, side, 0.0012);
          pts.push(p);
          ups.push(torsoPt(x, y, side, 0.01).sub(p).normalize());
          w.push(wd * Math.sin(Math.PI * (0.08 + 0.84 * t)));
          th.push(0.0005);
        }
        folds.push(ribbon(pts, ups, w, th, "#d5d8e2", M.cloth, 1));
      };
      for (const s of [-1, 1]) {
        fold(s * 0.05, 0.145, s * 0.06, 0.27, -1);
        fold(s * 0.1, 0.14, s * 0.11, 0.24, -1);
        fold(s * 0.02, 0.145, s * 0.03, 0.2, -1, 0.002);
        fold(s * 0.04, 0.14, s * 0.05, 0.3, 1);
        fold(s * 0.095, 0.14, s * 0.1, 0.26, 1);
      }
      tp.add(new THREE.Mesh(merge(folds), uber(rid, 0)));
    }
    // Soft puffed short sleeves: a rounded cap on the shoulder, a sleeve that follows the upper arm
    // (oriented in applyPose) with gathers and a rolled cuff.
    for (const s of [-1, 1]) {
      const S = SHOULDER(s);
      const cap = sphere(0.058, BLOUSE, M.cloth, 14, 10);
      cap.scale(1.0, 0.92, 0.95);
      this.fppKeep.push(this.add(cap.translate(S.x - s * 0.006, S.y + 0.004, S.z), tp, rid));
      const sg = new THREE.Group();
      b.add(sg);
      this.sleeves.push(sg);
      const prof = [V(0.05, -0.015, 0), V(0.061, 0.0, 0), V(0.069, 0.04, 0), V(0.068, 0.08, 0), V(0.062, 0.11, 0), V(0.058, 0.125, 0)].map((v) => new THREE.Vector2(v.x, v.y));
      const tube = new THREE.LatheGeometry(prof, 20);
      const tpos = tube.attributes.position;
      for (let i = 0; i < tpos.count; i++) {
        const x = tpos.getX(i), y = tpos.getY(i), z = tpos.getZ(i);
        const a = Math.atan2(x, z);
        const k = 1 + 0.035 * Math.cos(a * 7) * smooth(0.0, 0.05, y) * smooth(0.125, 0.07, y);
        tpos.setXYZ(i, x * k, y, z * k);
      }
      tube.computeVertexNormals();
      const tm = new THREE.Mesh(prep(tube, BLOUSE, M.cloth), uber(rid, 1, THREE.DoubleSide));
      sg.add(tm);
      const cuff = prep(new THREE.TorusGeometry(0.058, 0.0075, 6, 20), "#ebe9e3", M.cloth);
      cuff.rotateX(Math.PI / 2);
      cuff.translate(0, 0.122, 0);
      const cm = new THREE.Mesh(cuff, uber(rid, 1));
      sg.add(cm);
      this.fppKeep.push(tm, cm);
    }

    // Neck: slim, leaning slightly forward, entering the head behind the chin.
    {
      const neck = new Limb(tp, [0.039, 0.034, 0.03, 0.029], SKIN, M.skin, ID.skin);
      neck.mesh.geometry.scale(1, 1, 0.92);
      neck.set(V(0, 0.43, 0.01), V(0, 0.64, 0.002));
    }
    this.head.position.set(0, 0.664, -0.012);
    this.head.scale.setScalar(HEAD_SCALE);
    this.head.name = "riderHead";
    tp.add(this.head);
    const face = new THREE.SphereGeometry(1, 72, 54);
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
    this.drapeSkirt(0, 0);
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
   * Face after the model sheet: medium almond eyes one eye-width apart (warm brown iris darker at
   * the top, one main catch-light + a small one, a thin upper lash thickening to the outer corner,
   * a faint lower lash and a double-lid crease), thin soft brows just above the frames, a tiny nose
   * (geometry bump + a small shade), a small closed smile, soft blush, ears. All inner lines are
   * painted strokes excluded from the ink pass, so only the silhouette carries the outline. Each
   * eye sits in its own group so it can blink.
   */
  private buildFace(): void {
    const EYE_X = 0.043, EYE_Y = -0.012;
    const [EYE_AZ, EYE_EL] = faceAt(EYE_X, EYE_Y);
    const INK = -1;
    /** Tapered strip on the face surface along (az, el) samples. */
    const stroke = (az: number[], el: number[], w: number[], lift: number, color: string) => {
      const pts: THREE.Vector3[] = [], ups: THREE.Vector3[] = [], th: number[] = [];
      for (let k = 0; k < az.length; k++) {
        const d = dirOf(az[k], el[k]);
        const n = radialNormal(d, faceR);
        pts.push(d.clone().multiplyScalar(faceR(d)).addScaledVector(n, lift));
        ups.push(n);
        th.push(0.0005);
      }
      return ribbon(pts, ups, w, th, color, M.plain, 1);
    };
    /** Same, from face-plane (x, y) samples. */
    const strokeXY = (xy: [number, number][], w: number[], lift: number, color: string) => {
      const a: number[] = [], e: number[] = [];
      for (const [x, y] of xy) {
        const [az, el] = faceAt(x, y);
        a.push(az);
        e.push(el);
      }
      return stroke(a, e, w, lift, color);
    };
    const soft = (g: THREE.BufferGeometry, rgb: [number, number, number], alpha: number, mode: number, parent: THREE.Object3D = this.head) => {
      const m = new THREE.Mesh(g, softDecal(rgb, alpha, mode));
      m.renderOrder = 2;
      parent.add(m);
      this.lenses.push(m);
      return m;
    };
    const softXY = (g: THREE.BufferGeometry, x: number, y: number, lift: number, rgb: [number, number, number], alpha: number, mode = 0) => {
      const [az, el] = faceAt(x, y);
      return soft(placeOnHead(g, az, el, lift), rgb, alpha, mode);
    };
    const SHADE: [number, number, number] = [0.84, 0.58, 0.55];
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
      // Almond opening in local angular coords: X toward the outer corner, Y up. The outer corner
      // lifts a touch; the lower lid is flatter than the upper.
      const hw = 0.0189 / r0, hh = 0.0126 / r0, tilt = 0.14 * hh;
      const yTop = (X: number) => hh * Math.pow(Math.max(0, 1 - (X / hw) ** 2), 0.62) + tilt * (X / hw) - 0.12 * hh * (X / hw) ** 3;
      const yBot = (X: number) => -0.78 * hh * Math.pow(Math.max(0, 1 - (X / hw) ** 2), 0.75) + tilt * (X / hw);
      const at = (X: number, Y: number, lift: number) => {
        const d = dirOf(az + s * X, EYE_EL + Y);
        return d.clone().multiplyScalar(faceR(d)).addScaledVector(radialNormal(d, faceR), lift).sub(P);
      };
      /** Filled shape on the face (fan from its centre), optionally clipped to the eye opening. */
      const fill = (cx: number, cy: number, rx: number, ry: number, lift: number, color: string, clip: boolean) => {
        const N = 28;
        const pts: THREE.Vector3[] = [at(cx, cy, lift)];
        for (let k = 0; k <= N; k++) {
          const t = (k / N) * Math.PI * 2;
          let X = cx + Math.cos(t) * rx, Y = cy + Math.sin(t) * ry;
          if (clip) {
            X = Math.max(-hw * 0.985, Math.min(hw * 0.985, X));
            Y = Math.min(yTop(X), Math.max(yBot(X), Y));
          }
          pts.push(at(X, Y, lift));
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const idx: number[] = [];
        for (let k = 1; k <= N; k++) idx.push(0, k, k + 1);
        g.setIndex(idx);
        g.computeVertexNormals();
        const n0 = g.attributes.normal;
        if (V(n0.getX(0), n0.getY(0), n0.getZ(0)).dot(d0) < 0) {
          for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
          g.setIndex(idx);
          g.computeVertexNormals();
        }
        return prep(g, color, M.plain);
      };
      // Eye layers are painted flat (only the time-of-day light), stacked by render order, so the
      // iris keeps its warm brown under the fringe's shade instead of turning grey.
      let layer = 3;
      const add = (g: THREE.BufferGeometry) => {
        const c = g.attributes.color;
        const m = new THREE.Mesh(g, softDecal([c.getX(0), c.getY(0), c.getZ(0)], 1, 5));
        m.renderOrder = layer++;
        eye.add(m);
        this.lenses.push(m);
        return m;
      };
      // White, iris (warm brown, darker toward the top), lower glow ring, pupil.
      add(fill(0, 0, hw, hh * 1.6, 0.0008, "#fbf7f2", true));
      const ix = -0.04 * hw, iy = 0.02 * hh, irx = 0.55 * hw, iry = 1.06 * hh;
      add(fill(ix, iy, irx, iry, 0.0018, "#6a391d", true));
      add(fill(ix, iy - 0.3 * hh, irx * 0.8, iry * 0.55, 0.0022, "#a8683a", true));
      add(fill(ix, iy - 0.42 * hh, irx * 0.5, iry * 0.3, 0.0025, "#cf9255", true));
      add(fill(ix, iy + 0.02 * hh, irx * 0.46, iry * 0.52, 0.0028, "#23120c", true));
      add(fill(ix, iy + 0.62 * hh, irx * 1.05, iry * 0.5, 0.003, "#3a1f15", true));
      // Soft shadow of the upper lid across the top of the opening.
      {
        const pos: number[] = [], uv: number[] = [], idx: number[] = [];
        const N = 16;
        for (let k = 0; k <= N; k++) {
          const X = -hw + (2 * hw * k) / N;
          const top = yTop(X), bot = yBot(X);
          const a = at(X, top, 0.0034), b = at(X, top - 0.5 * (top - bot), 0.0034);
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
          uv.push(k / N, 1, k / N, 0);
          if (k < N) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, softDecal([0.25, 0.12, 0.1], 0.45, 4));
        m.material.side = THREE.DoubleSide;
        m.renderOrder = 2;
        eye.add(m);
        this.lenses.push(m);
      }
      // One main catch-light (upper, toward the nose side of the light) + one small one.
      add(fill(ix - 0.22 * hw, iy + 0.34 * hh, 0.15 * hw, 0.24 * hh, 0.0042, "#ffffff", false));
      add(fill(ix + 0.2 * hw, iy - 0.4 * hh, 0.065 * hw, 0.065 * hw, 0.0042, "#fff6ee", false));
      // Thin upper lash along the lid, thickening toward the outer corner with a short flick.
      const la: number[] = [], le: number[] = [], lw: number[] = [];
      for (let k = 0; k <= 14; k++) {
        const X = hw * (-0.98 + (k / 14) * 1.98);
        la.push(az + s * X);
        le.push(EYE_EL + yTop(X) + 0.06 * hh);
        const t = k / 14;
        lw.push(0.0008 + 0.0026 * Math.pow(t, 1.5));
      }
      la.push(az + s * hw * 1.2);
      le.push(EYE_EL + tilt + 0.4 * hh);
      lw.push(0.0007);
      eye.add(new THREE.Mesh(local(stroke(la, le, lw, 0.0036, "#1e120e")), uber(ID.eye, INK)));
      // Faint lower lash on the outer half.
      const ba: number[] = [], be: number[] = [], bw: number[] = [];
      for (let k = 0; k <= 6; k++) {
        const X = hw * (0.95 - (k / 6) * 0.95);
        ba.push(az + s * X);
        be.push(EYE_EL + yBot(X) - 0.07 * hh);
        bw.push(0.0005 * (1 - k / 7) + 0.00015);
      }
      eye.add(new THREE.Mesh(local(stroke(ba, be, bw, 0.002, "#8a5a48")), uber(ID.eye, INK)));
      // Warm lid shade and the double-eyelid crease above the lash.
      soft(local(placeOnHead(new THREE.CircleGeometry(1, 20).scale(0.017, 0.0055, 1), az + s * 0.1 * hw, EYE_EL + tilt * 0.5 + 1.5 * hh, 0.0012)), [0.88, 0.56, 0.48], 0.3, 0, eye);
      const ca: number[] = [], ce: number[] = [], cw: number[] = [];
      for (let k = 0; k <= 8; k++) {
        const X = hw * (-0.55 + (k / 8) * 1.4);
        ca.push(az + s * X);
        ce.push(EYE_EL + yTop(X) + 0.42 * hh);
        cw.push(0.0006 * Math.sin(Math.PI * (k / 8)) + 0.00012);
      }
      eye.add(new THREE.Mesh(local(stroke(ca, ce, cw, 0.0018, "#8e5e50")), uber(ID.eye, INK)));
      // Thin, soft brow just above the frame, tapering to the tail.
      const brow: [number, number][] = [], bwid: number[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        brow.push([s * (0.02 + 0.047 * t), EYE_Y + 0.0265 + 0.0045 * Math.sin(Math.PI * (0.2 + 0.75 * t)) - 0.004 * t * t]);
        bwid.push(0.0011 * (1 - 0.7 * Math.pow(t, 1.4)) * (0.6 + 0.4 * smooth(0, 0.25, t)));
      }
      this.head.add(new THREE.Mesh(strokeXY(brow, bwid, 0.0028, "#4b3128"), uber(ID.eye, INK)));
      // Blush oval under the eye, and soft shade on the outer cheek toward the jaw.
      softXY(new THREE.CircleGeometry(1, 24).scale(0.015, 0.0068, 1), s * 0.05, EYE_Y - 0.027, 0.0012, [0.96, 0.54, 0.52], 0.38);
      for (let k = 0; k < 3; k++) {
        const cx = s * (0.044 + 0.0055 * k), cy = EYE_Y - 0.027;
        this.head.add(new THREE.Mesh(strokeXY([[cx - s * 0.0016, cy - 0.0028], [cx + s * 0.0016, cy + 0.0028]], [0.0003, 0.0003], 0.0016, "#eea39a"), uber(ID.eye, INK)));
      }
      softXY(new THREE.PlaneGeometry(0.03, 0.06, 4, 6), s * 0.074, -0.05, 0.001, SHADE, 0.28);
    }
    // Soft shade under the chin and a warm gradient over the lower face.
    soft(placeOnHead(new THREE.CircleGeometry(1, 24).scale(0.035, 0.03, 1), 0, -1.2, 0.0012), SHADE, 0.5, 0);
    softXY(new THREE.CircleGeometry(1, 28).scale(0.06, 0.04, 1), 0, -0.058, 0.0009, [0.97, 0.7, 0.62], 0.16);
    // Soft cel shade under the fringe onto the forehead.
    soft(placeOnHead(new THREE.PlaneGeometry(0.17, 0.05, 16, 6), 0, 0.4, 0.0011), SHADE, 0.62, 2);
    // Nose: the tip is sculpted; add a small shade on one side and a faint nostril hint.
    const noseShade = strokeXY([[-0.0045, -0.036], [-0.0055, -0.043], [-0.0035, -0.048]], [0.00035, 0.0006, 0.0003], 0.001, "#d59a88");
    this.head.add(new THREE.Mesh(noseShade, uber(ID.eye, INK)));
    softXY(new THREE.CircleGeometry(1, 16).scale(0.0045, 0.0017, 1), 0.0005, -0.0505, 0.0009, [0.82, 0.5, 0.46], 0.35);
    softXY(new THREE.CircleGeometry(1, 16).scale(0.0022, 0.008, 1), 0.004, -0.03, 0.0012, [1.0, 0.97, 0.94], 0.35);
    // Small gentle closed smile with lifted corners and a light lip tint.
    {
      const m: [number, number][] = [], w: number[] = [];
      for (let k = 0; k <= 12; k++) {
        const x = -1 + (k / 12) * 2;
        m.push([x * 0.0125, -0.0685 - 0.0016 * (1 - x * x) + 0.0024 * Math.pow(x, 4)]);
        w.push(0.0006 * (1 - 0.55 * x * x) + 0.00018);
      }
      this.head.add(new THREE.Mesh(strokeXY(m, w, 0.0012, "#8a4038"), uber(ID.eye, INK)));
      softXY(new THREE.CircleGeometry(1, 16).scale(0.0065, 0.0022, 1), 0, -0.0725, 0.0009, [0.92, 0.5, 0.48], 0.32);
    }
    this.buildEars();
    this.buildGlasses(EYE_X, EYE_Y);
  }

  /** Simple ears: a cupped shell on each side, the top level with the eyes, a soft inner shade. */
  private buildEars(): void {
    for (const s of [-1, 1]) {
      const y = -0.021, z = 0.012;
      const [W, F, B] = profAt(y);
      const D = (F + B) / 2, v = (z - (B - F) / 2) / D;
      const x = s * W * Math.sqrt(Math.max(0, 1 - v * v)) * 0.965;
      const g = sphere(1, SKIN, M.skin, 14, 10);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        let px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
        // Cup: the outer face dishes in; the lobe (bottom) is narrower than the helix (top).
        const k = 0.75 + 0.25 * smooth(-1, 0.4, py);
        if (px * s > 0) px *= 0.35 + 0.65 * px * px;
        pa.setXYZ(i, px * 0.0075, py * 0.025, pz * 0.0155 * k);
      }
      g.computeVertexNormals();
      g.rotateX(0.2);
      g.rotateY(s * -0.35);
      g.translate(x + s * 0.0035, y, z);
      this.add(g, this.head, ID.skin);
      const inner = sphere(1, "#ebbba6", M.skin, 10, 8);
      inner.scale(0.0022, 0.014, 0.008);
      inner.rotateX(0.2);
      inner.rotateY(s * -0.35);
      inner.translate(x + s * 0.0085, y - 0.001, z - 0.001);
      this.head.add(new THREE.Mesh(inner, uber(ID.skin, 0)));
    }
  }

  /**
   * Slim black rectangular frames with softly rounded corners: thin even rims, lenses a little
   * wider than the eyes, a clean bridge on the nose and temples running straight back over the
   * ears. Flat acetate material, one tiny highlight on each top rim; faint lenses with a glint.
   */
  private buildGlasses(eyeX: number, eyeY: number): void {
    const FR = "#2a2024", HI = "#7a7078";
    const W = 0.048, H = 0.031, RC = 0.0076;
    const SIDE = 0.0011, TOP = 0.0015, BOT = 0.0011, DEPTH = 0.0016, CLEAR = 0.0052;
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
    /** Keep a point at least `c` off the skin. */
    const outside = (p: THREE.Vector3, c: number) => {
      const d = p.clone().normalize();
      const r = faceR(d) + c;
      return p.length() < r ? d.multiplyScalar(r) : p;
    };
    const bridgeEnds: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const [az, el] = faceAt(s * (eyeX + 0.001), eyeY + 0.001);
      const d = dirOf(az, el);
      const n = dirOf(s * 0.44, -0.04);
      const ex = V(0, 1, 0).cross(n).normalize(); // ≈ -X
      const ey = n.clone().cross(ex).normalize();
      const C = d.clone().multiplyScalar(faceR(d));
      const samples: number[][] = [];
      for (let i = 0; i <= 8; i++)
        for (let j = 0; j <= 4; j++) samples.push([(-0.5 + i / 8) * (W + 2 * SIDE), -H / 2 - BOT + (j / 4) * (H + TOP + BOT)]);
      for (let it = 0; it < 12; it++) {
        let minC = Infinity;
        for (const [x, y] of samples) minC = Math.min(minC, clearance(C.clone().addScaledVector(ex, x).addScaledVector(ey, y).addScaledVector(n, -DEPTH / 2)));
        if (Math.abs(minC - CLEAR) < 2e-4) break;
        C.addScaledVector(n, CLEAR - minC);
      }
      const basis = new THREE.Matrix4().makeBasis(ex, ey, n).setPosition(C);
      const shape = rrect(new THREE.Shape(), -W / 2 - SIDE, -H / 2 - BOT, W / 2 + SIDE, H / 2 + TOP, RC + SIDE);
      shape.holes.push(rrect(new THREE.Path(), -W / 2, -H / 2, W / 2, H / 2, RC));
      const rim = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, curveSegments: 6 });
      rim.translate(0, 0, -DEPTH / 2);
      parts.push(prep(rim, FR, M.lacquer).applyMatrix4(basis));
      // One tiny highlight on the top rim toward the outer corner.
      const hx = -s * W * 0.18;
      const hi = new THREE.ExtrudeGeometry(rrect(new THREE.Shape(), hx - W * 0.14, H / 2 + TOP * 0.35, hx + W * 0.14, H / 2 + TOP * 0.7, 0.0005), { depth: 0.0004, bevelEnabled: false, curveSegments: 2 });
      hi.translate(0, 0, DEPTH / 2);
      parts.push(prep(hi, HI, M.lacquer).applyMatrix4(basis));
      const lensG = new THREE.ShapeGeometry(rrect(new THREE.Shape(), -W / 2, -H / 2, W / 2, H / 2, RC), 6);
      const lp = lensG.attributes.position, luv = lensG.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < lp.count; i++) luv.setXY(i, lp.getX(i) / W + 0.5, lp.getY(i) / H + 0.5);
      const lens = new THREE.Mesh(lensG.applyMatrix4(basis), lensMaterial());
      lens.renderOrder = 12;
      this.head.add(lens);
      this.lenses.push(lens);
      // ex ≈ -X: the nose-side edge of lens s is at local x = +s·W/2.
      bridgeEnds.push(V(s * (W / 2 + SIDE * 0.4), H / 2 - 0.004, 0).applyMatrix4(basis));
      // Hinge at the outer top corner; the temple runs straight back over the ear, then bends down.
      const hinge = V(-s * (W / 2 + SIDE * 0.5), H / 2 - 0.002, -DEPTH / 2).applyMatrix4(basis);
      const [Wy, Fy, By] = profAt(eyeY + 0.006);
      const earTop = outside(V(s * (Wy + 0.002), eyeY + 0.004, 0.006), 0.0022);
      const behind = outside(V(s * (Wy - 0.008), eyeY - 0.016, 0.022), 0.0005);
      void Fy;
      void By;
      let prev = hinge;
      const path: THREE.Vector3[] = [];
      for (let k = 1; k <= 8; k++) path.push(outside(hinge.clone().lerp(earTop, k / 8), 0.0022));
      path.push(earTop.clone().lerp(behind, 0.5).add(V(s * 0.001, 0.001, 0)), behind);
      for (const p of path) {
        parts.push(beam(prev, p, 0.0008, FR, M.lacquer, 6));
        prev = p;
      }
    }
    const [bA, bB] = bridgeEnds;
    // Thin bridge dipping onto the nose between the lenses.
    const [nAz, nEl] = faceAt(0, eyeY + 0.001);
    const nd0 = dirOf(nAz, nEl);
    const mid = nd0.clone().multiplyScalar(faceR(nd0) + 0.0016);
    const qA = bA.clone().lerp(mid, 0.5).add(V(0, 0.0012, 0)), qB = bB.clone().lerp(mid, 0.5).add(V(0, 0.0012, 0));
    parts.push(beam(bA, qA, 0.0009, FR, M.lacquer, 6), beam(qA, mid, 0.0009, FR, M.lacquer, 6), beam(mid, qB, 0.0009, FR, M.lacquer, 6), beam(qB, bB, 0.0009, FR, M.lacquer, 6));
    // Black acetate is its own line: excluded from the ink pass so it never doubles up.
    const frames = new THREE.Mesh(merge(parts), uber(ID.eye, -1));
    this.head.add(frames);
    this.lenses.push(frames);
  }

  /**
   * Hair after the model sheet: scalp shell with a hairline that clears the ears and tucks under
   * the skin, airy bangs of separate strands falling to just above the brows, chin-length side
   * locks hanging in front of the ears, the back and sides combed up into a long ponytail tied at
   * back-of-head height with a red scrunchie.
   */
  private buildHair(): void {
    const C = 44, NR = 14;
    const pos: number[] = [];
    for (let i = 0; i < C; i++) {
      const az = -Math.PI + (i / C) * Math.PI * 2;
      const e0 = hairline(az);
      for (let j = 0; j < NR; j++) {
        const el = j === 0 ? e0 : e0 + 0.05 + (Math.PI / 2 - 0.03 - e0 - 0.05) * ((j - 1) / (NR - 1));
        const d = dirOf(az, el);
        const p = d.clone().multiplyScalar(faceR(d) + (j === 0 ? -0.005 : shellTap(d)));
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

    // Airy fringe after the sheet: many thin, tapered, gently curved strands of varied length from
    // a part just off centre, falling to the brows / top of the frames with the forehead showing
    // through the gaps; the outer ones sweep down over the temples. Each strand pivots at its root
    // and sways on a spring in update().
    const PART = 0.1;
    const hsh = (k: number) => {
      const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const fringe: [number, number, number, number, number][] = [];
    const NF = 27;
    for (let k = 0; k < NF; k++) {
      const u = -1 + (2 * k) / (NF - 1);
      const tx = u * 0.084 + (hsh(k) - 0.5) * 0.004;
      const edge = smooth(0.55, 1, Math.abs(u));
      // Lengths vary strand to strand; a few dip to the top of the frames, the outer ones reach the temples.
      const ty = 0.025 - 0.02 * hsh(k + 7) - (k % 4 === 1 ? 0.013 : 0) - 0.03 * edge;
      const w = 0.0045 + 0.0035 * hsh(k + 3) + 0.002 * (1 - edge);
      fringe.push([tx, ty, w, 0.05 * u * (0.5 + 0.5 * Math.abs(u)) + (hsh(k + 11) - 0.5) * 0.02, 0.0012 + 0.003 * edge]);
    }
    // Fillers under the part and at the temples so no scalp hole shows (short, wider, roots hidden).
    for (const [tx, ty] of [[PART * 0.4, 0.05], [-0.07, 0.045], [0.07, 0.045], [-0.035, 0.052], [0.035, 0.052], [0, 0.056]]) fringe.push([tx, ty, 0.018, 0.02 * Math.sign(tx), 0]);
    fringe.forEach(([tx, ty, w, curve, lift], k) => {
      const [az, tip] = faceAt(tx, ty);
      const az0 = PART + (az - PART) * 0.55, el0 = 1.2 - 0.12 * Math.abs(az - PART);
      const g = hairStrand(az0, el0, az, tip, w, 0.0042, curve, lift, false, 14);
      const rd = dirOf(az0, el0);
      const root = rd.clone().multiplyScalar(faceR(rd) + shellOff(rd));
      const grp = new THREE.Group();
      grp.position.copy(root);
      this.head.add(grp);
      grp.add(new THREE.Mesh(g.translate(-root.x, -root.y, -root.z), uber(ID.hair, 0.3)));
      this.fringe.push({ g: grp, radial: rd, side: V(0, 1, 0).cross(rd).normalize(), gain: 0.75 + 0.5 * Math.abs(Math.sin(k * 2.7)), ph: k * 1.37, long: lift > 0.003 ? 1 : 0 });
    });

    // Back, crown and sides combed up into the tie (hair pulled back over the ears' tops).
    const TIE_EL = -0.44;
    {
      const back: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 13; k++) {
        const az0 = Math.PI + (k - 6) * 0.26;
        back.push(hairStrand(az0, 1.3 - 0.03 * Math.abs(k - 6), Math.PI + (k - 6) * 0.03, TIE_EL + 0.06, 0.032, 0.006, 0.03 * Math.sin(k * 2.1), 0, true, 12));
      }
      for (let k = 0; k < 9; k++) {
        const a = (k - 4) * 0.2;
        back.push(hairStrand(Math.PI + a * 2.6, hairline(Math.PI + a * 2.6) + 0.1, Math.PI + a * 0.15, TIE_EL - 0.03, 0.026, 0.007, 0, 0, true, 9));
      }
      for (const s of [-1, 1])
        for (let k = 0; k < 4; k++) {
          const az0 = s * (1.15 + k * 0.22);
          back.push(hairStrand(az0, 0.72 - k * 0.1, s * (Math.PI - 0.1 - 0.03 * k), TIE_EL + 0.02 * k, 0.024, 0.008, s * 0.05, 0, true, 12));
        }
      // Strands sweeping from the temples back over the tops of the ears to the tie, hugging the
      // side hairline so it reads as combed hair rather than a cap edge.
      for (const s of [-1, 1])
        for (let k = 0; k < 6; k++) {
          const el0 = 0.14 + k * 0.07;
          back.push(hairStrand(s * (1.2 + 0.03 * k), el0, s * (Math.PI - 0.12 - 0.02 * k), TIE_EL + 0.01 * k, 0.014 + 0.004 * (k % 2), 0.0045, s * (0.02 - 0.12 * (1 - k / 5)) , 0, true, 14));
        }
      // Loose wisps along the hairline behind the ears and at the nape break the shell's edge.
      for (const s of [-1, 1])
        for (let k = 0; k < 6; k++) {
          const az = s * (1.95 + k * 0.2);
          back.push(hairStrand(az, hairline(az) + 0.26, az + s * 0.04, hairline(az) - 0.07 - 0.03 * (k % 2), 0.011, 0.004, s * 0.03, 0, true, 8));
        }
      this.head.add(new THREE.Mesh(merge(back), uber(ID.hair, 0.3)));
    }
    // Long thin side locks from the temples, in front of the ears, framing the face down to the
    // jaw / chin line; each sways from its root.
    for (const s of [-1, 1]) {
      ([
        [1.02, 0.95, 1.2, 0.14, CHIN_Y - 0.004, 0.0105, -0.004, 0.0],
        [1.12, 0.92, 1.3, 0.1, CHIN_Y + 0.01, 0.0095, 0.0, 0.002],
        [1.22, 0.9, 1.4, 0.08, CHIN_Y - 0.01, 0.008, 0.004, -0.002],
        [0.98, 0.95, 1.14, 0.18, CHIN_Y + 0.026, 0.0055, -0.006, 0.003],
        [1.3, 0.86, 1.46, 0.06, CHIN_Y + 0.018, 0.007, 0.007, 0.001],
        [1.16, 0.9, 1.34, 0.05, CHIN_Y - 0.02, 0.005, 0.002, 0.003],
        [1.34, 0.8, 1.46, 0.04, CHIN_Y + 0.012, 0.012, 0.004, -0.003],
        [1.42, 0.74, 1.52, 0.02, CHIN_Y + 0.028, 0.011, 0.006, -0.004],
      ] as number[][]).forEach(([az0, el0, az1, el1, yEnd, w, fwd, curl], k) => {
        const rd = dirOf(s * az0, el0);
        const root = rd.clone().multiplyScalar(faceR(rd) + shellOff(rd));
        const grp = new THREE.Group();
        grp.position.copy(root);
        this.head.add(grp);
        grp.add(new THREE.Mesh(hangLock(s * az0, el0, s * az1, el1, yEnd, w, fwd, curl).translate(-root.x, -root.y, -root.z), uber(ID.hair, 0.3)));
        this.fringe.push({ g: grp, radial: rd, side: V(0, 1, 0).cross(rd).normalize(), gain: 0.5 + 0.2 * k, ph: 2.1 + k * 1.9 + s, long: 1 });
      });
    }

    // Long ponytail from a red scrunchie at back-of-head height: a tapered 7-segment tail (each
    // segment lobed into strands) to mid-back plus a thinner secondary strand. Segments are
    // spring-damped and pushed off her back in update().
    const nd = dirOf(Math.PI, TIE_EL);
    const tie = nd.clone().multiplyScalar(faceR(nd) + shellTap(nd) + 0.006);
    const lobed = (rt: number, rb: number, len: number, lobes: number, twist: number) => {
      const prof = [
        new THREE.Vector2(0.0005, -len - rb * 0.8),
        new THREE.Vector2(rb * 0.75, -len - rb * 0.55),
        new THREE.Vector2(rb, -len),
        new THREE.Vector2((rt + rb) * 0.54, -len * 0.5),
        new THREE.Vector2(rt, 0),
        new THREE.Vector2(rt * 0.7, rt * 0.55),
        new THREE.Vector2(0.0005, rt * 0.75),
      ];
      const lg = new THREE.LatheGeometry(prof, 20);
      const pa = lg.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const a = Math.atan2(x, z);
        const k = 1 + 0.16 * Math.cos(lobes * a + (y / Math.max(len, 1e-3)) * twist);
        pa.setXYZ(i, x * k, y, z * k * 0.85);
      }
      return prep(weld(lg), HAIR, M.hair);
    };
    const chain = (parent: THREE.Object3D, start: THREE.Vector3, L: number[], RT: number[], RB: number[], lobes: number) => {
      for (let i = 0; i < L.length; i++) {
        const seg = new THREE.Group();
        if (i === 0) seg.position.copy(start);
        else seg.position.set(0, -L[i - 1], 0);
        parent.add(seg);
        seg.add(new THREE.Mesh(lobed(RT[i], RB[i], L[i], lobes, 0.9), uber(ID.hair, 0.4)));
        this.pony.push(seg);
        this.ponyLen.push(L[i]);
        parent = seg;
      }
    };
    chain(this.head, tie, [0.05, 0.062, 0.064, 0.062, 0.058, 0.052, 0.048], [0.019, 0.029, 0.03, 0.028, 0.024, 0.018, 0.011], [0.029, 0.03, 0.028, 0.024, 0.018, 0.011, 0.002], 5);
    chain(this.pony[3], V(0.012, -0.012, 0.011), [0.05, 0.05, 0.046, 0.042], [0.011, 0.011, 0.009, 0.006], [0.011, 0.009, 0.006, 0.001], 3);
    // Scrunchie: a ruffled ring of gathered cloth.
    const p0 = this.pony[0];
    const band = prep(new THREE.TorusGeometry(0.023, 0.0115, 8, 22), "#c23a3c", M.cloth);
    const bp = band.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const a = Math.atan2(y, x);
      const k = 1 + 0.18 * Math.sin(a * 9);
      bp.setXYZ(i, x * (1 + 0.06 * Math.sin(a * 9)), y * (1 + 0.06 * Math.sin(a * 9)), z * k);
    }
    band.computeVertexNormals();
    band.rotateX(Math.PI / 2);
    this.add(band.translate(0, -0.006, 0), p0, ID.flower);
  }

  private buildLimbs(): void {
    const b = this.body;
    const rid = ID.rider;

    // Limbs (updated every frame via IK): profiled tubes with a natural taper (thigh → knee, calf
    // curve → slim ankle, shoulder → elbow → wrist); joints are spheres.
    for (let s = 0; s < 2; s++) {
      this.thigh.push(new Limb(b, [0.088, 0.084, 0.076, 0.066, 0.058], SKIN, M.skin, ID.skin));
      this.shin.push(new Limb(b, [0.055, 0.06, 0.061, 0.055, 0.045, 0.037, 0.032], SKIN, M.skin, ID.skin));
      this.socks.push(new Limb(b, [0.036, 0.0375, 0.039, 0.0395], SOCK, M.cloth, rid));
      this.upperArm.push(new Limb(b, [0.05, 0.048, 0.044, 0.039, 0.036], SKIN, M.skin, ID.skin));
      this.foreArm.push(new Limb(b, [0.035, 0.038, 0.036, 0.031, 0.026, 0.024], SKIN, M.skin, ID.skin));
      const knee = mk(sphere(0.058, SKIN, M.skin, 14, 10), ID.skin);
      const elbow = mk(sphere(0.036, SKIN, M.skin, 12, 8), ID.skin);
      const foot = mk(loafer(), rid);
      b.add(knee, elbow, foot);
      this.knees.push(knee);
      this.elbows.push(elbow);
      this.feet.push(foot);
    }
    // Relaxed hands for walking (the riding hands are modelled on the grips): local -Y runs down the
    // fingers, the palm faces her thigh; fingers grouped and softly curled, a separate thumb.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hand = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      parts.push(xf(sphere(0.025, SKIN, M.skin, 10, 6), 0, 0, 0));
      const palm = sphere(1, SKIN, M.skin, 14, 10);
      palm.scale(0.02, 0.044, 0.036);
      parts.push(palm.translate(0, -0.042, 0));
      const fingers = sphere(1, SKIN, M.skin, 12, 8);
      fingers.scale(0.017, 0.036, 0.032);
      fingers.rotateX(-0.3);
      parts.push(fingers.translate(-side * 0.006, -0.088, -0.006));
      const tips = sphere(1, SKIN, M.skin, 10, 6);
      tips.scale(0.015, 0.018, 0.028);
      parts.push(tips.translate(-side * 0.011, -0.116, -0.012));
      const thumb = sphere(1, SKIN, M.skin, 10, 6);
      thumb.scale(0.012, 0.028, 0.013);
      thumb.rotateX(0.35);
      thumb.rotateZ(side * 0.25);
      parts.push(thumb.translate(-side * 0.01, -0.05, -0.034));
      for (const g of parts) this.add(g, hand, ID.skin);
      hand.visible = false;
      b.add(hand);
      this.walkHands.push(hand);
    }
  }

  /**
   * Recompute skirt vertices. Rings 0-1 sit on the torso (waistband, hips); the rest drape from
   * the hips: forward over the thighs and down past the knees when seated, hanging straight with
   * swinging, trailing pleats when standing / walking. `stand` 0 = seated … 1 = standing; `gait` =
   * [move 0..1, stride phase, run 0..1].
   */
  private drapeSkirt(speed: number, time: number, stand = 0, gait: number[] = [0, 0, 0]): void {
    const g = this.skirtGeo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const cols = SKIRT_N * 2;
    const [mv, ph, run] = gait;
    const sp = stand > 0 ? Math.min(1.3, (0.25 * mv + 0.55 * run) * stand + Math.min(speed / 8, 1.3) * (1 - stand)) : Math.min(speed / 8, 1.3);
    const TQ = this.torso.quaternion, TP = this.torso.position;
    const fwd = _d1.set(0, -0.3, -1).normalize(), back = _d2.set(0, -1, 0.32).normalize();
    const d = new THREE.Vector3(), out = new THREE.Vector3(), H = new THREE.Vector3();
    const drop = SKIRT_R - 2;
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * Math.PI * 2;
      const rz = Math.cos(a);
      const f = (1 - rz) / 2; // 0 back, 1 front
      const pleat = i % 2 ? 0.94 : 1.0;
      for (let j = 0; j < 2; j++) {
        const q = torsoRing(j === 0 ? SKIRT_WAIST_Y : SKIRT_HIP_Y, a, j === 0 ? 1.035 : 1.1 * (0.97 + 0.03 * pleat));
        q.applyQuaternion(TQ).add(TP);
        p.setXYZ(j * (cols + 1) + i, q.x, q.y, q.z);
        if (j === 1) H.copy(q);
      }
      out.set(Math.sin(a), 0, rz).applyQuaternion(TQ);
      out.y = 0;
      out.normalize();
      // Seated: fronts go along the thighs then fall over the knees; sides and back hang.
      d.copy(back).lerp(fwd, smooth(0.25, 0.85, f)).normalize().lerp(_d3.set(0, -1, 0), stand).normalize();
      const side = Math.abs(Math.sin(a));
      const len = (0.34 + 0.12 * f + 0.06 * side) * (1 - stand) + 0.5 * stand;
      const bendG = (0.35 + 0.35 * f) * (1 - stand);
      const flare = (0.1 + 0.02 * (1 - f)) * pleat * (1 - 0.1 * stand) + 0.015 * sp;
      for (let j = 2; j < SKIRT_R; j++) {
        const t = (j - 1) / drop;
        const flut = Math.sin(time * 8 + a * 3 + j * 0.7) * 0.01 * sp * t * t;
        const drift = 0.05 * sp * t * t * (1 - f) * (1 - stand) + (0.04 * mv + 0.06 * run) * t * t * stand;
        // Walking: the hem swings side to side with the hips and each pleat lags a little.
        const swing = (Math.sin(ph - t * 0.8) * 0.02 * mv + Math.sin(time * 2.1 + a) * 0.004) * t * t * stand;
        const along = len * (t - (bendG * t * t) / 2), fall = (len * bendG * t * t) / 2;
        _sp.copy(H).addScaledVector(out, flare * Math.pow(t, 0.8)).addScaledVector(d, along);
        _sp.y -= fall;
        _sp.x += Math.sin(a) * flut + swing;
        _sp.y += flut * 0.6;
        _sp.z += rz * flut + drift;
        // Standing: push the cloth radially off the thighs and shins (a stepping knee nudges the
        // hem forward, never lifts it).
        if (stand > 0.5)
          for (let l = 0; l < this.thighA.length * 2; l++) {
            const A = l < 2 ? this.thighA[l] : this.shinA[l - 2], B = l < 2 ? this.thighB[l] : this.shinB[l - 2];
            if (!A || !B) continue;
            _sr.subVectors(B, A);
            const u = Math.min(1, Math.max(0, _sq.subVectors(_sp, A).dot(_sr) / (_sr.lengthSq() + 1e-6)));
            _sr.multiplyScalar(u).add(A);
            _sq.subVectors(_sp, _sr);
            _sq.y = 0;
            const lat = _sq.length();
            const R = l < 2 ? 0.112 : 0.075;
            if (lat < R && lat > 1e-5) _sp.addScaledVector(_sq, (R - lat) / lat);
          }
        // Seated: keep the cloth above both thighs (front half only lifts, fading toward the hip).
        if (f > 0.3 && stand <= 0.5)
          for (let l = 0; l < this.thighA.length; l++) {
            const A = this.thighA[l], B = this.thighB[l];
            const ax = B.x - A.x, az = B.z - A.z;
            const u = Math.min(1, Math.max(0, ((_sp.x - A.x) * ax + (_sp.z - A.z) * az) / (ax * ax + az * az + 1e-6)));
            _sr.copy(A).lerp(B, u);
            const lat = Math.hypot(_sp.x - _sr.x, _sp.z - _sr.z);
            const R = 0.1;
            if (lat < R) {
              const minY = _sr.y + Math.sqrt(R * R - lat * lat) * smooth(0.3, 0.55, f) * smooth(0.0, 0.25, u);
              if (_sp.y < minY) _sp.y = minY;
            }
          }
        p.setXYZ(j * (cols + 1) + i, _sp.x, _sp.y, _sp.z);
      }
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Hide head/hair (first-person view) or show them. */
  setFirstPerson(on: boolean, arms = on): void {
    arms &&= on;
    if (on === this.fppOn && arms === this.fppArms) return;
    this.fppOn = on;
    this.fppArms = arms;
    // Only drop the main-view layer: head, hair, ponytail and decals keep casting their shadow.
    const set = (o: THREE.Object3D) =>
      o.traverse((c) => {
        c.layers.enable(LAYER_SHADOW);
        if (on) c.layers.disable(0);
        else c.layers.enable(0);
      });
    set(this.torso);
    for (const l of [...this.thigh, ...this.shin, ...this.socks, ...this.shortLegs]) set(l.mesh);
    for (const m of [...this.knees, ...this.feet]) set(m);
    // Her own arms stay whole in first person: puff sleeves + cuffs, upper arms and elbows run
    // out of frame at the lower corners toward the shoulders (no cut ends on screen).
    // Mid-blend (camera swinging over her head) they'd float without the torso, so hide them too.
    for (const l of this.upperArm) set(l.mesh);
    for (const m of this.elbows) set(m);
    if (arms) for (const m of [...this.fppKeep, ...this.elbows, ...this.upperArm.map((l) => l.mesh)]) m.traverse((c) => c.layers.enable(0));
  }
  private fppOn = false;
  private fppArms = false;
  private fppKeep: THREE.Object3D[] = [];
  private sleeves: THREE.Group[] = [];

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
    this.bike.update(dt, s);
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
    }
    this.standK = stand;
    this.springPony(P, dt);
    this.applyPose(P);
    this.ponyOffBack();
    this.seatCover.visible = fb === 0 && !this.fppArms;
    for (const l of this.lenses) l.layers.mask = this.fppOn ? 0 : 1;
    this.drapeSkirt(f && fb > 0 ? f.speed : s.speed, s.time, stand, gait);
    // Shorts: hips just under the waistband, legs over the top of each thigh.
    this.pelvis.position.copy(P.torsoP).add(_v1.set(0, -0.07, 0.005));
    for (let i = 0; i < 2; i++) this.shortLegs[i].set(this.thighA[i].clone().add(_v1.set(0, 0.02, 0)), _v2.copy(this.thighA[i]).lerp(this.thighB[i], 0.16));
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
    // Bouquet: a light spring nodding back with speed, swinging with steering and bumps.
    {
      const b = this.bq, sp = Math.abs(s.speed);
      const tx = -0.05 - Math.min(sp, 8) * 0.018 + Math.sin(s.time * 2.1) * 0.03 * Math.min(1, sp / 3);
      const tz = -s.steer * 0.25 + Math.sin(s.time * 3.3 + 1) * 0.025 * Math.min(1, sp / 3);
      const h = Math.min(dt, 1 / 30);
      b.vx += ((tx - b.x) * 90 - b.vx * 7) * h;
      b.vz += ((tz - b.z) * 90 - b.vz * 7) * h;
      b.x += b.vx * h;
      b.z += b.vz * h;
      this.bouquet.rotation.set(b.x, 0, b.z);
    }
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
      P.ankle[i].set(side * (0.1 - 0.015 * run), 0.07 + y, z);
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
      // Relaxed: hands a little away from the hips, elbows softly bent, a slow idle sway.
      const idle = (1 - mv) * (1 - run);
      const walkW = _v1.set(
        side * (0.105 + 0.01 * Math.sin(t * 0.9 + i * 1.7) * idle),
        -0.47 + Math.max(0, -armZ) * 0.25 + 0.006 * Math.sin(t * 1.3 + i) * idle,
        0.025 + armZ + 0.008 * Math.sin(t * 0.7 + i * 2.3) * idle,
      );
      const runW = _v2.set(side * 0.01, -0.3, -0.08 + armZ * 1.3);
      P.wrist[i].copy(walkW).lerp(runW, run).add(shoulder);
      P.elbowPole[i].set(side * (0.3 + 0.2 * run), -0.2 * run, 1).normalize();
      P.armL[i][0] = 0.27;
      P.armL[i][1] = 0.255;
    }
  }

  /** Spring-damped follow of the posed ponytail angles: later segments lag and overshoot more. */
  private springPony(P: Pose, dt: number): void {
    const h = Math.min(Math.max(dt, 0), 0.05);
    if (!this.ponyS) this.ponyS = P.ponyX.map((x, i) => ({ x, vx: 0, z: P.ponyZ[i], vz: 0 }));
    if (h === 0) return;
    for (let i = 0; i < P.ponyX.length; i++) {
      const st = this.ponyS[i];
      const j = i < 7 ? i : i - 4;
      const k = 140 / (1 + 0.45 * j), c = 2 * Math.sqrt(k) * 0.42;
      for (let n = 0; n < 2; n++) {
        const hh = h / 2;
        st.vx += (k * (P.ponyX[i] - st.x) - c * st.vx) * hh;
        st.x += st.vx * hh;
        st.vz += (k * (P.ponyZ[i] - st.z) - c * st.vz) * hh;
        st.z += st.vz * hh;
      }
      P.ponyX[i] = st.x;
      P.ponyZ[i] = st.z;
    }
  }

  /** Keep every ponytail segment tip a little off her back (swing it out if it would sink in). */
  private ponyOffBack(): void {
    if (!this.pony.length) return;
    this.torso.updateWorldMatrix(true, true);
    const tip = _v1, loc = _v2;
    const clear = (i: number) => {
      tip.set(0, -this.ponyLen[i], 0).applyMatrix4(this.pony[i].matrixWorld);
      loc.copy(tip);
      this.torso.worldToLocal(loc);
      if (loc.y < -0.05 || loc.y > 0.56 || Math.abs(loc.x) > 0.16) return 1;
      return loc.z - (torsoMag(loc.x, Math.min(Math.max(loc.y, 0.04), 0.5)) + 0.04);
    };
    for (let i = 1; i < this.pony.length; i++) {
      const seg = this.pony[i];
      let c0 = clear(i);
      if (c0 >= 0) continue;
      seg.rotation.x += 0.07;
      seg.updateMatrixWorld(true);
      let dir = 1;
      if (clear(i) < c0) {
        dir = -1;
        seg.rotation.x -= 0.14;
        seg.updateMatrixWorld(true);
      }
      c0 = clear(i);
      for (let it = 0; it < 10 && c0 < 0; it++) {
        seg.rotation.x += dir * 0.07;
        seg.updateMatrixWorld(true);
        c0 = clear(i);
      }
    }
  }

  private applyPose(P: Pose): void {
    this.torso.position.copy(P.torsoP);
    this.torso.quaternion.copy(P.torsoQ);
    this.head.rotation.set(P.head.x, P.head.y, P.head.z);
    for (let i = 0; i < this.pony.length; i++) {
      this.pony[i].rotation.x = P.ponyX[i] + PONY_REST_X[i];
      this.pony[i].rotation.z = P.ponyZ[i] + PONY_REST_Z[i];
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
      (this.shinA[i] ??= new THREE.Vector3()).copy(mid);
      (this.shinB[i] ??= new THREE.Vector3()).copy(ankle);
      this.socks[i].set(ankle, _v2.copy(ankle).lerp(mid, 0.17));
      this.knees[i].position.copy(mid);
      this.feet[i].position.copy(ankle).add(_v1.set(0, -0.03, 0));
      this.feet[i].quaternion.copy(P.footQ[i]);

      const shoulder = SHOULDER(side).applyQuaternion(P.torsoQ).add(P.torsoP);
      const wrist = P.wrist[i];
      ik(shoulder, wrist, P.armL[i][0], P.armL[i][1], P.elbowPole[i], mid);
      this.upperArm[i].set(shoulder, mid);
      this.sleeves[i].position.copy(shoulder);
      this.sleeves[i].quaternion.copy(this.upperArm[i].mesh.quaternion);
      this.foreArm[i].set(mid, wrist);
      this.elbows[i].position.copy(mid);
      const hand = this.walkHands[i];
      if (hand.visible) {
        hand.position.copy(wrist);
        hand.quaternion.setFromUnitVectors(_v1.set(0, -1, 0), _v2.subVectors(wrist, mid).normalize());
      }
    }
  }
}

const SKIRT_N = 20;
/** Skirt rings: waist (on the torso), hips (on the torso), then the hanging drape. */
const SKIRT_R = 9;
const SKIRT_WAIST_Y = 0.118, SKIRT_HIP_Y = -0.005;
const _sp = new THREE.Vector3(), _sr = new THREE.Vector3(), _sq = new THREE.Vector3();
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _d3 = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

