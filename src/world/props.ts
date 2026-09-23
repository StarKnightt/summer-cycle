import * as THREE from "three";
import { M, beam, blob, box, boxM, cyl, merge, prep, sphere, spherize, xf } from "./geo";
import { mulberry32, range } from "../core/rng";
import { LEAF_CELL, cellUv } from "../render/leafAtlas";

type Geo = THREE.BufferGeometry;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const WOOD_STAIN = "#4a3526";
const WOOD_DARK = "#33241a";
const WOOD = "#5c4230";
const WOOD_LIGHT = "#9a7650";
const PLASTER = "#e6ddc8";
const TILE = "#2a3134";
const TILE_DARK = "#1f2629";
const STONE = "#9a948a";

/** Gable end triangle prism (local: base width w along X, height h, thickness t along Z). */
function gable(w: number, h: number, t: number, color: string, mat: number): Geo {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  return prep(g, color, mat);
}

/** Gable roof over w (ridge along X) x d (Z), eaves at y0, deep overhang, kawara rib uvs. */
function roof(w: number, d: number, y0: number, pitch: number, over: number): Geo[] {
  const out: Geo[] = [];
  const half = d / 2 + over;
  const slope = half / Math.cos(pitch);
  const rise = (d / 2) * Math.tan(pitch);
  for (const s of [-1, 1]) {
    const g = boxM(w + over * 2, 0.16, slope, TILE, M.roof);
    g.rotateX(s * pitch);
    g.translate(0, y0 + rise - (half * Math.tan(pitch)) / 2 + 0.08, (s * half) / 2);
    out.push(g);
    // Thick eave edge tiles (the bold dark lip seen in the references).
    const lip = box(w + over * 2 + 0.02, 0.12, 0.2, TILE_DARK, M.plain);
    xf(lip, 0, y0 + rise - half * Math.tan(pitch) + 0.06, s * (half - 0.08));
    out.push(lip);
  }
  const ridge = box(w + over * 2 + 0.1, 0.26, 0.36, TILE_DARK, M.plain);
  xf(ridge, 0, y0 + rise + 0.14, 0);
  out.push(ridge);
  for (const s of [-1, 1]) {
    const c = box(0.26, 0.46, 0.46, TILE_DARK, M.plain);
    xf(c, s * (w / 2 + over + 0.05), y0 + rise + 0.22, 0);
    out.push(c);
    // Barge boards along the verge of the gable.
    for (const t of [-1, 1]) {
      const bb = box(0.1, 0.16, slope, WOOD_DARK);
      bb.rotateX(t * pitch);
      bb.translate(s * (w / 2 + over), y0 + rise - (half * Math.tan(pitch)) / 2, (t * half) / 2);
      out.push(bb);
    }
  }
  // Gable walls: white plaster with exposed timber.
  for (const s of [-1, 1]) {
    const gb = gable(d, rise, 0.1, PLASTER, M.plain);
    gb.rotateY(Math.PI / 2);
    gb.translate((s * w) / 2 - s * 0.05, y0, 0);
    out.push(gb);
    out.push(xf(box(0.12, 0.14, d + 0.2, WOOD_DARK), (s * w) / 2 + s * 0.02, y0 + rise * 0.4, 0));
    out.push(xf(box(0.12, rise * 0.9, 0.12, WOOD_DARK), (s * w) / 2 + s * 0.02, y0 + rise * 0.45, 0));
  }
  return out;
}

/** Lean-to eave (hisashi) projecting from a wall at local +Z. */
function hisashi(w: number, depth: number, y: number, z: number): Geo[] {
  const g = boxM(w, 0.12, depth, TILE, M.roof);
  g.rotateX(0.36);
  g.translate(0, y, z + depth / 2 - 0.05);
  const lip = box(w + 0.02, 0.1, 0.16, TILE_DARK, M.plain);
  xf(lip, 0, y - Math.sin(0.36) * depth * 0.5, z + depth * Math.cos(0.36) - 0.06);
  const out = [g, lip];
  for (const x of [-w / 2 + 0.25, 0, w / 2 - 0.25]) out.push(xf(box(0.08, 0.08, depth * 0.8, WOOD_DARK), x, y - 0.28, z + depth * 0.4, -0.5));
  return out;
}

const panel = (w: number, h: number, mat: number) => prep(new THREE.BoxGeometry(w, h, 0.05), "#ffffff", mat);

/** Koshi: dense vertical wooden lattice screen (front windows of machiya). */
function koshi(w: number, h: number): Geo[] {
  const out: Geo[] = [];
  out.push(xf(box(w + 0.08, 0.07, 0.07, WOOD_DARK), 0, h / 2, 0));
  out.push(xf(box(w + 0.08, 0.07, 0.07, WOOD_DARK), 0, -h / 2, 0));
  for (let x = -w / 2; x <= w / 2 + 1e-3; x += 0.06) out.push(xf(box(0.024, h, 0.035, "#3b2a1e"), x, 0, 0.02));
  out.push(xf(box(w, 0.03, 0.03, "#3b2a1e"), 0, h * 0.18, 0.04));
  return out;
}

/** Sliding glass doors in a wooden frame. */
function slidingDoor(w: number, h: number): Geo[] {
  const out: Geo[] = [];
  for (const s of [-1, 1]) out.push(xf(panel(w / 2 - 0.02, h, M.glass), (s * w) / 4, 0, 0));
  out.push(xf(box(w + 0.1, 0.1, 0.08, WOOD_DARK), 0, h / 2 + 0.05, 0.02));
  out.push(xf(box(w + 0.1, 0.06, 0.08, WOOD_DARK), 0, -h / 2, 0.02));
  for (const x of [-w / 2, 0, w / 2]) out.push(xf(box(0.06, h, 0.07, WOOD_DARK), x, 0, 0.02));
  return out;
}

function railing(w: number, h: number): Geo[] {
  const out: Geo[] = [];
  out.push(xf(box(w, 0.07, 0.08, WOOD_DARK), 0, h, 0));
  out.push(xf(box(w, 0.05, 0.06, WOOD_DARK), 0, 0.08, 0));
  for (let x = -w / 2 + 0.06; x <= w / 2; x += 0.11) out.push(xf(box(0.035, h, 0.035, WOOD), x, h / 2, 0));
  return out;
}

