# LAST NIGHT

*v1.0.0-beta.1 — out of pre-beta: GLB character, night objectives, living
house, and the Blood Market (IAP skeleton).*

**Survive until dawn.**

A 3/4 vampire survival horror game about psychological tension, defensive
decision-making, resource management and sound. One night lasts five minutes: you
start at 00:00 and you only have to still be alive at 05:00. You wake hungry, and
the servant door is already shaking — bar it, or open it and feed.

You are not a soldier. You do not have to kill anything.

---

## Running it

No build step, no dependencies, no installation. It is plain ES modules and a
canvas served as static files:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static file server works (`npx serve`, `php -S`, nginx, GitHub Pages). It must
be served over HTTP rather than opened as `file://`, because the game is split
across ES modules.

The static preview cannot take payment. `/api/iap` is the Node server in
`server/`, and the Midtrans server key stays in `server/.env` (gitignored).
A Google Play build must bill digital goods through Google Play Billing, not
Midtrans. The in-app privacy notice, `privacy.html`, and `delete.html` are
the store-facing copies. See `docs/PLAY-STORE.md`.

Opening it on a phone works too: there is a virtual stick plus sprint, attack,
interact, repair and barricade buttons, and the layout adapts.

## Playing it

| | |
|---|---|
| **Drag left / virtual stick** | move — she walks the way you push on screen |
| **WASD / arrows** | move (same direction rules; still there if you prefer keys) |
| **Mouse on the right** | aim, if you are not dragging the stick |
| **CLAW / click right / F** | claw (costs blood; hold to keep swinging) |
| **DASH / Shift** | dash (costs blood, your only real escape) |
| **USE / E** | interact: open/close a door, answer a knock, drink from the basin |
| **FIX / R** (hold) | repair an entrance — by hand at first, faster with planks |
| **BOARD / B** | barricade: planks raise a door's maximum durability |
| **Esc** | pause |

### The rules that matter

- **Blood is health.** There is no separate HP bar. It drains with time, faster
  when you run, and every claw swing costs it. Damage taken is damage to blood.
- **Kill to eat.** Enemies are food. That is the only sustainable source.
- **Doors are your life.** Every entrance has durability; you cannot make them
  all safe, and you are not supposed to. Choose what to defend and let the rest go.
- **Listen.** Knocking, breathing, breaking glass and footsteps tell you where
  something is before you can see it. When the house goes quiet, be suspicious.
- **The knock.** Something knocks. [E] opens the door, or you ignore it. The
  answer is never immediate — there might be nothing, a gift, a shadow, or
  something that was waiting for exactly that.
- **The night has a shape.** Three objectives per night (seeded, fair, always
  shard-paying) point you at the altar, the glass wing, the stalker. Partial
  credit pays honestly even when you die at 4:58.
- **Five predators.** Crawler, Hunter, Werewolf — and the v1.0 pair: the
  **Stalker** (moves only unseen, never breaks a door, just waits) and the
  **Ghoul** (a thinner wolf that eats barricades). Late-night variants
  (FRENZIED, MARKSMAN, ALPHA) stop the last hour from repeating the first.
- **The night has a shape.** Every run draws three objectives from a seed
  (feed properly, hold the walls, keep one door forgotten…). They pay out in
  shards — partial credit even when you die. Purpose on top of survival.

Dawn is at 05:00. Spending the night fighting is a losing strategy; spending it
surviving is the game.

## How it is built

Everything except the player is generated at runtime: no image files, no audio
files and no third-party libraries — the art is drawn procedurally on a 2D
canvas and the sound is synthesised with the Web Audio API.

**The player is the uploaded GLB, loaded as-is.** `new_character_glb_box_01_run_walk_c0d0d3.glb`
is fetched byte-for-byte (never decoded, unpacked, baked or re-exported — it is
SHA-256-checked by `node tools/glbtest.mjs`) and handed to a vendored Three.js
`GLTFLoader`. Three evaluates the asset's original 65-joint skin and authored
clips (`walk`, `run`, `box_01` punch; idle = the authored rest pose) on a small
transparent WebGL canvas, and the 2D renderer composites that live frame as the
upright character. Root motion from the clips is cancelled in memory only, so
the GLB file itself stays untouched. The procedural silhouette survives strictly
as a failure path (no WebGL / headless harness), never as the on-screen character.

