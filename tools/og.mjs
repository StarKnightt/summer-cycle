/**
 * Social preview image (GitHub / Open Graph / X large card, 2:1) rendered from the running build.
 *
 *   pnpm build && pnpm preview
 *   node tools/og.mjs [--url=http://localhost:5420/]
 *
 * Renders the scene at 2560x1280, lays the loader's title over the sky in HTML (same fonts as the
 * loader), screenshots it and downscales to 1280x640 with ffmpeg: media/og.jpg + public/og.jpg,
 * plus a 400x200 thumbnail check in the temp dir.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const URL = arg("url", "http://localhost:5420/");
const TIME = arg("time", "sunset");
const Z = Number(arg("z", -150));
const VIEW = arg("view", "2.2,1.9,4.2,-9,0.9,-9").split(",").map(Number);
const SIDE = arg("side", "left");

const browser = await chromium.launch({ channel: "chromium", args: ["--use-angle=d3d11", "--use-gl=angle", "--hide-scrollbars", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1280 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/warning X\d{4}/.test(m.text())) errors.push(m.text()); });
await page.goto(`${URL}?skipintro=1&nohud=1&autoplay=1&time=${TIME}`);
await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 120000 });
await page.evaluate(([z]) => { const r = window.__ride; r.setAutoplay(true); r.place(-0.8, z, 5); }, [Z]);
await page.waitForTimeout(1500);
await page.evaluate((v) => window.__ride.view(...v), VIEW);
await page.waitForTimeout(2200);
await page.evaluate((side) => {
  const el = document.createElement("div");
  const left = side === "left";
  el.innerHTML = `
    <div class="wash"></div>
    <div class="box">
      <div class="title"><h1>Summer Cycle</h1><div class="seal">夏</div></div>
      <p class="sub"><span class="jp">夏の道</span><span class="rule"></span><span class="en">a summer road</span></p>
      <p class="play">Play in your browser &nbsp;·&nbsp; starknightt.github.io/summer-cycle</p>
    </div>`;
  const css = document.createElement("style");
  css.textContent = `
    #og { position: fixed; inset: 0; z-index: 50; pointer-events: none; }
    #og .wash { position: absolute; inset: 0;
      background: radial-gradient(ellipse 34% 25% at ${left ? "27%" : "73%"} 23%, rgba(248,241,224,0.7) 0%, rgba(246,238,219,0.45) 50%, rgba(244,236,216,0) 100%); }
    #og .box { position: absolute; top: 150px; ${left ? "left: 170px" : "right: 170px"}; color: #2f3944; }
    #og .title { display: flex; align-items: flex-start; gap: 34px; }
    #og h1 { margin: 0; font-weight: 400; font-size: 150px; letter-spacing: 0.12em; line-height: 1.05; white-space: nowrap;
      font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Yu Mincho", serif; opacity: 0.94;
      text-shadow: 0 0 2px rgba(47,57,68,0.35), 0 0 18px rgba(248,241,224,0.85), 0 0 46px rgba(248,241,224,0.6); }
    #og .seal { margin-top: 24px; width: 62px; height: 62px; border-radius: 9px; background: #b9463c; color: #f7ecd9;
      display: grid; place-items: center; font-size: 38px; box-shadow: inset 0 0 0 3px rgba(247,236,217,0.55);
      font-family: "Yu Mincho", "Hiragino Mincho ProN", "MS PMincho", serif; transform: rotate(-4deg); opacity: 0.92; }
    #og .sub { margin: 26px 0 0 6px; display: flex; align-items: center; gap: 30px; color: #4f4a42;
      text-shadow: 0 0 14px rgba(248,241,224,0.9), 0 0 30px rgba(248,241,224,0.6); }
    #og .jp { font-size: 42px; letter-spacing: 0.5em; font-family: "Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS PMincho", serif; }
    #og .rule { width: 60px; height: 2px; background: rgba(93,88,79,0.5); }
    #og .en { font-style: italic; font-size: 36px; letter-spacing: 0.34em; font-family: "Palatino Linotype", Palatino, Georgia, serif; }
    #og .play { margin: 34px 0 0 8px; font-size: 30px; letter-spacing: 0.08em; color: #4f4a42; opacity: 0.92; text-shadow: 0 0 12px rgba(248,241,224,0.9), 0 0 26px rgba(248,241,224,0.6);
      font-family: "Palatino Linotype", Palatino, Georgia, serif; }`;
  el.id = "og";
  document.head.appendChild(css);
  document.body.appendChild(el);
}, SIDE);
await page.waitForTimeout(400);
const raw = path.join(os.tmpdir(), "og-2560.png");
await page.screenshot({ path: raw });
await browser.close();

await fs.mkdir("media", { recursive: true });
await fs.mkdir("public", { recursive: true });
// JPEG, not PNG: the grass and rice detail keeps a lossless 1280x640 above GitHub's 1 MB limit.
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale=1280:640:flags=lanczos", "-q:v", "2", "media/og.jpg"]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", "media/og.jpg", "-vf", "scale=400:200:flags=lanczos", path.join(os.tmpdir(), "og-thumb.png")]);
await fs.copyFile("media/og.jpg", "public/og.jpg");
console.log(`media/og.jpg ${((await fs.stat("media/og.jpg")).size / 1024).toFixed(0)} KB; thumb ${path.join(os.tmpdir(), "og-thumb.png")}`);
console.log(errors.length ? errors.join("\n") : "console: clean");
