/* LAST NIGHT — Milestone 1 survival-building loop
 *
 * This mode is deliberately isolated from the original hunt/night systems.
 * It keeps the existing Mansion, Player, CrowdBody, enemy damage hooks, Hunter
 * shot, GLB rigs, and 3D room/light pipeline, but owns its own day/phase save,
 * resources, builder queue, night waves, and rewards.
 */

import { clamp, damp, dist, rand, writeSave } from '../core/util.js';
import { SURVIVAL_TUNING } from '../core/config.js';
import { CrowdBody, Zombie, crowdSpot, outwardOf, CROWD, ESTATE } from './enemies.js';
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
const RESERVE_SLACK = 8;
// A hotter Perapian scorches whatever claws at it (damage per second by level).
const HEARTH_BURN = Object.freeze({ 1: 0, 2: 14, 3: 28 });
const HEARTH_BURN_RADIUS = 250;
const NIGHT_PHASE = { id: 'survival-night', label: 'NIGHT', danger: 0.24, ambient: [108, 114, 132] };
const DAY_PHASE = { id: 'survival-day', label: 'DAY', danger: 0.02, ambient: [186, 174, 150] };

export const SURVIVAL_BUILDINGS = Object.freeze({
  extractor: Object.freeze({ id: 'extractor', label: 'OIL EXTRACTOR', oil: 2, wood: 10, seconds: 7, produces: { oil: 6 } }),
  sawmill: Object.freeze({ id: 'sawmill', label: 'SAWMILL', oil: 2, wood: 10, seconds: 7, produces: { wood: 7 } }),
  shelter: Object.freeze({ id: 'shelter', label: 'SURVIVOR SHELTER', oil: 4, wood: 14, seconds: 9, produces: { survivors: 1 } }),
});

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
    nightStats: { kills: 0, hits: 0, damageToWalls: 0, drained: 0 },
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

