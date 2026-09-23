# TASKS — Summer Cycle release

## Done means
The game is live on GitHub Pages (public repo StarKnightt/summer-cycle), the Vercel project is deleted, everything is merged on `master`, the final critic passes all checkpoints against `refs/` with close-up detail crops, a code-review pass finds no blocking issues, ≥90 fps (floor 75) is measured on an idle GPU, `scripts/explore.mjs` passes with zero console errors, no ports are left open, and only the `ghibli-ride` folder remains (no worktrees).

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

- [x] Rename to Summer Cycle (title, loader, README, package name, audio lab)
- [x] Character rebuild (`feature/face`): 20-year-old rider matching `refs/girl_model_sheet.png` + production refs — sculpted oval head with blunt rounded chin, warm-brown eyes, glasses, airy bangs, nape ponytail + scrunchie; healthy adult body (~7 heads, lofted torso, tapered limbs, hands, loafers); white blouse + dusty-blue midi skirt (seated drape); loader SVG girl to match. Tools: `scripts/face-shots.mjs`, `face-compare.py`. Shots: `shots/face/`

## Found during the perf pass
- [ ] GPU is often shared with other processes (user's Chrome ~79% 3D engine at times, other agents' headless Chromium): benchmark only when `nvidia-smi` is near idle; `scripts/perf.mjs` prints per-pass GPU ms to spot it
- [ ] Global ink colour is near-black (`post.ts` uInk); production refs use warm brown ≈ #3A2A22 — worth a look in the critic pass (not changed in `feature/face`, affects the whole world)
- [ ] Character FPS unconfirmed on an idle GPU (GPU at 99% from other processes during `feature/face`); rider cost vs master: same mesh count (283 vs 281), +15k tris
- [x] `refs/girl_model_sheet.png` committed (character target); `refs/web/` + `scripts/_refgrab.mjs` gitignored

## Remaining
- [x] Merge `feature/mouse`
- [ ] Final critic review (all checkpoints + close-up detail crops vs refs/user_*.jpg, face at riding distance, all 4 times of day, FPS on idle GPU, mark anything unconfirmed)
- [ ] Code-review pass on the full diff since the last release (blocking issues only)
- [ ] Fix round for critic/review findings
  - [x] Review blocker 1: adaptive MSAA measures missed vsync against the detected refresh (no longer "fps < 72"), stays x4 on 60 Hz; MSAA 0 dithers coverage-alpha (see-through spoke blur, leaf fade); SMAA pre-compiled in warm-up
  - [x] Review blocker 2: riding mouse-look orbit collides (houses, trunks/props, above grass), chest-height floor when facing her from the front
  - [x] WebGL2 missing / context lost: friendly washi message + Reload; time-of-day blend allocation-free; `fpsLog` capped
  - [x] Shift sprint while riding (13.5 m/s, faster cadence, FOV +5.5°, pull-back, shake; `sprint` in RiderState for E's standing pose); collision sub-steps 0.1 m, no tunnelling at 13.5 m/s
- [x] GitHub Pages prep: Actions workflow (pnpm build → deploy-pages), sub-path `/summer-cycle/` verified locally, README live URL
- [ ] GitHub Pages: make repo public + enable Pages (source: GitHub Actions), re-run workflow, verify live URL
- [x] Remove vercel.json / .vercelignore from the repo, delete local .vercel/ and .env.local
- [ ] Delete Vercel project `ghibli-ride` (coordinator, at release)
- [ ] Final cleanup: no worktrees, no ports, lean shots, README controls up to date
