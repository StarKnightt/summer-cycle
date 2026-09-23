#!/usr/bin/env node
/**
 * Skirt/thigh check while riding: freezes the crank at 12 angles and captures her lap from the side,
 * front, 3/4 and chase cameras.
 *   node scripts/crank-sweep.mjs --url=http://localhost:5466/ --out=shots/face2-wip/sweep
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5466/");
const OUT = path.join(ROOT, arg("out", "shots/face2-wip/sweep"));
const W = 1920, H = 1080;
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error") errors.push(m.text());
  });
  const R = (fn, a) => page.evaluate(fn, a);
  await page.goto(`${URL}?autoplay=1&skipintro=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  /** Camera around her hips in the head's frame (az 0 = in front of her). */
  const lapView = (az, el, dist) =>
    R(([az, el, dist]) => {
      const r = window.__ride;
      const h = r.scene.getObjectByName("riderHead");
      h.updateWorldMatrix(true, false);
      const e = h.matrixWorld.elements;
      const n = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
      const X = n(e[0], 0, e[2]), F = n(-e[8], 0, -e[10]);
      const P = [e[12], e[13] - 0.62, e[14]];
      const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
      const d = [0, 1, 2].map((i) => (F[i] * ca + X[i] * sa) * ce + (i === 1 ? se : 0));
      const c = r.ctl;
      const eye = [0, 1, 2].map((i) => P[i] + d[i] * dist);
      r.view(eye[0] - c.x, eye[1], eye[2] - c.z, P[0] - c.x, P[1], P[2] - c.z);
      return P;
    }, [az, el, dist]);
  const views = [["side", Math.PI / 2, 0.08, 1.7], ["front", 0.05, 0.42, 1.7], ["q34", 0.75, 0.15, 1.8], ["chase", null]];
  for (const [name, az, el, dist] of views) {
    if (az === null) await R(() => window.__ride.setCam("tpp"));
    for (let k = 0; k < 12; k++) {
      await R(([a]) => { window.__ride.bike.crankHold = a; }, [(k / 12) * Math.PI * 2]);
      if (az !== null) await lapView(az, el, dist);
      await page.waitForTimeout(k === 0 ? 1500 : 140);
      if (az !== null) await lapView(az, el, dist);
      await page.waitForTimeout(60);
      let clip = { x: 510, y: 90, width: 900, height: 900 };
      if (az === null) {
        const h = await R(() => window.__ride.headScreen());
        clip = { x: Math.max(0, Math.min(W - 360, h.x - 180)), y: Math.max(0, Math.min(H - 360, h.y - 40)), width: 360, height: 360 };
      }
      await page.screenshot({ path: path.join(OUT, `${name}_${String(k).padStart(2, "0")}.png`), clip });
    }
    console.log(`sweep ${name}`);
  }
  await R(() => { window.__ride.bike.crankHold = null; });
} finally {
  console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "console: clean");
  await browser.close();
}
