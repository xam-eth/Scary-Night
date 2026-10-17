/* LAST NIGHT — Milestone 1 survival-building loop
 *
 * This mode is deliberately isolated from the original hunt/night systems.
 * It keeps the existing Mansion, Player, CrowdBody, enemy damage hooks, Hunter
 * shot, GLB rigs, and 3D room/light pipeline, but owns its own day/phase save,
 * resources, builder queue, night waves, and rewards.
 */

import { ISO_CAMERA, approachAngle, clamp, damp, dist, lerp, rand, writeSave } from '../core/util.js';
import { SURVIVAL_TUNING, SURVIVAL_ACTOR_SCALE } from '../core/config.js';
import { CrowdBody, Zombie, outwardOf, CROWD, ESTATE } from './enemies.js';
import { ROOM } from './mansion.js';
import { FORT } from './fortress.js';

const RESOURCE_CAP = 999;
/**
 * The camera's extra closeness over the 0.7 bailey's framing (frameMul).
 * 1.3 (2026-10-17 visual pass) read as too close on a phone: "camera terlalu
 * dekat harus jauhkan sedikit jarak nya" — 1.1 shows ~18% more bailey each
 * way, and the player can drag the view and pinch it (SURVIVAL_CAMERA).
 */
const FRAME_CLOSER = 1.1;
/**
 * The player's own hand on the camera: a drag on the free half of the screen
 * (the stick lives on the other half) slides the view, a pinch or the mouse
 * wheel zooms it within `zoom`, and it eases back onto the captain once he
 * walks. `reach`: how far past the bailey's edge the view centre may go.
 */
export const SURVIVAL_CAMERA = Object.freeze({
  zoom: Object.freeze([0.8, 1.3]),
  reach: 160,
  recenter: 3.2,      // 1/s the pan eases out while the captain walks
});
const SAVE_EVERY = 2.5;
// Night pacing: the first rank hits a door within seconds, so Night 1 has
// action near the Hunter before the halfway mark.
const WAVE_TIMES = Object.freeze([0.04, 0.3, 0.56]);
const BREAKER_TIMES = Object.freeze([0.2, 0.5]);
const INDIVIDUAL_TIMES = Object.freeze([0.42, 0.7]);
// Night 1–3 swarm sizes (×3 of the first M1 pass, capped per wave).
const WAVE_COUNTS = Object.freeze([
  Object.freeze([21, 21, 24]),
  Object.freeze([24, 27, 27]),
  Object.freeze([30, 30, 30]),
]);
const SWARM_CAP = 30;
// Gates per night: waves 1-3, then the two Individuals (src/game/fortress.js).
// Night 1 opens at the north gate, across the bailey from the camera, so the
// first contact is a gate the Hunter has time to walk to and the main gate
// is pressed only by the third wave. The posterns open from Night 2.
const NIGHT_DOORS = Object.freeze([
  Object.freeze(['northGate', 'eastGate', 'southGate', 'westGate', 'eastGate']),
  Object.freeze(['westGate', 'posternNW', 'southGate', 'northGate', 'posternNW']),
  Object.freeze(['posternSE', 'northGate', 'southGate', 'westGate', 'posternSE']),
]);
/**
 * K1's two bookends (DESIGN-SYSTEM-PLAN §4): the opening shot — the keep and
 * its people, the horde at a gate, then the captain and the three nights —
 * and the reinforcements marching in through the main gate at the third dawn.
 * Both play inside the run (the world keeps drawing, the clock waits), a tap
 * anywhere skips, and the opening is told once per save. Times in seconds;
 * camera zooms are multiples of the play framing (`frameMul`).
 */
export const CINE = Object.freeze({
  armAfter: 0.35,        // s before a tap may skip (the tap that started the run must not)
  march: 210,            // px/s, the relief column's pace
  intro: Object.freeze({
    dur: 7.2,
    horn: 5.2,           // the captain's horn, as the camera finds him
    captions: Object.freeze([
      Object.freeze({ from: 0.3, to: 2.5, icon: 'keep', title: 'PROTECT THE KEEP', sub: 'ITS PEOPLE SHELTER INSIDE' }),
      Object.freeze({ from: 2.9, to: 4.9, icon: 'swarm', title: 'THE HORDE COMES AT NIGHT', sub: 'THEY BREAK IN THROUGH THE GATES' }),
      Object.freeze({ from: 5.3, to: 7.2, icon: 'hunter', title: 'YOU ARE THE CAPTAIN', sub: 'HOLD 3 NIGHTS. REINFORCEMENTS ARE COMING', track: true }),
    ]),
  }),
  arrival: Object.freeze({
    dur: 7.0,
    fanfare: 0.7,
    captions: Object.freeze([
      Object.freeze({ from: 0.8, to: 7.0, icon: 'banner', title: 'REINFORCEMENTS ARRIVED!', sub: 'THE KEEP HELD FOR 3 NIGHTS', tone: 'dawn' }),
    ]),
  }),
});

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
  // the roof ballista reaches the gate roads of the half-size bailey (the
  // north and south gates stand 475 px from the keep): at 360 it only ever
  // covered the inner ward and seldom fired
  ballista: Object.freeze({
    2: Object.freeze({ damage: 18, every: 1.1, range: 440 }),
    3: Object.freeze({ damage: 26, every: 0.9, range: 500 }),
  }),
});

/**
 * The keep's banner: the yards of the bailey you may build in, by keep level
 * (the inner ward is the keep's own; Lv1 adds the four gate roads, Lv2 the
 * postern yards, Lv3 the last two corners). Inside them the garrison hits
 * harder (SURVIVAL_TUNING.territoryDamageTakenMul) — the banner never slows
 * a body.
 */
const TERRITORY_LV1 = [FORT.WARD, FORT.NORTH, FORT.SOUTH, FORT.EAST, FORT.WEST];
export const TERRITORY = Object.freeze({
  1: Object.freeze(TERRITORY_LV1.slice()),
  2: Object.freeze([...TERRITORY_LV1, FORT.NW, FORT.SE]),
  3: Object.freeze([...TERRITORY_LV1, FORT.NW, FORT.SE, FORT.NE, FORT.SW]),
});

/**
 * Typed build circles (P1, "walk into a circle, tap BUILD"). Every circle is
 * one building type, drawn on the ground as that building's ghost, so what
 * and where read without text. Every yard of the bailey has one economy
 * circle and, when a gate opens into it, a ballista circle inside that gate.
 * Ids: the yard id for the economy circle, `<yard>:tower` for the ballista.
 * Where each one stands is PLOT below (the old `at` yard fractions are gone).
 */
export const SURVIVAL_SLOTS = Object.freeze([
  Object.freeze({ id: 'south:tower', room: FORT.SOUTH, type: 'tower' }),
  Object.freeze({ id: FORT.WARD, room: FORT.WARD, type: 'barracks' }),
  Object.freeze({ id: FORT.SOUTH, room: FORT.SOUTH, type: 'sawmill' }),
  Object.freeze({ id: FORT.NORTH, room: FORT.NORTH, type: 'mine' }),
  Object.freeze({ id: 'north:tower', room: FORT.NORTH, type: 'tower' }),
  Object.freeze({ id: FORT.WEST, room: FORT.WEST, type: 'sawmill' }),
  Object.freeze({ id: 'west:tower', room: FORT.WEST, type: 'tower' }),
  Object.freeze({ id: FORT.EAST, room: FORT.EAST, type: 'mine' }),
  Object.freeze({ id: 'east:tower', room: FORT.EAST, type: 'tower' }),
  Object.freeze({ id: FORT.NW, room: FORT.NW, type: 'barracks' }),
  Object.freeze({ id: 'northwest:tower', room: FORT.NW, type: 'tower' }),
  Object.freeze({ id: FORT.SE, room: FORT.SE, type: 'mine' }),
  Object.freeze({ id: 'southeast:tower', room: FORT.SE, type: 'tower' }),
  Object.freeze({ id: FORT.NE, room: FORT.NE, type: 'sawmill' }),
  Object.freeze({ id: FORT.SW, room: FORT.SW, type: 'barracks' }),
]);
/**
 * WHERE EVERY PLOT STANDS — a laid-out bailey (playtest 2026-10-17: "letak
 * build bangunan masih belum rapi").
 *
 * The plots used to be searched for at run time from yard fractions, so they
 * landed wherever the search found floor: a ballista between the west gate's
 * towers, the ward's barracks against the keep, plots on top of the stores.
 * They are now a fixed plan, offsets from the keep in world px, drawn and
 * checked by tools/survival-map.mjs:
 *   - the plan is point-symmetric through the keep, like the fortress itself
 *     (the NW postern answers the SE one): every plot has a twin at -x, -y;
 *   - the main and north gate roads each have their pair either side of the
 *     road, mirrored (x = +-130, 160 px inside the wall): a street to the
 *     gate, its ballista on the side its twin gate's is not; the side gates'
 *     ballistas stand 115 px off their road, 170 px in;
 *   - the plots stand in columns (x = +-130, +-165, +-340, +-480) and keep
 *     30+ px between pads, 60+ px from the curtain wall, 24+ px from the keep;
 *   - every ballista sees out of its gate through the opening (boltPath),
 *     close enough to the road to see the crowd at the gate: at 150 px off
 *     the road its view through the opening narrowed and the ballista-only
 *     bot fell from 5/5 three-star wins to 4/5 (survival-balance, 5 seeds);
 *   - the ward's barracks and the armory flank the road from the keep's door
 *     to the main gate; the captain starts on the east road by the keep.
 * Every building faces south (the main gate, the camera), so the bailey
 * reads as one planned town rather than a scatter.
 */
export const PLOT = Object.freeze({
  radius: 68,
  at: Object.freeze({
    ward: Object.freeze([165, 120]),
    south: Object.freeze([-130, 315]),
    'south:tower': Object.freeze([130, 315]),
    north: Object.freeze([130, -315]),
    'north:tower': Object.freeze([-130, -315]),
    west: Object.freeze([-340, -125]),
    'west:tower': Object.freeze([-480, 115]),
    east: Object.freeze([340, 125]),
    'east:tower': Object.freeze([480, -115]),
    northwest: Object.freeze([-340, -345]),
    'northwest:tower': Object.freeze([-480, -235]),
    southeast: Object.freeze([340, 345]),
    'southeast:tower': Object.freeze([480, 235]),
    northeast: Object.freeze([480, -320]),
    southwest: Object.freeze([-480, 320]),
  }),
  /** The armory (the captain's upgrades): the ward barracks' mirror image. */
  armory: Object.freeze([-165, 120]),
  /**
   * Where the captain starts a run and every dawn: on the east road just off
   * the keep, between the ward's barracks and the east gate. (South of the
   * keep, before its door, the engaged bot's night anchor ended Night 1 with
   * the keep at 43% — one star; here it holds 94%, as the old start did.)
   */
  home: Object.freeze([190, 0]),
  /** Twins the plan keeps (p: through the keep; x: across the north-south axis). */
  mirrors: Object.freeze([
    ['south', 'north', 'p'], ['south:tower', 'north:tower', 'p'],
    ['west', 'east', 'p'], ['west:tower', 'east:tower', 'p'],
    ['northwest', 'southeast', 'p'], ['northwest:tower', 'southeast:tower', 'p'],
    ['northeast', 'southwest', 'p'],
    ['south', 'south:tower', 'x'], ['north', 'north:tower', 'x'],
  ].map((row) => Object.freeze(row))),
});
const SLOT_BY_ID = new Map(SURVIVAL_SLOTS.map((slot) => [slot.id, slot]));
export function survivalSlot(id) { return SLOT_BY_ID.get(id) || null; }
/** Pre-K1 saves: the old building ids. */
const TYPE_MIGRATE = Object.freeze({ extractor: 'mine', shelter: 'barracks' });
/** How close the Hunter stands to a circle (or the keep) to act on it. */
export const CIRCLE = Object.freeze({ radius: 68, reach: 80, keepReach: 100 });
const NIGHT_PHASE = { id: 'survival-night', label: 'NIGHT', danger: 0.24, ambient: [108, 114, 132] };
const DAY_PHASE = { id: 'survival-day', label: 'DAY', danger: 0.02, ambient: [186, 174, 150] };

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

function freshProgress(duration = SURVIVAL_TUNING.nightSeconds) {
  return {
    initialized: true,
    day: 1,
    phase: 'night',
    elapsed: 0,
    nightDuration: duration,
    gold: SURVIVAL_TUNING.startGold,
    wood: SURVIVAL_TUNING.startWood,
    survivors: SURVIVAL_TUNING.startSurvivors,
    keepLevel: 1,
    keepHp: SURVIVAL_TUNING.keepHp[1],
    buildings: {},
    buildingLevels: {},
    hunterLevel: 1,
    gateBuilt: false,
    gateHp: 0,
    builderJob: null,
    selectedRoom: null,
    nightsCompleted: 0,
    waveIndex: 0,
    breakerIndex: 0,
    individualIndex: 0,
    siegeTimers: {},
    nightStats: freshNightStats(), runStats: freshRunStats(),
    lastRewards: null,
    rewardAck: 0,
    hints: {},
    player: null,
    entrances: null,
    enemies: [],
  };
}

function clampDuration(value) {
  const n = Number(value);
  return clamp(Number.isFinite(n) ? Math.round(n) : SURVIVAL_TUNING.nightSeconds,
    SURVIVAL_TUNING.minNightSeconds, SURVIVAL_TUNING.maxNightSeconds);
}

/* ------------------------------------------------------------------ */
/* shared survival locomotion                                          */
/* ------------------------------------------------------------------ */

const SIEGE_REACH = 250;       // px from a door the pressing ranks still claw it

function stepToward(enemy, dt, game, tx, ty, speed, accel) {
  const a = Math.atan2(ty - enemy.y, tx - enemy.x);
  enemy.vx = damp(enemy.vx, Math.cos(a) * speed, accel, dt);
  enemy.vy = damp(enemy.vy, Math.sin(a) * speed, accel, dt);
  enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
  enemy.angle = a;
}

function stepDir(enemy, dt, game, dir, speed, accel) {
  enemy.vx = damp(enemy.vx, dir.x * speed, accel, dt);
  enemy.vy = damp(enemy.vy, dir.y * speed, accel, dt);
  enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
  enemy.angle = Math.atan2(dir.y, dir.x);
}

function settle(enemy, dt, k = 8) {
  enemy.vx = damp(enemy.vx, 0, k, dt);
  enemy.vy = damp(enemy.vy, 0, k, dt);
}

/**
 * Interior doorways sit between room rectangles, so findRoom() reports them
 * as OUTSIDE. Once a body has been inside a room it stays "inside" — otherwise
 * it flips back toward its entry door every time it crosses a doorway.
 */
function trackInside(enemy, game) {
  enemy.roomId = game.mansion.findRoom(enemy.x, enemy.y);
  if (enemy.roomId !== ROOM.OUTSIDE) enemy._inHouse = true;
  return !!enemy._inHouse;
}

/**
 * Outside the walls: walk the lane to a door. The door's flow field routes
 * around the house while the body is still far away; inside the last stretch
 * it walks straight to its own spot. (Following the field all the way made
 * every body whose rank stands further out than the field's goal orbit that
 * goal forever — whole waves never reached the wood.)
 */
const DOOR_LANE_NEAR = 200;
function approachDoor(enemy, dt, game, mode, door, point, speed, accel) {
  const out = door.outside || door;
  const far = dist(enemy.x, enemy.y, out.x, out.y) > DOOR_LANE_NEAR;
  const dir = far ? mode.flowDir(`door:${door.id}`, enemy.x, enemy.y) : null;
  if (dir && dist(enemy.x, enemy.y, point.x, point.y) > 60) stepDir(enemy, dt, game, dir, speed, accel);
  else stepToward(enemy, dt, game, point.x, point.y, speed, accel);
}

/**
 * Where a swarm body stands in its door's crowd. Unlike the legacy rank
 * layout (left-to-right, as wide as the frame + 220 px), Survival fills the
 * front rank centre-out and keeps it about one door wide, so the bodies that
 * are clawing are the ones the Hunter and the guards can see through the
 * door's slit; alternate ranks are staggered half a gap.
 */
// spaced for bodies x1.6 (SURVIVAL_ACTOR_SCALE): a demon is ~60 px across
const RANK_GAP = 54;
const RANK_ROW = 44;
export function survivalSpot(e, index, ring = 72) {
  const out = outwardOf(e);
  const along = { x: -out.y, y: out.x };
  const span = e.axis === 'v' ? e.h : e.w;
  const perRow = clamp(Math.round((span + 120) / RANK_GAP), 3, 7);
  const rank = Math.floor(index / perRow);
  const k = index % perRow;
  const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
  const lateral = step * RANK_GAP + (rank % 2 ? RANK_GAP / 2 : 0);
  const depth = ring + rank * RANK_ROW;
  return { x: e.x + out.x * depth + along.x * lateral, y: e.y + out.y * depth + along.y * lateral };
}

/**
 * Inside the walls: follow the flow field to the keep (or the Hunter when he
 * stands outside the banner's yards) and claw the keep's wall once in reach.
 * The banner never slows or blunts a body; it only makes the garrison's shots
 * hit harder (SurvivalMode.enemyDamageTaken).
 */
function invade(enemy, dt, game, mode, speed, accel, preferHunter, fallback = null) {
  const keep = mode.keep();
  const p = game.player;
  const held = mode.inTerritory(enemy.x, enemy.y);
  const pd = dist(enemy.x, enemy.y, p.x, p.y);
  enemy.attackingKeep = false;
  // One standing in its way still gets clawed, inside the banner or not.
  if (pd < enemy.radius + p.radius + 12 && p.state !== 'death' && p.state !== 'dead') {
    settle(enemy, dt);
    enemy.state = 'strike';
    enemy.angle = Math.atan2(p.y - enemy.y, p.x - enemy.x);
    enemy.attackCd -= dt;
    if (enemy.attackCd <= 0) {
      enemy.attackCd = enemy.hitEvery || 1.6;
      game.enemyHitPlayer(enemy, enemy.hitDamage || 10, enemy.hitKind || 'bite');
    }
    return 'press';
  }
  // A guard standing in its way gets clawed the same way (never hunted).
  const guard = mode.guardInReach(enemy);
  if (guard) {
    settle(enemy, dt);
    enemy.state = 'strike';
    enemy.angle = Math.atan2(guard.y - enemy.y, guard.x - enemy.x);
    enemy.attackCd -= dt;
    if (enemy.attackCd <= 0) {
      enemy.attackCd = enemy.hitEvery || 1.6;
      mode.hurtGuard(guard, (enemy.hitDamage || 10) * mode.enemyAttackMul(enemy), enemy);
    }
    return 'press';
  }
  // Outside the banner it also goes for a guard close by, as it would for the Hunter.
  const prey = held ? null : mode.guardToHunt(enemy);
  if (prey) {
    stepToward(enemy, dt, game, prey.x, prey.y, speed, accel);
    enemy.state = 'march';
    return 'march';
  }
  if (enemy._prey) enemy._prey = null;
  if (keep && mode.keepHp > 0 && dist(enemy.x, enemy.y, keep.x, keep.y) <= keep.r + (enemy.radius || 13) + KEEP.reach) {
    settle(enemy, dt);
    enemy.attackingKeep = true;
    enemy.state = 'strike';
    enemy.angle = Math.atan2(keep.y - enemy.y, keep.x - enemy.x);
    enemy.keepCd = (enemy.keepCd == null ? KEEP.hitEvery * 0.5 : enemy.keepCd) - dt;
    if (enemy.keepCd <= 0) { enemy.keepCd = KEEP.hitEvery; mode.hitKeep(enemy); }
    return 'keep';
  }
  const hunterOut = !mode.inTerritory(p.x, p.y);
  const chase = (preferHunter && hunterOut) || (!held && pd < 170);
  let dir = mode.flowDir(chase ? 'hunter' : 'keep', enemy.x, enemy.y);
  if (!dir && chase) dir = mode.flowDir('keep', enemy.x, enemy.y);
  if (dir) stepDir(enemy, dt, game, dir, speed, accel);
  else if (!enemy._inHouse && fallback) stepToward(enemy, dt, game, fallback.x, fallback.y, speed, accel);
  else if (chase) stepToward(enemy, dt, game, p.x, p.y, speed, accel);
  else if (keep) stepToward(enemy, dt, game, keep.x, keep.y, speed, accel);
  enemy.state = 'march';
  return 'march';
}

/** Death/hit-stun handling shared by all three survival enemy types. */
function commonPreamble(enemy, dt, game) {
  if (enemy.dead) {
    enemy.attackingKeep = false;
    enemy.deathT += dt;
    settle(enemy, dt, 7);
    if (enemy.deathT > 1.45) enemy.removeMe = true;
    return true;
  }
  enemy.staggerT = Math.max(0, (enemy.staggerT || 0) - dt);
  if (enemy.staggerT > 0) {
    // Flare knock-back / hit flinch: short and never caused by the banner.
    enemy.attackingKeep = false;
    enemy.state = 'stagger';
    settle(enemy, dt, 5.5);
    enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
    return true;
  }
  return false;
}

