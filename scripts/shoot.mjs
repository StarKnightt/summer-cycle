#!/usr/bin/env node
/**
 * Capture autoplay screenshots at 1920x1080 on the real GPU (ANGLE/D3D11), log FPS + console errors,
 * and run a scripted collision test.
 *   node scripts/shoot.mjs --url=http://localhost:5420/ --out=shots/iter-2 [--quick]
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
const OUT = path.join(ROOT, arg("out", "shots/iter-2"));
const QUICK = argv.includes("--quick");
const EXTRA = arg("extra", "");
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
    if (/warning X\d{4}/.test(txt)) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${txt}`);
  });
  await page.goto(`${URL}?autoplay=1${EXTRA ? "&" + EXTRA : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  await page.mouse.click(W / 2, H / 2);
  const t0 = await page.evaluate(() => window.__ride.time);
  const s0 = await page.evaluate(() => window.__ride.stats());
  console.log(`[gpu] ${s0.renderer}`);
  if (SOFTWARE.test(String(s0.renderer))) throw new Error(`software renderer: ${s0.renderer}`);
  const at = (x) => page.waitForFunction((y) => window.__ride.time >= y, t0 + x, { timeout: 120_000, polling: 30 });
  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    const s = await page.evaluate(() => window.__ride.stats());
    console.log(`${name.padEnd(12)} calls=${s.calls} (scene ${s.sceneCalls}) tris=${(s.triangles / 1e6).toFixed(2)}M fps=${s.fps} z=${s.z.toFixed(0)}`);
  };
  const cam = (m) => page.evaluate((mm) => window.__ride.setCam(mm), m);

  const plan = QUICK
    ? [[0.5, "first_0.5s"], [5, "t05s"], [5.5, "@houses"], [6.3, "@paddy"], [7.0, "@chase"], [12, "t12s"], [13, "@fpp"], [14, "fpp_a"], [14.2, "@tpp"]]
    : [
        [0.5, "first_0.5s"], [1, "first_1.0s"], [5, "t05s"],
        [5.6, "@houses"], [6.4, "@paddy"], [7.2, "@chase"],
        [10, "t10s"], [15, "t15s"], [20, "t20s"], [25, "t25s"], [30, "t30s"], [35, "t35s"], [40, "t40s"],
        [41, "@fpp"], [42, "fpp_a"], [46, "fpp_b"], [46.2, "@tpp"], [47.4, "fpp_back_tpp"],
      ];
  for (const [tt, name] of plan) {
    await at(tt);
    if (name.startsWith("@")) {
      const m = name.slice(1);
      await cam(m);
      if (m === "houses" || m === "paddy") {
        await page.waitForTimeout(250);
        await shot(`view_${m}`);
      }
      continue;
    }
    await shot(name);
  }
  await cam("closeup");
  await page.waitForTimeout(500);
  await shot("closeup");
  await cam("side");
  await page.waitForTimeout(500);
  await shot("side");
  const crop = async (name, w, h, dx = 0, dy = 0) => {
    const file = path.join(OUT, "crops", `${name}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, clip: { x: (W - w) / 2 + dx, y: (H - h) / 2 + dy, width: w, height: h } });
  };
  for (const [m, n] of [["face", "face_front"], ["faceside", "face_side"], ["back", "face_back"]]) {
    await cam(m);
    await page.waitForTimeout(400);
    await crop(n, 1000, 1000);
  }
  await cam("tpp");
  await page.waitForTimeout(1500);
  await crop("verge_right", 900, 600, 500, 200);
  await crop("road", 900, 500, 0, 290);
  await crop("rider_back", 500, 700, -200, 120);
  await crop("sky_clouds", 1920, 460, 0, -310);

  // Collision: manual mode against an in-rail obstacle on the right edge.
  const obs = await page.evaluate(() => window.__ride.obstacles());
  const target = obs.filter((o) => o.u > 2).sort((a, b) => b.z - a.z)[0];
  if (target) {
    const run = async (du, label, ms = 3500) => {
      await page.evaluate(([o, d]) => {
        window.__ride.setAutoplay(false);
        window.__ride.place(o.u + d, o.z + 10, 4.5);
      }, [target, du]);
      await page.waitForTimeout(ms);
      return page.evaluate(() => window.__ride.ctl);
    };
    // 1) Head-on: dead stop.
    let c = await run(-0.05, "headon");
    const stopOk = c.speed < 0.3 && c.z > target.z;
    console.log(`collision head-on: obstacle u=${target.u.toFixed(2)} z=${target.z.toFixed(1)} -> bike z=${c.z.toFixed(1)} speed=${c.speed.toFixed(2)} ${stopOk ? "PASS" : "FAIL"}`);
    await shot("collision_stop");
    // 2) Hold S: walks backward.
    await page.keyboard.down("KeyS");
    await page.waitForTimeout(1500);
    const cb = await page.evaluate(() => window.__ride.ctl);
    await page.keyboard.up("KeyS");
    console.log(`collision walk-back: z ${c.z.toFixed(2)} -> ${cb.z.toFixed(2)} speed=${cb.speed.toFixed(2)} ${cb.z > c.z + 0.5 ? "PASS" : "FAIL"}`);
    // 3) Glancing: slides past along the obstacle instead of stopping.
    await page.evaluate(([o]) => window.__ride.place(o.u - 0.62, o.z + 5, 4.5), [target]);
    await page.waitForTimeout(700);
    await shot("collision_slide");
    await page.waitForTimeout(1800);
    c = await page.evaluate(() => window.__ride.ctl);
    console.log(`collision glancing: bike z=${c.z.toFixed(1)} (obstacle ${target.z.toFixed(1)}) speed=${c.speed.toFixed(2)} ${c.z < target.z - 1 ? "PASS (slid past)" : "FAIL"}`);
  } else console.log("collision: no in-rail obstacle found");

  console.log(`audio: ${await page.evaluate(() => window.__ride.audio)}`);
  const log = await page.evaluate(() => window.__ride.fpsLog);
  const avg = log.length ? log.reduce((a, b) => a + b, 0) / log.length : 0;
  console.log(`fps log: ${log.join(",")}  avg=${avg.toFixed(1)} min=${Math.min(...log)}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("\nPage errors/warnings:");
  for (const e of [...new Set(errors)].slice(0, 40)) console.error("  " + e);
  process.exitCode = 1;
}
