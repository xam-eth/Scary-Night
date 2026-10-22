/* DUSKHOLD — plots, buildings and the builder queue: TABLES + PURE MATH.
 *
 * Phase 3 seam (b) of sim/survival.js: everything the bailey's economy is
 * MADE OF — the keep/banner tables, the typed build circles and where each
 * one stands (layout B), the building/level tables, the ballista, the
 * Hunter's track, the arms rack — plus the cost/yield math over them. Pure
 * like sim/waves.js: no game, no state; SurvivalMode delegates, the map tool
 * and the harness read the same source. The queue's stateful half (builderJob,
 * the purse, audio, saves) stays on the class in sim/survival.js.
 */
import { clamp } from '../../core/util.js';
import { FORT } from './fortress.js';

/**
 * The keep (K1 "Benteng Terakhir"): the stone tower in the middle of the
 * bailey's inner ward, with the townsfolk on its battlements. Bodies that reach its wall claw
 * it; at 0 HP the run is lost. From Lv2 a ballista on its roof shoots back.
 */
export const KEEP = Object.freeze({
  reach: 40,             // px past the keep's wall (and the body's radius) a claw lands from
  hitEvery: 1.5,         // s between one body's claws
  // tuned on the balance bots: idle still loses Night 1; a keep-only or
  // ballista-only plan can hold Night 3 when it also shoots back
  damage: Object.freeze({ swarm: 12, individual: 36, breaker: 72 }),
  alarmRange: 460,       // a body this close (and inside) threatens the keep
  attackedFor: 1.6,      // s the keep reads "under attack" after a claw
  // the roof ballista reaches out along the gate roads (at 360 it only ever
  // covered the inner ward and seldom fired). BUILD 12's bailey is 1.6x the
  // size (the north and south gates stand 773 px from the keep, not 488):
  // Lv2 covers the districts round the plaza, Lv3 most of the way to the
  // north and south gates, never past the wall
  ballista: Object.freeze({
    2: Object.freeze({ damage: 18, every: 1.1, range: 600 }),
    3: Object.freeze({ damage: 26, every: 0.9, range: 700 }),
  }),
});

/**
 * The keep's banner (BUILD 12): a circle round the keep that grows with its
 * level, clipped to the bailey's wall — Lv1 (900 px, three quarters of the
 * bailey) reaches every Lv1 plot including the side gates' ballistas, Lv2
 * (1100) all but the far corners, Lv3 all of it. Inside it the garrison hits
 * harder (SURVIVAL_TUNING.territoryDamageTakenMul); it never slows a body.
 * Which plot may be built is no longer the banner's yard but each plot's own
 * keep level (SURVIVAL_SLOTS `level`): layout B gives every district plots
 * of more than one level, so a later plot can stand on blue ground already.
 */
export const BANNER = Object.freeze({ 1: 900, 2: 1100, 3: 1400 });

/**
 * Typed build circles (P1, "walk into a circle, tap BUILD"). Every circle is
 * one building type, drawn on the ground as that building's ghost, so what
 * and where read without text. Every yard of the bailey has one economy
 * circle and, when a gate opens into it, a ballista circle inside that gate.
 * Ids: the yard id for the economy circle, `<yard>:tower` for the ballista.
 * Where each one stands is PLOT below (the old `at` yard fractions are gone).
 */
