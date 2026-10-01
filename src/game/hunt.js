/* LAST NIGHT — the Hunt
 *
 * The spine. The core loop says SURVIVE TONIGHT; this says why tonight is not
 * the same as last night. You came to kill the thing that owns this house.
 * On the first night it is far too strong to face, so every night — won or
 * lost — is a step closer: you learn it, you take its weaknesses, you arm
 * yourself. The track only ever moves forward. A night is never wasted.
 *
 * The rule that matters most is in bankNight() below: no run, however short
 * or hopeless, banks zero. That is the whole difference between a score and a
 * hunt, and it is the single highest-leverage line in the game.
 *
 * Governing spec: docs/PURPOSE.md (§2 P2, §5). The fortress and the weapons
 * read progression off this same block later; the story unlocks along it.
 */

import { NIGHT_DURATION } from '../core/config.js';

/**
 * Intel: discrete facts about the Master, learned by playing. Each is banked
 * once, ever — the second werewolf teaches you nothing new, the first one
 * taught you the pack exists. They read as a hunter's journal because that is
 * what they are: knowledge written down so the next night is not blind.
 */
const INTEL_LIST = [
  /* ---- what it sends ---- */
  { id: 'foe:crawler', kind: 'foe', key: 'crawler', track: 1.4,
    line: 'IT SENDS THE SMALL ONES FIRST. THEY GO UNDER A DOOR I HAVE BARRICADED.' },
  { id: 'foe:zombie', kind: 'foe', key: 'zombie', track: 1.4,
    line: 'THE SERVANTS DID NOT LEAVE THIS HOUSE. THEY WERE KEPT.' },
  { id: 'foe:werewolf', kind: 'foe', key: 'werewolf', track: 1.8,
    line: 'A HOUND, AND IT WEARS A MAN’S SHOULDERS. IT IS NOT THE MASTER.' },
  { id: 'foe:ghoul', kind: 'foe', key: 'ghoul', track: 1.8,
    line: 'THE HOUSE KEEPS A THING THAT EATS WHAT THE MASTER DISCARDS.' },
  { id: 'foe:hunter', kind: 'foe', key: 'hunter', track: 2.0,
    line: 'ONE OF THEM WEARS A HUNTER’S COAT. IT WAS ONE OF US ONCE.' },
  { id: 'foe:stalker', kind: 'foe', key: 'stalker', track: 2.2,
    line: 'SOMETHING WALKS THE HALLS THAT DOES NOT WANT TO BE SEEN. IT HUNTS THE WAY I DO.' },

  /* ---- where it keeps things ---- */
  { id: 'room:kitchen', kind: 'room', key: 'kitchen', track: 1.0,
    line: 'THE SCULLERY STILL HOLDS ITS KNIVES. SOMEONE COOKED HERE FOR A CROWD.' },
  { id: 'room:study', kind: 'room', key: 'study', track: 1.0,
    line: 'HIS DESK. THE LEDGER OF NAMES HAS A PAGE FOR TONIGHT.' },
  { id: 'room:library', kind: 'room', key: 'library', track: 1.0,
    line: 'THE MASTER READS. ONE MARGIN IS IN MY HAND, AND IT IS ABOUT ME.' },
  { id: 'room:basement', kind: 'room', key: 'basement', track: 1.4,
    line: 'BENEATH THE HOUSE: A CELLAR THAT WAS NEVER MEANT TO BE FOUND.' },
  { id: 'room:chapel', kind: 'room', key: 'chapel', track: 1.4,
    line: 'A CHAPEL UNDER THE HOUSE. IT PRAYS TO THE THING THAT OWNS IT.' },
  { id: 'room:conservatory', kind: 'room', key: 'conservatory', track: 1.2,
    line: 'GLASS, AND SOMETHING GROWN IN IT THAT IS NOT A PLANT.' },
  { id: 'room:gallery', kind: 'room', key: 'gallery', track: 1.2,
    line: 'PORTRAITS OF PEOPLE WHO CAME HERE. EVERY ONE OF THEM DATED.' },
  { id: 'room:oratory', kind: 'room', key: 'oratory', track: 1.2,
    line: 'A ROOM FOR PRAYER AT THE BACK OF THE HOUSE. SOMEONE PRAYED TO BE LET OUT.' },
  { id: 'room:gatehouse', kind: 'room', key: 'gatehouse', track: 1.2,
    line: 'THE GATEHOUSE IS A FORT ALREADY. WHOEVER BUILT IT EXPECTED A SIEGE.' },

  /* ---- what the night itself taught ---- */
  { id: 'peak:crescendo', kind: 'peak', key: 'crescendo', track: 2.0,
    line: 'THEY COME ALL AT ONCE BEFORE DAWN. THE MASTER IS IMPATIENT.' },
  { id: 'peak:frenzy', kind: 'peak', key: 'frenzy', track: 2.0,
    line: 'WHEN THE MOON GOES RED THE HOUSE LOSES ITS GRIP. SO DO I.' },
  { id: 'peak:duel', kind: 'peak', key: 'duel', track: 3.0,
    line: 'I HAVE LOOKED AT THE ALPHA AND LIVED. IT WAS TESTING ME.' },
  { id: 'peak:dawnbreak', kind: 'peak', key: 'dawnbreak', track: 2.4,
    line: 'SUNLIGHT BURNS THEM, AND THE MASTER KNOWS IT. IT KEEPS THEM OFF THE EAST WALL.' },

  /* ---- what you did ---- */
  { id: 'deed:first-night', kind: 'deed', key: 'first-night', track: 3.0,
    line: 'I HAVE HELD A WHOLE NIGHT. THE HOUSE IS NOT ENDLESS.' },
  { id: 'deed:kills-25', kind: 'deed', key: 'kills-25', track: 2.0,
    line: 'TWENTY-FIVE OF ITS HOUNDS. THE PACK IS THINNER THAN IT WAS.' },
  { id: 'deed:doors-held', kind: 'deed', key: 'doors-held', track: 2.0,
    line: 'NOT ONE DOOR FELL. THE WOOD HOLDS WHEN I AM THERE TO HOLD IT.' },
  { id: 'deed:hunt-near', kind: 'deed', key: 'hunt-near', track: 0,
    line: 'IT WALKS THE HALL ITSELF NOW. IT KNOWS MY NAME.' },
  /* ---- the end ---- */
  { id: 'deed:the-master', kind: 'deed', key: 'the-master', track: 0,
    line: 'IT IS DEAD. THE HOUSE DOES NOT KNOW WHAT TO DO WITH A MORNING.' },
];

