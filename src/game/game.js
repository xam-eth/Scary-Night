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
  loadSave, writeSave, defaultSave, Rng,
} from '../core/util.js';
import {
  NIGHT_DURATION, DAWN_AT, COUNTDOWN_AT, SILENCE_AT, PANIC_AT, PLAYER, DOOR, RES,
  phaseAt, DIFFICULTY, TUNING, UPGRADES, upgradeLevel, SHARDS, CODEX, nightHeat, threatMix,
} from '../core/config.js';
import { Mansion, ROOM, isTallProp, propFootY, drawFurnitureShape } from './mansion.js';
import { Player, PSTATE } from './player.js';
import { Enemy, Crawler, Hunter, Werewolf, Bolt } from './enemies.js';
import { Director, MOOD } from './director.js';
import { Objectives } from './objectives.js';
import {
  packGain, killShards, purseFloor, projectDawn, hungerMul, revealForNight,
  nextRank, rankCost, rankCount, LANE_CAP, LARDER_BLOOD, unlocked, markUnlocks, grantLaneTitle, houseTitle,
} from './economy.js';
import { House } from './house.js';
import { Haunts } from './haunts.js';
import { Ads } from '../shop/ads.js';
import { Valen3D } from './valen3d.js';
import { Enemy3D } from './enemy3d.js';
import { EnvKit } from './envkit.js';
import { IAP } from '../shop/iap.js';
import { drawHUD, drawWorldPrompts, urgentGuidance, pauseButtonBox, weaponChipBox } from './hud.js';
import { WEAPONS, weaponById, nextWeapon } from './weapons.js';
import { nextBeat, ackBeat, beatById, endingReady, narrationLines, beatSeen } from './narrative.js';
import { updateCoach, drawCoachWorld } from './coach.js';
import { Climax, PEAK } from './climax.js';
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
        game.grantBlood(this.amount, true);
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
    Ads.suppressed = !!(this.save.iap && this.save.iap.owned && this.save.iap.owned.remove_ads);
    this.screen = 'menu';
    this.settingsReturn = 'menu';
    this.time = 0;
    this.now = 0;
    this.dt = 1 / 60;
    this.timeScale = 1;
    // The peaks. slowScale is the frenzy's half-second of slow motion; the
    // rest are grades the renderer and the HUD read off `climax` each frame.
    this.slowScale = 1;
    this.climax = new Climax();
    this.peaks = PEAK;
    // The narrator's plate: null, or { list, i, t, kind, act, after, lineDur }.
    this.narration = null;
    this._openingPending = false;
    this._skipNarration = false;
    this.nightDuration = NIGHT_DURATION;
    this.timeLeft = NIGHT_DURATION;
    this.phase = phaseAt(0);
    this.danger = 0.06;
    this.threat = 0;
    this.bloodMoon = 0;
    this.moonBoost = 0;
    this.duelDark = 0;
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
    this.storyQueue = [];
    this.storyLine = null;
    this.storyBeatId = null;
    this.storyShown = 0;
    this.dawnCard = null;
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
    this.introLen = 3.2;
    this.seenIntroThisSession = false;
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
    this.objectives = new Objectives();   // the night's purpose (src/game/objectives.js)
    this.house = new House();             // ambient life: flicker, cat, piano, drafts
    this.haunts = new Haunts();           // v1.0: whispers, watchers — the psychology layer
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
  /* ---- The Blood Market (see src/shop/iap.js) ----
   * Thin wrappers: IAP owns the rules, these own the feedback (audio,
   * messages, save writes). The store never touches gameplay numbers.
   */
  noteDeed(id) {
    if (!this.save.deeds) this.save.deeds = {};
    if (this.save.deeds[id]) return false;
    this.save.deeds[id] = true;
    writeSave(this.save);
    return true;
  }
  wearCoat(id) {
    const worn = IAP.wear(this.save, id);
    writeSave(this.save);
    this.showMessage(worn ? 'YOU PUT IT ON. THE NIGHT DOES NOT GET EASIER.' : 'YOU TAKE IT OFF.', { tone: 'cold', life: 2.8 });
  }
  acceptPrivacy() {
    this.save.privacyAck = true;
    writeSave(this.save);
    this.setScreen('menu');
  }
  async wipeLocalData() {
    let id = null;
    try { id = localStorage.getItem('lastnight.playerId'); } catch (e) { /* private mode */ }
    if (id) {
      try {
        await fetch('/api/privacy/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId: id }),
        });
      } catch (e) { /* local wipe still proceeds; the web page can retry */ }
    }
    try {
      localStorage.removeItem('lastnight.save.v1');
      localStorage.removeItem('lastnight.playerId');
      localStorage.removeItem('lastnight.iap.sandbox.v1');
    } catch (e) { /* private mode */ }
    this.save = defaultSave();
    this.privacyDeleteArmed = false;
    this.setScreen('menu');
  }
  purchaseSku(id) {
    if (IAP.busy) return;
    if (!this.save.privacyAck) {
      this.setScreen('privacy');
      this.showMessage('READ THE NOTICE BEFORE THE MARKET TAKES ANYTHING.', { tone: 'cold', life: 4 });
      return;
    }
    this.audio.play('uiClick', { vol: 0.5 });
    IAP.buy(this.save, id, () => { writeSave(this.save); this.player && this.player.applyUpgrades(this.save); })
      .then((r) => {
        if (r.ok && id === 'revive1' && this.screen === 'death' && !this.usedRevive) {
          this.spendSecondBlood();
          this.showMessage('THE PURSE STAYS. THE CLAW DOES NOT.', { tone: 'gold', life: 4 });
          return;
        }
        if (r.ok) {
          this.audio.play('chandelier', { vol: 0.7 });
          this.showMessage('THE MARKET REMEMBERS. IT IS GRATEFUL.', { tone: 'gold', life: 4 });
        } else {
          this.audio.play('uiBack', { vol: 0.5 });
          this.showMessage('THE HANDS CAME BACK EMPTY: ' + String(r.error || 'unavailable').toUpperCase(), { tone: 'cold', life: 4 });
        }
      });
  }
  buySkuWithShards(id) {
    const r = IAP.buyWithShards(this.save, id);
    if (r.ok) {
      writeSave(this.save);
      this.player && this.player.applyUpgrades(this.save);
      this.audio.play('shard', { vol: 0.8 });
      this.showMessage('PAID IN SHARDS. NO DEBT OUTSIDE.', { tone: 'gold', life: 3.4 });
    } else {
      this.audio.play('uiBack', { vol: 0.5 });
      const err = r.error === 'not-yet' ? 'THE HOUSE HAS NOT SEEN THAT YET.' : (r.error || 'NOT POSSIBLE').replace(/-/g, ' ').toUpperCase();
      this.showMessage(err, { tone: 'cold', life: 3 });
    }
  }
  buySkuWithRelics(id) {
    const r = IAP.buyWithRelics(this.save, id);
    if (r.ok) {
      writeSave(this.save);
      this.audio.play('uiConfirm', { vol: 0.7 });
      this.showMessage('PAID IN RELICS. THE CLAW IS UNCHANGED.', { tone: 'gold', life: 3.4 });
    } else {
      this.audio.play('uiBack', { vol: 0.5 });
      this.showMessage('NOT ENOUGH RELICS.', { tone: 'cold', life: 2.6 });
    }
  }
  restorePurchases() {
    this.audio.play('uiClick', { vol: 0.4 });
    IAP.restore(this.save, () => writeSave(this.save)).then((r) => {
      this.showMessage(r.ok ? `THE LEDGER RECOUNTS ${r.restored} SALE${r.restored === 1 ? '' : 'S'}.` : 'THE LEDGER IS OUT OF REACH HERE.', { tone: r.ok ? 'gold' : 'cold', life: 4 });
    });
  }

  buyUpgrade(id) {
    if (!unlocked(this.save, 'builds') && !(this.save.nightsSurvived > 0 && this.save.revealed && this.save.revealed.builds)) {
      this.showMessage('THE HOUSE HAS NOT OFFERED YOU A LANE YET.', { tone: 'cold', life: 2.6 });
      return;
    }
    const rank = nextRank(this.save, id);
    if (!rank) { this.audio.play('uiBack', { vol: 0.5 }); return; }
    if (rankCount(this.save) >= LANE_CAP) {
      this.showMessage('SIX RANKS. THE REST OF YOU STAYS UNBOUGHT.', { tone: 'cold', life: 3.2 });
      this.audio.play('uiBack', { vol: 0.5 });
      return;
    }
    const cost = rankCost(this.save, rank);
    if (this.save.shards < cost) { this.audio.play('uiBack', { vol: 0.5 }); return; }
    this.save.shards -= cost;
    this.save.builds[rank.id] = 1;
    const named = grantLaneTitle(this.save, id);
    writeSave(this.save);
    this.audio.play('shard', { vol: 0.8 });
    this.audio.play('uiConfirm', { vol: 0.6 });
    if (named) this.showMessage(named + '. THE HOUSE HAS A NAME FOR YOU.', { tone: 'gold', life: 3.6 });
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
    if (s === 'settings' || s === 'upgrades' || s === 'collection' || s === 'help' || s === 'shop' || s === 'privacy') {
      this.settingsReturn = from || (prev === 'paused' ? 'paused' : prev === 'death' ? 'death' : prev === 'victory' ? 'victory' : 'menu');
    }
  }

  togglePause(on) {
    this.pauseConfirm = false;
    if (this.screen === 'playing' && on !== false) {
      this.paused = true; this.screen = 'paused'; this.ui = []; this.uiIndex = 0;
    } else if (this.screen === 'paused') {
      this.paused = false; this.screen = 'playing';
    }
  }

  toMenu() {
    this.pauseConfirm = false;
    this.narration = null;
    this._openingPending = false;
    this.settlePurse('leave');
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
    // Wake in the servant-door opening, south of the slab. Dragging up on the
    // stick walks into that door. The long table used to sit in the way.
    this.player = new Player(720, 200);
    this.equipSavedWeapon();
    this.player.applyUpgrades(this.save);
    this.player.blood = this.player.bloodMax * 0.48;
    // Night one can bar the shaking door without a scavenger hunt. Later
    // nights start leaner; the fort still costs three planks.
    this.player.planks = (this.save.nightsSurvived || 0) > 0 ? 2 : 3;
    this.player.planks += this.player.bonusPlanks || 0;
    this.player.angle = -Math.PI / 2;
    const doorMul = this.player.doorMul || 1;
    if (doorMul !== 1) {
      for (const e of this.mansion.entrances) {
        e.hpMax = e.baseHpMax * doorMul;
        e.hp = e.hpMax;
      }
    }
    // ---- director ----
    this.director = new Director();
    // ---- the four peaks are available again tonight ----
    this.climax.reset();
    this.slowScale = 1;
    this.moonBoost = 0;
    this.duelDark = 0;
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
    const doorN = this.mansion.doors.length;
    this.stats = { kills: 0, doorsSurviving: doorN, doorsTotal: doorN, closestCall: 0, waveCount: 0, hits: 0, bloodMin: 100, roomsVisited: 0, roomsSeen: {} };
    this.larderUsed = false;
    this._lastRoom = null;
    if (this.mansion.studyWard) { this.mansion.studyWard.until = 0; this.mansion.studyWard.readyAt = 0; }
    if (this.mansion.lowerStakes) this.mansion.lowerStakes();
    this._brief = {};
    this.coach = null;
    // ---- night purpose + living house + IAP consumables ----
    this.usedRevive = false;
    this.lastNightGoals = null;
    this.runSeed = ((rand(0, 2 ** 31) | 0) ^ (this.time * 1000)) >>> 0;
    this.lightMul = 1;
    // carpenter's pouch (IAP consumable): +3 planks tonight, consumed at dusk
    const pouch = IAP.takePouch(this.save);
    if (pouch) {
      this.player.planks += pouch;
      this.showMessage('A CARPENTER LEFT PLANKS ON THE PORCH.', { tone: 'cold', life: 4 });
      writeSave(this.save);
    }
    this.house.beginNight(this);
    this.haunts.beginNight(this);
    Ads.beginNight(this.night || 1);
    this.objectives.beginNight(this);
    this.shardsEarned = 0;
    this.purseReady = false;
    this.purseSettled = false;
    this.bankedNow = 0;
    this.forfeited = 0;
    this.hungerWarned = false;
    this.bloodTick = 0;
    this.drinks = [];
    this.bloodShown = null;
    this.bloodGulp = 0;
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
      { r: ROOM.KITCHEN, planks: 1, blood: 1 },
      { r: ROOM.STUDY, planks: 1, blood: 1 },
      { r: ROOM.GATEHOUSE, planks: 2, blood: 1 },
      { r: ROOM.GALLERY, planks: 1, blood: 1 },
      { r: ROOM.ORATORY, planks: 0, blood: 1 },
    ];
    let totalPlanks = 0, totalBlood = 0;
    for (const spec of rooms) {
      const room = m.rooms[spec.r];
      for (let i = 0; i < spec.planks; i++) {
        const p = this.pickSpotInRoom(room);
        if (p) { this.pickups.push(new Pickup(p.x, p.y, 'planks', RES.plankPickup)); totalPlanks++; }
      }
      for (let i = 0; i < spec.blood && totalBlood < RES.bloodPackCount; i++) {
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
      if (dist(x, y, 720, 200) < 120 && room.id === ROOM.DINING) ok = false;
      if (ok) return { x, y };
    }
    return null;
  }

  beginNight() {
    // v1.0 FIX (live click test): the whole night-start used to sit inside
    // `Audio.unlock().then(...)`. A suspended/hanging AudioContext (audio-less
    // browsers, some WebViews, autoplay quirks) then silently swallowed the
    // transition and TRY AGAIN/PLAY/RESTART were dead buttons. The game state
    // machine must never wait on audio — unlock is fire-and-forget polish.
    this.settlePurse('leave');
    this.freshRun();
    const repeat = this.seenIntroThisSession;
    this.seenIntroThisSession = true;
    // The opening belongs to a save that has never heard it — not to the first
    // press of PLAY. A player who retries, restarts, or walks in on the second
    // attempt of a session still gets night one told to them once.
    const owesOpening = !beatSeen(this.save, 'open-woke');
    if (repeat) {
      this._openingPending = owesOpening;
      this.narration = null;
      this.screen = 'playing';
      this.fadeFromBlack = 0.45;
      this.finishIntro();
    } else {
      this._openingPending = owesOpening;
      this.screen = 'intro';
      this.introT = 0;
      this.fadeFromBlack = 1;
    }
    this.renderer.snapCamera(this.player.x, this.player.y);
    this.offerNarrative({ surface: 'strip', event: 'night', night: (this.save.nightsSurvived || 0) + 1 });
    if (this.save.ending === 'monster' && this.save.seen && !this.save.seen.houseHeartTold) {
      this.save.seen.houseHeartTold = true;
      this.save.houseHeart = true;
      writeSave(this.save);
      this.showMessage('THE SIEGE ANSWERS. YOU ARE ITS HEART.', { tone: 'cold', life: 4.4 });
    }
    const reveal = revealForNight(this.save.nightsSurvived);
    if (reveal) this.showMessage(reveal.text, { tone: 'cold', life: 4.2 });
    if (this.save.iap && this.save.iap.owned && this.save.iap.owned.remove_ads) Ads.suppressed = true;
    else Ads.suppressed = false;
    Audio.unlock().then(() => { this.applySettings(); Audio.setAmbienceVolume(1); }).catch(() => { });
  }

  /* ================= update ================= */

  update(rawDt) {
    const dt = Math.min(rawDt, 1 / 20);
    // The climax runs on real time (a peak that lasts seven seconds lasts
    // seven seconds), and it may ask the night to slow down for a beat.
    this.climax.update(dt, this);
    this.slowScale = this.climax.slowScale;
    this.dt = dt * this.timeScale * this.slowScale;
    this.now += rawDt;
    this.fpsSmooth = lerp(this.fpsSmooth, 1 / Math.max(rawDt, 0.0001), 0.05);
    // v1.0 FIX (live click test): ui was cleared HERE at the top of update(),
    // but immediate-mode buttons register during render() — which runs AFTER
    // update in the frame loop. handleUIInput therefore hit-tested against an
    // empty array and every real click/tap on a menu button was swallowed.
    // The reset now lives at the top of render(), so update() always sees the
    // buttons drawn last frame. (This one predates v1.0 — it was in the base
    // checkout; keyboard nav worked, mouse/touch never did.)

    // Stick only exists while you are in the night. Menu clicks must never
    // start a drag-to-move, or PLAY/settings sliders fight the joystick.
    this.input.gameplay = this.screen === 'playing' || this.screen === 'dying';
    const b = this.input.buttons;
    if (!this.input.gameplay) {
      b.attack.hidden = b.dash.hidden = b.interact.hidden = true;
      b.repair.hidden = b.barricade.hidden = true;
    } else {
      // Menu hides these and used to leave them hidden for the whole night,
      // so CLAW / DASH / USE never came back. FIX and BOARD stay contextual.
      b.attack.hidden = false;
      b.dash.hidden = false;
      b.interact.hidden = false;
      this.input.layout(this.renderer.w, this.renderer.h);
    }
    this.input.update(rawDt);
    this.handleUIInput();

    if (this.input.keys.debug && !this._debugHeld) { TUNING.showDebug = !TUNING.showDebug; }
    this._debugHeld = this.input.keys.debug;

    switch (this.screen) {
      case 'menu': this.updateMenu(dt); break;
      case 'settings': case 'upgrades': case 'collection': case 'help': case 'shop': case 'privacy': break;
      case 'intro': this.updateIntro(dt); break;
      case 'narration': this.updateNarration(dt); break;
      case 'playing': this.updatePlaying(this.dt); break;
      case 'paused': break;
      case 'dying': this.updateDying(dt); break;
      case 'death': this.deathScreenT += dt; break;
      case 'dawn': this.updateDawn(dt); break;
      case 'dawnCard': this.updateDawnCard(dt); break;
      case 'ending': this.endingT = (this.endingT || 0) + dt; break;
      case 'victory': this.victoryScreenT += dt; break;
    }

    // global easing
    this.hbPulse = Math.max(0, this.hbPulse - rawDt * 3.4);
    this.renderer.decayFlash(rawDt);
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
    const keys = this.input && this.input.keys;
    const busy = !!(this.input && ((this.input.mouse && this.input.mouse.down) || (keys && (keys.interact || keys.attack || keys.up || keys.down))));
    if (!this.save.privacyAck || busy) this.menuIdle = 0;
    else this.menuIdle = (this.menuIdle || 0) + dt;
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
    // The tap that pressed PLAY must not also skip the card. After a beat,
    // any tap, claw, or confirm wakes her — including a phone with no keyboard.
    const armed = this.introT > 0.45;
    const tap = !!(this.input.uiTap || this._introTap);
    if (this.introT > this.introLen || (armed && (tap || this.input.attackPressed || this.input.interactPressed || this.input.keys.confirm))) {
      this.input.uiTap = null;
      this._introTap = false;
      this.finishIntro();
    }
  }

  finishIntro() {
    // The story is narrated, not only murmured (docs/STORY.md §2.3). Night one
    // opens with three authored lines, then the Act I card, then the night.
    const opening = this._openingPending
      ? narrationLines(this.save, { surface: 'narration', event: 'open', night: 1 })
      : [];
    this._openingPending = false;
    if (opening.length && this.startNarration(opening, { kind: 'open', after: 'play' })) return;
    if ((this.save.nightsSurvived || 0) === 0) {
      const act = nextBeat(this.save, { surface: 'actCard', event: 'act', act: 1 });
      if (act && this.startNarration([act], { kind: 'act', act: 1, after: 'play' })) return;
    }
    this.startNightProper();
  }

  /** What `finishIntro` used to be: the night itself, the hook, the first knock. */
  startNightProper() {
    this._skipNarration = false;
    this.narration = null;
    this.screen = 'playing';
    this.audio.play('uiConfirm', { vol: 0.6 });
    if (!this.save.tutorialSeen) { this.save.tutorialSeen = true; this.showTutorialHints = true; writeSave(this.save); }
    this.showMessage('THE SERVANT DOOR IS ALREADY SHAKING. BAR IT, OR FEED.', { tone: 'gold', life: 5.4, key: 'hook' });
    this.director.scheduleKnock(this, {
      force: true, entranceId: 'diningDoor', outcome: 'crawler', wait: 18, mustEnter: true, known: true,
    });
  }

  /* ---------------- the narrator's plate ---------------- */

  /**
   * Open the plate over a list of beats. Returns false when there is nothing
   * to show (or when capture has asked to step straight through), so callers
   * can fall through to whatever comes next.
   */
  startNarration(list, { kind = 'open', act = 0, after = 'play' } = {}) {
    if (!list || !list.length) return false;
    if (this._skipNarration) {
      for (const b of list) ackBeat(this.save, b.id);
      writeSave(this.save);
      return false;
    }
    this.narration = { list, i: 0, t: 0, kind, act, after, lineDur: kind === 'act' ? 3.4 : 2.9 };
    this.screen = 'narration';
    this.ui = [];
    this.audio.play('narrationSwell', { vol: 0.6, bus: 'music' });
    return true;
  }

  updateNarration(dt) {
    const n = this.narration;
    if (!n) { this.startNightProper(); return; }
    n.t += dt;
    this.mansion.update(dt, this);
    this.player.anim(dt);
    // The tap that ended the previous plate must not also end this line.
    const armed = n.t > 0.45;
    const tap = !!(this.input.uiTap || this._narrationTap || this._introTap);
    if (n.t >= n.lineDur || (armed && (tap || this.input.attackPressed || this.input.interactPressed || this.input.keys.confirm))) {
      this.input.uiTap = null;
      this._narrationTap = false;
      this._introTap = false;
      this.advanceNarration();
    }
  }

  advanceNarration() {
    const n = this.narration;
    if (!n) return;
    const beat = n.list[n.i];
    if (beat) { ackBeat(this.save, beat.id); writeSave(this.save); }
    n.i += 1;
    n.t = 0;
    if (n.i >= n.list.length) this.finishNarration();
  }

  finishNarration() {
    const n = this.narration;
    this.narration = null;
    if (!n) { this.startNightProper(); return; }
    if (n.after === 'menu') { this.setScreen('menu'); return; }
    if (n.after === 'dawn') { this.screen = 'dawn'; this.dawnT = 5.0; return; }
    // after the opening, the act card rides the same interstitial
    if (n.kind === 'open') {
      const act = nextBeat(this.save, { surface: 'actCard', event: 'act', act: 1 });
      if (act && this.startNarration([act], { kind: 'act', act: 1, after: 'play' })) return;
    }
    this.startNightProper();
  }

  /** Step straight through the plate (SKIP, and the capture harness). */
  skipNarration() {
    this._skipNarration = true;
    const n = this.narration;
    if (!n) return false;
    for (const b of n.list) ackBeat(this.save, b.id);
    // skipping the opening skips the card queued behind it: one gesture, one
    // sequence, and a retry does not then drop the player into a card
    if (n.kind === 'open') {
      const act = nextBeat(this.save, { surface: 'actCard', event: 'act', act: 1 });
      if (act) ackBeat(this.save, act.id);
    }
    writeSave(this.save);
    const after = n.after;
    this.narration = null;
    if (after === 'menu') { this.setScreen('menu'); return true; }
    if (after === 'dawn') { this.screen = 'dawn'; this.dawnT = 5.0; return true; }
    this.startNightProper();
    return true;
  }

  /** Replay the authored opening from the menu. Never forgets what was seen. */
  replayOpening() {
    const list = narrationLines(this.save, { surface: 'narration', event: 'open', night: 1 }, { includeSeen: true });
    if (!list.length) return false;
    this.renderer.snapCamera(this.player.x, this.player.y);
    return this.startNarration(list, { kind: 'open', after: 'menu' });
  }

  /* ---------------- the night ---------------- */

  nightBrief() {
    if ((this.save.nightsSurvived || 0) > 0) return;
    if (this.coach && this.coach.step !== 'done') return;
    const lines = [
      [68, 'pack', 'ZOMBIES COME IN PACKS. YOU DO NOT HAVE TO KILL THEM ALL.'],
      [108, 'rooms', 'THE GALLERY IS NORTH OF THE DINING ROOM. THE ORATORY SITS ABOVE THE GLASS.'],
      [168, 'choose', 'YOU CANNOT HOLD EVERY DOOR. THE POSTERN IS WEAK ON PURPOSE.'],
      [236, 'later', 'IF YOU SEE DAWN, THE NEXT NIGHT BRINGS MORE OF THEM.'],
      [262, 'stay', 'ONE MINUTE. STOP CHASING. STAY BEHIND A DOOR THAT STILL HOLDS.'],
    ];
    this._brief = this._brief || {};
    for (const [at, id, text] of lines) {
      if (this.time >= at && !this._brief[id]) {
        this._brief[id] = true;
        this.showMessage(text, { tone: 'gold', life: 5.4 });
      }
    }
  }

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
    // The blood moon is the late-night grade AND the frenzy's. Whichever is
    // higher wins: the peak is allowed to borrow the existing light rig.
    this.bloodMoon = Math.max(
      this.time >= PANIC_AT ? clamp((this.time - PANIC_AT) / 25, 0, 1) : 0,
      this.climax.moonBoost,
    );
    this.duelDark = this.climax.duelDark;
    this.blackoutT = Math.max(0, this.blackoutT - dt);
    this.powerOut = this.blackoutT > 0 || this.duelDark > 0.35;
    this.nightBrief();
    this.bloodTick = Math.max(0, (this.bloodTick || 0) - dt);
    this.bloodGulp = Math.max(0, (this.bloodGulp || 0) - dt);
    const shown = this.player.bloodPct;
    if (this.bloodShown == null) this.bloodShown = shown;
    this.bloodShown = damp(this.bloodShown, shown, this.bloodGulp > 0 ? 2.4 : 9, dt);
    if (this.drinks) {
      for (let i = this.drinks.length - 1; i >= 0; i--) {
        this.drinks[i].t += dt;
        if (this.drinks[i].t > this.drinks[i].life) this.drinks.splice(i, 1);
      }
    }
    const proj = projectDawn(this.player.blood, this.timeLeft, this.save, this.player.state === 'run');
    this.hungerFailing = proj.failing;
    if (proj.failing && !this.hungerWarned && this.player.alive) {
      this.hungerWarned = true;
      this.showMessage('THE HUNGER IS WINNING. YOU NEED TO FEED.', { tone: 'danger', life: 4.4 });
      this.audio.setHeartbeat(1.15, 0.55);
    } else if (!proj.failing && this.hungerWarned) {
      this.hungerWarned = false;
    }

    // ---- world ----
    this.mansion.update(dt, this);
    this.nearFire = clamp(1 - dist(this.player.x, this.player.y, 1120, 636) / 380, 0, 1);
    this.updateBlackoutPressure(dt);

    this.player.update(dt, this);
    this.player.anim(dt);
    updateCoach(this);

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
      // buckling: the wood shuddering under the crescendo
      if (e.buckling > 0) e.buckling = Math.max(0, e.buckling - dt * 1.6);
    }

    // ---- director ----
    this.director.update(dt, this);
    // ---- the house lives; the night has goals ----
    this.house.update(dt, this);
    this.haunts.update(dt, this);
    // the watched feeling decays; the altar is where you recover from it
    this.feelWatched = Math.max(0, (this.feelWatched ?? 0) - dt * 0.22);
    {
      const altar = this.mansion.chapelAltar;
      const p0 = this.player;
      if (altar && p0.alive && Math.hypot(p0.x - altar.x, p0.y - altar.y) < altar.r) {
        this.stats.altarSeconds = (this.stats.altarSeconds || 0) + dt;
      }
    }
    this.objectives.update(dt, this);
    // first-use legend for the door list (QA P1-7): teach it while it matters
    if (!this.compassLegendShown && this.mansion.doors.some((d) => d.attackers > 0)) {
      this.compassLegendShown = true;
      this.showMessage('THE CORNER MARK POINTS AT THE DOOR THEY ARE TOUCHING.', { tone: 'calm', life: 4.2 });
    }
    // keep the HUD knock markers in sync
    this.knocks = this.director.knock ? [this.director.knock] : [];

    // ---- interaction ----
    this.updateInteraction(dt);

    // ---- camera ----
    const p = this.player;
    const lookX = clamp(p.vx * 0.22, -70, 70);
    const lookY = clamp(p.vy * 0.22, -70, 70);
    // Full-bleed portrait. A small look-ahead keeps the door in frame; the
    // old -110 was compensating for a letterboxed band.
    const tall = this.renderer.h > this.renderer.w * 1.2;
    const biasY = tall ? -48 : 0;
    this.noteRoom(p);
    if (p.lowBlood) this.offerNarrative({ surface: 'strip', event: 'state', state: 'lowBlood', night: (this.save.nightsSurvived || 0) + 1 });
    this.tickStory(dt);
    // A peak may own the camera for a beat: the duel pushes in on the alpha so
    // it fills the frame. Nothing else moves the camera off the player.
    const focus = this.climax.focus;
    if (focus) this.renderer.followCamera(focus.x, focus.y, dt, lookX, biasY, this.mansion.camBounds);
    else this.renderer.followCamera(p.x, p.y, dt, lookX, lookY + biasY, this.mansion.camBounds);

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
    } else {
      const larder = this.mansion.props.find((pr) => pr.type === 'larder');
      const ward = this.mansion.props.find((pr) => pr.type === 'ward');
      const stakes = this.mansion.props.find((pr) => pr.type === 'stakes');
      const larderD = larder ? dist(p.x, p.y, larder.x, larder.y) : 1e9;
      const wardD = ward ? dist(p.x, p.y, ward.x, ward.y) : 1e9;
      const stakesD = stakes ? dist(p.x, p.y, stakes.x, stakes.y) : 1e9;
      if (larder && larderD < 64 && larderD <= wardD && larderD <= stakesD) {
        this.interactTarget = {
          ent: { x: larder.x, y: larder.y, name: 'LARDER', w: 80, h: 50, facing: 'south', hp: 1, hpMax: 1, barricade: 0 },
          actions: this.larderUsed ? [] : [{ key: 'E', label: 'DRINK — THEY WILL HEAR', act: 'larder' }],
          dist: larderD,
        };
        if (!this.larderUsed && input.interactPressed) this.drinkLarder(larder);
      } else if (stakes && stakesD < 70 && stakesD <= wardD && stakesD <= larderD) {
        const up = !!this.mansion.stakesUp;
        this.interactTarget = {
          ent: { x: stakes.x, y: stakes.y, name: 'STAKE LINE', w: 90, h: 40, facing: 'south', hp: 1, hpMax: 1, barricade: 0 },
          actions: up ? [] : [{ key: 'E', label: 'RAISE STAKES — 3 PLANKS', act: 'stakes' }],
          dist: stakesD,
        };
        if (!up && input.interactPressed) this.raiseStakes();
      } else if (ward && wardD < 64) {
        const ready = this.time >= (this.mansion.studyWard.readyAt || 0);
        const lit = this.time < this.mansion.studyWard.until;
        this.interactTarget = {
          ent: { x: ward.x, y: ward.y, name: 'STUDY LAMP', w: 40, h: 40, facing: 'south', hp: 1, hpMax: 1, barricade: 0 },
          actions: lit ? [] : [{ key: 'E', label: ready ? 'LIGHT THE WARD' : 'THE WARD IS COLD', act: 'ward' }],
          dist: wardD,
        };
        if (input.interactPressed) this.lightWard();
      }
    }

    // FIX / BOARD appear whenever the action exists, not only after a touch.
    const acts = (this.interactTarget && this.interactTarget.actions) || [];
    input.buttons.repair.hidden = !acts.some((a) => a.act === 'repair');
    input.buttons.barricade.hidden = !acts.some((a) => a.act === 'barricade');
  }

  noteRoom(p) {
    const id = this.mansion.findRoom(p.x, p.y);
    if (!id || id === ROOM.OUTSIDE || id === this._lastRoom) return;
    this._lastRoom = id;
    const seen = this.stats.roomsSeen || (this.stats.roomsSeen = {});
    if (seen[id]) return;
    seen[id] = true;
    this.stats.roomsVisited = Object.keys(seen).length;
    const lines = {
      kitchen: 'KITCHEN. THE LARDER FEEDS YOU. THE WEST DOOR WILL NOT HOLD.',
      study: 'STUDY. LIGHT THE LAMP TO SLOW THEM. THE WINDOW IS THE PRICE.',
      chapel: 'CHAPEL. THE ALTAR LIGHT SLOWS THEM. IT DOES NOT STOP THEM.',
      dining: 'DINING ROOM. THE SERVANT DOOR IS NORTH.',
    };
    const named = this.mansion.room(id);
    const roomLine = lines[id] || (named && named.name) || id;
    this._roomLine = roomLine;
    this._roomLineAt = this.time;
    this.offerNarrative({ surface: 'room', event: 'room', room: id, night: (this.save.nightsSurvived || 0) + 1 });
  }

  /**
   * Ask the director for the beat due at this hook. Strip and room lines
   * queue for the guidance slot. Dawn-cards wait on save for the interstitial.
   */
  offerNarrative(query) {
    const beat = nextBeat(this.save, query);
    if (!beat) return null;
    const queued = (this.storyQueue || []).some((b) => b.id === beat.id) || this.storyBeatId === beat.id;
    if (queued) return beat;
    if (beat.surface === 'dawnCard') {
      ackBeat(this.save, beat.id);
      this.save.pendingDawn = this.save.pendingDawn || [];
      if (!this.save.pendingDawn.includes(beat.id)) this.save.pendingDawn.push(beat.id);
      this.dawnCard = beatById(beat.id);
      writeSave(this.save);
      return beat;
    }
    this.storyQueue = this.storyQueue || [];
    this.storyQueue.push(beat);
    return beat;
  }

  /** Advance the murmur only while the strip is actually showing it. */
  tickStory(dt) {
    if (!this.storyLine && this.storyQueue && this.storyQueue.length) {
      const beat = this.storyQueue.shift();
      this.storyLine = beat.text;
      this.storyBeatId = beat.id;
      this.narrativeLine = beat.text;
      this.storyShown = 0;
      this._storyAcked = false;
    }
    if (!this.storyLine || this.screen !== 'playing') return;
    const covered = (this.messages || []).some((m) => m.life - m.t > 0.05);
    if (urgentGuidance(this) || covered) return;
    this.storyShown += dt;
    if (!this._storyAcked && this.storyShown >= 0.45 && this.storyBeatId) {
      ackBeat(this.save, this.storyBeatId);
      this._storyAcked = true;
      writeSave(this.save);
    }
    if (this.storyShown >= 6.8) {
      if (this.narrativeLine === this.storyLine) this.narrativeLine = null;
      this.storyLine = null;
      this.storyBeatId = null;
      this.storyShown = 0;
      this._storyAcked = false;
    }
  }

  drinkLarder(larder) {
    this.larderUsed = true;
    this.grantBlood(LARDER_BLOOD, true);
    this.audio.play('drink', { vol: 0.55 });
    this.showMessage('THE LARDER IS COLD. SOMETHING HEARD THE LATCH.', { tone: 'cold', life: 3.6 });
    this.makeNoise(larder.x, larder.y, 280);
    this.timeouts.push({
      t: 1.3,
      fn: () => {
        this.director.spawnWave(this, ['crawler'], { entranceId: 'kitchenDoor', reveal: true });
        this.showMessage('THE KITCHEN DOOR. IT SMELLED THE BLOOD.', { tone: 'danger' });
      },
    });
  }

  raiseStakes() {
    if (this.mansion.stakesUp) return;
    if (this.player.planks < 3) {
      this.showMessage('THE STAKES NEED THREE PLANKS.', { tone: 'cold', life: 2.6 });
      return;
    }
    this.player.planks -= 3;
    this.mansion.raiseStakes();
    this.objectives.notify(this, 'stakesRaised');
    this.audio.play('repair', { vol: 0.7 });
    this.showMessage('THE STAKES ARE UP. THEY COME THROUGH ONE AT A TIME.', { tone: 'gold', life: 4.2 });
  }

  lightWard() {
    const w = this.mansion.studyWard;
    if (!w) return;
    if (this.time < w.until) return;
    if (this.time < (w.readyAt || 0)) {
      this.showCombatText('COLD', w.x, w.y - 24, '#9a9488');
      return;
    }
    w.until = this.time + 18;
    w.readyAt = this.time + 48;
    this.objectives.notify(this, 'wardLit');
    this.audio.play('chandelier', { vol: 0.35 });
    this.showMessage('THE LAMP HOLDS THEM. EIGHTEEN SECONDS. NOT SAFETY.', { tone: 'gold', life: 3.4 });
    this.makeNoise(w.x, w.y, 180);
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
    this.objectives.notify(this, 'knockAnswered');
    if (!this.save.seen.knock) { this.save.seen.knock = true; writeSave(this.save); }
    this.audio.play('creak', { x: e.x, y: e.y, cam: this.renderer.cam, vol: 0.75 });
    this.makeNoise(e.x, e.y, 260);
    if (this.noteDeed('answered') && k.opened) {
      this.showMessage('YOU ANSWERED. WHATEVER WAS THERE KNOWS YOUR HAND.', { tone: 'cold', life: 3.4 });
    } else if (k.opened) {
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
    if (this.noteDeed('barred')) this.showMessage('THE WOOD HOLDS BECAUSE YOUR HANDS PUT IT THERE.', { tone: 'gold', life: 3.6 });
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
    this.grantBlood(RES.bloodWellValue, true);
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
    const quiet = p.quietMul || 1;
    if (running) {
      this.makeNoise(p.x, p.y, 380 * quiet);
      if (chance(0.25)) this.audio.play('stepCreak', { x: p.x, y: p.y, cam: this.renderer.cam, vol: 0.5 });
    } else this.makeNoise(p.x, p.y, 130 * quiet);
  }

  onPlayerHurt(dmg, fromX, fromY, kind) {
    this.objectives.onHurt();
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
    if (dmg > 0 && this.noteDeed('bled')) {
      this.showMessage('IT DREW BLOOD. THE HOUSE KEEPS THE STAIN.', { tone: 'danger', life: 3.4 });
    } else if (dmg > 0 && IAP.equippedCoat(this.save) === 'coat_bloodmoon' && !this._coatStain) {
      this._coatStain = true;
      this.showMessage('THE COAT TAKES THE STAIN. THE CLAW DOES NOT GROW.', { tone: 'cold', life: 2.8 });
    }
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

  equipSavedWeapon() {
    const id = WEAPONS[this.save && this.save.weapon] ? this.save.weapon : 'claw';
    if (this.player) this.player.weapon = id;
    if (this.save) this.save.weapon = id;
  }

  setWeapon(id) {
    if (!WEAPONS[id] || !this.player) return;
    this.player.weapon = id;
    if (this.save) {
      this.save.weapon = id;
      writeSave(this.save);
    }
  }

  cycleWeapon() {
    if (!this.player) return;
    this.setWeapon(nextWeapon(this.player.weapon));
    this.audio.play('uiClick', { vol: 0.35 });
  }

  playerAttackHit(player) {
    const tool = weaponById(player.weapon);
    // Coat tint stays on the swing. The weapon is a layer, not a replacement.
    this.spawnCoatClaw(player, IAP.fxLook(this.save));
    this.spawnWeaponFx(player, tool);
    if (tool.kind === 'ranged') {
      this.spawnBolt(player, player.swingAngle || player.angle || 0, tool);
      this.stats.shotsFired = (this.stats.shotsFired || 0) + 1;
      this.makeNoise(player.x, player.y, 420);
      return;
    }
    const arc = tool.arc;
    let hits = 0;
    let heft = 16;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, player.x, player.y);
      if (d > tool.range + e.radius) continue;
      const a = Math.atan2(e.y - player.y, e.x - player.x);
      let diff = Math.abs(((a - player.swingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const touching = d < player.radius + (e.radius || 12) + 14;
      if (!touching && diff > arc / 2) continue;
      const dmg = tool.damage * player.damageMul * (player.frenzy ? player.frenzy.dmg : 1);
      e.hurt(dmg, this, player.x, player.y);
      hits++;
      // The frenzy shreds: every connected claw throws blood across the frame.
      if (player.frenzy) {
        const a2 = Math.atan2(e.y - player.y, e.x - player.x);
        this.particles.burst('blood', e.x, e.y, 10, {
          color: 'rgba(198,20,32,0.9)', angle: a2, spread: 1.1, speedMin: 60, speedMax: 240,
          lifeMin: 0.24, lifeMax: 0.7, sizeMin: 2, sizeMax: 6, grav: 120,
        });
      }
      heft = Math.max(heft, (e.type && e.type.bloodValue) || 16);
      const kb = e.key === 'werewolf' ? 30 : e.key === 'ghoul' ? 48 : e.key === 'stalker' ? 60 : 110;
      e.vx += Math.cos(a) * kb; e.vy += Math.sin(a) * kb;
    }
    this.stats.clawSwings = (this.stats.clawSwings || 0) + 1;
    this.stats.clawHits = (this.stats.clawHits || 0) + hits;
    if (hits) {
      this.renderer.shake(0.16 + hits * 0.04 + (player.frenzy ? 0.22 : 0));
      this.audio.play(tool.hitSound, { vol: 0.5, weight: tool.hitWeight + heft / 40 });
      this.renderer.addFlash(player.frenzy ? 0.07 : 0.04, player.frenzy ? '#ff3a44' : (tool.fx === 'arc' ? '#f0e6d0' : '#ffffff'));
    }
    this.makeNoise(player.x, player.y, tool.fx === 'arc' ? 420 : 360);
  }

  /** Visual + audio for the equipped row. Coat FX already fired. */
  spawnWeaponFx(player, tool) {
    const ang = player.swingAngle || player.angle || 0;
    if (tool.kind === 'ranged') {
      this.audio.play(tool.sound, { x: player.x, y: player.y, cam: this.renderer.cam, vol: 0.72 });
    }
    if (tool.fx === 'arc') {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1) - 0.5) * tool.arc;
        const a = ang + t;
        const r = tool.range * (0.62 + (i % 3) * 0.08);
        this.particles.burst('spark', player.x + Math.cos(a) * r, player.y + Math.sin(a) * r, 1, {
          color: 'rgba(220, 210, 186, 0.92)', speedMin: 16, speedMax: 64, lifeMin: 0.08, lifeMax: 0.2, sizeMin: 1.2, sizeMax: 2.6, glow: true,
        });
      }
    } else if (tool.fx === 'muzzle') {
      const ox = player.x + Math.cos(ang) * (tool.offset || 22);
      const oy = player.y + Math.sin(ang) * (tool.offset || 22);
      this.particles.burst('spark', ox, oy, 9, {
        color: 'rgba(255, 206, 130, 0.95)', angle: ang, spread: 0.4, speedMin: 50, speedMax: 180, lifeMin: 0.05, lifeMax: 0.16, sizeMin: 1.4, sizeMax: 3.4, glow: true,
      });
      this.renderer.addFlash(0.06, '#e6c078');
    }
  }

  /** The equipped coat's claw signature — visual only, no stat rides the
   *  swing (#19; the integrity wall in iap.js keeps cosmetics powerless).
   *  Glutton sprays red, Warden strikes blunt and sure, Shade slashes pale. */
  spawnCoatClaw(player, look) {
    const fx = look && look.fx;
    const cc = look && look.claw;
    if (!fx && !cc) return;
    const col = cc ? `rgb(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0})` : 'rgb(200,40,48)';
    const ang = player.swingAngle || 0;
    const ox = player.x + Math.cos(ang) * 20, oy = player.y + Math.sin(ang) * 20;
    if (fx === 'glut') {
      this.particles.burst('blood', ox, oy, 12, { color: col, angle: ang, spread: 0.7, speedMin: 70, speedMax: 170, lifeMin: 0.22, lifeMax: 0.5, sizeMin: 2, sizeMax: 5.5, grav: 90 });
    } else if (fx === 'ward') {
      this.particles.burst('dust', ox, oy, 8, { color: col, angle: ang, spread: 0.5, speedMin: 14, speedMax: 46, lifeMin: 0.26, lifeMax: 0.5, sizeMin: 3, sizeMax: 7 });
      this.particles.burst('spark', ox, oy, 3, { color: col, angle: ang, spread: 0.4, speedMin: 30, speedMax: 70, lifeMin: 0.1, lifeMax: 0.22, glow: true });
    } else if (fx === 'shade') {
      for (let i = 0; i < 7; i++) {
        const r = 6 + i * 5;
        this.particles.burst('mote', player.x + Math.cos(ang) * r, player.y + Math.sin(ang) * r, 1, { color: col, speedMin: 4, speedMax: 14, lifeMin: 0.12, lifeMax: 0.3, sizeMin: 1, sizeMax: 2.6, glow: true });
      }
    } else {
      this.particles.burst('blood', ox, oy, 5, { color: col, angle: ang, spread: 0.6, speedMin: 44, speedMax: 96, lifeMin: 0.2, lifeMax: 0.4 });
    }
  }

  /** The coat's feed signature on a kill — the drink reads as the build.
   *  Glutton gorges, Warden feeds only when forced, Shade slips the kill. */
  spawnCoatFeed(x, y, look) {
    const fx = look && look.fx;
    const cc = look && look.claw;
    const col = cc ? `rgb(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0})` : '#8a1020';
    if (fx === 'glut') {
      this.particles.burst('blood', x, y, 14, { color: col, speedMin: 50, speedMax: 240, lifeMin: 0.3, lifeMax: 1.25, sizeMin: 2.5, sizeMax: 6.5, grav: 110 });
      this.particles.burst('mist', x, y, 8, { color: 'rgba(120,10,20,0.3)', sizeMin: 10, sizeMax: 26, lifeMin: 0.4, lifeMax: 1.1, speedMin: 6, speedMax: 34 });
    } else if (fx === 'ward') {
      this.particles.burst('blood', x, y, 5, { color: col, speedMin: 30, speedMax: 120, lifeMin: 0.25, lifeMax: 0.8, sizeMin: 2, sizeMax: 4.5, grav: 90 });
      this.particles.burst('dust', x, y, 7, { color: 'rgba(150,120,70,0.4)', sizeMin: 4, sizeMax: 11, speedMin: 16, speedMax: 60, lifeMin: 0.3, lifeMax: 0.7 });
    } else if (fx === 'shade') {
      this.particles.burst('mote', x, y, 8, { color: col, speedMin: 10, speedMax: 70, lifeMin: 0.2, lifeMax: 0.6, sizeMin: 1.5, sizeMax: 3.5, glow: true });
      this.particles.burst('mist', x, y, 6, { color: 'rgba(80,90,150,0.22)', sizeMin: 8, sizeMax: 20, lifeMin: 0.35, lifeMax: 0.9, speedMin: 6, speedMax: 30 });
    } else {
      this.particles.burst('blood', x, y, 8, { color: col, speedMin: 40, speedMax: 190, lifeMin: 0.3, lifeMax: 1.1, sizeMin: 2, sizeMax: 5.5, grav: 100 });
      this.particles.burst('mist', x, y, 6, { color: 'rgba(80,10,20,0.25)', sizeMin: 8, sizeMax: 22, lifeMin: 0.4, lifeMax: 1.0, speedMin: 5, speedMax: 30 });
    }
  }

  onEnemyKilled(enemy) {
    const p = this.player;
    this.stats.kills++;
    // a kill is a feed; a chain of them is what turns the moon red
    this.climax.noteFeed(this);
    const gain = enemy.type.bloodValue * p.recoveryMul;
    p.heal(gain, this);
    p.sated = Math.min(1.25, 0.7 + gain / 48);
    this.bloodGulp = 0.7 + Math.min(0.4, gain / 80);
    this.drinks = this.drinks || [];
    const look = IAP.fxLook(this.save);
    this.drinks.push({
      ox: enemy.x, oy: enemy.y, t: 0,
      life: 0.55 + Math.min(0.35, gain / 80),
      amount: gain,
      color: (look && look.drink) || (gain > 24 ? '#e02030' : '#a01828'),
    });
    this.stats.feedShards = (this.stats.feedShards || 0) + killShards(enemy);
    this.save.feeds = (this.save.feeds || 0) + 1;
    if (!this.save.coachFed) this.save.coachFed = true;
    this.audio.play('drink', { vol: 0.62 + Math.min(0.4, gain / 48), weight: Math.min(1.7, gain / 18) });
    this.spawnCoatFeed(enemy.x, enemy.y, look);
    this.decals.splat(enemy.x, enemy.y + 4, 16, 'rgba(88,10,18,0.5)', 6);
    if (this.stats.kills === 1 && this.noteDeed('fed')) {
      this.showMessage('YOU FED. THE NIGHT NOTICED THE CHOICE.', { tone: 'cold', life: 3.4 });
    }
    if (!this.save.seen[enemy.key]) { this.save.seen[enemy.key] = true; writeSave(this.save); }
    if (enemy.key === 'werewolf') {
      this.renderer.shake(0.5);
      this.audio.play('stinger', { vol: 0.5 });
      this.showMessage('THE WEREWOLF FALLS. IT WILL NOT STAY DOWN LONG.', { tone: 'cold' });
    }
    if (enemy.key === 'ghoul') {
      this.renderer.shake(0.3);
      this.showMessage('THE GHOUL STOPS TASTING THE DOOR.', { tone: 'cold' });
    }
    if (enemy.key === 'stalker') {
      this.objectives.notify(this, 'stalkerKilled');
      this.showMessage('IT TURNS OUT THEY BLEED TOO.', { tone: 'cold' });
    }
    if (enemy.variant) this.stats.variantsKilled = (this.stats.variantsKilled || 0) + 1;
  }

  damageEntrance(e, amount, source) {
    if (e.broken) return;
    const before = e.hp;
    const press = threatMix(this.save && this.save.nightsSurvived).doorMul;
    this.mansion.damageEntrance(e, amount * press, this, source ? source.x : undefined, source ? source.y : undefined);
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
    this.audio.duck(0.28, 2.1);
    this.particles.burst('splinter', e.x, e.y, 26, {
      color: 'rgba(120,88,50,0.9)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 200, lifeMin: 0.4, lifeMax: 1.2, grav: 190, spin: 8,
    });
    this.particles.burst('dust', e.x, e.y, 18, { color: 'rgba(140,130,115,0.4)', sizeMin: 5, sizeMax: 16, speedMin: 20, speedMax: 70, lifeMin: 0.6, lifeMax: 1.6 });
    this.decals.splat(e.x, e.y, 20, 'rgba(40,30,20,0.35)', 6);
    this.showMessage(`${e.name} GIVES WAY.`, { tone: 'danger' });
    if (e.kind === 'door') this.offerNarrative({ surface: 'strip', event: 'state', state: 'doorLost', night: (this.save.nightsSurvived || 0) + 1 });
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
    if (e.key === 'werewolf' || e.key === 'ghoul') this.renderer.shake(e.key === 'werewolf' ? 0.4 : 0.28);
    if (e.key === 'stalker') { this.audio.play('breath', { vol: 0.4 }); this.feelWatched = 1.6; }
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
    // One caption. A stack of three bars was covering the vampire and the door.
    if (this.messages.length > 1) this.messages.splice(0, this.messages.length - 1);
  }

  showBanner(text, life = 3) {
    this.banner = { text, t: 0, life };
    this.audio.play('stinger', { vol: 0.35, det: 0.01 });
  }

  showCombatText(text, x, y, color) {
    if (!text) return;
    this.combatTexts.push({ text, x, y, color, life: 0.9 });
  }

  spawnBolt(owner, angle, spec) {
    const off = (spec && spec.offset) || 22;
    const speed = (spec && spec.boltSpeed) || owner.type.boltSpeed;
    const damage = (spec && spec.damage) || owner.type.boltDamage;
    const b = new Bolt(
      owner.x + Math.cos(angle) * off,
      owner.y + Math.sin(angle) * off,
      angle, speed, damage, owner,
    );
    this.bolts.push(b);
    if (!spec) {
      this.audio.play('crossbow', { x: owner.x, y: owner.y, cam: this.renderer.cam, vol: 0.85 });
      this.showCombatText('!', owner.x, owner.y - 30, '#e8c060');
    }
  }

  addPickup(x, y, kind, amount) {
    this.pickups.push(new Pickup(x, y, kind, amount));
  }

  addBloodShards(n) {
    if (!n) return;
    this.save.shards += n;
    this.save.totalShards = (this.save.totalShards || 0) + n;
  }

  addRelics(n) {
    if (!n) return;
    this.save.relics = (this.save.relics || 0) + n;
  }

  /** Vials, the basin, the larder. Kills do not use this — feeding stays the meal. */
  grantBlood(amount, diminish = false) {
    const p = this.player;
    const gain = diminish ? packGain(p.blood, p.bloodMax, amount) : amount;
    p.heal(gain, this);
    p.sated = Math.min(1.1, (p.sated || 0) + 0.4);
    this.bloodGulp = 0.55;
    return gain;
  }

  /**
   * Dawn banks the whole purse. Leaving a death banks the floor only.
   * A revive does not call this — the purse stays at risk in the same night.
   */
  settlePurse(why) {
    if (!this.purseReady || this.purseSettled) return;
    this.purseSettled = true;
    const full = Math.max(0, this.shardsEarned || 0);
    const bank = why === 'dawn' ? full : purseFloor(full);
    this.bankedNow = bank;
    this.forfeited = Math.max(0, full - bank);
    this.addBloodShards(bank);
    if (why === 'dawn' && unlocked(this.save, 'relics')) this.addRelics(1);
    markUnlocks(this.save);
    this.save.nightsAttempted = (this.save.nightsAttempted || 0) + 1;
    writeSave(this.save);
  }

  /* ---------------- death ---------------- */

  killPlayer(reason) {
    if (this.player.state === PSTATE.DEAD) return;
    // ---- SECOND BLOOD ---- (IAP entitlement or shard-bought; once per night)
    // It does not make you stronger: it hands back one dawn and drops you in
    // the same dark, mid-swing, at 45% blood. Cap is enforced by the ledger.
    this.noteDeed('died');
    this.player.die(this);
    this.deathReason = reason;
  }

  spendSecondBlood() {
    if (this.usedRevive || this.screen !== 'death') return;
    if (!IAP.takeRevive(this.save)) return;
    this.usedRevive = true;
    writeSave(this.save);
    this.reviveIntoNight();
  }

  /** Hand back one dawn. Same dark, same danger, 45% blood — the cap is the
   *  whole design: this is mercy, not power. The player has to choose it. */
  reviveIntoNight() {
    if (this._objectivePaid) {
      this.shardsEarned = Math.max(0, (this.shardsEarned || 0) - this._objectivePaid);
      this._objectivePaid = 0;
      if (this.objectives) this.objectives._settled = false;
    }
    this.purseSettled = false;
    const p = this.player;
    if (p.state !== PSTATE.DEAD) { /* mid-death-screen revive */ }
    p.state = PSTATE.IDLE;
    p.deathT = 0;
    p.blood = Math.max(p.blood, p.bloodMax * 0.45);
    p.starveT = 0;
    p.iframes = 2.8;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.vx += Math.cos(a) * 260; e.vy += Math.sin(a) * 260;
    }
    this.renderer.shake(0.9);
    this.audio.play('chandelier', { vol: 0.9 });
    this.showMessage('SECOND BLOOD. THE NIGHT ALLOWS ONE DO-OVER.', { tone: 'gold', life: 5 });
    if (this.screen === 'death') this.setScreen('playing');
  }

  /** Rewarded-ad revival from the death screen — opt-in, once per night. */
  async requestAdRevive() {
    if (this.usedRevive) return;
    const res = await Ads.watch('revive');
    if (!res.ok) {
      this.showMessage(res.error === 'user-cancelled' ? 'THE RITUAL WAS DECLINED.' : 'THE RITUAL DID NOT ANSWER.', { tone: 'cold', life: 3.2 });
      return;
    }
    this.usedRevive = true;
    this.reviveIntoNight();
    if (res.mock) this.showMessage('(simulated grant)', { tone: 'cold', life: 2.2 });
  }

  /** Rewarded crate: one Relic, once per day, from the shop. Never shards. */
  async requestAdCrate() {
    const res = await Ads.watch('crate');
    if (!res.ok) { this.showMessage(res.error === 'user-cancelled' ? 'NOT TODAY.' : 'NO CRATE TONIGHT.', { tone: 'cold', life: 2.6 }); return res; }
    this.addRelics(1);
    this.showMessage('A RELIC IN THE CRATE. NOT BLOOD. NOT A CLAW.', { tone: 'gold', life: 4 });
    writeSave(this.save);
    return res;
  }

  beginDying() {
    if (this.screen === 'dying') return;
    // A peak does not survive her. The slow-motion beat especially: the death
    // slow-down owns time from here on.
    this.climax.endFrenzy(this);
    if (this.climax.duel) this.climax.endDuel(this);
    this.screen = 'dying';
    this.dyingT = 0;
    this.deathScreenT = 0;
    this.audio.setHeartbeat(0.6, 0.3);
    this.audio.play('death', { vol: 0.9 });
    this.audio.duck(0.25, 3);
    this.showMessage('', {});
    this.messages.length = 0;
    // the night keeps its stats (objectives pay out with it, partial credit)
    this.finalizeShards(this.time);
    this.settleNight(this.time);
    this.save.bestTime = Math.max(this.save.bestTime, this.time);
    const kills = this.stats.kills;
    if (this.save.bestDefeated === undefined || kills > this.save.bestDefeated) this.save.bestDefeated = kills;
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
    this.renderer.followCamera(this.player.x, this.player.y - this.dyingT * 8, dt, 0, 0, this.mansion.camBounds);
    if (this.dyingT > 4.2) {
      this.screen = 'death';
      this.deathScreenT = 0;
      this.timeScale = 1;
      this.audio.setHeartbeat(0, 0);
      writeSave(this.save);
    }
  }

  after(seconds, fn) { this.timeouts.push({ t: seconds, fn }); }

  /** Merge objective payout into the night's shards and remember the board. */
  settleNight(survived) {
    const won = survived >= NIGHT_DURATION;
    const night = this.objectives.settle(this, won);
    this.lastNightGoals = night.list;
    this.save.goals = this.save.goals || { done: 0, nights: 0 };
    this.save.goals.done += night.done;
    this.save.goals.nights += 1;
    this.shardsEarned = Math.max(0, this.shardsEarned + night.shards);
    this._objectivePaid = night.shards;
    if (night.done) this.showMessage(night.done + ' OF ' + night.list.length + ' GOALS MET', { tone: 'gold', life: 4.2 });
  }

  livePurse() {
    const mins = (this.time || 0) / 60;
    let s = Math.floor(mins * SHARDS.perMinute) + ((this.stats && this.stats.feedShards) || 0);
    return Math.max(0, Math.round(s * nightHeat(this.save && this.save.nightsSurvived)));
  }

  finalizeShards(survived) {
    const mins = survived / 60;
    let s = Math.floor(mins * SHARDS.perMinute);
    s += this.stats.feedShards || 0;
    if (this.objectives && this.objectives.flags && this.objectives.flags.knockSurvived) s += SHARDS.knockSurvived || 0;
    if (survived >= NIGHT_DURATION) s += SHARDS.surviveBonus;
    const heat = nightHeat(this.save && this.save.nightsSurvived);
    this.shardsEarned = Math.max(0, Math.round(s * heat));
    this.purseReady = true;
    return this.shardsEarned;
  }

  /* ---------------- dawn ---------------- */

  beginDawn() {
    if (this.screen === 'dawn' || this.screen === 'dawnCard' || this.screen === 'ending') return;
    this.screen = 'dawn';
    this.dawnT = 0;
    this.audio.setHeartbeat(0, 0);
    this.audio.play('dawnChime', { vol: 0.7 });
    this.audio.duck(0.2, 4);
    this.messages.length = 0;
    this.knocks.length = 0;
    if (this.director.knock) this.director.knock = null;
    // Dawnbreak: the sun does not delete the swarm, it crosses the house and
    // burns it. Everything still standing is handed to the wave (climax.js);
    // the wave is what turns them to ash, one by one, in front of the player.
    this.climax.startDawnWave(this);
    const firstDawn = this.noteDeed('dawned');
    const named = IAP.owns(this.save, 'title_dawnbreaker');
    const laneName = houseTitle(this.save);
    const coat = IAP.equippedCoat(this.save);
    const coatDawn = coat === 'coat_glutton' ? 'THE GLUTTON DRINKS THE MORNING.'
      : coat === 'coat_warden' ? 'THE WARDEN KEPT THE WOOD.'
      : coat === 'coat_shade' ? 'THE SHADE WALKS OUT UNSEEN.'
      : coat === 'coat_moonsilver' ? 'THE WOOL GOES PALE WITH THE WINDOWS.'
      : null;
    this.showMessage(
      named ? 'DAWNBREAKER. THE HOUSE SAYS YOUR NAME.'
        : laneName ? laneName + '. THE MORNING KNOWS THE LANE.'
        : coatDawn || (firstDawn ? 'YOU STAYED. THAT IS THE WHOLE STORY.' : 'THE SUN IS COMING UP.'),
      { tone: 'warm', life: 5 },
    );
    // results
    this.finalizeShards(NIGHT_DURATION);
    this.settleNight(NIGHT_DURATION);
    this.save.nightsSurvived++;
    this.offerNarrative({ surface: 'dawnCard', event: 'dawn', dawn: this.save.nightsSurvived });
    this.newRecord = NIGHT_DURATION > this.save.bestTime;
    this.save.bestTime = Math.max(this.save.bestTime, NIGHT_DURATION);
    this.save.seen.dawn = true;
    this.settlePurse('dawn');
    this.stats.doorsSurviving = this.mansion.doors.filter((d) => !d.broken).length;
    this.stats.doorsTotal = this.mansion.doors.length;
    writeSave(this.save);
    this.presentDawnSurface();
  }

  /** Card, or the Act III choice, before the results. No card means the old dawn. */
  presentDawnSurface() {
    if (endingReady(this.save)) {
      this.screen = 'ending';
      this.endingT = 0;
      this.audio.play('dawnSwell', { vol: 0.75, bus: 'music' });
      return;
    }
    const id = (this.save.pendingDawn || [])[0];
    const card = id && beatById(id);
    if (card) {
      this.dawnCard = card;
      this.dawnCardT = 0;
      this.screen = 'dawnCard';
      this.audio.play('dawnSwell', { vol: 0.7, bus: 'music' });
      return;
    }
    this.screen = 'dawn';
  }

  finishDawnCard() {
    const id = this.dawnCard && this.dawnCard.id;
    if (id) this.save.pendingDawn = (this.save.pendingDawn || []).filter((x) => x !== id);
    this.dawnCard = null;
    this.dawnCardT = 0;
    writeSave(this.save);
    this.screen = 'dawn';
    this.dawnT = 5.0;
    // The act turn rides the same interstitial: Act II begins after the third
    // survived dawn, Act III after the seventh. The ending's dawn is never an
    // act turn — that screen is the choice, and the choice wins.
    const survived = this.save.nightsSurvived || 0;
    const actN = survived === 3 ? 2 : survived === 7 ? 3 : 0;
    if (actN && !endingReady(this.save)) {
      const act = nextBeat(this.save, { surface: 'actCard', event: 'act', act: actN });
      if (act && this.startNarration([act], { kind: 'act', act: actN, after: 'dawn' })) return;
    }
  }

  chooseEnding(which) {
    if (this.save.ending) return;
    const stay = which === 'monster';
    this.save.ending = stay ? 'monster' : 'dawnbreaker';
    this.save.iap = this.save.iap || { owned: {}, revives: 0 };
    this.save.iap.owned = this.save.iap.owned || {};
    this.save.seen = this.save.seen || {};
    if (!stay) {
      this.save.iap.owned.title_dawnbreaker = true;
      this.save.seen['frag:ending-dawnbreaker'] = true;
      this.save.freed = true;
    } else {
      this.save.seen['frag:ending-monster'] = true;
      this.save.houseHeart = true;
    }
    writeSave(this.save);
    this.endingJustChosen = this.save.ending;
    this.screen = 'dawn';
    this.dawnT = 4.4;
  }

  updateDawnCard(dt) {
    this.dawnCardT = (this.dawnCardT || 0) + dt;
    if (this.player) this.player.anim(dt);
    if (this.dawnCardT > 4.6) this.finishDawnCard();
  }

  updateDawn(dt) {
    this.dawnT += dt;
    this.mansion.update(dt, this);
    this.player.update(dt, this);
    this.player.anim(dt);
    this.renderer.followCamera(this.player.x, this.player.y, dt, 0, 0, this.mansion.camBounds);
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

    // fresh immediate-mode registration surface (see update() note)
    this.ui.length = 0;

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
    const gameVisible = ['playing', 'paused', 'intro', 'dying', 'dawn', 'dawnCard', 'ending', 'settings', 'upgrades', 'collection', 'help', 'shop', 'privacy'].includes(this.screen);
    if (gameVisible) {
      // v1.1 — if the purchased GLB never loaded, the player sees this once
      // and the placeholder announces itself every frame after that.
      if (Valen3D.failed && !this._valenWarned) {
        this._valenWarned = true;
        this.showMessage('THE BODY REFUSES TO RISE — CHARACTER ASSET FAILED TO LOAD. RELOAD THE PAGE.', { tone: 'red', life: 9 });
      }
      r.beginWorld();
    }
    // One shadow map per frame for the whole house (issue #54), not one per
    // body: the first body placed refreshes it and the rest reuse it.
    if (Valen3D.beginFrame) Valen3D.beginFrame();
    if (gameVisible) this.renderWorld(dtSafe(this));
    r.resetForUI();
    if (gameVisible) r.drawFrameFade();
    if (gameVisible && this.player && this.player.alive && r.worldToScreen) {
      const s = r.worldToScreen(this.player.x, this.player.y);
      const hv = this.player.hungerVis || 0;
      const sated = this.player.sated || 0;
      if (hv > 0.32 || sated > 0.08) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = sated > 0.08
          ? `rgba(255,150,110,${0.4 + sated * 0.5})`
          : `rgba(220,230,255,${0.22 + (hv - 0.32) * 1.05})`;
        ctx.lineWidth = hv > 0.75 ? 3.4 + hv * 2 : 1.4 + hv * 2.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 52, 22 + hv * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- HUD ----
    if (this.screen === 'playing' || this.screen === 'dying') {
      if (this.screen === 'playing') drawHUD(this, ctx, w, h);
      this.drawMessages(ctx, w, h);
    }
    // ---- the peaks: the four frames the night is for ----
    if (this.screen === 'playing' || this.screen === 'dawn') UI.drawPeakOverlay(this, ctx, w, h);

    // ---- screens ----
    switch (this.screen) {
      case 'intro': UI.drawIntro(this, ctx, w, h); break;
      case 'narration': UI.drawNarration(this, ctx, w, h); break;
      case 'paused': UI.drawPause(this, ctx, w, h); break;
      case 'settings': UI.drawSettings(this, ctx, w, h); break;
      case 'upgrades': UI.drawUpgrades(this, ctx, w, h); break;
      case 'collection': UI.drawCollection(this, ctx, w, h); break;
      case 'help': UI.drawHelp(this, ctx, w, h); break;
      case 'shop': UI.drawShop(this, ctx, w, h); break;
      case 'privacy': UI.drawPrivacy(this, ctx, w, h); break;
      case 'death': UI.drawDeath(this, ctx, w, h); break;
      case 'dawnCard': UI.drawDawnCard(this, ctx, w, h); break;
      case 'ending': UI.drawEnding(this, ctx, w, h); break;
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

  drawFoodCues(ctx) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const near = p && dist(e.x, e.y, p.x, p.y) < PLAYER.attackRange + (e.radius || 12) + 24;
      const hurt = e.hpMax && e.hp / e.hpMax < 0.72;
      if (!near && !hurt) continue;
      const big = (e.type && e.type.bloodValue > 24) ? 1.7 : 1;
      const y = e.y - (e.radius || 12) - 10;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(this.time * 4 + e.x * 0.01));
      ctx.fillStyle = '#c01828';
      ctx.beginPath();
      ctx.moveTo(e.x, y + 7 * big);
      ctx.bezierCurveTo(e.x - 5 * big, y, e.x - 4 * big, y - 6 * big, e.x, y - 2 * big);
      ctx.bezierCurveTo(e.x + 4 * big, y - 6 * big, e.x + 5 * big, y, e.x, y + 7 * big);
      ctx.fill();
      ctx.restore();
    }
  }

  drawDrinks(ctx) {
    const p = this.player;
    if (!p || !this.drinks) return;
    for (const d of this.drinks) {
      const k = clamp(d.t / d.life, 0, 1);
      for (let i = 0; i < 8; i++) {
        const u = clamp(k * 1.2 - i * 0.07, 0, 1);
        const x = d.ox + (p.x - d.ox) * u;
        const y = d.oy + (p.y - d.oy) * u - Math.sin(u * Math.PI) * (18 + d.amount * 0.15);
        ctx.save();
        ctx.globalAlpha = (1 - k) * (0.45 + (1 - i / 8) * 0.55);
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(x, y, 2.4 + (d.amount > 24 ? 2.2 : 0.8) + (1 - i / 8) * 1.4, 0, Math.PI * 2);
        ctx.fill();
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
    // ---------- the duel: a monster is scarier as a silhouette ----------
    // Drawn under the actors on purpose: the light is behind it, so what the
    // player reads is the SHAPE, which is the whole point of a reveal.
    const duelBoss = this.climax.boss;
    if (duelBoss && this.climax.duel && this.duelDark > 0.02 && r.isVisible(duelBoss.x, duelBoss.y, 560)) {
      const k = clamp(this.duelDark, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const gx = duelBoss.x, gy = duelBoss.y - 46;
      const gg = ctx.createRadialGradient(gx, gy, 8, gx, gy, 330);
      gg.addColorStop(0, `rgba(255,158,104,${0.9 * k})`);
      gg.addColorStop(0.32, `rgba(226,72,54,${0.52 * k})`);
      gg.addColorStop(0.7, `rgba(140,20,26,${0.22 * k})`);
      gg.addColorStop(1, 'rgba(70,8,12,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(gx, gy, 330, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // ---------- decals ----------
    this.decals.draw(ctx);
    // ---------- props under entities ----------
    m.drawProps(ctx, this);
    this.house.draw(ctx, this);   // the cat, the drafts — before the actors
    this.haunts.drawWatchers(ctx, this);   // the things at the edge of the light
    // ---------- the room itself, in three dimensions (issue #55) ----------
    // Doors first: real meshes, on the shared floor, under the shared lamp.
    // Drawn before the actors so she walks in FRONT of a door she opened, and
    // after the floor so the painted room stays as the ground beneath them.
    EnvKit.init();
    if (EnvKit.ready) {
      EnvKit.sync(this.mansion.entrances);
      const env = EnvKit.render({
        camX: r.cam.x, camY: r.cam.y, zoom: r.cam.zoom, tilt: r.tilt,
        w: r.view.w, h: r.view.h, dpr: r.dpr,
        shakeX: r.cam.sx, shakeY: r.cam.sy,
        light: r.keyLightAt(r.cam.x, r.cam.y),
      });
      if (env) {
        ctx.save();
        ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
        ctx.drawImage(env, r.view.left, r.view.top, r.view.w, r.view.h);
        ctx.restore();
      }
    }

    // ---------- dust motes (air, not floor — billboard around the view) ----------
    ctx.save(); r.upright(ctx, this.renderer.cam.x, this.renderer.cam.y);
    this.drawAmbientMotes(ctx);
    ctx.restore();
    // ---------- pickups (stand tall like everything alive) ----------
    for (const pk of this.pickups) {
      ctx.save(); r.upright(ctx, pk.x, pk.y);
      pk.draw(ctx, this);
      ctx.restore();
    }

    // ---------- bodies and tall props, one depth order ----------
    // A table in front of a crawler hides the crawler. A body in front of the
    // table hides the table. Valen uses the same foot-y as the swarm.
    // The house's own light field, so every body is lit by the lamp that is
    // lighting the floor it is standing on (issue #54).
    Enemy3D.setLightSampler((x, y) => r.keyLightAt(x, y));
    Enemy3D.assign(this.enemies, p);
    const layer = [];
    for (const e of this.enemies) layer.push({ y: e.y, enemy: e });
    for (const f of m.furniture) {
      if (!isTallProp(f)) continue;
      layer.push({ y: propFootY(f), prop: f });
    }
    layer.push({ y: p.y, player: true });
    for (const proof of Enemy3D.proofs || []) layer.push({ y: proof.y, proof });
    layer.sort((a, b) => a.y - b.y);
    for (const item of layer) {
      if (item.player) { this.drawPlayerLayer(ctx); continue; }
      if (item.prop) {
        const f = item.prop;
        if (!r.isVisible(f.x, f.y, Math.max(f.w, f.h) + 60)) continue;
        ctx.save();
        drawFurnitureShape(ctx, f, this, t);
        ctx.restore();
        continue;
      }
      if (item.proof) {
        if (!r.isVisible(item.proof.x, item.proof.y, 160)) continue;
        ctx.save();
        r.upright(ctx, item.proof.x, item.proof.y);
        Enemy3D.draw(ctx, item.proof, this);
        ctx.restore();
        continue;
      }
      const e = item.enemy;
      if (!r.isVisible(e.x, e.y, 120)) continue;
      ctx.save();
      r.upright(ctx, e.x, e.y);
      if (!e.dead && Math.hypot(e.vx, e.vy) > 16) {
        const ph = Math.sin(t * (e.key === 'werewolf' ? 16 : 9) + e.id);
        ctx.translate(e.x, e.y);
        ctx.scale(1 + ph * 0.03, 1 - Math.abs(ph) * 0.035);
        ctx.translate(-e.x, -e.y);
      }
      if (!Enemy3D.draw(ctx, e, this)) e.draw(ctx, this);
      ctx.restore();
      // v1.0 variant tell: a cold tint ring — readable at a glance in the dark
      if (e.variant && e.tint && !e.dead) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = e.tint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 8, e.radius * 1.5, e.radius * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    this.drawFoodCues(ctx);
    this.drawDrinks(ctx);

    // ---------- bolts ----------
    for (const b of this.bolts) if (r.isVisible(b.x, b.y, 60)) {
      ctx.save(); r.upright(ctx, b.x, b.y);
      b.draw(ctx, this);
      ctx.restore();
    }

    // ---------- furniture + architecture above the floor ----------
    m.drawFurniture(ctx, this, { skipTall: true });
    m.drawEntrances(ctx, this);
    m.drawLightFixtures(ctx, this);

    // ---------- particles ----------
    ctx.save(); r.upright(ctx, this.renderer.cam.x, this.renderer.cam.y);
    this.particles.draw(ctx);
    ctx.restore();

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
    r.fadeLift = this.blackoutT > 0 ? 0.7 : 1;
    // the duel's lights-out: the same lift the blackout uses, borrowed
    if (this.duelDark > 0.02) r.fadeLift *= 1 - 0.88 * this.duelDark;
    r.fadeColor = this.bloodMoon > 0.3 ? '#9a8088' : '#8490a4';
    r.lightBegin(m.ambientFor(this));
    p.submitLight(r, this);
    m.submitLights(r, this);
    for (const e of this.enemies) {
      if (e.submitLight && !e.dead && r.isVisible(e.x, e.y, 220)) e.submitLight(r, this);
    }
    // the duel's reveal: one pool of red in a house with no lights in it
    if (duelBoss && this.climax.duel) {
      const hot = this.climax.duel.stage === 'cut' ? 1 : 0.55;
      r.addLight(duelBoss.x, duelBoss.y - 10, 320, 0.95 * hot, [255, 92, 66]);
      r.addLight(duelBoss.x, duelBoss.y - 40, 150, 0.7 * hot, [255, 130, 90]);
    }
    // muzzle flashes / impacts
    for (const b of this.bolts) r.addLight(b.x, b.y, 70, 0.3, [255, 220, 170]);
    r.lightEnd();
    // The guide arrow and the claw are pointers, not floor stains. Drawn
    // after the multiply so the night cannot swallow them.
    drawCoachWorld(this, ctx);
    p.drawSwing(ctx, this);
    for (const b of this.bolts) {
      if (b.dead || !r.isVisible(b.x, b.y, 80)) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = 'rgba(255, 214, 150, 0.9)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(b.angle) * 14, b.y - Math.sin(b.angle) * 14);
      ctx.lineTo(b.x + Math.cos(b.angle) * 8, b.y + Math.sin(b.angle) * 8);
      ctx.stroke();
      ctx.restore();
    }

    // ---------- character self-light (moonlight on the GLB frame) ----------
    Enemy3D.paintLit(ctx, this);
    this.player.drawAfterDark(ctx, this);

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
      vignette: 0.18 + this.danger * 0.08 + (this.bloodMoon) * 0.05,
      danger: this.danger,
      lowBlood: lb,
      heartbeat: this.hbPulse,
      blackout: this.screen === 'dying' ? clamp(this.dyingT / 4, 0, 0.8) : 0,
      time: this.now,
      // the peaks' grades: red edges on the crescendo and the frenzy, a blood
      // wash while the moon is up
      edge: this.climax.edge,
      red: this.climax.red,
    });

    // ---------- dawnbreak: the sun crosses the house and burns the swarm ----------
    const wave = this.climax.dawnWave;
    if (wave) {
      const s = this.renderer.worldToScreen(wave.front, 0);
      const bw = Math.max(180, this.renderer.w * 0.34);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(s.x - bw, 0, s.x + bw * 0.3, 0);
      g.addColorStop(0, 'rgba(255,190,110,0)');
      g.addColorStop(0.52, `rgba(255,204,136,${0.5 * this.climax.gold})`);
      g.addColorStop(0.86, `rgba(255,250,236,${1.0 * this.climax.gold})`);
      g.addColorStop(0.94, `rgba(255,236,196,${0.55 * this.climax.gold})`);
      g.addColorStop(1, 'rgba(255,226,180,0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x - bw, 0, bw * 1.3, this.renderer.h);
      const wash = ctx.createLinearGradient(0, 0, this.renderer.w, this.renderer.h);
      wash.addColorStop(0, `rgba(255,220,164,${0.42 * this.climax.gold})`);
      wash.addColorStop(1, `rgba(255,170,120,${0.16 * this.climax.gold})`);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, this.renderer.w, this.renderer.h);
      ctx.restore();
    }

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
    const p = this.player;
    // Floor cues live in the tilted world, so they point the way she actually
    // walks. Prompts are drawn AFTER upright is popped — they were previously
    // counter-scaled around her feet, which shoved door labels and knock
    // arrows off their targets.
    if (p.alive) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = 'rgba(176, 198, 232, 0.55)';
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(32, -5);
      ctx.lineTo(28, 0);
      ctx.lineTo(32, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.save(); this.renderer.upright(ctx, p.x, p.y);
    p.draw(ctx, this);
    ctx.restore();
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
      const rm = this.mansion.room(room);
      if (!rm) break;
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
    const captionsOn = !this.save.settings || this.save.settings.captions !== 0;
    const msgs = captionsOn ? this.messages : [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = msgs[msgs.length - 1];
    if (m) {
      const inA = clamp(m.t / 0.35, 0, 1);
      const outA = clamp((m.life - m.t) / 0.6, 0, 1);
      const a = inA * outA;
      const tone = m.tone === 'danger' ? '#e2685c' : m.tone === 'gold' ? '#e0c070' : m.tone === 'warm' ? '#e0c48a' : m.tone === 'calm' ? '#a8b0c0' : '#cfc6b0';
      const view = this.renderer.view || { top: 0, h, left: 0, w, cy: h / 2 };
      const framed = view.top > 8 || view.h < h - 8;
      const phone = w < 840 || h < 500;
      const stick = this.input && this.input.stick;
      const stickTop = stick ? ((stick.homeY || h - 120) - stick.r) : h - 80;
      // One chip, above the thumbs. Never a stack across the middle of the room.
      const y = phone ? Math.min(stickTop - 36, h - 176) : h * 0.72;
      const maxW = Math.min(framed ? view.w - 28 : w * 0.72, phone ? 280 : 560);
      const fontPx = phone ? 12 : 14;
      ctx.font = `500 ${fontPx}px "Segoe UI", Roboto, sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
      const lines = [];
      for (const base of String(m.text).split('\n')) {
        let cur = '';
        for (const word of base.split(' ')) {
          const next = cur ? cur + ' ' + word : word;
          if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = word; }
          else cur = next;
        }
        if (cur) lines.push(cur);
      }
      const shown = lines.slice(0, 2);
      let maxLw = 0;
      for (const ln of shown) maxLw = Math.max(maxLw, ctx.measureText(ln).width);
      const scrW = Math.min(maxW + 22, maxLw + 22);
      const scrH = shown.length * (fontPx + 6) + 10;
      ctx.globalAlpha = a * 0.88;
      ctx.fillStyle = 'rgba(6,7,10,0.88)';
      ctx.fillRect(w / 2 - scrW / 2, y - scrH / 2, scrW, scrH);
      ctx.strokeStyle = tone;
      ctx.globalAlpha = a * 0.45;
      ctx.strokeRect(w / 2 - scrW / 2 + 0.5, y - scrH / 2 + 0.5, scrW - 1, scrH - 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = tone;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      for (let l = 0; l < shown.length; l++) {
        ctx.fillText(shown[l], w / 2, y + l * (fontPx + 6) - (shown.length - 1) * (fontPx + 6) / 2);
      }
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
        const view = this.renderer.view;
        const by = view && view.top > 8 ? view.top + 28 : h * 0.2;
        ctx.fillText(b.text, w / 2, by);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(180,150,80,0.5)';
        ctx.lineWidth = 1;
        const tw = ctx.measureText(b.text).width;
        ctx.beginPath();
        ctx.moveTo(w / 2 - tw / 2 - 20, by + 26);
        ctx.lineTo(w / 2 + tw / 2 + 20, by + 26);
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
    // pause toggle FIRST — it exists precisely for the 'playing' screen, so it
    // cannot live behind the menu guard below. (v1.0 FIX, live click test:
    // ESC during play had been unreachable since the base checkout.)
    if (input.keys.pause && !this._pauseHeld) {
      this._pauseHeld = true;
      if (this.screen === 'playing') this.togglePause(true);
      else if (this.screen === 'paused') this.togglePause(false);
    }
    if (!input.keys.pause) this._pauseHeld = false;
    if (input.keys.weapon && !this._weaponHeld && this.screen === 'playing') {
      this._weaponHeld = true;
      this.cycleWeapon();
    }
    if (!input.keys.weapon) this._weaponHeld = false;
    if (this.screen === 'playing' && input.uiTap && this._weaponChip) {
      const chip = this._weaponChip;
      const tap = input.uiTap;
      if (tap.x >= chip.x && tap.x <= chip.x + chip.w && tap.y >= chip.y && tap.y <= chip.y + chip.h) {
        input.uiTap = null;
        this.cycleWeapon();
        return;
      }
    }
    if (this.screen === 'playing' && input.uiTap) {
      const box = pauseButtonBox(this.renderer.w, this.renderer.h);
      const tap = input.uiTap;
      if (tap.x >= box.x && tap.x <= box.x + box.w && tap.y >= box.y && tap.y <= box.y + box.h) {
        input.uiTap = null;
        this.audio.play('uiConfirm', { vol: 0.4 });
        this.togglePause(true);
        return;
      }
    }
    if (this.screen === 'intro') {
      if (input.uiTap) { this._introTap = true; input.uiTap = null; }
      return;
    }
    const inMenu = this.screen !== 'playing' && this.screen !== 'dying' && this.screen !== 'dawn';
    if (!inMenu) { this.uiIndex = 0; input.uiTap = null; return; }  // taps spent during play must not pop a menu button later
    // keyboard navigation
    if (input.keys.up && !this._navUp) { this.uiIndex = Math.max(0, this.uiIndex - 1); this.usingKeyboard = true; this.audio.play('uiHover', { vol: 0.3 }); }
    if (input.keys.down && !this._navDown) { this.uiIndex = Math.min(99, this.uiIndex + 1); this.usingKeyboard = true; this.audio.play('uiHover', { vol: 0.3 }); }
    this._navUp = input.keys.up; this._navDown = input.keys.down;
    // clicking — one channel for mouse and touch (input posts uiTap on both)
    {
      const tap = input.uiTap;
      if (tap) {
        input.uiTap = null;
        let hit = null;
        for (const b of this.ui) {
          if (b.slider) continue;
          if (b.disabled) continue;
          if (tap.x > b.x && tap.x < b.x + b.w && tap.y > b.y && tap.y < b.y + b.h) { hit = b; }
        }
        if (hit && hit.onClick) { this.audio.play('uiConfirm', { vol: 0.4 }); hit.onClick(); }
        // A tap that hits nothing is still an answer on the narrator's plate:
        // it steps the line on. No dead input, and SKIP still wins the hit.
        else if (this.screen === 'narration') this._narrationTap = true;
      }
    }
    if (input.keys.confirm && !this._confirmHeld) {
      this._confirmHeld = true;
      const b = this.ui[this.uiIndex];
      if (b && b.onClick && !b.disabled) { this.audio.play('uiConfirm', { vol: 0.5 }); b.onClick(); }
    }
    if (!input.keys.confirm) this._confirmHeld = false;
  }
}

function dtSafe(game) { return game.dt; }
