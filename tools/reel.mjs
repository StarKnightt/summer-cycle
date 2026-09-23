/**
 * Captures the README media from a running build.
 *
 *   pnpm build && pnpm preview          (serves http://localhost:5420/)
 *   node tools/reel.mjs [--url=http://localhost:5420/] [--only=reel|stills]
 *
 * reel:   7 s (20 fps) of autoplay from the opening frame, simulated one frame at a time. requestAnimationFrame
 *         is taken over once the world is built and fed a virtual clock that advances exactly one frame
 *         per frame, so the result is independent of how fast the capturing machine renders.
 *         Frames are kept in --frames and encoded to media/reel.webp with ffmpeg (libwebp_anim);
 *         --only=encode [--quality=N] re-encodes them.
 * stills: six 1600x900 JPEGs (quality 82) in media/.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5420/");
const ONLY = arg("only", "all");
const OUT = "media";
const FPS = Number(arg("fps", 20)), SECS = Number(arg("secs", 7)), QUALITY = arg("quality", "50");
const FRAMES = arg("frames", path.join(os.tmpdir(), "summer-cycle-reel"));
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chromium", args: ["--use-angle=d3d11", "--use-gl=angle", "--mute-audio", "--hide-scrollbars"] });
const errors = [];
async function open(query, viewport) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/warning X\d{4}/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    // Manual clock: once __manual is set, rAF callbacks queue up until __step() runs them.
    const raf = window.requestAnimationFrame.bind(window);
    let queue = [], vt = 0;
    window.__manual = false;
    window.requestAnimationFrame = (cb) => (window.__manual ? (queue.push(cb), queue.length) : raf(cb));
    window.__step = (ms) => {
      vt = vt || performance.now();
      vt += ms;
      const q = queue;
      queue = [];
      for (const cb of q) cb(vt);
    };
  });
  await page.goto(`${URL}?${query}`);
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120000 });
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (ONLY === "all" || ONLY === "reel") {
  const page = await open("autoplay=1&skipintro=1&nohud=1", { width: 1440, height: 810 });
  const dir = FRAMES;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await wait(400);
  await page.evaluate(() => (window.__manual = true));
  await wait(100);
  // Settle: one second of simulated riding before the first captured frame.
  for (let i = 0; i < FPS; i++) await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
  for (let i = 0; i < FPS * SECS; i++) {
    await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
  }
  await page.close();
  encode(dir);
}

/** Encode captured frames (re-run with --only=encode to try other settings without re-capturing). */
function encode(dir) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"),
    "-vf", "scale=960:-2:flags=lanczos", "-c:v", "libwebp_anim", "-quality", QUALITY, "-compression_level", "6", "-loop", "0", path.join(OUT, "reel.webp")]);
}
if (ONLY === "encode") encode(FRAMES);
if (ONLY !== "stills") console.log(`reel: ${((await fs.stat(path.join(OUT, "reel.webp"))).size / 1e6).toFixed(2)} MB`);

if (ONLY === "all" || ONLY === "stills") {
  const V = { width: 1600, height: 900 };
  const still = async (name, query, setup, settle = 2500) => {
    const page = await open(`skipintro=1&nohud=1&${query}`, V);
    await setup(page);
    await wait(settle);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
    await page.close();
    console.log(name);
  };
  const ride = (u, z, speed) => (p) => p.evaluate(([u, z, s]) => { const r = window.__ride; r.setAutoplay(true); r.place(u, z, s); }, [u, z, speed]);
  await still("01-opening", "autoplay=1", async () => {}, 1500);
  await still("02-shop-row", "autoplay=1", ride(-0.8, -88, 6), 3000);
  await still("03-sunset-paddies", "autoplay=1&time=sunset", async (p) => {
    await ride(-0.8, -150, 5)(p);
    await wait(1500);
    await p.evaluate(() => window.__ride.view(2.2, 1.9, 4.2, -9, 0.9, -9));
  });
  await still("04-dusk-shop-row", "autoplay=1&time=dusk", ride(-0.8, -90, 5), 3500);
  await still("05-first-person", "autoplay=1&cam=fpp&time=golden", ride(-0.8, -196, 6), 3000);
  await still("06-on-foot", "time=golden", async (p) => {
    await p.keyboard.press("KeyF");
    await p.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 15000 });
    await p.evaluate(() => window.__ride.explore.teleport(4.2, -47));
    await wait(300);
    await p.evaluate(() => window.__ride.explore.orbit(2.2, 0.16, 4.4));
  });
}

await browser.close();
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console: clean");
