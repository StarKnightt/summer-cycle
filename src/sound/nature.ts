import { clamp, expRand, lerp, pick, rr, vnoise } from "./dsp";
import { GEN_SR, glide, Kit, Layer, type Env, type RideState } from "./kit";
import { birdChirps, birdTrill, birdWarble, birdWhistle, cicadaChorus, crow, frog, higurashi, kite, minmin, uguisu, waterBabble } from "./voices";

/** Place a voice at distance d∈[0,1]: quieter, darker (far bus) and wetter the further away. */
function placeOpts(l: Layer & { far: AudioNode }, d: number, gain: number) {
  return { gain: gain * lerp(1, 0.3, d), dest: d > 0.5 ? l.far : l.out, wet: lerp(0.15, 0.7, d), wetDest: l.wet };
}

const L_CHORUS = 0.1;
const L_HIGU = 0.09;
const L_MINMIN = 0.06;

/**
 * Cicadas: a seamlessly looping far chorus in two stereo-spread sheets that swell and fade in slow waves,
 * plus individual higurashi ("kana-kana-kana") that call and answer each other from around the valley,
 * and now and then a minmin-zemi.
 */
export class CicadaLayer extends Layer {
  readonly far: BiquadFilterNode;
  private sheets: { g: GainNode; seed: number }[] = [];
  private nextCall = 0;
  private nextMin = 0;
  private answers: { t: number; slot: number; left: number }[] = [];
  private slots = [
    { pan: -0.8, d: 0.8 },
    { pan: -0.3, d: 0.95 },
    { pan: 0.35, d: 0.7 },
    { pan: 0.85, d: 0.85 },
    { pan: 0.05, d: 1 },
  ];

  constructor(kit: Kit) {
    super(kit);
    kit.loopBank("chorus", 2, 24000, cicadaChorus(9));
    kit.bank("higurashi", 5, GEN_SR, higurashi);
    kit.bank("minmin", 2, GEN_SR, minmin);
    this.far = this.filter("lowpass", 5200, 0.6);
    this.far.connect(this.out);
  }

  events(now: number, _dt: number, s: RideState): void {
    const k = this.kit;
    const r = k.rng;
    if (!this.sheets.length && k.has("chorus")) {
      const buf = k.get("chorus")[0];
      for (const [rate, pan, seed] of [
        [1, -0.35, 41],
        [0.987, 0.35, 42],
      ]) {
        const g = this.gain();
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        k.loop(buf, rate).connect(g).connect(p).connect(this.out);
        p.connect(this.gain(0.45)).connect(this.wet);
        this.sheets.push({ g, seed });
      }
    }
    if (!this.nextCall) {
      this.nextCall = now + rr(r, 3, 6);
      this.nextMin = now + rr(r, 30, 70);
    }
    if (now >= this.nextCall) {
      if (this.call(now + 0.02, Math.floor(r() * this.slots.length))) this.nextCall = now + expRand(r, lerp(26, 10, s.evening)) + 2;
      else this.nextCall = now + 1;
    }
    for (let i = this.answers.length - 1; i >= 0; i--) {
      const a = this.answers[i];
      if (now >= a.t) {
        this.answers.splice(i, 1);
        this.call(now + 0.02, a.slot, a.left);
      }
    }
    if (now >= this.nextMin) {
      this.minmin(now + 0.02);
      this.nextMin = now + rr(r, 40, 90) / (1.2 - 0.6 * s.evening);
    }
  }

  minmin(when: number): void {
    const k = this.kit;
    const b = k.pick("minmin");
    if (b) k.play(b, when, { ...placeOpts(this, rr(k.rng, 0.5, 0.9), L_MINMIN), pan: rr(k.rng, -0.8, 0.8), rate: rr(k.rng, 0.97, 1.03) });
  }

  /** One higurashi phrase; others may answer from elsewhere a few seconds later. */
  call(when: number, slot: number, answersLeft = 2): boolean {
    const k = this.kit;
    const b = k.pick("higurashi");
    if (!b) return false;
    const pos = this.slots[slot % this.slots.length];
    k.play(b, when, { ...placeOpts(this, pos.d, L_HIGU), pan: pos.pan + rr(k.rng, -0.1, 0.1), rate: rr(k.rng, 0.97, 1.03) });
    if (answersLeft > 0 && k.rng() < 0.65) {
      let other = Math.floor(k.rng() * this.slots.length);
      if (other === slot) other = (other + 1) % this.slots.length;
      this.answers.push({ t: when + rr(k.rng, 1.5, 4.5), slot: other, left: answersLeft - 1 });
    }
    return true;
  }

