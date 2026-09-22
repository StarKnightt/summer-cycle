#!/usr/bin/env node
/**
 * Capture autoplay screenshots at 1920x1080 on the real GPU (ANGLE/D3D11), log FPS + console errors.
 *   node scripts/shoot.mjs --url=http://localhost:5420/ --out=shots/iter-1 --times=1,5,12,20,30
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const URL = arg("url", "http://localhost:5420/");
const OUT = path.join(ROOT, arg("out", "shots/iter-1"));
const TIMES = arg("times", "1,5,12,20,30").split(",").map(Number);
const EXTRA = arg("extra", "");
const PREFIX = arg("prefix", "");
const W = 1920, H = 1080;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const txt = m.text();
    // ANGLE/HLSL compiler chatter (X3595/X4000) is informational, not a runtime error.
    if (/warning X\d{4}/.test(txt)) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${txt}`);
  });
  await page.goto(`${URL}?autoplay=1${EXTRA ? "&" + EXTRA : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  // A click starts the Web Audio graph (exercises the synth path for errors).
  await page.mouse.click(W / 2, H / 2);
  const t0 = await page.evaluate(() => window.__ride.time);
  const s0 = await page.evaluate(() => window.__ride.stats());
  console.log(`[gpu] ${s0.renderer}`);
  if (SOFTWARE.test(String(s0.renderer))) throw new Error(`software renderer: ${s0.renderer}`);
  for (const ts of TIMES) {
    await page.waitForFunction((x) => window.__ride.time >= x, t0 + ts, { timeout: 120_000, polling: 50 });
    const file = path.join(OUT, `${PREFIX}t${String(ts).padStart(2, "0")}s.png`);
    await page.screenshot({ path: file });
    const s = await page.evaluate(() => window.__ride.stats());
    console.log(`t=${ts}s  ${path.relative(ROOT, file)}  calls=${s.calls} tris=${s.triangles} fps=${s.fps} speed=${s.speed.toFixed(1)} z=${s.z.toFixed(0)}`);
  }
  // Close-up of the bike (wheels, crank, rider).
  await page.evaluate(() => window.__ride.setCam("closeup"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}closeup.png`) });
  await page.evaluate(() => window.__ride.setCam("side"));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${PREFIX}side.png`) });
  console.log(`audio: ${await page.evaluate(() => window.__ride.audio)}`);
  const log = await page.evaluate(() => window.__ride.fpsLog);
  const avg = log.length ? log.reduce((a, b) => a + b, 0) / log.length : 0;
  console.log(`fps log: ${log.join(",")}  avg=${avg.toFixed(1)}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("\nPage errors/warnings:");
  for (const e of [...new Set(errors)].slice(0, 40)) console.error("  " + e);
  process.exitCode = 1;
}
