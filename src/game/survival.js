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
    nightStats: { kills: 0, hits: 0, damageToWalls: 0 },
    lastRewards: null,
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
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.t += dt;
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 3.8);
    if (this.dead) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 7, dt); this.vy = damp(this.vy, 0, 7, dt);
      if (this.deathT > 1.45) this.removeMe = true;
      return;
    }
    this.staggerT = Math.max(0, (this.staggerT || 0) - dt);
    if (this.staggerT > 0) {
      this.state = 'stagger';
      this.vx = damp(this.vx, 0, 5.5, dt); this.vy = damp(this.vy, 0, 5.5, dt);
      this.moveColliding(game, this.vx * dt, this.vy * dt);
      return;
    }
    const mode = game.survival;
    const entrance = mode.entranceById(this.entranceId) || this.entrance;
    this.entrance = entrance;
    this.roomId = game.mansion.findRoom(this.x, this.y);
    const lit = mode.isLit(this.x, this.y);
    const player = game.player;
    const broken = !!(entrance && entrance.broken);

    // A breached rank enters through the opening and pressures an unlit lane.
    // In the Perapian's light it slows, staggers, and cannot land a player hit.
    if (broken) {
      if (this.roomId === ROOM.OUTSIDE) {
        const inside = entrance.inside || { x: entrance.x, y: entrance.y };
        this._stepToward(dt, game, inside.x, inside.y, lit ? 59 * mode.tuning.lightMoveMul : 59, 4.8);
        return;
      }
      if (lit) {
        this.state = 'stagger';
        this.vx = damp(this.vx, 0, 5.5, dt); this.vy = damp(this.vy, 0, 5.5, dt);
        this.moveColliding(game, this.vx * dt, this.vy * dt);
        return;
      }
      const d = dist(this.x, this.y, player.x, player.y);
      if (d > this.radius + player.radius + 12) {
        this._stepToward(dt, game, player.x, player.y, 70 * (1 + (mode.day - 1) * 0.06), 5.2);
      } else {
        this.vx = damp(this.vx, 0, 8, dt); this.vy = damp(this.vy, 0, 8, dt);
        this.state = 'press';
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          this.attackCd = 1.6;
          game.enemyHitPlayer(this, 9 + mode.day * 2, 'swarm');
        }
      }
      return;
    }

    if (!entrance || entrance.broken) { this.state = CROWD.LEAVE; return; }
    const spot = crowdSpot(entrance, this.index, 72);
    const targetX = spot.x + this.jx * 0.25;
    const targetY = spot.y + this.jy * 0.25;
    const d = dist(this.x, this.y, targetX, targetY);
    const speed = (59 + Math.max(0, mode.day - 1) * 5) * this.gait * (lit ? mode.tuning.lightMoveMul : 1);
    if (d > 10) {
      this.state = CROWD.MARCH;
      this._stepToward(dt, game, targetX, targetY, speed, 4.8);
      this.press = damp(this.press, 0, 5, dt);
    } else {
      this.vx = damp(this.vx, 0, 7, dt); this.vy = damp(this.vy, 0, 7, dt);
      this.state = CROWD.PRESS;
      this.press = damp(this.press, 1, 5, dt);
      this.angle = Math.atan2(entrance.y - this.y, entrance.x - this.x);
    }
    this.alpha = Math.min(1, this.alpha + dt * 0.8);
  }

  _stepToward(dt, game, tx, ty, speed, accel) {
    const a = Math.atan2(ty - this.y, tx - this.x);
    this.vx = damp(this.vx, Math.cos(a) * speed, accel, dt);
    this.vy = damp(this.vy, Math.sin(a) * speed, accel, dt);
    const moved = this.moveColliding(game, this.vx * dt, this.vy * dt);
    this.angle = Math.atan2(ty - this.y, tx - this.x);
    return moved;
  }
}

