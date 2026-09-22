import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { blob, prep, spherize, M, ID } from "./geo";
import { cloudMaterial, skyMaterial, uber } from "../render/materials";
import { mulberry32, range } from "../core/rng";

/**
 * Everything at "infinite" distance follows the camera: sky dome, cumulus towers, distant ridges,
 * and a far ground disc that fills the horizon beyond the built chunks.
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
    // Hand-placed cumulus (azimuth in radians from -Z, distance, size). Ahead-heavy for the ride.
    const spots: [number, number, number, number][] = [
      [0.1, 1650, 380, 1.5],
      [-0.5, 1450, 290, 1.1],
      [0.6, 1350, 300, 1.3],
      [-1.15, 1300, 220, 0.9],
      [1.2, 1400, 260, 1.1],
      [0.35, 2100, 200, 0.7],
      [-0.25, 2000, 180, 0.65],
      [1.9, 1500, 180, 0.9],
      [-1.9, 1500, 170, 0.85],
      [2.7, 1400, 200, 1.0],
      [-2.6, 1500, 190, 0.9],
      [3.14, 1600, 170, 0.8],
    ];
    for (const [az, dist, size, tall] of spots) {
      const g = cumulus(size, tall, Math.floor(r() * 1e6));
      const m = new THREE.Mesh(g, cm);
      m.position.set(Math.sin(az) * dist, range(r, 130, 190), -Math.cos(az) * dist);
      m.rotation.y = r() * 6.28;
      m.frustumCulled = false;
      this.group.add(m);
    }

    // Distant ridges: three rings, bluer with distance via the shared fog.
    const ridgeCols = ["#2f6a3a", "#3a6f55", "#4f7a78"];
    [
      [520, 55, 1],
      [850, 110, 2],
      [1300, 190, 3],
    ].forEach(([rad, h, s], i) => {
      const g = ridge(rad, h, s * 13 + 5, ridgeCols[i]);
      const m = new THREE.Mesh(g, uber(ID.hills, i === 0 ? 0.6 : 0.25, THREE.DoubleSide));
      m.frustumCulled = false;
      this.group.add(m);
    });

    const disc = new THREE.Mesh(prep(new THREE.CircleGeometry(2400, 48).rotateX(-Math.PI / 2), "#4e8a3c", M.ground), uber(ID.ground, 0));
    disc.position.y = -0.7;
    disc.frustumCulled = false;
    this.group.add(disc);
  }

  follow(cam: THREE.Vector3): void {
    this.group.position.set(cam.x, 0, cam.z);
  }
}

/** Cauliflower cumulus: flat-bottomed cluster of lumpy blobs, normals partly spherized. */
function cumulus(size: number, tall: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 26;
  const top = size * (0.55 + tall * 0.55);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = r() * Math.PI * 2;
    // Wide base, heaped centre.
    const spread = size * (1 - t * 0.7) * range(r, 0.3, 0.95);
    const y = t * top * range(r, 0.7, 1.0);
    const rad = size * range(r, 0.22, 0.38) * (1 - t * 0.35);
    const g = blob(rad, 2, 0.12, seed + i * 3.7);
    g.translate(Math.cos(a) * spread, y + rad * 0.3, Math.sin(a) * spread * 0.55);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  const p = merged.attributes.position;
  let ymin = Infinity, ymax = -Infinity;
  const base = size * 0.12;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    if (y < base) y = base - (base - y) * 0.12; // flatten the underside
    p.setY(i, y);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  merged.computeVertexNormals();
  spherize(merged, new THREE.Vector3(0, top * 0.35, 0), 0.35, 0.8);
  const h = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) h[i] = (p.getY(i) - ymin) / (ymax - ymin);
  merged.setAttribute("aH", new THREE.BufferAttribute(h, 1));
  return merged;
}

function ridge(rad: number, h: number, seed: number, color: string): THREE.BufferGeometry {
  const seg = 160;
  const rows = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  const s = seed;
  const prof = (a: number) => {
    const v = Math.sin(a * 3 + s) * 0.35 + Math.sin(a * 7 + s * 1.7) * 0.25 + Math.sin(a * 13 + s * 0.3) * 0.15 + Math.sin(a * 29 + s) * 0.06;
    return h * (0.55 + v);
  };
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const top = prof(a);
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      // Rounded shoulder: rows bulge toward the viewer as they near the top.
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
  return prep(g, color, M.foliage);
}