function acUnit(): Geo[] {
  const out: Geo[] = [];
  out.push(box(0.8, 0.56, 0.28, "#d6d4ca", M.metal));
  const fan = cyl(0.19, 0.19, 0.03, "#4c4e52", M.metal, 16);
  fan.rotateX(Math.PI / 2);
  fan.translate(0.12, 0, 0.145);
  out.push(fan);
  for (let i = -2; i <= 2; i++) out.push(xf(box(0.36, 0.012, 0.01, "#9a9c9e"), 0.12, i * 0.06, 0.165));
  out.push(xf(box(0.06, 0.9, 0.06, "#e0ddd0"), -0.32, 0.6, -0.08));
  return out;
}

function pottedPlant(r: number, seed: number): Geo[] {
  const pot = cyl(r * 0.8, r * 0.6, r * 1.2, "#8f5236", M.plain, 10);
  pot.translate(0, r * 0.6, 0);
  const leaves = prep(blob(r * 1.2, 1, 0.25, seed), "#22442b", M.foliage);
  spherize(leaves, V(0, 0, 0), 0.6);
  leaves.translate(0, r * 1.9, 0);
  return [pot, leaves];
}

/** Leaf card: alpha-cut leaf cluster quad facing `dir`, normal set to `nrm` (for coherent shading). */
export function leafCard(c: THREE.Vector3, dir: THREE.Vector3, size: number, color: string, nrm: THREE.Vector3, roll: number, mat: number = M.leafCard, cell: number = LEAF_CELL.ovate): Geo {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ...cellUv(cell, uv.getX(i), uv.getY(i)));
  g.rotateZ(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(c.x, c.y, c.z);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, nrm.x, nrm.y, nrm.z);
  return prep(g, color, mat);
}

/** Climbing vines: leaf cards scattered up a wall or along a rail (local, facing +Z). */
function vines(h: number, w: number, seed: number): Geo[] {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  for (let i = 0; i < Math.round(h * w * 14); i++) {
    const y = Math.pow(r(), 0.7) * h;
    const x = range(r, -w / 2, w / 2) * (1 - (y / h) * 0.5);
    const d = V(range(r, -0.4, 0.4), range(r, -0.2, 0.5), 1).normalize();
    out.push(leafCard(V(x, y, 0.04), d, range(r, 0.22, 0.36), r() > 0.5 ? "#1c3b28" : "#24462b", V(0, 0.3, 1).normalize(), r() * 6.28));
  }
  return out;
}

export interface HouseOpts {
  w: number;
  d: number;
  floors: 1 | 2;
  shop?: boolean;
  seed: number;
  ac?: boolean;
  balcony?: boolean;
}

/**
 * Traditional wooden house (machiya-style), front facing local +Z, the -X side faces the road.
 * Both visible faces are dressed: koshi lattices, sliding doors, shoji, lanterns, AC, vines.
 */
