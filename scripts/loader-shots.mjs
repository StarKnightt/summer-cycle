/**
 * Capture the intro loader on the real GPU: early, mid-build, ready prompt, mid-dissolve, first ride frame.
 *   node scripts/loader-shots.mjs --url=http://localhost:5420/ --out=shots/loader [--only=live_loader] [--small]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5420/");
const OUT = path.join(ROOT, arg("out", "shots/loader"));
const ONLY = arg("only", "");
const SMALL = argv.includes("--small");
const [W, H] = SMALL ? [1366, 768] : [1920, 1080];

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=user-gesture-required"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const progress = () => page.evaluate(() => window.__loader?.progress ?? 0).catch(() => -1);
  const t0 = Date.now();
  await page.goto(`${URL}?autoplay=1`, { waitUntil: "commit" });
  const samples = [];
  const sampler = setInterval(async () => samples.push(await progress()), 150);
  if (ONLY) {
    await page.waitForTimeout(2500);
    await shot(ONLY);
  } else {
    await page.waitForTimeout(1000);
    await shot(SMALL ? "small_1s" : "loader_1s");
    if (!SMALL) {
      await page.waitForTimeout(4000);
      await shot("loader_5s");
    }
  }
  await page.waitForFunction(() => window.__ride?.waiting === true, null, { timeout: 120_000, polling: 50 });
  const loadMs = Date.now() - t0;
  clearInterval(sampler);
  await page.waitForTimeout(1600);
  if (!ONLY) await shot(SMALL ? "small_ready" : "loader_ready");
  const boot = await page.evaluate(() => window.__ride.bootLog);
  await page.mouse.click(W / 2, H / 2);
  if (!ONLY && !SMALL) {
    await page.waitForTimeout(480);
    await shot("loader_dissolve");
    await page.waitForFunction(() => !document.getElementById("loader") && window.__ride.time >= 1.3, null, { timeout: 10_000, polling: 20 });
    await shot("first_frame");
  }
  await page.waitForTimeout(ONLY || SMALL ? 1500 : 6000);
  const res = await page.evaluate(() => ({ audio: window.__ride.audio, fps: window.__ride.fpsLog.slice(-5), loaderGone: !document.getElementById("loader") }));
  const mono = samples.filter((v) => v >= 0).every((v, i, a) => i === 0 || v >= a[i - 1]);
  console.log(`load ${loadMs} ms (wall, to prompt); steps: ${boot.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`progress samples monotonic=${mono} [${samples.map((v) => v.toFixed(2)).join(" ")}]`);
  console.log(`after click: audio=${res.audio} loaderGone=${res.loaderGone} fps=${res.fps.join(",")}`);
} finally {
  await browser.close();
}
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