```
index.html            canvas, veil, fullscreen button
styles.css            page shell
src/main.js           boot, resize, audio unlock, fixed-step loop
src/core/util.js      math, seeded RNG, clock formatting, save layer
src/core/config.js    all timings, phases, enemy stats, upgrades, beats
src/core/audio.js     40+ synthesised sounds, 3 buses, limiter, reverb
src/core/input.js     keyboard/mouse + virtual stick and buttons
src/core/render.js    camera, shake, half-res lightmap, particles, decals, post
src/game/mansion.js   6 rooms + grounds, walls, furniture, entrances, collision, nav grid
src/game/objectives.js night objectives: seeded picks, partial credit, shard payout
src/game/house.js     ambient life: flicker, the cat, distant piano, drafts
src/game/haunts.js    psychology layer: whispers, watchers, fake knocks (never lies about damage)
src/game/player.js    the vampire: blood economy, states, GLB character composite
src/game/enemies.js   crawler, hunter, werewolf, stalker, ghoul + variants: perception, pathing, breaches
src/shop/config.js    store knobs: sandbox | midtrans | bridge; ads off by default
src/shop/iap.js       catalog + providers (Midtrans Snap, ledger restore)
src/shop/ads.js       rewarded-only ads: placements, caps, mock provider
src/game/objectives.js  three seeded goals per night: par checks, rewards, HUD
src/game/house.js     ambient life: candle flicker, a cat, distant piano, drafts
src/game/valen3d.js   direct GLTFLoader runtime for the uploaded animated GLB
src/vendor/three/     vendored Three.js + GLTFLoader (no npm, no CDN)
src/game/director.js  tension director: budget, moods, knocks, events, countdown
src/game/hud.js       clock, blood cells, prompts, touch controls
src/shop/iap.js       the Blood Market: catalog, sandbox/native providers,
                      entitlements (see the design notes at the top of the file)
src/ui/screens.js     menu, intro, pause, settings, upgrades, collection, help,
                      shop, death, victory
```

### v1.0 — shipping state

Version `1.0.0`. Monetisation plan, price ladder (IDR via Midtrans) and the
rewarded-ads policy live in **docs/IAP.md**; the client ships with `provider:
'sandbox'` (no real money, no network) until the four server routes exist.
Ads are opt-in and invisible until configured. Everything in the store is
also earnable with shards — and shards are earnable with a good night.

### A few design decisions worth knowing

- **The tension director replaces random spawning.** It owns a pressure budget,
  composes waves from it, decides *where* things come from, and enforces quiet
  stretches — because pressure only reads as pressure when there is contrast.
  Mood raises instantly and decays slowly, so it never flaps.
- **Real pathfinding.** The mansion has interior walls and the grounds are large,
  so enemies route on a coarse walkability grid with BFS rather than steering
  straight at you. They also give up: after a long hunt with no contact they
  leave, which rewards evasion over killing.
- **The camera is impact-only.** Shake happens on door breaks, hits, blood moon
  and the panic phase — never as decoration.
- **The player must never be lost.** The vampire carries a cold rim of moonlight
  that grows stronger the weaker she gets, so the world can get darker without
  the player losing track of herself.

## Verifying it

The game can be run headlessly for testing, which is how the balance was tuned:

```bash
cd tools && npm i          # @napi-rs/canvas, dev only
cd ..

# play a whole night with a scripted bot, deterministic for a given seed
node tools/harness.mjs --mode=bot --frames=21600 --seed=42

# verify the systems that a normal run only reaches by luck
node tools/harness.mjs --systems

# check the touch layout at phone/tablet/desktop sizes
node tools/harness.mjs --touch

# write screenshots of every screen into tools/shots/
node tools/harness.mjs --screens
```

`tools/shotbrowser.mjs` runs the game in a REAL headless Chromium with
software WebGL (`@sparticuz/chromium`, bundled in the npm tarball — no CDN),
so the GLB character and the store flow are exercised end to end. It writes
the QA shots to `tools/shots-browser/`:

```bash
python3 -m http.server 8080 &        # or: node tools/shotbrowser.mjs alone
node tools/shotbrowser.mjs           # serves + shoots menu, night, shop, mobile
```

The Blood Market in the web beta runs on a **sandbox provider**: prices are
shown with a SANDBOX mark, nothing is charged, purchases persist locally, and
every item is also purchasable with earned shards (no pay-to-win, no ads —
the full monetization rationale is documented in `src/shop/iap.js`).

`tools/harness.mjs` boots the real game modules against a Node canvas and a
Web Audio shim, drives a bot that flees swarms, feeds on crawlers, repairs doors
and answers knocks, and prints a telemetry table every 15 simulated seconds.
Runs are reproducible per `--seed`.

Note: `@napi-rs/canvas` leaks native memory per render, so the harness renders
only every 1000th frame (`--rendercheck=N` to change that).

The payment backend has its own zero-dependency test that stubs Midtrans and
AdMob SSV locally (no network):

```bash
node server/test.mjs   # order → settlement → replay/refund → SSV: 16/16 PASS
```

Two small map tools are included for development: `tools/geo.mjs` dumps room
rects, props and entrance coordinates, and `tools/nav.mjs` prints the
walkability grid and test routes. Both are useful when editing the mansion.
