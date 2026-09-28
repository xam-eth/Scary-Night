# LAST NIGHT — paid ads strategy

*Written 2026-09-28. This is the plan to execute once the blockers in §0 are
cleared — not something running yet. Companion to `CLAUDE.md` (organic
strategy, channel status) and `docs/SOCIAL-PROFILES.md` (page setup). Update
in place as blockers clear and real spend data comes in; log outcomes in
`CLAUDE.md` §8 lessons, not here — this file stays the plan.*

---

## 0. Blockers — checked live via Zernio, 2026-09-28

None of this can spend a dollar yet. In order of what unblocks what:

1. **No Meta Ad Account.** A `metaads` connection exists in Zernio
   (`accountId 6aba95faa8080a310a8c71e8`, token healthy) — but
   `ad_accounts_list_ad_accounts` returns zero accounts. The OAuth grant is
   there; the actual billing-capable ad account (`act_<digits>`) is not.
   That gets created in Meta Business Manager (business verification +
   payment method), which is the account owner's action, not something
   scriptable from here. Once it exists, re-run the connect flow scoped to
   it (`ad_account_id` on `connect_ads`) or it'll be visible to
   `ad_accounts_list_ad_accounts` directly.
2. **TikTok Ads disconnected.** Was connected earlier today
   (`6aa6cb92726ebfe037e56053`), no longer in `accounts_list`. Reconnect via
   the account owner's TikTok Ads Manager login.
3. **No live game URL.** Needed for: the destination of any traffic/
   conversion ad, and the page the Meta Pixel actually gets installed on.
   Without it, nothing beyond a Page-engagement boost (§2) can run at all.
4. **No public support email / finished store listing.** Lower priority for
   ads specifically, but relevant once ads point at a Play Store listing
   instead of the browser build (`docs/PLAY-STORE.md`).

## 1. What CAN run today, once an ad account exists (no URL needed)

The one thing that doesn't need a landing page: **boosting the organic
posts already live** (Page-likes / post-engagement objective) on the
Facebook Page and, once TikTok Ads reconnects, Spark Ads on a TikTok post
that's already showing above-average organic engagement — this is exactly
the "paid organic" approach `CLAUDE.md` §7 already commits to. Don't boost
cold; boost only a post that's already outperforming the account's own
baseline. There's no baseline yet (first posts went out today) — revisit
after ~1–2 weeks of organic posting once there's something worth amplifying.

## 2. Full-funnel plan, once the URL + a real Meta Ad Account both exist

### 2.1 Pixel & conversion events

Install the Meta Pixel on the game's page (standard `PageView` fires
automatically). Two custom events worth wiring in the game client, in order
of value:

1. **`GameStart`** — fires when the player presses Play. Cheap to add
   (one `fbq('trackCustom', 'GameStart')` call at the right point in
   `src/ui/screens.js`'s menu-to-game transition), and it's the event every
   later optimization step depends on.
2. **`Night1Complete`** — fires on the player's first survived dawn (tying
   into the existing Guided-Win Night 1 design, `docs/DESIGN.md` §1 L0).
   Add once `GameStart` has enough volume to be worth a second event;
   premature before that.

This is a small code change, not a marketing task — happy to implement it
directly once there's a real pixel ID to wire in (`tracking_tags_create_tracking_tag`
needs a live `ad_account_id`, which is blocker §0.1).

### 2.2 Campaign structure (Meta)

- **Campaign 1 — Awareness/Engagement** (runs from day one, no pixel
  dependency): boosts the best-performing organic posts, per §1. Objective
  `OUTCOME_ENGAGEMENT`.
- **Campaign 2 — Traffic** (once the URL exists): objective
  `OUTCOME_TRAFFIC`, sending clicks to the game. This is what actually
  builds pixel volume for Campaign 3 to later optimize against — don't skip
  straight to a conversions objective with zero pixel data, Meta's
  optimizer needs volume to work with (roughly 50 conversion events/week
  per ad set is Meta's own guidance for exiting the learning phase cleanly).
- **Campaign 3 — Conversions on `GameStart`** (once Campaign 2 has run long
  enough to generate that volume — realistically weeks, not days): objective
  `OUTCOME_SALES` or `OUTCOME_ENGAGEMENT` with the custom conversion wired
  to `GameStart`, bid strategy `LOWEST_COST_WITHOUT_CAP` to start (auto-bid)
  before ever setting a cost cap.

All three should be created `status: PAUSED` and reviewed before switching
on — the `ad_campaigns_create_ad_campaign` tool defaults to `PAUSED` for
exactly this reason, and that default should be kept, not overridden,
until someone has actually looked at the ad in Ads Manager.

### 2.3 Targeting

- **Age 18+, no upper bound** — matches the content rating
  (`docs/PLAY-STORE.md`: horror violence, 18+), and don't rely on Meta's
  defaults to enforce this, set it explicitly on every ad set.
- **Interest targeting to start:** horror games, survival games,
  *Vampire Survivors*, roguelite games, indie horror — broad enough that
  Advantage+ audience expansion (`advantage_audience: 1`) can find lookalikes
  once there's pixel signal to expand from; too narrow wastes the auction on
  day one when there's no retargeting pool yet.
- **Geography:** start with whatever markets the game is actually reachable
  from (needs the live URL to know — likely English-speaking first given the
  copy is all English; confirm before spend commits to a region).
- **Placements:** automatic to start (let Meta's delivery system find the
  cheapest inventory) rather than hand-picking placements with zero data to
  justify the choice.

### 2.4 Budget

No dollar figure is committed here — that's the account owner's call, not
mine to set unilaterally for something that spends real money. Framework
once a number exists:
- Test phase: small daily budgets (commonly $5–15/day per ad set is enough
  to read signal without material risk) across 2–3 creative/audience
  variants for 3–5 days each before judging any of them.
- Scale phase: once a variant is clearly outperforming (lower CPM/CTR than
  the test-phase average), increase its budget in increments rather than
  jumping straight to the full monthly budget on one ad set — sudden large
  budget jumps reset Meta's delivery optimization (a new learning phase).
- Every campaign launches `PAUSED` per §2.2 — nothing goes live without a
  human looking at it in Ads Manager first, regardless of budget size.

### 2.5 Creative

Static key art (`assets/brand/post-1080x1080.png`, `post-1200x675.png`) is
usable for the awareness/engagement campaign (§2.2 Campaign 1) starting
today. Traffic and conversion campaigns should wait for real gameplay
footage (`xam-eth/Scary-Night#48` ask #1) — 2026 ad creative for this genre
underperforms badly on static art alone; the research in `CLAUDE.md` §7
about clip volume applies just as much to paid as organic.

## 3. TikTok Ads (once reconnected)

Same "paid organic" posture as §1/§7: TikTok Ads exists specifically to
amplify organic posts that are already proving themselves, via Spark Ads on
the organic post's own post ID (keeps the organic engagement/comments
attached to the boosted version, which reads more authentic than a cold ad
unit). Don't build TikTok ad creative from scratch until there's an organic
post worth spending behind.

## 4. What happens next

1. Owner creates a real Meta Ad Account in Business Manager and grants it to
   this Zernio connection (or reconnects with `ad_account_id` scoped to it).
2. Owner reconnects TikTok Ads.
3. Owner/team gets the game hosted at a real URL.
4. Once 1–3 land: implement the `GameStart` pixel event (§2.1, I can do this
   directly in `src/ui/screens.js`), then launch Campaign 1 (§2.2) — the one
   piece that doesn't even need the URL, so it can start the moment an ad
   account exists.
5. Log real results in `CLAUDE.md` §8 as they come in, not projections.