export function house(o: HouseOpts): Geo {
  const r = mulberry32(o.seed);
  const { w, d } = o;
  const out: Geo[] = [];
  const f1 = 2.75;
  const f2 = 2.45;
  const base = 0.35;
  out.push(xf(box(w + 0.15, base, d + 0.15, STONE, M.stone), 0, base / 2, 0));
  // Ground floor: stained vertical boards with a plaster band under the eave.
  out.push(xf(box(w, f1 - 0.4, d, WOOD_STAIN, M.planks), 0, base + (f1 - 0.4) / 2, 0));
  out.push(xf(box(w + 0.02, 0.4, d + 0.02, PLASTER), 0, base + f1 - 0.2, 0));
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(xf(box(0.14, f1, 0.14, WOOD_DARK), (sx * w) / 2, base + f1 / 2, (sz * d) / 2));
  const zf = d / 2 + 0.03;
  if (o.shop) {
    for (const g of slidingDoor(w * 0.5, 2.0)) out.push(xf(g, -w * 0.15, base + 1.0, zf));
    // Faint warm interior behind the doors (daylight: dim, never a lamp).
    out.push(xf(prep(new THREE.BoxGeometry(w * 0.48, 1.9, 0.02), "#6a4a2a", M.lantern), -w * 0.15, base + 0.98, zf - 0.03));
    const nPanels = 4;
    const nw = (w * 0.5) / nPanels;
    for (let i = 0; i < nPanels; i++) {
      const p = prep(new THREE.BoxGeometry(nw - 0.03, 0.72, 0.025, 1, 4, 1), "#253566", M.cloth);
      const pa = p.attributes.position;
      const wa = p.attributes.aWind as THREE.BufferAttribute;
      for (let k = 0; k < pa.count; k++) wa.setX(k, Math.pow((0.36 - pa.getY(k)) / 0.72, 2) * 0.1);
      xf(p, -w * 0.4 + nw * (i + 0.5), base + 1.72, zf + 0.14);
      out.push(p);
      if (i === 1 || i === 2) {
        const c = cyl(0.11, 0.11, 0.03, "#f2eee4", M.cloth, 12);
        c.rotateX(Math.PI / 2);
        c.translate(-w * 0.4 + nw * (i + 0.5) + (i === 1 ? nw / 2 - 0.05 : -nw / 2 + 0.05), base + 1.78, zf + 0.16);
        out.push(c);
      }
    }
    out.push(xf(box(w * 0.52, 0.05, 0.05, WOOD_DARK), -w * 0.15, base + 2.1, zf + 0.14));
    // Koshi lattice on the other half of the shopfront.
    for (const g of koshi(w * 0.32, 1.5)) out.push(xf(g, w * 0.28, base + 1.25, zf + 0.02));
    // Vertical sign board.
    const sx = w / 2 - 0.3;
    out.push(xf(box(0.42, 1.7, 0.08, "#d24e76", M.metal), sx, base + 3.3, zf + 0.5));
    for (let i = 0; i < 4; i++) out.push(xf(box(0.24, 0.22, 0.1, "#fbf3ea", M.plain), sx, base + 3.95 - i * 0.38, zf + 0.51));
    // Vending machine, bench, crates.
    out.push(xf(box(0.9, 1.8, 0.7, "#e2e0da", M.metal), -w / 2 - 0.6, 0.9, d / 2 - 0.5));
    out.push(xf(box(0.72, 0.8, 0.06, "#c43a36", M.metal), -w / 2 - 0.6, 1.25, d / 2 - 0.13));
    for (let i = 0; i < 3; i++) out.push(xf(box(0.16, 0.26, 0.06, ["#e7c44a", "#4a86c4", "#e25c4a"][i], M.metal), -w / 2 - 0.85 + i * 0.25, 1.35, d / 2 - 0.09));
    out.push(xf(box(1.6, 0.08, 0.4, WOOD_LIGHT), w * 0.2, 0.45, d / 2 + 0.9));
    for (const x of [-0.65, 0.65]) out.push(xf(box(0.07, 0.42, 0.34, WOOD_DARK), w * 0.2 + x, 0.21, d / 2 + 0.9));
    out.push(xf(box(0.5, 0.3, 0.35, "#3a6a9a", M.metal), w * 0.2 + 1.2, 0.15, d / 2 + 0.7));
  } else {
    for (const g of slidingDoor(w * 0.34, 1.95)) out.push(xf(g, -w * 0.25, base + 0.98, zf));
    for (const g of koshi(w * 0.4, 1.3)) out.push(xf(g, w * 0.2, base + 1.35, zf + 0.02));
    out.push(xf(panel(w * 0.4, 1.3, M.shoji), w * 0.2, base + 1.35, zf - 0.01));
    out.push(xf(box(w * 0.5, 0.12, 0.6, WOOD_LIGHT), -w * 0.18, base + 0.1, d / 2 + 0.3));
  }
  // Lanterns flanking the door.
  for (const x of o.shop ? [-w * 0.45, w * 0.08] : [-w * 0.45]) {
    const l = prep(new THREE.SphereGeometry(0.2, 12, 8), r() > 0.5 ? "#f2ede0" : "#d8453a", M.lantern);
    l.scale(1, 1.3, 1);
    l.translate(x, base + 2.3, zf + 0.75);
    out.push(l);
    out.push(xf(box(0.22, 0.05, 0.22, "#2a2220"), x, base + 2.57, zf + 0.75));
  }
  // Road-facing side (-X): koshi window, shoji, downpipe.
  {
    const side: Geo[] = [];
    for (const g of koshi(1.6, 1.0)) side.push(xf(g, -d * 0.18, base + 1.55, 0.02));
    side.push(xf(panel(1.6, 1.0, M.shoji), -d * 0.18, base + 1.55, -0.01));
    side.push(xf(panel(0.9, 1.6, M.glass), d * 0.28, base + 1.1, 0));
    for (const g of side) {
      g.rotateY(-Math.PI / 2);
      g.translate(-w / 2 - 0.03, 0, 0);
      out.push(g);
    }
  }
  // Far side (+X): one shoji window.
  {
    const g = panel(1.2, 0.9, M.shoji);
    g.rotateY(Math.PI / 2);
    g.translate(w / 2 + 0.03, base + 1.6, range(r, -d * 0.2, d * 0.2));
    out.push(g);
  }
  let roofY = base + f1;
  out.push(...hisashi(w + 0.6, 1.2, roofY + 0.25, d / 2));
  // Side hisashi on the road-facing wall.
  for (const g of hisashi(d * 0.7, 0.9, roofY + 0.2, w / 2 - 0.05)) {
    g.rotateY(-Math.PI / 2);
    out.push(g);
  }
  if (o.floors === 2) {
    const w2 = w - 0.3, d2 = d - 0.6;
    const z2 = -0.1;
    out.push(xf(box(w2, f2 - 0.45, d2, WOOD_STAIN, M.planks), 0, roofY + (f2 - 0.45) / 2, z2));
    out.push(xf(box(w2 + 0.02, 0.45, d2 + 0.02, PLASTER), 0, roofY + f2 - 0.225, z2));
    const zf2 = z2 + d2 / 2 + 0.03;
    for (const g of koshi(w2 * 0.3, 0.95)) out.push(xf(g, -w2 * 0.25, roofY + 1.3, zf2 + 0.02));
    out.push(xf(panel(w2 * 0.3, 0.95, M.shoji), -w2 * 0.25, roofY + 1.3, zf2 - 0.01));
    out.push(xf(panel(w2 * 0.28, 1.1, M.shoji), w2 * 0.22, roofY + 1.25, zf2));
    for (const x of [-w2 / 2 + 0.05, w2 / 2 - 0.05]) out.push(xf(box(0.12, f2, 0.12, WOOD_DARK), x, roofY + f2 / 2, zf2));
    out.push(xf(box(w2, 0.1, 0.06, WOOD_DARK), 0, roofY + f2 - 0.45, zf2 + 0.01));
    // 2F road-side window.
    {
      const g = panel(1.4, 0.9, M.shoji);
      g.rotateY(-Math.PI / 2);
      g.translate(-w2 / 2 - 0.03, roofY + 1.3, z2);
      out.push(g);
      for (const k of koshi(1.4, 0.9)) {
        k.rotateY(-Math.PI / 2);
        k.translate(-w2 / 2 - 0.06, roofY + 1.3, z2);
        out.push(k);
      }
    }
    if (o.balcony !== false) {
      const bw = w2 * 0.5;
      const bx = w2 * 0.2;
      out.push(xf(box(bw, 0.1, 0.85, WOOD_DARK), bx, roofY + 0.62, zf2 + 0.42));
      for (const g of railing(bw, 0.85)) out.push(xf(g, bx, roofY + 0.67, zf2 + 0.82));
      for (const s of [-1, 1]) out.push(xf(box(0.08, 0.7, 0.08, WOOD_DARK), bx + (s * bw) / 2, roofY + 0.3, zf2 + 0.8));
      out.push(xf(box(bw * 0.4, 0.55, 0.04, r() > 0.5 ? "#e8e2d4" : "#d9a3a0", M.cloth), bx - bw * 0.15, roofY + 1.3, zf2 + 0.86));
    }
    roofY += f2;
    for (const g of roof(w2, d2, roofY, 0.5, 0.95)) out.push(g.translate(0, 0, z2));
  } else {
    out.push(...roof(w, d, roofY, 0.5, 0.95));
  }
  if (o.ac) {
    for (const g of acUnit()) out.push(xf(g, -w / 2 - 0.16, base + 0.42, d * 0.3, 0, -Math.PI / 2));
    if (o.floors === 2) for (const g of acUnit()) out.push(xf(g, w * 0.3, base + f1 + 0.62, d / 2 + 0.1));
  }
  for (let i = 0; i < 3; i++) for (const g of pottedPlant(range(r, 0.14, 0.22), o.seed + i)) out.push(xf(g, -w / 2 + 0.3 + i * 0.45, 0, d / 2 + 0.35));
  for (const g of vines(range(r, 2.2, 3.4), 1.0, o.seed * 3)) {
    g.rotateY(-Math.PI / 2);
    g.translate(-w / 2 - 0.02, 0, d / 2 - 0.7);
    out.push(g);
  }
  out.push(xf(cyl(0.04, 0.04, roofY, "#5e5a52", M.metal, 6), -w / 2 - 0.08, roofY / 2, d / 2 - 0.1));
  return merge(out);
}

