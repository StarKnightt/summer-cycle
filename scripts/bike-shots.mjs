/**
 * Bicycle close-ups: side, 3/4 front, rear, FPP, chase, parked on the kickstand, and a burst of
 * consecutive frames at speed (spoke shimmer / blur check). Camera offsets are in bike-local space.
 *   node scripts/bike-shots.mjs --url=http://localhost:5470/ --out=shots/bike [--only=side,burst]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5470/");
const OUT = path.join(ROOT, arg("out", "shots/bike"));
const ONLY = arg("only", "");
const Z = Number(arg("z", "-60"));
const want = (n) => !ONLY || ONLY.split(",").includes(n);

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${URL}?skipintro=1&nohud=1&msaa=4`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(600);
  // Bike-local eye/look → world offsets from the rider (yaw about +Y, forward = -Z).
  const view = (eye, look, speed = 0, u = 0.9, z = Z, auto = speed > 0) =>
    page.evaluate(
      ({ eye, look, speed, u, z, auto }) => {
        const r = window.__ride;
        r.setAutoplay(auto);
        r.place(u, z, speed);
        const yaw = r.ctl.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
        const w = ([x, y, zz]) => [x * c + zz * s, y, -x * s + zz * c];
        const e = w(eye), l = w(look);
        r.view(e[0], e[1], e[2], l[0], l[1], l[2]);
      },
      { eye, look, speed, u, z, auto },
    );
  const shot = async (name, clip) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
    console.log(`${name.padEnd(12)} fps=${await page.evaluate(() => Math.round(window.__ride.fps))}`);
  };

  if (want("side")) {
    await view([1.75, 0.72, 0.0], [0, 0.6, 0.0]);
    await page.waitForTimeout(700);
    await shot("side");
  }
  if (want("front")) {
    await view([1.25, 1.15, -1.75], [0, 0.68, -0.15]);
    await page.waitForTimeout(700);
    await shot("front34");
  }
  if (want("lamp")) {
    await view([-0.75, 0.62, -1.3], [-0.05, 0.62, -0.5]);
    await page.evaluate(() => window.__ride.setTime("dusk", true));
    await page.waitForTimeout(700);
    await shot("lamp_on");
    await page.evaluate(() => window.__ride.setTime("afternoon", true));
  }
  if (want("rear")) {
    await view([-0.9, 1.05, 1.95], [0, 0.6, 0.15]);
    await page.waitForTimeout(700);
    await shot("rear34");
  }
  if (want("detail")) {
    await view([0.55, 1.35, -1.05], [0, 0.85, -0.45]);
    await page.waitForTimeout(700);
    await shot("bars_basket");
    await view([0.75, 0.55, 0.35], [0, 0.4, 0.28]);
    await page.waitForTimeout(700);
    await shot("crank_case");
    await view([-0.5, 1.28, -0.52], [-0.2, 1.06, -0.24]);
    await page.evaluate(() => window.__ride.bike.ringBell());
    await page.waitForTimeout(90);
    await shot("bell");
    await view([0.45, 1.1, 0.75], [0, 0.86, 0.3]);
    await page.waitForTimeout(700);
    await shot("saddle_rack");
  }
  if (want("fpp")) {
    await page.evaluate(() => {
      const r = window.__ride;
      r.setAutoplay(false);
      r.place(0.9, -60, 0);
      r.setCam("fpp");
      r.bike.ringBell();
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__ride.bike.ringBell());
    await page.waitForTimeout(60);
    await shot("fpp");
    await page.evaluate(() => window.__ride.setTime("dusk", true));
    await page.waitForTimeout(500);
    await shot("fpp_lamp");
    await page.evaluate(() => window.__ride.setTime("afternoon", true));
  }
  if (want("chase")) {
    await page.evaluate(() => {
      const r = window.__ride;
      r.place(0.9, -40, 5);
      r.setAutoplay(true);
      r.setCam("tpp");
    });
    await page.waitForTimeout(2500);
    await shot("chase");
  }
  if (want("burst")) {
    // Rolling at ~20 km/h, camera locked to the bike: consecutive frames.
    await view([1.6, 0.62, 0.35], [0, 0.45, 0.2], 5.5, 0.9, -80);
    await page.waitForTimeout(1500);
    for (let i = 0; i < 4; i++) await shot(`burst_fast_${i}`, { x: 330, y: 250, width: 940, height: 560 });
    await view([1.6, 0.62, 0.35], [0, 0.45, 0.2], 0.8, 0.9, -80, false);
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) {
      // The controller drifts back to cruise; hold the slow roll.
      await page.evaluate(() => (window.__ride.ctl.speed = 0.8));
      await page.waitForTimeout(120);
      await shot(`burst_slow_${i}`, { x: 330, y: 250, width: 940, height: 560 });
    }
  }
  if (want("parked")) {
    await page.evaluate(() => {
      const r = window.__ride;
      r.setAutoplay(false);
      r.place(0.9, -60, 0);
      r.setCam("tpp");
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__ride.explore.pressF());
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.__ride.explore.walk(-1, 0));
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__ride.explore.walk(0, 0));
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const r = window.__ride;
      const yaw = r.ctl.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
      const w = ([x, y, zz]) => [x * c + zz * s, y, -x * s + zz * c];
      const e = w([1.55, 1.0, -1.1]), l = w([0, 0.55, 0.05]);
      r.view(e[0], e[1], e[2], l[0], l[1], l[2]);
    });
    await page.waitForTimeout(800);
    await shot("parked");
  }
  const st = await page.evaluate(() => {
    const r = window.__ride;
    let meshes = 0, tris = 0;
    const g = r.bike.group;
    g.traverseVisible((o) => {
      if (o.isMesh && o.userData.bike) {
        meshes++;
        const gi = o.geometry.index;
        tris += (gi ? gi.count : o.geometry.attributes.position.count) / 3;
      }
    });
    return { bikeMeshes: meshes, bikeTris: Math.round(tris), ...r.stats() };
  });
  console.log(JSON.stringify(st));
} finally {
  await browser.close();
}
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
