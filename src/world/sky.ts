import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { blob, prep, spherize, M, ID } from "./geo";
import { mote } from "./vegetation";
import { cloudMaterial, skyMaterial, uber } from "../render/materials";
import { LAYER_REFLECT, onLayers } from "../render/lightpasses";
import { mulberry32, range } from "../core/rng";

/**
 * Everything at "infinite" distance follows the camera: sky dome, cumulus towers, distant ridges,
 * a far ground disc that fills the horizon, and drifting light motes.
 */
export class Sky {
  readonly group = new THREE.Group();

  constructor() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 48, 24), skyMaterial());
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.group.add(dome);

    const cm = cloudMaterial();
    const r = mulberry32(77);
    // Hand-placed cumulus (azimuth in radians from -Z, distance, size, tallness). Ahead-heavy.
    const spots: [number, number, number, number][] = [
      [0.28, 2300, 560, 2.3], // the big towering one near the horizon
      [-0.42, 1450, 290, 1.1],
      [0.75, 1350, 280, 1.2],
      [-1.15, 1300, 220, 0.9],
      [1.25, 1400, 260, 1.1],
      [-0.12, 2000, 170, 0.6],
      [1.9, 1500, 180, 0.9],
      [-1.9, 1500, 170, 0.85],
      [2.7, 1400, 200, 1.0],
      [-2.6, 1500, 190, 0.9],
      [3.14, 1600, 170, 0.8],
    ];
    for (const [az, dist, size, tall] of spots) {
      const g = cumulus(size, tall, Math.floor(r() * 1e6));
      const m = new THREE.Mesh(g, cm);
      m.position.set(Math.sin(az) * dist, range(r, 110, 150), -Math.cos(az) * dist);
      m.rotation.y = r() * 6.28;
      m.frustumCulled = false;
      this.group.add(m);
    }

    // Distant layers: a forested near ridge, then painted blue mountains fading lighter.
    const layers: [number, number, number, string, number][] = [
      [520, 50, 1, "#2c5e40", M.foliage],
      [900, 150, 2, "#7fa0b8", M.distant],
      [1400, 250, 3, "#a9c2cf", M.distant],
    ];
    layers.forEach(([rad, h, s, color, mat], i) => {
      const g = ridge(rad, h, s * 13 + 5, color, mat);
      const m = new THREE.Mesh(g, uber(ID.hills, i === 0 ? 0.5 : 0.0, THREE.DoubleSide));
      m.frustumCulled = false;
      this.group.add(m);
    });

    const disc = new THREE.Mesh(prep(new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2), "#3f7a36", M.ground), uber(ID.ground, 0));
    disc.position.y = -0.7;
    disc.frustumCulled = false;
    this.group.add(disc);
    onLayers(this.group, LAYER_REFLECT);

    // Light motes / seed fluff drifting on the wind (wrapped around the camera in the shader).
    const n = 160;
    const im = new THREE.InstancedMesh(mote(), uber(ID.sky, -1, THREE.DoubleSide), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const s = range(r, 0.6, 1.4);
      m4.makeScale(s, s, s).setPosition(range(r, -18, 18), range(r, 0.3, 5), range(r, -18, 18));
      im.setMatrixAt(i, m4);
    }
    im.frustumCulled = false;
    this.motes = im;
  }

  /** Added to the scene separately: must not follow the sky group (the shader wraps it). */
  readonly motes: THREE.InstancedMesh;

  follow(cam: THREE.Vector3): void {
    this.group.position.set(cam.x, 0, cam.z);
  }
}

