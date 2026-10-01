/* LAST NIGHT — the climax system
 *
 * The night is a slow burn, and a slow burn is what keeps a player. It is not
 * what makes one stop scrolling. This module owns the four engineered peaks —
 * the moments the game is *about*, and the moments that can be cut into a
 * 2–3 second, 9:16, sound-off clip:
 *
 *   1. SIEGE CRESCENDO  the last ~20s: every door at once, the swarm floods.
 *   2. BLOOD MOON FRENZY a feed-chain turns the moon red: slow-mo, overdrive.
 *   3. BOSS DUEL        the alpha: the lights cut, the swarm leaves, 1v1.
 *   4. DAWNBREAK        the sun arrives as a golden wave and burns what is left.
 *
 * Rules of the house:
 *   - every peak is a real gameplay beat, never a scripted cutscene. The player
 *     keeps the stick, the doors keep taking damage, the blood keeps draining.
 *   - nothing here forks the director, the renderer or the dawn. The peaks hang
 *     off them: the director is asked to spend its budget NOW (or to hold its
 *     breath), the renderer is given a grade to draw, the dawn is given a wave.
 *   - the horror identity stays. The frenzy is desperate, not heroic: it is
 *     seven seconds of not being careful, and it costs blood like everything.
 *   - procedural only. Grade, particles, synth. No new art, no video.
 */

import { clamp, lerp, rand, dist } from '../core/util.js';
import { CLIMAX, DAWN_AT } from '../core/config.js';
import { Werewolf, applyVariant } from './enemies.js';
import { masterReady, masterDown } from './hunt.js';

export const PEAK = Object.freeze({
  CRESCENDO: 'crescendo',
  FRENZY: 'frenzy',
  DUEL: 'duel',
  DAWNBREAK: 'dawnbreak',
});

/** Everything the render/HUD/audio layers are allowed to read, in one place. */
const NEUTRAL = Object.freeze({
  slowScale: 1,      // < 1 for the frenzy's slow-motion beat
  edge: 0,           // red screen-edge pulse (crescendo / frenzy)
  red: 0,            // full-frame blood grade (frenzy)
  moonBoost: 0,      // pushes the existing blood-moon light grade
  duelDark: 0,       // the lights leaving for the entrance
  heartBoost: 0,     // added to the director's heartbeat rate
  panicBoost: 0,     // floor for the music's panic layer
  spawnsHeld: false, // director: hold the swarm (duel entrance)
  focus: null,       // {x,y} camera override
  shield: 0,         // Valen's hand against the sun (dawnbreak)
  gold: 0,           // the dawn wave's screen wash
});

function immolate(game, e) {
  if (!e || e.dead) return;
  e.dead = true;
  e.state = 'dying';
  e.deathT = 0;
  e.ash = true;
  game.particles.burst('glow', e.x, e.y, 15, {
    color: 'rgba(255,214,150,0.82)', sizeMin: 4, sizeMax: 15, lifeMin: 0.5, lifeMax: 1.7, speedMin: 10, speedMax: 55,
  });
  game.particles.burst('dust', e.x, e.y, 18, {
    color: 'rgba(150,120,90,0.5)', sizeMin: 4, sizeMax: 12, lifeMin: 0.6, lifeMax: 1.8, speedMin: 20, speedMax: 60,
  });
}

export class Climax {
  constructor() {
    Object.assign(this, NEUTRAL);
    this.reset();
  }

  /** Called by freshRun(): a new night has all four peaks available again. */
  reset() {
    this.crescendo = null;   // { t, dur, doorT }
    this.frenzy = null;      // { t, dur, slow }
    this.duel = null;        // { t, stage, boss, dur }
    this.dawnWave = null;    // { t, dur, front, x0, x1 }
    this.feedChain = 0;
    this.lastFeedT = -99;
    this.frenzyCd = 0;
    this.crescendoUsed = false;
    this.duelUsed = false;
    this.peaksFired = [];
    Object.assign(this, NEUTRAL);
  }

  /* ================= queries ================= */

