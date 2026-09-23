import * as THREE from "three";
import { M, beam, blob, box, cyl, merge, prep, sphere, spherize, xf } from "./geo";
import { signUv } from "../render/signAtlas";
import { mulberry32, range } from "../core/rng";

/** Countryside street furniture. Every builder: base at origin, front facing local +Z. */
type Geo = THREE.BufferGeometry;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const WOOD = "#5c4230";
const WOOD_DARK = "#33241a";
const STONE = "#9a948a";
const CONCRETE = "#a8a49a";
const METAL = "#8c9290";

/** Flat sign plane (w x h) showing atlas entry `name`, facing +Z. */
export function sign(name: string, w: number, h: number, glow = false, segY = 1): Geo {
  const g = new THREE.PlaneGeometry(w, h, 1, segY);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ...signUv(name, uv.getX(i), uv.getY(i)));
  return prep(g, "#ffffff", glow ? M.signGlow : M.sign);
}

/** Two-sided sign: the back face shows the same art mirrored (boards seen from both ways). */
function sign2(name: string, w: number, h: number): Geo[] {
  const a = sign(name, w, h);
  const b = sign(name, w, h);
  b.rotateY(Math.PI);
  b.translate(0, 0, -0.012);
  return [a, b];
}

export function vendingMachine(kind: "vendDrink" | "vendIce"): Geo {
  const out: Geo[] = [];
  const body = kind === "vendDrink" ? "#e8e8e4" : "#f2e6ec";
  out.push(xf(box(0.95, 1.83, 0.72, body, M.metal), 0, 0.915, 0));
  out.push(xf(box(0.99, 0.08, 0.76, "#5a5e62", M.metal), 0, 0.04, 0));
  out.push(xf(box(0.97, 0.06, 0.74, body, M.metal), 0, 1.86, 0));
  const face = sign(kind, 0.82, 1.64, true);
  face.translate(0, 0.98, 0.362);
  out.push(face);
  out.push(xf(box(0.52, 0.12, 0.08, "#2a2e34", M.metal), 0, 0.3, 0.38));
  return merge(out);
}

export function phoneBox(): Geo {
  const out: Geo[] = [];
  out.push(xf(box(0.95, 0.12, 0.95, CONCRETE, M.stone), 0, 0.06, 0));
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) out.push(xf(box(0.06, 2.05, 0.06, "#e8e4d8", M.metal), x, 1.1, z));
  for (const [x, z, ry] of [[0, 0.42, 0], [0, -0.42, 0], [0.42, 0, Math.PI / 2], [-0.42, 0, Math.PI / 2]] as const) {
    const p = prep(new THREE.BoxGeometry(0.8, 1.7, 0.02), "#ffffff", M.glass);
    p.rotateY(ry);
    p.translate(x, 1.05, z);
    out.push(p);
  }
  out.push(xf(box(1.0, 0.22, 1.0, "#3c8a52", M.metal), 0, 2.2, 0));
  for (const s of [1, -1]) {
    const t = sign("phone", 0.84, 0.16, true);
    if (s < 0) t.rotateY(Math.PI);
    t.translate(0, 2.2, s * 0.505);
    out.push(t);
  }
  // Phone on a shelf inside.
  out.push(xf(box(0.34, 0.42, 0.22, "#58a86a", M.metal), 0, 1.3, -0.28));
  out.push(xf(box(0.5, 0.04, 0.3, "#d8d2c4"), 0, 1.06, -0.26));
  return merge(out);
}

