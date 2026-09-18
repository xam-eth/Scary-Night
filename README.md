# LAST NIGHT

**Survive until dawn.**

A 2D top-down vampire survival horror game about psychological tension, defensive
decision-making, resource management and sound. One night lasts five minutes: you
start at 00:00 and you only have to still be alive at 05:00.

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

Opening it on a phone works too: there is a virtual stick plus sprint, attack,
interact, repair and barricade buttons, and the layout adapts.

## Playing it

| | |
|---|---|
| **WASD / arrows** | move |
| **Mouse** | aim (keyboard and touch get light aim assist) |
| **Click / F** | claw (costs blood; hold to keep swinging) |
| **Shift** | dash (costs blood, your only real escape) |
| **E** | interact: open/close a door, answer a knock, drink from the basin |
| **R** (hold) | repair an entrance — by hand at first, faster with planks |
| **B** | barricade: planks raise a door's maximum durability |
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

Dawn is at 05:00. Spending the night fighting is a losing strategy; spending it
surviving is the game.

## How it is built

Everything is generated at runtime. There are no image files, no audio files and
no third-party libraries — the art is drawn procedurally on a 2D canvas and the
sound is synthesised with the Web Audio API.

```
index.html            canvas, veil, fullscreen button
styles.css            page shell
src/main.js           boot, resize, audio unlock, fixed-step loop
src/core/util.js      math, seeded RNG, clock formatting, save layer
src/core/config.js    all timings, phases, enemy stats, upgrades, beats
src/core/audio.js     40+ synthesised sounds, 3 buses, limiter, reverb
src/core/input.js     keyboard/mouse + virtual stick and buttons
src/core/render.js    camera, shake, half-res lightmap, particles, decals, post
src/game/mansion.js   4 rooms, walls, furniture, entrances, collision, nav grid
src/game/player.js    the vampire: blood economy, states, procedural drawing
src/game/enemies.js   crawler, hunter, werewolf: perception, pathing, breaches
src/game/director.js  tension director: budget, moods, knocks, events, countdown
src/game/hud.js       clock, blood cells, prompts, touch controls
src/ui/screens.js     menu, intro, pause, settings, upgrades, collection, help,
                      death, victory
```

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

`tools/harness.mjs` boots the real game modules against a Node canvas and a
Web Audio shim, drives a bot that flees swarms, feeds on crawlers, repairs doors
and answers knocks, and prints a telemetry table every 15 simulated seconds.
Runs are reproducible per `--seed`.

Note: `@napi-rs/canvas` leaks native memory per render, so the harness renders
only every 1000th frame (`--rendercheck=N` to change that).

Two small map tools are included for development: `tools/geo.mjs` dumps room
rects, props and entrance coordinates, and `tools/nav.mjs` prints the
walkability grid and test routes. Both are useful when editing the mansion.