export const INTEL = Object.freeze(Object.fromEntries(INTEL_LIST.map((i) => [i.id, i])));

/** The five visible states of the house, and the hunt progress that earns them. */
export const FORTRESS_STATES = Object.freeze([
  { level: 0, at: 0, name: 'ABANDONED HOUSE' },
  { level: 1, at: 15, name: 'SAFE HOUSE' },
  { level: 2, at: 35, name: 'FORTIFIED HOUSE' },
  { level: 3, at: 60, name: 'HUNTER’S KEEP' },
  { level: 4, at: 85, name: 'THE LAST FORTRESS' },
]);
/** The track at which the Master can be cornered and the hunt ended. */
export const HUNT_END_AT = 100;

/* ---- the last night (#56 P1): the hunt has a destination -----------------
 * The whole spine is a walk toward one door. When the track is full the
 * Master is not a rumour any more: it comes, and the Boss-Duel is the kill.
 * Kill it and the hunt is over — that is the ending, earned, not granted.
 */

/** The track is full: tonight the Master itself will come for her. */
export function masterReady(save) {
  return huntProgress(save) >= HUNT_END_AT;
}

/** It is dead, and the house is hers. Recorded once, ever. */
export function masterDown(save) {
  return !!huntBlock(save).masterDown;
}

/** Put the Master down. The night it happened is the night it is banked on. */
export function fellMaster(save) {
  const h = huntBlock(save);
  if (h.masterDown) return false;
  h.masterDown = true;
  h.masterDownNight = h.nights + 1;
  return true;
}

