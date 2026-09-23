#!/usr/bin/env node
/**
 * Time-of-day captures at 1920x1080 on the real GPU: each preset at the opening frame, sunset over
 * the paddies, dusk lights + fireflies, a mid-transition frame, the timelapse at ~20 s; FPS per preset.
 *   node scripts/tod-shots.mjs --url=http://localhost:5460/ --out=shots/tod [--only=sunset] [--fps]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5460/");
const OUT = path.join(ROOT, arg("out", "shots/tod"));
const ONLY = arg("only", "");
const FPS = argv.includes("--fps");
const W = 1920, H = 1080;

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
const open = async (q) => {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${URL}?skipintro=1&nohud=1&${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__ride.time > 1.0, null, { timeout: 20_000 });
  return page;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const want = (n) => !ONLY || ONLY.split(",").includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  // Opening frame (z = -54 composition), each preset from its own URL.
  for (const p of ["afternoon", "golden", "sunset", "dusk"]) {
    if (!want(p)) continue;
    const pg = await open(`time=${p}`);
    await shot(pg, `open_${p}`);
    await pg.close();
  }
  const page = await open("time=afternoon");
  console.log(`[gpu] ${(await page.evaluate(() => window.__ride.stats())).renderer}`);
  if (want("paddy")) {
    await page.evaluate(() => { window.__ride.setTime("sunset", true); window.__ride.setCam("paddy"); });
    await sleep(700);
    await shot(page, "sunset_paddy");
    await page.evaluate(() => window.__ride.setCam("tpp"));
  }
  if (want("lights")) {
    // Village frontage at dusk: stop by the shop with lamps, lantern and vending machine.
    await page.evaluate(() => { window.__ride.setTime("dusk", true); window.__ride.place(0.4, -31, 0); window.__ride.setCam("houses"); });
    await sleep(700);
    await shot(page, "dusk_lights");
    await page.evaluate(() => window.__ride.setCam("paddy"));
    await sleep(700);
    await shot(page, "dusk_fireflies");
    await page.evaluate(() => window.__ride.setCam("tpp"));
  }
  if (want("shoprow")) {
    // Shop row (vending machines, phone box, signs) at dusk and at sunset.
    for (const p of ["dusk", "sunset"]) {
      await page.evaluate((pp) => { window.__ride.setTime(pp, true); window.__ride.place(0.3, -94, 0); window.__ride.setCam("houses"); }, p);
      await sleep(900);
      await shot(page, `${p}_shoprow`);
    }
    await page.evaluate(() => window.__ride.setCam("tpp"));
  }
  if (want("mid")) {
    // Real key press: T from golden hour starts the transition to sunset.
    await page.evaluate(() => window.__ride.setTime("golden", true));
    await sleep(300);
    await page.keyboard.press("KeyT");
    await sleep(1800);
    const now = await page.evaluate(() => window.__ride.timeOfDay);
    if (now !== "sunset") errors.push(`T key: expected sunset, got ${now}`);
    await shot(page, "transition_golden_to_sunset");
  }
  if (FPS) {
    await page.evaluate(() => window.__ride.setAutoplay(true));
    for (const p of ["afternoon", "golden", "sunset", "dusk"]) {
      await page.evaluate((pp) => window.__ride.setTime(pp, true), p);
      await sleep(2500);
      const n0 = await page.evaluate(() => window.__ride.fpsLog.length);
      await sleep(8200);
      const log = await page.evaluate((n) => window.__ride.fpsLog.slice(n), n0);
      const avg = log.reduce((a, b) => a + b, 0) / Math.max(1, log.length);
      console.log(`fps ${p.padEnd(10)} avg=${avg.toFixed(1)} min=${Math.min(...log)} [${log.join(",")}]`);
    }
  }
  await page.close();
  if (want("timelapse")) {
    const p2 = await open("autoplay=1&timelapse=1");
    const t0 = await p2.evaluate(() => window.__ride.time);
    await p2.waitForFunction((t) => window.__ride.time >= t + 20, t0, { timeout: 60_000, polling: 50 });
    await shot(p2, "timelapse_20s");
    await p2.waitForFunction((t) => window.__ride.time >= t + 31, t0, { timeout: 60_000, polling: 50 });
    await shot(p2, "timelapse_31s");
    await p2.waitForFunction((t) => window.__ride.time >= t + 41, t0, { timeout: 60_000, polling: 50 });
    await shot(p2, "timelapse_41s");
    const log = await p2.evaluate(() => window.__ride.fpsLog);
    console.log(`timelapse fps [${log.join(",")}] end=${await p2.evaluate(() => window.__ride.timeOfDay)}`);
    await p2.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `console errors:\n  ${[...new Set(errors)].slice(0, 30).join("\n  ")}` : "console errors: none");
if (errors.length) process.exitCode = 1;
