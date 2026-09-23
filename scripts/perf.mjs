#!/usr/bin/env node
/**
 * Performance run: autoplay (the recording path) for 40 s at 1920x1080 on the real GPU, with the
 * ?prof=1 frame profiler (GPU timer queries per pass, CPU per frame section, renderer.info).
 *   node scripts/perf.mjs --url=http://localhost:5460/ [--time=sunset] [--msaa=4] [--secs=40] [--label=x]
 * Prints FPS avg/min/p10 and a per-pass table; writes JSON to shots/perf/<label>.json.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5460/");
const TIME = arg("time", "");
const MSAA = arg("msaa", "");
const SECS = Number(arg("secs", "40"));
const LABEL = arg("label", `run${TIME ? "_" + TIME : ""}`);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--enable-webgl-draft-extensions", "--mute-audio", "--hide-scrollbars"],
});
const errors = [];
let out;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (/warning X\d{4}/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  const q = new URLSearchParams({ autoplay: "1", skipintro: "1", nohud: "1", prof: "1" });
  if (TIME) q.set("time", TIME);
  if (MSAA) q.set("msaa", MSAA);
  await page.goto(`${URL}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__ride.prof.reset());
  const n0 = await page.evaluate(() => window.__ride.fpsLog.length);
  await page.waitForTimeout(SECS * 1000);
  out = await page.evaluate((n0) => {
    const r = window.__ride;
    const log = r.fpsLog.slice(n0);
    return { fps: log, msaa: r.msaa, prof: r.prof.report(), info: { programs: r.renderer?.info.programs?.length } };
  }, n0);
} finally {
  await browser.close();
}
const f = out.fps;
const s = [...f].sort((a, b) => a - b);
out.summary = { avg: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), min: s[0], p10: s[Math.floor(s.length * 0.1)], msaaEnd: out.msaa };
await fs.mkdir(path.join(ROOT, "shots/perf"), { recursive: true });
await fs.writeFile(path.join(ROOT, `shots/perf/${LABEL}.json`), JSON.stringify(out, null, 1));
console.log(`[${LABEL}] fps avg=${out.summary.avg} min=${out.summary.min} p10=${out.summary.p10} msaa(end)=${out.msaa}`);
console.log(`fps: ${f.join(",")}`);
const { gpuMs, cpuMs, calls, tris } = out.prof;
const keys = [...new Set([...Object.keys(gpuMs), ...Object.keys(calls)])];
let gt = 0;
console.log("pass              gpu ms   calls     tris");
for (const k of keys) {
  gt += gpuMs[k] ?? 0;
  console.log(`${k.padEnd(16)} ${String(gpuMs[k] ?? "-").padStart(7)} ${String(Math.round(calls[k] ?? 0)).padStart(7)} ${String(Math.round((tris[k] ?? 0) / 1000) + "k").padStart(8)}`);
}
console.log(`GPU total        ${gt.toFixed(2)} ms`);
console.log("cpu:", Object.entries(cpuMs).map(([k, v]) => `${k}=${v}`).join("  "));
console.log(errors.length ? `console errors:\n  ${errors.join("\n  ")}` : "console errors: none");
