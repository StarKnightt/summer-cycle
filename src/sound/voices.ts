/**
 * Procedural "recordings": each generator renders one variation of a sound into Float32Array channels.
 * They run once (lazily, a few per frame) and the results are played back as AudioBuffers.
 */
import {
  Biq,
  envAD,
  envASR,
  expRand,
  filt,
  lerp,
  mode,
  normPeak,
  note,
  rr,
  sn,
  smooth,
  TAU,
  trim,
  white,
  type Rng,
} from "./dsp";

type Gen = (r: Rng, sr: number) => Float32Array[];
const mono = (d: Float32Array, sr: number): Float32Array[] => normPeak([trim(d, sr)]);

// ───────────────────────────── bicycle ─────────────────────────────

/** Freewheel pawl click: tiny, bright, metallic. */
export const freewheelClick: Gen = (r, sr) => {
  const d = new Float32Array(Math.floor(sr * 0.012));
  const a = rr(r, 0.55, 1);
  mode(d, sr, 0, rr(r, 2900, 3500), a, rr(r, 0.0007, 0.0012), r());
  mode(d, sr, 0, rr(r, 5000, 6100), a * 0.7, rr(r, 0.0005, 0.0009), r());
  mode(d, sr, 0, rr(r, 7600, 8800), a * 0.35, 0.0004, r());
  for (let i = 0; i < sr * 0.0004; i++) d[i] += (r() * 2 - 1) * a * 0.3 * (1 - i / (sr * 0.0004));
  return [d];
};

/** Chain link / sprocket tick while pedalling — softer and rounder. */
export const chainTick = (accent: boolean): Gen => (r, sr) => {
  const d = new Float32Array(Math.floor(sr * 0.03));
  const a = accent ? rr(r, 0.85, 1) : rr(r, 0.35, 0.6);
  mode(d, sr, 0, rr(r, 1150, 1550), a * 0.6, rr(r, 0.002, 0.0035), r(), 0.0015);
  mode(d, sr, 0, rr(r, 2500, 3200), a * 0.45, rr(r, 0.0015, 0.0025), r(), 0.0012);
  mode(d, sr, 0, rr(r, 4100, 5000), a * 0.2, 0.0012, r(), 0.001);
  mode(d, sr, 0, rr(r, 150, 210), a * (accent ? 0.55 : 0.25), 0.009, 0, 0.002);
  return [d];
};

/** Wire basket + mudguard rattle over a bump. */
export const rattle: Gen = (r, sr) => {
  const d = new Float32Array(Math.floor(sr * 0.35));
  // tyre thump with a little pitch drop
  note(d, sr, 0, 0.09, (u) => lerp(115, 55, u), envAD(0.05, 2.5), [1, 0.2]);
  const n = 4 + Math.floor(r() * 7);
  for (let k = 0; k < n; k++) {
    const t = Math.min(0.22, 0.004 + expRand(r, 0.035));
    const f = rr(r, 1700, 4200);
    const a = rr(r, 0.08, 0.35);
    mode(d, sr, t, f, a, rr(r, 0.002, 0.007), r());
    mode(d, sr, t, f * rr(r, 1.4, 2.3), a * 0.5, 0.002, r());
  }
  return mono(d, sr);
};

const BELL_PARTIALS: [number, number, number][] = [
  [1, 1, 0.55],
  [1.0048, 0.75, 0.6],
  [2.09, 0.33, 0.28],
  [2.104, 0.22, 0.25],
  [3.15, 0.12, 0.14],
  [4.47, 0.06, 0.08],
];

/** Mamachari thumb bell: "chirin-chirin" = two quick double strikes. */
export const bikeBell = (single: boolean): Gen => (r, sr) => {
  const f = rr(r, 1580, 1720);
  const strikes: [number, number][] = single ? [[0.002, 0.5]] : [[0.002, 0.65], [0.047, 1], [0.3, 0.6], [0.346, 0.9]];
  const d = new Float32Array(Math.floor(sr * (strikes[strikes.length - 1][0] + 1.8)));
  for (const [t, a] of strikes) {
    for (const [ratio, amp, tau] of BELL_PARTIALS) mode(d, sr, t, f * ratio, a * amp, tau, r(), 0.0006);
    const n = Math.floor(sr * 0.0015);
    const i0 = Math.floor(t * sr);
    for (let i = 0; i < n; i++) d[i0 + i] += (r() * 2 - 1) * 0.2 * a * (1 - i / n);
  }
  filt(d, new Biq("lp", sr, 7500, 0.6));
  return mono(d, sr);
};

