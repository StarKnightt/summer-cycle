import * as THREE from "three";
import { ID, M, beam, box, cyl, prep, sphere, xf } from "../world/geo";
import { uber } from "../render/materials";

/**
 * Mamachari (Japanese city bicycle). Bike local frame: forward = -Z, up = +Y, right = +X.
 * Hierarchy: group (lean space) → frame meshes, kickstand, rear wheel, crank → pedals,
 * steer (fork/bars/basket/front wheel, rotates about the head tube).
 */

export const WHEEL_R = 0.34;
export const REAR = new THREE.Vector3(0, WHEEL_R, 0.52);
export const FRONT = new THREE.Vector3(0, WHEEL_R, -0.53);
export const BB = new THREE.Vector3(0, 0.3, 0.06);
export const CRANK = 0.165;
export const HEAD_TOP = new THREE.Vector3(0, 0.98, -0.4);
export const HEAD_BOT = new THREE.Vector3(0, 0.74, -0.46);
export const SEAT = new THREE.Vector3(0, 0.9, 0.27);
const KICK_PIVOT = new THREE.Vector3(-0.05, 0.31, 0.32);
const KICK_LEN = 0.32;
const KICK_FOLDED = new THREE.Vector3(-0.06, -0.06, 1).normalize();
/** Deployed leg direction: reaches the ground with the bike leaning PARK_LEAN onto it. */
const KICK_DOWN = new THREE.Vector3(-0.4, -0.9, 0.15).normalize();
/** Parked roll (toward the kickstand, her left) and bar angle. */
export const PARK_LEAN = 0.12;
export const PARK_STEER = 0.32;
export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };

const FRAME = "#c7353a";
const CHROME = "#a3a8ae";
const TYRE = "#26221f";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mk(g: THREE.BufferGeometry, id: number): THREE.Mesh {
  return new THREE.Mesh(g, uber(id, 1));
}

function wheel(): THREE.Group {
  const g = new THREE.Group();
  const bike = ID.bike;
  const tyre = prep(new THREE.TorusGeometry(WHEEL_R - 0.02, 0.028, 8, 36), TYRE, M.plain);
  tyre.rotateY(Math.PI / 2);
  g.add(mk(tyre, bike));
  const rim = prep(new THREE.TorusGeometry(WHEEL_R - 0.05, 0.012, 6, 36), CHROME, M.metal);
  rim.rotateY(Math.PI / 2);
  g.add(mk(rim, bike));
  const hub = cyl(0.035, 0.035, 0.12, CHROME, M.metal, 10);
  hub.rotateZ(Math.PI / 2);
  g.add(mk(hub, bike));
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const side = i % 2 ? 0.035 : -0.035;
    spokes.push(beam(V(side, 0, 0), V(0, Math.sin(a) * (WHEEL_R - 0.055), Math.cos(a) * (WHEEL_R - 0.055)), 0.0045, "#b8bbc0", M.metal, 3));
  }
  for (const s of spokes) g.add(mk(s, bike));
  return g;
}

/** Per-frame bike input (a subset of the rider state). */
export interface BikeState {
  steer: number;
  wheel: number;
  crank: number;
  /** 0 folded … 1 kickstand down (parked). */
  kick?: number;
}

export class Bike {
  /** Everything of the bike; add to the rider's lean group (identity transform). */
  readonly group = new THREE.Group();
  /** Fork, bars, basket and front wheel: rotates about the head tube. Origin at HEAD_BOT. */
  readonly steer = new THREE.Group();
  /**
   * Front basket. `basketContents` is a child whose local frame equals steer space (lean-space
   * coordinates minus HEAD_BOT), so loads built in bike coordinates can be added directly and ride
   * along with the basket.
   */
  readonly basket = new THREE.Group();
  readonly basketContents = new THREE.Group();
  private kick = new THREE.Group();
  private frontWheel = wheel();
  private rearWheel = wheel();
  private crank = new THREE.Group();
  private pedals: THREE.Group[] = [];
  private steerAxis = new THREE.Vector3().subVectors(HEAD_TOP, HEAD_BOT).normalize();

  constructor() {
    this.buildFrame();
    this.buildSteer();
    this.buildCrank();
  }

