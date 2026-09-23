import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { TOD_GRADE } from "./todUniforms";
import { G } from "./materials";
import type { Profiler } from "./profiler";

const FS_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Scene → MRT (colour, normal/id/mask, depth) → [paint filter + ink outlines] → bloom →
 * [warm grade, vignette, paper grain, sRGB] → FXAA.
 */
export class Post {
  readonly mrt: THREE.WebGLRenderTarget;
  readonly composer: EffectComposer;
  private ink: ShaderPass;
  private grade: ShaderPass;
  private smaa: SMAAPass;
  private sharpen: ShaderPass;
  readonly bloom: UnrealBloomPass;
  prof: Profiler | null = null;
  private wrapped = false;
  sceneCalls = 0;
  sceneTris = 0;

  get msaa(): number {
    return this.mrt.samples;
  }

  /** Change scene-pass MSAA at runtime (the target re-allocates on next use); SMAA covers 0. */
  setMsaa(n: number): void {
    if (this.mrt.samples === n) return;
    this.mrt.samples = n;
    this.mrt.dispose();
    this.smaa.enabled = n === 0;
  }

  constructor(private renderer: THREE.WebGLRenderer, w: number, h: number, opts: { kuwahara: boolean; msaa?: number }) {
    const pr = renderer.getPixelRatio();
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.mrt = new THREE.WebGLRenderTarget(W, H, {
      count: 2,
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(W, H, THREE.UnsignedIntType),
      // MSAA on the scene pass: thin blades, wires and lattice resolve without sub-pixel crawl.
      samples: opts.msaa ?? 4,
    });
    this.mrt.textures[0].name = "color";
    this.mrt.textures[1].name = "normal";

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);