// ------------------------------------------------------------------ trees

export type TreeKind = "round" | "tall" | "bush" | "cedar";

/** Deep blue-green canopy core; the foliage shader lifts only sunlit upper clusters toward #4f7d3a. */
const LEAF = ["#1b3a2a", "#1e3f2a", "#183628", "#21422b", "#1c3c2e"];

/**
 * Tree prototype, base at origin. `lod`: 0 = hero (leaf-card scalloped silhouette),
 * 1 = distant (fewer, coarser blobs, no cards).
 */
export function tree(kind: TreeKind, seed: number, lod = 0): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const det = lod ? 1 : 2;
  const leaf = (c: THREE.Vector3, rad: number, d = det) => {
    const g = prep(blob(rad, d, 0.16, seed + c.x * 3 + c.y * 7), LEAF[Math.floor(r() * LEAF.length)], M.foliage, 0);
    g.translate(c.x, c.y, c.z);
    return g;
  };
  if (kind === "round" || kind === "tall") {
    const h = kind === "round" ? range(r, 3.2, 4.2) : range(r, 5.5, 6.5);
    const top = V(range(r, -0.3, 0.3), h, range(r, -0.3, 0.3));
    out.push(beam(V(0, -0.3, 0), top, 0.34, "#5b4331", M.bark, 7, 0.2));
    const cr = kind === "round" ? range(r, 3.6, 4.4) : range(r, 3.0, 3.6);
    const center = V(top.x, h + cr * 0.55, top.z);
    const sy = kind === "tall" ? 1.15 : 0.82;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      out.push(beam(V(top.x * 0.6, h * 0.7, top.z * 0.6), V(Math.cos(a) * cr * 0.6, h + range(r, 0.4, 1.4), Math.sin(a) * cr * 0.6), 0.12, "#5b4331", M.bark, 5, 0.06));
    }
    const blobs: Geo[] = [];
    const shell: { c: THREE.Vector3; rad: number }[] = [];
    /** Distance from p to the union of canopy blobs (negative inside). */
    const surfDist = (p: THREE.Vector3) => {
      let d = Infinity;
      for (const s of shell) d = Math.min(d, p.distanceTo(s.c) - s.rad * 0.92);
      return d;
    };
    const n = lod ? 11 : 13;
    // Distant LOD: 3-5 sub-crowns at uneven heights/offsets (keyaki / camphor-like clumps) so the
    // silhouette is lobed and lopsided, never one ball on a stick.
    const subs = Array.from({ length: 3 + Math.floor(r() * 3) }, (_, k) => {
      const a = r() * Math.PI * 2;
      const d = k === 0 ? 0 : cr * range(r, 0.45, 0.8);
      return V(center.x + Math.cos(a) * d, center.y + range(r, -0.45, 0.35) * cr * (kind === "tall" ? 1.4 : 1), center.z + Math.sin(a) * d * 0.8);
    });
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const e = range(r, -0.35, 1.0);
      let c: THREE.Vector3, rad: number;
      if (lod) {
        const sc = subs[i % subs.length];
        const d = cr * range(r, 0.15, 0.4);
        c = V(sc.x + Math.cos(a) * d * Math.cos(e), sc.y + Math.sin(e) * d * 0.7, sc.z + Math.sin(a) * d * Math.cos(e));
        rad = cr * range(r, 0.3, 0.46);
      } else {
        const d = cr * range(r, 0.45, 0.8);
        c = V(center.x + Math.cos(a) * d * Math.cos(e), center.y + Math.sin(e) * d * (kind === "tall" ? 1.2 : 0.75), center.z + Math.sin(a) * d * Math.cos(e));
        rad = cr * range(r, 0.42, 0.62);
      }
      // Hero trees get denser main masses: no big flat facets when one hangs over the camera.
      blobs.push(leaf(c, rad, lod || rad < cr * 0.52 ? det : 3));
      shell.push({ c, rad });
    }
    if (!lod) {
      blobs.push(leaf(center, cr * 0.75, 3));
      shell.push({ c: center, rad: cr * 0.75 });
    } else for (const sc of subs) out.push(beam(V(top.x * 0.7, h * 0.8, top.z * 0.7), sc.clone().multiplyScalar(0.9).setY(sc.y - cr * 0.2), 0.1, "#5b4331", M.bark, 4, 0.05));
    for (const b of blobs) {
      spherize(b, center, lod ? 0.45 : 0.72, kind === "tall" ? 0.8 : 1.2);
      out.push(b);
    }
    if (lod) {
      // Leafy fringe on every sub-crown: cards sit on the lobe shells, so the edge breaks up.
      const cell = kind === "tall" ? LEAF_CELL.small : LEAF_CELL.ovate;
      for (let i = 0; i < 44; i++) {
        const s = shell[Math.floor(r() * shell.length)];
        const dir = randDir(r);
        if (dir.y < -0.3) continue;
        const c = s.c.clone().addScaledVector(dir, s.rad * 0.95);
        if (surfDist(c) > 0.2) continue;
        out.push(leafCard(c, dir, cr * range(r, 0.26, 0.38), LEAF[Math.floor(r() * LEAF.length)], dir, r() * 6.28, M.fringeCard, cell));
      }
    }
    if (!lod) {
      // Scalloped silhouette: leaf-cluster cards around the canopy shell, plus a few lumps.
      for (let i = 0; i < 16; i++) {
        const dir = randDir(r);
        let rad = cr * range(r, 0.88, 1.0);
        const c = center.clone().add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        for (let s = 0; s < 24 && surfDist(c) > 0; s++) {
          rad *= 0.95;
          c.copy(center).add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        }
        const g = leaf(c, cr * range(r, 0.16, 0.24));
        spherize(g, center, 0.7, 1.2);
        out.push(g);
      }
      const cell = kind === "tall" ? LEAF_CELL.small : LEAF_CELL.ovate;
      for (let i = 0; i < 105; i++) {
        const dir = randDir(r);
        let rad = cr * range(r, 0.98, 1.16);
        const c = center.clone().add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        // Pull the card in until it sits on the blob shell (never a clump floating in the air).
        for (let s = 0; s < 24 && surfDist(c) > 0.12; s++) {
          rad *= 0.95;
          c.copy(center).add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        }
        if (surfDist(c) > 0.3) continue;
        const nrm = dir.clone().normalize();
        const facing = dir.clone().add(V(range(r, -0.5, 0.5), range(r, -0.3, 0.5), range(r, -0.5, 0.5))).normalize();
        out.push(leafCard(c, facing, cr * range(r, 0.16, 0.24), LEAF[Math.floor(r() * LEAF.length)], nrm, r() * 6.28, M.leafCard, r() < 0.8 ? cell : LEAF_CELL.small));
      }
      // Serrated fringe: cards straddling the lower rim and underside so the silhouette seen from
      // below breaks into leaf clusters instead of a smooth blob edge.
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2;
        const dy = range(r, -0.9, 0.3);
        const dir = V(Math.cos(a) * Math.sqrt(1 - dy * dy), dy, Math.sin(a) * Math.sqrt(1 - dy * dy));
        let rad = cr * 1.6;
        const c = center.clone().add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        // surfDist is measured to a 0.92 shell, so this straddles the real (noisy) blob surface.
        const out0 = range(r, 0.45, 0.75);
        for (let s = 0; s < 40 && surfDist(c) > out0; s++) {
          rad *= 0.96;
          c.copy(center).add(V(dir.x * rad, dir.y * rad * sy, dir.z * rad));
        }
        if (surfDist(c) > out0 + 0.2) continue;
        const facing = dir.clone().add(V(range(r, -0.6, 0.6), range(r, -0.6, 0.2), range(r, -0.6, 0.6))).normalize();
        out.push(leafCard(c, facing, cr * range(r, 0.2, 0.3), LEAF[Math.floor(r() * LEAF.length)], dir, r() * 6.28, M.fringeCard, cell));
      }
    }
  } else if (kind === "bush") {
    // Shrub = layered leaf cards around a small, dark, hidden core (never a bare striped sphere).
    const center = V(0, 0.7, 0);
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      const c = V(Math.cos(a) * 0.5, range(r, 0.45, 0.85), Math.sin(a) * 0.5);
      const b = prep(blob(range(r, 0.42, 0.6), 1, 0.16, seed + i * 5), "#10241a", M.foliage, 0);
      b.translate(c.x, c.y, c.z);
      spherize(b, center, 0.6);
      out.push(b);
    }
    // Twigs through the gaps.
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      out.push(beam(V(0, 0, 0), V(Math.cos(a) * 1.0, range(r, 0.7, 1.3), Math.sin(a) * 1.0), 0.025, "#4a3a2a", M.bark, 4, 0.01));
    }
    const nCards = lod ? 50 : 100;
    for (let i = 0; i < nCards; i++) {
      const dir = randDir(r);
      if (dir.y < -0.35) continue;
      // Three shells: inner cards darker (occluded), outer ones catch the light.
      const shellR = range(r, 0.85, 1.4);
      const c = center.clone().add(V(dir.x * shellR, dir.y * 0.75 * shellR + 0.15, dir.z * shellR));
      const facing = dir.clone().add(V(range(r, -0.5, 0.5), range(r, -0.2, 0.5), range(r, -0.5, 0.5))).normalize();
      const cell = r() < 0.7 ? LEAF_CELL.broad : LEAF_CELL.ovate;
      out.push(leafCard(c, facing, range(r, 0.45, 0.7) * (lod ? 1.3 : 1), LEAF[Math.floor(r() * LEAF.length)], dir, r() * 6.28, M.leafCard, cell));
    }
  } else {
    // Japanese cedar: one continuous lumpy spire (overlapping masses, no separated tiers).
    const h = range(r, 9, 12);
    out.push(beam(V(0, -0.3, 0), V(0, h * 0.9, 0), 0.3, "#4e3a2a", M.bark, 6, 0.08));
    const y0 = h * 0.3, y1 = h * 1.02;
    const coneR = (y: number) => 2.1 * (1 - (y - y0) / (y1 - y0)) + 0.35;
    const core = lod ? 4 : 5;
    for (let i = 0; i < core; i++) {
      const t = i / (core - 1);
      const y = y0 + 0.4 + t * (y1 - y0 - 1.0);
      const rad = coneR(y) * 0.95 + 0.25;
      const g = prep(blob(rad, 1, 0.2, seed + i * 11), LEAF[i % LEAF.length], M.foliage);
      g.scale(1, 1.25, 1);
      g.translate(range(r, -0.12, 0.12), y, range(r, -0.12, 0.12));
      spherize(g, V(0, y - 0.6, 0), 0.6, 0.7);
      out.push(g);
    }
    // Lumps on the flanks break the cone into a soft, irregular silhouette.
    for (let i = 0; i < (lod ? 3 : 8); i++) {
      const y = y0 + 0.3 + r() * (y1 - y0 - 1.4);
      const a = r() * Math.PI * 2;
      const cr = coneR(y) * 0.85;
      const g = prep(blob(cr * range(r, 0.4, 0.6) + 0.2, 1, 0.2, seed + 100 + i), LEAF[Math.floor(r() * LEAF.length)], M.foliage);
      g.scale(1, 1.1, 1);
      g.translate(Math.cos(a) * cr, y, Math.sin(a) * cr);
      spherize(g, V(0, y - 0.6, 0), 0.6, 0.7);
      out.push(g);
    }
    // Needle-spray cards over the whole spire: a feathery silhouette instead of smooth lumps.
    for (let i = 0; i < (lod ? 40 : 90); i++) {
      const y = y0 + 0.2 + Math.pow(r(), 0.8) * (y1 - y0 - 0.2);
      const a = r() * Math.PI * 2;
      const rr = coneR(y) * range(r, 0.95, 1.2);
      const dir = V(Math.cos(a), range(r, -0.3, 0.4), Math.sin(a)).normalize();
      out.push(leafCard(V(Math.cos(a) * rr, y, Math.sin(a) * rr), dir, range(r, 0.9, 1.4), LEAF[Math.floor(r() * LEAF.length)], dir, r() * 6.28, M.fringeCard, LEAF_CELL.small));
    }
  }
  return merge(out);
}