export const SURVIVAL_SLOTS = Object.freeze([
  Object.freeze({ id: 'south:tower', room: FORT.SOUTH, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.WARD, room: FORT.WARD, type: 'barracks', level: 1 }),
  Object.freeze({ id: FORT.SOUTH, room: FORT.SOUTH, type: 'sawmill', level: 1 }),
  Object.freeze({ id: FORT.NORTH, room: FORT.NORTH, type: 'mine', level: 1 }),
  Object.freeze({ id: 'north:tower', room: FORT.NORTH, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.WEST, room: FORT.WEST, type: 'sawmill', level: 1 }),
  Object.freeze({ id: 'west:tower', room: FORT.WEST, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.EAST, room: FORT.EAST, type: 'mine', level: 1 }),
  Object.freeze({ id: 'east:tower', room: FORT.EAST, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.NW, room: FORT.NW, type: 'barracks', level: 2 }),
  Object.freeze({ id: 'northwest:tower', room: FORT.NW, type: 'tower', level: 2 }),
  Object.freeze({ id: FORT.SE, room: FORT.SE, type: 'mine', level: 2 }),
  Object.freeze({ id: 'southeast:tower', room: FORT.SE, type: 'tower', level: 2 }),
  Object.freeze({ id: FORT.NE, room: FORT.NE, type: 'sawmill', level: 3 }),
  Object.freeze({ id: FORT.SW, room: FORT.SW, type: 'barracks', level: 3 }),
]);
/**
 * WHERE EVERY PLOT STANDS — layout B (BUILD 12, docs/VISUAL-LAYOUT-RESEARCH.md
 * §6; chosen 2026-10-17: "untuk opsi nya B tapi cek dulu peta ROK").
 *
 * The plots are a fixed plan, offsets from the keep in world px, drawn and
 * checked by tools/survival-map.mjs. Like a Rise of Kingdoms city, the bailey
 * is zoned: the keep on its plaza in the middle, roads to the four gates, and
 * each grass quarter one district of one trade, so a player reads "the blue
 * quarter is the barracks" instead of hunting a mix of fifteen pads:
 *   - north-west BARRACKS, north-east GOLD MINES, south-west SAWMILLS, each
 *     three plots in a triangle (inner pair 270 px apart beside the plaza,
 *     the third further out); south-east the ARMORY, the well and the stores;
 *   - the ballistas stand where they always did relative to their gates
 *     (BUILD 11: 170-183 px inside the wall, 115-130 px off the gate's axis,
 *     85 px off a postern's), so each one sees out of its gate through the
 *     opening exactly as before (boltPath; at 150 px off the road the view
 *     narrowed and the ballista-only bot lost a win in five); the north and
 *     south ones 120 px off, inside their road (ROAD_HALF 130);
 *   - the economy plots keep 130+ px of grass between pads (BUILD 11: 36-62),
 *     190+ px from the wall, and stay off the roads and the plaza;
 *   - the ballistas are point-symmetric through the keep (each gate's twin),
 *     the districts mirror across the north-south road.
 * The keep levels (SURVIVAL_SLOTS `level`) are BUILD 11's per plot id: 9
 * plots at Lv1, 4 more at Lv2, the last 2 at Lv3; in each district the Lv1
 * plots stand nearest the plaza. Every building faces south (the main gate,
 * the camera).
 */
