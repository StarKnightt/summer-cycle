/**
 * Fixed detail framings (houses, near bush, verge flowers, rice, road, clouds) + a burst of consecutive
 * frames riding slowly past the houses (for shimmer / jitter checks).
 *   node scripts/detail-shots.mjs --url=http://localhost:5420/ --out=shots/iter-6/detail [--extra=kuwahara=0]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5420/");
const OUT = path.join(ROOT, arg("out", "shots/iter-6/detail"));
const EXTRA = arg("extra", "");
const ONLY = arg("only", "");

// name: rider (u, z); eye / look as [u relative to road centre at z+dz, y, dz].
const VIEWS = [
  { name: "house_close", u: 1.6, z: -45, eye: [1.2, 1.55, 0], look: [8.5, 2.6, -8] },
  { name: "house_front", u: 2.2, z: -60, eye: [2.0, 1.6, 0], look: [9.0, 2.4, 6] },
  { name: "bush_near", u: 2.6, z: -30, eye: [3.0, 1.2, 0], look: [7.0, 0.9, -4.5] },
  { name: "verge_flowers", u: 2.0, z: -110, eye: [2.3, 0.75, 0], look: [5.2, 0.35, -3.2] },
  { name: "rice", u: -1.5, z: -150, eye: [-3.4, 1.25, 0], look: [-12, -0.2, -9] },
  { name: "road", u: 0.2, z: -130, eye: [0.6, 1.3, 0], look: [0.4, 0.0, -5] },
  { name: "tree_canopy", u: -2.0, z: -22, eye: [-2.4, 1.4, 0], look: [-5.3, 3.8, -4] },
  { name: "shop_wide", u: 0.8, z: -90, eye: [0.2, 1.6, 0], look: [5.5, 2.0, -16] },
  { name: "shop_close", u: 2.2, z: -98, eye: [2.0, 1.55, 0], look: [6.5, 1.7, -6] },
  { name: "ramen_close", u: 2.3, z: -116, eye: [2.2, 1.55, 0], look: [6.5, 1.8, -6.5] },
  { name: "shrine", u: -1.0, z: -189, eye: [-0.2, 1.7, 3], look: [7.0, 2.4, -11] },
  { name: "hamlet", u: 1.4, z: -229, eye: [1.2, 1.6, 0], look: [5.5, 1.3, -8] },
  { name: "house_detail", u: 2.4, z: -60, eye: [3.0, 1.9, 0], look: [8.5, 3.6, -5] },
  { name: "basket", u: 0.2, z: -150, eye: [0.55, 1.28, -1.45], look: [0.0, 0.98, -0.62] },
  { name: "verge_ride", u: 2.5, z: -160, eye: [1.8, 1.5, 3.5], look: [3.0, 0.8, -6] },
  { name: "far_left", u: -2.2, z: -200, eye: [-3.2, 2.2, 0], look: [-120, 4, -80] },
  { name: "far_school", u: -2.2, z: -180, eye: [-3.2, 2.4, 0], look: [-200, 6, -80] },
  { name: "far_right", u: 2.2, z: -250, eye: [2.6, 1.9, 0], look: [120, 18, -90] },
  { name: "sky_clouds", u: 0, z: -90, eye: [0, 1.5, 0], look: [-8, 14, -30] },
];

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${URL}?skipintro=1&nohud=1${EXTRA ? "&" + EXTRA : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(800);
  const frame = (v, speed = 0) =>
    page.evaluate(
      ({ v, speed }) => {
        const r = window.__ride;
        r.setAutoplay(false);
        r.place(v.u, v.z, speed);
        const rx = r.roadX(v.z) + v.u;
        const ez = v.z + v.eye[2], lz = v.z + v.look[2];
        r.view(r.roadX(ez) + v.eye[0] - rx, v.eye[1], ez - v.z, r.roadX(lz) + v.look[0] - rx, v.look[1], lz - v.z);
      },
      { v, speed },
    );
  for (const v of VIEWS) {
    if (ONLY && !ONLY.split(",").includes(v.name)) continue;
    await frame(v);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${v.name}.png`) });
    console.log(`${v.name.padEnd(14)} fps=${await page.evaluate(() => Math.round(window.__ride.fps))}`);
  }
  if (!ONLY || ONLY.includes("burst")) {
    // Slow roll past the shop with a camera locked to the rider: static detail should hold still.
    await frame({ u: 1.8, z: -44, eye: [1.4, 1.5, 0], look: [8.5, 2.4, -7] }, 0.8);
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) {
      await page.screenshot({ path: path.join(OUT, `burst_${i}.png`), clip: { x: 960, y: 220, width: 900, height: 560 } });
      await page.waitForTimeout(60);
    }
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
