import * as THREE from "three";
import { M, beam, blob, box, boxM, cyl, merge, prep, sphere, spherize, xf } from "./geo";
import { mulberry32, range } from "../core/rng";

type Geo = THREE.BufferGeometry;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const WOOD_DARK = "#5a3a24";
const WOOD = "#7a5234";
const WOOD_LIGHT = "#a27a50";
const PLASTER = "#e2d6b8";
const TILE = "#4a5160";
const TILE_DARK = "#373d4a";
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

/**
 * Gable roof over a footprint w (along X, ridge direction) x d (along Z), eaves at y0.
 * Panels are metre-uv boxes so the tile shader lays kawara rows.
 */
function roof(w: number, d: number, y0: number, pitch: number, over: number, color = TILE): Geo[] {
  const out: Geo[] = [];
  const half = d / 2 + over;
  const slope = half / Math.cos(pitch);
  const rise = (d / 2) * Math.tan(pitch);
  for (const s of [-1, 1]) {
    const g = boxM(w + over * 2, 0.16, slope, color, M.roof);
    // Tile uv: u along ridge (x), v down the slope (z).
    g.rotateX(s * pitch);
    g.translate(0, y0 + rise - (half * Math.tan(pitch)) / 2 + 0.08, (s * half) / 2);
    out.push(g);
  }
  const ridge = box(w + over * 2 + 0.1, 0.22, 0.34, TILE_DARK, M.roof);
  xf(ridge, 0, y0 + rise + 0.12, 0);
  out.push(ridge);
  // Ridge end caps (onigawara).
  for (const s of [-1, 1]) {
    const c = box(0.24, 0.42, 0.42, TILE_DARK, M.plain);
    xf(c, s * (w / 2 + over + 0.05), y0 + rise + 0.2, 0);
    out.push(c);
  }
  // Gable walls.
  for (const s of [-1, 1]) {
    const gb = gable(d, rise, 0.1, WOOD, M.planks);
    gb.rotateY(Math.PI / 2);
    gb.translate((s * w) / 2 - s * 0.05, y0, 0);
    out.push(gb);
    // Exposed beam across the gable.
    const bm = box(0.12, 0.14, d + 0.2, WOOD_DARK);
    xf(bm, (s * w) / 2 + s * 0.02, y0 + rise * 0.35, 0);
    out.push(bm);
  }
  // Fascia boards along the eaves.
  for (const s of [-1, 1]) {
    const f = box(w + over * 2, 0.14, 0.1, WOOD_DARK);
    xf(f, 0, y0 + rise - half * Math.tan(pitch) + 0.02, s * (half - 0.02));
    out.push(f);
  }
  return out;
}

/** Sloped lean-to eave (hisashi) projecting from a wall at local +Z. */
function hisashi(w: number, depth: number, y: number, z: number): Geo[] {
  const g = boxM(w, 0.1, depth, TILE, M.roof);
  g.rotateX(0.38);
  g.translate(0, y, z + depth / 2 - 0.05);
  const f = box(w, 0.1, 0.08, WOOD_DARK);
  xf(f, 0, y - Math.sin(0.38) * depth * 0.5 - 0.02, z + depth * Math.cos(0.38) - 0.02);
  const out = [g, f];
  // Brackets.
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
    out.push(xf(box(0.08, 0.08, depth * 0.8, WOOD_DARK), x, y - 0.25, z + depth * 0.4, -0.5));
  }
  return out;
}

function shoji(w: number, h: number): Geo {
  return prep(new THREE.BoxGeometry(w, h, 0.05), "#ffffff", M.shoji);
}

function glowWin(w: number, h: number): Geo {
  return prep(new THREE.BoxGeometry(w, h, 0.05), "#ffffff", M.glow);
}

