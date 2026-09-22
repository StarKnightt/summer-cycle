/** Small offline DSP toolkit used to pre-render procedural buffers (noise, impulse responses, animal calls). */

export const TAU = Math.PI * 2;
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rr = (r: Rng, a: number, b: number): number => a + (b - a) * r();
export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
export const expRand = (r: Rng, mean: number): number => -Math.log(1 - r() * 0.999999) * mean;
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const smoothstep = (a: number, b: number, x: number): number => smooth((x - a) / (b - a));

// Sine lookup table (argument in cycles) — several times faster than Math.sin for bulk synthesis.
const TN = 4096;
const TAB = new Float32Array(TN + 1);
for (let i = 0; i <= TN; i++) TAB[i] = Math.sin((TAU * i) / TN);
export function sn(cycles: number): number {
  const x = (cycles - Math.floor(cycles)) * TN;
  const i = x | 0;
  return TAB[i] + (TAB[i + 1] - TAB[i]) * (x - i);
}

function hash1(i: number, seed: number): number {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** Smooth 1-D value noise in [0,1]. */
export function vnoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  return lerp(hash1(i, seed), hash1(i + 1, seed), f * f * (3 - 2 * f));
}

/** RBJ biquad for offline filtering. */
export class Biq {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  constructor(type: "lp" | "hp" | "bp", sr: number, f: number, q = 0.707) {
    const w = (TAU * Math.min(f, sr * 0.49)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    let b0: number, b1: number, b2: number;
    if (type === "lp") {
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = b0;
    } else if (type === "hp") {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = b0;
    } else {
      b0 = al;
      b1 = 0;
      b2 = -al;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Filter in place. With `loop`, the filter is primed on the tail first so a periodic signal stays seamless. */
export function filt(d: Float32Array, f: Biq, loop = false): Float32Array {
  if (loop) for (let i = Math.max(0, d.length - 6000); i < d.length; i++) f.run(d[i]);
  for (let i = 0; i < d.length; i++) d[i] = f.run(d[i]);
  return d;
}

export function white(n: number, r: Rng): Float32Array {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return d;
}

export function pink(n: number, r: Rng): Float32Array {
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return d;
}

export function brown(n: number, r: Rng): Float32Array {
  const d = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = (b + 0.02 * (r() * 2 - 1)) / 1.02;
    d[i] = b;
  }
  // remove DC drift
  const hp = new Biq("hp", 48000, 12, 0.7);
  return filt(d, hp);
}

export function rms(d: Float32Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, d.length));
}

export function scale(d: Float32Array, k: number): Float32Array {
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}

export function normRms(d: Float32Array, target: number): Float32Array {
  const v = rms(d);
  return v > 0 ? scale(d, target / v) : d;
}

/** Peak-normalise several channels together. */
export function normPeak(chs: Float32Array[], target = 0.9): Float32Array[] {
  let p = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  if (p > 0) for (const d of chs) scale(d, target / p);
  return chs;
}

/** Equal-power crossfade of the tail into the head so a noise buffer loops without a seam. */
export function makeLoop(d: Float32Array, fade: number): Float32Array {
  const n = d.length - fade;
  const out = d.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const w = (i / fade) * (Math.PI / 2);
    out[i] = d[i] * Math.sin(w) + d[n + i] * Math.cos(w);
  }
  return out;
}

/** Trim trailing silence (with a short safety tail) and zero the last samples. */
export function trim(d: Float32Array, sr: number): Float32Array {
  let e = d.length - 1;
  while (e > 0 && Math.abs(d[e]) < 1e-4) e--;
  const out = d.slice(0, Math.min(d.length, e + Math.floor(sr * 0.02)));
  const f = Math.min(64, out.length);
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= i / f;
  return out;
}

/**
 * Add one pitched note. `f(u)` and `a(u)` get normalised time u∈[0,1); harmonics above 0.45·sr are skipped.
 */
export function note(
  out: Float32Array,
  sr: number,
  t0: number,
  dur: number,
  f: (u: number) => number,
  a: (u: number) => number,
  harm: readonly number[] = [1],
): void {
  const n0 = Math.round(t0 * sr);
  const n = Math.max(1, Math.round(dur * sr));
  const lim = sr * 0.45;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const j = n0 + i;
    if (j >= out.length) break;
    const u = i / n;
    const fr = f(u);
    ph += fr / sr;
    if (ph >= 1) ph -= Math.floor(ph);
    let s = 0;
    for (let h = 0; h < harm.length; h++) {
      if (fr * (h + 1) > lim) break;
      s += harm[h] * sn(ph * (h + 1));
    }
    out[j] += a(u) * s;
  }
}

/** Attack/decay envelope over u∈[0,1]: linear rise for `att`, power-law fall to zero. */
export const envAD =
  (att: number, pow = 1.5) =>
  (u: number): number =>
    u < att ? u / att : Math.pow(Math.max(0, (1 - u) / (1 - att)), pow);

/** Attack/sustain/release envelope with smooth edges. */
export const envASR =
  (att: number, rel: number) =>
  (u: number): number =>
    u < att ? smooth(u / att) : u > 1 - rel ? smooth((1 - u) / rel) : 1;

/**
 * Add a decaying sinusoid (modal ping) starting at t0. Used for bells, chimes and clicks.
 */
export function mode(out: Float32Array, sr: number, t0: number, f: number, amp: number, tau: number, phase = 0, attack = 0.0008): void {
  if (f >= sr * 0.47) return;
  const n0 = Math.round(t0 * sr);
  const n = Math.min(out.length - n0, Math.ceil(tau * 7 * sr));
  const k = Math.exp(-1 / (tau * sr));
  const at = Math.max(1, attack * sr);
  let e = amp;
  const inc = f / sr;
  let ph = phase;
  for (let i = 0; i < n; i++) {
    out[n0 + i] += e * (i < at ? i / at : 1) * sn(ph);
    ph += inc;
    e *= k;
  }
}

/** Stereo decaying-noise impulse response for an open-air reverb (normalised to unit energy per channel). */
export function reverbIR(sr: number, r: Rng, dur = 3.2, t60 = 2.4): Float32Array[] {
  const n = Math.floor(sr * dur);
  const pre = Math.floor(0.014 * sr);
  const chs: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n);
    // sparse early reflections: ground, walls, tree lines
    for (let k = 0; k < 9; k++) {
      const t = rr(r, 0.004, 0.11);
      const i = pre + Math.floor(t * sr);
      if (i < n) d[i] += rr(r, 0.05, 0.22) * Math.exp(-t * 14) * (r() < 0.5 ? -1 : 1);
    }
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / t60) * (1 - Math.exp(-t / 0.045));
      const fc = 6500 * Math.exp(-t * 1.3) + 700;
      lp += (1 - Math.exp((-TAU * fc) / sr)) * ((r() * 2 - 1) * env - lp);
      d[i] += lp;
    }
    const fo = Math.floor(sr * 0.2);
    for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    scale(d, 1 / Math.sqrt(e));
    chs.push(d);
  }
  return chs;
}
