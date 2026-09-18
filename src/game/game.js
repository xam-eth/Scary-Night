/* LAST NIGHT — game orchestration
 *
 * Owns the run: intro, the night itself, the dawn/dying sequences, results,
 * meta progression and all the little feedback events that glue the systems
 * together (noise, hit feedback, camera shake, messages).
 *
 * Screen flow:
 *   menu -> intro -> playing -> (dying -> death | dawn -> victory) -> menu
 */

import * as Audio from '../core/audio.js';
import { Input } from '../core/input.js';
import { Renderer, Particles, Decals, PAL } from '../core/render.js';
import {
  clamp, lerp, damp, rand, randInt, chance, pick, dist, TAU, fmtClock,
  loadSave, writeSave, Rng,
} from '../core/util.js';
import {
  NIGHT_DURATION, DAWN_AT, COUNTDOWN_AT, SILENCE_AT, PANIC_AT, PLAYER, DOOR, RES,
  phaseAt, DIFFICULTY, TUNING, UPGRADES, upgradeLevel, SHARDS, CODEX,
} from '../core/config.js';
import { Mansion, ROOM } from './mansion.js';
import { Player, PSTATE } from './player.js';
import { Enemy, Crawler, Hunter, Werewolf, Bolt } from './enemies.js';
import { Director, MOOD } from './director.js';
import { drawHUD, drawWorldPrompts } from './hud.js';
import * as UI from '../ui/screens.js';

/* ================= pickups ================= */

/** Bare-handed repair rate: slow, and capped at half of a door's health. */
const PLAYER_HAND_REPAIR = DOOR.repairRate;

