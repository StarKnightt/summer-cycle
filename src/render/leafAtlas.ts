import * as THREE from "three";
import { mulberry32, range } from "../core/rng";

/**
 * Painted leaf atlas (2x2 cells, generated on a canvas at load):
 *   0 ovate canopy cluster · 1 broad bush leaves · 2 long lanceolate blades · 3 small-leaf spray.
 * R = painted tone (each leaf split along its midrib into a light and a dark half, darker toward the
 * stem, dark rim + midrib), G = per-leaf random, A = coverage. Data texture: no colour space.
 */
export const LEAF_CELL = { ovate: 0, broad: 1, lance: 2, small: 3 } as const;

const SIZE = 1024;
const CELL = SIZE / 2;

interface LeafSpec {
  count: number;
  len: [number, number];
  ratio: number; // width / length
  fan: [number, number]; // radians around "up"
  base: [number, number]; // origin inside the cell (0..1)
  spread: number; // origin jitter (px)
  tipCurl: number;
}

const SPECS: LeafSpec[] = [
  { count: 11, len: [150, 215], ratio: 0.44, fan: [-1.5, 1.5], base: [0.5, 0.62], spread: 40, tipCurl: 0.15 },
  { count: 7, len: [170, 230], ratio: 0.66, fan: [-1.35, 1.35], base: [0.5, 0.66], spread: 30, tipCurl: 0.1 },
  { count: 7, len: [300, 440], ratio: 0.16, fan: [-0.55, 0.55], base: [0.5, 0.97], spread: 22, tipCurl: 0.35 },
  { count: 22, len: [80, 120], ratio: 0.5, fan: [-3.1, 3.1], base: [0.5, 0.5], spread: 95, tipCurl: 0.1 },
];

function leafOutline(g: CanvasRenderingContext2D, L: number, W: number, curl: number, side: -1 | 0 | 1) {
  // Leaf along -y from the origin; side -1/1 = one half only (split at the midrib), 0 = whole.
  const tipX = curl * L * 0.25;
  g.beginPath();
  g.moveTo(0, 0);
  if (side <= 0) g.bezierCurveTo(-W * 0.62, -L * 0.18, -W * 0.52, -L * 0.72, tipX, -L);
  else g.bezierCurveTo(0, -L * 0.3, tipX * 0.5, -L * 0.7, tipX, -L);
  if (side >= 0) g.bezierCurveTo(W * 0.52, -L * 0.72, W * 0.62, -L * 0.18, 0, 0);
  else g.bezierCurveTo(tipX * 0.5, -L * 0.7, 0, -L * 0.3, 0, 0);
  g.closePath();
}

function paintCell(g: CanvasRenderingContext2D, cx: number, cy: number, spec: LeafSpec, seed: number) {
  const r = mulberry32(seed);
  const leaves = Array.from({ length: spec.count }, () => {
    const a = range(r, spec.fan[0], spec.fan[1]);
    return {
      a,
      L: range(r, spec.len[0], spec.len[1]) * (1 - Math.abs(a) * 0.12),
      ox: range(r, -spec.spread, spec.spread),
      oy: range(r, -spec.spread, spec.spread) * 0.6,
      v: r(),
      curl: range(r, -spec.tipCurl, spec.tipCurl),
      depth: r(),
    };
  });
  // Back to front: leaves further back are darker, so overlaps read as layered foliage.
  leaves.sort((p, q) => p.depth - q.depth);
  g.save();
  g.beginPath();
  g.rect(cx, cy, CELL, CELL);
  g.clip();
  for (const l of leaves) {
    const W = l.L * spec.ratio;
    const layer = 0.72 + 0.28 * l.depth;
    const G = Math.round(l.v * 255);
    g.save();
    g.translate(cx + CELL * spec.base[0] + l.ox, cy + CELL * spec.base[1] + l.oy);
    g.rotate(l.a);
    // Sunlit half and shaded half, each darkening toward the stem.
    for (const side of [-1, 1] as const) {
      const lit = side < 0;
      const grad = g.createLinearGradient(0, 0, 0, -l.L);
      const t0 = (lit ? 0.5 : 0.24) * layer, t1 = (lit ? 0.98 : 0.56) * layer;
      grad.addColorStop(0, `rgb(${Math.round(t0 * 255)},${G},0)`);
      grad.addColorStop(0.75, `rgb(${Math.round(t1 * 255)},${G},0)`);
      grad.addColorStop(1, `rgb(${Math.round(t1 * 0.9 * 255)},${G},0)`);
      g.fillStyle = grad;
      leafOutline(g, l.L, W, l.curl, side);
      g.fill();
    }
    // Dark painted rim and midrib.
    g.lineJoin = "round";
    g.strokeStyle = `rgb(${Math.round(0.14 * 255)},${G},0)`;
    g.lineWidth = Math.max(2, W * 0.035);
    leafOutline(g, l.L, W, l.curl, 0);
    g.stroke();
    g.strokeStyle = `rgb(${Math.round(0.2 * layer * 255)},${G},0)`;
    g.lineWidth = Math.max(1.5, W * 0.03);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo((l.curl * l.L * 0.25) * 0.4, -l.L * 0.6, l.curl * l.L * 0.25, -l.L * 0.96);
    g.stroke();
    // Stalk into the cluster centre.
    g.lineWidth = Math.max(2, W * 0.05);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, W * 0.22);
    g.stroke();
    g.restore();
  }
  g.restore();
}

let tex: THREE.CanvasTexture | null = null;

export function leafAtlas(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  if (tex) return tex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, SIZE, SIZE);
  SPECS.forEach((s, i) => paintCell(g, (i % 2) * CELL, Math.floor(i / 2) * CELL, s, 101 + i * 17));
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Atlas uv for cell `c` from a 0..1 card uv (texture flipY: canvas row 0 is the top half). */
export function cellUv(c: number, u: number, v: number): [number, number] {
  const col = c % 2, row = Math.floor(c / 2);
  return [(u + col) / 2, (v + (1 - row)) / 2];
}
