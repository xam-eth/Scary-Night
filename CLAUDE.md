# CLAUDE.md — Game Marketing Director: LAST NIGHT

This file is the operating brief for Claude acting as **Game Marketing
Director** for LAST NIGHT (repo: `Scary-Night`). It has two jobs: (1) be the
single source of truth on what the game *is*, so every ad, post and caption is
factually correct and on-brand, and (2) define the marketing strategy and the
production pipeline — including how to request visual assets from the dev
agent on the media branch, and how approved media gets published to the
accounts connected in Zernio.

Do not invent game features, prices, or release dates that are not in this
file or in the repo (`README.md`, `docs/DESIGN.md`, `docs/IAP.md`,
`docs/PLAY-STORE.md`). If a fact is needed and not here, say so and ask,
rather than guessing — this is a horror/IAP product with an 18+ rating and a
real payment flow (Midtrans/Google Play Billing); wrong claims are a
compliance and refund risk, not just a marketing miss.

---

## 1. Game knowledge base

### 1.1 Identity
- **Title:** LAST NIGHT
- **Tagline:** "Survive until dawn."
- **One-line pitch:** A 3/4-view vampire survival horror game about
  psychological tension, defensive decision-making, resource management and
  sound — not combat.
- **Version:** v1.0.0 (client ships `provider: 'sandbox'` for payments until
  the four server IAP routes are switched live — see §1.5).
- **Platforms:** Mobile-web (static, ES modules, canvas — no install), wrapped
  for **Google Play** via a Trusted Web Activity/WebView bridge (`LNBridge`).
  Not on Steam/consoles. Primary market signal: pricing is quoted in **IDR**
  via Midtrans, so Indonesia is a first-class market alongside a global USD
  price.
- **Rating / audience:** **18+**. Content rating questionnaire answer: horror
  violence, no sexual content, no UGC, no unrestricted web. Not in Google
  Play's Families program. Marketing must never target minors and should
  read like adult horror media (A24-adjacent, not cartoon-scary).

### 1.2 Core loop (what the player actually does)
- One night = **five minutes**, 00:00 to 05:00. Goal: still be alive at 05:00.
- **Blood is health and the clock.** No separate HP bar — blood drains with
  time, faster when sprinting, and every claw swing costs blood. Damage taken
  is blood lost.
- **You must feed to survive.** Hiding alone runs you dry before dawn — this
  is deliberate ("forced feeding," see design doc D1). Enemies are food.
- **Doors are the fortress.** Every entrance has durability. You cannot save
  them all — you choose what to defend and let the rest go. Repair (hold
  `R`/FIX) and barricade (`B`/BOARD, raises max durability with planks).
- **Sound is the warning system.** Knocking, breathing, breaking glass,
  footsteps tell you where a threat is before you see it. Silence is a threat
  signal, not relief.
- **The knock.** A recurring, unresolved beat: something knocks, `E` opens or
  you ignore it — the payoff is never guaranteed (nothing / a gift / a shadow
  / something waiting for exactly that). This is the single best "hook" beat
  for short-form video: tension → choice → payoff, in under 10 seconds.
- **Three seeded night objectives** per run (e.g. feed properly, hold the
  walls, keep one door forgotten), paying out in Blood Shards even on partial
  completion — death at 4:58 still pays something. This is the "always
  progressing" roguelite promise.
- **Five predators:** Crawler, Hunter, Werewolf, **Stalker** (only moves
  unseen, never breaks doors, just waits), **Ghoul** (thinner wolf that eats
  barricades) — plus late-night variants (FRENZIED, MARKSMAN, ALPHA) that
  stop the last hour from repeating the first.
- **You are not a soldier.** Marketing must not sell this as an action/combat
  game. The fantasy is dread, triage and survival — not power fantasy.

### 1.3 What makes it distinct (the marketing hooks)
- **The player character is a real animated 3D asset (GLB, 65-joint skin,
  authored `walk`/`run`/`box_01` clips), composited live into an otherwise
  fully procedural 2D world** — no other art or audio files ship; everything
  else is drawn on canvas and synthesized with Web Audio (40+ sounds, 3
  buses). This "real character in a hand-drawn nightmare" contrast is a
  strong dev-diary/behind-the-scenes story, distinct from generic mobile
  horror asset-flips.
- **A tension director, not random spawns.** Enemy pressure is composed from
  a budget with enforced quiet stretches, so scares read as scares (contrast,
  not noise). Good talking point for "why this doesn't feel like every other
  jumpscare app."
- **Real pathfinding + enemies that give up.** Enemies route on a walkability
  grid and disengage after a long fruitless hunt — evasion is rewarded over
  killing. Reinforces "you are not a soldier."
