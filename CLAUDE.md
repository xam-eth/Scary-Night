# LAST NIGHT — Marketing Director memory

*This file is the standing brief for whichever agent picks up marketing work on
this repo. It is not game design (that's `docs/DESIGN.md` and `docs/STORY.md`,
which this file defers to on anything about mechanics or narrative canon) — it
is the marketing memory: what the product is, what assets exist, which
channels are live, what strategy is running, what worked, what didn't, and
what to do next. Update it in place as facts change. Append to the lessons
log instead of deleting old entries — the history is the point.*

Owner: earlyaakses@gmail.com · Working branch: `arena/01a0e66a-scary-night`
(no other branches/tags exist in this repo — there is nothing to cherry-pick
media from outside this branch; everything below is already on it).

---

## 1. The product, in marketing terms

**LAST NIGHT** — *Survive until dawn.* A 3/4 top-down vampire survival horror
game. Free-to-play, browser-first (plain HTML5/canvas, no install), with a
Google Play wrapper planned. Status: **v1.0.0-beta.1**, out of pre-beta —
GLB character, night objectives, a living house, and the Blood Market (IAP
skeleton, currently sandbox-only, no real money moves yet).

**The one-line pitch:** *You wake hungry in a house that won't let you leave.
Bar the door, or open it and feed. One night is five minutes — survive from
00:00 to 05:00.*

**Why it's ownable (the marketing angles, ranked):**
1. **The reversal.** You are not the survivor hiding from the monster — you
   *are* the monster, and the tension is that you still have to survive.
   Every hook should lead with this ("you don't have to kill anything" reads
   as a twist once people assume this is a hiding-sim).
2. **Forced feeding as a readable clock.** Blood is health *and* a timer.
   This is a uniquely visual, uniquely TikTok-clippable mechanic once the
   diegetic-blood visual pass (`docs/DESIGN.md` §15, D-V1) lands — the body
   itself shows the countdown.
3. **The knock.** A recurring, unresolved mystery beat (something knocks;
   open it or don't) that works as a stand-alone teaser loop independent of
   full playthroughs — good for short vertical clips with no context needed.
4. **Real pathfinding, five distinct predators, a tension director** (not
   random spawns) — the game reads as considered, not templated, to anyone
   who watches more than 10 seconds.
5. **Story hook held in reserve:** dawn should kill her; it doesn't; the
   house resets. This is a slow-burn hook for retention content (devlogs,
   lore threads), not a Day-1 headline — don't spoil the dawn paradox in
   acquisition marketing, it's the mid-game curiosity engine (`docs/STORY.md`
   §5).

**Never in marketing copy** (from `brand/index.html` §05, binding — these are
brand law, not a suggestion):
- No "EPIC", "EXTREME", "#1", "jump-scare", no exclamation marks, no emoji.
  The horror is psychological and the voice is spare.
- Never explain the monster or the house's motive. Imply, never expose.
- Never claim "no ads" — the honest line is **"ads are opt-in and
  reward-only."** The ad system is scaffolded but off by default
  (`SHOP_CONFIG.ads.provider`); don't promise a permanent state that isn't
  locked.
- Never say anything that reads as pay-to-win. The one sanctioned economic
  claim: **"money buys relief and identity, never power."** This is a
  structural/code-enforced invariant (`docs/DESIGN.md` §7, the integrity
  invariant #20) — it is safe to state as fact, not aspiration.
- Don't market IAP prices or the Blood Market yet — it ships in
  `provider: 'sandbox'`, nothing is chargeable. Marketing sells the *game*,
  not the store, until a real payment provider is wired (`docs/IAP.md`).
- The only sanctioned CTA: **"Play free in your browser."**

---

## 2. Brand system (source of truth: `brand/index.html`, regenerate via
`node tools/brandkit.mjs`)

- **Mark:** a door in a ring of night (crescent moon, arched servant door,
  candle window, one blood drop). Never rotate/skew/outline/gradient it.
  Never place type inside the ring.
