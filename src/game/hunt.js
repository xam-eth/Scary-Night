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
  if (h.intel.includes('deed:hunt-near')) out.push('IT WALKS THE HALL ITSELF NOW. IT KNOWS MY NAME.');
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

  let delta = 0;
  delta += (survived / NIGHT_DURATION) * 5;
  delta += Math.min(kills, 40) * 0.12;
  for (const id of intel) delta += (INTEL[id] ? INTEL[id].track : 1);
  if (won) delta += 3;
  delta = Math.max(delta, 1.2);                  // the hard rule

  const materials = Math.max(4, Math.round(survived / 60 * 3 + kills * 0.5 + (won ? 8 : 0)));

  h.track = clamp(before + delta, before, HUNT_END_AT);   // forward only
  h.materials += materials;
  h.nights += 1;
  const gain = {
    won, survived, kills,
    intel,
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
