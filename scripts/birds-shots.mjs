/**
 * Birds: a flock + the kite in the sky, and perched sparrows on the wires scattering as the bike
 * rides up (sequence of frames from a camera that watches the span).
 *   node scripts/birds-shots.mjs --url=http://localhost:5440/ --out=shots/iter-7
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5440/");
const OUT = path.join(ROOT, arg("out", "shots/iter-7"));
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${URL}?autoplay=1&skipintro=1&nohud=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  // Sky: aim at the nearest flock, framing the kite if it is near that direction.
  await page.evaluate(() => {
    const r = window.__ride, c = r.ctl, info = r.birds.info();
    let best = info.flocks[0], bd = 1e9;
    for (const f of info.flocks) {
      const d = Math.hypot(f[0] - c.x, f[2] - c.z);
      if (d < bd) (bd = d), (best = f);
    }
    r.view(0, 1.6, 2.5, best[0] - c.x, best[1] - 8, best[2] - c.z);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "birds_flock.png") });
  await page.evaluate(() => {
    const r = window.__ride, c = r.ctl, k = r.birds.info().kite;
    r.view(0, 1.6, 2.5, k[0] - c.x, 60, k[2] - c.z);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "birds_kite.png") });
  // Swallows over the paddy (left, low).
  await page.evaluate(() => window.__ride.view(-1.5, 1.4, 1.5, -12, 0.8, -12));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "birds_swallows.png") });

  // Perched: pick the nearest stocked bird ahead, place the bike 45 m before it, ride up with a
  // camera fixed beside the road watching the wire.
  const target = await page.evaluate(() => {
    const r = window.__ride, c = r.ctl, p = r.birds.info().perched;
    p.sort((a, b) => b[2] - a[2]);
    return p.find((q) => q[2] < c.z - 20) ?? p[0];
  });
  console.log("perch target", target?.map((v) => v.toFixed(1)).join(","));
  if (target) {
    await page.evaluate((t) => {
      const r = window.__ride;
      r.setAutoplay(false);
      r.place(-0.8, t[2] + 40, 6.5);
      r.setAutoplay(true);
    }, target);
    for (let i = 0; i < 6; i++) {
      await page.evaluate((t) => {
        const r = window.__ride, c = r.ctl;
        // A fixed world camera 18 m before the span, eye low, looking at the perch.
        const ex = r.roadX(t[2] + 16) - 1.5, ez = t[2] + 16;
        r.view(ex - c.x, 2.0, ez - c.z, t[0] - c.x, t[1] - 0.6, t[2] - c.z);
      }, target);
      const d = await page.evaluate((t) => { const c = window.__ride.ctl; return Math.hypot(c.x - t[0], c.z - t[2]); }, target);
      const info = await page.evaluate(() => window.__ride.birds.info());
      console.log(`frame ${i}: bike ${d.toFixed(1)} m from perch, perched=${info.perched.length} flying=${info.flying}`);
      if (i === 1 || i === 3 || i === 5) await page.screenshot({ path: path.join(OUT, `birds_perch_${i}.png`) });
      await page.waitForTimeout(1100);
    }
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