/** Individual, durable zombie that switches to the hero only after a breach. */
class SurvivalIndividualZombie extends Zombie {
  constructor(x, y, entrance, day, index = 0) {
    super(x, y, { entranceId: entrance && entrance.id });
    this._survivalType = 'individual';
    this._crowd = false;
    this.type = { ...this.type, name: 'ZOMBIE', hp: 118 + day * 14, speed: 58, huntSpeed: 72, contactDamage: 12 + day * 2 };
    this.hp = this.hpMax = this.type.hp;
    this.radius = 15;
    this.entranceId = entrance && entrance.id;
    this.waveIndex = index;
    this.attackCd = 1.2;
    this.alpha = 0.95;
    this.survival = true;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (this.dead) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 7, dt); this.vy = damp(this.vy, 0, 7, dt);
      if (this.deathT > 1.45) this.removeMe = true;
      return;
    }
    this.staggerT = Math.max(0, (this.staggerT || 0) - dt);
    if (this.staggerT > 0) {
      this.state = 'stagger';
      this.vx = damp(this.vx, 0, 5.5, dt); this.vy = damp(this.vy, 0, 5.5, dt);
      this.moveColliding(game, this.vx * dt, this.vy * dt);
      return;
    }
    const mode = game.survival;
    const entrance = mode.entranceById(this.entranceId) || mode.chooseTargetEntrance(this.x, this.y);
    this.entranceId = entrance && entrance.id;
    this.roomId = game.mansion.findRoom(this.x, this.y);
    const player = game.player;
    const lit = mode.isLit(this.x, this.y);
    this.attackCd -= dt;
    if (entrance && entrance.broken) {
      if (this.roomId === ROOM.OUTSIDE) {
        const inside = entrance.inside || { x: entrance.x, y: entrance.y };
        this._survivalMove(dt, game, inside.x, inside.y, lit ? this.type.speed * mode.tuning.lightMoveMul : this.type.speed);
        return;
      }
      const d = dist(this.x, this.y, player.x, player.y);
      if (d > this.radius + player.radius + 10) {
        this._survivalMove(dt, game, player.x, player.y, lit ? 75 * mode.tuning.lightMoveMul : 75);
      } else if (!lit && this.attackCd <= 0) {
        this.attackCd = 1.55;
        game.enemyHitPlayer(this, this.type.contactDamage, 'bite');
      }
      return;
    }
    if (!entrance) return;
    const out = entrance.outside || entrance;
    const d = dist(this.x, this.y, out.x, out.y);
    if (d > 54) {
      this._survivalMove(dt, game, out.x, out.y, lit ? this.type.speed * mode.tuning.lightMoveMul : this.type.speed);
      return;
    }
    this.state = 'press';
    this.vx = damp(this.vx, 0, 8, dt); this.vy = damp(this.vy, 0, 8, dt);
    if (!lit && this.attackCd <= 0) {
      this.attackCd = 2.1;
      mode.damageEntrance(entrance, this.type.doorDamage || 8, this);
    }
  }

  _survivalMove(dt, game, tx, ty, speed) {
    const a = Math.atan2(ty - this.y, tx - this.x);
    this.vx = damp(this.vx, Math.cos(a) * speed, 5.2, dt);
    this.vy = damp(this.vy, Math.sin(a) * speed, 5.2, dt);
    this.moveColliding(game, this.vx * dt, this.vy * dt);
    this.angle = Math.atan2(ty - this.y, tx - this.x);
    this.state = 'march';
  }
}

