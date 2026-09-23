/* LAST NIGHT — enemies
 *
 * Three enemies, three jobs:
 *   CRAWLER  — panic. Fast, fragile, throws itself at doors, arrives in numbers.
 *   HUNTER   — ranged pressure. Keeps its distance, punishes you for standing
 *              still, retreats when you close in. Carries a lantern, so you can
 *              see it coming... usually.
 *   WEREWOLF — threat spike. Slow until it isn't. Walks through barricades.
 *
 * Shared behaviour: they always arrive from *outside*, they must get through an
 * entrance, and they lose track of you if you break line of sight. Stealth is a
 * real strategy here — the player is not supposed to kill everything.
 */

import { clamp, lerp, damp, TAU, rand, randInt, chance, dist, dist2, approachAngle, angDiff, visualAngle, Rng } from '../core/util.js';
import { ENEMY_TYPES, VARIANTS } from '../core/config.js';
import { ROOM } from './mansion.js';

export const ESTATE = {
  APPROACH: 'approach', BREACH: 'breach', CLIMB: 'climb', HUNT: 'hunt',
  STRIKE: 'strike', STAGGER: 'stagger', SEARCH: 'search', DYING: 'dying',
  CHARGE: 'charge', WINDUP: 'windup', RETREAT: 'retreat', IDLE: 'idle',
  LEAVE: 'leave',
};

let UID = 1;

export class Enemy {
  constructor(typeKey, x, y, opts = {}) {
    const T = ENEMY_TYPES[typeKey];
    this.type = T;
    this.key = typeKey;
    this.id = UID++;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = rand(0, TAU);
    this.radius = T.radius;
    this.hp = T.hp;
    this.hpMax = T.hp;
    this.state = ESTATE.APPROACH;
    this.stateT = 0;
    this.attackCd = rand(0, 0.6);
    this.doorCd = rand(0, 0.4);
    this.target = null;            // {x,y}
    this.seenPlayer = 0;           // memory timer
    this.lastKnown = null;
    this.room = ROOM.OUTSIDE;
    this.entranceId = opts.entranceId || null;
    this.climbT = 0;
    this.hurtFlash = 0;
    this.staggerT = 0;
    this.wobble = rand(0, TAU);
    this.alpha = 0;
    this.dead = false;
    this.removeMe = false;
    this.deathT = 0;
    this.speedMul = opts.speedMul ?? 1;
    this.damageMul = opts.damageMul ?? 1;
    this.aggro = 0;
    this.lastDoorHit = 0;
    this.stuckT = 0;
    this.path = [];
    this.pathT = 0;
    this.spawnGrace = 0.4;
    this.speakCd = rand(3, 9);
    this.leapT = 0;
    this.leapDir = 0;
    this.revealed = !!opts.reveal;
    this.roomId = ROOM.OUTSIDE;
  }

  get T() { return this.type; }
  get alive() { return !this.dead; }
  get insideHouse() { return this.roomId !== ROOM.OUTSIDE; }

  /* ---------------- navigation ---------------- */

  pickTarget(game) {
    // choose an entrance: prefer the one nearest the player, weighted by how
    // damaged it already is (they follow weakness, like water finding a crack)
    const p = game.player;
    let best = null, bestScore = -1e9;
    for (const e of game.mansion.entrances) {
      if (e.kind === 'window' && (this.key === 'werewolf' || this.key === 'ghoul')) continue;
      if (e.kind === 'window' && this.key === 'hunter' && chance(0.5)) continue;
      const d = dist(e.outside.x, e.outside.y, p.x, p.y);
      let score = -d * 0.01;
      score -= (e.hp / e.hpMax) * 3.2;                 // damaged doors are attractive
      score += e.kind === 'door' ? 1.2 : 0;
      if (e.id === this.entranceId) score += 1.5;      // stick with the plan
      score += rand(-0.8, 0.8);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    this.entranceId = best ? best.id : null;
  }

  entrance(game) {
    if (!this.entranceId) this.pickTarget(game);
    return game.mansion.entranceById(this.entranceId);
  }

  /** Set a steering target from room-level pathing. */
  computePath(game) {
    const p = game.player;
    const myRoom = this.roomId;
    const pRoom = game.mansion.findRoom(p.x, p.y);
    this.pathT = 0.55;
    if (myRoom === ROOM.OUTSIDE) {
      const e = this.entrance(game);
      if (!e) { this.path = [{ x: p.x, y: p.y }]; return; }
      const blocked = !e.broken && !(e.kind === 'door' && e.open);
      this.path = blocked ? [{ x: e.outside.x, y: e.outside.y }] : [{ x: e.inside.x, y: e.inside.y }];
      return;
    }
    if (myRoom === pRoom || pRoom === ROOM.OUTSIDE) { this.path = [{ x: p.x, y: p.y }]; return; }
    if (this.seenPlayer > 0 && this.lastKnown) { this.path = [{ x: this.lastKnown.x, y: this.lastKnown.y }]; }
    else this.path = game.mansion.route(myRoom, pRoom);
  }

  nextWaypoint(game) {
    if (this.pathT <= 0 || this.path.length === 0) this.computePath(game);
    this.pathT -= game.dt;
    // drop waypoints we've reached
    while (this.path.length > 1 && dist(this.x, this.y, this.path[0].x, this.path[0].y) < 58) this.path.shift();
    const wp = this.path[0] || { x: game.player.x, y: game.player.y };
    return wp;
  }

  /* ---------------- movement ---------------- */

  steer(dt, tx, ty, speed, game, opts = {}) {
    const a = Math.atan2(ty - this.y, tx - this.x);
    const accel = opts.accel ?? 7;
    // v1.0 — the chapel altar: light as refuge, not as wall. Everything inside
    // the circle moves like it is wading through the night itself. Stand in it
    // to breathe; it never makes you safe.
    const altar = game.mansion.chapelAltar;
    if (altar) {
      const ad = Math.hypot(this.x - altar.x, this.y - altar.y);
      if (ad < altar.r) speed *= lerp(0.45, 1, clamp((ad - altar.r * 0.3) / (altar.r * 0.7), 0, 1));
    }
    // gentle wall-following: nudge the desired angle if the last frame was blocked
    let ang = a;
    if (this.stuckT > 0.25) ang += Math.sin(game.time * 2.2 + this.id) * 0.9 * clamp(this.stuckT, 0, 1);
    const tvx = Math.cos(ang) * speed, tvy = Math.sin(ang) * speed;
    this.vx = damp(this.vx, tvx, accel, dt);
    this.vy = damp(this.vy, tvy, accel, dt);

    const px = this.x, py = this.y;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const res = game.mansion.resolve(nx, ny, this.radius, false);
    this.x = res.x; this.y = res.y;
    if (opts.avoid !== false) this.separate(game);

    // stuck detection
    const moved = dist(px, py, this.x, this.y);
    if (moved < speed * dt * 0.35) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);

    // face movement (or the player when attacking)
    const facing = opts.faceTarget === false ? Math.atan2(this.vy, this.vx) : Math.atan2(ty - this.y, tx - this.x);
    if (opts.faceTarget === false && Math.hypot(this.vx, this.vy) < 8) {
      // keep last angle
    } else {
      this.angle = approachAngle(this.angle, facing, dt * 7);
    }
    return moved;
  }

