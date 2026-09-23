import * as THREE from "three";
import { M, beam, box, merge, xf } from "./geo";

/**
 * Small road lamp clamped to a utility pole: a curved arm reaching toward the road (local -X)
 * with a flat shade and a panel underneath that glows at night (M.glow, driven by uNight).
 */
export function poleLamp(y = 5.4): THREE.BufferGeometry {
  const V = (x: number, yy: number) => new THREE.Vector3(x, yy, 0);
  const out = [
    xf(box(0.2, 0.16, 0.2, "#4a4a46", M.metal), -0.12, y, 0),
    beam(V(-0.15, y), V(-0.7, y + 0.28), 0.025, "#4a4a46", M.metal, 5),
    beam(V(-0.7, y + 0.28), V(-1.12, y + 0.22), 0.025, "#4a4a46", M.metal, 5),
    xf(box(0.44, 0.08, 0.24, "#5a5c58", M.metal), -1.2, y + 0.17, 0),
    xf(box(0.38, 0.04, 0.18, "#fff4dc", M.glow), -1.2, y + 0.115, 0),
  ];
  return merge(out);
}
