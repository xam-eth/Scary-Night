/**
 * core/save.js — penyimpanan save `save.survival` (perapian 2026-10-21).
 * Pindah dari core/util.js supaya core tidak mengimpor lapis sim: migrasi
 * schema disuntik oleh composition root (game.js) dari sim/economy.js.
 */
/* ---------------- save storage ---------------- */

const SAVE_KEY = 'lastnight.save.v1';

export const defaultSave = () => ({
  shards: 0,
  totalShards: 0,
  relics: 0,                // hard currency. Play drip or money-bought goods. Never power.
  inventory: { arrows: 0, knives: 0, bandages: 0 }, // earned from completed missions
  nightsSurvived: 0,
  nightsAttempted: 0,
  killsBy: {},               // what she has put down, by kind — the refuge wall hangs these
  bestTime: 0,
  bestDefeated: 0,
  upgrades: { blood: 0, speed: 0, repair: 0, damage: 0, recovery: 0 },
  seen: {},                 // collection unlocks
  iap: { owned: {}, revives: 0, pouches: 0 },   // store entitlements (see src/shop/iap.js)
  goals: { done: 0, nights: 0 },                // lifetime objectives
  settings: {
    master: 0.85, music: 0.7, sfx: 0.9,
    shake: 1, flashes: 1, captions: 1, difficulty: 'standard',
    invertPanic: 0,
  },
  weapon: 'claw',             // hunter tool. Never a stat, never a purchase.
  tutorialSeen: false,
  coachFed: false,
  coachKnock: false,
  builds: {},               // lane rank id -> 1. Commitment cap lives in economy.js.
  revealed: {},
  milestones: {},
  privacyAck: false,        // first-run notice; not an account
  deeds: {},                // what the player has actually done; the shop waits on these
  beats: {},                // once-only narrative beats the director has delivered
  pendingDawn: [],          // dawn-card ids waiting for the interstitial
  /* Legacy Hunt progression state, retained for `?legacy=1`. Survival uses
   * the separate `survival` namespace below. */
  hunt: {
    track: 0,               // 0..100, forward only
    intel: [],              // ids of the facts learned about the Master (deduped for life)
    materials: 0,           // what a night yielded toward arming yourself
    forged: [],             // the temperings Marthe has already made (ARMOURY)
    nights: 0,              // nights banked toward the hunt
    lastGain: null,         // the last night's readout, for the death/dawn screens
  },
  fortressLevel: 0,         // the house's visible state, derived from the track
  // The new route owns a parallel save namespace; legacy hunt/IAP fields are
  // retained untouched and remain available through ?legacy=1.
  // The purse (gold), the keep's level/HP and the starting wood/soldiers come
  // from SurvivalMode's own fresh progress: they are deliberately NOT
  // defaulted here, so a pre-K1 save's `oil` / `perapianLevel` can still be
  // told apart and migrated (deepMerge lays these defaults under the save).
  survival: {
    initialized: false, day: 1, phase: 'night', elapsed: 0, nightDuration: 72,
    buildings: {}, gateBuilt: false, gateHp: 0, builderJob: null,
    selectedRoom: null, nightsCompleted: 0, waveIndex: 0, breakerIndex: 0,
    individualIndex: 0, siegeTimers: {}, nightStats: { kills: 0, hits: 0, damageToWalls: 0, keepDamage: 0, mined: 0 },
    lastRewards: null, rewardAck: 0, player: null, entrances: null, enemies: [],
    hints: {}, // FTUE chips already shown (move, auto, banner, keep, flare, build, ...)
  },
});

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else if (over[k] !== undefined) base[k] = over[k];
  }
  return base;
}

export function loadSave(migrate = (save) => save) {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return base;
    return migrate(deepMerge(base, JSON.parse(raw)));
  } catch (e) { return migrate(base); }
}
export function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode */ }
}