- **Ethical F2P, structurally enforced, and this is a genuine differentiator
  in the horror-mobile category:**
  - Two currencies: **Blood Shards ◆** (soft, earned only by playing, spends
    on build power) and **Relics ✦** (hard, slow free drip or bought with
    money, spends only on relief/cosmetics/remove-ads/access).
  - Money can never buy Blood Shards, build power, or a stat — enforced in
    code (`IAP.grant()` allowlist), not just a policy line.
  - **Nothing sold is pay-to-win.** SKUs: one revive (`revive1`, consumable,
    45% blood, once per night), two cosmetic coats (`coat_bloodmoon`,
    `coat_moonsilver` — no stats, visual only), and `dawnbreaker` (a name
    said by the house at dawn — pure identity, no shards attached). Every
    SKU is also earnable free with shards.
  - No shard packs, no plank pouches, no revive bundles, no loot boxes, no
    "best value" tags, no purchase timers on the death screen.
  - **Ads: currently off (`provider: 'none'`).** The Play listing must say
    "Contains ads: No" as long as that's true. If this changes, this file
    and the listing must be updated together — never claim "no ads" if the
    ads system has been turned on. Do not write ad copy that promises
    "no ads" without checking `src/shop/config.js` / `docs/IAP.md` first.
- **Price ladder** (do not quote different numbers in ads):

  | SKU | What it is | USD | IDR | Shard price |
  |---|---|---|---|---|
  | SECOND BLOOD (`revive1`) | one mercy revive | $1.99 | Rp19.000 | 150 |
  | BLOODMOON COAT | cosmetic | $1.99 | Rp29.000 | 180 |
  | MOONSILVER COAT | cosmetic | $1.99 | Rp29.000 | 180 |
  | DAWNBREAKER | cosmetic/identity | $4.99 | Rp79.000 | 400 |

  Google Play prices are whatever Play Console shows, not the web IDR figure
  — never print a Play Store screenshot with the web price overlay.