function randDir(r: () => number): THREE.Vector3 {
  const u = r() * 2 - 1, a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return V(s * Math.cos(a), u * 0.85 + 0.12, s * Math.sin(a)).normalize();
}

// ------------------------------------------------------------------ infrastructure

/** Wooden utility pole; crossarm along local X. Returns geometry + insulator tip points (local). */
export function pole(h: number, transformer: boolean): { geo: Geo; tips: THREE.Vector3[] } {
  const out: Geo[] = [];
  out.push(beam(V(0, -0.3, 0), V(0, h, 0), 0.15, "#6e5d49", M.bark, 8, 0.12));
  const gs = cyl(0.17, 0.17, 1.8, "#ffffff", M.guard, 10);
  gs.translate(0, 0.9, 0);
  out.push(gs);
  out.push(xf(box(1.7, 0.12, 0.12, "#4a3d30"), 0, h - 0.5, 0));
  out.push(xf(box(1.1, 0.1, 0.1, "#4a3d30"), 0, h - 1.3, 0));
  const tips: THREE.Vector3[] = [];
  for (const x of [-0.7, 0, 0.7]) {
    out.push(xf(cyl(0.05, 0.06, 0.16, "#dcdcd4", M.metal, 6), x, h - 0.36, 0));
    tips.push(V(x, h - 0.28, 0));
  }
  for (const x of [-0.45, 0.45]) {
    out.push(xf(cyl(0.04, 0.05, 0.12, "#dcdcd4", M.metal, 6), x, h - 1.18, 0));
    tips.push(V(x, h - 1.12, 0));
  }
  out.push(beam(V(-0.6, h - 0.55, 0), V(0, h - 1.1, 0), 0.03, "#4a4a4a", M.metal, 4));
  out.push(beam(V(0.6, h - 0.55, 0), V(0, h - 1.1, 0), 0.03, "#4a4a4a", M.metal, 4));
  if (transformer) {
    out.push(xf(cyl(0.28, 0.28, 0.8, "#8f959a", M.metal, 12), 0.38, h - 2.6, 0));
    out.push(xf(cyl(0.3, 0.3, 0.06, "#747a7e", M.metal, 12), 0.38, h - 2.18, 0));
  }
  for (let y = 2.2; y < h - 1.5; y += 0.45) out.push(xf(box(0.22, 0.03, 0.03, "#555"), 0, y, 0, 0, y * 2.0));
  return { geo: merge(out), tips };
}

