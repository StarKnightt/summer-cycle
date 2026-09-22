import * as THREE from "three";
import { M, prep, windByHeight } from "./geo";
import { mulberry32, range } from "../core/rng";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

type Geo = THREE.BufferGeometry;
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

/** Clump of curved tapered blades with a dark-root → bright-tip gradient. Base at y=0, height ~1. */
function blades(n: number, h: number, w: number, lean: number, root: string, tip: string, seed: number, spread: number): Geo {
  const r = mulberry32(seed);
  const seg = 3;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  _c0.set(root);
  _c1.set(tip);
  const c = new THREE.Color();
  for (let b = 0; b < n; b++) {
    const a = r() * Math.PI * 2;
    const bh = h * range(r, 0.65, 1.1);
    const bw = w * range(r, 0.7, 1.2);
    const ox = Math.cos(a) * spread * r(), oz = Math.sin(a) * spread * r();
    const dirx = Math.cos(a + range(r, -0.6, 0.6)), dirz = Math.sin(a + range(r, -0.6, 0.6));
    const bend = lean * range(r, 0.5, 1.3);
    // Blade plane faces perpendicular to its lean direction.
    const px = -dirz, pz = dirx;
    const start = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = bh * t;
      const off = bend * t * t * bh;
      const hw = bw * (1 - t * 0.92) * 0.5;
      const cx = ox + dirx * off, cz = oz + dirz * off;
      pos.push(cx - px * hw, y, cz - pz * hw, cx + px * hw, y, cz + pz * hw);
      c.copy(_c0).lerp(_c1, Math.pow(t, 0.8));
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < seg; i++) {
      const k = start + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  prep(g, null, M.grass);
  windByHeight(g, 0, h, 1, 1.6);
  return g;
}

export const grassClump = (seed: number) => blades(6, 1.0, 0.075, 0.35, "#2f5a1c", "#a9cf55", seed, 0.12);
export const riceTuft = (seed: number) => blades(7, 0.5, 0.03, 0.28, "#3c7a22", "#b4e062", seed, 0.04);
export const shortGrass = (seed: number) => blades(5, 0.45, 0.06, 0.4, "#3d6d20", "#98c24a", seed, 0.1);

/** Wildflower head: small star of petals on a thin stem. */
export function flower(): Geo {
  const g = new THREE.IcosahedronGeometry(0.055, 0);
  g.scale(1, 0.55, 1);
  g.translate(0, 0, 0);
  return prep(g, "#ffffff", M.plain);
}

/** Lavender-style flower spike: tapering stack of petal clusters on a stem. */
export function flowerSpike(seed: number): Geo {
  const r = mulberry32(seed);
  const parts: Geo[] = [];
  const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.7, 4, 1);
  stem.translate(0, 0.35, 0);
  parts.push(prep(stem, "#4d7a2c", M.plain));
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const g = new THREE.IcosahedronGeometry(0.045 * (1 - t * 0.55), 0);
    g.translate(range(r, -0.02, 0.02), 0.45 + t * 0.32, range(r, -0.02, 0.02));
    parts.push(prep(g, "#ffffff", M.plain));
  }
  // mergeGeometries lives in geo.ts' merge(); inline here to keep the prototype self-contained.
  return mergeSimple(parts);
}

/** Mossy boulder: lumpy flattened blob, moss-green on top, purple-grey shadowed stone below. */
export function boulder(seed: number): Geo {
  let g: Geo = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 2.3 + seed * 0.7);
    v.multiplyScalar(1 + 0.22 * n);
    v.y = v.y > 0 ? v.y * 0.62 : v.y * 0.3;
    p.setXYZ(i, v.x * 1.2, v.y, v.z);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  const stone = new THREE.Color("#8d8a90");
  const moss = new THREE.Color("#6e9a3e");
  const c = new THREE.Color();
  const nr = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const up = nr.getY(i);
    c.copy(stone).lerp(moss, Math.max(0, Math.min(1, (up - 0.45) * 2.5)));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return prep(g, null, M.stone);
}

function mergeSimple(parts: Geo[]): Geo {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error("merge failed");
  return g;
}

/** Butterfly: two wing quads hinged at x=0 (flapped + wandered in the vertex shader). */
export function butterfly(): Geo {
  const pos = [
    // right wing (x > 0)
    0, 0, -0.035, 0.075, 0, -0.05, 0.065, 0, 0.02, 0, 0, 0.03, 0.045, 0, 0.055,
    // left wing
    0, 0, -0.035, -0.075, 0, -0.05, -0.065, 0, 0.02, 0, 0, 0.03, -0.045, 0, 0.055,
  ];
  const idx = [0, 1, 2, 0, 2, 3, 3, 2, 4, 5, 7, 6, 5, 8, 7, 8, 9, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, "#ffffff", M.butterfly);
}
