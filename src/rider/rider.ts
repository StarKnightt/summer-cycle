import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { ID, M, beam, box, cyl, prep, sphere, xf } from "../world/geo";
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

const FRAME = "#c7353a";
const CHROME = "#a3a8ae";
const TYRE = "#26221f";
const SKIN = "#f5d3b8";
const HAIR = "#2b1e1b";
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
const HEAD_SCALE = 1.28;
/** Unit direction from head centre: az 0 = front (-Z), +az toward +X; el up. */
const dirOf = (az: number, el: number) => V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
const CHIN = V(0, -0.72, -0.69).normalize();
const CHEEK_L = V(0.55, -0.3, -0.78).normalize();
const CHEEK_R = V(-0.55, -0.3, -0.78).normalize();

/** Radial face surface: ellipsoid with a flatter front, narrowing jaw, soft pointed chin, round cheeks. */
function faceR(d: THREE.Vector3): number {
  const cz = d.z < 0 ? 0.85 : 1.0;
  const cy = d.y < 0 ? 0.92 : 1.01;
  let r = HEAD_R / Math.sqrt((d.x / 0.95) ** 2 + (d.y / cy) ** 2 + (d.z / cz) ** 2);
  const lower = smooth(-0.05, -0.8, d.y);
  r *= 1 - 0.155 * lower * Math.abs(d.x);
  r *= 1 - 0.16 * smooth(-0.2, -0.9, d.y) * Math.max(0, d.z);
  r *= 1 + 0.09 * Math.exp(-(1 - d.dot(CHIN)) / 0.035);
  r *= 1 + 0.035 * (Math.exp(-(1 - d.dot(CHEEK_L)) / 0.05) + Math.exp(-(1 - d.dot(CHEEK_R)) / 0.05));
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
}

