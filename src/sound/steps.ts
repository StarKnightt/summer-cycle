import { Biq, normPeak, rr, type Rng } from "./dsp";
import { GEN_SR, type Kit } from "./kit";

export type StepSurface = "asphalt" | "grass" | "dirt";

const L_STEP = 0.32;

/** Soft school-shoe heel strike + toe scuff on asphalt. */
function asphalt(r: Rng, sr: number): Float32Array[] {
  const n = Math.floor(sr * 0.16);
  const d = new Float32Array(n);
  const bp = new Biq("bp", sr, rr(r, 1500, 2100), 1.1);
  const lp = new Biq("lp", sr, 2600, 0.7);
  const f0 = rr(r, 80, 105);
  const toe = rr(r, 0.022, 0.034);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const heel = Math.exp(-t / 0.009);
    const scuff = t > toe ? Math.exp(-(t - toe) / 0.03) * 0.35 : 0;
    const w = r() * 2 - 1;
    d[i] = bp.run(w) * heel * 0.9 + lp.run(w) * scuff * 0.5 + Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t / 0.025) * 0.5;
  }
  return normPeak([d], 0.8);
}

/** Swish of blades brushing the shin plus a muffled thud and a few crackles. */
function grass(r: Rng, sr: number): Float32Array[] {
  const n = Math.floor(sr * 0.32);
  const d = new Float32Array(n);
  const hp = new Biq("hp", sr, 1400, 0.7);
  const bp = new Biq("bp", sr, rr(r, 3000, 4200), 0.8);
  const f0 = rr(r, 60, 80);
  const len = rr(r, 0.1, 0.16);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.015) * Math.exp(-t / len);
    const w = r() * 2 - 1;
    const crackle = r() < 0.004 * env ? (r() * 2 - 1) * 2.2 : 0;
    d[i] = bp.run(hp.run(w)) * env * 0.9 + crackle * env + Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t / 0.03) * 0.35;
  }
  return normPeak([d], 0.7);
}

/** Gritty crunch on the packed-earth paths and paddy banks. */
function dirt(r: Rng, sr: number): Float32Array[] {
  const n = Math.floor(sr * 0.22);
  const d = new Float32Array(n);
  const bp = new Biq("bp", sr, rr(r, 1100, 1600), 0.9);
  const f0 = rr(r, 70, 90);
  let grain = 0;
  let g = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.055);
    if (grain-- <= 0) {
      grain = Math.floor(sr * rr(r, 0.0008, 0.004));
      g = r() < 0.6 ? rr(r, 0.3, 1) : 0.1;
    }
    const w = (r() * 2 - 1) * g;
    d[i] = bp.run(w) * env + Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t / 0.028) * 0.45;
  }
  return normPeak([d], 0.8);
}

/** Footstep one-shots, generated lazily into the kit (a handful of variations per surface). */
export class Steps {
  private lastPan = 0.06;
  constructor(
    private readonly kit: Kit,
    private readonly dest: AudioNode,
    private readonly wet: AudioNode,
  ) {
    kit.bank("step-asphalt", 6, GEN_SR, asphalt);
    kit.bank("step-grass", 6, GEN_SR, grass);
    kit.bank("step-dirt", 6, GEN_SR, dirt);
  }

  play(when: number, surface: StepSurface, strength: number): void {
    const b = this.kit.pick(`step-${surface}`);
    if (!b) return;
    // Alternate feet a touch left / right of centre.
    this.lastPan = -this.lastPan;
    const k = Math.max(0, Math.min(1.5, strength));
    this.kit.play(b, when, { gain: L_STEP * k, pan: this.lastPan, rate: rr(this.kit.rng, 0.93, 1.07), dest: this.dest, wet: 0.35, wetDest: this.wet });
  }
}
