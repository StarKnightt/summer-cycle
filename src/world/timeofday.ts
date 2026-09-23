import * as THREE from "three";
import { G } from "../render/materials";
import { TOD_GRADE } from "../render/todUniforms";
import type { Post } from "../render/post";
import type { SunShadow } from "../render/lightpasses";

/**
 * Time of day: afternoon → golden hour → sunset → dusk (blue hour). Each preset is a flat table of
 * light/sky/grade values; the current state is interpolated between presets and written into the
 * existing shared uniforms (`G`, the grade pass, the bloom pass). The afternoon preset is read
 * back from those uniforms at start-up, so the default look is exactly the untouched scene.
 */
export const PRESETS = ["afternoon", "golden", "sunset", "dusk"] as const;
export type Preset = (typeof PRESETS)[number];

type RGB = [number, number, number];
interface Look {
  az: number; // sun azimuth, degrees: atan2(x, z) (0 = behind the rider, ±180 = ahead, -90 = left)
  el: number; // true sun elevation (sky, disk, clouds, shadows)
  shadeMin: number; // shading light never goes lower than this (keeps flat ground readable)
  sun: RGB; shadow: RGB; rim: RGB;
  zenith: RGB; mid: RGB; horizon: RGB; fog: RGB; fogD: number;
  glow: RGB; glowA: number; glowB: number;
  haze: RGB; hazeA: number;
  hgl: RGB; hglA: number; hglF: number;
  cTop: RGB; cMid: RGB; cLow: RGB; cRim: RGB; cRimK: number; cBack: number; cUnder: RGB; cUnderA: number;
  wisp: RGB; disk: RGB; stars: number; night: number;
  world: RGB; far: RGB; farHaze: number; glint: number;
  grade: RGB; sat: number;
  bloomS: number; bloomR: number; bloomT: number;
  evening: number;
  birds: number; // share of bird flocks aloft
}

/** sRGB hex → linear (what `new THREE.Color(hex)` stores), optionally scaled. */
const hx = (hex: string, k = 1): RGB => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
const cv = (c: THREE.Color): RGB => [c.r, c.g, c.b];

const DEG = Math.PI / 180;

// Art direction (Shinkai magic hour): saturated gradient skies, sun low and ahead so the sky glows
// in front of the rider, cumulus lit gold/pink underneath with lavender shadow sides, long raking
// shadows, warm rim light on everything; blue hour goes indigo with a last orange band.
const LOOKS: Record<Exclude<Preset, "afternoon">, Look> = {
  golden: {
    az: -72, el: 12, shadeMin: 15,
    sun: hx("#ffc98a", 1.02), shadow: hx("#8583ad"), rim: hx("#ffc07a", 1.7),
    zenith: hx("#1b5c80"), mid: hx("#4d9cbc"), horizon: hx("#f4d6a8"), fog: hx("#e4d3b2"), fogD: 0.0011,
    glow: [1.0, 0.7, 0.36], glowA: 0.3, glowB: 0.5,
    haze: [0.96, 0.8, 0.58], hazeA: 0.42,
    hgl: hx("#ffc58a"), hglA: 0.45, hglF: 7,
    cTop: [1.0, 0.86, 0.6], cMid: [0.86, 0.74, 0.72], cLow: [0.44, 0.42, 0.62], cRim: [1.0, 0.86, 0.6], cRimK: 0.6, cBack: 0.5,
    cUnder: [1.0, 0.7, 0.45], cUnderA: 0.25,
    wisp: [1.0, 0.88, 0.74], disk: [2.2, 1.85, 1.3], stars: 0, night: 0,
    world: [1.05, 0.97, 0.87], far: [1.02, 0.94, 0.88], farHaze: 0.1, glint: 0.6,
    grade: [1.02, 1.0, 0.97], sat: 1.08,
    bloomS: 0.34, bloomR: 0.5, bloomT: 0.95,
    evening: 0.8,
    birds: 1,
  },
  sunset: {
    az: -160, el: 4.5, shadeMin: 13,
    sun: hx("#f7ae82", 0.88), shadow: hx("#6f5f96"), rim: hx("#ff9448", 2.2),
    zenith: hx("#2a4a7a"), mid: hx("#b98aac"), horizon: hx("#ffb070"), fog: hx("#d89e8a"), fogD: 0.0012,
    glow: [1.0, 0.6, 0.28], glowA: 0.42, glowB: 0.6,
    haze: [1.0, 0.64, 0.4], hazeA: 0.38,
    hgl: hx("#ff8a5c"), hglA: 0.62, hglF: 5,
    cTop: [1.0, 0.76, 0.46], cMid: [0.95, 0.56, 0.52], cLow: [0.42, 0.3, 0.5], cRim: [1.0, 0.72, 0.38], cRimK: 0.75, cBack: 0.9,
    cUnder: [1.0, 0.6, 0.36], cUnderA: 0.75,
    wisp: [1.0, 0.62, 0.5], disk: [2.6, 1.95, 1.2], stars: 0, night: 0.3,
    world: [0.98, 0.86, 0.8], far: [0.52, 0.42, 0.64], farHaze: 0.2, glint: 0.55,
    grade: [1.02, 0.98, 0.96], sat: 1.12,
    bloomS: 0.42, bloomR: 0.55, bloomT: 0.95,
    evening: 0.95,
    birds: 0.5,
  },
  dusk: {
    az: -154, el: -3, shadeMin: 18,
    sun: hx("#56609a"), shadow: hx("#414a7c"), rim: hx("#ff9a6a", 0.7),
    zenith: hx("#141a46"), mid: hx("#3a4c7c"), horizon: hx("#dd8e6c"), fog: hx("#4c5679"), fogD: 0.0016,
    glow: [1.0, 0.55, 0.35], glowA: 0.18, glowB: 0.12,
    haze: [0.56, 0.45, 0.56], hazeA: 0.3,
    hgl: hx("#ff9a60"), hglA: 0.55, hglF: 14,
    cTop: [0.36, 0.31, 0.47], cMid: [0.25, 0.24, 0.4], cLow: [0.13, 0.14, 0.27], cRim: [0.9, 0.55, 0.45], cRimK: 0.25, cBack: 0.25,
    cUnder: [0.8, 0.44, 0.42], cUnderA: 0.4,
    wisp: [0.6, 0.5, 0.66], disk: [0, 0, 0], stars: 1, night: 1,
    world: [0.42, 0.46, 0.66], far: [0.4, 0.43, 0.66], farHaze: 0.35, glint: 0,
    grade: [0.97, 0.98, 1.04], sat: 1.05,
    bloomS: 0.7, bloomR: 0.6, bloomT: 0.8,
    evening: 1.0,
    birds: 0,
  },
};