export class Rider {
  readonly root = new THREE.Group();
  readonly lean = new THREE.Group();
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
    // Blob shadow under the bike.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.9).rotateX(-Math.PI / 2),
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
    this.root.add(shadow);
  }

  private add(g: THREE.BufferGeometry, parent: THREE.Object3D = this.lean, id: number = ID.bike): THREE.Mesh {
    const m = mk(g, id);
    parent.add(m);
    return m;
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
    // Kickstand folded.
    this.add(beam(V(0.06, 0.3, 0.5), V(0.06, 0.18, 0.72), 0.01, CHROME, M.metal, 4));
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
      for (const g of parts) this.add(g.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer, ID.skin);
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
  private onHead(g: THREE.BufferGeometry, az: number, el: number, lift: number, id: number, parent: THREE.Object3D = this.head): THREE.Mesh {
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
    return this.add(g, parent, id);
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
    this.skirt = new THREE.Mesh(g, uber(rid, 1, THREE.DoubleSide));
    this.skirt.frustumCulled = false;
    b.add(this.skirt);
    this.drapeSkirt(0, 0);
    const seat = sphere(0.15, NAVY, M.cloth, 16, 10);
    seat.scale(1.05, 0.55, 1.0);
    seat.translate(hip.x, hip.y - 0.06, hip.z + 0.03);
    this.seatCover = this.add(seat, b, rid);

    // Torso (leans forward from the hips).
    this.torso.position.copy(hip);
    this.torso.rotation.x = -0.28;
    b.add(this.torso);
    const chest = prep(new THREE.CylinderGeometry(0.135, 0.11, 0.44, 14, 4), BLOUSE, M.cloth);
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
    this.add(xf(box(0.25, 0.05, 0.17, NAVY, M.cloth), 0, 0.03, 0), this.torso, rid);
    // Square sailor collar lying on the back with two white stripes (reads from the chase cam).
    const WHITE = "#f4f2ec", RED = "#c8363a";
    const tp = this.torso;
    this.add(torsoPatch(-0.116, 0.116, 0.27, 0.48, 1, 0.006, NAVY, 10, 6), tp, rid);
    // One white stripe inset along the collar's three edges (a single connected U, corners overlap).
    const sy = 0.29, sx = 0.098, sw = 0.012;
    this.add(torsoPatch(-sx, sx, sy, sy + sw, 1, 0.009, WHITE, 10, 1), tp, rid);
    for (const s of [-1, 1]) this.add(torsoPatch(Math.min(s * sx, s * (sx - sw)), Math.max(s * sx, s * (sx - sw)), sy, 0.478, 1, 0.009, WHITE, 1, 6), tp, rid);
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
    this.add(xf(cyl(0.04, 0.047, 0.2, SKIN, M.skin, 10), 0, 0.56, 0), tp, ID.skin);
    this.head.position.set(0, 0.725, -0.012);
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

  /** Ghibli-simple face: big dark eyes with a lash line, small nose wedge, short smile, soft blush. */
  private buildFace(): void {
    const EYE_AZ = 0.34, EYE_EL = -0.05;
    for (const s of [-1, 1]) {
      const az = s * EYE_AZ;
      this.onHead(this.disc(0.022, 0.024, "#fbf8f2"), az, EYE_EL - 0.01, 0.001, ID.skin);
      this.onHead(this.disc(0.0165, 0.0235, "#4a2a1c"), az - s * 0.012, EYE_EL - 0.015, 0.003, ID.eye);
      this.onHead(this.disc(0.0085, 0.0125, "#140a07"), az - s * 0.012, EYE_EL - 0.01, 0.004, ID.eye);
      this.onHead(this.disc(0.0055, 0.0065, "#ffffff"), az - 0.035, EYE_EL + 0.04, 0.006, ID.eye);
      // Arched upper lid line with a small outer tick.
      const lash = prep(new THREE.TorusGeometry(0.028, 0.0034, 3, 10, 1.6), "#1a100c", M.plain);
      lash.rotateZ(Math.PI / 2 - 0.8);
      lash.translate(0, -0.028, 0);
      lash.scale(1.15, 1, 0.6);
      this.onHead(lash, az, EYE_EL + 0.195, 0.004, ID.eye);
      const flick = box(0.012, 0.006, 0.003, "#1a100c");
      flick.rotateZ(s * 0.5);
      this.onHead(flick, az + s * 0.215, EYE_EL + 0.12, 0.004, ID.eye);
      const lower = box(0.012, 0.003, 0.003, "#6a3a2a");
      lower.rotateZ(s * 0.25);
      this.onHead(lower, az + s * 0.09, EYE_EL - 0.2, 0.002, ID.skin);
      const brow = box(0.026, 0.0036, 0.003, "#4a2e20");
      brow.rotateZ(s * 0.08);
      this.onHead(brow, az * 1.04, 0.33, 0.004, ID.eye);
      this.onHead(this.disc(0.018, 0.008, "#f2a6a0", M.skin), s * 0.63, -0.3, 0.001, ID.skin);
    }
    // Nose: a tiny flat-shaded wedge (catches one lit and one shaded facet, and a profile bump).
    const nose = new THREE.BufferGeometry();
    const top = [0, 0.026, 0], l = [-0.011, -0.008, 0], r = [0.011, -0.008, 0], tip = [0, -0.006, 0.034];
    nose.setAttribute("position", new THREE.Float32BufferAttribute([...top, ...l, ...tip, ...top, ...tip, ...r, ...l, ...r, ...tip], 3));
    this.onHead(prep(nose, SKIN, M.skin), 0, -0.27, -0.002, ID.skin);
    // Short soft smile.
    const mouth = prep(new THREE.TorusGeometry(0.019, 0.0034, 3, 8, 1.1), "#7a3230", M.plain);
    mouth.rotateZ(-Math.PI / 2 - 0.55);
    mouth.translate(0, 0.015, 0);
    mouth.scale(1, 1, 0.5);
    this.onHead(mouth, 0, -0.45, 0.001, ID.skin);
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

    // Bangs: blunt separated clumps down to the brows.
    const tips = [0.5, 0.45, 0.41, 0.39, 0.42, 0.46, 0.52];
    tips.forEach((el1, k) => {
      const az = (k - 3) * 0.24;
      this.add(hairClump(az, 1.12, az * 1.08, el1, 0.021, 0.28, 0.009), this.head, ID.hair);
    });
    for (const s of [-1, 1]) {
      // Face-framing side bangs, cheek locks over the face edge, and a fuller clump behind the ear.
      this.add(hairClump(s * 1.0, 1.0, s * 1.12, 0.22, 0.018, 0.22, 0.009), this.head, ID.hair);
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
  }

  /** Recompute skirt vertices: pleated A-line that lies on the thighs in front, hangs behind. */
  private drapeSkirt(speed: number, time: number): void {
    const g = this.skirtGeo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const cols = SKIRT_N * 2;
    const rings = 4;
    const W = this.skirtWaist;
    const sp = Math.min(speed / 8, 1.3);
    const fwd = V(0, -0.4, -1).normalize();
    const back = V(0, -1, 0.3).normalize();
    const d = new THREE.Vector3();
    for (let j = 0; j < rings; j++) {
      const t = j / (rings - 1);
      for (let i = 0; i <= cols; i++) {
        const a = (i / cols) * Math.PI * 2;
        const rx = Math.sin(a), rz = Math.cos(a);
        const f = (1 - rz) / 2; // 0 back, 1 front
        d.copy(back).lerp(fwd, f).normalize();
        const pleat = i % 2 ? 0.84 : 1.0;
        const rWaist = 0.15;
        const flare = 0.13 * pleat;
        const rad = rWaist * (1 - t) + (rWaist + flare) * t;
        const len = 0.31 * (f > 0.6 ? 0.9 : 1.0);
        const flut = Math.sin(time * 9 + a * 3 + j) * 0.012 * sp * t * t;
        const drift = 0.05 * sp * t * t * (1 - f);
        const k = j * (cols + 1) + i;
        _sp.set(
          W.x + rx * rad * 1.12 + rx * flut,
          W.y + d.y * len * t + flut * 0.6,
          W.z + rz * rad * 0.9 + d.z * len * t + drift,
        );
        // Keep the cloth outside both thighs (the knee rises through the hem at the top of the stroke).
        // Front half only lifts (never tucks under the leg); the lift fades toward the sides.
        if (j > 0 && f > 0.3)
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
    for (const l of [...this.upperArm, ...this.thigh, ...this.shin]) set(l.mesh);
    for (const m of [...this.elbows, ...this.knees, ...this.feet]) set(m);
  }
  private fppOn = false;

  /** Hide the skirt from the main view only (keeps its shadow) while the camera swoops in. */
  setSkirtHidden(on: boolean): void {
    for (const m of [this.skirt, this.seatCover]) {
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

  update(dt: number, s: RiderState): void {
    this.lean.rotation.z = s.lean;
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level

    const bob = Math.sin(s.crank * 2) * 0.008 * s.pedaling;
    this.torso.position.y = SEAT.y + 0.1 + bob;
    this.torso.rotation.z = Math.sin(s.crank) * 0.025 * s.pedaling;
    this.torso.rotation.x = -0.28 - Math.min(s.speed / 12, 1) * 0.08;
    this.head.rotation.y = Math.sin(s.time * 0.37) * 0.12 + Math.sin(s.time * 0.13) * 0.1;
    this.head.rotation.x = 0.14 + Math.sin(s.time * 0.21) * 0.04;
    this.head.rotation.z = -s.lean * 0.5;
    const sp = Math.min(s.speed / 8, 1.2);
    // Low ponytail: hangs from the nape (undoing the head nod so it stays off her back), wind
    // lifts it slightly with speed, and a travelling wave sways it.
    for (let i = 0; i < this.pony.length; i++) {
      const p = this.pony[i];
      const wave = Math.sin(s.time * 3.6 - i * 0.9) * 0.07 * (0.4 + sp);
      p.rotation.x = (i === 0 ? -this.head.rotation.x - 0.22 - sp * 0.22 : -0.05 - sp * 0.08) + wave;
      p.rotation.z = Math.sin(s.time * 2.4 - i * 1.1) * 0.09 * (0.4 + sp) + (i === 0 ? s.steer * 0.3 + s.lean * 0.35 : 0);
    }
    this.root.updateMatrixWorld(true);
    const bodyInv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const toBody = (o: THREE.Object3D, v: THREE.Vector3) => v.applyMatrix4(o.matrixWorld).applyMatrix4(bodyInv);

    // Hip joints sit just under the skirt's waist ring so the open thigh tube never shows above it.
    const hipBase = V(0, SEAT.y + 0.035, SEAT.z - 0.03);
    const mid = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const a = s.crank + (i === 0 ? 0 : Math.PI);
      const pedal = V(side * 0.14, BB.y - Math.cos(a) * CRANK, BB.z + Math.sin(a) * CRANK);
      const ankle = pedal.clone().add(V(0, 0.06, 0.03));
      const hip = hipBase.clone().add(V(side * 0.085, 0, 0));
      ik(hip, ankle, 0.43, 0.42, V(side * 0.12, 0.4, -1).normalize(), mid);
      this.thigh[i].set(hip, mid);
      (this.thighA[i] ??= new THREE.Vector3()).copy(hip);
      (this.thighB[i] ??= new THREE.Vector3()).copy(mid);
      this.shin[i].set(mid, ankle);
      this.knees[i].position.copy(mid);
      this.feet[i].position.copy(ankle).add(V(0, -0.03, 0));
      this.feet[i].rotation.x = -0.15 + Math.sin(a) * 0.25;

      const shoulder = toBody(this.torso, V(side * 0.165, 0.41, -0.01));
      const wrist = toBody(this.steer, this.wrists[i].clone());
      // Segment lengths follow the reach so the elbow always keeps a relaxed ~18° bend.
      const reach = shoulder.distanceTo(wrist) / (2 * Math.cos((9 * Math.PI) / 180));
      ik(shoulder, wrist, reach * 1.04, reach * 0.96, V(side * 0.45, -0.8, 0.45).normalize(), mid);
      this.upperArm[i].set(shoulder, mid);
      // First person: the elbow is hidden, so run the forearm on past the near plane (no cut end).
      if (this.fppOn) this.foreArm[i].set(mid.clone().lerp(wrist, -1.2), wrist);
      else this.foreArm[i].set(mid, wrist);
      this.elbows[i].position.copy(mid);
    }
    this.drapeSkirt(s.speed, s.time);
    void dt;
  }
}

const SKIRT_N = 14;
const _sp = new THREE.Vector3(), _sr = new THREE.Vector3();

export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };
