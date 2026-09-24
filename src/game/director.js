/* LAST NIGHT — the tension director
 *
 * The single most important system in the game. It owns pacing.
 *
 * It never spawns "every N seconds". Instead it runs a *pressure budget*:
 * budget regenerates slowly, a wave spends it, and after the wave the director
 * deliberately does nothing for a while so the player can breathe. Relief is
 * what makes the next wave frightening.
 *
 * The mood machine below is the emotional curve of the whole night:
 *   calm -> curious -> uneasy -> alert -> pressured -> panic -> relief
 */

import {
  clamp, lerp, damp, rand, randInt, chance, pick, shuffle, dist, fmtClock,
} from '../core/util.js';
import {
  PHASES, phaseAt, nextPhase, BEATS, DIRECTOR, KNOCKS, NIGHT_DURATION, nightHeat,
  SPAWN_WARMUP, PANIC_AT, SILENCE_AT, COUNTDOWN_AT, ENEMY_TYPES, TUNING,
} from '../core/config.js';
import { Crawler, Hunter, Werewolf, Stalker, Ghoul, Zombie, applyVariant } from './enemies.js';
import { ROOM } from './mansion.js';

export const MOOD = {
  CALM: 'calm', CURIOUS: 'curious', UNEASY: 'uneasy', ALERT: 'alert',
  PRESSURED: 'pressured', PANIC: 'panic', RELIEF: 'relief',
};

const MOOD_ORDER = [MOOD.CALM, MOOD.CURIOUS, MOOD.UNEASY, MOOD.ALERT, MOOD.PRESSURED, MOOD.PANIC];

export class Director {
  constructor() {
    this.beatIndex = 0;
    this.budget = 1.2;
    this.mood = MOOD.CALM;
    this.moodT = 0;
    this.quietUntil = 0;
    this.waveCount = 0;
    this.lastWaveT = -99;
    this.lastSpawnEntrance = null;
    this.spawnEntranceCd = new Map();
    this.knock = null;
    this.lastKnock = -99;
    this.lastKnockDoor = null;
    this.behindYouCount = 0;
    this.lastBehindYou = -99;
    this.lastBlackout = -60;
    this.blackoutPlanned = 0;
    this.lastLightning = 0;
    this.lightningAt = 0;
    this.lightningPower = 0;
    this.pendingThunder = 0;
    this.lastAmbient = 0;
    this.reliefT = 0;
    this.pressure = 0;
    this.waveRegen = 1;
    this.chandelierFell = false;
    this.spawnedThisNight = 0;
    this.wasEnemyCount = 0;
    this.lastKillT = -99;
    this.threat = 0;         // smoothed measure of how much is currently happening
    this.beatsFired = {};
    this.shadow = null;
    this.lastEventText = '';
    this.lastEventT = -99;
    this.intensityCurve = [];
    this.moodsSeen = [];
  }

  /* ================= main update ================= */

  update(dt, game) {
    const t = game.time;
    // ---- mood ----
    this.updateMood(dt, game);
    // ---- scripted beats ----
    while (this.beatIndex < BEATS.length && t >= BEATS[this.beatIndex].t) {
      this.fireBeat(BEATS[this.beatIndex], game);
      this.beatIndex++;
    }
    // ---- budget & waves ----
    this.updateBudget(dt, game);
    // ---- knock resolution ----
    this.updateKnock(dt, game);
    // ---- random atmospheric events ----
    this.updateEvents(dt, game);
    // ---- danger/threat signals ----
    this.updateThreat(dt, game);
    // ---- audio ----
    this.updateAudioState(dt, game);
    // ---- countdown ----
    this.updateCountdown(dt, game);
  }