    this.ink = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        tColor: { value: null },
        tNormal: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(W, H) },
        uNear: { value: 0.15 },
        uFar: { value: 4200 },
        uWidth: { value: Math.max(1.0, H / 1080) * 1.35 },
        uKuwa: { value: opts.kuwahara ? 1 : 0 },
        uInk: { value: new THREE.Color("#1c1418") },
      },
      vertexShader: FS_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tNormal, tDepth;
        uniform vec2 uRes; uniform float uNear, uFar, uWidth, uKuwa; uniform vec3 uInk;
        varying vec2 vUv;
        float linz(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

        // 4-sector Kuwahara (radius 2): flattens texture into gouache-like patches, keeps edges.
        vec4 kuwahara(vec2 uv){
          vec2 px = 1.0 / uRes;
          vec3 m[4]; float s[4];
          for (int k = 0; k < 4; k++){
            vec2 dir = vec2(k == 1 || k == 2 ? -1.0 : 1.0, k >= 2 ? -1.0 : 1.0);
            vec3 sum = vec3(0.0); float sq = 0.0;
            for (int j = 0; j <= 2; j++) for (int i = 0; i <= 2; i++){
              vec3 c = texture2D(tColor, uv + vec2(float(i), float(j)) * dir * px).rgb;
              sum += c; float l = lum(c); sq += l * l;
            }
            vec3 mean = sum / 9.0; float lm = lum(mean);
            m[k] = mean; s[k] = sq / 9.0 - lm * lm;
          }
          vec3 best = m[0]; float bs = s[0];
          for (int k = 1; k < 4; k++) if (s[k] < bs) { bs = s[k]; best = m[k]; }
          // Even the calmest sector is busy: this is real detail (lattice, leaves, tiles), keep it.
          return vec4(best, bs);
        }

        void main(){
          vec2 px = uWidth / uRes;
          vec3 col = texture2D(tColor, vUv).rgb;
          // Eye features (irises, catch-lights, lashes, brows, glasses) stay crisp: no paint filter.
          bool crisp = abs(texture2D(tNormal, vUv).z * 32.0 - 19.0) < 0.5;
          float dC = linz(texture2D(tDepth, vUv).r);
          float iC = 1.0 / dC;
          vec4 nC = texture2D(tNormal, vUv);
          float eD = 0.0, eN = 0.0, eI = 0.0, mask = max(nC.a, 0.0);
          vec2 offs[4];
          offs[0] = vec2(1.0, 0.0); offs[1] = vec2(0.0, 1.0); offs[2] = vec2(0.7071, 0.7071); offs[3] = vec2(0.7071, -0.7071);
          for (int i = 0; i < 4; i++){
            vec2 o = offs[i] * px;
            vec4 n1 = texture2D(tNormal, vUv + o), n2 = texture2D(tNormal, vUv - o);
            // Excluded surfaces (mask < 0: grass, leaf cards, motes) never ink or induce ink.
            if (n1.a < 0.0 || n2.a < 0.0) continue;
            float i1 = 1.0 / linz(texture2D(tDepth, vUv + o).r);
            float i2 = 1.0 / linz(texture2D(tDepth, vUv - o).r);
            // Laplacian of 1/z is zero on planes: only creases and silhouettes light up.
            eD = max(eD, abs(i1 + i2 - 2.0 * iC) / iC);
            eN = max(eN, length(n1.xy - nC.xy) + length(n2.xy - nC.xy));
            eI = max(eI, step(0.01, abs(n1.z - nC.z)) + step(0.01, abs(n2.z - nC.z)));
            mask = max(mask, max(n1.a, n2.a));
          }
          if (nC.a < 0.0) mask = 0.0;
          float e = max(smoothstep(0.05, 0.16, eD), smoothstep(0.55, 1.0, eN));
          e = max(e, min(eI, 1.0));
          // Paint filter: a light gouache flattening on calm mid/far surfaces only. It stays off
          // near the camera, on ink edges and on fine detail (it boils frame to frame there).
          if (uKuwa > 0.5 && !crisp) {
            float wK = 0.5 * smoothstep(6.0, 40.0, dC) * (1.0 - clamp(max(e, min(eI, 1.0)) * 1.5, 0.0, 1.0));
            if (wK > 0.02) {
              vec4 k = kuwahara(vUv);
              wK *= 1.0 - smoothstep(0.0015, 0.012, k.a);
              col = mix(col, k.rgb, wK);
            }
          }
          float fade = 1.0 - smoothstep(60.0, 420.0, dC) * 0.75;
          e *= clamp(mask, 0.0, 1.0) * fade;
          vec3 inkCol = mix(col * 0.22, uInk, 0.55);
          col = mix(col, inkCol, clamp(e, 0.0, 1.0) * 0.92);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.ink.uniforms.tColor.value = this.mrt.textures[0];
    this.ink.uniforms.tNormal.value = this.mrt.textures[1];
    this.ink.uniforms.tDepth.value = this.mrt.depthTexture;
    this.composer.addPass(this.ink);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.28, 0.5, 1.0);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(W, H) },
        uTime: { value: 0 },
      },
      vertexShader: FS_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime;
        uniform vec3 uGradeMul; uniform float uSat;
        varying vec2 vUv;
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
        vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb * uGradeMul;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          // Split tone: cool teal shadows, warm (#fff1d8) highlight lift.
          c *= mix(vec3(0.96, 1.0, 1.04), vec3(1.0, 0.945, 0.85) * 1.04, smoothstep(0.08, 0.75, l));
          // Soft shoulder.
          c = c / (1.0 + max(c - 0.85, 0.0) * 0.8);
          vec3 s = toSRGB(c);
          // Vignette.
          vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
          s *= mix(1.0, 0.8, smoothstep(0.45, 1.05, length(q)));
          // Paper / brush grain (screen space, very subtle).
          vec2 fc = gl_FragCoord.xy;
          float paper = vn(fc * 0.35) * 0.5 + vn(fc * 0.09 + 7.0) * 0.5;
          float fib = vn(vec2(fc.x * 0.02, fc.y * 0.6));
          s *= 0.975 + paper * 0.04 + fib * 0.012;
          s += (h12(fc) - 0.5) * 0.01;
          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }`,
    });
    Object.assign(this.grade.uniforms, TOD_GRADE);
    this.composer.addPass(this.grade);

    // SMAA keeps thin lines (wires, lattice, blades) crisp where FXAA smeared them.
    this.smaa = new SMAAPass();
    // With MSAA on the scene pass, SMAA only re-softens already resolved edges.
    this.smaa.enabled = !(opts.msaa ?? 4);
    this.composer.addPass(this.smaa);
    // Mild contrast-adaptive sharpening (AMD CAS style): recovers texture after AA without halos.
    this.sharpen = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uAmount: { value: 0.45 } },
      vertexShader: FS_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uAmount;
        varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
          vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
          vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
          vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
          vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
          // Less sharpening where local contrast is already high (edges), more on soft texture.
          vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
          vec3 wgt = -amp * mix(0.125, 0.2, uAmount);
          vec3 o = (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
          gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
        }`,
    });
    this.composer.addPass(this.sharpen);
  }

  /** Compile the SMAA programs up front, so a later step down to SMAA doesn't hitch mid-ride. */
  warmSmaa(): void {
    const was = this.smaa.enabled;
    this.smaa.enabled = true;
    this.composer.render();
    this.smaa.enabled = was;
  }

  /** Keep depth linearisation in sync with the camera (FPP uses a much smaller near plane). */
  setNear(n: number): void {
    this.ink.uniforms.uNear.value = n;
  }

  setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.mrt.setSize(W, H);
    this.composer.setSize(w, h);
    this.ink.uniforms.uRes.value.set(W, H);
    this.ink.uniforms.uWidth.value = Math.max(1.0, H / 1080) * 1.35;
    this.grade.uniforms.uRes.value.set(W, H);
    this.sharpen.uniforms.uTexel.value.set(1 / W, 1 / H);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    const c0 = this.renderer.info.render.calls, t0 = this.renderer.info.render.triangles;
    const pf = this.prof?.on ? this.prof : null;
    if (pf && !this.wrapped) {
      this.wrapped = true;
      const names = ["ink+kuwahara", "bloom", "grade", "smaa", "sharpen"];
      this.composer.passes.forEach((p, i) => {
        const r = p.render.bind(p);
        p.render = (...a: Parameters<typeof r>) => {
          pf.begin(names[i] ?? `pass${i}`, this.renderer);
          r(...a);
          pf.end(names[i] ?? `pass${i}`, this.renderer);
        };
      });
    }
    pf?.begin("scene", this.renderer);
    const rd = this.renderer;
    rd.setRenderTarget(this.mrt);
    rd.clear();
    G.uDither.value = this.mrt.samples === 0 ? 1 : 0;
    rd.render(scene, camera);
    G.uDither.value = 0;
    pf?.end("scene", this.renderer);
    this.sceneCalls = this.renderer.info.render.calls - c0;
    this.sceneTris = this.renderer.info.render.triangles - t0;
    this.renderer.setRenderTarget(null);
    this.grade.uniforms.uTime.value = time;
    this.composer.render();
  }
}