  separate(game) {
    for (const o of game.enemies) {
      if (o === this || o.dead) continue;
      const d2 = dist2(this.x, this.y, o.x, o.y);
      const rr = (this.radius + o.radius) * 1.15;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / d * 0.5;
        this.x += (this.x - o.x) * push;
        this.y += (this.y - o.y) * push;
      }
    }
    // stay out of the player's personal space floor when just walking
    if (this.state !== ESTATE.STRIKE && this.state !== ESTATE.HUNT) {
      const d = dist(this.x, this.y, game.player.x, game.player.y);
      if (d < 34 && d > 0.01) {
        this.x += (this.x - game.player.x) / d * (34 - d);
        this.y += (this.y - game.player.y) / d * (34 - d);
      }
    }
  }

  /* ---------------- perception ---------------- */

  perceive(dt, game) {
    const p = game.player;
    if (!p.alive) { this.seenPlayer = Math.max(0, this.seenPlayer - dt); return false; }
    const d = dist(this.x, this.y, p.x, p.y);
    let sees = false;
    const range = this.T.visionRange * (game.player.lowBlood ? 1.15 : 1) * (game.darknessVision ?? 1);
    if (d < range) {
      const sameRoom = this.roomId === game.mansion.findRoom(p.x, p.y);
      const los = game.mansion.hasLOS(this.x, this.y, p.x, p.y);
      // predators sense blood
      const smellRange = (this.key === 'werewolf' || this.key === 'ghoul') ? 300 : 150;
      if (los && (sameRoom || d < range * 0.6)) sees = true;
      else if (d < smellRange && game.player.lowBlood) sees = true;
      else if (d < smellRange * 0.6) sees = true;
    }
    if (sees) {
      this.seenPlayer = this.T.loseSight * (game.player.state === 'run' ? 1.25 : 1);
      this.lastKnown = { x: p.x, y: p.y };
      this.aggro = 1;
      return true;
    }
    this.seenPlayer = Math.max(0, this.seenPlayer - dt);
    if (this.seenPlayer <= 0) this.aggro = Math.max(0, this.aggro - dt * 0.4);
    return false;
  }

  /* ---------------- damage ---------------- */

  hurt(amount, game, fromX, fromY) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtFlash = 1;
    game.particles.burst('blood', this.x, this.y - 4, 6 + Math.round(amount / 8), {
      color: '#8a1020', speedMin: 20, speedMax: 110, lifeMin: 0.2, lifeMax: 0.6, sizeMin: 1.5, sizeMax: 3.5, angle: fromX !== undefined ? Math.atan2(this.y - fromY, this.x - fromX) : undefined, spread: 0.9,
    });
    game.decals.splat(this.x, this.y + 2, 8 + amount * 0.2, 'rgba(96,10,20,0.4)', 3);
    if (this.hp <= 0) this.die(game);
    else if (this.T.stagger) {
      this.staggerT = 0.25;
    }
    // being hit makes them realise where you are — even if they were leaving
    if (fromX !== undefined) { this.lastKnown = { x: fromX, y: fromY }; this.seenPlayer = Math.max(this.seenPlayer, this.T.loseSight * 0.7); }
    if (this.leaving) {
      this.leaving = false;
      this.insideTime = 0;
      this.state = ESTATE.HUNT;
      this.seenPlayer = Math.max(this.seenPlayer, this.T.loseSight);
    }
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    game.onEnemyKilled(this);
  }

  /* ---------------- update ---------------- */

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.alpha = Math.min(1, this.alpha + dt * (this.spawnGrace > 0 ? 2.5 : 1.4));
    this.spawnGrace = Math.max(0, this.spawnGrace - dt);
    this.roomId = game.mansion.findRoom(this.x, this.y);
    this.angle = this.angle;

    if (this.dead) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 6, dt); this.vy = damp(this.vy, 0, 6, dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.deathT > 1.5) this.removeMe = true;
      return;
    }

    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.vx = damp(this.vx, 0, 10, dt); this.vy = damp(this.vy, 0, 10, dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      return;
    }

    // ---- long-term pacing: they do not hunt forever ----
    if (this.insideHouse) this.insideTime = (this.insideTime || 0) + dt;
    else { this.insideTime = 0; this.leaving = false; }
    if (!this.leaving && this.insideHouse && this.insideTime > (this.T.leaveAfter || 45) &&
      game.time - (this.lastPlayerHitT ?? -99) > 16 && game.mood !== 'panic') {
      this.leaving = true;
      this.state = ESTATE.LEAVE;
      this.leavePath = null;
      this.leaveT = 0;
      game.onEnemyGivesUp(this);
    }
    if (this.leaving) { this.leaveStep(dt, game); return; }

    const sees = this.perceive(dt, game);
    this.speak(dt, game, sees);
    this.behave(dt, game, sees);
    this.postUpdate(dt, game);
  }

  /** Walk back out of the house and disappear into the dark. */
  leaveStep(dt, game) {
    if (!this.exitEntrance || this.exitEntrance.broken === false && this.exitEntrance.open === false) {
      const usable = game.mansion.entrances.filter((e) => e.broken || (e.kind === 'door' && e.open));
      this.exitEntrance = usable.length
        ? usable.reduce((a, b) => (dist(a.inside.x, a.inside.y, this.x, this.y) < dist(b.inside.x, b.inside.y, this.x, this.y) ? a : b))
        : game.mansion.entrances.reduce((a, b) => (dist(a.outside.x, a.outside.y, this.x, this.y) < dist(b.outside.x, b.outside.y, this.x, this.y) ? a : b));
    }
    const e = this.exitEntrance;
    const insideTarget = { x: e.inside.x, y: e.inside.y };
    const outsideTarget = { x: e.outside.x, y: e.outside.y };
    const dIn = dist(this.x, this.y, insideTarget.x, insideTarget.y);
    const dOut = dist(this.x, this.y, outsideTarget.x, outsideTarget.y);
    const dEnter = dist(this.x, this.y, e.inside.x, e.inside.y);
    if (dEnter < 70) {
      // step through the opening, collision-free, then dissolve into the dark
      this.exitT = (this.exitT || 0) + dt;
      const t = clamp(this.exitT / 0.7, 0, 1);
      this.x = lerp(e.inside.x, e.outside.x, t);
      this.y = lerp(e.inside.y, e.outside.y, t);
      this.vx = 0; this.vy = 0;
      this.alpha = Math.min(this.alpha, 1 - t * 0.5);
      if (t >= 1) { this.exitT = 0; this.exitDone = true; }
      return;
    }
    this.exitT = 0;
    // safety valve: if it genuinely cannot find a way out, it simply fades —
    // an enemy that lingers forever is just clutter
    this.leaveT = (this.leaveT || 0) + dt;
    if (this.leaveT > 14) { this.alpha -= dt * 0.5; if (this.alpha <= 0.02) this.removeMe = true; }
    if (this.exitDone) {
      this.alpha -= dt * 0.8;
      if (this.alpha <= 0.02) this.removeMe = true;
      return;
    }
    const sp = this.T.speed * this.speedMul;
    this.navTo(dt, game, insideTarget.x, insideTarget.y, sp, { accel: 5 });
    if (chance(dt * 0.6)) game.audio.playAt('footstep', this.x, this.y, game.renderer.cam, { vol: 0.35 });
  }

  speak(dt, game, sees) { /* overridden */ }
  behave(dt, game, sees) { /* overridden */ }
  postUpdate(dt, game) { /* overridden */ }

  /** Attack whatever entrance we're standing at. */
  breach(dt, game, e) {
    this.doorCd -= dt;
    const d = dist(this.x, this.y, e.outside.x, e.outside.y);
    if (d > 70) { this.state = ESTATE.APPROACH; return false; }
    // face the door
    this.angle = approachAngle(this.angle, Math.atan2(e.y - this.y, e.x - this.x), dt * 8);
    if (this.doorCd <= 0) {
      this.doorCd = this.T.doorAttackInterval * (e.kind === 'window' ? 1.15 : 1);
      const dmg = this.T.doorDamage * (e.kind === 'window' ? 0.75 : 1) * (1 + game.danger * 0.35);
      game.damageEntrance(e, dmg, this);
      this.attackAnim = 1;
    }
    // hold position near the door
    this.steer(dt, e.outside.x, e.outside.y, this.T.speed * 0.28, game, { accel: 5, faceTarget: false });
    if (e.broken || (e.kind === 'door' && e.open)) { this.state = ESTATE.CLIMB; this.climbT = 0; game.onEntranceOpened(e, this); }
    return true;
  }

  /** Cross the threshold. Slow for windows: that is the player's window of opportunity. */
  climb(dt, game, e) {
    this.climbT += dt;
    const need = e.kind === 'window' ? (this.key === 'crawler' ? 1.35 : 2.0) : ((this.key === 'werewolf' || this.key === 'ghoul') ? 1.0 : 0.75);
    const t = clamp(this.climbT / need, 0, 1);
    const from = e.outside, to = e.inside;
    this.x = lerp(from.x, to.x, t);
    this.y = lerp(from.y, to.y, t);
    this.angle = approachAngle(this.angle, Math.atan2(to.y - from.y, to.x - from.x), dt * 10);
    this.vx = 0; this.vy = 0;
    if (t >= 1) {
      this.state = ESTATE.HUNT;
      this.climbT = 0;
      if (chance(0.5)) game.audio.play((this.key === 'werewolf' || this.key === 'ghoul') ? 'snarl' : 'breath', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.5 });
      game.onEnemyEntered(this);
    }
  }

  /**
   * Route through the mansion grid and walk it. Recomputes only when the goal
   * has moved or the timer expired, so a whole mansion of enemies stays cheap.
   */
  navTo(dt, game, tx, ty, speed, opts = {}) {
    this.navCd = (this.navCd || 0) - dt;
    const moved = !this.navGoal || dist(this.navGoal.x, this.navGoal.y, tx, ty) > 120;
    if (this.navCd <= 0 || moved) {
      this.navCd = 0.55;
      this.navGoal = { x: tx, y: ty };
      this.navPts = game.mansion.navPath(this.x, this.y, tx, ty);
    }
    let wp = { x: tx, y: ty };
    if (this.navPts && this.navPts.length) {
      for (const node of this.navPts) {
        if (dist(this.x, this.y, node.x, node.y) > 34) { wp = node; break; }
      }
    }
    this.target = wp;
    this.stepToward(dt, game, wp.x, wp.y, speed, opts);
  }

  /**
   * One movement step toward a point that actually copes with geometry: slide
   * along walls, and when grinding to a halt, commit to a fresh sideways escape
   * instead of pushing into the same corner forever.
   */
  stepToward(dt, game, tx, ty, speed, opts = {}) {
    const px = this.x, py = this.y;
    this.escapeT = Math.max(0, (this.escapeT || 0) - dt);
    let desired = Math.atan2(ty - this.y, tx - this.x);
    if (this.escapeT > 0) desired = this.escapeA;
    else if (this.stuckT > 0.3) desired += Math.sin(game.time * 3.1 + this.id) * clamp(this.stuckT, 0, 1) * 1.1;
    const accel = opts.accel ?? 6.5;
    this.vx = damp(this.vx, Math.cos(desired) * speed, accel, dt);
    this.vy = damp(this.vy, Math.sin(desired) * speed, accel, dt);
    const res = game.mansion.resolve(this.x + this.vx * dt, this.y + this.vy * dt, this.radius, false);
    this.x = res.x; this.y = res.y;
    this.separate(game);
    const moved = dist(px, py, this.x, this.y);
    if (moved < speed * dt * 0.35) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 1.4 && this.escapeT <= 0) {
      this.escapeT = 0.8;
      this.escapeA = Math.atan2(ty - this.y, tx - this.x) + (chance(0.5) ? 1 : -1) * rand(1.0, 2.0);
      this.stuckT = 0.9;
      this.repickWp = true;
    }
    this.angle = approachAngle(this.angle, Math.atan2(this.vy, this.vx), dt * 7);
  }

  /** Remember a waypoint that keeps defeating us, so we try another one. */
  markBadWaypoint(wp, game) {
    if (!wp) return;
    this.badWps = (this.badWps || []).filter((b) => game.time < b.t);
    this.badWps.push({ x: wp.x, y: wp.y, t: game.time + 5 });
    if (this.badWps.length > 4) this.badWps.shift();
  }

  isBadWaypoint(node, game) {
    if (!this.badWps) return false;
    return this.badWps.some((b) => game.time < b.t && dist(b.x, b.y, node.x, node.y) < 44);
  }

  /**
   * Walk toward a point while outside the mansion, going around the building on
   * a ring of waypoints. Straight-line steering would just grind into the walls.
   */
  moveOutside(dt, game, tx, ty, mul = 1) {
    const speed = this.T.speed * this.speedMul * mul * (1 + game.danger * 0.1);
    const path = game.mansion.navPath(this.x, this.y, tx, ty);
    if (path && path.length) { this.navPts = path; this.navGoal = { x: tx, y: ty }; this.navCd = 0.55; }
    let wp = { x: tx, y: ty };
    if (this.navPts && this.navPts.length) {
      for (const node of this.navPts) {
        if (dist(this.x, this.y, node.x, node.y) > 34) { wp = node; break; }
      }
    }
    this.stepToward(dt, game, wp.x, wp.y, speed, { accel: 5 });
  }

  /** Standard "walk toward the current objective" step. */
  advance(dt, game) {
    const wp = this.nextWaypoint(game);
    const speed = this.T.speed * this.speedMul * (1 + game.danger * 0.16);
    this.steer(dt, wp.x, wp.y, speed, game);
  }

  /**
   * Get to the player's room. Inside the house this means walking through the
   * interior passages (the mansion graph), never back out of an entrance.
   */
  pursue(dt, game, mul = 1, target = null) {
    const p = game.player;
    const goal = target || (this.seenPlayer > 0 && this.lastKnown ? this.lastKnown : { x: p.x, y: p.y });
    const myRoom = this.roomId;
    const pRoom = game.mansion.findRoom(goal.x, goal.y);
    const hunting = this.seenPlayer > 0 || (this.insideHouse && game.mansion.findRoom(game.player.x, game.player.y) === this.roomId);
    const base = (hunting ? (this.T.huntSpeed ?? this.T.speed) : this.T.speed);
    const speed = base * this.speedMul * mul * (1 + game.danger * 0.12);
    this.navTo(dt, game, goal.x, goal.y, speed, { accel: 6 });
  }

  /** Can this enemy reach the player right now? (used to decide door bashing) */
  canReachPlayer(game) {
    return this.roomId === game.mansion.findRoom(game.player.x, game.player.y) && this.seenPlayer > 0;
  }

  wasHit(dt, game, x, y) {
    game.audio.play('hitFlesh', { x, y, cam: game.renderer.cam, vol: 0.7 });
  }
}

