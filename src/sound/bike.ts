import { clamp, expRand, rr, smoothstep, vnoise } from "./dsp";
import { Gate, GEN_SR, glide, glideStep, Kit, Layer, type RideState } from "./kit";
import { bikeBell, chainTick, freewheelClick, rattle } from "./voices";

const L_TYRE = 0.34;
const L_HISS = 0.07;
const L_WHIRR = 0.05;
const L_CHAIN = 0.13;
const L_FREE = 0.1;
const L_RUB = 0.14;
const L_SQUEAL = 0.012;
const L_RATTLE = 0.24;
const L_BELL = 0.2;

const TEETH = 33; // chainring teeth → chain mesh rate
const PAWL_CLICKS = 16; // freewheel clicks per wheel revolution
const CHAIN_TICKS = 6; // soft ticks per crank revolution (every 3rd accented = each pedal stroke)
const LOOKAHEAD = 0.1;

interface Clicker {
  phase: number;
  t: number;
}

/**
 * The bicycle: tyre roll + asphalt hiss, chain whirr and ticks locked to cadence, freewheel buzz when
 * coasting, rim-brake rub with an occasional soft squeal, basket rattle on bumps, and the thumb bell.
 */
export class BikeLayer extends Layer {
  private tyre: Gate;
  private tyreLP: BiquadFilterNode;
  private hiss: Gate;
  private hissBP: BiquadFilterNode;
  private tread: OscillatorNode;
  private whirr: Gate;
  private mesh: OscillatorNode;
  private rub: Gate;
  private rubBP: BiquadFilterNode;
  private squeal: Gate;
  private sq: OscillatorNode;
  private freeBus: GainNode;
  private chainBus: GainNode;
  private fw: Clicker = { phase: 0, t: 0 };
  private ch: Clicker = { phase: 0.5, t: 0 };
  private chainN = 0;
  private brakeWas = 0;
  private squealAmt = 0;
  private squealF = 2000;
  private nextBump = -1;
  private lastBump = -1;
  private lastBell = -1;
  private dist = 0;

  constructor(kit: Kit) {
    super(kit);
    const sr = kit.ctx.sampleRate;
    kit.bank("fw", 8, sr, freewheelClick, true);
    kit.bank("chain", 6, sr, chainTick(false), true);
    kit.bank("chainAcc", 3, sr, chainTick(true), true);
    kit.bank("rattle", 5, GEN_SR, rattle);
    kit.bank("bell", 2, GEN_SR, bikeBell(false));
    kit.bank("tink", 2, GEN_SR, bikeBell(true));

    // Tyre: pink noise, amplitude-modulated once per wheel revolution (tread/valve), low-passed with speed.
    this.tread = this.osc(1);
    const treadDepth = this.gain(0.16);
    this.tread.connect(treadDepth);
    const treadAM = this.gain(1);
    treadDepth.connect(treadAM.gain);
    this.tyreLP = this.filter("lowpass", 300, 0.6);
    const pinkSrc = kit.loop(kit.pink);
    const whiteSrc = kit.loop(kit.white);
    this.tyre = new Gate(this.gain(), this.out);
    pinkSrc.connect(treadAM).connect(this.filter("highpass", 90, 0.7)).connect(this.tyreLP).connect(this.tyre.g);

    // Fine asphalt hiss.
    this.hissBP = this.filter("bandpass", 3000, 0.7);
    this.hiss = new Gate(this.gain(), this.out);
    whiteSrc.connect(this.hissBP).connect(this.hiss.g);

    // Chain whirr: noise gated at the tooth-mesh rate.
    this.mesh = this.osc(30);
    const meshDepth = this.gain(0.6);
    this.mesh.connect(meshDepth);
    const meshAM = this.gain(0.6);
    meshDepth.connect(meshAM.gain);
    this.whirr = new Gate(this.gain(), this.out);
    whiteSrc.connect(this.filter("bandpass", 1900, 1.4)).connect(meshAM).connect(this.whirr.g);

    // Rim-brake rub, textured by the same wheel-rate modulation.
    this.rubBP = this.filter("bandpass", 2000, 1.1);
    const rubAM = this.gain(1);
    treadDepth.connect(rubAM.gain);
    this.rub = new Gate(this.gain(), this.out);
    pinkSrc.connect(this.rubBP).connect(rubAM).connect(this.rub.g);

    // Soft squeal: sine + slow vibrato, rounded by a lowpass.
    this.sq = this.osc(2000);
    const vib = this.osc(5.3);
    const vibD = this.gain(9);
    vib.connect(vibD).connect(this.sq.frequency);
    this.squeal = new Gate(this.gain(), this.out);
    this.sq.connect(this.filter("lowpass", 3500, 0.5)).connect(this.squeal.g);

    this.freeBus = this.gain();
    this.freeBus.connect(this.filter("highpass", 1500, 0.6)).connect(this.out);
    this.chainBus = this.gain();
    this.chainBus.connect(this.out);
    this.wet.gain.value = 0.04;
    this.out.connect(this.wet);
  }