  get active() {
    if (this.crescendo) return PEAK.CRESCENDO;
    if (this.frenzy) return PEAK.FRENZY;
    if (this.duel) return PEAK.DUEL;
    if (this.dawnWave) return PEAK.DAWNBREAK;
    return null;
  }

  /** The running boss, if the duel still has one. */
  get boss() {
    const d = this.duel;
    if (!d || !d.boss || d.boss.dead) return null;
    return d.boss;
  }

  /* ================= frame ================= */

  update(dt, game) {
    const t = game.time;
    this.frenzyCd = Math.max(0, this.frenzyCd - dt);
    Object.assign(this, NEUTRAL);

    // 1 — the nightly peak. The last twenty seconds are a siege, every night.
    if (game.screen === 'playing' && !this.crescendoUsed && t >= CLIMAX.crescendoAt && t < DAWN_AT) {
      this.startCrescendo(game);
    }

    // 3 — the set-piece. Rolled once, in the second half, when the house has
    //     something with a name on it. (Night 1 is the guided win: it waits.)
    if (game.screen === 'playing' && !this.duelUsed && !this.duel
      && (game.save.nightsSurvived || 0) >= CLIMAX.duelMinNights
      && t >= CLIMAX.duelAfter && t < CLIMAX.duelBefore) {
      this.rollDuel(game);
    }

    if (this.crescendo) this.tickCrescendo(dt, game);
    if (this.frenzy) this.tickFrenzy(dt, game);
    if (this.duel) this.tickDuel(dt, game);
    if (this.dawnWave) this.tickDawnWave(dt, game);

    // the feed chain decays on its own, not only on the next kill
    if (this.feedChain && t - this.lastFeedT > CLIMAX.frenzyWindow) this.feedChain = 0;
  }

  /* ================= 1. siege crescendo ================= */

  startCrescendo(game) {
    this.crescendoUsed = true;
    this.peaksFired.push(PEAK.CRESCENDO);
    this.crescendo = { t: 0, dur: CLIMAX.crescendoDur, doorT: 0 };

    const d = game.director;
    d.quietUntil = 0;
    d.budget = Math.max(d.budget, 3.6);
    d.waveRegen = 1.6;                 // the house stops pacing itself
    const nights = game.save.nightsSurvived || 0;
    const picks = ['zombie', 'zombie', 'crawler', 'crawler'];
    if (nights >= 1) picks.push('crawler');
    if (nights >= 3) picks.push('werewolf');
    if (nights >= 5) picks.push('ghoul');
    d.launchWave(game, picks);
    // the flood comes from more than one side of the house
    const doors = game.mansion.entrances.filter((e) => !e.broken);
    if (doors.length > 1) {
      const other = doors[(Math.random() * doors.length) | 0];
      d.spawnWave(game, nights >= 3 ? ['zombie', 'zombie', 'crawler'] : ['zombie', 'crawler'], { entranceId: other.id });
    }

    // every door takes the house leaning on it at once
    for (const e of game.mansion.entrances) {
      if (e.broken) continue;
      e.buckling = 1;
      game.audio.playAt('doorHit', e.x, e.y, game.renderer.cam, { vol: 0.5 });
    }
    game.renderer.shake(0.85);
    game.renderer.addFlash(0.1, '#b0202c');
    game.audio.play('siege', { vol: 0.85 });
    game.audio.duck(0.55, 1.4);
    game.showBanner('THE FINAL PUSH', 2.6);
    game.showMessage('EVERY DOOR AT ONCE. HOLD WHAT YOU CAN.', { tone: 'danger', life: 4 });
  }

  tickCrescendo(dt, game) {
    const c = this.crescendo;
    c.t += dt;
    if (game.screen !== 'playing') return;

    // the wood keeps taking it: one more door gives, over and over
    c.doorT -= dt;
    if (c.doorT <= 0) {
      c.doorT = CLIMAX.crescendoDoorEvery * rand(0.8, 1.2);
      const standing = game.mansion.entrances.filter((e) => !e.broken);
      if (standing.length) {
        const pressed = standing.filter((e) => (e.attackers || 0) > 0);
        const e = (pressed.length ? pressed : standing)[(Math.random() * (pressed.length || standing.length)) | 0];
        if (e) {
          e.buckling = 1;
          game.damageEntrance(e, e.hpMax * CLIMAX.crescendoDoorBite, null);
          game.audio.playAt('doorHit', e.x, e.y, game.renderer.cam, { vol: 0.7 });
          game.particles.burst('dust', e.x, e.y, 8, {
            color: 'rgba(150,130,100,0.4)', sizeMin: 2, sizeMax: 7, lifeMin: 0.3, lifeMax: 0.8, speedMin: 10, speedMax: 50,
          });
        }
      }
    }
    // doors shudder between impacts so the frame is never still
    for (const e of game.mansion.entrances) e.buckling = Math.max(e.buckling || 0, 0.35);

    const k = clamp(c.t / 1.2, 0, 1) * clamp((c.dur - c.t) / 2, 0, 1);
    // the frame: the edges breathe red with the heartbeat, a thin blood wash
    // over everything, and a house that will not stop shaking
    this.edge = k * (0.62 + 0.38 * Math.abs(Math.sin(c.t * 4.2)));
    this.red = 0.3 * k;
    this.heartBoost = 0.7 * k;
    this.panicBoost = 0.8 * k;
    c.shakeT = (c.shakeT ?? 0) - dt;
    if (c.shakeT <= 0) {
      c.shakeT = 0.42;
      game.renderer.shake(0.16);
    }
    // plaster coming down: the house is being leaned on from every side
    if (Math.random() < dt * 9) {
      const p = game.player;
      game.particles.burst('dust', p.x + rand(-170, 170), p.y + rand(-130, 130), 2, {
        color: 'rgba(150,140,120,0.32)', sizeMin: 1.5, sizeMax: 4, lifeMin: 0.6, lifeMax: 1.5, speedMin: 2, speedMax: 14, grav: 34,
      });
    }
    if (c.t >= c.dur) this.crescendo = null;
  }

  /* ================= 2. blood moon frenzy ================= */

  /** A kill is a feed. A chain of them is what the moon notices. */
  noteFeed(game) {
    const t = game.time;
    this.feedChain = (t - this.lastFeedT <= CLIMAX.frenzyWindow) ? this.feedChain + 1 : 1;
    this.lastFeedT = t;
    if (this.feedChain >= CLIMAX.frenzyChain && !this.frenzy && !this.duel
      && this.frenzyCd <= 0 && game.screen === 'playing' && t > 40 && t < DAWN_AT - 8) {
      this.startFrenzy(game);
    }
  }

  startFrenzy(game) {
    this.feedChain = 0;
    this.frenzyCd = CLIMAX.frenzyCooldown;
    this.peaksFired.push(PEAK.FRENZY);
    this.frenzy = { t: 0, dur: CLIMAX.frenzyDur, slow: CLIMAX.frenzySlowT };
    game.player.frenzy = { dmg: CLIMAX.frenzyDamage, spd: CLIMAX.frenzySpeed, rate: CLIMAX.frenzyRate };
    game.audio.play('bloodMoon', { vol: 0.95 });
    game.audio.duck(0.5, 1.6);
    game.renderer.shake(0.8);
    game.renderer.addFlash(0.45, '#c8202e');
    game.showBanner('FRENZY', 2.4);
    game.showMessage('THE MOON COMES UP RED AND YOU STOP BEING CAREFUL.', { tone: 'danger', life: 4 });
  }

