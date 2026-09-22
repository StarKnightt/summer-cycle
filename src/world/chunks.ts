import * as THREE from "three";
import { CHUNK, L, NCHUNK, RIBBON_HALF, faceRoadFromRight, groundH, pnoise, roadX, roadYaw, smooth } from "./road";
import { ID, M, box, merge, prep, shear, wire, xf } from "./geo";
import { fence, house, pole, postBox, stoneMarker, tree, warningSign, type TreeKind } from "./props";
import { boulder, butterfly, flower, flowerSpike, grassClump, riceTuft, shortGrass } from "./vegetation";
import { roadMaterial, uber, waterMaterial } from "../render/materials";
import { mulberry32, pick, range, type Rng } from "../core/rng";

type Geo = THREE.BufferGeometry;

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface Chunk {
  k: number;
  group: THREE.Group;
  colliders: Collider[];
}

// ------------------------------------------------------------------ layout constants

const ROW_P = 14.6; // paddy pitch across (u)
const COL_P = 20; // paddy pitch along (z)
const NROWS = 6;
const BERM0 = -4.9;
const POLE_SPACING = 40;
const POLE_U = 3.95;

interface HouseSpot {
  z: number;
  w: number;
  d: number;
  floors: 1 | 2;
  shop?: boolean;
  u: number;
  ac?: boolean;
  balcony?: boolean;
  seed: number;
}

/** Village clusters (periodic z). The first sits right ahead of the spawn point. */
const HOUSES: HouseSpot[] = [
  { z: -46, w: 7.2, d: 6.4, floors: 2, u: 8.2, ac: true, seed: 11 },
  { z: -60, w: 6.6, d: 6.0, floors: 2, shop: true, u: 7.4, ac: true, balcony: false, seed: 23 },
  { z: -74.5, w: 7.6, d: 6.8, floors: 2, u: 8.6, seed: 37 },
  { z: -91, w: 6.8, d: 6.2, floors: 1, u: 8.0, ac: true, seed: 41 },
  { z: -228, w: 8.2, d: 7.0, floors: 2, u: 9.5, ac: true, seed: 53 },
  { z: -244, w: 6.0, d: 5.4, floors: 1, u: 8.4, seed: 67 },
  { z: -505, w: 7.4, d: 6.6, floors: 2, u: 9.0, seed: 79, ac: true },
];

const SIGNS = [
  { z: -28, kind: 2 },
  { z: -150, kind: 0 },
  { z: -262, kind: 1 },
  { z: -420, kind: 0 },
  { z: -560, kind: 2 },
];

const FENCES_LEFT: [number, number][] = [
  [-6, -118],
  [-176, -252],
  [-398, -470],
  [-590, -628],
];

const GUARDRAIL_RIGHT: [number, number][] = [
  [-160, -198],
  [-452, -486],
];

const inVillage = (z: number) => HOUSES.some((h) => Math.abs(z - h.z) < h.w / 2 + 2.5);
/** Keep sightlines to the houses open: no big roadside trees just before a cluster. */
const nearVillage = (z: number) => HOUSES.some((h) => z - h.z < 40 && z - h.z > -h.w);
const nearShopFront = (z: number) => Math.abs(z - -60) < 3.4;
const villageLot = (u: number, z: number) => {
  for (const h of HOUSES) if (Math.abs(z - h.z) < h.w / 2 + 1.2 && u > 3.6 && u < h.u + 0.6) return true;
  return false;
};
const inHouse = (u: number, z: number, pad = 0.8) => {
  for (const h of HOUSES) if (Math.abs(z - h.z) < h.w / 2 + pad + 1.2 && u > h.u - pad - 1.0 && u < h.u + h.d + pad) return true;
  return false;
};

function paddyLevel(r: number, c: number): number {
  return -0.42 + r * 0.19 + 0.09 * Math.sin(c * 1.7 + r * 2.3);
}

// ------------------------------------------------------------------ shared prototypes

let protos: {
  trees: Record<TreeKind, Geo[]>;
  grass: Geo[];
  short: Geo;
  rice: Geo;
  flower: Geo;
  fly: Geo;
  spike: Geo;
  rocks: Geo[];
} | null = null;