  params(now: number, s: RideState): void {
    for (const sh of this.sheets) {
      const wave = 0.3 + 0.7 * Math.pow(vnoise(now / 19, sh.seed), 1.3);
      glide(sh.g.gain, L_CHORUS * wave * (1 - 0.3 * s.evening), now, 1.2);
    }
  }
}

const L_BIRD = 0.22;
type Kind = "chirp" | "warble" | "trill" | "whistle";
const KINDS: Kind[] = ["chirp", "chirp", "warble", "warble", "trill", "trill", "whistle"];

interface Bird {
  kind: Kind;
  pan: number;
  d: number;
  rate: number;
  next: number;
  left: number;
  buf: AudioBuffer | null;
}

/**
 * Birds: a handful of individual songbirds, each repeating its own song a few times from one spot
 * before flying off and being replaced; plus rare set pieces — uguisu, a kite circling high above,
 * a crow far away.
 */
export class BirdLayer extends Layer {
  readonly far: BiquadFilterNode;
  private birds: Bird[] = [];
  private nextUguisu = 0;
  private uguisuLeft = 0;
  private nextKite = 0;
  private nextCrow = 0;

  constructor(kit: Kit) {
    super(kit);
    kit.bank("chirp", 5, GEN_SR, birdChirps);
    kit.bank("warble", 5, GEN_SR, birdWarble);
    kit.bank("trill", 4, GEN_SR, birdTrill);
    kit.bank("whistle", 3, GEN_SR, birdWhistle);
    kit.bank("uguisu", 2, GEN_SR, uguisu);
    kit.bank("kite", 2, GEN_SR, kite);
    kit.bank("crow", 2, GEN_SR, crow);
    this.far = this.filter("lowpass", 3200, 0.6);
    this.far.connect(this.out);
    this.wet.gain.value = 1;
  }

  private spawn(now: number, first: boolean): Bird {
    const r = this.kit.rng;
    const kind = pick(r, KINDS);
    return {
      kind,
      pan: rr(r, -0.9, 0.9),
      d: kind === "whistle" ? rr(r, 0.5, 1) : rr(r, 0.1, 1),
      rate: rr(r, 0.92, 1.08),
      next: now + (first ? rr(r, 0.8, 6) : rr(r, 3, 10)),
      left: 2 + Math.floor(r() * 5),
      buf: null,
    };
  }

  events(now: number, _dt: number, s: RideState): void {
    const k = this.kit;
    const r = k.rng;
    if (!this.birds.length) {
      for (let i = 0; i < 5; i++) this.birds.push(this.spawn(now, true));
      this.nextUguisu = now + rr(r, 20, 50);
      this.nextKite = now + rr(r, 40, 90);
      this.nextCrow = now + rr(r, 30, 80);
    }
    const activity = 0.55 + 0.9 * vnoise(now / 40, 51);
    const sp = clamp(s.speed / 10, 0, 1.2);
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (now < b.next) continue;
      b.buf ??= k.pick(b.kind);
      if (!b.buf) {
        b.next = now + 1;
        continue;
      }
      const o = placeOpts(this, b.d, L_BIRD * (b.kind === "whistle" ? 0.8 : 1));
      // as we ride past, a bird slides outward in the stereo field
      const panTo = b.pan + Math.sign(b.pan || 1) * Math.min(0.3, sp * 0.25);
      k.play(b.buf, now + 0.02, { ...o, pan: b.pan, panTo, rate: b.rate * rr(r, 0.985, 1.015) });
      b.pan = clamp(panTo, -1, 1);
      b.d = clamp(b.d + sp * 0.08, 0, 1);
      if (--b.left <= 0) this.birds[i] = this.spawn(now, false);
      else b.next = now + (b.buf.duration + rr(r, 1.5, 6)) / activity;
      if (r() < 0.25) b.buf = null; // occasionally switch to a variation of its song
    }