/** Wooden bus shelter with a bench, plus the round stop sign on its concrete base in front. */
export function busStop(): Geo {
  const out: Geo[] = [];
  const W = 2.4, D = 1.1, H = 2.2;
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) out.push(xf(box(0.1, H, 0.1, WOOD, M.bark), x, H / 2, z));
  out.push(xf(box(W, H * 0.8, 0.05, WOOD, M.planks), 0, H * 0.45, -D / 2));
  for (const x of [-W / 2, W / 2]) out.push(xf(box(0.05, H * 0.8, D, WOOD, M.planks), x, H * 0.45, 0));
  const rf = box(W + 0.5, 0.08, D + 0.6, "#6a5a4a", M.metal);
  rf.rotateX(-0.14);
  rf.translate(0, H + 0.12, 0.05);
  out.push(rf);
  out.push(xf(box(W - 0.2, 0.06, 0.36, "#9a7650"), 0, 0.45, -D / 2 + 0.25));
  for (const x of [-0.9, 0.9]) out.push(xf(box(0.06, 0.42, 0.3, WOOD_DARK), x, 0.22, -D / 2 + 0.25));
  // Timetable board on the back wall.
  out.push(xf(box(0.5, 0.6, 0.02, "#f2f0e8"), 0.7, 1.4, -D / 2 + 0.04));
  // Stop sign pole (round sign, both faces).
  const px = -W / 2 - 0.6, pz = D / 2 + 0.5;
  out.push(xf(cyl(0.3, 0.32, 0.18, CONCRETE, M.stone, 12), px, 0.09, pz));
  out.push(xf(cyl(0.035, 0.035, 2.2, "#dcdcd4", M.metal, 8), px, 1.2, pz));
  for (const g of sign2("bus", 0.56, 0.56)) out.push(g.translate(px, 2.1, pz + 0.05));
  return merge(out);
}

/** Unmanned vegetable stand (mujin hanbai): little roof, shelves of produce, a coin box. */
export function vegStand(seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const W = 1.5, D = 0.7;
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) out.push(xf(box(0.07, z < 0 ? 1.95 : 1.75, 0.07, WOOD, M.bark), x, (z < 0 ? 1.95 : 1.75) / 2, z));
  const rf = box(W + 0.35, 0.05, D + 0.45, "#5a6a74", M.metal);
  rf.rotateX(0.26);
  rf.translate(0, 1.9, 0.02);
  out.push(rf);
  for (const [y, z] of [[0.55, 0.05], [0.95, -0.12]]) out.push(xf(box(W, 0.04, D * 0.62, "#9a7650", M.planks), 0, y, z));
  out.push(xf(box(W, 0.5, 0.03, WOOD, M.planks), 0, 0.28, D / 2));
  const veg = (x: number, y: number, z: number, kind: number) => {
    if (kind === 0) {
      const c = prep(blob(0.1, 1, 0.2, seed + x * 9), "#8cc05a", M.plain);
      c.translate(x, y + 0.09, z);
      out.push(c);
    } else if (kind === 1) out.push(xf(sphere(0.055, "#d2402a", M.plain, 8, 6), x, y + 0.05, z));
    else out.push(xf(cyl(0.025, 0.025, 0.2, "#3f7a30", M.plain, 6), x, y + 0.03, z, 0, 0, Math.PI / 2));
  };
  // Produce in paper-lined baskets.
  for (let i = 0; i < 4; i++) {
    const x = -0.55 + i * 0.37;
    out.push(xf(cyl(0.15, 0.12, 0.08, "#b8935a", M.plain, 10), x, 0.61, 0.05));
    const k = i % 3;
    for (let j = 0; j < (k === 0 ? 2 : 4); j++) veg(x + range(r, -0.06, 0.06), 0.62, 0.05 + range(r, -0.06, 0.06), k);
    out.push(xf(cyl(0.13, 0.11, 0.07, "#b8935a", M.plain, 10), x, 1.0, -0.12));
    for (let j = 0; j < 3; j++) veg(x + range(r, -0.05, 0.05), 1.01, -0.12 + range(r, -0.05, 0.05), (k + 1) % 3);
  }
  // Coin box on a post and the hand-lettered sign.
  out.push(xf(box(0.14, 0.18, 0.12, "#6a4a30", M.planks), W / 2 - 0.12, 1.25, D / 2 - 0.08));
  out.push(xf(box(0.08, 0.01, 0.01, "#1a1410"), W / 2 - 0.12, 1.33, D / 2 - 0.015));
  const s = sign("yasai", 0.8, 0.25);
  s.translate(0, 1.58, D / 2 + 0.02);
  out.push(s);
  return merge(out);
}

