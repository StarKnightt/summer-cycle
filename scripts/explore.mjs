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

  await page.goto(`${URL}?autoplay=1&skipintro=1${process.env.EXPLORE_QS ?? ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
  await page.mouse.click(W / 2, H / 2);
  const s0 = await R(() => window.__ride.stats());
  console.log(`[gpu] ${s0.renderer}`);
  await wait(2500);
  {
    // Autoplay keeps its scripted camera: the start click must not capture the mouse or enable look.
    const lk = await R(() => window.__ride.look);
    ok("autoplay ignores mouse look", !lk.enabled && !lk.locked, JSON.stringify(lk));
  }

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

  if (want("mouse")) {
    // Mouse look while riding: chase orbit, pitch clamp, idle ease-back; FPP head turn; C cams ignore it.
    await R(() => window.__ride.setCam("tpp"));
    await wait(1500);
    await R(() => window.__ride.mouseLook(300, 0));
    await wait(400);
    let lk = await R(() => window.__ride.look);
    await shot("mouse_chase_orbit_right");
    ok("mouse orbits chase cam", lk.yaw < -1.1, `yaw=${lk.yaw.toFixed(2)}`);
    await R(() => window.__ride.mouseLook(-900, 0));
    await wait(400);
    lk = await R(() => window.__ride.look);
    await shot("mouse_chase_orbit_front");
    ok("chase yaw clamped to ±150°", Math.abs(lk.yaw) <= 2.62 + 1e-3 && lk.yaw > 2.3, `yaw=${lk.yaw.toFixed(2)}`);
    await R(() => window.__ride.mouseLook(0, 900));
    await wait(400);
    lk = await R(() => window.__ride.look);
    await shot("mouse_chase_pitch_top");
    ok("chase pitch clamped", lk.pitch <= 0.96 - 0.07 + 1e-3, `pitch=${lk.pitch.toFixed(2)}`);
    await wait(4500);
    lk = await R(() => window.__ride.look);
    ok("chase eases back behind her when idle", Math.abs(lk.yaw) < 0.25 && Math.abs(lk.pitch) < 0.15, `yaw=${lk.yaw.toFixed(2)} pitch=${lk.pitch.toFixed(2)}`);
    await R(() => window.__ride.setCam("fpp"));
    await wait(1500);
    await R(() => window.__ride.mouseLook(-260, 0));
    await wait(400);
    lk = await R(() => window.__ride.look);
    await shot("mouse_fpp_look_left");
    ok("FPP head turn", lk.fppYaw > 0.8, `fppYaw=${lk.fppYaw.toFixed(2)}`);
    await R(() => window.__ride.mouseLook(900, -900));
    await wait(400);
    lk = await R(() => window.__ride.look);
    ok("FPP clamp ±100° / ±45°", Math.abs(lk.fppYaw) <= 1.746 && Math.abs(lk.fppPitch) <= 0.786, `fppYaw=${lk.fppYaw.toFixed(2)} fppPitch=${lk.fppPitch.toFixed(2)}`);
    await wait(3500);
    lk = await R(() => window.__ride.look);
    ok("FPP recentres when idle", Math.abs(lk.fppYaw) < 0.2 && Math.abs(lk.fppPitch) < 0.15, `fppYaw=${lk.fppYaw.toFixed(2)}`);
    await R(() => window.__ride.setCam("tpp"));
    await wait(1200);
    await R(() => window.__ride.cycleCam());
    await wait(300);
    await R(() => window.__ride.mouseLook(400, 200));
    lk = await R(() => window.__ride.look);
    ok("C cinematic ignores mouse", Math.abs(lk.yaw) < 0.1, `yaw=${lk.yaw.toFixed(2)}`);
    await R(() => window.__ride.cycleCam());
    await R(() => window.__ride.cycleCam());
    await wait(2200);
  }

  if (ONLY.includes("lock")) {
    // Real flow (no autoplay): the loader's "to ride" click captures the pointer; mouse moves orbit.
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p3.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await p3.goto(URL, { waitUntil: "load" });
    await p3.waitForFunction(() => window.__ride?.waiting === true, null, { timeout: 90_000 });
    await p3.waitForTimeout(1500);
    await p3.mouse.move(640, 360);
    await p3.mouse.down();
    await p3.mouse.up();
    await p3.waitForTimeout(800);
    let lk = await p3.evaluate(() => window.__ride.look);
    ok("loader click captures pointer", lk.locked, JSON.stringify(lk));
    for (let i = 0; i < 10; i++) await p3.mouse.move(640 + 30 * (i + 1), 360);
    await p3.waitForTimeout(300);
    lk = await p3.evaluate(() => window.__ride.look);
    ok("locked mouse orbits while riding", Math.abs(lk.yaw) > 0.05, `yaw=${lk.yaw.toFixed(2)}`);
    await p3.close();
  }

  if (want("pause")) {
    // Esc tap pauses (autoplay too), hold only frees the mouse; blur pauses; nothing resumes on its own.
    const P = () => R(() => ({ paused: window.__ride.pause.paused, t: window.__ride.time, cam: window.__ride.camMode, tod: JSON.stringify(window.__ride.timeOfDay), veil: getComputedStyle(document.getElementById("pause")).opacity }));
    const esc = async (ms) => {
      await page.keyboard.down("Escape");
      await wait(ms);
      await page.keyboard.up("Escape");
    };
    await R(() => window.__ride.setCam("tpp"));
    await page.keyboard.down("KeyW");
    await wait(300);
    await esc(90);
    await page.keyboard.up("KeyW");
    await wait(500);
    let a = await P();
    await wait(1000);
    let b = await P();
    ok("Esc tap pauses", a.paused && b.paused && Number(b.veil) > 0.95, `paused=${b.paused} veil=${b.veil}`);
    ok("sim clock frozen while paused", a.t === b.t, `t ${a.t.toFixed(3)} -> ${b.t.toFixed(3)}`);
    await page.screenshot({ path: path.join(OUT, "pause_overlay_1920.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
    await wait(400);
    await page.screenshot({ path: path.join(OUT, "pause_overlay_1366.png") });
    await page.setViewportSize({ width: W, height: H });
    await wait(300);
    await page.keyboard.press("KeyC");
    await page.keyboard.press("KeyT");
    await page.keyboard.press("KeyF");
    await wait(300);
    const c = await P();
    const m = (await state()).mode;
    ok("keys don't leak while paused", c.cam === a.cam && c.tod === a.tod && m === "ride" && c.t === a.t, `cam=${c.cam} mode=${m}`);
    await esc(90);
    await wait(50);
    const r0 = await P();
    await wait(1000);
    const r1 = await P();
    ok("Esc tap resumes, clock doesn't jump", !r0.paused && r0.t - a.t < 0.15 && r1.t - r0.t > 0.8, `jump=${(r0.t - a.t).toFixed(3)} then +${(r1.t - r0.t).toFixed(2)}s`);
    await esc(700);
    await wait(300);
    a = await P();
    ok("Esc hold does not pause", !a.paused, `paused=${a.paused}`);
    await R(() => dispatchEvent(new Event("blur")));
    await wait(1800);
    a = await P();
    ok("blur pauses, no auto-resume (autoplay)", a.paused, `paused=${a.paused}`);
    await page.keyboard.press("Enter");
    await wait(200);
    ok("Enter resumes", !(await P()).paused, "");
    await esc(90);
    await wait(400);
    await page.mouse.click(W / 2, H / 2);
    await wait(300);
    ok("click resumes", !(await P()).paused, "");
    // Keyboard-lock path (mocked): hold is decided on keydown, tap still pauses.
    await R(() => (window.__ride.pause.keyLock = true));
    await page.keyboard.down("Escape");
    await wait(700);
    a = await P();
    await page.keyboard.up("Escape");
    await wait(200);
    b = await P();
    ok("keyboard lock: hold only frees the mouse", !a.paused && !b.paused, `during=${a.paused} after=${b.paused}`);
    await esc(90);
    await wait(300);
    a = await P();
    await esc(90);
    await wait(300);
    b = await P();
    ok("keyboard lock: tap pauses / tap resumes", a.paused && !b.paused, `${a.paused} -> ${b.paused}`);
    await R(() => (window.__ride.pause.keyLock = false));
  }

  if (ONLY.includes("pauselock")) {
    // Real pointer lock (no autoplay): hold frees the mouse without pausing; tap pauses; click resumes + re-locks.
    // Freeze the autoplay page so its rendering does not starve the new page's shader compile.
    await R(() => window.__ride.pause.pause());
    const p4 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p4.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    p4.on("console", (m) => {
      if (m.type() === "error") errors.push(`error: ${m.text()}`);
    });
    await p4.goto(URL, { waitUntil: "load" });
    await p4.waitForFunction(() => window.__ride?.waiting === true, null, { timeout: 90_000 });
    await p4.waitForTimeout(1200);
    await p4.mouse.click(640, 360);
    await p4.waitForTimeout(1200);
    const Q = () => p4.evaluate(() => ({ paused: window.__ride.pause.paused, locked: window.__ride.look.locked, keyLock: window.__ride.pause.keyLock, fs: !!document.fullscreenElement }));
    let q = await Q();
    console.log("after loader click", JSON.stringify(q));
    ok("loader click: pointer locked", q.locked, JSON.stringify(q));
    for (const kl of [q.keyLock, !q.keyLock]) {
      await p4.evaluate((v) => (window.__ride.pause.keyLock = v), kl);
      if (!(await Q()).locked) {
        await p4.mouse.click(640, 360);
        await p4.waitForTimeout(500);
      }
      await p4.keyboard.down("Escape");
      await p4.waitForTimeout(800);
      const mid = await Q();
      await p4.keyboard.up("Escape");
      await p4.waitForTimeout(300);
      q = await Q();
      ok(`[keyLock=${kl}] hold: mouse freed, not paused`, (kl ? !mid.locked : true) && !mid.paused && !q.locked && !q.paused, `mid=${JSON.stringify(mid)} after=${JSON.stringify(q)}`);
      await p4.mouse.click(640, 360);
      await p4.waitForTimeout(500);
      await p4.keyboard.down("Escape");
      await p4.waitForTimeout(80);
      await p4.keyboard.up("Escape");
      await p4.waitForTimeout(400);
      q = await Q();
      ok(`[keyLock=${kl}] tap: paused, mouse free`, q.paused && !q.locked, JSON.stringify(q));
      await p4.mouse.click(640, 360);
      await p4.waitForTimeout(600);
      q = await Q();
      ok(`[keyLock=${kl}] click resumes + re-locks`, !q.paused && q.locked, JSON.stringify(q));
    }
    await p4.close();
    await R(() => window.__ride.pause.resume(false));
  }

  if (ONLY.includes("fpp")) {
    // First person: arms must read as whole arms running out of frame (no cut/flat ends).
    await R(() => window.__ride.setCam("fpp"));
    await wait(160);
    await page.screenshot({ path: path.join(OUT, "fpp_mid_blend.png") });
    await wait(1500);
    await page.screenshot({ path: path.join(OUT, "fpp_straight.png") });
    for (const [key, name] of [["ArrowLeft", "fpp_steer_left"], ["ArrowRight", "fpp_steer_right"]]) {
      await page.keyboard.down(key);
      await wait(700);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      await page.keyboard.up(key);
      await wait(900);
    }
    await R(() => window.__ride.setCam("tpp"));
    await wait(1200);
    console.log("fpp shots done");
  }

  if (ONLY.includes("outfit")) {
    // Modesty check: 8 steep (max 55°) top-down angles + 4 low angles on foot, then riding views,
    // composed into contact sheets.
    const grab = async (cw = 520, ch = 620, dy = 0.3) => {
      const h = await R(() => window.__ride.headScreen());
      const x = Math.max(0, Math.min(W - cw, h.x - cw / 2)), y = Math.max(0, Math.min(H - ch, h.y - ch * dy));
      return (await page.screenshot({ clip: { x, y, width: cw, height: ch } })).toString("base64");
    };
    const sheet = async (name, imgs, cols) => {
      const p2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await p2.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px">${imgs.map((b) => `<img style="width:100%" src="data:image/png;base64,${b}">`).join("")}</body>`);
      await p2.waitForTimeout(300);
      await p2.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      await p2.close();
      console.log(`sheet ${name}`);
    };
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    await R(() => window.__ride.explore.lookAround(false));
    const top = [], low = [];
    for (let k = 0; k < 8; k++) {
      await R(([a]) => window.__ride.explore.orbit(a, 2, 1.8), [(k / 8) * Math.PI * 2]);
      await wait(450);
      top.push(await grab(520, 620, 0.15));
    }
    for (let k = 0; k < 4; k++) {
      await R(([a]) => window.__ride.explore.orbit(a, -1, 1.6), [(k / 4) * Math.PI * 2 + 0.4]);
      await wait(450);
      low.push(await grab(520, 700, 0.12));
    }
    await sheet("outfit_onfoot_top8", top, 4);
    await sheet("outfit_onfoot_low4", low, 4);
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "ride", null, { timeout: 8000 });
    await wait(2500);
    const ride = [];
    for (const m of ["overhead", "chase", "flank", "front"]) {
      await R(([mm]) => window.__ride.setCam(mm), [m]);
      await wait(700);
      ride.push(await grab(700, 620, 0.2));
    }
    await R(() => window.__ride.setCam("fpp"));
    await wait(900);
    ride.push((await page.screenshot({ clip: { x: 260, y: 0, width: 1400, height: 1080 } })).toString("base64"));
    await R(() => window.__ride.setCam("tpp"));
    await sheet("outfit_riding", ride, 3);
  }

  if (ONLY.includes("face")) {
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 8000 });
    await R(() => window.__ride.explore.lookAround(false));
    for (const [n, rel, d] of [["face_front", Math.PI, 1.5], ["face_34", Math.PI - 0.65, 1.5], ["face_profile", Math.PI / 2 + 0.05, 1.5], ["face_back", 0.35, 1.6]]) {
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
    await page.waitForFunction(() => window.__ride.ctl.speed > 1, null, { timeout: 6000 }).catch(() => {});
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
    // Street furniture: walk straight at the vending machine (u 4.6, z -108.4) and the phone box.
    for (const [name, u, z, r] of [["vending machine", 4.6, -108.4, 0.55], ["phone box", 4.55, -117.2, 0.6]]) {
      await R(() => window.__ride.explore.walk(0, 0));
      await R(([u, z]) => window.__ride.explore.teleport(u, z + 4.2, 0), [u, z]);
      await R(() => window.__ride.explore.walk(0, -1, false));
      let md = 1e9;
      for (let i = 0; i < 40; i++) {
        await wait(100);
        const s = await state();
        md = Math.min(md, Math.hypot(s.u - u, s.z - z));
      }
      ok(`${name} blocks walker`, md > r + 0.1, `closest approach ${md.toFixed(2)} m (collider ${r} + body 0.24)`);
    }
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
    // Mid range (2.2–60 m): F also wheels the bike over beside her, then she gets on.
    await page.keyboard.press("KeyF");
    await page.waitForFunction(() => window.__ride.explore.state.mode === "walk", null, { timeout: 15000 }).catch(() => {});
    await R(() => window.__ride.explore.walk(0, -1, true));
    await wait(3000);
    await R(() => window.__ride.explore.walk(0, 0));
    await wait(500);
    const s3 = await state();
    await page.keyboard.press("KeyF");
    await wait(400);
    const s4 = await state();
    ok("F at mid range summons the bike", s3.bikeDist > 2.2 && s3.bikeDist < 60 && s4.bikeDist < 3, `before=${s3.bikeDist.toFixed(1)} m after=${s4.bikeDist.toFixed(2)} m`);
    await page.waitForFunction(() => window.__ride.explore.state.mode === "ride", null, { timeout: 8000 }).catch(() => {});
    ok("remount after mid-range summon", (await state()).mode === "ride", (await state()).mode);
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
