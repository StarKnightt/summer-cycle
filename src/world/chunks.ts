import * as THREE from "three";
import { CHUNK, L, NCHUNK, RIBBON_HALF, faceRoadFromRight, groundH, pnoise, roadX, roadYaw, smooth } from "./road";
import { ID, M, box, merge, prep, shear, wire, xf } from "./geo";
import { bambooGrove, farHouse, fence, house, pole, postBox, scarecrow, school, shed, stoneMarker, tree, warningSign, waterTower, type TreeKind } from "./props";
import { boulder, butterfly, floretCluster, flower, flowerSpike, fringeGrass, grassClump, leafPlant, riceTuft, shortGrass, vergeClump } from "./vegetation";
import { roadMaterial, uber, waterMaterial } from "../render/materials";
import { LAYER_REFLECT, LAYER_SHADOW, onLayers } from "../render/lightpasses";
import { mulberry32, pick, range, type Rng } from "../core/rng";

type Geo = THREE.BufferGeometry;

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface Contact {
  pen: number;
  nx: number;
  nz: number;
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
  /** Yaw relative to the road: 0 = front faces the approaching rider, negative turns it roadward. */
  tilt?: number;
}

/**
 * Village clusters (periodic z). w = front width (lateral), d = depth (along the road), u = the
 * road-side wall's offset. Fronts face the approaching rider like the reference street.
 */