  tickFrenzy(dt, game) {
    const f = this.frenzy;
    f.t += dt;
    f.slow = Math.max(0, f.slow - dt);
    const rise = clamp(f.t / 0.55, 0, 1);
    const fall = clamp((f.dur - f.t) / 1.1, 0, 1);
    const k = Math.min(rise, fall);
    this.slowScale = f.slow > 0 ? lerp(CLIMAX.frenzySlowScale, 1, 1 - f.slow / CLIMAX.frenzySlowT) : 1;
    this.moonBoost = k;                                  // the existing light grade goes blood-red
    this.red = 0.75 * k;
    this.edge = 0.5 * k;
    this.heartBoost = 0.5 * k;
    this.panicBoost = 0.45 * k;
    // blood spray in the air the whole time: the frame fills with it
    if (Math.random() < dt * 22 * k) {
      const p = game.player;
      const a = rand(0, Math.PI * 2);
      game.particles.burst('blood', p.x + Math.cos(a) * rand(20, 90), p.y + Math.sin(a) * rand(20, 90), 2, {
        color: 'rgba(190,20,34,0.85)', speedMin: 20, speedMax: 90, lifeMin: 0.2, lifeMax: 0.6, sizeMin: 1.5, sizeMax: 4, grav: 70,
      });
    }
    if (f.t >= f.dur) this.endFrenzy(game);
  }

  endFrenzy(game) {
    if (this.frenzy) this.frenzy = null;
    if (game.player) game.player.frenzy = null;
  }

  /* ================= 3. boss duel ================= */

  rollDuel(game) {
    // One per night. The trigger is a werewolf already in the house and in
    // reach of the light — or, from the third night on, the house simply
    // deciding it is time. Never while another peak owns the frame.
    if (this.crescendo || this.frenzy) return;
    // THE LAST NIGHT (#56 P1). The track is full, so the duel is not a roll
    // and the thing that comes is not an alpha. It comes, or the night is a
    // lie about what the hunt has been walking toward.
    if (masterReady(game.save) && !masterDown(game.save)) {
      if (game.time >= CLIMAX.duelAfter && !this.duelUsed) this.startDuel(game, null, { master: true });
      return;
    }
    const boss = game.enemies.find((e) => !e.dead && e.key === 'werewolf'
      && dist(e.x, e.y, game.player.x, game.player.y) < 900);
    const nights = game.save.nightsSurvived || 0;
    const decided = boss ? true : (nights >= 3 && game.time > CLIMAX.duelAfter + 30 && Math.random() < 0.006);
    if (!decided) return;
    this.startDuel(game, boss || null);
  }

  startDuel(game, existing = null, opts = {}) {
    const master = !!opts.master;
    this.duelUsed = true;
    this.peaksFired.push(PEAK.DUEL);
    const p = game.player;

    // the monster fills the frame: in front of her, just outside the light,
    // close enough that the entrance is a reveal and not a walk.
    let boss = existing;
    if (!boss) {
      const a = p.angle + rand(-0.35, 0.35);
      const x = p.x + Math.cos(a) * 320;
      const y = p.y + Math.sin(a) * 320;
      const spot = game.mansion.freeSpot(x, y, 26, 14);
      boss = new Werewolf(spot.x, spot.y, {});
      applyVariant(boss, master ? 'master' : 'alpha');
      game.enemies.push(boss);
    } else if (!boss.variant || master) {
      applyVariant(boss, master ? 'master' : 'alpha');
    }
    boss.x = game.mansion.freeSpot(boss.x, boss.y, 26, 14).x;
    boss.duelBoss = true;
    boss.isMaster = master;
    if (master) {
      // three times the wolf, and it does not get bored and wander off
      boss.hpMax = Math.max(boss.hpMax, 900);
      boss.hp = boss.hpMax;
      boss.type = { ...boss.type, leaveAfter: 1e9 };
    }
    if (boss.hpMax < 300) { boss.hpMax = Math.round(boss.hpMax * 1.3); boss.hp = boss.hpMax; }
    boss.state = 'hunt';
    boss.seenPlayer = boss.type.loseSight;
    boss.lastKnown = { x: p.x, y: p.y };
    boss.entranceId = null;
    boss.leaving = false;

    // the siege pauses: everything else in the house loses interest
    for (const e of game.enemies) {
      if (e === boss || e.dead) continue;
      e.leaving = true;
      e.state = 'leave';
      e.leaveT = 0;
    }
    const d = game.director;
    d.budget = 0;
    d.quietUntil = game.time + CLIMAX.duelCut + CLIMAX.duelFight;
    const fight = master ? CLIMAX.duelFight * 1.8 : CLIMAX.duelFight;
    this.duel = {
      t: 0, stage: 'cut', boss, dur: CLIMAX.duelCut + fight,
      master, name: master ? 'THE MASTER' : 'THE ALPHA',
    };
    // the hold starts now, not on the next frame: the entrance owns the night
    this.spawnsHeld = true;
    this.duelDark = 1;

    game.audio.play('bossCut', { vol: 0.95 });
    game.audio.duck(0.35, 2.2);
    game.renderer.shake(master ? 1.1 : 0.6);
    game.showBanner(master ? 'THE MASTER' : 'THE ALPHA', master ? 3.2 : 2.2);
    game.showMessage(master
      ? 'THE HOUSE OPENS. THE THING THAT OWNS IT WALKS IN, AND IT KNOWS YOUR NAME.'
      : 'THE HOUSE BRINGS YOU THE ONE THAT LEADS THEM.', { tone: 'danger', life: master ? 5.2 : 4.2 });
  }