function railing(w: number, h: number): Geo[] {
  const out: Geo[] = [];
  out.push(xf(box(w, 0.07, 0.08, WOOD_DARK), 0, h, 0));
  out.push(xf(box(w, 0.05, 0.06, WOOD_DARK), 0, 0.08, 0));
  for (let x = -w / 2 + 0.06; x <= w / 2; x += 0.13) out.push(xf(box(0.035, h, 0.035, WOOD), x, h / 2, 0));
  return out;
}

function acUnit(): Geo[] {
  const out: Geo[] = [];
  out.push(box(0.8, 0.56, 0.28, "#dcdad0", M.metal));
  const fan = cyl(0.19, 0.19, 0.03, "#5c5e62", M.metal, 16);
  fan.rotateX(Math.PI / 2);
  fan.translate(0.12, 0, 0.145);
  out.push(fan);
  const hub = cyl(0.05, 0.05, 0.04, "#9a9c9e", M.metal, 8);
  hub.rotateX(Math.PI / 2);
  hub.translate(0.12, 0, 0.16);
  out.push(hub);
  out.push(xf(box(0.06, 0.9, 0.06, "#e9e6da"), -0.32, 0.6, -0.08));
  return out;
}

function pottedPlant(r: number, seed: number): Geo[] {
  const pot = cyl(r * 0.8, r * 0.6, r * 1.2, "#9b5a3a", M.plain, 10);
  pot.translate(0, r * 0.6, 0);
  const leaves = prep(blob(r * 1.2, 1, 0.25, seed), "#4f8f3a", M.foliage);
  spherize(leaves, V(0, 0, 0), 0.6);
  leaves.translate(0, r * 1.9, 0);
  return [pot, leaves];
}

