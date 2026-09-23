/**
 * Ride soundscape — everything is synthesised at runtime with Web Audio (no audio files).
 * The engine lives in ./sound/: bicycle, wind + leaf rustle, cicadas (higurashi / minmin / far chorus),
 * birds (songbirds, uguisu, kite, crow), irrigation water + frogs, and a warm ambience bed with rare
 * furin, temple-bell and level-crossing details, all through an open-air convolution reverb and a
 * compressor → limiter → soft-clip master bus.
 *
 * ── Wiring guide ────────────────────────────────────────────────────────────────────────────────
 *   const audio = new RideAudio();
 *   new Input(() => audio.start());            // start() must run inside a user gesture (autoplay policy)
 *   audio.bindKeys();                          // optional: B = bell, M = mute (returns an unbind function)
 *
 *   // every frame (unchanged signature; the 7th argument is optional):
 *   audio.update(dt, ctl.speed, ctl.cadence, ctl.wheelRate, ctl.pedaling, ctl.braking, {
 *     steer: ctl.steer / 0.3,     // -1…1, wind shifts slightly toward the turn
 *     bump: 0,                    // 0…1 impulse on the frame the wheel hits a seam/pothole (basket rattle)
 *     roughness: 0.25,            // 0 smooth asphalt … 1 rough/gravel (more tyre noise, more random bumps)
 *     water: 0…1,                 // closeness to paddies / irrigation channels (trickling water, frogs)
 *     trees: 0…1,                 // closeness to trees (leaf rustle)
 *     houses: 0…1,                // closeness to houses (furin wind chimes ring more often)
 *     evening: 0.65,              // 0 midday … 1 dusk (more higurashi, fewer minmin)
 *   });
 *   Any omitted extra gets a default; water/trees/houses then drift slowly with distance ridden.
 *   `braking` may be a boolean or a 0…1 brake pressure.
 *
 *   audio.ringBell();  audio.bump(0.8);  audio.toggleMute();  audio.setMasterVolume(0…1);
 *   audio.footstep("asphalt" | "grass" | "dirt", 0…1.5);   // on foot (optional)
 *   audio.trigger("furin" | "temple" | "crossing" | "uguisu" | "kite" | "crow" | "frog" | "higurashi" | "minmin" | "bell" | "bump");
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { SoundEngine, type SoundEvent } from "./sound/engine";
import type { StepSurface } from "./sound/steps";

export type { SoundEvent } from "./sound/engine";
export type { StepSurface } from "./sound/steps";

export interface RideAudioExtras {
  steer?: number;
  bump?: number;
  roughness?: number;
  water?: number;
  trees?: number;
  houses?: number;
  evening?: number;
}

const PREFS_KEY = "ghibli-ride:audio";
const FADE_IN = 2.5;

export class RideAudio {
  private ctx: AudioContext | null = null;
  private engine: SoundEngine | null = null;
  private vol = 0.8;
  private mute = false;
  private hideTimer = 0;
  private onVis = () => this.visibility();

  constructor() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { volume?: number; muted?: boolean };
      if (typeof p.volume === "number" && Number.isFinite(p.volume)) this.vol = Math.min(1, Math.max(0, p.volume));
      if (typeof p.muted === "boolean") this.mute = p.muted;
    } catch {
      /* private mode / no storage */
    }
  }

  /** "off" before start(), otherwise the AudioContext state. */
  get state(): string {
    return this.ctx ? this.ctx.state : "off";
  }

  get muted(): boolean {
    return this.mute;
  }

  get volume(): number {
    return this.vol;
  }

  /** Create (or resume) the audio context. Call from a user gesture. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.engine = new SoundEngine(ctx, ctx.destination, { lazy: true });
    this.engine.setVolume(0, ctx.currentTime, 0.01);
    this.applyVolume(FADE_IN / 3);
    document.addEventListener("visibilitychange", this.onVis);
    if (ctx.state === "suspended") void ctx.resume();
  }

  update(dt: number, speed: number, crankRate: number, wheelRate: number, pedaling: number, braking: boolean | number, extras?: RideAudioExtras): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || ctx.state !== "running") return;
    this.engine.tick(ctx.currentTime, dt, {
      speed,
      crank: crankRate,
      wheel: wheelRate,
      pedal: pedaling,
      brake: typeof braking === "number" ? braking : braking ? 1 : 0,
      ...extras,
    });
  }

  /** Mamachari bell "chirin-chirin". Starts audio if needed. */
  ringBell(): void {
    this.start();
    if (this.ctx && this.engine) this.engine.ringBell(this.ctx.currentTime + 0.01);
  }

  /** Basket/mudguard rattle, strength 0…1. */
  bump(strength = 0.6): void {
    if (this.ctx && this.engine) this.engine.bump(this.ctx.currentTime + 0.01, strength);
  }

  /** A footstep while walking: "asphalt" | "grass" | "dirt", strength 0…1.5 (jogging ≈ 1.2). */
  footstep(surface: StepSurface, strength = 0.8): void {
    if (this.ctx && this.engine) this.engine.footstep(this.ctx.currentTime + 0.005, surface, strength);
  }

  /** Fire a specific sound now (handy for cutscenes and testing). */
  trigger(ev: SoundEvent): void {
    if (this.ctx && this.engine) this.engine.trigger(ev, this.ctx.currentTime + 0.02);
  }

  /** 0…1 (persisted). */
  setMasterVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, Number.isFinite(v) ? v : this.vol));
    this.applyVolume();
    this.save();
  }

  setMuted(m: boolean): void {
    this.mute = m;
    this.applyVolume();
    this.save();
  }

  /** Pause menu: duck to near-silence over ~0.4 s, and back. */
  setPaused(p: boolean): void {
    this.ducked = p;
    this.applyVolume(0.13);
  }

  toggleMute(): boolean {
    this.setMuted(!this.mute);
    return this.mute;
  }

  /** B = bell, M = mute. Returns a function that removes the listener. */
  bindKeys(target: Window = window): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "KeyB") this.ringBell();
      else if (e.code === "KeyM") {
        this.start();
        this.toggleMute();
      }
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.onVis);
    clearTimeout(this.hideTimer);
    void this.ctx?.close();
    this.ctx = null;
    this.engine = null;
  }

  private ducked = false;

  private applyVolume(tau = 0.08): void {
    if (this.ctx && this.engine) this.engine.setVolume(this.mute ? 0 : this.ducked ? this.vol * 0.03 : this.vol, this.ctx.currentTime, tau);
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ volume: this.vol, muted: this.mute }));
    } catch {
      /* ignore */
    }
  }

  /** Fade out and suspend while the tab is hidden; fade back in when it returns. */
  private visibility(): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    clearTimeout(this.hideTimer);
    if (document.hidden) {
      this.engine.setVolume(0, ctx.currentTime, 0.04);
      this.hideTimer = window.setTimeout(() => void ctx.suspend(), 250);
    } else {
      void ctx.resume().then(() => this.applyVolume(0.3));
    }
  }
}