/* ---- THE ARMOURY (#56 P5) — the mid-term ladder --------------------------
 * The three weapons are a row, not a ladder: claw, sword and crossbow are
 * choices about how you fight, and raising one above the others would make
 * the other two wrong. What climbs instead is the metal she carries.
 *
 * Three temperings, each waiting on the same two things: what the hunt has
 * LEARNED (intel) and what it has GATHERED (materials). Both are banked by
 * every night, won or lost — so the ladder is death-into-progress too, and a
 * bad night still buys the next rung. Marthe forges the moment both are in
 * the room, which is why the reward lands at the hub and not in a shop.
 *
 * docs/PURPOSE.md §5 (goal layer 2) and §2 (materials toward weapons that can
 * actually hurt the Master).
 */
export const ARMOURY = Object.freeze([
  { id: 'silver', name: 'SILVERED', intel: 6, cost: 30,
    effect: 'SILVER BITES THE HOUNDS',
    line: 'I PUT SILVER IN THE STEEL. THE HOUNDS WILL FEEL THE DIFFERENCE.' },
  { id: 'blessed', name: 'BLESSED', intel: 12, cost: 70,
    effect: 'THE BLESSING BITES EVERYTHING',
    line: 'I SAID THE WORDS OVER EVERY BOLT. THE HOUSE HEARD ME SAY THEM.' },
  { id: 'ward', name: 'WARDED', intel: 18, cost: 120,
    effect: 'THE FIRST BLOW OF A NIGHT DOES NOT LAND',
    line: 'I SEWED THE WARDS INTO YOUR BELT. THE FIRST BLOW WILL NOT LAND.' },
]);

export const ARMOURY_BY = Object.freeze(Object.fromEntries(ARMOURY.map((t) => [t.id, t])));

/** The temperings already forged, in ladder order. */
export function armouryHeld(save) {
  const h = huntBlock(save);
  return ARMOURY.filter((t) => h.forged.includes(t.id));
}

/** What she carries into the night, as the fight reads it. */
export function huntKit(save) {
  const h = huntBlock(save);
  return {
    silver: h.forged.includes('silver'),
    blessed: h.forged.includes('blessed'),
    ward: h.forged.includes('ward'),
  };
}

/**
 * The next rung, and exactly what it is still waiting on. `need` is the gate,
 * `facts` is what the hunt knows now; `materials` is what is on the table.
 */
export function armouryNext(save) {
  const h = huntBlock(save);
  const t = ARMOURY.find((x) => !h.forged.includes(x.id));
  if (!t) return null;
  const facts = (h.intel || []).length;
  const materials = h.materials || 0;
  return {
    ...t, need: t.intel, facts, materials,
    hasIntel: facts >= t.intel,
    hasCost: materials >= t.cost,
  };
}

/**
 * Forge the next rung if the hunt has earned it — the facts are in and the
 * materials are on the table. Costs nothing when it does not fire, and never
 * forges twice. Returns the tier forged, or null.
 */
export function forgeArmoury(save) {
  const next = armouryNext(save);
  if (!next || !next.hasIntel || !next.hasCost) return null;
  const h = huntBlock(save);
  h.materials = Math.max(0, h.materials - next.cost);
  h.forged.push(next.id);
  return ARMOURY_BY[next.id];
}

/* ---- tonight's errand (P5, the short goal layer) -------------------------
 * Surviving is the clock, not the purpose. Every night the hunt asks for one
 * thing, and the thing it asks for is what the hunt is still missing: the map
 * while the house is unmapped, the pack while its hounds are unmarked, its
 * stalker once it starts sending one, and on the long nights, what the house
 * hoards. docs/PURPOSE.md §2 P5.
 */
export const HUNT_OBJECTIVES = Object.freeze({
  endit: { id: 'endit', label: 'END IT' },
  nests: { id: 'nests', label: 'FIND WHERE IT NESTS' },
  mark: { id: 'mark', label: 'MARK THE BEAST' },
  stalk: { id: 'stalk', label: 'FACE WHAT IT SENDS' },
  hoard: { id: 'hoard', label: 'TAKE BACK WHAT IT HOARDS' },
});

/** The rooms the hunt can still send her into, read off the intel itself. */
const ROOM_KEYS = Object.values(INTEL).filter((i) => i.kind === 'room').map((i) => i.key);

/**
 * Which errand tonight. Chosen by what the hunt still needs, with the seed as
 * the tiebreak, and never the same errand twice running — a rotation the
 * player can predict stops being a reason to go out. Pure: asking does not
 * deal, so the hub can name tomorrow's errand without changing it.
 */
export function pickHuntObjective(save, seed = 1) {
  const h = huntBlock(save);
  const seedN = Math.abs(seed | 0) || 1;
  const knows = (id) => h.intel.includes(id);
  // Nothing left to learn, nothing left to mark: only the kill. The hunt has
  // been walking toward this door the whole time and tonight it opens.
  if (masterReady(save) && !h.masterDown) {
    h.lastObjective = { id: 'endit', night: h.nights };
    return { id: 'endit', target: null, label: HUNT_OBJECTIVES.endit.label };
  }

  const cands = [];
  const missing = ROOM_KEYS.filter((k) => !knows('room:' + k));
  // The first two nights are always the map: a hunter who has never been past
  // the hall is sent to look, and every other errand assumes she knows where
  // she is standing. `must` outranks the no-repeat rule below.
  if (missing.length) cands.push({ id: 'nests', target: missing[seedN % missing.length], w: h.nights < 2 ? 99 : 3, must: h.nights < 2 });
  if (!knows('foe:werewolf') || !knows('foe:ghoul')) cands.push({ id: 'mark', w: 2 });
  if (h.nights >= 8 && !knows('foe:stalker')) cands.push({ id: 'stalk', w: 2 });
  cands.push({ id: 'hoard', w: 1 });

  const last = h.lastObjective && h.lastObjective.id;
  const loose = cands.filter((c) => !c.must);
  const fresh = loose.filter((c) => c.id !== last);
  const use = cands.filter((c) => c.must).concat(fresh.length ? fresh : loose);
  let roll = ((((seedN * 2654435761) >>> 0) * 1103515245 + 12345) >>> 0) / 4294967296
    * use.reduce((a, c) => a + c.w, 0);
  let pick = use[use.length - 1];
  for (const c of use) { roll -= c.w; if (roll <= 0) { pick = c; break; } }

  return { id: pick.id, target: pick.target || null, label: HUNT_OBJECTIVES[pick.id].label };
}

/**
 * Deal tonight's errand and put it on the record, so the next night is not
 * handed the same one. Seeded by the night number rather than by the run, so
 * a night retried is the same errand — the hunt still wants that thing.
 */
export function dealHuntObjective(save, seed = 1) {
  const h = huntBlock(save);
  const pick = pickHuntObjective(save, seed);
  h.lastObjective = { id: pick.id, night: h.nights };
  return pick;
}

/** The night number tonight's errand is seeded from. */
export function huntNightSeed(save) {
  return (huntBlock(save).nights || 0) + 1;
}

/**
 * What tonight's errand is worth to the hunt. Done pays like a fresh fact;
 * half done pays half of it, because the point is that going out was a step,
 * not that it went well.
 */
export function objectiveBonus(objective) {
  if (!objective) return 0;
  if (objective.done) return 1.2;
  return (objective.p || 0) >= 0.5 ? 0.5 : 0;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The hunt block on a save, whatever an older save happened to carry. */
export function huntBlock(save) {
  const s = save || {};
  if (!s.hunt) s.hunt = { track: 0, intel: [], materials: 0, nights: 0, lastGain: null };
  const h = s.hunt;
  h.track = clamp(Number(h.track) || 0, 0, HUNT_END_AT);
  if (!Array.isArray(h.intel)) h.intel = [];
  h.materials = Math.max(0, Math.round(Number(h.materials) || 0));
  h.nights = Math.max(0, Math.round(Number(h.nights) || 0));
  if (!Array.isArray(h.forged)) h.forged = [];
  // a save cannot claim a tempering the ladder does not have
  h.forged = h.forged.filter((id) => !!ARMOURY_BY[id]);
  h.masterDown = !!h.masterDown;
  return h;
}

/** How close the Hunter is to being able to kill the Master, 0..100. */
export function huntProgress(save) {
  return huntBlock(save).track;
}
export function huntPct(save) {
  return Math.round(huntProgress(save));
}

/** The house's visible state: what the progression has bought, in one number. */
export function fortressLevel(save) {
  const p = huntProgress(save);
  let level = 0;
  for (const s of FORTRESS_STATES) if (p >= s.at) level = s.level;
  return level;
}
export function fortressState(save) {
  return FORTRESS_STATES[fortressLevel(save)];
}

/** The tell that plays as the track fills: the hunt has an end, and it is close. */
export function nearingEnd(save) {
  return huntProgress(save) >= HUNT_END_AT - 15;
}
export function huntTells(save) {
  const h = huntBlock(save);
  const out = [];
  if (h.masterDown) out.push('IT IS DEAD. THE HOUSE HAS NO MASTER THIS MORNING.');
  else if (masterReady(save)) out.push('THE HUNT IS FULL. IT CAN BE ENDED TONIGHT.');
  else if (h.intel.includes('deed:hunt-near')) out.push('IT WALKS THE HALL ITSELF NOW. IT KNOWS MY NAME.');
  else if (nearingEnd(save)) out.push('THE HUNT NEARS ITS END. IT KNOWS I AM COMING.');
  return out;
}

export function intelLine(id) {
  const i = INTEL[id];
  return i ? i.line : null;
}
export function knowsIntel(save, id) {
  return huntBlock(save).intel.includes(id);
}

/**
 * Which of the ids are new to this save. Intel is deduped for life: the same
 * werewolf on the tenth night banks nothing, because it taught you nothing.
 */
export function newIntel(save, ids) {
  const h = huntBlock(save);
  const out = [];
  for (const id of ids || []) {
    if (!INTEL[id] || h.intel.includes(id)) continue;
    h.intel.push(id);
    out.push(id);
  }
  return out;
}

/**
 * Bank a night. Win or lose, this returns a gain that is never empty — the
 * hard rule of the spine. What a night yields:
 *
 *   time    how long you stood, up to 5
 *   kills   what you put down, up to 4.8
 *   intel   what you learned, 1.4-3.0 each — the largest and the point
 *   dawn    surviving the whole night, +3
 *   floor   and if all of that is nothing, still 1.2. No wasted run.
 */
export function bankNight(save, result = {}) {
  const h = huntBlock(save);
  const r = result || {};
  const won = !!r.won;
  const survived = clamp(Number(r.survived) || 0, 0, NIGHT_DURATION);
  const kills = Math.max(0, Math.round(Number(r.kills) || 0));

  const before = h.track;
  const levelBefore = fortressLevel(save);
  const intel = newIntel(save, r.intel || []);
  // tonight's errand: the reason this night was not only a clock (P5)
  const objective = r.objective || null;
  const objBonus = objectiveBonus(objective);

  let delta = 0;
  delta += (survived / NIGHT_DURATION) * 5;
  delta += Math.min(kills, 40) * 0.12;
  for (const id of intel) delta += (INTEL[id] ? INTEL[id].track : 1);
  delta += objBonus;
  if (won) delta += 3;
  delta = Math.max(delta, 1.2);                  // the hard rule

  let materials = Math.max(4, Math.round(survived / 60 * 3 + kills * 0.5 + (won ? 8 : 0)));
  if (objBonus >= 1.2) materials += 8;
  else if (objBonus > 0) materials += 3;

  const wasReady = before >= HUNT_END_AT;
  h.track = clamp(before + delta, before, HUNT_END_AT);   // forward only
  h.materials += materials;
  h.nights += 1;
  const gain = {
    won, survived, kills,
    intel,
    // the hunt's end, the first dawn it was possible and the night it happened
    masterReady: !wasReady && h.track >= HUNT_END_AT,
    masterDown: !!(h.masterDown && h.masterDownNight === h.nights),
    objective: objective
      ? { id: objective.id, label: objective.label || HUNT_OBJECTIVES[objective.id].label, done: !!objective.done, p: clamp(objective.p || 0, 0, 1), bonus: objBonus }
      : null,
    materials,
    track: h.track,
    trackBefore: before,
    trackDelta: h.track - before,
    level: fortressLevel(save),
    levelBefore,
    levelUp: fortressLevel(save) > levelBefore,
  };
  h.lastGain = gain;
  return gain;
}