function vines(h: number, seed: number): Geo[] {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  let x = 0;
  for (let y = 0.2; y < h; y += range(r, 0.18, 0.32)) {
    x += range(r, -0.12, 0.12);
    const b = prep(blob(range(r, 0.12, 0.22), 0, 0.3, seed + y), r() > 0.5 ? "#3f7d33" : "#5a9a3c", M.foliage);
    b.translate(x, y, range(r, 0.0, 0.08));
    b.scale(1, 1, 0.55);
    out.push(b);
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

/** Traditional wooden house, front facing local +Z, ground at y=0. */
export function house(o: HouseOpts): Geo {
  const r = mulberry32(o.seed);
  const { w, d } = o;
  const out: Geo[] = [];
  const f1 = 2.75;
  const f2 = 2.45;
  const base = 0.35;
  out.push(xf(box(w + 0.15, base, d + 0.15, STONE, M.stone), 0, base / 2, 0));
  // Ground floor.
  out.push(xf(box(w, f1, d, o.shop ? WOOD_DARK : WOOD, M.planks), 0, base + f1 / 2, 0));
  const zf = d / 2 + 0.03;
  if (o.shop) {
    // Open shop front: warm interior, noren, sign.
    out.push(xf(glowWin(w * 0.7, 2.0), -w * 0.08, base + 1.05, zf));
    out.push(xf(box(w * 0.74, 0.12, 0.12, WOOD_DARK), -w * 0.08, base + 2.12, zf + 0.04));
    const nPanels = 4;
    const nw = (w * 0.56) / nPanels;
    for (let i = 0; i < nPanels; i++) {
      const p = prep(new THREE.BoxGeometry(nw - 0.03, 0.78, 0.025, 1, 4, 1), "#2c3a6e", M.cloth);
      const pa = p.attributes.position;
      const wa = p.attributes.aWind as THREE.BufferAttribute;
      for (let k = 0; k < pa.count; k++) wa.setX(k, Math.pow((0.39 - pa.getY(k)) / 0.78, 2) * 0.12);
      xf(p, -w * 0.36 + nw * (i + 0.5), base + 1.72, zf + 0.12);
      out.push(p);
      // White crest on the noren.
      if (i === 1 || i === 2) {
        const c = cyl(0.11, 0.11, 0.03, "#f2eee4", M.cloth, 12);
        c.rotateX(Math.PI / 2);
        c.translate(-w * 0.36 + nw * (i + 0.5) + (i === 1 ? nw / 2 - 0.05 : -nw / 2 + 0.05), base + 1.78, zf + 0.14);
        out.push(c);
      }
    }
    out.push(xf(box(w * 0.58, 0.05, 0.05, WOOD_DARK), -w * 0.08, base + 2.13, zf + 0.12));
    // Vertical sign board.
    const sx = w / 2 - 0.35;
    out.push(xf(box(0.42, 1.7, 0.08, "#d8527a", M.metal), sx, base + 3.2, zf + 0.35));
    for (let i = 0; i < 4; i++) out.push(xf(box(0.24, 0.22, 0.1, "#fbf3ea", M.plain), sx, base + 3.85 - i * 0.38, zf + 0.36));
    out.push(xf(box(0.06, 0.06, 0.4, WOOD_DARK), sx, base + 4.0, zf + 0.15));
    // Vending machine and bench.
    const vm = box(0.9, 1.8, 0.7, "#e8e6e0", M.metal);
    xf(vm, w / 2 + 0.6, 0.9, d / 2 - 0.5);
    out.push(vm);
    out.push(xf(box(0.72, 0.8, 0.06, "#c43a36", M.metal), w / 2 + 0.6, 1.25, d / 2 - 0.13));
    out.push(xf(glowWin(0.6, 0.5), w / 2 + 0.6, 1.3, d / 2 - 0.1));
    out.push(xf(box(1.6, 0.08, 0.4, WOOD_LIGHT), -w * 0.1, 0.45, d / 2 + 0.8));
    for (const x of [-0.65, 0.65]) out.push(xf(box(0.07, 0.42, 0.34, WOOD_DARK), -w * 0.1 + x, 0.21, d / 2 + 0.8));
    // Lanterns under the eave.
    for (const x of [-w * 0.42, w * 0.25]) {
      const l = prep(new THREE.SphereGeometry(0.2, 12, 8), "#f4efe2", M.lantern);
      l.scale(1, 1.3, 1);
      l.translate(x, base + 2.35, zf + 0.7);
      out.push(l);
      out.push(xf(box(0.22, 0.05, 0.22, "#2a2220"), x, base + 2.62, zf + 0.7));
    }
  } else {
    // Sliding glass doors + shoji window.
    out.push(xf(glowWin(w * 0.36, 1.95), -w * 0.22, base + 1.0, zf));
    out.push(xf(shoji(w * 0.3, 1.1), w * 0.25, base + 1.55, zf));
    out.push(xf(box(w * 0.34, 0.08, 0.2, WOOD_DARK), w * 0.25, base + 0.95, zf + 0.08));
    // Engawa step.
    out.push(xf(box(w * 0.5, 0.12, 0.6, WOOD_LIGHT), -w * 0.18, base + 0.1, d / 2 + 0.3));
  }
  // Side windows.
  for (const s of [-1, 1]) {
    const sw = shoji(1.2, 0.9);
    sw.rotateY((s * Math.PI) / 2);
    sw.translate((s * (w / 2 + 0.03)), base + 1.6, range(r, -d * 0.2, d * 0.2));
    out.push(sw);
  }
  let roofY = base + f1;
  // Lower eave across the front.
  out.push(...hisashi(w + 0.5, 1.05, roofY + 0.25, d / 2));
  if (o.floors === 2) {
    const w2 = w - 0.3, d2 = d - 0.6;
    const z2 = -0.1;
    out.push(xf(box(w2, f2 * 0.8, d2, WOOD, M.planks), 0, roofY + (f2 * 0.8) / 2, z2));
    out.push(xf(box(w2 + 0.02, f2 * 0.2, d2 + 0.02, PLASTER, M.plain), 0, roofY + f2 * 0.8 + (f2 * 0.2) / 2, z2));
    const zf2 = z2 + d2 / 2 + 0.03;
    // Upper windows.
    out.push(xf(shoji(w2 * 0.3, 1.0), -w2 * 0.25, roofY + 1.35, zf2));
    out.push(xf(glowWin(w2 * 0.28, 0.95), w2 * 0.22, roofY + 1.35, zf2));
    // Timber frame lines on the plaster band.
    for (const x of [-w2 / 2 + 0.05, 0, w2 / 2 - 0.05]) out.push(xf(box(0.1, f2 * 0.22, 0.06, WOOD_DARK), x, roofY + f2 * 0.9, zf2 + 0.01));
    out.push(xf(box(w2, 0.1, 0.06, WOOD_DARK), 0, roofY + f2 * 0.8, zf2 + 0.01));
    if (o.balcony !== false) {
      const bw = w2 * 0.5;
      const bx = w2 * 0.2;
      out.push(xf(box(bw, 0.1, 0.85, WOOD_DARK), bx, roofY + 0.62, zf2 + 0.42));
      for (const g of railing(bw, 0.85)) out.push(xf(g, bx, roofY + 0.67, zf2 + 0.82));
      for (const s of [-1, 1]) out.push(xf(box(0.08, 0.7, 0.08, WOOD_DARK), bx + (s * bw) / 2, roofY + 0.3, zf2 + 0.8));
      // Hanging futon / laundry on the rail.
      out.push(xf(box(bw * 0.4, 0.55, 0.04, r() > 0.5 ? "#e8e2d4" : "#d9a3a0", M.cloth), bx - bw * 0.15, roofY + 1.3, zf2 + 0.86));
    }
    roofY += f2;
    for (const g of roof(w2, d2, roofY, 0.5, 0.7)) out.push(g.translate(0, 0, z2));
  } else {
    out.push(...roof(w, d, roofY, 0.5, 0.7));
  }
  if (o.ac) {
    for (const g of acUnit()) out.push(xf(g, w / 2 + 0.16, base + 0.42, -d * 0.1, 0, Math.PI / 2));
    // Outdoor unit on the wall at 2F too (they sit on brackets).
    if (o.floors === 2) for (const g of acUnit()) out.push(xf(g, -w / 2 + 0.6, base + f1 + 0.6, d / 2 - 0.05 - 0.3 + 0.3));
  }
  // Pots and vines.
  for (let i = 0; i < 3; i++) for (const g of pottedPlant(range(r, 0.14, 0.22), o.seed + i)) out.push(xf(g, -w / 2 + 0.3 + i * 0.45, 0, d / 2 + 0.35));
  for (const g of vines(range(r, 2.2, 3.6), o.seed * 3)) out.push(xf(g, -w / 2 - 0.02, 0, d / 2 - 0.2, 0, -Math.PI / 2));
  // Gutter downpipe.
  out.push(xf(cyl(0.04, 0.04, roofY, "#6e6a60", M.metal, 6), w / 2 - 0.1, roofY / 2, d / 2 + 0.05));
  return merge(out);
}

// ------------------------------------------------------------------ trees

export type TreeKind = "round" | "tall" | "bush" | "cedar";

const LEAF = ["#3f7f35", "#4c8d3a", "#5a9a3f", "#356f30", "#66a544"];

/** Tree prototype, base at origin. Returns merged geometry (bark + spherized foliage). */
export function tree(kind: TreeKind, seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const leaf = (c: THREE.Vector3, rad: number, k: number) => {
    const g = prep(blob(rad, 2, 0.16, seed + c.x * 3 + c.y * 7), LEAF[Math.floor(r() * LEAF.length)], M.foliage, 0);
    g.translate(c.x, c.y, c.z);
    return { g, k };
  };
  if (kind === "round" || kind === "tall") {
    const h = kind === "round" ? range(r, 3.2, 4.2) : range(r, 5.5, 6.5);
    const top = V(range(r, -0.3, 0.3), h, range(r, -0.3, 0.3));
    out.push(beam(V(0, -0.3, 0), top, 0.34, "#6b5039", M.bark, 7, 0.2));
    const cr = kind === "round" ? range(r, 3.6, 4.4) : range(r, 3.0, 3.6);
    const center = V(top.x, h + cr * 0.55, top.z);
    // Branches.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      out.push(beam(V(top.x * 0.6, h * 0.7, top.z * 0.6), V(Math.cos(a) * cr * 0.6, h + range(r, 0.4, 1.4), Math.sin(a) * cr * 0.6), 0.12, "#6b5039", M.bark, 5, 0.06));
    }
    const blobs: { g: Geo; k: number }[] = [];
    const n = kind === "round" ? 13 : 11;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const e = range(r, -0.35, 1.0);
      const d = cr * range(r, 0.45, 0.8);
      const c = V(center.x + Math.cos(a) * d * Math.cos(e), center.y + Math.sin(e) * d * (kind === "tall" ? 1.2 : 0.75), center.z + Math.sin(a) * d * Math.cos(e));
      blobs.push(leaf(c, cr * range(r, 0.42, 0.62), 0.65));
    }
    blobs.push(leaf(center, cr * 0.75, 0.6));
    for (const b of blobs) {
      spherize(b.g, center, b.k, kind === "tall" ? 0.8 : 1.2);
      out.push(b.g);
    }
  } else if (kind === "bush") {
    const center = V(0, 0.7, 0);
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      const c = V(Math.cos(a) * 0.7, range(r, 0.5, 1.0), Math.sin(a) * 0.7);
      const b = leaf(c, range(r, 0.55, 0.85), 0.6);
      spherize(b.g, center, 0.6);
      out.push(b.g);
    }
  } else {
    // Japanese cedar: stacked cones of lumpy foliage.
    const h = range(r, 9, 12);
    out.push(beam(V(0, -0.3, 0), V(0, h, 0), 0.3, "#5e4633", M.bark, 6, 0.08));
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = h * (0.28 + t * 0.72);
      const rad = (1 - t) * 1.9 + 0.5;
      const g = prep(blob(rad, 1, 0.22, seed + i * 11), i % 2 ? "#2f5f35" : "#3a6d3a", M.foliage);
      g.scale(1, 0.75, 1);
      g.translate(0, y, 0);
      spherize(g, V(0, y - rad * 0.3, 0), 0.55, 1.4);
      out.push(g);
    }
  }
  return merge(out);
}

