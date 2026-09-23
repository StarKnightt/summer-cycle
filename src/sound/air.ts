import { clamp, expRand, rr, smoothstep, vnoise } from "./dsp";
import { Gate, GEN_SR, glide, glideStep, Kit, Layer, type Env, type RideState } from "./kit";
import { crossingDing, furin, railClack, rustle, templeBell } from "./voices";

const L_WIND = 0.09;
const L_BUFFET = 0;
const L_GRASS = 0.05;
const L_RUSTLE = 0.16;

/**
 * Wind: stereo band-passed pink noise whose level and brightness follow airflow (ride speed² + gusts),
 * low buffeting at speed, grass swish and a granular leaf-rustle loop that swells with the gusts.
 */
export class WindLayer extends Layer {
  private gL: GainNode;
  private gR: GainNode;
  private bpL: BiquadFilterNode;
  private bpR: BiquadFilterNode;
  private buffet: Gate;
  private grass: GainNode;
  private rustle: Gate;
  private rustleSrc: AudioBufferSourceNode | null = null;

  constructor(kit: Kit) {
    super(kit);
    kit.loopBank("rustle", 2, GEN_SR, rustle(9));
    const src = kit.loop(kit.pinkSt);
    const split = this.ctx.createChannelSplitter(2);
    const merge = this.ctx.createChannelMerger(2);
    src.connect(this.filter("highpass", 1500, 0.7)).connect(this.filter("highpass", 1500, 0.7)).connect(split);
    this.bpL = this.filter("bandpass", 500, 0.7);
    this.bpR = this.filter("bandpass", 520, 0.7);
    this.gL = this.gain();
    this.gR = this.gain();
    split.connect(this.bpL, 0).connect(this.gL).connect(merge, 0, 0);
    split.connect(this.bpR, 1).connect(this.gR).connect(merge, 0, 1);
    merge.connect(this.out);

    this.buffet = new Gate(this.gain(), this.out);
    kit.loop(kit.brown).connect(this.filter("lowpass", 160, 0.7)).connect(this.buffet.g);

    this.grass = this.gain();
    kit.loop(kit.pinkSt, 0.93).connect(this.filter("bandpass", 2600, 0.6)).connect(this.grass).connect(this.out);

    const rustleBus = this.gain(1);
    rustleBus.connect(this.out);
    this.rustle = new Gate(this.gain(), rustleBus);
    this.wet.gain.value = 0.08;
    this.grass.connect(this.wet);
    rustleBus.connect(this.wet);
  }

  events(): void {
    if (!this.rustleSrc && this.kit.has("rustle")) {
      this.rustleSrc = this.kit.loop(this.kit.get("rustle")[0]);
      this.rustleSrc.connect(this.rustle.g);
    }
  }

  params(now: number, s: RideState, e: Env): void {
    const sp = clamp(s.speed / 10, 0, 1.4);
    const air = 0.2 + 0.8 * e.gust;
    const cruise = Math.min(sp, 0.7) / 0.7;
    const flow = 0.35 * cruise;
    const dir = clamp(s.steer * 0.35 + (vnoise(now / 13, 5) - 0.5) * 0.6, -0.6, 0.6);
    const base = L_WIND * (0.55 * air + flow);
    glide(this.gL.gain, base * (1 - dir * 0.5), now, 0.15);
    glide(this.gR.gain, base * (1 + dir * 0.5), now, 0.15);
    glideStep(this.bpL.frequency, 2400 + 600 * air + 500 * flow + 300 * (vnoise(now / 3.1, 7) - 0.5), now, 0.2);
    glideStep(this.bpR.frequency, 2500 + 600 * air + 500 * flow + 300 * (vnoise(now / 2.7, 8) - 0.5), now, 0.2);
    this.buffet.set(L_BUFFET * e.turb * smoothstep(0.25, 0.4, sp), now, 0.06);
    glide(this.grass.gain, L_GRASS * (0.25 + 0.75 * e.gust) * (1 - 0.4 * s.trees) * (0.7 + 0.3 * cruise), now, 0.3);
    this.rustle.set(L_RUSTLE * s.trees * (0.18 + 0.82 * Math.pow(e.gust, 1.3)) * (0.85 + 0.2 * cruise), now, 0.35);
    if (this.rustleSrc) glide(this.rustleSrc.playbackRate, 0.96 + 0.08 * vnoise(now / 11, 9), now, 0.5);
  }
}

const L_BED = 0.025;
const L_VALLEY = 0;
const L_FURIN = 0.12;
const L_TEMPLE = 0.1;
const L_CROSS = 0.06;
const L_TRAIN = 0.05;

/**
 * Ambience: warm low countryside air, and rare nostalgic details — a glass furin tinkling on a porch
 * when the breeze picks up, a far temple bell, and a distant level crossing with a train passing.
 */
export class AmbienceLayer extends Layer {
  private bed: GainNode;
  private valley: GainNode;
  private far: BiquadFilterNode;
  private nextFurin = 0;
  private nextTemple = 0;
  private nextCross = 0;

