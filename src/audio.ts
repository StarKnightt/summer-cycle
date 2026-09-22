/**
 * Everything is synthesised with Web Audio (no files):
 *   chain      soft ticks locked to the crank while pedalling; faster freewheel ticks when coasting
 *   wind       band-passed noise, louder and brighter with speed
 *   tyres      low rumble of the asphalt under the wheels
 *   birds      occasional chirp phrases (swept sine bursts), panned left/right
 *   ambience   quiet countryside bed: low drone + distant cicada shimmer
 */
export class RideAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private tyreGain!: GainNode;
  private tickPhase = 0;
  private birdT = 2;

  get state(): string {
    return this.ctx ? this.ctx.state : "off";
  }

  start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 2);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop().connect(this.windFilter).connect(this.windGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(this.windFilter.frequency);
    lfo.start();

    // Tyre rumble.
    const tf = ctx.createBiquadFilter();
    tf.type = "lowpass";
    tf.frequency.value = 180;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.loop().connect(tf).connect(this.tyreGain).connect(this.master);

    // Ambient drone: two soft detuned sines through a lowpass.
    const dg = ctx.createGain();
    dg.gain.value = 0.018;
    const dl = ctx.createBiquadFilter();
    dl.type = "lowpass";
    dl.frequency.value = 400;
    for (const f of [98, 147.3, 196.5]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(dl);
      o.start();
    }
    dl.connect(dg).connect(this.master);
    // Distant cicadas: high band noise with a fast tremolo, slowly breathing.
    const cf = ctx.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 5200;
    cf.Q.value = 3;
    const cg = ctx.createGain();
    cg.gain.value = 0.0;
    const trem = ctx.createOscillator();
    trem.frequency.value = 38;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.012;
    trem.connect(tremG).connect(cg.gain);
    trem.start();
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.05;
    const bg = ctx.createGain();
    bg.gain.value = 0.006;
    breathe.connect(bg).connect(cg.gain);
    breathe.start();
    this.loop().connect(cf).connect(cg).connect(this.master);
  }

  update(dt: number, speed: number, crankRate: number, wheelRate: number, pedaling: number, braking: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = Math.min(speed / 10, 1);
    this.windGain.gain.setTargetAtTime(0.015 + s * s * 0.12, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(350 + s * 900, t, 0.3);
    this.tyreGain.gain.setTargetAtTime(s * 0.07, t, 0.2);

    // Chain / freewheel ticks.
    const coasting = pedaling < 0.5;
    const rate = coasting ? wheelRate * 9 : crankRate * 6;
    if (speed > 0.3 && !braking) {
      this.tickPhase += rate * dt;
      while (this.tickPhase >= 1) {
        this.tickPhase -= 1;
        if (coasting) this.click(t + Math.random() * 0.004, 5200, 0.018, 0.018);
        else this.click(t + Math.random() * 0.006, 2400 + Math.random() * 400, 0.012, 0.03);
      }
    }

    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.bird(t);
      this.birdT = 3 + Math.random() * 6;
    }
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  private click(t: number, freq: number, gain: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.02);
  }

  private bird(t0: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.05 + Math.random() * 0.04;
    out.connect(pan).connect(this.master);
    const kind = Math.random();
    const n = 2 + Math.floor(Math.random() * 5);
    const base = 2600 + Math.random() * 1800;
    let t = t0;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      const g = ctx.createGain();
      const dur = kind < 0.5 ? 0.07 + Math.random() * 0.05 : 0.14 + Math.random() * 0.08;
      const f0 = base * (0.9 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f0, t);
      if (kind < 0.5) o.frequency.exponentialRampToValueAtTime(f0 * 1.45, t + dur);
      else {
        o.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + dur * 0.4);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
      }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
  }
}
