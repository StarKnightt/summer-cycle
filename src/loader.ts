/**
 * Intro loader (markup + wash painter live in index.html so it shows before this bundle arrives).
 * Every animation there is a CSS transform/opacity loop on its own layer, so it keeps running on the
 * compositor while the world builds on the main thread; this class only feeds it progress and text.
 */
export type Stage = "sky" | "trees" | "grass" | "rice" | "houses" | "poles" | "road" | "rider" | "paint" | "cicadas";

const LINES: Record<Stage, string> = {
  sky: "painting the clouds…",
  trees: "growing the camphor trees…",
  grass: "combing the summer grass…",
  rice: "planting the rice…",
  houses: "raising the old wooden houses…",
  poles: "stringing the power lines…",
  road: "laying the country road…",
  rider: "pumping up the tyres…",
  paint: "mixing the watercolours…",
  cicadas: "listening for cicadas…",
};

const DISSOLVE = 1.15;

declare global {
  interface Window {
    __paintWash?: () => void;
  }
}

export class Loader {
  /** 0…1, never decreases. */
  progress = 0;
  private readonly el: HTMLElement | null;
  private readonly spans: HTMLSpanElement[];
  private cur = 0;
  private stage: Stage | null = null;
  private lastSwap = 0;
  private pendingText: string | null = null;
  private go: ((viaPointer: boolean) => void) | null = null;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(skip: boolean) {
    this.el = document.getElementById("loader");
    this.spans = this.el ? [...this.el.querySelectorAll<HTMLSpanElement>(".lines span")] : [];
    if (!this.el) return;
    this.lastSwap = performance.now();
    // While the loader is up it owns input: nothing reaches the ride until the "to ride" gesture.
    addEventListener("keydown", this.onKey, true);
    addEventListener("keyup", this.swallow, true);
    addEventListener("pointerdown", this.onPointer, true);
    addEventListener("resize", this.onResize);
    if (skip) this.el.style.cursor = "progress";
  }

  advance(w: number, stage: Stage): void {
    this.progress = Math.min(1, this.progress + w);
    this.el?.style.setProperty("--p", this.progress.toFixed(4));
    if (stage !== this.stage) {
      this.stage = stage;
      this.say(LINES[stage]);
    } else this.flush();
  }

  /** Built: show the prompt; `go` runs inside the first click/key (so it may start audio). */
  ready(go: (viaPointer: boolean) => void): void {
    this.progress = 1;
    if (!this.el) return go(false);
    this.el.style.setProperty("--p", "1");
    this.go = go;
    this.el.classList.add("go");
    this.pendingText = null;
    this.show("click or press any key to ride", true);
    const hint = this.el.querySelector<HTMLElement>(".hint");
    const auto = new URLSearchParams(location.search).has("autoplay");
    if (hint && !auto) hint.innerHTML = "<b>W</b> pedal &nbsp;·&nbsp; <b>Shift</b> sprint &nbsp;·&nbsp; <b>A D</b> steer &nbsp;·&nbsp; <b>S</b> brake &nbsp;·&nbsp; <b>V</b> view &nbsp;·&nbsp; <b>mouse</b> look &nbsp;·&nbsp; <b>B</b> bell";
  }