  events(now: number, dt: number, s: RideState): void {
    this.dist += s.speed * dt;
    const h = now + LOOKAHEAD;
    const kit = this.kit;
    this.clicks(this.fw, s.wheel * PAWL_CLICKS * (s.speed > 0.25 ? 1 : 0), now, h, (t) => {
      const b = kit.pick("fw");
      if (b) kit.fire(b, t, this.freeBus, rr(kit.rng, 0.97, 1.03));
    });
    this.clicks(this.ch, s.crank * CHAIN_TICKS * (s.pedal > 0.05 ? 1 : 0), now, h, (t) => {
      const b = kit.pick(this.chainN++ % 3 === 0 ? "chainAcc" : "chain");
      if (b) kit.fire(b, t + rr(kit.rng, 0, 0.004), this.chainBus);
    });

    // bumps: explicit from the game, or occasional road seams
    if (s.bump > 0.05) this.bump(now + 0.01, s.bump, s);
    const sp = clamp(s.speed / 10, 0, 1.2);
    if (this.nextBump < 0) this.nextBump = now + rr(kit.rng, 4, 9);
    if (now >= this.nextBump) {
      if (s.speed > 1.5) this.bump(now + 0.02, rr(kit.rng, 0.2, 0.55) * (0.6 + s.roughness), s);
      this.nextBump = now + Math.min(40, 2 + expRand(kit.rng, 1 / Math.max(0.025, (0.05 + 0.25 * s.roughness) * sp)));
    }

    // squeal character is chosen per brake press
    if (s.brake > 0.3 && this.brakeWas <= 0.3) {
      this.squealAmt = kit.rng() < 0.5 ? rr(kit.rng, 0.35, 1) : 0;
      this.squealF = rr(kit.rng, 1750, 2350);
    }
    this.brakeWas = s.brake;
  }

  params(now: number, s: RideState): void {
    const sp = clamp(s.speed / 10, 0, 1.2);
    const grain = 0.85 + 0.3 * vnoise(this.dist / 7, 3);
    this.tyre.set(L_TYRE * Math.pow(sp, 1.2) * grain * (1 + 0.4 * s.roughness), now, 0.08);
    glideStep(this.tyreLP.frequency, 220 + 900 * sp, now, 0.1);
    this.hiss.set(L_HISS * Math.pow(sp, 1.6) * grain, now, 0.08);
    glideStep(this.hissBP.frequency, 2500 + 2200 * sp, now, 0.1);
    glideStep(this.tread.frequency, Math.max(0.05, s.wheel), now, 0.05);

    const crank = clamp(s.crank / 1.2, 0, 1.5);
    this.whirr.set(L_WHIRR * s.pedal * crank, now, 0.08);
    glideStep(this.mesh.frequency, Math.max(1, s.crank * TEETH), now, 0.05);
    glide(this.chainBus.gain, L_CHAIN * s.pedal * clamp(s.crank / 0.5, 0, 1), now, 0.05);
    const coast = 1 - s.pedal;
    glide(this.freeBus.gain, L_FREE * coast * coast * smoothstep(0.2, 1.5, s.speed) * (1 - 0.7 * s.brake), now, 0.05);

    const moving = smoothstep(0.2, 3, s.speed);
    this.rub.set(L_RUB * s.brake * moving * (0.6 + 0.4 * sp), now, s.brake > 0 ? 0.05 : 0.03);
    glideStep(this.rubBP.frequency, 1300 + 1500 * sp, now, 0.1);
    this.squeal.set(L_SQUEAL * this.squealAmt * s.brake * smoothstep(1, 3.5, s.speed), now, s.brake > 0.3 ? 0.15 : 0.04);
    glide(this.sq.frequency, this.squealF * (0.9 + 0.1 * sp), now, 0.2);
  }

  bump(when: number, strength: number, s: RideState): void {
    if (when - this.lastBump < 0.15) return;
    this.lastBump = when;
    const k = this.kit;
    const b = k.pick("rattle");
    const sp = clamp(s.speed / 10, 0, 1.2);
    if (b) k.play(b, when, { gain: L_RATTLE * clamp(strength, 0, 1.5) * (0.35 + 0.65 * sp), pan: rr(k.rng, -0.12, 0.12), rate: rr(k.rng, 0.93, 1.07), dest: this.out });
    const t = k.pick("tink");
    if (t && k.rng() < 0.25) k.play(t, when + 0.012, { gain: L_BELL * 0.1 * strength, pan: 0.05, dest: this.out });
  }

  ringBell(when: number): void {
    if (when - this.lastBell < 0.35) return;
    this.lastBell = when;
    const b = this.kit.pick("bell");
    if (b) this.kit.play(b, when, { gain: L_BELL, pan: 0.06, rate: rr(this.kit.rng, 0.985, 1.015), dest: this.out, wet: 1.5, wetDest: this.wet });
  }

  /** Schedule evenly spaced clicks at `rate`/s between the last scheduled time and `horizon`. */
  private clicks(c: Clicker, rate: number, now: number, horizon: number, fire: (t: number) => void): void {
    if (c.t < now) c.t = now;
    if (rate < 0.2) {
      c.t = horizon;
      return;
    }
    for (let guard = 0; guard < 64; guard++) {
      const tn = c.t + (1 - c.phase) / rate;
      if (tn > horizon) {
        c.phase = Math.min(0.999, c.phase + (horizon - c.t) * rate);
        c.t = horizon;
        return;
      }
      fire(tn);
      c.phase = 0;
      c.t = tn;
    }
  }
}