function getProtos() {
  if (!protos) {
    protos = {
      trees: {
        round: [tree("round", 1), tree("round", 2), tree("round", 3)],
        tall: [tree("tall", 4), tree("tall", 5)],
        bush: [tree("bush", 6), tree("bush", 7)],
        cedar: [tree("cedar", 8), tree("cedar", 9)],
      },
      grass: [grassClump(1), grassClump(2), grassClump(3)],
      short: shortGrass(4),
      rice: riceTuft(5),
      flower: flower(),
      fly: butterfly(),
      spike: flowerSpike(9),
      rocks: [boulder(1), boulder(2.7)],
    };
  }
  return protos;
}

// ------------------------------------------------------------------ helpers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

interface Inst {
  m: THREE.Matrix4[];
  c: THREE.Color[];
}
const newInst = (): Inst => ({ m: [], c: [] });

function pushInst(list: Inst, x: number, y: number, z: number, ry: number, s: number, sy = s, color?: THREE.Color, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  list.m.push(new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(s, sy, s)));
  list.c.push(color ?? new THREE.Color(1, 1, 1));
}

function instMesh(geo: Geo, mat: THREE.Material, list: Inst): THREE.InstancedMesh | null {
  if (!list.m.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.m.length);
  for (let i = 0; i < list.m.length; i++) {
    im.setMatrixAt(i, list.m[i]);
    im.setColorAt(i, list.c[i]);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.computeBoundingBox();
  return im;
}

function mesh(geo: Geo, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** Place local geometry at road-relative (u, z) with yaw, returning a world-space copy. */
function placeAt(g: Geo, u: number, z: number, ry: number, y = 0): Geo {
  _e.set(0, ry, 0, "YXZ");
  _q.setFromEuler(_e);
  _m.compose(_p.set(roadX(z) + u, y, z), _q, _s.set(1, 1, 1));
  return g.applyMatrix4(_m);
}

const col = (hex: string) => new THREE.Color(hex);
const hsl = (base: THREE.Color, r: Rng, dh: number, ds: number, dl: number) => {
  const c = base.clone();
  c.offsetHSL(range(r, -dh, dh), range(r, -ds, ds), range(r, -dl, dl));
  return c;
};

// ------------------------------------------------------------------ ground + road

const U_SAMPLES = [-5.4, -4.6, -4.0, -3.4, -2.6, 0, 2.6, 3.4, 4.2, 5.2, 6.4, 8, 10, 12.5, 15.5, 19, 23, 28, 34, 41, 49, 58, 68, 80, 94, 110, 130, 155, 185, 220, 260];

function groundColor(u: number, z: number, out: THREE.Color): THREE.Color {
  const n = pnoise(u, z, 3);
  if (u < -3.2) return out.set("#5f9a3a").offsetHSL(0, 0, (n - 0.5) * 0.06);
  if (u < 3.3) return out.set("#6a9e3c");
  out.set("#6fa843");
  const warm = pnoise(u * 0.5, z, 7);
  out.lerp(col("#9fb54e"), smooth(0.62, 0.85, warm) * 0.55);
  out.lerp(col("#4f8a38"), smooth(40, 90, u));
  out.lerp(col("#3b7236"), smooth(110, 200, u) * 0.8);
  if (villageLot(u, z)) out.lerp(col("#a88f62"), 0.85);
  return out;
}

function buildGround(z0: number, z1: number): Geo {
  const nz = Math.round((z0 - z1) / 2) + 1;
  const nu = U_SAMPLES.length;
  const pos = new Float32Array(nz * nu * 3);
  const cols = new Float32Array(nz * nu * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    const z = z0 - (j / (nz - 1)) * (z0 - z1);
    for (let i = 0; i < nu; i++) {
      const u = U_SAMPLES[i];
      const k = (j * nu + i) * 3;
      pos[k] = roadX(z) + u;
      pos[k + 1] = groundH(u, z);
      pos[k + 2] = z;
      groundColor(u, z, c);
      cols[k] = c.r;
      cols[k + 1] = c.g;
      cols[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, cc = a + nu, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, null, M.ground);
}

function buildRoad(z0: number, z1: number): Geo {
  const us = [-RIBBON_HALF, -3.0, -2.4, -1.2, 0, 1.2, 2.4, 3.0, RIBBON_HALF];
  const nz = Math.round(z0 - z1) + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 - j;
    for (const u of us) {
      pos.push(roadX(z) + u, 0.02, z);
      uv.push(u, -z);
    }
  }
  const idx: number[] = [];
  const nu = us.length;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ paddies

function waterPlane(u0: number, u1: number, za: number, zb: number, y: number, growth: number): Geo {
  const segs = Math.max(1, Math.round(Math.abs(za - zb) / 2.5));
  const g = new THREE.PlaneGeometry(Math.abs(u1 - u0), Math.abs(za - zb), 1, segs);
  g.rotateX(-Math.PI / 2);
  g.translate((u0 + u1) / 2, y, (za + zb) / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  shear(g);
  g.deleteAttribute("normal");
  g.setAttribute("aP", new THREE.BufferAttribute(new Float32Array(p.count).fill(growth), 1));
  return g;
}

function bermAlongZ(u: number, za: number, zb: number, top: number, w = 0.75): Geo {
  const len = Math.abs(za - zb);
  const g = prep(new THREE.BoxGeometry(w, top + 0.9, len, 1, 1, Math.max(1, Math.round(len / 2.5))), "#7d9448", M.ground);
  g.translate(u, (top - 0.9) / 2, (za + zb) / 2);
  return shear(g);
}

function bermAlongU(z: number, ua: number, ub: number, top: number): Geo {
  const g = prep(new THREE.BoxGeometry(Math.abs(ua - ub), top + 0.9, 0.6, 3, 1, 1), "#7a9146", M.ground);
  g.translate((ua + ub) / 2, (top - 0.9) / 2, z);
  return shear(g);
}

// ------------------------------------------------------------------ chunk

export function buildChunk(k: number): Chunk {
  const P = getProtos();
  const r = mulberry32(1000 + k * 7919);
  const z0 = -k * CHUNK;
  const z1 = -(k + 1) * CHUNK;
  const inRange = (z: number) => z <= z0 && z > z1;
  const group = new THREE.Group();
  group.name = `chunk${k}`;
  const colliders: Collider[] = [];

  const houseG: Geo[] = [];
  const infraG: Geo[] = [];
  const wireG: Geo[] = [];
  const fenceG: Geo[] = [];
  const bermG: Geo[] = [];
  const waterG: Geo[] = [];

  group.add(mesh(buildGround(z0, z1), uber(ID.ground, 0.45)));
  group.add(mesh(buildRoad(z0, z1), roadMaterial()));

  // ---- paddies (left)
  const rice = newInst();
  const bermGrass = newInst();
  const c0 = Math.round(-z0 / COL_P);
  const c1 = Math.round(-z1 / COL_P);
  for (let c = c0; c < c1; c++) {
    const za = -c * COL_P, zb = -(c + 1) * COL_P;
    for (let rr = 0; rr < NROWS; rr++) {
      const uIn = BERM0 - rr * ROW_P;
      const uOut = uIn - ROW_P;
      const lvl = paddyLevel(rr, c);
      const growth = 0.45 + 0.55 * ((Math.sin(c * 2.1 + rr * 1.3) * 0.5 + 0.5) * 0.7 + 0.3 * r());
      waterG.push(waterPlane(uIn, uOut, za, zb, lvl, growth));
      // Berm on the road side of this row.
      const top = rr === 0 ? 0.0 : Math.max(paddyLevel(rr - 1, c), lvl) + 0.24;
      bermG.push(bermAlongZ(uIn, za + 0.3, zb - 0.3, top, rr === 0 ? 0.8 : 0.7));
      // Cross berm at the start of this column.
      const ctop = Math.max(paddyLevel(rr, c - 1), lvl) + 0.2;
      bermG.push(bermAlongU(za, uIn - 0.3, uOut + 0.3, ctop));
      // 3D rice in the nearest row.
      if (rr === 0) {
        for (let u = uIn - 0.65; u > uOut + 0.5; u -= 0.6) {
          for (let z = za - 0.55; z > zb + 0.5; z -= 0.45) {
            const s = (0.7 + growth * 0.55) * range(r, 0.85, 1.15);
            pushInst(rice, roadX(z) + u + range(r, -0.05, 0.05), lvl - 0.02, z + range(r, -0.05, 0.05), r() * 6.28, s, s * range(r, 0.9, 1.2), hsl(col("#ffffff"), r, 0.02, 0.0, 0.06));
          }
        }
      }
      if (rr <= 1) {
        for (let z = za; z > zb; z -= 0.7) {
          if (r() < 0.55) pushInst(bermGrass, roadX(z) + uIn + range(r, -0.3, 0.3), top, z, r() * 6.28, range(r, 0.6, 1.2));
        }
      }
      // Bamboo fence on some inner berms.
      if (rr === 1 && pnoise(0, za, 11) > 0.6) {
        for (const g of fence(COL_P - 2, 0.9, "#b4a068", c * 13 + rr, false)) {
          g.rotateY(Math.PI / 2);
          g.translate(uIn, top, za - 1);
          fenceG.push(shear(g));
        }
      }
    }
  }
  // Far fields beyond the terraces.
  const uFar = BERM0 - NROWS * ROW_P;
  waterG.push(waterPlane(uFar, uFar - 330, z0, z1, 0.75, 0.8));
  for (let z = z0 - 10; z > z1; z -= 40) bermG.push(bermAlongU(z, uFar, uFar - 330, 0.95));
  bermG.push(bermAlongZ(uFar, z0, z1, 0.95, 1.0));
  for (let u = uFar - 30; u > uFar - 330; u -= 36) bermG.push(bermAlongZ(u, z0, z1, 0.95, 0.8));

  // ---- houses (right)
  for (const h of HOUSES) {
    if (!inRange(h.z)) continue;
    const g = house({ w: h.w, d: h.d, floors: h.floors, shop: h.shop, seed: h.seed, ac: h.ac, balcony: h.balcony });
    houseG.push(placeAt(g, h.u + h.d / 2, h.z, faceRoadFromRight(h.z), groundH(h.u, h.z) + 0.02));
    colliders.push({ x: roadX(h.z) + h.u + h.d / 2, z: h.z, r: Math.max(h.w, h.d) * 0.55 });
  }
  if (inRange(-57)) {
    infraG.push(placeAt(postBox(), 4.3, -57.2, faceRoadFromRight(-57.2)));
    colliders.push({ x: roadX(-57.2) + 4.3, z: -57.2, r: 0.35 });
  }
  if (inRange(-205)) infraG.push(placeAt(stoneMarker(), -4.05, -205, faceRoadFromRight(-205) + Math.PI));
  if (inRange(-212)) infraG.push(placeAt(stoneMarker(), 4.0, -212, faceRoadFromRight(-212)));

  // ---- poles + wires
  const nPoles = L / POLE_SPACING;
  for (let i = 0; i < nPoles; i++) {
    const z = -12 - i * POLE_SPACING;
    if (!inRange(z)) continue;
    const h = 8.6;
    const pr = pole(h, i % 4 === 2);
    const yaw = roadYaw(z);
    const place = (v: THREE.Vector3, zz: number, u: number, ry: number) => {
      const w = v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      return w.add(new THREE.Vector3(roadX(zz) + u, 0, zz));
    };
    infraG.push(placeAt(pr.geo, POLE_U, z, yaw));
    colliders.push({ x: roadX(z) + POLE_U, z, r: 0.3 });
    const zn = z - POLE_SPACING;
    const yawN = roadYaw(zn);
    for (let t = 0; t < 5; t++) {
      const a = place(pr.tips[t], z, POLE_U, yaw);
      const b = place(pr.tips[t], zn, POLE_U, yawN);
      wireG.push(...wire(a, b, t < 3 ? 0.55 : 0.75, t < 3 ? 0.022 : 0.03, "#2a2622", 14));
    }
    // Lines crossing the road to the paddy side.
    if (i % 3 === 1) {
      const zl = z - 13;
      const lp = pole(7.6, false);
      const yl = roadYaw(zl);
      infraG.push(placeAt(lp.geo, -4.35, zl, yl));
      colliders.push({ x: roadX(zl) - 4.35, z: zl, r: 0.3 });
      for (const t of [3, 4]) {
        const a = place(pr.tips[t], z, POLE_U, yaw);
        const b = place(lp.tips[t - 3 === 0 ? 0 : 2], zl, -4.35, yl);
        wireG.push(...wire(a, b, 0.7, 0.024, "#2a2622", 14));
      }
      // And onward across the fields.
      const far = new THREE.Vector3(roadX(zl - 30) - 60, 6.5, zl - 30);
      wireG.push(...wire(place(lp.tips[1], zl, -4.35, yl), far, 1.4, 0.024, "#2a2622", 14));
    }
  }

  // ---- signs
  for (const s of SIGNS) {
    if (!inRange(s.z)) continue;
    infraG.push(placeAt(warningSign(s.kind), 3.3, s.z, roadYaw(s.z)));
    colliders.push({ x: roadX(s.z) + 3.3, z: s.z, r: 0.15 });
  }

  // ---- fences
  for (const [fa, fb] of FENCES_LEFT) {
    const a = Math.min(z0, fa), b = Math.max(z1, fb);
    if (a <= b) continue;
    for (const g of fence(a - b, 1.05, "#8a7254", Math.round(a), true)) {
      g.rotateY(Math.PI / 2);
      g.translate(-4.3, 0, a);
      fenceG.push(shear(g));
    }
  }
  for (const [fa, fb] of GUARDRAIL_RIGHT) {
    const a = Math.min(z0, fa), b = Math.max(z1, fb);
    if (a <= b) continue;
    const len = a - b;
    const n = Math.round(len / 2);
    for (let i = 0; i <= n; i++) {
      const z = a - (i / n) * len;
      infraG.push(xf(prep(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 8), "#c4c2ba", M.metal), roadX(z) + 3.25, 0.42, z));
    }
    const rail = prep(new THREE.BoxGeometry(0.06, 0.32, len, 1, 2, Math.max(1, Math.round(len / 2))), "#cbc9c0", M.metal);
    rail.translate(3.18, 0.66, a - len / 2);
    infraG.push(shear(rail));
  }

  // ---- trees
  const trees: Record<string, Inst> = {};
  const addTree = (kind: TreeKind, u: number, z: number, s: number) => {
    const variants = P.trees[kind];
    const vi = Math.floor(r() * variants.length);
    const key = `${kind}${vi}`;
    (trees[key] ??= newInst());
    pushInst(trees[key], roadX(z) + u, groundH(u, z) - 0.1, z, r() * 6.28, s, s * range(r, 0.9, 1.1), hsl(col("#ffffff"), r, 0.015, 0.05, 0.05));
    if (Math.abs(u) < 14) colliders.push({ x: roadX(z) + u, z, r: 0.5 * s });
  };
  // Village backdrop: big dark trees behind the houses (as in the reference).
  for (const h of HOUSES) {
    if (!inRange(h.z)) continue;
    addTree(pick(r, ["round", "round", "tall"] as TreeKind[]), h.u + h.d + range(r, 4, 9), h.z + range(r, -4, 4), range(r, 1.2, 1.6));
    if (r() > 0.3) addTree("bush", h.u - 0.4, h.z + h.w / 2 + 1.2, range(r, 0.7, 1.0));
  }
  for (let z = z0 - range(r, 2, 10); z > z1; z -= range(r, 9, 22)) {
    // Roadside trees on the right (skip the village lots).
    if (!inVillage(z) && !nearVillage(z)) {
      const u = range(r, 7, 12);
      if (!inHouse(u, z) && r() > 0.4) addTree(r() > 0.35 ? "round" : "tall", u, z, range(r, 0.7, 1.05));
      if (r() > 0.5) addTree("bush", range(r, 4.8, 6.2), z + range(r, -3, 3), range(r, 0.6, 1.0));
    }
    // Meadow trees.
    const um = range(r, nearVillage(z) ? 26 : 16, 44);
    if (!inHouse(um, z)) addTree(pick(r, ["round", "tall", "round", "bush"] as TreeKind[]), um, z + range(r, -5, 5), range(r, 0.9, 1.5));
  }
  // Wooded hills to the right.
  for (let i = 0; i < 70; i++) {
    const z = range(r, z1, z0);
    const u = range(r, 46, 250);
    addTree(r() > 0.45 ? "cedar" : "round", u, z, range(r, 1.1, 1.9));
  }
  // A few trees out in the fields / on far berms.
  for (let i = 0; i < 4; i++) {
    const z = range(r, z1, z0);
    const u = BERM0 - Math.floor(range(r, 2, NROWS)) * ROW_P;
    addTree(pick(r, ["round", "tall", "bush"] as TreeKind[]), u, z, range(r, 0.8, 1.3));
  }
  // Groves out in the far fields (farmstead windbreaks) so the horizon isn't a flat line.
  for (let gi = 0; gi < 2; gi++) {
    const gz = range(r, z1, z0);
    const gu = range(r, uFar - 50, uFar - 240);
    for (let i = 0; i < 9; i++) addTree(r() > 0.45 ? "round" : "cedar", gu + range(r, -14, 14), gz + range(r, -12, 12), range(r, 1.0, 1.7));
  }
  for (let i = 0; i < 4; i++) addTree("round", range(r, uFar - 40, uFar - 260), range(r, z1, z0), range(r, 1.0, 1.5));

  // ---- grass, flowers, butterflies
  const grass = [newInst(), newInst(), newInst()];
  const flowers = newInst();
  const flies = newInst();
  const gBase = col("#ffffff");
  const addGrass = (u: number, z: number, s: number) => {
    if (inHouse(u, z, 0.3)) return;
    pushInst(grass[Math.floor(r() * 3)], roadX(z) + u, groundH(u, z) - 0.03, z, r() * 6.28, s, s * range(r, 0.8, 1.25), hsl(gBase, r, 0.02, 0.08, 0.07));
  };
  const area = CHUNK;
  // Right verge: tall and dense. Left verge: between road and paddy berm.
  for (let i = 0; i < area * 2.6 * 5.5; i++) {
    const z = range(r, z1, z0);
    const u = 2.8 + Math.pow(r(), 0.8) * 2.8;
    if (inVillage(z) && (u > 4.2 || nearShopFront(z))) continue;
    addGrass(u, z, range(r, 0.55, 1.25) * smooth(2.7, 3.6, u) + 0.25);
  }
  for (let i = 0; i < area * 1.7 * 5; i++) {
    const z = range(r, z1, z0);
    const u = -2.8 - r() * 1.75;
    addGrass(u, z, range(r, 0.5, 1.15) * smooth(-2.7, -3.5, u) + 0.2);
  }
  for (let i = 0; i < area * 24 * 0.45; i++) {
    const z = range(r, z1, z0);
    const u = range(r, 5.6, 30);
    if (inVillage(z) && u < 18) continue;
    addGrass(u, z, range(r, 0.8, 1.6));
  }
  const FLOWER = ["#f7f3ea", "#f7f3ea", "#f3d23c", "#f3d23c", "#ec8fb6", "#b09ae0", "#f39a3c"].map(col);
  const addFlower = (u: number, z: number) => {
    if (inHouse(u, z, 0.2)) return;
    pushInst(flowers, roadX(z) + u, groundH(u, z) + range(r, 0.35, 0.85), z, r() * 6.28, range(r, 0.8, 1.4), undefined, pick(r, FLOWER));
  };
  for (let i = 0; i < 260; i++) addFlower(range(r, 2.9, 5.8), range(r, z1, z0));
  for (let i = 0; i < 130; i++) addFlower(range(r, -4.5, -2.9), range(r, z1, z0));
  for (let i = 0; i < 120; i++) addFlower(range(r, 6, 26), range(r, z1, z0));
  // Flower patches: lavender spikes + red/pink clusters, with butterflies swarming over them.
  const spikes = newInst();
  const rocks = [newInst(), newInst()];
  const SPIKE = ["#a898e2", "#a898e2", "#b9a8ee", "#e06a6a", "#f09ab8"].map(col);
  const FLY = [col("#f8d84a"), col("#f8d84a"), col("#f8d84a"), col("#fbf6e8")];
  const patches: { u: number; z: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const left = r() < 0.35;
    patches.push({ u: left ? range(r, -4.3, -3.2) : range(r, 3.4, 6.5), z: range(r, z1 + 4, z0 - 4) });
  }
  for (const p of patches) {
    if (inHouse(p.u, p.z, 0.5) || nearShopFront(p.z)) continue;
    const pc = pick(r, SPIKE);
    for (let i = 0; i < 16; i++) {
      const u = p.u + range(r, -1.1, 1.1) * (p.u < 0 ? 0.6 : 1);
      const z = p.z + range(r, -2.2, 2.2);
      pushInst(spikes, roadX(z) + u, groundH(u, z) - 0.05, z, r() * 6.28, range(r, 0.8, 1.35), undefined, r() > 0.25 ? pc : pick(r, SPIKE));
    }
    for (let i = 0; i < 5; i++) {
      const z = p.z + range(r, -2.5, 2.5);
      pushInst(flies, roadX(z) + p.u + range(r, -1, 1), range(r, 0.7, 1.5), z, r() * 6.28, range(r, 1.2, 1.5), undefined, pick(r, FLY));
    }
    // Mossy boulder anchoring the patch (away from the road edge).
    if (r() > 0.35) {
      const u = p.u + (p.u > 0 ? range(r, 0.8, 2.0) : -0.6);
      pushInst(rocks[Math.floor(r() * 2)], roadX(p.z) + u, groundH(u, p.z) - 0.1, p.z + range(r, -1, 1), r() * 6.28, range(r, 0.45, 0.9));
    }
  }
  for (let i = 0; i < 10; i++) {
    const u = r() > 0.35 ? range(r, 3.2, 6.5) : range(r, -4.4, -3.0);
    const z = range(r, z1, z0);
    pushInst(flies, roadX(z) + u, range(r, 0.55, 1.3), z, r() * 6.28, range(r, 1.1, 1.4), undefined, pick(r, FLY));
  }
  // Scattered boulders in the meadow and at the foot of trees.
  for (let i = 0; i < 6; i++) {
    const u = range(r, 6, 30), z = range(r, z1, z0);
    if (inHouse(u, z, 1)) continue;
    pushInst(rocks[Math.floor(r() * 2)], roadX(z) + u, groundH(u, z) - 0.15, z, r() * 6.28, range(r, 0.5, 1.4));
  }

  // ---- assemble
  if (houseG.length) group.add(mesh(merge(houseG), uber(ID.house, 1)));
  if (infraG.length) group.add(mesh(merge(infraG), uber(ID.pole, 1)));
  if (wireG.length) group.add(mesh(merge(wireG), uber(ID.wire, 0.8)));
  if (fenceG.length) group.add(mesh(merge(fenceG), uber(ID.fence, 1)));
  if (bermG.length) group.add(mesh(merge(bermG), uber(ID.berm, 0.6)));
  if (waterG.length) {
    const wg = merge(waterG);
    group.add(mesh(wg, waterMaterial()));
  }
  const add = (o: THREE.Object3D | null) => o && group.add(o);
  const dbl = THREE.DoubleSide;
  add(instMesh(P.rice, uber(ID.rice, 0.25, dbl), rice));
  add(instMesh(P.short, uber(ID.grass, 0.25, dbl), bermGrass));
  for (let i = 0; i < 3; i++) add(instMesh(P.grass[i], uber(ID.grass, 0.3, dbl), grass[i]));
  add(instMesh(P.flower, uber(ID.flower, 0.0), flowers));
  add(instMesh(P.fly, uber(ID.butterfly, 0, dbl), flies));
  add(instMesh(P.spike, uber(ID.flower, 0.3), spikes));
  for (let i = 0; i < 2; i++) add(instMesh(P.rocks[i], uber(ID.fence, 1), rocks[i]));
  for (const [key, list] of Object.entries(trees)) {
    const kind = key.slice(0, -1) as TreeKind;
    const vi = Number(key.slice(-1));
    add(instMesh(P.trees[kind][vi], uber(ID.tree, 1), list));
  }
  void box;
  return { k, group, colliders };
}

export class World {
  readonly chunks: Chunk[] = [];
  readonly root = new THREE.Group();

  constructor() {
    for (let k = 0; k < NCHUNK; k++) {
      const c = buildChunk(k);
      this.chunks.push(c);
      this.root.add(c.group);
    }
  }

  /** Recycle chunks so the window [pz - L + behind, pz + behind] is always covered. */
  update(pz: number, behind = 110): void {
    const top = pz + behind;
    for (const c of this.chunks) {
      const zc = -(c.k + 0.5) * CHUNK;
      const n = Math.ceil((zc - top) / L);
      c.group.position.z = -n * L;
    }
  }

  /** Circle colliders near (x, z) in world space. */
  hit(x: number, z: number, r: number): boolean {
    for (const c of this.chunks) {
      const oz = c.group.position.z;
      for (const k of c.colliders) {
        const dx = x - k.x, dz = z - (k.z + oz);
        const rr = r + k.r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    return false;
  }
}
