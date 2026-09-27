/* LAST NIGHT — the night's economy, one source of truth.
 *
 * Issues #4–#9, #11–#15, #21–#22. docs/DESIGN.md wins when an issue draft
 * disagrees (the permanent floor is the locked loss rule, not a total wipe).
 *
 * Forced-feeding math (night 2+, rest, standard difficulty), worst case the
 * player drinks every non-combat source immediately:
 *   start 48
 *   6 vials × 4 = 24, all taken under 70% so they pay full
 *   basin 8 and larder 6 are taken above 70%, so they pay 40% → 3.2 + 2.4
 *   hoard total ≈ 77.6
 *   drain 0.42/s → empty at ≈ 185s (03:05). Paced scavenging (never above
 *   70%) totals 86 and dies at ≈ 205s (03:25). Both miss dawn.
 *   Three crawler feeds (+20 each) put the hoard at 137.6 → 328s. Dawn holds.
 * Night 1 multiplies that drain by 0.48, so one feed reaches dawn. That is
 * the guided win. The floor is not an easy mode.
 */

import { PLAYER, RES, nightHeat, threatMix } from '../core/config.js';

export const LARDER_BLOOD = 6;
export const NIGHT1_DRAIN = 0.48;
export const HIGH_BLOOD_PACK = 0.4;
export const PURSE_FLOOR = 0.2;
export const LANE_CAP = 6;

export const CADENCE = [
  { id: 'purse', night: 1 },
  { id: 'risk', night: 2 },
  { id: 'builds', night: 3 },
  { id: 'market', night: 4 },
  { id: 'relics', night: 5 },
  { id: 'cosmetics', night: 5 },
  { id: 'ads', night: 6 },
];

export const REVEALS = [
  { night: 2, kind: 'note', text: 'THE DEAD LEARN YOUR DOORS.' },
  { night: 3, kind: 'enemy', key: 'hunter', text: 'A HUNTER KEEPS THE TREELINE.' },
  { night: 4, kind: 'variant', variant: 'frenzy', text: 'SOMETHING IN THE PACK RUNS WRONG.' },
  { night: 5, kind: 'enemy', key: 'ghoul', text: 'THE GHOUL COMES FOR THE WOOD.' },
  { night: 6, kind: 'variant', variant: 'marksman', text: 'THE BOLT FINDS THE GAP.' },
  { night: 8, kind: 'variant', variant: 'alpha', text: 'AN ALPHA WALKS WITH THEM.' },
  { night: 10, kind: 'enemy', key: 'stalker', text: 'THE QUIET GROWS A SECOND STEP.' },
];

export const LANES = [
  {
    id: 'glutton', name: 'THE GLUTTON', blurb: 'Feed. The claw is the meal.',
    ranks: [
      { id: 'g_dmg', name: 'LONGER CLAW', stat: 'damage', per: 0.1, cost: 4 },
      { id: 'g_rec', name: 'DEEP DRINK', stat: 'recovery', per: 0.14, cost: 5 },
      { id: 'g_aspd', name: 'HUNGRY HANDS', stat: 'attackSpeed', per: 0.08, cost: 6 },
      { id: 'g_blood', name: 'OPEN VEINS', stat: 'blood', per: 0.05, cost: 7 },
    ],
  },
  {
    id: 'warden', name: 'THE WARDEN', blurb: 'Hold the wood. Feed only when it fails.',
    ranks: [
      { id: 'w_door', name: 'THICKER OAK', stat: 'doorHp', per: 0.12, cost: 4 },
      { id: 'w_rep', name: 'CARPENTER', stat: 'repair', per: 0.16, cost: 5 },
      { id: 'w_plank', name: 'FULL POUCH', stat: 'planks', per: 1, cost: 6 },
      { id: 'w_bar', name: 'DOUBLE BOARD', stat: 'barricade', per: 0.2, cost: 7 },
    ],
  },
  {
    id: 'shade', name: 'THE SHADE', blurb: 'Slip the night. Do not be the meal.',
    ranks: [
      { id: 's_move', name: 'QUIET STEP', stat: 'speed', per: 0.07, cost: 4 },
      { id: 's_dash', name: 'LONG DASH', stat: 'dash', per: 0.12, cost: 5 },
      { id: 's_quiet', name: 'NO FOOTFALL', stat: 'quiet', per: 0.18, cost: 6 },
      { id: 's_sight', name: 'CAT EYES', stat: 'sight', per: 0.1, cost: 7 },
    ],
  },
];

const RANK_BY_ID = Object.fromEntries(LANES.flatMap((l) => l.ranks.map((r) => [r.id, { lane: l.id, rank: r }])));

export function nightIndex(save) {
  return (save && save.nightsSurvived) || 0;
}

export function unlocked(save, id) {
  const row = CADENCE.find((c) => c.id === id);
  if (!row) return true;
  if (save && save.revealed && save.revealed[id]) return true;
  return nightIndex(save) >= row.night - 1;
}

export function markUnlocks(save) {
  save.revealed = save.revealed || {};
  for (const row of CADENCE) {
    if (nightIndex(save) >= row.night - 1) save.revealed[row.id] = true;
  }
}

export function hungerMul(save) {
  return nightIndex(save) === 0 ? NIGHT1_DRAIN : 1;
}

/** Pickup / basin / larder. Kills do not pass through here. */
export function packGain(blood, bloodMax, amount) {
  if (blood / Math.max(1, bloodMax) > 0.7) return amount * HIGH_BLOOD_PACK;
  return amount;
}

export function drainPerSecond(save, running = false) {
  const base = PLAYER.bloodDrain + (running ? PLAYER.bloodDrainRun : 0);
  return base * hungerMul(save);
}

/** Blood left at dawn if the player keeps doing what they are doing now. */
export function projectDawn(blood, timeLeft, save, running = false) {
  const atDawn = blood - drainPerSecond(save, running) * Math.max(0, timeLeft);
  return {
    atDawn,
    failing: atDawn < PLAYER.critBlood,
  };
}

export function killShards(enemy) {
  const v = (enemy && enemy.type && enemy.type.bloodValue) || (enemy && enemy.bloodValue) || 16;
  return Math.max(1, Math.round(v / 10));
}

export function purseFloor(full) {
  if (full <= 0) return 0;
  return Math.max(1, Math.round(full * PURSE_FLOOR));
}

export function tellFor(outcome) {
  if (outcome === 'werewolf') return { class: 'menacing', sound: 'tellWolf', weight: 0.72 };
  if (outcome === 'crawler' || outcome === 'hunter' || outcome === 'ghoul' || outcome === 'zombie' || outcome === 'stalker') {
    return { class: 'menacing', sound: 'tellBreath', weight: 0.55 };
  }
  if (outcome === 'gift') return { class: 'gift', sound: 'tellGift', weight: 0.5 };
  return { class: 'empty', sound: 'tellEmpty', weight: 0.5 };
}

export function revealForNight(nightsSurvived) {
  const night = (nightsSurvived || 0) + 1;
  return REVEALS.find((r) => r.night === night) || null;
}

export function nextReveal(save) {
  const done = nightIndex(save);
  return REVEALS.find((r) => r.night > done) || null;
}

export function nextRevealLine(save) {
  const n = nextReveal(save);
  if (!n) return 'THE HOUSE HAS SHOWN YOU ITS LAST NEW FACE.';
  return `NIGHT ${n.night}: ${n.text}`;
}

export function rankCount(save) {
  const b = (save && save.builds) || {};
  return Object.values(b).reduce((a, n) => a + (n ? 1 : 0), 0);
}

/** A finished lane is a name, not a stat. Money never buys the name by itself. */
export function grantLaneTitle(save, laneId) {
  const lane = LANES.find((l) => l.id === laneId);
  if (!lane || !lane.ranks.every((r) => ownsRank(save, r.id))) return null;
  save.titles = save.titles || {};
  save.titles[lane.id] = lane.name;
  return lane.name;
}