  updateMood(dt, game) {
    const t = game.time;
    const phase = game.phase;
    // ---- desired tension level from the timeline ----
    let want = MOOD.CALM;
    if (phase.id === 'warning') want = MOOD.CURIOUS;
    else if (phase.id === 'pressure') want = MOOD.UNEASY;
    else if (phase.id === 'heavy') want = MOOD.ALERT;
    else if (phase.id === 'final') want = MOOD.PRESSURED;
    else if (phase.id === 'panic' || phase.id === 'silence') want = MOOD.PANIC;

    // ---- ...raised by what is actually happening right now ----
    const alive = game.enemies.filter((e) => !e.dead && e.insideHouse).length;
    const anyBroken = game.mansion.entrances.some((e) => e.broken);
    const playerBlood = game.player.bloodPct;
    const chased = game.enemies.some((e) => !e.dead && e.seenPlayer > 0 && dist(e.x, e.y, game.player.x, game.player.y) < 460);

    let wantIdx = MOOD_ORDER.indexOf(want);
    const raise = (idx) => { wantIdx = Math.max(wantIdx, idx); };
    if (alive >= 2 || anyBroken) raise(MOOD_ORDER.indexOf(MOOD.ALERT));
    if (alive >= 3 || (anyBroken && alive >= 2) || chased) raise(MOOD_ORDER.indexOf(MOOD.PRESSURED));
    if (alive >= 5 || (chased && alive >= 3) || (playerBlood < 0.2 && alive >= 2)) raise(MOOD_ORDER.indexOf(MOOD.PANIC));
    if (phase.id === 'panic') wantIdx = MOOD_ORDER.indexOf(MOOD.PANIC);

    // ---- relief: nothing alive, the wave is over, we are inside the quiet window ----
    let relief = false;
    const nearbyThreat = game.enemies.some((e) => !e.dead && dist(e.x, e.y, game.player.x, game.player.y) < 520);
    if (alive <= 1 && !nearbyThreat && this.waveCount > 0 && t > this.lastWaveT + 3 && t > this.quietUntil - 20 && t < this.quietUntil + 30 && phase.id !== 'panic') {
      this.reliefT += dt;
      if (this.reliefT > 0.8) relief = true;
    } else this.reliefT = 0;

    const curIdx = this.mood === MOOD.RELIEF ? -1 : MOOD_ORDER.indexOf(this.mood);
    const wantFinal = relief ? -1 : wantIdx;

    if (wantFinal === curIdx) { this.moodT = 0; return; }
    if (wantFinal > curIdx) {
      // tension rises instantly
      this.pendingMood = null;
      this.mood = wantFinal < 0 ? MOOD.RELIEF : MOOD_ORDER[wantFinal];
      this.moodT = 0;
      if (game.onMoodChange) game.onMoodChange(this.mood);
      return;
    }
    // ...and falls slowly, with hysteresis, so it never flaps
    this.moodT += dt;
    if (this.pendingMood !== wantFinal) { this.pendingMood = wantFinal; this.moodT = 0; }
    if (this.moodT > 2.6) {
      this.mood = wantFinal < 0 ? MOOD.RELIEF : MOOD_ORDER[wantFinal];
      this.moodT = 0;
      this.pendingMood = null;
      if (game.onMoodChange) game.onMoodChange(this.mood);
    }
  }

