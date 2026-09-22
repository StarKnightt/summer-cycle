import { AmbienceLayer, WindLayer } from "./air";
import { BikeLayer } from "./bike";
import { clamp, reverbIR, smoothstep, vnoise } from "./dsp";
import { Kit, type Env, type Layer, type RideState } from "./kit";
import { BirdLayer, CicadaLayer, WaterLayer } from "./nature";

export type LayerName = "bike" | "wind" | "cicadas" | "birds" | "water" | "ambience";
export const LAYER_NAMES: LayerName[] = ["bike", "wind", "cicadas", "birds", "water", "ambience"];
export type SoundEvent = "bell" | "bump" | "furin" | "temple" | "crossing" | "uguisu" | "kite" | "crow" | "frog" | "higurashi" | "minmin";

/** Raw per-frame input; anything left undefined falls back to a sensible default. */
export interface EngineInput {
  speed: number;
  crank: number;
  wheel: number;
  pedal: number;
  brake: number;
  steer?: number;
  bump?: number;
  roughness?: number;
  water?: number;
  trees?: number;
  houses?: number;
  evening?: number;
}

export interface EngineOptions {
  seed?: number;
  /** Generate voice banks a few ms per tick instead of all up front (real-time use). */
  lazy?: boolean;
}

const PARAM_RATE = 1 / 30;

export class SoundEngine {
  readonly kit: Kit;
  readonly layers: Record<LayerName, Layer>;
  /** Final node of the chain (after the safety clipper) — tap it for metering. */
  readonly output: AudioNode;
  private readonly bike: BikeLayer;
  private readonly birds: BirdLayer;
  private readonly cicadas: CicadaLayer;
  private readonly water: WaterLayer;
  private readonly amb: AmbienceLayer;
  private readonly volume: GainNode;
  private readonly mutes: Record<LayerName, [GainNode, GainNode]>;
  private readonly lazy: boolean;
  private lastParams = -1;
  private dist = 0;
  private state: RideState = {
    speed: 0,
    crank: 0,
    wheel: 0,
    pedal: 0,
    brake: 0,
    steer: 0,
    bump: 0,
    roughness: 0.25,
    water: 0.5,
    trees: 0.5,
    houses: 0.3,
    evening: 0.65,
  };

  constructor(
    readonly ctx: BaseAudioContext,
    dest: AudioNode,
    opts: EngineOptions = {},
  ) {
    this.lazy = opts.lazy ?? false;
    const kit = (this.kit = new Kit(ctx, opts.seed ?? (Math.random() * 2 ** 31) | 0));

    // ── master: mix → warm EQ → glue compressor → volume → limiter → soft clip ──
    const mix = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 180;
    low.gain.value = 1.5;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 8500;
    high.gain.value = -2;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 10;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.03;
    glue.release.value = 0.3;
    this.volume = ctx.createGain();
    this.volume.gain.value = 1;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    mix.connect(low).connect(high).connect(glue).connect(this.volume).connect(limiter).connect(clip).connect(dest);
    this.output = clip;

    // ── open-air reverb ──
    const verbIn = ctx.createBiquadFilter();
    verbIn.type = "highpass";
    verbIn.frequency.value = 220;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = kit.buffer(reverbIR(ctx.sampleRate, kit.rng), ctx.sampleRate);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.9;
    verbIn.connect(conv).connect(verbOut).connect(mix);

    this.bike = new BikeLayer(kit);
    this.cicadas = new CicadaLayer(kit);
    this.birds = new BirdLayer(kit);
    this.water = new WaterLayer(kit);
    this.amb = new AmbienceLayer(kit);
    this.layers = { bike: this.bike, wind: new WindLayer(kit), cicadas: this.cicadas, birds: this.birds, water: this.water, ambience: this.amb };
    this.mutes = {} as Record<LayerName, [GainNode, GainNode]>;
    for (const n of LAYER_NAMES) {
      const l = this.layers[n];
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      l.out.connect(dry).connect(mix);
      l.wet.connect(wet).connect(verbIn);
      this.mutes[n] = [dry, wet];
    }
    if (!this.lazy) kit.pump(Infinity);
  }

  /** Advance the soundscape. `now` is the audio-clock time events are scheduled against. */
  tick(now: number, dt: number, inp: EngineInput): void {
    if (this.lazy && this.kit.pending) this.kit.pump(4);
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const s = this.state;
    const num = (v: number | undefined, d: number, a = 0, b = 1) => (v === undefined || !Number.isFinite(v) ? d : clamp(v, a, b));
    s.speed = num(inp.speed, 0, 0, 40);
    s.crank = num(inp.crank, 0, 0, 10);
    s.wheel = num(inp.wheel, s.speed / (2 * Math.PI * 0.34), 0, 20);
    s.pedal = num(inp.pedal, 0);
    s.brake = num(inp.brake, 0);
    s.steer = num(inp.steer, 0, -1, 1);
    s.bump = num(inp.bump, 0, 0, 2);
    s.roughness = num(inp.roughness, 0.25);
    this.dist += s.speed * dt;
    // when the game doesn't say what's around, let the scenery drift as we ride
    const d = this.dist;
    s.water = num(inp.water, clamp(0.15 + 1.1 * (vnoise(d / 55, 11) - 0.3), 0, 1));
    s.trees = num(inp.trees, clamp(0.2 + 0.9 * vnoise(d / 70, 12), 0, 1));
    s.houses = num(inp.houses, clamp(-0.1 + 1.2 * vnoise(d / 90, 13), 0, 1));
    s.evening = num(inp.evening, 0.65);

    const env: Env = {
      gust: smoothstep(0.3, 0.85, 0.55 * vnoise(now / 9, 21) + 0.45 * vnoise(now / 23, 22)),
      turb: vnoise(now * 3.3, 23),
    };
    for (const n of LAYER_NAMES) this.layers[n].events(now, dt, s, env);
    if (this.lastParams < 0 || now - this.lastParams >= PARAM_RATE || now < this.lastParams) {
      this.lastParams = now;
      for (const n of LAYER_NAMES) this.layers[n].params(now, s, env);
    }
  }

  setVolume(v: number, now: number, tau = 0.08): void {
    this.volume.gain.cancelScheduledValues(now);
    this.volume.gain.setTargetAtTime(clamp(v, 0, 2), now, tau);
  }

  /** Hear only one layer (null = everything). */
  solo(name: LayerName | null): void {
    for (const n of LAYER_NAMES) {
      const on = name === null || n === name ? 1 : 0;
      this.mutes[n][0].gain.value = on;
      this.mutes[n][1].gain.value = on;
    }
  }

  ringBell(when: number): void {
    this.bike.ringBell(when);
  }

  bump(when: number, strength: number): void {
    this.bike.bump(when, strength, this.state);
  }

  trigger(ev: SoundEvent, when: number): void {
    const s = this.state;
    switch (ev) {
      case "bell":
        return this.bike.ringBell(when);
      case "bump":
        return this.bike.bump(when, 0.8, s);
      case "furin":
        return this.amb.furin(when, s);
      case "temple":
        return this.amb.temple(when);
      case "crossing":
        return this.amb.crossing(when);
      case "uguisu":
      case "kite":
      case "crow":
        return this.birds.trigger(ev);
      case "frog":
        return this.water.frog(when, s);
      case "higurashi":
        this.cicadas.call(when, 0);
        return;
      case "minmin":
        return this.cicadas.minmin(when);
    }
  }
}

/** Transparent below 0.8, then a tanh knee that never exceeds ~0.98. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
  }
  return c;
}
