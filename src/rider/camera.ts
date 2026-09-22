import * as THREE from "three";
import type { Controller } from "./controller";
import { damp } from "../core/rng";

/** Third-person chase camera: behind + above at head height, damped, with a slow organic sway. */
export class ChaseCam {
  readonly cam: THREE.PerspectiveCamera;
  mode: "chase" | "closeup" | "side" = "chase";
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private init = false;

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(52, aspect, 0.15, 4200);
  }

  shift(dz: number): void {
    this.pos.z += dz;
    this.look.z += dz;
  }

  update(dt: number, c: Controller, t: number): void {
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    if (!this.init) {
      this.yaw = c.yaw;
    }
    this.yaw = damp(this.yaw, c.yaw, 2.2, dt);
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw); // backward vector
    const sway = Math.sin(t * 0.7) * 0.06 + Math.sin(t * 1.9) * 0.02;
    const bob = Math.sin(t * 1.1) * 0.03;
    let tp: THREE.Vector3;
    let tl: THREE.Vector3;
    if (this.mode === "closeup") {
      // 3/4 front-side view of the bike: wheels, crank and rider face.
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      tp = new THREE.Vector3(c.x + rx * 1.9 + fx * 1.4, 1.05, c.z + rz * 1.9 + fz * 1.4);
      tl = new THREE.Vector3(c.x + fx * 0.1, 0.75, c.z + fz * 0.1);
    } else if (this.mode === "side") {
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      tp = new THREE.Vector3(c.x - rx * 3.2 + fx * 0.6, 1.2, c.z - rz * 3.2 + fz * 0.6);
      tl = new THREE.Vector3(c.x, 0.85, c.z);
    } else {
      tp = new THREE.Vector3(c.x + bx * 3.5 + Math.cos(this.yaw) * sway, 1.95 + bob, c.z + bz * 3.5 - Math.sin(this.yaw) * sway);
      tl = new THREE.Vector3(c.x + fx * 6, 1.15, c.z + fz * 6);
    }
    if (!this.init || this.mode !== "chase") {
      this.pos.copy(tp);
      this.look.copy(tl);
      this.init = true;
    } else {
      this.pos.x = damp(this.pos.x, tp.x, 4.5, dt);
      this.pos.y = damp(this.pos.y, tp.y, 3, dt);
      this.pos.z = damp(this.pos.z, tp.z, 4.5, dt);
      this.look.x = damp(this.look.x, tl.x, 6, dt);
      this.look.y = damp(this.look.y, tl.y, 6, dt);
      this.look.z = damp(this.look.z, tl.z, 6, dt);
    }
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    if (this.mode === "chase") this.cam.rotateZ(-c.lean * 0.12 + Math.sin(t * 0.5) * 0.004);
  }
}