export const PLOT = Object.freeze({
  radius: 68,
  at: Object.freeze({
    // the ballistas, by their gates
    'south:tower': Object.freeze([120, 600]),
    'north:tower': Object.freeze([-120, -600]),
    'west:tower': Object.freeze([-870, 115]),
    'east:tower': Object.freeze([870, -115]),
    'northwest:tower': Object.freeze([-870, -427]),
    'southeast:tower': Object.freeze([870, 427]),
    // north-west: the barracks
    ward: Object.freeze([-330, -260]),
    northwest: Object.freeze([-600, -260]),
    southwest: Object.freeze([-465, -500]),
    // north-east: the gold mines
    north: Object.freeze([330, -260]),
    east: Object.freeze([600, -260]),
    southeast: Object.freeze([465, -500]),
    // south-west: the sawmills
    south: Object.freeze([-330, 260]),
    west: Object.freeze([-600, 260]),
    northeast: Object.freeze([-465, 500]),
  }),
  /** The armory (the captain's upgrades): the south-east district, the barracks' mirror image. */
  armory: Object.freeze([330, 260]),
  /**
   * The arms rack (BUILD 14: the garrison's crossbows), the armory's
   * neighbour on the same row, where the north-west barracks' outer plot is
   * mirrored (270 px apart, like every district's inner pair).
   */
  arms: Object.freeze([600, 260]),
  /**
   * Where the captain starts a run and every dawn: where the east road leaves
   * the keep's plaza, inside the keep's reach (keep.r + CIRCLE.keepReach =
   * 250, the plaza and its kerb), so the keep's card is the first thing a day
   * shows. (South of the keep, before its door, the engaged bot's night
   * anchor ended Night 1 with the keep at 43% in BUILD 9 — one star; on the
   * east road it held. At 190 px in layout B one seed in five fell to one
   * star on Night 1; at 240 all five held.)
   */
  home: Object.freeze([240, 0]),
  /**
   * Twins the plan keeps (p: through the keep; x: across the north-south
   * road; y: across the east-west road).
   */
  mirrors: Object.freeze([
    ['south:tower', 'north:tower', 'p'], ['west:tower', 'east:tower', 'p'],
    ['northwest:tower', 'southeast:tower', 'p'],
    ['ward', 'north', 'x'], ['northwest', 'east', 'x'], ['southwest', 'southeast', 'x'],
    ['ward', 'south', 'y'], ['northwest', 'west', 'y'], ['southwest', 'northeast', 'y'],
  ].map((row) => Object.freeze(row))),
});
export const SLOT_BY_ID = new Map(SURVIVAL_SLOTS.map((slot) => [slot.id, slot]));
export function survivalSlot(id) { return SLOT_BY_ID.get(id) || null; }
/** Pre-K1 saves: the old building ids. */
export const TYPE_MIGRATE = Object.freeze({ extractor: 'mine', shelter: 'barracks' });
/** How close the Hunter stands to a circle (or the keep) to act on it. */
// keepReach: BUILD 12's keep stands on a plaza (fortress.js PLAZA_R 235), and
// anywhere on it (with its kerb) is "at the keep" — 150 past its wall
export const CIRCLE = Object.freeze({ radius: 68, reach: 80, keepReach: 150 });

// Lv1 build cost/label. The level table below drives the economy.
export const SURVIVAL_BUILDINGS = Object.freeze({
  mine: Object.freeze({ id: 'mine', label: 'GOLD MINE', gold: 2, wood: 10, seconds: 7 }),
  sawmill: Object.freeze({ id: 'sawmill', label: 'SAWMILL', gold: 2, wood: 10, seconds: 7 }),
  barracks: Object.freeze({ id: 'barracks', label: 'BARRACKS', gold: 4, wood: 14, seconds: 9 }),
  tower: Object.freeze({ id: 'tower', label: 'BALLISTA', gold: 4, wood: 16, seconds: 8 }),
});

/**
 * Building levels (Lv1 is the build itself). Every level pays off in the
 * coming night, so an upgrade bought on the last day still counts:
 *   mine      digs gold into the purse DURING the night (`yield` per night)
 *   sawmill   wood every dawn, and planks: every outer door gets +% max HP
 *   barracks  houses soldiers; a build or level moves one in at once
 *             (one more door guard tonight)
 *   tower     a ballista by the room's outer door: harder bolts, further
 *             reach (see TOWER)
 */
export const BUILDING_MAX_LEVEL = 3;
export const SURVIVAL_BUILDING_LEVELS = Object.freeze({
  mine: Object.freeze({
    1: Object.freeze({ gold: 2, wood: 10, seconds: 7, yield: 6 }),
    2: Object.freeze({ gold: 4, wood: 12, seconds: 6, yield: 10 }),
    3: Object.freeze({ gold: 6, wood: 16, seconds: 7, yield: 14 }),
  }),
  sawmill: Object.freeze({
    1: Object.freeze({ gold: 2, wood: 10, seconds: 7, dawnWood: 7, doorBonus: 0.1 }),
    2: Object.freeze({ gold: 4, wood: 12, seconds: 6, dawnWood: 11, doorBonus: 0.2 }),
    3: Object.freeze({ gold: 6, wood: 16, seconds: 7, dawnWood: 15, doorBonus: 0.3 }),
  }),
  barracks: Object.freeze({
    1: Object.freeze({ gold: 4, wood: 14, seconds: 9, houses: 1 }),
    2: Object.freeze({ gold: 6, wood: 16, seconds: 8, houses: 2 }),
    3: Object.freeze({ gold: 8, wood: 20, seconds: 9, houses: 3 }),
  }),
  // A bolt that kills: 24 at Lv1 drops a Night 1 body (48 HP) in two, and
  // runs on through a second one (TOWER.pierce). At 16 a ballista fired 110
  // bolts a run and landed 30 kills, so it read as decoration (2026-10-17).
  tower: Object.freeze({
    1: Object.freeze({ gold: 4, wood: 16, seconds: 8, damage: 24, range: 520 }),
    2: Object.freeze({ gold: 6, wood: 18, seconds: 7, damage: 32, range: 580 }),
    3: Object.freeze({ gold: 8, wood: 22, seconds: 8, damage: 42, range: 640 }),
  }),
});
const DOOR_BONUS_CAP = 0.6;