/* =====================================================================
 * CRAWLER
 * ===================================================================== */

export class Crawler extends Enemy {
  constructor(x, y, opts) { super('crawler', x, y, opts); this.lungeCd = rand(0.5, 2); this.screamCd = rand(6, 14); }

  speak(dt, game, sees) {
    this.screamCd -= dt;
    if (this.screamCd <= 0) {
      this.screamCd = rand(9, 20) / (1 + game.danger);
      if (dist(this.x, this.y, game.player.x, game.player.y) < 900 || this.insideHouse) {
        game.audio.play(this.type.speak, { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.5 });
      }
    }
  }

  behave(dt, game, sees) {
    const p = game.player;
    const e = this.entrance(game);
    switch (this.state) {
      case ESTATE.APPROACH: {
        if (this.insideHouse) {
          if (this.canReachPlayer(game)) { this.state = ESTATE.HUNT; break; }
          this.pursue(dt, game, 0.95);
          break;
        }
        if (e) {
          const target = (!e.broken && !(e.kind === 'door' && e.open)) ? e.outside : e.inside;
          this.wobble += dt * 7;
          this.moveOutside(dt, game, target.x, target.y, 1 + game.danger * 0.12);
          // jagged read: a little lateral twitch on top of the pathing
          this.x += Math.cos(this.angle + Math.PI / 2) * Math.sin(this.wobble) * 12 * dt;
          this.y += Math.sin(this.angle + Math.PI / 2) * Math.sin(this.wobble) * 12 * dt;
          if (dist(this.x, this.y, e.outside.x, e.outside.y) < 46 && !e.broken && !(e.kind === 'door' && e.open)) { this.state = ESTATE.BREACH; }
          else if (dist(this.x, this.y, e.inside.x, e.inside.y) < 40 && (e.broken || e.open)) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        } else this.advance(dt, game);
        break;
      }
      case ESTATE.BREACH: {
        const done = this.breach(dt, game, e);
        if (e && e.broken) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        if (!done) this.state = ESTATE.APPROACH;
        break;
      }
      case ESTATE.CLIMB: this.climb(dt, game, e); break;
      case ESTATE.HUNT: {
        if (this.seenPlayer <= 0) {
          this.state = ESTATE.SEARCH;
          this.searchT = 0;
          this.searchPt = this.lastKnown || { x: p.x, y: p.y };
          break;
        }
        const d = dist(this.x, this.y, p.x, p.y);
        const myRoom = this.roomId, pRoom = game.mansion.findRoom(p.x, p.y);
        if (myRoom !== pRoom && pRoom !== ROOM.OUTSIDE) {
          // lost in the house: run the graph, growling
          this.pursue(dt, game, 1.0);
          break;
        }
        this.lungeCd -= dt;
        if (d < this.type.attackRange + 6) {
          this.attackCd -= dt;
          if (this.attackCd <= 0) {
            this.attackCd = this.type.attackInterval;
            game.enemyHitPlayer(this, this.type.contactDamage, 'claw');
          }
          this.steer(dt, p.x, p.y, (this.type.huntSpeed ?? this.type.speed) * 0.35, game, { faceTarget: true });
        } else if (d < 150 && this.lungeCd <= 0) {
          // lunge
          this.lungeCd = rand(1.6, 3.2);
          this.leapT = 0.28;
          this.leapDir = Math.atan2(p.y - this.y, p.x - this.x);
          game.audio.play('snarl', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.4 });
        } else if (this.leapT > 0) {
          this.leapT -= dt;
          this.vx = Math.cos(this.leapDir) * 230; this.vy = Math.sin(this.leapDir) * 230;
          this.x += this.vx * dt; this.y += this.vy * dt;
          this.angle = this.leapDir;
          if (dist(this.x, this.y, p.x, p.y) < 26) { game.enemyHitPlayer(this, this.type.contactDamage * 0.8, 'claw'); this.leapT = 0; }
        } else {
          this.wobble += dt * 9;
          const ang = Math.atan2(p.y - this.y, p.x - this.x) + Math.sin(this.wobble) * 0.16;
          const hs = (this.type.huntSpeed ?? this.type.speed) * this.speedMul;
          this.vx = damp(this.vx, Math.cos(ang) * hs, 7, dt);
          this.vy = damp(this.vy, Math.sin(ang) * hs, 7, dt);
          const res = game.mansion.resolve(this.x + this.vx * dt, this.y + this.vy * dt, this.radius, false);
          this.x = res.x; this.y = res.y;
          this.separate(game);
          this.angle = approachAngle(this.angle, ang, dt * 9);
        }
        break;
      }
      case ESTATE.SEARCH: {
        this.searchT = (this.searchT || 0) + dt;
        const wp = this.searchPt;
        const d = dist(this.x, this.y, wp.x, wp.y);
        if (d > 50) this.pursue(dt, game, 0.8, wp);
        else {
          const a = game.time * 1.3 + this.id;
          this.pursue(dt, game, 0.55, { x: this.x + Math.cos(a) * 70, y: this.y + Math.sin(a * 1.3) * 70 });
        }
        if (this.seenPlayer > 0) this.state = ESTATE.HUNT;
        else if (this.searchT > 7) { this.state = ESTATE.APPROACH; this.pathT = 0; this.searchT = 0; this.searchPt = null; }
        break;
      }
      default: this.pursue(dt, game);
    }
  }

  postUpdate(dt, game) {
    // doors inside the house: if we're inside and the player is elsewhere, use the graph
    if (this.insideHouse && (this.state === ESTATE.HUNT || this.state === ESTATE.SEARCH)) {
      const pRoom = game.mansion.findRoom(game.player.x, game.player.y);
      if (this.roomId !== pRoom && this.seenPlayer <= 0 && this.searchT === undefined) {
        this.advance(dt, game);
      }
    }
    if (this.leapT > 0) this.leapT -= dt;
  }

  draw(ctx, game) {
    const t = game.time;
    const dying = this.dead;
    const k = dying ? clamp(this.deathT / 0.8, 0, 1) : 0;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.alpha;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 6, 13, 6, 0, 0, TAU); ctx.fill();
    ctx.rotate(visualAngle(this.angle, game.renderer.tilt));
    if (dying) { ctx.rotate(k * 1.2); ctx.translate(k * 4, 0); ctx.scale(1, 1 - k * 0.5); }

    const lurch = Math.sin(t * 12 + this.id) * 0.5 + 0.5;
    const limb = Math.sin(t * 14 + this.id) * 4;
    const body = '#0c0d12';
    const edge = 'rgba(120,132,158,0.20)';

    // four limbs, spider-ish, big elbows
    ctx.strokeStyle = body; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-2, s * 3);
      ctx.lineTo(-9 + limb * s * 0.5, s * 9);
      ctx.lineTo(3 + limb * 0.8, s * 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, s * 2);
      ctx.lineTo(9 + limb * 0.4, s * 7);
      ctx.stroke();
    }
    // hunched torso
    const g = ctx.createLinearGradient(-10, 0, 8, 0);
    g.addColorStop(0, '#07080c'); g.addColorStop(1, '#191b24');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-2, 0, 11, 8.5, 0, 0, TAU);
    ctx.fill();
    // spine ridge
    ctx.strokeStyle = 'rgba(150,160,190,0.13)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(-2, -2 - lurch, 7, 0); ctx.stroke();
    // head: jaw open too wide
    ctx.save();
    ctx.translate(9, 0);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, 6, 5, 0, 0, TAU); ctx.fill();
    const jaw = 0.5 + lurch * 0.5;
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(8, -1.5 - jaw * 3); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(8, 1.5 + jaw * 3); ctx.lineTo(2, 0); ctx.closePath(); ctx.fill();
    // teeth
    ctx.fillStyle = 'rgba(220,215,200,0.55)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(3.5 + i * 1.6, -2.2 - jaw * 1.5, 1, 1.8);
      ctx.fillRect(3.5 + i * 1.6, 0.4 + jaw * 1.5, 1, 1.8);
    }
    // eyes: two pale dots. Everything else is darkness.
    ctx.globalCompositeOperation = 'screen';
    const eyeGlow = 0.55 + 0.45 * Math.sin(t * 6 + this.id);
    for (const s of [-1, 1]) {
      const eg = ctx.createRadialGradient(1.5, s * 1.8, 0, 1.5, s * 1.8, 6);
      eg.addColorStop(0, `rgba(220,235,255,${0.85})`);
      eg.addColorStop(0.4, `rgba(120,170,220,${0.35 * eyeGlow})`);
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(1.5, s * 1.8, 6, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // rim light so the silhouette reads against the dark
    ctx.strokeStyle = edge; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(-2, 0, 11, 8.5, 0, -1.2, 1.2); ctx.stroke();

    if (this.hurtFlash > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = this.hurtFlash * 0.8;
      ctx.fillStyle = '#ff4050';
      ctx.beginPath(); ctx.ellipse(-2, 0, 14, 11, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (dying) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - (this.deathT - 0.7) / 0.8, 0, 1) * 0.6;
      ctx.fillStyle = '#6b0d18';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + 5, 18 + this.deathT * 8, 10 + this.deathT * 4, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

/* =====================================================================
 * HUNTER
 * ===================================================================== */

export class Hunter extends Enemy {
  constructor(x, y, opts) { super('hunter', x, y, opts); this.boltCd = rand(1.2, 3); this.meleeCd = 0; this.aimT = 0; this.lantern = 1; }

  speak(dt, game, sees) { }

  behave(dt, game, sees) {
    const p = game.player;
    const e = this.entrance(game);
    switch (this.state) {
      case ESTATE.APPROACH: {
        if (this.insideHouse) {
          if (this.canReachPlayer(game)) { this.state = ESTATE.STRIKE; break; }
          this.pursue(dt, game, 0.9);
          break;
        }
        if (e) {
          const target = (!e.broken && !(e.kind === 'door' && e.open)) ? e.outside : e.inside;
          const d = dist(this.x, this.y, target.x, target.y);
          if (d < 46 && !e.broken && !(e.kind === 'door' && e.open)) { this.state = ESTATE.BREACH; break; }
          if (!this.insideHouse) this.moveOutside(dt, game, target.x, target.y); else this.steer(dt, target.x, target.y, this.type.speed * this.speedMul, game);
          if (e.broken || (e.kind === 'door' && e.open)) {
            if (dist(this.x, this.y, e.inside.x, e.inside.y) < 44) { this.state = ESTATE.CLIMB; this.climbT = 0; }
          }
        } else this.pursue(dt, game, 0.9);
        break;
      }
      case ESTATE.BREACH: {
        // hunters are smart: they back off and shoot through the gap instead
        if (e && !e.broken) {
          this.doorCd -= dt;
          const d = dist(this.x, this.y, e.outside.x, e.outside.y);
          if (d > 150) {
            this.steer(dt, e.outside.x, e.outside.y, this.type.speed * this.speedMul, game);
          } else if (this.doorCd <= 0 && chance(0.35)) {
            // kick the door now and then
            this.doorCd = this.type.doorAttackInterval * 1.6;
            game.damageEntrance(e, this.type.doorDamage, this);
            this.attackAnim = 1;
          }
          // shoot at the player through a broken window/door
          const canShoot = game.mansion.hasLOS(this.x, this.y, p.x, p.y) || (e.kind === 'window' && e.broken);
          if (canShoot && dist(this.x, this.y, p.x, p.y) < this.type.attackRange) { this.state = ESTATE.STRIKE; this.aimT = 0; }
        } else if (e) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        break;
      }
      case ESTATE.CLIMB: this.climb(dt, game, e); break;
      case ESTATE.STRIKE: {
        const d = dist(this.x, this.y, p.x, p.y);
        this.boltCd -= dt;
        this.aimT += dt;
        // keep the distance it wants
        const want = this.type.keepDistance;
        const los = game.mansion.hasLOS(this.x, this.y, p.x, p.y);
        if (!los || !p.alive) { this.state = ESTATE.SEARCH; this.searchT = 0; this.searchPt = this.lastKnown || { x: p.x, y: p.y }; break; }
        if (d < this.type.retreatRange) {
          // back away
          const a = Math.atan2(this.y - p.y, this.x - p.x);
          this.steer(dt, this.x + Math.cos(a) * 100, this.y + Math.sin(a) * 100, this.type.speed * 1.05, game, { faceTarget: false });
          this.angle = approachAngle(this.angle, Math.atan2(p.y - this.y, p.x - this.x), dt * 8);
        } else if (d > want * 1.15) {
          this.steer(dt, p.x, p.y, this.type.speed * 0.8, game);
        } else {
          this.steer(dt, p.x, p.y, this.type.speed * 0.25, game);
        }
        // fire after an aim time — the tell is the lantern steadying
        if (this.boltCd <= 0 && this.aimT > 0.65 && d < this.type.attackRange) {
          this.boltCd = this.type.boltCooldown * (1 - game.danger * 0.25);
          this.aimT = 0;
          game.spawnBolt(this, Math.atan2(p.y - this.y - 2, p.x - this.x) + rand(-0.05, 0.05));
        }
        if (d < this.type.meleeRange) {
          this.meleeCd -= dt;
          if (this.meleeCd <= 0) { this.meleeCd = this.type.meleeCooldown; game.enemyHitPlayer(this, this.type.meleeDamage, 'stake'); }
        }
        if (this.seenPlayer <= 0) { this.state = ESTATE.SEARCH; this.searchT = 0; this.searchPt = this.lastKnown || { x: p.x, y: p.y }; }
        break;
      }
      case ESTATE.SEARCH: {
        this.searchT = (this.searchT || 0) + dt;
        const wp = this.searchPt || { x: p.x, y: p.y };
        if (dist(this.x, this.y, wp.x, wp.y) > 50) this.pursue(dt, game, 0.8, wp);
        else {
          const a = game.time * 0.8 + this.id;
          this.pursue(dt, game, 0.5, { x: this.x + Math.cos(a) * 80, y: this.y + Math.sin(a) * 80 });
        }
        if (this.seenPlayer > 0) this.state = ESTATE.STRIKE;
        else if (this.searchT > 7) { this.state = ESTATE.APPROACH; this.pathT = 0; }
        break;
      }
      default: this.advance(dt, game);
    }
  }

  postUpdate(dt, game) {
    if (!this.insideHouse && this.state === ESTATE.HUNT) this.state = ESTATE.APPROACH;
  }

  draw(ctx, game) {
    const t = game.time;
    const dying = this.dead;
    const k = dying ? clamp(this.deathT / 0.9, 0, 1) : 0;
    const aiming = this.state === ESTATE.STRIKE && this.boltCd < 0.55 && !dying;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, 7, 14, 7, 0, 0, TAU); ctx.fill();
    ctx.rotate(visualAngle(this.angle, game.renderer.tilt) + (dying ? k * 1.35 : 0));
    if (dying) { ctx.scale(1, 1 - k * 0.6); ctx.translate(k * 6, 0); }

    const walk = Math.sin(t * 7 + this.id) * (Math.hypot(this.vx, this.vy) > 20 ? 4 : 1.2);
    const coat = '#141821';
    const coatDark = '#0a0d14';
    const leather = '#2a2018';

    // long coat
    ctx.fillStyle = coatDark;
    ctx.beginPath();
    ctx.moveTo(-4, -6);
    ctx.quadraticCurveTo(-16, -9 + walk * 0.3, -22, -10 + walk * 0.6);
    ctx.lineTo(-22, 10 + walk * 0.6);
    ctx.quadraticCurveTo(-16, 9 - walk * 0.3, -4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 10, 8, 0, 0, TAU);
    ctx.fill();
    // legs
    ctx.strokeStyle = '#0d1017'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2, -3); ctx.lineTo(-2 + walk, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-2 - walk, 6); ctx.stroke();

    // lantern arm (gives the hunter away — and lights the fight)
    const lx = 8, ly = 9;
    ctx.strokeStyle = coat; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.fillStyle = '#1c2028';
    ctx.fillRect(lx - 4, ly - 1, 8, 10);
    if (!dying) {
      ctx.globalCompositeOperation = 'screen';
      const fl = 0.8 + 0.2 * Math.sin(t * 7.5 + this.id);
      const lg = ctx.createRadialGradient(lx, ly + 4, 0, lx, ly + 4, 13 * fl);
      lg.addColorStop(0, 'rgba(255,214,150,0.95)');
      lg.addColorStop(0.4, 'rgba(255,150,60,0.4)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ly + 4, 13 * fl, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // crossbow
    ctx.strokeStyle = leather; ctx.lineWidth = 3;
    const aimBack = aiming ? -2.5 : 0;
    ctx.save();
    ctx.translate(11 + aimBack, -4);
    ctx.rotate(aiming ? 0 : -0.5);
    ctx.fillStyle = '#2b2016';
    ctx.fillRect(-4, -1.6, 20, 3.2);
    ctx.strokeStyle = '#3d2f22'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, -7); ctx.quadraticCurveTo(15, 0, 12, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,215,200,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, -7); ctx.lineTo(4 + (aiming ? -2 : 0), 0); ctx.lineTo(12, 7); ctx.stroke();
    if (!aiming) { ctx.strokeStyle = '#6a5a44'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(16, 0); ctx.stroke(); }
    ctx.restore();

    // arms holding it
    ctx.strokeStyle = coat; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(9 + aimBack, -4); ctx.stroke();

    // head: wide brim hat, pale face in the dark
    ctx.save();
    ctx.translate(4, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.beginPath(); ctx.ellipse(0, 0, 6, 5.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = skinColor();
    ctx.beginPath(); ctx.ellipse(1.6, 0, 3.4, 3, 0, 0, TAU); ctx.fill();
    // hat
    ctx.fillStyle = '#0d0f14';
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 7.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#15181f';
    ctx.beginPath(); ctx.ellipse(-1.5, 0, 5, 5.5, 0, 0, TAU); ctx.fill();
    // hat brim highlight
    ctx.strokeStyle = 'rgba(150,160,185,0.18)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 7.5, 0, -0.8, 0.8); ctx.stroke();
    // eye glint
    if (!dying) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255,240,220,0.85)';
      ctx.beginPath(); ctx.arc(3.2, -1.3, 1.1, 0, TAU); ctx.arc(3.2, 1.3, 1.1, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // aiming tell: a thin laser-like sight line
    if (aiming) {
      const p = game.player;
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      const d = dist(this.x, this.y, p.x, p.y);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(255,80,90,${0.10 + 0.16 * Math.sin(t * 20)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(14 + Math.cos(a) * d * 0.98, Math.sin(a) * d * 0.98); ctx.stroke();
      ctx.restore();
    }

    if (this.hurtFlash > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = this.hurtFlash * 0.75;
      ctx.fillStyle = '#ff4050';
      ctx.beginPath(); ctx.ellipse(-1, 0, 15, 12, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (dying) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - (this.deathT - 0.8) / 0.9, 0, 1) * 0.55;
      ctx.fillStyle = '#6b0d18';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + 5, 20 + this.deathT * 6, 11 + this.deathT * 3, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  submitLight(renderer) {
    if (this.dead) return;
    const fl = 0.85 + 0.15 * Math.sin(performance.now() / 90 + this.id);
    renderer.addLight(this.x, this.y, 150 * fl, 0.5, [255, 190, 130]);
  }
}

function skinColor() { return '#cbbfae'; }

/* =====================================================================
 * WEREWOLF
 * ===================================================================== */

export class Werewolf extends Enemy {
  constructor(x, y, opts) {
    super('werewolf', x, y, opts);
    this.chargeCd = rand(3, 7);
    this.roarCd = rand(4, 9);
    this.charging = 0;
    this.windup = 0;
  }

  speak(dt, game, sees) {
    this.roarCd -= dt;
    if (this.roarCd <= 0) {
      this.roarCd = this.type.roarEvery * rand(0.7, 1.4);
      if (dist(this.x, this.y, game.player.x, game.player.y) < 1200) {
        game.audio.play('growl', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.65 });
        if (this.insideHouse) game.onWerewolfRoar(this);
      }
    }
  }

  behave(dt, game, sees) {
    const p = game.player;
    const e = this.entrance(game);
    switch (this.state) {
      case ESTATE.APPROACH: {
        if (this.insideHouse) {
          if (this.canReachPlayer(game)) { this.state = ESTATE.HUNT; break; }
          this.pursue(dt, game, 0.95);
          break;
        }
        if (e) {
          const blocked = !e.broken && !(e.kind === 'door' && e.open);
          const target = blocked ? e.outside : e.inside;
          if (!this.insideHouse) this.moveOutside(dt, game, target.x, target.y);
          else this.steer(dt, target.x, target.y, this.type.speed * this.speedMul, game, { accel: 3.4 });
          if (blocked && dist(this.x, this.y, e.outside.x, e.outside.y) < 52) this.state = ESTATE.BREACH;
          else if (!blocked && dist(this.x, this.y, e.inside.x, e.inside.y) < 46) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        } else this.advance(dt, game);
        break;
      }
      case ESTATE.BREACH: {
        this.doorCd -= dt;
        if (this.doorCd <= 0) {
          this.doorCd = this.type.doorAttackInterval;
          game.damageEntrance(e, this.type.doorDamage * (1 + game.danger * 0.3), this);
          this.attackAnim = 1;
          game.renderer.shake(0.35);
        }
        this.steer(dt, e.outside.x, e.outside.y, this.type.speed * 0.2, game, { accel: 4, faceTarget: false });
        if (e.broken) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        break;
      }
      case ESTATE.CLIMB: this.climb(dt, game, e); break;
      case ESTATE.WINDUP: {
        this.windup -= dt;
        this.vx = damp(this.vx, 0, 8, dt); this.vy = damp(this.vy, 0, 8, dt);
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.angle = approachAngle(this.angle, Math.atan2(p.y - this.y, p.x - this.x), dt * 5);
        if (this.windup <= 0) {
          this.charging = 0.75;
          this.chargeDir = this.angle;
          game.audio.play('snarl', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.8 });
          game.particles.burst('dust', this.x, this.y + 8, 12, { color: 'rgba(90,80,70,0.5)', sizeMin: 4, sizeMax: 12, speedMin: 20, speedMax: 90, lifeMin: 0.3, lifeMax: 0.7 });
        }
        break;
      }
      case ESTATE.CHARGE: {
        this.charging -= dt;
        this.vx = Math.cos(this.chargeDir) * this.type.chargeSpeed;
        this.vy = Math.sin(this.chargeDir) * this.type.chargeSpeed;
        const res = game.mansion.resolve(this.x + this.vx * dt, this.y + this.vy * dt, this.radius, false);
        // if the charge hits geometry, stun it briefly
        if (Math.abs(res.x - (this.x + this.vx * dt)) > 0.5 || Math.abs(res.y - (this.y + this.vy * dt)) > 0.5) {
          this.charging = 0;
          this.staggerT = 0.7;
          game.renderer.shake(0.4);
          game.audio.play('impact', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.6 });
        }
        this.x = res.x; this.y = res.y;
        for (const o of game.enemies) {
          if (o !== this && !o.dead && dist(this.x, this.y, o.x, o.y) < this.radius + o.radius) {
            o.hurt(6, game, this.x, this.y);
          }
        }
        if (dist(this.x, this.y, p.x, p.y) < this.radius + 20) {
          game.enemyHitPlayer(this, this.type.contactDamage, 'claw');
          this.charging = 0;
          this.chargeCd = this.type.chargeCooldown;
        }
        if (this.charging <= 0) { this.state = ESTATE.HUNT; this.chargeCd = this.type.chargeCooldown * rand(0.8, 1.2); }
        break;
      }
      case ESTATE.HUNT: {
        if (this.seenPlayer <= 0) { this.state = ESTATE.SEARCH; this.searchT = 0; this.searchPt = this.lastKnown || { x: p.x, y: p.y }; break; }
        const myRoom = this.roomId, pRoom = game.mansion.findRoom(p.x, p.y);
        if (myRoom !== pRoom && pRoom !== ROOM.OUTSIDE) { this.pursue(dt, game, 0.95); break; }
        const d = dist(this.x, this.y, p.x, p.y);
        this.chargeCd -= dt;
        if (this.chargeCd <= 0 && d < this.type.chargeRange && d > 90) {
          this.state = ESTATE.WINDUP; this.windup = 0.55;
          game.audio.play('growl', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.5 });
          break;
        }
        if (d < this.type.attackRange + 8) {
          this.attackCd -= dt;
          if (this.attackCd <= 0) {
            this.attackCd = this.type.attackInterval;
            game.enemyHitPlayer(this, this.type.contactDamage, 'claw');
            game.renderer.shake(0.5);
          }
          this.steer(dt, p.x, p.y, this.type.speed * 0.35, game);
        } else {
          this.steer(dt, p.x, p.y, (this.type.huntSpeed ?? this.type.speed) * this.speedMul, game, { accel: 3.6 });
        }
        break;
      }
      case ESTATE.SEARCH: {
        this.searchT = (this.searchT || 0) + dt;
        const wp = this.searchPt || { x: p.x, y: p.y };
        if (dist(this.x, this.y, wp.x, wp.y) > 50) this.pursue(dt, game, 0.8, wp);
        else this.pursue(dt, game, 0.45, { x: this.x + Math.cos(game.time + this.id) * 70, y: this.y + Math.sin(game.time * 0.8 + this.id) * 70 });
        if (this.seenPlayer > 0) this.state = ESTATE.HUNT;
        else if (this.searchT > 9) { this.state = ESTATE.APPROACH; this.pathT = 0; }
        break;
      }
      default: this.advance(dt, game);
    }
  }

  draw(ctx, game) {
    const t = game.time;
    const dying = this.dead;
    const k = dying ? clamp(this.deathT / 1.3, 0, 1) : 0;
    const charging = this.state === ESTATE.CHARGE;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.ellipse(0, 12, 26, 12, 0, 0, TAU); ctx.fill();
    ctx.rotate(visualAngle(this.angle, game.renderer.tilt) + (dying ? k * 1.2 : 0));
    if (dying) { ctx.rotate(k * 0.5); ctx.translate(k * 6, 0); ctx.scale(1, 1 - k * 0.55); }

    const stride = Math.sin(t * (charging ? 18 : 7) + this.id) * (Math.hypot(this.vx, this.vy) > 20 ? 6 : 1.5);
    const fur = '#0e0f13';
    const furEdge = 'rgba(130,120,150,0.16)';

    // hind legs
    ctx.strokeStyle = '#0a0b0f'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-12, -9); ctx.lineTo(-22, -13 + stride); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-12, 9); ctx.lineTo(-22, 13 - stride); ctx.stroke();
    // body
    const bg = ctx.createLinearGradient(-24, 0, 16, 0);
    bg.addColorStop(0, '#07080b'); bg.addColorStop(0.7, '#131520'); bg.addColorStop(1, '#1b1e2b');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(-4, 0, 24, 15, 0, 0, TAU);
    ctx.fill();
    // hunched spine
    ctx.fillStyle = '#0a0b10';
    ctx.beginPath();
    ctx.moveTo(-26, -6);
    ctx.quadraticCurveTo(-6, -20 - (this.state === ESTATE.WINDUP ? 6 : 0), 18, -8);
    ctx.quadraticCurveTo(-6, -6, -26, 6);
    ctx.closePath();
    ctx.fill();
    // shoulder spikes
    ctx.strokeStyle = 'rgba(170,165,180,0.20)'; ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-6 + i * 6, -8 - Math.abs(i) * 1.2);
      ctx.lineTo(-9 + i * 6, -16 - Math.abs(i) * 2);
      ctx.stroke();
    }
    // forelimbs with claws
    ctx.strokeStyle = '#0d0e13'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(8, -10); ctx.lineTo(20, -13 + stride * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(20, 13 - stride * 0.8); ctx.stroke();
    ctx.strokeStyle = 'rgba(215,210,195,0.5)'; ctx.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(20, s * 13);
        ctx.lineTo(26 + i * 1.5, s * (15 + i * 2));
        ctx.stroke();
      }
    }
    // head: long jaw, too many teeth
    ctx.save();
    ctx.translate(20, 0);
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 10, 0, 0, TAU); ctx.fill();
    // muzzle
    ctx.fillStyle = '#0b0c11';
    ctx.beginPath();
    ctx.moveTo(6, -5); ctx.quadraticCurveTo(20, 0, 6, 5); ctx.quadraticCurveTo(10, 0, 6, -5);
    ctx.fill();
    // teeth
    ctx.fillStyle = 'rgba(225,220,205,0.65)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(7 + i * 2.4, -3.4 + i * 0.5);
      ctx.lineTo(9 + i * 2.4, -1.2 + i * 0.6);
      ctx.lineTo(7.4 + i * 2.4, -0.4 + i * 0.6);
      ctx.closePath(); ctx.fill();
    }
    // ears
    ctx.fillStyle = '#0a0b10';
    ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-6, -18); ctx.lineTo(3, -9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2, 8); ctx.lineTo(-6, 18); ctx.lineTo(3, 9); ctx.closePath(); ctx.fill();
    // eyes
    if (!dying) {
      ctx.globalCompositeOperation = 'screen';
      const glow = charging ? 1.3 : 1;
      for (const s of [-1, 1]) {
        const eg = ctx.createRadialGradient(3, s * 4, 0, 3, s * 4, 7 * glow);
        eg.addColorStop(0, `rgba(255,190,80,${0.95})`);
        eg.addColorStop(0.3, `rgba(220,110,20,${0.5 * glow})`);
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(3, s * 4, 7 * glow, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // rim light
    ctx.strokeStyle = furEdge; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(-4, 0, 24, 15, 0, -1.1, 1.1); ctx.stroke();

    if (this.state === ESTATE.WINDUP) {
      // telegraph: red glow gathering at the claws
      ctx.globalCompositeOperation = 'screen';
      const a = 0.35 + 0.35 * Math.sin(t * 30);
      for (const s of [-1, 1]) {
        const g = ctx.createRadialGradient(22, s * 13, 0, 22, s * 13, 18);
        g.addColorStop(0, `rgba(255,60,60,${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(22, s * 13, 18, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.hurtFlash > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = this.hurtFlash * 0.6;
      ctx.fillStyle = '#ff4050';
      ctx.beginPath(); ctx.ellipse(-4, 0, 28, 18, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // damage read-out without a health bar: it visibly bleeds and slows
    if (!dying && this.hp < this.hpMax * 0.6) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - this.hp / this.hpMax, 0, 1) * 0.5;
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 40);
      g.addColorStop(0, 'rgba(140,20,30,0)');
      g.addColorStop(1, 'rgba(160,16,26,0.7)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, 40, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

/* =====================================================================
 * CROSSBOW BOLT
 * ===================================================================== */

/* ---------------- STALKER (v1.0) ----------------
 * The attention predator. It only moves while it is outside what the player
 * is watching — the cone of her aim, her own carried light. Face it and it
 * freezes mid-stride with the unsettling composure of something that has all
 * the time in the world. Turn away and it closes. It never attacks a door;
 * it waits for one to open, or blinks between dark corners when unseen.
 * Designed to be survived, not killed; damage on a brush-past only.
 */
export class Stalker extends Enemy {
  constructor(x, y, opts) {
    super('stalker', x, y, opts);
    this.blinkCd = this.type.blinkCd ?? 7;
    this.waitT = 0;
    this.frozen = 0;
    this.stalkBeat = rand(2, 5);
  }

  watchedBy(game) {
    const p = game.player;
    const d = dist(this.x, this.y, p.x, p.y);
    if (d > 460 || p.state === 'death') return false;
    if (!game.mansion.hasLOS(p.x, p.y, this.x, this.y)) return false;
    const toIt = Math.atan2(this.y - p.y, this.x - p.x);
    const off = Math.abs(angDiff(toIt, p.angle));
    if (off < 0.85) return true;
    // her own carried light counts: it cannot move inside the moon she wears
    const lightR = (p.lightR ?? 150) * 0.85;
    return d < lightR;
  }

  speak(dt, game) {
    this.stalkBeat -= dt;
    if (this.stalkBeat <= 0) {
      this.stalkBeat = rand(2.6, 6.5);
      const d = dist(this.x, this.y, game.player.x, game.player.y);
      if (d < 900) game.audio.play('breath', { x: this.x, y: this.y, cam: game.renderer.cam, vol: clamp(0.5 - d / 2400, 0.12, 0.5) });
    }
  }

  blink(game) {
    // vanish to a dark spot across the room — only ever when unseen
    const p = game.player;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const r = rand(230, 430);
      const nx = p.x + Math.cos(a) * r, ny = p.y + Math.sin(a) * r;
      if (game.mansion.solidAt(nx, ny)) continue;
      if (game.mansion.hasLOS(p.x, p.y, nx, ny)) {
        const toIt = Math.atan2(ny - p.y, nx - p.x);
        if (Math.abs(angDiff(toIt, p.angle)) < 1.1 && dist(nx, ny, p.x, p.y) < 460) continue;   // would land in view
      }
      game.particles.burst('mist', this.x, this.y, 7, { color: 'rgba(90,80,120,0.14)', sizeMin: 9, sizeMax: 20, speedMin: 6, speedMax: 34, lifeMin: 0.3, lifeMax: 0.8 });
      this.x = nx; this.y = ny;
      game.audio.play('draft', { vol: 0.10, x: nx, y: ny, cam: game.renderer.cam });
      this.path = []; this.pathT = 0;
      return;
    }
  }

  behave(dt, game, sees) {
    const p = game.player;
    const e = this.entrance(game);
    const watched = this.watchedBy(game);
    this.frozen = watched ? Math.min(1, this.frozen + dt * 8) : Math.max(0, this.frozen - dt * 5);

    if (watched) {
      // the freeze: dead stop, no tremble — the stillness IS the tell
      this.vx = damp(this.vx, 0, 16, dt); this.vy = damp(this.vy, 0, 16, dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.angle = Math.atan2(p.y - this.y, p.x - this.x);
      return;
    }
    this.blinkCd -= dt;
    if (this.blinkCd <= 0 && this.insideHouse && this.state === ESTATE.HUNT && dist(this.x, this.y, p.x, p.y) > 320) {
      this.blinkCd = this.type.blinkCd ?? 7;
      this.blink(game);
    }

    switch (this.state) {
      case ESTATE.APPROACH: {
        if (this.insideHouse) { if (this.canReachPlayer(game)) { this.state = ESTATE.HUNT; break; } this.pursue(dt, game, 1); break; }
        if (e) {
          const closedDoor = e.kind === 'door' && !e.open && !e.broken;
          const intactWindow = e.kind === 'window' && !e.broken;
          if (closedDoor || intactWindow) {
            // it does not knock. it waits beside the wood, which is worse.
            this.waitT += dt;
            this.moveOutside(dt, game, e.outside.x, e.outside.y, 0.6);
            const leaveAt = game.difficulty.spawn < 1 ? 42 : 30;
            if (this.waitT > leaveAt) { this.leaving = true; game.onEnemyGivesUp(this); }
            break;
          }
          const target = (e.broken || (e.kind === 'door' && e.open)) ? e.inside : e.outside;
          this.moveOutside(dt, game, target.x, target.y, 0.85);
          if (dist(this.x, this.y, e.inside.x, e.inside.y) < 46) { this.state = ESTATE.CLIMB; this.climbT = 0; }
        } else this.advance(dt, game);
        break;
      }
      case ESTATE.BREACH: this.state = ESTATE.APPROACH; break;   // it never breaks anything
      case ESTATE.CLIMB: this.climb(dt, game, e); break;
      case ESTATE.HUNT: {
        const d = dist(this.x, this.y, p.x, p.y);
        if (this.seenPlayer <= 0 && d > 90) { this.pursue(dt, game, 1); break; }
        // stalk pace: fast until close, then a walk you hear before you see
        this.pursue(dt, game, d < 150 ? 0.62 : 1);
        if (d < this.type.attackRange && this.attackCd <= 0) {
          this.attackCd = this.type.attackInterval;
          game.enemyHitPlayer(this, this.type.contactDamage, 'claw');
          game.audio.play('snarl', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.5 });
          this.blinkCd = 2.2;   // after it touches you it is somewhere else soon
        }
        break;
      }
      case ESTATE.SEARCH: {
        this.pursue(dt, game, 0.8);
        if (this.seenPlayer > 0) this.state = ESTATE.HUNT;
        break;
      }
      default: this.advance(dt, game);
    }
    this.attackCd -= dt;
    this.speak(dt, game);
  }

  draw(ctx, game) {
    const t = game.time;
    const frozen = this.frozen;
    const walking = (1 - frozen) * (Math.hypot(this.vx, this.vy) > 16 ? 1 : 0.2);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.alpha * (frozen > 0.5 ? 0.92 : 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, 10, 12, 6, 0, 0, TAU); ctx.fill();
    const sway = Math.sin(t * 6) * 3 * walking;
    // the coat: too long for the body inside it
    ctx.fillStyle = '#0a0a10';
    ctx.beginPath();
    ctx.moveTo(-7, 12); ctx.quadraticCurveTo(-11, -8 + sway * 0.4, -5, -22);
    ctx.lineTo(5, -22); ctx.quadraticCurveTo(11, -8 - sway * 0.4, 7, 12);
    ctx.closePath(); ctx.fill();
    // too-long arms, always slightly out of tune with the walk
    ctx.strokeStyle = '#0d0d14'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, -14); ctx.quadraticCurveTo(-13 + sway, -4, -11 - sway, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, -14); ctx.quadraticCurveTo(13 - sway, -6, -sway, 12); ctx.stroke();
    // head: no face, just the memory of one — a pale tilt toward you
    ctx.fillStyle = '#c9c2b4';
    ctx.beginPath(); ctx.ellipse(0, -26 + sway * 0.2, 4.6, 5.6, frozen > 0.5 ? 0 : sway * 0.03, 0, TAU); ctx.fill();
    if (frozen < 0.4) {
      // only moving stalkers show eyes — the freeze has nothing to see you with
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(200,60,50,0.75)';
      ctx.fillRect(-2.4, -27, 1.6, 1.2); ctx.fillRect(1.0, -27, 1.6, 1.2);
    }
    ctx.restore();
  }
}

/* ---------------- GHOUL (v1.0) ----------------
 * The werewolf's gaunt cousin: half the mass, twice the appetite for wood.
 * Built on the wolf's machine with its own stats (see ENEMY_TYPES.ghoul) and
 * a thinner, hungrier draw. Its purpose in the night: when doors are being
 * defended everywhere, one gets eaten while nobody is looking.
 */
export class Ghoul extends Werewolf {
  constructor(x, y, opts) {
    super(x, y, opts);
    this.type = ENEMY_TYPES.ghoul;
    this.key = 'ghoul';
    this.radius = this.type.radius;
    this.hp = this.type.hp * (opts.hpMul ?? 1);
    this.hpMax = this.hp;
    this.chargeCd = 1e9;           // no charge — it just chews
  }

  draw(ctx, game) {
    // reuse the wolf's shape pass with a starving silhouette: narrower, taller
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(0.82, 1.12);
    ctx.translate(-this.x, -this.y);
    super.draw(ctx, game);
    ctx.restore();
    // hunger shimmer: ribs catch a light the wolf never shows
    if (!this.dead && this.alpha > 0.4) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = this.alpha * 0.16;
      ctx.strokeStyle = this.tint || '#8f86b8';
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + i * 4, 12, 5, 0, -1.1, 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------------- variants (v1.0) ----------------
 * Multipliers + a palette hint only — no new behaviour, no new art pipeline.
 * The director rolls them on established enemies in the harder phases so the
 * late night never repeats the shape of the early one.
 */
export function applyVariant(e, name) {
  const V = VARIANTS[name];
  if (!V || !e) return e;
  e.variant = name;
  if (V.hpMul) { e.hpMax *= V.hpMul; e.hp = e.hpMax; }
  if (V.speedMul) e.speedMul *= V.speedMul;
  if (V.damageMul) e.damageMul *= V.damageMul;
  if (V.keepAdd) e.type = { ...e.type, keepDistance: (e.type.keepDistance || 0) + V.keepAdd, boltCooldown: (e.type.boltCooldown || 2) * (V.boltCdMul || 1) };
  e.tint = V.tint || null;
  return e;
}

export class Bolt {
  constructor(x, y, angle, speed, damage, owner) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
    this.damage = damage;
    this.owner = owner;
    this.dead = false;
    this.trail = [];
  }
  update(dt, game) {
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const sdt = dt / steps;
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;
      if (this.dead) return;
      // wall / door
      const e = game.mansion.entrances.find((en) =>
        Math.abs(this.x - en.x) < en.w / 2 + 3 && Math.abs(this.y - en.y) < en.h / 2 + 3);
      if (e && !(e.kind === 'door' && (e.open || e.broken)) && !(e.kind === 'window' && e.broken)) {
        this.hit(game, true);
        return;
      }
      const s = game.mansion.solidAt(this.x, this.y);
      if (s) { this.hit(game, true); return; }
      const p = game.player;
      if (p.alive && dist(this.x, this.y, p.x, p.y) < p.radius + 5) {
        if (p.takeDamage(this.damage, game, this.x - Math.cos(this.angle) * 40, this.y - Math.sin(this.angle) * 40, 'bolt')) {
          this.hit(game, false);
          game.showCombatText('BOLT', p.x, p.y, '#ff8080');
        }
        return;
      }
      for (const o of game.enemies) {
        if (o !== this.owner && !o.dead && dist(this.x, this.y, o.x, o.y) < o.radius + 4 && o.key !== 'hunter') {
          o.hurt(this.damage * 0.5, game, this.x, this.y);
          this.hit(game, false);
          return;
        }
      }
    }
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.shift();
  }
  hit(game, wall) {
    this.dead = true;
    game.audio.play(wall ? 'boltImpact' : 'hitFlesh', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.7 });
    game.particles.burst('spark', this.x, this.y, 6, { color: 'rgba(220,220,240,0.8)', sizeMin: 1, sizeMax: 2.5, speedMin: 20, speedMax: 90, lifeMin: 0.1, lifeMax: 0.3, glow: true });
    if (wall) game.decals.splat(this.x, this.y, 3, 'rgba(30,30,40,0.35)', 2);
  }
  draw(ctx, game) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(200,200,220,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.translate(this.x, this.y);
    ctx.rotate(visualAngle(this.angle, game && game.renderer ? game.renderer.tilt : 1));
    ctx.fillStyle = '#2b2016';
    ctx.fillRect(-7, -1.2, 14, 2.4);
    ctx.fillStyle = '#c8c8d4';
    ctx.beginPath(); ctx.moveTo(7, -2.4); ctx.lineTo(12, 0); ctx.lineTo(7, 2.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(-7, -3.4, 3, 6.8);
    ctx.restore();
  }
}
