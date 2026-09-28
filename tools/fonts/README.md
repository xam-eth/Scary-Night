# Brand raster fonts

Used only by `tools/brandkit.mjs` to rasterise the brand assets.

- `Gelasio.ttf` — Gelasio (variable), metric-compatible stand-in for the in-game
  Georgia. Source: google/fonts, OFL.
- `Lato-Regular.ttf` — Lato, for small tracked labels. Source: google/fonts, OFL.

Both fonts are licensed under the SIL Open Font License 1.1
(https://scripts.sil.org/OFL). They are not loaded by the game itself — the game
ships zero font files and uses system stacks (see `src/game/hud.js`).