// ───────────────────────────── birds ─────────────────────────────

/** Sparrow-like "chip chip" series. */
export const birdChirps: Gen = (r, sr) => {
  const d = new Float32Array(sr * 2);
  const n = 2 + Math.floor(r() * 5);
  const base = rr(r, 3000, 5200);
  const kind = Math.floor(r() * 3);
  let t = 0.01;
  for (let k = 0; k < n; k++) {
    const dur = rr(r, 0.035, 0.075);
    const fa = base * rr(r, 0.94, 1.06);
    const f =
      kind === 0 ? (u: number) => fa * lerp(1.25, 0.8, u) : kind === 1 ? (u: number) => fa * lerp(0.85, 1.3, u) : (u: number) => fa * (1 + 0.3 * Math.sin(Math.PI * u));
    const amp = rr(r, 0.6, 1);
    const e = envAD(0.18, 1.8);
    note(d, sr, t, dur, f, (u) => e(u) * amp, [1, 0.1, 0.03]);
    t += dur + rr(r, 0.04, 0.13);
  }
  return mono(d, sr);
};

/** Fast trill of repeated notes, gliding in pitch. */
export const birdTrill: Gen = (r, sr) => {
  const d = new Float32Array(sr * 2);
  const n = 8 + Math.floor(r() * 15);
  const rate = rr(r, 12, 22);
  const base = rr(r, 3400, 6000);
  const glide = rr(r, 0.75, 1.25);
  const sweep = rr(r, -0.25, 0.3);
  const e = envAD(0.2, 1.3);
  let t = 0.01;
  for (let k = 0; k < n; k++) {
    const u = k / Math.max(1, n - 1);
    const f = base * lerp(1, glide, u);
    const amp = 0.45 + 0.55 * Math.sin(Math.PI * (0.1 + 0.8 * u));
    note(d, sr, t, 0.62 / rate, (v) => f * (1 + sweep * (v - 0.5)), (v) => e(v) * amp, [1, 0.08]);
    t += 1 / rate;
  }
  return mono(d, sr);
};

/** Mejiro / swallow style twittering warble — a continuous melodic chatter. */
export const birdWarble: Gen = (r, sr) => {
  const d = new Float32Array(sr * 3);
  const total = rr(r, 1.1, 2.3);
  let f = rr(r, 3000, 5000);
  let t = 0.01;
  while (t < total) {
    const dur = rr(r, 0.045, 0.13);
    const f0 = f;
    const f1 = Math.min(6800, Math.max(2400, f * rr(r, 0.78, 1.28)));
    const vib = rr(r, 18, 40);
    const vd = rr(r, 0.02, 0.07);
    const amp = rr(r, 0.45, 1) * (t / total < 0.1 ? 0.6 : 1);
    const e = envASR(0.15, 0.25);
    note(d, sr, t, dur, (u) => lerp(f0, f1, u) * (1 + vd * sn(vib * u * dur)), (u) => e(u) * amp, [1, 0.08]);
    f = f1;
    t += dur + (r() < 0.3 ? rr(r, 0.02, 0.08) : rr(r, 0.004, 0.015));
  }
  return mono(d, sr);
};

/** Two/three-note whistle ("pii-yo", bulbul-ish), meant to be heard at a distance. */
export const birdWhistle: Gen = (r, sr) => {
  const d = new Float32Array(sr * 2);
  const fA = rr(r, 2700, 3300);
  let t = 0.01;
  const d1 = rr(r, 0.25, 0.38);
  note(d, sr, t, d1, (u) => fA * (1 + 0.09 * smooth(u)), envASR(0.12, 0.2), [1, 0.06]);
  t += d1 + rr(r, 0.03, 0.07);
  const d2 = rr(r, 0.2, 0.3);
  note(d, sr, t, d2, (u) => fA * lerp(1.05, 0.72, Math.pow(u, 0.7)), envASR(0.08, 0.35), [1, 0.06]);
  if (r() < 0.4) {
    t += d2 + rr(r, 0.12, 0.2);
    note(d, sr, t, d1 * 0.8, (u) => fA * (1 + 0.07 * smooth(u)), (u) => envASR(0.12, 0.25)(u) * 0.7, [1, 0.06]);
  }
  return mono(d, sr);
};