/** Outside the walls: walk the lane to a door (flow field near the house). */
function approachDoor(enemy, dt, game, mode, door, point, speed, accel) {
  const dir = mode.flowDir(`door:${door.id}`, enemy.x, enemy.y);
  if (dir && dist(enemy.x, enemy.y, point.x, point.y) > 60) stepDir(enemy, dt, game, dir, speed, accel);
  else stepToward(enemy, dt, game, point.x, point.y, speed, accel);
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
  if (!lit && pd < enemy.radius + p.radius + 12 && p.state !== 'death' && p.state !== 'dead') {
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
    const spot = crowdSpot(entrance, this.index, 72);
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
    this._configureMansion();
    this._applyEntranceState();
    this.applyBuildingEffects(false);
    this.game.mansion.buildNav();
    this.refreshFireplace(true);
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
    this.buildings = s.buildings && typeof s.buildings === 'object' ? s.buildings : {};
    this.gateBuilt = !!s.gateBuilt;
    this.gateHp = Math.max(0, Number(s.gateHp) || 0);
    this.builderJob = s.builderJob && typeof s.builderJob === 'object' ? { ...s.builderJob } : null;
    this.selectedRoom = s.selectedRoom || null;
    this.nightsCompleted = clamp(Math.floor(Number(s.nightsCompleted) || 0), 0, 3);
    this.waveIndex = Math.max(0, Math.floor(Number(s.waveIndex) || 0));
    this.breakerIndex = Math.max(0, Math.floor(Number(s.breakerIndex) || 0));
    this.individualIndex = Math.max(0, Math.floor(Number(s.individualIndex) || 0));
    this.oilBurned = Math.max(0, Number(s.oilBurned) || 0);
    this.siegeTimers = s.siegeTimers && typeof s.siegeTimers === 'object' ? { ...s.siegeTimers } : {};
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0, drained: 0, ...(s.nightStats || {}) };
    this.lastRewards = s.lastRewards || null;
    this.rewardAck = Math.max(0, Math.floor(Number(s.rewardAck) || 0));

    const g = this.game;
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
      if (prop.type === 'carpet' && prop.color === 'dark') prop.color = 'crimson';
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
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0, drained: 0 };
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
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(1);
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
    this._updateFx(dt);
    this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    this.skillFlash = Math.max(0, this.skillFlash - dt);
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

  spawnSwarm(count, wave) {
    const g = this.game;
    const entrance = this.chooseTargetEntrance(g.player.x, g.player.y, wave);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const total = clamp(Math.round(count), 1, SWARM_CAP);
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const lateral = (col - 3) * 42 + rand(-8, 8);
      const depth = 150 + row * 56 + rand(-16, 16);
      const x = entrance.outside.x + out.x * depth + along.x * lateral;
      const y = entrance.outside.y + out.y * depth + along.y * lateral;
      const body = new SurvivalCrowdZombie(x, y, entrance, i + wave * total, this.day);
      body.id = 1000000 + this.day * 10000 + wave * 100 + i;
      g.enemies.push(body);
    }
  }

  spawnIndividual(index) {
    const g = this.game;
    const entrance = this.chooseTargetEntrance(g.player.x, g.player.y, index + 2);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const x = entrance.outside.x + out.x * (180 + index * 54) + rand(-42, 42);
    const y = entrance.outside.y + out.y * (180 + index * 54) + rand(-42, 42);
    const enemy = new SurvivalIndividualZombie(x, y, entrance, this.day, index);
    enemy.id = 2000000 + this.day * 100 + index;
    g.enemies.push(enemy);
  }

  spawnBreaker(index = 0) {
    const g = this.game;
    const entrance = this.mainGate();
    if (!entrance) return;
    const out = outwardOf(entrance);
    const x = entrance.outside.x + out.x * (330 + index * 80) + rand(-20, 20);
    const y = entrance.outside.y + out.y * (330 + index * 80) + rand(-20, 20);
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
    // Night n rotates the opening doors so every night tests a different side.
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

  updateCrowdSiege(dt) {
    const g = this.game;
    const pressed = new Map();
    for (const e of g.enemies) {
      if (!e._survivalType || e.dead || e._survivalType !== 'swarm' || e.state !== CROWD.PRESS) continue;
      const id = e.entranceId || (e.entrance && e.entrance.id);
      if (!id) continue;
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

  enemyCanAttack(enemy) { return !this.isLit(enemy.x, enemy.y); }

  autoTarget() {
    const p = this.game.player;
    const candidates = this.game.enemies.filter((e) => !e.dead && !e.removeMe && e.hp > 0
      && dist(p.x, p.y, e.x, e.y) <= this.tuning.autoAttackRange
      && this.game.mansion.hasLOS(p.x, p.y, e.x, e.y));
    candidates.sort((a, b) => {
      const aa = (a._survivalType === 'breaker' ? -70 : a._survivalType === 'individual' ? -20 : 0) + dist(p.x, p.y, a.x, a.y);
      const bb = (b._survivalType === 'breaker' ? -70 : b._survivalType === 'individual' ? -20 : 0) + dist(p.x, p.y, b.x, b.y);
      return aa - bb;
    });
    return candidates[0] || null;
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

  finishBuilderJob() {
    const job = this.builderJob;
    if (!job) return;
    if (job.kind === 'perapian') {
      this.perapianLevel = clamp(job.targetLevel, 1, 3);
    } else if (job.kind === 'gate') {
      this.gateBuilt = true;
      this.applyBuildingEffects(true);
    } else if (job.kind === 'building') {
      this.buildings[job.roomId] = job.type;
    }
    this.builderJob = null;
    if (job.kind === 'gate') this.game.mansion.buildNav();
    this.refreshFireplace(true);
    this.game.audio.play('uiConfirm', { vol: 0.62 });
    const icon = job.kind === 'perapian' ? 'perapian' : job.kind === 'gate' ? 'gate' : (job.type === 'extractor' ? 'extractor' : job.type === 'sawmill' ? 'sawmill' : 'shelter');
    this.pushEvent('build', icon, job.kind === 'perapian' ? `PERAPIAN Lv${this.perapianLevel}` : 'BUILT!', { life: 1.6 });
    this._persist(true);
  }

  applyBuildingEffects(repairGate = false) {
    const gate = this.mainGate();
    if (!gate) return;
    const base = gate.baseHpMax || gate.hpMax || 190;
    if (this.gateBuilt) {
      gate.hpMax = base + this.tuning.gateHpBonus;
      if (repairGate || gate.hp <= 0) { gate.hp = gate.hpMax; gate.broken = false; gate.open = false; }
      else gate.hp = Math.min(gate.hp, gate.hpMax);
    } else {
      gate.hpMax = base;
      if (!Number.isFinite(gate.hp)) gate.hp = base;
    }
    this.gateHp = Math.max(0, gate.hp);
  }

  completeNight() {
    if (this.phase !== 'night') return;
    const g = this.game;
    const dayIndex = clamp(this.day - 1, 0, 2);
    let oil = this.tuning.nightRewards.oil[dayIndex];
    let wood = this.tuning.nightRewards.wood[dayIndex];
    const survivorsBefore = this.survivors;
    for (const type of Object.values(this.buildings)) {
      const spec = SURVIVAL_BUILDINGS[type];
      if (!spec) continue;
      oil += spec.produces.oil || 0;
      wood += spec.produces.wood || 0;
      if (spec.produces.survivors) this.survivors = Math.min(this.tuning.maxSurvivors, this.survivors + spec.produces.survivors);
    }
    const killOil = Math.floor(this.nightStats.kills / 4);
    const killWood = Math.floor(this.nightStats.kills / 3);
    oil += killOil; wood += killWood;
    this.oil = clamp(this.oil + oil, 0, RESOURCE_CAP);
    this.wood = clamp(this.wood + wood, 0, RESOURCE_CAP);
    this.nightsCompleted = Math.min(3, this.nightsCompleted + 1);
    this.repairDoors();
    this.lastRewards = {
      oil, wood, kills: this.nightStats.kills, walls: this.nightStats.damageToWalls,
      survivors: this.survivors - survivorsBefore, drained: Math.round(this.nightStats.drained || 0),
    };
    this._resetNightFx();
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.player.blood = g.player.bloodMax;
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
      survivors: this.tuning.startSurvivors, perapianLevel: 1, buildings: {}, gateBuilt: false,
      gateHp: 0, builderJob: null, selectedRoom: null, nightsCompleted: 0, waveIndex: 0,
      breakerIndex: 0, individualIndex: 0, oilBurned: 0, siegeTimers: Object.create(null),
      nightStats: { kills: 0, hits: 0, damageToWalls: 0, drained: 0 }, lastRewards: null, skillCooldown: 0,
      rewardAck: 0, dayFocus: null,
    });
    this._resetNightFx();
    this._fields.clear();
    for (const e of g.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax; e.broken = false; e.open = false; e.barricade = 0;
    }
    g.enemies.length = 0; g.bolts.length = 0;
    const fire = g.mansion.fireplaceLight;
    g.player.x = fire.x + 70; g.player.y = fire.y + 210;
    g.player.blood = g.player.bloodMax; g.player.weapon = 'shot'; g.player.state = 'idle';
    this.nightDuration = duration;
    this.phase = 'night';
    g.mansion.buildNav();
    this.refreshFireplace(true);
    this.enter();
    this._nightIntro();
  }

  useBuilding(roomId) { return this.buildings[roomId] || null; }

  buildingCost(type) {
    if (type === 'perapian') return this.tuning.perapianUpgrade[this.perapianLevel + 1] || null;
    if (type === 'gate') return this.tuning.gateCost;
    return SURVIVAL_BUILDINGS[type] || null;
  }

  buildingName(type) {
    if (type === 'perapian') return `PERAPIAN LV${this.perapianLevel}`;
    if (type === 'gate') return 'REINFORCED GATE';
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
      if (r.setZoomMul) r.setZoomMul(0.8, dt);
      const focus = this.dayFocusPoint();
      const a = r.screenToWorld(r.w / 2, r.h / 2);
      const b = r.screenToWorld(r.w / 2, r.h / 2 + Math.min(150, r.h * 0.17));
      r.followCamera(focus.x + (b.x - a.x), focus.y + (b.y - a.y), dt, 0, 0, g.mansion.camBounds);
      return;
    }
    if (r.setZoomMul) r.setZoomMul(1, dt);
    const lookX = clamp(p.vx * 0.18, -56, 56);
    const lookY = clamp(p.vy * 0.18, -56, 56);
    r.followCamera(p.x, p.y, dt, lookX, lookY, g.mansion.camBounds);
  }

  dayFocusPoint() {
    const key = this.dayFocus || 'perapian';
    if (key === 'gate') { const gate = this.mainGate(); if (gate) return { x: gate.x, y: gate.y }; }
    if (key !== 'perapian') {
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
    return breached ? 84 * (1 + (this.day - 1) * 0.06) : base;
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
        if (typeof e.hurt === 'function') e.hurt(dps * 0.5, g, fire.x, fire.y);
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
      survivors: this.survivors, perapianLevel: this.perapianLevel,
      radius: Math.round(this.getFireRadius()), litRooms: this.litRooms().map((r) => r.id),
      enemies: this.game.enemies.filter((e) => !e.dead).length,
      breakers: this.game.enemies.filter((e) => e._survivalType === 'breaker' && !e.dead).length,
      kills: this.nightStats.kills, gateHp: Math.round(this.gateHp),
      feeders: this.hearthFeeders, drained: Math.round(this.nightStats.drained || 0),
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
    s.buildings = { ...this.buildings }; s.gateBuilt = this.gateBuilt;
    s.gateHp = Math.round(this.gateHp); s.builderJob = this.builderJob ? { ...this.builderJob } : null;
    s.selectedRoom = this.selectedRoom; s.nightsCompleted = this.nightsCompleted;
    s.waveIndex = this.waveIndex; s.breakerIndex = this.breakerIndex; s.individualIndex = this.individualIndex;
    s.oilBurned = +this.oilBurned.toFixed(2); s.siegeTimers = { ...this.siegeTimers };
    s.nightStats = { ...this.nightStats }; s.lastRewards = this.lastRewards ? { ...this.lastRewards } : null;
    s.rewardAck = this.rewardAck;
    s.player = { x: g.player.x, y: g.player.y, angle: g.player.angle, blood: g.player.blood };
    s.entrances = g.mansion.entrances.map((e) => ({ id: e.id, hp: e.hp, hpMax: e.hpMax, broken: e.broken, open: e.open, barricade: e.barricade }));
    s.enemies = this.phase === 'night' ? this._serializeEnemies() : [];
    if (force) this._saveT = 0;
    try { window.__LN_SURVIVAL = this.getNightSnapshot(); } catch (_) { /* node harness */ }
    // writeSave is intentionally batched while simulating; phase/build changes
    // force an immediate checkpoint so a reload does not lose a completed day.
    if (force || this._saveT === 0) writeSave(g.save);
  }
}

export { SurvivalCrowdZombie, SurvivalIndividualZombie, SurvivalBreaker };