/**
 * A ballista is the house fighting back on its own. It is built on its own
 * circle just inside a room's outer door and, by night, shoots a heavy bolt
 * through the door slit that runs on through a second body. It never walks
 * to the pressed door like a guard does: where it stands is the choice.
 */
export const TOWER = Object.freeze({
  every: 1.1,          // s between shots
  pierce: 1,           // extra bodies one bolt runs through
  boltSpeed: 900,
  reach: 120,          // px a bolt flies past the tower's range before it drops
  setback: 150,        // px inside the door it guards
  side: 64,            // px off the doorway line, toward the room's middle
  turn: 12,            // rad/s the ballista swings
  // a yard with two gates guards the busier one
  doors: Object.freeze(['southGate', 'northGate', 'eastGate', 'westGate', 'posternNW', 'posternSE']),
});

/**
 * The Hunter's own track, bought by day at the armory rack (no skill cards).
 * Shots are meant to feel heavy: a swarm body (48/54/60 HP) drops in two
 * bolts at Lv1 and one inside the banner's yards. Every level adds something
 * you can SEE: Lv2 bolts run on through a body, Lv3 fires a fan of three.
 */
export const HUNTER_MAX_LEVEL = 3;
export const SURVIVAL_HUNTER = Object.freeze({
  1: Object.freeze({ damage: 32, hp: 100, pierce: 0, fan: 1 }),
  2: Object.freeze({ gold: 14, wood: 8, seconds: 5, damage: 40, hp: 120, pierce: 1, fan: 1 }),
  3: Object.freeze({ gold: 20, wood: 12, seconds: 6, damage: 48, hp: 140, pierce: 1, fan: 3 }),
});

/**
 * BUILD 14 (2026-10-17: "senjata terpisah ... senjata pasukan bisa di-
 * upgrade"): the garrison's crossbows, bought by day at the arms rack beside
 * the armory (one level for every guard on the walls). Each level shows on
 * every guard (game/troop3d.js: Lv1 the pack's plain crossbow, Lv2 the same
 * bow lacquered royal blue, Lv3 the two-handed arbalest in blue and gold)
 * and in its bolts (white-blue, then gold). Lv1 is GUARD's base; a guard
 * inside the banner's yards still hits x1.5.
 */
export const ARMS_MAX_LEVEL = 3;
export const SURVIVAL_ARMS = Object.freeze({
  1: Object.freeze({ damage: 10, every: 1.6, pierce: 0 }),
  2: Object.freeze({ gold: 12, wood: 10, seconds: 5, damage: 14, every: 1.4, pierce: 0 }),
  3: Object.freeze({ gold: 18, wood: 14, seconds: 6, damage: 18, every: 1.25, pierce: 1 }),
});

/* ---------------- pure math over the tables ----------------
 * Every function here reads only its arguments and the frozen tables — the
 * SurvivalMode methods delegate to them, so the economy can be tested (and
 * balanced) without a game, exactly like sim/waves.js does for the schedule.
 */

/** The keep banner's radius at a level (BANNER). */
export function bannerReachFor(level) {
  return BANNER[clamp(Math.round(level) || 1, 1, 3)];
}

