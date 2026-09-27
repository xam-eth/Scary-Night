# LAST NIGHT — Game, Economy & Monetization Design Spec

*Living design doc. Single source of truth for the gameplay-workflow and economy
redesign tracked in GitHub Epics #3, #10, #16. When code and this doc disagree,
this doc is the intent — update it as decisions change.*

Status: **v1 model locked** (all major forks decided). Tuning numbers marked
`[tune]` are targets for the implementing agent to hit, not final values.

---

## 0. North star

**The night is the product. Blood is a clock. You survive by feeding, you
progress by daring, and money only ever buys relief and identity — never power.**

Five pillars, in priority order:

1. **The loop comes first.** Economy is derived *from* the gameplay flow, never
   bolted on. Every currency is a faucet or a sink that already exists inside the
   core loop. (Industry orthodoxy — see §8.)
2. **Forced feeding.** Hiding alone must run you dry before dawn. Reaching 05:00
   requires feeding. Blood is a countdown the player can read.
3. **Always progressing.** Even a lost night moves you forward (a permanent
   floor), so failure never feels wasted — the roguelite "one step closer."
4. **Bank vs risk.** What you earn in a night is at stake until dawn. Daring is
   rewarded; dying costs you (most of) the night's purse, but never everything.
5. **Ethical F2P.** Free to play to the end. Money buys **relief** (keep what you
   earned) and **identity** (cosmetics) and **remove-ads** — and it is structurally
   impossible to buy **power**.

---

## 1. The layered model (from "Play" pressed)

