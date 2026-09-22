// Standalone listening / measurement page for the ride audio (not part of the game build).
import { RideAudio } from "./src/audio";
import { LAYER_NAMES, SoundEngine, type LayerName, type SoundEvent } from "./src/sound/engine";

const WHEEL_C = 2 * Math.PI * 0.34;
const GEAR = 2.3;

/** Scripted 20 s ride: pull away, cruise, coast, sprint, brake, crawl, pedal again. */
export function ride(t: number) {
  const seg: [number, number, number, number][] = [
    // [until, targetSpeed, pedal, brake]
    [4, 7, 1, 0],
    [8, 7, 1, 0],
    [11, 6, 0, 0],
    [13, 10, 1, 0],
    [15, 2, 0, 1],
    [17, 1.5, 0, 0],
    [1e9, 6, 1, 0],
  ];
  const cur = seg.find((s) => t < s[0])!;
  return { target: cur[1], pedal: cur[2], brake: cur[3] };
}

class Sim {
  speed = 0;
  pedal = 1;
  step(t: number, dt: number) {
    const r = ride(t % 20);
    if (r.brake) this.speed = Math.max(r.target, this.speed - 4.2 * dt);
    else if (r.pedal) this.speed += Math.sign(r.target - this.speed) * Math.min(Math.abs(r.target - this.speed), 1.7 * dt);
    else this.speed = Math.max(0, this.speed - 0.35 * dt);
    this.pedal += (r.pedal - this.pedal) * Math.min(1, 5 * dt);
    const wheel = this.speed / WHEEL_C;
    return { speed: this.speed, crank: wheel / GEAR, wheel, pedal: this.pedal, brake: r.brake };
  }
}

interface OfflineResult {
  layer: string;
  secs: number;
  peakDb: number;
  peakT: number;
  rmsDb: number;
  maxShortRmsDb: number;
  nans: number;
  clipped: number;
  genMs: number;
  renderMs: number;
  nodes: number;
}

const db = (x: number) => (x > 0 ? Math.round(200 * Math.log10(x)) / 10 : -999);

/** Render `secs` of the soundscape offline (optionally one layer solo, optionally forcing events). */
async function offline(layer: LayerName | null, secs = 20, events: [number, SoundEvent][] = [], seed = 7, idle = false, patch = ""): Promise<OfflineResult & { timings: Record<string, number> }> {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, sr * secs, sr);
  // CPU experiments: replace expensive nodes with plain gains
  const fake = () => Object.assign(ctx.createGain(), { buffer: null, normalize: false, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
  if (patch.includes("noverb")) (ctx as any).createConvolver = fake;
  if (patch.includes("nocomp")) (ctx as any).createDynamicsCompressor = fake;
  const g0 = performance.now();
  const eng = new SoundEngine(ctx, ctx.destination, { seed });
  const genMs = performance.now() - g0;
  eng.solo(layer);
  eng.setVolume(0.8, 0, 0.01);
  const sim = new Sim();
  const dt = 1 / 30;
  const ev = [...events];
  // step the render like a real-time frame loop: suspend every dt, tick the engine, resume
  const tick = () => {
    const t = ctx.currentTime;
    const s = idle ? { speed: 0, crank: 0, wheel: 0, pedal: 0, brake: 0 } : sim.step(t, dt);
    eng.tick(t, dt, s);
    while (ev.length && ev[0][0] <= t) eng.trigger(ev.shift()![1], t + 0.02);
  };
  tick();
  for (let k = 1; k * dt < secs; k++)
    void ctx.suspend(k * dt).then(() => {
      tick();
      void ctx.resume();
    });
  const r0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - r0;
  let peak = 0, sum = 0, nans = 0, clipped = 0, maxShort = 0, peakT = 0;
  const win = Math.floor(sr * 0.4);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let ws = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nans++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) { peak = m; peakT = i / sr; }
    if (m >= 0.99) clipped++;
    const e = (a * a + b * b) / 2;
    sum += e;
    ws += e;
    if (i % win === win - 1) { maxShort = Math.max(maxShort, ws / win); ws = 0; }
  }
  const pi = Math.round(peakT * sr);
  const loc = (w: number) => {
    let s2 = 0, c = 0;
    for (let i = Math.max(0, pi - w); i < Math.min(L.length, pi + w); i++) { s2 += L[i] * L[i]; c++; }
    return db(Math.sqrt(s2 / Math.max(1, c)));
  };
  (window as any).lastPeak = { rms5ms: loc(240), rms50ms: loc(2400), samples: Array.from(L.slice(pi - 12, pi + 12)).map((x) => Math.round(x * 1000) / 1000) };
  return {
    layer: layer ?? "mix",
    secs,
    peakDb: db(peak),
    peakT: Math.round(peakT * 100) / 100,
    rmsDb: db(Math.sqrt(sum / L.length)),
    maxShortRmsDb: db(Math.sqrt(maxShort)),
    nans,
    clipped,
    genMs: Math.round(genMs),
    renderMs: Math.round(renderMs),
    nodes: eng.kit.nodes,
    timings: Object.fromEntries(Object.entries(eng.kit.timings).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  };
}

