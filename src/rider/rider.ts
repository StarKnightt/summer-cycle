import * as THREE from "three";
import { ID, M, beam, box, cyl, prep, sphere, xf } from "../world/geo";
import { uber } from "../render/materials";

/**
 * Mamachari (city bicycle) + schoolgirl rider. Bike local frame: forward = -Z, up = +Y, right = +X.
 * Hierarchy: root (world pos, yaw) → lean (roll) → frame, steer, wheels, crank, body.
 */

const WHEEL_R = 0.34;
const REAR = new THREE.Vector3(0, WHEEL_R, 0.52);
const FRONT = new THREE.Vector3(0, WHEEL_R, -0.53);
const BB = new THREE.Vector3(0, 0.3, 0.06);
const CRANK = 0.165;
const HEAD_TOP = new THREE.Vector3(0, 0.98, -0.4);
const HEAD_BOT = new THREE.Vector3(0, 0.74, -0.46);
const SEAT = new THREE.Vector3(0, 0.9, 0.27);

const FRAME = "#c7353a";
const CHROME = "#a3a8ae";
const TYRE = "#26221f";
const SKIN = "#f5d3b8";
const HAIR = "#2b1e1b";
const BLOUSE = "#f4f2ec";
const NAVY = "#27335c";
const SOCK = "#f2f0ea";
const SHOE = "#5a3526";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mk(g: THREE.BufferGeometry, id: number): THREE.Mesh {
  const m = new THREE.Mesh(g, uber(id, 1));
  return m;
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

/** Two-bone IK. Writes the joint position into `mid`. */
function ik(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, mid: THREE.Vector3): void {
  const d = new THREE.Vector3().subVectors(c, a);
  let len = d.length();
  len = Math.min(Math.max(len, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  d.normalize();
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
  mid.copy(a).addScaledVector(d, l1 * cosA).addScaledVector(perp, l1 * sinA);
}

/** A limb segment: unit-height cylinder oriented between two points each frame. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, r0: number, r1: number, color: string, mat: number, id: number) {
    const g = prep(new THREE.CylinderGeometry(r1, r0, 1, 10, 1), color, mat);
    g.translate(0, 0.5, 0);
    this.mesh = mk(g, id);
    parent.add(this.mesh);
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    this.mesh.scale.set(1, len, 1);
  }
}

export interface RiderState {
  speed: number;
  steer: number;
  lean: number;
  crank: number;
  wheel: number;
  pedaling: number;
  time: number;
}

export class Rider {
  readonly root = new THREE.Group();
  readonly lean = new THREE.Group();
  private steer = new THREE.Group();
  private frontWheel = wheel();
  private rearWheel = wheel();
  private crank = new THREE.Group();
  private pedals: THREE.Group[] = [];
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private pony: THREE.Group[] = [];
  private skirt!: THREE.Mesh;
  private thigh: Limb[] = [];
  private shin: Limb[] = [];
  private upperArm: Limb[] = [];
  private foreArm: Limb[] = [];
  private knees: THREE.Mesh[] = [];
  private elbows: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private steerAxis = new THREE.Vector3().subVectors(HEAD_TOP, HEAD_BOT).normalize();

  constructor() {
    this.root.add(this.lean);
    this.buildFrame();
    this.buildSteer();
    this.buildCrank();
    this.buildBody();
    // Blob shadow under the bike.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.9).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        transparent: true,
        depthWrite: false,
        uniforms: {},
        vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `in vec2 vUv; layout(location=0) out vec4 gColor; layout(location=1) out vec4 gNormal;
          void main(){ vec2 d = (vUv - 0.5) * 2.0; float a = 1.0 - smoothstep(0.35, 1.0, length(d));
            gColor = vec4(0.035, 0.035, 0.05, a * 0.42); gNormal = vec4(0.5, 1.0, 1.0/32.0, 0.0) * a; }`,
      }),
    );
    shadow.position.y = 0.035;
    shadow.renderOrder = 1;
    this.root.add(shadow);
  }

  private add(g: THREE.BufferGeometry, parent: THREE.Object3D = this.lean, id: number = ID.bike): THREE.Mesh {
    const m = mk(g, id);
    parent.add(m);
    return m;
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
    // Kickstand folded.
    this.add(beam(V(0.06, 0.3, 0.5), V(0.06, 0.18, 0.72), 0.01, CHROME, M.metal, 4));
    this.rearWheel.position.copy(REAR);
    this.lean.add(this.rearWheel);
  }

  private buildSteer(): void {
    this.steer.position.copy(HEAD_BOT);
    this.lean.add(this.steer);
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
    // Front basket with a school bag.
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
    for (const b of bars) this.add(b.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
    const bag = box(0.3, 0.2, 0.2, "#6b4a2e", M.cloth);
    xf(bag, 0, by + 0.02, bz, 0, 0.1);
    this.add(bag.translate(-HEAD_BOT.x, -HEAD_BOT.y, -HEAD_BOT.z), this.steer);
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
    this.lean.add(this.crank);
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

  private buildBody(): void {
    const b = this.body;
    this.lean.add(b);
    const rid = ID.rider;
    // Hips / skirt.
    const hip = V(0, SEAT.y + 0.1, SEAT.z - 0.02);
    const skirt = prep(new THREE.CylinderGeometry(0.155, 0.23, 0.3, 18, 1, true), NAVY, M.cloth);
    // Pleats: alternate vertex shading around the hem.
    const cols = skirt.attributes.color as THREE.BufferAttribute;
    const pos = skirt.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getX(i), pos.getZ(i));
      const k = 0.85 + 0.15 * Math.sign(Math.sin(a * 9));
      cols.setXYZ(i, cols.getX(i) * k, cols.getY(i) * k, cols.getZ(i) * k);
      const rr = Math.hypot(pos.getX(i), pos.getZ(i));
      const bump = pos.getY(i) < 0 ? 1 + 0.06 * Math.sin(a * 18) : 1;
      pos.setXYZ(i, (pos.getX(i) / rr) * rr * bump, pos.getY(i), (pos.getZ(i) / rr) * rr * bump);
    }
    skirt.computeVertexNormals();
    this.skirt = new THREE.Mesh(skirt, uber(rid, 1, THREE.DoubleSide));
    this.skirt.position.set(hip.x, hip.y - 0.08, hip.z - 0.06);
    this.skirt.rotation.x = 1.0;
    this.skirt.scale.set(1.1, 1, 1.05);
    b.add(this.skirt);
    // Seat panel of the skirt: covers the hips / thigh roots seen from the chase camera.
    const seat = sphere(0.16, NAVY, M.cloth, 16, 10);
    seat.scale(1.12, 0.62, 1.05);
    seat.translate(hip.x, hip.y - 0.05, hip.z + 0.02);
    this.add(seat, b, rid);

    // Torso (leans forward from the hips).
    this.torso.position.copy(hip);
    this.torso.rotation.x = -0.28;
    b.add(this.torso);
    // Softly rounded torso: elliptical tapered cylinder, narrow waist, rounded shoulders.
    const chest = prep(new THREE.CylinderGeometry(0.14, 0.115, 0.44, 12, 3), BLOUSE, M.cloth);
    const cp = chest.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      const bulge = 1 + 0.12 * Math.sin(((y + 0.22) / 0.44) * Math.PI); // blouse fullness
      cp.setXYZ(i, cp.getX(i) * bulge, y, cp.getZ(i) * 0.68 * bulge);
    }
    chest.computeVertexNormals();
    chest.translate(0, 0.25, 0);
    this.add(chest, this.torso, rid);
    const yoke = sphere(0.14, BLOUSE, M.cloth, 14, 8);
    yoke.scale(1.08, 0.45, 0.7);
    yoke.translate(0, 0.46, 0);
    this.add(yoke, this.torso, rid);
    for (const s of [-1, 1]) {
      const sleeve = sphere(0.062, BLOUSE, M.cloth, 10, 8);
      sleeve.translate(s * 0.165, 0.41, -0.005);
      this.add(sleeve, this.torso, rid);
    }
    // Waist band + sailor collar on the back.
    this.add(xf(box(0.27, 0.05, 0.18, NAVY, M.cloth), 0, 0.03, 0), this.torso, rid);
    this.add(xf(box(0.27, 0.2, 0.02, NAVY, M.cloth), 0, 0.37, 0.1, 0.12), this.torso, rid);
    this.add(xf(box(0.24, 0.015, 0.025, "#f4f2ec", M.cloth), 0, 0.3, 0.115, 0.12), this.torso, rid);
    // Red scarf at the front.
    this.add(xf(box(0.08, 0.1, 0.03, "#c8363a", M.cloth), 0, 0.37, -0.1, -0.2), this.torso, rid);
    // Neck + head.
    this.add(xf(cyl(0.045, 0.05, 0.1, SKIN, M.skin, 8), 0, 0.5, 0), this.torso, ID.skin);
    this.head.position.set(0, 0.66, -0.01);
    this.head.scale.setScalar(1.14);
    this.torso.add(this.head);
    const face = sphere(0.125, SKIN, M.skin, 20, 14);
    face.scale(0.95, 1.05, 1.0);
    this.add(face, this.head, ID.skin);
    // Face: eyes, brows, blush, mouth (flat anime features on the front, -Z).
    for (const s of [-1, 1]) {
      const eye = sphere(0.02, "#2a1b18", M.plain, 8, 6);
      eye.scale(0.8, 1.35, 0.4);
      eye.translate(s * 0.045, 0.0, -0.118);
      this.add(eye, this.head, ID.skin);
      const hl = sphere(0.007, "#ffffff", M.plain, 6, 4);
      hl.translate(s * 0.045 + 0.006, 0.012, -0.126);
      this.add(hl, this.head, ID.skin);
      const blush = sphere(0.022, "#f2a2a0", M.skin, 8, 6);
      blush.scale(1.2, 0.5, 0.3);
      blush.translate(s * 0.068, -0.035, -0.094);
      this.add(blush, this.head, ID.skin);
    }
    const mouth = sphere(0.012, "#b0524c", M.plain, 8, 4);
    mouth.scale(1.2, 0.35, 0.3);
    mouth.translate(0, -0.058, -0.112);
    this.add(mouth, this.head, ID.skin);
    // Hair: back shell, bangs, side locks, ponytail chain.
    const shell = sphere(0.14, HAIR, M.hair, 20, 14);
    shell.scale(1.0, 1.02, 1.05);
    const sp = shell.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      // Open the face: pull front-lower vertices back inside the head.
      const z = sp.getZ(i), y = sp.getY(i);
      if (z < -0.04 && y < 0.05) sp.setZ(i, z * 0.35 + 0.02);
    }
    shell.computeVertexNormals();
    shell.translate(0, 0.02, 0.012);
    this.add(shell, this.head, ID.hair);
    const bangs = sphere(0.12, HAIR, M.hair, 16, 8);
    bangs.scale(1.08, 0.45, 0.6);
    bangs.translate(0, 0.075, -0.075);
    this.add(bangs, this.head, ID.hair);
    for (const s of [-1, 1]) {
      const lock = sphere(0.045, HAIR, M.hair, 10, 8);
      lock.scale(0.5, 1.7, 0.9);
      lock.translate(s * 0.118, -0.03, 0.03);
      this.add(lock, this.head, ID.hair);
    }
    let parent: THREE.Object3D = this.head;
    const tie = xf(cyl(0.03, 0.03, 0.03, "#c8363a", M.cloth, 8), 0, 0.03, 0.14, Math.PI / 2);
    this.add(tie, this.head, ID.rider);
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.03 : -0.08, i === 0 ? 0.15 : 0.0);
      parent.add(seg);
      const g = sphere(0.045 - i * 0.008, HAIR, M.hair, 10, 8);
      g.scale(1, 1.9, 1);
      g.translate(0, -0.05, 0);
      this.add(g, seg, ID.hair);
      this.pony.push(seg);
      parent = seg;
    }
    // Limbs (updated every frame via IK).
    for (let s = 0; s < 2; s++) {
      this.thigh.push(new Limb(b, 0.065, 0.055, SKIN, M.skin, ID.skin));
      this.shin.push(new Limb(b, 0.048, 0.04, SOCK, M.cloth, rid));
      this.upperArm.push(new Limb(b, 0.05, 0.042, SKIN, M.skin, ID.skin));
      this.foreArm.push(new Limb(b, 0.04, 0.032, SKIN, M.skin, ID.skin));
      const knee = mk(sphere(0.052, SKIN, M.skin, 10, 8), ID.skin);
      const elbow = mk(sphere(0.036, SKIN, M.skin, 8, 6), ID.skin);
      const foot = mk(xf(box(0.08, 0.06, 0.17, SHOE, M.plain), 0, 0, -0.03), rid);
      const hand = mk(sphere(0.035, SKIN, M.skin, 8, 6), ID.skin);
      b.add(knee, elbow, foot, hand);
      this.knees.push(knee);
      this.elbows.push(elbow);
      this.feet.push(foot);
      this.hands.push(hand);
    }
  }

  update(dt: number, s: RiderState): void {
    this.lean.rotation.z = s.lean;
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level

    // Body bob with pedal stroke + a little sway when pushing hard.
    const bob = Math.sin(s.crank * 2) * 0.008 * s.pedaling;
    this.torso.position.y = SEAT.y + 0.1 + bob;
    this.torso.rotation.z = Math.sin(s.crank) * 0.025 * s.pedaling;
    this.torso.rotation.x = -0.28 - Math.min(s.speed / 12, 1) * 0.08;
    this.head.rotation.y = Math.sin(s.time * 0.37) * 0.12 + Math.sin(s.time * 0.13) * 0.1;
    this.head.rotation.x = 0.12 + Math.sin(s.time * 0.21) * 0.04;
    this.head.rotation.z = -s.lean * 0.5;
    // Ponytail sways with speed, bob and turning.
    const sp = Math.min(s.speed / 8, 1.2);
    for (let i = 0; i < this.pony.length; i++) {
      const p = this.pony[i];
      p.rotation.x = -(0.25 + sp * (0.3 + i * 0.12) + Math.sin(s.time * 5.5 - i * 0.8) * 0.08 * (0.5 + sp));
      p.rotation.z = Math.sin(s.time * 3.1 - i * 0.9) * 0.12 + s.steer * 0.5;
    }
    this.skirt.rotation.x = 1.0 - sp * 0.05 + Math.sin(s.time * 7.0) * 0.02 * sp;

    this.root.updateMatrixWorld(true);
    const bodyInv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const toBody = (o: THREE.Object3D, v: THREE.Vector3) => v.applyMatrix4(o.matrixWorld).applyMatrix4(bodyInv);

    const hipBase = V(0, SEAT.y + 0.07, SEAT.z - 0.03);
    const mid = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // Pedal world pos → body space.
      const a = s.crank + (i === 0 ? 0 : Math.PI);
      const pedal = V(side * 0.14, BB.y - Math.cos(a) * CRANK, BB.z + Math.sin(a) * CRANK);
      const ankle = pedal.clone().add(V(0, 0.06, 0.03));
      const hip = hipBase.clone().add(V(side * 0.085, 0, 0));
      ik(hip, ankle, 0.43, 0.42, V(side * 0.12, 0.4, -1).normalize(), mid);
      this.thigh[i].set(hip, mid);
      this.shin[i].set(mid, ankle);
      this.knees[i].position.copy(mid);
      this.feet[i].position.copy(ankle).add(V(0, -0.03, 0));
      this.feet[i].rotation.x = -0.15 + Math.sin(a) * 0.25;

      // Arms: shoulder (in torso space) → grip (in steer space).
      const shoulder = toBody(this.torso, V(side * 0.17, 0.42, -0.01));
      const gripLocal = V(side * 0.26, 1.05, -0.17).sub(HEAD_BOT);
      const grip = toBody(this.steer, gripLocal);
      ik(shoulder, grip, 0.27, 0.27, V(side * 0.8, -0.6, 0.4).normalize(), mid);
      this.upperArm[i].set(shoulder, mid);
      this.foreArm[i].set(mid, grip);
      this.elbows[i].position.copy(mid);
      this.hands[i].position.copy(grip);
    }
    void dt;
  }
}

export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };
