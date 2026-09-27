# LAST NIGHT — Story Bible & Cinematic Design

*Living narrative doc. Source of truth for the story and how it is delivered.
Companion to `docs/DESIGN.md` (systems). When an issue draft disagrees, this
doc wins for anything narrative.*

Status: **spine locked** (owner decisions below). The authored beat text here is
the canon; `[draft]` lines are placeholders for the writing pass to refine, never
to contradict.

---

## 0. Logline

**LAST NIGHT is not about surviving. It is about not being allowed to die.**

A vampire wakes hungry in a house that will not let her leave. Every night the
siege comes; she feeds to live; the dawn that should burn her only resets the
walls. The story is *why* — uncovered across repeated nights — and a final
choice: walk into the true dawn and be free, or stay and become the house's
monster forever.

## 1. Pillars (owner-locked)

- **P1 — The house is a living prison / curse.** It keeps her alive by feeding
  her enemies to feed on. The loop is punishment *and* protection. Dawn does not
  free her; it resets the siege. ("The house remembers" is literal.)
- **P2 — Sympathetic tragedy.** We fear her *and* pity her (Carmilla). Her hunger
  is not villainy — it is a curse she carries. The player must relate to the
  monster.
- **P3 — The ending is a choice.** At the arc's climax: **break the loop** (walk
  into the true dawn — burn, be free — **DAWNBREAKER**, tragic release) **or**
  **embrace the monster** (refuse the dawn, feed forever, become the house's
  thing). Earned by how you played + a final decision.

## 2. Delivery method (research-backed, honest to the tech)

The art is procedural 2D canvas + the GLB + Web Audio — **no video, no
pre-rendered cutscenes**. "Cinematic" is achieved through:

1. **Show, don't tell (environmental storytelling).** The rooms carry the story
   in three layers — *architecture* (the floor plan), *surface* (stains, decay =
   time passed), *object* (a personal item = a person + an event). Meaning stays
   **open**; horror is implicative, never explained flat.