/** Uguisu (Japanese bush warbler): "Hoooo — ho-ke-kyo". */
export const uguisu: Gen = (r, sr) => {
  const d = new Float32Array(sr * 3);
  const f = rr(r, 980, 1150);
  const dh = rr(r, 0.95, 1.25);
  note(
    d,
    sr,
    0.02,
    dh,
    (u) => f * (1 + 0.06 * u + 0.004 * sn(4.5 * u * dh)),
    (u) => (u < 0.85 ? 0.35 + 0.65 * smooth(u / 0.85) : smooth((1 - u) / 0.15)) * smooth(u / 0.03),
    [1, 0.12, 0.04],
  );
  let t = 0.02 + dh + rr(r, 0.18, 0.28);
  note(d, sr, t, 0.11, (u) => f * 1.75 * (1 + 0.08 * u), envASR(0.2, 0.3), [1, 0.1]);
  t += 0.135;
  note(d, sr, t, 0.065, (u) => f * 2.7 * (1 + 0.05 * u), envAD(0.2, 1.2), [1, 0.1]);
  t += 0.095;
  note(d, sr, t, 0.36, (u) => f * lerp(2.55, 1.6, 1 - Math.pow(1 - u, 2.2)), envAD(0.06, 1.1), [1, 0.15, 0.05]);
  return mono(d, sr);
};

/** Tonbi (black kite) circling high above: "piiii — hyorororo". */
export const kite: Gen = (r, sr) => {
  const d = new Float32Array(Math.floor(sr * 3.5));
  const f = rr(r, 2900, 3300);
  const d1 = rr(r, 0.7, 0.95);
  note(d, sr, 0.02, d1, (u) => f * (0.93 + 0.1 * smooth(u * 4) - 0.04 * u), envASR(0.12, 0.08), [1, 0.07]);
  let t = 0.02 + d1 + 0.015;
  note(d, sr, t, 0.2, (u) => f * lerp(0.99, 0.78, u), envASR(0.05, 0.2), [1, 0.06]);
  t += 0.23;
  const d3 = rr(r, 1.1, 1.5);
  const rate = rr(r, 7.5, 9.5);
  const e = envASR(0.05, 0.4);
  note(
    d,
    sr,
    t,
    d3,
    (u) => f * lerp(0.86, 0.66, u) * (1 + 0.11 * sn(rate * u * d3)),
    (u) => (0.55 + 0.45 * sn(rate * u * d3)) * e(u) * (1 - 0.5 * u),
    [1, 0.06],
  );
  return mono(d, sr);
};

/** Distant crow: "kaa kaa". Harmonic-rich source through two formants plus a little rasp. */
export const crow: Gen = (r, sr) => {
  const d = new Float32Array(sr * 3);
  const n = 2 + Math.floor(r() * 3);
  const f0 = rr(r, 460, 600);
  const harm: number[] = [];
  for (let h = 1; h <= 14; h++) harm.push(1 / Math.pow(h, 0.7));
  let t = 0.02;
  for (let k = 0; k < n; k++) {
    const dur = rr(r, 0.26, 0.4);
    const e = envASR(0.1, 0.35);
    note(d, sr, t, dur, (u) => f0 * (0.88 + 0.22 * Math.sin(Math.PI * Math.min(1, u * 1.4))), e, harm);
    const i0 = Math.round(t * sr);
    const nn = Math.round(dur * sr);
    for (let i = 0; i < nn; i++) d[i0 + i] += (r() * 2 - 1) * 0.35 * e(i / nn);
    t += dur + rr(r, 0.22, 0.4);
  }
  const a = filt(d.slice(), new Biq("bp", sr, 1250, 2.5));
  const b = filt(d.slice(), new Biq("bp", sr, 2300, 3));
  for (let i = 0; i < d.length; i++) d[i] = a[i] + 0.6 * b[i] + 0.12 * d[i];
  return mono(d, sr);
};

// ───────────────────────────── insects & frogs ─────────────────────────────

