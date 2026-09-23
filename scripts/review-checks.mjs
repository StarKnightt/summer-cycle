import { chromium } from "playwright";
import fs from "node:fs/promises";
const URL = process.argv[2] ?? "http://localhost:5480/";
const WHAT = process.argv[3] ?? "all";
const OUT = "shots/review";
await fs.mkdir(OUT, { recursive: true });
// Default headless Chromium flags (vsync-locked rAF, ~60 Hz) plus the real GPU.
const b = await chromium.launch({ channel: "chromium", headless: true, args: ["--use-angle=d3d11", "--use-gl=angle", "--mute-audio", "--hide-scrollbars"] });
const errs = [];
const open = async (q) => {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  if (process.env.VSYNC60)
    // Emulate a vsync-locked 60 Hz display: callbacks land on a 16.67 ms grid (missed vsyncs quantise).
    await p.addInitScript(() => {
      const P = 1000 / 60, raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf(() => {
          const next = Math.ceil(performance.now() / P) * P;
          setTimeout(() => cb(next), Math.max(0, next - performance.now()));
        });
    });
  p.on("pageerror", (e) => errs.push(`${q}: ${e.message}`));
  p.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !/warning X\d{4}/.test(m.text())) errs.push(`${q}: ${m.text()}`); });
  await p.goto(`${URL}?${q}`);
  await p.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120000 });
  return p;
};
try {
  if (WHAT === "all" || WHAT === "vsync") {
    const p = await open("autoplay=1&skipintro=1&nohud=1");
    const seen = [];
    for (let s = 0; s < 40; s += 4) {
      await p.waitForTimeout(4000);
      seen.push(await p.evaluate(() => `${window.__ride.fpsLog.slice(-1)[0]}fps/x${window.__ride.msaa}`));
    }
    const r = await p.evaluate(() => ({ msaa: window.__ride.msaa, log: window.__ride.aaLog, fps: window.__ride.fpsLog.slice(-38) }));
    console.log("vsync-capped autoplay:", seen.join(" "));
    console.log("  aaLog:", JSON.stringify(r.log), " final msaa:", r.msaa);
    const f = r.fps, avg = f.reduce((a, c) => a + c, 0) / f.length;
    console.log(`  fps avg ${avg.toFixed(1)} min ${Math.min(...f)}`);
    await p.evaluate(() => { const r = window.__ride; r.setAutoplay(false); r.place(-0.8, -160, 6); r.view(1.5, 0.75, 0.2, 0, 0.45, -0.1); });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/wheels_vsync_auto.png`, clip: { x: 560, y: 300, width: 800, height: 560 } });
    await p.close();
  }
  if (WHAT === "all" || WHAT === "wheels") {
    for (const n of [0, 2, 4]) {
      const p = await open(`skipintro=1&nohud=1&msaa=${n}`);
      await p.evaluate(() => { const r = window.__ride; r.setAutoplay(true); r.place(-0.8, -160, 6); });
      await p.waitForTimeout(1500);
      await p.evaluate(() => window.__ride.view(1.5, 0.75, 0.2, 0, 0.45, -0.1));
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${OUT}/wheels_msaa${n}.png`, clip: { x: 560, y: 300, width: 800, height: 560 } });
      console.log(`wheels msaa=${n}: msaa now x${await p.evaluate(() => window.__ride.msaa)}`);
      await p.close();
    }
  }
  if (WHAT === "all" || WHAT === "sprint") {
    const p = await open("skipintro=1&nohud=1");
    // Real Shift key under autoplay: speed should climb to ~13.5 m/s, then ease back to cruise.
    await p.evaluate(() => { const r = window.__ride; r.setAutoplay(true); r.place(-0.8, -300, 6); });
    await p.keyboard.down("Shift");
    const up = [];
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(500); up.push(await p.evaluate(() => window.__ride.sprint)); }
    await p.evaluate(() => window.__ride.view(0, 0, 0, 0, 0, 0)).catch(() => {});
    await p.evaluate(() => window.__ride.setCam("tpp"));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/sprint_top.png` });
    await p.keyboard.up("Shift");
    const down = [];
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(500); down.push(await p.evaluate(() => window.__ride.sprint)); }
    console.log("sprint up  :", up.map((s) => `${s.speed.toFixed(1)}(${s.k.toFixed(2)})`).join(" "));
    console.log("sprint down:", down.map((s) => `${s.speed.toFixed(1)}(${s.k.toFixed(2)})`).join(" "));
    // Tunnelling: ride flat out (sprint held) straight at every reachable collider in the loaded chunks.
    const targets = await p.evaluate(async () => {
      const r = window.__ride, out = [], seen = new Set();
      const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
      r.setAutoplay(false);
      for (const zs of [-60, -140, -220, -300, -380, -460, -540]) {
      r.place(0, zs, 0);
      await frame(); await frame();
      for (const ch of r.world.chunks) {
        const oz = ch.group.position.z;
        for (const k of ch.colliders) {
          const z = k.z + oz;
          r.place(0, z, 0);
          const u = k.x - r.ctl.x;
          const key = `${Math.round(k.x * 10)},${Math.round(z * 10)}`;
          if (z < -30 && z > -600 && Math.abs(u) < 2.75 + k.r + 0.1 && k.r < 1.5 && !seen.has(key)) {
            seen.add(key);
            out.push({ u: Math.max(-2.7, Math.min(2.7, u)), z, r: k.r, cu: u, cx: k.x });
          }
        }
      }
      }
      return out.sort((a, b) => a.z - b.z).filter((_, i, a) => a.length <= 16 || i % Math.ceil(a.length / 16) === 0);
    });
    let tunnels = 0;
    for (const tg of targets) {
      const res = await p.evaluate(async (tg) => {
        const r = window.__ride;
        r.setAutoplay(false);
        // Let chunk streaming settle at the start point before launching.
        r.place(tg.u, tg.z + 12, 0);
        for (let i = 0; i < 30; i++) await new Promise((res) => requestAnimationFrame(() => res()));
        r.setSprint(true);
        r.place(tg.u, tg.z + 12, 13.5);
        let passed = false, minZ = 1e9, md = 1e9;
        const t0 = performance.now();
        await new Promise((res) => {
          const tick = () => {
            const c = r.ctl;
            minZ = Math.min(minZ, c.z);
            md = Math.min(md, Math.hypot(c.x - tg.cx, c.z - tg.z));
            if (md < tg.r + 0.2) passed = true;
            if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else res();
          };
          requestAnimationFrame(tick);
        });
        r.setSprint(false);
        return { passed, md, stopDz: minZ - tg.z, speed: r.ctl.speed };
      }, tg);
      if (res.passed) tunnels++;
      console.log(`  collider r=${tg.r.toFixed(2)} u=${tg.cu.toFixed(2)} z=${tg.z.toFixed(1)}: ${res.passed ? "PENETRATED" : "ok"}: closest ${res.md.toFixed(2)} m (collider ${tg.r.toFixed(2)} + bike 0.35), ${res.stopDz > 0 ? `stopped ${res.stopDz.toFixed(2)} m short` : "slid past"}, end speed ${res.speed.toFixed(1)}`);
    }
    console.log(`tunnelling: ${tunnels}/${targets.length}`);
    await p.close();
  }
  if (WHAT === "all" || WHAT === "lost") {
    // Simulate a GPU reset: the friendly overlay with a Reload button should appear.
    const p = await open("skipintro=1&nohud=1");
    await p.evaluate(() => document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
    await p.waitForSelector("#fatal", { timeout: 5000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/context_lost.png` });
    console.log("context lost overlay:", await p.textContent("#fatal h2"));
    await p.close();
    errs.splice(0, errs.length, ...errs.filter((e) => !/CONTEXT_LOST|context lost/i.test(e)));
  }
  if (WHAT === "all" || WHAT === "look") {
    const p = await open("skipintro=1&nohud=1");
    const shot = async (name, u, z, mx, my) => {
      await p.evaluate(([u, z]) => { const r = window.__ride; r.setAutoplay(false); r.setCam("tpp"); r.place(u, z, 0); }, [u, z]);
      await p.waitForTimeout(800);
      await p.evaluate(([mx, my]) => window.__ride.mouseLook(mx, my), [mx, my]);
      await p.waitForTimeout(1500);
      const st = await p.evaluate(() => window.__ride.look);
      await p.screenshot({ path: `${OUT}/${name}.png` });
      console.log(name, JSON.stringify(st));
    };
    await shot("look_verge", 2, -150, -350, -200);
    await shot("look_verge_front", 2, -150, -900, -200);
    await shot("look_shoprow", 2.4, -113, -350, -120);
    await shot("look_shoprow2", 2.4, -113, 350, -120);
    await p.close();
  }
} finally {
  await b.close();
}
console.log(errs.length ? "errors:\n  " + errs.join("\n  ") : "console errors: none");
