# TASKS — Ghibli Ride release

## Done means
The game is live on GitHub Pages (public repo StarKnightt/ghibli-ride), the Vercel project is deleted, everything is merged on `master`, the final critic passes all checkpoints against `refs/` with close-up detail crops, a code-review pass finds no blocking issues, ≥90 fps (floor 75) is measured on an idle GPU, `scripts/explore.mjs` passes with zero console errors, no ports are left open, and only the `ghibli-ride` folder remains (no worktrees).

## Merged
- [x] Toon world, outlines, painterly post, sky/clouds, paddies with reflections, houses (iter 1–5)
- [x] Intro loader (washi screen, real progress, click to ride); 4-legs bug fixed
- [x] Sharpness + detail pass: leaf atlas, undergrowth, flowers, butterflies, far field, hills, hamlets
- [x] Birds (flocks, egrets, swallows, kite, perched sparrows), shop row, shrine, hamlet props, house modeled detail, basket bouquet
- [x] On-foot explore (F), orbit camera, footsteps, C cinematic cams, glasses + face, closed outfit
- [x] Time of day (T): afternoon / golden / sunset / dusk, timelapse, fireflies, night glow
- [x] Face pass 3 (smaller almond eyes, slimmer glasses, long ponytail), FPP arms fix
- [x] Synthesized soundscape (bike, wind, cicadas, birds, water, ambience)

## In progress
- [x] Performance pass to ≥90 fps: 118 fps avg / 110 min afternoon, 116 sunset, 112 dusk (MSAA x4) — shader specialisation, distance LOD, half-rate paddy mirror with far-LOD trees
- [x] Detailed mamachari bicycle (`feature/bike`, merged, branch + worktree removed)
- [x] Pointer lock after loader + mouse look while riding/FPP (`feature/mouse`, merged, branch + worktree removed)

## Found during the perf pass
- [ ] GPU is often shared with other processes (user's Chrome ~79% 3D engine at times, other agents' headless Chromium): benchmark only when `nvidia-smi` is near idle; `scripts/perf.mjs` prints per-pass GPU ms to spot it
- [ ] `refs/girl_model_sheet.png` is untracked (not added by builder A) — owner to decide whether to commit

## Remaining
- [x] Merge `feature/mouse`
- [ ] Final critic review (all checkpoints + close-up detail crops vs refs/user_*.jpg, face at riding distance, all 4 times of day, FPS on idle GPU, mark anything unconfirmed)
- [ ] Code-review pass on the full diff since the last release (blocking issues only)
- [ ] Fix round for critic/review findings
- [ ] GitHub Pages: make repo public, Actions workflow (pnpm build → deploy-pages), verify live URL
- [ ] Delete Vercel project `ghibli-ride`, remove vercel.json / .vercelignore / .vercel / .env.local
- [ ] Final cleanup: no worktrees, no ports, lean shots, README controls up to date