/** Yellow diamond warning sign, board facing local +Z. */
export function warningSign(kind: number): Geo {
  const out: Geo[] = [];
  out.push(xf(cyl(0.035, 0.035, 2.4, "#b8bcc0", M.metal, 6), 0, 1.2, -0.03));
  const b = box(0.62, 0.62, 0.03, "#eeb622", M.metal);
  xf(b, 0, 2.25, 0.02, 0, 0, Math.PI / 4);
  out.push(b);
  const bk = box(0.7, 0.7, 0.02, "#1e1a16", M.metal);
  xf(bk, 0, 2.25, -0.005, 0, 0, Math.PI / 4);
  out.push(bk);
  const ink = "#1b1814";
  if (kind === 0) {
    out.push(xf(box(0.07, 0.3, 0.02, ink), -0.02, 2.13, 0.045));
    out.push(xf(box(0.07, 0.22, 0.02, ink), 0.06, 2.34, 0.045, 0, 0, -0.6));
    out.push(xf(box(0.16, 0.05, 0.02, ink), 0.12, 2.43, 0.045, 0, 0, -0.6));
  } else if (kind === 1) {
    for (const x of [-0.09, 0.09]) {
      out.push(xf(cyl(0.035, 0.035, 0.02, ink, M.metal, 10), x, 2.4, 0.045, Math.PI / 2));
      out.push(xf(box(0.06, 0.2, 0.02, ink), x, 2.24, 0.045));
      out.push(xf(box(0.04, 0.14, 0.02, ink), x - 0.03, 2.09, 0.045, 0, 0, 0.3));
      out.push(xf(box(0.04, 0.14, 0.02, ink), x + 0.03, 2.09, 0.045, 0, 0, -0.3));
    }
  } else {
    out.push(xf(box(0.07, 0.26, 0.02, ink), 0, 2.12, 0.045));
    out.push(xf(box(0.06, 0.2, 0.02, ink), -0.07, 2.32, 0.045, 0, 0, 0.55));
    out.push(xf(box(0.06, 0.2, 0.02, ink), 0.07, 2.32, 0.045, 0, 0, -0.55));
  }
  return merge(out);
}