  /** Watercolour dissolve: holes bloom outward from the middle through the paper, pigment pooling at the edges. */
  dissolve(): void {
    const el = this.el;
    if (!el) return;
    this.detach();
    el.style.pointerEvents = "none";
    el.style.background = "transparent";
    const stage = el.querySelector<HTMLElement>("#stage")!;
    const grain = el.querySelector<HTMLElement>("#grain")!;
    for (const m of el.querySelectorAll<HTMLElement>(".mote,.petal,.fly")) m.style.transition = "opacity 0.5s", (m.style.opacity = "0");
    stage.style.transition = "opacity 0.5s ease, transform 0.9s ease";
    stage.style.opacity = "0";
    stage.style.transform = "translateY(-10px)";
    const cv = el.querySelector<HTMLCanvasElement>("#wash")!;
    const g = cv.getContext("2d");
    if (this.reduced || !g) {
      el.style.transition = "opacity 0.7s ease";
      el.style.opacity = "0";
      setTimeout(() => this.remove(), 750);
      return;
    }
    const w = cv.width, h = cv.height;
    const base = g.getImageData(0, 0, w, h);
    const out = g.createImageData(w, h);
    const field = new Float32Array(w * h);
    const cx = w * 0.5, cy = h * 0.56, dmax = Math.hypot(w * 0.5, h * 0.56);
    const u = 384 / w;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const n = fbm((x * u) / 34, (y * u) / 34) * 0.6 + fbm((x * u) / 9 + 40, (y * u) / 9) * 0.18;
        field[y * w + x] = (Math.hypot(x - cx, (y - cy) * 1.25) / dmax) * 0.72 + n * 0.5;
      }
    const t0 = performance.now();
    const src = base.data, dst = out.data;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 1000 / DISSOLVE);
      const e = k * k * (3 - 2 * k);
      const T = -0.1 + 1.4 * e, band = 0.022;
      for (let i = 0, j = 0; i < field.length; i++, j += 4) {
        const f = (field[i] - T) / band;
        const a = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
        // Pigment pools in a thin warm rim just inside the wet edge.
        const q = (field[i] - T) / 0.05;
        const rr = q > 0 && q < 1 ? (1 - q) * (1 - q) : 0;
        dst[j] = src[j] * (1 - rr * 0.1);
        dst[j + 1] = src[j + 1] * (1 - rr * 0.15);
        dst[j + 2] = src[j + 2] * (1 - rr * 0.26);
        dst[j + 3] = 255 * a;
      }
      g.putImageData(out, 0, 0);
      grain.style.opacity = String(0.55 * (1 - e) * (1 - e));
      if (k < 1) requestAnimationFrame(tick);
      else this.remove();
    };
    requestAnimationFrame(tick);
  }

  /** Remove at once (skip-intro: the ride's own cream fade takes over underneath). */
  remove(): void {
    this.detach();
    this.el?.remove();
  }

  private detach(): void {
    removeEventListener("keydown", this.onKey, true);
    removeEventListener("keyup", this.swallow, true);
    removeEventListener("pointerdown", this.onPointer, true);
    removeEventListener("resize", this.onResize);
  }

  private say(text: string): void {
    // Each line stays up long enough to read, even when build steps race past.
    if (performance.now() - this.lastSwap < 1100) this.pendingText = text;
    else this.show(text);
  }

  private flush(): void {
    if (this.pendingText && performance.now() - this.lastSwap >= 1100) {
      const t = this.pendingText;
      this.pendingText = null;
      this.show(t);
    }
  }

  private show(text: string, prompt = false): void {
    if (this.spans.length < 2) return;
    this.spans[this.cur].classList.remove("on");
    this.cur ^= 1;
    const s = this.spans[this.cur];
    // Start the incoming line just below its rest position (the outgoing one drifts up).
    s.style.transition = "none";
    s.style.transform = "translateY(5px)";
    s.textContent = text;
    s.classList.toggle("prompt", prompt);
    void s.offsetWidth;
    s.style.transition = "";
    s.style.transform = "";
    s.classList.add("on");
    this.lastSwap = performance.now();
  }

  private trigger(viaPointer: boolean): void {
    const go = this.go;
    if (!go) return;
    this.go = null;
    go(viaPointer);
  }

  private readonly swallow = (e: Event) => e.stopImmediatePropagation();

  private readonly onKey = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab" || e.key === "F5" || e.key === "F11" || e.key === "F12") return;
    e.preventDefault();
    if (!e.repeat) this.trigger(false);
  };

  private readonly onPointer = (e: PointerEvent) => {
    e.stopImmediatePropagation();
    if (e.button === 0) this.trigger(true);
  };

  private readonly onResize = () => {
    window.__paintWash?.();
  };
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
}

/**
 * Friendly full-screen notice for unrecoverable graphics problems (no WebGL2, lost context), in
 * the loader's washi style, with a Reload button. Safe to call before or after the loader is gone.
 */
export function fatal(title: string, detail: string): void {
  if (document.getElementById("fatal")) return;
  const el = document.createElement("div");
  el.id = "fatal";
  el.setAttribute("role", "alert");
  el.style.cssText =
    "position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;" +
    "background:radial-gradient(ellipse at 50% 40%,#f6efdd 0%,#efe3c8 70%,#e6d6b6 100%);color:#2f3944;text-align:center;padding:24px;" +
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;';
  const h = document.createElement("h2");
  h.textContent = title;
  h.style.cssText = "margin:0;font-weight:400;font-size:28px;letter-spacing:0.08em;";
  const p = document.createElement("p");
  p.textContent = detail;
  p.style.cssText = "margin:0;max-width:520px;font-size:16px;line-height:1.6;color:#6d675d;font-style:italic;";
  const b = document.createElement("button");
  b.textContent = "Reload";
  b.style.cssText =
    "margin-top:8px;padding:8px 26px;border:1px solid #9a8f7d;border-radius:18px;background:#f8f1e2;color:#2f3944;" +
    "font:inherit;font-size:15px;letter-spacing:0.12em;cursor:pointer;";
  b.addEventListener("click", () => location.reload());
  el.append(h, p, b);
  document.body.appendChild(el);
  if (document.pointerLockElement) document.exitPointerLock();
}
