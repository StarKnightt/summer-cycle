#!/usr/bin/env node
/**
 * A/B autoplay FPS at 1920x1080 on the real GPU, interleaving runs so shared-GPU load drifts evenly.
 *   node scripts/fps-ab.mjs "A=http://localhost:5461/?" "B=http://localhost:5460/?time=sunset&" [--secs=15] [--rounds=2]
 */
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const SECS = Number(arg("secs", 15));
const ROUNDS = Number(arg("rounds", 2));
const targets = argv.filter((a) => !a.startsWith("--")).map((a) => a.split(/=(.*)/s).slice(0, 2));
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const res = Object.fromEntries(targets.map(([k]) => [k, []]));
const errors = [];
try {
  for (let r = 0; r < ROUNDS; r++)
    for (const [name, url] of targets) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
      await page.goto(`${url}autoplay=1&skipintro=1&nohud=1`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__ride?.ready === true && window.__ride.time > 3, null, { timeout: 120_000 });
      const n0 = await page.evaluate(() => window.__ride.fpsLog.length);
      await page.waitForTimeout(SECS * 1000);
      const log = await page.evaluate((n) => window.__ride.fpsLog.slice(n), n0);
      res[name].push(...log);
      console.log(`${name.padEnd(10)} round ${r}: [${log.join(",")}]`);
      await page.close();
    }
} finally {
  await browser.close();
}
for (const [k, v] of Object.entries(res)) {
  const s = [...v].sort((a, b) => a - b);
  console.log(`${k.padEnd(10)} avg=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} median=${s[s.length >> 1]} min=${s[0]}`);
}
console.log(errors.length ? `errors:\n  ${errors.join("\n  ")}` : "errors: none");