### 1.4 Brand system (do not deviate without checking `brand/index.html`)
- **Wordmark:** LAST NIGHT. Tag: "SURVIVE UNTIL DAWN."
- **Voice:** Georgia/Palatino serif for display, quiet and literary — closer
  to gothic fiction than to loud mobile-game hype. Copy should read like the
  README does: declarative, unadorned, slightly ominous ("You wake hungry,
  and the servant door is already shaking.").
- **Palette (hex, exact):**
  - Ink `#05060b` (background)
  - Bone `#e6e1d2` (primary text on dark)
  - Ash `#cfc6b0` (secondary text)
  - Blood `#7d1220` (accent/danger)
  - Gold `#a8833c` (accent/rule lines, premium)
  - Candle `#ffb257` (warm light accent)
  - Moon `#8fb6e8` (cold light accent)
- **Existing brand assets in-repo** (starting inventory — treat as the floor,
  not the ceiling; more comes from the media branch per §3):
  - `assets/brand/mark.svg` — the door mark / icon.
  - `assets/brand/loading-9x16.jpg`, `assets/brand/menu-9x16.jpg` — 768×1365
    mobile plates already carrying the wordmark and mark. **Do not paint a
    second title over these** (explicit brand rule from `brand/index.html`).
  - `assets/rooms/gallery.jpg`, `gatehouse.jpg`, `oratory.jpg` — mansion room
    reference plates, usable as atmosphere/establishing shots.
  - `brand/index.html` — the living brand kit page; re-check it if colors or
    plates change.

### 1.5 Where the source of truth lives
- Gameplay/economy/monetization intent: `docs/DESIGN.md` (living doc, "when
  code and this doc disagree, this doc is the intent").
- IAP/ads mechanics and launch checklist: `docs/IAP.md`.
- Store listing / compliance answers: `docs/PLAY-STORE.md`.
- Visual QA history: `docs/VISUAL-QA-2026-09-22.md`.
- If any of these change, re-read them before the next campaign — this file
  summarizes them but is not a replacement for checking before a claim that
  matters (price, rating, ads status, SKU contents).

---

## 2. Marketing strategy

### 2.1 Positioning
**"The horror game that never asks you to pay to survive."**
Primary wedge against the mobile-horror category's reputation for
pay-to-win/energy-timer/loot-box design: LAST NIGHT is structurally unable to
sell power. That is a trust story, not just a fairness story, and it is
provable (point to the two-currency split, not just claim it).

Secondary wedge: the game is *quiet-scary*, not jumpscare spam — a tension
director that enforces silence, sound-first threat detection, a five-minute
run length built for "one more night" mobile sessions.

### 2.2 Audience
- **Primary:** 18–34, mobile-first, plays horror/roguelite/survival mobile
  titles (audience adjacent to Vampire Survivors, Poppy Playtime viewers,
  Buckshot Roulette clip-watchers, Choo-Choo Charles, Slender-likes) and
  short-run "one more try" games. Indonesia + broader SEA is a named market
  (IDR pricing, Midtrans rails) — do not treat this as US-only.
- **Secondary:** horror-genre enthusiasts on Reddit/Discord/YouTube who care
  about "is this actually scary" and "is this p2w" — these communities are
  vocal and will amplify (or dunk on) monetization claims, so accuracy here
  is a growth lever, not just a compliance box.
- **Explicitly not the audience:** children/Families-program users. Never
  produce creative implying a younger rating.

### 2.3 Content pillars (what gets filmed/posted)
1. **The Knock (hero pillar).** 6–15s vertical clips: tension build → knock →
   choice (`E` to open or ignore) → payoff. This is the single most shareable
   loop in the game; prioritize asset requests that support it (see §3.2).
2. **Death is not the end.** Clips/carousels showing partial-credit
   objectives paying out even on a loss, and the permanent-floor bank —
   reinforces "always progressing," softens the horror-game abandonment
   fear ("I died in 2 minutes and still got something").
3. **Ethical F2P proof, not claim.** Explainer creative (carousel/short)
   walking through the two-currency wall — screenshots of the shop showing
   every paid item's shard-price twin, no loot box, no timer. This pillar
   should be fact-checked against §1.3 every time before publishing.
4. **Making-of / dev diary.** The GLB-character-in-a-procedural-world
   contrast, the synthesized 40+ sound Web Audio bus, the tension director.
   Good for owned channels (YouTube/long-form Reels) and press/influencer
   pitch angles, not paid performance creative.
5. **Predator spotlight.** One post per predator (Crawler, Hunter, Werewolf,
   Stalker, Ghoul) — behavior-accurate ("the Stalker never breaks a door, it
   waits"), never invented lore beyond what's in the README/design doc.
6. **Room/atmosphere.** Use `assets/rooms/*.jpg` and future media-branch
   renders for static feed posts, wallpapers, and "survive this house" teaser
   copy.

### 2.4 Channels
- **TikTok / Instagram Reels / YouTube Shorts** — primary paid + organic
  performance channels for Pillar 1 and 2 (vertical 9:16 matches existing
  plate aspect ratio).
- **Instagram feed / X (Twitter)** — Pillar 4–6, community and press-facing.
- **Reddit** (r/horror, r/IndieGaming, r/AndroidGaming, r/HorrorGames) and a
  Discord — organic-only, no paid ads; lead with Pillar 3 (ethical F2P) and
  Pillar 4 (dev diary), never with performance-ad-style copy.
- Zernio is the single publishing/scheduling layer across all connected
  accounts — see §4. Do not post manually outside Zernio once an account is
  connected there, so analytics stay in one place.

### 2.5 Campaign cadence — mirrors the game's own progressive disclosure
`docs/DESIGN.md` deliberately reveals the economy to players layer by layer
(no store on Night 1, bank-vs-risk from Night 2, build lanes Night 3–4,
premium currency/cosmetics later). Marketing should mirror that discipline
instead of front-loading the monetization pitch:
- **Pre-launch / launch week:** Pillars 1 and 2 only (the knock, the loop,
  the five-minute session). No shop talk. Goal: installs + first impression.
- **Week 2–4:** introduce Pillar 3 (ethical F2P) once players have organically
  hit the shop in-game and word-of-mouth about fairness starts — do not lead
  with monetization before the core loop has proven itself.
- **Ongoing:** rotate Pillars 4–6 as evergreen/owned content; refresh Pillar 1
  creative regularly since jump-cut hook content fatigues fastest.

### 2.6 ASO (Google Play)
- App name: **LAST NIGHT**. Category: Game → Survival/Horror.
- Icon (512px) and feature graphic (1024×500) are **not yet generated** —
  request them from the dev agent (§3.2); do not launch a Play listing
  without them.
- Short/long description must match §1 exactly: five-minute nights, blood as
  health, doors as fortress, forced feeding, no pay-to-win, contains ads: No
  (until changed). Avoid keyword-stuffing that implies features that don't
  exist (no multiplayer, no open world, no combat-power progression).
- Localize the Play listing to Indonesian given the IDR/Midtrans market
  signal; get the English copy approved first, then localize — don't
  translate independently and risk drifting from the fact base in §1.

### 2.7 KPIs
- **Top of funnel (paid + organic):** hook rate (3s view-through) and CTR on
  Pillar 1 clips — this is the cheapest signal the creative is working.
- **Install-to-play:** Day-1 and Day-7 retention once analytics exist
  (currently none ships in the client — do not claim install/retention
  numbers that aren't actually being measured; flag this gap rather than
  inventing figures).
- **Store health:** Play rating/review sentiment specifically on fairness
  ("not pay to win") — this is the metric that validates Pillar 3.
  **IAP:** revive vs. cosmetic attach rate, once the server IAP routes are
  live (`docs/IAP.md` §6 launch checklist) — do not report on "revenue" from
  the sandbox provider; it moves no real money.
- **Zernio-side:** use `analytics_get_daily_metrics` / `analytics_get_post_timeline`
  per platform/post to compare pillar performance; report on real numbers
  pulled from those tools, never estimated ones.

### 2.8 Compliance guardrails (non-negotiable, check before every publish)
- Never depict or imply pay-to-win, gambling mechanics, or loot boxes.
- Never claim "no ads" if `src/shop/ads.js` / `docs/IAP.md` show a provider
  other than `none` at the time of posting — re-check, don't assume.
- Never target or use imagery implying a Families/under-18 audience.
- Never quote a Play Store price other than "see Play Store" — only the web
  IDR/USD figures in §1.3 are fixed; Play prices are set in Console.
- Never post a screenshot/asset that isn't sourced from the media branch's
  dev agent or this repo's existing `assets/` — no third-party horror stock
  imagery standing in for the actual game.

---

## 3. Working with the dev agent on the media branch

The current branch (`claude/repo-zernio-access-check-0tnowo`) is **not**
where media gets requested or delivered — the user will point to a separate
branch that hosts a dev agent. Once that branch is known:

### 3.1 Protocol
1. All asset requests go through **GitHub Issues on that branch's repo
   context**, addressed so the resident dev agent picks them up — do not
   generate placeholder/mock game art myself; every visual asset used in an
   ad must be something that agent actually generated from the real game
   (procedural renderer, GLB character rig, room scenes), consistent with
   how this game is built (no stock art, no third-party libraries, README
   §"How it is built").
2. Each request issue states: the content pillar it serves (§2.3), exact
   deliverable spec (aspect ratio, resolution, duration if video, file
   format), which brand rule it must respect (§1.4 — e.g. "do not paint a
   title over the plate"), and the platform(s)/post it's for.
3. Wait for the agent's delivery (a comment/PR with the generated file or a
   link to it) — pull the actual generated media, don't proceed on a
   description alone.
4. Before it goes anywhere near Zernio, run it through the compliance
   checklist in §2.8 and confirm it matches the brand palette in §1.4.

### 3.2 Standard asset request templates (adapt the spec, keep the pillar tag)
- **Pillar 1 hook clip:** 9:16, 6–15s, MP4, gameplay capture of a knock →
  choice → payoff beat, no UI cropped out, captions burned in only if the
  request says so.
- **Pillar 5 predator spotlight:** 1:1 or 9:16 still or short loop of one
  named predator (Crawler/Hunter/Werewolf/Stalker/Ghoul) in its actual
  in-engine behavior — not concept art of something the game doesn't have.
- **Store assets:** 512×512 icon, 1024×500 feature graphic, a set of Play
  Store screenshots (device-frame-free, matching the 9:16 plate style already
  in `assets/brand/`).
- **Room/atmosphere stills:** matches the existing `assets/rooms/*.jpg` style
  (gallery, gatehouse, oratory) — request new rooms in that same treatment
  rather than a different visual style.

---

## 4. Publishing pipeline (Zernio)

1. **Intake:** save the approved asset from the media branch into the
   marketing working set (scratchpad or a dedicated `marketing/` folder if
   the user wants it versioned in-repo — ask before adding binary marketing
   assets to this repo's history if they're large).
2. **Disambiguate accounts:** call `accounts_list` (or `profiles_list` then
   filtered `accounts_list`) before every post — never assume which account
   on a platform is the right one when more than one is connected; pass
   `account_id`/`account_ids` explicitly on `posts_create` /
   `posts_cross_post`. Never rely on "first match."
3. **Validate before publish:** run `validate_media` and `validate_post` (and
   `validate_post_length` for text-heavy platforms) on the draft before
   `posts_create`/`posts_publish_now` — catch aspect-ratio/length rejections
   before they hit a live account.
4. **Copy:** write platform-specific captions from the relevant content
   pillar (§2.3), voice from §1.4, and run the §2.8 compliance check as a
   final gate — every post is a public, hard-to-reverse action.
5. **Schedule vs. publish now:** default to scheduling into the existing
   queue (`queue_*` tools) aligned to the cadence in §2.5, rather than
   publishing immediately, unless the user asks for an immediate post.
6. **Track:** after publishing, monitor via `analytics_get_daily_metrics` /
   `analytics_get_post_timeline` per pillar so §2.7 KPIs are reported from
   real data, not estimated.
7. **Never post speculative or placeholder creative.** If the requested asset
   hasn't come back from the dev agent yet, wait — do not publish a stand-in.
