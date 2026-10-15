/* LAST NIGHT — Milestone 1 survival-building loop
 *
 * This mode is deliberately isolated from the original hunt/night systems.
 * It keeps the existing Mansion, Player, CrowdBody, enemy damage hooks, Hunter
 * shot, GLB rigs, and 3D room/light pipeline, but owns its own day/phase save,
 * resources, builder queue, night waves, and rewards.
 */

import { approachAngle, clamp, damp, dist, rand, writeSave } from '../core/util.js';
import { SURVIVAL_TUNING } from '../core/config.js';
import { CrowdBody, Zombie, outwardOf, CROWD, ESTATE } from './enemies.js';
import { ROOM } from './mansion.js';

const RESOURCE_CAP = 999;
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
// Doors per night: waves 1-3, then the two Individuals.
const NIGHT_DOORS = Object.freeze([
  Object.freeze(['frontDoor', 'chapelDoor', 'cellarDoor', 'cellarDoor', 'diningDoor']),
  Object.freeze(['cellarDoor', 'diningDoor', 'palisade', 'palisade', 'kitchenDoor']),
  Object.freeze(['chapelDoor', 'palisade', 'frontDoor', 'kitchenDoor', 'cellarDoor']),
]);
const RESERVE_SLACK = 8;
// A hotter Perapian scorches whatever claws at it (damage per second by level).
// (no knock-back: the burn thins a crowd at the hearth, it is not a wall)
const HEARTH_BURN = Object.freeze({ 1: 0, 2: 8, 3: 14 });
const HEARTH_BURN_RADIUS = 250;
const NIGHT_PHASE = { id: 'survival-night', label: 'NIGHT', danger: 0.24, ambient: [108, 114, 132] };
const DAY_PHASE = { id: 'survival-day', label: 'DAY', danger: 0.02, ambient: [186, 174, 150] };

// Lv1 build cost/label. `produces` only mirrors the Lv1 row of
// SURVIVAL_BUILDING_LEVELS for old readers; the level table drives the economy.
export const SURVIVAL_BUILDINGS = Object.freeze({
  extractor: Object.freeze({ id: 'extractor', label: 'OIL EXTRACTOR', oil: 2, wood: 10, seconds: 7, produces: { oil: 6 } }),
  sawmill: Object.freeze({ id: 'sawmill', label: 'SAWMILL', oil: 2, wood: 10, seconds: 7, produces: { wood: 7 } }),
  shelter: Object.freeze({ id: 'shelter', label: 'SURVIVOR SHELTER', oil: 4, wood: 14, seconds: 9, produces: { survivors: 1 } }),
  tower: Object.freeze({ id: 'tower', label: 'CROSSBOW TOWER', oil: 4, wood: 16, seconds: 8, produces: {} }),
});

/**
 * Building levels (Lv1 is the build itself). Every level pays off in the
 * coming night, so an upgrade bought on the last day still counts:
 *   extractor  pumps its oil into the stock DURING the night (fire fuel + purse)
 *   sawmill    wood every dawn, and planks: every outer door gets +% max HP
 *   shelter    houses survivors; a build or level moves one in at once
 *              (one more door guard tonight)
 *   tower      a crossbow tower by the room's outer door: harder bolts,
 *              further reach (see TOWER)
 */
export const BUILDING_MAX_LEVEL = 3;
export const SURVIVAL_BUILDING_LEVELS = Object.freeze({
  extractor: Object.freeze({
    1: Object.freeze({ oil: 2, wood: 10, seconds: 7, pump: 6 }),
    2: Object.freeze({ oil: 4, wood: 12, seconds: 6, pump: 10 }),
    3: Object.freeze({ oil: 6, wood: 16, seconds: 7, pump: 14 }),
  }),
  sawmill: Object.freeze({
    1: Object.freeze({ oil: 2, wood: 10, seconds: 7, dawnWood: 7, doorBonus: 0.1 }),
    2: Object.freeze({ oil: 4, wood: 12, seconds: 6, dawnWood: 11, doorBonus: 0.2 }),
    3: Object.freeze({ oil: 6, wood: 16, seconds: 7, dawnWood: 15, doorBonus: 0.3 }),
  }),
  shelter: Object.freeze({
    1: Object.freeze({ oil: 4, wood: 14, seconds: 9, houses: 1 }),
    2: Object.freeze({ oil: 6, wood: 16, seconds: 8, houses: 2 }),
    3: Object.freeze({ oil: 8, wood: 20, seconds: 9, houses: 3 }),
  }),
  tower: Object.freeze({
    1: Object.freeze({ oil: 4, wood: 16, seconds: 8, damage: 16, range: 520 }),
    2: Object.freeze({ oil: 6, wood: 18, seconds: 7, damage: 22, range: 580 }),
    3: Object.freeze({ oil: 8, wood: 22, seconds: 8, damage: 30, range: 640 }),
  }),
});
const DOOR_BONUS_CAP = 0.6;

/**
 * A crossbow tower is the house fighting back on its own. It is built in a
 * lit room like any building, but it stands just inside that room's outer
 * door (the middle of a room without one) and, by night, shoots a heavy bolt
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
  // a room with two outer doors guards the busier one
  doors: Object.freeze(['frontDoor', 'cellarDoor', 'chapelDoor', 'diningDoor', 'palisade', 'kitchenDoor', 'postern']),
});

/** The Hunter's own track, bought by day like a building (no skill cards). */
export const HUNTER_MAX_LEVEL = 3;
export const SURVIVAL_HUNTER = Object.freeze({
  1: Object.freeze({ damage: 26, hp: 100 }),
  2: Object.freeze({ oil: 14, wood: 8, seconds: 5, damage: 32, hp: 120 }),
  3: Object.freeze({ oil: 20, wood: 12, seconds: 6, damage: 40, hp: 140 }),
});

/**
 * A phone held sideways is too short for the day sheet under the world, so
 * the sheet and the NIGHT row move into a left column (ui/survival.js) and
 * the day camera frames the build target in the world view beside it.
 */
export function daySideColumn(w, h) {
  if (!(w > h && h < 560)) return null;
  return { x: 10, width: Math.min(380, Math.round(w * 0.45)) };
}