  tickDuel(dt, game) {
    const d = this.duel;
    d.t += dt;
    const boss = d.boss;

    // the swarm stays out of it for the length of the set-piece
    game.director.budget = Math.min(game.director.budget, 0.4);
    game.director.quietUntil = Math.max(game.director.quietUntil, game.time + 1.5);

    const dead = !boss || boss.dead;
    if (d.stage === 'cut') {
      const k = clamp(d.t / 0.35, 0, 1) * clamp((CLIMAX.duelCut - d.t) / 0.35, 0, 1);
      // not pitch black: the room has to hold its shape so the monster has one
      this.duelDark = 0.88 * k;
      this.spawnsHeld = true;
      if (boss && !boss.dead) {
        // the spotlight: one pool of red in a black house
        const bx = boss.x, by = boss.y;
        this.focus = { x: lerp(game.player.x, bx, 0.62), y: lerp(game.player.y, by, 0.62) };
        if (Math.random() < dt * 8) {
          game.particles.burst('mist', bx + rand(-30, 30), by + rand(-10, 20), 1, {
            color: 'rgba(120,20,26,0.22)', sizeMin: 10, sizeMax: 30, lifeMin: 0.5, lifeMax: 1.2, speedMin: 4, speedMax: 18,
          });
        }
      }
      if (d.t >= CLIMAX.duelCut) {
        d.stage = 'fight';
        game.audio.play('werewolfReveal', { vol: 0.8 });
        game.showMessage('IT IS ONLY THE TWO OF YOU NOW.', { tone: 'danger', life: 3.4 });
      }
    } else {
      this.duelDark = clamp(0.55 - (d.t - CLIMAX.duelCut) * 0.25, 0, 1);
      this.spawnsHeld = true;
      if (boss && !boss.dead) {
        this.focus = { x: lerp(game.player.x, boss.x, 0.35), y: lerp(game.player.y, boss.y, 0.35) };
        boss.seenPlayer = boss.type.loseSight;
      }
    }

    if (dead) {
      game.renderer.shake(0.7);
      game.audio.play('stinger', { vol: 0.7 });
      if (d.master) {
        // the hunt ends here — not with a screen of numbers, with a body
        this.endDuel(game);
        game.endHunt();
      } else {
        game.showMessage('THE ALPHA FALLS. THE HOUSE GOES QUIET AGAIN.', { tone: 'cold', life: 4 });
        this.endDuel(game);
      }
      return;
    }
    if (d.t >= d.dur) {
      // she survived it: it loses interest and walks back into the dark
      boss.leaving = true;
      boss.state = 'leave';
      boss.leaveT = 0;
      game.showMessage(d.master
        ? 'IT STEPS BACK INTO THE DARK, UNBLED. IT WILL COME AGAIN TOMORROW.'
        : 'IT TIRES OF YOU AND WALKS BACK INTO THE DARK.', { tone: 'cold', life: 4 });
      this.endDuel(game);
    }
  }