/** Higurashi (evening cicada): a falling, slowing "kana-kana-kana" phrase. */
export const higurashi: Gen = (r, sr) => {
  const D = rr(r, 4.5, 7.5);
  const n = Math.floor(D * sr);
  const d = new Float32Array(n);
  const r0 = rr(r, 6.5, 8.5);
  const r1 = r0 * rr(r, 0.55, 0.7);
  const fS = rr(r, 4300, 4900);
  const fE = fS * rr(r, 0.88, 0.95);
  const tym = rr(r, 330, 440);
  let sp = 0;
  let ph = 0;
  let tp = 0;
  let rate = r0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = t / D;
    if ((i & 63) === 0) rate = lerp(r0, r1, Math.pow(x, 0.8));
    sp += rate / sr;
    const k = Math.floor(sp);
    const w = sp - k;
    const q = Math.max(0, 1 - (w - 0.08) / 0.75);
    const e = w < 0.08 ? w / 0.08 : q * Math.sqrt(q);
    const f = lerp(fS, fE, x) * (1 + 0.045 * sn(w * 0.5)) * (k & 1 ? 0.962 : 1);
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    tp += tym / sr;
    const m = 0.6 + 0.4 * sn(tp);
    const A = smooth(t / 0.35) * lerp(1, 0.28, x) * smooth((D - t) / 0.35);
    d[i] = A * e * m * (sn(ph) + 0.28 * sn(2 * ph) + 0.08 * sn(3 * ph));
  }
  return mono(d, sr);
};

/** Minmin-zemi: "miiin — min min min … miii". */
export const minmin: Gen = (r, sr) => {
  const intro = 0.9;
  const units = 10 + Math.floor(r() * 9);
  const ur = rr(r, 2.6, 3.4);
  const outro = 1.2;
  const D = intro + units / ur + outro;
  const n = Math.floor(D * sr);
  const d = new Float32Array(n);
  const fc = rr(r, 3200, 3700);
  const tym = rr(r, 200, 260);
  let ph = 0;
  let tp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f: number;
    let a: number;
    if (t < intro) {
      f = fc * lerp(0.88, 1.02, t / intro);
      a = smooth(t / intro);
    } else if (t < intro + units / ur) {
      const w = ((t - intro) * ur) % 1;
      a = w < 0.55 ? 0.35 + 0.65 * smooth(w / 0.55) : 0.35 + 0.65 * Math.pow(Math.max(0, 1 - (w - 0.55) / 0.35), 1.5);
      f = fc * (0.9 + 0.14 * Math.min(1, w / 0.55));
    } else {
      const x = (t - intro - units / ur) / outro;
      f = fc * lerp(1.02, 0.85, x);
      a = Math.pow(1 - x, 1.6);
    }
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    tp += tym / sr;
    d[i] = a * (0.55 + 0.45 * sn(tp)) * (sn(ph) + 0.3 * sn(2 * ph) + 0.1 * sn(3 * ph));
  }
  return mono(d, sr);
};

/**
 * Seamlessly looping distant cicada chorus (one channel). Every frequency is quantised to whole cycles
 * over the loop length so the buffer is exactly periodic.
 */
export const cicadaChorus =
  (L: number): Gen =>
  (r, sr) => {
    const n = Math.round(L * sr);
    const noise = white(n, r);
    const d = new Float32Array(n);
    const q = (f: number) => Math.round(f * L) / L;
    for (let k = 0; k < 6; k++) {
      const fc = q(rr(r, 3800, 6200));
      const pr = q(rr(r, 90, 170));
      const jr = q(rr(r, 0.3, 1.2));
      const jp = r();
      const fmA = 0.01;
      const m = 1 + Math.floor(r() * 3);
      const sp = r();
      const amp = rr(r, 0.4, 1);
      const sharp = r() < 0.5;
      const fmK = (fc * fmA) / (TAU * jr);
      const B = 64;
      for (let i0 = 0; i0 < n; i0 += B) {
        const tb = i0 / sr;
        const s = 0.3 + 0.7 * (0.5 - 0.5 * sn((m * tb) / L + sp + 0.25));
        const env = amp * s * Math.sqrt(s);
        const e = Math.min(n, i0 + B);
        for (let i = i0; i < e; i++) {
          const t = i / sr;
          const p = 0.5 + 0.5 * sn(pr * t);
          const p2 = p * p;
          const pulse = sharp ? p2 * p2 : p2 * p;
          const ph = fc * t - fmK * sn(jr * t + jp + 0.25);
          d[i] += env * pulse * (sn(ph) + 0.35 * noise[i]);
        }
      }
    }
    filt(d, new Biq("bp", sr, 4800, 0.8), true);
    filt(d, new Biq("lp", sr, 7500, 0.7), true);
    return [d];
  };