/** Day-2 wall specialist: its objective is an entrance, never the visible hero. */
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
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (this.dead) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 7, dt); this.vy = damp(this.vy, 0, 7, dt);
      if (this.deathT > 1.45) this.removeMe = true;
      return;
    }
    this.staggerT = Math.max(0, (this.staggerT || 0) - dt);
    if (this.staggerT > 0) {
      this.state = 'stagger';
      this.vx = damp(this.vx, 0, 5.5, dt); this.vy = damp(this.vy, 0, 5.5, dt);
      this.moveColliding(game, this.vx * dt, this.vy * dt);
      return;
    }
    const mode = game.survival;
    // Deliberately do not inspect player LOS/visibility here. The wall target is
    // selected once and remains the objective while the hero is in view.
    const target = mode.entranceById(this.targetEntranceId) || mode.mainGate();
    this.targetEntranceId = target && target.id;
    this.entranceId = this.targetEntranceId;
    this.roomId = game.mansion.findRoom(this.x, this.y);
    const lit = mode.isLit(this.x, this.y);
    if (!target) return;
    const out = target.outside || target;
    const d = dist(this.x, this.y, out.x, out.y);
    const speed = lit ? this.type.speed * mode.tuning.lightMoveMul : this.type.speed;
    if (d > 62) {
      const a = Math.atan2(out.y - this.y, out.x - this.x);
      this.vx = damp(this.vx, Math.cos(a) * speed, 4.2, dt);
      this.vy = damp(this.vy, Math.sin(a) * speed, 4.2, dt);
      this.moveColliding(game, this.vx * dt, this.vy * dt);
      this.angle = Math.atan2(out.y - this.y, out.x - this.x);
      this.state = 'march';
      return;
    }
    this.vx = damp(this.vx, 0, 8, dt); this.vy = damp(this.vy, 0, 8, dt);
    this.state = 'press';
    if (lit) return;
    this.attackCd -= dt;
    if (this.attackCd <= 0 && !target.broken) {
      this.attackCd = Math.max(2.2, 3.4 - mode.day * 0.25);
      mode.damageEntrance(target, this.type.doorDamage, this);
    }
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
    this._restore(game.save.survival || freshProgress(this.nightDuration));
    this._configureMansion();
    this._applyEntranceState();
    this.applyBuildingEffects(false);
    this.refreshFireplace(true);
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
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0, ...(s.nightStats || {}) };
    this.lastRewards = s.lastRewards || null;

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

  _configureMansion() {
    const m = this.game.mansion;
    m.survivalLighting = true;
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
    this.nightStats = { kills: 0, hits: 0, damageToWalls: 0 };
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
    this.refreshFireplace(true);
    g.renderer.snapCamera(g.player.x, g.player.y);
    this._persist(true);
    return true;
  }

  update(dt) {
    const g = this.game;
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

    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      e.update(dt, g);
      if (e.removeMe) g.enemies.splice(i, 1);
    }
    for (let i = g.bolts.length - 1; i >= 0; i--) {
      const b = g.bolts[i];
      b.update(dt, g);
      if (b.dead || dist(b.x, b.y, g.player.x, g.player.y) > 2600) g.bolts.splice(i, 1);
    }
    this.updateCrowdSiege(dt);
    this.updateGateMeter();
    this.followPlayer(dt);
    if (g.player.blood <= 0 && g.player.state !== 'death') g.killPlayer('Hunter lost');
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
    const waveTimes = [0.08, 0.38, 0.68];
    const counts = this.day === 1 ? [7, 7, 8] : this.day === 2 ? [8, 9, 9] : [10, 10, 10];
    while (this.waveIndex < waveTimes.length && this.elapsed >= duration * waveTimes[this.waveIndex]) {
      this.spawnSwarm(counts[this.waveIndex], this.waveIndex);
      this.waveIndex++;
    }
    const breakerAt = this.day >= 2 ? duration * 0.28 : Infinity;
    if (this.day >= 2 && this.breakerIndex === 0 && this.elapsed >= breakerAt) {
      this.spawnBreaker(0);
      this.breakerIndex = 1;
    }
    if (this.day >= 3 && this.breakerIndex === 1 && this.elapsed >= duration * 0.63) {
      this.spawnBreaker(1);
      this.breakerIndex = 2;
    }
    const individualAt = [0.54, 0.82];
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
    const total = Math.max(20, Math.min(30, count));
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const lateral = (col - 3) * 42 + rand(-8, 8);
      const depth = 240 + row * 60 + rand(-18, 18);
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
  }

  chooseTargetEntrance(_x, _y, offset = 0) {
    const doors = this.game.mansion.entrances.filter((e) => e.kind === 'door' && e.exterior);
    if (!doors.length) return this.mainGate();
    const priority = ['frontDoor', 'diningDoor', 'kitchenDoor', 'palisade', 'cellarDoor', 'chapelDoor', 'postern'];
    for (let i = 0; i < priority.length; i++) {
      const candidate = doors.find((e) => e.id === priority[(i + offset) % priority.length]);
      if (candidate && !candidate.broken) return candidate;
    }
    return doors.find((e) => !e.broken) || doors[0];
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
    for (const [id, row] of pressed) {
      const entrance = this.entranceById(id);
      if (!entrance || entrance.broken) continue;
      if (this.isLit(row.sample.x, row.sample.y)) continue;
      this.siegeTimers[id] = Math.max(0, (this.siegeTimers[id] || 0) - dt);
      if (this.siegeTimers[id] <= 0) {
        const amount = Math.min(16, 1.2 + row.count * 1.15);
        this.damageEntrance(entrance, amount, row.sample);
        this.siegeTimers[id] = 1.85;
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
  }

  enemyDamageTaken(enemy, amount) {
    return amount * (this.isLit(enemy.x, enemy.y) ? this.tuning.lightDamageTakenMul : 1);
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
    if (this.oil < spec.oil || this.wood < spec.wood) return false;
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
    if (this.oil < cost.oil || this.wood < cost.wood) return false;
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
    if (!cost || this.oil < cost.oil || this.wood < cost.wood) return false;
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
    this.refreshFireplace(true);
    this.game.audio.play('uiConfirm', { vol: 0.62 });
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
    this.lastRewards = { oil, wood, kills: this.nightStats.kills, walls: this.nightStats.damageToWalls };
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
      nightStats: { kills: 0, hits: 0, damageToWalls: 0 }, lastRewards: null, skillCooldown: 0,
    });
    for (const e of g.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax; e.broken = false; e.open = false; e.barricade = 0;
    }
    g.enemies.length = 0; g.bolts.length = 0;
    const fire = g.mansion.fireplaceLight;
    g.player.x = fire.x + 70; g.player.y = fire.y + 210;
    g.player.blood = g.player.bloodMax; g.player.weapon = 'shot'; g.player.state = 'idle';
    this.nightDuration = duration;
    this.phase = 'night';
    this.refreshFireplace(true);
    this.enter();
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
    const lookX = clamp(p.vx * 0.18, -56, 56);
    const lookY = clamp(p.vy * 0.18, -56, 56);
    g.renderer.followCamera(p.x, p.y, dt, lookX, lookY, g.mansion.camBounds);
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