  constructor(kit: Kit) {
    super(kit);
    kit.bank("furin", 4, GEN_SR, furin);
    kit.bank("temple", 1, 16000, templeBell);
    kit.bank("crossA", 1, GEN_SR, crossingDing(735));
    kit.bank("crossB", 1, GEN_SR, crossingDing(702));
    kit.bank("clack", 3, GEN_SR, railClack);

    this.bed = this.gain();
    kit.loop(kit.brown).connect(this.filter("highpass", 55, 0.7)).connect(this.filter("lowpass", 260, 0.6)).connect(this.bed).connect(this.out);
    this.valley = this.gain();
    kit.loop(kit.pinkSt, 0.9).connect(this.filter("bandpass", 150, 0.8)).connect(this.valley).connect(this.out);
    this.far = this.filter("lowpass", 1800, 0.6);
    this.far.connect(this.out);
  }

  events(now: number, _dt: number, s: RideState, e: Env): void {
    const k = this.kit;
    const r = k.rng;
    if (!this.nextFurin) {
      this.nextFurin = now + rr(r, 10, 22);
      this.nextTemple = now + rr(r, 80, 140);
      this.nextCross = now + rr(r, 170, 280);
    }
    if (now >= this.nextFurin) {
      // a furin rings when the breeze moves it; in still air it waits a little
      if (e.gust < 0.2 && r() < 0.6) this.nextFurin = now + rr(r, 2, 6);
      else {
        this.furin(now + 0.02, s);
        this.nextFurin = now + Math.max(8, expRand(r, 38 / (0.35 + 1.3 * s.houses)));
      }
    }
    if (now >= this.nextTemple) {
      this.temple(now + 0.02);
      this.nextTemple = now + rr(r, 200, 420);
    }
    if (now >= this.nextCross) {
      this.crossing(now + 0.05);
      this.nextCross = now + rr(r, 280, 520);
    }
  }

  params(now: number, _s: RideState, e: Env): void {
    glide(this.bed.gain, L_BED * (0.8 + 0.2 * vnoise(now / 17, 31)), now, 0.5);
    glide(this.valley.gain, L_VALLEY * (0.4 + 0.6 * e.gust), now, 0.6);
  }

  furin(when: number, s: RideState): void {
    const k = this.kit;
    const b = k.pick("furin");
    if (!b) return;
    const d = rr(k.rng, 0.2, 0.55);
    const side = k.rng() < 0.5 ? -1 : 1;
    const pan = side * rr(k.rng, 0.3, 0.8);
    k.play(b, when, {
      gain: L_FURIN * (1 - 0.6 * d) * (0.7 + 0.3 * s.houses),
      pan,
      panTo: pan + side * clamp(s.speed / 10, 0, 1) * 0.25,
      rate: rr(k.rng, 0.97, 1.03),
      dest: this.out,
      wet: 0.25 + 0.4 * d,
      wetDest: this.wet,
    });
  }

  temple(when: number): void {
    const b = this.kit.pick("temple");
    if (b) this.kit.play(b, when, { gain: L_TEMPLE, pan: rr(this.kit.rng, -0.6, 0.6), dest: this.far, wet: 0.8, wetDest: this.wet });
  }

  crossing(when: number): void {
    const k = this.kit;
    const a = k.pick("crossA");
    const b = k.pick("crossB");
    if (!a || !b) return;
    const pan = rr(k.rng, -0.7, 0.7);
    const n = Math.floor(rr(k.rng, 18, 26));
    for (let i = 0; i < n; i++) {
      const env = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 0.7);
      k.play(i % 2 ? b : a, when + i * 0.52, { gain: L_CROSS * env, pan, dest: this.far, wet: 0.5, wetDest: this.wet });
    }
    // the train passes while the bell rings: rumble swell + rail-joint "ta-tan"s
    const t0 = when + n * 0.52 * 0.3;
    const dur = rr(k.rng, 7, 10);
    const ctx = this.ctx;
    const src = k.loop(k.brown);
    const lp = this.filter("lowpass", 380, 0.7);
    const g = this.gain();
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(clamp(pan - 0.3, -1, 1), t0);
    p.pan.linearRampToValueAtTime(clamp(pan + 0.3, -1, 1), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(L_TRAIN, t0 + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(lp).connect(g).connect(p).connect(this.far);
    src.stop(t0 + dur + 0.1);
    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      g.disconnect();
      p.disconnect();
    };
    const gap = rr(k.rng, 0.75, 0.95);
    for (let t = t0 + 0.5; t < t0 + dur - 0.5; t += gap) {
      const env = Math.sin((Math.PI * (t - t0)) / dur);
      for (const off of [0, 0.13]) {
        const c = k.pick("clack");
        if (c) k.play(c, t + off, { gain: L_TRAIN * 0.8 * env, pan: clamp(pan + (0.6 * (t - t0)) / dur - 0.3, -1, 1), dest: this.far, wet: 0.4, wetDest: this.wet });
      }
    }
  }
}