  private add(g: THREE.BufferGeometry, parent: THREE.Object3D = this.group, id: number = ID.bike): THREE.Mesh {
    const m = mk(g, id);
    parent.add(m);
    return m;
  }

  private setKick(k: number): void {
    const d = KICK_FOLDED.clone().lerp(KICK_DOWN, k * k * (3 - 2 * k)).normalize();
    this.kick.quaternion.setFromUnitVectors(V(0, -1, 0), d);
  }

  update(_dt: number, s: BikeState): void {
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level
    this.setKick(s.kick ?? 0);
  }

  private buildFrame(): void {
    const r = 0.022;
    const seatTop = V(0, 0.84, 0.25);
    // Step-through mamachari frame: low curved down tube.
    const low = V(0, 0.42, -0.12);
    this.add(beam(HEAD_BOT, low, r * 1.2, FRAME, M.metal));
    this.add(beam(low, BB, r * 1.2, FRAME, M.metal));
    this.add(beam(BB, seatTop, r, FRAME, M.metal));
    this.add(beam(V(0, 0.84, -0.4), V(0, 0.6, 0.12), r * 0.9, FRAME, M.metal));
    for (const s of [-1, 1]) {
      this.add(beam(V(s * 0.05, WHEEL_R, REAR.z), V(0, BB.y, BB.z), r * 0.7, FRAME, M.metal));
      this.add(beam(V(s * 0.05, WHEEL_R, REAR.z), seatTop, r * 0.7, FRAME, M.metal));
    }
    this.add(beam(HEAD_BOT, HEAD_TOP, r * 1.6, FRAME, M.metal));
    // Seat post + saddle.
    this.add(beam(seatTop, SEAT, 0.014, CHROME, M.metal));
    const saddle = sphere(0.1, "#4a2e22", M.plain, 12, 8);
    saddle.scale(0.8, 0.32, 1.1);
    saddle.translate(SEAT.x, SEAT.y + 0.0, SEAT.z - 0.06);
    this.add(saddle);
    // Rear rack + fender + chain guard.
    this.add(xf(box(0.16, 0.02, 0.36, CHROME, M.metal), 0, 0.78, 0.5));
    this.add(beam(V(0.07, 0.78, 0.66), V(0.05, WHEEL_R, REAR.z), 0.008, CHROME, M.metal, 4));
    this.add(beam(V(-0.07, 0.78, 0.66), V(-0.05, WHEEL_R, REAR.z), 0.008, CHROME, M.metal, 4));
    const fender = prep(new THREE.TorusGeometry(WHEEL_R + 0.03, 0.03, 4, 20, Math.PI * 0.75), CHROME, M.metal);
    fender.rotateY(Math.PI / 2);
    fender.rotateX(Math.PI * 0.12);
    fender.translate(0, REAR.y, REAR.z);
    this.add(fender);
    const guard = box(0.03, 0.14, 0.62, FRAME, M.metal);
    xf(guard, 0.09, 0.32, 0.28, 0.05);
    this.add(guard);
    // Side kickstand on the left chainstay: folded along the stay, swings down when parked.
    this.kick.position.copy(KICK_PIVOT);
    this.group.add(this.kick);
    this.add(beam(V(0, 0, 0), V(0, -KICK_LEN, 0), 0.011, CHROME, M.metal, 5, 0.009), this.kick);
    this.add(xf(box(0.035, 0.012, 0.05, "#8d9094", M.metal), 0, -KICK_LEN, 0), this.kick);
    this.setKick(0);
    this.rearWheel.position.copy(REAR);
    this.group.add(this.rearWheel);
  }

