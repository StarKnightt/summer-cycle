# Ghibli Ride — agent rules

Studio Ghibli / Makoto Shinkai style third-person cycling game. Vite + TypeScript + Three.js, pnpm only.

## Working rules
- When a step doesn't need the user's input, keep going. Put status notes in the same message as the next action.
- Stop and ask only when you can't continue without the user, or before anything destructive: deleting data, force-pushing master, deleting cloud projects, or changing anything outside this repository.
- Keep the task list in `TASKS.md`. Tick items when done, add anything new you find.
- End every run with three headings: **Blocked on me**, **Changed**, **Found**. Mark anything you couldn't confirm and say where you looked.

## Project constraints
- Everything stays inside `c:\Code\ghibli-ride`. Extra git worktrees go in `.worktrees/` (gitignored), never next to the project folder.
- Close every dev/preview server and headless browser you start. The user wants no ports left open. Never kill servers you didn't start (e.g. port 5411 is another project).
- No recorded videos left on disk; keep screenshot sets lean.
- Hosting: GitHub Pages (repo StarKnightt/ghibli-ride). Do not deploy to Vercel.

## Art and tech rules
- Toon/cel shaders only via the material factory in `src/render/materials.ts`; no PBR, no downloaded assets (geometry, textures, audio all generated in code).
- Outlines, painterly grade, warm light. Band-limit procedural patterns (fwidth) to avoid shimmer.
- Performance target: ≥90 fps average at 1920×1080 on the RTX 4060 in autoplay over the first 40 s; floor 75. Measure GPU contention before trusting numbers.
- Keep the opening composition (autoplay start z = −54) and all controls working: WASD/arrows, V FPP/TPP, C cinematic cams, F walk/ride, Shift run, T time of day, B bell, M mute, mouse look. URL: `?autoplay=1`, `&skipintro=1`, `&time=`, `&timelapse=1`, `&msaa=`.
- Regression: `scripts/explore.mjs` must pass; zero console errors.