// ------------------------------------------------------------------ infrastructure

/** Wooden utility pole; crossarm along local X. Returns geometry + insulator tip points (local). */
export function pole(h: number, transformer: boolean): { geo: Geo; tips: THREE.Vector3[] } {
  const out: Geo[] = [];
  out.push(beam(V(0, -0.3, 0), V(0, h, 0), 0.15, "#7a6853", M.bark, 8, 0.12));
  // Yellow/black guard sleeve.
  const gs = cyl(0.17, 0.17, 1.8, "#ffffff", M.guard, 10);
  gs.translate(0, 0.9, 0);
  out.push(gs);
  out.push(xf(box(1.7, 0.12, 0.12, "#5a4a3a"), 0, h - 0.5, 0));
  out.push(xf(box(1.1, 0.1, 0.1, "#5a4a3a"), 0, h - 1.3, 0));
  const tips: THREE.Vector3[] = [];
  for (const x of [-0.7, 0, 0.7]) {
    out.push(xf(cyl(0.05, 0.06, 0.16, "#e8e8e2", M.metal, 6), x, h - 0.36, 0));
    tips.push(V(x, h - 0.28, 0));
  }
  for (const x of [-0.45, 0.45]) {
    out.push(xf(cyl(0.04, 0.05, 0.12, "#e8e8e2", M.metal, 6), x, h - 1.18, 0));
    tips.push(V(x, h - 1.12, 0));
  }
  // Brace struts.
  out.push(beam(V(-0.6, h - 0.55, 0), V(0, h - 1.1, 0), 0.03, "#4a4a4a", M.metal, 4));
  out.push(beam(V(0.6, h - 0.55, 0), V(0, h - 1.1, 0), 0.03, "#4a4a4a", M.metal, 4));
  if (transformer) {
    out.push(xf(cyl(0.28, 0.28, 0.8, "#9aa0a4", M.metal, 12), 0.38, h - 2.6, 0));
    out.push(xf(cyl(0.3, 0.3, 0.06, "#7c8286", M.metal, 12), 0.38, h - 2.18, 0));
  }
  // Step bolts.
  for (let y = 2.2; y < h - 1.5; y += 0.45) out.push(xf(box(0.22, 0.03, 0.03, "#555"), 0, y, 0, 0, y * 2.0));
  return { geo: merge(out), tips };
}

