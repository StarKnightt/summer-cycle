import * as THREE from "three";
import { M, beam, merge, prep, windByHeight } from "./geo";
import { mulberry32, range } from "../core/rng";
import { leafCard } from "./props";
import { LEAF_CELL } from "../render/leafAtlas";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

type Geo = THREE.BufferGeometry;
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

/** Clump of curved tapered blades with a dark-root → bright-tip gradient. Base at y=0, height ~1. */
const _cm = new THREE.Color();
const _tipWarm = new THREE.Color("#a8c860");

function blades(n: number, h: number, w: number, lean: number, root: string, tip: string, seed: number, spread: number, mid?: string, seg = 3): Geo {
  const r = mulberry32(seed);
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
    // Per-blade tip hue: some catch warm yellow-green light, some stay deep blue-green.
    const tv = r();
    _c1.set(tip);
    if (tv > 0.72) _c1.lerp(_tipWarm, 0.55);
    else if (tv < 0.25) _c1.multiplyScalar(0.72);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = bh * t;
      const off = bend * t * t * bh;
      const hw = bw * (1 - t * 0.92) * 0.5;
      const cx = ox + dirx * off, cz = oz + dirz * off;
      pos.push(cx - px * hw, y, cz - pz * hw, cx + px * hw, y, cz + pz * hw);
      if (mid) {
        _cm.set(mid);
        if (t < 0.5) c.copy(_c0).lerp(_cm, t * 2);
        else c.copy(_cm).lerp(_c1, Math.pow((t - 0.5) * 2, 0.9));
      } else c.copy(_c0).lerp(_c1, Math.pow(t, 0.8));
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

export const grassClump = (seed: number) => blades(10, 0.85, 0.036, 0.12, "#1f3d22", "#6f9a3e", seed, 0.14, "#33602c", 2);
/** Tall right-verge clump, height 1 (instances scale it to 0.4-1.3 m): a dense outward fan. */
export const vergeClump = (seed: number) => blades(13, 1.0, 0.038, 0.17, "#1f3d22", "#6f9a3e", seed, 0.18, "#30592a", 2);
export const shortGrass = (seed: number) => blades(7, 0.4, 0.034, 0.2, "#22412a", "#6f9a3e", seed, 0.1, "#386530");
/** Low grass fringe along the paddy bank tops. */
export const fringeGrass = (seed: number) => blades(5, 0.32, 0.036, 0.3, "#2a4a24", "#7a9c44", seed, 0.1, "#436a2e", 2);

/** Young rice: V-shaped three-blade tuft (upright centre, two out-leaning sides), lighter tips. */
export function riceTuft(seed: number): Geo {
  const r = mulberry32(seed);
  const seg = 3;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cRoot = new THREE.Color("#2c4d20");
  const cBody = new THREE.Color("#3f6b2a");
  const cTip = new THREE.Color("#8fb05a");
  const c = new THREE.Color();
  for (let b = 0; b < 3; b++) {
    const side = b - 1;
    const bh = 0.42 * (side === 0 ? range(r, 0.95, 1.05) : range(r, 0.72, 0.88));
    const tilt = side * range(r, 0.34, 0.5) + range(r, -0.06, 0.06);
    // Blade axis in the V plane (x-y); width direction twisted 45° off that plane so it never goes edge-on.
    const wx = Math.cos(tilt) * 0.7, wz = 0.7;
    const bw = range(r, 0.022, 0.03);
    const start = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = bh * t * (1 - Math.abs(tilt) * 0.25 * t);
      const off = Math.sin(tilt) * bh * t * (0.55 + 0.45 * t);
      const hw = bw * (1 - t * 0.9) * 0.5;
      pos.push(off - wx * hw, y, -wz * hw, off + wx * hw, y, wz * hw);
      if (t < 0.45) c.copy(cRoot).lerp(cBody, t / 0.45);
      else c.copy(cBody).lerp(cTip, Math.pow((t - 0.45) / 0.55, 1.3));
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
  windByHeight(g, 0, 0.42, 0.6, 1.6);
  return g;
}

/** Wildflower head: small star of petals on a thin stem. */
/** Wildflower: alpha-cut five-petal card facing up/out on a thin stem (instance origin = bloom). */
export function flower(): Geo {
  // Instance origin = bloom, planted 0.62 m (x scale) above the ground: the stem always reaches it.
  const card = new THREE.PlaneGeometry(0.13, 0.13);
  card.rotateX(-Math.PI / 2 + 0.55);
  const stem = new THREE.CylinderGeometry(0.005, 0.008, 0.7, 3, 1);
  stem.translate(0, -0.35, 0);
  const base = blades(5, 0.26, 0.035, 0.35, "#24452a", "#5f8a3a", 71, 0.05, "#35602c", 2);
  base.translate(0, -0.64, 0);
  return merge([prep(card, "#ffffff", M.flower), prep(stem, "#3f6a2a", M.plain, 0.6), base]);
}

/**
 * Undergrowth plant from painted atlas leaves: `lance` = tall stems with long narrow alternate
 * leaves (knotweed / reed-like), `broad` = low rosette of big broad leaves (butterbur / hosta-like).
 */
export function leafPlant(seed: number, kind: "lance" | "broad"): Geo {
  const r = mulberry32(seed);
  const parts: Geo[] = [];
  const cols = ["#1e3f2a", "#244a2c", "#2a5230", "#1b3a28"];
  if (kind === "lance") {
    for (let s = 0; s < 4; s++) {
      const a = r() * Math.PI * 2;
      const h = range(r, 0.7, 1.15);
      const top = new THREE.Vector3(Math.cos(a) * h * 0.18, h, Math.sin(a) * h * 0.18);
      parts.push(beam(new THREE.Vector3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), top, 0.009, "#3f6a2c", M.plain, 3, 0.004));
      for (let i = 0; i < 5; i++) {
        const t = 0.25 + i * 0.16;
        const c = top.clone().multiplyScalar(t);
        const out = new THREE.Vector3(Math.cos(a + i * 2.2), 0.55, Math.sin(a + i * 2.2)).normalize();
        parts.push(leafCard(c.clone().addScaledVector(out, 0.14), out, range(r, 0.36, 0.5), cols[i % 4], new THREE.Vector3(out.x, 0.8, out.z).normalize(), range(r, -0.5, 0.5), M.leafCard, LEAF_CELL.lance));
      }
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.5;
      const out = new THREE.Vector3(Math.cos(a), range(r, 0.6, 1.1), Math.sin(a)).normalize();
      const c = new THREE.Vector3(Math.cos(a) * 0.18, range(r, 0.18, 0.36), Math.sin(a) * 0.18);
      parts.push(leafCard(c, out, range(r, 0.42, 0.6), cols[i % 4], new THREE.Vector3(out.x * 0.4, 1, out.z * 0.4).normalize(), range(r, -0.4, 0.4), M.leafCard, LEAF_CELL.broad));
    }
  }
  const g = merge(parts);
  windByHeight(g, 0, 1.1, 0.6, 1.5);
  return g;
}

/**
 * Floret cluster (aster / fleabane spray, red spray): branching stems carrying many tiny daisy
 * cards, leafy base. Base at y=0; instance colour tints the florets.
 */
export function floretCluster(seed: number, n: number, h: number, size: number): Geo {
  const r = mulberry32(seed);
  const parts: Geo[] = [blades(7, h * 0.45, 0.04, 0.3, "#22412a", "#5f8a3a", seed + 3, 0.08, "#35602c", 2)];
  const stems = 5;
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + r();
    const top = new THREE.Vector3(Math.cos(a) * range(r, 0.05, 0.16), h * range(r, 0.75, 1.0), Math.sin(a) * range(r, 0.05, 0.16));
    parts.push(beam(new THREE.Vector3(0, 0, 0), top, 0.006, "#3e6a2c", M.plain, 3, 0.003));
    for (let i = 0; i < n / stems; i++) {
      const c = top.clone().add(new THREE.Vector3(range(r, -1, 1), range(r, -0.8, 0.5), range(r, -1, 1)).multiplyScalar(h * 0.14));
      const card = new THREE.PlaneGeometry(size, size);
      card.rotateX(-Math.PI / 2 + range(r, 0.3, 0.9));
      card.rotateY(r() * Math.PI * 2);
      card.translate(c.x, c.y, c.z);
      parts.push(prep(card, i % 7 === 0 ? "#e8e0f0" : "#ffffff", M.flower));
    }
  }
  const g = merge(parts);
  windByHeight(g, 0, h, 0.7, 1.4);
  return g;
}

