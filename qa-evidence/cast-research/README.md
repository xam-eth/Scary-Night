# Cast research — candidate packs vs current cast (visual-sync follow-up)

Status: RESEARCH / PROTOTYPE. Nothing wired into the game yet. User mandate:
research candidate free packs, prototype them in a lineup next to the current
cast, SHOW the result before any wiring decision.

## Candidates scanned (GitHub, 2026-10-23)

| Source | License (verified in-repo) | Verdict |
|---|---|---|
| KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (★60) | **CC0 1.0** (LICENSE.txt) | PROTOTYPED — heroes |
| KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 (★28) | **CC0 1.0** (same author/pack family) | PROTOTYPED — horde |
| trebeljahr/quaternius-showcase, chibifire-stages/quaternius-stage, beep2bleep/FreeAssetsBy… | CC0 / NOASSERTION mirrors | backup pool, not prototyped |
| current in-game: egyptian_people.glb, polyart_zombies…glb | free packs | measured as OFF-theme (see visual-sync-audit/) |

KayKit packs downloaded via codeload tarball into `tools/.cache/kaykit/`
(gitignored — NOT in the repo yet; commit decision follows the wiring choice).

## Prototype method

`node tools/probe-cast-candidates.mjs qa-evidence/.tmp-cast-proto`
Studio lineup under one neutral rig, plus a second pass under the survival
world's bright daylight rig. Left→right: egyptian Commander (current captain),
KayKit Knight, KayKit Barbarian, polyart shambler (current horde), KayKit
Skeleton_Minion, KayKit Skeleton_Warrior. Heights normalised to 1.75 m.

## What vision review found

- The four KayKit figures read as ONE art family: chunky stylised proportions,
  saturated flat-ish shading, big readable silhouettes. Under the world's
  bright daylight they pop with colour exactly like the bailey props/flags
  (proto-daylit.png) — the world-sync the audit found missing.
- The egyptian captain (semi-real skin shading, white kilt) and the polyart
  shambler (thin realistic proportions, modern dress) sit visibly outside that
  family in every lighting pass — same desync the user reported from device.
- Skeleton horde matches the concept sheet's undead direction: Minion = peasant
  undead in brown rag tunic (≈ 03-enemy-ghoul), Warrior = horned-helm undead
  soldier with crimson scarf (≈ 04-enemy-undead-soldier), glowing eyes give the
  night-read the current pack lacks.
- Clip inventory is rich and maps cleanly onto the game rig API:
  Knight 76 anims, Skeleton_Minion 95 anims; both include `Idle`, `Walking_A…C`,
  `Running_A…C`, `Death_A/B (+_Pose)`, jump/attack families; skeletons add
  `Spawn_Ground`/`Spawn_Air` (horde emergence) — current polyart pack has none.

## Proposed mapping IF the user approves wiring (not done yet)

| Game role | Source | Notes |
|---|---|---|
| captain | KayKit Knight | grade to concept 01 blue/gold; pack ships 25+ accessories (plume/helm options) |
| soldier/guard | KayKit Barbarian or Rogue_Hooded | grade to blue gambeson (concept 02) |
| shambler/ghoul | Skeleton_Minion | Spawn_Ground for emergence |
| runner | Skeleton_Rogue | |
| breaker/bruiser | Skeleton_Warrior | |
| screamer/caster | Skeleton_Mage | |

Open deviation to flag: KayKit proportions are chibi (~3 heads) while the
concept PNGs are realistic-proportioned; the chibi read matches the world's
chunky stylisation and gameplay-distance readability, concepts stay the
palette/narrative reference. User decides.

License: CC0 1.0 Universal — free commercial use, no attribution required
(credit Kay Lousberg / kaylousberg.com appreciated, will add to CREDITS.md).