- **Palette:** Ink `#05060b` (~70% of any composition), Bone `#e6e1d2`,
  Ash `#cfc6b0`, Blood `#7d1220` (accent only, ~3%), Gold `#a8833c` (rules,
  tagline), Candle `#ffb257` (glow), Moon `#8fb6e8` (night light, fog).
- **Type:** Display = Gelasio/Georgia, tracked caps (wordmark 0.16em,
  tagline 0.40em, never bold). Labels = Lato/Segoe UI. Data/mono = Consolas
  (product UI only, never marketing).
- **Two art registers:** *Key art* (painted plate, photoreal desaturated
  house-at-night) and *night motif* (procedural silhouette — moon, spires,
  pines, fog) for wide banners where no plate exists.
- **Voice:** spare, ominous, honest. "Survive until dawn." / "The house
  remembers." / "Something knocks." are the canon lines — reuse them, don't
  reinvent taglines.

## 3. Asset inventory — what exists right now (`assets/brand/`)

All regenerated deterministically by `node tools/brandkit.mjs` (needs
`cd tools && npm i` once, for `@napi-rs/canvas`). Edit the generator, not the
PNGs, if the brand system itself changes.

| File | Size | Use |
|---|---|---|
| `mark.svg` | vector | the mark alone, any size |
| `logo-vertical.svg`, `lockup-vertical(.-ink).png` | vector / 1200×900 | default lockup |
| `logo-horizontal.svg`, `lockup-horizontal(.-ink).png` | vector / 1800×460 | wide placements |
| `wordmark.svg` | vector | captions, watermarks |
| `icon-512/192/32.png` | 512·192·32 | store icon, PWA, favicon |
| `feature-1024x500.png` | 1024×500 | Google Play feature graphic |
| `post-1080x1080.png` | 1080×1080 | feed square (IG/FB/X) |
| `post-1200x675.png` | 1200×675 | X / Facebook link-share card |
| `story-1080x1920.png` | 1080×1920 | IG/TikTok story, Reels cover |
| `thumb-1280x720.png` | 1280×720 | YouTube/video thumbnail base |
| `banner-youtube-2560x1440.png` | 2560×1440 | YouTube channel art |
| `header-x-1500x500.png` | 1500×500 | X header |
| `cover-facebook-820x312.png` | 820×312 | Facebook cover |
| `banner-discord-960x540.png` | 960×540 | Discord server banner |
| `loading-9x16.jpg`, `menu-9x16.jpg` | 768×1365 | key-art plates (exterior / great hall) |

Also available, not in the generated kit but usable as-is: `assets/rooms/`
(`gallery.jpg`, `gatehouse.jpg`, `oratory.jpg` — environmental plates, good
for "the house is a character" story-driven posts) and the player character
model `new_character_glb_box_01_run_walk_c0d0d3.glb` (byte-exact, never
re-export it — screenshot/record it live instead, see `tools/harness.mjs
--screens` and `tools/shotbrowser.mjs` for how QA already captures it).

**Gap (no static asset can fill this — needs real capture):** everything
static above is *pre-gameplay* key art. There is currently **no gameplay
footage, GIF, or edited vertical video** in the repo — and per the 2026
research below, that is the single highest-leverage missing asset. Filed as
an issue, see §6. Re-checked 2026-09-28 (later same day): still zero
`.mp4`/`.gif`/`.webm`/`.mov` files anywhere in the repo, no movement on the
issue — this gap is unchanged and is still the top blocker on cadence.