  updateThreat(dt, game) {
    const p = game.player;
    let near = 0;
    let nearest = 9999;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      nearest = Math.min(nearest, d);
      if (d < 520) near += 1 - d / 520;
    }
    const raw = clamp(near * 0.45 + (nearest < 200 ? 0.4 : 0) + game.danger * 0.4, 0, 1.4);
    this.threat = damp(this.threat, raw, 1.6, dt);
    game.threat = this.threat;
    game.nearestEnemy = nearest;
    game.enemiesNear = near;
  }

  /* ================= spawn budget ================= */

  updateBudget(dt, game) {
    const t = game.time;
    if (t < SPAWN_WARMUP) { this.budget = Math.min(this.budget, 0.6); return; }
    const d = game.difficulty;
    const heat = nightHeat(game.save && game.save.nightsSurvived);
    const regen = lerp(DIRECTOR.budgetRegen[0], DIRECTOR.budgetRegen[1], game.danger) * this.waveRegen * d.spawn * heat;
    this.budget = Math.min(DIRECTOR.budgetMax * Math.min(heat, 2.2), this.budget + regen * dt);

    const alive = game.enemies.filter((e) => !e.dead).length;
    const maxAlive = Math.min(14, Math.round(lerp(DIRECTOR.maxAlive[0], DIRECTOR.maxAlive[1], game.danger) * Math.max(0.8, d.spawn) * heat));
    // BREATHING. The curve needs contrast: without quiet stretches, pressure
    // stops reading as pressure at all. Whenever the house is empty, buy the
    // player a genuine lull — shorter as the night gets late.
    // only enemies that actually got inside count as pressure: a hunter waiting
    // out in the dark must not keep the mansion permanently tense
    const insideNow = game.enemies.filter((e) => !e.dead && e.insideHouse).length;
    if (insideNow === 0 && this.waveCount > 0 && t > this.quietUntil) {
      const breath = lerp(DIRECTOR.breath[0], DIRECTOR.breath[1], game.danger);
      this.quietUntil = t + breath;
    }
    const quiet = t < this.quietUntil;
    // v1.0 — the stalker owns the quiet. Pressure waves never carry it; being
    // unbothered is what it hunts. One per long while, on its own schedule.
    this.stalkerCd = (this.stalkerCd ?? 40) - dt;
    if (quiet && !TUNING.noSpawns && this.stalkerCd <= 0 && t > 95 && game.danger > 0.12 && game.danger < 0.72
        && !game.enemies.some((x) => x.key === 'stalker' && !x.dead)) {
      this.stalkerCd = rand(55, 95);
      const sEnt = game.mansion.entrances[(rand(0, game.mansion.entrances.length)) | 0];
      this.spawnWave(game, ['stalker'], { entranceId: sEnt ? sEnt.id : undefined });
      game.showMessage('THE QUIET GREW A SECOND SET OF FOOTSTEPS.', { tone: 'cold', whisper: true, life: 4.5 });
    }
    const tooSoon = t - this.lastWaveT < lerp(DIRECTOR.waveGap[1], DIRECTOR.waveGap[0], game.danger) / Math.min(heat, 1.8);
    const wavesReady = !quiet && (!tooSoon || game.danger > 0.75);
    if (TUNING.noSpawns) return;
    if (wavesReady && alive < maxAlive && this.budget > 1.0) {
      this.launchWave(game);
    }
  }

  /** Compose and spawn a wave from the current budget. */
  launchWave(game, forced = null) {
    const d = game.danger;
    const phase = game.phase;
    const picks = [];
    if (forced) picks.push(...forced);
    else {
      let budgetLeft = this.budget;
      // the type mix opens up as the night goes on
      const pool = [];
      pool.push({ k: 'crawler', w: 4 });
      pool.push({ k: 'zombie', w: 5.5 });
      if (game.time > 110) pool.push({ k: 'hunter', w: 2.4 });
      if (game.time > 170) pool.push({ k: 'werewolf', w: 0.55 + d * 0.8 });
      // v1.0: the ghoul comes when the doors matter; the pack answers the panic
      if (game.time > 150) pool.push({ k: 'ghoul', w: 0.45 + d * 0.7 });
      if (phase.id === 'panic') pool.push({ k: 'crawler', w: 3 }, { k: 'zombie', w: 5 }, { k: 'werewolf', w: 1.0 }, { k: 'hunter', w: 1.4 }, { k: 'ghoul', w: 0.8 });
      const totalW = pool.reduce((a, b) => a + b.w, 0);
      let guard = 0;
      while (budgetLeft > 1.0 && guard++ < 12) {
        let r = Math.random() * totalW;
        let chosen = pool[0];
        for (const p of pool) { r -= p.w; if (r <= 0) { chosen = p; break; } }
        const cost = ENEMY_TYPES[chosen.k].spawnCost;
        if (cost > budgetLeft + 1.6) break;
        picks.push(chosen.k);
        budgetLeft -= cost;
        // a group of crawlers is scarier than one of anything else
        if ((chosen.k === 'crawler' || chosen.k === 'zombie') && chance(0.55) && budgetLeft > 0.7) picks.push('zombie');
      }
      const remembered = Math.min(4, (game.save && game.save.nightsSurvived) || 0);
      for (let i = 0; i < remembered && picks.length < 8; i++) picks.push('zombie');
    }
    if (!picks.length) return;
    this.budget = Math.max(0, this.budget - picks.reduce((a, k) => a + ENEMY_TYPES[k].spawnCost, 0) * 0.85);
    this.waveCount++;
    this.lastWaveT = game.time;
    this.spawnWave(game, picks, {});
  }

  /**
   * Spawn a list of enemies at (or just outside) a chosen entrance.
   * opts: { entranceId, door (attack a door), snipe, breakIn, reveal, count, type }
   */
  spawnWave(game, picks, opts = {}) {
    if (TUNING.noSpawns) return [];
    const p = game.player;
    const spawned = [];
    // choose the entrance: prefer one the player is NOT looking at, and that we
    // haven't used recently (so the house feels big instead of cheap)
    let ent = opts.entranceId ? game.mansion.entranceById(opts.entranceId) : null;
    if (!ent) {
      const cands = game.mansion.entrances.filter((e) => {
        const cd = this.spawnEntranceCd.get(e.id) || 0;
        if (e.id === this.lastSpawnEntrance && game.time - cd < DIRECTOR.spawnPointCooldown * 2) return false;
        if (e.kind === 'window' && picks.some((k) => ENEMY_TYPES[k] && ENEMY_TYPES[k].noWindows)) return false;
        return true;
      });
      const pool = cands.length ? cands : game.mansion.entrances;
      // weight toward entrances far from the player but not absurdly far
      const scored = pool.map((e) => {
        const d = dist(e.outside.x, e.outside.y, p.x, p.y);
        let s = clamp(d / 700, 0, 1.4);
        if (e.id === this.lastSpawnEntrance) s -= 0.8;
        s += rand(-0.35, 0.45);
        return { e, s };
      }).sort((a, b) => b.s - a.s);
      ent = scored[0].e;
    }
    if (!ent) return [];
    this.lastSpawnEntrance = ent.id;
    this.spawnEntranceCd.set(ent.id, game.time);

    const cluster = [ent.outside, { x: ent.outside.x + rand(-90, 90), y: ent.outside.y + rand(-90, 90) }];
    for (let i = 0; i < picks.length; i++) {
      const key = picks[i];
      let pos = cluster[i % cluster.length];
      // never spawn inside the camera view if we can help it
      const tries = 6;
      for (let a = 0; a < tries; a++) {
        const inView = game.renderer.isVisible(pos.x, pos.y, 60) &&
          dist(pos.x, pos.y, p.x, p.y) < 420;
        if (!inView) break;
        const ang = Math.atan2(pos.y - p.y, pos.x - p.x) + rand(-0.6, 0.6);
        pos = { x: pos.x + Math.cos(ang) * 90, y: pos.y + Math.sin(ang) * 90 };
      }
      pos = game.mansion.freeSpot(pos.x, pos.y, 16, 8);
      const o = {
        entranceId: ent.id,
        speedMul: 1 + (game.difficulty.spawn - 1) * 0.25,
        reveal: opts.reveal,
      };
      let e;
      if (key === 'crawler') e = new Crawler(pos.x, pos.y, o);
      else if (key === 'zombie') e = new Zombie(pos.x, pos.y, o);
      else if (key === 'hunter') e = new Hunter(pos.x, pos.y, o);
      else if (key === 'stalker') e = new Stalker(pos.x, pos.y, o);
      else if (key === 'ghoul') e = new Ghoul(pos.x, pos.y, o);
      else e = new Werewolf(pos.x, pos.y, o);
      // v1.0 variant rolls — the late night does not repeat the early one
      if (key !== 'stalker' && game.time > 165) {
        const vr = Math.random();
        if (key === 'crawler' && game.phase.id === 'panic' && vr < 0.34) applyVariant(e, 'frenzy');
        else if (key === 'hunter' && vr < 0.18) applyVariant(e, 'marksman');
        else if ((key === 'werewolf' || key === 'ghoul') && vr < 0.16) applyVariant(e, 'alpha');
      }
      e.waveId = this.waveCount;
      game.enemies.push(e);
      spawned.push(e);
      this.spawnedThisNight++;
    }
    game.onWaveIncoming(spawned, ent);
    return spawned;
  }

  /* ================= knock system ================= */

  /** Schedule a knock at a door. The outcome is decided now, revealed later. */
  scheduleKnock(game, opts = {}) {
    if (this.knock) return null;
    if (game.time - this.lastKnock < KNOCKS.minGap && !opts.force) return null;
    const doors = game.mansion.entrances.filter((e) => e.kind === 'door');
    let cands = doors.filter((e) => !e.broken);
    if (!cands.length) cands = doors;
    const p = game.player;
    let ent = opts.entranceId ? game.mansion.entranceById(opts.entranceId) : null;
    if (!ent) {
      // prefer doors the player is near-ish (so they can act) but not right on top
      const scored = cands.map((e) => {
        const d = dist(e.x, e.y, p.x, p.y);
        let s = d < 900 ? 1 : 0.2;
        if (d < 120) s *= 0.4;
        if (e.id === this.lastKnockDoor) s *= 0.35;
        return { e, s: s * rand(0.6, 1.4) };
      }).sort((a, b) => b.s - a.s);
      ent = scored[0] && scored[0].e;
    }
    if (!ent) return null;

    // weighted outcome table, shifted by how late it is
    let table = KNOCKS.outcomes.map((o) => {
      let w = o.weight;
      if (o.id === 'werewolf') w *= game.time > 170 ? 1.6 : 0.35;
      if (o.id === 'gift') w *= 1 + (1 - game.player.bloodPct) * 1.2;   // the house is generous to the desperate
      if (o.id === 'fake') w *= 1 + game.danger * 0.6;
      if (o.id === 'nothing') w *= game.time < 90 ? 1.5 : 1;
      return { ...o, w };
    });
    const total = table.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total, outcome = table[0];
    for (const o of table) { r -= o.w; if (r <= 0) { outcome = o; break; } }

    if (opts.outcome) {
      const forced = KNOCKS.outcomes.find((o) => o.id === opts.outcome) || { id: opts.outcome, label: opts.outcome };
      outcome = forced;
    }
    const wait = opts.wait ?? rand(KNOCKS.timeToAnswer[0], KNOCKS.timeToAnswer[1]);
    this.knock = {
      entranceId: ent.id,
      outcome: outcome.id,
      label: outcome.label,
      t: game.time,
      deadline: game.time + wait,
      opened: false,
      resolved: false,
      knockCount: 0,
      nextKnockAt: game.time + 0.15,
      known: !!opts.known,
      mustEnter: !!opts.mustEnter,
    };
    this.lastKnock = game.time;
    this.lastKnockDoor = ent.id;
    game.onKnockScheduled(this.knock, ent);
    return this.knock;
  }

  /** Player opened the door while a knock was pending. */
  resolveKnock(game, entrance) {
    const k = this.knock;
    if (!k || k.entranceId !== entrance.id) return null;
    k.opened = true;
    k.resolved = true;
    this.knock = null;
    return this.applyKnockOutcome(game, k, entrance, true);
  }

  applyKnockOutcome(game, k, entrance, opened) {
    const p = game.player;
    const at = { x: entrance.outside.x, y: entrance.outside.y };
    switch (k.outcome) {
      case 'nothing': {
        game.showMessage(opened ? 'NOTHING. ONLY THE COLD.' : 'THE KNOCKING STOPS.', { tone: 'calm' });
        game.audio.play('wind_gust', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.6 });
        break;
      }
      case 'fake': {
        game.audio.play('whisper', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.9 });
        game.showMessage('THERE IS NOTHING THERE.\nSOMETHING IS STILL WRONG.', { tone: 'cold' });
        game.particles.burst('mist', at.x, at.y, 14, { color: 'rgba(90,80,120,0.2)', sizeMin: 10, sizeMax: 26, speedMin: 6, speedMax: 30, lifeMin: 0.6, lifeMax: 1.4 });
        this.spawnShadow(game, at);
        break;
      }
      case 'gift': {
        const blood = 18 + Math.round(rand(0, 10));
        game.addPickup(at.x, at.y, 'blood', blood);
        game.addPickup(at.x + 26, at.y + 10, 'planks', 2);
        game.audio.play('bell', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.4, base: 330 });
        game.showMessage('SOMEONE LEFT A GIFT ON THE STEP.', { tone: 'warm' });
        break;
      }
      default: {
        // a creature was waiting
        const e = this.spawnWave(game, [k.outcome], { entranceId: entrance.id })[0];
        if (e) {
          e.x = at.x; e.y = at.y;
          e.state = 'approach';
          e.seenPlayer = e.type.loseSight;
          e.lastKnown = { x: p.x, y: p.y };
          game.audio.play(k.outcome === 'werewolf' ? 'werewolfReveal' : 'growl', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.9 });
          game.renderer.shake(0.5);
          game.showMessage(opened
            ? (k.outcome === 'werewolf' ? 'IT WAS WAITING FOR YOU TO OPEN IT.' : 'IT WAS WAITING BEHIND THE DOOR.')
            : 'IT DID NOT WAIT FOR AN INVITATION.', { tone: 'danger' });
        }
        break;
      }
    }
    return k;
  }

  updateKnock(dt, game) {
    const k = this.knock;
    if (!k) return;
    const e = game.mansion.entranceById(k.entranceId);
    if (!e) { this.knock = null; return; }
    if (e.broken) {
      // the door fell apart while something was knocking: resolve immediately
      k.resolved = true;
      this.knock = null;
      this.applyKnockOutcome(game, k, e, false);
      return;
    }
    const p = game.player;
    const d = dist(e.x, e.y, p.x, p.y);
    k.known = k.known || d < 620;
    // repeat knocks, getting less patient
    k.nextKnockAt -= dt;
    if (k.nextKnockAt <= 0 && game.time < k.deadline) {
      k.knockCount++;
      const hard = k.knockCount >= 3;
      game.audio.playAt(hard ? 'knockHard' : 'knock', e.x, e.y, game.renderer.cam, { vol: hard ? 1.05 : 0.85 });
      game.onKnockSound(e, k);
      k.nextKnockAt = rand(3.2, 6.5) * (1 + k.knockCount * 0.18);
      e.hint = 1;
    }
    if (game.time > k.deadline) {
      // ignored for too long: usually safe, sometimes very much not
      k.resolved = true;
      this.knock = null;
      const impatient = k.mustEnter || (k.outcome !== 'nothing' && k.outcome !== 'gift' && chance(0.42));
      if (impatient) {
        if (k.outcome === 'fake') {
          game.showMessage('THE KNOCKING STOPS.', { tone: 'calm' });
          game.audio.play('creak', { x: e.x, y: e.y, cam: game.renderer.cam, vol: 0.8 });
        } else {
          const spawned = this.spawnWave(game, [k.outcome], { entranceId: e.id, reveal: !!k.mustEnter });
          if (k.mustEnter && spawned[0]) {
            spawned[0].x = e.outside.x;
            spawned[0].y = e.outside.y;
            spawned[0].state = 'approach';
            spawned[0].seenPlayer = spawned[0].type.loseSight;
            spawned[0].lastKnown = { x: p.x, y: p.y };
            e.hp = Math.min(e.hp, e.hpMax * 0.42);
            e.attackers = Math.max(e.attackers || 0, 1);
          }
          game.showMessage(k.mustEnter ? 'IT IS COMING THROUGH THE SERVANT DOOR.' : 'WHATEVER IT WAS, IT STOPPED WAITING.', { tone: 'danger' });
        }
      } else {
        game.showMessage('THE KNOCKING STOPS.', { tone: 'calm' });
      }
    }
  }

  /* ================= random events ================= */

  updateEvents(dt, game) {
    const t = game.time;
    const p = game.player;

    // ---- something moved behind you ----
    if (this.behindYouCount < DIRECTOR.behindYou.maxPerNight &&
      t - this.lastBehindYou > DIRECTOR.behindYou.minGap && t > 60 && !this.knock &&
      game.enemies.filter((e) => !e.dead).length <= 2 && chance(dt * 0.02 * (1 + game.danger))) {
      this.lastBehindYou = t;
      this.behindYouCount++;
      this.triggerBehindYou(game);
    }

    // ---- "did you hear that" ambient signals ----
    if (t - this.lastAmbient > 12 && chance(dt * 0.08)) {
      this.lastAmbient = t;
      const roll = Math.random();
      const far = game.mansion.spawns.filter((s) => dist(s.x, s.y, p.x, p.y) > 500);
      const at = far.length ? pick(far) : { x: p.x + rand(-600, 600), y: p.y + rand(-600, 600) };
      if (roll < 0.22) {
        game.audio.play(far.length ? 'stepCreak' : 'creak', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.7 });
        if (chance(0.4)) game.showMessage('FOOTSTEPS ABOVE YOU.', { tone: 'cold' });
      } else if (roll < 0.4) {
        game.audio.play('scream', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.45 });
        game.showMessage('SOMETHING OUT THERE IS DYING.', { tone: 'cold' });
      } else if (roll < 0.58) {
        game.audio.play('footstep', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.7 });
        game.audio.play('footstep', { x: at.x + 20, y: at.y + 10, cam: game.renderer.cam, vol: 0.5 });
      } else if (roll < 0.72) {
        game.audio.play('whisper', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.7 });
      } else if (roll < 0.86) {
        game.audio.play('breath', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.6 });
        game.showMessage('SOMETHING IS BREATHING.', { tone: 'cold' });
      } else {
        game.audio.play('drip', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.6 });
      }
    }

    // ---- a shadow moving just outside the player's vision ----
    if (!this.shadow && chance(dt * 0.05 * (0.5 + game.danger)) && t > 45) {
      this.spawnShadow(game, null);
    }
    if (this.shadow) {
      this.shadow.t -= dt;
      this.shadow.x += this.shadow.vx * dt;
      this.shadow.y += this.shadow.vy * dt;
      this.shadow.a = clamp(this.shadow.t / this.shadow.maxT, 0, 1);
      if (this.shadow.t <= 0) this.shadow = null;
    }

    // ---- lightning ----
    if (t > this.lightningAt && chance(dt * (0.05 + (game.phase.id === 'panic' ? 0.18 : 0)))) {
      this.lightningAt = t + rand(18, 55);
      this.strikeLightning(game);
    }
    if (this.pendingThunder > 0) {
      this.pendingThunder -= dt;
      if (this.pendingThunder <= 0) {
        game.audio.play('thunder', { vol: clamp(0.3 + this.lightningPower * 0.9, 0.2, 1), pan: rand(-0.5, 0.5) });
      }
    }

    // ---- blackouts (environmental danger) ----
    if (t > this.lastBlackout + DIRECTOR.blackout.minGap && t > 150 && game.blackoutT <= 0 && !game.blackoutWarning) {
      if (chance(dt * (0.02 + game.danger * 0.05)) && t < 292) this.startBlackout(game);
    }
  }

  triggerBehindYou(game) {
    const p = game.player;
    game.showMessage('SOMETHING MOVED BEHIND YOU.', { tone: 'cold', whisper: true });
    // a shape crosses behind the player, just at the edge of vision
    const a = p.angle + Math.PI + rand(-0.8, 0.8);
    const d = 250 + rand(0, 130);
    const at = game.mansion.freeSpot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 20, 10);
    game.audio.play('footstep', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.8, soft: true });
    const isReal = chance(0.28) && game.enemies.filter((e) => !e.dead).length < 5;
    if (isReal) {
      const key = game.time > 170 && chance(0.25) ? 'werewolf' : chance(0.5) ? 'hunter' : 'crawler';
      const e = this.spawnWave(game, [key], {})[0];
      if (e) {
        e.x = at.x; e.y = at.y;
        e.seenPlayer = e.type.loseSight;
        e.lastKnown = { x: p.x, y: p.y };
        e.state = 'hunt';
        e.waveId = this.waveCount;
      }
      return;
    }
    const roll = Math.random();
    if (roll < 0.55) this.spawnShadow(game, at);
    else if (roll < 0.8) {
      // a harmless object moved
      game.particles.burst('dust', at.x, at.y, 10, { color: 'rgba(120,110,100,0.35)', sizeMin: 3, sizeMax: 9, speedMin: 10, speedMax: 40, lifeMin: 0.5, lifeMax: 1.1 });
      game.audio.play('creak', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.7 });
    } else {
      game.audio.play('breath', { x: at.x, y: at.y, cam: game.renderer.cam, vol: 0.8 });
    }
  }

  spawnShadow(game, at) {
    const p = game.player;
    if (!at) {
      const a = rand(0, Math.PI * 2);
      const d = rand(320, 480);
      at = game.mansion.freeSpot(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 20, 8);
    }
    const a2 = rand(0, Math.PI * 2);
    this.shadow = {
      x: at.x, y: at.y,
      vx: Math.cos(a2) * 130, vy: Math.sin(a2) * 130,
      t: 0.85, maxT: 0.85, a: 1,
    };
  }

  strikeLightning(game) {
    this.pendingThunder = rand(0.9, 3.2);
    this.lightningPower = rand(0.4, 1);
    game.lightningFlash = this.lightningPower;
    game.renderer.addFlash(0.35 * this.lightningPower, '#cfe0ff');
    game.audio.play('crack', { vol: 0.5 * this.lightningPower, pan: rand(-0.6, 0.6) });
  }

  startBlackout(game) {
    this.lastBlackout = game.time;
    game.blackoutT = rand(DIRECTOR.blackout.duration[0], DIRECTOR.blackout.duration[1]);
    game.audio.play('blackout', { vol: 0.9 });
    game.audio.play('impact', { vol: 0.5 });
    game.renderer.shake(0.4);
    game.showMessage('THE LIGHTS GO OUT.', { tone: 'danger' });
    // the chandelier in the main hall comes down the first time
    if (!this.chandelierFell && chance(0.85)) {
      this.chandelierFell = true;
      game.timeouts.push({ t: 1.1, fn: () => game.dropChandelier() });
    }
  }

  /* ================= heartbeat & music ================= */

  heartbeat(game) {
    const p = game.player;
    const blood = p.bloodPct;
    let rate = 0.75;                                  // resting
    rate += (1 - blood) * 1.1;                        // hunger
    if (blood < 0.3) rate += 0.35;
    if (blood < 0.12) rate += 0.3;
    const near = game.nearestEnemy ?? 9999;
    if (near < 620) rate += (1 - near / 620) * 0.85;
    rate += clamp((game.enemiesNear ?? 0) * 0.16, 0, 0.7);
    const chased = game.enemies.some((e) => !e.dead && e.seenPlayer > 0 && dist(e.x, e.y, p.x, p.y) < 420);
    if (chased) rate += 0.45;
    rate += game.danger * 0.55;
    if (game.phase.id === 'panic') rate += 0.5;
    if (game.phase.id === 'silence') rate += 0.25;
    let strength = clamp(rate / 3.4, 0, 1);
    if (Math.abs(game.time - (game.lastHurtT ?? -9)) < 1.5) rate += 0.5;
    return { rate: clamp(rate, 0.55, 3.7), strength };
  }

  updateAudioState(dt, game) {
    const hb = this.heartbeat(game);
    game.heartRate = hb.rate;
    game.heartStrength = hb.strength;
    if (game.audio) game.audio.setHeartbeat(hb.rate, hb.strength);

    // music layers
    const panicPhase = game.phase.id === 'panic' || game.phase.id === 'silence';
    let panic = panicPhase ? clamp((game.time - PANIC_AT) / 12, 0, 1) : 0;
    if (game.mood === MOOD.PANIC && !panicPhase) panic = Math.max(panic, 0.35);
    if (this.mood === MOOD.RELIEF) panic *= 0.2;
    let danger = clamp(game.danger * 0.85 + this.threat * 0.35, 0, 1.15);
    if (this.mood === MOOD.RELIEF) danger *= 0.4;
    let intensity = clamp(0.35 + game.danger * 0.5, 0, 1);
    // the last ten seconds: strip everything but the heartbeat
    const silence = game.time >= SILENCE_AT ? clamp((game.time - SILENCE_AT) / 2.5, 0, 1) : 0;
    if (this.mood === MOOD.RELIEF) { intensity *= 0.5; danger *= 0.35; }

    game.musicState = { intensity, danger, panic, silence };
    if (game.audio) {
      game.audio.updateAudio(dt, {
        intensity,
        danger,
        panic,
        wind: 0.3 + game.danger * 0.35 + (game.phase.id === 'panic' ? 0.3 : 0),
        nearFire: game.nearFire ?? 0,
        lowBlood: clamp((1 - game.player.bloodPct) * 1.4 - 0.4, 0, 1),
        silenceMusic: silence,
        heartbeat: hb.strength,
      });
    }
  }

  updateCountdown(dt, game) {
    const t = game.time;
    if (t >= COUNTDOWN_AT && t < NIGHT_DURATION) {
      const left = Math.ceil(NIGHT_DURATION - t);
      if (left !== game.countdownShown && left <= 5 && left > 0) {
        game.countdownShown = left;
        game.showCountdown(left);
      }
    }
  }

  fireBeat(beat, game) {
    this.beatsFired[beat.id] = game.time;
    const args = beat.args || {};
    switch (beat.fn) {
      case 'creakNear': {
        const p = game.player;
        game.audio.play('creak', { x: p.x + rand(-260, 260), y: p.y + rand(-260, 260), cam: game.renderer.cam, vol: 0.8 });
        break;
      }
      case 'knock': {
        this.scheduleKnock(game, { force: true });
        break;
      }
      case 'knockHard': {
        this.scheduleKnock(game, { force: true });
        if (this.knock) this.knock.knockCount = 2;
        break;
      }
      case 'windowBreak': {
        const w = pick(game.mansion.entrances.filter((e) => e.kind === 'window'));
        if (w && !w.broken) {
          game.audio.play('glassBreak', { x: w.x, y: w.y, cam: game.renderer.cam, vol: 0.95 });
          game.damageEntrance(w, w.hp * 0.55, null);
          game.particles.burst('shard', w.x, w.y, 16, {
            color: 'rgba(170,205,240,0.85)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 160, lifeMin: 0.4, lifeMax: 1.1, grav: 180, spin: 6,
          });
          game.showMessage('GLASS BREAKS SOMEWHERE IN THE HOUSE.', { tone: 'danger' });
        }
        break;
      }
      case 'lull': {
        // the false calm: everything goes still, which is its own kind of dread
        this.quietUntil = Math.max(this.quietUntil, game.time + 22);
        for (const e of game.enemies) {
          if (!e.dead && e.insideHouse && e.leaving !== true && chance(0.75)) {
            e.leaving = true; e.state = 'leave'; e.leaveT = 0;
          }
        }
        game.audio.play('wind_gust', { vol: 0.7 });
        game.showMessage('THE HOUSE GOES QUIET.', { tone: 'calm', life: 5 });
        break;
      }
      case 'behindYou': this.triggerBehindYou(game); break;
      case 'blackout': this.startBlackout(game); break;
      case 'flourish': {
        game.renderer.shake(0.3);
        game.audio.play('stinger', { vol: 0.7, det: 0.01 });
        break;
      }
      case 'spawnWave': {
        const picks = [];
        const survived = (game.save && game.save.nightsSurvived) || 0;
        const count = (args.count || 1) + (args.type === 'werewolf' ? 0 : Math.min(4, survived));
        for (let i = 0; i < count; i++) {
          if (args.type === 'mixed') picks.push(pick(['zombie', 'crawler', 'zombie', 'hunter', 'ghoul']));
          else picks.push(args.type);
        }
        if (args.type === 'crawler' || args.type === 'mixed') {
          for (let i = 0; i < 1 + Math.min(3, survived); i++) picks.push('zombie');
        }
        const spawned = this.spawnWave(game, picks, args);
        break;
      }
    }
    if (beat.text) game.showMessage(beat.text, { tone: beat.id === 'panicWave' ? 'danger' : 'cold', banner: false });
  }
}