/** A reduced-AI siege zombie that retains CrowdBody's rank/entrance identity. */
class SurvivalCrowdZombie extends CrowdBody {
  constructor(x, y, entrance, index, day) {
    super('zombie', x, y, entrance);
    this._survivalType = 'swarm';
    this._crowd = true;
    this.index = index;
    this.hpMax = Math.round(48 * (1 + Math.max(0, day - 1) * 0.12));
    this.hp = this.hpMax;
    this.radius = 13;
    this.hurtFlash = 0;
    this.deathT = 0;
    this.removeMe = false;
    this.attackCd = 0;
    this.alpha = 0.9;
    this.entranceId = entrance ? entrance.id : null;
    this.hitEvery = 1.6;
    this.hitDamage = 9 + day * 2;
    this.hitKind = 'swarm';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  hurt(amount, game, fromX, fromY) {
    if (this.dead || this.removeMe) return;
    const incoming = game.survival ? game.survival.enemyDamageTaken(this, amount) : amount;
    this.hp -= incoming;
    this.hurtFlash = 1;
    if (fromX != null && fromY != null) {
      // a heavy bolt shoves the body back: the hit reads as weight
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      const shove = this.hp <= 0 ? 260 : 120;
      this.vx += Math.cos(a) * shove; this.vy += Math.sin(a) * shove;
    }
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.t += dt;
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 3.8);
    if (commonPreamble(this, dt, game)) return;
    const mode = game.survival;
    const entrance = mode.entranceById(this.entranceId) || this.entrance;
    this.entrance = entrance;
    const inside = trackInside(this, game);
    const broken = !!(entrance && entrance.broken);
    this.alpha = Math.min(1, this.alpha + dt * 0.8);

    if (broken || inside) {
      // The keep's field routes through whichever gap is open.
      this.press = damp(this.press || 0, 0, 5, dt);
      invade(this, dt, game, mode, mode.swarmSpeed(true), 5.2, false, entrance && (entrance.outside || entrance));
      return;
    }

    if (!entrance) { this.state = CROWD.LEAVE; return; }
    const spot = survivalSpot(entrance, this.index, 72);
    const targetX = spot.x + this.jx * 0.25;
    const targetY = spot.y + this.jy * 0.25;
    const d = dist(this.x, this.y, targetX, targetY);
    const speed = mode.swarmSpeed(false) * this.gait;
    if (d > 10) {
      this.state = CROWD.MARCH;
      if (d > 120) approachDoor(this, dt, game, mode, entrance, { x: targetX, y: targetY }, speed, 4.8);
      else stepToward(this, dt, game, targetX, targetY, speed, 4.8);
      this.press = damp(this.press, 0, 5, dt);
    } else {
      settle(this, dt, 7);
      this.state = CROWD.PRESS;
      this.press = damp(this.press, 1, 5, dt);
      this.angle = Math.atan2(entrance.y - this.y, entrance.x - this.x);
    }
  }

  _stepToward(dt, game, tx, ty, speed, accel) {
    stepToward(this, dt, game, tx, ty, speed, accel);
    return true;
  }
}

/** Individual, durable zombie: hunts the Hunter outside the banner, else the keep. */
class SurvivalIndividualZombie extends Zombie {
  constructor(x, y, entrance, day, index = 0) {
    super(x, y, { entranceId: entrance && entrance.id });
    this._survivalType = 'individual';
    this._crowd = false;
    this.type = { ...this.type, name: 'ZOMBIE', hp: 118 + day * 14, speed: 58, huntSpeed: 72, contactDamage: 12 + day * 2, doorDamage: 8 };
    this.hp = this.hpMax = this.type.hp;
    this.radius = 15;
    this.entranceId = entrance && entrance.id;
    this.waveIndex = index;
    this.attackCd = 1.2;
    this.alpha = 0.95;
    this.survival = true;
    this.hitEvery = 1.55;
    this.hitDamage = this.type.contactDamage;
    this.hitKind = 'bite';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (commonPreamble(this, dt, game)) return;
    const mode = game.survival;
    let entrance = mode.entranceById(this.entranceId);
    const inside = trackInside(this, game);
    const slow = 1;
    this.attackCd -= dt;
    // Outside: the assigned door; if it is intact, batter it; once any door
    // is open, the flow field routes through the nearest gap.
    const open = mode.nearestBrokenDoor(this.x, this.y);
    if (open) { entrance = open; this.entranceId = open.id; }
    if (!entrance) entrance = mode.chooseTargetEntrance(this.x, this.y);
    if (inside || (entrance && entrance.broken)) {
      invade(this, dt, game, mode, this.type.huntSpeed * slow, 5.2, true, entrance && (entrance.outside || entrance));
      return;
    }
    if (!entrance) return;
    this.entranceId = entrance.id;
    const out = entrance.outside || entrance;
    const d = dist(this.x, this.y, out.x, out.y);
    if (d > 54) {
      approachDoor(this, dt, game, mode, entrance, out, this.type.speed * slow, 5.2);
      this.state = 'march';
      return;
    }
    settle(this, dt);
    this.state = this.attackCd < 0.4 ? 'strike' : 'press';
    this.angle = Math.atan2(entrance.y - this.y, entrance.x - this.x);
    if (this.attackCd <= 0) {
      this.attackCd = 2.1;
      mode.damageEntrance(entrance, this.type.doorDamage || 8, this);
    }
  }

  _survivalMove(dt, game, tx, ty, speed) {
    stepToward(this, dt, game, tx, ty, speed, 5.2);
    this.state = 'march';
  }
}

/** Day-2 wall specialist: doors first (next intact one after a breach), then the keep. */
class SurvivalBreaker extends Zombie {
  constructor(x, y, entrance, day, index = 0) {
    super(x, y, { entranceId: entrance && entrance.id });
    this._survivalType = 'breaker';
    this._crowd = false;
    this.key = 'zombie'; // uses the authored demon.glb zombie role
    this.type = { ...this.type, name: 'BREAKER', hp: 250 + Math.max(0, day - 2) * 55, speed: 48, doorDamage: 31 + day * 3 };
    this.hp = this.hpMax = this.type.hp;
    this.radius = 19;
    this.entranceId = entrance && entrance.id;
    this.targetKind = 'wall';
    this.targetEntranceId = entrance && entrance.id;
    this.breakerIndex = index;
    this.attackCd = 1.5 + index * 0.3;
    this.alpha = 1;
    this.tint = '#a66b38';
    this.variant = 'survival-breaker';
    this.hitEvery = 1.9;
    this.hitDamage = 18 + day * 2;
    this.hitKind = 'slam';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (commonPreamble(this, dt, game)) return;
    const mode = game.survival;
    const inside = trackInside(this, game);
    const speed = this.type.speed;
    // Deliberately do not inspect player LOS/visibility: the objective is a
    // structure. A broken target hands over to the next intact door; with no
    // door left standing it walks in and goes for the keep.
    let target = mode.entranceById(this.targetEntranceId);
    if (!target || target.broken) {
      const next = mode.nextIntactDoor(this.x, this.y);
      if (next) { target = next; this.targetKind = 'wall'; }
      else { target = null; this.targetKind = 'keep'; }
      this.targetEntranceId = target && target.id;
      this.entranceId = this.targetEntranceId || this.entranceId;
    }
    if (inside || !target) {
      const gap = inside ? null : mode.nearestBrokenDoor(this.x, this.y);
      this.attackCd -= dt;
      invade(this, dt, game, mode, speed, 4.2, false, gap && (gap.outside || gap));
      return;
    }
    const out = target.outside || target;
    const d = dist(this.x, this.y, out.x, out.y);
    if (d > 62) {
      approachDoor(this, dt, game, mode, target, out, speed, 4.2);
      this.state = 'march';
      return;
    }
    settle(this, dt);
    this.attackCd -= dt;
    this.state = this.attackCd < 0.5 ? 'strike' : 'press';
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.attackCd <= 0 && !target.broken) {
      this.attackCd = Math.max(2.2, 3.4 - mode.day * 0.25);
      mode.damageEntrance(target, this.type.doorDamage, this);
    }
  }
}

/**
 * BFS distance field on the Mansion nav grid. One field per goal (the keep,
 * the Hunter, each door lane); enemies read a direction in O(1) instead of
 * each running its own path search, which keeps a 30-body wave cheap on
 * phones. The keep's field has many goals (a ring around its wall), so every
 * body walks to the nearest side of the tower instead of queueing at one.
 */
class FlowField {
  constructor(mansion) {
    this.m = mansion;
    this.size = 0;
    this.dist = null;
    this.queue = null;
    this.version = -1;
    this.goalCell = -1;
    this.builtAt = -1;
    this.out = { x: 0, y: 0 };
  }

  build(x, y, version) { return this.buildMulti([{ x, y }], version); }

  buildMulti(points, version) {
    const m = this.m;
    const size = m.navW * m.navH;
    if (size !== this.size) {
      this.size = size;
      this.dist = new Int32Array(size);
      this.queue = new Int32Array(size);
    }
    this.version = version;
    const d = this.dist;
    d.fill(-1);
    const w = m.navW, h = m.navH, nav = m.nav, q = this.queue;
    let head = 0, tail = 0;
    this.goalCell = -1;
    for (const point of points) {
      const goal = m.navNearest(point.x, point.y, 6);
      if (!goal) continue;
      const cell = goal.gy * w + goal.gx;
      if (d[cell] === 0) continue;
      d[cell] = 0;
      q[tail++] = cell;
      if (this.goalCell < 0) this.goalCell = cell;
    }
    if (this.goalCell < 0) return false;
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % w, cy = (cur - cx) / w;
      const nd = d[cur] + 1;
      if (cx + 1 < w && d[cur + 1] < 0 && nav[cur + 1] === 0) { d[cur + 1] = nd; q[tail++] = cur + 1; }
      if (cx > 0 && d[cur - 1] < 0 && nav[cur - 1] === 0) { d[cur - 1] = nd; q[tail++] = cur - 1; }
      if (cy + 1 < h && d[cur + w] < 0 && nav[cur + w] === 0) { d[cur + w] = nd; q[tail++] = cur + w; }
      if (cy > 0 && d[cur - w] < 0 && nav[cur - w] === 0) { d[cur - w] = nd; q[tail++] = cur - w; }
    }
    return true;
  }

  _best(gx, gy, here) {
    const m = this.m, w = m.navW, h = m.navH, d = this.dist;
    let best = -1, bestD = here >= 0 ? here : 1e9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = gx + ox, ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const nd = d[ni];
        if (nd < 0 || nd >= bestD) continue;
        if (ox && oy && (d[gy * w + nx] < 0 || d[ny * w + gx] < 0)) continue; // no corner cutting
        best = ni; bestD = nd;
      }
    }
    return best;
  }

  /** Unit vector toward the goal, or null outside the grid / at the goal. */
  dirAt(x, y) {
    const m = this.m;
    if (this.goalCell < 0 || !this.dist) return null;
    const gx = Math.floor((x - m.navX0) / m.navCell);
    const gy = Math.floor((y - m.navY0) / m.navCell);
    const w = m.navW;
    if (gx < 0 || gy < 0 || gx >= w || gy >= m.navH) return null;
    const idx = gy * w + gx;
    const here = this.dist[idx];
    if (here === 0) return null;
    const first = this._best(gx, gy, here);
    if (first < 0) return null;
    let aim = first;
    const fx = first % w, fy = (first - fx) / w;
    const second = this._best(fx, fy, this.dist[first]);
    if (second >= 0 && here >= 0) aim = second;
    const ax = m.navX0 + ((aim % w) + 0.5) * m.navCell;
    const ay = m.navY0 + (Math.floor(aim / w) + 0.5) * m.navCell;
    const dx = ax - x, dy = ay - y;
    const len = Math.hypot(dx, dy) || 1;
    this.out.x = dx / len; this.out.y = dy / len;
    return this.out;
  }
}

/**
 * Soldiers (survivors) are the keep's garrison. By day they stand around the
 * keep (the count the HUD shows is people you can see); by night each one
 * walks to the door under the most pressure and shoots through its slit.
 *
 * They can be hurt, by the same rules as the Hunter: a body that gets inside
 * (a breach) claws a guard standing in its way, and outside the banner's
 * rooms it also goes for a guard close by — a few per guard, the rest keep
 * walking to the keep. So a guard holding a door inside the banner is fairly
 * safe and one holding a door beyond it is not. A badly hurt guard falls back
 * to the keep; one that drops stays down where it fell and stops shooting.
 * The Hunter helps a fallen guard up by standing beside it; one left alone
 * for `bleedOut` seconds is lost (one soldier fewer, for good). Dawn gets
 * everyone still down back up. Losing the run is only the keep or the Hunter.
 */
/** Who landed the killing blow (R19 "the building MVP", R1 run summary). */
export const KILL_SOURCES = Object.freeze(['captain', 'guard', 'tower', 'keep', 'flare']);
const freshKillsBy = () => ({ captain: 0, guard: 0, tower: 0, keep: 0, flare: 0 });
function freshNightStats() {
  // breached: gate ids in the order they gave way tonight (R4's tip)
  return { kills: 0, hits: 0, damageToWalls: 0, keepDamage: 0, mined: 0, by: freshKillsBy(), breached: [], flares: 0, keepMin: 1 };
}
/**
 * The whole run (three nights): the end panel's numbers. keepMin is the
 * lowest share of HP the keep fell to (R2's stars), lost the guards nobody
 * helped up, towers the kills per ballista circle (R19's MVP), time the
 * seconds played (nights and days, pause excluded).
 */
function freshRunStats() {
  return { kills: 0, by: freshKillsBy(), mined: 0, sawn: 0, recruited: 0, nights: 0, keepMin: 1, lost: 0, towers: {}, time: 0 };
}
/** A save-safe copy of a stats object (its nested tallies copied too). */
function cloneStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) out[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v);
  return out;
}
/** A kill's source from the bolt owner (or 'flare') that hit the body last. */
function killSource(game, by) {
  if (by === 'flare') return 'flare';
  if (!by || by === game.player) return 'captain';
  if (by.key === 'guard') return 'guard';
  if (by.key === 'tower') return 'tower';
  if (by.key === 'keep') return 'keep';
  return 'captain';
}
/** The colour of a hit by source: warm for the captain, cool for guards, hot for ballistas. */
const HIT_COLOR = Object.freeze({ captain: '#ffd36a', guard: '#8fe3ff', tower: '#ff8a3a', keep: '#ff8a3a', flare: '#fff2b0' });

/**
 * THE END OF A RUN (UX-REPLAY-RESEARCH §5 P0: R1 summary, R2 stars, R3
 * records, R4 the near miss and its tip, R19 the MVP).
 *
 * Stars rate a won run by how the keep held, the way Kingdom Rush rates a
 * level by the lives left: one for holding three nights, two when the keep
 * never fell below half, three when no guard was lost as well. A lost run
 * has none; it shows how close dawn was and one tip read off what really
 * happened.
 */
export const RUN_STARS = Object.freeze({ keepMin: 0.5 });
export function survivalStars(won, stats) {
  if (!won) return 0;
  const keepMin = stats && Number.isFinite(stats.keepMin) ? stats.keepMin : 1;
  if (keepMin < RUN_STARS.keepMin) return 1;
  return stats && stats.lost > 0 ? 2 : 3;
}
/** Best results across runs (save.survival.records); PLAY AGAIN keeps them. */
function freshRecords() {
  return { runs: 0, wins: 0, bestStars: 0, bestNights: 0, bestKills: 0, totalKills: 0 };
}
const SIDE_NAMES = Object.freeze({ north: 'NORTH', south: 'SOUTH', east: 'EAST', west: 'WEST', northwest: 'NW', southeast: 'SE' });
const GATE_NAMES = Object.freeze({ northGate: 'NORTH', southGate: 'SOUTH', eastGate: 'EAST', westGate: 'WEST', posternNW: 'NW', posternSE: 'SE' });
/**
 * The run's MVP (R19): the part of the garrison the player raised that
 * brought down the most — one ballista by its circle, the keep's roof
 * ballista, or the guards. The captain is the player, never the MVP (his
 * share is on the crew row): the line exists to make the build felt, and in
 * every balance bot that defends, the captain takes most of the kills. A tie
 * goes to the ballista listed first. Null when the garrison killed nothing.
 */
export function survivalMvp(stats) {
  const by = (stats && stats.by) || {};
  const rows = [];
  for (const [slotId, kills] of Object.entries((stats && stats.towers) || {})) {
    rows.push({ id: slotId, icon: 'tower', name: `${SIDE_NAMES[String(slotId).split(':')[0]] || 'GATE'} BALLISTA`, kills: kills || 0 });
  }
  rows.push({ id: 'keep', icon: 'keep', name: 'KEEP BALLISTA', kills: by.keep || 0 });
  rows.push({ id: 'guard', icon: 'guard', name: 'GUARDS', kills: by.guard || 0 });
  let best = null;
  for (const row of rows) if (row.kills > 0 && (!best || row.kills > best.kills)) best = row;
  return best;
}

export const GUARD = Object.freeze({
  speed: 210,          // px/s walking between posts
  range: 420,          // px a guard will shoot at
  every: 1.6,          // s between shots
  damage: 10,          // per bolt (x1.5 inside the banner's yards, like the Hunter's)
  boltSpeed: 640,
  perDoor: 2,          // most guards one door takes before the next door gets one
  cap: 8,              // most guards on the map (== maxSurvivors)
  hp: 40,              // a survivor is no Hunter (100+): 3-4 claws in the dark
  reach: 12,           // px past both bodies' radii a claw lands from
  woundedAt: 0.35,     // at or below this share of HP a guard falls back to the keep
  rescueRange: 70,     // px from a fallen guard the Hunter stands to help him up
  rescueTime: 1.5,     // s he stays there
  rescueHp: 0.5,       // share of HP a guard gets up with
  bleedOut: 20,        // s a fallen guard holds on alone (the clock stops while helped)
  iframes: 0.5,        // s after a claw before the next one lands (the Hunter has 0.75)
  huntRange: 110,      // px: beyond the banner a body this close goes for a guard (Hunter: 170)
  maxHunters: 3,       // bodies going for one guard at once
});

class SurvivalGuard {
  constructor(index, x, y) {
    this.id = 5000000 + index;
    this.index = index;
    this.key = 'guard';
    this.x = x; this.y = y;
    this.angle = -Math.PI / 2;
    this.radius = 12;
    this.type = { boltSpeed: GUARD.boltSpeed, boltDamage: GUARD.damage };
    this.cd = 0.5 + index * 0.23;  // staggered so a pair never fires in lockstep
    this.post = null;              // { key, x, y, doorId }
    this.path = null;
    this.pathI = 0;
    this.moving = false;
    this.shotT = 0;                // recoil, for the 3D pawn
    this.walkT = 0;
    this.target = null;
    this.hpMax = GUARD.hp;
    this.hp = GUARD.hp;
    this.down = false;             // dropped: lies where it fell, no shots
    this.downT = 0;
    this.rescueT = 0;              // how long the Hunter has stood beside it
    this.hurtFlash = 0;
    this.iframes = 0;
  }
}

export class SurvivalMode {
  constructor(game, options = {}) {
    this.game = game;
    this.tuning = SURVIVAL_TUNING;
    this.phase = 'night';
    this.day = 1;
    this.elapsed = 0;
    this.nightDuration = clampDuration(options.nightDuration || (game.save.survival && game.save.survival.nightDuration));
    this.gold = this.tuning.startGold;
    this.wood = this.tuning.startWood;
    this.survivors = this.tuning.startSurvivors;
    this.keepLevel = 1;
    this.keepHp = this.tuning.keepHp[1];
    this.buildings = {};
    this.buildingLevels = {};
    this.hunterLevel = 1;
    this.gateBuilt = false;
    this.gateHp = 0;
    this.builderJob = null;
    this.selectedRoom = null;
    this.nightsCompleted = 0;
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = freshNightStats();
    this.lastRewards = null;
    this.skillCooldown = 0;
    this.skillCooldownMax = this.tuning.skillCooldown;
    this.skillFlash = 0;
    this._saveT = 0;
    this._lastGateOpen = null;
    this._savedDurationOverride = options.nightDuration || null;
    this.uiClock = 0;
    // the player's drag on the camera (world px off the captain) — _steerCamera
    this.camPan = { x: 0, y: 0 };
    this._recenter = false;
    this._userZoom = null;
    this.guards = [];
    this.towers = [];
    this.floaters = [];
    this.fx = [];                  // one-shot 3D effects for world3d (pushFx)
    this.hudPops = [];             // income beside the HUD counters (pushHudPop)
    this.runStats = freshRunStats();
    this._mineBank = Object.create(null);
    this.bannerQueue = [];
    this.banner = null;
    this.keepAttackers = 0;
    this.keepBallista = { cd: 0.6, aim: Math.PI / 2, angle: Math.PI / 2, shotT: 0, target: null, shots: 0 };
    this.rewardAck = 0;
    this.dayFocus = null;
    this.walkPath = null;          // day: tap a far circle and the Hunter walks there
    this.hitStop = 0;              // s the night holds still on a heavy kill
    this._doorPressure = new Map();
    this._breachAt = Object.create(null);
    this._fields = new Map();
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._keepHitAt = -99;
    this._keepWarnAt = -99;
    this._keepLowWarned = false;
    // the K1 bookends (CINE): only a real run asks for them (main.js; QA
    // passes ?cine=0); a node harness that never opts in plays straight
    this.cinematics = options.cinematics === true;
    this.cine = null;              // { kind: 'intro' | 'arrival', t, dur, keys, night }
    this.reinforcements = null;    // the relief column (victory)
    this.records = freshRecords();  // best results across runs (R3)
    this.runResult = null;          // how the last run ended (stars, MVP, tip)
    this._restore(game.save.survival || freshProgress(this.nightDuration));
    this.applyHunterStats(false);
    this._configureMansion();
    this._applyEntranceState();
    this.applyBuildingEffects(false);
    this.game.mansion.buildNav();
    this._syncTerritory();
    this.game.survivalBakeDirty = true;
    this._syncGuardRoster(true);
    this._applyGuardState();
    this._syncTowers();
    if (this.phase === 'night' && this.elapsed < 1) this._nightIntro();
    // a run that was won stays won on reload: the column stands at the keep
    if (this.phase === 'complete') this.reinforcements = this._reliefColumn(true);
  }