/** Red Japanese post box. */
export function postBox(): Geo {
  const red = "#c42e28";
  const out: Geo[] = [];
  out.push(xf(cyl(0.09, 0.11, 0.35, "#3a3432", M.metal, 8), 0, 0.17, 0));
  out.push(xf(cyl(0.26, 0.26, 0.95, red, M.metal, 16), 0, 0.82, 0));
  const top = prep(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, M.metal);
  top.scale(1, 0.45, 1);
  top.translate(0, 1.29, 0);
  out.push(top);
  out.push(xf(box(0.26, 0.05, 0.05, "#1a1412"), 0, 1.08, 0.25));
  out.push(xf(box(0.18, 0.12, 0.02, "#f4eee2"), 0, 0.72, 0.26));
  out.push(xf(box(0.06, 0.12, 0.02, red), 0, 0.72, 0.27));
  return merge(out);
}

/** Post-and-rail fence segment along local X from 0 to len, optional leaf-card vines. */
export function fence(len: number, h: number, color: string, seed: number, withVines: boolean): Geo[] {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const n = Math.max(1, Math.round(len / 1.8));
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * len;
    out.push(xf(box(0.1, h + 0.1, 0.1, color, M.bark), x, (h + 0.1) / 2 - 0.05, 0, 0, range(r, -0.1, 0.1), range(r, -0.04, 0.04)));
  }
  for (const y of [h * 0.45, h * 0.92]) {
    const rail = prep(new THREE.BoxGeometry(len, 0.07, 0.05, Math.max(1, Math.round(len / 2)), 1, 1), color, M.bark);
    xf(rail, len / 2, y, 0.06);
    out.push(rail);
  }
  if (withVines) {
    // Vines hug the timber: climbing up posts from the ground, or trailing along a rail.
    const rails = [h * 0.45, h * 0.92];
    const leafAt = (x: number, y: number, s: number) => {
      const d = V(range(r, -0.35, 0.35), range(r, -0.15, 0.4), 1).normalize();
      out.push(leafCard(V(x, y, 0.1), d, s, r() > 0.5 ? "#1c3b28" : "#24462b", V(0, 0.4, 1).normalize(), r() * 6.28));
    };
    for (let i = 0; i <= n; i++) {
      if (r() < 0.55) continue;
      const px = (i / n) * len;
      const top = range(r, 0.35, 1) * (h + 0.05);
      for (let y = 0.05; y < top; y += range(r, 0.09, 0.15)) leafAt(px + range(r, -0.07, 0.07), y, range(r, 0.13, 0.2));
      // A short run out along the upper or lower rail from the post.
      const ry = rails[r() < 0.5 ? 0 : 1];
      if (ry > top) continue;
      const run = range(r, 0.2, 0.9) * (r() < 0.5 ? -1 : 1);
      for (let k = 0; k < 7; k++) {
        const x = px + (run * k) / 6;
        if (x < 0 || x > len) break;
        leafAt(x, ry + range(r, -0.05, 0.05), range(r, 0.12, 0.19));
      }
    }
  }
  return out;
}

/** Roadside stone marker (jizo-like) with a red bib. */
export function stoneMarker(): Geo {
  const out: Geo[] = [];
  out.push(xf(box(0.34, 0.12, 0.34, STONE, M.stone), 0, 0.06, 0));
  const s = sphere(0.14, "#a39d92", M.stone, 10, 8);
  s.scale(1, 2.2, 0.8);
  s.translate(0, 0.42, 0);
  out.push(s);
  out.push(xf(box(0.2, 0.14, 0.12, "#c9302a", M.cloth), 0, 0.42, 0.08));
  return merge(out);
}

// ------------------------------------------------------------------ far field (cheap, merged)

/** Distant farmhouse: plaster / dark-board box under a tile or tin gable roof, sometimes an annex. */
export function farHouse(seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const w = range(r, 6, 10), d = range(r, 5, 7), h = r() > 0.6 ? range(r, 4.6, 5.4) : range(r, 2.6, 3.2);
  const wall = r() > 0.45 ? PLASTER : WOOD_STAIN;
  const tin = r() > 0.7;
  const roofCol = tin ? (r() > 0.5 ? "#8a4a34" : "#4f6878") : TILE;
  const addBlock = (bw: number, bd: number, bh: number, x: number, z: number, pitch: number) => {
    out.push(xf(box(bw, bh, bd, wall, M.plain), x, bh / 2, z));
    out.push(xf(box(bw + 0.1, 0.5, bd + 0.05, WOOD_DARK), x, 0.25, z));
    const half = bd / 2 + 0.7;
    const slope = half / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const g = box(bw + 1.2, 0.2, slope, roofCol, tin ? M.metal : M.roof);
      g.rotateX(s * pitch);
      g.translate(x, bh + (bd / 2) * Math.tan(pitch) - (half * Math.tan(pitch)) / 2 + 0.1, z + (s * half) / 2);
      out.push(g);
    }
    for (const s of [-1, 1]) {
      const gb = gable(bd, (bd / 2) * Math.tan(pitch), 0.1, wall, M.plain);
      gb.rotateY(Math.PI / 2);
      gb.translate(x + (s * bw) / 2 - s * 0.05, bh, z);
      out.push(gb);
    }
    // Window band (shoji / glass) on the long faces.
    for (const s of [-1, 1]) out.push(xf(box(bw * 0.7, 0.9, 0.06, "#e8dcc0", M.plain), x, bh * 0.55, z + s * (bd / 2 + 0.02)));
  };
  addBlock(w, d, h, 0, 0, range(r, 0.45, 0.6));
  if (r() > 0.45) addBlock(w * range(r, 0.4, 0.6), d * 0.8, h > 4 ? h * 0.55 : h * 0.9, w * 0.5 + 1.5, range(r, -1, 1), 0.5);
  return merge(out);
}