function snapshotAfternoon(post: Post): Look {
  const d = G.uSunDir.value;
  const S = G.uSkySun.value;
  return {
    az: Math.atan2(S.x, S.z) / DEG, el: Math.asin(S.y) / DEG, shadeMin: Math.asin(d.y) / DEG,
    sun: cv(G.uSunColor.value), shadow: cv(G.uShadowTint.value), rim: cv(G.uRimColor.value),
    zenith: cv(G.uSkyZenith.value), mid: cv(G.uSkyMid.value), horizon: cv(G.uSkyHorizon.value), fog: cv(G.uFogColor.value), fogD: G.uFogDensity.value,
    glow: cv(G.uSunGlow.value), glowA: G.uSunGlowAmt.value.x, glowB: G.uSunGlowAmt.value.y,
    haze: cv(G.uHaze.value), hazeA: G.uHazeAmt.value,
    hgl: cv(G.uHorizGlow.value), hglA: G.uHorizGlowK.value.x, hglF: G.uHorizGlowK.value.y,
    cTop: cv(G.uCloudTop.value), cMid: cv(G.uCloudMid.value), cLow: cv(G.uCloudLow.value), cRim: cv(G.uCloudRim.value),
    cRimK: G.uCloudK.value.x, cBack: G.uCloudK.value.y, cUnder: cv(G.uCloudUnder.value), cUnderA: G.uCloudK.value.z,
    wisp: cv(G.uWisp.value), disk: cv(G.uSunDisk.value), stars: G.uStars.value, night: G.uNight.value,
    world: cv(G.uWorldTint.value), far: cv(G.uFarTint.value), farHaze: G.uFarHaze.value, glint: G.uGlint.value,
    grade: cv(TOD_GRADE.uGradeMul.value), sat: TOD_GRADE.uSat.value,
    bloomS: post.bloom.strength, bloomR: post.bloom.radius, bloomT: post.bloom.threshold,
    evening: 0.65,
    birds: 1,
  };
}

function mix(a: Look, b: Look, k: number): Look {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(a) as (keyof Look)[]) {
    const x = a[key], y = b[key];
    out[key] = Array.isArray(x) ? x.map((v, i) => v + ((y as RGB)[i] - v) * k) : (x as number) + ((y as number) - (x as number)) * k;
  }
  return out as unknown as Look;
}