// ── real-time page ──
const audio = new RideAudio();
const sim = new Sim();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const soloSel = $<HTMLSelectElement>("solo");
for (const n of LAYER_NAMES) soloSel.add(new Option(n, n));
const engine = () => (audio as unknown as { engine: SoundEngine | null }).engine;
soloSel.onchange = () => engine()?.solo((soloSel.value || null) as LayerName | null);
$("start").onclick = () => {
  const t0 = performance.now();
  audio.start();
  (stats as Record<string, number>).startMs = Math.round((performance.now() - t0) * 10) / 10;
};
audio.bindKeys();
const EVENTS: SoundEvent[] = ["bell", "bump", "furin", "temple", "crossing", "uguisu", "kite", "crow", "frog", "higurashi", "minmin"];
for (const e of EVENTS) {
  const b = document.createElement("button");
  b.textContent = e;
  b.onclick = () => (audio.start(), audio.trigger(e));
  $("events").append(b);
}

let analyser: AnalyserNode | null = null;
const stats = { frames: 0, updMs: 0, updMax: 0, peak: 0, sumSq: 0, samples: 0, nans: 0 };
let t = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += dt;
  const s = $<HTMLInputElement>("auto").checked
    ? sim.step(t, dt)
    : (() => {
        const speed = +$<HTMLInputElement>("speed").value;
        const wheel = speed / WHEEL_C;
        return { speed, crank: wheel / GEAR, wheel, pedal: $<HTMLInputElement>("coast").checked ? 0 : 1, brake: $<HTMLInputElement>("brake").checked ? 1 : 0 };
      })();
  const u0 = performance.now();
  audio.update(dt, s.speed, s.crank, s.wheel, s.pedal, s.brake > 0);
  const u = performance.now() - u0;
  stats.frames++;
  stats.updMs += u;
  stats.updMax = Math.max(stats.updMax, u);
  const eng = engine();
  if (eng && !analyser) {
    analyser = eng.ctx.createAnalyser() as AnalyserNode;
    analyser.fftSize = 2048;
    eng.output.connect(analyser);
  }
  if (analyser) {
    const d = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(d);
    for (const x of d) {
      if (!Number.isFinite(x)) { stats.nans++; continue; }
      stats.peak = Math.max(stats.peak, Math.abs(x));
      stats.sumSq += x * x;
      stats.samples++;
    }
  }
  $("meter").textContent =
    `state ${audio.state}  t ${t.toFixed(1)}s  speed ${s.speed.toFixed(1)}  pedal ${s.pedal.toFixed(2)}  brake ${s.brake}\n` +
    `peak ${db(stats.peak)} dBFS  rms ${db(Math.sqrt(stats.sumSq / Math.max(1, stats.samples)))} dBFS  update avg ${(stats.updMs / stats.frames).toFixed(3)} ms  max ${stats.updMax.toFixed(2)} ms  nodes ${eng?.kit.nodes ?? 0}  pending ${eng?.kit.pending ?? "-"}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as Record<string, unknown>).lab = { offline, audio, stats, engine, LAYER_NAMES };