/** Village school: three storeys, window bands, flat roof, clock on the stair tower. */
export function school(): Geo {
  const out: Geo[] = [];
  const W = 34, D = 9, H = 10.5;
  out.push(xf(box(W, H, D, "#e9e4d6", M.plain), 0, H / 2, 0));
  out.push(xf(box(W + 0.4, 0.5, D + 0.4, "#b9b4a8", M.plain), 0, H + 0.25, 0));
  for (let f = 0; f < 3; f++) {
    out.push(xf(box(W - 2, 1.5, 0.08, "#5f7488", M.plain), 0, 1.6 + f * 3.3, D / 2 + 0.04));
    out.push(xf(box(W - 1, 0.18, 0.5, "#cfc9ba", M.plain), 0, 0.7 + f * 3.3, D / 2 + 0.25));
    for (let i = 0; i <= 12; i++) out.push(xf(box(0.14, 1.5, 0.12, "#e9e4d6", M.plain), -W / 2 + 1 + (i * (W - 2)) / 12, 1.6 + f * 3.3, D / 2 + 0.08));
  }
  // Stair tower + clock face (white disc, dark rim, two hands).
  out.push(xf(box(5, H + 3, 5, "#e3ddcd", M.plain), W / 2 - 4, (H + 3) / 2, 0.8));
  const face = prep(new THREE.CircleGeometry(1.25, 20), "#f6f2e6", M.plain);
  face.translate(W / 2 - 4, H + 1, 3.33);
  out.push(face);
  const rim = prep(new THREE.RingGeometry(1.25, 1.45, 20), "#2a2622", M.plain);
  rim.translate(W / 2 - 4, H + 1, 3.34);
  out.push(rim);
  out.push(xf(box(0.14, 0.95, 0.05, "#2a2622"), W / 2 - 4, H + 1.4, 3.37));
  out.push(xf(box(0.7, 0.14, 0.05, "#2a2622"), W / 2 - 4 + 0.32, H + 1, 3.37));
  // Gym roof (barrel) beside it.
  const gym = prep(new THREE.CylinderGeometry(9, 9, 20, 16, 1, false, 0, Math.PI), "#6f8494", M.metal);
  gym.rotateZ(Math.PI / 2);
  gym.rotateY(Math.PI / 2);
  gym.scale(1, 0.32, 1);
  gym.translate(-W / 2 - 12, 6, 0);
  out.push(gym);
  out.push(xf(box(18, 6, 20, "#e2dccb", M.plain), -W / 2 - 12, 3, 0));
  return merge(out);
}

/** Steel-legged water tower (tank on four braced legs). */
export function waterTower(): Geo {
  const out: Geo[] = [];
  const H = 16;
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) out.push(beam(V(x * 1.3, 0, z * 1.3), V(x * 0.8, H, z * 0.8), 0.18, "#8c9290", M.metal, 5));
  for (let y = 4; y < H; y += 4) out.push(xf(box(4.2, 0.15, 4.2, "#8c9290", M.metal), 0, y, 0));
  out.push(xf(cyl(3, 3, 4.2, "#c4c8c2", M.metal, 16), 0, H + 2.1, 0));
  out.push(xf(cyl(0.2, 3.1, 1.2, "#aeb3ad", M.metal, 16), 0, H + 4.8, 0));
  return merge(out);
}

/** Small field shed: weathered boards under a rusted tin lean-to. */
export function shed(seed: number): Geo {
  const r = mulberry32(seed);
  const w = range(r, 2.4, 3.6), d = range(r, 2, 2.8), h = range(r, 2, 2.5);
  const out: Geo[] = [xf(box(w, h, d, r() > 0.5 ? WOOD : "#6a5a48", M.planks), 0, h / 2, 0)];
  const tin = box(w + 0.5, 0.08, d + 0.7, r() > 0.5 ? "#8a553a" : "#6f7f86", M.metal);
  tin.rotateX(0.2);
  tin.translate(0, h + 0.25, 0);
  out.push(tin);
  out.push(xf(box(0.9, 1.7, 0.05, WOOD_DARK), w * 0.2, 0.85, d / 2 + 0.03));
  return merge(out);
}

/** Scarecrow (kakashi): post, crossbar arms, faded shirt, straw hat. */
export function scarecrow(seed: number): Geo {
  const r = mulberry32(seed);
  const shirt = ["#5f7ea0", "#a8584a", "#c8b890"][Math.floor(r() * 3)];
  const out: Geo[] = [
    beam(V(0, -0.3, 0), V(0, 1.9, 0), 0.04, "#6e5d49", M.bark, 5),
    beam(V(-0.75, 1.35, 0), V(0.75, 1.4, 0), 0.03, "#6e5d49", M.bark, 5),
    xf(box(0.5, 0.6, 0.22, shirt, M.cloth), 0, 1.2, 0),
    xf(box(1.3, 0.16, 0.18, shirt, M.cloth), 0, 1.38, 0),
    xf(sphere(0.16, "#e8e0c8"), 0, 1.72, 0),
  ];
  const hat = prep(new THREE.ConeGeometry(0.36, 0.2, 10), "#d8c078", M.plain);
  hat.translate(0, 1.9, 0);
  out.push(hat);
  return merge(out);
}

/** Bamboo grove clump: tall pale culms leaning outward, feathery leaf sprays toward the top. */
export function bambooGrove(seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.2;
    const base = V(Math.cos(a) * d, -0.2, Math.sin(a) * d);
    const h = range(r, 9, 14);
    const lean = V(Math.cos(a) * range(r, 0.6, 2.2), h, Math.sin(a) * range(r, 0.6, 2.2));
    const tip = base.clone().add(lean);
    out.push(beam(base, tip, 0.07, i % 3 ? "#7e9a50" : "#93a860", M.plain, 5, 0.035));
    for (let k = 0; k < 7; k++) {
      const t = range(r, 0.45, 1.0);
      const c = base.clone().lerp(tip, t);
      const dir = V(range(r, -1, 1), range(r, -0.2, 0.5), range(r, -1, 1)).normalize();
      out.push(leafCard(c.addScaledVector(dir, 0.5), dir, range(r, 1.4, 2.1), ["#3f6a34", "#4f7a3a", "#35602e"][k % 3], dir, r() * 6.28, M.fringeCard, LEAF_CELL.lance));
    }
  }
  return merge(out);
}