  _restore(saved) {
    const base = freshProgress(this.nightDuration);
    const s = { ...base, ...(saved || {}) };
    if (this._savedDurationOverride) s.nightDuration = this._savedDurationOverride;
    this.day = clamp(Math.round(Number(s.day) || 1), 1, 3);
    this.phase = ['night', 'day', 'complete', 'failed'].includes(s.phase) ? s.phase : 'night';
    this.elapsed = clamp(Number(s.elapsed) || 0, 0, this.nightDuration);
    this.nightDuration = clampDuration(s.nightDuration || this.nightDuration);
    // pre-K1 saves: Oil was the purse, the Perapian the heart
    const gold = saved && saved.gold == null && saved.oil != null ? saved.oil : s.gold;
    this.gold = clamp(Math.floor(Number(gold) || 0), 0, RESOURCE_CAP);
    this.wood = clamp(Math.floor(Number(s.wood) || 0), 0, RESOURCE_CAP);
    this.survivors = clamp(Math.floor(Number(s.survivors) || 0), 0, 99);
    const level = saved && saved.keepLevel == null && saved.perapianLevel != null ? saved.perapianLevel : s.keepLevel;
    this.keepLevel = clamp(Math.round(Number(level) || 1), 1, 3);
    const hp = saved && saved.keepHp != null ? Number(saved.keepHp) : NaN;
    this.keepHp = Number.isFinite(hp) ? clamp(hp, 0, this.keepHpMax()) : this.keepHpMax();
    this.buildings = {};
    this.buildingLevels = {};
    // Typed circles: a building lives on the circle of its own type. Saves
    // from the house (room-keyed circles) move each building onto a free
    // circle of the same type in the bailey, keeping its level — inside the
    // banner first, in circle order.
    const levels = s.buildingLevels && typeof s.buildingLevels === 'object' ? s.buildingLevels : {};
    if (s.buildings && typeof s.buildings === 'object') {
      const homeless = [];
      for (const [key, raw] of Object.entries(s.buildings)) {
        const type = TYPE_MIGRATE[raw] || raw;
        if (!SURVIVAL_BUILDINGS[type]) continue;
        const level = clamp(Math.round(Number(levels[key]) || 1), 1, BUILDING_MAX_LEVEL);
        const id = type === 'tower' && !String(key).endsWith(':tower') ? `${key}:tower` : key;
        const slot = SLOT_BY_ID.get(id);
        if (!slot || slot.type !== type || this.buildings[id]) { homeless.push({ type, level }); continue; }
        this.buildings[id] = type;
        this.buildingLevels[id] = level;
      }
      const banner = TERRITORY[this.keepLevel] || TERRITORY[1];
      const order = [...SURVIVAL_SLOTS].sort((a, b) => (banner.includes(b.room) ? 1 : 0) - (banner.includes(a.room) ? 1 : 0));
      for (const old of homeless) {
        const slot = order.find((c) => c.type === old.type && !this.buildings[c.id]);
        if (!slot) continue;
        this.buildings[slot.id] = old.type;
        this.buildingLevels[slot.id] = old.level;
      }
    }
    this.hunterLevel = clamp(Math.round(Number(s.hunterLevel) || 1), 1, HUNTER_MAX_LEVEL);
    this.gateBuilt = !!s.gateBuilt;
    this.gateHp = Math.max(0, Number(s.gateHp) || 0);
    let job = s.builderJob && typeof s.builderJob === 'object' ? { ...s.builderJob } : null;
    if (job) {
      if (job.kind === 'perapian') { job.kind = 'keep'; job.type = 'keep'; }
      if (TYPE_MIGRATE[job.type]) job.type = TYPE_MIGRATE[job.type];
      if ((job.kind === 'building' || job.kind === 'upgrade') && !job.slotId) {
        job.slotId = job.type === 'tower' && job.roomId ? `${job.roomId}:tower` : job.roomId;
      }
      if ((job.kind === 'building' || job.kind === 'upgrade') && !SLOT_BY_ID.has(job.slotId)) job = null;
    }
    this.builderJob = job;
    this.selectedRoom = s.selectedRoom || null;
    this.nightsCompleted = clamp(Math.floor(Number(s.nightsCompleted) || 0), 0, 3);
    this.waveIndex = Math.max(0, Math.floor(Number(s.waveIndex) || 0));
    this.breakerIndex = Math.max(0, Math.floor(Number(s.breakerIndex) || 0));
    this.individualIndex = Math.max(0, Math.floor(Number(s.individualIndex) || 0));
    this.nightKeepStart = Number.isFinite(Number(s.nightKeepStart)) && s.nightKeepStart != null ? Number(s.nightKeepStart) : null;
    this.siegeTimers = s.siegeTimers && typeof s.siegeTimers === 'object' ? { ...s.siegeTimers } : {};
    this.nightStats = { ...freshNightStats(), ...(s.nightStats || {}) };
    this.nightStats.by = { ...freshKillsBy(), ...((s.nightStats && s.nightStats.by) || {}) };
    this.nightStats.breached = Array.isArray(this.nightStats.breached) ? this.nightStats.breached.slice() : [];
    this.runStats = { ...freshRunStats(), ...(s.runStats || {}) };
    this.runStats.by = { ...freshKillsBy(), ...((s.runStats && s.runStats.by) || {}) };
    this.runStats.towers = { ...((s.runStats && s.runStats.towers) || {}) };
    this.records = { ...freshRecords(), ...(s.records && typeof s.records === 'object' ? s.records : {}) };
    this.runResult = (this.phase === 'complete' || this.phase === 'failed') && s.runResult && typeof s.runResult === 'object'
      ? cloneStats(s.runResult) : null;
    this.lastRewards = s.lastRewards || null;
    this.rewardAck = Math.max(0, Math.floor(Number(s.rewardAck) || 0));

    const g = this.game;
    // the Hunter's health track first: a saved 130 HP must not be clamped
    // to a Lv1 bar before the level is known
    g.player.bloodMax = this.hunterStats().hp;
    const pos = s.player;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      g.player.x = pos.x; g.player.y = pos.y;
      if (Number.isFinite(pos.blood)) g.player.blood = clamp(pos.blood, 1, g.player.bloodMax);
      if (Number.isFinite(pos.angle)) g.player.angle = pos.angle;
    } else {
      const home = this.hunterHome();
      g.player.x = home.x; g.player.y = home.y;
      g.player.angle = -Math.PI / 2;
    }
    g.player.weapon = 'shot';
    g.player.blood = Math.max(1, g.player.blood || g.player.bloodMax);
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.time = this.elapsed;
    g.timeLeft = this.nightDuration - this.elapsed;
    g.phase = this.daylight() ? DAY_PHASE : NIGHT_PHASE;
    g.nightDuration = this.nightDuration;
    g.survival = this;

