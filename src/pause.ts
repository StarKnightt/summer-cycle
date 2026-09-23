/**
 * Pause menu. Tap Esc toggles it; holding Esc only lets go of the mouse (the ride keeps going).
 * Losing focus (tab switch, window blur) pauses too. While paused, keys don't reach the game.
 *
 * With the Keyboard Lock API (fullscreen + navigator.keyboard.lock(["Escape"])) the page sees Esc
 * keydown/keyup, so a hold is detected while still pressed. Without it the browser drops pointer
 * lock on keydown and the tap/hold decision waits for the keyup.
 */
const TAP = 0.4; // s: shorter Esc presses are taps
const HOLD = 0.5; // s: with keyboard lock, release the mouse once Esc has been held this long

const CONTROLS: [string, string][] = [
  ["W  S", "pedal · brake"],
  ["A  D", "steer"],
  ["Shift", "sprint · run"],
  ["Mouse", "look around"],
  ["F", "walk · ride"],
  ["C", "cinematic cameras"],
  ["V", "first person"],
  ["T", "time of day"],
  ["B", "bell"],
  ["M", "mute"],
];

type Nav = Navigator & { keyboard?: { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void } };

export class Pause {
  paused = false;
  /** False until the ride has started (the loader owns input before that). */
  enabled = false;
  /** Keyboard Lock is holding Esc for us (fullscreen): Esc presses reach the page. */
  keyLock = false;
  private el: HTMLDivElement;
  private escDown = -1;
  private unlockedAt = -1;
  private holdTimer = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: { onPause: () => void; onResume: (viaGesture: boolean) => void; lookHint: () => void },
  ) {
    this.el = document.createElement("div");
    this.el.id = "pause";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Paused");
    this.el.innerHTML = `<div class="pgrain"></div><div class="pcard">
      <div class="ptitle">Summer Cycle</div>
      <div class="phead">Paused</div>
      <div class="prule"></div>
      <dl class="pkeys">${CONTROLS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <div class="pgo">click to resume</div>
      <div class="pnote"><b>Esc</b> · <b>Enter</b> · <b>Space</b> also resume &nbsp;—&nbsp; hold <b>Esc</b> to free the mouse</div>
    </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.button === 0 && this.paused) this.resume(true);
    });

    addEventListener("keydown", this.onKeyDown, true);
    addEventListener("keyup", this.onKeyUp, true);
    addEventListener("blur", () => this.pause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement !== canvas) this.unlockedAt = performance.now();
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) this.keyLock = false;
    });
  }

  /** From the "to ride" click: fullscreen + Keyboard Lock on Esc, where the browser allows it. */
  async enterFullscreen(): Promise<void> {
    const root = document.documentElement;
    try {
      if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
      const kb = (navigator as Nav).keyboard;
      if (document.fullscreenElement && kb?.lock) {
        await kb.lock(["Escape"]);
        this.keyLock = true;
      }
    } catch {
      /* denied or unsupported: the keyup fallback handles Esc */
    }
  }

  pause(): void {
    if (!this.enabled || this.paused) return;
    this.paused = true;
    clearTimeout(this.holdTimer);
    this.el.classList.add("on");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    // Release anything held (the input handlers clear their key state on blur).
    if (document.hasFocus()) dispatchEvent(new Event("blur"));
    this.hooks.onPause();
  }

  resume(viaGesture: boolean): void {
    if (!this.paused) return;
    this.paused = false;
    this.el.classList.remove("on");
    this.hooks.onResume(viaGesture);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || this.escDown >= 0) return;
      this.escDown = performance.now();
      if (this.keyLock && !this.paused) {
        this.holdTimer = window.setTimeout(() => {
          if (this.escDown >= 0 && document.pointerLockElement === this.canvas) document.exitPointerLock();
        }, HOLD * 1000);
      }
      return;
    }
    if (!this.paused) return;
    // Paused: nothing reaches the game. Enter / Space resume (they are user gestures, so re-lock).
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat && (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space")) this.resume(true);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled || e.code !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    clearTimeout(this.holdTimer);
    const now = performance.now();
    // Without keyboard lock the keydown can be eaten by the browser's pointer-lock exit: time the
    // press from the unlock instead.
    let start = this.escDown;
    if (start < 0 && this.unlockedAt >= 0 && now - this.unlockedAt < 3000) start = this.unlockedAt;
    this.escDown = -1;
    const held = start >= 0 ? (now - start) / 1000 : 0;
    if (held >= TAP) {
      if (!this.paused) {
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.hooks.lookHint();
      }
      return;
    }
    // Esc is not a user-activation key: resuming with it re-locks on the next click.
    if (this.paused) this.resume(false);
    else this.pause();
  };
}
