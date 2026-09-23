#!/usr/bin/env node
/**
 * On-foot / cinematic-camera verification: screenshots at 1920x1080 on the real GPU, collision,
 * remount and chunk-streaming checks, console errors and FPS.
 *   node scripts/explore.mjs --url=http://localhost:5450/ --out=shots/explore [--only=front,walk]
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
const URL = arg("url", "http://localhost:5450/");
const OUT = path.join(ROOT, arg("out", "shots/explore"));
const ONLY = arg("only", "").split(",").filter(Boolean);
const W = 1920, H = 1080;

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
const errors = [];
const results = [];
const ok = (name, pass, detail) => {
  results.push(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const txt = m.text();
    if (/warning X\d{4}/.test(txt)) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${txt}`);
  });
  const R = (fn, a) => page.evaluate(fn, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = async (name, crop) => {
    const file = path.join(OUT, `${name}.png`);
    if (crop === "face") {
      const h = await R(() => window.__ride.headScreen());
      const cw = 600, ch = 600;
      const x = Math.max(0, Math.min(W - cw, h.x - cw / 2)), y = Math.max(0, Math.min(H - ch, h.y - ch * 0.42));
      await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch } });
    } else await page.screenshot({ path: file });
    const s = await R(() => window.__ride.stats());
    console.log(`shot ${name.padEnd(22)} fps=${s.fps} calls=${s.calls} tris=${(s.triangles / 1e6).toFixed(2)}M`);
  };
  const state = () => R(() => window.__ride.explore.state);
  const want = (k) => !ONLY.length || ONLY.includes(k);

  await page.goto(`${URL}?autoplay=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  await page.mouse.click(W / 2, H / 2);
  const s0 = await R(() => window.__ride.stats());
  console.log(`[gpu] ${s0.renderer}`);
  await wait(2500);

  if (ONLY.includes("fps")) {
    // Steady-state FPS, no screenshots: chase ride, front cinematic, then walking on foot.
    const avgOf = async (secs) => {
      const n0 = (await R(() => window.__ride.fpsLog.length));
      await wait(secs * 1000);
      const l = (await R(() => window.__ride.fpsLog)).slice(n0 + 1);
      return { avg: l.reduce((a, b) => a + b, 0) / Math.max(1, l.length), min: Math.min(...l), l };
    };
    const a = await avgOf(12);
    ok("fps chase ride", a.avg >= 90, `avg ${a.avg.toFixed(1)} min ${a.min} [${a.l.join(",")}]`);
    await R(() => window.__ride.cycleCam());
    const b = await avgOf(10);
    ok("fps front cinematic", b.avg >= 90, `avg ${b.avg.toFixed(1)} min ${b.min} [${b.l.join(",")}]`);
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    await R(() => window.__ride.explore.walk(0, -1, false));
    const c = await avgOf(12);
    ok("fps walking", c.avg >= 90, `avg ${c.avg.toFixed(1)} min ${c.min} [${c.l.join(",")}]`);
    await R(() => window.__ride.explore.walk(0, 0));
  }

  if (ONLY.includes("face")) {
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    await R(() => window.__ride.explore.lookAround(false));
    for (const [n, rel, d] of [["face_front", Math.PI, 1.5], ["face_34", Math.PI - 0.65, 1.5], ["face_profile", Math.PI / 2 + 0.05, 1.5]]) {
      await R(([a, b]) => window.__ride.explore.orbit(a, 0.02, b), [rel, d]);
      await wait(700);
      await shot(`dbg_${n}`, "face");
    }
  }

  if (want("front")) {
    await R(() => window.__ride.cycleCam());
    await wait(2600);
    await shot("01_front_cinematic");
    await shot("01b_front_face_crop", "face");
    await R(() => window.__ride.cycleCam());
    await wait(2600);
    await shot("02_side_cinematic");
    await R(() => window.__ride.cycleCam());
    await wait(2400);
    ok("C cycle back to chase", (await R(() => window.__ride.camMode)) === "chase", await R(() => window.__ride.camMode));
  }

  if (want("dismount")) {
    // Front shot, then F: auto-brake, step off; orbit picks up from the front camera.
    await R(() => window.__ride.cycleCam());
    await wait(2200);
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "dismount", null, { timeout: 8000 });
    await R(() => window.__ride.explore.orbit(-1.9, 0.12, 3.2));
    await wait(520);
    await shot("03a_dismount_mid");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    const st = await state();
    ok("dismount -> walk", st.mode === "walk", `bikeDist=${st.bikeDist.toFixed(2)}`);
    await R(() => window.__ride.explore.lookAround(false));
    await R(() => window.__ride.explore.orbit(2.35, 0.12, 3.6));
    await wait(900);
    await shot("03_parked_bike");
    await R(() => window.__ride.explore.orbit(Math.PI - 0.7, 0.05, 1.9));
    await wait(900);
    await shot("04_face_34_on_foot");
    await shot("04b_face_34_crop", "face");
    await R(() => window.__ride.explore.orbit(Math.PI / 2, 0.02, 1.7));
    await wait(900);
    await shot("05_profile_glasses_crop", "face");
    await R(() => window.__ride.explore.lookAround(true));
    // Remount.
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "ride", null, { timeout: 8000 });
    await wait(400);
    await shot("06_remount");
    await wait(2500);
    const c = await R(() => window.__ride.ctl);
    ok("remount rides on", c.speed > 1, `speed=${c.speed.toFixed(2)}`);
  }

  if (want("walk")) {
    // Stop, get off, walk to the village and test house collision.
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    await R(() => window.__ride.explore.teleport(4.2, -47));
    await wait(300);
    const hz = -53;
    // Walk straight toward the shop house (u ≈ 6.4 + 3.3, z -53) and see that she stops at the wall.
    const tgt = await R(([z]) => {
      const s = window.__ride.explore.state;
      return { dx: 0, dz: z - s.z };
    }, [hz]);
    await R(() => window.__ride.explore.orbit(0.9, 0.2, 4.2));
    await R(() => {
      const s = window.__ride.explore.state;
      // aim at the house centre
      const hx = s.x + (9.7 - s.u), hz = -53;
      const l = Math.hypot(hx - s.x, hz - s.z);
      window.__ride.explore.walk((hx - s.x) / l, (hz - s.z) / l, false);
    });
    await wait(2200);
    await shot("07_walking_near_houses");
    let inside = false;
    for (let i = 0; i < 45; i++) {
      await wait(100);
      inside ||= (await state()).inHouse;
    }
    const st = await state();
    ok("house blocks walker", !inside, `stopped at u=${st.u.toFixed(2)} z=${st.z.toFixed(2)} speed=${st.speed.toFixed(2)}`);
    void tgt;
    // Pole: stand in line with a roadside pole (u 3.95, z -12) and walk straight into it.
    await R(() => window.__ride.explore.walk(0, 0));
    await R(() => window.__ride.explore.teleport(3.95, -8, 0));
    await R(() => window.__ride.explore.walk(0, -1, false));
    let minD = 1e9;
    for (let i = 0; i < 40; i++) {
      await wait(100);
      const s = await state();
      minD = Math.min(minD, Math.hypot(s.u - 3.95, s.z + 12));
    }
    ok("pole blocks walker", minD > 0.45, `closest approach to pole centre ${minD.toFixed(2)} m (collider 0.30 + body 0.24)`);
    await R(() => window.__ride.explore.walk(0, 0));
  }

  if (want("paddy")) {
    // Run along the first paddy bank (u = -4.9), then check she can't step into the water.
    await R(() => window.__ride.explore.teleport(-4.9, -130, 0));
    await R(() => window.__ride.explore.orbit(-2.3, 0.18, 3.8));
    await R(() => window.__ride.explore.walk(0, -1, true));
    await wait(1800);
    await shot("08_running_paddy_bank");
    await R(() => window.__ride.explore.walk(-1, 0, false));
    await wait(2500);
    const st = await state();
    ok("paddy water blocks walker", st.u > -5.45, `u=${st.u.toFixed(2)} y=${st.y.toFixed(2)}`);
    await R(() => window.__ride.explore.walk(0, 0));
  }

  if (want("stream")) {
    // Walk 140 m down the road: chunks stream with her, the far bike is hidden, F summons it.
    await R(() => window.__ride.explore.teleport(-0.6, -200, 0));
    const t0 = Date.now();
    await R(() => window.__ride.explore.walk(0, -1, true));
    await page.waitForFunction(() => window.__ride.explore.state.z < -330, null, { timeout: 90_000, polling: 200 });
    await R(() => window.__ride.explore.walk(0, 0));
    await wait(600);
    const st = await state();
    await R(() => window.__ride.explore.orbit(0.4, 0.3, 5));
    await wait(700);
    await shot("09_walked_far_chunks");
    ok("walked 130 m+ with streaming", st.z < -330, `z=${st.z.toFixed(1)} bikeDist=${st.bikeDist.toFixed(0)} bikeVisible=${st.bikeVisible} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    await page.keyboard.press("KeyF");
    await wait(400);
    const s2 = await state();
    ok("F far away summons the bike", s2.bikeDist < 3, `bikeDist=${s2.bikeDist.toFixed(2)} mode=${s2.mode}`);
    await page.waitForFunction(() => window.__ride.explore.state.mode === "ride", null, { timeout: 8000 }).catch(() => {});
    ok("remount after summon", (await state()).mode === "ride", (await state()).mode);
    await wait(3000);
    await shot("10_riding_after_summon");
  }

  const log = await R(() => window.__ride.fpsLog);
  const tail = log.slice(-20);
  const avg = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
  console.log(`fps (last 20 s): ${tail.join(",")} avg=${avg.toFixed(1)} min=${Math.min(...tail)}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("\nPage errors/warnings:");
  for (const e of [...new Set(errors)].slice(0, 40)) console.error("  " + e);
  process.exitCode = 1;
} else console.log("console: clean");