**Off-brand — do not use in marketing:** `assets/loading-last-night.jpg`
(root of `assets/`, not in `assets/brand/`). A wide AI-generated-style house
plate with "LAST NIGHT" set in a different typeface than the locked
wordmark (Gelasio tracked caps, §2/`assets/brand/wordmark.svg`). Not
referenced anywhere in `index.html` or `src/`, and it violates the
registered art direction (`brand/index.html` §06 — key art is photoreal/
desaturated/ink-shadowed, no second painted title over a plate). Left in
place rather than deleted in case something outside marketing depends on
it — flagged as a question in
[xam-eth/Scary-Night#48](https://github.com/xam-eth/Scary-Night/issues/48).
Until that's resolved: never pull this file into a post, banner, or store
asset.

## 4. Distribution channels (source of truth: Zernio `accounts_list`)

Connected right now (re-checked 2026-09-28, later same day — this changed
since the morning check, see the log line below):

| Platform | Handle | Account ID | Status |
|---|---|---|---|
| TikTok | phagos_space | `6aa6ca78726ebfe037e55afa` | connected, organic — **not yet renamed** |
| X / Twitter | last_nighti (display "last_night") | `6aba3372941047d17613f0cc` | connected, organic, 39 followers |
| Facebook | Last Night | `6aba677c28ae0fa04bafbea3` | connected, 0 followers — brand new Page |

**What changed since the morning:** the X account was **renamed** from
`phagos_space` to `@last_nighti` (followers carried over — 39, confirming
it's a rename in place, not a fresh account) — looks like Option A from
`docs/SOCIAL-PROFILES.md` §0 was taken for X. TikTok is still
`phagos_space`, unrenamed — if the intent is one consistent identity across
platforms (the whole point of §0), TikTok still needs the same treatment.
A **Facebook Page ("Last Night") now exists and is connected** — this is
the one `docs/SOCIAL-PROFILES.md` §1 was written for; Zernio's API doesn't
expose bio/About text, so verify by hand whether that copy actually got
pasted in, don't assume it did. **TikTok Ads (`6aa6cb92...`) is no longer
connected** — the "paid organic" plan in §7 needs that account back before
it can boost anything.

**Fallout:** the X draft post created this morning
(`6aba046e47e37cd27fea172b`) auto-**cancelled** when `phagos_space` was
renamed/disconnected (error: "Account 'phagos_space' was disconnected").
Re-created as `6aba76c429ab78851327e57e` on the new `@last_nighti` account,
still `is_draft: true`. The TikTok draft (`6aba046d183cfe1b2f5386fe`) was
unaffected. **Lesson for next time:** a rename/reconnect on a platform
silently kills anything queued/drafted on the old account id — after any
account change, re-check `posts_list` for casualties rather than assuming
drafts survive.

**Confirms the §0 read, not just a guess:** `posts_list` shows
`phagos_space`'s post history includes unrelated content — another game
("PHAGOS", an immune-system game), web3/Ronin commentary, Tokyo Game Show
takes — none of it LAST NIGHT. This was a shared studio account, not a
misconfigured one.

**Not connected**, despite a full brand kit already built for them:
Instagram, YouTube, Discord. Zernio supports all of them (16 platforms
total). Connecting these is a decision for the account owner, not something
this session can do — flag it, don't silently work around it. Until
they're connected, don't produce content plans that assume a posting
channel that doesn't exist yet; keep the live plan scoped to TikTok + X +
Facebook, and keep the rest in "ready to activate" status in §7.

No live game URL is recorded anywhere in this repo (README only documents
`python3 -m http.server 8080` for local preview). **Do not invent a play
link in any post.** Get the real hosted URL from the team before any post
that needs a CTA link; until then, link-less awareness content only.

**Page/profile setup copy:** ready-to-paste Page name, bio, description,
CTA and asset mapping for Facebook (the one slated for ads), X, TikTok,
YouTube, Instagram and Discord lives in `docs/SOCIAL-PROFILES.md` (written
2026-09-28). It reuses only assets already in `assets/brand/` — nothing new
to generate — and leaves every link/CTA field blank pending the two open
items above (live URL, public support email). Update that file in place as
handles get claimed and real URLs land; this file stays the summary.

## 5. Zernio operating notes (how to actually post from here)

- `accounts_list` / `profiles_list` first, always, to resolve `account_id` —
  this account has two TikTok entries (organic + ads), so `platform: tiktok`
  alone is ambiguous; pass `account_id` explicitly.
- `posts_create` defaults to **scheduled**, not live. Use `is_draft: true`
  for anything that needs human sign-off before it can go out at all — that
  is the default posture for this repo until the owner says otherwise, since
  publishing is public and hard to fully undo (deletion exists via
  `posts_delete`/`posts_unpublish_post` but a live post can already have been
  screenshotted/reposted).
  For static images, upload real files with `media_generate_upload_link`
  before posting.
- `queue_preview_queue` / `queue_*` manage a posting queue per profile if a
  recurring slot cadence gets set up later.
- `analytics_get_analytics`, `analytics_get_best_time_to_post`,
  `analytics_get_post_timeline` — use these after the first 2–3 weeks of
  posts exist; too early right now to have a baseline (log the first
  read in §8 lessons once it happens, don't guess numbers).

## 6. Open asset requests (filed to the dev/design side)

Filed as a GitHub issue rather than guessed at:
[xam-eth/Scary-Night#48 — "Marketing asset requests: gameplay capture + character cards"](https://github.com/xam-eth/Scary-Night/issues/48)
(filed 2026-09-28. Content below is the standing ask — keep it in sync with
the issue if scope changes, and append new asks there rather than opening a
second thread).

Ask, in priority order:
1. **7–10 vertical gameplay clips (15–40s, 9:16, no commentary needed)** from
   `tools/shotbrowser.mjs`-style real headless capture, or a screen recording
   of a real browser session: a door breaking under siege, a feed (the claw
   → blood-fill loop), a knock-then-reveal, a close call at low blood, a
   dawn card. These are the single highest-leverage missing asset — 2026
   organic strategy for horror games runs on clip volume, not key art.
2. **Five predator "cast" portraits** (Crawler, Hunter, Werewolf, Stalker,
   Ghoul) in the *key art* register — feeds "meet the cast" carousel/thread
   content without spoiling story.
3. **A UGC-friendly raw B-roll pack** (no logo/text baked in) so edits and
   any future creator/UGC outreach have clean footage to cut, per the
   creator-style trend below.
4. **Animated mark/wordmark (short loop, transparent)** for video intros —
   static SVG only exists today.

## 7. Marketing strategy (2026, research-backed)

Sources pulled 2026-09-28; re-pull if this section is more than ~2 months
old, the landscape (esp. TikTok organic reach) moves fast:
- [TikTok's Changing Landscape for Game Marketing in 2026](https://www.cloutboost.com/blog/tiktoks-changing-landscape-for-game-marketing-in-2026-what-developers-need-to-know)
- [TikTok Growth Strategies for Brands in 2026](https://www.stackmatix.com/blog/tiktok-growth-strategies-2026)
- [TikTok Gaming Trends 2026](https://viryze.com/blog/tiktok-gaming-trends-2026)
- [Zero Budget Marketing for Indie Games: 2026](https://boomiestudio.com/blog/indie-game-marketing)
- [Essential Mobile Game Marketing Strategies Guide](https://segwise.ai/blog/essential-mobile-game-marketing-strategies)
- [2026 Indie Game Marketing Playbook — market before you build](https://www.strayspark.studio/blog/2026-indie-game-marketing-playbook-market-before-build)
- [How to Grow an Indie Game Audience With Devlogs in 2026](https://gtstu.com/indie-game-devlog-audience-growth-youtube-tiktok/)
- [2026 Tips for making tweets go viral](https://howtomarketagame.com/2026/05/07/2026-tips-for-making-your-tweets-go-viral/)

**What changed vs. older playbooks:** TikTok organic reach has compressed —
~15-20% in 2024 down to ~4-8% for many gaming accounts by early 2026. Pure
organic posting is no longer a strategy on its own.

**What's working now — "paid organic":** post consistently, watch which
clips catch traction organically, then put a *small* paid budget behind the
winners specifically (this account already has `tiktokads` connected, which
is exactly the tool this needs). Organic builds the brand equity that lowers
paid CPMs; paid extends the reach of what already proved itself. Don't
boost cold — only boost what already has above-average organic engagement.

**Content cadence:** aim for 7–14 short vertical clips/week once the capture
pipeline (§6 ask #1) exists. Before that exists, cadence is necessarily
lower — don't force a quota with nothing to show; a slower cadence of real
gameplay beats a fast cadence of key-art reposts. Expect 60–90 days before a
TikTok strategy shows reliable results (first 30 days = cadence + baseline
data, months 2–3 = optimize on what the data says).

**Horror-genre specifics for 2026:** the trend has moved past "play scary
game on camera" toward reactions, and toward showing failure/authenticity
(a bad run, a death, a bug) rather than only highlight reels — this fits
LAST NIGHT's own "a lost night still moves you forward" design philosophy
(`docs/DESIGN.md` §0 pillar 3) unusually well: a death clip is not a bad
clip here, it's on-brand.

**UGC/creator angle (once there's something to point creators at):**
UGC-style edits — POV, mobile-screen-recording feel, casual tone — blend
into feeds and read as recommendations rather than ads, which matters more
than production polish for this genre. When any player or creator posts
their own clip, reposting/crediting it is worth more than another owned
post — feed that into the account when it starts happening (log it in §8).

**X/Twitter specifics:** rarely drives acquisition spikes alone, but is the
right home for devlog-style posts (a solved bug, a shader/lighting pass, a
balance number) — post 3–5×/week, use `#indiedev` `#gamedev`
`#screenshotsaturday`, and treat it as community/credibility building that
supports the TikTok funnel rather than a growth channel in its own right.

**Store listing (when the Play build ships):** `docs/PLAY-STORE.md` already
locks the listing category (Survival/Horror, 18+), the "Contains ads: No"
answer (must flip in lockstep with `src/shop/ads.js` if that ever changes),
and that IAP is real only on Play via `LNBridge`/Play Billing, never
Midtrans in that build. Marketing must not get ahead of that doc — e.g.
don't advertise a sale/price before Play Console prices are actually set.

## 8. Lessons learned (append-only log — newest entry on top, never delete)

*(empty — this is a new marketing effort as of 2026-09-28. The first entry
should land after the first posts get real analytics back, not before.)*

Template for each entry:
```
### YYYY-MM-DD — <headline finding>
- What we tried:
- What happened (numbers from analytics_get_analytics if available):
- What we're changing because of it:
```

## 9. Standing skills / how-to

- **Regenerate the whole brand kit:** `cd tools && npm i && node
  brandkit.mjs` — writes into `assets/brand/`. Edit `tools/brandkit.mjs`
  (palette `C`, `drawMark`, lockup layout) as the single source of truth;
  never hand-edit a generated PNG.
- **Preview the brand kit page:** `node tools/shotbrand.mjs` (serves +
  screenshots `brand/index.html` via real headless Chromium into
  `tools/shots-browser/`).
- **Capture real gameplay for clips:** `node tools/harness.mjs --screens`
  (every game screen, scripted) or `node tools/shotbrowser.mjs` (real
  browser, real WebGL, exercises the GLB character and shop flow) — outputs
  under `tools/shots/` and `tools/shots-browser/`. Neither currently
  produces video; that gap is §6 ask #1.
- **Post to a connected account:** `accounts_list` → resolve `account_id` →
  `media_generate_upload_link` for any real asset → `posts_create` with
  `is_draft: true` for review, or `schedule_minutes` once a post is approved
  to go out. Never `publish_now` without an explicit go-ahead in the
  conversation that asked for it.
- **File a new asset ask:** open/append to the GitHub issue named in §6
  rather than a new one each time, so the design side has one thread to
  track, not a scatter of one-offs.

---

*Marketing memory only. For gameplay/economy truth, defer to
`docs/DESIGN.md`. For story/narrative canon, defer to `docs/STORY.md`. For
Play Store compliance, defer to `docs/PLAY-STORE.md`. This file wins on
anything specifically about marketing history, strategy, assets, and
channels.*