/** Cauliflower cumulus: flat floor, heaped towers, crisp secondary lobes; normals partly spherized. */
function cumulus(size: number, tall: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 24 + Math.round(tall * 6);
  const top = size * (0.5 + tall * 0.55);
  const big: { x: number; y: number; z: number; rad: number }[] = [];
  const lobe = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < c.length; k += 3) (c[k] = x), (c[k + 1] = y), (c[k + 2] = z);
    g.setAttribute("aLobe", new THREE.BufferAttribute(c, 3));
  };
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = r() * Math.PI * 2;
    // Base lobes stay tucked in so the flat floor is one clean line, not stacked slabs.
    const spread = size * (1 - t * 0.72) * range(r, 0.3, 0.95) * (0.7 + 0.3 * Math.min(1, t * 4));
    const y = t * top * range(r, 0.72, 1.0);
    const rad = size * range(r, 0.22, 0.36) * (1 - t * 0.35);
    const x = Math.cos(a) * spread, z = Math.sin(a) * spread * 0.55;
    const g = blob(rad, 2, 0.12, seed + i * 3.7);
    const cy = y + rad * 0.5;
    g.translate(x, cy, z);
    lobe(g, x, cy, z);
    parts.push(g);
    big.push({ x, y: cy, z, rad });
  }
  // Secondary cauliflower lobes on the upper surfaces.
  for (let i = 0; i < 34; i++) {
    const b = big[Math.floor(r() * big.length)];
    const u = range(r, 0.15, 1), a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const rad = b.rad * range(r, 0.22, 0.38);
    const g = blob(rad, 1, 0.15, seed + 100 + i);
    const lx = b.x + Math.cos(a) * s * b.rad * 0.92, ly = b.y + u * b.rad * 0.92, lz = b.z + Math.sin(a) * s * b.rad * 0.92;
    g.translate(lx, ly, lz);
    lobe(g, lx, ly, lz);
    parts.push(g);
  }
  // Small bulges around the outer flanks so the vertical sides never read as flat walls.
  for (let i = 0; i < 22; i++) {
    let b = big[Math.floor(r() * big.length)];
    for (let k = 0; k < 2; k++) {
      const o = big[Math.floor(r() * big.length)];
      if (Math.hypot(o.x, o.z) > Math.hypot(b.x, b.z)) b = o;
    }
    const out = Math.atan2(b.z, b.x) + range(r, -0.9, 0.9);
    const u = range(r, -0.25, 0.4), s = Math.sqrt(1 - u * u);
    const rad = b.rad * range(r, 0.2, 0.34);
    const g = blob(rad, 1, 0.15, seed + 300 + i);
    const lx = b.x + Math.cos(out) * s * b.rad * 0.9, ly = b.y + u * b.rad * 0.9, lz = b.z + Math.sin(out) * s * b.rad * 0.9;
    g.translate(lx, ly, lz);
    lobe(g, lx, ly, lz);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  const p = merged.attributes.position;
  let ymin = Infinity, ymax = -Infinity;
  const floor = size * 0.14;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    // Flat horizontal base with a slightly rounded lip (no hard step where lobes are cut).
    if (y < floor + size * 0.04) {
      const d = floor + size * 0.04 - y;
      y = floor + size * 0.04 - (size * 0.04) * (1 - Math.exp(-d / (size * 0.04)));
    }
    p.setY(i, y);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  merged.computeVertexNormals();
  spherize(merged, new THREE.Vector3(0, top * 0.35, 0), 0.3, 0.8);
  const h = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) h[i] = (p.getY(i) - ymin) / (ymax - ymin);
  merged.setAttribute("aH", new THREE.BufferAttribute(h, 1));
  return merged;
}

function ridge(rad: number, h: number, seed: number, color: string, mat: number): THREE.BufferGeometry {
  const seg = 180;
  const rows = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  const s = seed;
  const prof = (a: number) => {
    const v = Math.sin(a * 3 + s) * 0.35 + Math.sin(a * 7 + s * 1.7) * 0.25 + Math.sin(a * 13 + s * 0.3) * 0.15 + Math.sin(a * 29 + s) * 0.06;
    return h * Math.max(0.12, 0.5 + v);
  };
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const top = prof(a);
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const y = -6 + (top + 6) * Math.sin((t * Math.PI) / 2);
      const rr = rad + (1 - t) * rad * 0.08;
      pos.push(Math.sin(a) * rr, y, -Math.cos(a) * rr);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return prep(g, color, mat);
}