/** Japanese tree frog (amagaeru): pulsed "kwa-kwa-kwa". */
export const frog: Gen = (r, sr) => {
  const d = new Float32Array(Math.floor(sr * 2.2));
  const n = 4 + Math.floor(r() * 6);
  const rate = rr(r, 5, 7);
  const pr = rr(r, 150, 230);
  const f1 = rr(r, 1300, 1800);
  let t = 0.02;
  for (let k = 0; k < n; k++) {
    const nd = 0.55 / rate;
    const amp = 0.5 + 0.5 * Math.sin((Math.PI * (k + 0.5)) / n);
    const np = Math.floor(nd * pr);
    for (let p = 0; p < np; p++) {
      const u = p / np;
      const i = Math.round((t + p / pr) * sr);
      d[i] += amp * Math.sin(Math.PI * u) * (1 + 0.2 * (r() - 0.5));
    }
    t += 1 / rate;
  }
  const a = filt(d.slice(), new Biq("bp", sr, f1, 6));
  const b = filt(d.slice(), new Biq("bp", sr, f1 * rr(r, 1.7, 1.9), 6));
  const c = filt(d.slice(), new Biq("bp", sr, 420, 2));
  for (let i = 0; i < d.length; i++) d[i] = a[i] + 0.6 * b[i] + 0.3 * c[i];
  return mono(d, sr);
};

// ───────────────────────────── air & water loops ─────────────────────────────

/** Periodic cluster density in [0,1] built from whole-cycle cosines (tabulated at 200 Hz). */
function cluster(r: Rng, L: number): (t: number) => number {
  const parts = Array.from({ length: 4 }, () => ({ m: 2 + Math.floor(r() * 8), p: r(), a: rr(r, 0.5, 1) }));
  const sum = parts.reduce((s, p) => s + p.a, 0);
  const N = Math.round(L * 200);
  const tab = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    let v = 0;
    for (const p of parts) v += p.a * (0.5 + 0.5 * sn((p.m * i) / N + p.p));
    tab[i] = Math.pow(v / sum, 2.2);
  }
  return (t) => {
    const x = ((((t / L) % 1) + 1) % 1) * N;
    const i = x | 0;
    return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
  };
}

/** Leaves rustling: dense crackly noise grains that come in swishes (one channel, loops seamlessly). */
export const rustle =
  (L: number): Gen =>
  (r, sr) => {
    const n = Math.round(L * sr);
    const d = new Float32Array(n);
    const c = cluster(r, L);
    const grains = Math.floor(70 * L);
    for (let g = 0; g < grains; g++) {
      const pos = r() * L;
      if (r() > c(pos) * 1.6) continue;
      const len = Math.floor(rr(r, 0.004, 0.03) * sr);
      const tau = len / 3;
      const a = Math.pow(r(), 2);
      const i0 = Math.floor(pos * sr);
      const k = Math.exp(-1 / tau);
      let e = a;
      for (let i = 0; i < len; i++) {
        d[(i0 + i) % n] += e * (r() * 2 - 1) * (i < 20 ? i / 20 : 1);
        e *= k;
      }
    }
    for (let i = 0; i < n; i++) d[i] += 0.1 * (r() * 2 - 1) * c(i / sr);
    filt(d, new Biq("hp", sr, 1500, 0.7), true);
    filt(d, new Biq("lp", sr, 9000, 0.7), true);
    return [d];
  };

/** Irrigation channel trickle: gurgle + Minnaert bubbles + a few droplets (one channel, loops seamlessly). */
export const waterBabble =
  (L: number): Gen =>
  (r, sr) => {
    const n = Math.round(L * sr);
    const g = white(n, r);
    filt(g, new Biq("lp", sr, 550, 0.9), true);
    filt(g, new Biq("lp", sr, 900, 0.7), true);
    const c = cluster(r, L);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = g[i] * 2.2 * (0.35 + 0.65 * c(i / sr));
    const bubble = (f0: number, a: number, xi: number, pos: number) => {
      const dec = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5);
      const len = Math.floor(Math.min(0.15, 5 / dec) * sr);
      const i0 = Math.floor(pos * sr);
      let ph = r();
      let e = a;
      const k = Math.exp(-dec / sr);
      const at = 0.0005 * sr;
      for (let i = 0; i < len; i++) {
        ph += (f0 * (1 + (xi * dec * i) / sr)) / sr;
        d[(i0 + i) % n] += e * (i < at ? i / at : 1) * sn(ph);
        e *= k;
      }
    };
    const nb = Math.floor(24 * L);
    for (let k = 0; k < nb; k++) {
      const pos = r() * L;
      const f0 = Math.exp(rr(r, Math.log(350), Math.log(2200)));
      const a = Math.pow(rr(r, 0.1, 1), 2) * Math.sqrt(700 / f0) * (0.4 + 0.8 * c(pos));
      bubble(f0, a * 0.5, rr(r, 0.05, 0.25), pos);
    }
    for (let k = 0; k < 3 * L; k++) bubble(rr(r, 2000, 3800), rr(r, 0.05, 0.18), rr(r, 0.1, 0.3), r() * L);
    filt(d, new Biq("hp", sr, 120, 0.7), true);
    filt(d, new Biq("lp", sr, 6000, 0.7), true);
    return [d];
  };