/** Yellow diamond warning sign, board facing local +Z. */
export function warningSign(kind: number): Geo {
  const out: Geo[] = [];
  out.push(xf(cyl(0.035, 0.035, 2.4, "#c8ccd0", M.metal, 6), 0, 1.2, -0.03));
  const b = box(0.62, 0.62, 0.03, "#f2c028", M.metal);
  xf(b, 0, 2.25, 0.02, 0, 0, Math.PI / 4);
  out.push(b);
  const bk = box(0.7, 0.7, 0.02, "#1e1a16", M.metal);
  xf(bk, 0, 2.25, -0.005, 0, 0, Math.PI / 4);
  out.push(bk);
  const ink = "#1b1814";
  if (kind === 0) {
    // Curve ahead: bent arrow.
    out.push(xf(box(0.07, 0.3, 0.02, ink), -0.02, 2.13, 0.045));
    out.push(xf(box(0.07, 0.22, 0.02, ink), 0.06, 2.34, 0.045, 0, 0, -0.6));
    out.push(xf(box(0.16, 0.05, 0.02, ink), 0.12, 2.43, 0.045, 0, 0, -0.6));
  } else if (kind === 1) {
    // Pedestrians / children: two stick figures.
    for (const x of [-0.09, 0.09]) {
      out.push(xf(cyl(0.035, 0.035, 0.02, ink, M.metal, 10), x, 2.4, 0.045, Math.PI / 2));
      out.push(xf(box(0.06, 0.2, 0.02, ink), x, 2.24, 0.045));
      out.push(xf(box(0.04, 0.14, 0.02, ink), x - 0.03, 2.09, 0.045, 0, 0, 0.3));
      out.push(xf(box(0.04, 0.14, 0.02, ink), x + 0.03, 2.09, 0.045, 0, 0, -0.3));
    }
  } else {
    // Merge / fork symbol (as in the reference).
    out.push(xf(box(0.07, 0.26, 0.02, ink), 0, 2.12, 0.045));
    out.push(xf(box(0.06, 0.2, 0.02, ink), -0.07, 2.32, 0.045, 0, 0, 0.55));
    out.push(xf(box(0.06, 0.2, 0.02, ink), 0.07, 2.32, 0.045, 0, 0, -0.55));
  }
  return merge(out);
}

/** Red Japanese post box. */
export function postBox(): Geo {
  const red = "#c9302a";
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

/** Post-and-rail fence segment along local X from 0 to len, optional vines. */
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
    for (let x = 0.3; x < len; x += range(r, 0.25, 0.9)) {
      if (r() < 0.45) continue;
      const b = prep(blob(range(r, 0.14, 0.3), 0, 0.3, seed + x), r() > 0.5 ? "#3f7d33" : "#5f9e3e", M.foliage);
      b.scale(1, 0.8, 0.7);
      b.translate(x, range(r, 0.1, h), 0.08);
      out.push(b);
    }
  }
  return out;
}

/** Stone lantern-ish jizo shelter? Kept tiny: roadside stone marker. */
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