function freshProgress(duration = SURVIVAL_TUNING.nightSeconds) {
  return {
    initialized: true,
    day: 1,
    phase: 'night',
    elapsed: 0,
    nightDuration: duration,
    oil: SURVIVAL_TUNING.startOil,
    wood: SURVIVAL_TUNING.startWood,
    survivors: SURVIVAL_TUNING.startSurvivors,
    perapianLevel: 1,
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
    oilBurned: 0,
    siegeTimers: {},
    nightStats: { kills: 0, hits: 0, damageToWalls: 0, drained: 0, pumped: 0 },
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

const HEARTH_REACH = 132;
const SIEGE_REACH = 250;       // px from a door the pressing ranks still claw it
const FEED_EVERY = 1.5;
const FEED_OIL = Object.freeze({ swarm: 1, individual: 3, breaker: 6 });

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
const RANK_GAP = 44;
const RANK_ROW = 36;
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
 * Inside the walls: follow the flow field to the Perapian (or the Hunter when
 * he stands in the dark) and claw the fire once in reach. Light only slows.
 */
function invade(enemy, dt, game, mode, speed, accel, preferHunter, fallback = null) {
  const fire = mode.hearth();
  const p = game.player;
  const lit = mode.isLit(enemy.x, enemy.y);
  const pd = dist(enemy.x, enemy.y, p.x, p.y);
  enemy.feeding = false;
  // Firelight never makes a body harmless: in the light it will not hunt the
  // Hunter, but one standing in its way still gets clawed (weaker, see
  // SurvivalMode.enemyAttackMul).
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
  // In the dark it also goes for a guard close by, as it would for the Hunter.
  const prey = lit ? null : mode.guardToHunt(enemy);
  if (prey) {
    stepToward(enemy, dt, game, prey.x, prey.y, speed, accel);
    enemy.state = 'march';
    return 'march';
  }
  if (enemy._prey) enemy._prey = null;
  if (fire && dist(enemy.x, enemy.y, fire.x, fire.y) <= HEARTH_REACH) {
    settle(enemy, dt);
    enemy.feeding = true;
    enemy.state = 'strike';
    enemy.angle = Math.atan2(fire.y - enemy.y, fire.x - enemy.x);
    enemy.feedCd = (enemy.feedCd == null ? FEED_EVERY * 0.5 : enemy.feedCd) - dt;
    if (enemy.feedCd <= 0) { enemy.feedCd = FEED_EVERY; mode.feedHearth(enemy); }
    return 'feed';
  }
  const hunterInDark = !mode.isLit(p.x, p.y);
  const chase = (preferHunter && hunterInDark) || (!lit && pd < 170);
  let dir = mode.flowDir(chase ? 'hunter' : 'hearth', enemy.x, enemy.y);
  if (!dir && chase) dir = mode.flowDir('hearth', enemy.x, enemy.y);
  if (dir) stepDir(enemy, dt, game, dir, speed, accel);
  else if (!enemy._inHouse && fallback) stepToward(enemy, dt, game, fallback.x, fallback.y, speed, accel);
  else if (chase) stepToward(enemy, dt, game, p.x, p.y, speed, accel);
  else if (fire) stepToward(enemy, dt, game, fire.x, fire.y, speed, accel);
  enemy.state = 'march';
  return 'march';
}

/** Death/hit-stun handling shared by all three survival enemy types. */
function commonPreamble(enemy, dt, game) {
  if (enemy.dead) {
    enemy.feeding = false;
    enemy.deathT += dt;
    settle(enemy, dt, 7);
    if (enemy.deathT > 1.45) enemy.removeMe = true;
    return true;
  }
  enemy.staggerT = Math.max(0, (enemy.staggerT || 0) - dt);
  if (enemy.staggerT > 0) {
    // Flare knock-back / hit flinch: short and never caused by light alone.
    enemy.feeding = false;
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
    this.feedCd = null;
    this.feeding = false;
  }

  hurt(amount, game, fromX, fromY) {
    if (this.dead || this.removeMe) return;
    const incoming = game.survival ? game.survival.enemyDamageTaken(this, amount) : amount;
    this.hp -= incoming;
    this.hurtFlash = 1;
    if (fromX != null && fromY != null) {
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      this.vx += Math.cos(a) * 42; this.vy += Math.sin(a) * 42;
    }
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.feeding = false;
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
    const lit = mode.isLit(this.x, this.y);
    const slow = lit ? mode.tuning.lightMoveMul : 1;
    const broken = !!(entrance && entrance.broken);
    this.alpha = Math.min(1, this.alpha + dt * 0.8);

    if (broken || inside) {
      // The hearth field routes through whichever gap is open.
      this.press = damp(this.press || 0, 0, 5, dt);
      invade(this, dt, game, mode, mode.swarmSpeed(true) * slow, 5.2, false, entrance && (entrance.outside || entrance));
      return;
    }

    if (!entrance) { this.state = CROWD.LEAVE; return; }
    const spot = survivalSpot(entrance, this.index, 72);
    const targetX = spot.x + this.jx * 0.25;
    const targetY = spot.y + this.jy * 0.25;
    const d = dist(this.x, this.y, targetX, targetY);
    const speed = mode.swarmSpeed(false) * this.gait * slow;
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

/** Individual, durable zombie: hunts the Hunter in the dark, else the fire. */
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
    this.feedCd = null;
    this.feeding = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.feeding = false;
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
    const lit = mode.isLit(this.x, this.y);
    const slow = lit ? mode.tuning.lightMoveMul : 1;
    this.attackCd -= dt;
    // Outside: the assigned door; if it is intact, batter it (halved in light);
    // once any door is open, the flow field routes through the nearest gap.
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

/** Day-2 wall specialist: doors first (next intact one after a breach), then the fire. */
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
    this.feedCd = null;
    this.feeding = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.feeding = false;
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
    const lit = mode.isLit(this.x, this.y);
    const speed = this.type.speed * (lit ? mode.tuning.lightMoveMul : 1);
    // Deliberately do not inspect player LOS/visibility: the objective is a
    // structure. A broken target hands over to the next intact door; with no
    // door left standing it walks in and goes for the Perapian.
    let target = mode.entranceById(this.targetEntranceId);
    if (!target || target.broken) {
      const next = mode.nextIntactDoor(this.x, this.y);
      if (next) { target = next; this.targetKind = 'wall'; }
      else { target = null; this.targetKind = 'perapian'; }
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
 * BFS distance field on the Mansion nav grid. One field per goal (Perapian,
 * Hunter, each door lane); enemies read a direction in O(1) instead of each
 * running its own path search, which keeps a 30-body wave cheap on phones.
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

  build(x, y, version) {
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
    const goal = m.navNearest(x, y, 6);
    if (!goal) { this.goalCell = -1; return false; }
    const w = m.navW, h = m.navH, nav = m.nav, q = this.queue;
    const start = goal.gy * w + goal.gx;
    this.goalCell = start;
    let head = 0, tail = 0;
    q[tail++] = start;
    d[start] = 0;
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
 * Survivors are the house's garrison. By day they stand around the Perapian
 * (the count the HUD shows is people you can see); by night each one walks to
 * the door under the most pressure and shoots through its slit.
 *
 * They can be hurt, by the same rules as the Hunter: a body that gets inside
 * (a breach) claws a guard standing in its way (halved in firelight), and in
 * the dark it also goes for a guard close by — a few per guard, the rest keep
 * walking to the fire. So a guard holding a lit door is fairly safe and one
 * holding a dark door is not. A badly hurt guard falls back to the fire; one
 * that drops stays down where it fell and stops shooting. The Hunter helps a fallen guard up by standing beside it;
 * one left alone for `bleedOut` seconds is lost (one survivor fewer, for
 * good). Dawn gets everyone still down back up. Losing the house is still
 * only the fire or the Hunter.
 */
export const GUARD = Object.freeze({
  speed: 210,          // px/s walking between posts
  range: 420,          // px a guard will shoot at
  every: 1.6,          // s between shots
  damage: 10,          // per bolt (x1.75 on lit enemies, like the Hunter's)
  boltSpeed: 640,
  perDoor: 2,          // most guards one door takes before the next door gets one
  cap: 8,              // most guards on the map (== maxSurvivors)
  hp: 40,              // a survivor is no Hunter (100+): 3-4 claws in the dark
  reach: 12,           // px past both bodies' radii a claw lands from
  woundedAt: 0.35,     // at or below this share of HP a guard falls back to the fire
  rescueRange: 70,     // px from a fallen guard the Hunter stands to help him up
  rescueTime: 1.5,     // s he stays there
  rescueHp: 0.5,       // share of HP a guard gets up with
  bleedOut: 20,        // s a fallen guard holds on alone (the clock stops while helped)
  iframes: 0.5,        // s after a claw before the next one lands (the Hunter has 0.75)
  huntRange: 110,      // px: in the dark a body this close goes for a guard (Hunter: 170)
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
    this.oil = this.tuning.startOil;
    this.wood = this.tuning.startWood;
    this.survivors = this.tuning.startSurvivors;
    this.perapianLevel = 1;
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
    this.oilBurned = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0 };
    this.lastRewards = null;
    this.skillCooldown = 0;
    this.skillCooldownMax = this.tuning.skillCooldown;
    this.skillFlash = 0;
    this._saveT = 0;
    this._bakeRadius = -1;
    this._lastGateOpen = null;
    this._savedDurationOverride = options.nightDuration || null;
    this.uiClock = 0;
    this.guards = [];
    this.towers = [];
    this.floaters = [];
    this.bannerQueue = [];
    this.banner = null;
    this.hearthFeeders = 0;
    this.rewardAck = 0;
    this.dayFocus = null;
    this._doorPressure = new Map();
    this._breachAt = Object.create(null);
    this._fields = new Map();
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._fireLowWarned = false;
    this._hearthWarnAt = -99;
    this._restore(game.save.survival || freshProgress(this.nightDuration));
    this.applyHunterStats(false);
    this._configureMansion();
    this._applyEntranceState();
    this.applyBuildingEffects(false);
    this.game.mansion.buildNav();
    this.refreshFireplace(true);
    this._syncGuardRoster(true);
    this._applyGuardState();
    this._syncTowers();
    if (this.phase === 'night' && this.elapsed < 1) this._nightIntro();
  }

  _restore(saved) {
    const base = freshProgress(this.nightDuration);
    const s = { ...base, ...(saved || {}) };
    if (this._savedDurationOverride) s.nightDuration = this._savedDurationOverride;
    this.day = clamp(Math.round(Number(s.day) || 1), 1, 3);
    this.phase = ['night', 'day', 'complete', 'failed'].includes(s.phase) ? s.phase : 'night';
    this.elapsed = clamp(Number(s.elapsed) || 0, 0, this.nightDuration);
    this.nightDuration = clampDuration(s.nightDuration || this.nightDuration);
    this.oil = clamp(Math.floor(Number(s.oil) || 0), 0, RESOURCE_CAP);
    this.wood = clamp(Math.floor(Number(s.wood) || 0), 0, RESOURCE_CAP);
    this.survivors = clamp(Math.floor(Number(s.survivors) || 0), 0, 99);
    this.perapianLevel = clamp(Math.round(Number(s.perapianLevel) || 1), 1, 3);
    this.buildings = {};
    if (s.buildings && typeof s.buildings === 'object') {
      for (const [roomId, type] of Object.entries(s.buildings)) if (SURVIVAL_BUILDINGS[type]) this.buildings[roomId] = type;
    }
    // saves from before building levels have no table: every building is Lv1
    const levels = s.buildingLevels && typeof s.buildingLevels === 'object' ? s.buildingLevels : {};
    this.buildingLevels = {};
    for (const roomId of Object.keys(this.buildings)) {
      this.buildingLevels[roomId] = clamp(Math.round(Number(levels[roomId]) || 1), 1, BUILDING_MAX_LEVEL);
    }
    this.hunterLevel = clamp(Math.round(Number(s.hunterLevel) || 1), 1, HUNTER_MAX_LEVEL);
    this.gateBuilt = !!s.gateBuilt;
    this.gateHp = Math.max(0, Number(s.gateHp) || 0);
    this.builderJob = s.builderJob && typeof s.builderJob === 'object' ? { ...s.builderJob } : null;
    this.selectedRoom = s.selectedRoom || null;
    this.nightsCompleted = clamp(Math.floor(Number(s.nightsCompleted) || 0), 0, 3);
    this.waveIndex = Math.max(0, Math.floor(Number(s.waveIndex) || 0));
    this.breakerIndex = Math.max(0, Math.floor(Number(s.breakerIndex) || 0));
    this.individualIndex = Math.max(0, Math.floor(Number(s.individualIndex) || 0));
    this.oilBurned = Math.max(0, Number(s.oilBurned) || 0);
    this.nightOilStart = Number.isFinite(Number(s.nightOilStart)) && s.nightOilStart != null ? Number(s.nightOilStart) : null;
    this.siegeTimers = s.siegeTimers && typeof s.siegeTimers === 'object' ? { ...s.siegeTimers } : {};
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0, drained: 0, pumped: 0, ...(s.nightStats || {}) };
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
      const hearth = g.mansion.fireplaceLight || g.mansion.roomCenter(ROOM.LIBRARY);
      g.player.x = hearth.x + 70; g.player.y = hearth.y + 210;
      g.player.angle = -Math.PI / 2;
    }
    g.player.weapon = 'shot';
    g.player.blood = Math.max(1, g.player.blood || g.player.bloodMax);
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.time = this.elapsed;
    g.timeLeft = this.nightDuration - this.elapsed;
    g.phase = this.phase === 'day' ? DAY_PHASE : NIGHT_PHASE;
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
      if (row.targetKind) e.targetKind = row.targetKind;
      // a body that already crossed a doorway keeps walking to the fire
      // instead of turning back toward its door after a reload
      if (row.inHouse) e._inHouse = true;
      if (Number.isFinite(row.feedCd)) e.feedCd = row.feedCd;
      if (Number.isFinite(row.staggerT)) e.staggerT = row.staggerT;
      if (e._crowd) e.index = Number(row.index) || 0;
      g.enemies.push(e);
    }
  }

  /** The bake is phase-tinted (cool night / warm day); rebake on change. */
  _syncBakePhase() {
    const m = this.game.mansion;
    const want = this.phase === 'day' ? 'day' : 'night';
    if (m.survivalPhase !== want) {
      m.survivalPhase = want;
      this.game.survivalBakeDirty = true;
    }
  }

  _configureMansion() {
    const m = this.game.mansion;
    m.survivalLighting = true;
    this._syncBakePhase();
    for (const prop of m.props || []) {
      if (prop.type === 'carpet' && (prop.color === 'dark' || prop.color === 'crimson')) prop.color = 'rose';
      else if (prop.type === 'carpet' && prop.color === 'purple') prop.color = 'violet';
    }
    for (const light of m.lights) {
      if (light !== m.fireplaceLight) { light.i = 0; light.curI = 0; }
    }
    if (m.fireplaceLight) {
      m.fireplaceLight.i = this.oil > 0 ? 0.92 : 0;
      m.fireplaceLight.type = 'fire';
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
    g.uiPanel = this.phase === 'day' ? 'survival-day' : this.phase === 'complete' ? 'survival-complete' : this.phase === 'failed' ? 'survival-failed' : null;
    g.player.state = 'idle';
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(this.frameMul(this.phase !== 'day'));
    g.renderer.snapCamera(g.player.x, g.player.y);
    g.input.gameplay = this.phase === 'night';
    g.mansion.update(0, g);
    this._persist(true);
    return true;
  }

  startNight() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    this.phase = 'night';
    this.elapsed = 0;
    this.oilBurned = 0;
    this.nightOilStart = this.oil;
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0, drained: 0, pumped: 0 };
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
    this.refreshFireplace(true);
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
    this.bannerQueue.length = 0;
    this.banner = null;
    this.hearthFeeders = 0;
    this._doorPressure.clear();
    this._breachAt = Object.create(null);
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._fireLowWarned = false;
    this._hearthWarnAt = -99;
  }

  _nightIntro() {
    this.pushEvent('night', 'moon', `NIGHT ${this.day}`, { sub: 'SURVIVE UNTIL DAWN', life: 2.4 });
  }

  update(dt) {
    const g = this.game;
    this._syncBakePhase();
    this.uiClock += dt;
    // Pause freezes the run: Flare cooldown, banners and damage numbers all
    // wait with the night instead of quietly running out behind the panel.
    if (g.screen === 'playing') {
      this._updateFx(dt);
      this.skillCooldown = Math.max(0, this.skillCooldown - dt);
      this.skillFlash = Math.max(0, this.skillFlash - dt);
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
    this.updateLightFuel(dt);
    g.mansion.update(dt, g);
    this.refreshFireplace(false);

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

    let feeders = 0;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      e.update(dt, g);
      if (e.feeding && !e.dead) feeders++;
      if (e.removeMe) g.enemies.splice(i, 1);
    }
    this.hearthFeeders = feeders;
    this.updateHearthBurn(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    const p = g.player;
    if (this._lastPlayerPos) this._movedSinceStart += Math.hypot(p.x - this._lastPlayerPos.x, p.y - this._lastPlayerPos.y);
    this._lastPlayerPos = { x: p.x, y: p.y };
    if (!this._fireLowWarned && this.oil > 0 && this.oil < 6) {
      this._fireLowWarned = true;
      this.pushEvent('fireLow', 'oil', 'FIRE LOW!');
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
    if (this.oil <= 0) this.fail('THE FIRE WENT OUT');
    else if (g.player.blood <= 0 && g.player.state !== 'death') g.killPlayer('Hunter lost');
    else if (g.player.state === 'death' || g.player.state === 'dead') this.fail('Hunter lost');
    else if (this.elapsed >= this.nightDuration) this.completeNight();
  }

  updateDay(dt) {
    const g = this.game;
    this.elapsed += dt;
    g.time = this.elapsed;
    g.timeLeft = 0;
    g.phase = DAY_PHASE;
    g.danger = 0.02;
    g.bloodMoon = 0; g.duelDark = 0; g.blackoutT = 0; g.powerOut = false;
    g.mansion.update(dt, g);
    this.refreshFireplace(false);
    g.player.anim(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    if (this.builderJob) {
      this.builderJob.remaining = Math.max(0, this.builderJob.remaining - dt);
      if (this.builderJob.remaining <= 0) this.finishBuilderJob();
    }
    this.followPlayer(dt);
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
      const lateral = (col - 3) * 42 + rand(-8, 8);
      const depth = 150 + row * 56 + rand(-16, 16);
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
    const priority = ['frontDoor', 'chapelDoor', 'cellarDoor', 'diningDoor', 'palisade', 'kitchenDoor', 'postern'];
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
      if (e._inHouse || e.feeding) continue;
      const id = e._survivalType === 'breaker' ? e.targetEntranceId : e.entranceId;
      if (id) this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + 1);
    }
    for (const [id, row] of pressed) {
      const entrance = this.entranceById(id);
      if (!entrance || entrance.broken) continue;
      this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + row.count);
      // Firelight weakens a siege (damageEntrance halves it); it never cancels it.
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
    const lit = source && this.isLit(source.x, source.y);
    const weakened = lit ? 0.5 : 1;
    this.game.mansion.damageEntrance(entrance, amount * weakened, this.game, source && source.x, source && source.y);
    this.nightStats.damageToWalls += Math.max(0, before - entrance.hp);
    this.gateHp = Math.max(0, this.mainGate() ? this.mainGate().hp : 0);
    if (entrance.broken) this.onBreach(entrance);
  }

  onBreach(entrance) {
    if (this._breachAt[entrance.id] != null) return;
    this._breachAt[entrance.id] = this.uiClock;
    this.game.mansion.refreshNavAround(entrance);
    this.pushEvent('breach', 'doorBroken', 'BREACH!');
  }

  enemyDamageTaken(enemy, amount) {
    const lit = this.isLit(enemy.x, enemy.y);
    const dealt = amount * (lit ? this.tuning.lightDamageTakenMul : 1);
    if (dealt > 0.5) {
      const h = enemy._survivalType === 'breaker' ? 96 : enemy._survivalType === 'individual' ? 78 : 60;
      this.pushFloater(enemy.x + rand(-10, 10), enemy.y, `${Math.round(dealt)}`, lit ? '#ffd24a' : '#ffffff', { h, size: lit ? 20 : 16 });
    }
    return dealt;
  }

  /** Light weakens claws; it never makes a body harmless (Hunter can still die). */
  enemyCanAttack() { return true; }
  enemyAttackMul(enemy) { return enemy && this.isLit(enemy.x, enemy.y) ? this.tuning.litAttackMul : 1; }

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

  /** Lower is shot first: whatever is eating the fire, then what is already inside. */
  targetScore(from, e) {
    let s = dist(from.x, from.y, e.x, e.y);
    if (e._survivalType === 'breaker') s -= 70;
    else if (e._survivalType === 'individual') s -= 20;
    if (e.feeding) s -= 160;
    else if (e._inHouse) s -= 60;
    return s;
  }

  /* ---------------- guards (survivors) ---------------- */

  /** One pawn per survivor (capped). New ones step out by the fire. */
  _syncGuardRoster(snap = false) {
    const want = clamp(Math.floor(this.survivors || 0), 0, GUARD.cap);
    while (this.guards.length > want) this.guards.pop();
    while (this.guards.length < want) {
      const i = this.guards.length;
      const post = this._hearthPost(i);
      const guard = new SurvivalGuard(i, post.x, post.y);
      guard.post = post;
      this.guards.push(guard);
    }
    if (snap) {
      // a new phase (dawn, dusk, a fresh run): everyone stands, healed, by the fire
      for (const guard of this.guards) {
        const post = this._hearthPost(guard.index);
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

  /** A claw lands on a guard (already scaled for firelight). */
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
    this.pushEvent('guardLost', 'guard', 'GUARD LOST', { life: 2.2 });
    this.game.audio.play('playerHurt', { vol: 0.65 });
    this._guardAssignT = 0;
    this._persist(true);
  }

  /** A loose arc in front of the fire (day camp / spare guards at night). */
  _hearthPost(i) {
    const fire = this.hearth() || { x: 0, y: 0 };
    const t = (i + 0.5) / GUARD.cap;
    const a = Math.PI * (0.12 + 0.76 * t);
    const r = 205 + (i % 2) * 34;
    return this._freePost(fire.x + Math.cos(a) * r, fire.y + 60 + Math.sin(a) * r, 'hearth', null);
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
   * each; the rest hold the fire. A guard keeps its post while that door is
   * still in the ranking, so they do not ping-pong across the house.
   */
  assignGuards() {
    const g = this.game;
    if (!this.guards.length) return;
    if (this.phase !== 'night') {
      for (const guard of this.guards) this._setGuardPost(guard, this._hearthPost(guard.index));
      return;
    }
    // a fallen guard stays where it fell; a badly hurt one holds the fire
    const able = [];
    for (const guard of this.guards) {
      if (guard.down) continue;
      if (guard.hp <= guard.hpMax * GUARD.woundedAt) this._setGuardPost(guard, this._hearthPost(guard.index));
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
      else this._setGuardPost(guard, this._hearthPost(guard.index));
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
   * Where a building stands (its model, and the day bubble over it): an
   * economy building near the middle of its room, a tower beside the room's
   * outer door, a little off the doorway so the slit stays in its sights.
   * Either way on clear floor, never on a table; fixed per room and type.
   */
  buildingSpot(roomId, type = this.buildings[roomId]) {
    const key = `${roomId}:${type === 'tower' ? 'tower' : 'building'}`;
    if (!this._spots) this._spots = new Map();
    if (this._spots.has(key)) return this._spots.get(key);
    const room = this.game.mansion.room(roomId);
    if (!room) return null;
    const spot = this._findSpot(room, type === 'tower' ? this.towerDoor(room) : null);
    this._spots.set(key, spot);
    return spot;
  }

  _findSpot(room, door) {
    const m = this.game.mansion;
    const pad = 46;
    let ideal;
    if (door) {
      let nx = door.inside.x - door.x, ny = door.inside.y - door.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      let sx = -ny, sy = nx;
      if ((room.x + room.w / 2 - door.x) * sx + (room.y + room.h / 2 - door.y) * sy < 0) { sx = -sx; sy = -sy; }
      ideal = { x: door.x + nx * TOWER.setback + sx * TOWER.side, y: door.y + ny * TOWER.setback + sy * TOWER.side };
    } else {
      ideal = { x: room.x + room.w / 2 + 48, y: room.y + room.h / 2 + 24 };
    }
    ideal.x = clamp(ideal.x, room.x + pad, room.x + room.w - pad);
    ideal.y = clamp(ideal.y, room.y + pad, room.y + room.h - pad);
    const clear = (x, y) => {
      if (x < room.x + pad || x > room.x + room.w - pad || y < room.y + pad || y > room.y + room.h - pad) return false;
      if (m.solidAt(x, y)) return false;
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

  towerStats(roomId) { return this.buildingStats('tower', this.buildingLevel(roomId)); }

  /** Towers mirror `buildings`: one per room holding a tower, any level. */
  _syncTowers() {
    const ids = Object.keys(this.buildings).filter((id) => this.buildings[id] === 'tower');
    if (ids.length === this.towers.length && ids.every((id, i) => this.towers[i].roomId === id)) return;
    const old = new Map(this.towers.map((t) => [t.roomId, t]));
    this.towers = ids.map((roomId, i) => old.get(roomId) || this._makeTower(roomId, i)).filter(Boolean);
  }

  _makeTower(roomId, index) {
    const spot = this.buildingSpot(roomId, 'tower');
    if (!spot) return null;
    const door = spot.doorId ? this.entranceById(spot.doorId) : null;
    const angle = door ? Math.atan2(door.y - spot.y, door.x - spot.x) : Math.PI / 2;
    return {
      id: 6000000 + index, key: 'tower', roomId, doorId: spot.doorId,
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
      const st = this.towerStats(t.roomId);
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
    g.audio.play('chandelier', { vol: 0.72 });
    g.particles.burst('spark', p.x, p.y, 26, {
      color: 'rgba(255,194,98,0.95)', sizeMin: 2, sizeMax: 6, speedMin: 55, speedMax: 240,
      lifeMin: 0.18, lifeMax: 0.68, glow: true,
    });
    for (const e of g.enemies) {
      if (e.dead || dist(p.x, p.y, e.x, e.y) > this.tuning.skillRadius) continue;
      e.hurt(this.tuning.skillDamage, g, p.x, p.y);
      e.staggerT = Math.max(e.staggerT || 0, 0.85);
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.vx = (e.vx || 0) + Math.cos(a) * 110; e.vy = (e.vy || 0) + Math.sin(a) * 110;
    }
    return true;
  }

  updateLightFuel(dt) {
    if (this.oil <= 0) {
      this.oil = 0;
      return;
    }
    // Oil pumps feed the stock all night long (the fire's fuel is the purse).
    const pump = this.pumpRate() * dt;
    if (pump > 0) {
      this.oil = Math.min(RESOURCE_CAP, this.oil + pump);
      this.nightStats.pumped = (this.nightStats.pumped || 0) + pump;
    }
    if (this.hearthFeeders > 0 && Math.random() < dt * 2) this.game.renderer.shake(0.04);
    const burn = Math.min(this.oil, this.tuning.oilBurnPerSecond * dt);
    this.oil = Math.max(0, this.oil - burn);
    this.oilBurned += burn;
  }

  getFireRadius() {
    if (this.oil <= 0 || this.phase === 'failed') return 0;
    const base = this.tuning.perapianRadius[this.perapianLevel] || 0;
    const target = this.tuning.oilBurnTargetPerNight + (this.perapianLevel - 1) * 2.5;
    const spent = clamp(this.oilBurned / Math.max(1, target), 0, 1);
    const fuelFactor = 1 - spent * this.tuning.oilRadiusShrink;
    return Math.max(0, base * fuelFactor);
  }

  isLit(x, y) {
    if (this.oil <= 0 || this.phase === 'failed') return false;
    const light = this.game.mansion.fireplaceLight;
    return !!light && dist(x, y, light.x, light.y) <= this.getFireRadius();
  }

  refreshFireplace(force = false) {
    this._syncBakePhase();
    const light = this.game.mansion.fireplaceLight;
    if (!light) return;
    const radius = this.getFireRadius();
    const intensity = this.oil > 0 ? 0.88 : 0;
    if (Math.abs((light.r || 0) - radius) > 0.5) light.r = Math.max(1, radius);
    light.i = intensity;
    light.curI = intensity * (light.f == null ? 1 : light.f);
    const crossedBakeStep = Math.abs(radius - this._bakeRadius) >= 105 || (this._bakeRadius > 0) !== (radius > 0);
    if (force || crossedBakeStep) {
      this._bakeRadius = radius;
      this.game.survivalBakeDirty = true;
    }
  }

  litRooms() {
    const fire = this.game.mansion.fireplaceLight;
    if (!fire || this.getFireRadius() <= 0) return [];
    return this.game.mansion.roomList.filter((room) => this.isLit(room.x + room.w / 2, room.y + room.h / 2));
  }

  buildableRooms() {
    const occupied = this.buildings;
    return this.litRooms().filter((room) => room.id !== ROOM.LIBRARY && !occupied[room.id]);
  }

  startBuild(type, roomId = null) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    if (type === 'perapian') return this.startPerapianUpgrade();
    if (type === 'gate') return this.startGateBuild();
    if (type === 'hunter') return this.startHunterUpgrade();
    if (type === 'upgrade') return this.startUpgrade(roomId);
    const spec = SURVIVAL_BUILDINGS[type];
    if (!spec || !roomId) return false;
    if (!this.buildableRooms().some((room) => room.id === roomId)) return false;
    if (!this.canAfford(spec)) return false;
    this.oil -= spec.oil; this.wood -= spec.wood;
    this.selectedRoom = roomId;
    this.builderJob = { kind: 'building', type, roomId, remaining: spec.seconds, duration: spec.seconds };
    g.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  startGateBuild() {
    if (this.gateBuilt || this.builderJob || this.phase !== 'day') return false;
    const cost = this.tuning.gateCost;
    if (!this.canAfford(cost)) return false;
    this.oil -= cost.oil; this.wood -= cost.wood;
    this.builderJob = { kind: 'gate', type: 'gate', remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  startPerapianUpgrade() {
    if (this.perapianLevel >= 3 || this.builderJob || this.phase !== 'day') return false;
    const target = this.perapianLevel + 1;
    const cost = this.tuning.perapianUpgrade[target];
    if (!cost || !this.canAfford(cost)) return false;
    this.oil -= cost.oil; this.wood -= cost.wood;
    this.builderJob = { kind: 'perapian', type: 'perapian', targetLevel: target, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  /* ---------------- building levels + the Hunter's track ---------------- */

  buildingLevel(roomId) {
    if (!this.buildings[roomId]) return 0;
    return clamp(Math.round(Number(this.buildingLevels[roomId]) || 1), 1, BUILDING_MAX_LEVEL);
  }

  /** Stats of one building type at one level ({} for unknown types). */
  buildingStats(type, level = 1) {
    const table = SURVIVAL_BUILDING_LEVELS[type];
    return (table && table[clamp(Math.round(level) || 1, 1, BUILDING_MAX_LEVEL)]) || {};
  }

  /** Cost of the next level of the building in a room (null at max / empty). */
  upgradeCost(roomId) {
    const type = this.buildings[roomId];
    const level = this.buildingLevel(roomId);
    if (!type || level >= BUILDING_MAX_LEVEL) return null;
    const next = this.buildingStats(type, level + 1);
    return next.wood != null ? { oil: next.oil || 0, wood: next.wood || 0, seconds: next.seconds || 6 } : null;
  }

  startUpgrade(roomId) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const type = this.buildings[roomId];
    const cost = this.upgradeCost(roomId);
    if (!type || !cost || !this.canAfford(cost)) return false;
    this.oil -= cost.oil; this.wood -= cost.wood;
    this.selectedRoom = roomId;
    const targetLevel = this.buildingLevel(roomId) + 1;
    this.builderJob = { kind: 'upgrade', type, roomId, targetLevel, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  /** Oil every pump moves into the stock over one night. */
  pumpPerNight() {
    let total = 0;
    for (const [roomId, type] of Object.entries(this.buildings)) {
      if (type === 'extractor') total += this.buildingStats(type, this.buildingLevel(roomId)).pump || 0;
    }
    return total;
  }

  pumpRate() { return this.pumpPerNight() / Math.max(1, this.nightDuration); }

  /** Sawmill planks: +% max HP on every outer door (summed, capped). */
  doorHpBonus() {
    let bonus = 0;
    for (const [roomId, type] of Object.entries(this.buildings)) {
      if (type === 'sawmill') bonus += this.buildingStats(type, this.buildingLevel(roomId)).doorBonus || 0;
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
    return { oil: next.oil || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
  }

  startHunterUpgrade() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const cost = this.hunterUpgradeCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.oil -= cost.oil; this.wood -= cost.wood;
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

  finishBuilderJob() {
    const job = this.builderJob;
    if (!job) return;
    let text = 'BUILT!';
    let icon = SURVIVAL_BUILDINGS[job.type] ? job.type : 'shelter';
    if (job.kind === 'perapian') {
      this.perapianLevel = clamp(job.targetLevel, 1, 3);
      icon = 'perapian'; text = `PERAPIAN Lv${this.perapianLevel}`;
    } else if (job.kind === 'gate') {
      this.gateBuilt = true;
      this.applyBuildingEffects(true);
      icon = 'gate';
    } else if (job.kind === 'hunter') {
      this.hunterLevel = clamp(job.targetLevel, 1, HUNTER_MAX_LEVEL);
      this.applyHunterStats(true);
      icon = 'hunter'; text = `HUNTER Lv${this.hunterLevel}`;
    } else if (job.kind === 'building' || job.kind === 'upgrade') {
      const before = job.kind === 'upgrade' ? this.buildingLevel(job.roomId) : 0;
      const level = job.kind === 'upgrade' ? clamp(job.targetLevel, 1, BUILDING_MAX_LEVEL) : 1;
      this.buildings[job.roomId] = job.type;
      this.buildingLevels[job.roomId] = level;
      if (job.type === 'shelter') {
        // a shelter houses its survivors at once: tonight's door guards
        const moved = (this.buildingStats('shelter', level).houses || 0) - (before ? this.buildingStats('shelter', before).houses || 0 : 0);
        this.survivors = Math.min(this.tuning.maxSurvivors, this.survivors + Math.max(0, moved));
        this._syncGuardRoster(false);
      }
      if (job.type === 'sawmill') this.applyBuildingEffects(false);
      if (job.kind === 'upgrade') text = `Lv${level}!`;
    }
    this.builderJob = null;
    if (job.kind === 'gate') this.game.mansion.buildNav();
    this.refreshFireplace(true);
    this.game.audio.play('uiConfirm', { vol: 0.62 });
    this.pushEvent('build', icon, text, { life: 1.6 });
    this._persist(true);
  }

  /**
   * Door max HP from what stands in the house: sawmill planks on every outer
   * door, the reinforced gate on the front door. By day the doors are whole,
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
    const dayIndex = clamp(this.day - 1, 0, 2);
    let oil = this.tuning.nightRewards.oil[dayIndex];
    let wood = this.tuning.nightRewards.wood[dayIndex];
    // guards lost during the night are already gone from the roster; anyone
    // still down gets up at dawn (the snap below heals the garrison)
    const lost = this.nightStats.lost || 0;
    const survivorsBefore = this.survivors;
    // Dawn pays the sawmills; the pumps already poured their oil in during
    // the night, and shelters house their survivors as soon as they stand.
    for (const [roomId, type] of Object.entries(this.buildings)) {
      if (type === 'sawmill') wood += this.buildingStats(type, this.buildingLevel(roomId)).dawnWood || 0;
    }
    const pumped = Math.round(this.nightStats.pumped || 0);
    // kills pay a little (guards shoot too, so this stays a trickle)
    const killOil = Math.floor(this.nightStats.kills / 6);
    const killWood = Math.floor(this.nightStats.kills / 4);
    oil += killOil; wood += killWood;
    this.oil = clamp(this.oil + oil, 0, RESOURCE_CAP);
    this.wood = clamp(this.wood + wood, 0, RESOURCE_CAP);
    this.nightsCompleted = Math.min(3, this.nightsCompleted + 1);
    // Dawn tops the fire back up to its full radius: the day plans with the
    // radius the sheet shows (lit rooms = buildable rooms), not the embers
    // of the night before.
    this.oilBurned = 0;
    this.repairDoors();
    this.lastRewards = {
      oil, wood, kills: this.nightStats.kills, walls: this.nightStats.damageToWalls,
      survivors: this.survivors - survivorsBefore, drained: Math.round(this.nightStats.drained || 0),
      pumped, lost, rescued: this.nightStats.rescued || 0,
    };
    this._resetNightFx();
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    this.applyHunterStats(true);
    this.elapsed = 0;
    if (this.nightsCompleted >= 3) {
      this.day = 3;
      this.phase = 'complete';
      g.uiPanel = 'survival-complete';
    } else {
      this.day = Math.min(3, this.day + 1);
      this.phase = 'day';
      g.uiPanel = 'survival-day';
    }
    g.screen = 'playing';
    g.phase = DAY_PHASE;
    g.time = 0; g.timeLeft = 0;
    g.input.gameplay = false;
    this.applyBuildingEffects(false);
    this.refreshFireplace(true);
    this._syncGuardRoster(true);
    this._syncTowers();
    this._persist(true);
  }

  fail(reason) {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.failureReason = reason || 'The Hunter fell.';
    this.game.screen = 'playing';
    this.game.uiPanel = 'survival-failed';
    this.game.input.gameplay = false;
    this._persist(true);
  }

  restart() {
    const g = this.game;
    const duration = this.nightDuration;
    Object.assign(this, {
      phase: 'night', day: 1, elapsed: 0, oil: this.tuning.startOil, wood: this.tuning.startWood,
      survivors: this.tuning.startSurvivors, perapianLevel: 1, buildings: {}, buildingLevels: {}, hunterLevel: 1, gateBuilt: false,
      gateHp: 0, builderJob: null, selectedRoom: null, nightsCompleted: 0, waveIndex: 0,
      breakerIndex: 0, individualIndex: 0, oilBurned: 0, siegeTimers: Object.create(null),
      nightStats: { kills: 0, hits: 0, damageToWalls: 0, drained: 0, pumped: 0 }, lastRewards: null, skillCooldown: 0,
      rewardAck: 0, dayFocus: null, nightOilStart: this.tuning.startOil,
    });
    this._resetNightFx();
    this._fields.clear();
    for (const e of g.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax; e.broken = false; e.open = false; e.barricade = 0;
      e.flash = 0; e.attackers = 0;
    }
    g.enemies.length = 0; g.bolts.length = 0;
    const fire = g.mansion.fireplaceLight;
    g.player.x = fire.x + 70; g.player.y = fire.y + 210;
    this.applyHunterStats(true);
    g.player.weapon = 'shot'; g.player.state = 'idle';
    this.nightDuration = duration;
    this.phase = 'night';
    g.mansion.buildNav();
    this.refreshFireplace(true);
    this.guards.length = 0;
    this._syncGuardRoster(true);
    this._syncTowers();
    this.enter();
    this._nightIntro();
  }

  useBuilding(roomId) { return this.buildings[roomId] || null; }

  buildingCost(type) {
    if (type === 'perapian') return this.tuning.perapianUpgrade[this.perapianLevel + 1] || null;
    if (type === 'gate') return this.tuning.gateCost;
    if (type === 'hunter') return this.hunterUpgradeCost();
    return SURVIVAL_BUILDINGS[type] || null;
  }

  buildingName(type) {
    if (type === 'perapian') return `PERAPIAN LV${this.perapianLevel}`;
    if (type === 'gate') return 'REINFORCED GATE';
    if (type === 'hunter') return `HUNTER LV${this.hunterLevel}`;
    return SURVIVAL_BUILDINGS[type] ? SURVIVAL_BUILDINGS[type].label : 'EMPTY';
  }

  onEnemyKilled(enemy) {
    if (enemy._survivalRewarded) return;
    enemy._survivalRewarded = true;
    this.nightStats.kills++;
    this.game.stats.kills = (this.game.stats.kills || 0) + 1;
    this.game.audio.play('hitFlesh', { vol: 0.42, weight: 0.8 });
  }

  onPlayerHurt(amount) {
    this.nightStats.hits++;
    this.game.audio.play('playerHurt', { vol: 0.72 });
    this.game.renderer.shake(clamp(0.18 + amount * 0.009, 0.18, 0.55));
    this.game.particles.burst('blood', this.game.player.x, this.game.player.y, 7, {
      color: '#a52635', speedMin: 20, speedMax: 92, lifeMin: 0.2, lifeMax: 0.55, sizeMin: 1.5, sizeMax: 3,
    });
  }

  followPlayer(dt) {
    const g = this.game;
    const p = g.player;
    const r = g.renderer;
    if (this.phase === 'day') {
      // Day is a base view: zoom out and frame the selected build target
      // above the bottom sheet.
      if (r.setZoomMul) r.setZoomMul(this.frameMul(false), dt);
      const focus = this.dayFocusPoint();
      // where the target should land on screen: above the bottom sheet, or
      // (sideways) a little below the middle of the world view so its bubble
      // sits in the middle
      const side = daySideColumn(r.w, r.h);
      const sx = side ? (side.x + side.width + r.w) / 2 : r.w / 2;
      const sy = side ? (74 + r.h - 34) / 2 + 30 : r.h / 2 - Math.min(150, r.h * 0.17);
      const a = r.screenToWorld(r.w / 2, r.h / 2);
      const b = r.screenToWorld(sx, sy);
      r.followCamera(focus.x + (a.x - b.x), focus.y + (a.y - b.y), dt, 0, 0, g.mansion.camBounds);
      return;
    }
    if (r.setZoomMul) r.setZoomMul(this.frameMul(true), dt);
    let lookX = clamp(p.vx * 0.18, -56, 56);
    let lookY = clamp(p.vy * 0.18, -56, 56);
    // lean toward what the Hunter is shooting so a crowd at a door is on screen
    const t = this.currentTarget;
    if (t && !t.dead) {
      lookX += clamp((t.x - p.x) * 0.3, -130, 130);
      lookY += clamp((t.y - p.y) * 0.3, -130, 130);
    }
    r.followCamera(p.x, p.y, dt, lookX, lookY, g.mansion.camBounds);
  }

  /**
   * Survival frames by the screen's short side, so a portrait phone and the
   * same phone turned sideways see the same depth of house around the Hunter
   * (landscape used to clamp to a much tighter zoom). Night pulls back far
   * enough that a crowd at the nearest door is in frame; day shows the base.
   */
  frameMul(night) {
    const r = this.game.renderer;
    const short = Math.min(r.w || 390, r.h || 844);
    const target = clamp(short / 720, 0.5, 0.82) * (night ? 0.86 : 0.74);
    return target / (r.baseZoom || 1);
  }

  dayFocusPoint() {
    const key = this.dayFocus || 'perapian';
    if (key === 'gate') { const gate = this.mainGate(); if (gate) return { x: gate.x, y: gate.y }; }
    if (key === 'hunter') return { x: this.game.player.x, y: this.game.player.y };
    if (key !== 'perapian') {
      // a tower stands by its door: frame the tower and its reach
      if (this.buildings[key] === 'tower') { const spot = this.buildingSpot(key, 'tower'); if (spot) return { x: spot.x, y: spot.y }; }
      const room = this.game.mansion.room(key);
      if (room) return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
    }
    const fire = this.hearth();
    return fire ? { x: fire.x, y: fire.y + 120 } : { x: this.game.player.x, y: this.game.player.y };
  }

  /* ---------------- threat model helpers ---------------- */

  waveCounts() { return WAVE_COUNTS[clamp(this.day, 1, 3) - 1].slice(); }

  swarmSpeed(breached) {
    const base = 59 + Math.max(0, this.day - 1) * 5;
    // Inside the walls they rush; outside they shamble in ranks.
    return breached ? 92 * (1 + (this.day - 1) * 0.08) : base;
  }

  hearth() { return this.game.mansion.fireplaceLight || null; }

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
      if (key === 'hearth') {
        const fire = this.hearth();
        if (fire) field.build(fire.x, fire.y + 70, version);
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

  /** An enemy at the Perapian claws fuel out of it. Fire out = night lost. */
  feedHearth(enemy) {
    if (this.phase !== 'night') return;
    const amount = FEED_OIL[enemy._survivalType] || 1;
    const before = this.oil;
    this.oil = Math.max(0, this.oil - amount);
    const lost = before - this.oil;
    this.nightStats.drained = (this.nightStats.drained || 0) + lost;
    const fire = this.hearth();
    if (fire) this.pushFloater(fire.x + rand(-30, 30), fire.y + 40, `-${Math.round(lost)}`, '#ff6b5e', { h: 90, size: 20, icon: 'oil' });
    if (this.uiClock - this._hearthWarnAt > 7) {
      this._hearthWarnAt = this.uiClock;
      this.pushEvent('hearth', 'fire', 'PROTECT THE FIRE!');
    }
    const g = this.game;
    g.audio.play('impact', { vol: 0.32 });
    g.renderer.shake(0.08);
    if (fire) g.particles.burst('spark', fire.x, fire.y + 30, 8, {
      color: 'rgba(255,150,60,0.95)', sizeMin: 1.5, sizeMax: 4, speedMin: 40, speedMax: 150, lifeMin: 0.2, lifeMax: 0.5, glow: true,
    });
    if (this.oil <= 0) this.fail('THE FIRE WENT OUT');
  }

  hearthBurnDps(level = this.perapianLevel) { return HEARTH_BURN[level] || 0; }

  updateHearthBurn(dt) {
    const dps = this.hearthBurnDps();
    const fire = this.hearth();
    if (!dps || !fire || this.oil <= 0) return;
    const g = this.game;
    for (const e of g.enemies) {
      if (!e._survivalType || e.dead || e.removeMe) continue;
      if (dist(e.x, e.y, fire.x, fire.y) > HEARTH_BURN_RADIUS) { e._burnT = 0; continue; }
      e._burnT = (e._burnT || 0) + dt;
      if (e._burnT >= 0.5) {
        e._burnT -= 0.5;
        if (typeof e.hurt === 'function') e.hurt(dps * 0.5, g);
      }
    }
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

  roomsLitAt(radius) {
    const fire = this.hearth();
    if (!fire) return 0;
    return this.game.mansion.roomList.filter((room) => dist(room.x + room.w / 2, room.y + room.h / 2, fire.x, fire.y) <= radius).length;
  }

  /** Fuel the day may not spend: tonight's burn plus a few claws of slack. */
  oilReserveForNight() { return Math.ceil(this.tuning.oilBurnPerSecond * this.nightDuration) + RESERVE_SLACK; }

  /**
   * Day spending may not dip into tonight's fuel: the Perapian burns
   * oilReserveForNight() before dawn and an empty hearth loses the run.
   * Returns false, 'wood', 'oil' (not enough at all) or 'reserve'.
   */
  affordReason(cost) {
    if (!cost) return 'none';
    if (this.wood < (cost.wood || 0)) return 'wood';
    if (this.oil < (cost.oil || 0)) return 'oil';
    if ((cost.oil || 0) > 0 && this.oil - cost.oil < this.oilReserveForNight()) return 'reserve';
    return null;
  }

  canAfford(cost) { return this.affordReason(cost) === null; }

  rewardPending() {
    return this.phase === 'day' && !!this.lastRewards && this.rewardAck !== this.nightsCompleted;
  }

  ackRewards() {
    this.rewardAck = this.nightsCompleted;
    this.game.audio.play('uiConfirm', { vol: 0.6 });
    this._persist(true);
    return true;
  }

  /* ---------------- banners + floating numbers ---------------- */

  pushEvent(kind, icon, text, opts = {}) {
    const ev = { kind, icon, text, sub: opts.sub || null, life: opts.life || 1.9, age: 0 };
    const urgent = kind === 'breach' || kind === 'hearth' || kind === 'breaker';
    if (!this.banner) this.banner = ev;
    else if (urgent && this.banner.kind !== 'breach' && this.banner.kind !== 'hearth') {
      this.banner = ev;
    } else if (this.bannerQueue.length < 4) this.bannerQueue.push(ev);
  }

  currentBanner() { return this.banner; }

  pushFloater(x, y, text, color, opts = {}) {
    if (this.floaters.length > 48) this.floaters.shift();
    this.floaters.push({ x, y, text, color, h: opts.h || 60, size: opts.size || 16, icon: opts.icon || null, t: 0, life: opts.life || 0.9 });
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
      duration: this.nightDuration, oil: +this.oil.toFixed(1), wood: this.wood,
      survivors: this.survivors, perapianLevel: this.perapianLevel, hunterLevel: this.hunterLevel,
      buildingLevels: { ...this.buildingLevels },
      radius: Math.round(this.getFireRadius()), litRooms: this.litRooms().map((r) => r.id),
      enemies: this.game.enemies.filter((e) => !e.dead).length,
      breakers: this.game.enemies.filter((e) => e._survivalType === 'breaker' && !e.dead).length,
      kills: this.nightStats.kills, gateHp: Math.round(this.gateHp),
      feeders: this.hearthFeeders, drained: Math.round(this.nightStats.drained || 0),
      guards: this.guards.length, guardsDown: this.guards.filter((guard) => guard.down).length,
      gateBroken: !!(this.mainGate() && this.mainGate().broken),
      job: this.builderJob ? { ...this.builderJob } : null,
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
      inHouse: !!e._inHouse, feedCd: e.feedCd, staggerT: e.staggerT || 0, targetKind: e.targetKind || null,
    }));
  }

  _persist(force) {
    const g = this.game;
    const s = g.save.survival || (g.save.survival = freshProgress(this.nightDuration));
    s.initialized = true;
    s.day = this.day; s.phase = this.phase; s.elapsed = +this.elapsed.toFixed(2);
    s.nightDuration = this.nightDuration;
    s.oil = Math.round(this.oil * 100) / 100; s.wood = Math.round(this.wood);
    s.survivors = this.survivors; s.perapianLevel = this.perapianLevel;
    s.buildings = { ...this.buildings }; s.buildingLevels = { ...this.buildingLevels };
    s.hunterLevel = this.hunterLevel; s.gateBuilt = this.gateBuilt;
    s.gateHp = Math.round(this.gateHp); s.builderJob = this.builderJob ? { ...this.builderJob } : null;
    s.selectedRoom = this.selectedRoom; s.nightsCompleted = this.nightsCompleted;
    s.waveIndex = this.waveIndex; s.breakerIndex = this.breakerIndex; s.individualIndex = this.individualIndex;
    s.oilBurned = +this.oilBurned.toFixed(2); s.siegeTimers = { ...this.siegeTimers };
    s.nightOilStart = this.nightOilStart == null ? null : +Number(this.nightOilStart).toFixed(2);
    s.nightStats = { ...this.nightStats }; s.lastRewards = this.lastRewards ? { ...this.lastRewards } : null;
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
