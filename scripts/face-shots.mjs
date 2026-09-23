#!/usr/bin/env node
/**
 * Rider character sheet: head close-ups framed in the head's own frame (front / 3/4 / profile /
 * back), full-body on-foot views, walking, riding (chase, side, front cinematic), FPP, sunset/dusk.
 *   node scripts/face-shots.mjs --url=http://localhost:5463/ --out=shots/face-wip/it1 [--only=head,body,ride,dusk]
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
const URL = arg("url", "http://localhost:5463/");
const OUT = path.join(ROOT, arg("out", "shots/face-wip/latest"));
const ONLY = arg("only", "head,body,ride,dusk").split(",");
const W = 1920, H = 1080;

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
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  const R = (fn, a) => page.evaluate(fn, a);
  const wait = (ms) => page.waitForTimeout(ms);
  let FREE = true;
  const shot = async (name, clip) => {
    const file = path.join(OUT, `${name}.png`);
    if (clip === "head" || clip === "body") {
      const h = await R(() => window.__ride.headScreen());
      const cw = clip === "head" ? 720 : 900, ch = clip === "head" ? 720 : 1080;
      const cx = clip === "head" && !FREE ? W / 2 : h.x, cy = clip === "head" && !FREE ? H / 2 + ch * 0.05 : h.y;
      const x = Math.max(0, Math.min(W - cw, cx - cw / 2)), y = clip === "head" ? Math.max(0, Math.min(H - ch, cy - ch * 0.45)) : 0;
      await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch } });
    } else await page.screenshot({ path: file });
    console.log(`shot ${name}`);
  };
  /** Camera `dist` m from the head centre along (az around her up axis, 0 = in front; el up). */
  const headView = (az, el, dist, lookDy = 0, lookF = 0) =>
    R(([az, el, dist, lookDy, lookF]) => {
      const r = window.__ride;
      const h = r.scene.getObjectByName("riderHead");
      h.updateWorldMatrix(true, false);
      const e = h.matrixWorld.elements;
      const n = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
      const X = n(e[0], e[1], e[2]), Y = n(e[4], e[5], e[6]), F = n(-e[8], -e[9], -e[10]);
      const P = [0, 1, 2].map((i) => [e[12], e[13], e[14]][i] + F[i] * lookF);
      const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
      const d = [0, 1, 2].map((i) => (F[i] * ca + X[i] * sa) * ce + Y[i] * se);
      const c = r.ctl;
      const eye = [0, 1, 2].map((i) => P[i] + d[i] * dist);
      r.view(eye[0] - c.x, eye[1], eye[2] - c.z, P[0] - c.x, P[1] + lookDy, P[2] - c.z);
    }, [az, el, dist, lookDy, lookF]);

  await page.goto(`${URL}?autoplay=1&skipintro=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  await page.mouse.click(W / 2, H / 2);
  await wait(2500);

  if (ONLY.includes("ride")) {
    await R(() => window.__ride.setCam("tpp"));
    await wait(1500);
    await shot("ride_chase");
    await R(() => window.__ride.setCam("side"));
    await wait(1500);
    await shot("ride_side");
    await R(() => window.__ride.setCam("front"));
    await wait(1800);
    await shot("ride_front_cinematic");
    await shot("ride_front_cinematic_face", "head");
    await R(() => window.__ride.setCam("fpp"));
    await wait(2000);
    await shot("ride_fpp");
    await R(() => window.__ride.setCam("tpp"));
    await wait(800);
  }

  // Park for the close-ups (bike stopped, she sits and looks ahead).
  const park = async () => {
    await R(() => {
      const r = window.__ride;
      r.setAutoplay(false);
      r.place(r.ctl.u, r.ctl.z, 0);
    });
    await wait(1500);
  };
  const heads = async (sfx) => {
    FREE = false;
    for (const [name, az, el, dist, lf = 0, ly = -0.02] of (process.env.FRONTONLY ? [["front", 0, 0.02, 0.62]] : [["front", 0, 0.02, 0.7, 0.0, 0.015], ["q34", 0.7, 0.03, 0.72, 0.02, 0.015], ["profile", Math.PI / 2, 0.0, 0.74, 0.07, 0.015], ["back", Math.PI * 0.85, 0.12, 0.8]])) {
      await headView(az, el, dist, ly, lf);
      await wait(1600);
      await headView(az, el, dist, ly, lf);
      await wait(250);
      await shot(`head_${name}${sfx}`, "head");
    }
    FREE = true;
  };
  if (process.env.HIDE)
    await R((what) => {
      const h = window.__ride.scene.getObjectByName("riderHead");
      h.children.forEach((c, i) => {
        if (what === "fringe" && c.type === "Group" && c.children.length === 1) c.visible = false;
        if (what.startsWith("idx:") && what.slice(4).split("-").map(Number).includes(i)) c.visible = false;
      });
      return h.children.map((c, i) => `${i}:${c.type}:${c.children.length}`).join(" ");
    }, process.env.HIDE).then((s) => console.log(s));
  if (ONLY.includes("head")) {
    await park();
    await heads("");
  }
  if (ONLY.includes("dusk")) {
    await park();
    for (const p of ["sunset", "dusk"]) {
      await R((pp) => window.__ride.setTime(pp, true), p);
      await wait(600);
      await headView(0.35, 0.02, 0.7, -0.02);
      await wait(1600);
      await shot(`head_${p}`, "head");
    }
    await R(() => window.__ride.setTime("afternoon", true));
  }

  if (ONLY.includes("body")) {
    await R(() => {
      window.__ride.setAutoplay(true);
      window.__ride.setCam("tpp");
    });
    await wait(2500);
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 10000 });
    await R(() => window.__ride.explore.lookAround(false));
    await R(() => window.__ride.explore.walk(0, -1, false));
    await wait(2600);
    await R(() => window.__ride.explore.walk(0, 0));
    await wait(1800);
    for (const [name, rel] of [["front", Math.PI], ["q34", Math.PI - 0.75], ["side", Math.PI / 2], ["back", 0.15]]) {
      await R(([a]) => window.__ride.explore.orbit(a, 0.02, 4.3), [rel]);
      await wait(1400);
      await shot(`body_${name}`, "body");
    }
    await R(() => window.__ride.explore.walk(0, -1, false));
    await wait(1200);
    await R(() => window.__ride.explore.orbit(0.2, 0.2, 3.4));
    await wait(1200);
    await shot("walk_back", "body");
    await R(() => window.__ride.explore.orbit(Math.PI / 2 + 0.3, 0.06, 3.2));
    await wait(1000);
    for (let i = 0; i < 2; i++) {
      await shot(`walk_side_${i}`, "body");
      await wait(270);
    }
    await R(() => window.__ride.explore.orbit(Math.PI - 0.5, 0.06, 3.2));
    await wait(1000);
    await shot("walk_front", "body");
    await R(() => window.__ride.explore.walk(0, 0));
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.log(`console errors (${errors.length}):\n` + errors.slice(0, 20).join("\n"));
  process.exitCode = 1;
} else console.log("console: clean");
