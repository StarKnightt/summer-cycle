# Ghibli Ride

A short cinematic bicycle ride through a late-summer Japanese countryside, rendered in Three.js
with custom toon shaders, ink outlines and painterly post-processing. No score, no objectives,
just ride. Everything (geometry, textures, audio) is generated procedurally in code.

## Run

```sh
pnpm install
pnpm dev        # dev server on http://localhost:5421
pnpm build      # type-check + production build into dist/
pnpm preview    # serve dist/ on http://localhost:5420
```

The build uses a relative base (`./`), so `dist/` can be dropped onto any static host
(GitHub Pages, Vercel, Netlify, a plain folder) without configuration.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Pedal harder (she cruises on her own) |
| S / ↓ | Brake; hold at a standstill to walk the bike backward |
| A / ← , D / → | Steer |
| V | Toggle third-person / first-person camera (from a cinematic shot: straight to first person) |
| C | Cinematic ride cameras: chase → front tracking shot (her face) → side tracking shot → chase |
| F | Get off and explore on foot (brakes to a stop first); next to the bike, get back on |
| T | Time of day: afternoon → golden hour → sunset → dusk → afternoon (smooth ~3.6 s transition) |
| B | Ring the bell |
| M | Mute / unmute |

On foot:

| Input | Action |
| --- | --- |
| W A S D / arrows | Walk, relative to the camera |
| Shift (hold) | Jog |
| Mouse drag | Orbit the camera around her (click to capture the mouse, Esc releases) |
| Mouse wheel | Zoom in / out |
| F | Get back on the bike when she's within ~2 m of it (a small "F — ride" hint appears) |

She can wander the verges, the village lots around the houses and the paddy banks (not the
water), but not through houses, poles, trunks or fences. The bike stays parked on its kickstand
where she left it; if she's more than 60 m away, F wheels it over to the road edge nearest her.

Audio starts on the first click or key press (browser autoplay rules).

## URL options

- `?autoplay=1` rides by itself along the road and hides the UI, for screen recording.
- `&cam=fpp` starts in first-person view.
- `&start=<z>` starts at a different point along the road (default `-54`).
- `&time=afternoon|golden|sunset|dusk` starts at that time of day (default `afternoon`).
- `&timelapse=1` sets the sun continuously over ~40 s, afternoon → golden hour → sunset → dusk
  (pairs with `autoplay=1` for a 40 s recording: `?autoplay=1&skipintro=1&timelapse=1`).

## Scripts

- `pnpm shoot` captures the verification screenshots with Playwright (expects `pnpm preview` running).
- `node scripts/explore.mjs --url=<server>` checks on-foot mode and the cinematic cameras
  (screenshots, collision / remount / streaming tests, FPS); `scripts/fps-ab.mjs <urlA> <urlB>`
  compares steady chase-cam FPS between two builds.
- `node scripts/birds-shots.mjs --url=<server>` frames the flocks, swallows and the perched birds scattering.
- `node scripts/tod-shots.mjs --url=<server> --out=shots/tod` captures each time-of-day preset, the
  sunset paddy reflection, dusk lights + fireflies, a mid-transition frame and the timelapse;
  `scripts/tod-fps.mjs "name=<url>?" …` interleaves FPS runs of several builds / presets.
- `audio-lab.html` is a dev-only sound playground (served by `pnpm dev`, not part of the build).
