import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { roadX } from "./road";

/** Surface pattern ids understood by the uber toon shader. */
export const M = {
  plain: 0, foliage: 1, planks: 2, roof: 3, shoji: 4, glow: 5, grass: 6, skin: 7, cloth: 8,
  bark: 9, metal: 10, ground: 11, butterfly: 12, stone: 13, lantern: 14, hair: 15, guard: 16,
} as const;

/** Outline groups: lines are drawn where neighbouring pixels belong to different groups. */
export const ID = {
  sky: 0, ground: 1, water: 2, berm: 3, grass: 4, rice: 5, tree: 6, house: 7, pole: 8, wire: 9,
  fence: 10, sign: 11, bike: 12, rider: 13, hair: 14, hills: 15, flower: 16, butterfly: 17, skin: 18,
} as const;

type Geo = THREE.BufferGeometry;
const _c = new THREE.Color();

/**
 * Normalise a geometry to the uber attribute layout: indexed, position/normal/uv/color/aMat/aWind.
 * Pass color = null to keep an existing vertex-colour attribute.
 */
export function prep(g: Geo, color: THREE.ColorRepresentation | null, mat = 0, wind = 0): Geo {
  const n = g.attributes.position.count;
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const k of Object.keys(g.attributes)) {
    if (k === "position" || k === "normal" || k === "uv") continue;
    if (k === "color" && color === null) continue;
    g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (color !== null) {
    _c.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  g.setAttribute("aMat", new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  g.setAttribute("aWind", new THREE.BufferAttribute(new Float32Array(n).fill(wind), 1));
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}

/** Wind weight grows with local height (call before transforming). */
export function windByHeight(g: Geo, h0: number, h1: number, amount: number, pow = 2): Geo {
  const p = g.attributes.position;
  const w = g.attributes.aWind as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - h0) / (h1 - h0)));
    w.setX(i, Math.pow(t, pow) * amount);
  }
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function xf(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Geo {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, mat = 0): Geo {
  return prep(new THREE.BoxGeometry(w, h, d), color, mat);
}

/** Box whose uvs are in metres on every face (for tile / shoji patterns). */
export function boxM(w: number, h: number, d: number, color: THREE.ColorRepresentation, mat = 0): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const su = nx > 0.5 ? d : w;
    const sv = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return prep(g, color, mat);
}

export function cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, mat = 0, seg = 8): Geo {
  return prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1), color, mat);
}

export function sphere(r: number, color: THREE.ColorRepresentation, mat = 0, ws = 12, hs = 8): Geo {
  return prep(new THREE.SphereGeometry(r, ws, hs), color, mat);
}

const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

/** Cylinder from a to b. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.ColorRepresentation, mat = 0, seg = 6, r2 = r): Geo {
  _d.subVectors(b, a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(a, _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return prep(g, color, mat);
}

/** Sagging wire (parabolic catenary approximation) as a chain of thin cylinders. */
export function wire(a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number, color: THREE.ColorRepresentation, segs = 12): Geo[] {
  const out: Geo[] = [];
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    p0.lerpVectors(a, b, t0).y -= sag * 4 * t0 * (1 - t0);
    p1.lerpVectors(a, b, t1).y -= sag * 4 * t1 * (1 - t1);
    out.push(beam(p0.clone(), p1.clone(), r, color, M.metal, 4));
  }
  return out;
}

export function merge(list: Geo[]): Geo {
  const g = mergeGeometries(list, false);
  if (!g) throw new Error("mergeGeometries failed (attribute mismatch)");
  for (const x of list) x.dispose();
  return g;
}

/** Map road-aligned coordinates (x = u) to world: x += roadX(z). Recomputes normals. */
export function shear(g: Geo): Geo {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + roadX(p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** Lumpy blob for foliage / clouds: displaced icosphere with smooth normals. */
export function blob(r: number, detail: number, amp: number, seed: number): Geo {
  let g: Geo = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 1.7 / r + seed) * Math.sin(v.y * 2.3 / r + seed * 1.3) * Math.sin(v.z * 1.9 / r + seed * 0.7);
    const n2 = Math.sin(v.x * 4.1 / r + seed * 2.1) * Math.sin(v.z * 3.7 / r - seed);
    v.multiplyScalar(1 + amp * (n * 0.7 + n2 * 0.3));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Blend normals toward the direction from `c`: big-shape lighting for foliage/cloud clusters. */
export function spherize(g: Geo, c: THREE.Vector3, k: number, squashY = 1): Geo {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i).sub(c);
    a.y *= squashY;
    a.normalize();
    b.fromBufferAttribute(n, i).lerp(a, k).normalize();
    n.setXYZ(i, b.x, b.y, b.z);
  }
  return g;
}

export function tint(g: Geo, color: THREE.ColorRepresentation): Geo {
  _c.set(color);
  const c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, _c.r, _c.g, _c.b);
  return g;
}

export function setMat(g: Geo, mat: number): Geo {
  (g.attributes.aMat as THREE.BufferAttribute).array.fill(mat);
  return g;
}