2. **Death/repetition IS the story (roguelite).** Each night and each dawn
   advances the arc; the loop is not a backdrop, it is the plot. Beats are hung on
   the existing reveal cadence (`REVEALS` in `src/game/economy.js`, #15).
3. **The monster's interior voice.** A spare, gothic first/second-person murmur —
   her thoughts and the house's whisper — delivered in fragments, never exposition.

Delivery surfaces (all already exist or are seamed):
- **Dawn-cards** — a short procedural interstitial after each survived dawn (the
  room in first light + one line + grade + audio). The strongest cinematic slot.
- **Bottom narrative strip** — the reusable slot from #31; in-run diegetic lines.
- **Environmental room fragments** — each named room holds one discoverable detail.
- **The knock** — the recurring mystery/voice (its "gift" outcome can carry a
  memory fragment).
- **The codex/collection** — the collected fragments (repurpose the existing CODEX).
- **The attract vignette (#26)** + menu — mood and hook.

## 3. The protagonist — VALEN (the vampire)

The uploaded GLB is her. Ancient, alone, the last of a line. She woke hungry
because **something woke her**. She is not proud and not repentant — she is
*tired*, and the hunger never is. She remembers almost nothing at first; the
house gives her memory back one night at a time, and she does not always want it.

Voice: sparse, cold, occasionally tender. First person for her interior
("I know this door. I sealed it."), second person for the house's address to her
("You have done this before."). Never over-explains. `[draft]` lines below.

## 4. The house — the antagonist (a place, not a person)

The mansion is the villain, and it is *sympathetic-adjacent* too — it may have
been built to protect her, or to cage her; the ambiguity is the point (P1). It
**remembers every dawn** and grows the siege (already true in `nightHeat`). Its
rooms are her biography:

- **Hall / dining** — where she wakes; the servant door that always shakes first.
- **Chapel & altar** — she was consecrated here, or damned here. The altar light
  slows the siege because the house's own faith still lingers.
- **Glass wing / oratory** — the sun's room. She cannot bear it. Someone loved
  the light here once. (Ties to the dawn paradox.)
- **Study & ward lamp** — someone tried to **bind** her (or bind the house shut).
  The ward still works, barely.
- **Basement / blood basin** — the oldest hunger; what the house fed her before
  it learned to send her enemies.
- **Kitchen / larder** — a colder, human mercy; feeding here is loud because the
  house wants her *out* among the siege.
- **Gatehouse / stakes / palisade** — **the hunters' own weapons**, left behind
  and repurposed. They came for her and never left either.

## 5. The dawn paradox (the engine of the mystery)

The sun kills vampires. Reaching dawn should end her. It does not — she wakes the
next night, hungrier, the siege heavier. **That impossibility is the hook.** The
player, like Valen, slowly understands: dawn here is a *false* dawn the house
raises to keep her; the **true dawn** (the ending) is the one thing the house
cannot allow, because it would set her free. `Codex: "The sun does not care who
wins. It only arrives."` becomes a promise, not a threat.

## 6. The knock (the recurring voice)

Something knocks. Sometimes nothing, sometimes a monster, sometimes a gift. Across
the arc, the **gift knocks carry fragments of the truth** — a memory, a name, a
line the house did not want her to have. The knock is the crack in the prison: it
is how the way out reaches her. Who knocks is left open (the one who bound her /
her buried self / the house's guilt). `Codex knock line stays canon.`

## 7. The cast, reframed as story (not just enemies)

- **The dead (zombie/crawler)** — the ones **she** made. The night learning your
  habits = her own victims returning. Guilt, embodied.
- **The hunters** — humans who tracked her here with crossbow and stake. They
  died on the palisade and the house keeps them too. (Their tools are your fort.)
- **The werewolf / ghoul** — beasts drawn to so much blood in one place; the
  ghoul eats the wood because it wants *her*, not the door.
- **The stalker** — moves only unseen, never breaks a door, is simply *inside*
  when you open one. The truest face of the curse: it is patient because the house
  has forever. `"Running is consent."` — you cannot outrun what you are.

## 8. The arc (three acts, hung on the night cadence)

Beats fire on specific nights via the reveal schedule (`REVEALS`, #15) and on
dawn-cards. `[draft]` text is illustrative canon, to be polished in the writing pass.

### Act I — The Waking (nights 1–3): *"Something woke you."*
She thinks it is an invasion to survive. The house feels like hers, but wrong.
- N1 dawn-card: *"I woke with the taste of the servant's blood already in my mouth.
  I do not remember opening the door."*
- N2 (the dead learn your doors): *"I know these faces. I made these faces."*
- N3 (the hunters): *"They came with stakes. The house kept the stakes. It kept
  them, too."*
- Act turn: the besiegers are not random — they are her past, and the house feeds
  it to her.

### Act II — The House Remembers (nights 4–7): *"You have done this before."*
Repetition surfaces: the same knock, the same false dawn, rooms rearranged.
- Environmental reveals: the altar (consecration/damnation), the glass wing (the
  light she lost), the study ward (someone tried to bind her).
- A gift-knock delivers the first true fragment: *"You asked to be kept safe. You
  did not ask for how long."*
- Act turn: dawn does not free her. She wakes again. **The house is keeping her.**

### Act III — The Long Dawn (nights 8+): *"The house will never let you leave."*
The alpha, then the stalker — the curse shows its face.
- The knock offers the way out: the **true dawn** the house has been hiding.
- Climax: **the choice** (§9).

## 9. The ending — the choice (P3)

At the climax the player decides, framed diegetically (a final knock / the glass
wing at true dawn):

- **DAWNBREAKER — break the loop.** She walks into the true dawn. It burns. She is
  free. Tragic release — the "reward for losing" the whole game trained: the only
  way to win is to stop surviving. (Gives the existing `DAWNBREAKER` title its
  meaning.)
- **THE HOUSE'S MONSTER — stay.** She refuses the dawn and remains. The hunger
  wins; she becomes fully the thing the house made. The siege becomes *hers* to
  command; the loop continues, but she is no longer its prisoner — she is its
  heart. (A darker "power" ending, tied to the defiant/monstrous read.)

The choice reads off how you played (fed-and-daring vs hoarded-and-hid) *and* a
final decision, so it feels earned, not menu-picked.

## 10. Writing guide (voice & restraint)

- **Fragments, not exposition.** One line at a time. Never state the whole truth;
  let the rooms and the repetition carry it.
- **Sensory + specific.** "The taste of the servant's blood," not "you are a
  vampire." Objects and bodies, not lore-dumps.
- **Ambiguity is a feature (within P1/P2).** The house's motive stays double —
  prison or protection — until the end, and even then not fully closed.
- **Diegetic always.** No narrator explaining rules; her voice and the house's.
- **Mobile-legible.** Lines are short enough for the bottom strip and a dawn-card
  at phone width.

## 11. Canon vs new
- **Canon (keep):** the CODEX entries, "you woke hungry / the servant door,"
  "survive until dawn," the knock line, "the house remembers," the stakes/hunters,
  DAWNBREAKER, the room names.
- **New (this bible):** the loop-as-prison premise, the dawn paradox as the
  mystery, the cast reframed as her past, the three-act arc, the ending choice,
  the delivery system.

## 12. Implementation seams → Epic (Narrative & Cinematics)
- A **narrative director** (data-driven beats → the bottom strip #31 slot,
  dawn-cards, room fragments; hung on `REVEALS`/#15 and room-enter).
  Landed in `src/game/narrative.js`. Once-only beats persist on `save.beats`.
  Dawn-cards wait in `save.pendingDawn`. Urgent guidance pre-empts a murmur;
  the murmur resumes. Adding a line is a table row, not new control flow.
- **Dawn-card interstitials** after each survived dawn.
- **Environmental room fragments** (one discoverable detail per named room).
- **The arc content + the knock's fragment thread** (the authored beats here).
- **The ending choice** (branching climax; DAWNBREAKER vs stay).

## 13. Guardrails
- Diegetic, gothic, restrained — no exposition dumps, no narrator.
- Mobile-first; lines fit the strip and dawn-cards at phone width.
- No new art/video assets — procedural + the room plates + grade + audio only.
- Don't break the systems in `docs/DESIGN.md`; the story rides the existing loop,
  reveal cadence (#15), and the #31 strip slot. No placeholder — real, final copy.
- Respect the byte-exact GLB rule and the harness.