    this._restoreEnemies(Array.isArray(s.enemies) ? s.enemies : []);
    this._savedEntrances = Array.isArray(s.entrances) ? s.entrances : null;
    this._savedGuards = this.phase === 'night' && Array.isArray(s.guards) ? s.guards : null;
  }

  /** After the roster is rebuilt on load: put back each guard's wounds. */
  _applyGuardState() {
    const rows = this._savedGuards;
    this._savedGuards = null;
    if (!rows) return;
    this.guards.forEach((guard, i) => {
      const row = rows[i];
      if (!row) return;
      guard.hp = clamp(Number(row.hp), 0, guard.hpMax);
      if (!Number.isFinite(guard.hp)) guard.hp = guard.hpMax;
      guard.down = !!row.down || guard.hp <= 0;
      if (guard.down) {
        guard.hp = 0;
        guard.rescueT = clamp(Number(row.rescueT) || 0, 0, GUARD.rescueTime);
        guard.downT = clamp(Number(row.downT) || 0, 0, GUARD.bleedOut - 0.5);
        if (Number.isFinite(row.x) && Number.isFinite(row.y)) { guard.x = row.x; guard.y = row.y; }
      }
    });
  }

  _restoreEnemies(rows) {
    const g = this.game;
    g.enemies.length = 0;
    for (const row of rows) {
      if (!row || !Number.isFinite(row.x) || !Number.isFinite(row.y)) continue;
      const e = this._makeEnemy(row.kind, row.x, row.y, row.entranceId, row.index || 0);
      if (!e) continue;
      for (const key of ['id', 'hp', 'hpMax', 'state', 'stateT', 'angle', 'vx', 'vy', 'alpha', 'dead', 'deathT', 'attackCd', 'press', 't']) {
        if (row[key] != null) e[key] = row[key];
      }
      if (row.targetEntranceId) e.targetEntranceId = row.targetEntranceId;
      if (row.targetKind) e.targetKind = row.targetKind === 'perapian' ? 'keep' : row.targetKind;
      // a body that already crossed a doorway keeps walking to the keep
      // instead of turning back toward its door after a reload
      if (row.inHouse) e._inHouse = true;
      const keepCd = row.keepCd != null ? row.keepCd : row.feedCd;
      if (Number.isFinite(keepCd)) e.keepCd = keepCd;
      if (Number.isFinite(row.staggerT)) e.staggerT = row.staggerT;
      if (e._crowd) e.index = Number(row.index) || 0;
      g.enemies.push(e);
    }
  }

  /** The bake is phase-tinted (cool night / warm day); rebake on change. */
  _syncBakePhase() {
    const m = this.game.mansion;
    const want = this.daylight() ? 'day' : 'night';
    if (m.survivalPhase !== want) {
      m.survivalPhase = want;
      this.game.survivalBakeDirty = true;
    }
  }

  /**
   * K1: the inner ward's middle belongs to the keep. Any house fixtures go
   * dark (the legacy house only), a warm lamp marks the keep's lit window,
   * and the tower is solid: bodies, bolts and the Hunter walk around it.
   */
  _configureMansion() {
    const m = this.game.mansion;
    m.survivalLighting = true;
    this._syncBakePhase();
    m.props = (m.props || []).filter((prop) => !(prop.room === ROOM.HALL && (prop.type === 'candelabra' || prop.type === 'carpet')));
    for (const prop of m.props || []) {
      if (prop.type === 'carpet' && (prop.color === 'dark' || prop.color === 'crimson')) prop.color = 'rose';
      else if (prop.type === 'carpet' && prop.color === 'purple') prop.color = 'violet';
    }
    for (const light of m.lights) { light.i = 0; light.curI = 0; }
    const keep = this.keep();
    let lamp = m.lights.find((light) => light.id === 'keep');
    if (!lamp) {
      lamp = { id: 'keep', on: true, flicker: 0, seed: 1, x: keep.x, y: keep.y + 30, r: 560, color: [255, 220, 170], flick: 0, room: m.findRoom(keep.x, keep.y), type: 'lamp' };
      m.lights.push(lamp);
    }
    lamp.i = 0.62; lamp.curI = 0.62; lamp.f = 1;
    if (!m.solids.some((solid) => solid.type === 'keep')) {
      // a plus and a square: the round tower's footprint within ~20 px
      const r = keep.r;
      const a = Math.round(r * 0.625), b = Math.round(r * 0.85);
      const rects = [
        { x: keep.x - r, y: keep.y - a, w: r * 2, h: a * 2 },
        { x: keep.x - a, y: keep.y - r, w: a * 2, h: r * 2 },
        { x: keep.x - b, y: keep.y - b, w: b * 2, h: b * 2 },
      ];
      for (const rect of rects) m._indexSolid({ ...rect, type: 'keep', solid: true });
    }
  }

  _applyEntranceState() {
    if (!this._savedEntrances) return;
    const byId = new Map(this.game.mansion.entrances.map((e) => [e.id, e]));
    for (const row of this._savedEntrances) {
      const e = byId.get(row.id);
      if (!e) continue;
      e.hpMax = Math.max(e.baseHpMax || 100, Number(row.hpMax) || e.baseHpMax);
      e.hp = clamp(Number(row.hp) || 0, 0, e.hpMax);
      e.broken = !!row.broken || e.hp <= 0;
      e.open = e.broken || !!row.open;
      e.barricade = Math.max(0, Number(row.barricade) || 0);
    }
  }

  enter() {
    const g = this.game;
    g.screen = 'playing';
    g.paused = false;
    g.player.state = 'idle';
    this.recenterCamera(true);
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(this.frameMul(this.phase !== 'day') * this.userZoom());
    g.renderer.snapCamera(g.player.x, g.player.y);
    if (this._wantsIntro()) this._startIntro();
    g.uiPanel = this.panelFor();
    g.input.gameplay = !this.cine && (this.phase === 'night' || this.phase === 'day');
    g.mansion.update(0, g);
    this._persist(true);
    return true;
  }

  /** The panel the run shows right now (a cinematic holds every other one). */
  panelFor() {
    if (this.cine) return 'survival-cine';
    return this.phase === 'day' ? 'survival-day' : this.phase === 'complete' ? 'survival-complete' : this.phase === 'failed' ? 'survival-failed' : null;
  }

  /** Dawn light: the day, and the morning the reinforcements arrive. */
  daylight() { return this.phase === 'day' || this.phase === 'complete'; }

  /* ---------------- K1 bookends (CINE) ---------------- */

  /**
   * The opening plays at the start of every run (Night 1, before its clock
   * has run): a fresh save, PLAY AGAIN and RESTART all open on it, a tap
   * skips it. It used to be told once per save (`introSeen`), so after the
   * first run it never came back and read as lost (playtest 2026-10-17:
   * "tralier toturial yg sebelum nya di buat di Awal itu hilang, harusnya
   * itu di pertahan kan"). `introSeen` is still written, as a record only.
   */
  _wantsIntro() {
    if (!this.cinematics || this.cine) return false;
    if (this.phase !== 'night' || this.day !== 1 || this.nightsCompleted > 0) return false;
    // a reload in the middle of a night is not an opening
    return !(this.elapsed > 0.5);
  }

  _startIntro() {
    const g = this.game;
    const s = g.save.survival || (g.save.survival = freshProgress(this.nightDuration));
    // a record that this save has seen the opening (it no longer gates it)
    s.introSeen = true;
    // The night opens on its first wave already at a gate — the state the
    // night reaches at its first wave mark, minus the empty seconds before.
    this.elapsed = Math.max(this.elapsed, this.nightDuration * WAVE_TIMES[0]);
    g.time = this.elapsed;
    g.timeLeft = Math.max(0, this.nightDuration - this.elapsed);
    this.updateWaves();
    // the banners wait for the handover (the opening says it all first)
    this.banner = null;
    this.bannerQueue.length = 0;
    g.player.slashAge = null;
    const horde = g.enemies.filter((e) => e._survivalType === 'swarm' && !e.dead);
    let hx = 0, hy = 0;
    for (const e of horde) { hx += e.x; hy += e.y; }
    const gate = horde.length ? this.entranceById(horde[0].entranceId) : this.mainGate();
    const center = horde.length ? { x: hx / horde.length, y: hy / horde.length }
      : gate ? { x: gate.x + outwardOf(gate).x * 260, y: gate.y + outwardOf(gate).y * 260 } : { x: 0, y: -1200 };
    this.cine = { kind: 'intro', t: 0, dur: CINE.intro.dur, night: true, keys: this._introKeys(center, gate), horn: false };
    g.uiPanel = 'survival-cine';
    g.input.gameplay = false;
    this._cineCamera();
  }

  /** Height (world px) of the keep's roof walk, where its people stand. */
  _keepRoof() { return 228 * (1 + (this.keepLevel - 1) * 0.06); }

  /**
   * Where the play camera sits on the Hunter (followPlayer's goal without the
   * look-ahead): the hand-over frame the opening ends on.
   */
  _playFocus(night) {
    const p = this.game.player;
    const r = this.game.renderer;
    return { x: p.x, y: p.y - ((r.h || 720) < 560 ? (night ? 90 : 70) : 0) };
  }

  /**
   * World offset (along +x and +y) that lifts a framed subject clear of the
   * caption chip: half the chip's height (drawCineCaption: 48 / 58 px) plus
   * its gap, turned into floor distance at the key's zoom.
   */
  _cineLift(z, night) {
    const r = this.game.renderer;
    const px = (((r.h || 720) < 560 ? 48 : 58) + 10) / 2;
    const zoom = this.frameMul(night) * (r.baseZoom || 1) * z;
    return px / Math.max(0.05, zoom * 0.8165);
  }

  /**
   * Camera keys. A raised point shows where the floor point (x − h, y − h)
   * would: the keep's roof walk is framed from its floor offset.
   * 1 the keep's roof walk, close; 2 the horde massed outside its gate, the
   * gate in frame, with a slow push in; 3 the Hunter; 4 the play frame.
   */
  _introKeys(horde, gate) {
    const keep = this.keep();
    const roof = this._keepRoof();
    const top = { x: keep.x - roof * 0.72, y: keep.y - roof * 0.72 };
    const door = gate || { x: horde.x, y: horde.y + 300 };
    const along = (f, z) => {
      const a = this._cineLift(z, true);
      return { x: lerp(door.x, horde.x, f) + a, y: lerp(door.y, horde.y, f) + a, z };
    };
    const p = this.game.player;
    const play = this._playFocus(true);
    // zooms are multiples of the play frame (FRAME_CLOSER 1.1): the first
    // shot holds the townsfolk on the roof walk and pulls back until the
    // whole keep and its banner stand in the letterbox (at 2.4 x the 1.3
    // frame it showed only the battlements, cut by the bars)
    return [
      { t: 0, x: top.x - 22, y: top.y - 22, z: 1.6 },
      { t: 2.2, x: top.x + 24, y: top.y + 24, z: 1.3 },
      { t: 3.3, ...along(0.45, 0.9) },
      { t: 4.7, ...along(0.52, 1.0) },
      { t: 5.7, x: p.x - 30, y: p.y - 30, z: 1.4 },
      { t: CINE.intro.dur, x: play.x, y: play.y, z: 1 },
    ];
  }

  /** Drive the camera along the current cinematic's keys (eased per leg). */
  _cineCamera() {
    const c = this.cine;
    const r = this.game.renderer;
    if (!c || !c.keys || !c.keys.length || !r || !r.cam) return;
    const keys = c.keys;
    let i = 0;
    while (i < keys.length - 2 && c.t >= keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[Math.min(keys.length - 1, i + 1)];
    const k = clamp((c.t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
    const e = k * k * (3 - 2 * k);
    r.cam.x = lerp(a.x, b.x, e);
    r.cam.y = lerp(a.y, b.y, e);
    r.cam.shake = 0; r.cam.sx = 0; r.cam.sy = 0;
    const play = this.frameMul(c.night) * (r.baseZoom || 1);
    const zoom = play * lerp(a.z, b.z, e);
    if (r.setZoomAbsolute) r.setZoomAbsolute(zoom);
    else if (r.setZoomMul) r.setZoomMul(zoom / (r.baseZoom || 1));
  }

  /** The caption on screen now (+ its age), or null. */
  cineCaption() {
    const c = this.cine;
    if (!c) return null;
    const spec = CINE[c.kind];
    const row = spec && spec.captions.find((cap) => c.t >= cap.from && c.t < cap.to);
    return row ? { ...row, age: c.t - row.from, left: row.to - c.t } : null;
  }

  updateCine(dt) {
    const g = this.game;
    const c = this.cine;
    c.t += dt;
    g.mansion.update(dt, g);
    g.player.anim(dt);
    // a muzzle flash in flight still fades (the player's update is held)
    if (g.player.slashAge != null && g.player.slashAge < 1) g.player.slashAge += dt;
    if (c.kind === 'intro') {
      // the horde waits at its gate, restless: arms sway, nobody advances
      for (const e of g.enemies) if (e._crowd && !e.dead) e.t = (e.t || 0) + dt;
      if (!c.horn && c.t >= CINE.intro.horn) { c.horn = true; g.audio.play('horn', { vol: 0.85 }); }
    } else if (c.kind === 'arrival') {
      this.updateRelief(dt);
      if (!c.fanfare && c.t >= CINE.arrival.fanfare) { c.fanfare = true; g.audio.play('fanfare', { vol: 0.8 }); }
    }
    this._cineCamera();
    if (c.t >= c.dur) this.endCine();
  }

  /** A tap anywhere (after the arming beat) skips to the hand-over. */
  skipCine() {
    if (!this.cine || this.cine.t < CINE.armAfter) return false;
    this.endCine();
    return true;
  }

  endCine() {
    const c = this.cine;
    if (!c) return;
    const g = this.game;
    const r = g.renderer;
    // the frame the cinematic would have ended on (a skip cuts straight to it)
    c.t = c.dur;
    this._cineCamera();
    this.cine = null;
    this.recenterCamera(true);
    if (c.kind === 'intro') {
      if (r.setZoomMul) r.setZoomMul(this.frameMul(true) * this.userZoom());
      this._nightIntro();
    } else if (c.kind === 'arrival') {
      this.updateRelief(Infinity);
    }
    g.uiPanel = this.panelFor();
    g.input.gameplay = this.phase === 'night' || this.phase === 'day';
    this._persist(true);
  }

  /**
   * The relief column: a banner-bearer and four ranks of two spears. They
   * start outside the main gate and march in along the gate road to two
   * lines in front of the keep (or stand there already: `placed`).
   */
  _reliefColumn(placed = false) {
    const keep = this.keep();
    const gate = this.mainGate();
    const out = gate ? outwardOf(gate) : { x: 0, y: 1 };
    const along = { x: -out.y, y: out.x };
    const gx = gate ? gate.x : keep.x + out.x * 900;
    const gy = gate ? gate.y : keep.y + out.y * 900;
    const front = keep.r + 118;
    const at = (o, d, l) => ({ x: o.x + out.x * d + along.x * l, y: o.y + out.y * d + along.y * l });
    const face = Math.atan2(-out.y, -out.x);
    const troops = [{ role: 'banner', rank: 0, file: 0, slot: at(keep, front, 0) }];
    for (let rank = 1; rank <= 4; rank++) {
      for (const file of [-1, 1]) {
        // two lines of four behind the banner: ranks 1–2 in front, 3–4 behind
        const line = rank <= 2 ? 0 : 1;
        const col = (rank % 2 === 1 ? 0.5 : 1.5) * file;
        // spacing for the GLB knights (shoulder pads and shields, x1.6):
        // 104 apart each way, so no two bodies overlap in the lines
        troops.push({ role: 'spear', rank, file, slot: at(keep, front + 96 + line * 104, col * 104) });
      }
    }
    const gatePt = { x: gx, y: gy };
    return troops.map((tr, i) => {
      const start = at(gatePt, 130 + tr.rank * 68, tr.file * 34);
      const inside = at(gatePt, -90, tr.file * 34);
      const s = {
        id: i, role: tr.role, x: start.x, y: start.y, angle: face, face,
        path: [inside, tr.slot], i: 0, delay: tr.rank * 0.1 + 0.25, walkT: rand(0, 1), moving: false,
      };
      if (placed) Object.assign(s, { x: tr.slot.x, y: tr.slot.y, i: 2, delay: 0 });
      return s;
    });
  }

  /** March the column along its path; Infinity snaps everyone into line. */
  updateRelief(dt) {
    const list = this.reinforcements;
    if (!list) return;
    for (const s of list) {
      if (dt === Infinity) {
        const end = s.path[s.path.length - 1];
        s.x = end.x; s.y = end.y; s.i = s.path.length; s.delay = 0; s.moving = false; s.angle = s.face;
        continue;
      }
      if (s.delay > 0) { s.delay -= dt; continue; }
      if (s.i >= s.path.length) { s.moving = false; s.angle = s.face; continue; }
      const wp = s.path[s.i];
      const dx = wp.x - s.x, dy = wp.y - s.y;
      const d = Math.hypot(dx, dy);
      const step = CINE.march * dt;
      if (d <= step) { s.x = wp.x; s.y = wp.y; s.i++; }
      else { s.x += (dx / d) * step; s.y += (dy / d) * step; s.angle = Math.atan2(dy, dx); }
      s.moving = s.i < s.path.length;
      s.walkT += dt;
    }
  }

  _startArrival() {
    const g = this.game;
    const keep = this.keep();
    const gate = this.mainGate();
    const out = gate ? outwardOf(gate) : { x: 0, y: 1 };
    const roof = this._keepRoof();
    const gx = gate ? gate.x : keep.x, gy = gate ? gate.y : keep.y + 900;
    // the gate with the road outside it (the column comes up it), then in
    // through the gate and up to the keep: its roof and the two lines in one
    // frame, all of it lifted clear of the caption
    const key = (t, x, y, z) => { const a = this._cineLift(z, false); return { t, x: x + a, y: y + a, z }; };
    const lines = { x: keep.x + out.x * (keep.r + 180), y: keep.y + out.y * (keep.r + 180) };
    const finale = { x: (lines.x + keep.x - roof) / 2, y: (lines.y + keep.y - roof) / 2 };
    this.cine = {
      kind: 'arrival', t: 0, dur: CINE.arrival.dur, night: false, fanfare: false,
      keys: [
        key(0, gx - out.x * 50 - 40, gy - out.y * 50, 1.55),
        key(2.0, gx - out.x * 130 - 40, gy - out.y * 130, 1.45),
        key(3.6, gx - out.x * 420 - 70, gy - out.y * 420 - 70, 1.3),
        key(5.2, finale.x, finale.y, 1.2),
        key(CINE.arrival.dur, finale.x, finale.y, 1.14),
      ],
    };
    // the captain turns to meet them
    const p = g.player;
    p.angle = Math.atan2(lines.y - p.y, lines.x - p.x);
    this._cineCamera();
  }

  startNight() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    g._survivalHint = null;   // nor a day's into the night
    this.recenterCamera(true);
    this.phase = 'night';
    this.elapsed = 0;
    this.nightKeepStart = this.keepHp;
    this.walkPath = null;
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = freshNightStats();
    this._resetNightFx();
    g.time = 0;
    g.timeLeft = this.nightDuration;
    g.phase = NIGHT_PHASE;
    g.screen = 'playing';
    g.paused = false;
    g.uiPanel = null;
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.player.blood = Math.max(1, g.player.blood);
    g.player.wardSpent = false;
    for (const e of g.mansion.entrances) {
      e.attackers = 0; e.flash = 0; e.lastTouched = -99;
    }
    this.applyBuildingEffects(true);
    g.mansion.buildNav();
    this._fields.clear();
    this._syncBakePhase();
    this._syncGuardRoster(true);
    this._syncTowers();
    this._guardAssignT = 0;
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(this.frameMul(true));
    g.renderer.snapCamera(g.player.x, g.player.y);
    this._nightIntro();
    this._persist(true);
    return true;
  }

  _resetNightFx() {
    this.floaters.length = 0;
    this.fx.length = 0;
    this.hudPops = [];
    this._mineBank = Object.create(null);
    // tonight's tally over every ballista (the night HUD's kill pills)
    for (const t of this.towers || []) t.nightKills = 0;
    this.keepBallistaKills = 0;
    this.bannerQueue.length = 0;
    this.banner = null;
    this.keepAttackers = 0;
    this.hitStop = 0;
    this.keepBallista.target = null;
    this.keepBallista.shotT = 0;
    this._doorPressure.clear();
    this._breachAt = Object.create(null);
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._keepHitAt = -99;
    this._keepWarnAt = -99;
    this._keepLowWarned = false;
  }

  _nightIntro() {
    const left = 3 - this.nightsCompleted;
    // the first night says who you are and what you hold (shown once a run)
    if (this.day === 1) this.pushEvent('night', 'keep', 'HOLD THE KEEP', { sub: 'REINFORCEMENTS IN 3 NIGHTS', life: 3.2 });
    else this.pushEvent('night', 'moon', `NIGHT ${this.day}`, { sub: left > 1 ? `REINFORCEMENTS IN ${left} NIGHTS` : 'REINFORCEMENTS AT DAWN', life: 2.6 });
  }

  update(dt) {
    const g = this.game;
    this._syncBakePhase();
    this.uiClock += dt;
    // Pause freezes the run: Flare cooldown, banners and damage numbers all
    // wait with the night instead of quietly running out behind the panel.
    if (g.screen === 'playing') {
      this._updateFx(dt);
      // the run's clock for the end panel: nights and days, never a pause
      // or a cinematic
      if (!this.cine && (this.phase === 'night' || this.phase === 'day')) this.runStats.time = (this.runStats.time || 0) + dt;
      // (the Flare's cooldown belongs to the run: it waits out a cinematic)
      if (!this.cine) {
        this.skillCooldown = Math.max(0, this.skillCooldown - dt);
        this.skillFlash = Math.max(0, this.skillFlash - dt);
      }
    }
    // a cinematic owns the frame: the world draws, the run's clock waits
    if (this.cine) {
      if (g.screen === 'playing') this.updateCine(dt);
      else g.player.anim(0);
      this._saveT += dt;
      if (this._saveT >= SAVE_EVERY) { this._saveT = 0; this._persist(false); }
      return;
    }
    // a heavy kill holds the night still for a few frames (hit-stop)
    if (this.hitStop > 0 && this.phase === 'night' && g.screen === 'playing') {
      this.hitStop = Math.max(0, this.hitStop - dt);
      g.player.anim(0);
      return;
    }
    if (this.phase === 'night' && g.screen === 'playing' && !g.uiPanel) this.updateNight(dt);
    else if (this.phase === 'day' && g.screen === 'playing') this.updateDay(dt);
    else {
      g.mansion.update(dt, g);
      g.player.anim(dt);
    }
    this._saveT += dt;
    if (this._saveT >= SAVE_EVERY) { this._saveT = 0; this._persist(false); }
  }

  updateNight(dt) {
    const g = this.game;
    this.elapsed = Math.min(this.nightDuration, this.elapsed + dt);
    g.time = this.elapsed;
    g.timeLeft = Math.max(0, this.nightDuration - this.elapsed);
    g.phase = NIGHT_PHASE;
    g.danger = clamp(0.18 + this.elapsed / this.nightDuration * 0.55 + (this.day - 1) * 0.08, 0.1, 0.92);
    g.bloodMoon = 0; g.duelDark = 0; g.blackoutT = 0; g.powerOut = false;
    g.lightningFlash = Math.max(0, g.lightningFlash - dt * 2.4);

    if (g.player.bloodMax !== this.hunterStats().hp) this.applyHunterStats(false);
    this.updateWaves();
    this.updateMines(dt);
    g.mansion.update(dt, g);

    this.currentTarget = this.autoTarget();
    if (this.currentTarget) {
      const p = g.player;
      p.angle = Math.atan2(this.currentTarget.y - p.y, this.currentTarget.x - p.x);
      // Hunter's shot is an auto-attack. A manual press still works and lets
      // touch/keyboard players prioritize a target by facing toward it.
      g.input.attackDown = true;
    }
    if (g.input.interactPressed) this.useSkill();
    g.player.update(dt, g);
    g.player.anim(dt);

    let attackers = 0;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      e.update(dt, g);
      if (e.attackingKeep && !e.dead) attackers++;
      if (e.removeMe) g.enemies.splice(i, 1);
    }
    this.keepAttackers = attackers;
    this.updateKeepBallista(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    const p = g.player;
    if (this._lastPlayerPos) this._movedSinceStart += Math.hypot(p.x - this._lastPlayerPos.x, p.y - this._lastPlayerPos.y);
    this._lastPlayerPos = { x: p.x, y: p.y };
    if (!this._keepLowWarned && this.keepHp > 0 && this.keepHp < this.keepHpMax() * 0.25) {
      this._keepLowWarned = true;
      this.pushEvent('keepLow', 'keep', 'KEEP CRITICAL!');
    }
    for (let i = g.bolts.length - 1; i >= 0; i--) {
      const b = g.bolts[i];
      b.update(dt, g);
      if (b.dead || dist(b.x, b.y, g.player.x, g.player.y) > 2600) g.bolts.splice(i, 1);
    }
    this.updateCrowdSiege(dt);
    this.updateGateMeter();
    // A hit makes a door flash for a moment; Survival owns the decay (the
    // legacy loop that used to fade it never runs here), otherwise one claw
    // marked a door "under attack" for the rest of the night.
    for (const e of g.mansion.entrances) if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 1.6);
    this.followPlayer(dt);
    if (this.phase !== 'night') return;
    if (this.keepHp <= 0) this.fail('THE KEEP FELL');
    else if (g.player.blood <= 0 && g.player.state !== 'death') g.killPlayer('Hunter lost');
    else if (g.player.state === 'death' || g.player.state === 'dead') this.fail('Hunter lost');
    else if (this.elapsed >= this.nightDuration) this.completeNight();
  }

  /**
   * The day is a walk between build circles (P1): the Hunter moves with the
   * stick (a little faster than at night), or walks himself to a circle that
   * was tapped. Nothing attacks; the clock does not run.
   */
  updateDay(dt) {
    const g = this.game;
    this.elapsed += dt;
    g.time = this.elapsed;
    g.timeLeft = 0;
    g.phase = DAY_PHASE;
    g.danger = 0.02;
    g.bloodMoon = 0; g.duelDark = 0; g.blackoutT = 0; g.powerOut = false;
    g.mansion.update(dt, g);
    const p = g.player;
    const input = g.input;
    this.currentTarget = null;
    input.attackDown = false;
    input.attackPressed = false;
    input.interactPressed = false;
    const steering = !this.rewardPending() && input.moving;
    if (steering) this.walkPath = null;
    if (this.walkPath && !this.rewardPending()) this._walkAlong(dt);
    else if (!this.rewardPending()) {
      const mul = p.speedMul;
      p.speedMul = (mul || 1) * this.tuning.dayWalkMul;
      p.update(dt, g);
      p.speedMul = mul;
    }
    p.anim(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    if (this.builderJob) {
      this.builderJob.remaining = Math.max(0, this.builderJob.remaining - dt);
      if (this.builderJob.remaining <= 0) this.finishBuilderJob();
    }
    this.followPlayer(dt);
  }

  /** Walk the Hunter to a point by day (a tapped circle), around furniture. */
  walkTo(x, y) {
    if (this.phase !== 'day') return false;
    const p = this.game.player;
    const path = this.game.mansion.navPath(p.x, p.y, x, y) || [{ x, y }];
    this.walkPath = { points: path.concat([{ x, y }]), i: 0, t: 0 };
    return true;
  }

  _walkAlong(dt) {
    const g = this.game;
    const p = g.player;
    const path = this.walkPath;
    path.t += dt;
    const speed = 210 * this.tuning.dayWalkMul;
    let budget = speed * dt;
    let vx = 0, vy = 0;
    while (budget > 0 && path.i < path.points.length) {
      const wp = path.points[path.i];
      const dx = wp.x - p.x, dy = wp.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) { path.i++; continue; }
      const step = Math.min(d, budget);
      const res = g.mansion.resolve(p.x + dx / d * step, p.y + dy / d * step, p.radius, true);
      vx = dx / d * speed; vy = dy / d * speed;
      const moved = Math.hypot(res.x - p.x, res.y - p.y);
      p.x = res.x; p.y = res.y;
      budget -= step;
      if (moved < step * 0.2) { path.i++; break; }   // blocked: try the next point
    }
    p.vx = vx; p.vy = vy;
    if (vx || vy) p.angle = approachAngle(p.angle, Math.atan2(vy, vx), dt * 14);
    if (path.i >= path.points.length || path.t > 12) { this.walkPath = null; p.vx = 0; p.vy = 0; }
  }

  updateWaves() {
    const duration = this.nightDuration;
    const waveTimes = WAVE_TIMES;
    const counts = this.waveCounts();
    while (this.waveIndex < waveTimes.length && this.elapsed >= duration * waveTimes[this.waveIndex]) {
      this.spawnSwarm(counts[this.waveIndex], this.waveIndex);
      this.waveIndex++;
      this.pushEvent('wave', 'swarm', `WAVE ${this.waveIndex}/${waveTimes.length}`);
    }
    const breakerAt = this.day >= 2 ? duration * BREAKER_TIMES[0] : Infinity;
    if (this.day >= 2 && this.breakerIndex === 0 && this.elapsed >= breakerAt) {
      this.spawnBreaker(0);
      this.breakerIndex = 1;
    }
    if (this.day >= 3 && this.breakerIndex === 1 && this.elapsed >= duration * BREAKER_TIMES[1]) {
      this.spawnBreaker(1);
      this.breakerIndex = 2;
    }
    const individualAt = INDIVIDUAL_TIMES;
    while (this.individualIndex < individualAt.length && this.elapsed >= duration * individualAt[this.individualIndex]) {
      this.spawnIndividual(this.individualIndex);
      this.individualIndex++;
    }
  }

  spawnSwarm(count, wave, forced = null) {
    const g = this.game;
    const entrance = forced || this.chooseTargetEntrance(g.player.x, g.player.y, wave);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const total = clamp(Math.round(count), 1, SWARM_CAP);
    const queued = this.crowdAt(entrance.id).length;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const lateral = (col - 3) * 50 + rand(-8, 8);
      const depth = 150 + row * 64 + rand(-16, 16);
      const { x, y } = this._outsideSpot(entrance, out, along, lateral, depth);
      // Ranks count from the front of *this* door's crowd: a wave that joins
      // an existing crowd queues behind it, a fresh door starts at rank 0.
      const body = new SurvivalCrowdZombie(x, y, entrance, queued + i, this.day);
      body.id = 1000000 + this.day * 10000 + wave * 100 + i;
      g.enemies.push(body);
    }
  }

  /**
   * Where a body queued at a door starts: its formation slot outside the
   * walls, or — when that slot falls inside another room of the house (the
   * front door's crowd reached into the basement, the dining door's into the
   * gallery) or on a prop — the nearest clear slot further out. A body that
   * started inside skipped the door and walked straight to the fire.
   */
  _outsideSpot(entrance, out, along, lateral, depth) {
    const m = this.game.mansion;
    const b = m.bounds;
    const at = (l, d) => ({ x: entrance.outside.x + out.x * d + along.x * l, y: entrance.outside.y + out.y * d + along.y * l });
    const clear = (q) => (!b || (q.x > b.x + 24 && q.x < b.x + b.w - 24 && q.y > b.y + 24 && q.y < b.y + b.h - 24))
      && m.findRoom(q.x, q.y) === ROOM.OUTSIDE
      && !m.solidAt(q.x, q.y) && !m.solidAt(q.x + 14, q.y) && !m.solidAt(q.x - 14, q.y)
      && !m.solidAt(q.x, q.y + 14) && !m.solidAt(q.x, q.y - 14);
    const first = at(lateral, depth);
    if (clear(first)) return first;
    for (let k = 1; k <= 10; k++) {
      const d = depth + k * 26;
      for (const l of [lateral, -lateral, lateral * 0.6, -lateral * 0.6, lateral * 0.25, -lateral * 0.25]) {
        const q = at(l, d);
        if (clear(q)) return q;
      }
    }
    return first;
  }

  spawnIndividual(index) {
    const g = this.game;
    const entrance = this.chooseTargetEntrance(g.player.x, g.player.y, index + 2);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const jx = rand(-42, 42), jy = rand(-42, 42);
    const depth = 180 + index * 54 + (out.x * jx + out.y * jy);
    const { x, y } = this._outsideSpot(entrance, out, along, along.x * jx + along.y * jy, depth);
    const enemy = new SurvivalIndividualZombie(x, y, entrance, this.day, index);
    enemy.id = 2000000 + this.day * 100 + index;
    g.enemies.push(enemy);
  }

  spawnBreaker(index = 0) {
    const g = this.game;
    const entrance = this.mainGate();
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const jx = rand(-20, 20), jy = rand(-20, 20);
    const depth = 330 + index * 80 + (out.x * jx + out.y * jy);
    const { x, y } = this._outsideSpot(entrance, out, along, along.x * jx + along.y * jy, depth);
    const breaker = new SurvivalBreaker(x, y, entrance, this.day, index);
    breaker.id = 3000000 + this.day * 10 + index;
    // Preserve a permanent structure target even if the hero is the nearest
    // visible actor. This is also surfaced to QA diagnostics.
    breaker.targetKind = 'wall';
    breaker.targetEntranceId = entrance.id;
    g.enemies.push(breaker);
    this.pushEvent('breaker', 'breaker', 'BREAKER!');
  }

  chooseTargetEntrance(_x, _y, offset = 0) {
    const doors = this.game.mansion.entrances.filter((e) => e.kind === 'door' && e.exterior);
    if (!doors.length) return this.mainGate();
    // Every night tests a different side, and the nights get *closer*: the
    // old rotation sent Night 3 to the three doors furthest from the fire, so
    // its biggest waves never reached the Perapian before dawn. Night 3 now
    // opens with the chapel (near), presses the palisade, and ends with its
    // largest wave on the front gate beside both Breakers.
    const plan = NIGHT_DOORS[clamp(this.day - 1, 0, NIGHT_DOORS.length - 1)];
    const wanted = plan[offset % plan.length];
    const exact = doors.find((e) => e.id === wanted);
    if (exact) return exact;
    const priority = ['southGate', 'northGate', 'eastGate', 'westGate', 'posternNW', 'posternSE'];
    const start = (offset + (this.day - 1) * 2) % priority.length;
    for (let i = 0; i < priority.length; i++) {
      const candidate = doors.find((e) => e.id === priority[(start + i) % priority.length]);
      if (candidate) return candidate;
    }
    return doors[0];
  }

  /** Dawn: survivors patch every exterior door (the gate keeps its bonus). */
  repairDoors() {
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior) continue;
      e.hpMax = Math.max(e.baseHpMax || 100, e.hpMax || 0);
      e.hp = e.hpMax; e.broken = false; e.open = false; e.flash = 0; e.attackers = 0;
    }
    this._breachAt = Object.create(null);
    this.game.mansion.buildNav();
    this._fields.clear();
  }

  entranceById(id) { return this.game.mansion.entrances.find((e) => e.id === id) || null; }
  mainGate() { return this.game.mansion.frontDoor || this.entranceById('frontDoor') || this.game.mansion.doors[0] || null; }

  /** Living swarm bodies still outside, queued at one door. */
  crowdAt(id) {
    return this.game.enemies.filter((e) => !e.dead && !e.removeMe && e._survivalType === 'swarm'
      && !e._inHouse && e.entranceId === id);
  }

  /**
   * Close the ranks: front-rank deaths are filled by the nearest body behind,
   * so a crowd keeps leaning on the wood (and stays in reach of the Hunter
   * and the guards) instead of standing on its spawn spots.
   */
  reslotCrowds() {
    const byDoor = new Map();
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || e._survivalType !== 'swarm' || e._inHouse) continue;
      const door = this.entranceById(e.entranceId);
      if (!door || door.broken) continue;
      let list = byDoor.get(door);
      if (!list) byDoor.set(door, (list = []));
      list.push(e);
    }
    for (const [door, list] of byDoor) {
      const free = list.slice();
      for (let slot = 0; slot < list.length; slot++) {
        const spot = survivalSpot(door, slot, 72);
        let best = 0, bestD = Infinity;
        for (let k = 0; k < free.length; k++) {
          const b = free[k];
          // a small bias keeps a body on its own slot when it is a tie
          const d = (b.x - spot.x) ** 2 + (b.y - spot.y) ** 2 - (b.index === slot ? 1600 : 0);
          if (d < bestD) { bestD = d; best = k; }
        }
        free[best].index = slot;
        free.splice(best, 1);
      }
    }
  }

  updateCrowdSiege(dt) {
    const g = this.game;
    this._reslotT = (this._reslotT || 0) - dt;
    if (this._reslotT <= 0) { this._reslotT = 0.6; this.reslotCrowds(); }
    const pressed = new Map();
    for (const e of g.enemies) {
      if (!e._survivalType || e.dead || e._survivalType !== 'swarm' || e.state !== CROWD.PRESS) continue;
      const id = e.entranceId || (e.entrance && e.entrance.id);
      if (!id) continue;
      // only the ranks actually leaning on the wood claw it
      const door = e.entrance;
      if (door && dist(e.x, e.y, door.x, door.y) > SIEGE_REACH) continue;
      const row = pressed.get(id) || { count: 0, sample: e };
      row.count++;
      pressed.set(id, row);
    }
    this._doorPressure.clear();
    for (const e of g.enemies) {
      if (e.dead || !e._survivalType || e._survivalType === 'swarm') continue;
      if (e.state !== 'press' && e.state !== 'strike') continue;
      if (e._inHouse || e.attackingKeep) continue;
      const id = e._survivalType === 'breaker' ? e.targetEntranceId : e.entranceId;
      if (id) this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + 1);
    }
    for (const [id, row] of pressed) {
      const entrance = this.entranceById(id);
      if (!entrance || entrance.broken) continue;
      this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + row.count);
      this.siegeTimers[id] = Math.max(0, (this.siegeTimers[id] || 0) - dt);
      if (this.siegeTimers[id] <= 0) {
        const amount = Math.min(18, 2 + row.count * 1.3);
        this.damageEntrance(entrance, amount, row.sample);
        this.siegeTimers[id] = 1.6;
      }
    }
    for (const key of Object.keys(this.siegeTimers)) {
      if (!pressed.has(key)) this.siegeTimers[key] = Math.max(0, (this.siegeTimers[key] || 0) - dt);
    }
  }

  updateGateMeter() {
    const gate = this.mainGate();
    if (!gate) return;
    this.gateHp = Math.max(0, gate.hp);
    if (gate.broken) this.gateHp = 0;
  }

  damageEntrance(entrance, amount, source = null) {
    if (!entrance || entrance.broken || !(amount > 0)) return;
    const before = entrance.hp;
    this.game.mansion.damageEntrance(entrance, amount, this.game, source && source.x, source && source.y);
    this.nightStats.damageToWalls += Math.max(0, before - entrance.hp);
    this.gateHp = Math.max(0, this.mainGate() ? this.mainGate().hp : 0);
    if (entrance.broken) this.onBreach(entrance);
  }

  onBreach(entrance) {
    if (this._breachAt[entrance.id] != null) return;
    this._breachAt[entrance.id] = this.uiClock;
    if (!Array.isArray(this.nightStats.breached)) this.nightStats.breached = [];
    if (!this.nightStats.breached.includes(entrance.id)) this.nightStats.breached.push(entrance.id);
    this.game.mansion.refreshNavAround(entrance);
    this.pushEvent('breach', 'doorBroken', 'BREACH!');
    this.game.renderer.shake(0.22);
  }

  /**
   * Inside the banner's yards the garrison hits harder (gold numbers). The
   * number pops bigger on the bolt that kills, so a heavy shot reads.
   */
  enemyDamageTaken(enemy, amount) {
    const held = this.inTerritory(enemy.x, enemy.y);
    const dealt = amount * (held ? this.tuning.territoryDamageTakenMul : 1);
    if (dealt > 0.5) {
      // bodies read bigger in Survival (SURVIVAL_ACTOR_SCALE): the number
      // and the flash sit at their chest, not at their knees
      const h = (enemy._survivalType === 'breaker' ? 96 : enemy._survivalType === 'individual' ? 78 : 60) * SURVIVAL_ACTOR_SCALE;
      const kill = (enemy.hp || 0) - dealt <= 0;
      const src = killSource(this.game, enemy._lastHitBy);
      const heavy = src === 'tower' || src === 'keep' || src === 'flare' || dealt >= 28;
      this.pushFloater(enemy.x + rand(-12, 12), enemy.y, `${Math.round(dealt)}`, kill ? '#ff9a3c' : held ? '#ffd24a' : '#ffffff',
        { h, size: kill ? 40 : heavy ? 32 : held ? 28 : 23, pop: kill ? 1.7 : heavy ? 1.55 : 1.4, drift: rand(-30, 30), kind: kill ? 'kill' : heavy ? 'heavy' : 'hit' });
      // the hit lands: a flash and a ring at the body (world3d) and sparks
      // thrown back along the shot
      const color = HIT_COLOR[src] || '#ffffff';
      this.pushFx('impact', enemy.x, enemy.y, { h: h * 0.62, color, heavy, kill });
      const g = this.game;
      if (g.particles) {
        g.particles.burst('spark', enemy.x, enemy.y, heavy ? 10 : 6, {
          color: heavy ? 'rgba(255,170,90,0.95)' : src === 'guard' ? 'rgba(170,236,255,0.95)' : 'rgba(255,226,150,0.95)',
          sizeMin: heavy ? 2.4 : 1.8, sizeMax: heavy ? 5.5 : 4, speedMin: 50, speedMax: heavy ? 260 : 190,
          lifeMin: 0.12, lifeMax: heavy ? 0.42 : 0.32, glow: true,
        });
      }
    }
    return dealt;
  }

  /** Claws are never blunted or blocked: the banner only strengthens the garrison. */
  enemyCanAttack() { return true; }
  enemyAttackMul() { return 1; }

  autoTarget() {
    const p = this.game.player;
    // Closed doors have shooting slits: the Hunter picks off a crowd leaning
    // on a door from inside. Solid walls still block the shot.
    const candidates = this.game.enemies.filter((e) => !e.dead && !e.removeMe && e.hp > 0
      && dist(p.x, p.y, e.x, e.y) <= this.tuning.autoAttackRange
      && this.game.mansion.hasLOS(p.x, p.y, e.x, e.y, { throughDoors: true }));
    candidates.sort((a, b) => this.targetScore(p, a) - this.targetScore(p, b));
    return candidates[0] || null;
  }

  /** Lower is shot first: whatever claws the keep, then what is already inside. */
  targetScore(from, e) {
    let s = dist(from.x, from.y, e.x, e.y);
    if (e._survivalType === 'breaker') s -= 70;
    else if (e._survivalType === 'individual') s -= 20;
    if (e.attackingKeep) s -= 160;
    else if (e._inHouse) s -= 60;
    return s;
  }

  /* ---------------- guards (survivors) ---------------- */

  /** One pawn per soldier (capped). New ones step out by the keep. */
  _syncGuardRoster(snap = false, from = null) {
    const want = clamp(Math.floor(this.survivors || 0), 0, GUARD.cap);
    while (this.guards.length > want) this.guards.pop();
    let fresh = 0;
    while (this.guards.length < want) {
      const i = this.guards.length;
      const post = this._keepPost(i);
      // a soldier a barracks just housed starts at its door (fanned out so
      // two do not stand in one spot) and walks to the post
      const start = from && !snap ? { x: from.x + (fresh % 2 ? 26 : -26) * Math.ceil(fresh / 2), y: from.y + 40 } : post;
      const guard = new SurvivalGuard(i, start.x, start.y);
      guard.post = start === post ? post : null;
      this.guards.push(guard);
      fresh++;
    }
    if (fresh && from && !snap) this._guardAssignT = 0;
    if (snap) {
      // a new phase (dawn, dusk, a fresh run): everyone stands, healed, by the keep
      for (const guard of this.guards) {
        const post = this._keepPost(guard.index);
        guard.x = post.x; guard.y = post.y; guard.post = post;
        guard.path = null; guard.moving = false; guard.target = null; guard.shotT = 0;
        guard.hp = guard.hpMax; guard.down = false; guard.downT = 0; guard.rescueT = 0; guard.hurtFlash = 0; guard.iframes = 0;
      }
    }
  }

  /** Guards still on their feet (the HUD counts these). */
  standingGuards() { return this.guards.filter((guard) => !guard.down).length; }

  /** The nearest standing guard a body is close enough to claw. */
  guardInReach(enemy) {
    let best = null, bestD = Infinity;
    for (const guard of this.guards) {
      if (guard.down) continue;
      const d = dist(enemy.x, enemy.y, guard.x, guard.y);
      if (d < (enemy.radius || 13) + guard.radius + GUARD.reach && d < bestD) { best = guard; bestD = d; }
    }
    return best;
  }

  /**
   * A guard a body in the dark goes for: the one it already picked while it
   * stays close and standing, else the nearest within huntRange that has
   * fewer than maxHunters on it (counted once a frame in updateGuards).
   */
  guardToHunt(enemy) {
    const prev = enemy._prey;
    if (prev && !prev.down && this.guards.includes(prev)
      && dist(enemy.x, enemy.y, prev.x, prev.y) < GUARD.huntRange * 1.4) return prev;
    enemy._prey = null;
    let best = null, bestD = GUARD.huntRange;
    for (const guard of this.guards) {
      if (guard.down || (guard.hunters || 0) >= GUARD.maxHunters) continue;
      const d = dist(enemy.x, enemy.y, guard.x, guard.y);
      if (d < bestD) { best = guard; bestD = d; }
    }
    if (best) { enemy._prey = best; best.hunters = (best.hunters || 0) + 1; }
    return best;
  }

  /** A claw lands on a guard. */
  hurtGuard(guard, amount, from = null) {
    if (!guard || guard.down || this.phase !== 'night' || !(amount > 0)) return false;
    // like the Hunter, a guard is not shredded by a crowd landing every claw
    // in the same frame
    if (guard.iframes > 0) return false;
    guard.iframes = GUARD.iframes;
    guard.hp = Math.max(0, guard.hp - amount);
    guard.hurtFlash = 1;
    this.nightStats.guardDamage = (this.nightStats.guardDamage || 0) + amount;
    this.pushFloater(guard.x, guard.y, `-${Math.round(amount)}`, '#ff6b5e', { h: 64, size: 15 });
    const g = this.game;
    g.audio.play('slash', { x: guard.x, y: guard.y, cam: g.renderer.cam, vol: 0.45 });
    if (guard.hp <= 0) this._downGuard(guard, from);
    else if (guard.hp <= guard.hpMax * GUARD.woundedAt) this._guardAssignT = 0;   // fall back now
    return true;
  }

  _downGuard(guard) {
    guard.down = true;
    guard.hp = 0;
    guard.downT = 0;
    guard.rescueT = 0;
    guard.path = null; guard.moving = false; guard.target = null; guard.shotT = 0;
    this.nightStats.guardsDown = (this.nightStats.guardsDown || 0) + 1;
    this.pushEvent('guardDown', 'medic', 'GUARD DOWN!', { life: 2.2 });
    this.game.audio.play('playerHurt', { vol: 0.5 });
    this._guardAssignT = 0;
  }

  /**
   * The Hunter stands beside a fallen guard: after a moment it gets up. Left
   * alone, its clock runs out and it is lost (the clock stops while helped).
   */
  _updateRescue(guard, dt) {
    const p = this.game.player;
    const near = this.phase === 'night' && p.state !== 'death' && p.state !== 'dead'
      && dist(p.x, p.y, guard.x, guard.y) <= GUARD.rescueRange;
    guard.rescueT = near ? guard.rescueT + dt : Math.max(0, guard.rescueT - dt * 2);
    if (!near) {
      guard.downT += dt;
      if (guard.downT >= GUARD.bleedOut) { this._loseGuard(guard); return; }
    }
    if (guard.rescueT < GUARD.rescueTime) return;
    guard.down = false;
    guard.rescueT = 0;
    guard.hp = Math.round(guard.hpMax * GUARD.rescueHp);
    guard.cd = 0.6;
    this.nightStats.rescued = (this.nightStats.rescued || 0) + 1;
    this.pushFloater(guard.x, guard.y, `+${guard.hp}`, '#5ee07a', { h: 70, size: 18, icon: 'heart', life: 1.2 });
    this.game.audio.play('uiConfirm', { vol: 0.5 });
    this._guardAssignT = 0;
  }

  /** Nobody came: one survivor fewer, for the rest of the run. */
  _loseGuard(guard) {
    const i = this.guards.indexOf(guard);
    if (i < 0) return;
    this.guards.splice(i, 1);
    this.guards.forEach((g, k) => { g.index = k; g.id = 5000000 + k; });
    this.survivors = Math.max(0, this.survivors - 1);
    this.nightStats.lost = (this.nightStats.lost || 0) + 1;
    this.runStats.lost = (this.runStats.lost || 0) + 1;
    this.pushEvent('guardLost', 'guard', 'GUARD LOST', { life: 2.2 });
    this.game.audio.play('playerHurt', { vol: 0.65 });
    this._guardAssignT = 0;
    this._persist(true);
  }

  /** A loose ring around the keep's foot (day camp / spare guards at night). */
  _keepPost(i) {
    const keep = this.keep();
    const t = (i + 0.5) / GUARD.cap;
    // south-east round to north-west: the Hunter's own spot is on the east
    const a = Math.PI * (0.35 + 0.8 * t);
    const r = keep.r + 54 + (i % 2) * 30;
    return this._freePost(keep.x + Math.cos(a) * r, keep.y + Math.sin(a) * r, 'keep', null);
  }

  /** Just inside a door, beside its frame: slot 0/1 left and right of the slit. */
  _doorPost(door, slot) {
    const out = outwardOf(door);
    const inward = { x: -out.x, y: -out.y };
    const along = { x: -inward.y, y: inward.x };
    const base = door.inside || door;
    const side = slot % 2 === 0 ? -1 : 1;
    const lateral = side * (26 + Math.floor(slot / 2) * 30);
    const depth = 46 + Math.floor(slot / 2) * 26;
    return this._freePost(base.x + inward.x * depth + along.x * lateral,
      base.y + inward.y * depth + along.y * lateral, `door:${door.id}:${slot}`, door.id, inward);
  }

  /** Nudge a post off furniture so a pawn never stands inside a table. */
  _freePost(x, y, key, doorId, push = null) {
    const m = this.game.mansion;
    const free = (px, py) => !m.solidAt(px, py) && !m.solidAt(px + 10, py) && !m.solidAt(px - 10, py)
      && !m.solidAt(px, py + 10) && !m.solidAt(px, py - 10);
    if (!free(x, y)) {
      const tries = push ? [[push.x * 24, push.y * 24], [push.x * 48, push.y * 48], [-push.y * 30, push.x * 30], [push.y * 30, -push.x * 30]]
        : [[0, 30], [30, 0], [-30, 0], [0, -30], [36, 36], [-36, 36]];
      for (const [ox, oy] of tries) if (free(x + ox, y + oy)) { x += ox; y += oy; break; }
    }
    return { key, x, y, doorId };
  }

  /**
   * Who stands where tonight: doors ranked by how many bodies lean on them
   * (outside crowds + anything coming through a breach), up to GUARD.perDoor
   * each; the rest hold the keep. A guard keeps its post while that door is
   * still in the ranking, so they do not ping-pong across the house.
   */
  assignGuards() {
    const g = this.game;
    if (!this.guards.length) return;
    if (this.phase !== 'night') {
      for (const guard of this.guards) this._setGuardPost(guard, this._keepPost(guard.index));
      return;
    }
    // a fallen guard stays where it fell; a badly hurt one holds the keep
    const able = [];
    for (const guard of this.guards) {
      if (guard.down) continue;
      if (guard.hp <= guard.hpMax * GUARD.woundedAt) this._setGuardPost(guard, this._keepPost(guard.index));
      else able.push(guard);
    }
    const threat = new Map();
    for (const e of g.enemies) {
      if (e.dead || e.removeMe || !e._survivalType) continue;
      if (!e._inHouse) {
        const id = e._survivalType === 'breaker' ? e.targetEntranceId : e.entranceId;
        const door = id && this.entranceById(id);
        if (!door || dist(e.x, e.y, door.x, door.y) > 520) continue;
        threat.set(door, (threat.get(door) || 0) + (e._survivalType === 'swarm' ? 1 : 3));
      }
    }
    // a breach keeps its guards: invaders still walk past them
    for (const door of g.mansion.entrances) {
      if (door.kind === 'door' && door.exterior && door.broken) {
        const near = this.enemiesNear(door.x, door.y, 420);
        if (near > 0) threat.set(door, (threat.get(door) || 0) + near);
      }
    }
    const ranked = [...threat.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    const slots = [];
    for (let pass = 0; pass < GUARD.perDoor; pass++) {
      for (const [door] of ranked) slots.push({ door, slot: pass });
    }
    const taken = new Set();
    const pending = [];
    for (const guard of able) {
      const keep = guard.post && guard.post.doorId
        && slots.find((s) => s.door.id === guard.post.doorId && !taken.has(`${s.door.id}:${s.slot}`));
      if (keep) { taken.add(`${keep.door.id}:${keep.slot}`); this._setGuardPost(guard, this._doorPost(keep.door, keep.slot)); }
      else pending.push(guard);
    }
    for (const guard of pending) {
      const free = slots.find((s) => !taken.has(`${s.door.id}:${s.slot}`));
      if (free) { taken.add(`${free.door.id}:${free.slot}`); this._setGuardPost(guard, this._doorPost(free.door, free.slot)); }
      else this._setGuardPost(guard, this._keepPost(guard.index));
    }
  }

  _setGuardPost(guard, post) {
    if (guard.post && guard.post.key === post.key && Math.hypot(guard.post.x - post.x, guard.post.y - post.y) < 4) return;
    guard.post = post;
    guard.path = this.game.mansion.navPath(guard.x, guard.y, post.x, post.y) || [{ x: post.x, y: post.y }];
    guard.pathI = 0;
  }

  /** Nearest thing worth a bolt that this guard can actually hit. */
  guardTarget(guard) {
    const m = this.game.mansion;
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0)) continue;
      const d = dist(guard.x, guard.y, e.x, e.y);
      if (d > GUARD.range) continue;
      const s = this.targetScore(guard, e);
      if (s >= bestS) continue;
      if (!m.hasLOS(guard.x, guard.y, e.x, e.y, { throughDoors: true })) continue;
      best = e; bestS = s;
    }
    return best;
  }

  updateGuards(dt) {
    const g = this.game;
    this._syncGuardRoster(false);
    if (!this.guards.length) return;
    this._guardAssignT = (this._guardAssignT || 0) - dt;
    if (this._guardAssignT <= 0) { this._guardAssignT = 0.5; this.assignGuards(); }
    const night = this.phase === 'night';
    // how many bodies are going for each guard (guardToHunt caps it)
    for (const guard of this.guards) guard.hunters = 0;
    if (night) {
      for (const e of g.enemies) {
        const prey = e._prey;
        if (prey && !e.dead && !e.removeMe && !prey.down) prey.hunters = (prey.hunters || 0) + 1;
      }
    }
    for (const guard of [...this.guards]) {
      guard.shotT = Math.max(0, guard.shotT - dt);
      guard.hurtFlash = Math.max(0, (guard.hurtFlash || 0) - dt * 4);
      guard.iframes = Math.max(0, (guard.iframes || 0) - dt);
      if (guard.down) {
        guard.moving = false;
        this._updateRescue(guard, dt);
        continue;
      }
      // walk the path to the post
      guard.moving = false;
      if (guard.path && guard.pathI < guard.path.length) {
        const wp = guard.path[guard.pathI];
        const dx = wp.x - guard.x, dy = wp.y - guard.y;
        const d = Math.hypot(dx, dy);
        const step = GUARD.speed * dt;
        if (d <= step) { guard.x = wp.x; guard.y = wp.y; guard.pathI++; }
        else { guard.x += dx / d * step; guard.y += dy / d * step; }
        if (d > 0.5) guard.angle = Math.atan2(dy, dx);
        guard.moving = true;
        guard.walkT += dt;
      }
      if (!night) { guard.target = null; continue; }
      guard.cd -= dt;
      if (guard.moving) { guard.cd = Math.max(guard.cd, 0.25); continue; }
      if (guard.cd > 0) {
        if (guard.target && !guard.target.dead) guard.angle = Math.atan2(guard.target.y - guard.y, guard.target.x - guard.x);
        continue;
      }
      const target = this.guardTarget(guard);
      guard.target = target;
      if (!target) { guard.cd = 0.3; continue; }
      const lead = dist(guard.x, guard.y, target.x, target.y) / GUARD.boltSpeed;
      const tx = target.x + (target.vx || 0) * lead, ty = target.y + (target.vy || 0) * lead;
      guard.angle = Math.atan2(ty - guard.y, tx - guard.x);
      const bolt = g.spawnBolt(guard, guard.angle, { offset: 16, boltSpeed: GUARD.boltSpeed, damage: GUARD.damage, friendly: true });
      if (bolt) bolt.guard = true;
      guard.cd = GUARD.every + rand(-0.12, 0.18);
      guard.shotT = 0.2;
      this.nightStats.guardShots = (this.nightStats.guardShots || 0) + 1;
      g.audio.play('crossbow', { x: guard.x, y: guard.y, cam: g.renderer.cam, vol: 0.3 });
    }
  }

  /** The outer door a tower in this room guards (null: the room has none). */
  towerDoor(room) {
    if (!room) return null;
    let best = null, bestRank = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior || e.kind !== 'door' || !e.inside) continue;
      const { x, y } = e.inside;
      if (!(x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.h)) continue;
      const rank = TOWER.doors.includes(e.id) ? TOWER.doors.indexOf(e.id) : TOWER.doors.length;
      if (rank < bestRank) { best = e; bestRank = rank; }
    }
    return best;
  }

  /**
   * Where a circle's building stands (its model, its ghost and the circle on
   * the floor): the bailey's plan (PLOT), an offset from the keep. A ballista
   * plot also names the gate it guards (its yard's outer gate). A plot the
   * plan does not know (a house layout) falls back to the floor search.
   * Fixed per circle.
   */
  buildingSpot(slotId) {
    if (!this._spots) this._spots = new Map();
    if (this._spots.has(slotId)) return this._spots.get(slotId);
    const slot = SLOT_BY_ID.get(slotId);
    const room = slot && this.game.mansion.room(slot.room);
    if (!room) return null;
    const door = slot.type === 'tower' ? this.towerDoor(room) : null;
    const plan = this.game.mansion.isFortress ? PLOT.at[slotId] : null;
    let spot;
    if (plan) {
      const keep = this.keep();
      spot = { x: Math.round(keep.x + plan[0]), y: Math.round(keep.y + plan[1]), doorId: door ? door.id : null };
    } else {
      const avoid = [];
      for (const other of SURVIVAL_SLOTS) {
        if (other === slot || other.room !== slot.room || !this._spots.has(other.id)) continue;
        avoid.push(this._spots.get(other.id));
      }
      spot = this._findSpot(room, door, avoid, null);
    }
    this._spots.set(slotId, spot);
    return spot;
  }

  _findSpot(room, door, avoid = [], at = null) {
    const m = this.game.mansion;
    const pad = 46;
    const keep = this.keep();
    let ideal;
    if (door) {
      let nx = door.inside.x - door.x, ny = door.inside.y - door.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      let sx = -ny, sy = nx;
      if ((room.x + room.w / 2 - door.x) * sx + (room.y + room.h / 2 - door.y) * sy < 0) { sx = -sx; sy = -sy; }
      ideal = { x: door.x + nx * TOWER.setback + sx * TOWER.side, y: door.y + ny * TOWER.setback + sy * TOWER.side };
    } else if (at) {
      ideal = { x: room.x + room.w * at[0], y: room.y + room.h * at[1] };
    } else {
      ideal = { x: room.x + room.w / 2 + 48, y: room.y + room.h / 2 + 24 };
    }
    ideal.x = clamp(ideal.x, room.x + pad, room.x + room.w - pad);
    ideal.y = clamp(ideal.y, room.y + pad, room.y + room.h - pad);
    const clear = (x, y) => {
      if (x < room.x + pad || x > room.x + room.w - pad || y < room.y + pad || y > room.y + room.h - pad) return false;
      if (m.solidAt(x, y)) return false;
      if (keep && dist(x, y, keep.x, keep.y) < keep.r + CIRCLE.radius + 28) return false;
      for (const q of avoid) if (q && dist(x, y, q.x, q.y) < CIRCLE.radius * 2 + 40) return false;
      for (const r of [26, 42]) {
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          if (m.solidAt(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false;
        }
      }
      // a tower must see out through its door's slit with nothing in the way
      return !door || this.boltPath(x, y, door.outside.x, door.outside.y);
    };
    const out = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), doorId: door ? door.id : null });
    if (clear(ideal.x, ideal.y)) return out(ideal);
    for (let r = 16; r <= 192; r += 16) {
      const steps = Math.max(8, Math.round(r / 8));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = ideal.x + Math.cos(a) * r, y = ideal.y + Math.sin(a) * r;
        if (clear(x, y)) return out({ x, y });
      }
    }
    return out(ideal);
  }

  /**
   * A bolt from (x0, y0) reaches (x1, y1): sight through door slits, and no
   * masonry or furniture in its way from where it leaves the string.
   */
  boltPath(x0, y0, x1, y1, start = 20) {
    const m = this.game.mansion;
    if (!m.hasLOS(x0, y0, x1, y1, { throughDoors: true })) return false;
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    for (let s = start; s < d - 6; s += 10) if (m.solidAt(x0 + dx / d * s, y0 + dy / d * s)) return false;
    return true;
  }

  towerStats(slotId) { return this.buildingStats('tower', this.buildingLevel(slotId)); }

  /** Towers mirror `buildings`: one per ballista circle built, any level. */
  _syncTowers() {
    const ids = Object.keys(this.buildings).filter((id) => this.buildings[id] === 'tower');
    if (ids.length === this.towers.length && ids.every((id, i) => this.towers[i].slotId === id)) return;
    const old = new Map(this.towers.map((t) => [t.slotId, t]));
    this.towers = ids.map((slotId, i) => old.get(slotId) || this._makeTower(slotId, i)).filter(Boolean);
  }

  _makeTower(slotId, index) {
    const spot = this.buildingSpot(slotId);
    const slot = SLOT_BY_ID.get(slotId);
    if (!spot || !slot) return null;
    const door = spot.doorId ? this.entranceById(spot.doorId) : null;
    const angle = door ? Math.atan2(door.y - spot.y, door.x - spot.x) : Math.PI / 2;
    return {
      id: 6000000 + index, key: 'tower', slotId, roomId: slot.room, doorId: spot.doorId,
      x: spot.x, y: spot.y, radius: 18,
      angle, aim: angle,                // shot bearing / the ballista's swing
      cd: 0.4 + index * 0.27, shotT: 0, target: null, shots: 0,
      type: { boltSpeed: TOWER.boltSpeed, boltDamage: 1 },
    };
  }

  towerTarget(tower, range) {
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0)) continue;
      if (dist(tower.x, tower.y, e.x, e.y) > range) continue;
      const s = this.targetScore(tower, e);
      if (s >= bestS) continue;
      if (!this.boltPath(tower.x, tower.y, e.x, e.y)) continue;
      best = e; bestS = s;
    }
    return best;
  }

  updateTowers(dt) {
    this._syncTowers();
    if (!this.towers.length) return;
    const g = this.game;
    const night = this.phase === 'night';
    for (const t of this.towers) {
      t.shotT = Math.max(0, t.shotT - dt);
      t.aim = approachAngle(t.aim, t.angle, TOWER.turn * dt);
      if (!night) { t.target = null; continue; }
      t.cd -= dt;
      if (t.cd > 0) {
        if (t.target && !t.target.dead) t.angle = Math.atan2(t.target.y - t.y, t.target.x - t.x);
        continue;
      }
      const st = this.towerStats(t.slotId);
      const target = this.towerTarget(t, st.range || 0);
      t.target = target;
      if (!target) { t.cd = 0.25; continue; }
      const lead = dist(t.x, t.y, target.x, target.y) / TOWER.boltSpeed;
      t.angle = Math.atan2(target.y + (target.vy || 0) * lead - t.y, target.x + (target.vx || 0) * lead - t.x);
      const bolt = g.spawnBolt(t, t.angle, {
        offset: 20, boltSpeed: TOWER.boltSpeed, damage: st.damage, friendly: true,
        boltPierce: TOWER.pierce, boltRange: (st.range || 0) + TOWER.reach,
      });
      // aimDist: where the bolt drops from the deck to body height (3D)
      if (bolt) { bolt.tower = true; bolt.aimDist = Math.max(40, dist(t.x, t.y, target.x, target.y) - 20); }
      t.cd = TOWER.every + rand(-0.06, 0.1);
      t.shotT = 0.26;
      t.shots++;
      this.nightStats.towerShots = (this.nightStats.towerShots || 0) + 1;
      g.audio.play('crossbow', { x: t.x, y: t.y, cam: g.renderer.cam, vol: 0.42 });
    }
  }

  useSkill() {
    if (this.phase !== 'night' || this.skillCooldown > 0) return false;
    const g = this.game;
    const p = g.player;
    this.skillCooldown = this.skillCooldownMax;
    this.skillFlash = 0.65;
    this.nightStats.flares = (this.nightStats.flares || 0) + 1;
    g.audio.play('chandelier', { vol: 0.72 });
    g.particles.burst('spark', p.x, p.y, 26, {
      color: 'rgba(255,214,140,0.95)', sizeMin: 2, sizeMax: 6, speedMin: 55, speedMax: 240,
      lifeMin: 0.18, lifeMax: 0.68, glow: true,
    });
    let hit = 0;
    for (const e of g.enemies) {
      if (e.dead || dist(p.x, p.y, e.x, e.y) > this.tuning.skillRadius) continue;
      e._lastHitBy = 'flare';
      e.hurt(this.tuning.skillDamage, g, p.x, p.y);
      e.staggerT = Math.max(e.staggerT || 0, 0.85);
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.vx = (e.vx || 0) + Math.cos(a) * 170; e.vy = (e.vy || 0) + Math.sin(a) * 170;
      hit++;
    }
    // the big blast lands: a short hold and a hard shake
    g.renderer.shake(0.42);
    if (hit) this.hitStop = Math.max(this.hitStop, 0.06);
    return true;
  }

  /**
   * Mines dig gold into the purse all night long (it never burns). Each mine
   * shows its work: every whole coin it digs pops out of its shaft as a 3D
   * coin with a "+1" over it, so a mine reads as working, not as a number
   * that changes somewhere in the HUD (playtest 2026-10-16: "bangunan yg di
   * build juga tidak berfungsi"). The banks are visual only — the purse
   * still grows by goldRate() * dt.
   */
  updateMines(dt) {
    const dig = this.goldRate() * dt;
    if (dig > 0) {
      this.gold = Math.min(RESOURCE_CAP, this.gold + dig);
      this.nightStats.mined = (this.nightStats.mined || 0) + dig;
      this.runStats.mined = (this.runStats.mined || 0) + dig;
    }
    if (this.phase !== 'night') return;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type !== 'mine') continue;
      const rate = (this.buildingStats(type, this.buildingLevel(slotId)).yield || 0) / Math.max(1, this.nightDuration);
      const bank = (this._mineBank[slotId] || 0) + rate * dt;
      if (bank >= 1) {
        const spot = this.buildingSpot(slotId);
        if (spot) {
          this.pushFx('coin', spot.x, spot.y, { slotId });
          this.pushFloater(spot.x, spot.y, '+1', '#ffd24a', { h: 150, size: 22, icon: 'gold', life: 1.15, pop: 1.3, kind: 'income' });
        }
        // and beside the purse in the HUD, wherever the captain stands: the
        // mine at work is seen from the gate he is holding
        this.pushHudPop('gold', '+1', 'mine');
        this._mineBank[slotId] = bank - 1;
      } else this._mineBank[slotId] = bank;
    }
  }

  /* ---------------- the keep and its banner ---------------- */

  /** The keep: a round stone tower in the middle of the bailey's inner ward. */
  keep() {
    if (!this._keep) {
      const m = this.game.mansion;
      const spot = m.keepSpot || m.roomCenter(ROOM.HALL);
      this._keep = spot
        ? { x: Math.round(spot.x), y: Math.round(spot.y), r: this.tuning.keepRadius }
        : { x: 0, y: 0, r: this.tuning.keepRadius };
    }
    return this._keep;
  }

  keepHpMax(level = this.keepLevel) { return this.tuning.keepHp[clamp(Math.round(level) || 1, 1, 3)] || 600; }

  /**
   * What the keep shows (tower, townsfolk, HUD), most urgent first:
   * fallen · critical (< 25%) · attacked (a claw in the last moment) ·
   * threat (bodies inside and close) · safe.
   */
  keepState() {
    if (this.keepHp <= 0) return 'fallen';
    if (this.phase === 'night') {
      if (this.uiClock - this._keepHitAt < KEEP.attackedFor) return this.keepHp < this.keepHpMax() * 0.25 ? 'critical' : 'attacked';
      if (this.keepHp < this.keepHpMax() * 0.25) return 'critical';
      const keep = this.keep();
      for (const e of this.game.enemies) {
        if (!e._survivalType || e.dead || e.removeMe || !e._inHouse) continue;
        if (dist(e.x, e.y, keep.x, keep.y) < KEEP.alarmRange) return 'threat';
      }
      return 'safe';
    }
    return this.keepHp < this.keepHpMax() * 0.25 ? 'critical' : 'safe';
  }

  /** A body at the keep's wall claws it. At 0 HP the run is lost. */
  hitKeep(enemy) {
    if (this.phase !== 'night' || this.keepHp <= 0) return;
    const amount = KEEP.damage[enemy._survivalType] || KEEP.damage.swarm;
    const before = this.keepHp;
    this.keepHp = Math.max(0, this.keepHp - amount);
    const lost = before - this.keepHp;
    this.nightStats.keepDamage = (this.nightStats.keepDamage || 0) + lost;
    // the lowest the keep fell (R2: two stars need it never below half)
    const share = this.keepHp / Math.max(1, this.keepHpMax());
    this.nightStats.keepMin = Math.min(this.nightStats.keepMin == null ? 1 : this.nightStats.keepMin, share);
    this.runStats.keepMin = Math.min(this.runStats.keepMin == null ? 1 : this.runStats.keepMin, share);
    this._keepHitAt = this.uiClock;
    const keep = this.keep();
    const a = Math.atan2(enemy.y - keep.y, enemy.x - keep.x);
    const wx = keep.x + Math.cos(a) * keep.r, wy = keep.y + Math.sin(a) * keep.r;
    this.pushFloater(wx, wy, `-${Math.round(lost)}`, '#ff6b5e', { h: 120, size: 20, icon: 'keep' });
    if (this.uiClock - this._keepWarnAt > 7) {
      this._keepWarnAt = this.uiClock;
      this.pushEvent('keep', 'keep', 'KEEP UNDER ATTACK!');
    }
    const g = this.game;
    g.audio.play('impact', { vol: 0.34 });
    g.renderer.shake(0.08);
    g.particles.burst('spark', wx, wy, 8, {
      color: 'rgba(196,188,176,0.95)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 150, lifeMin: 0.25, lifeMax: 0.6,
    });
    if (this.keepHp <= 0) this.fail('THE KEEP FELL');
  }

  /** From Lv2 a ballista on the keep's roof shoots what comes for the keep. */
  updateKeepBallista(dt) {
    const b = this.keepBallista;
    b.shotT = Math.max(0, b.shotT - dt);
    b.aim = approachAngle(b.aim, b.angle, TOWER.turn * dt);
    const spec = KEEP.ballista[this.keepLevel];
    if (!spec || this.phase !== 'night' || this.keepHp <= 0) { b.target = null; return; }
    b.cd -= dt;
    if (b.cd > 0) return;
    const keep = this.keep();
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0) || !e._survivalType) continue;
      const d = dist(keep.x, keep.y, e.x, e.y);
      if (d > spec.range) continue;
      const s = d - (e.attackingKeep ? 200 : 0);
      if (s < bestS) { best = e; bestS = s; }
    }
    b.target = best;
    if (!best) { b.cd = 0.25; return; }
    b.angle = Math.atan2(best.y - keep.y, best.x - keep.x);
    // the bolt drops from the roof: it ignores the keep's own wall
    const shooter = { x: keep.x + Math.cos(b.angle) * (keep.r + 14), y: keep.y + Math.sin(b.angle) * (keep.r + 14), type: { boltSpeed: TOWER.boltSpeed, boltDamage: 1 }, key: 'keep' };
    const bolt = this.game.spawnBolt(shooter, b.angle, {
      offset: 0, boltSpeed: TOWER.boltSpeed, damage: spec.damage, friendly: true, boltRange: spec.range + 60,
    });
    if (bolt) { bolt.tower = true; bolt.keepBolt = true; bolt.aimDist = Math.max(30, dist(shooter.x, shooter.y, best.x, best.y)); }
    b.cd = spec.every;
    b.shotT = 0.26;
    b.shots++;
    this.game.audio.play('crossbow', { x: keep.x, y: keep.y, cam: this.game.renderer.cam, vol: 0.36 });
  }

  /** Rooms under the keep's banner (by keep level). */
  territoryRooms(level = this.keepLevel) {
    const ids = TERRITORY[level] || TERRITORY[1];
    return this.game.mansion.roomList.filter((room) => ids.includes(room.id));
  }

  _syncTerritory() {
    this._territoryLevel = this.keepLevel;
    this._territory = new Set(TERRITORY[this.keepLevel] || TERRITORY[1]);
  }

  inTerritory(x, y) {
    if (this._territoryLevel !== this.keepLevel) this._syncTerritory();
    return this._territory.has(this.game.mansion.findRoom(x, y));
  }

  /**
   * Where the Hunter stands at the start of a run and every dawn: before the
   * keep's door, between the ward's barracks plot and the armory (PLOT.home).
   */
  hunterHome() {
    const keep = this.keep();
    if (this.game.mansion.isFortress) return { x: keep.x + PLOT.home[0], y: keep.y + PLOT.home[1] };
    return { x: keep.x + keep.r + 86, y: keep.y + 34 };
  }

  /** The armory rack beside the keep: the Hunter's own upgrades. */
  armorySpot() {
    if (!this._armory && this.game.mansion.isFortress) {
      const keep = this.keep();
      this._armory = { x: Math.round(keep.x + PLOT.armory[0]), y: Math.round(keep.y + PLOT.armory[1]) };
    }
    if (!this._armory) {
      const keep = this.keep();
      const m = this.game.mansion;
      let best = { x: keep.x - keep.r - 120, y: keep.y + 20 };
      for (let r = 0; r <= 120; r += 12) {
        let found = null;
        for (let k = 0; k < 12 && !found; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = keep.x - keep.r - 120 + Math.cos(a) * r, y = keep.y + 20 + Math.sin(a) * r;
          const free = !m.solidAt(x, y) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !m.solidAt(x + Math.cos(i * Math.PI / 4) * 40, y + Math.sin(i * Math.PI / 4) * 40));
          if (free && dist(x, y, keep.x, keep.y) > keep.r + CIRCLE.radius + 30) found = { x, y };
        }
        if (found) { best = found; break; }
      }
      this._armory = { x: Math.round(best.x), y: Math.round(best.y) };
    }
    return this._armory;
  }

  /** Inside the front door: where the barricade circle sits. */
  gateSpot() {
    const gate = this.mainGate();
    if (!gate) return null;
    const out = outwardOf(gate);
    const base = gate.inside || gate;
    return { x: Math.round(base.x - out.x * 24), y: Math.round(base.y - out.y * 24) };
  }

  /** Circles the banner reaches (built or not), and the ones still locked. */
  slotsInTerritory() {
    const ids = TERRITORY[this.keepLevel] || TERRITORY[1];
    return SURVIVAL_SLOTS.filter((slot) => ids.includes(slot.room));
  }

  lockedSlots() {
    const ids = TERRITORY[this.keepLevel] || TERRITORY[1];
    return SURVIVAL_SLOTS.filter((slot) => !ids.includes(slot.room));
  }

  /** The keep level whose banner first reaches this circle (1-3). */
  slotUnlockLevel(slotId) {
    const slot = SLOT_BY_ID.get(slotId);
    if (!slot) return 3;
    for (let level = 1; level <= 3; level++) if (TERRITORY[level].includes(slot.room)) return level;
    return 3;
  }

  /** Empty circles the Hunter can build on now. */
  buildableSlots() {
    return this.slotsInTerritory().filter((slot) => !this.buildings[slot.id]);
  }

  /**
   * Every place the Hunter can act on by day, with where it is: the build
   * circles (built or not, locked or not), the keep, the armory and the
   * barricade. The UI and the 3D world both read this list.
   */
  dayPoints() {
    const out = [];
    const keep = this.keep();
    out.push({ id: 'keep', kind: 'keep', x: keep.x, y: keep.y, reach: keep.r + CIRCLE.keepReach });
    const armory = this.armorySpot();
    out.push({ id: 'armory', kind: 'armory', x: armory.x, y: armory.y, reach: CIRCLE.reach });
    const gate = this.gateSpot();
    if (gate) out.push({ id: 'gate', kind: 'gate', x: gate.x, y: gate.y, reach: CIRCLE.reach });
    const ids = TERRITORY[this.keepLevel] || TERRITORY[1];
    for (const slot of SURVIVAL_SLOTS) {
      const spot = this.buildingSpot(slot.id);
      if (!spot) continue;
      out.push({
        id: slot.id, kind: 'slot', slot, type: slot.type, x: spot.x, y: spot.y, reach: CIRCLE.reach,
        built: this.buildings[slot.id] || null, level: this.buildingLevel(slot.id), locked: !ids.includes(slot.room),
      });
    }
    return out;
  }

  /** The day point the Hunter stands at (nearest within reach), or null. */
  dayContext() {
    if (this.phase !== 'day') return null;
    const p = this.game.player;
    let best = null, bestD = Infinity;
    for (const point of this.dayPoints()) {
      const d = dist(p.x, p.y, point.x, point.y);
      if (d <= point.reach && d < bestD) { best = point; bestD = d; }
    }
    return best;
  }

  /* ---------------- building ---------------- */

  startBuild(type, slotId = null) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    if (type === 'keep') return this.startKeepUpgrade();
    if (type === 'repair') return this.startKeepRepair();
    if (type === 'gate') return this.startGateBuild();
    if (type === 'hunter') return this.startHunterUpgrade();
    if (type === 'upgrade') return this.startUpgrade(slotId);
    const spec = SURVIVAL_BUILDINGS[type];
    const slot = SLOT_BY_ID.get(slotId);
    if (!spec || !slot || slot.type !== type) return false;
    if (!this.buildableSlots().some((item) => item.id === slotId)) return false;
    if (!this.canAfford(spec)) return false;
    this.gold -= spec.gold; this.wood -= spec.wood;
    this.selectedRoom = slotId;
    this.builderJob = { kind: 'building', type, slotId, roomId: slot.room, remaining: spec.seconds, duration: spec.seconds };
    g.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  startGateBuild() {
    if (this.gateBuilt || this.builderJob || this.phase !== 'day') return false;
    const cost = this.tuning.gateCost;
    if (!this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'gate', type: 'gate', remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  keepUpgradeCost() { return this.keepLevel >= 3 ? null : this.tuning.keepUpgrade[this.keepLevel + 1] || null; }

  /** Raise the keep a level: more HP, a wider banner (new rooms), a roof ballista. */
  startKeepUpgrade() {
    if (this.keepLevel >= 3 || this.builderJob || this.phase !== 'day') return false;
    const target = this.keepLevel + 1;
    const cost = this.tuning.keepUpgrade[target];
    if (!cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'keep', type: 'keep', targetLevel: target, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  keepRepairCost() {
    const r = this.tuning.keepRepair;
    return this.keepHp >= this.keepHpMax() - 0.5 ? null : { gold: 0, wood: r.wood, seconds: r.seconds };
  }

  /** Patch the keep by day: wood for stone (the free dawn patch is not enough). */
  startKeepRepair() {
    if (this.builderJob || this.phase !== 'day') return false;
    const cost = this.keepRepairCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.wood -= cost.wood;
    this.builderJob = { kind: 'repair', type: 'repair', remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  /* ---------------- building levels + the Hunter's track ---------------- */

  buildingLevel(slotId) {
    if (!this.buildings[slotId]) return 0;
    return clamp(Math.round(Number(this.buildingLevels[slotId]) || 1), 1, BUILDING_MAX_LEVEL);
  }

  /** Stats of one building type at one level ({} for unknown types). */
  buildingStats(type, level = 1) {
    const table = SURVIVAL_BUILDING_LEVELS[type];
    return (table && table[clamp(Math.round(level) || 1, 1, BUILDING_MAX_LEVEL)]) || {};
  }

  /** Cost of the next level of the building on a circle (null at max / empty). */
  upgradeCost(slotId) {
    const type = this.buildings[slotId];
    const level = this.buildingLevel(slotId);
    if (!type || level >= BUILDING_MAX_LEVEL) return null;
    const next = this.buildingStats(type, level + 1);
    return next.wood != null ? { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 6 } : null;
  }

  startUpgrade(slotId) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const type = this.buildings[slotId];
    const cost = this.upgradeCost(slotId);
    if (!type || !cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.selectedRoom = slotId;
    const targetLevel = this.buildingLevel(slotId) + 1;
    const slot = SLOT_BY_ID.get(slotId);
    this.builderJob = { kind: 'upgrade', type, slotId, roomId: slot ? slot.room : null, targetLevel, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  /** Gold every mine digs into the purse over one night. */
  goldPerNight() {
    let total = 0;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type === 'mine') total += this.buildingStats(type, this.buildingLevel(slotId)).yield || 0;
    }
    return total;
  }

  goldRate() { return this.goldPerNight() / Math.max(1, this.nightDuration); }

  /** Sawmill planks: +% max HP on every outer door (summed, capped). */
  doorHpBonus() {
    let bonus = 0;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type === 'sawmill') bonus += this.buildingStats(type, this.buildingLevel(slotId)).doorBonus || 0;
    }
    return Math.min(DOOR_BONUS_CAP, Math.round(bonus * 100) / 100);
  }

  hunterStats(level = this.hunterLevel) {
    return SURVIVAL_HUNTER[clamp(Math.round(level) || 1, 1, HUNTER_MAX_LEVEL)];
  }

  hunterDamage() { return this.hunterStats().damage; }

  hunterUpgradeCost() {
    if (this.hunterLevel >= HUNTER_MAX_LEVEL) return null;
    const next = this.hunterStats(this.hunterLevel + 1);
    return { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
  }

  startHunterUpgrade() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const cost = this.hunterUpgradeCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'hunter', type: 'hunter', targetLevel: this.hunterLevel + 1, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  /** Survival owns the Hunter's health bar (legacy meta upgrades stay legacy). */
  applyHunterStats(heal = false) {
    const p = this.game.player;
    if (!p) return;
    const hp = this.hunterStats().hp;
    p.bloodMax = hp;
    p.blood = heal ? hp : clamp(Number(p.blood) || hp, 1, hp);
  }

  /** Where the builder works (and the celebration pops). */
  jobSpot(job = this.builderJob) {
    if (!job) return null;
    if (job.kind === 'keep' || job.kind === 'repair') { const keep = this.keep(); return { x: keep.x, y: keep.y + keep.r }; }
    if (job.kind === 'gate') return this.gateSpot();
    if (job.kind === 'hunter') return this.armorySpot();
    return job.slotId ? this.buildingSpot(job.slotId) : null;
  }

  finishBuilderJob() {
    const job = this.builderJob;
    if (!job) return;
    let text = 'BUILT!';
    let icon = SURVIVAL_BUILDINGS[job.type] ? job.type : 'hammer';
    const at = this.jobSpot(job);
    if (job.kind === 'keep') {
      this.keepLevel = clamp(job.targetLevel, 1, 3);
      // the new storey comes with its stone: the new HP share is added
      const before = this.tuning.keepHp[this.keepLevel - 1] || this.keepHpMax();
      this.keepHp = Math.min(this.keepHpMax(), this.keepHp + (this.keepHpMax() - before));
      this._syncTerritory();
      icon = 'keep'; text = `KEEP Lv${this.keepLevel}`;
    } else if (job.kind === 'repair') {
      const heal = Math.min(this.tuning.keepRepair.hp, this.keepHpMax() - this.keepHp);
      this.keepHp = Math.min(this.keepHpMax(), this.keepHp + heal);
      icon = 'keep'; text = `+${Math.round(heal)}`;
    } else if (job.kind === 'gate') {
      this.gateBuilt = true;
      this.applyBuildingEffects(true);
      icon = 'gate';
    } else if (job.kind === 'hunter') {
      this.hunterLevel = clamp(job.targetLevel, 1, HUNTER_MAX_LEVEL);
      this.applyHunterStats(true);
      icon = 'hunter'; text = `HUNTER Lv${this.hunterLevel}`;
    } else if (job.kind === 'building' || job.kind === 'upgrade') {
      const before = job.kind === 'upgrade' ? this.buildingLevel(job.slotId) : 0;
      const level = job.kind === 'upgrade' ? clamp(job.targetLevel, 1, BUILDING_MAX_LEVEL) : 1;
      this.buildings[job.slotId] = job.type;
      this.buildingLevels[job.slotId] = level;
      if (job.type === 'barracks') {
        // a barracks houses its soldiers at once: tonight's door guards. They
        // step out of its door and march to their post by the keep, so the
        // building is seen to work (a "+1" soldier pops over it).
        const moved = (this.buildingStats('barracks', level).houses || 0) - (before ? this.buildingStats('barracks', before).houses || 0 : 0);
        const was = this.survivors;
        this.survivors = Math.min(this.tuning.maxSurvivors, this.survivors + Math.max(0, moved));
        const spot = this.buildingSpot(job.slotId);
        this._syncGuardRoster(false, spot);
        const added = this.survivors - was;
        if (added > 0 && spot) {
          this.runStats.recruited = (this.runStats.recruited || 0) + added;
          this.pushFx('rally', spot.x, spot.y, { n: added });
          this.pushFloater(spot.x, spot.y, `+${added}`, '#7fd0ff', { h: 150, size: 24, icon: 'guard', life: 1.6, pop: 1.4, kind: 'income' });
        }
      }
      if (job.type === 'sawmill') this.applyBuildingEffects(false);
      if (job.kind === 'upgrade') text = `Lv${level}!`;
    }
    this.builderJob = null;
    this.lastBuilt = { kind: job.kind, type: job.type, slotId: job.slotId || null, x: at ? at.x : 0, y: at ? at.y : 0, t: this.uiClock };
    if (job.kind === 'gate') this.game.mansion.buildNav();
    this._syncTowers();
    this.game.survivalBakeDirty = true;
    this.game.audio.play('uiConfirm', { vol: 0.62 });
    if (at) {
      this.game.particles.burst('spark', at.x, at.y, 18, {
        color: 'rgba(255,226,140,0.95)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 170, lifeMin: 0.3, lifeMax: 0.8, glow: true,
      });
    }
    this.pushEvent('build', icon, text, { life: 1.6 });
    this._persist(true);
  }

  /**
   * Door max HP from what stands in the house: sawmill planks on every outer
   * door, the barricade on the front door. By day the doors are whole,
   * so a new bonus is filled at once; a mid-night reload never mends a door.
   */
  applyBuildingEffects(repairGate = false) {
    const gate = this.mainGate();
    const bonus = this.doorHpBonus();
    const night = this.phase === 'night';
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior || e.kind !== 'door') continue;
      const base = e.baseHpMax || e.hpMax || 100;
      const extra = e === gate && this.gateBuilt ? this.tuning.gateHpBonus : 0;
      e.hpMax = Math.round(base * (1 + bonus)) + extra;
      if (!Number.isFinite(e.hp)) e.hp = e.hpMax;
      if (e === gate && repairGate) { e.hp = e.hpMax; e.broken = false; e.open = false; }
      else if (!night && !e.broken) e.hp = e.hpMax;
      else e.hp = Math.min(e.hp, e.hpMax);
    }
    if (gate) this.gateHp = Math.max(0, gate.hp);
  }

  completeNight() {
    if (this.phase !== 'night') return;
    const g = this.game;
    g._survivalHint = null;   // a night's hint chip never runs on into the day
    this.recenterCamera(true);
    const dayIndex = clamp(this.day - 1, 0, 2);
    let gold = this.tuning.nightRewards.gold[dayIndex];
    let wood = this.tuning.nightRewards.wood[dayIndex];
    // guards lost during the night are already gone from the roster; anyone
    // still down gets up at dawn (the snap below heals the garrison)
    const lost = this.nightStats.lost || 0;
    const survivorsBefore = this.survivors;
    // Dawn pays the sawmills; the mines already dug their gold in during
    // the night, and barracks house their soldiers as soon as they stand.
    let sawn = 0;
    const sawmills = [];
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type !== 'sawmill') continue;
      const planks = this.buildingStats(type, this.buildingLevel(slotId)).dawnWood || 0;
      sawn += planks;
      sawmills.push({ slotId, wood: planks });
    }
    wood += sawn;
    this.runStats.sawn = (this.runStats.sawn || 0) + sawn;
    this.runStats.nights = Math.min(3, (this.runStats.nights || 0) + 1);
    this._sawmillPayout = sawmills;
    const mined = Math.round(this.nightStats.mined || 0);
    // kills pay a little (guards shoot too, so this stays a trickle)
    const killGold = Math.floor(this.nightStats.kills / 6);
    const killWood = Math.floor(this.nightStats.kills / 4);
    gold += killGold; wood += killWood;
    this.gold = clamp(this.gold + gold, 0, RESOURCE_CAP);
    this.wood = clamp(this.wood + wood, 0, RESOURCE_CAP);
    this.nightsCompleted = Math.min(3, this.nightsCompleted + 1);
    // the keep as dawn found it (the end panel's "keep left", before the patch)
    this._keepAtDawn = this.keepHp / Math.max(1, this.keepHpMax());
    // the townsfolk patch part of the keep for free; the rest is wood by day
    const missing = this.keepHpMax() - this.keepHp;
    const patched = Math.round(missing * this.tuning.keepDawnHeal);
    this.keepHp = Math.min(this.keepHpMax(), this.keepHp + patched);
    this.repairDoors();
    this.lastRewards = {
      gold, wood, kills: this.nightStats.kills, walls: this.nightStats.damageToWalls,
      survivors: this.survivors - survivorsBefore, keepDamage: Math.round(this.nightStats.keepDamage || 0),
      keepPatched: patched, mined, lost, rescued: this.nightStats.rescued || 0,
      reinforcements: Math.max(0, 3 - this.nightsCompleted),
      sawn, killsBy: { ...freshKillsBy(), ...(this.nightStats.by || {}) },
      towerKills: (this.nightStats.by && this.nightStats.by.tower) || 0,
    };
    this._resetNightFx();
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.player.slashAge = null;   // the night's last shot does not flash on into the dawn
    this.applyHunterStats(true);
    this.elapsed = 0;
    this.walkPath = null;
    // dawn: the captain is back at the keep (the day starts on the base)
    const home = this.hunterHome();
    g.player.x = home.x; g.player.y = home.y; g.player.vx = 0; g.player.vy = 0;
    g.renderer.snapCamera(home.x, home.y);
    if (this.nightsCompleted >= 3) {
      this.day = 3;
      this.phase = 'complete';
      // K1's promise kept: the main gate swings open and the relief column
      // marches in to the keep (a cinematic when the run asked for them;
      // otherwise the column already stands in its two lines)
      const gate = this.mainGate();
      if (gate && !gate.broken) gate.open = true;
      this.reinforcements = this._reliefColumn(!this.cinematics);
      if (this.cinematics) this._startArrival();
      this._finishRun(true);
      g.uiPanel = this.panelFor();
    } else {
      this.day = Math.min(3, this.day + 1);
      this.phase = 'day';
      g.uiPanel = 'survival-day';
    }
    g.screen = 'playing';
    g.phase = DAY_PHASE;
    g.time = 0; g.timeLeft = 0;
    g.input.gameplay = this.phase === 'day';
    this.applyBuildingEffects(false);
    this._syncBakePhase();
    this._syncGuardRoster(true);
    this._syncTowers();
    this._persist(true);
  }

  fail(reason) {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.failureReason = reason || 'The Hunter fell.';
    this._finishRun(false);
    this.game.screen = 'playing';
    this.game.uiPanel = 'survival-failed';
    this.game.input.gameplay = false;
    this._persist(true);
  }

  restart() {
    const g = this.game;
    const duration = this.nightDuration;
    Object.assign(this, {
      phase: 'night', day: 1, elapsed: 0, gold: this.tuning.startGold, wood: this.tuning.startWood,
      survivors: this.tuning.startSurvivors, keepLevel: 1, keepHp: this.tuning.keepHp[1],
      buildings: {}, buildingLevels: {}, hunterLevel: 1, gateBuilt: false,
      gateHp: 0, builderJob: null, selectedRoom: null, nightsCompleted: 0, waveIndex: 0,
      breakerIndex: 0, individualIndex: 0, siegeTimers: Object.create(null),
      nightStats: freshNightStats(), runStats: freshRunStats(), lastRewards: null, skillCooldown: 0,
      rewardAck: 0, dayFocus: null, nightKeepStart: this.tuning.keepHp[1], walkPath: null, lastBuilt: null,
      cine: null, reinforcements: null, runResult: null,
    });
    this._syncTerritory();
    this._resetNightFx();
    this._fields.clear();
    for (const e of g.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax; e.broken = false; e.open = false; e.barricade = 0;
      e.flash = 0; e.attackers = 0;
    }
    g.enemies.length = 0; g.bolts.length = 0;
    const home = this.hunterHome();
    g.player.x = home.x; g.player.y = home.y;
    this.applyHunterStats(true);
    g.player.weapon = 'shot'; g.player.state = 'idle';
    this.nightDuration = duration;
    this.phase = 'night';
    g.mansion.buildNav();
    this.game.survivalBakeDirty = true;
    this.guards.length = 0;
    this._syncGuardRoster(true);
    this._syncTowers();
    this.enter();
    this._nightIntro();
  }

  useBuilding(slotId) { return this.buildings[slotId] || null; }

  /**
   * Close the run once, at the third dawn or the fall (R1-R4, R19): stars,
   * the MVP, how close dawn was and the tip, and the records across runs.
   * "NEW BEST" needs a run to beat, so the very first result is just that.
   */
  _finishRun(won) {
    const rs = this.runStats;
    const nights = won ? 3 : clamp(this.nightsCompleted, 0, 3);
    const stars = survivalStars(won, rs);
    const prev = { ...freshRecords(), ...(this.records || {}) };
    const kills = rs.kills || 0;
    this.records = {
      runs: prev.runs + 1,
      wins: prev.wins + (won ? 1 : 0),
      bestStars: Math.max(prev.bestStars, stars),
      bestNights: Math.max(prev.bestNights, nights),
      bestKills: Math.max(prev.bestKills, kills),
      totalKills: prev.totalKills + kills,
    };
    this.runResult = {
      won, stars, nights, kills,
      newBest: prev.runs > 0 && (stars > prev.bestStars || nights > prev.bestNights),
      night: this.day,
      toDawn: won ? 0 : Math.max(0, Math.ceil(this.nightDuration - this.elapsed)),
      progress: won ? 1 : clamp(this.elapsed / Math.max(1, this.nightDuration), 0, 1),
      keepLeft: won ? Math.round(100 * (this._keepAtDawn == null ? this.keepHp / Math.max(1, this.keepHpMax()) : this._keepAtDawn)) : 0,
      keepMin: Math.round(100 * (rs.keepMin == null ? 1 : rs.keepMin)),
      built: Object.keys(this.buildings).length,
      time: Math.round(rs.time || 0),
      mvp: survivalMvp(rs),
      tip: won ? null : this._lossTip(),
    };
    return this.runResult;
  }

  /** The end panel's numbers: the closed run, or (old saves) a fresh reading. */
  endSummary() {
    if (this.runResult) return this.runResult;
    if (this.phase !== 'complete' && this.phase !== 'failed') return null;
    const records = this.records;
    const result = this._finishRun(this.phase === 'complete');
    this.records = records;          // reading an old save is not a new run
    result.newBest = false;
    return result;
  }

  /** The ballista circle that covers a gate (its spot's door), if any. */
  _towerSlotFor(gateId) {
    for (const slot of SURVIVAL_SLOTS) {
      if (slot.type !== 'tower') continue;
      const spot = this.buildingSpot(slot.id);
      if (spot && spot.doorId === gateId) return slot;
    }
    return null;
  }

  /**
   * R4: one tip read off what really happened (8 words at most). The first
   * night has no day before it, so its tips are about defending; after that
   * the first missing piece in the build is named (nothing built, the gate
   * that gave way first without a ballista, a keep a level behind, lost
   * guards, no barracks).
   */
  _lossTip() {
    const ns = this.nightStats || {};
    if (!/KEEP/i.test(String(this.failureReason || ''))) return { icon: 'heart', text: 'FALL BACK TO THE KEEP WHEN HURT' };
    if (this.day <= 1) {
      if ((this._movedSinceStart || 0) < 400) return { icon: 'gate', text: 'WALK TO THE GATE UNDER ATTACK' };
      if (!(ns.flares > 0)) return { icon: 'flare', text: 'TAP FLARE ON BIG GROUPS' };
      return { icon: 'guard', text: 'FIGHT BESIDE YOUR GUARDS AT THE GATE' };
    }
    const built = Object.values(this.buildings);
    if (!built.length && this.keepLevel <= 1) return { icon: 'hammer', text: 'BUILD BY DAY: WALK INTO A CIRCLE' };
    for (const gateId of Array.isArray(ns.breached) ? ns.breached : []) {
      const slot = this._towerSlotFor(gateId);
      if (!slot || this.buildings[slot.id]) continue;
      const name = GATE_NAMES[gateId] || 'BROKEN';
      if (this.slotUnlockLevel(slot.id) > this.keepLevel) return { icon: 'keep', text: `RAISE THE KEEP TO GUARD THE ${name} GATE` };
      return { icon: 'tower', text: `BUILD A BALLISTA AT THE ${name} GATE` };
    }
    if (this.keepLevel < Math.min(3, this.day)) return { icon: 'keep', text: 'UPGRADE THE KEEP BY DAY' };
    if ((ns.lost || 0) > 0) return { icon: 'guard', text: 'HELP FALLEN GUARDS UP' };
    if (!built.includes('barracks')) return { icon: 'barracks', text: 'BUILD BARRACKS FOR MORE GUARDS' };
    return { icon: 'up', text: 'UPGRADE YOUR BALLISTAS BY DAY' };
  }

  buildingCost(type) {
    if (type === 'keep') return this.keepUpgradeCost();
    if (type === 'repair') return this.keepRepairCost();
    if (type === 'gate') return this.tuning.gateCost;
    if (type === 'hunter') return this.hunterUpgradeCost();
    return SURVIVAL_BUILDINGS[type] || null;
  }

  buildingName(type) {
    if (type === 'keep') return `KEEP LV${this.keepLevel}`;
    if (type === 'gate') return 'BARRICADE';
    if (type === 'hunter') return `HUNTER LV${this.hunterLevel}`;
    return SURVIVAL_BUILDINGS[type] ? SURVIVAL_BUILDINGS[type].label : 'EMPTY';
  }

  onEnemyKilled(enemy) {
    if (enemy._survivalRewarded) return;
    enemy._survivalRewarded = true;
    this.nightStats.kills++;
    this.game.stats.kills = (this.game.stats.kills || 0) + 1;
    const g = this.game;
    // who got it: per night (the dawn panel) and per run (the end panel)
    const src = killSource(g, enemy._lastHitBy);
    if (!this.nightStats.by) this.nightStats.by = freshKillsBy();
    this.nightStats.by[src] = (this.nightStats.by[src] || 0) + 1;
    this.runStats.kills++;
    this.runStats.by[src] = (this.runStats.by[src] || 0) + 1;
    if (src === 'tower' && enemy._lastHitBy) {
      const tower = enemy._lastHitBy;
      tower.kills = (tower.kills || 0) + 1;
      tower.nightKills = (tower.nightKills || 0) + 1;
      const slotId = tower.slotId;
      if (slotId) {
        if (!this.runStats.towers) this.runStats.towers = {};
        this.runStats.towers[slotId] = (this.runStats.towers[slotId] || 0) + 1;
      }
      // the building that got it says so, over its own deck: a ballista
      // reads as working (2026-10-17: "bangunan ... tidak berfungsi")
      if (Number.isFinite(tower.x)) this.pushFloater(tower.x, tower.y, '+1', '#ffb36b', { h: 236, size: 22, icon: 'skull', life: 1.2, pop: 1.35, kind: 'income' });
    } else if (src === 'keep') {
      const keep = this.keep();
      this.keepBallistaKills = (this.keepBallistaKills || 0) + 1;
      this.pushFloater(keep.x, keep.y, '+1', '#ffb36b', { h: 330, size: 22, icon: 'skull', life: 1.2, pop: 1.35, kind: 'income' });
    }
    const big = enemy._survivalType === 'breaker' || enemy._survivalType === 'individual';
    g.audio.play('hitFlesh', { vol: big ? 0.6 : 0.42, weight: big ? 1 : 0.8 });
    // the kill pops: a burst and a shock ring on the floor (world3d), then
    // dust, grit and a wisp of the thing rising off the body
    this.pushFx('kill', enemy.x, enemy.y, { h: (big ? 70 : 46) * SURVIVAL_ACTOR_SCALE, color: HIT_COLOR[src] || '#ffffff', big });
    g.particles.burst('spark', enemy.x, enemy.y, big ? 22 : 11, {
      color: big ? 'rgba(255,214,120,0.95)' : 'rgba(226,236,200,0.92)', sizeMin: 2.4, sizeMax: big ? 7 : 5,
      speedMin: 60, speedMax: big ? 300 : 210, lifeMin: 0.22, lifeMax: 0.6, glow: true,
    });
    g.particles.burst('glow', enemy.x, enemy.y, big ? 6 : 3, {
      color: 'rgba(150,90,210,0.7)', sizeMin: 5, sizeMax: big ? 12 : 8, speedMin: 10, speedMax: 50, lifeMin: 0.45, lifeMax: 0.9,
    });
    // ichor chunks thrown off the body, and a stain left on the ground: a
    // gate you held reads as a battlefield the next time you look at it
    g.particles.burst('blood', enemy.x, enemy.y, big ? 16 : 9, {
      color: 'rgba(92,40,128,0.95)', sizeMin: 2.4, sizeMax: big ? 6.5 : 4.8, speedMin: 70, speedMax: big ? 280 : 210, lifeMin: 0.25, lifeMax: 0.6,
    });
    if (g.decals && g.decals.splat) g.decals.splat(enemy.x, enemy.y + 4, big ? 26 : 17, 'rgba(46,18,64,0.42)', big ? 7 : 5);
    // a streak of kills shakes a little; a big one holds the frame
    this._streak = (this.uiClock - (this._lastKillAt || -9) < 0.6) ? (this._streak || 0) + 1 : 1;
    this._lastKillAt = this.uiClock;
    if (big) { this.hitStop = Math.max(this.hitStop, 0.05); g.renderer.shake(0.16); }
    else if (src === 'captain') {
      // the captain's own kill lands with weight: a nudge of the camera
      // (the hit-stop stays for the big ones — on every swarm kill it made
      // a busy gate stutter and stretched the night)
      g.renderer.shake(this._streak >= 3 ? 0.08 : 0.05);
    } else if (this._streak >= 3) g.renderer.shake(0.05);
  }

  onPlayerHurt(amount) {
    this.nightStats.hits++;
    this.game.audio.play('playerHurt', { vol: 0.72 });
    this.game.renderer.shake(clamp(0.18 + amount * 0.009, 0.18, 0.55));
    this.game.particles.burst('blood', this.game.player.x, this.game.player.y, 7, {
      color: '#a52635', speedMin: 20, speedMax: 92, lifeMin: 0.2, lifeMax: 0.55, sizeMin: 1.5, sizeMax: 3,
    });
  }

  /**
   * The camera follows the Hunter day and night. By day it pulls back a
   * little and leans toward the circle he stands in, so its ghost and the
   * contextual button never cover each other.
   */
  followPlayer(dt) {
    const g = this.game;
    const p = g.player;
    const r = g.renderer;
    const night = this.phase !== 'day';
    this._steerCamera(dt);
    if (r.setZoomMul) r.setZoomMul(this.frameMul(night) * this.userZoom(), dt);
    let lookX = clamp(p.vx * 0.18, -56, 56);
    // a phone held sideways is short and its top band is HUD: frame a little
    // north of the Hunter so what stands above him is not under the HUD
    let lookY = clamp(p.vy * 0.18, -56, 56) - ((r.h || 720) < 560 ? (night ? 90 : 70) : 0);
    // lean toward what the Hunter is shooting so a crowd at a door is on screen
    const t = this.currentTarget;
    if (night && t && !t.dead) {
      lookX += clamp((t.x - p.x) * 0.3, -130, 130);
      lookY += clamp((t.y - p.y) * 0.3, -130, 130);
    }
    if (!night) {
      const here = this.dayContext();
      if (here) { lookX += clamp((here.x - p.x) * 0.5, -80, 80); lookY += clamp((here.y - p.y) * 0.5, -80, 80); }
    }
    // the player's own drag rides on top of the follow
    const pan = this.camPan;
    if (pan.x || pan.y) {
      lookX = lookX * this._panLook() + pan.x;
      lookY = lookY * this._panLook() + pan.y;
    }
    r.followCamera(p.x, p.y, dt, lookX, lookY, g.mansion.camBounds);
  }

  /** The look-ahead fades while the view is dragged away (it would fight the drag). */
  _panLook() {
    const d = Math.hypot(this.camPan.x, this.camPan.y);
    return clamp(1 - d / 160, 0, 1);
  }

  /** The player's zoom on top of the framing (SURVIVAL_CAMERA.zoom), persisted. */
  userZoom() {
    if (this._userZoom == null) {
      const s = this.game.save && this.game.save.survival;
      const z = s && Number(s.camZoom);
      this._userZoom = Number.isFinite(z) && z > 0 ? clamp(z, SURVIVAL_CAMERA.zoom[0], SURVIVAL_CAMERA.zoom[1]) : 1;
    }
    return this._userZoom;
  }

  /** Drop the drag: the view goes back onto the captain (snap: at once). */
  recenterCamera(snap = false) {
    if (snap) { this.camPan.x = 0; this.camPan.y = 0; this._recenter = false; return; }
    this._recenter = Math.hypot(this.camPan.x, this.camPan.y) > 1;
  }

  /** How far the view has been dragged off the captain (world px). */
  cameraOffset() { return Math.hypot(this.camPan.x, this.camPan.y); }

  /**
   * The player's hand on the camera (playtest 2026-10-17: "camera terlalu
   * dekat ... dan bisa di geser"). A drag on the free half moves the ground
   * with the finger, 1:1 (the camera jumps with it, so it never lags); a
   * pinch or the wheel zooms within SURVIVAL_CAMERA.zoom. Walking eases the
   * view back onto the captain, so the drag never costs him the fight; a tap
   * on free ground (or the RECENTER chip) brings it back at once.
   */
  _steerCamera(dt) {
    const g = this.game;
    const input = g.input;
    const r = g.renderer;
    const pan = this.camPan;
    if (!input || !r || !r.cam) return;
    const d = input.panDelta;
    if (d && (d.x || d.y) && r.cam.zoom > 0) {
      const u = d.x / (r.cam.zoom * ISO_CAMERA.horizontal);
      const q = d.y / (r.cam.zoom * ISO_CAMERA.vertical);
      // the ground follows the finger: the view moves the other way
      const wx = -(u + q) * 0.5, wy = -(q - u) * 0.5;
      pan.x += wx; pan.y += wy;
      r.cam.x += wx; r.cam.y += wy;
      this._recenter = false;
      this._panUsed = true;
    }
    const z = input.zoomDelta;
    if (z && Math.abs(z - 1) > 1e-4) {
      this._userZoom = clamp(this.userZoom() * z, SURVIVAL_CAMERA.zoom[0], SURVIVAL_CAMERA.zoom[1]);
      const s = g.save && g.save.survival;
      if (s) s.camZoom = +this._userZoom.toFixed(3);
      this._panUsed = true;
    }
    if (typeof input.takePanTap === 'function' && input.takePanTap() && this.cameraOffset() > 40) this._recenter = true;
    // the view centre stays over the bailey (+ reach)
    const p = g.player;
    const B = g.mansion.bailey || g.mansion.bounds;
    if (B && p) {
      const reach = SURVIVAL_CAMERA.reach;
      pan.x = clamp(p.x + pan.x, B.x - reach, B.x + B.w + reach) - p.x;
      pan.y = clamp(p.y + pan.y, B.y - reach, B.y + B.h + reach) - p.y;
    }
    const walking = !!(input.moving || this.walkPath);
    if (this._recenter || walking) {
      const k = Math.exp(-(this._recenter ? 7 : SURVIVAL_CAMERA.recenter) * dt);
      pan.x *= k; pan.y *= k;
      if (Math.hypot(pan.x, pan.y) < 1) { pan.x = 0; pan.y = 0; this._recenter = false; }
    }
  }

  /**
   * Survival frames by the screen's short side, so a portrait phone and the
   * same phone turned sideways see the same depth of house around the Hunter
   * (landscape used to clamp to a much tighter zoom). Night pulls back far
   * enough that a crowd at the nearest door is in frame; day shows the base.
   * The half-size bailey (FORT_SCALE 0.5) lets the camera sit 1.3x closer
   * again (FRAME_CLOSER), so the captain, his guards and the horde read as
   * the pieces of the game rather than specks in a yard: a body stands ~90
   * px tall on a 390 px sideways phone (it was ~54).
   */
  frameMul(night) {
    const r = this.game.renderer;
    const short = Math.min(r.w || 390, r.h || 844);
    const target = clamp(short / 720, 0.5, 0.82) * (night ? 1.1 : 1.02) * FRAME_CLOSER;
    return target / (r.baseZoom || 1);
  }

  /* ---------------- threat model helpers ---------------- */

  waveCounts() { return WAVE_COUNTS[clamp(this.day, 1, 3) - 1].slice(); }

  swarmSpeed(breached) {
    const base = 59 + Math.max(0, this.day - 1) * 5;
    // Inside the walls they rush; outside they shamble in ranks.
    return breached ? 92 * (1 + (this.day - 1) * 0.08) : base;
  }

  _field(key) {
    const m = this.game.mansion;
    let field = this._fields.get(key);
    if (!field) { field = new FlowField(m); this._fields.set(key, field); }
    const version = m.navVersion || 0;
    if (key === 'hunter') {
      const p = this.game.player;
      const cell = `${Math.floor((p.x - m.navX0) / m.navCell)},${Math.floor((p.y - m.navY0) / m.navCell)}`;
      if (field.version !== version || field.cell !== cell) {
        if (field.version === version && this.uiClock - field.builtAt < 0.25) return field;
        field.cell = cell;
        field.builtAt = this.uiClock;
        field.build(p.x, p.y, version);
      }
      return field;
    }
    if (field.version !== version) {
      if (key === 'keep') {
        // a ring of goals around the tower's wall: every side is a target
        const keep = this.keep();
        const ring = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ring.push({ x: keep.x + Math.cos(a) * (keep.r + 34), y: keep.y + Math.sin(a) * (keep.r + 34) });
        }
        field.buildMulti(ring, version);
      } else if (key.startsWith('door:')) {
        const door = this.entranceById(key.slice(5));
        const point = door && (door.outside || door);
        if (point) field.build(point.x, point.y, version);
      }
      field.builtAt = this.uiClock;
    }
    return field;
  }

  flowDir(kind, x, y) {
    const field = this._field(kind);
    return field ? field.dirAt(x, y) : null;
  }

  nearestBrokenDoor(x, y) {
    let best = null, bestD = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (e.kind !== 'door' || !e.exterior || !e.broken) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nextIntactDoor(x, y) {
    let best = null, bestD = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (e.kind !== 'door' || !e.exterior || e.broken) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  doorPressure(id) { return this._doorPressure.get(id) || 0; }

  /** Intact exterior doors something is clawing right now. */
  besiegedDoors() {
    return this.game.mansion.entrances.filter((e) => e.exterior && e.kind === 'door' && !e.broken && this.doorPressure(e.id) > 0);
  }

  breachAge(id) { return this._breachAt[id] == null ? Infinity : this.uiClock - this._breachAt[id]; }

  nightSchedule() {
    const marks = WAVE_TIMES.map((at, i) => ({ at, kind: 'wave', done: this.waveIndex > i }));
    if (this.day >= 2) marks.push({ at: BREAKER_TIMES[0], kind: 'breaker', done: this.breakerIndex >= 1 });
    if (this.day >= 3) marks.push({ at: BREAKER_TIMES[1], kind: 'breaker', done: this.breakerIndex >= 2 });
    return marks;
  }

  aliveEnemies() {
    let n = 0;
    for (const e of this.game.enemies) if (e._survivalType && !e.dead && !e.removeMe) n++;
    return n;
  }

  enemiesNear(x, y, r) {
    let n = 0;
    for (const e of this.game.enemies) if (e._survivalType && !e.dead && dist(x, y, e.x, e.y) <= r) n++;
    return n;
  }

  /** Returns false, 'wood' or 'gold' (not enough). Gold never burns: no reserve. */
  affordReason(cost) {
    if (!cost) return 'none';
    if (this.wood < (cost.wood || 0)) return 'wood';
    if (this.gold < (cost.gold || 0)) return 'gold';
    return null;
  }

  canAfford(cost) { return this.affordReason(cost) === null; }

  rewardPending() {
    return this.phase === 'day' && !!this.lastRewards && this.rewardAck !== this.nightsCompleted;
  }

  ackRewards() {
    this.rewardAck = this.nightsCompleted;
    this.game.audio.play('uiConfirm', { vol: 0.6 });
    // the dawn's planks come off the sawmills you built, where you can see them
    for (const pay of this._sawmillPayout || []) {
      const spot = this.buildingSpot(pay.slotId);
      if (!spot || !(pay.wood > 0)) continue;
      this.pushFx('log', spot.x, spot.y, { n: pay.wood });
      this.pushFloater(spot.x, spot.y, `+${pay.wood}`, '#ffcf8a', { h: 130, size: 24, icon: 'wood', life: 1.8, pop: 1.4, kind: 'income' });
    }
    this._sawmillPayout = null;
    this._persist(true);
    return true;
  }

  /* ---------------- banners + floating numbers ---------------- */

  pushEvent(kind, icon, text, opts = {}) {
    const ev = { kind, icon, text, sub: opts.sub || null, life: opts.life || 1.9, age: 0 };
    const urgent = kind === 'breach' || kind === 'keep' || kind === 'breaker' || kind === 'keepLow';
    // a guard alarm is next in line (its clock is running), once per kind:
    // two guards falling together raise one banner, the HUD counts them
    const guardAlarm = kind === 'guardDown' || kind === 'guardLost';
    if (guardAlarm && ((this.banner && this.banner.kind === kind) || this.bannerQueue.some((q) => q.kind === kind))) return;
    if (!this.banner) this.banner = ev;
    else if (urgent && this.banner.kind !== 'breach' && this.banner.kind !== 'keep') {
      this.banner = ev;
    } else if (guardAlarm) {
      this.bannerQueue.unshift(ev);
      if (this.bannerQueue.length > 4) this.bannerQueue.pop();
    } else if (this.bannerQueue.length < 4) this.bannerQueue.push(ev);
  }

  currentBanner() { return this.banner; }

  /**
   * Income shown beside a HUD counter (`icon`: the counter it lands in;
   * `from`: the building icon it came from). Timestamped on the UI clock;
   * the HUD draws and drops them (src/ui/survival.js drawHudPops).
   */
  pushHudPop(icon, text, from) {
    if (!this.hudPops) this.hudPops = [];
    if (this.hudPops.length > 6) this.hudPops.shift();
    this.hudPops.push({ icon, text, from, t0: this.uiClock });
  }

  pushFloater(x, y, text, color, opts = {}) {
    if (this.floaters.length > 48) this.floaters.shift();
    this.floaters.push({
      x, y, text, color, h: opts.h || 60, size: opts.size || 16, icon: opts.icon || null, pop: opts.pop || 1.2, t: 0, life: opts.life || 0.9,
      drift: opts.drift != null ? opts.drift : 0, kind: opts.kind || null,
    });
  }

  /**
   * A one-shot 3D effect for world3d to play and forget (impact flashes and
   * rings, kill bursts, coins out of a mine, logs off a sawmill, a soldier
   * stepping out of a barracks). Drained every frame by the renderer; a
   * headless run just lets the queue roll over.
   */
  pushFx(kind, x, y, opts = {}) {
    if (this.fx.length >= 96) this.fx.shift();
    this.fx.push({ kind, x, y, t0: this.game.now || 0, ...opts });
  }

  _updateFx(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) this.floaters.splice(i, 1);
    }
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.life) this.banner = this.bannerQueue.shift() || null;
    }
  }

  getNightSnapshot() {
    return {
      phase: this.phase, day: this.day, elapsed: +this.elapsed.toFixed(2),
      duration: this.nightDuration, gold: +this.gold.toFixed(1), wood: this.wood,
      survivors: this.survivors, keepLevel: this.keepLevel, keepHp: Math.round(this.keepHp), keepHpMax: this.keepHpMax(),
      keepState: this.keepState(), hunterLevel: this.hunterLevel,
      buildings: { ...this.buildings }, buildingLevels: { ...this.buildingLevels },
      territory: this.territoryRooms().map((r) => r.id),
      enemies: this.game.enemies.filter((e) => !e.dead).length,
      breakers: this.game.enemies.filter((e) => e._survivalType === 'breaker' && !e.dead).length,
      kills: this.nightStats.kills, gateHp: Math.round(this.gateHp),
      keepAttackers: this.keepAttackers, keepDamage: Math.round(this.nightStats.keepDamage || 0),
      guards: this.guards.length, guardsDown: this.guards.filter((guard) => guard.down).length,
      gateBroken: !!(this.mainGate() && this.mainGate().broken),
      job: this.builderJob ? { ...this.builderJob } : null,
      context: this.phase === 'day' && this.dayContext() ? this.dayContext().id : null,
      cine: this.cine ? { kind: this.cine.kind, t: +this.cine.t.toFixed(2), dur: this.cine.dur } : null,
      relief: this.reinforcements ? {
        troops: this.reinforcements.length,
        marching: this.reinforcements.filter((s) => s.moving || s.delay > 0).length,
        inLine: this.reinforcements.filter((s) => s.i >= s.path.length).length,
      } : null,
      introSeen: !!(this.game.save.survival && this.game.save.survival.introSeen),
    };
  }

  _makeEnemy(kind, x, y, entranceId, index) {
    const entrance = this.entranceById(entranceId) || this.mainGate();
    if (kind === 'swarm') return new SurvivalCrowdZombie(x, y, entrance, index, this.day);
    if (kind === 'individual') return new SurvivalIndividualZombie(x, y, entrance, this.day, index);
    if (kind === 'breaker') return new SurvivalBreaker(x, y, entrance, this.day, index);
    return null;
  }

  _serializeEnemies() {
    return this.game.enemies.filter((e) => e._survivalType).map((e) => ({
      kind: e._survivalType, id: e.id, x: e.x, y: e.y, hp: e.hp, hpMax: e.hpMax,
      state: e.state, stateT: e.stateT, angle: e.angle, vx: e.vx, vy: e.vy,
      alpha: e.alpha, dead: e.dead, deathT: e.deathT, attackCd: e.attackCd,
      press: e.press, t: e.t, index: e.index || e.waveIndex || e.breakerIndex || 0,
      entranceId: e.entranceId, targetEntranceId: e.targetEntranceId,
      inHouse: !!e._inHouse, keepCd: e.keepCd, staggerT: e.staggerT || 0, targetKind: e.targetKind || null,
    }));
  }

  _persist(force) {
    const g = this.game;
    const s = g.save.survival || (g.save.survival = freshProgress(this.nightDuration));
    s.initialized = true;
    s.day = this.day; s.phase = this.phase; s.elapsed = +this.elapsed.toFixed(2);
    s.nightDuration = this.nightDuration;
    s.gold = Math.round(this.gold * 100) / 100; s.wood = Math.round(this.wood);
    delete s.oil; delete s.perapianLevel; delete s.oilBurned; delete s.nightOilStart;
    s.survivors = this.survivors; s.keepLevel = this.keepLevel; s.keepHp = Math.round(this.keepHp * 10) / 10;
    s.buildings = { ...this.buildings }; s.buildingLevels = { ...this.buildingLevels };
    s.hunterLevel = this.hunterLevel; s.gateBuilt = this.gateBuilt;
    s.gateHp = Math.round(this.gateHp); s.builderJob = this.builderJob ? { ...this.builderJob } : null;
    s.selectedRoom = this.selectedRoom; s.nightsCompleted = this.nightsCompleted;
    s.waveIndex = this.waveIndex; s.breakerIndex = this.breakerIndex; s.individualIndex = this.individualIndex;
    s.siegeTimers = { ...this.siegeTimers };
    s.nightKeepStart = this.nightKeepStart == null ? null : Math.round(Number(this.nightKeepStart));
    s.nightStats = cloneStats(this.nightStats); s.lastRewards = this.lastRewards ? { ...this.lastRewards } : null;
    s.runStats = cloneStats(this.runStats);
    s.records = { ...this.records };
    s.runResult = this.runResult ? cloneStats(this.runResult) : null;
    s.rewardAck = this.rewardAck;
    s.player = { x: g.player.x, y: g.player.y, angle: g.player.angle, blood: g.player.blood };
    s.entrances = g.mansion.entrances.map((e) => ({ id: e.id, hp: e.hp, hpMax: e.hpMax, broken: e.broken, open: e.open, barricade: e.barricade }));
    s.enemies = this.phase === 'night' ? this._serializeEnemies() : [];
    // hurt / fallen guards survive a mid-night reload (a fallen one where it lies)
    s.guards = this.phase === 'night' ? this.guards.map((guard) => ({
      hp: Math.round(guard.hp * 10) / 10, down: !!guard.down, rescueT: +guard.rescueT.toFixed(2),
      downT: +guard.downT.toFixed(2), x: Math.round(guard.x), y: Math.round(guard.y),
    })) : [];
    if (force) this._saveT = 0;
    try { window.__LN_SURVIVAL = this.getNightSnapshot(); } catch (_) { /* node harness */ }
    // writeSave is intentionally batched while simulating; phase/build changes
    // force an immediate checkpoint so a reload does not lose a completed day.
    if (force || this._saveT === 0) writeSave(g.save);
  }
}

export { SurvivalCrowdZombie, SurvivalIndividualZombie, SurvivalBreaker };