const HOUSES: HouseSpot[] = [
  { z: -40, w: 7.2, d: 6.2, floors: 2, u: 7.6, ac: true, seed: 11, tilt: -0.22 },
  { z: -53, w: 6.6, d: 6.0, floors: 2, shop: true, u: 6.4, ac: true, balcony: false, seed: 23, tilt: -0.45 },
  { z: -67, w: 7.6, d: 6.6, floors: 2, u: 8.2, seed: 37, tilt: -0.15 },
  { z: -82, w: 6.8, d: 6.0, floors: 1, u: 7.4, ac: true, seed: 41, tilt: -0.3 },
  { z: -228, w: 8.2, d: 7.0, floors: 2, u: 8.6, ac: true, seed: 53, tilt: -0.2 },
  { z: -244, w: 6.0, d: 5.4, floors: 1, u: 7.8, seed: 67, tilt: -0.35 },
  { z: -505, w: 7.4, d: 6.6, floors: 2, u: 8.4, seed: 79, ac: true, tilt: -0.25 },
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

const inVillage = (z: number) => HOUSES.some((h) => z < h.z + h.d / 2 + 5 && z > h.z - h.d / 2 - 2.5);
/** Keep sightlines to the houses open: no big roadside trees just before a cluster. */
const nearVillage = (z: number) => HOUSES.some((h) => z - h.z < 42 && z - h.z > -h.d);
const SHOP_Z = -53;
const nearShopFront = (z: number) => z < SHOP_Z + 7 && z > SHOP_Z - 2;
const villageLot = (u: number, z: number) => {
  for (const h of HOUSES) if (z < h.z + h.d / 2 + 4.5 && z > h.z - h.d / 2 - 1 && u > 3.5 && u < h.u + h.w + 1) return true;
  return false;
};
const inHouse = (u: number, z: number, pad = 0.8) => {
  for (const h of HOUSES) if (Math.abs(z - h.z) < h.d / 2 + pad + 1.4 && u > h.u - pad - 0.8 && u < h.u + h.w + pad) return true;
  return false;
};

function paddyLevel(r: number, c: number): number {
  return -0.42 + r * 0.19 + 0.09 * Math.sin(c * 1.7 + r * 2.3);
}

// ------------------------------------------------------------------ shared prototypes

let protos: {
  trees: Record<TreeKind, Geo[]>;
  far: Record<TreeKind, Geo[]>;
  grass: Geo[];
  verge: Geo[];
  short: Geo;
  fringe: Geo;
  rice: Geo;
  flower: Geo;
  fly: Geo;
  spike: Geo;
  rocks: Geo[];
  lance: Geo[];
  broad: Geo[];
  florets: Geo[];
  hydrangea: Geo;
  bamboo: Geo;
} | null = null;

const protoCache = new Map<string, Geo>();
const memo = (key: string, make: () => Geo) => () => {
  let g = protoCache.get(key);
  if (!g) protoCache.set(key, (g = make()));
  return g;
};
const T = (kind: TreeKind, seed: number, lod?: number) => memo(`${kind}${seed}:${lod ?? 0}`, () => tree(kind, seed, lod));
const PROTO = {
  trees: {
    round: [T("round", 1), T("round", 2), T("round", 3)],
    tall: [T("tall", 4), T("tall", 5)],
    bush: [T("bush", 6), T("bush", 7)],
    cedar: [T("cedar", 8), T("cedar", 9)],
  },
  far: {
    round: [T("round", 11, 1), T("round", 12, 1), T("round", 13, 1)],
    tall: [T("tall", 14, 1), T("tall", 15, 1)],
    bush: [T("bush", 16, 1)],
    cedar: [T("cedar", 18, 1), T("cedar", 19, 1)],
  },
  grass: [memo("g1", () => grassClump(1)), memo("g2", () => grassClump(2)), memo("g3", () => grassClump(3))],
  verge: [memo("v21", () => vergeClump(21)), memo("v22", () => vergeClump(22)), memo("v23", () => vergeClump(23))],
  short: memo("short", () => shortGrass(4)),
  fringe: memo("fringe", () => fringeGrass(6)),
  rice: memo("rice", () => riceTuft(5)),
  flower: memo("flower", () => flower()),
  fly: memo("fly", () => butterfly()),
  spike: memo("spike", () => flowerSpike(9)),
  rocks: [memo("r1", () => boulder(1)), memo("r2", () => boulder(2.7))],
  lance: [memo("l1", () => leafPlant(31, "lance")), memo("l2", () => leafPlant(32, "lance"))],
  broad: [memo("b1", () => leafPlant(41, "broad")), memo("b2", () => leafPlant(42, "broad"))],
  // Floret sprays: aster, fleabane, red spray, tall golden-rod-ish, hydrangea head clusters.
  florets: [
    memo("f1", () => floretCluster(51, 44, 0.75, 0.034)),
    memo("f2", () => floretCluster(52, 30, 0.55, 0.03)),
    memo("f3", () => floretCluster(53, 24, 0.5, 0.04)),
    memo("f4", () => floretCluster(54, 36, 0.95, 0.03)),
  ],
  hydrangea: memo("hy", () => floretCluster(61, 90, 0.95, 0.075)),
  bamboo: memo("bam", () => bambooGrove(71)),
};

/** Every shared prototype as a separate build step, so a loader can yield between them. */
export function protoSteps(): (() => void)[] {
  const out: (() => void)[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "function") out.push(v as () => void);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(PROTO);
  return out;
}

function getProtos() {
  if (!protos) {
    const all = <K extends string>(r: Record<K, (() => Geo)[]>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v as (() => Geo)[]).map((f) => f())])) as Record<K, Geo[]>;
    protos = {
      trees: all(PROTO.trees),
      far: all(PROTO.far),
      grass: PROTO.grass.map((f) => f()),
      verge: PROTO.verge.map((f) => f()),
      short: PROTO.short(),
      fringe: PROTO.fringe(),
      rice: PROTO.rice(),
      flower: PROTO.flower(),
      fly: PROTO.fly(),
      spike: PROTO.spike(),
      rocks: PROTO.rocks.map((f) => f()),
      lance: PROTO.lance.map((f) => f()),
      broad: PROTO.broad.map((f) => f()),
      florets: PROTO.florets.map((f) => f()),
      hydrangea: PROTO.hydrangea(),
      bamboo: PROTO.bamboo(),
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

/** Value noise periodic in z (period L, so recycled chunks stay seamless), cells of `cell` metres. */
function pvnoise(u: number, z: number, cell: number, seed: number): number {
  const n = Math.round(L / cell);
  const x = u / cell, y = (-z / L) * n;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + (((b % n) + n) % n) * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Right-verge grass bed density: 0 = bare dirt / leaf-litter gap, 1 = dense clump bed. */
const vergeDensity = (u: number, z: number) => smooth(0.25, 0.5, pvnoise(u, z, 3.2, 1) * 0.72 + pvnoise(u, z, 1.1, 2) * 0.28);

const LITTER = col("#3b3826");
const LITTER_DRY = col("#524630");
const BED = col("#2a4524");

function groundColor(u: number, z: number, out: THREE.Color): THREE.Color {
  const n = pnoise(u, z, 3);
  if (u < -3.2) return out.set("#4a7c34").offsetHSL(0, 0, (n - 0.5) * 0.06);
  if (u < 3.3) return out.set("#4b7c35");
  if (u < 7.5) {
    // Verge floor: dark soil + leaf litter in the gaps between grass beds.
    out.copy(LITTER).lerp(LITTER_DRY, pvnoise(u, z, 1.7, 5) * 0.7).lerp(BED, smooth(0.15, 0.7, vergeDensity(u, z)));
    const meadow = col("#5b8f3a").lerp(col("#3f7232"), 0.3);
    if (villageLot(u, z)) return out.lerp(col("#a88f62"), 0.85);
    return out.lerp(meadow, smooth(5.8, 7.5, u));
  }
  out.set("#5b8f3a");
  const warm = pnoise(u * 0.5, z, 7);
  out.lerp(col("#86a04a"), smooth(0.62, 0.85, warm) * 0.5);
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

const BANK_FACE = col("#66763a");
const BANK_TOP = col("#4a7431");

/** Bank faces olive earth, bank tops grassy. */
function bankColors(g: Geo): Geo {
  const n = g.attributes.normal;
  const c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const k = n.getY(i) > 0.5 ? BANK_TOP : BANK_FACE;
    c.setXYZ(i, k.r, k.g, k.b);
  }
  return g;
}

function bermAlongZ(u: number, za: number, zb: number, top: number, w = 0.75): Geo {
  const len = Math.abs(za - zb);
  const g = bankColors(prep(new THREE.BoxGeometry(w, top + 0.9, len, 1, 1, Math.max(1, Math.round(len / 2.5))), "#ffffff", M.ground));
  g.translate(u, (top - 0.9) / 2, (za + zb) / 2);
  return shear(g);
}

function bermAlongU(z: number, ua: number, ub: number, top: number): Geo {
  const g = bankColors(prep(new THREE.BoxGeometry(Math.abs(ua - ub), top + 0.9, 0.6, 3, 1, 1), "#ffffff", M.ground));
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
      // 3D rice (V tufts) on the 0.6 m grid rows nearest the road (u > -10.8); every row beyond
      // is drawn by the water shader on the same grid.
      if (rr === 0) {
        for (let u = -5.7; u > -10.8; u -= 0.6) {
          for (let z = za - 0.55; z > zb + 0.5; z -= 0.45) {
            if (r() < 0.12) continue;
            const s = (0.55 + growth * 0.4) * range(r, 0.85, 1.15);
            pushInst(rice, roadX(z) + u + range(r, -0.04, 0.04), lvl - 0.02, z + range(r, -0.04, 0.04), range(r, -0.5, 0.5) + (r() > 0.5 ? 0 : Math.PI / 2), s, s * range(r, 0.9, 1.2), hsl(col("#ffffff"), r, 0.02, 0.0, 0.06));
          }
        }
      }
      // Grass fringe along both top edges of the nearer banks.
      if (rr <= 1) {
        const hw = (rr === 0 ? 0.8 : 0.7) / 2 - 0.08;
        for (let z = za; z > zb; z -= 0.45) {
          for (const e of [-hw, hw]) if (r() < 0.7) pushInst(bermGrass, roadX(z) + uIn + e + range(r, -0.06, 0.06), top, z, r() * 6.28, range(r, 0.7, 1.25), undefined, hsl(col("#ffffff"), r, 0.02, 0.05, 0.08));
        }
      }
      if (rr <= 1) {
        for (let u = uIn - 0.4; u > uOut + 0.4; u -= 0.5) {
          for (const e of [-0.22, 0.22]) {
            if (r() > 0.6) continue;
            const zz = za + e;
            pushInst(bermGrass, roadX(zz) + u, ctop, zz, r() * 6.28, range(r, 0.7, 1.2), undefined, hsl(col("#ffffff"), r, 0.02, 0.05, 0.08));
          }
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
  const farProps: Geo[] = [];
  bermG.push(bermAlongZ(uFar, z0, z1, 0.95, 1.0));
  {
    // Irregular far paddies: strips of uneven length, each cut across at its own uneven widths,
    // levels stepping slightly (terraces), rice at different growth, some wide farm paths.
    const fr = mulberry32(Math.round(z0) * 7 + 3);
    let za = z0;
    while (za > z1 + 1) {
      const zb = Math.max(z1, za - range(fr, 16, 48));
      let ua = uFar;
      while (ua > uFar - 330) {
        const ub = Math.max(uFar - 330, ua - range(fr, 16, 58));
        const lvl = 0.66 + fr() * 0.16;
        waterG.push(waterPlane(ua, ub, za, zb, lvl, range(fr, 0.35, 1.0)));
        if (ub > uFar - 330) bermG.push(bermAlongZ(ub, za, zb, 0.95, fr() > 0.85 ? 2.4 : range(fr, 0.6, 1.0)));
        const cu = (ua + ub) / 2, cz = (za + zb) / 2;
        if (fr() > 0.93) farProps.push(placeAt(scarecrow(Math.floor(fr() * 1e4)), cu + range(fr, -4, 4), cz, fr() * 6.28, lvl - 0.2));
        if (fr() > 0.94) farProps.push(placeAt(shed(Math.floor(fr() * 1e4)), ub + 2, zb + 2, roadYaw(cz) + range(fr, -0.3, 0.3), 0.9));
        ua = ub;
      }
      if (zb > z1) bermG.push(bermAlongU(zb, uFar, uFar - 330, 0.95));
      za = zb;
    }
  }

  // ---- houses (right)
  for (const h of HOUSES) {
    if (!inRange(h.z)) continue;
    const g = house({ w: h.w, d: h.d, floors: h.floors, shop: h.shop, seed: h.seed, ac: h.ac, balcony: h.balcony });
    houseG.push(placeAt(g, h.u + h.w / 2, h.z, roadYaw(h.z) + (h.tilt ?? -0.25), groundH(h.u + 1, h.z) + 0.02));
    colliders.push({ x: roadX(h.z) + h.u + h.w / 2, z: h.z, r: Math.max(h.w, h.d) * 0.55 });
  }
  // Obstacles that sit inside the guide rails (reachable by steering, clear of the autoplay line
  // which holds ~0.85 m left of centre): post box and stone marker at the road edge, a pole
  // standing on the asphalt shoulder as rural Japanese poles often do.
  const obstacle = (g: Geo, u: number, z: number, ry: number, rad: number) => {
    if (!inRange(z)) return;
    infraG.push(placeAt(g, u, z, ry));
    colliders.push({ x: roadX(z) + u, z, r: rad });
  };
  // Collider radius = visual half-size + ~0.1 m so nothing ever overlaps the rider.
  obstacle(postBox(), 2.55, SHOP_Z + 5.5, faceRoadFromRight(SHOP_Z + 5.5), 0.45);
  obstacle(stoneMarker(), 2.5, -140, faceRoadFromRight(-140), 0.3);
  obstacle(stoneMarker(), -4.05, -205, faceRoadFromRight(-205) + Math.PI, 0.3);
  if (inRange(-300)) {
    const ep = pole(8.2, false);
    obstacle(ep.geo, 2.6, -300, roadYaw(-300), 0.26);
  }
  if (inRange(-380)) {
    const ep = pole(8.2, true);
    obstacle(ep.geo, -2.65, -380, roadYaw(-380), 0.26);
  }

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
      infraG.push(xf(prep(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 8), "#a2a098", M.metal), roadX(z) + 3.25, 0.42, z));
    }
    const rail = prep(new THREE.BoxGeometry(0.06, 0.32, len, 1, 2, Math.max(1, Math.round(len / 2))), "#a8a69e", M.metal);
    rail.translate(3.18, 0.66, a - len / 2);
    infraG.push(shear(rail));
  }

  // ---- trees
  const trees: Record<string, Inst> = {};
  const farTrees: Record<string, Inst> = {};
  const addTree = (kind: TreeKind, u: number, z: number, s: number, far = false, rng: Rng = r) => {
    const variants = far ? P.far[kind] : P.trees[kind];
    const vi = Math.floor(rng() * variants.length);
    const key = `${kind}${vi}`;
    const bucket = far ? farTrees : trees;
    (bucket[key] ??= newInst());
    pushInst(bucket[key], roadX(z) + u, groundH(u, z) - 0.1, z, rng() * 6.28, s, s * range(rng, 0.9, 1.1), hsl(col("#ffffff"), rng, 0.015, 0.05, 0.05));
    if (Math.abs(u) < 46) colliders.push({ x: roadX(z) + u, z, r: 0.5 * s });
  };
  // Village backdrop: a big dark tree mass behind the houses (as in the reference).
  for (const h of HOUSES) {
    if (!inRange(h.z)) continue;
    addTree(pick(r, ["round", "round", "tall"] as TreeKind[]), h.u + h.w + range(r, 3, 7), h.z + range(r, -4, 2), range(r, 1.35, 1.7));
    addTree("round", h.u + h.w + range(r, 9, 14), h.z + range(r, -6, 6), range(r, 1.3, 1.8));
    if (r() > 0.3) addTree("bush", h.u - 0.2, h.z + h.d / 2 + 2.6, range(r, 0.7, 1.0));
  }
  // Trees on the paddy-side berm: the low sun throws their dappled shadows across the road.
  for (const lz of [-0.5, -26, -118, -170, -262, -330, -445, -520, -600]) {
    if (!inRange(lz)) continue;
    // (The z=-0.5 tree sits back a little: its canopy no longer roofs the road.)
    const kind = lz === -0.5 ? "round" : pick(r, ["round", "tall"] as TreeKind[]);
    const s = range(r, 1.0, 1.25);
    addTree(kind, lz === -0.5 ? -6.6 : -5.3, lz, lz === -0.5 ? 1.0 : s);
  }
  // Two tall berm trees just behind the opening shot (out of frame): their long dappled
  // shadows stripe the road around the rider in the first seconds.
  const openR = mulberry32(9001);
  for (const [lz, s] of [[-43, 1.2], [-48.5, 1.1]]) {
    if (inRange(lz)) addTree("tall", -5.6, lz, s, false, openR);
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
    addTree(r() > 0.45 ? "cedar" : "round", u, z, range(r, 1.1, 1.9), u > 70);
  }
  // A few trees out in the fields / on far berms.
  for (let i = 0; i < 4; i++) {
    const z = range(r, z1, z0);
    const u = BERM0 - Math.floor(range(r, 2, NROWS)) * ROW_P;
    addTree(pick(r, ["round", "tall", "bush"] as TreeKind[]), u, z, range(r, 0.8, 1.3));
  }
  // Groves out in the far fields (farmstead windbreaks) so the horizon isn't a flat line.
  // Farmstead hamlets across the fields: roofs at different heights/angles inside a grove, with a
  // cedar windbreak on the north side and a bamboo clump.
  const bamboo = newInst();
  const hamlet = (gu: number, gz: number, nHouses: number) => {
    const yaw = roadYaw(gz) + range(r, -0.5, 0.5);
    for (let i = 0; i < nHouses; i++) {
      const hu = gu + range(r, -16, 16), hz = gz + range(r, -14, 14);
      farProps.push(placeAt(farHouse(Math.floor(r() * 1e5)), hu, hz, yaw + (r() > 0.5 ? Math.PI / 2 : 0) + range(r, -0.15, 0.15), 0.75));
    }
    for (let i = 0; i < 10; i++) addTree(pick(r, ["round", "round", "tall"] as TreeKind[]), gu + range(r, -22, 22), gz + range(r, -18, 18), range(r, 0.9, 1.6), true);
    // Windbreak: a tight line of cedars along one side.
    const side = r() > 0.5 ? 1 : -1;
    for (let i = 0; i < 9; i++) addTree("cedar", gu + side * 22 + range(r, -1.5, 1.5), gz - 20 + i * 5 + range(r, -1, 1), range(r, 1.0, 1.4), true);
    for (let i = 0; i < 2; i++) {
      const bz = gz + range(r, -16, 16);
      pushInst(bamboo, roadX(bz) + gu - side * range(r, 16, 26), 0.6, bz, r() * 6.28, range(r, 0.9, 1.3), undefined, hsl(col("#ffffff"), r, 0.02, 0.05, 0.06));
    }
  };
  hamlet(range(r, uFar - 70, uFar - 150), range(r, z1 + 30, z0 - 30), 4 + Math.floor(r() * 3));
  if (r() > 0.4) hamlet(range(r, uFar - 170, uFar - 280), range(r, z1 + 30, z0 - 30), 3 + Math.floor(r() * 3));
  // Hedgerows / tree lines along a few far berms instead of evenly spaced single balls.
  for (let k = 0; k < 2; k++) {
    const lu = range(r, uFar - 40, uFar - 300);
    const za = range(r, z1, z0), len = range(r, 40, 90);
    for (let z = za; z > za - len && z > z1; z -= range(r, 4, 7)) addTree(r() > 0.3 ? "round" : "tall", lu + range(r, -1.5, 1.5), z, range(r, 0.7, 1.1), true);
  }
  // Village school + water tower out at the far edge, once per world period.
  if (inRange(-260)) {
    farProps.push(placeAt(school(), uFar - 200, -260, roadYaw(-260) + Math.PI / 2 + 0.3, 0.75));
    farProps.push(placeAt(waterTower(), uFar - 150, -300, 0, 0.75));
    for (let i = 0; i < 8; i++) addTree("round", uFar - 200 + range(r, -30, 30), -260 + range(r, -35, 35), range(r, 1.0, 1.6), true);
  }
  // Receding power line across the fields toward the hamlets.
  if (inRange(-150)) {
    for (let i = 0; i < 7; i++) {
      const pu = uFar - 10 - i * 42, pz = -150 - i * 9;
      const pa = pole(8.5, false);
      farProps.push(placeAt(pa.geo, pu, pz, roadYaw(pz) + 0.2, 0.7));
      if (i > 0) {
        const qu = pu + 42, qz = pz + 9;
        const A = new THREE.Vector3(roadX(qz) + qu, 8.5, qz), B = new THREE.Vector3(roadX(pz) + pu, 8.5, pz);
        for (const dx of [-0.7, 0.7]) wireG.push(...wire(A.clone().setX(A.x + dx * 0.2), B.clone().setX(B.x + dx * 0.2), 1.2, 0.03, "#2a2622", 10));
      }
    }
  }

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
  // Right verge: beds of tall clumps (0.4-1.3 m, per clump) with bare litter gaps between beds,
  // thinned and shortened over the first half metre from the road edge.
  const verge = [newInst(), newInst(), newInst()];
  for (let i = 0; i < area * 3.45 * 5.0; i++) {
    const z = range(r, z1, z0);
    const u = range(r, 2.75, 6.2);
    if (inVillage(z) && (u > 4.2 || nearShopFront(z))) continue;
    if (inHouse(u, z, 0.3)) continue;
    const d = vergeDensity(u, z);
    const edge = smooth(2.75, 3.25, u);
    if (r() > d * (0.2 + 0.8 * edge)) continue;
    const h = (0.4 + 0.9 * Math.min(1, Math.pow(r(), 0.85) * (0.5 + 0.65 * d))) * (0.55 + 0.45 * edge);
    const s = range(r, 0.8, 1.2);
    pushInst(verge[Math.floor(r() * 3)], roadX(z) + u, groundH(u, z) - 0.03, z, r() * 6.28, s, h, hsl(gBase, r, 0.015, 0.06, 0.06));
  }
  // Left verge kept low so the mirror paddies read from the chase camera.
  for (let i = 0; i < area * 1.7 * 6; i++) {
    const z = range(r, z1, z0);
    const u = -2.8 - r() * 1.75;
    addGrass(u, z, range(r, 0.3, 0.5) * smooth(-2.7, -3.4, u) + 0.12);
  }
  for (let i = 0; i < area * 24 * 0.42; i++) {
    const z = range(r, z1, z0);
    const u = range(r, 5.8, 30);
    if (inVillage(z) && u < 20) continue;
    addGrass(u, z, range(r, 0.7, 1.3));
  }
  // Weeds pushing through the crumbling asphalt edges.
  const weeds = newInst();
  for (let z = z0; z > z1; z -= range(r, 0.6, 2.2)) {
    const s = r() > 0.5 ? 1 : -1;
    const u = s * range(r, 2.15, 2.5);
    pushInst(weeds, roadX(z) + u, 0.0, z, r() * 6.28, range(r, 0.35, 0.7), undefined, hsl(gBase, r, 0.02, 0.05, 0.06));
  }
  const FLOWER = ["#f7f3ea", "#f7f3ea", "#f3d23c", "#f3d23c", "#ec8fb6", "#b09ae0", "#f39a3c"].map(col);
  const addFlower = (u: number, z: number) => {
    if (inHouse(u, z, 0.2)) return;
    const s = range(r, 0.6, 1.3);
    pushInst(flowers, roadX(z) + u, groundH(u, z) + 0.62 * s - 0.03, z, r() * 6.28, s, undefined, pick(r, FLOWER));
  };
  // Undergrowth species + floret sprays along both verges (layered like the reference verges).
  const lance = [newInst(), newInst()], broad = [newInst(), newInst()];
  const florets = [newInst(), newInst(), newInst(), newInst()];
  const FLORET = [
    ["#b7a4ec", "#c9b8f4", "#a893e4"],
    ["#f6f3ea", "#fbf6e6"],
    ["#e8503e", "#f07a4a", "#e0443a"],
    ["#f2c93a", "#f6d860"],
  ].map((l) => l.map(col));
  const plantAt = (u: number, z: number) => {
    if (inHouse(u, z, 0.3) || (inVillage(z) && u > 3.4 && u < 7 && nearShopFront(z))) return;
    const y = groundH(u, z) - 0.02, x = roadX(z) + u;
    const k = r();
    if (k < 0.3) pushInst(lance[Math.floor(r() * 2)], x, y, z, r() * 6.28, range(r, 0.7, 1.2), undefined, hsl(gBase, r, 0.02, 0.06, 0.06));
    else if (k < 0.55) pushInst(broad[Math.floor(r() * 2)], x, y, z, r() * 6.28, range(r, 0.7, 1.1), undefined, hsl(gBase, r, 0.02, 0.06, 0.06));
    else {
      const fi = Math.floor(r() * 4);
      pushInst(florets[fi], x, y, z, r() * 6.28, range(r, 0.75, 1.25), undefined, pick(r, FLORET[fi]));
    }
  };
  for (let i = 0; i < 190; i++) plantAt(range(r, 2.95, 6.4), range(r, z1, z0));
  for (let i = 0; i < 70; i++) plantAt(range(r, -4.5, -2.95), range(r, z1, z0));
  for (let i = 0; i < 40; i++) plantAt(range(r, 6.4, 22), range(r, z1, z0));
  for (let i = 0; i < 260; i++) addFlower(range(r, 2.9, 5.8), range(r, z1, z0));
  for (let i = 0; i < 130; i++) addFlower(range(r, -4.5, -2.9), range(r, z1, z0));
  for (let i = 0; i < 120; i++) addFlower(range(r, 6, 26), range(r, z1, z0));
  // Flower patches: lavender spikes + red/pink clusters, with butterflies swarming over them.
  const spikes = newInst();
  const rocks = [newInst(), newInst()];
  const SPIKE = ["#a898e2", "#a898e2", "#b9a8ee", "#e06a6a", "#f09ab8"].map(col);
  const FLY = [col("#f2d04a"), col("#f2d04a"), col("#f6dc5a"), col("#fff4c0"), col("#fff4c0"), col("#f7f7ef"), col("#f39a3c")];
  const patches: { u: number; z: number }[] = [];
  for (let i = 0; i < 9; i++) {
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
    for (let i = 0; i < 12; i++) {
      const z = p.z + range(r, -2.5, 2.5);
      pushInst(flies, roadX(z) + p.u + range(r, -1.4, 1.4), range(r, 0.5, 1.5), z, r() * 6.28, range(r, 0.3, 0.5), undefined, pick(r, FLY));
    }
    // Floret sprays packed into the patch.
    for (let i = 0; i < 10; i++) {
      const fi = Math.floor(r() * 4);
      const z = p.z + range(r, -2.4, 2.4), u = p.u + range(r, -1.2, 1.2) * (p.u < 0 ? 0.6 : 1);
      if (!inHouse(u, z, 0.3)) pushInst(florets[fi], roadX(z) + u, groundH(u, z) - 0.02, z, r() * 6.28, range(r, 0.8, 1.3), undefined, pick(r, FLORET[fi]));
    }
    // Mossy boulder anchoring the patch (away from the road edge).
    if (r() > 0.35) {
      const u = p.u + (p.u > 0 ? range(r, 0.8, 2.0) : -0.6);
      pushInst(rocks[Math.floor(r() * 2)], roadX(p.z) + u, groundH(u, p.z) - 0.1, p.z + range(r, -1, 1), r() * 6.28, range(r, 0.45, 0.9));
    }
  }
  // Dozens of tiny butterflies scattered over the verges and meadow (as in the reference frames).
  for (let i = 0; i < 46; i++) {
    const u = r() > 0.35 ? range(r, 3.0, 12) : range(r, -4.6, -2.9);
    const z = range(r, z1, z0);
    pushInst(flies, roadX(z) + u, range(r, 0.4, 1.4), z, r() * 6.28, range(r, 0.28, 0.45), undefined, pick(r, FLY));
  }
  // Hydrangea shrubs by the houses: leafy bush + big blue/violet flower heads.
  const hyd = newInst();
  const HYD = ["#6f8ee6", "#8f84e0", "#a79ae8", "#7aa6e8"].map(col);
  for (const h of HOUSES) {
    if (!inRange(h.z)) continue;
    for (let i = 0; i < 4; i++) {
      const u = h.u - range(r, 0.2, 1.0), z = h.z + h.d / 2 + range(r, 0.6, 3.6);
      pushInst(hyd, roadX(z) + u, groundH(u, z) - 0.05, z, r() * 6.28, range(r, 0.8, 1.1), undefined, pick(r, HYD));
      addTree("bush", u + range(r, -0.3, 0.3), z + range(r, -0.4, 0.4), range(r, 0.45, 0.6));
    }
  }
  // Scattered boulders in the meadow and at the foot of trees.
  for (let i = 0; i < 6; i++) {
    const u = range(r, 6, 30), z = range(r, z1, z0);
    if (inHouse(u, z, 1)) continue;
    const s = range(r, 0.5, 1.2);
    pushInst(rocks[Math.floor(r() * 2)], roadX(z) + u, groundH(u, z) - 0.25 * s, z, r() * 6.28, s);
  }

  // ---- assemble
  const S = LAYER_SHADOW, R = LAYER_REFLECT;
  const add = (o: THREE.Object3D | null, ...layers: number[]) => {
    if (!o) return;
    onLayers(o, ...layers);
    group.add(o);
  };
  if (houseG.length) add(mesh(merge(houseG), uber(ID.house, 1)), S, R);
  if (farProps.length) add(mesh(merge(farProps), uber(ID.house, 1)));
  add(instMesh(P.bamboo, uber(ID.tree, -1, THREE.DoubleSide), bamboo));
  if (infraG.length) add(mesh(merge(infraG), uber(ID.pole, 1)), S, R);
  if (wireG.length) add(mesh(merge(wireG), uber(ID.wire, 0.8)), S, R);
  if (fenceG.length) add(mesh(merge(fenceG), uber(ID.fence, 1, THREE.DoubleSide)), S, R);
  if (bermG.length) add(mesh(merge(bermG), uber(ID.berm, 0.6)), R);
  if (waterG.length) add(mesh(merge(waterG), waterMaterial()));
  const dbl = THREE.DoubleSide;
  add(instMesh(P.rice, uber(ID.rice, -1, dbl), rice));
  add(instMesh(P.fringe, uber(ID.grass, -1, dbl), bermGrass));
  add(instMesh(P.short, uber(ID.grass, -1, dbl), weeds));
  for (let i = 0; i < 3; i++) add(instMesh(P.grass[i], uber(ID.grass, -1, dbl), grass[i]));
  for (let i = 0; i < 3; i++) add(instMesh(P.verge[i], uber(ID.grass, -1, dbl), verge[i]));
  add(instMesh(P.flower, uber(ID.flower, -1, dbl), flowers));
  add(instMesh(P.fly, uber(ID.butterfly, -1, dbl), flies));
  add(instMesh(P.spike, uber(ID.flower, -1, dbl), spikes));
  const plantMat = uber(ID.tree, -1, dbl);
  for (let i = 0; i < 2; i++) add(instMesh(P.lance[i], plantMat, lance[i]), S);
  for (let i = 0; i < 2; i++) add(instMesh(P.broad[i], plantMat, broad[i]), S);
  for (let i = 0; i < 4; i++) add(instMesh(P.florets[i], uber(ID.flower, -1, dbl), florets[i]));
  add(instMesh(P.hydrangea, uber(ID.flower, -1, dbl), hyd));
  for (let i = 0; i < 2; i++) add(instMesh(P.rocks[i], uber(ID.fence, 1), rocks[i]), S);
  const treeMat = uber(ID.tree, 0.8, dbl);
  for (const [key, list] of Object.entries(trees)) {
    const kind = key.slice(0, -1) as TreeKind;
    const vi = Number(key.slice(-1));
    add(instMesh(P.trees[kind][vi], treeMat, list), S, R);
  }
  for (const [key, list] of Object.entries(farTrees)) {
    const kind = key.slice(0, -1) as TreeKind;
    const vi = Number(key.slice(-1));
    add(instMesh(P.far[kind][vi], treeMat, list), R);
  }
  void box;
  return { k, group, colliders };
}

export class World {
  readonly chunks: Chunk[] = [];
  readonly root = new THREE.Group();

  static readonly CHUNKS = NCHUNK;

  /** Pass false to build the chunks one at a time with addChunk() (0 … CHUNKS-1). */
  constructor(buildAll = true) {
    if (buildAll) for (let k = 0; k < NCHUNK; k++) this.addChunk(k);
  }

  addChunk(k: number): void {
    const c = buildChunk(k);
    this.chunks.push(c);
    this.root.add(c.group);
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

  /** Deepest circle-collider penetration at (x, z) in world space (0 = clear). */
  hit(x: number, z: number, r: number): number {
    return this.contact(x, z, r).pen;
  }

  /** Deepest penetration plus the push-out normal (from the obstacle toward the point). */
  contact(x: number, z: number, r: number): Contact {
    const out: Contact = { pen: 0, nx: 0, nz: 0 };
    for (const c of this.chunks) {
      const oz = c.group.position.z;
      for (const k of c.colliders) {
        const dx = x - k.x, dz = z - (k.z + oz);
        const rr = r + k.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2);
          if (rr - d > out.pen) {
            out.pen = rr - d;
            out.nx = d > 1e-5 ? dx / d : 1;
            out.nz = d > 1e-5 ? dz / d : 0;
          }
        }
      }
    }
    return out;
  }

  /** 0..1 closeness to trees / houses / paddy water around (x, z), for the soundscape. */
  closeness(x: number, z: number): { trees: number; houses: number } {
    let tree = Infinity, house = Infinity;
    for (const c of this.chunks) {
      const oz = c.group.position.z;
      for (const k of c.colliders) {
        const dx = x - k.x, dz = z - (k.z + oz);
        const d = Math.sqrt(dx * dx + dz * dz) - k.r;
        if (k.r > 1.2) house = Math.min(house, d);
        else if (k.r >= 0.35) tree = Math.min(tree, d);
      }
    }
    return {
      trees: Math.max(0, Math.min(1, 1 - (tree - 2) / 16)),
      houses: Math.max(0, Math.min(1, 1 - (house - 3) / 30)),
    };
  }

  /** Nearest obstacle inside the guide rails (for the collision test hook). */
  obstacles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const c of this.chunks) for (const k of c.colliders) if (Math.abs(k.x - roadX(k.z)) < 2.8) out.push({ x: k.x, z: k.z + c.group.position.z, r: k.r });
    return out;
  }
}

/** Layout data for the on-foot explorer (walkable paddy banks, house footprints, fences). */
export const LAYOUT = { ROW_P, COL_P, NROWS, BERM0, HOUSES, FENCES_LEFT, GUARDRAIL_RIGHT, paddyLevel } as const;
