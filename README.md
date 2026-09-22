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
| V | Toggle third-person / first-person camera |
| B | Ring the bell |
| M | Mute / unmute |

Audio starts on the first click or key press (browser autoplay rules).

## URL options

- `?autoplay=1` rides by itself along the road and hides the UI, for screen recording.
- `&cam=fpp` starts in first-person view.
- `&start=<z>` starts at a different point along the road (default `-54`).

## Scripts

- `pnpm shoot` captures the verification screenshots with Playwright (expects `pnpm preview` running).
- `audio-lab.html` is a dev-only sound playground (served by `pnpm dev`, not part of the build).
