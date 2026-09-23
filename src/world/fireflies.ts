import * as THREE from "three";
import { G } from "../render/materials";
import { roadX } from "./road";
import { mulberry32, range } from "../core/rng";

/**
 * A few dozen fireflies drifting low over the paddies (left, -u) and the verge, around the rider.
 * One instanced draw of camera-facing quads; HDR colour so the bloom pass makes the glow. Wander
 * happens in the vertex shader; the CPU only recycles z once a fly falls behind.
 */
export class Fireflies {
  readonly mesh: THREE.Mesh;
  private readonly off: THREE.InstancedBufferAttribute;
  private readonly u: Float32Array;
  private readonly r = mulberry32(911);
  private readonly n: number;

  constructor(n = 64) {
    this.n = n;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.attributes.position);
    g.instanceCount = n;
    this.off = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.off.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aOff", this.off);
    this.u = new Float32Array(n);
    for (let i = 0; i < n; i++) this.spawn(i, 0, true);

    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTime: G.uTime, uNight: G.uNight },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uNight;
        in vec4 aOff;
        out vec2 vQ; out float vB;
        void main(){
          float ph = aOff.w, t = uTime;
          vec3 c = aOff.xyz + vec3(sin(t * 0.37 + ph) * 0.9 + sin(t * 1.3 + ph * 2.0) * 0.2,
                                   sin(t * 0.8 + ph * 1.7) * 0.28,
                                   cos(t * 0.29 + ph * 1.3) * 0.9);
          // Slow blink: long dark gaps, a soft pulse (some flies out of phase).
          float bl = sin(t * (0.9 + fract(ph) * 0.9) + ph * 5.0);
          vB = smoothstep(0.1, 0.8, bl) * uNight;
          float d = distance(c, cameraPosition);
          // Never smaller than ~7 px so they survive the paint filter.
          float s = max(0.09, d * 0.0075) * step(0.01, vB);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vQ = position.xy * 2.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * s, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        in vec2 vQ; in float vB;
        layout(location = 0) out vec4 gColor;
        layout(location = 1) out vec4 gNormal;
        void main(){
          float r = length(vQ);
          if (r > 1.0 || vB < 0.01) discard;
          float k = 1.0 - smoothstep(0.2, 1.0, r);
          gColor = vec4(mix(vec3(0.55, 0.9, 0.25), vec3(1.0, 1.0, 0.7), k) * (0.6 + 4.0 * k) * vB, 1.0);
          gNormal = vec4(0.5, 0.5, 0.0, -1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  private spawn(i: number, z: number, init: boolean): void {
    const r = this.r;
    // Mostly over the paddies, a few along the right verge and village edge.
    const u = r() < 0.8 ? range(r, -18, -6.2) : range(r, 4.2, 7);
    const zz = init ? z + range(r, -70, 8) : z - range(r, 45, 70);
    this.u[i] = u;
    const a = this.off.array as Float32Array;
    a[i * 4] = roadX(zz) + u;
    a[i * 4 + 1] = range(r, 0.35, 1.7);
    a[i * 4 + 2] = zz;
    a[i * 4 + 3] = r() * 100;
  }

  /** z = rider position; keeps the swarm spanning ~70 m ahead to ~10 m behind. */
  update(z: number, night: number): void {
    this.mesh.visible = night > 0.02;
    if (!this.mesh.visible) return;
    const a = this.off.array as Float32Array;
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      const fz = a[i * 4 + 2];
      if (fz > z + 12 || fz < z - 90) {
        this.spawn(i, z, fz < z - 90);
        dirty = true;
      }
    }
    if (dirty) this.off.needsUpdate = true;
  }
}