/** Light mote / seed fluff billboard (placed + wrapped around the camera in the vertex shader). */
export function mote(): Geo {
  return prep(new THREE.PlaneGeometry(0.06, 0.06), "#ffffff", M.mote);
}

/** Lavender-style flower spike: tapering stack of petal clusters on a stem. */
export function flowerSpike(seed: number): Geo {
  const r = mulberry32(seed);
  const parts: Geo[] = [];
  const stem = new THREE.CylinderGeometry(0.007, 0.011, 0.8, 4, 1);
  stem.translate(0, 0.4, 0);
  parts.push(prep(stem, "#4d7a2c", M.plain));
  // Palmate leaf rosette at the foot, so the spike grows out of a plant, not out of bare ground.
  parts.push(blades(8, 0.3, 0.05, 0.45, "#22412a", "#5f8a3a", seed + 5, 0.06, "#35602c", 2));
  // Dense tapering column of tiny pea-flower florets.
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const y = 0.42 + t * 0.38;
    const a = i * 2.4 + r();
    const rad = 0.035 * (1 - t * 0.6);
    const card = new THREE.PlaneGeometry(0.045 * (1 - t * 0.4), 0.045 * (1 - t * 0.4));
    card.rotateX(-0.4);
    card.rotateY(a);
    card.translate(Math.cos(a) * rad, y, Math.sin(a) * rad);
    parts.push(prep(card, i % 5 === 0 ? "#f0eaf6" : "#ffffff", M.flower));
  }
  const g = merge(parts);
  windByHeight(g, 0, 0.8, 0.5, 1.5);
  return g;
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
  // Weathered dark stone with mottled moss creeping over the top (never a pale grey dome).
  const stone = new THREE.Color("#5f5b62");
  const stoneDk = new THREE.Color("#3e3a42");
  const moss = new THREE.Color("#3f6a30");
  const mossHi = new THREE.Color("#5a8438");
  const c = new THREE.Color();
  const nr = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const up = nr.getY(i);
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const mot = 0.5 + 0.5 * Math.sin(x * 5.3 + seed) * Math.sin(z * 4.7 - seed) * Math.sin(y * 6.1 + 1.3);
    c.copy(stone).lerp(stoneDk, 0.4 + 0.6 * (1 - mot) * (up < 0 ? 1 : 0.5));
    const m = Math.max(0, Math.min(1, (up - 0.1 + (mot - 0.5) * 0.7) * 2.2));
    c.lerp(moss.clone().lerp(mossHi, mot * Math.max(0, up)), m);
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
  // Each wing = rounded forewing lobe + smaller hindwing lobe, as fans from the body hinge.
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of [1, -1]) {
    for (const [cz, rx, rz, n] of [
      [-0.012, 0.062, 0.042, 7],
      [0.022, 0.042, 0.03, 6],
    ] as const) {
      const c = pos.length / 3;
      pos.push(0, 0, cz);
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI;
        pos.push(s * Math.cos(a) * rx, 0, cz + Math.sin(a) * rz * (cz < 0 ? 1.1 : 1));
      }
      for (let i = 0; i < n; i++) idx.push(c, c + 1 + i, c + 2 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, "#ffffff", M.butterfly);
}