// ───────────────────────────── chimes & bells ─────────────────────────────

/** Edo glass furin: glassy inharmonic partials with slow beating, 1–4 clapper strikes. */
export const furin: Gen = (r, sr) => {
  const f = rr(r, 2300, 3000);
  const P: [number, number, number][] = [
    [1, 1, 1.4],
    [1.0027 * rr(r, 0.9995, 1.0005), 0.6, 1.5],
    [2.41 * rr(r, 0.995, 1.005), 0.32, 0.8],
    [2.425 * rr(r, 0.995, 1.005), 0.2, 0.75],
    [4.08 * rr(r, 0.99, 1.01), 0.16, 0.4],
    [5.95 * rr(r, 0.99, 1.01), 0.08, 0.22],
    [8.1 * rr(r, 0.99, 1.01), 0.04, 0.12],
  ];
  const ns = 1 + Math.floor(r() * 3.2);
  const strikes: [number, number][] = [];
  let t = 0.01;
  for (let k = 0; k < ns; k++) {
    strikes.push([t, k === 0 ? rr(r, 0.7, 1) : rr(r, 0.3, 0.9)]);
    t += rr(r, 0.25, 0.8);
  }
  const len = strikes[strikes.length - 1][0] + 3.2;
  const d = new Float32Array(Math.floor(len * sr));
  for (const [ts, a] of strikes) {
    for (const [ratio, amp, tau] of P) mode(d, sr, ts, f * ratio, a * amp, tau, r(), 0.0004);
    const i0 = Math.floor(ts * sr);
    const nk = Math.floor(0.002 * sr);
    for (let i = 0; i < nk; i++) d[i0 + i] += (r() * 2 - 1) * 0.12 * a * Math.exp(-i / (0.0004 * sr));
  }
  const fo = Math.floor(0.6 * sr);
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return normPeak([d]);
};

/** Distant temple bell (bonshō): deep "gooon" with slow beating (unari). Rendered at a low sample rate. */
export const templeBell: Gen = (r, sr) => {
  const f = rr(r, 118, 136);
  const P: [number, number, number][] = [
    [0.5, 0.55, 7.5],
    [0.503, 0.35, 7],
    [1, 0.8, 5],
    [1.012, 0.5, 5],
    [1.63, 0.4, 3.2],
    [2.34, 0.3, 2.2],
    [2.97, 0.22, 1.5],
    [3.9, 0.15, 0.9],
    [5.1, 0.1, 0.5],
    [6.4, 0.06, 0.3],
  ];
  const d = new Float32Array(Math.floor(12 * sr));
  for (const [ratio, amp, tau] of P) mode(d, sr, 0.02, f * ratio, amp, tau, r(), 0.006);
  const lp = new Biq("lp", sr, 300, 0.7);
  const nk = Math.floor(0.12 * sr);
  const i0 = Math.floor(0.02 * sr);
  for (let i = 0; i < nk; i++) d[i0 + i] += lp.run((r() * 2 - 1) * 0.6 * Math.exp(-i / (0.03 * sr)));
  const fo = Math.floor(1.5 * sr);
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return normPeak([d]);
};

/** One strike of a railway crossing bell ("kan"). */
export const crossingDing =
  (f: number): Gen =>
  (r, sr) => {
    const d = new Float32Array(Math.floor(0.7 * sr));
    const P: [number, number, number][] = [
      [1, 1, 0.25],
      [2.0, 0.5, 0.18],
      [2.76, 0.45, 0.14],
      [4.1, 0.2, 0.08],
      [5.4, 0.12, 0.05],
    ];
    for (const [ratio, amp, tau] of P) mode(d, sr, 0.002, f * ratio, amp, tau, r(), 0.001);
    return mono(d, sr);
  };

/** Wheel over a rail joint, heard from far away. */
export const railClack: Gen = (r, sr) => {
  const d = new Float32Array(Math.floor(0.3 * sr));
  note(d, sr, 0, 0.12, (u) => lerp(75, 45, u), envAD(0.04, 2), [1, 0.3]);
  mode(d, sr, 0.002, rr(r, 900, 1300), 0.25, 0.02, r());
  return mono(d, sr);
};