/** Red torii with stone steps rising behind it to a little hokora shrine on a stone platform. */
export function shrine(): { geo: Geo; steps: number; depth: number } {
  const out: Geo[] = [];
  const RED = "#c8402c";
  const H = 3.6, S = 2.6;
  for (const x of [-S / 2, S / 2]) {
    out.push(xf(cyl(0.15, 0.17, H, RED, M.plain, 12), x, H / 2, 0));
    out.push(xf(cyl(0.21, 0.21, 0.35, "#2a2624", M.plain, 12), x, 0.17, 0));
  }
  out.push(xf(box(S + 0.5, 0.18, 0.24, RED), 0, H - 0.55, 0));
  const kasagi = box(S + 1.3, 0.22, 0.34, "#2a2624");
  kasagi.translate(0, H + 0.05, 0);
  out.push(kasagi);
  out.push(xf(box(S + 1.1, 0.16, 0.3, RED), 0, H - 0.14, 0));
  const plaque = sign("shrine", 0.28, 0.8);
  plaque.translate(0, H - 0.2, 0.13);
  out.push(plaque);
  // Steps going back (-Z) and up.
  const n = 9, rise = 0.19, run = 0.42;
  for (let i = 0; i < n; i++) out.push(xf(box(1.7, rise, run + 0.04, i % 2 ? "#a19b90" : STONE, M.stone), 0, rise * (i + 0.5), -0.9 - i * run));
  const topY = rise * n, topZ = -0.9 - n * run - 1.3;
  out.push(xf(box(3.2, topY, 2.8, "#7f7c6c", M.stone), 0, topY / 2, topZ));
  out.push(xf(box(3.3, 0.06, 2.9, "#4f6a38", M.ground), 0, topY + 0.02, topZ));
  // Hokora: small wooden shrine with a gabled copper-green roof.
  const hz = topZ - 0.4;
  out.push(xf(box(0.9, 0.3, 0.8, STONE, M.stone), 0, topY + 0.15, hz));
  out.push(xf(box(0.7, 0.8, 0.6, "#6a4a30", M.planks), 0, topY + 0.7, hz));
  for (const s of [-1, 1]) {
    const rf = box(1.1, 0.06, 0.62, "#4f8a7a", M.metal);
    rf.rotateX(s * 0.55);
    rf.translate(0, topY + 1.28, hz + s * 0.26);
    out.push(rf);
  }
  out.push(xf(box(0.36, 0.5, 0.02, "#e8dcc0", M.shoji), 0, topY + 0.72, hz + 0.31));
  // Paper shide + rope across the torii.
  out.push(xf(cyl(0.035, 0.035, S, "#d8c890", M.cloth, 6), 0, H - 0.9, 0.05, 0, 0, Math.PI / 2));
  for (const x of [-0.6, 0, 0.6]) out.push(xf(box(0.08, 0.26, 0.01, "#f6f4ee", M.cloth), x, H - 1.08, 0.08));
  return { geo: merge(out), steps: n, depth: -topZ + 1.4 };
}