  private buildSteer(): void {
    this.steer.position.copy(HEAD_BOT);
    this.group.add(this.steer);
    const rel = (v: THREE.Vector3) => v.clone().sub(HEAD_BOT);
    for (const s of [-1, 1]) this.add(beam(rel(V(s * 0.045, 0.72, -0.46)), rel(V(s * 0.045, WHEEL_R, FRONT.z)), 0.013, CHROME, M.metal), this.steer);
    // Stem + swept city handlebar.
    const stemTop = V(0, 1.06, -0.38);
    this.add(beam(rel(HEAD_TOP), rel(stemTop), 0.016, CHROME, M.metal), this.steer);
    const gripL = V(-0.27, 1.05, -0.17), gripR = V(0.27, 1.05, -0.17);
    for (const g of [gripL, gripR]) {
      const mid = V(g.x * 0.55, 1.07, -0.33);
      this.add(beam(rel(stemTop), rel(mid), 0.012, CHROME, M.metal), this.steer);
      this.add(beam(rel(mid), rel(g), 0.012, CHROME, M.metal), this.steer);
      const grip = cyl(0.02, 0.02, 0.1, "#3a2a24", M.plain, 8);
      grip.rotateZ(Math.PI / 2);
      grip.translate(g.x + Math.sign(g.x) * 0.02, g.y, g.z);
      this.add(grip.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    }
    // Front basket.
    this.steer.add(this.basket);
    this.basket.add(this.basketContents);
    const bz = -0.68, by = 0.88;
    const bars: THREE.BufferGeometry[] = [];
    bars.push(xf(box(0.36, 0.02, 0.3, "#2d2d2d", M.metal), 0, by - 0.12, bz));
    for (const s of [-1, 1]) {
      bars.push(xf(box(0.02, 0.02, 0.32, "#2d2d2d", M.metal), s * 0.18, by + 0.13, bz));
      bars.push(xf(box(0.38, 0.02, 0.02, "#2d2d2d", M.metal), 0, by + 0.13, bz + s * 0.15));
      bars.push(xf(box(0.38, 0.015, 0.015, "#2d2d2d", M.metal), 0, by, bz + s * 0.15));
    }
    for (let x = -0.12; x <= 0.13; x += 0.06) for (const s of [-1, 1]) bars.push(xf(box(0.008, 0.26, 0.01, "#2d2d2d", M.metal), x, by, bz + s * 0.15));
    for (let z = -0.1; z <= 0.11; z += 0.07) for (const s of [-1, 1]) bars.push(xf(box(0.01, 0.26, 0.008, "#2d2d2d", M.metal), s * 0.18, by, bz + z));
    for (const b of bars) this.add(b.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.basket);
    // Headlamp.
    const lamp = cyl(0.045, 0.05, 0.08, CHROME, M.metal, 10);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(0, 0.72, -0.53);
    this.add(lamp.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    const fender = prep(new THREE.TorusGeometry(WHEEL_R + 0.03, 0.03, 4, 18, Math.PI * 0.55), CHROME, M.metal);
    fender.rotateY(Math.PI / 2);
    fender.rotateX(-Math.PI * 0.05);
    fender.translate(0, FRONT.y, FRONT.z);
    this.add(fender.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    this.frontWheel.position.copy(rel(FRONT));
    this.steer.add(this.frontWheel);
  }

  private buildCrank(): void {
    this.crank.position.copy(BB);
    this.group.add(this.crank);
    const ring = prep(new THREE.TorusGeometry(0.1, 0.012, 6, 28), CHROME, M.metal);
    ring.rotateY(Math.PI / 2);
    ring.translate(0.075, 0, 0);
    this.add(ring, this.crank);
    const disc = cyl(0.09, 0.09, 0.01, "#8d9094", M.metal, 16);
    disc.rotateZ(Math.PI / 2);
    disc.translate(0.075, 0, 0);
    this.add(disc, this.crank);
    for (const s of [1, -1]) {
      const arm = box(0.02, CRANK, 0.03, "#b0b3b8", M.metal);
      arm.translate(s * 0.1, (-s * CRANK) / 2, 0);
      this.add(arm, this.crank);
      const pedal = new THREE.Group();
      pedal.position.set(s * 0.14, -s * CRANK, 0);
      this.crank.add(pedal);
      this.add(box(0.1, 0.02, 0.07, "#2a2a2a", M.metal), pedal);
      this.pedals.push(pedal);
    }
    // Chain (static loop between chainring and rear hub).
    for (const y of [0.1, -0.1]) this.add(beam(V(0.075, BB.y + y, BB.z), V(0.075, REAR.y + y * 0.4, REAR.z), 0.006, "#4a4a4a", M.metal, 4));
  }
}