| Layer | Span | Psychological job | Owning epic |
|---|---|---|---|
| **L0 Hook** | first 10s / Night 1 | plant dopamine, "one more" | Guided Win (#14) |
| **L1 Moment** | seconds | juice per action (a kill = blood + FX) | already strong |
| **L2 Night** | 5 minutes | one run's payoff; the purse fills here | #3 |
| **L3 Meta** | across nights | the economy engine; bank/risk + build | #10 |
| **L4 Curiosity** | long term | always a next thing to chase | #15 |
| **L5 Monetization** | optional, layered in | relief + identity, never power | #16 |

---

## 2. The flywheel

```
Play well  (feed, take risks, go deep)
  → the night PURSE fills          (soft currency, scaled by nightHeat)
  → BANK it at dawn, or lose most on death  (bank-vs-risk; a permanent floor always remains)
  → invest into a BUILD lane        (specialize; you can't own all)
  → a different, stronger night     (build changes strategy)
  → survive deeper nightHeat        (difficulty↔power curve)
  → new REVEALS / milestones        (curiosity cadence)
  → "one more night"
```

Monetization attaches to this loop at exactly two emotional peaks: the **death**
(sell relief — keep the purse) and the **identity** you build (sell cosmetics).
It never sells a step of the loop itself.

---

## 3. Decision log (locked)

Every fork we resolved, with the choice and the why. External evidence in §8.

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Core economy | **Forced feeding** | hiding must run dry; feeding is the heartbeat |
| D2 | Loss model | **Bank-vs-risk + permanent floor** | tension of loss + roguelite "always advancing" (Hades/VS) |
| D3 | Upgrade model | **Build specialization** (Glutton/Warden/Shade) | currency must create *strategy*, not flat creep |
| D4 | Session-1 | **Guided win** | plant the hook before difficulty bites (Survivor.io progressive) |
| D5 | Business model | **Ethical F2P** | free-playable + opt-in ads + IAP; fits game + ID market |
| D6 | Pay-to-win line | **Never sell power** | integrity of the roguelite; trust as a feature |
| D7 | Currency | **Dual currency** (soft action + hard premium) | separates "earned power" from "bought identity" — enforces D6 structurally |
| D8 | Disclosure | **Progressive cadence** | reveal economy/monetization layer-by-layer across nights, not at once |
| D9 | Revive | **Archero-style** — time-pressured, contextual | tempt, show what's at stake, never force |

---

## 4. Currencies (the plumbing that makes D6 a wall, not a promise)

Two currencies. The separation is what makes "never sell power" **enforceable**:
money can only ever become the hard currency, and the hard currency is walled off
from build power.

### 4.1 Blood Shards ◆ — SOFT / action currency
- **Faucets (earned by play only):** feeding (per kill, weighted by enemy value),
  night-depth, risk actions (answered knocks, basin), objectives.
- **This is the night PURSE** (see §6): provisional during a night, banked at dawn.
- **Sinks:** build lanes (§5) — the only thing that buys *power*.
- **Rule:** never purchasable with money. Never minted by an ad. Earned only by
  playing. This is the guarantee behind D6.

### 4.2 Premium currency (name TBD — themeable, e.g. "Moonstone" / "Relic") — HARD
- **Faucets:** slow drip from tasks / milestones / achievements, **or** bought with
  money.
- **Sinks:** cosmetics (§7 identity), relief (revive/keep-purse), remove-ads,
  season pass. **Never** buys build power or Blood Shards.
- **Rule:** the *only* currency money can touch, and it can *only* buy relief +
  identity + access. Enforced in code by the integrity invariant (#20).

> Net effect: `money → premium → {relief, identity, access}` and
> `play → shards → power`. The two arrows never cross. That is D6, in plumbing.

---

## 5. Build specialization (the spend valve — #12)

Replace the flat 5-line permanent upgrades with **three lanes you cannot fully own
at once**. Each produces a genuinely different night.

- **The Glutton** — feeder / glass-cannon: claw damage, blood-from-kills
  (lifesteal), attack speed. Leans *into* forced feeding; aggressive.
- **The Warden** — fortress: door HP, repair & barricade value/speed, plank
  economy. Holds ground; feeds minimally.
- **The Shade** — evasion: move speed, dash, quiet/stealth, sight. Never fights;
  slips the night.

Commitment mechanism (pick one in implementation, `[tune]`): hard lane cap, or
respec cost, or a points pool too small to max >~1.5 lanes. The point: **every
night you commit to a strategy, and that commitment reshapes the run.** Spent with
Blood Shards only.

---

## 6. The night purse + bank-vs-risk + permanent floor (#11)

- The purse is **Blood Shards earned during the night**, scaled by `nightHeat`
  (deeper/harder night = richer purse). Feeding + depth + risk fill it; idle
  survival fills it slowly.
- The purse is **provisional** and shown at-risk in the HUD ("◆ 40 AT RISK").
- **At dawn:** the full purse banks.
- **On death before dawn:** you **forfeit most of the purse**, but a **permanent
  floor always banks** (a guaranteed minimum, `[tune]` e.g. ~15–25% or a flat
  small amount) so every run still advances you. This is D2 — the tension of loss
  *and* the comfort of always progressing.
- Today's code banks shards even on death (`beginDying → addBloodShards`); this is
  **reversed** — death banks only the floor.

Optional (design in, flag as follow-up): a mid-night bank point (safe/altar action
that locks in partial purse at a cost) to deepen the decision.

---

## 7. Monetization spec (Ethical F2P — #16)

Three pillars. All buyable with the premium currency; premium is earnable slowly
for free and buyable with money.

1. **RELIEF (the crown jewel).** At the death screen with an at-risk purse — the
   highest willingness-to-pay moment — offer **revive-and-keep-purse** via IAP or
   an opt-in rewarded ad. Archero-style (D9): a short decision timer, and the
   offer *shows what's at stake* ("keep your ◆40"). Once per night, opt-in, never
   forced. Sells relief from loss, not power.
2. **IDENTITY.** Cosmetics tied to the three builds — coats, claw/feed FX, death &
   dawn screens, titles. Composited over the GLB without touching the model file.
   Every cosmetic also earnable with the premium currency for free.
3. **ACCESS.** Remove-ads IAP. Phase 2: a **cosmetic season pass** riding the
   curiosity cadence (§ curiosity), Fortnite-style — buying it doesn't unlock
   everything; you **play** to earn the tiers.

Ads: opt-in, reward-only, hard-capped, never interstitial/forced. Turn on the
scaffolded system (`SHOP_CONFIG.ads.provider`), retire the "NO ADS" marketing line
for the honest "ads are opt-in and reward-only." With provider `none`, zero ad
affordances render (keep that).

**Integrity invariant (#20):** a money/premium purchase may grant only from an
allowlist `{ relief, cosmetic, title, removeAds }`. It may never grant Blood
Shards, build power, or a stat. Enforced at `IAP.grant()` and covered by a
catalog-sweep test in `server/test.mjs`.

---

## 8. Progressive disclosure — the cadence (D8)

Do not show the whole economy on Night 1. Reveal it layer-by-layer as the player
is hooked (Survivor.io's masterclass — hook on fun *before* friction).

Reference cadence (`[tune]`):

- **Night 1 (Guided Win):** pure gameplay + the first feed + the first bank. No
  store, no premium currency shown. End at dawn with a small banked purse.
- **Night 2:** forced feeding + bank-vs-risk go live; the purse is now truly at
  risk; the death-screen relief offer can appear.
- **Night 3–4:** build lanes open (the spend valve); the Blood Market surfaces.
- **Later nights:** premium currency, cosmetics, remove-ads, then (phase 2) the
  season pass; scheduled predator/variant reveals land on set nights.

The existing `nightsAttempted > 0` gate on the Blood Market is the right instinct —
this generalizes it into a full schedule.

---

## 9. Curiosity engine (#15)

Always a visible next thing:

- **Scheduled reveals:** new predator / variant / named escalation on set nights,
  so the player knows something new is coming and pushes to see it.
- **Milestone unlocks:** reach night N / bank X premium / master a lane → a codex
  entry, a build tier, a cosmetic, a title.
- **Variable-ratio dopamine:** the knock/gift (#6) is the "pull the lever" moment —
  rare enough to matter, frequent enough to tease.
- The menu and post-run screens always show the *next* thing to chase.

---

## 10. Difficulty ↔ power curve (#13)

`nightHeat` escalation and build-power steps are **one co-designed curve**. Each
survived night's increase is answerable by one more investment; past the intended
depth `N`, the stat curve flattens while threat keeps rising, so **mastery**
(reads, positioning, risk) becomes the differentiator. No hard wall before `N`.
Escalation varies in *kind* (variants, enemy mix, door pressure), not only count.

---

## 11. External benchmarks (what we borrowed, and from where)

- **Archero** — revive-on-death (30 gems, 5s timer, "your build is good, don't
  lose it"); dual currency (coins from kills = soft, gems = hard/stingy); permanent
  gear + in-run picks that reset; "tempt, never force." → our §7 relief, §4
  currencies, §5 builds.
- **Survivor.io** ($5M/mo) — **progressive disclosure** of monetization; ads as
  early subsidy, gacha/pass layered later; hook on fun before friction. → our §8
  cadence, §1 Guided Win.
- **Fortnite / Dota 2** — cosmetic-only, level playing field, skill decides;
  battle pass earned by *playing*, not bought outright; scarcity + identity sell
  cosmetics. → our D6, §7 identity + season pass.
- **Hades / Vampire Survivors** — permanent meta so "even if you fail you're one
  step closer"; hub breather → "one more run." → our D2 permanent floor.
- **Economy orthodoxy** (Unity/Mobile-F2P) — design the core loop first; economy is
  faucets & sinks placed *in* the loop; monetization is "just another sink/faucet"
  that respects the player's time. → our pillar 1.

Sources: gamesforum (Survivor.io $5M/mo), Game Developer (Archero; Dota 2 not
pay-to-win), Deconstructor of Fun (Archero; Fortnite), Mobile Free To Play
(core loop), Unity & DEV.to (sources/sinks), ResetEra (roguelite meta).

---

## 12. Issue map (implementation)

**Epic #3 — In-run survival economy**
- #4 forced-feeding tuning · #5 blood-clock legibility · #6 knock-as-skill ·
  #7 FTUE · #8 goal-draw anti-conflict · #9 instant retry

**Epic #10 — Compulsion economy**
- #21 dual-currency model (§4) — **foundational, precedes #11/#12** ·
  #11 night purse + bank-vs-risk (+ **permanent floor**, §6) · #12 build
  specialization · #13 difficulty↔power curve · #14 Guided-Win Night 1 ·
  #22 progressive disclosure cadence (§8) · #15 curiosity cadence

**Epic #16 — Monetization (Ethical F2P)**
- #17 relief at bank-vs-risk (+ Archero refinements, §7·D9) · #18 rewarded ads +
  remove-ads · #19 cosmetic identity · #20 integrity invariant · *(phase 2)*
  season pass

**Epic #23 — Visual communication** (presentation layer; see §15)
- #24 diegetic blood (body = clock) · #25 the feed verb · #26 attract-mode loop
  vignette · #27 adaptive HUD priority

---

## 13. Guardrails (every issue)

- **Mobile-first**; diegetic / horror tone; **no placeholder or dummy** — real
  logic, real tuning, wired end to end.
- Don't break the harness: `tools/glbtest.mjs`, `tools/clicktest.mjs`,
  `tools/harness.mjs`, `server/test.mjs`. Extend them to prove new economy
  behaviour deterministically.
- Security: the Midtrans server key never ships in the client bundle; grants only
  after settlement/consume/acknowledge (`src/shop/config.js`, `docs/IAP.md`).
- The byte-exact GLB rule stands (`tools/glbtest.mjs` 18/18) — cosmetics composite
  over the model, never modify it.

---

## 15. Visual communication — the game reads itself (Epic #23)

Solid backend logic is wasted if the player can't *see* and *understand* it. The
game already communicates **mood** at an AAA level; this layer adds the **loop**.

Three channels a game communicates through, and where we stand:

1. **Pre-play identity (5-second read).** Weakest today — the menu sells
   atmosphere, not the verbs (defend, feed, race the clock).
2. **Moment readability.** Strong bones (clock rail, door bearings, hunger
   language) but two core gaps: **blood reads as "health," not a clock**, and
   **feeding reads as score numbers, not the refill verb**.
3. **Systemic legibility.** The new economy (purse, builds) needs deliberate viz,
   and the flat HUD needs an attention layer to make room.

**Principle:** keep the AAA mood, add the loop. Show the systems diegetically (on
the body, in the world); reserve the flat HUD for what can't be shown; let
attention follow the moment.

**Locked visual decisions:**

- **D-V1 — Blood is diegetic, on the body** (#24). The primary "how close to
  death" read moves onto the vampire: the moonlight rim intensifies and the body
  desaturates as hunger grows; feeding briefly sates her. The HUD bar is demoted
  to a secondary readout. This is what makes "blood is a clock" read as a clock —
  the single biggest visual lever.
- **D-V2 — Show the loop before play** (#26). The menu plays a short silent
  gameplay vignette (chased by the clock, a door draining, a feed) so a new
  player learns the verbs in ~5 seconds — taught through the eyes, not text.
- **D-V3 — Adaptive HUD priority** (#27). The HUD spotlights what's urgent now and
  dims the rest (calm → clock; door attack → that door + blood; panic →
  survival), which also seats the incoming purse (#17) and build badge (#19).

**The feed verb** (#25): feeding is the core verb of a feed-economy, so it must be
the juiciest, most legible beat — a visible drink/absorb, the blood filling with a
gulp, a momentary satiation, and enemies that read as food.

---

## 16. Still open (not final)

- Premium currency name/theme.
- Exact `[tune]` values: purse formula, permanent-floor %, lane commitment
  mechanism, cadence night numbers, difficulty depth `N`.
- Whether the rewarded-ad crate mints premium currency or only cosmetics/relief
  (classify in #20).
- Mid-night bank point (§6) — in or out.
- Visual `[tune]`: desaturation curve for hunger, vignette length, HUD emphasis
  weights.
- Balance of the 5 predators against the three new builds (future pass).