const dirFrom = (v: THREE.Vector3, azDeg: number, elDeg: number) => {
  const a = azDeg * DEG, e = elDeg * DEG;
  return v.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

/** Seconds for a T-key transition, and for the full timelapse (afternoon → dusk). */
const TRANSITION = 3.6;
const TIMELAPSE = 40;

export class TimeOfDay {
  private readonly looks: Look[];
  private from: Look;
  private to: Look;
  private k = 1;
  private idx = 0;
  private cur: Look;
  private lapse: boolean;
  private lapseT = 0;
  private readonly shadowDir = new THREE.Vector3();

  constructor(private post: Post, private shadow: SunShadow, params: URLSearchParams) {
    const aft = snapshotAfternoon(post);
    // Afternoon keeps its own sun: shading light = the true sun (shadeMin = its elevation).
    this.looks = [aft, LOOKS.golden, LOOKS.sunset, LOOKS.dusk];
    const start = PRESETS.indexOf((params.get("time") ?? "afternoon") as Preset);
    this.idx = start < 0 ? 0 : start;
    this.cur = this.from = this.to = this.looks[this.idx];
    this.lapse = params.has("timelapse") && params.get("timelapse") !== "0";
    if (this.lapse) this.idx = 0;
    this.apply(this.lapse ? this.looks[0] : this.cur);
    addEventListener("keydown", (e) => {
      if (e.code === "KeyT" && !e.repeat) this.cycle();
    });
  }

  get preset(): Preset {
    return PRESETS[this.idx];
  }
  get evening(): number {
    return this.cur.evening;
  }
  get birds(): number {
    return this.cur.birds;
  }
  get night(): number {
    return this.cur.night;
  }

  /** Next preset (wraps dusk → afternoon), with a smooth transition from wherever we are now. */
  cycle(): void {
    this.set(PRESETS[(this.idx + 1) % PRESETS.length]);
  }

  set(p: Preset, instant = false): void {
    this.lapse = false;
    this.idx = PRESETS.indexOf(p);
    this.from = this.cur;
    this.to = this.looks[this.idx];
    this.k = instant ? 1 : 0;
    if (instant) this.cur = this.to;
  }

  /** Continuous 0…3 position along afternoon → golden → sunset → dusk. */
  private along(s: number): Look {
    const i = Math.min(2, Math.floor(s));
    const f = s - i;
    return mix(this.looks[i], this.looks[i + 1], f * f * (3 - 2 * f) * 0.35 + f * 0.65);
  }

  update(dt: number): void {
    if (this.lapse) {
      // Hold the afternoon a moment, then the sun sets steadily; linger on the sunset glow.
      this.lapseT += dt;
      const x = Math.min(1, Math.max(0, (this.lapseT - 2) / (TIMELAPSE - 4)));
      const s = x < 0.7 ? (x / 0.7) * 2.1 : 2.1 + ((x - 0.7) / 0.3) * 0.9;
      this.cur = this.along(Math.min(3, s));
      this.idx = Math.min(3, Math.round(s));
    } else if (this.k < 1) {
      this.k = Math.min(1, this.k + dt / TRANSITION);
      const e = this.k * this.k * (3 - 2 * this.k);
      this.cur = mix(this.from, this.to, e);
    }
    this.apply(this.cur);
  }

  private apply(l: Look): void {
    dirFrom(G.uSkySun.value, l.az, l.el);
    dirFrom(G.uSunDir.value, l.az, Math.max(l.el, l.shadeMin));
    // Shadows follow the true sun but never from below the horizon.
    this.shadow.dir = dirFrom(this.shadowDir, l.az, Math.max(l.el, 3));
    G.uSunColor.value.setRGB(...l.sun);
    G.uShadowTint.value.setRGB(...l.shadow);
    G.uRimColor.value.setRGB(...l.rim);
    G.uSkyZenith.value.setRGB(...l.zenith);
    G.uSkyMid.value.setRGB(...l.mid);
    G.uSkyHorizon.value.setRGB(...l.horizon);
    G.uFogColor.value.setRGB(...l.fog);
    G.uFogDensity.value = l.fogD;
    G.uSunGlow.value.setRGB(...l.glow);
    G.uSunGlowAmt.value.set(l.glowA, l.glowB);
    G.uHaze.value.setRGB(...l.haze);
    G.uHazeAmt.value = l.hazeA;
    G.uHorizGlow.value.setRGB(...l.hgl);
    G.uHorizGlowK.value.set(l.hglA, l.hglF);
    G.uCloudTop.value.setRGB(...l.cTop);
    G.uCloudMid.value.setRGB(...l.cMid);
    G.uCloudLow.value.setRGB(...l.cLow);
    G.uCloudRim.value.setRGB(...l.cRim);
    G.uCloudK.value.set(l.cRimK, l.cBack, l.cUnderA);
    G.uCloudUnder.value.setRGB(...l.cUnder);
    G.uWisp.value.setRGB(...l.wisp);
    G.uSunDisk.value.setRGB(...l.disk);
    G.uStars.value = l.stars;
    G.uNight.value = l.night;
    G.uWorldTint.value.setRGB(...l.world);
    G.uFarTint.value.setRGB(...l.far);
    G.uFarHaze.value = l.farHaze;
    G.uGlint.value = l.glint;
    TOD_GRADE.uGradeMul.value.setRGB(...l.grade);
    TOD_GRADE.uSat.value = l.sat;
    this.post.bloom.strength = l.bloomS;
    this.post.bloom.radius = l.bloomR;
    this.post.bloom.threshold = l.bloomT;
  }
}