/** Jizo statue with a red bib and knitted cap on a small stone base. */
export function jizo(seed: number): Geo {
  const r = mulberry32(seed);
  const s = range(r, 0.85, 1.05);
  const out: Geo[] = [];
  out.push(xf(box(0.42, 0.18, 0.36, "#8d877c", M.stone), 0, 0.09, 0));
  const body = prep(new THREE.CylinderGeometry(0.13 * s, 0.17 * s, 0.46 * s, 12, 1), "#a8a298", M.stone);
  body.translate(0, 0.18 + 0.23 * s, 0);
  out.push(body);
  out.push(xf(sphere(0.12 * s, "#aaa49a", M.stone, 12, 8), 0, 0.18 + 0.56 * s, 0));
  const bib = sign("jizoBib", 0.3 * s, 0.22 * s);
  bib.rotateX(-0.25);
  bib.translate(0, 0.18 + 0.36 * s, 0.155 * s);
  out.push(bib);
  const cap = prep(new THREE.SphereGeometry(0.125 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#c8302a", M.cloth);
  cap.translate(0, 0.18 + 0.58 * s, 0);
  out.push(cap);
  return merge(out);
}

/** Stone lantern (ishi-doro). */
export function stoneLantern(): Geo {
  const out: Geo[] = [];
  out.push(xf(box(0.5, 0.14, 0.5, STONE, M.stone), 0, 0.07, 0));
  out.push(xf(cyl(0.09, 0.11, 0.7, STONE, M.stone, 8), 0, 0.49, 0));
  out.push(xf(box(0.42, 0.1, 0.42, STONE, M.stone), 0, 0.89, 0));
  out.push(xf(box(0.3, 0.3, 0.3, "#8d877c", M.stone), 0, 1.09, 0));
  out.push(xf(box(0.14, 0.14, 0.32, "#2a2622", M.fire), 0, 1.09, 0));
  const cap = prep(new THREE.ConeGeometry(0.36, 0.26, 6), STONE, M.stone);
  cap.translate(0, 1.37, 0);
  out.push(cap);
  out.push(xf(sphere(0.06, STONE, M.stone, 8, 6), 0, 1.52, 0));
  return merge(out);
}

/** Concrete drain canal along local -Z (len), inner width 0.5, with dark still water. */
export function drainCanal(len: number, segs = 1): Geo {
  const seg = (w: number, h: number, c: string, m: number) => prep(new THREE.BoxGeometry(w, h, len, 1, 1, segs), c, m);
  const out: Geo[] = [];
  for (const x of [-0.32, 0.32]) out.push(xf(seg(0.12, 0.55, CONCRETE, M.stone), x, -0.2, -len / 2));
  out.push(xf(seg(0.6, 0.06, "#3c4a44", M.plain), 0, -0.4, -len / 2));
  out.push(xf(seg(0.52, 0.02, "#4f6a70", M.glass), 0, -0.3, -len / 2));
  return merge(out);
}

/** Grey concrete bridge plate over the canal (width along X). */
export function bridgePlate(): Geo {
  const g = box(0.95, 0.1, 1.3, "#9d998f", M.stone);
  g.translate(0, 0.07, 0);
  return merge([g, xf(box(0.9, 0.02, 0.04, "#7a766e"), 0, 0.125, 0.35), xf(box(0.9, 0.02, 0.04, "#7a766e"), 0, 0.125, -0.35)]);
}

/** Orange-pole convex traffic mirror, the round mirror tilted toward the road. */
export function convexMirror(): Geo {
  const out: Geo[] = [];
  out.push(xf(cyl(0.045, 0.05, 3.0, "#e8762a", M.metal, 8), 0, 1.5, 0));
  out.push(beam(V(0, 2.9, 0), V(0, 3.0, 0.3), 0.03, "#e8762a", M.metal, 6));
  const rim = prep(new THREE.TorusGeometry(0.4, 0.05, 6, 20), "#e8762a", M.metal);
  rim.translate(0, 3.05, 0.34);
  out.push(rim);
  const face = prep(new THREE.SphereGeometry(0.83, 18, 6, 0, Math.PI * 2, 0, 0.5), "#c8d8e0", M.glass);
  face.rotateX(Math.PI / 2);
  face.translate(0, 3.05, 0.34 - 0.83 * Math.cos(0.5));
  out.push(face);
  return merge(out);
}

/** Red inverted-triangle 止まれ stop sign on a grey pole. */
export function tomareSign(): Geo {
  const out: Geo[] = [xf(cyl(0.035, 0.035, 2.3, "#d8d8d0", M.metal, 8), 0, 1.15, 0)];
  const s = sign("tomare", 0.8, 0.8);
  s.translate(0, 2.05, 0.05);
  out.push(s);
  out.push(xf(box(0.7, 0.62, 0.02, "#b8bab6", M.metal), 0, 2.15, 0.03));
  return merge(out);
}

/** Kei truck (white micro pickup): cab, flat bed with drop sides, four wheels. */
export function keiTruck(): Geo {
  const out: Geo[] = [];
  const WH = "#eeece6";
  // Length along Z (front toward +Z).
  out.push(xf(box(1.4, 0.3, 3.3, "#3a3c40", M.metal), 0, 0.42, 0));
  out.push(xf(box(1.42, 1.0, 1.15, WH, M.metal), 0, 1.02, 1.05));
  const cabTop = box(1.38, 0.5, 0.95, WH, M.metal);
  cabTop.translate(0, 1.75, 0.95);
  out.push(cabTop);
  const ws = prep(new THREE.BoxGeometry(1.25, 0.5, 0.02), "#ffffff", M.glass);
  ws.rotateX(-0.2);
  ws.translate(0, 1.72, 1.45);
  out.push(ws);
  for (const s of [-1, 1]) out.push(xf(prep(new THREE.BoxGeometry(0.02, 0.42, 0.7), "#ffffff", M.glass), s * 0.7, 1.72, 0.95));
  out.push(xf(box(1.44, 0.14, 0.06, "#c8c6c0", M.metal), 0, 0.65, 1.64));
  for (const s of [-1, 1]) out.push(xf(box(0.22, 0.1, 0.03, "#f4e6a0", M.lantern), s * 0.5, 0.88, 1.64));
  const plate = sign("plate", 0.3, 0.16);
  plate.translate(0, 0.62, 1.68);
  out.push(plate);
  // Bed + drop sides.
  out.push(xf(box(1.4, 0.06, 1.95, "#9a9c98", M.metal), 0, 0.62, -0.62));
  for (const s of [-1, 1]) out.push(xf(box(0.04, 0.34, 1.95, WH, M.metal), s * 0.69, 0.82, -0.62));
  out.push(xf(box(1.4, 0.34, 0.04, WH, M.metal), 0, 0.82, -1.6));
  out.push(xf(box(1.4, 0.34, 0.04, WH, M.metal), 0, 0.82, 0.36));
  // Cargo: a few crates.
  for (let i = 0; i < 3; i++) out.push(xf(box(0.45, 0.28, 0.35, i === 1 ? "#3a6a9a" : "#c8a060", M.planks), -0.35 + i * 0.35, 0.8, -0.9 + (i % 2) * 0.4));
  for (const z of [1.05, -1.0]) for (const s of [-1, 1]) {
    const w = prep(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 14, 1), "#1e1f22", M.plain);
    w.rotateZ(Math.PI / 2);
    w.translate(s * 0.64, 0.26, z);
    out.push(w);
    const hub = prep(new THREE.CylinderGeometry(0.12, 0.12, 0.19, 10, 1), "#b8bab6", M.metal);
    hub.rotateZ(Math.PI / 2);
    hub.translate(s * 0.65, 0.26, z);
    out.push(hub);
  }
  return merge(out);
}

/** Parked town bicycle (mamachari) on its stand, basket at the front. */
export function parkedBike(color: string): Geo {
  const out: Geo[] = [];
  for (const z of [0.52, -0.52]) {
    const t = prep(new THREE.TorusGeometry(0.31, 0.022, 5, 18), "#222226", M.plain);
    t.rotateY(Math.PI / 2);
    t.translate(0, 0.33, z);
    out.push(t);
  }
  out.push(beam(V(0, 0.33, -0.52), V(0, 0.8, -0.1), 0.02, color, M.metal, 5));
  out.push(beam(V(0, 0.33, -0.52), V(0, 0.4, 0.05), 0.02, color, M.metal, 5));
  out.push(beam(V(0, 0.4, 0.05), V(0, 0.95, 0.42), 0.022, color, M.metal, 5));
  out.push(beam(V(0, 0.33, 0.52), V(0, 0.95, 0.42), 0.02, color, M.metal, 5));
  out.push(xf(box(0.12, 0.05, 0.24, "#2a2222"), 0, 0.84, -0.12));
  out.push(beam(V(-0.28, 1.0, 0.38), V(0.28, 1.0, 0.38), 0.015, "#9a9c9e", M.metal, 5));
  out.push(xf(box(0.34, 0.24, 0.28, "#9a9c9e", M.metal), 0, 0.88, 0.62));
  return merge(out);
}

/** Laundry pole on two stands with shirts and towels (cloth sways in the wind). */
export function laundryPole(seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  const W = 2.6;
  for (const x of [-W / 2, W / 2]) {
    out.push(xf(cyl(0.03, 0.03, 1.9, "#c8ccd0", M.metal, 6), x, 0.95, 0));
    out.push(xf(box(0.5, 0.04, 0.04, "#c8ccd0", M.metal), x, 0.02, 0));
  }
  out.push(xf(cyl(0.025, 0.025, W + 0.3, "#8ac0d8", M.metal, 6), 0, 1.85, 0, 0, 0, Math.PI / 2));
  const cols = ["#f4f2ec", "#8fb4d8", "#e8a0a0", "#f4f2ec", "#d8d0a8", "#6a8ab8"];
  let x = -W / 2 + 0.3;
  while (x < W / 2 - 0.3) {
    const w = range(r, 0.35, 0.6), h = range(r, 0.45, 0.75);
    const c = prep(new THREE.BoxGeometry(w, h, 0.015, 1, 3, 1), cols[Math.floor(r() * cols.length)], M.cloth);
    const pa = c.attributes.position, wa = c.attributes.aWind as THREE.BufferAttribute;
    for (let k = 0; k < pa.count; k++) wa.setX(k, Math.pow((h / 2 - pa.getY(k)) / h, 2) * 0.25);
    c.translate(x + w / 2, 1.83 - h / 2, 0);
    out.push(c);
    x += w + range(r, 0.08, 0.2);
  }
  return merge(out);
}

/** A row of mixed flower pots and a potted shrub (by doors). */
export function potRow(seed: number, n: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  for (let i = 0; i < n; i++) {
    const rr = range(r, 0.1, 0.18);
    const x = i * 0.36;
    out.push(xf(cyl(rr, rr * 0.75, rr * 1.4, ["#8f5236", "#6a6e72", "#b86a3a"][i % 3], M.plain, 10), x, rr * 0.7, 0));
    const b = prep(blob(rr * 1.25, 1, 0.3, seed + i), "#264a2c", M.foliage);
    spherize(b, V(0, 0, 0), 0.6);
    b.translate(x, rr * 1.4 + rr * 0.8, 0);
    out.push(b);
    if (r() > 0.4) for (let k = 0; k < 4; k++) out.push(xf(sphere(0.035, ["#e8506a", "#f4d040", "#f4f0f8", "#b070d0"][i % 4], M.plain, 6, 4), x + range(r, -rr, rr), rr * 2.3 + range(r, 0, 0.1), range(r, -rr, rr) * 0.7));
  }
  return merge(out);
}

/** Glass candy jars on a wooden display table (dagashi counter). */
export function candyCounter(seed: number): Geo {
  const r = mulberry32(seed);
  const out: Geo[] = [];
  out.push(xf(box(1.6, 0.06, 0.6, "#9a7650", M.planks), 0, 0.78, 0));
  for (const x of [-0.72, 0.72]) for (const z of [-0.25, 0.25]) out.push(xf(box(0.06, 0.76, 0.06, WOOD_DARK), x, 0.38, z));
  out.push(xf(box(1.5, 0.04, 0.5, "#9a7650", M.planks), 0, 0.35, 0));
  const candy = ["#e8506a", "#f4d040", "#6ab0e8", "#f0a040", "#8ad070", "#f4f0f8", "#c060c0"];
  for (let i = 0; i < 6; i++) {
    const x = -0.62 + i * 0.25, z = i % 2 ? -0.1 : 0.12;
    const jar = prep(new THREE.CylinderGeometry(0.09, 0.09, 0.24, 12, 1), "#ffffff", M.glass);
    jar.translate(x, 0.93, z);
    out.push(jar);
    out.push(xf(cyl(0.085, 0.085, 0.1, candy[i % candy.length], M.plain, 10), x, 0.87, z));
    out.push(xf(cyl(0.07, 0.095, 0.04, i % 2 ? "#d8342c" : "#e8c040", M.metal, 12), x, 1.07, z));
  }
  for (let i = 0; i < 10; i++) out.push(xf(box(0.12, 0.03, 0.08, candy[Math.floor(r() * candy.length)], M.plain), range(r, -0.7, 0.7), 0.4, range(r, -0.2, 0.2)));
  return merge(out);
}

/** Capsule-toy machines (gachapon) on a stand. */
export function gachapon(): Geo {
  const out: Geo[] = [];
  for (let i = 0; i < 2; i++) {
    const x = i * 0.46;
    out.push(xf(box(0.4, 0.62, 0.36, i ? "#3a7ac8" : "#d8342c", M.metal), x, 0.31, 0));
    out.push(xf(box(0.4, 0.4, 0.36, "#ffffff", M.glass), x, 0.82, 0));
    for (let k = 0; k < 5; k++) out.push(xf(sphere(0.05, ["#f4d040", "#e8506a", "#6ab0e8", "#8ad070", "#f4f0f8"][k], M.plain, 6, 4), x - 0.1 + (k % 3) * 0.1, 0.7 + Math.floor(k / 3) * 0.1, 0.02));
    out.push(xf(box(0.42, 0.06, 0.38, i ? "#3a7ac8" : "#d8342c", M.metal), x, 1.05, 0));
  }
  return merge(out);
}

/** 氷 banner on a thin pole. */
export function koriFlag(): Geo {
  const out: Geo[] = [xf(cyl(0.02, 0.02, 1.8, "#c8ccd0", M.metal, 6), 0, 0.9, 0)];
  for (const g of sign2("kori", 0.5, 0.5)) out.push(g.translate(0.27, 1.45, 0));
  out.push(xf(cyl(0.012, 0.012, 0.56, "#c8ccd0", M.metal, 4), 0.27, 1.72, 0, 0, 0, Math.PI / 2));
  return merge(out);
}

export { sign2 };