/** The plots a keep level opens (built or not). */
export function territoryPlotsFor(level) {
  return SURVIVAL_SLOTS.filter((slot) => slot.level <= level);
}

/** The plots a keep level has NOT opened yet. */
export function lockedSlotsFor(level) {
  return SURVIVAL_SLOTS.filter((slot) => slot.level > level);
}

/** The keep level that opens a circle (1-3; 3 for unknown ids). */
export function slotUnlockLevelFor(slotId) {
  const slot = SLOT_BY_ID.get(slotId);
  return slot ? slot.level : 3;
}

/** Level of the building on a circle (0 when empty), clamped 1..MAX. */
export function buildingLevelOf(buildings, buildingLevels, slotId) {
  if (!buildings[slotId]) return 0;
  return clamp(Math.round(Number(buildingLevels[slotId]) || 1), 1, BUILDING_MAX_LEVEL);
}

/** Stats of one building type at one level ({} for unknown types). */
export function buildingStatsFor(type, level = 1) {
  const table = SURVIVAL_BUILDING_LEVELS[type];
  return (table && table[clamp(Math.round(level) || 1, 1, BUILDING_MAX_LEVEL)]) || {};
}

/** Cost of a building's next level (null at max / unknown type). */
export function upgradeCostFor(type, level) {
  if (!type || level >= BUILDING_MAX_LEVEL) return null;
  const next = buildingStatsFor(type, level + 1);
  return next.wood != null ? { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 6 } : null;
}

/** Gold every mine digs into the purse over one night. */
export function goldPerNightFor(buildings, buildingLevels) {
  let total = 0;
  for (const [slotId, type] of Object.entries(buildings)) {
    if (type === 'mine') total += buildingStatsFor(type, buildingLevelOf(buildings, buildingLevels, slotId)).yield || 0;
  }
  return total;
}

/** Sawmill planks: +% max HP on every outer door (summed, capped). */
export function doorHpBonusFor(buildings, buildingLevels) {
  let bonus = 0;
  for (const [slotId, type] of Object.entries(buildings)) {
    if (type === 'sawmill') bonus += buildingStatsFor(type, buildingLevelOf(buildings, buildingLevels, slotId)).doorBonus || 0;
  }
  return Math.min(DOOR_BONUS_CAP, Math.round(bonus * 100) / 100);
}

/** The Hunter's track at a level. */
export function hunterStatsFor(level) {
  return SURVIVAL_HUNTER[clamp(Math.round(level) || 1, 1, HUNTER_MAX_LEVEL)];
}

/** Cost of the Hunter's next level (null at max). */
export function hunterUpgradeCostFor(level) {
  if (level >= HUNTER_MAX_LEVEL) return null;
  const next = hunterStatsFor(level + 1);
  return { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
}

/** The garrison's crossbows at a level (BUILD 14; Lv1 = GUARD's base). */
export function armsStatsFor(level) {
  return SURVIVAL_ARMS[clamp(Math.round(level) || 1, 1, ARMS_MAX_LEVEL)];
}

/** Cost of the arms rack's next level (null at max). */
export function armsUpgradeCostFor(level) {
  if (level >= ARMS_MAX_LEVEL) return null;
  const next = armsStatsFor(level + 1);
  return { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
}

/** Cost of the keep's next level (null at Lv3). */
export function keepUpgradeCostFor(level, tuning) {
  return level >= 3 ? null : tuning.keepUpgrade[level + 1] || null;
}

/** Cost of patching the keep (null when it is already whole). */
export function keepRepairCostFor(keepHp, keepHpMax, tuning) {
  const r = tuning.keepRepair;
  return keepHp >= keepHpMax - 0.5 ? null : { gold: 0, wood: r.wood, seconds: r.seconds };
}

/** Why a purse cannot pay a cost: 'none' | 'wood' | 'gold' | null (it can). */
export function affordReasonFor(gold, wood, cost) {
  if (!cost) return 'none';
  if (wood < (cost.wood || 0)) return 'wood';
  if (gold < (cost.gold || 0)) return 'gold';
  return null;
}
