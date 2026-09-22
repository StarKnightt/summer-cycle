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
    const g = prep(new THREE.CylinderGeometry(r1, r0, 1, 12, 1), color, mat);
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
  private skirtGeo!: THREE.BufferGeometry;
  private skirtWaist = new THREE.Vector3();
  private bobEnds: THREE.Group[] = [];
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

  // ---------------------------------------------------------------- body

  /** Flat decal disc on the head surface at azimuth az (0 = front, +x = her left) / elevation el. */
  private onHead(g: THREE.BufferGeometry, az: number, el: number, lift: number, id: number, parent: THREE.Object3D = this.head): THREE.Mesh {
    const R = 0.124;
    const dir = V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const p = V(dir.x * 0.95, dir.y * 1.05, dir.z).multiplyScalar(R + lift);
    const m = new THREE.Matrix4().lookAt(p.clone().add(dir), p, V(0, 1, 0));
    m.setPosition(p);
    g.applyMatrix4(m);
    return this.add(g, parent, id);
  }

  private disc(rx: number, ry: number, color: string, mat: number = M.plain): THREE.BufferGeometry {
    const g = prep(new THREE.CylinderGeometry(1, 1, 0.003, 20, 1), color, mat);
    g.rotateX(Math.PI / 2);
    g.scale(rx, ry, 1);
    return g;
  }

  private buildBody(): void {
    const b = this.body;
    this.lean.add(b);
    const rid = ID.rider;
    const hip = V(0, SEAT.y + 0.1, SEAT.z - 0.02);

    // Pleated A-line skirt, rebuilt each frame so it drapes over the thighs/saddle and flutters.
    const cols = SKIRT_N * 2;
    const rings = 4;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((cols + 1) * rings * 3);
    const col = new Float32Array((cols + 1) * rings * 3);
    const uv = new Float32Array((cols + 1) * rings * 2);
    const navy = new THREE.Color(NAVY);
    for (let j = 0; j < rings; j++)
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        const shade = i % 2 ? 0.72 : 1.0;
        col[k * 3] = navy.r * shade;
        col[k * 3 + 1] = navy.g * shade;
        col[k * 3 + 2] = navy.b * shade;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = j / (rings - 1);
      }
    const idx: number[] = [];
    for (let j = 0; j < rings - 1; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, bb = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, bb, bb, c, d);
      }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    prep(g, null, M.cloth);
    this.skirtGeo = g;
    this.skirtWaist.copy(hip).add(V(0, -0.04, 0.0));
    this.skirt = new THREE.Mesh(g, uber(rid, 1, THREE.DoubleSide));
    this.skirt.frustumCulled = false;
    b.add(this.skirt);
    this.drapeSkirt(0, 0);
    const seat = sphere(0.15, NAVY, M.cloth, 16, 10);
    seat.scale(1.05, 0.55, 1.0);
    seat.translate(hip.x, hip.y - 0.06, hip.z + 0.03);
    this.add(seat, b, rid);

    // Torso (leans forward from the hips).
    this.torso.position.copy(hip);
    this.torso.rotation.x = -0.28;
    b.add(this.torso);
    const chest = prep(new THREE.CylinderGeometry(0.135, 0.11, 0.44, 14, 4), BLOUSE, M.cloth);
    const cp = chest.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      const bulge = 1 + 0.12 * Math.sin(((y + 0.22) / 0.44) * Math.PI);
      cp.setXYZ(i, cp.getX(i) * bulge, y, cp.getZ(i) * 0.7 * bulge);
    }
    chest.computeVertexNormals();
    chest.translate(0, 0.25, 0);
    this.add(chest, this.torso, rid);
    const yoke = sphere(0.135, BLOUSE, M.cloth, 16, 8);
    yoke.scale(1.08, 0.42, 0.72);
    yoke.translate(0, 0.46, 0);
    this.add(yoke, this.torso, rid);
    for (const s of [-1, 1]) {
      const sleeve = sphere(0.058, BLOUSE, M.cloth, 12, 8);
      sleeve.scale(1, 1.1, 1);
      sleeve.translate(s * 0.162, 0.41, -0.005);
      this.add(sleeve, this.torso, rid);
      // Navy sleeve cuff stripe.
      const cuff = prep(new THREE.TorusGeometry(0.052, 0.008, 5, 14), NAVY, M.cloth);
      cuff.rotateZ(Math.PI / 2);
      cuff.translate(s * 0.19, 0.37, -0.005);
      this.add(cuff, this.torso, rid);
    }
    this.add(xf(box(0.25, 0.05, 0.17, NAVY, M.cloth), 0, 0.03, 0), this.torso, rid);
    // Big square sailor collar on the back with two white stripes (reads from the chase cam).
    this.add(xf(box(0.3, 0.25, 0.02, NAVY, M.cloth), 0, 0.35, 0.1, 0.14), this.torso, rid);
    for (const y of [0.25, 0.28]) this.add(xf(box(0.27, 0.012, 0.024, "#f4f2ec", M.cloth), 0, y, 0.112, 0.14), this.torso, rid);
    for (const s of [-1, 1]) {
      this.add(xf(box(0.012, 0.22, 0.024, "#f4f2ec", M.cloth), s * 0.12, 0.35, 0.112, 0.14), this.torso, rid);
      // Front lapels of the collar forming a V.
      this.add(xf(box(0.07, 0.2, 0.015, NAVY, M.cloth), s * 0.06, 0.37, -0.1, -0.2, 0, s * 0.45), this.torso, rid);
    }
    this.add(xf(box(0.09, 0.11, 0.03, "#c8363a", M.cloth), 0, 0.33, -0.11, -0.2), this.torso, rid);
    // Neck + head.
    this.add(xf(cyl(0.04, 0.046, 0.16, SKIN, M.skin, 10), 0, 0.54, 0), this.torso, ID.skin);
    this.head.position.set(0, 0.72, -0.01);
    this.head.scale.setScalar(1.14);
    this.torso.add(this.head);
    const face = sphere(0.125, SKIN, M.skin, 24, 16);
    face.scale(0.95, 1.05, 1.0);
    // Softer, slightly pointed chin.
    const fp = face.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const y = fp.getY(i), z = fp.getZ(i);
      if (y < -0.03 && z < 0) fp.setZ(i, z * (1 + (-0.03 - y) * 1.2));
    }
    face.computeVertexNormals();
    this.add(face, this.head, ID.skin);

    // Anime eyes: white, large dark iris, highlight, bold upper lash line with outer flick.
    const EYE_AZ = 0.46;
    for (const s of [-1, 1]) {
      const az = s * EYE_AZ;
      this.onHead(this.disc(0.024, 0.031, "#fbf8f2"), az, -0.02, 0.001, ID.skin);
      this.onHead(this.disc(0.019, 0.028, "#5a3322"), az - s * 0.02, -0.03, 0.003, ID.eye);
      this.onHead(this.disc(0.009, 0.013, "#1c100c"), az - s * 0.02, -0.025, 0.004, ID.eye);
      this.onHead(this.disc(0.0065, 0.0075, "#ffffff"), az - s * 0.05, 0.005, 0.006, ID.eye);
      const lash = box(0.05, 0.007, 0.004, "#1a100c");
      lash.rotateZ(-s * 0.18);
      this.onHead(lash, az, 0.105, 0.004, ID.eye);
      const flick = box(0.014, 0.006, 0.004, "#1a100c");
      flick.rotateZ(-s * 0.7);
      this.onHead(flick, az + s * 0.21, 0.09, 0.004, ID.eye);
      const brow = box(0.04, 0.006, 0.004, "#3a2418");
      brow.rotateZ(s * 0.12);
      this.onHead(brow, az * 0.95, 0.31, 0.004, ID.eye);
      this.onHead(this.disc(0.02, 0.009, "#f2a2a0", M.skin), s * 0.62, -0.28, 0.001, ID.skin);
    }
    this.onHead(this.disc(0.011, 0.0035, "#b0524c"), 0, -0.47, 0.002, ID.skin);
    this.onHead(this.disc(0.004, 0.006, "#e8b49a", M.skin), 0, -0.2, 0.004, ID.skin);

    // Hair: back shell, strand fringe, side locks, swaying bob ends, ponytail chain.
    const shell = sphere(0.14, HAIR, M.hair, 24, 16);
    shell.scale(1.0, 1.02, 1.06);
    const sp = shell.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i), y = sp.getY(i);
      if (z < -0.01 && y < 0.06) sp.setZ(i, z * 0.3 + 0.025);
    }
    shell.computeVertexNormals();
    shell.translate(0, 0.022, 0.012);
    this.add(shell, this.head, ID.hair);
    for (let i = 0; i < 5; i++) {
      const az = (i - 2) * 0.24;
      const strand = prep(new THREE.ConeGeometry(0.034, 0.075, 6, 1), HAIR, M.hair);
      strand.rotateX(Math.PI);
      strand.scale(1, 1, 0.45);
      strand.translate(0, -0.02, 0);
      this.onHead(strand, az, 0.52 - Math.abs(i - 2) * 0.05, 0.012, ID.hair);
    }
    for (const s of [-1, 1]) {
      const lock = prep(new THREE.ConeGeometry(0.022, 0.11, 6, 1), HAIR, M.hair);
      lock.rotateX(Math.PI);
      lock.scale(1, 1, 0.5);
      lock.translate(0, -0.05, 0);
      this.onHead(lock, s * 1.62, 0.02, 0.006, ID.hair);
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.PI - 1.2 + (i / 5) * 2.4;
      const grp = new THREE.Group();
      grp.position.set(Math.sin(a) * 0.12, -0.07, -Math.cos(a) * 0.125);
      this.head.add(grp);
      const end = prep(new THREE.ConeGeometry(0.035, 0.09, 5, 1), HAIR, M.hair);
      end.rotateX(Math.PI);
      end.translate(0, -0.035, 0);
      this.add(end, grp, ID.hair);
      this.bobEnds.push(grp);
    }
    let parent: THREE.Object3D = this.head;
    this.add(xf(cyl(0.032, 0.032, 0.035, "#c8363a", M.cloth, 10), 0, 0.04, 0.145, Math.PI / 2), this.head, ID.rider);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.04 : -0.085, i === 0 ? 0.16 : 0.0);
      parent.add(seg);
      const pg = sphere(0.05 - i * 0.009, HAIR, M.hair, 12, 8);
      pg.scale(1, 1.9, 0.9);
      pg.translate(0, -0.05, 0);
      this.add(pg, seg, ID.hair);
      this.pony.push(seg);
      parent = seg;
    }

    // Limbs (updated every frame via IK): tapered round sections, thin wrists and ankles.
    for (let s = 0; s < 2; s++) {
      this.thigh.push(new Limb(b, 0.068, 0.05, SKIN, M.skin, ID.skin));
      this.shin.push(new Limb(b, 0.047, 0.03, SOCK, M.cloth, rid));
      this.upperArm.push(new Limb(b, 0.044, 0.033, SKIN, M.skin, ID.skin));
      this.foreArm.push(new Limb(b, 0.034, 0.022, SKIN, M.skin, ID.skin));
      const knee = mk(sphere(0.049, SKIN, M.skin, 12, 8), ID.skin);
      const elbow = mk(sphere(0.034, SKIN, M.skin, 10, 6), ID.skin);
      const footG = sphere(0.05, SHOE, M.plain, 10, 6);
      footG.scale(0.8, 0.6, 1.7);
      footG.translate(0, 0, -0.04);
      const foot = mk(footG, rid);
      const hg = sphere(0.03, SKIN, M.skin, 10, 6);
      hg.scale(0.9, 1.0, 1.2);
      const hand = mk(hg, ID.skin);
      b.add(knee, elbow, foot, hand);
      this.knees.push(knee);
      this.elbows.push(elbow);
      this.feet.push(foot);
      this.hands.push(hand);
    }
  }

  /** Recompute skirt vertices: pleated A-line that lies on the thighs in front, hangs behind. */
  private drapeSkirt(speed: number, time: number): void {
    const g = this.skirtGeo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const cols = SKIRT_N * 2;
    const rings = 4;
    const W = this.skirtWaist;
    const sp = Math.min(speed / 8, 1.3);
    const fwd = V(0, -0.4, -1).normalize();
    const back = V(0, -1, 0.3).normalize();
    const d = new THREE.Vector3();
    for (let j = 0; j < rings; j++) {
      const t = j / (rings - 1);
      for (let i = 0; i <= cols; i++) {
        const a = (i / cols) * Math.PI * 2;
        const rx = Math.sin(a), rz = Math.cos(a);
        const f = (1 - rz) / 2; // 0 back, 1 front
        d.copy(back).lerp(fwd, f).normalize();
        const pleat = i % 2 ? 0.84 : 1.0;
        const rWaist = 0.15;
        const flare = 0.13 * pleat;
        const rad = rWaist * (1 - t) + (rWaist + flare) * t;
        const len = 0.31 * (f > 0.6 ? 0.9 : 1.0);
        const flut = Math.sin(time * 9 + a * 3 + j) * 0.012 * sp * t * t;
        const drift = 0.05 * sp * t * t * (1 - f);
        const k = j * (cols + 1) + i;
        p.setXYZ(
          k,
          W.x + rx * rad * 1.12 + rx * flut,
          W.y + d.y * len * t + flut * 0.6,
          W.z + rz * rad * 0.9 + d.z * len * t + drift,
        );
      }
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Hide head/hair (first-person view) or show them. */
  setFirstPerson(on: boolean): void {
    if (on === this.fppOn) return;
    this.fppOn = on;
    // Only drop the main-view layer: the head keeps casting its shadow and reflecting.
    const set = (o: THREE.Object3D) => o.traverse((c) => (on ? c.layers.disable(0) : c.layers.enable(0)));
    set(this.torso);
    for (const l of this.upperArm) set(l.mesh);
    for (const e of this.elbows) set(e);
  }
  private fppOn = false;

  /** World-space eye point (between the eyes, slightly forward). */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return out.set(0, 0.01, -0.07).applyMatrix4(this.head.matrixWorld);
  }

  update(dt: number, s: RiderState): void {
    this.lean.rotation.z = s.lean;
    this.steer.setRotationFromAxisAngle(this.steerAxis, s.steer);
    this.frontWheel.rotation.x = -s.wheel;
    this.rearWheel.rotation.x = -s.wheel;
    this.crank.rotation.x = -s.crank;
    for (const p of this.pedals) p.rotation.x = s.crank; // keep pedals level

    const bob = Math.sin(s.crank * 2) * 0.008 * s.pedaling;
    this.torso.position.y = SEAT.y + 0.1 + bob;
    this.torso.rotation.z = Math.sin(s.crank) * 0.025 * s.pedaling;
    this.torso.rotation.x = -0.28 - Math.min(s.speed / 12, 1) * 0.08;
    this.head.rotation.y = Math.sin(s.time * 0.37) * 0.12 + Math.sin(s.time * 0.13) * 0.1;
    this.head.rotation.x = 0.14 + Math.sin(s.time * 0.21) * 0.04;
    this.head.rotation.z = -s.lean * 0.5;
    const sp = Math.min(s.speed / 8, 1.2);
    for (let i = 0; i < this.pony.length; i++) {
      const p = this.pony[i];
      p.rotation.x = -(0.3 + sp * (0.35 + i * 0.14) + Math.sin(s.time * 5.5 - i * 0.8) * 0.14 * (0.5 + sp));
      p.rotation.z = Math.sin(s.time * 3.1 - i * 0.9) * 0.2 * (0.5 + sp) + s.steer * 0.5;
    }
    for (let i = 0; i < this.bobEnds.length; i++) {
      const e = this.bobEnds[i];
      e.rotation.x = -(0.15 + sp * 0.35) + Math.sin(s.time * 7 + i * 1.3) * 0.12 * sp;
      e.rotation.z = Math.sin(s.time * 6 + i) * 0.1 * sp;
    }
    this.drapeSkirt(s.speed, s.time);

    this.root.updateMatrixWorld(true);
    const bodyInv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const toBody = (o: THREE.Object3D, v: THREE.Vector3) => v.applyMatrix4(o.matrixWorld).applyMatrix4(bodyInv);

    const hipBase = V(0, SEAT.y + 0.07, SEAT.z - 0.03);
    const mid = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
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

      const shoulder = toBody(this.torso, V(side * 0.165, 0.41, -0.01));
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

const SKIRT_N = 14;

export const BIKE = { WHEEL_R, WHEELBASE: FRONT.distanceTo(REAR) };
