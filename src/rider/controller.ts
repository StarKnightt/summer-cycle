import { RAIL, roadX, roadYaw } from "../world/road";
import { BIKE } from "./rider";
import { clamp, damp } from "../core/rng";
import type { Input } from "../core/input";

const CRUISE = 6.0;
const MAX = 10.5;
const GEAR = 2.3; // wheel revolutions per crank revolution
/** Opening frame: village + dark tree mass + pole in the right third, paddy mirror on the left. */
const START_Z = 6;

export class Controller {
  x = roadX(START_Z) - 0.9;
  z = START_Z;
  yaw = roadYaw(START_Z);
  /** Set when the last step was refused by an obstacle (for tests / HUD). */
  bumped = false;
  speed = CRUISE;
  steer = 0;
  lean = 0;
  yawRate = 0;
  wheel = 0;
  crank = 0;
  pedaling = 1;
  time = 0;
  braking = false;
  private coastT = 0;

  constructor(public autoplay: boolean) {}

  update(dt: number, input: Input, blocked: (x: number, z: number) => number): void {
    this.time += dt;
    let throttle = 0;
    let brake = 0;
    let steerIn = 0;
    if (this.autoplay) {
      // Cruise with gentle surges, and a short coast every so often (freewheel ticking).
      const target = CRUISE + 0.6 * Math.sin(this.time * 0.17) + 0.3 * Math.sin(this.time * 0.41);
      this.coastT = (this.time % 17) > 13.5 ? 1 : 0;
      throttle = this.coastT ? 0 : clamp((target - this.speed) * 1.5, -1, 1);
      // Pure pursuit on a line slightly left of centre (Japan rides on the left).
      const la = 7 + this.speed * 0.6;
      const zt = this.z - la * Math.cos(this.yaw);
      const off = -0.85 + 0.25 * Math.sin(this.time * 0.11);
      const xt = roadX(zt) + off;
      const want = Math.atan2(this.x - xt, this.z - zt);
      let err = want - this.yaw;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      const delta = Math.atan((2 * BIKE.WHEELBASE * Math.sin(err)) / la);
      steerIn = clamp(delta / 0.3, -1, 1);
    } else {
      throttle = input.up ? 1 : 0;
      brake = input.down ? 1 : 0;
      steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    }

    // Speed: pedal to accelerate, drift back to cruise, brake to stop.
    const tgt = this.autoplay ? CRUISE : CRUISE;
    if (brake) this.speed -= 4.2 * dt;
    else if (throttle > 0) this.speed += (this.autoplay ? 1.0 : 1.7) * throttle * dt * (1 - this.speed / (MAX + 1));
    else if (this.autoplay && this.coastT) this.speed -= 0.25 * dt;
    else if (this.speed < tgt) this.speed += 0.9 * dt;
    else this.speed -= 0.35 * dt;
    this.speed = clamp(this.speed, 0, MAX);
    this.braking = !!brake;
    const wantPedal = !brake && (throttle > 0 || (!this.coastT && this.speed <= tgt + 0.05)) ? 1 : 0;
    this.pedaling = damp(this.pedaling, wantPedal, 5, dt);

    // Steering → yaw rate via bicycle kinematics; less authority at speed for smoothness.
    const maxSteer = 0.3 / (1 + this.speed * 0.06);
    this.steer = damp(this.steer, steerIn * maxSteer, this.autoplay ? 4 : 6, dt);
    // At a standstill she can still walk the bars round (so a stop at an obstacle isn't a dead end).
    const turnSpeed = steerIn !== 0 ? Math.max(this.speed, 1.2) : this.speed;
    this.yawRate = (turnSpeed * Math.tan(this.steer)) / BIKE.WHEELBASE;
    this.yaw += this.yawRate * dt;

    // Integrate, then enforce the invisible guide rails and obstacles.
    let nx = this.x - Math.sin(this.yaw) * this.speed * dt;
    const nz = this.z - Math.cos(this.yaw) * this.speed * dt;
    const u = nx - roadX(nz);
    if (Math.abs(u) > RAIL) {
      nx = roadX(nz) + Math.sign(u) * RAIL;
      // Turn back toward the road direction instead of grinding along the rail.
      const ry = roadYaw(nz);
      this.yaw = damp(this.yaw, ry, 6, dt);
    }
    // Obstacles: blocked() returns penetration depth (0 = clear). Refuse steps that go deeper;
    // steps that back out of contact are allowed so she can ride away after turning.
    const now = blocked(this.x, this.z);
    const next = blocked(nx, nz);
    if (next > 0 && next >= now - 1e-4) {
      this.speed = 0;
      this.bumped = true;
    } else {
      this.x = nx;
      this.z = nz;
      this.bumped = false;
    }

    this.lean = damp(this.lean, clamp(Math.atan((this.speed * this.yawRate) / 9.81) * 1.4, -0.4, 0.4), 5, dt);
    const dist = this.speed * dt;
    this.wheel += dist / BIKE.WHEEL_R;
    this.crank += ((dist / BIKE.WHEEL_R) / GEAR) * this.pedaling;
  }

  /** Crank revolutions per second while pedalling, wheel revs/s otherwise. */
  get cadence(): number {
    return (this.speed / (2 * Math.PI * BIKE.WHEEL_R)) / GEAR;
  }
  get wheelRate(): number {
    return this.speed / (2 * Math.PI * BIKE.WHEEL_R);
  }
}