export function houseTitle(save) {
  const t = (save && save.titles) || {};
  return t.glutton || t.warden || t.shade || null;
}

/**
 * One maxed lane is about 1.3×. Count heat matches that through four dawns,
 * then flattens. Kind (door pressure, stalkers) keeps rising — mastery.
 */
export function curveSweep() {
  const lane = 1.3;
  const marks = [0, 4, 8, 12];
  const rows = marks.map((n) => {
    const mix = threatMix(n);
    return { n, heat: nightHeat(n), door: mix.doorMul, stalker: !!mix.stalker };
  });
  const ok = rows.every((r) => r.heat <= 1.56 + 1e-9)
    && rows[1].heat <= lane + 0.02
    && rows[1].heat > 1.2
    && rows[2].stalker
    && rows[2].door > lane
    && rows[3].heat === rows[2].heat;
  return { ok, lane, rows };
}

export function ownsRank(save, id) {
  return !!((save && save.builds && save.builds[id]));
}

export function nextRank(save, laneId) {
  const lane = LANES.find((l) => l.id === laneId);
  if (!lane) return null;
  return lane.ranks.find((r) => !ownsRank(save, r.id)) || null;
}

export function rankCost(save, rank) {
  if (!rank) return 0;
  const mine = RANK_BY_ID[rank.id];
  const other = rankCount(save) - (ownsRank(save, rank.id) ? 1 : 0);
  const cross = LANES.some((l) => l.id !== mine.lane && l.ranks.some((r) => ownsRank(save, r.id)));
  const tax = cross && other >= 2 ? 1.5 : 1;
  return Math.ceil(rank.cost * tax);
}

export function laneStats(save) {
  const out = { damage: 0, recovery: 0, attackSpeed: 0, blood: 0, doorHp: 0, repair: 0, planks: 0, barricade: 0, speed: 0, dash: 0, quiet: 0, sight: 0 };
  const b = (save && save.builds) || {};
  for (const id of Object.keys(b)) {
    if (!b[id]) continue;
    const row = RANK_BY_ID[id];
    if (!row) continue;
    out[row.rank.stat] = (out[row.rank.stat] || 0) + row.rank.per;
  }
  return out;
}

/** Old flat upgrades become the nearest lane rank. Capped at the commitment pool. */
export function migrateSave(save) {
  if (!save) return save;
  save.relics = save.relics || 0;
  save.builds = save.builds || {};
  save.revealed = save.revealed || {};
  save.milestones = save.milestones || {};
  save.beats = save.beats || {};
  save.pendingDawn = save.pendingDawn || [];
  save.coachFed = !!save.coachFed;
  save.coachKnock = !!save.coachKnock;
  if (!save._migratedLanes && save.upgrades) {
    const map = { blood: 'g_blood', speed: 's_move', repair: 'w_rep', damage: 'g_dmg', recovery: 'g_rec' };
    let n = rankCount(save);
    for (const [old, id] of Object.entries(map)) {
      if (!(save.upgrades[old] > 0) || save.builds[id] || n >= LANE_CAP) continue;
      save.builds[id] = 1;
      n++;
    }
    save._migratedLanes = true;
  }
  markUnlocks(save);
  return save;
}

/**
 * Second-by-second hide curve using the same pack rule as the night.
 * Returns the second blood hits 0 if the player never kills.
 */
export function hideDeathSecond(save = { nightsSurvived: 1 }) {
  let blood = PLAYER.bloodMax * 0.48;
  const max = PLAYER.bloodMax;
  const packs = [];
  for (let i = 0; i < RES.bloodPackCount; i++) packs.push(RES.bloodPackValue);
  packs.push(RES.bloodWellValue, LARDER_BLOOD);
  for (const amount of packs) blood += packGain(blood, max, amount);
  const drain = drainPerSecond(save, false);
  return blood / drain;
}
