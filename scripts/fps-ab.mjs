#!/usr/bin/env node
/** A/B steady chase-cam FPS: node scripts/fps-ab.mjs http://localhost:5451/ http://localhost:5452/ */
import { chromium } from "playwright";

const urls = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--force_high_performance_gpu", "--hide-scrollbars", "--mute-audio"],
});
try {
  for (let round = 0; round < 2; round++)
    for (const url of urls) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`${url}?autoplay=1&skipintro=1`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__ride?.ready === true, null, { timeout: 90_000 });
      await page.mouse.click(960, 540);
      await page.waitForTimeout(3000);
      const n0 = await page.evaluate(() => window.__ride.fpsLog.length);
      await page.waitForTimeout(12000);
      const l = (await page.evaluate(() => window.__ride.fpsLog)).slice(n0 + 1);
      const avg = l.reduce((a, b) => a + b, 0) / l.length;
      console.log(`${url} round ${round}: avg ${avg.toFixed(1)} min ${Math.min(...l)} [${l.join(",")}]`);
      await page.close();
    }
} finally {
  await browser.close();
}