    if (now >= this.nextUguisu) {
      const b = k.pick("uguisu");
      if (b) {
        const pan = this.uguisuLeft > 0 ? 0.55 : rr(r, -0.8, 0.8);
        k.play(b, now + 0.02, { ...placeOpts(this, rr(r, 0.35, 0.6), L_BIRD * 0.85), pan, rate: rr(r, 0.98, 1.02) });
        if (this.uguisuLeft > 0) this.uguisuLeft--;
        else this.uguisuLeft = Math.floor(r() * 3);
        this.nextUguisu = now + (this.uguisuLeft > 0 ? rr(r, 7, 12) : rr(r, 45, 110));
      } else this.nextUguisu = now + 2;
    }
    if (now >= this.nextKite) {
      const b = k.pick("kite");
      if (b) {
        const pan = rr(r, -0.7, 0.7);
        k.play(b, now + 0.02, { ...placeOpts(this, rr(r, 0.85, 1), L_BIRD * 1.1), pan, panTo: pan + rr(r, -0.3, 0.3), rate: rr(r, 0.97, 1.03) });
        this.nextKite = now + rr(r, 70, 160);
      } else this.nextKite = now + 2;
    }
    if (now >= this.nextCrow) {
      const b = k.pick("crow");
      if (b) {
        k.play(b, now + 0.02, { ...placeOpts(this, rr(r, 0.75, 1), L_BIRD * 0.8), pan: rr(r, -0.9, 0.9), rate: rr(r, 0.95, 1.05) });
        this.nextCrow = now + rr(r, 50, 130);
      } else this.nextCrow = now + 2;
    }
  }

  params(): void {}

  trigger(name: "uguisu" | "kite" | "crow"): void {
    if (name === "uguisu") this.nextUguisu = 0;
    else if (name === "kite") this.nextKite = 0;
    else this.nextCrow = 0;
  }
}

const L_WATER = 0.22;
const L_FROG = 0.12;

/** Water: trickling irrigation channel beside the paddies (fades with proximity) and far-off tree frogs. */
export class WaterLayer extends Layer {
  readonly far: BiquadFilterNode;
  private g: GainNode;
  private lp: BiquadFilterNode;
  private pan: StereoPannerNode;
  private src: AudioBufferSourceNode | null = null;
  private nextFrog = 0;

  constructor(kit: Kit) {
    super(kit);
    kit.loopBank("water", 2, GEN_SR, waterBabble(10));
    kit.bank("frog", 3, GEN_SR, frog);
    this.g = this.gain();
    this.lp = this.filter("lowpass", 3000, 0.6);
    this.pan = this.ctx.createStereoPanner();
    this.g.connect(this.lp).connect(this.pan).connect(this.out);
    this.pan.connect(this.gain(0.3)).connect(this.wet);
    this.far = this.filter("lowpass", 2400, 0.6);
    this.far.connect(this.out);
  }

  events(now: number, _dt: number, s: RideState): void {
    const k = this.kit;
    if (!this.src && k.has("water")) {
      this.src = k.loop(k.get("water")[0]);
      this.src.connect(this.g);
    }
    if (!this.nextFrog) this.nextFrog = now + rr(k.rng, 8, 20);
    if (now >= this.nextFrog) {
      this.frog(now + 0.02, s);
      this.nextFrog = now + Math.max(6, expRand(k.rng, 40 / (0.25 + s.water)));
    }
  }

  frog(when: number, s: RideState): void {
    const k = this.kit;
    const b = k.pick("frog");
    if (b) k.play(b, when, { ...placeOpts(this, rr(k.rng, 0.55, 0.95), L_FROG * (0.5 + 0.5 * s.water)), pan: rr(k.rng, -0.9, 0.9), rate: rr(k.rng, 0.92, 1.08) });
  }

  params(now: number, s: RideState): void {
    const w = s.water;
    glide(this.g.gain, L_WATER * Math.pow(w, 1.4), now, 0.6);
    glide(this.lp.frequency, 900 + 4500 * w, now, 0.6);
    glide(this.pan.pan, clamp((vnoise(now / 23, 61) - 0.5) * 1.6, -0.8, 0.8), now, 1);
    if (this.src) glide(this.src.playbackRate, 0.95 + 0.1 * vnoise(now / 9, 62), now, 0.8);
  }
}
