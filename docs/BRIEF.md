# LAST NIGHT — Game Director Brief (canonical north star)

*Owner-issued design brief (2026-09-29). This is the primary gameplay + visual
reference. When another doc disagrees on **direction**, this wins. `docs/DESIGN.md`
(systems) and `docs/STORY.md` (narrative) remain valid for detail on the systems
they cover, but see "Reconciliation" below for what is now frozen vs active.*

## 0. North star
**LAST NIGHT: how long can you survive before you die?** You are **THE HUNTER**
— a grounded Victorian human monster-hunter trapped in a dark gothic mansion.
The objective is not to kill everything; it is to **SURVIVE UNTIL DAWN**. Time is
the difficulty curve. The strongest feeling is *"I can survive this… wait, what
was that?"* — escalating tension, not power growth.

## 1. Core loop
Enter night → explore/reposition → manage blood + planks → defend doors →
kill or avoid → environmental warning → threat escalates → resources scarce →
final minute (max tension) → **DAWN** → reward/upgrade → next run. Fast restart.

## 2. Player — THE HUNTER
Grounded human hunter (male, 35–45, lean, weathered, Victorian charcoal hunting
coat + hat, gloves, boots). **Not** anime/knight/superhero/steampunk/soldier.
Wields a **sword** (fast, close, high-risk) and a **crossbow** (safe distance,
limited ammo, precise). 3D GLB, humanoid rig. *(The current hunter GLB with
sword/claw/shot clips is this character.)*

## 3. Art direction — the CRITICAL decision
**Stop the 2D-illustrated-world + 3D-character mix** — it makes the character
look pasted on. Target: **stylized 3D / 2.5D gothic survival-horror** where
character AND environment live in the **same physical space** — controlled ~45°
top-down camera, 3D characters, 3D/modular environment, strong shadows,
atmospheric candle/moonlight, readable silhouettes. Not photoreal, not cartoon.

**Approach (owner-locked, path C — incremental):** gameplay stays a **2D
top-down sim** (AI, pathing, doors, camBounds, economy untouched); only the
**presentation** becomes 3D. Phase B first (unify the world into the characters'
three.js scene — shared lights + contact shadows), then swap the highest-impact
elements to modular 3D meshes (doors → key props → walls), toward full modular
3D over iterations. See the Environment epic.

## 4. Camera
Controlled ~45° top-down / isometric, orthographic or controlled perspective,
slight follow, room bounds. Readability over cinematic movement. Do not rotate.

## 5. Systems already satisfying the brief (keep)
Survive-until-dawn + **DAWN IN** countdown · Blood + Planks · Doors
(repair/barricade/break) · Dash · Sword/Crossbow · 3 enemies (Crawler, Hunter,
Werewolf) · **Tension Director** (`director.js`: pressure budget + moods) ·
telegraphing (knocks, door-shake, candle flicker, growls) · pressure↔silence
pacing · HUD (DAWN IN / BLOOD / PLANKS / bottom controls) · mobile controls ·
death screen + TRY AGAIN · VFX decay · the 4-peak climax system.

## 6. MVP scope (brief §25) — DO
1 Hunter · 3 enemies · 1 modular mansion arena · survive loop · sword · crossbow
· dash · blood · planks · doors · repair · barricade · countdown · Tension
Director · basic enemy AI · death · restart · basic progression · mobile controls
· **3D environment · 3D character · lighting · basic VFX · horror audio**.

## 6b. MVP — DO NOT (brief §25)
multiplayer · inventory UI · crafting · large skill tree · procedural mansion
generation · complex/dialogue-heavy story · multiple maps · dozens of weapons ·
account system · full IAP payment integration in the MVP.

## 7. Progression (small)
After a run: currency → small upgrades only (sword dmg, crossbow dmg, dash cd,
max blood, barricade strength). Upgrades keep tension (trade-offs: more damage =
more noise, faster crossbow = less damage, etc.). No large RPG tree.

## 8. Priority order (brief §26)
P0 core (move/combat/AI/blood/death/restart) → P1 survival (timer/doors/planks/
repair/barricade) → P2 tension (director/escalation/warnings/audio/events) →
**P3 visual (3D env/lighting/VFX/polish)** → P4 progression → P5 monetization
architecture only. *Do not polish visuals before the core loop is solid.*

## 9. Reconciliation with what was already built (owner decision 2026-09-29)
The project was built **wider** than this MVP. Owner decision: **FREEZE**, do not
delete — keep the tested systems, stop developing them, refocus 100% on the 3D
survival-horror core.
- **FROZEN (keep, deprioritized):** the rich narrative (dawn cards, act cards,
  ending choice, story bible, narrator, room fragments); the dual-currency
  economy / compulsion loop / bank-vs-risk / lane builds; the full monetization
  (Midtrans, Play Billing, relief SKUs, cosmetics, ads). They stay in the build
  and green; no new work until the core + 3D land.
- **REFRAMED:** the player is **the Hunter** (human), per §2 — the earlier
  "Valen the vampire" framing is superseded for direction; the STORY.md reframe
  itself is part of the frozen narrative and is deferred.
- **ACTIVE FOCUS:** the Environment 2.5D→3D path (§3), the lean survival core,
  readability, tension, horror atmosphere.

## 10. Director test (brief §29) — for any new feature
Does it improve (1) survival, (2) tension, (3) readability, (4) replayability,
(5) horror atmosphere? If not, defer it. Small isolated tasks per agent; don't
let systems get independently redesigned.