  endDuel(game) {
    if (this.duel && this.duel.boss) this.duel.boss.duelBoss = false;
    this.duel = null;
    this.spawnsHeld = false;
    this.focus = null;
    game.director.quietUntil = game.time + 4;
    game.director.budget = Math.max(game.director.budget, 1.1);
  }

  /* ================= 4. dawnbreak ================= */

  /** beginDawn hands the swarm to the sun instead of deleting it. */
  startDawnWave(game) {
    const b = game.mansion.bounds;
    this.peaksFired.push(PEAK.DAWNBREAK);
    this.dawnWave = {
      t: 0,
      dur: CLIMAX.dawnWaveDur,
      x0: b.x - 260,
      x1: b.x + b.w + 260,
      front: b.x - 260,
    };
    for (const e of game.enemies) {
      if (e.dead) continue;
      e.dawnHold = true;      // the sun is coming; nothing moves
    }
    game.audio.play('dawnbreak', { vol: 0.9 });
    game.audio.duck(0.3, 2.2);
    game.renderer.addFlash(0.5, '#ffd9a2');
    game.renderer.shake(0.55);
    game.showBanner('DAWNBREAK', 2.4);
  }

  tickDawnWave(dt, game) {
    const w = this.dawnWave;
    w.t += dt;
    const k = clamp(w.t / w.dur, 0, 1);
    // the front accelerates: it arrives, then it is simply morning
    w.front = lerp(w.x0, w.x1, k * k * (3 - 2 * k) * 0.35 + k * 0.65);
    for (const e of game.enemies) {
      if (e.dead || !e.dawnHold) continue;
      if (e.x - (e.radius || 12) <= w.front) immolate(game, e);
    }
    // and when it reaches her: the frame goes white-gold for a beat
    if (!w.flashed && w.front >= game.player.x) {
      w.flashed = true;
      game.renderer.addFlash(0.45, '#ffdfa6');
      game.renderer.shake(0.5);
      game.audio.play('dawnbreak', { vol: 0.55 });
    }
    this.gold = clamp(w.t / 0.5, 0, 1) * clamp((w.dur + 0.8 - w.t) / 1.2, 0, 1);
    this.shield = clamp((w.t - 0.15) / 0.45, 0, 1) * clamp((w.dur + 0.9 - w.t) / 1.1, 0, 1);
    if (w.t >= w.dur) {
      for (const e of game.enemies) if (!e.dead && e.dawnHold) immolate(game, e);
      this.dawnWave = null;
      this.gold = 0;
      this.shield = 0;
    }
  }

  /* ================= capture / QA ================= */

  /** Force a peak on demand (shotbrowser, QA, the ad capture for #48). */
  force(game, name) {
    if (name === PEAK.CRESCENDO) { this.crescendoUsed = false; this.crescendo = null; this.startCrescendo(game); return !!this.crescendo; }
    if (name === PEAK.FRENZY) { this.endFrenzy(game); this.frenzyCd = 0; this.startFrenzy(game); return !!this.frenzy; }
    if (name === PEAK.DUEL) { if (this.duel) this.endDuel(game); this.startDuel(game, null); return !!this.duel; }
    if (name === PEAK.DAWNBREAK) { if (!this.dawnWave) this.startDawnWave(game); return !!this.dawnWave; }
    return false;
  }

  diagnostics() {
    return {
      active: this.active,
      fired: this.peaksFired.slice(),
      crescendo: this.crescendo ? Math.round(this.crescendo.t * 10) / 10 : null,
      frenzy: this.frenzy ? Math.round((this.frenzy.dur - this.frenzy.t) * 10) / 10 : null,
      duel: this.duel ? this.duel.stage : null,
      boss: this.boss ? { hp: Math.round(this.boss.hp), hpMax: Math.round(this.boss.hpMax) } : null,
      dawnWave: this.dawnWave ? Math.round(this.dawnWave.t * 10) / 10 : null,
      feeds: this.feedChain,
    };
  }
}