class Pickup {
  constructor(x, y, kind, amount) {
    this.x = x; this.y = y; this.kind = kind; this.amount = amount;
    this.t = rand(0, 6);
    this.taken = false;
    this.life = 99999;
    this.bob = rand(0, TAU);
    this.spawnAnim = 0.8;
  }
  update(dt, game) {
    this.t += dt;
    this.spawnAnim = Math.max(0, this.spawnAnim - dt);
    if (this.taken) return;
    const p = game.player;
    if (dist(this.x, this.y, p.x, p.y) < 30) {
      this.taken = true;
      if (this.kind === 'planks') {
        p.planks = Math.min(PLAYER.carryMax + 4, p.planks + this.amount);
        game.audio.play('woodPickup', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.7 });
        game.showCombatText(`+${this.amount} PLANKS`, this.x, this.y - 14, '#c8a05a');
      } else if (this.kind === 'blood') {
        game.player.heal(this.amount, game);
        game.audio.play('bloodPickup', { x: this.x, y: this.y, cam: game.renderer.cam, vol: 0.8 });
        game.showCombatText(`+${Math.round(this.amount)} BLOOD`, this.x, this.y - 14, '#e06070');
        game.particles.burst('blood', this.x, this.y, 10, { color: '#b8202e', speedMin: 10, speedMax: 60, lifeMin: 0.3, lifeMax: 0.8, sizeMin: 2, sizeMax: 4 });
      }
      game.decals.splat(this.x, this.y, 6, 'rgba(90,10,18,0.18)', 2);
    }
  }
  draw(ctx, game) {
    if (this.taken) return;
    const bob = Math.sin(this.t * 2 + this.bob) * 2.5;
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    if (this.spawnAnim > 0) ctx.globalAlpha = 1 - this.spawnAnim / 0.8;
    if (this.kind === 'planks') {
      ctx.rotate(-0.3);
      ctx.fillStyle = '#4a3119';
      for (let i = 0; i < Math.min(this.amount, 3); i++) {
        ctx.save();
        ctx.translate(i * 3 - 3, i * -2);
        ctx.rotate(0.1 * i);
        ctx.fillRect(-10, -4, 20, 8);
        ctx.fillStyle = 'rgba(200,160,100,0.15)';
        ctx.fillRect(-10, -4, 20, 2);
        ctx.fillStyle = '#4a3119';
        ctx.restore();
      }
    } else {
      // a blood vial
      ctx.fillStyle = 'rgba(30,10,14,0.9)';
      ctx.fillRect(-5, -8, 10, 16);
      const g = ctx.createLinearGradient(0, -8, 0, 8);
      g.addColorStop(0, '#c0202e'); g.addColorStop(1, '#5c0a14');
      ctx.fillStyle = g;
      ctx.fillRect(-4, -6, 8, 12);
      ctx.fillStyle = '#8a8070';
      ctx.fillRect(-2.5, -11, 5, 4);
      ctx.fillStyle = 'rgba(255,200,200,0.25)';
      ctx.fillRect(-3, -6, 1.5, 10);
    }
    ctx.restore();
    // faint glint so exploring pays off
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const gg = ctx.createRadialGradient(this.x, this.y + bob, 0, this.x, this.y + bob, 26);
    gg.addColorStop(0, this.kind === 'blood' ? 'rgba(200,30,50,0.30)' : 'rgba(200,160,90,0.22)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(this.x, this.y + bob, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ================= game ================= */

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.input = canvas.__input || (canvas.__input = new Input(canvas));
    this.audio = Audio;
    this.save = loadSave();
    this.screen = 'menu';
    this.settingsReturn = 'menu';
    this.time = 0;
    this.now = 0;
    this.dt = 1 / 60;
    this.timeScale = 1;
    this.nightDuration = NIGHT_DURATION;
    this.timeLeft = NIGHT_DURATION;
    this.phase = phaseAt(0);
    this.danger = 0.06;
    this.threat = 0;
    this.bloodMoon = 0;
    this.blackoutT = 0;
    this.lightningFlash = 0;
    this.powerOut = false;
    this.hbPulse = 0;
    this.heartRate = 0.8;
    this.heartStrength = 0.2;
    this.musicState = { intensity: 0, danger: 0, panic: 0, silence: 0 };
    this.difficulty = DIFFICULTY[this.save.settings.difficulty] || DIFFICULTY.standard;

    this.enemies = [];
    this.bolts = [];
    this.pickups = [];
    this.particles = new Particles(760);
    this.decals = new Decals();
    this.messages = [];
    this.combatTexts = [];
    this.knocks = [];
    this.timeouts = [];
    this.ui = [];
    this.uiIndex = 0;
    this.uiHoverIdx = -1;
    this.usingKeyboard = false;
    this.stats = { kills: 0, doorsSurviving: 4, doorsTotal: 4, closestCall: 0, waveCount: 0, hits: 0 };
    this.shardsEarned = 0;
    this.newRecord = false;
    this.introT = 0;
    this.introLen = 4.6;
    this.deathScreenT = 0;
    this.victoryScreenT = 0;
    this.dawnT = 0;
    this.dyingT = 0;
    this.fadeFromBlack = 1;
    this.countdown = null;
    this.countdownShown = 0;
    this.menuLightning = 0;
    this.menuLightningAt = 4;
    this.nearFire = 0;
    this.interactTarget = null;
    this.repairing = 0;
    this.lastHurtT = -99;
    this.input.touchSeen = this.input.touchSeen || false;
    this.paused = false;
    this.fpsSmooth = 60;
    this.frameCount = 0;
    this.totalEnemiesSpawned = 0;
    this.night = 1;
    this.log = [];

    this.mansion = new Mansion();
    this.player = new Player(620, 1200);
    this.director = new Director();
    this.player.applyUpgrades(this.save);
    this.applySettings();
    this.decals.canvas.getContext('2d');
    window.__LN = this;   // used by the automated playtest harness
  }

  /* ================= save / settings ================= */

  applySettings() {
    const s = this.save.settings;
    this.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.standard;
    this.renderer.shakeEnabled = s.shake > 0.05;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    writeSave(this.save);
  }
  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u) return;
    const lvl = upgradeLevel(this.save, id);
    if (lvl >= u.max) return;
    const cost = u.costs[lvl];
    if (this.save.shards < cost) { this.audio.play('uiBack', { vol: 0.5 }); return; }
    this.save.shards -= cost;
    this.save.upgrades[id] = lvl + 1;
    writeSave(this.save);
    this.audio.play('shard', { vol: 0.8 });
    this.audio.play('uiConfirm', { vol: 0.6 });
    if (this.player) this.player.applyUpgrades(this.save);
  }

  /* ================= scene control ================= */

  setScreen(s, from) {
    if (from) this.settingsReturn = from;
    const prev = this.screen;
    this.screen = s;
    this.uiIndex = 0;
    this.ui = [];
    if (s !== 'playing') this.audio.play('uiClick', { vol: 0.5 });
    if (s === 'settings' || s === 'upgrades' || s === 'collection' || s === 'help') {
      this.settingsReturn = from || (prev === 'paused' ? 'paused' : prev === 'death' ? 'death' : prev === 'victory' ? 'victory' : 'menu');
    }
  }

  togglePause(on) {
    if (this.screen === 'playing' && on !== false) {
      this.paused = true; this.screen = 'paused'; this.ui = []; this.uiIndex = 0;
    } else if (this.screen === 'paused') {
      this.paused = false; this.screen = 'playing';
    }
  }

  toMenu() {
    this.paused = false;
    this.screen = 'menu';
    this.ui = []; this.uiIndex = 0;
    this.enemies.length = 0;
    this.bolts.length = 0;
    this.pickups.length = 0;
    this.particles.list.length = 0;
    this.messages.length = 0;
    this.knocks.length = 0;
    this.audio.setHeartbeat(0, 0);
    this.audio.setAmbienceVolume(1);
    this.audio.resumeAll();
  }

  freshRun() {
    // ---- reset the mansion's dynamic state ----
    for (const e of this.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax;
      e.broken = false; e.open = false; e.barricade = 0;
      e.attackers = 0; e.flash = 0; e.hint = 0; e.repairHold = 0; e.lastTouched = -99;
      if (e.kind === 'window') e.glass = true;
    }
    this.basinUsed = false;
    this.mansion.thresholdBlocked = 0;
    this.decals.ctx.clearRect(0, 0, this.decals.canvas.width, this.decals.canvas.height);
    this.decals.dirty = true;
    // ---- entities ----
    this.enemies.length = 0;
    this.bolts.length = 0;
    this.pickups.length = 0;
    this.particles.list.length = 0;
    this.messages.length = 0;
    this.combatTexts.length = 0;
    this.timeouts.length = 0;
    this.knocks.length = 0;
    // ---- player ----
    this.player = new Player(620, 1210);
    this.player.applyUpgrades(this.save);
    this.player.planks = 2;
    this.player.angle = -Math.PI / 2;
    // ---- director ----
    this.director = new Director();
    // ---- clocks ----
    this.time = TUNING.startAt || 0;
    this.timeLeft = NIGHT_DURATION - this.time;
    this.phase = phaseAt(this.time);
    this.danger = this.phase.danger;
    this.bloodMoon = this.time >= PANIC_AT ? clamp((this.time - PANIC_AT) / 25, 0, 1) : 0;
    this.blackoutT = 0;
    this.lightningFlash = 0;
    this.hbPulse = 0;
    this.countdown = null;
    this.countdownShown = 0;
    this.stats = { kills: 0, doorsSurviving: 4, doorsTotal: 4, closestCall: 0, waveCount: 0, hits: 0, bloodMin: 100 };
    this.shardsEarned = 0;
    this.newRecord = false;
    this.dyingT = 0;
    this.dawnT = 0;
    this.repairing = 0;
    this.lastHurtT = -99;
    this.totalEnemiesSpawned = 0;
    this.log = [];
    // ---- pickups ----
    this.placePickups();
    this.audio.resumeAll();
  }

  placePickups() {
    const m = this.mansion;
    const rooms = [
      { r: ROOM.HALL, planks: 3, blood: 2 },
      { r: ROOM.DINING, planks: 2, blood: 2 },
      { r: ROOM.LIBRARY, planks: 2, blood: 2 },
      { r: ROOM.BASEMENT, planks: 1, blood: 2 },
    ];
    let totalPlanks = 0, totalBlood = 0;
    for (const spec of rooms) {
      const room = m.rooms[spec.r];
      for (let i = 0; i < spec.planks; i++) {
        const p = this.pickSpotInRoom(room);
        if (p) { this.pickups.push(new Pickup(p.x, p.y, 'planks', RES.plankPickup)); totalPlanks++; }
      }
      for (let i = 0; i < spec.blood; i++) {
        const p = this.pickSpotInRoom(room);
        if (p) { this.pickups.push(new Pickup(p.x, p.y, 'blood', RES.bloodPackValue)); totalBlood++; }
      }
    }
  }

  pickSpotInRoom(room) {
    for (let i = 0; i < 40; i++) {
      const x = rand(room.x + 50, room.x + room.w - 50);
      const y = rand(room.y + 50, room.y + room.h - 50);
      if (this.mansion.solidAt(x, y)) continue;
      let ok = true;
      for (const e of this.mansion.entrances) if (dist(x, y, e.x, e.y) < 70) ok = false;
      for (const p of this.pickups) if (dist(x, y, p.x, p.y) < 60) ok = false;
      // not right under the player's nose at the start
      if (dist(x, y, 620, 1210) < 140 && room.id === ROOM.HALL) ok = false;
      if (ok) return { x, y };
    }
    return null;
  }

  beginNight() {
    Audio.unlock().then(() => {
      this.freshRun();
      this.screen = 'intro';
      this.introT = 0;
      this.fadeFromBlack = 1;
      this.renderer.snapCamera(this.player.x, this.player.y);
      Audio.setAmbienceVolume(1);
    });
  }

  /* ================= update ================= */

  update(rawDt) {
    const dt = Math.min(rawDt, 1 / 20);
    this.dt = dt * this.timeScale;
    this.now += rawDt;
    this.fpsSmooth = lerp(this.fpsSmooth, 1 / Math.max(rawDt, 0.0001), 0.05);
    this.ui.length = 0;

    this.input.update(rawDt);
    this.handleUIInput();

    if (this.input.keys.debug && !this._debugHeld) { TUNING.showDebug = !TUNING.showDebug; }
    this._debugHeld = this.input.keys.debug;

    switch (this.screen) {
      case 'menu': this.updateMenu(dt); break;
      case 'settings': case 'upgrades': case 'collection': case 'help': break;
      case 'intro': this.updateIntro(dt); break;
      case 'playing': this.updatePlaying(this.dt); break;
      case 'paused': break;
      case 'dying': this.updateDying(dt); break;
      case 'death': this.deathScreenT += dt; break;
      case 'dawn': this.updateDawn(dt); break;
      case 'victory': this.victoryScreenT += dt; break;
    }

    // global easing
    this.hbPulse = Math.max(0, this.hbPulse - rawDt * 3.4);
    this.lightningFlash = Math.max(0, this.lightningFlash - rawDt * 2.2);
    this.fadeFromBlack = Math.max(0, this.fadeFromBlack - rawDt * 0.9);
    if (this.screen !== 'playing') this.player.anim(rawDt);
    this.particles.update(rawDt);
    for (let i = this.combatTexts.length - 1; i >= 0; i--) {
      const c = this.combatTexts[i];
      c.life -= rawDt; c.y -= rawDt * 18;
      if (c.life <= 0) this.combatTexts.splice(i, 1);
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      msg.t += rawDt;
      if (msg.t > msg.life) this.messages.splice(i, 1);
    }
    for (let i = this.timeouts.length - 1; i >= 0; i--) {
      const to = this.timeouts[i];
      to.t -= rawDt;
      if (to.t <= 0) { to.fn(); this.timeouts.splice(i, 1); }
    }
    // ambience even in menus (a quiet house)
    if (this.screen === 'menu' || this.screen === 'settings' || this.screen === 'upgrades' || this.screen === 'collection' || this.screen === 'help') {
      this.menuAmbience(rawDt);
    }
    if (this.screen === 'death' || this.screen === 'paused' || this.screen === 'victory') {
      Audio.updateAudio(rawDt, { intensity: 0.18, danger: 0.05, panic: 0, wind: 0.3, nearFire: 0, lowBlood: 0, silenceMusic: 0.55 });
    }
  }

  updateMenu(dt) {
    this.menuLightningAt -= dt;
    if (this.menuLightningAt <= 0) {
      this.menuLightningAt = rand(9, 26);
      this.menuLightning = rand(0.18, 0.42);
      this.audio.play('thunder', { vol: 0.35, pan: rand(-0.4, 0.4) });
    }
    this.menuLightning = Math.max(0, this.menuLightning - dt * 1.8);
    this.mansion.update(dt, this);
  }

  menuAmbience(dt) {
    Audio.updateAudio(dt, {
      intensity: 0.3, danger: 0.08, panic: 0, wind: 0.45, nearFire: 0, lowBlood: 0, silenceMusic: 0,
    });
  }

  updateIntro(dt) {
    this.introT += dt;
    this.mansion.update(dt, this);
    if (this.introT > this.introLen || this.input.attackPressed || this.input.interactPressed || this.input.keys.confirm) {
      this.screen = 'playing';
      this.audio.play('uiConfirm', { vol: 0.6 });
      if (!this.save.tutorialSeen) { this.save.tutorialSeen = true; this.showTutorialHints = true; writeSave(this.save); }
    }
  }

  /* ---------------- the night ---------------- */

  updatePlaying(dt) {
    if (TUNING.godMode && this.player.blood < this.player.bloodMax) this.player.blood = this.player.bloodMax;
    // ---- clock ----
    this.time += dt;
    this.timeLeft = Math.max(0, NIGHT_DURATION - this.time);
    const ph = phaseAt(this.time);
    if (ph !== this.phase) this.onPhaseChange(ph);
    this.phase = ph;
    // smoothed danger
    const targetDanger = clamp(ph.danger + this.threat * 0.12, 0, 1.15);
    this.danger = damp(this.danger, targetDanger, 0.7, dt);
    this.bloodMoon = this.time >= PANIC_AT ? clamp((this.time - PANIC_AT) / 25, 0, 1) : 0;
    this.blackoutT = Math.max(0, this.blackoutT - dt);
    this.powerOut = this.blackoutT > 0;

    // ---- world ----
    this.mansion.update(dt, this);
    this.nearFire = clamp(1 - dist(this.player.x, this.player.y, 1120, 636) / 380, 0, 1);
    this.updateBlackoutPressure(dt);

    this.player.update(dt, this);
    this.player.anim(dt);

    // ---- enemies ----
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this);
      if (e.removeMe) this.enemies.splice(i, 1);
    }
    // ---- bolts ----
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.update(dt, this);
      if (b.dead || dist(b.x, b.y, this.player.x, this.player.y) > 2400) this.bolts.splice(i, 1);
    }
    // ---- pickups ----
    for (const p of this.pickups) p.update(dt, this);
    // ---- entrance pressure readout (drives the door panel + audio cues) ----
    for (const e of this.mansion.entrances) {
      let atk = 0;
      for (const en of this.enemies) {
        if (en.dead) continue;
        if (dist(en.x, en.y, e.outside.x, e.outside.y) < 110 || (en.entranceId === e.id && en.state === 'breach')) atk++;
      }
      if (atk > 0 && e.attackers === 0) {
        // first hit on a quiet door: the player should *feel* it through the floor
        if (dist(e.x, e.y, this.player.x, this.player.y) < 1500) {
          this.showMessage(atk > 1 ? `${e.name} IS UNDER ATTACK.` : `${e.name} IS BEING HIT.`, { tone: 'danger', life: 3.2, key: 'entrance:' + e.id });
          this.audio.play('doorHit', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.7 });
        }
      }
      e.attackers = atk;
      e.lastTouched = e.attackers > 0 ? this.time : (e.lastTouched || -99);
    }

    // ---- director ----
    this.director.update(dt, this);
    // keep the HUD knock markers in sync
    this.knocks = this.director.knock ? [this.director.knock] : [];

    // ---- interaction ----
    this.updateInteraction(dt);

    // ---- camera ----
    const p = this.player;
    const lookX = clamp(p.vx * 0.22, -70, 70);
    const lookY = clamp(p.vy * 0.22, -70, 70);
    this.renderer.followCamera(p.x, p.y, dt, lookX, lookY, { x: 20, y: 10, w: 1240, h: 1520 });

    // ---- stats / codex ----
    this.stats.bloodMin = Math.min(this.stats.bloodMin, p.bloodPct * 100);
    for (const e of this.enemies) {
      if (!this.save.seen[e.key]) { this.save.seen[e.key] = true; }
    }

    // ---- win / lose ----
    if (this.time >= DAWN_AT) this.beginDawn();
    if (this.player.state === PSTATE.DEAD) this.beginDying();
  }

  updateBlackoutPressure(dt) {
    if (this.blackoutT > 0.4 && !this.blackoutWarned) {
      this.blackoutWarned = true;
      // in the dark they move faster and see further; the player does not
      for (const e of this.enemies) e.speedMul = Math.min(1.45, e.speedMul * 1.12);
    }
    if (this.blackoutT <= 0 && this.blackoutWarned) {
      this.blackoutWarned = false;
      this.showMessage('THE LIGHTS COME BACK.', { tone: 'calm' });
    }
  }

  onPhaseChange(ph) {
    this.log.push(`${this.time.toFixed(1)}:${ph.id}`);
    const banners = {
      warning: null,
      pressure: 'THEY KNOW YOU ARE HERE',
      heavy: 'THE HOUSE IS WAKING UP',
      final: 'DAWN IN 60 SECONDS',
      panic: 'PANIC',
      silence: null,
    };
    if (banners[ph.id]) this.showBanner(banners[ph.id], ph.id === 'panic' ? 2.6 : 3.2);
    if (ph.id === 'final') this.audio.play('stinger', { vol: 0.5, det: 0 });
    if (ph.id === 'panic') {
      this.audio.play('bell', { vol: 0.55, base: 165 });
      this.renderer.shake(0.5);
      this.showMessage('THEY ARE ALL COMING NOW.', { tone: 'danger' });
    }
    if (ph.id === 'silence') {
      this.audio.play('bell', { vol: 0.4, base: 220 });
      this.showMessage('HOLD ON.', { tone: 'cold' });
    }
  }

  showCountdown(n) {
    this.countdown = { n, t: 0 };
    this.audio.play('bell', { vol: 0.5, base: 300 + (5 - n) * 22 });
    this.renderer.addFlash(0.06, '#e8d8b0');
  }

  /* ---------------- interaction ---------------- */

  updateInteraction(dt) {
    const p = this.player;
    this.interactTarget = null;
    const input = this.input;
    let best = null, bestD = 1e9;
    for (const e of this.mansion.entrances) {
      const d = Math.min(
        dist(p.x, p.y, e.x, e.y),
        dist(p.x, p.y, e.inside.x, e.inside.y),
      );
      if (d < 96 && d < bestD) { bestD = d; best = e; }
    }
    // basin
    const basin = this.mansion.props.find((pr) => pr.type === 'basin');
    const basinD = basin ? dist(p.x, p.y, basin.x, basin.y) : 1e9;

    if (best && bestD < 96) {
      const e = best;
      const actions = [];
      const canOpen = e.kind === 'door' && !e.broken;
      if (canOpen) actions.push({ key: 'E', label: e.open ? 'CLOSE' : (e.id === 'frontDoor' ? 'OPEN THE DOOR' : 'OPEN'), act: 'open' });
      const canRepair = e.hp < e.hpMax || e.broken;
      if (canRepair) {
        const planksNeeded = p.planks > 0 ? 1 : 0;
        actions.push({ key: 'R', label: 'REPAIR', cost: planksNeeded, act: 'repair' });
      }
      if (p.planks >= DOOR.barricadePlanks && e.barricade < 2) {
        actions.push({ key: 'B', label: 'BARRICADE', cost: DOOR.barricadePlanks, act: 'barricade' });
      }
      this.interactTarget = { ent: e, actions, dist: bestD };
      // ---- act ----
      if (input.interactPressed) {
        if (canOpen) this.toggleDoor(e);
        else this.showCombatText('NOTHING TO OPEN', e.x, e.y - 30, '#9a9488');
      }
      if (input.barricadePressed) this.doBarricade(e);
      if (input.repairDown) this.doRepair(dt, e);
      else if (e.repairHold) e.repairHold = 0;
    } else if (basin && basinD < 70) {
      this.interactTarget = {
        ent: { x: basin.x, y: basin.y, name: 'BLOOD BASIN', w: 120, h: 120, facing: 'south', hp: 1, hpMax: 1, barricade: 0 },
        actions: this.basinUsed ? [] : [{ key: 'E', label: 'DRINK DEEPLY', act: 'drink' }],
        dist: basinD,
      };
      if (!this.basinUsed && input.interactPressed) this.startDrink(basin);
    }

    // contextual mobile buttons
    const touching = input.touchSeen;
    input.buttons.repair.hidden = !touching || !this.interactTarget;
    input.buttons.barricade.hidden = !touching || !this.interactTarget
      || !this.interactTarget.actions.some((a) => a.act === 'barricade');
  }

  toggleDoor(e) {
    const p = this.player;
    if (e.broken) return;
    e.open = !e.open;
    this.audio.play(e.open ? 'doorHit' : 'doorHit', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.55 });
    this.showCombatText(e.open ? 'OPEN' : 'CLOSED', e.x, e.y - 30, '#c8bfa8');
    // opening the door while something is knocking answers it
    if (e.open && this.director.knock && this.director.knock.entranceId === e.id) {
      const k = this.director.resolveKnock(this, e);
      this.onKnockAnswered(k, e);
    } else if (e.open) {
      // opening a door makes noise, and lets whatever is out there in
      this.makeNoise(e.x, e.y, 420);
      const waiting = this.enemies.find((en) => !en.dead && !en.insideHouse &&
        dist(en.x, en.y, e.outside.x, e.outside.y) < 130);
      if (waiting) {
        this.showMessage('SOMETHING WAS STANDING RIGHT THERE.', { tone: 'danger' });
        this.director.spawnWave(this, [waiting.key], { entranceId: e.id });
        // remove the old one to avoid duplicates
        waiting.dead = true; waiting.removeMe = true;
      }
    }
  }

  /**
   * The player opened (or ignored) a door something was knocking on. The whole
   * point of the system is that the answer is not immediate, so this only
   * handles the surface reaction: a creak, a held breath, a line of text.
   * The outcome itself lands a beat later, from the director.
   */
  onKnockAnswered(k, e) {
    if (!k) return;
    if (!this.save.seen.knock) { this.save.seen.knock = true; writeSave(this.save); }
    this.audio.play('creak', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.75 });
    this.makeNoise(e.x, e.y, 260);
    if (k.opened) {
      this.showMessage('THE DARK BEYOND THE DOOR IS PATIENT.', { tone: 'cold', life: 3.2 });
      this.particles.burst('mist', e.outside.x, e.outside.y, 10, {
        color: 'rgba(110,120,150,0.16)', sizeMin: 12, sizeMax: 26, speedMin: 6, speedMax: 26, lifeMin: 0.5, lifeMax: 1.2,
      });
    }
  }

  doRepair(dt, e) {
    const p = this.player;
    if (e.hp >= e.hpMax && !e.broken) return;
    const cap = e.barricade > 0 ? e.hpMax : e.baseHpMax;
    if (e.hp >= cap && !e.broken) return;
    e.repairHold = (e.repairHold || 0) + dt;
    this.repairing = 1;
    // planks accelerate repairs massively; hands are slow and capped at half
    const usingPlanks = p.planks > 0 && e.hp < e.hpMax;
    const rate = (usingPlanks ? 38 : PLAYER_HAND_REPAIR) * p.repairMul;
    const prev = e.hp;
    e.hp = Math.min(cap, e.hp + rate * dt);
    if (e.hp > 0) e.broken = false;
    if (usingPlanks) {
      p.plankProgress = (p.plankProgress || 0) + (e.hp - prev);
      if (p.plankProgress >= DOOR.plankRepair) {
        p.plankProgress -= DOOR.plankRepair;
        p.planks = Math.max(0, p.planks - 1);
        this.audio.play('repair', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.5 });
      }
    } else if (chance(dt * 3)) {
      this.audio.play('stepCreak', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.3 });
    }
    if (e.hp - prev > 0 && chance(dt * 6)) {
      this.particles.burst('dust', e.x + rand(-20, 20), e.y + rand(-14, 14), 2, {
        color: 'rgba(150,130,100,0.3)', sizeMin: 2, sizeMax: 5, speedMin: 5, speedMax: 25, lifeMin: 0.3, lifeMax: 0.7,
      });
    }
  }

  doBarricade(e) {
    const p = this.player;
    if (e.barricade >= 2) { this.showCombatText('ALREADY BARRICADED', e.x, e.y - 30, '#9a9488'); return; }
    if (p.planks < DOOR.barricadePlanks) {
      this.showCombatText(`NEED ${DOOR.barricadePlanks} PLANKS`, e.x, e.y - 30, '#c05a5a');
      this.audio.play('uiBack', { vol: 0.4 });
      return;
    }
    p.planks -= DOOR.barricadePlanks;
    this.mansion.barricadeEntrance(e, this);
    this.audio.play('build', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.8 });
    this.audio.play('woodPickup', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.5 });
    this.showCombatText('BARRICADED', e.x, e.y - 30, '#c8a05a');
    this.makeNoise(e.x, e.y, 300);
    this.particles.burst('splinter', e.x, e.y, 10, {
      color: 'rgba(110,80,45,0.8)', sizeMin: 2, sizeMax: 4, speedMin: 20, speedMax: 80, lifeMin: 0.3, lifeMax: 0.7, grav: 120, spin: 5,
    });
  }

  startDrink(basin) {
    this.player.state = PSTATE.DRINK;
    this.player.drinking = 0;
    this.audio.play('drink', { vol: 0.7 });
  }

  finishDrink(basin) {
    const p = this.player;
    this.basinUsed = true;
    p.heal(RES.bloodWellValue, this);
    this.audio.play('bloodPickup', { vol: 0.9 });
    this.showMessage('THE BLOOD IS OLD. IT TASTES LIKE THE HOUSE.', { tone: 'cold' });
    this.particles.burst('blood', basin.x, basin.y, 20, { color: '#a01020', speedMin: 20, speedMax: 90, lifeMin: 0.4, lifeMax: 1.1, sizeMin: 2, sizeMax: 5 });
    this.renderer.shake(0.3);
    // high risk, high reward: the house notices
    this.timeouts.push({
      t: 1.6, fn: () => {
        this.showMessage('SOMETHING HEARD YOU DOWN HERE.', { tone: 'danger' });
        this.director.spawnWave(this, ['werewolf'], { entranceId: 'cellarDoor', reveal: true });
        this.audio.play('werewolfReveal', { vol: 0.7 });
        this.renderer.shake(0.7);
      },
    });
  }

  /* ---------------- feedback events ---------------- */

  makeNoise(x, y, radius) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, x, y);
      if (d < radius) {
        if (e.seenPlayer <= 0) {
          e.lastKnown = { x: x, y: y };
          e.seenPlayer = Math.max(e.seenPlayer, 1.4);
          e.aggro = Math.min(1, e.aggro + 0.5);
          e.pathT = 0;
        }
      }
    }
  }

  onPlayerStep(running) {
    const p = this.player;
    this.audio.play('footstep', { x: p.x, y: p.y, cam: this.renderer.cam, vol: running ? 0.65 : 0.32, soft: !running });
    // footprints
    if (chance(0.6)) this.decals.print(p.x - Math.cos(p.angle) * 6, p.y - Math.sin(p.angle) * 6, p.angle, 'rgba(70,8,14,0.20)', 5);
    // running is loud
    if (running) {
      this.makeNoise(p.x, p.y, 380);
      if (chance(0.25)) this.audio.play('stepCreak', { x: p.x, y: p.y, cam: this.renderer.cam, vol: 0.5 });
    } else this.makeNoise(p.x, p.y, 130);
  }

  onPlayerHurt(dmg, fromX, fromY, kind) {
    const p = this.player;
    this.lastHurtT = this.time;
    this.stats.hits++;
    this.stats.closestCall = Math.max(this.stats.closestCall, 1 - p.bloodPct);
    this.audio.play('playerHurt', { vol: 0.85 });
    this.audio.play('hitFlesh', { vol: 0.6 });
    this.renderer.shake(clamp(0.22 + dmg * 0.012, 0.2, 0.8));
    this.renderer.addFlash(clamp(dmg * 0.016, 0.05, 0.28), '#8a0a14');
    this.particles.burst('blood', p.x, p.y, 12 + Math.round(dmg * 0.5), {
      color: '#9c1420', speedMin: 30, speedMax: 140, lifeMin: 0.3, lifeMax: 0.9, sizeMin: 2, sizeMax: 4.5,
      angle: fromX !== undefined ? Math.atan2(p.y - fromY, p.x - fromX) : undefined, spread: 0.8,
    });
    this.decals.splat(p.x, p.y + 4, 12, 'rgba(96,12,20,0.42)', 4);
    this.hbPulse = 1;
    this.showCombatText(`-${Math.round(dmg)}`, p.x + rand(-8, 8), p.y - 22, '#ff6a6a');
    this.audio.duck(0.55, 0.7);
  }

  onBloodGained(amount) {
    if (amount > 4) this.audio.play('drink', { vol: 0.4 });
  }

  enemyHitPlayer(enemy, amount, kind) {
    const p = this.player;
    if (!p.alive) return;
    enemy.lastPlayerHitT = this.time;
    const ok = p.takeDamage(amount, this, enemy.x, enemy.y, kind);
    if (ok) {
      this.audio.play(kind === 'bolt' ? 'boltImpact' : 'slash', { x: enemy.x, y: enemy.y, cam: this.renderer.cam, vol: 0.6 });
    }
  }

  playerAttackHit(player) {
    const arc = PLAYER.attackArc;
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, player.x, player.y);
      if (d > PLAYER.attackRange + e.radius) continue;
      const a = Math.atan2(e.y - player.y, e.x - player.x);
      let diff = Math.abs(((a - player.swingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > arc / 2) continue;
      const dmg = PLAYER.attackDamage * player.damageMul;
      e.hurt(dmg, this, player.x, player.y);
      hits++;
      // knockback
      const kb = e.key === 'werewolf' ? 30 : 110;
      e.vx += Math.cos(a) * kb; e.vy += Math.sin(a) * kb;
    }
    this.stats.clawSwings = (this.stats.clawSwings || 0) + 1;
    this.stats.clawHits = (this.stats.clawHits || 0) + hits;
    if (hits) {
      this.renderer.shake(0.16 + hits * 0.04);
      this.audio.play('hitFlesh', { vol: 0.5 });
      this.renderer.addFlash(0.04, '#ffffff');
    }
    // clawing is loud
    this.makeNoise(player.x, player.y, 360);
  }

  onEnemyKilled(enemy) {
    const p = this.player;
    this.stats.kills++;
    const gain = enemy.type.bloodValue * p.recoveryMul;
    p.heal(gain, this);
    this.showCombatText(`+${Math.round(gain)} BLOOD`, enemy.x, enemy.y - 20, '#e06070');
    this.audio.play('growl', { x: enemy.x, y: enemy.y, cam: this.renderer.cam, vol: 0.35 });
    this.particles.burst('blood', enemy.x, enemy.y, 22, {
      color: '#8a1020', speedMin: 40, speedMax: 190, lifeMin: 0.3, lifeMax: 1.1, sizeMin: 2, sizeMax: 5.5, grav: 100,
    });
    this.particles.burst('mist', enemy.x, enemy.y, 6, { color: 'rgba(80,10,20,0.25)', sizeMin: 8, sizeMax: 22, lifeMin: 0.4, lifeMax: 1.0, speedMin: 5, speedMax: 30 });
    this.decals.splat(enemy.x, enemy.y + 4, 16, 'rgba(88,10,18,0.5)', 6);
    if (!this.save.seen[enemy.key]) { this.save.seen[enemy.key] = true; writeSave(this.save); }
    if (enemy.key === 'werewolf') {
      this.renderer.shake(0.5);
      this.audio.play('stinger', { vol: 0.5 });
      this.showMessage('THE WEREWOLF FALLS. IT WILL NOT STAY DOWN LONG.', { tone: 'cold' });
    }
  }

  damageEntrance(e, amount, source) {
    if (e.broken) return;
    const before = e.hp;
    this.mansion.damageEntrance(e, amount, this, source ? source.x : undefined, source ? source.y : undefined);
    e.lastTouched = this.time;
    if (e.attackers <= 0 || before > 0) { /* keep */ }
  }

  onEntranceHit(e, amount) {
    this.audio.play(e.kind === 'window' && e.hp <= 0 ? 'glassBreak' : 'doorHit', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.9 });
    const horiz = e.axis === 'h';
    this.particles.burst('splinter', e.x + rand(-e.w / 2, e.w / 2), e.y + rand(-e.h / 2, e.h / 2), 6, {
      color: 'rgba(120,88,50,0.85)', sizeMin: 1.5, sizeMax: 3.5, speedMin: 20, speedMax: 90, lifeMin: 0.25, lifeMax: 0.7, grav: 140, spin: 6,
      angle: e.facing === 'south' ? -Math.PI / 2 : e.facing === 'north' ? Math.PI / 2 : e.facing === 'east' ? Math.PI : 0, spread: 1.2,
    });
    if (dist(e.x, e.y, this.player.x, this.player.y) < 700) {
      this.renderer.shake(clamp(amount * 0.012, 0.06, 0.35));
      this.audio.duck(0.75, 0.4);
      // the attacker count drives the door HUD readout
    }
  }

  onEntranceBreak(e) {
    this.audio.play('doorBreak', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 1.05 });
    this.audio.play('impact', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.8 });
    this.renderer.shake(DOOR.breakShake);
    this.audio.duck(0.35, 1.6);
    this.particles.burst('splinter', e.x, e.y, 26, {
      color: 'rgba(120,88,50,0.9)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 200, lifeMin: 0.4, lifeMax: 1.2, grav: 190, spin: 8,
    });
    this.particles.burst('dust', e.x, e.y, 18, { color: 'rgba(140,130,115,0.4)', sizeMin: 5, sizeMax: 16, speedMin: 20, speedMax: 70, lifeMin: 0.6, lifeMax: 1.6 });
    this.decals.splat(e.x, e.y, 20, 'rgba(40,30,20,0.35)', 6);
    this.showMessage(`${e.name} GIVES WAY.`, { tone: 'danger' });
    this.makeNoise(e.x, e.y, 900);
    this.hbPulse = 1;
  }

  onEntranceOpened(e, enemy) {
    e.lastTouched = this.time;
  }

  onWaveIncoming(spawned, ent) {
    this.stats.waveCount++;
    const types = new Set(spawned.map((s) => s.key));
    if (types.has('werewolf')) {
      this.showMessage('SOMETHING HEAVY IS WALKING AROUND THE HOUSE.', { tone: 'danger' });
    } else if (types.has('hunter')) {
      this.showMessage('A LANTERN, MOVING THROUGH THE TREES.', { tone: 'cold' });
    } else if (chance(0.5)) {
      this.showMessage('FOOTSTEPS. SEVERAL OF THEM.', { tone: 'cold' });
    }
  }

  onKnockScheduled(k, ent) {
    // the first knock of the night gets a smell of narrative
    if (!this.save.seen.knock) {
      this.showMessage('KNOCKING. FROM THE OTHER SIDE.', { tone: 'cold' });
    }
  }

  onKnockSound(e, k) {
    e.lastTouched = this.time;
    if (k.knockCount === 3) this.showMessage('IT IS GETTING IMPATIENT.', { tone: 'cold' });
  }

  onEnemyEntered(e) {
    e.lastTouched = this.time;
    if (e.key === 'werewolf') this.renderer.shake(0.4);
  }

  onEnemyGivesUp(e) {
    if (dist(e.x, e.y, this.player.x, this.player.y) < 420) {
      this.showMessage('THE SHUFFLING MOVES AWAY.', { tone: 'calm', life: 3 });
    }
  }

  onWerewolfRoar(e) {
    this.renderer.shake(0.3);
    if (dist(e.x, e.y, this.player.x, this.player.y) < 700) this.hbPulse = 0.8;
  }

  onMoodChange(mood) {
    this.log.push(`${this.time.toFixed(1)}:mood=${mood}`);
  }

  dropChandelier() {
    const l = this.mansion.lights.find((x) => x.type === 'chandelier');
    if (!l) return;
    l.i = 0.12;  // the hall is darker for the rest of the night
    l.r = 90;
    this.audio.play('chandelier', { x: l.x, y: l.y, cam: this.renderer.cam, vol: 1 });
    this.renderer.shake(1.2);
    this.audio.duck(0.3, 2);
    this.renderer.addFlash(0.1, '#ffd090');
    this.particles.burst('shard', l.x, l.y, 40, {
      color: 'rgba(190,215,245,0.9)', sizeMin: 2, sizeMax: 6, speedMin: 60, speedMax: 260, lifeMin: 0.5, lifeMax: 1.6, grav: 220, spin: 10,
    });
    this.particles.burst('glow', l.x, l.y, 20, { color: 'rgba(255,190,110,0.7)', sizeMin: 6, sizeMax: 18, lifeMin: 0.4, lifeMax: 1.2, speedMin: 20, speedMax: 90 });
    // it kills whatever is underneath
    for (const e of this.enemies) {
      if (!e.dead && dist(e.x, e.y, l.x, l.y) < 150) {
        e.hurt(999, this, l.x, l.y);
      }
    }
    this.showMessage('THE CHANDELIER COMES DOWN.', { tone: 'danger' });
    this.decals.splat(l.x, l.y, 40, 'rgba(30,25,20,0.3)', 8);
  }

  /* ---------------- messages ---------------- */

  showMessage(text, { tone = 'cold', whisper = false, life = 4.4, key = null } = {}) {
    // door/window warnings repeat constantly: collapse them so the screen stays
    // readable instead of stacking "X IS UNDER ATTACK." three times
    if (key) {
      const prev = this.messages.find((m) => m.key === key);
      if (prev) {
        prev.text = text;
        prev.t = 0;
        prev.life = life;
        prev.tone = tone;
        return;
      }
      if (text.includes('IS UNDER ATTACK')) {
        const other = this.messages.find((m) => m.text.includes('IS UNDER ATTACK'));
        if (other) {
          const n = (other.attackN || 1) + 1;
          other.attackN = n;
          other.text = n > 1 ? 'THE ENTRANCES ARE TAKING HITS.' : text;
          other.t = 0;
          other.life = life;
          other.tone = 'danger';
          other.key = key;
          return;
        }
      }
    }
    this.messages.push({ text, tone, whisper, t: 0, life, key });
    if (this.messages.length > 3) this.messages.shift();
  }

  showBanner(text, life = 3) {
    this.banner = { text, t: 0, life };
    this.audio.play('stinger', { vol: 0.35, det: 0.01 });
  }

  showCombatText(text, x, y, color) {
    if (!text) return;
    this.combatTexts.push({ text, x, y, color, life: 0.9 });
  }

  spawnBolt(owner, angle) {
    const b = new Bolt(
      owner.x + Math.cos(angle) * 22,
      owner.y + Math.sin(angle) * 22,
      angle, owner.type.boltSpeed, owner.type.boltDamage, owner,
    );
    this.bolts.push(b);
    this.audio.play('crossbow', { x: owner.x, y: owner.y, cam: this.renderer.cam, vol: 0.85 });
    this.showCombatText('!', owner.x, owner.y - 30, '#e8c060');
  }

  addPickup(x, y, kind, amount) {
    this.pickups.push(new Pickup(x, y, kind, amount));
  }

  addBloodShards(n) { this.save.shards += n; this.save.totalShards = (this.save.totalShards || 0) + n; }

  /* ---------------- death ---------------- */

  killPlayer(reason) {
    if (this.player.state === PSTATE.DEAD) return;
    this.player.die(this);
    this.deathReason = reason;
  }

  beginDying() {
    if (this.screen === 'dying') return;
    this.screen = 'dying';
    this.dyingT = 0;
    this.deathScreenT = 0;
    this.audio.setHeartbeat(0.6, 0.3);
    this.audio.play('death', { vol: 0.9 });
    this.audio.duck(0.25, 3);
    this.showMessage('', {});
    this.messages.length = 0;
    // the night keeps its stats
    this.finalizeShards(this.time);
    this.save.nightsAttempted = (this.save.nightsAttempted || 0) + 1;
    this.save.bestTime = Math.max(this.save.bestTime, this.time);
    const kills = this.stats.kills;
    if (this.save.bestDefeated === undefined || kills > this.save.bestDefeated) this.save.bestDefeated = kills;
    this.addBloodShards(this.shardsEarned);
    writeSave(this.save);
  }

  updateDying(dt) {
    this.dyingT += dt;
    this.timeScale = lerp(this.timeScale, 0.12, dt * 0.6);
    const d = this.dt;
    this.mansion.update(d, this);
    for (const e of this.enemies) { e.update(d, this); }
    this.player.update(d, this);
    this.player.anim(d);
    this.director.updateAudioState(dt, this);
    // the camera drifts up and away
    this.renderer.followCamera(this.player.x, this.player.y - this.dyingT * 8, dt, 0, 0, { x: 20, y: 10, w: 1240, h: 1520 });
    if (this.dyingT > 4.2) {
      this.screen = 'death';
      this.deathScreenT = 0;
      this.timeScale = 1;
      this.audio.setHeartbeat(0, 0);
      writeSave(this.save);
    }
  }

  finalizeShards(survived) {
    const mins = survived / 60;
    let s = Math.floor(mins * SHARDS.perMinute);
    if (survived >= NIGHT_DURATION) s += SHARDS.surviveBonus;
    s += Math.floor((this.stats.kills / 10) * SHARDS.defeatBonusPer10);
    this.shardsEarned = Math.max(0, s);
    return this.shardsEarned;
  }

  /* ---------------- dawn ---------------- */

  beginDawn() {
    if (this.screen === 'dawn') return;
    this.screen = 'dawn';
    this.dawnT = 0;
    this.audio.setHeartbeat(0, 0);
    this.audio.play('dawnChime', { vol: 0.7 });
    this.audio.duck(0.2, 4);
    this.messages.length = 0;
    this.knocks.length = 0;
    if (this.director.knock) this.director.knock = null;
    // everything outside turns to ash
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.dead = true; e.state = 'dying'; e.deathT = 0; e.ash = true;
      this.particles.burst('glow', e.x, e.y, 16, { color: 'rgba(220,190,150,0.7)', sizeMin: 4, sizeMax: 14, lifeMin: 0.5, lifeMax: 1.6, speedMin: 10, speedMax: 50 });
      this.particles.burst('dust', e.x, e.y, 20, { color: 'rgba(120,110,100,0.5)', sizeMin: 4, sizeMax: 12, lifeMin: 0.6, lifeMax: 1.8, speedMin: 20, speedMax: 60 });
    }
    this.showMessage('THE SUN IS COMING UP.', { tone: 'warm' });
    // results
    this.finalizeShards(NIGHT_DURATION);
    this.save.nightsSurvived++;
    this.save.nightsAttempted = (this.save.nightsAttempted || 0) + 1;
    this.newRecord = NIGHT_DURATION > this.save.bestTime;
    this.save.bestTime = Math.max(this.save.bestTime, NIGHT_DURATION);
    this.save.seen.dawn = true;
    this.addBloodShards(this.shardsEarned);
    this.stats.doorsSurviving = this.mansion.doors.filter((d) => !d.broken).length;
    this.stats.doorsTotal = this.mansion.doors.length;
    writeSave(this.save);
  }

  updateDawn(dt) {
    this.dawnT += dt;
    this.mansion.update(dt, this);
    this.player.update(dt, this);
    this.player.anim(dt);
    this.renderer.followCamera(this.player.x, this.player.y, dt, 0, 0, { x: 20, y: 10, w: 1240, h: 1520 });
    if (this.dawnT > 5.6) {
      this.screen = 'victory';
      this.victoryScreenT = 0;
    }
  }

  /* ================= render ================= */

  render() {
    const r = this.renderer;
    const ctx = r.ctx;
    const w = r.w, h = r.h;

    r.clear(PAL.void);

    if (this.screen === 'menu') {
      r.resetForUI();
      UI.drawMenu(this, ctx, w, h);
      if (this.fadeFromBlack > 0) {
        ctx.fillStyle = `rgba(0,0,0,${this.fadeFromBlack})`;
        ctx.fillRect(0, 0, w, h);
      }
      return;
    }

    // ---- the world is drawn for every in-run screen (so pause/death keep it) ----
    const gameVisible = ['playing', 'paused', 'intro', 'dying', 'dawn', 'settings', 'upgrades', 'collection', 'help'].includes(this.screen);
    if (gameVisible) r.beginWorld();
    if (gameVisible) this.renderWorld(dtSafe(this));
    r.resetForUI();

    // ---- HUD ----
    if (this.screen === 'playing' || this.screen === 'dying') {
      if (this.screen === 'playing') drawHUD(this, ctx, w, h);
      this.drawMessages(ctx, w, h);
    }

    // ---- screens ----
    switch (this.screen) {
      case 'intro': UI.drawIntro(this, ctx, w, h); break;
      case 'paused': UI.drawPause(this, ctx, w, h); break;
      case 'settings': UI.drawSettings(this, ctx, w, h); break;
      case 'upgrades': UI.drawUpgrades(this, ctx, w, h); break;
      case 'collection': UI.drawCollection(this, ctx, w, h); break;
      case 'help': UI.drawHelp(this, ctx, w, h); break;
      case 'death': UI.drawDeath(this, ctx, w, h); break;
      case 'victory': UI.drawVictory(this, ctx, w, h); break;
    }
    if (this.screen === 'playing') UI.drawTutorial(this, ctx, w, h);
    if (TUNING.showDebug) this.drawDebug(ctx, w, h);

    // fade from black on run start
    if (this.fadeFromBlack > 0.001) {
      ctx.fillStyle = `rgba(0,0,0,${this.fadeFromBlack})`;
      ctx.fillRect(0, 0, w, h);
    }
    // low blood wash over everything
    if (this.screen === 'playing' || this.screen === 'dying') {
      const lb = clamp(1 - this.player.bloodPct / 0.3, 0, 1);
      if (lb > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, h * 0.8);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(110,0,10,${0.22 * lb})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }

  renderWorld(dt) {
    const r = this.renderer;
    const ctx = r.ctx;
    const m = this.mansion;
    const p = this.player;
    const t = this.time;

    // ---------- baked architecture ----------
    m.drawFloor(ctx);
    // ---------- decals ----------
    this.decals.draw(ctx);
    // ---------- props under entities ----------
    m.drawProps(ctx, this);
    // ---------- dust motes ----------
    this.drawAmbientMotes(ctx);
    // ---------- pickups ----------
    for (const pk of this.pickups) pk.draw(ctx, this);

    // ---------- entities (sorted by y for a pseudo-3D read) ----------
    const ents = [];
    for (const e of this.enemies) ents.push(e);
    ents.sort((a, b) => (a.y - b.y));
    // enemies under the player if further up the screen
    let playerDrawn = false;
    for (const e of ents) {
      if (!playerDrawn && e.y > p.y) { this.drawPlayerLayer(ctx); playerDrawn = true; }
      if (!r.isVisible(e.x, e.y, 120)) continue;
      e.draw(ctx, this);
    }
    if (!playerDrawn) this.drawPlayerLayer(ctx);

    // ---------- bolts ----------
    for (const b of this.bolts) if (r.isVisible(b.x, b.y, 60)) b.draw(ctx);

    // ---------- furniture + architecture above the floor ----------
    m.drawFurniture(ctx, this);
    m.drawEntrances(ctx, this);
    m.drawLightFixtures(ctx, this);

    // ---------- particles ----------
    this.particles.draw(ctx);

    // ---------- the shadow that is not quite there ----------
    if (this.director.shadow) {
      const s = this.director.shadow;
      ctx.save();
      ctx.globalAlpha = s.a * 0.5;
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.fillStyle = '#04050a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 26, 11, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(20, 0, 9, 8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = s.a * 0.5;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 60);
      g.addColorStop(0, 'rgba(90,80,120,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, 60, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---------- lighting ----------
    r.lightBegin(m.ambientFor(this));
    p.submitLight(r, this);
    m.submitLights(r, this);
    for (const e of this.enemies) {
      if (e.submitLight && !e.dead && r.isVisible(e.x, e.y, 220)) e.submitLight(r, this);
    }
    // muzzle flashes / impacts
    for (const b of this.bolts) r.addLight(b.x, b.y, 70, 0.3, [255, 220, 170]);
    r.lightEnd();

    // ---------- warm additive pass ----------
    r.glowBegin();
    for (const l of m.lights) {
      const i = (l.curI ?? l.i) * 0.5;
      if (i <= 0.02) continue;
      const g = this.renderer.ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.8);
      const c = this.bloodMoon > 0.4 ? [255, 120, 90] : l.color;
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.10 * i})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this.renderer.ctx.fillStyle = g;
      this.renderer.ctx.beginPath(); this.renderer.ctx.arc(l.x, l.y, l.r * 0.8, 0, TAU); this.renderer.ctx.fill();
    }
    r.glowEnd();

    // ---------- fog ----------
    r.drawFog(Math.max(0.0001, 1 / 60), 0.8 + this.danger * 0.5);

    // ---------- post ----------
    const lb = clamp(1 - p.bloodPct / 0.32, 0, 1);
    r.post({
      vignette: 0.5 + this.danger * 0.35 + (this.bloodMoon) * 0.2,
      danger: this.danger,
      lowBlood: lb,
      heartbeat: this.hbPulse,
      blackout: this.screen === 'dying' ? clamp(this.dyingT / 4, 0, 0.8) : 0,
      time: this.now,
    });

    // ---------- dawn light wash ----------
    if (this.screen === 'dawn') {
      const k = clamp(this.dawnT / 3.5, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, 0, 0, this.renderer.h);
      g.addColorStop(0, `rgba(255,196,120,${0.35 * k})`);
      g.addColorStop(0.6, `rgba(220,140,110,${0.16 * k})`);
      g.addColorStop(1, `rgba(120,80,90,${0.1 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.renderer.w, this.renderer.h);
      if (this.dawnT > 2.6) {
        ctx.globalAlpha = clamp((this.dawnT - 2.6) / 2.2, 0, 1);
        ctx.fillStyle = '#000';
        // hold the frame, then fade to the results
      }
      ctx.restore();
      if (this.dawnT > 3.4) {
        ctx.save();
        ctx.globalAlpha = clamp((this.dawnT - 3.4) / 2.0, 0, 1);
        ctx.fillStyle = 'rgba(2,3,6,1)';
        ctx.fillRect(0, 0, this.renderer.w, this.renderer.h);
        ctx.restore();
      }
    }
  }

  /** The vampire is drawn in the entity sort so enemies can occlude it. */
  drawPlayerLayer(ctx) {
    this.player.draw(ctx, this);
    if (this.screen === 'playing' || this.screen === 'dying' || this.screen === 'intro') drawWorldPrompts(this, ctx);
  }

  drawAmbientMotes(ctx) {
    // slow drifting dust, only in the room the player is in
    const p = this.player;
    const r = this.renderer;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 26; i++) {
      const seed = i * 37.1;
      const room = this.mansion.findRoom(p.x, p.y);
      if (room === ROOM.OUTSIDE) break;
      const rm = this.mansion.rooms[room];
      const x = rm.x + ((seed * 7.3 + this.now * (6 + i % 5)) % rm.w);
      const y = rm.y + ((seed * 3.7 + Math.sin(this.now * 0.4 + i) * 40 + rm.h * 0.5) % rm.h);
      if (!r.isVisible(x, y, 40)) continue;
      const a = 0.05 + 0.09 * Math.abs(Math.sin(this.now * 1.4 + i));
      ctx.fillStyle = `rgba(200,210,235,${a})`;
      ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.7, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawMessages(ctx, w, h) {
    const msgs = this.messages;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = h * 0.72;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const inA = clamp(m.t / 0.5, 0, 1);
      const outA = clamp((m.life - m.t) / 0.8, 0, 1);
      const a = inA * outA;
      const tone = m.tone === 'danger' ? '#e2685c' : m.tone === 'warm' ? '#e0c48a' : m.tone === 'calm' ? '#a8b0c0' : '#cfc6b0';
      const lines = String(m.text).split('\n');
      ctx.globalAlpha = a * (m.whisper ? 0.75 : 0.95);
      ctx.font = `${m.whisper ? 'italic ' : ''}500 ${m.whisper ? 15 : 14}px ${m.whisper ? 'Georgia, serif' : '"Segoe UI", Roboto, sans-serif'}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillStyle = tone;
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 10;
      for (let l = 0; l < lines.length; l++) {
        ctx.fillText(lines[l], w / 2, y + l * 20 - (lines.length - 1) * 10);
      }
      y += lines.length * 20 + 12;
    }
    ctx.restore();

    // banner
    if (this.banner) {
      const b = this.banner;
      b.t += this.dt;
      const a = clamp(b.t / 0.4, 0, 1) * clamp((b.life - b.t) / 0.8, 0, 1);
      if (b.t > b.life) { this.banner = null; }
      else {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `400 ${clamp(w * 0.032, 22, 40)}px Georgia, serif`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
        ctx.fillStyle = b.text === 'PANIC' ? '#c8202e' : '#e6dcc4';
        ctx.shadowColor = b.text === 'PANIC' ? 'rgba(180,20,30,0.6)' : 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 22;
        ctx.fillText(b.text, w / 2, h * 0.3);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(180,150,80,0.5)';
        ctx.lineWidth = 1;
        const tw = ctx.measureText(b.text).width;
        ctx.beginPath();
        ctx.moveTo(w / 2 - tw / 2 - 20, h * 0.3 + 26);
        ctx.lineTo(w / 2 + tw / 2 + 20, h * 0.3 + 26);
        ctx.stroke();
        ctx.restore();
      }
    }

    // countdown numerals
    if (this.countdown) {
      this.countdown.t += this.dt;
      const c = this.countdown;
      const a = clamp(c.t / 0.15, 0, 1) * clamp((1 - c.t / 1.05), 0, 1);
      if (c.t > 1.1) this.countdown = null;
      else {
        const scale = 1 + (1 - clamp(c.t / 1, 0, 1)) * 0.35;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(w / 2, h * 0.42);
        ctx.scale(scale, scale);
        ctx.font = `400 92px Georgia, serif`;
        ctx.fillStyle = '#e8dcc0';
        ctx.shadowColor = 'rgba(200,160,80,0.55)';
        ctx.shadowBlur = 30;
        ctx.fillText(String(c.n), 0, 0);
        ctx.restore();
      }
    }
  }

  /* ================= debug overlay ================= */

  drawDebug(ctx, w, h) {
    const d = this.director;
    const lines = [
      `fps ${this.fpsSmooth.toFixed(0)}  t=${this.time.toFixed(1)} ${this.phase.id}  danger=${this.danger.toFixed(2)}`,
      `mood=${d.mood}  budget=${d.budget.toFixed(2)}  waves=${d.waveCount}  threat=${this.threat.toFixed(2)}`,
      `enemies=${this.enemies.length}  alive=${this.enemies.filter((e) => !e.dead).length}  bolts=${this.bolts.length}`,
      `hb=${this.heartRate.toFixed(2)}Hz  blood=${this.player.blood.toFixed(1)}  planks=${this.player.planks}`,
      `doors=${this.mansion.doors.map((x) => (x.broken ? 'X' : Math.round(x.hp))).join('/')}`,
      `windows=${this.mansion.entrances.filter((e) => e.kind === 'window').map((x) => (x.broken ? 'X' : Math.round(x.hp))).join('/')}`,
      `music=${JSON.stringify(this.musicState)}`,
      `F1 debug · T timeScale=${TUNING.timeScale} · G god=${TUNING.godMode} · N nospawn=${TUNING.noSpawns}`,
    ];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 520, 16 * lines.length + 12);
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8ef08a';
    lines.forEach((l, i) => ctx.fillText(l, 8, 18 + i * 16));
    ctx.restore();
  }

  handleUIInput() {
    const input = this.input;
    const inMenu = this.screen !== 'playing' && this.screen !== 'dying' && this.screen !== 'dawn' && this.screen !== 'intro';
    if (!inMenu) { this.uiIndex = 0; return; }
    // keyboard navigation
    if (input.keys.up && !this._navUp) { this.uiIndex = Math.max(0, this.uiIndex - 1); this.usingKeyboard = true; this.audio.play('uiHover', { vol: 0.3 }); }
    if (input.keys.down && !this._navDown) { this.uiIndex = Math.min(99, this.uiIndex + 1); this.usingKeyboard = true; this.audio.play('uiHover', { vol: 0.3 }); }
    this._navUp = input.keys.up; this._navDown = input.keys.down;
    // clicking (mouse or touch tap)
    {
      const tap = input.uiTap;
      const mx = input.mouse.clicked ? input.mouse.x : (tap ? tap.x : null);
      const my = input.mouse.clicked ? input.mouse.y : (tap ? tap.y : null);
      if (mx !== null && my !== null) {
        let hit = null;
        for (const b of this.ui) {
          if (b.slider) continue;
          if (b.disabled) continue;
          if (mx > b.x && mx < b.x + b.w && my > b.y && my < b.y + b.h) { hit = b; }
        }
        if (hit && hit.onClick) { this.audio.play('uiConfirm', { vol: 0.4 }); hit.onClick(); input.uiTap = null; }
        else if (tap) input.uiTap = null;
      }
    }
    if (input.keys.confirm && !this._confirmHeld) {
      this._confirmHeld = true;
      const b = this.ui[this.uiIndex];
      if (b && b.onClick && !b.disabled) { this.audio.play('uiConfirm', { vol: 0.5 }); b.onClick(); }
    }
    if (!input.keys.confirm) this._confirmHeld = false;
    // pause toggle
    if (input.keys.pause && !this._pauseHeld) {
      this._pauseHeld = true;
      if (this.screen === 'playing') this.togglePause(true);
      else if (this.screen === 'paused') this.togglePause(false);
    }
    if (!input.keys.pause) this._pauseHeld = false;
  }
}



function dtSafe(game) { return game.dt; }
