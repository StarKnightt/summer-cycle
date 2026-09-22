import * as THREE from "three";
import type { Controller } from "./controller";
import type { Rider } from "./rider";
import { damp } from "../core/rng";
import { roadX } from "../world/road";

export type CamMode = "chase" | "closeup" | "side" | "paddy" | "houses";

const TPP_FOV = 45;
const FPP_FOV = 70;
const TPP_NEAR = 0.15;
const FPP_NEAR = 0.03;

/**
 * Third-person chase camera (low, behind, rider on the left-third line) with an eased blend into
 * a first-person view at her eye point. V toggles; `fpp` is the blend target (0 = TPP, 1 = FPP).
 */
export class ChaseCam {
  readonly cam: THREE.PerspectiveCamera;
  mode: CamMode = "chase";
  fpp = 0;
  private blend = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private init = false;
  private qT = new THREE.Quaternion();
  private qF = new THREE.Quaternion();
  private eye = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(TPP_FOV, aspect, TPP_NEAR, 4200);
  }

  toggle(): void {
    this.fpp = this.fpp > 0.5 ? 0 : 1;
  }

  /** Current first-person blend (eased), for hiding the head and tuning post. */
  get fppBlend(): number {
    return this.blend;
  }

  shift(dz: number): void {
    this.pos.z += dz;
    this.look.z += dz;
  }

  update(dt: number, c: Controller, t: number, rider: Rider): void {
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw); // rider's right
    if (!this.init) this.yaw = c.yaw;
    this.yaw = damp(this.yaw, c.yaw, 2.2, dt);
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
    const cxr = Math.cos(this.yaw), czr = -Math.sin(this.yaw);
    const sway = Math.sin(t * 0.7) * 0.05 + Math.sin(t * 1.9) * 0.015;
    const bob = Math.sin(t * 1.1) * 0.025;
    let tp: THREE.Vector3;
    let tl: THREE.Vector3;
    let hard = this.mode !== "chase";
    switch (this.mode) {
      case "closeup":
        tp = new THREE.Vector3(c.x + rx * 1.9 + fx * 1.4, 1.05, c.z + rz * 1.9 + fz * 1.4);
        tl = new THREE.Vector3(c.x + fx * 0.1, 0.8, c.z + fz * 0.1);
        break;
      case "side":
        tp = new THREE.Vector3(c.x - rx * 3.0 + fx * 0.6, 1.25, c.z - rz * 3.0 + fz * 0.6);
        tl = new THREE.Vector3(c.x, 0.9, c.z);
        break;
      case "paddy": {
        // Low over the left verge, looking across the mirror paddies toward the far trees.
        const z = c.z - 6;
        tp = new THREE.Vector3(roadX(z) - 3.2, 0.9, z);
        tl = new THREE.Vector3(roadX(z - 26) - 30, -0.4, z - 26);
        break;
      }
      case "houses": {
        const z = c.z;
        tp = new THREE.Vector3(roadX(z) - 1.0, 1.6, z);
        tl = new THREE.Vector3(roadX(z - 22) + 10, 2.6, z - 22);
        break;
      }
      default:
        hard = false;
        // Low chase: 1.5 m high, 4.2 m back, aimed 0.6 m right so she sits on the left third.
        tp = new THREE.Vector3(c.x + bx * 4.2 + cxr * (sway + 0.15), 1.5 + bob, c.z + bz * 4.2 + czr * (sway + 0.15));
        tl = new THREE.Vector3(c.x + fx * 7 + cxr * 0.6 * 1.6, 1.25, c.z + fz * 7 + czr * 0.6 * 1.6);
    }
    if (!this.init || hard) {
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
    // TPP orientation.
    this.m4.lookAt(this.pos, this.look, new THREE.Vector3(0, 1, 0));
    this.qT.setFromRotationMatrix(this.m4);
    if (this.mode === "chase") this.qT.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -c.lean * 0.12));

    // FPP: at her eyes, looking down the road; bob with the pedal stroke, roll into turns.
    const target = this.mode === "chase" ? this.fpp : 0;
    const k = 1 - Math.exp(-dt / 0.14);
    this.blend += (target - this.blend) * k;
    if (Math.abs(target - this.blend) < 0.002) this.blend = target;
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    // Upright eye point over the saddle (her leaning head would put the bars straight below).
    rider.eyeWorld(this.eye);
    this.eye.x -= fx * 0.34;
    this.eye.z -= fz * 0.34;
    this.eye.y = 1.52 + Math.sin(c.crank * 2) * 0.012 * c.pedaling;
    const fl = new THREE.Vector3(this.eye.x + fx * 10, this.eye.y - 3.4, this.eye.z + fz * 10);
    this.m4.lookAt(this.eye, fl, new THREE.Vector3(0, 1, 0));
    this.qF.setFromRotationMatrix(this.m4);
    this.qF.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.lean * 0.8 + Math.sin(c.crank) * 0.008 * c.pedaling));

    this.cam.position.lerpVectors(this.pos, this.eye, e);
    this.cam.quaternion.slerpQuaternions(this.qT, this.qF, e);
    this.cam.fov = TPP_FOV + (FPP_FOV - TPP_FOV) * e;
    this.cam.near = TPP_NEAR + (FPP_NEAR - TPP_NEAR) * e;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    rider.setFirstPerson(e > 0.45);
  }
}
