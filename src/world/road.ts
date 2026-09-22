/**
 * The road runs toward -Z. Its centreline x(z) is periodic with period L, so the world is built
 * as L-long content that is recycled in chunks ahead of the rider. Lateral coordinate `u` is a
 * horizontal (sheared) offset from the centreline: world x = roadX(z) + u. +u is the rider's right
 * (houses), -u the left (rice paddies).
 */
export const L = 640;
export const CHUNK = 80;
export const NCHUNK = L / CHUNK;
export const ROAD_HALF = 2.4; // asphalt half width
export const RIBBON_HALF = 3.6; // road mesh half width (edges blend into dirt/grass)
export const RAIL = 2.75; // invisible guide rail: max |u| for the bike

const TAU = Math.PI * 2;
const K = TAU / L;

export function roadX(z: number): number {
  const a = K * z;
  return 7 * Math.sin(a) + 3 * Math.sin(3 * a + 1.3) + 1.2 * Math.sin(5 * a + 0.4);
}

export function roadDX(z: number): number {
  const a = K * z;
  return K * (7 * Math.cos(a) + 9 * Math.cos(3 * a + 1.3) + 6 * Math.cos(5 * a + 0.4));
}

/** Yaw (three.js rotation.y) of a rider travelling toward -Z along the road at z. */
export function roadYaw(z: number): number {
  return Math.atan(roadDX(z));
}

/** Rotation.y that makes local +Z face the road from the +u side (house fronts). */
export function faceRoadFromRight(z: number): number {
  return Math.atan2(-1, -roadDX(z));
}

/** Rotation.y that makes local +Z face the road from the -u side. */
export function faceRoadFromLeft(z: number): number {
  return Math.atan2(1, roadDX(z));
}

/** Terrain height on the right side (u > 0) and verges. */
export function groundH(u: number, z: number): number {
  if (u < 3.4 && u > -4.6) return -0.04;
  if (u <= -4.6) return -0.3;
  const a = K * z;
  const bumps = (Math.sin(u * 0.23 + a * 13) + Math.sin(u * 0.08 - a * 21 + 1.7)) * 0.12;
  const h1 = Math.sin(a * 3 + u * 0.021) * 0.5 + Math.sin(a * 7 - u * 0.034 + 2.1) * 0.35 + Math.sin(a * 17 + u * 0.05 + 0.6) * 0.2;
  const hill = smooth(34, 150, u) * (9 + 7 * h1);
  return bumps * smooth(3.4, 8, u) + hill;
}

/** Periodic-in-z pseudo noise in [0,1] for placement decisions. */
export function pnoise(u: number, z: number, s = 0): number {
  const a = K * z;
  const v = Math.sin(a * 11 + u * 0.3 + s * 1.7) * 0.5 + Math.sin(a * 29 - u * 0.51 + s * 3.1) * 0.3 + Math.sin(a * 53 + u * 0.9 + s) * 0.2;
  return v * 0.5 + 0.5;
}

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise2(x: number, y: number): number {
  // Periodic in z (y) so recycled chunks stay continuous: wrap the z lattice on L * scale.
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
