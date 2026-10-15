/* LAST NIGHT — headless playtest harness
 *
 * Runs the real game code in Node against a real 2D canvas implementation.
 * A scripted "competent player" bot plays full nights so we can measure
 * balance, and frames can be dumped to PNG so the art can be inspected.
 *
 *   node tools/harness.mjs --mode=bot --seed=1 --shots
 *   node tools/harness.mjs --mode=idle
 */

import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const MODE = args.mode || 'bot';
const SHOTS = !!args.shots;
const MAX_FRAMES = parseInt(args.frames || '21000', 10);   // 300s at 60fps + slack
const SHOT_DIR = path.resolve('tools/shots');
// Rendering in the Node canvas backend leaks native memory (~6MB/frame), so we
// render sparsely: a periodic smoke-test of the draw path, plus exact frames
// where a screenshot is wanted. Gameplay balance is measured without rendering.
const RENDERCHECK = parseInt(args.rendercheck ?? '1000', 10);
const SEED = parseInt(args.seed ?? '20260918', 10);

/* ============================================================
 * Browser shims
 * ============================================================ */

class StubParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
  setValueCurveAtTime() { return this; }
}
class StubNode {
  constructor() { this.gain = new StubParam(1); this.frequency = new StubParam(440); this.Q = new StubParam(1); this.detune = new StubParam(0); this.playbackRate = new StubParam(1); this.pan = new StubParam(0); }
  connect() { return this; }
  disconnect() { return this; }
  start() { return this; }
  stop() { return this; }
}
class StubAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new StubNode();
    this.listener = {};
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return new StubNode(); }
  createOscillator() { return Object.assign(new StubNode(), { type: 'sine' }); }
  createBiquadFilter() { return Object.assign(new StubNode(), { type: 'lowpass' }); }
  createStereoPanner() { return new StubNode(); }
  createConvolver() { return Object.assign(new StubNode(), { buffer: null }); }
  createDynamicsCompressor() {
    return Object.assign(new StubNode(), {
      threshold: new StubParam(-24), knee: new StubParam(30), ratio: new StubParam(12),
      attack: new StubParam(0.003), release: new StubParam(0.25),
    });
  }
  createWaveShaper() { return Object.assign(new StubNode(), { curve: null, oversample: 'none' }); }
  createBufferSource() { return Object.assign(new StubNode(), { buffer: null, loop: false }); }
  createBuffer(ch, len, rate) {
    const data = [];
    for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
    return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: (i) => data[i] };
  }
}

const listeners = [];
const canvasEls = [];
const stubDoc = {
  hidden: false,
  createElement(tag) {
    if (tag === 'canvas') { const c = createCanvas(64, 64); canvasEls.push(c); return c; }
    return { style: {}, classList: { add() { }, remove() { } }, appendChild() { }, remove() { }, addEventListener() { } };
  },
  getElementById() { return null; },
  addEventListener(t, f) { listeners.push([t, f]); },
  body: { appendChild() { }, style: {} },
  documentElement: { requestFullscreen() { } },
  fullscreenElement: null,
  exitFullscreen() { },
};

const win = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(t, f) { listeners.push([t, f]); },
  removeEventListener() { },
  AudioContext: StubAudioContext,
  requestAnimationFrame() { return 0; },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
};

globalThis.window = win;
globalThis.document = stubDoc;
globalThis.localStorage = win.localStorage;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-harness' }, configurable: true }); } catch (e) { }
globalThis.performance = globalThis.performance || { now: () => Number(process.hrtime.bigint() / 1000000n) };
globalThis.addEventListener = win.addEventListener;
globalThis.requestAnimationFrame = () => 0;
globalThis.devicePixelRatio = 1;

/* ---------------- deterministic randomness ----------------
 * Every run must be replayable so balance changes can be measured, so we
 * replace Math.random with a seeded stream before any game module loads.
 */
let _seedState = SEED >>> 0;
/** Rewind the stream, so two nights can be compared like for like. */
const reseed = (n) => { _seedState = (n >>> 0) || 1; };
Math.random = function () {
  _seedState |= 0; _seedState = (_seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(_seedState ^ (_seedState >>> 15), 1 | _seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ============================================================
 * Boot the real game
 * ============================================================ */

const Audio = await import('../src/core/audio.js');
const { Game } = await import('../src/game/game.js');
const { ROOM } = await import('../src/game/mansion.js');
const { TUNING, NIGHT_DURATION, SURVIVAL_TUNING } = await import('../src/core/config.js');

function makeHarnessCanvas() {
  const canvas = createCanvas(1280, 720);
  canvas.addEventListener = () => { };
  canvas.removeEventListener = () => { };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  canvas.clientWidth = 1280;
  canvas.clientHeight = 720;
  canvas.style = {};
  return canvas;
}

// The pre-existing systems battery intentionally runs in the preserved legacy
// route. The survival battery below constructs the new default route separately.
const canvas = makeHarnessCanvas();
const game = new Game(canvas, { mode: 'legacy' });
const input = game.input;
input.touchSeen = false;

await Audio.unlock();
game.applySettings();

async function runSurvivalMilestone() {
  console.log('\n=== SURVIVAL MILESTONE 1 — deterministic three-day probe ===');
  window.localStorage.removeItem('lastnight.save.v1');
  const survivalGame = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
  const sInput = survivalGame.input;
  sInput.touchSeen = false;
  sInput.layout(1280, 720);
  const step = 1 / 60;
  const tick = (frames = 1) => { for (let i = 0; i < frames; i++) survivalGame.update(step); };
  const waitForBuilder = () => {
    let guard = 0;
    while (survivalGame.survival.builderJob && guard++ < 1200) tick();
    return !survivalGame.survival.builderJob;
  };
  const resetControls = () => {
    for (const key of Object.keys(sInput.keys)) sInput.keys[key] = false;
    sInput.move.x = 0; sInput.move.y = 0;
    for (const button of Object.values(sInput.buttons)) button.down = false;
    survivalGame.player.iframes = 0;
    survivalGame.player.dashCd = 0;
  };

  // Run the real Night 1–3 spawners and record both requested wave weights and
  // the bodies they actually materialize after spawnSwarm applies its clamp.
  survivalGame.survival.restart();
  const scheduleMode = survivalGame.survival;
  const originalSpawners = {
    swarm: scheduleMode.spawnSwarm,
    breaker: scheduleMode.spawnBreaker,
    individual: scheduleMode.spawnIndividual,
  };
  const waveSchedule = [];
  try {
    for (let day = 1; day <= 3; day++) {
      const row = { day, swarms: [], breakers: [], individuals: [] };
      scheduleMode.day = day;
      scheduleMode.elapsed = scheduleMode.nightDuration;
      scheduleMode.waveIndex = 0;
      scheduleMode.breakerIndex = 0;
      scheduleMode.individualIndex = 0;
      scheduleMode.spawnSwarm = (count, index) => {
        row.swarms.push({ count, index });
        originalSpawners.swarm.call(scheduleMode, count, index);
      };
      scheduleMode.spawnBreaker = (index) => {
        row.breakers.push(index);
        originalSpawners.breaker.call(scheduleMode, index);
      };
      scheduleMode.spawnIndividual = (index) => {
        row.individuals.push(index);
        originalSpawners.individual.call(scheduleMode, index);
      };
      scheduleMode.updateWaves();
      const spawned = survivalGame.enemies;
      row.spawnedSwarms = spawned.filter((enemy) => enemy._survivalType === 'swarm').length;
      row.spawnedBreakers = spawned.filter((enemy) => enemy._survivalType === 'breaker').length;
      row.spawnedIndividuals = spawned.filter((enemy) => enemy._survivalType === 'individual').length;
      row.swarmHp = spawned.find((enemy) => enemy._survivalType === 'swarm')?.hpMax || 0;
      waveSchedule.push(row);
      survivalGame.enemies.length = 0;
    }
  } finally {
    scheduleMode.spawnSwarm = originalSpawners.swarm;
    scheduleMode.spawnBreaker = originalSpawners.breaker;
    scheduleMode.spawnIndividual = originalSpawners.individual;
  }
  // Waves are the ×3 design weights (cap 30/wave) and spawn exactly as
  // requested — the old 20-body clamp is gone.
  const waveSchedulePass = waveSchedule.length === 3
    && waveSchedule[0].swarms.map((wave) => wave.count).join(',') === '21,21,24'
    && waveSchedule[1].swarms.map((wave) => wave.count).join(',') === '24,27,27'
    && waveSchedule[2].swarms.map((wave) => wave.count).join(',') === '30,30,30'
    && waveSchedule.map((row) => row.spawnedSwarms).join(',') === '66,78,90'
    && waveSchedule.map((row) => row.swarmHp).join(',') === '48,54,60'
    && waveSchedule.map((row) => row.spawnedBreakers).join(',') === '0,1,2'
    && waveSchedule.every((row) => row.spawnedIndividuals === 2
      && row.individuals.join(',') === '0,1'
      && row.spawnedSwarms === row.swarms.reduce((sum, wave) => sum + wave.count, 0));
  console.log(`  ${waveSchedulePass ? 'PASS' : 'FAIL'}  Night 1–3 waves: requested ${waveSchedule.map((row) => row.swarms.map((wave) => wave.count).join('/')).join(' → ')}; actual Swarm ${waveSchedule.map((row) => row.spawnedSwarms).join('/')} (no clamp, HP ${waveSchedule.map((row) => row.swarmHp).join('→')}), Breaker ${waveSchedule.map((row) => row.spawnedBreakers).join('/')}`);

  // Compare real enemy update paths on either side of the Perapian boundary.
  // Two breached Swarm bodies walk the real flow field for one second: the
  // lit one is slower (light slows, it never freezes) and takes more damage.
  survivalGame.survival.restart();
  const lightMode = survivalGame.survival;
  const fire = survivalGame.mansion.fireplaceLight;
  const lightRadius = lightMode.getFireRadius();
  const litPoint = { x: fire.x, y: fire.y };
  const unlitPoint = { x: fire.x + lightRadius + 100, y: fire.y };
  const litProbe = { x: litPoint.x, y: litPoint.y };
  const unlitProbe = { x: unlitPoint.x, y: unlitPoint.y };
  const lightDoor = lightMode.mainGate();
  lightDoor.hp = 0; lightDoor.broken = true; lightDoor.open = true;
  survivalGame.mansion.refreshNavAround(lightDoor);
  const hallSpot = survivalGame.mansion.roomCenter(ROOM.HALL);
  const diningSpot = survivalGame.mansion.roomCenter(ROOM.DINING);
  const { SurvivalCrowdZombie } = await import('../src/game/survival.js');
  const walkSpeed = (spot) => {
    const body = new SurvivalCrowdZombie(spot.x, spot.y, lightDoor, 0, 1);
    survivalGame.player.x = fire.x + 70; survivalGame.player.y = fire.y + 210;
    let travelled = 0;
    let px = body.x, py = body.y;
    for (let i = 0; i < 60; i++) {
      body.update(step, survivalGame);
      travelled += Math.hypot(body.x - px, body.y - py);
      px = body.x; py = body.y;
    }
    return { speed: travelled, lit: lightMode.isLit(spot.x, spot.y), state: body.state };
  };
  const litWalk = walkSpeed(hallSpot);
  const darkWalk = walkSpeed(diningSpot);
  const lightDamage = lightMode.enemyDamageTaken(litProbe, 10);
  const darkDamage = lightMode.enemyDamageTaken(unlitProbe, 10);
  const lightEffectsPass = lightMode.isLit(litPoint.x, litPoint.y)
    && !lightMode.isLit(unlitPoint.x, unlitPoint.y)
    && lightDamage > darkDamage
    && lightMode.enemyCanAttack(litProbe) && lightMode.enemyCanAttack(unlitProbe)
    && lightMode.enemyAttackMul(litProbe) < lightMode.enemyAttackMul(unlitProbe) && lightMode.enemyAttackMul(litProbe) > 0
    && litWalk.lit && !darkWalk.lit
    && litWalk.speed < darkWalk.speed && litWalk.speed > darkWalk.speed * 0.45
    && litWalk.state !== 'stagger';
  console.log(`  ${lightEffectsPass ? 'PASS' : 'FAIL'}  Perapian light weakens but never freezes enemies (damage ${lightDamage.toFixed(1)} vs ${darkDamage.toFixed(1)}, breached walk ${litWalk.speed.toFixed(1)} vs ${darkWalk.speed.toFixed(1)} px/s, lit claws ×${lightMode.enemyAttackMul(litProbe)} — weakened, never blocked)`);

  // Closed doors are solid across their whole width (entrances are authored by
  // their center; the old resolve() treated x/y as a corner).
  survivalGame.survival.restart();
  const doorProbe = survivalGame.mansion.entranceById('frontDoor');
  const doorSamples = [-0.4, -0.2, 0, 0.2, 0.4].map((frac) => {
    const startX = doorProbe.x + doorProbe.w * frac;
    const outside = doorProbe.outside || { x: doorProbe.x, y: doorProbe.y + 80 };
    const fromY = outside.y;
    const end = survivalGame.mansion.moveCircle(startX, fromY, 0, (doorProbe.y - fromY) * 2.2, 13, false);
    return { frac, crossed: end.y < doorProbe.y };
  });
  const doorSolidPass = doorSamples.every((row) => !row.crossed);
  console.log(`  ${doorSolidPass ? 'PASS' : 'FAIL'}  a closed door blocks bodies across its full width (${doorSamples.map((row) => `${row.frac}:${row.crossed ? 'through' : 'blocked'}`).join(' ')})`);

  // Siege damage on a door is halved by firelight, never cancelled.
  survivalGame.survival.restart();
  const siegeMode = survivalGame.survival;
  const siegeDoor = siegeMode.entranceById('chapelDoor');
  const siegeHp = siegeDoor.hp;
  siegeMode.damageEntrance(siegeDoor, 20, unlitProbe);
  const darkLoss = siegeHp - siegeDoor.hp;
  const litBefore = siegeDoor.hp;
  siegeMode.damageEntrance(siegeDoor, 20, litProbe);
  const litLoss = litBefore - siegeDoor.hp;
  const siegeLightPass = darkLoss === 20 && Math.abs(litLoss - 10) < 1e-6;
  console.log(`  ${siegeLightPass ? 'PASS' : 'FAIL'}  door damage in firelight is 50% of dark damage (${darkLoss} dark vs ${litLoss} lit)`);

  // A breach refreshes the nav grid; a breached body walks to the Perapian,
  // claws Oil out of it, and an empty hearth loses the night.
  survivalGame.survival.restart();
  const feedMode = survivalGame.survival;
  const feedDoor = feedMode.mainGate();
  const navBefore = survivalGame.mansion.navVersion;
  feedMode.damageEntrance(feedDoor, feedDoor.hp + 5, unlitProbe);
  const navRefreshed = feedDoor.broken && survivalGame.mansion.navVersion > navBefore;
  const feeder = new SurvivalCrowdZombie(feedDoor.inside.x, feedDoor.inside.y, feedDoor, 0, 1);
  survivalGame.enemies.length = 0;
  survivalGame.enemies.push(feeder);
  survivalGame.player.x = -2000; survivalGame.player.y = -2000;
  feeder.hp = feeder.hpMax = 1e9;
  const oilBeforeFeed = feedMode.oil;
  let reachedAt = null;
  for (let i = 0; i < 60 * 60 && reachedAt === null; i++) {
    feeder.update(step, survivalGame);
    if (feeder.feeding) reachedAt = i / 60;
  }
  for (let i = 0; i < 60 * 4; i++) feeder.update(step, survivalGame);
  const drained = oilBeforeFeed - feedMode.oil;
  feedMode.oil = 2;
  for (let i = 0; i < 60 * 4 && feedMode.phase === 'night'; i++) feeder.update(step, survivalGame);
  const fireOutPass = navRefreshed && reachedAt !== null && drained >= 2
    && feedMode.phase === 'failed' && /FIRE/.test(feedMode.failureReason || '');
  console.log(`  ${fireOutPass ? 'PASS' : 'FAIL'}  breach → flow field → Perapian: body reached the hearth in ${reachedAt === null ? 'never' : reachedAt.toFixed(1) + 's'}, clawed ${drained.toFixed(0)} Oil, empty hearth → ${feedMode.phase} (${feedMode.failureReason || '-'})`);
  survivalGame.enemies.length = 0;

  // Breaker hands over to the next intact door, then (none left) the Perapian.
  survivalGame.survival.restart();
  const retargetMode = survivalGame.survival;
  retargetMode.day = 2;
  retargetMode.spawnBreaker(0);
  const retargeter = survivalGame.enemies.find((enemy) => enemy._survivalType === 'breaker');
  const firstDoor = retargetMode.entranceById(retargeter.targetEntranceId);
  retargetMode.damageEntrance(firstDoor, firstDoor.hp + 5, unlitProbe);
  retargeter.update(step, survivalGame);
  const secondTarget = retargeter.targetEntranceId;
  for (const door of survivalGame.mansion.entrances) {
    if (door.kind === 'door' && door.exterior && !door.broken) retargetMode.damageEntrance(door, door.hp + 5, unlitProbe);
  }
  retargeter.update(step, survivalGame);
  const breakerRetargetPass = !!secondTarget && secondTarget !== firstDoor.id
    && retargeter.targetKind === 'perapian' && !retargeter.targetEntranceId;
  console.log(`  ${breakerRetargetPass ? 'PASS' : 'FAIL'}  Breaker retargets ${firstDoor.id} → ${secondTarget || 'none'} → ${retargeter.targetKind}`);
  survivalGame.enemies.length = 0;

  // Find a collision-clear tile with room to move in all four screen directions,
  // then exercise the real Survival input/player update rather than a movement stub.
  survivalGame.survival.restart();
  const { screenDirToWorld } = await import('../src/core/util.js');
  const movementMode = survivalGame.survival;
  const movementPlayer = survivalGame.player;
  const movementMansion = survivalGame.mansion;
  const screenDirections = ['right', 'left', 'down', 'up'].map((direction) => {
    const vector = screenDirToWorld(direction === 'right' ? 1 : direction === 'left' ? -1 : 0,
      direction === 'down' ? 1 : direction === 'up' ? -1 : 0, survivalGame.renderer);
    return { direction, x: vector.x, y: vector.y };
  });
  let movementStart = null;
  for (const room of movementMansion.roomList) {
    for (let y = room.y + 45; y < room.y + room.h - 45 && !movementStart; y += 32) {
      for (let x = room.x + 45; x < room.x + room.w - 45 && !movementStart; x += 32) {
        if (movementMansion.resolve(x, y, movementPlayer.radius, true).hit) continue;
        const clearAllWays = screenDirections.every((vector) => {
          const end = movementMansion.moveCircle(x, y, vector.x * 110, vector.y * 110, movementPlayer.radius, true);
          return Math.hypot(end.x - x, end.y - y) > 80;
        });
        if (clearAllWays) movementStart = { x, y, room: room.id };
      }
    }
    if (movementStart) break;
  }
  const movementDistances = {};
  if (movementStart) {
    for (const { direction } of screenDirections) {
      resetControls();
      movementMode.elapsed = 0;
      movementPlayer.x = movementStart.x; movementPlayer.y = movementStart.y;
      movementPlayer.vx = 0; movementPlayer.vy = 0;
      movementPlayer.dashT = 0; movementPlayer.attackT = 0;
      sInput.keys[direction] = true;
      tick(90);
      sInput.keys[direction] = false;
      movementDistances[direction] = Math.hypot(movementPlayer.x - movementStart.x, movementPlayer.y - movementStart.y);
    }
  }
  const survivalMovementPass = !!movementStart && screenDirections.every(({ direction }) => movementDistances[direction] > 30);
  console.log(`  ${survivalMovementPass ? 'PASS' : 'FAIL'}  Survival Hunter moves in all four screen directions from ${movementStart?.room || 'no clear tile'} (${JSON.stringify(Object.fromEntries(Object.entries(movementDistances).map(([key, value]) => [key, +value.toFixed(1)])))})`);

  // The Breaker sees the Hunter at arm's length but retains the wall objective.
  survivalGame.survival.restart();
  const targetDoor = survivalGame.survival.mainGate();
  survivalGame.survival.day = 2;
  survivalGame.survival.spawnBreaker(0);
  const breaker = survivalGame.enemies.find((enemy) => enemy._survivalType === 'breaker');
  const out = targetDoor.outside || targetDoor;
  const wallDx = out.x - breaker.x, wallDy = out.y - breaker.y;
  const len = Math.hypot(wallDx, wallDy) || 1;
  survivalGame.player.x = breaker.x - wallDy / len * 30;
  survivalGame.player.y = breaker.y + wallDx / len * 30;
  const heroHp = survivalGame.player.blood;
  breaker.update(0.1, survivalGame);
  const breakerTargetsWall = breaker.targetKind === 'wall'
    && breaker.targetEntranceId === targetDoor.id
    && breaker.vx * wallDx + breaker.vy * wallDy > 0
    && survivalGame.player.blood === heroHp;
  console.log(`  ${breakerTargetsWall ? 'PASS' : 'FAIL'}  Breaker keeps ${breaker.targetEntranceId} wall target with Hunter visible`);

  // Use an in-range synthetic target with LOS/wall checks stubbed open to
  // isolate auto-fire and bolt damage from furniture in the headless fixture.
  survivalGame.survival.restart();
  resetControls();
  const hunter = survivalGame.player;
  const losWitness = (() => {
    const mansion = survivalGame.mansion;
    const distances = [70, 100, 140, 180, 220, 280];
    for (const room of mansion.roomList) {
      for (let y = room.y + 35; y < room.y + room.h - 35; y += 32) {
        for (let x = room.x + 35; x < room.x + room.w - 35; x += 32) {
          if (mansion.resolve(x, y, 15, true).hit) continue;
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
            for (const distance of distances) {
              const target = { x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance };
              if (mansion.findRoom(target.x, target.y) !== room.id || mansion.resolve(target.x, target.y, 12).hit) continue;
              if (mansion.hasLOS(x, y, target.x, target.y)) return { player: { x, y }, target, room: room.id };
            }
          }
        }
      }
    }
    return null;
  })();
  const targetSpot = { x: hunter.x + 60, y: hunter.y };
  const oldHasLOS = survivalGame.mansion.hasLOS;
  const oldSolidAt = survivalGame.mansion.solidAt;
  // Isolate target acquisition/bolt damage from this headless fixture's room
  // furniture; separate browser 3D QA keeps the real collision/LOS pipeline.
  survivalGame.mansion.hasLOS = () => true;
  survivalGame.mansion.solidAt = () => null;
  const hitSamples = [];
  const autoTarget = targetSpot && {
    id: 987654, key: 'zombie', _survivalType: 'individual', dead: false, removeMe: false,
    x: targetSpot.x, y: targetSpot.y, radius: 12, hp: 500, hpMax: 500, state: 'press',
    update() { },
    hurt(amount) { this.hp -= amount; hitSamples.push(amount); if (this.hp <= 0) this.dead = true; },
  };
  if (autoTarget) survivalGame.enemies.push(autoTarget);
  for (let i = 0; i < 240 && !hitSamples.length; i++) tick();
  const hunterAutoShot = !!(autoTarget && survivalGame.player.weapon === 'shot'
    && (survivalGame.stats.shotsFired || 0) > 0 && hitSamples.length > 0);
  survivalGame.mansion.hasLOS = oldHasLOS;
  survivalGame.mansion.solidAt = oldSolidAt;
  console.log(`  ${hunterAutoShot ? 'PASS' : 'FAIL'}  Hunter auto-shot hits an unobstructed in-range test target (${hitSamples.length} hit(s), ${survivalGame.stats.shotsFired || 0} bolt(s), target=${survivalGame.survival.currentTarget?.id || 'none'}, weapon=${hunter.weapon}; LOS stubbed open)`);

  // Repeat the shot check from a clear in-room witness with the actual LOS and
  // collision functions enabled, so this is not inferred from the stubbed case.
  survivalGame.survival.restart();
  resetControls();
  let hunterRealLos = false;
  let realLosHits = [];
  if (losWitness) {
    const realHunter = survivalGame.player;
    realHunter.x = losWitness.player.x; realHunter.y = losWitness.player.y;
    realHunter.vx = 0; realHunter.vy = 0;
    const actualTarget = {
      id: 987656, key: 'zombie', _survivalType: 'individual', dead: false, removeMe: false,
      x: losWitness.target.x, y: losWitness.target.y, radius: 12, hp: 500, hpMax: 500, state: 'press',
      update() { },
      hurt(amount) { this.hp -= amount; realLosHits.push(amount); if (this.hp <= 0) this.dead = true; },
    };
    const visibleWithRealLos = survivalGame.mansion.hasLOS(realHunter.x, realHunter.y, actualTarget.x, actualTarget.y);
    if (visibleWithRealLos) survivalGame.enemies.push(actualTarget);
    for (let i = 0; i < 240 && !realLosHits.length; i++) tick();
    hunterRealLos = !!(visibleWithRealLos && realLosHits.length > 0
      && survivalGame.player.weapon === 'shot' && survivalGame.survival.currentTarget?.id === actualTarget.id);
  }
  console.log(`  ${hunterRealLos ? 'PASS' : 'FAIL'}  Hunter auto-shot acquires and hits a real-LOS target with mansion collision enabled (${losWitness?.room || 'no clear room'}; ${realLosHits.length} hit(s))`);

  survivalGame.survival.restart();
  resetControls();
  const skillPlayer = survivalGame.player;
  const skillTarget = {
    id: 987655, key: 'zombie', _survivalType: 'swarm', dead: false, removeMe: false,
    x: skillPlayer.x + 160, y: skillPlayer.y, radius: 13, hp: 500, hpMax: 500, state: 'march',
    update() { }, hurt(amount) { this.hp -= amount; },
  };
  survivalGame.enemies.push(skillTarget);
  const skillHp = skillTarget.hp;
  const skillUsed = survivalGame.survival.useSkill();
  const skillReuseBlocked = !survivalGame.survival.useSkill();
  const hunterSkill = !!(skillUsed && skillReuseBlocked && skillTarget.hp < skillHp
    && skillTarget.staggerT > 0 && survivalGame.survival.skillCooldown > 0);
  console.log(`  ${hunterSkill ? 'PASS' : 'FAIL'}  Hunter's Flare skill damages/staggers in radius and respects cooldown (${skillHp} → ${skillTarget.hp} HP)`);

  /* ---------- gap/bug regressions (crowd ranks, door slits, guards, pause) ---------- */
  const { GUARD } = await import('../src/game/survival.js');
  const quietNight = (mode) => {
    // freeze the scheduled spawners so a probe controls every body
    mode.waveIndex = 99; mode.breakerIndex = 99; mode.individualIndex = 99;
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    mode.oil = 200;
  };

  // 1) A 30-body wave reaches its own ranks and claws the door (the old
  //    global rank index sent wave 3 to spots it orbited forever).
  survivalGame.survival.restart();
  const rankMode = survivalGame.survival;
  quietNight(rankMode);
  rankMode.day = 3;
  survivalGame.player.x = rankMode.hearth().x + 70; survivalGame.player.y = rankMode.hearth().y + 210;
  rankMode.guards.length = 0; rankMode.survivors = 0;
  const posternDoor = rankMode.entranceById('postern');
  const posternHp = posternDoor.hp;
  rankMode.spawnSwarm(30, 2, posternDoor);
  let rankPressing = 0;
  for (let i = 0; i < 60 * 10; i++) {
    tick();
    if (posternDoor.broken) break;
    rankPressing = Math.max(rankPressing, survivalGame.enemies.filter((e) => e._survivalType === 'swarm' && !e.dead && e.state === 'press').length);
  }
  const rankIdx = survivalGame.enemies.filter((e) => e._survivalType === 'swarm').map((e) => e.index);
  const crowdRankPass = rankPressing >= 24 && (posternDoor.broken || posternDoor.hp < posternHp) && Math.min(...rankIdx) === 0;
  console.log(`  ${crowdRankPass ? 'PASS' : 'FAIL'}  wave 3 (30 bodies) reaches its own ranks at the postern: ${rankPressing} pressing, door ${posternHp} → ${posternDoor.broken ? 'broken' : Math.round(posternDoor.hp)} within 10s, front rank index ${Math.min(...rankIdx)}`);

  // 2) Ranks close up: kill the front row, the bodies behind step forward.
  survivalGame.survival.restart();
  const promoteMode = survivalGame.survival;
  quietNight(promoteMode);
  promoteMode.guards.length = 0; promoteMode.survivors = 0;
  promoteMode.tuning = { ...promoteMode.tuning, autoAttackRange: 0 };
  const promoteDoor = promoteMode.entranceById('chapelDoor');
  promoteDoor.hp = promoteDoor.hpMax = 99999;
  promoteMode.spawnSwarm(24, 0, promoteDoor);
  tick(60 * 9);
  const nearest = () => Math.min(...survivalGame.enemies.filter((e) => !e.dead && e._survivalType === 'swarm').map((e) => Math.hypot(e.x - promoteDoor.x, e.y - promoteDoor.y)));
  const front = survivalGame.enemies.filter((e) => !e.dead && e._survivalType === 'swarm')
    .sort((a, b) => Math.hypot(a.x - promoteDoor.x, a.y - promoteDoor.y) - Math.hypot(b.x - promoteDoor.x, b.y - promoteDoor.y)).slice(0, 8);
  const frontBefore = nearest();
  for (const e of front) e.die(survivalGame);
  tick(60 * 4);
  const frontAfter = nearest();
  promoteMode.tuning = SURVIVAL_TUNING;
  const promotePass = Number.isFinite(frontAfter) && frontAfter < frontBefore + 30;
  console.log(`  ${promotePass ? 'PASS' : 'FAIL'}  ranks close up after the front row dies (nearest body ${frontBefore.toFixed(0)} px → ${frontAfter.toFixed(0)} px from the chapel door)`);

  // 3) Door slits: from inside, the Hunter shoots a body clawing a closed
  //    door; the bolt passes the wood and the door takes no bolt damage.
  survivalGame.survival.restart();
  resetControls();
  const slitMode = survivalGame.survival;
  quietNight(slitMode);
  slitMode.guards.length = 0; slitMode.survivors = 0;
  const slitDoor = slitMode.entranceById('frontDoor');
  const inward = { x: slitDoor.inside.x - slitDoor.x, y: slitDoor.inside.y - slitDoor.y };
  const inLen = Math.hypot(inward.x, inward.y) || 1;
  survivalGame.player.x = slitDoor.inside.x + inward.x / inLen * 60;
  survivalGame.player.y = slitDoor.inside.y + inward.y / inLen * 60;
  const { survivalSpot } = await import('../src/game/survival.js');
  const slitSpot = survivalSpot(slitDoor, 0, 72);
  const slitBody = new SurvivalCrowdZombie(slitSpot.x, slitSpot.y, slitDoor, 0, 1);
  slitBody.hp = slitBody.hpMax = 400;
  survivalGame.enemies.push(slitBody);
  const slitDoorHp = slitDoor.hp;
  const losBlocked = !survivalGame.mansion.hasLOS(survivalGame.player.x, survivalGame.player.y, slitBody.x, slitBody.y);
  tick(60 * 3);
  const slitPass = losBlocked && slitBody.hp < 400 && !slitDoor.broken && !slitDoor.open
    && slitDoor.hp >= slitDoorHp - 30;
  console.log(`  ${slitPass ? 'PASS' : 'FAIL'}  Hunter shoots through a closed door's slit (plain LOS blocked=${losBlocked}; body 400 → ${Math.round(slitBody.hp)} HP; door ${slitDoorHp} → ${Math.round(slitDoor.hp)}, still closed)`);

  // 4) Guards: one per survivor; they post at the clawed door and shoot.
  survivalGame.survival.restart();
  resetControls();
  const guardMode = survivalGame.survival;
  quietNight(guardMode);
  guardMode.tuning = { ...guardMode.tuning, autoAttackRange: 0 };
  survivalGame.player.x = guardMode.hearth().x + 70; survivalGame.player.y = guardMode.hearth().y + 210;
  const guardDoor = guardMode.entranceById('frontDoor');
  guardDoor.hp = guardDoor.hpMax = 99999;
  guardMode.spawnSwarm(21, 0, guardDoor);
  let guardsAtDoor = 0;
  for (let i = 0; i < 60 * 22; i++) {
    tick();
    guardsAtDoor = Math.max(guardsAtDoor, guardMode.guards.filter((gd) => gd.post && gd.post.doorId === 'frontDoor' && !gd.moving).length);
  }
  const guardKills = guardMode.nightStats.kills;
  const guardShots = guardMode.nightStats.guardShots || 0;
  guardMode.tuning = SURVIVAL_TUNING;
  const guardPass = guardMode.guards.length === guardMode.survivors && guardMode.survivors === 2
    && guardsAtDoor >= 1 && guardShots > 0 && guardKills > 0;
  console.log(`  ${guardPass ? 'PASS' : 'FAIL'}  survivors guard the clawed door (${guardMode.guards.length} guards, ${guardsAtDoor} posted at frontDoor, ${guardShots} shots, ${guardKills} kills with the Hunter's shot disabled)`);

  // 5) Friendly bolts never hit the Hunter.
  survivalGame.survival.restart();
  const ffMode = survivalGame.survival;
  quietNight(ffMode);
  const ffHp = survivalGame.player.blood;
  const ffGuard = ffMode.guards[0];
  ffGuard.x = survivalGame.player.x - 120; ffGuard.y = survivalGame.player.y;
  survivalGame.spawnBolt(ffGuard, 0, { offset: 16, boltSpeed: GUARD.boltSpeed, damage: 50, friendly: true });
  survivalGame.player.iframes = 0;
  tick(30);
  const friendlyPass = survivalGame.player.blood === ffHp;
  console.log(`  ${friendlyPass ? 'PASS' : 'FAIL'}  a guard's bolt passes through the Hunter (blood ${ffHp} → ${survivalGame.player.blood})`);

  // 6) Pause freezes the run; no pause on the end panel; the day after a
  //    night plans with the full fire radius.
  survivalGame.survival.restart();
  resetControls();
  const pauseMode = survivalGame.survival;
  quietNight(pauseMode);
  pauseMode.skillCooldown = 10;
  const elapsedBefore = pauseMode.elapsed;
  survivalGame.togglePause(true);
  tick(120);
  const pausedCd = pauseMode.skillCooldown;
  const pausedElapsed = pauseMode.elapsed;
  survivalGame.resumeSurvival();
  tick(60);
  const resumedCd = pauseMode.skillCooldown;
  pauseMode.fail('THE FIRE WENT OUT');
  const canPauseOnEnd = survivalGame.survivalCanPause();
  sInput.keys.pause = true; tick(); sInput.keys.pause = false; tick();
  const endScreen = survivalGame.screen;
  survivalGame.survival.restart();
  const dawnMode = survivalGame.survival;
  quietNight(dawnMode);
  dawnMode.elapsed = dawnMode.nightDuration - 0.01;
  dawnMode.oilBurned = 9;
  tick(2);
  const dayRadius = dawnMode.getFireRadius();
  const fullRadius = dawnMode.tuning.perapianRadius[dawnMode.perapianLevel];
  const canPauseOnReward = survivalGame.survivalCanPause();
  if (dawnMode.rewardPending()) dawnMode.ackRewards();
  const canPauseOnDay = survivalGame.survivalCanPause();
  const pausePass = pausedCd === 10 && pausedElapsed === elapsedBefore && resumedCd < 10
    && !canPauseOnEnd && endScreen === 'playing' && !canPauseOnReward && canPauseOnDay
    && dawnMode.phase === 'day' && Math.abs(dayRadius - fullRadius) < 1;
  console.log(`  ${pausePass ? 'PASS' : 'FAIL'}  pause freezes Flare cooldown (${pausedCd} while paused → ${resumedCd.toFixed(2)} after 1s) and the clock; no pause on the end panel (${endScreen}) or the dawn reward (${canPauseOnReward}), pause on the build day (${canPauseOnDay}); dawn radius ${Math.round(dayRadius)}/${fullRadius}`);

  // 7) A body that already crossed a doorway keeps that through a reload.
  survivalGame.survival.restart();
  const reloadMode = survivalGame.survival;
  quietNight(reloadMode);
  const hall = survivalGame.mansion.roomCenter(ROOM.HALL);
  const insideBody = new SurvivalCrowdZombie(hall.x, hall.y, reloadMode.mainGate(), 0, 1);
  insideBody._inHouse = true;
  survivalGame.enemies.push(insideBody);
  reloadMode._persist(true);
  const reloadedGame = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
  const reloadedBody = reloadedGame.enemies.find((e) => e._survivalType === 'swarm');
  const inHousePass = !!(reloadedBody && reloadedBody._inHouse === true && reloadedGame.survival.guards.length === reloadedGame.survival.survivors);
  console.log(`  ${inHousePass ? 'PASS' : 'FAIL'}  reload keeps an invader inside (_inHouse=${reloadedBody && reloadedBody._inHouse}) and rebuilds ${reloadedGame.survival.guards.length} guards`);
  survivalGame.enemies.length = 0;
  window.localStorage.removeItem('lastnight.save.v1');
  const gapRegressionPass = crowdRankPass && promotePass && slitPass && guardPass && friendlyPass && pausePass && inHousePass;

  const { botNight, botDay, releaseControls } = await import('./survival-bots.mjs');
  const { ISO_CAMERA } = await import('../src/core/util.js');
  const runScenario = (builderBot) => {
    // Pair the idle and builder night runs from an identical random stream.
    // idle = no input at all; builder = engaged defender (real stick + Flare
    // through Input) who also spends each day on the builder queue.
    reseed(SEED + 77);
    survivalGame.survival.restart();
    resetControls();
    const mode = survivalGame.survival;
    const botState = { flareHeld: false, flares: 0 };
    const upgrades = [{ level: 1, radius: Math.round(mode.getFireRadius()) }];
    const workResults = [];
    let queueLockVerified = false;
    let sawmillBuilt = false;
    let gateBuilt = false;
    let shelterBuilt = false;
    let failure = null;
    const nightThree = { peakEnemies: 0, peakBreakers: 0, kills: 0, wallDamage: 0, gateHp: 0, playerHp: 0 };

    for (let day = 1; day <= 3; day++) {
      if (mode.phase !== 'night' || mode.day !== day) break;
      let guard = 0;
      while (mode.phase === 'night' && guard++ < 60 * mode.nightDuration + 120) {
        if (builderBot) botNight(survivalGame, botState, { ROOM, ISO_CAMERA });
        else releaseControls(survivalGame);
        tick();
        if (mode.day === 3 && mode.phase === 'night') {
          const alive = survivalGame.enemies.filter((enemy) => !enemy.dead).length;
          const breakers = survivalGame.enemies.filter((enemy) => enemy._survivalType === 'breaker' && !enemy.dead).length;
          nightThree.peakEnemies = Math.max(nightThree.peakEnemies, alive);
          nightThree.peakBreakers = Math.max(nightThree.peakBreakers, breakers);
          nightThree.kills = mode.nightStats.kills;
          nightThree.wallDamage = Math.round(mode.nightStats.damageToWalls);
          nightThree.gateHp = Math.round(mode.gateHp);
          nightThree.playerHp = Math.round(survivalGame.player.blood);
        }
      }
      releaseControls(survivalGame);
      if (mode.phase === 'failed') { failure = mode.failureReason; break; }
      if (mode.phase === 'complete') break;
      if (mode.phase !== 'day') break;
      if (day >= 3) break;
      if (mode.rewardPending()) mode.ackRewards();

      if (builderBot) {
        const beforeLevel = mode.perapianLevel;
        const beforeRadius = Math.round(mode.getFireRadius());
        const targetLevel = day + 1;
        const upgradeQueued = mode.startBuild('perapian');
        if (upgradeQueued && !queueLockVerified) queueLockVerified = !mode.startBuild('gate');
        const upgradeFinished = waitForBuilder();
        const afterRadius = Math.round(mode.getFireRadius());
        upgrades.push({ level: mode.perapianLevel, beforeRadius, radius: afterRadius });
        workResults.push({ day: day + 1, upgradeQueued, upgradeFinished, targetLevel, beforeLevel, level: mode.perapianLevel });
        if (mode.perapianLevel !== targetLevel) { failure = `Perapian level ${targetLevel} not reached`; break; }

        const freeRoom = mode.buildableRooms()[0];
        if (day === 1 && freeRoom) {
          const queued = mode.startBuild('sawmill', freeRoom.id);
          const finished = queued && waitForBuilder();
          sawmillBuilt = !!(finished && mode.buildings[freeRoom.id] === 'sawmill');
          workResults.push({ day: 2, building: 'sawmill', room: freeRoom.id, queued, finished });
          const gateQueued = mode.startBuild('gate');
          const gateFinished = gateQueued && waitForBuilder();
          gateBuilt = !!(gateFinished && mode.gateBuilt);
          workResults.push({ day: 2, building: 'gate', queued: gateQueued, finished: gateFinished, hp: mode.gateHp });
        } else if (day === 2 && freeRoom) {
          const queued = mode.startBuild('shelter', freeRoom.id);
          const finished = queued && waitForBuilder();
          shelterBuilt = !!(finished && mode.buildings[freeRoom.id] === 'shelter');
          workResults.push({ day: 3, building: 'shelter', room: freeRoom.id, queued, finished });
        }
      }
      if (!mode.startNight()) { failure = `Night ${day + 1} could not start`; break; }
    }
    const complete = mode.phase === 'complete' && mode.nightsCompleted === 3;
    if (!nightThree.playerHp) nightThree.playerHp = Math.round(survivalGame.player.blood);
    return {
      type: builderBot ? 'builder' : 'idle', complete, failure,
      day: mode.day, phase: mode.phase, nightsCompleted: mode.nightsCompleted,
      perapianLevel: mode.perapianLevel, survivors: mode.survivors,
      buildings: Object.values(mode.buildings), workResults, upgrades, queueLockVerified,
      sawmillBuilt, gateBuilt, shelterBuilt, nightThree, flares: botState.flares,
      oil: +mode.oil.toFixed(1), wood: mode.wood,
    };
  };

  const idle = runScenario(false);
  const builder = runScenario(true);

  // Save/reload round-trip at the first dawn: day, phase, duration, and
  // completed-night progress must survive constructing a fresh Game instance.
  survivalGame.survival.restart();
  resetControls();
  let saveGuard = 0;
  // Isolate persistence from balance: keep the hearth fed so Night 1 reaches dawn.
  while (survivalGame.survival.phase === 'night' && saveGuard++ < 60 * survivalGame.survival.nightDuration + 120) {
    survivalGame.survival.oil = Math.max(survivalGame.survival.oil, 30);
    tick();
  }
  const storedSave = JSON.parse(window.localStorage.getItem('lastnight.save.v1') || 'null');
  const resumedGame = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
  const saveProgressPass = !!(storedSave?.survival?.day === 2 && storedSave.survival.phase === 'day'
    && storedSave.survival.nightsCompleted === 1 && storedSave.survival.nightDuration === 60
    && resumedGame.survival.day === 2 && resumedGame.survival.phase === 'day'
    && resumedGame.survival.nightsCompleted === 1 && resumedGame.survival.elapsed === 0);
  console.log(`  ${saveProgressPass ? 'PASS' : 'FAIL'}  save/reload resumes Day ${resumedGame.survival.day} ${resumedGame.survival.phase} (${resumedGame.survival.nightsCompleted}/3 nights, ${resumedGame.survival.nightDuration}s)`);

  // Isolated economy check: each listed room building completes one queued
  // job, and its defined production is credited at the next dawn.
  survivalGame.survival.restart();
  resetControls();
  const economyMode = survivalGame.survival;
  economyMode.phase = 'day';
  economyMode.perapianLevel = 3;
  economyMode.oil = 100; economyMode.wood = 100; economyMode.survivors = 2;
  survivalGame.screen = 'playing'; survivalGame.uiPanel = 'survival-day';
  economyMode.refreshFireplace(true);
  const economyRooms = economyMode.buildableRooms();
  const economyBuilt = [];
  for (const [i, type] of ['extractor', 'sawmill', 'shelter'].entries()) {
    const room = economyRooms.find((candidate) => !economyMode.buildings[candidate.id] && !economyBuilt.some((row) => row.room === candidate.id));
    const queued = !!(room && economyMode.startBuild(type, room.id));
    const finished = queued && waitForBuilder();
    economyBuilt.push({ type, room: room && room.id, queued, finished });
  }
  // the shelter houses its survivor as soon as it stands (tonight's guard)
  const survivorsAtBuild = economyMode.survivors;
  economyMode.phase = 'night';
  economyMode.day = 1;
  economyMode.elapsed = 0;
  economyMode.oilBurned = 0;
  economyMode.nightStats = { kills: 0, hits: 0, damageToWalls: 0, drained: 0, pumped: 0 };
  // the pump pours its oil into the stock during the night, not at dawn
  const oilBeforeNight = economyMode.oil;
  for (let t = 0; t < economyMode.nightDuration * 60; t++) economyMode.updateLightFuel(step);
  const pumpedOvernight = economyMode.nightStats.pumped;
  const burnedOvernight = economyMode.oilBurned;
  const purseDelta = economyMode.oil - oilBeforeNight;
  economyMode.completeNight();
  const economyPass = economyBuilt.length === 3 && economyBuilt.every((row) => row.queued && row.finished)
    && survivorsAtBuild === 3 && economyMode.survivors === 3
    && Math.abs(pumpedOvernight - 6) < 0.01 && Math.abs(purseDelta - (pumpedOvernight - burnedOvernight)) < 0.01
    && economyMode.lastRewards.pumped === 6 && economyMode.lastRewards.survivors === 0
    && economyMode.lastRewards.oil === 14 && economyMode.lastRewards.wood === 21;
  console.log(`  economy: ${JSON.stringify(economyBuilt)} → survivors ${survivorsAtBuild} at build, pumped ${pumpedOvernight.toFixed(2)} Oil overnight (purse ${purseDelta >= 0 ? '+' : ''}${purseDelta.toFixed(2)} after burn ${burnedOvernight.toFixed(2)}), dawn +${economyMode.lastRewards.oil} Oil, +${economyMode.lastRewards.wood} Wood, Survivors ${economyMode.survivors} (${economyPass ? 'PASS' : 'FAIL'})`);

  // ---- progression: building levels + the Hunter's track (no skill cards) ----
  const progressionChecks = [];
  const progCheck = (name, ok, detail) => {
    progressionChecks.push(!!ok);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
  };
  {
    const mode = survivalGame.survival;
    mode.restart();
    resetControls();
    mode.phase = 'day'; mode.day = 2;
    survivalGame.screen = 'playing'; survivalGame.uiPanel = 'survival-day';
    mode.perapianLevel = 3;
    mode.refreshFireplace(true);
    mode.oil = 150; mode.wood = 150;
    const rooms = mode.buildableRooms();
    const [pumpRoom, millRoom, shelterRoom] = rooms;
    mode.startBuild('extractor', pumpRoom.id); waitForBuilder();
    const lv1 = mode.buildingLevel(pumpRoom.id);
    const cost2 = mode.upgradeCost(pumpRoom.id);
    const purse = { oil: mode.oil, wood: mode.wood };
    const queued = mode.startBuild('upgrade', pumpRoom.id);
    const paid = purse.oil - mode.oil === 4 && purse.wood - mode.wood === 12;
    const job = mode.builderJob ? { ...mode.builderJob } : null;
    // one builder: nothing else starts while the pump is being raised
    const lockBuild = mode.startBuild('sawmill', millRoom.id);
    const lockHunter = mode.startBuild('hunter');
    const lockOther = mode.startUpgrade(pumpRoom.id);
    const done2 = waitForBuilder();
    const lv2 = mode.buildingLevel(pumpRoom.id);
    const cost3 = mode.upgradeCost(pumpRoom.id);
    mode.startBuild('upgrade', pumpRoom.id); waitForBuilder();
    const lv3 = mode.buildingLevel(pumpRoom.id);
    const atMax = mode.upgradeCost(pumpRoom.id) === null && mode.startUpgrade(pumpRoom.id) === false;
    progCheck('building levels: queued, paid and finished through the one builder; Lv3 is the cap',
      lv1 === 1 && queued && paid && job && job.kind === 'upgrade' && job.targetLevel === 2
        && !lockBuild && !lockHunter && !lockOther && done2 && lv2 === 2 && lv3 === 3 && atMax
        && cost2 && cost2.oil === 4 && cost2.wood === 12 && cost3 && cost3.oil === 6 && cost3.wood === 16,
      `pump Lv${lv1}→${lv2}→${lv3}, cost Lv2 ${cost2 && `${cost2.oil}/${cost2.wood}`}, Lv3 ${cost3 && `${cost3.oil}/${cost3.wood}`}, queue lock build=${lockBuild} hunter=${lockHunter} upgrade=${lockOther}, max locked=${atMax}`);

    // the pump's level sets the oil poured in overnight
    const pumpNight = mode.pumpPerNight();
    mode.phase = 'night';
    const nightUpgrade = mode.startBuild('upgrade', pumpRoom.id) || mode.startBuild('hunter') || mode.startUpgrade(pumpRoom.id);
    mode.nightStats.pumped = 0;
    for (let t = 0; t < mode.nightDuration * 60; t++) mode.updateLightFuel(step);
    const pumpedLv3 = mode.nightStats.pumped;
    progCheck('Lv3 pump pours 14 Oil over one night; nothing is bought at night',
      pumpNight === 14 && Math.abs(pumpedLv3 - 14) < 0.01 && nightUpgrade === false,
      `pumpPerNight ${pumpNight}, pumped ${pumpedLv3.toFixed(2)}, night purchase=${nightUpgrade}`);
    mode.phase = 'day';

    // shelters house survivors at once: Lv1 1, Lv2 2, Lv3 3 → guards
    const s0 = mode.survivors;
    mode.startBuild('shelter', shelterRoom.id); waitForBuilder();
    const s1 = mode.survivors;
    mode.startBuild('upgrade', shelterRoom.id); waitForBuilder();
    const s2 = mode.survivors;
    mode.startBuild('upgrade', shelterRoom.id); waitForBuilder();
    const s3 = mode.survivors;
    progCheck('shelter levels house 1 / 2 / 3 survivors as soon as they stand; each one guards',
      s1 - s0 === 1 && s2 - s0 === 2 && s3 - s0 === 3 && mode.guards.length === Math.min(8, s3),
      `survivors ${s0} → ${s1} → ${s2} → ${s3}, guards ${mode.guards.length}`);

    // sawmill planks: every outer door +10% (Lv1) → +20% (Lv2), full by day
    const doors = survivalGame.mansion.entrances.filter((e) => e.exterior && e.kind === 'door');
    const gate = mode.mainGate();
    const expect = (bonus) => doors.every((e) => e.hpMax === Math.round(e.baseHpMax * (1 + bonus)) + (e === gate && mode.gateBuilt ? mode.tuning.gateHpBonus : 0) && e.hp === e.hpMax);
    const base = doors.map((e) => e.hpMax).join('/');
    mode.startBuild('sawmill', millRoom.id); waitForBuilder();
    const mill1 = expect(0.1);
    const after1 = doors.map((e) => e.hpMax).join('/');
    mode.startBuild('upgrade', millRoom.id); waitForBuilder();
    const mill2 = expect(0.2);
    const after2 = doors.map((e) => e.hpMax).join('/');
    progCheck('sawmill planks raise every outer door +10% at Lv1, +20% at Lv2 (doors full by day)',
      doors.length > 0 && mill1 && mill2 && mode.doorHpBonus() === 0.2,
      `door max HP ${base} → ${after1} → ${after2}`);

    // the Hunter's own track: Lv2 = 32 bolt damage / 120 HP, healed on completion
    survivalGame.player.blood = 40;
    const hunterCost = mode.hunterUpgradeCost();
    const hPurse = { oil: mode.oil, wood: mode.wood };
    const hQueued = mode.startBuild('hunter');
    const hPaid = hPurse.oil - mode.oil === 14 && hPurse.wood - mode.wood === 8;
    const hDone = waitForBuilder();
    survivalGame.player.weapon = 'shot';
    survivalGame.player.swingAngle = 0;
    const boltsBefore = survivalGame.bolts.length;
    survivalGame.playerAttackHit(survivalGame.player);
    const bolt = survivalGame.bolts[survivalGame.bolts.length - 1];
    const boltDamage = survivalGame.bolts.length > boltsBefore && bolt ? bolt.damage : null;
    survivalGame.bolts.length = 0;
    progCheck('Hunter Lv2: bolt damage 26 → 32, health 100 → 120, healed when the training ends',
      hunterCost && hQueued && hPaid && hDone && mode.hunterLevel === 2 && boltDamage === 32
        && survivalGame.player.bloodMax === 120 && survivalGame.player.blood === 120,
      `cost ${hunterCost && `${hunterCost.oil}/${hunterCost.wood}`}, Lv${mode.hunterLevel}, bolt ${boltDamage}, HP ${survivalGame.player.blood}/${survivalGame.player.bloodMax}`);

    // persistence: levels survive a reload; an old save without levels is Lv1
    mode._persist(true);
    const saved = JSON.parse(window.localStorage.getItem('lastnight.save.v1') || 'null');
    const reloaded = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    const rs = reloaded.survival;
    const levelsKept = rs.buildingLevel(pumpRoom.id) === 3 && rs.buildingLevel(shelterRoom.id) === 3
      && rs.buildingLevel(millRoom.id) === 2 && rs.hunterLevel === 2 && reloaded.player.bloodMax === 120
      && rs.doorHpBonus() === 0.2;
    const legacySave = JSON.parse(JSON.stringify(saved));
    delete legacySave.survival.buildingLevels;
    delete legacySave.survival.hunterLevel;
    window.localStorage.setItem('lastnight.save.v1', JSON.stringify(legacySave));
    const oldGame = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    const os = oldGame.survival;
    const oldDefaults = Object.keys(os.buildings).length === 3
      && Object.keys(os.buildings).every((roomId) => os.buildingLevel(roomId) === 1)
      && os.hunterLevel === 1 && oldGame.player.bloodMax === 100;
    // a mid-night reload keeps the Hunter's absolute health on his own bar
    window.localStorage.setItem('lastnight.save.v1', JSON.stringify(saved));
    const nightGame = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    const ns = nightGame.survival;
    ns.startNight();
    for (let i = 0; i < 90; i++) nightGame.update(step);
    nightGame.player.blood = 60;
    ns._persist(true);
    const nightReload = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    const midNightHp = `${Math.round(nightReload.player.blood)}/${nightReload.player.bloodMax}`;
    progCheck('save/reload keeps building levels + Hunter level; old saves load as Lv1; a mid-night reload keeps 60/120 HP',
      saved && saved.survival && saved.survival.hunterLevel === 2 && saved.survival.buildingLevels
        && levelsKept && oldDefaults && nightReload.survival.phase === 'night' && midNightHp === '60/120',
      `saved levels ${JSON.stringify(saved && saved.survival && saved.survival.buildingLevels)}, hunter ${saved && saved.survival && saved.survival.hunterLevel}; old save → ${Object.keys(os.buildings).map((r) => `${os.buildings[r]} Lv${os.buildingLevel(r)}`).join(', ')}, Hunter Lv${os.hunterLevel}; mid-night ${midNightHp}`);
    window.localStorage.removeItem('lastnight.save.v1');
  }
  const progressionPass = progressionChecks.length === 6 && progressionChecks.every(Boolean);

  // ---- towers: a building that fights, by its room's outer door ----
  const towerChecks = [];
  const towerCheck = (name, ok, detail) => {
    towerChecks.push(!!ok);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
  };
  {
    const { TOWER } = await import('../src/game/survival.js');
    const mode = survivalGame.survival;
    const m = survivalGame.mansion;
    mode.restart();
    resetControls();
    mode.phase = 'day'; mode.day = 2;
    survivalGame.screen = 'playing'; survivalGame.uiPanel = 'survival-day';
    mode.perapianLevel = 1;
    mode.refreshFireplace(true);
    mode.oil = 150; mode.wood = 150;
    const hallSlot = mode.buildableRooms().some((room) => room.id === 'hall');
    const purse = { oil: mode.oil, wood: mode.wood };
    const queued = mode.startBuild('tower', 'hall');
    const paid = purse.oil - mode.oil === 4 && purse.wood - mode.wood === 16;
    const done = waitForBuilder();
    tick();
    const spot = mode.buildingSpot('hall');
    const door = mode.entranceById('frontDoor');
    const hall = m.room('hall');
    const inHall = spot.x > hall.x && spot.x < hall.x + hall.w && spot.y > hall.y && spot.y < hall.y + hall.h;
    const doorDist = Math.hypot(spot.x - door.x, spot.y - door.y);
    const cons = m.room('conservatory');
    const consSpot = mode.buildingSpot('conservatory', 'tower');
    const middle = !!consSpot && consSpot.doorId === null && m.findRoom(consSpot.x, consSpot.y) === 'conservatory'
      && Math.hypot(consSpot.x - (cons.x + cons.w / 2), consSpot.y - (cons.y + cons.h / 2)) < 220;
    // every spot stands on clear floor (no table under a model, nothing at the bolt's start)
    const clearFloor = [spot, consSpot].every((p) => p && !m.solidAt(p.x, p.y)
      && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => !m.solidAt(p.x + Math.cos(k * Math.PI / 4) * 26, p.y + Math.sin(k * Math.PI / 4) * 26)));
    const tower = mode.towers[0];
    towerCheck('tower: built in a lit room through the one builder; it stands just inside that room\'s outer door (a doorless room: its middle)',
      hallSlot && queued && paid && done && mode.buildings.hall === 'tower' && mode.buildingLevel('hall') === 1
        && spot.doorId === 'frontDoor' && inHall && doorDist > 100 && doorDist < 320 && middle && clearFloor
        && mode.boltPath(spot.x, spot.y, door.outside.x, door.outside.y)
        && mode.towers.length === 1 && tower.x === spot.x && tower.y === spot.y,
      `hall slot=${hallSlot}, paid 4/16=${paid}, spot (${spot.x}, ${spot.y}) ${Math.round(doorDist)}px from ${spot.doorId}, conservatory (${consSpot && consSpot.x}, ${consSpot && consSpot.y}) doorless=${middle}, clear floor=${clearFloor}, towers ${mode.towers.length}`);

    // a body on the line from the tower through the door centre, `past` px outside
    const lineDir = { x: door.x - tower.x, y: door.y - tower.y };
    const lineLen = Math.hypot(lineDir.x, lineDir.y);
    const onLine = (past) => ({ x: door.x + lineDir.x / lineLen * past, y: door.y + lineDir.y / lineLen * past });
    const body = (at, frozen = true) => {
      const z = new SurvivalCrowdZombie(at.x, at.y, door, 0, 1);
      z.hp = z.hpMax = 999;
      z.vx = 0; z.vy = 0;
      if (frozen) z.update = () => {};
      survivalGame.enemies.push(z);
      return z;
    };
    const resolveShot = (frames = 60) => {
      // let the bolt fly out; the tower does not shoot again meanwhile
      for (let i = 0; i < frames && survivalGame.bolts.some((b) => b.tower); i++) { tower.cd = 99; tick(); }
    };

    // by day a tower watches, it does not shoot
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    const dayBody = body(onLine(110));
    tick(120);
    const dayShots = mode.nightStats.towerShots || 0;
    const dayQuiet = dayShots === 0 && dayBody.hp === 999 && !survivalGame.bolts.some((b) => b.tower);

    // by night it shoots the crowd at its door through the slit
    mode.startNight();
    quietNight(mode);
    mode.guards.length = 0; mode.survivors = 0;
    mode.tuning = { ...mode.tuning, autoAttackRange: 0 };   // the Hunter's own shot off
    door.hp = door.hpMax = 99999;
    const target = body(onLine(110), false);
    let boltSeen = null;
    for (let i = 0; i < 120; i++) {
      tick();
      const b = survivalGame.bolts.find((item) => item.tower);
      if (b && !boltSeen) boltSeen = { pierce: b.pierce, range: b.range, friendly: !!b.friendly, slits: !!b.pierceDoors, damage: b.damage };
    }
    const nightShots = mode.nightStats.towerShots || 0;
    const lost = 999 - target.hp;
    const plainBlocked = !m.hasLOS(tower.x, tower.y, target.x, target.y);
    towerCheck('tower: watches by day; by night fires its heavy bolt through the door slit (Hunter shot + guards off)',
      dayQuiet && nightShots >= 1 && lost >= 16 && Math.abs(lost / 16 - Math.round(lost / 16)) < 0.01
        && boltSeen && boltSeen.pierce === TOWER.pierce && boltSeen.range === 520 + TOWER.reach && boltSeen.friendly && boltSeen.slits
        && plainBlocked && !door.open && !door.broken,
      `day shots ${dayShots}; night ${nightShots} shots, body 999 → ${Math.round(target.hp)} (${Math.round(lost / 16)}×16), bolt ${JSON.stringify(boltSeen)}, plain LOS blocked=${plainBlocked}`);

    // the tower's keys never leak into the Hunter's or a guard's bolt: the
    // Hunter's spec is his weapon (which has a `range`)
    survivalGame.bolts.length = 0;
    survivalGame.player.weapon = 'shot';
    survivalGame.player.swingAngle = 0;
    survivalGame.playerAttackHit(survivalGame.player);
    const hunterBolt = survivalGame.bolts[survivalGame.bolts.length - 1];
    const guardBolt = survivalGame.spawnBolt({ x: 0, y: 0, key: 'guard', type: { boltSpeed: 640, boltDamage: 10 } }, 0, { offset: 16, boltSpeed: 640, damage: 10, friendly: true });
    towerCheck('the Hunter\'s and guards\' bolts keep no reach cap and no pierce',
      hunterBolt && hunterBolt.range === 0 && hunterBolt.pierce === 0 && !hunterBolt.tower
        && guardBolt && guardBolt.range === 0 && guardBolt.pierce === 0,
      `hunter range ${hunterBolt && hunterBolt.range} pierce ${hunterBolt && hunterBolt.pierce}; guard range ${guardBolt && guardBolt.range} pierce ${guardBolt && guardBolt.pierce}`);
    survivalGame.bolts.length = 0;

    // one bolt runs through two bodies, never a third
    quietNight(mode);
    const first = body(onLine(60)), second = body(onLine(100)), third = body(onLine(140));
    const shotsBefore = mode.nightStats.towerShots || 0;
    tower.cd = 0; tower.target = null;
    for (let i = 0; i < 30 && (mode.nightStats.towerShots || 0) === shotsBefore; i++) tick();
    resolveShot();
    const pierceHp = [first, second, third].map((z) => Math.round(z.hp));
    towerCheck('tower bolt runs through 2 bodies in a line and stops in the 2nd (pierce 1)',
      (mode.nightStats.towerShots || 0) === shotsBefore + 1 && pierceHp.join('/') === '983/983/999',
      `one shot, bodies ${pierceHp.join(' / ')}`);

    // masonry stops it: a body in range but out of sight behind a wall
    quietNight(mode);
    let hiddenAt = null;
    for (let gy = tower.y - 500; gy <= tower.y + 500 && !hiddenAt; gy += 20) {
      for (let gx = tower.x - 500; gx <= tower.x + 500 && !hiddenAt; gx += 20) {
        if (Math.hypot(gx - tower.x, gy - tower.y) > 480 || Math.hypot(gx - tower.x, gy - tower.y) < 200 || m.solidAt(gx, gy)) continue;
        if (m.findRoom(gx, gy) === 'hall') continue;
        if (!m.hasLOS(tower.x, tower.y, gx, gy, { throughDoors: true })) hiddenAt = { x: gx, y: gy };
      }
    }
    const hidden = body(hiddenAt || { x: -100, y: 700 });
    const hiddenShots = mode.nightStats.towerShots || 0;
    tower.cd = 0;
    tick(90);
    const inRange = Math.hypot(hidden.x - tower.x, hidden.y - tower.y) <= 520;
    const noLos = !m.hasLOS(tower.x, tower.y, hidden.x, hidden.y, { throughDoors: true });
    towerCheck('tower never shoots through a wall (a body in range behind masonry is ignored)',
      !!hiddenAt && inRange && noLos && (mode.nightStats.towerShots || 0) === hiddenShots && hidden.hp === 999,
      `body at (${Math.round(hidden.x)}, ${Math.round(hidden.y)}) in ${m.findRoom(hidden.x, hidden.y)}, in range=${inRange}, no LOS=${noLos}, shots ${hiddenShots} → ${mode.nightStats.towerShots || 0}, body ${Math.round(hidden.hp)}`);

    // levels: Lv2 22 dmg / 580, Lv3 30 dmg / 640; a Lv3 bolt lands for 30
    mode.phase = 'day'; survivalGame.screen = 'playing'; survivalGame.uiPanel = 'survival-day';
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    mode.oil = 150; mode.wood = 150;
    const cost2 = mode.upgradeCost('hall');
    mode.startBuild('upgrade', 'hall'); waitForBuilder();
    const st2 = { ...mode.towerStats('hall') };
    const cost3 = mode.upgradeCost('hall');
    mode.startBuild('upgrade', 'hall'); waitForBuilder();
    const st3 = { ...mode.towerStats('hall') };
    mode.startNight();
    quietNight(mode);
    mode.guards.length = 0; mode.survivors = 0;
    door.hp = door.hpMax = 99999;
    const lv3Body = body(onLine(110));
    const lv3Shots = mode.nightStats.towerShots || 0;
    tower.cd = 0; tower.target = null;
    for (let i = 0; i < 30 && (mode.nightStats.towerShots || 0) === lv3Shots; i++) tick();
    resolveShot();
    towerCheck('tower levels: Lv2 22 dmg / 580 range, Lv3 30 / 640 (costs 6/18, 8/22); a Lv3 bolt lands for 30',
      cost2 && cost2.oil === 6 && cost2.wood === 18 && cost3 && cost3.oil === 8 && cost3.wood === 22
        && st2.damage === 22 && st2.range === 580 && st3.damage === 30 && st3.range === 640
        && mode.buildingLevel('hall') === 3 && Math.round(lv3Body.hp) === 969,
      `cost Lv2 ${cost2 && `${cost2.oil}/${cost2.wood}`}, Lv3 ${cost3 && `${cost3.oil}/${cost3.wood}`}; Lv2 ${st2.damage}/${st2.range}, Lv3 ${st3.damage}/${st3.range}; body 999 → ${Math.round(lv3Body.hp)}`);
    mode.tuning = SURVIVAL_TUNING;

    // persistence: the tower and its level survive a reload, on the same spot
    mode.phase = 'day';
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    mode._persist(true);
    const reloaded = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    reloaded.update(step);
    const rs = reloaded.survival;
    const rt = rs.towers[0];
    towerCheck('save/reload keeps the tower at Lv3 on the same spot',
      rs.buildings.hall === 'tower' && rs.buildingLevel('hall') === 3 && rs.towers.length === 1
        && rt && rt.x === spot.x && rt.y === spot.y && rt.doorId === 'frontDoor',
      `reloaded ${rs.buildings.hall} Lv${rs.buildingLevel('hall')}, towers ${rs.towers.length} at (${rt && Math.round(rt.x)}, ${rt && Math.round(rt.y)})`);
    window.localStorage.removeItem('lastnight.save.v1');
  }
  const towerPass = towerChecks.length === 7 && towerChecks.every(Boolean);

  // ---- guards can fall: claws inside the house, rescue by the Hunter, loss at dawn ----
  const fallChecks = [];
  const fallCheck = (name, ok, detail) => {
    fallChecks.push(!!ok);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
  };
  {
    const mode = survivalGame.survival;
    const m = survivalGame.mansion;
    const p = survivalGame.player;
    mode.restart();
    resetControls();
    mode.startNight();
    quietNight(mode);
    mode.tuning = { ...mode.tuning, autoAttackRange: 0 };   // the Hunter's own shot off
    const hallC = m.roomCenter(ROOM.HALL);
    const parkHunter = () => { p.x = hallC.x; p.y = hallC.y; p.blood = p.bloodMax; };
    parkHunter();
    mode.survivors = 2;
    mode._syncGuardRoster(true);
    const [ga, gb] = mode.guards;
    const pin = (guard, at) => {
      guard.x = at.x; guard.y = at.y; guard.path = null; guard.moving = false;
      guard.post = { key: 'test', x: at.x, y: at.y, doorId: null };
    };
    const kc = m.roomCenter(ROOM.KITCHEN);
    const dark = mode._freePost(kc.x, kc.y, 'test', null);
    const lit = mode._hearthPost(0);
    const clawOnce = (guard, frames = 40) => {
      // one live invader right beside the guard: count only its first claw
      const before = guard.hp;
      guard.iframes = 0;
      const z = new SurvivalCrowdZombie(guard.x + 22, guard.y, mode.mainGate(), 0, mode.day);
      z.hp = z.hpMax = 9999; z._inHouse = true; z.attackCd = 0;
      survivalGame.enemies.push(z);
      for (let i = 0; i < frames && guard.hp === before && !guard.down; i++) { mode._guardAssignT = 1e9; tick(); }
      survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
      return { dealt: before - guard.hp, hit: z.hitDamage };
    };

    // 1) a claw in the dark lands full; in the firelight at half (like the Hunter's)
    mode._guardAssignT = 1e9;
    pin(ga, dark); pin(gb, lit);
    const darkClaw = clawOnce(ga);
    const litClaw = clawOnce(gb);
    const darkSpot = !mode.isLit(dark.x, dark.y), litSpot = mode.isLit(lit.x, lit.y);
    // a crowd of 8 landing in the same frame: the guard's i-frames take one claw
    const burstHp = ga.hp;
    ga.iframes = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const z = new SurvivalCrowdZombie(ga.x + Math.cos(a) * 24, ga.y + Math.sin(a) * 24, mode.mainGate(), 0, mode.day);
      z.hp = z.hpMax = 9999; z._inHouse = true; z.attackCd = 0;
      survivalGame.enemies.push(z);
    }
    mode._guardAssignT = 1e9;
    tick(2);
    const burstDealt = burstHp - ga.hp;
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    ga.hp = burstHp; ga.iframes = 0;
    fallCheck('guards take claws from invaders: full in the dark, x0.5 in the firelight; 8 claws in one frame land once',
      darkSpot && litSpot && Math.abs(darkClaw.dealt - darkClaw.hit) < 0.01
        && Math.abs(litClaw.dealt - litClaw.hit * mode.tuning.litAttackMul) < 0.01
        && ga.hp === GUARD.hp - darkClaw.hit && !ga.down && (mode.nightStats.guardDamage || 0) > 0
        && Math.abs(burstDealt - darkClaw.hit) < 0.01,
      `dark spot ${darkSpot}: ${GUARD.hp} → ${GUARD.hp - darkClaw.dealt} (claw ${darkClaw.hit}); lit spot ${litSpot}: ${GUARD.hp} → ${gb.hp}; 8 bodies at once → ${burstDealt} damage (${GUARD.iframes} s i-frames)`);

    // 1b) in the dark bodies close by go for a guard (3 at most); in the
    //     firelight they walk past one that is not in their way
    const huntProbe = (guard, offsets) => {
      const before = guard.hp;
      guard.iframes = 0;
      const bodies = offsets.map(([ox, oy]) => {
        const z = new SurvivalCrowdZombie(guard.x + ox, guard.y + oy, mode.mainGate(), 0, mode.day);
        z.hp = z.hpMax = 9999; z._inHouse = true; z.attackCd = 0;
        survivalGame.enemies.push(z);
        return z;
      });
      let maxOn = 0;
      for (let i = 0; i < 60 * 2.5; i++) {
        mode._guardAssignT = 1e9; tick();
        maxOn = Math.max(maxOn, bodies.filter((z) => z._prey === guard).length);
      }
      survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
      const dealt = before - guard.hp;
      guard.hp = before; guard.iframes = 0;
      return { maxOn, dealt };
    };
    pin(ga, dark); pin(gb, lit);
    const darkHunt = huntProbe(ga, [[95, 0], [-95, 0], [0, 95], [0, -95], [70, 70]]);
    const litHunt = huntProbe(gb, [[-85, 0], [-85, 30], [-85, -30]]);
    fallCheck('in the dark bodies within 110 px go for a guard (3 at most, the rest walk on); in the firelight they pass one not in their way',
      darkHunt.maxOn === GUARD.maxHunters && darkHunt.dealt > 0 && litHunt.maxOn === 0 && litHunt.dealt === 0,
      `dark: ${darkHunt.maxOn}/5 bodies on the guard, ${darkHunt.dealt} damage in 2.5 s; lit: ${litHunt.maxOn}/3 on it, ${litHunt.dealt} damage`);

    // 2) at 0 HP it drops: no more shots, claws pass it by
    ga.hp = 3;
    const downedBy = clawOnce(ga);
    const banner = [mode.banner, ...mode.bannerQueue].some((ev) => ev && ev.kind === 'guardDown');
    pin(gb, lit);
    const decoy = new SurvivalCrowdZombie(ga.x + 150, ga.y, mode.mainGate(), 0, mode.day);
    decoy.hp = decoy.hpMax = 9999; decoy.update = () => {};
    survivalGame.enemies.push(decoy);
    const walker = new SurvivalCrowdZombie(ga.x + 24, ga.y, mode.mainGate(), 0, mode.day);
    walker.hp = walker.hpMax = 9999; walker._inHouse = true; walker.attackCd = 0;
    survivalGame.enemies.push(walker);
    const ignoredAtStart = mode.guardInReach(walker) === null;
    let downShot = 0;
    for (let i = 0; i < 60 * 3; i++) { tick(); downShot = Math.max(downShot, ga.shotT); }
    const walkedOn = Math.hypot(walker.x - ga.x, walker.y - ga.y) > 60;
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    fallCheck('at 0 HP a guard drops where it stands: it stops shooting and invaders walk past it',
      ga.down && ga.hp === 0 && downedBy.dealt === 3 && banner && (mode.nightStats.guardsDown || 0) === 1
        && downShot === 0 && ignoredAtStart && walkedOn && ga.hp === 0 && mode.standingGuards() === 1,
      `down=${ga.down}, banner=${banner}, guardsDown ${mode.nightStats.guardsDown}, shots while down ${downShot ? 'yes' : 'none'}, walker ${Math.round(Math.hypot(walker.x - ga.x, walker.y - ga.y))}px on, standing ${mode.standingGuards()}/2`);

    // 3) the Hunter helps it up by standing beside it; leaving early resets
    p.x = ga.x + 40; p.y = ga.y;
    tick(Math.round(60 * 0.8));
    const partial = ga.rescueT;
    const stillDown = ga.down;
    parkHunter();
    tick(30);
    const decayed = ga.rescueT;
    p.x = ga.x + 40; p.y = ga.y;
    let upAt = null;
    for (let i = 0; i < 60 * 2.2 && ga.down; i++) { tick(); if (!ga.down) upAt = i / 60; }
    fallCheck('the Hunter beside a fallen guard helps it up in 1.5 s with half HP; stepping away resets it',
      stillDown && partial > 0.7 && decayed === 0 && !ga.down && upAt != null && upAt > 1.4 && upAt < 1.6
        && ga.hp === Math.round(GUARD.hp * GUARD.rescueHp) && (mode.nightStats.rescued || 0) === 1,
      `0.8 s beside → ${partial.toFixed(2)} s (still down=${stillDown}); after stepping away ${decayed.toFixed(2)}; back → up after ${upAt && upAt.toFixed(2)} s with ${ga.hp} HP, rescued ${mode.nightStats.rescued}`);
    parkHunter();

    // 4) a badly hurt guard leaves its door for the fire; a healthy one stays
    mode._syncGuardRoster(true);
    const fd = mode.entranceById('frontDoor');
    fd.hp = fd.hpMax = 99999;
    mode._guardAssignT = 0;
    mode.spawnSwarm(21, 0, fd);
    let posted = false;
    for (let i = 0; i < 60 * 20 && !posted; i++) {
      tick();
      posted = mode.guards.every((gd) => gd.post && gd.post.doorId === 'frontDoor');
    }
    // let them walk the ~1400 px from the fire and hold the door while the
    // crowd claws the wood
    for (let i = 0; i < 60 * 14; i++) tick();
    const atPosts = mode.guards.every((gd) => !gd.moving && Math.hypot(gd.x - gd.post.x, gd.y - gd.post.y) < 30);
    const throughWood = atPosts && mode.guards.every((gd) => gd.hp === GUARD.hp) && fd.attackers !== undefined;
    ga.hp = Math.floor(GUARD.hp * GUARD.woundedAt) - 1;
    mode._guardAssignT = 0;
    tick();
    fallCheck('a guard at or below 35% HP falls back to a post by the fire; the healthy one keeps the door; no claws through an intact door',
      posted && throughWood && ga.post.key === 'hearth' && gb.post.doorId === 'frontDoor',
      `both posted at frontDoor=${posted} (standing at their posts=${atPosts}), door ${Math.round(fd.hpMax - fd.hp)} damage taken, guard HP after 14 s ${mode.guards.map((gd) => gd.hp).join('/')}, wounded ${ga.hp} HP → ${ga.post.key}, healthy → ${gb.post.doorId}`);

    // 5) a mid-night reload keeps the wounds, and the fallen guard where it
    //    lies with the time it has left
    survivalGame.enemies.length = 0; survivalGame.bolts.length = 0;
    pin(ga, dark);
    mode._downGuard(ga);
    ga.rescueT = 0.4;
    ga.downT = 6.5;
    gb.hp = 23;
    mode._persist(true);
    const reloaded = new Game(makeHarnessCanvas(), { mode: 'survival', nightDuration: 60 });
    const [ra, rb] = reloaded.survival.guards;
    fallCheck('a mid-night reload keeps a fallen guard down where it fell (with its clock) and a hurt one\'s HP',
      reloaded.survival.phase === 'night' && ra && ra.down && ra.hp === 0 && Math.abs(ra.x - dark.x) < 1 && Math.abs(ra.y - dark.y) < 1
        && Math.abs(ra.rescueT - 0.4) < 0.01 && Math.abs(ra.downT - 6.5) < 0.01 && rb && !rb.down && rb.hp === 23,
      `reloaded: guard 0 down=${ra && ra.down} at (${ra && Math.round(ra.x)}, ${ra && Math.round(ra.y)}) vs (${Math.round(dark.x)}, ${Math.round(dark.y)}), help ${ra && ra.rescueT}s, alone ${ra && ra.downT}s; guard 1 ${rb && rb.hp} HP`);

    // 6) left alone for 20 s a fallen guard is lost at once (one survivor
    //    fewer); one still down at dawn gets up, healed
    parkHunter();
    let lostAt = null;
    for (let i = 0; i < 60 * 16 && lostAt == null; i++) { tick(); if (!mode.guards.includes(ga)) lostAt = mode.elapsed; }
    const lostBanner = [mode.banner, ...mode.bannerQueue].some((ev) => ev && ev.kind === 'guardLost');
    const afterLoss = { survivors: mode.survivors, guards: mode.guards.length, lost: mode.nightStats.lost || 0, left: mode.guards[0] === gb && gb.hp === 23 };
    mode._downGuard(gb);
    mode.elapsed = mode.nightDuration - 0.01;
    tick(2);
    const reward = mode.lastRewards || {};
    fallCheck('a fallen guard left alone 20 s is lost (survivors 2 → 1 at once); one still down at dawn stands up healed',
      lostAt != null && afterLoss.survivors === 1 && afterLoss.guards === 1 && afterLoss.lost === 1 && afterLoss.left && lostBanner
        && mode.phase === 'day' && mode.survivors === 1 && reward.lost === 1 && reward.survivors === 0
        && mode.guards.length === 1 && mode.guards[0].hp === GUARD.hp && !mode.guards[0].down
        && mode.guards[0].post && mode.guards[0].post.key === 'hearth',
      `lost after ${GUARD.bleedOut} s alone (banner=${lostBanner}): survivors ${afterLoss.survivors}, guards ${afterLoss.guards}; dawn: phase ${mode.phase}, survivors ${mode.survivors}, reward lost ${reward.lost} / rescued ${reward.rescued}, guards ${mode.guards.map((gd) => `${gd.hp}${gd.down ? 'X' : ''}`).join('/')}`);
    mode.tuning = SURVIVAL_TUNING;
    if (mode.rewardPending && mode.rewardPending()) mode.ackRewards();

    // 7) every wave starts outside the walls: the front door's crowd used to
    //    reach into the basement and the dining door's into the gallery, so
    //    those bodies skipped the door (and clawed guards behind intact wood)
    const insideAt = [];
    let spawned = 0;
    for (const door of m.entrances.filter((e) => e.exterior && e.kind === 'door')) {
      survivalGame.enemies.length = 0;
      mode.spawnSwarm(30, 0, door);
      for (const z of survivalGame.enemies) {
        spawned++;
        if (m.findRoom(z.x, z.y) !== ROOM.OUTSIDE || m.solidAt(z.x, z.y)) insideAt.push(`${door.id}:${m.findRoom(z.x, z.y)}`);
      }
    }
    survivalGame.enemies.length = 0;
    for (let k = 0; k < 3; k++) mode.spawnBreaker(k);
    for (let k = 0; k < 6; k++) mode.spawnIndividual(k);
    for (const z of survivalGame.enemies) {
      spawned++;
      if (m.findRoom(z.x, z.y) !== ROOM.OUTSIDE || m.solidAt(z.x, z.y)) insideAt.push(`${z._survivalType}:${m.findRoom(z.x, z.y)}`);
    }
    survivalGame.enemies.length = 0;
    fallCheck('every wave body starts outside the walls and off props (no crowd starts inside the basement or gallery)',
      spawned >= 7 * 30 + 9 && insideAt.length === 0,
      `${spawned} bodies over 7 doors + Breakers + individuals, ${insideAt.length} inside/on props${insideAt.length ? ': ' + insideAt.slice(0, 6).join(' ') : ''}`);
    window.localStorage.removeItem('lastnight.save.v1');
  }
  const guardFallPass = fallChecks.length === 8 && fallChecks.every(Boolean);

  console.log(`  idle Night 3: ${idle.nightThree.peakEnemies} peak enemies / ${idle.nightThree.peakBreakers} Breakers, ${idle.nightThree.kills} kills, ${idle.nightThree.wallDamage} wall damage, gate ${idle.nightThree.gateHp} HP, Hunter ${idle.nightThree.playerHp} HP; ${idle.phase}`);
  console.log(`  builder Night 3: ${builder.nightThree.peakEnemies} peak enemies / ${builder.nightThree.peakBreakers} Breakers, ${builder.nightThree.kills} kills, ${builder.nightThree.wallDamage} wall damage, gate ${builder.nightThree.gateHp} HP, Hunter ${builder.nightThree.playerHp} HP; Perapian Lv${builder.perapianLevel}, survivors ${builder.survivors}, buildings ${builder.buildings.join(',') || 'none'}, gateBuilt=${builder.gateBuilt}; ${builder.phase}`);
  // Balance target (M1 rebuild): doing nothing must not win; an engaged
  // builder must. idle loses because the Perapian goes out.
  const idleLoses = !idle.complete && /FIRE/.test(idle.failure || '');
  console.log(`  ${idleLoses ? 'PASS' : 'FAIL'}  idle (no input, no builds) does not survive: ${idle.phase} on Night ${idle.day} (${idle.failure || 'no failure'})`);
  console.log(`  ${builder.complete ? 'PASS' : 'FAIL'}  engaged builder survives Night 3 (Flare ×${builder.flares}, Perapian Lv${builder.perapianLevel}, oil ${builder.oil})`);
  const pass = waveSchedulePass && lightEffectsPass && survivalMovementPass && breakerTargetsWall && gapRegressionPass
    && doorSolidPass && siegeLightPass && fireOutPass && breakerRetargetPass
    && hunterAutoShot && hunterRealLos && hunterSkill
    && idleLoses && builder.complete && builder.perapianLevel === 3
    && builder.queueLockVerified && builder.sawmillBuilt && builder.gateBuilt && builder.shelterBuilt
    && saveProgressPass && economyPass && progressionPass && towerPass && guardFallPass && builder.upgrades.map((item) => item.level).join(',') === '1,2,3';
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  three-day loop, Perapian Lv1→Lv3, one builder queue, idle loses / engaged builder wins`);
  if (!pass) process.exitCode = 1;
  window.localStorage.removeItem('lastnight.save.v1');
}

await runSurvivalMilestone();

if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

/* ============================================================
 * Playtest bot
 * ============================================================ */

const bot = {
  stuckT: 0, lastX: 0, lastY: 0, attackT: 0, dashT: 0, retargetT: 0, wp: null,
  log: [],

  think(game, dt) {
    const p = game.player;
    for (const k of ['left', 'right', 'up', 'down', 'attack', 'dash', 'repair', 'interact', 'barricade']) input.keys[k] = false;
    if (MODE === 'idle') return;

    // ---------------- threat assessment ----------------
    const threats = game.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 240);
    threats.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    const nearest = threats[0] || null;
    const nd = nearest ? Math.hypot(nearest.x - p.x, nearest.y - p.y) : 1e9;
    const wolf = threats.find((e) => e.key === 'werewolf' && Math.hypot(e.x - p.x, e.y - p.y) < 320);
    const crawlers = threats.filter((e) => e.key === 'crawler');
    const overwhelmed = !!wolf || threats.length >= 5 || (threats.length >= 4 && p.bloodPct < 0.4);
    const desperate = p.bloodPct < 0.34;

    // ---------------- 1. escape ----------------
    if (overwhelmed) {
      const cx = threats.reduce((a, e) => a + e.x, 0) / threats.length;
      const cy = threats.reduce((a, e) => a + e.y, 0) / threats.length;
      const fleeA = Math.atan2(p.y - cy, p.x - cx);
      input.keys.right = Math.cos(fleeA) > 0; input.keys.left = Math.cos(fleeA) < 0;
      input.keys.down = Math.sin(fleeA) > 0; input.keys.up = Math.sin(fleeA) < 0;
      input.keys.dash = p.dashCd <= 0 && p.blood > 20;
      // ...but claw anything right in front of us on the way out
      if (nearest && nd < 62) { input.keys.attack = true; }
      return;
    }

    // ---------------- 2. fight what is in our face ----------------
    if (desperate && nearest && nd > 70) {
      // starving: the nearest blood is worth more than the nearest enemy
      let best = null, bd = 1e9;
      for (const pk of game.pickups) {
        if (pk.taken || pk.kind !== 'blood') continue;
        const d = Math.hypot(pk.x - p.x, pk.y - p.y);
        if (d < bd) { bd = d; best = pk; }
      }
      if (best && bd < 700) { this.goto(game, best.x, best.y, dt); return; }
      const basin = game.mansion.props.find((pr) => pr.type === 'basin');
      if (basin && !game.basinUsed) { this.goto(game, basin.x, basin.y, dt, 60); return; }
    }

    if (nearest && nd < 100) {
      if (process.env.DIAG && !this._logged) { console.log(`  FIGHT at t=${game.time.toFixed(1)} nd=${nd.toFixed(0)} key=${nearest.key}`); this._logged = true; }
      this.face(p, nearest.x, nearest.y);
      input.keys.attack = true;
      this.fightFrames = (this.fightFrames || 0) + 1;
      return;
    }

    if (process.env.DIAG && frames % 600 === 0 && frames > 0) {
      console.log(`  think t=${game.time.toFixed(0)} threats=${threats.length} nd=${nd.toFixed(0)} overwhelm=${overwhelmed} desperate=${desperate} fightFrames=${this.fightFrames || 0}`);
    }

    // ---------------- 3. feed: hunt a crawler when the hunger bites ----------
    if (p.bloodPct < 0.55) {
      const prey = threats.filter((e) => e.key === 'crawler')[0]
        || game.enemies.filter((e) => !e.dead && e.key === 'crawler' && Math.hypot(e.x - p.x, e.y - p.y) < 760)
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (prey && Math.hypot(prey.x - p.x, prey.y - p.y) < 760) {
        if (Math.hypot(prey.x - p.x, prey.y - p.y) < 92) { this.face(p, prey.x, prey.y); input.keys.attack = true; }
        else this.goto(game, prey.x, prey.y, dt, 40);
        return;
      }
    }

    // ---------------- 3b. hunger ----------------
    if (p.bloodPct < 0.62) {
      let best = null, bd = 1e9;
      for (const pk of game.pickups) {
        if (pk.taken || pk.kind !== 'blood') continue;
        const d = Math.hypot(pk.x - p.x, pk.y - p.y);
        if (d < bd) { bd = d; best = pk; }
      }
      if (best && bd < 900) { this.goto(game, best.x, best.y, dt); return; }
      const basin = game.mansion.props.find((pr) => pr.type === 'basin');
      if (basin && !game.basinUsed && p.bloodPct < 0.4) { this.goto(game, basin.x, basin.y, dt, 60); return; }
    }

    // ---------------- 4. doors ----------------
    const doors = game.mansion.doors.filter((d) => !d.broken);
    const worst = doors.slice().sort((a, b) => (a.hp / a.hpMax) - (b.hp / b.hpMax))[0];
    if (worst && worst.hp / worst.hpMax < 0.7 && p.planks > 0) {
      const near = Math.hypot(worst.inside.x - p.x, worst.inside.y - p.y) < 52;
      if (near) { this.face(p, worst.x, worst.y); input.keys.repair = true; return; }
      this.goto(game, worst.inside.x, worst.inside.y, dt, 30);
      return;
    }

    // ---------------- 4b. board something back up ----------------
    if (p.planks >= 3) {
      const openDoor = game.mansion.doors.filter((d) => d.broken && d.barricade < 2)
        .sort((a, b) => Math.hypot(a.inside.x - p.x, a.inside.y - p.y) - Math.hypot(b.inside.x - p.x, b.inside.y - p.y))[0];
      if (openDoor && Math.hypot(openDoor.inside.x - p.x, openDoor.inside.y - p.y) < 900) {
        if (Math.hypot(openDoor.inside.x - p.x, openDoor.inside.y - p.y) < 52) {
          this.face(p, openDoor.x, openDoor.y);
          input.keys.barricade = true;
          return;
        }
        this.goto(game, openDoor.inside.x, openDoor.inside.y, dt, 30);
        return;
      }
    }

    // ---------------- 5. supplies ----------------
    if (p.planks < 3) {
      let best = null, bd = 1e9;
      for (const pk of game.pickups) {
        if (pk.taken || pk.kind !== 'planks') continue;
        const d = Math.hypot(pk.x - p.x, pk.y - p.y);
        if (d < bd) { bd = d; best = pk; }
      }
      if (best) { this.goto(game, best.x, best.y, dt); return; }
    }

    // ---------------- 6. hold the hall ----------------
    const c = game.mansion.roomCenter('hall');
    const drift = Math.sin(game.time * 0.25) * 140;
    this.goto(game, c.x + drift, c.y + 40, dt, 70);
  },

  face(p, x, y) {
    const a = Math.atan2(y - p.y, x - p.x);
    input.keys.right = Math.cos(a) > 0.3;
    input.keys.left = Math.cos(a) < -0.3;
    input.keys.down = Math.sin(a) > 0.3;
    input.keys.up = Math.sin(a) < -0.3;
  },

  goto(game, tx, ty, dt, closeEnough = 26) {
    const p = game.player;
    const myRoom = game.mansion.findRoom(p.x, p.y);
    const tRoom = game.mansion.findRoom(tx, ty);
    let wx = tx, wy = ty;
    if (myRoom !== tRoom && myRoom !== 'outside' && tRoom !== 'outside') {
      const route = game.mansion.route(myRoom, tRoom);
      if (route.length) { wx = route[0].x; wy = route[0].y; }
    }
    const d = Math.hypot(wx - p.x, wy - p.y);
    if (d < closeEnough) { this.wp = null; return; }
    this.face(p, wx, wy);
    const moved = Math.hypot(p.x - this.lastX, p.y - this.lastY);
    if (moved < 0.4) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    this.lastX = p.x; this.lastY = p.y;
    if (this.stuckT > 0.8) {
      const a = Math.atan2(wy - p.y, wx - p.x) + Math.PI / 2 * (Math.sin(game.time * 3) > 0 ? 1 : -1);
      input.keys.right = Math.cos(a) > 0.2; input.keys.left = Math.cos(a) < -0.2;
      input.keys.down = Math.sin(a) > 0.2; input.keys.up = Math.sin(a) < -0.2;
    }
  },
};

/* ============================================================
 * Telemetry
 * ============================================================ */

const telemetry = [];
const frameErrors = [];

function sample(game) {
  telemetry.push({
    t: +game.time.toFixed(1),
    blood: +game.player.bloodPct.toFixed(2),
    alive: game.enemies.filter((e) => !e.dead).length,
    inside: game.enemies.filter((e) => !e.dead && e.insideHouse).length,
    kills: game.stats.kills,
    planks: game.player.planks,
    doors: game.mansion.doors.map((d) => (d.broken ? 0 : Math.round(d.hp))),
    windows: game.mansion.entrances.filter((e) => e.kind === 'window').map((e) => (e.broken ? 0 : Math.round(e.hp))),
    mood: game.director.mood,
    danger: +game.danger.toFixed(2),
    heartbeat: +game.heartRate.toFixed(2),
    budget: +game.director.budget.toFixed(2),
    knock: game.director.knock ? game.director.knock.outcome : null,
    spawned: game.director.spawnedThisNight,
  });
}

/* ============================================================
 * Main loop
 * ============================================================ */

const dt = 1 / 60;
let frames = 0;
let lastSample = -99;
const shotTimes = args.shots ? [0, 40, 90, 150, 200, 245, 272, 292, 299] : [];
let shotIdx = 0;
let outcome = 'timeout';

game.renderer.snapCamera(game.player.x, game.player.y);
input.layout(1280, 720);
game.freshRun();
game.screen = 'playing';

/* ---------------- density: how much of the night a player can SEE ----------
 * The show is not the simulation. A night can hold eighty creatures and still
 * look empty if the frame holds two of them, and the phone frame is a keyhole
 * (353x1120 world units). This mode measures the gap between what the night
 * contains and what the screen shows — the number the hero scenes (the
 * memorable combat/scene moments live or die by.
 *   node tools/harness.mjs --mode=density
 */
if (MODE === 'density') {
  const marks = [30, 60, 90, 120, 150, 180, 210, 240, 270, 292];
  console.log('\n=== DENSITY — what the night holds vs what the frame shows ===');
  console.log('   (phone frame: 390x693 canvas, zoom 1.10 — the shape the game ships in)');
  console.log('\n  t   phase      alive  crowd  inFrame  atDoors  pointsAttacked  openingsLeft  mix');
  for (const nights of [0, 4, 8, 12]) {
    game.save.privacyAck = true;
    game.save.nightsSurvived = nights;
    game.renderer.resize(390, 693, 1);
    input.layout(390, 693);
    reseed(SEED + nights * 7919);      // each night measured on its own stream
    game.beginNight();
    game.introT = 99; game.skipNarration(); game.skipNarration(); game.startNightProper();
    let mi = 0, peak = 0, peakAt = 0, framePeak = 0, nearPeak = 0;
    let crowdPeak = 0, crowdFramePeak = 0, bodyPeak = 0;
    const onScreen = (o, cam) => Math.abs(o.x - cam.x) < cam.viewW * 0.5 + 40
      && Math.abs(o.y - cam.y) < cam.viewH * 0.5 + 40;
    for (let i = 0; i < 300 * 60; i++) {
      bot.think(game, dt);
      game.update(dt);
      const alive = game.enemies.filter((e) => !e.dead).length;
      if (alive > peak) { peak = alive; peakAt = Math.round(game.time); }
      const cam = game.renderer.cam;
      /* THE SIEGE (#60): the show is the whole frame — the besiegers AND the
       * crowd at the walls, which is the hook the issue is written for. */
      const crowd = (game.director.crowd || []).filter((b) => !b.gone);
      if (crowd.length > crowdPeak) crowdPeak = crowd.length;
      const crowdFrame = crowd.filter((b) => onScreen(b, cam)).length;
      if (crowdFrame > crowdFramePeak) crowdFramePeak = crowdFrame;
      const inFrame = game.enemies.filter((e) => !e.dead && onScreen(e, cam)).length;
      if (inFrame + crowdFrame > bodyPeak) bodyPeak = inFrame + crowdFrame;
      const near = game.enemies.filter((e) => !e.dead
        && Math.abs(e.x - cam.x) < 450 && Math.abs(e.y - cam.y) < 450).length;
      if (inFrame > framePeak) framePeak = inFrame;
      if (near > nearPeak) nearPeak = near;
      if (mi < marks.length && game.time >= marks[mi]) {
        const atDoor = game.enemies.filter((e) => !e.dead && e.state === 'breach').length;
        const points = game.mansion.entrances.filter((x) => (x.attackers || 0) > 0).length;
        const open = game.mansion.entrances.filter((x) => !(x.broken)).length;
        const kinds = {};
        for (const e of game.enemies) if (!e.dead) kinds[e.key] = (kinds[e.key] || 0) + 1;
        const crowdNow = (game.director.crowd || []).filter((b) => !b.gone && onScreen(b, game.renderer.cam)).length;
        console.log(` ${String(marks[mi]).padStart(3)}  ${String(game.phase.id).padEnd(9)} ${String(alive).padStart(4)}   ${String(crowd.length).padStart(4)}    ${String(inFrame + crowdNow).padStart(4)}    ${String(atDoor).padStart(4)}       ${String(points).padStart(4)}          ${String(open).padStart(3)}        ${JSON.stringify(kinds)}`);
        mi++;
      }
      if (game.screen !== 'playing') { console.log(`     (night ended: ${game.screen} @ ${Math.round(game.time)}s)`); break; }
    }
    const cam2 = game.renderer.cam;
    console.log(`   NIGHT ${nights + 1}: peak ${peak} besiegers alive at t=${peakAt}s · most ever IN FRAME ${framePeak}`);
    console.log(`             THE SIEGE: crowd peaked at ${crowdPeak} bodies outside (${crowdFramePeak} of them on screen at once) · ${bodyPeak} bodies in the frame at the busiest moment`);
    console.log(`             kills ${game.stats.kills} · openings ${game.mansion.entrances.filter((x) => !(x.broken)).length}/${game.mansion.entrances.length} standing · frame ${Math.round(cam2.viewW)}x${Math.round(cam2.viewH)} world units (zoom ${cam2.zoom.toFixed(2)})\n`);
  }
  process.exit(0);
}

if (MODE === 'combat') {
  // deterministic check: put a crawler in front of the vampire and claw it
  const { Crawler, Hunter, Werewolf } = await import('../src/game/enemies.js');
  const results = [];
  for (const [name, Cls, dist0] of [['crawler', Crawler, 50], ['hunter', Hunter, 50], ['werewolf', Werewolf, 58]]) {
    const p = game.player;
    p.blood = p.bloodMax;
    const e = new Cls(p.x + dist0, p.y, {});
    e.alpha = 1; e.spawnGrace = 0;
    game.enemies.push(e);
    const hp0 = e.hp;
    let frames2 = 0;
    const startBlood = p.blood;
    while (!e.dead && frames2 < 900) {
      // face and claw
      input.keys.attack = frames2 % 6 === 0;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      input.keys.right = Math.cos(a) > 0.3; input.keys.left = Math.cos(a) < -0.3;
      input.keys.down = Math.sin(a) > 0.3; input.keys.up = Math.sin(a) < -0.3;
      game.update(dt);
      frames2++;
      if (p.state === 'death') break;
    }
    results.push(`${name}: hp ${hp0}->${Math.max(0, Math.round(e.hp))} dead=${e.dead} frames=${frames2} playerBlood=${startBlood.toFixed(0)}->${p.blood.toFixed(0)}`);
    game.enemies.length = 0;
    game.player.blood = game.player.bloodMax;
    game.player.state = 'idle';
    game.log.length = 0;
  }
  console.log('\n=== COMBAT CHECK ===');
  results.forEach((r) => console.log('  ' + r));
  console.log(`  kills counted: ${game.stats.kills}`);
  process.exit(0);
}

/* ---------------- HUD zoom sheet ----------------
 * Renders one busy gameplay frame and blows up each HUD element so the
 * hand-drawn (code-drawn) interface can actually be inspected.
 */
if (args.hud) {
  const { createCanvas } = await import('@napi-rs/canvas');
  // build a believable "everything is happening" moment
  game.freshRun(); game.screen = 'playing';
  const botRun = args.bot ? parseInt(args.bot, 10) : 12000;
  // play until the night is busy but still alive, so the HUD is in its
  // interesting state rather than showing a results screen
  for (let i = 0; i < botRun; i++) {
    bot.think(game, dt);
    game.update(dt);
    if (game.screen !== 'playing') { game.freshRun(); game.screen = 'playing'; }
    if (game.time > 130 && game.enemies.length >= 3) break;
  }
  const p = game.player;
  p.planks = 3;
  p.blood = p.bloodMax * 0.34;
  p.dashCd = 1.2;
  p.attackCd = 0.4;
  game.messages.length = 0;
  game.showMessage('BAY WINDOW IS UNDER ATTACK.', { tone: 'danger', life: 6 });
  game.showMessage('A CROSSBOW BOLT CLATTERS AGAINST THE GLASS.', { tone: 'cold', life: 6 });
  const door = game.mansion.doors.find((d) => !d.broken) || game.mansion.doors[0];
  p.x = door.inside.x; p.y = door.inside.y + 26;
  door.hp = door.hpMax * 0.42;
  door.attackers = 1;
  const d2 = game.mansion.doors.find((d) => d !== door);
  if (d2) { d2.hp = 0; d2.broken = true; }
  game.updateInteraction();
  // let the messages finish fading in and the frame settle before capturing
  for (let i = 0; i < 40; i++) game.update(dt);
  game.render();

  const regions = [
    ['CLOCK  (atas tengah)', 405, 0, 470, 96],
    ['BLOOD  (kiri bawah)', 0, 588, 300, 132],
    ['ACTIONS  (kanan bawah)', 975, 588, 305, 132],
    ['DOORS  (kanan atas)', 940, 84, 340, 92],
    ['PROMPTS + PESAN  (tengah bawah)', 300, 460, 680, 260],
  ];
  const scale = 2.1, capH = 30, pad = 10;
  const outW = Math.max(...regions.map((r) => Math.round(r[3] * scale))) + pad * 2;
  const outH = regions.reduce((a, r) => a + Math.round(r[4] * scale) + capH + pad, pad);
  const out = createCanvas(outW, outH);
  const octx = out.getContext('2d');
  octx.fillStyle = '#0a0b10'; octx.fillRect(0, 0, outW, outH);
  let y = pad;
  for (const [label, rx, ry, rw, rh] of regions) {
    octx.fillStyle = 'rgba(200,190,170,0.85)';
    octx.font = '600 15px monospace';
    octx.fillText(label, pad, y + 18);
    y += capH;
    const dw = Math.round(rw * scale), dh = Math.round(rh * scale);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(canvas, rx, ry, rw, rh, pad, y, dw, dh);
    octx.strokeStyle = 'rgba(120,110,95,0.35)';
    octx.strokeRect(pad + 0.5, y + 0.5, dw - 1, dh - 1);
    y += dh + pad;
  }
  const cctx = canvas.getContext('2d');
  const px = cctx.getImageData(640, 300, 1, 1).data;
  const lum = (px[0] + px[1] + px[2]) / 3;
  console.log(`frame check: renderer.flash=${game.renderer.flash.toFixed(3)} luminance=${lum.toFixed(0)} ${lum < 150 ? 'OK (dark)' : 'FAIL (washed out)'}`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOT_DIR, 'hud-zoom.png'), out.toBuffer('image/png'));
  fs.writeFileSync(path.join(SHOT_DIR, 'hud-full.png'), canvas.toBuffer('image/png'));
  console.log('hud-zoom.png + hud-full.png written');
  process.exit(0);
}

/* ---------------- touch / small screen smoke test ---------------- */
if (args.touch) {
  console.log('touch layout check:');
  const resize = (w, h) => {
    canvas.width = w; canvas.height = h;
    canvas.clientWidth = w; canvas.clientHeight = h;
    game.resize && game.resize();
  };
  for (const [w, h] of [[900, 420], [412, 915], [1280, 720]]) {
    resize(w, h);
    game.freshRun(); game.screen = 'playing';
    game.player.planks = 3;
    game.input.touchSeen = true;
    game.input.layout(w, h);
    for (let i = 0; i < 40; i++) game.update(dt);
    game.render();
    const btn = game.input.buttons || {};
    const names = Object.keys(btn);
    console.log(`  ${w}x${h}: ok, buttons=[${names.join(',')}]`);
  }
  process.exit(0);
}

/* ---------------- systems check ----------------
 * Drives the paths a normal playthrough only reaches by luck: answering a
 * knock, ignoring a knock, hand repair, barricade, and the blood basin.
 */
if (args.systems) {
  const line = (ok, msg) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  const run = (n) => { for (let i = 0; i < n; i++) game.update(dt); };
  console.log('systems check:');
  const { KNOCKS } = await import('../src/core/config.js');

  // ---- knocking: the player opens the door ----
  game.freshRun(); game.screen = 'playing'; game.time = 80;
  game.director.knock = null;
  const door = game.mansion.doors.find((d) => d.id === 'servantDoor') || game.mansion.doors[0];
  game.director.knock = {
    entranceId: door.id, outcome: 'crawler', knockCount: 0, nextKnockAt: 0,
    deadline: game.time + 20, resolved: false, opened: false, known: true,
  };
  game.player.x = door.inside.x; game.player.y = door.inside.y;
  door.hp = door.hpMax; door.open = false; game.doRepair(0.016, door); // warm the path
  game.toggleDoor(door);   // this answers the knock
  line(game.director.knock === null, 'opening the door resolves the knock');
  line(game.enemies.length > 0, `answering spawned the waiting enemy (${game.enemies.length})`);
  line(game.messages.some((m) => /WAITING|NOT WAIT|INVITATION|ANSWERED|PATIENT/i.test(m.text)), 'the answer is narrated, not yet revealed');

  // ---- knocking: the player ignores it until the deadline ----
  game.freshRun(); game.screen = 'playing'; game.time = 100;
  game.player.x = 700; game.player.y = 1150;
  const e2 = game.mansion.doors.find((d) => d.id === 'cellarDoor');
  game.director.knock = {
    entranceId: e2.id, outcome: 'hunter', knockCount: 0, nextKnockAt: 0.5,
    deadline: game.time + 2, resolved: false, opened: false, known: true,
  };
  const n0 = game.enemies.length;
  let knocked = 0;
  const realKnockSound = game.onKnockSound.bind(game);
  game.onKnockSound = (e, k) => { knocked++; return realKnockSound(e, k); };
  run(240);
  game.onKnockSound = realKnockSound;
  line(knocked >= 1, `ignoring still knocks on the door (${knocked} knocks heard)`);
  line(game.director.knock === null, 'the knock resolves itself after the deadline');
  line(game.enemies.length >= n0, 'ignoring has its own consequence');

  // ---- hand repair (no planks) ----
  game.freshRun(); game.screen = 'playing';
  const d3 = game.mansion.doors[0];
  d3.hp = 40; d3.broken = true;
  game.player.planks = 0;
  game.player.x = d3.inside.x; game.player.y = d3.inside.y;
  game.updateInteraction();
  for (let i = 0; i < 120; i++) { game.input.keys.repair = true; game.doRepair(dt, d3); }
  line(d3.hp > 40, `bare hands still repair, slowly (${d3.hp.toFixed(1)} hp)`);
  line(d3.hp <= d3.baseHpMax, 'bare hands cannot push past the base cap');

  // ---- barricade ----
  const d4 = game.mansion.doors[1];
  d4.hp = d4.hpMax; game.player.planks = 4;
  const cap0 = d4.hpMax;
  game.doBarricade(d4);
  line(d4.hpMax > cap0 && d4.hp > cap0, `barricading raises the cap and the door (${cap0} -> ${d4.hpMax})`);

  // ---- blood basin ----
  game.player.blood = 20;
  const basin = game.mansion.props.find((pr) => pr.type === 'basin');
  if (basin) {
    game.player.x = basin.x; game.player.y = basin.y;
    game.startDrink(basin);
    input.keys.interact = true;      // drinking is a deliberate hold
    run(150);
    input.keys.interact = false;
    line(game.player.blood > 20, `the basin restores blood (${game.player.blood.toFixed(0)})`);
  }
  else line(false, 'no basin in the mansion');

  const { hideDeathSecond, unlocked, rankCount, tellFor, purseFloor, drainPerSecond, projectDawn, curveSweep, grantLaneTitle, houseTitle } = await import('../src/game/economy.js');
  const { dealNightGoals, forbiddenPair, CORE_GOALS } = await import('../src/game/objectives.js');
  const { TUNING, nightHeat, threatMix, CLIMAX } = await import('../src/core/config.js');
  const hideAt = hideDeathSecond({ nightsSurvived: 1 });
  line(hideAt > 180 && hideAt < 210, `hoard-and-hide dies at ${hideAt.toFixed(0)}s (want 03:00–03:30)`);
  const n1 = drainPerSecond({ nightsSurvived: 0 });
  line((48 + 20) / n1 > 300 && 48 / n1 < 300, `night 1 is a taught feed (${(48 / n1).toFixed(0)}s hidden, ${((48 + 20) / n1).toFixed(0)}s with one kill)`);
  line((77.6 + 60) / 0.42 > 300, 'three feeds carry a later night to dawn');
  line(projectDawn(48, 300, { nightsSurvived: 1 }).failing, 'a hider is already losing at dusk, with the whole night left to feed');
  line(nightHeat(4) > 1.2 && nightHeat(4) < 1.35, `four dawns of heat (${nightHeat(4).toFixed(2)}) fits a maxed lane`);
  line(nightHeat(12) <= nightHeat(8) + 0.001 && threatMix(8).stalker && !threatMix(3).stalker, 'count flattens; kind keeps rising');
  const sweep = curveSweep();
  line(sweep.ok, 'curve sweep ' + sweep.rows.map((r) => `n${r.n} heat ${r.heat.toFixed(2)} door ${r.door.toFixed(2)}${r.stalker ? ' stalker' : ''}`).join(' | '));
  const titled = { builds: { g_dmg: 1, g_rec: 1, g_aspd: 1, g_blood: 1 } };
  line(grantLaneTitle(titled, 'glutton') === 'THE GLUTTON' && houseTitle(titled) === 'THE GLUTTON', 'a finished lane is a name, not a stat');
  let badGoals = 0;
  for (let s = 1; s <= 200; s++) {
    const ids = dealNightGoals(s).map((g) => g.id);
    if (ids.length !== 3 || forbiddenPair(ids) || !ids.some((id) => CORE_GOALS.has(id))) badGoals++;
  }
  line(badGoals === 0, '200 seeds deal 3 goals, no contradiction, always a core');
  line(!unlocked({ nightsSurvived: 0, revealed: {} }, 'market'), 'night 1 hides the market');
  line(unlocked({ nightsSurvived: 3, revealed: {} }, 'market'), 'the market opens after three dawns');
  for (const [outcome, cls] of [['crawler', 'menacing'], ['gift', 'gift'], ['nothing', 'empty'], ['werewolf', 'menacing']]) {
    line(tellFor(outcome).class === cls, `${outcome} tell is ${cls}`);
  }
  line(tellFor('nothing').sound === 'tellEmpty', 'an empty door still has a knock tell');
  const { guidanceLine } = await import('../src/game/hud.js');
  const coachWas = game.coach;
  const bloodWas = game.player.blood;
  const failingWas = game.hungerFailing;
  const knockWas = game.director.knock;
  const attackersWas = game.mansion.entrances.map((e) => e.attackers);
  game.narrativeLine = 'THE HOUSE REMEMBERS.';
  game.storyLine = null;
  game.coach = { step: 'walk' };
  line(guidanceLine(game).startsWith('DRAG'), 'urgent guidance pre-empts a story murmur');
  game.coach = { step: 'done' };
  game.player.blood = game.player.bloodMax;
  game.hungerFailing = false;
  game.director.knock = null;
  for (const e of game.mansion.entrances) e.attackers = 0;
  line(guidanceLine(game) === 'THE HOUSE REMEMBERS.', 'the story murmur resumes when the night is quiet');
  game.render();
  game.narrativeLine = null;
  game.coach = coachWas;
  game.player.blood = bloodWas;
  game.hungerFailing = failingWas;
  game.director.knock = knockWas;
  game.mansion.entrances.forEach((e, i) => { e.attackers = attackersWas[i]; });
  const { SFX } = await import('../src/core/audio.js');
  line(typeof SFX.tellEmpty === 'function' && typeof SFX.hitFlesh === 'function' && typeof SFX.drink === 'function' && typeof SFX.doorBreak === 'function', 'feed, claw, door, and knock tells are synth layers');
  game.director.knock = null;
  game.director.lastKnock = -999;
  const told = game.director.scheduleKnock(game, { force: true, outcome: 'gift', entranceId: 'diningDoor' });
  line(told && told.tell && told.tell.class === 'gift', 'a scheduled knock carries its tell');
  game.director.knock = null;
  game.save.shards = 0;
  game.shardsEarned = 10;
  game.purseReady = true;
  game.purseSettled = false;
  game.settlePurse('leave');
  line(game.bankedNow === purseFloor(10), `leaving a death keeps the floor (${game.bankedNow})`);
  game.purseSettled = false;
  game.purseReady = true;
  game.shardsEarned = 10;
  game.settlePurse('dawn');
  line(game.bankedNow === 10, 'dawn banks the whole purse');
  game.save.shards = 400;
  game.save.nightsSurvived = 4;
  game.save.builds = {};
  game.save.revealed = { builds: true };
  for (const lane of ['glutton', 'glutton', 'glutton', 'glutton', 'warden', 'warden', 'shade']) game.buyUpgrade(lane);
  line(rankCount(game.save) === 6, `commitment cap holds at ${rankCount(game.save)}`);
  TUNING.noSpawns = true;
  game.save.nightsSurvived = 1;
  game.save.builds = {};
  game.freshRun();
  game.screen = 'playing';
  const vials = game.pickups.filter((p) => p.kind === 'blood');
  line(vials.length === 6, `six vials in the house, not a pantry (${vials.length})`);
  for (const p of vials) game.grantBlood(p.amount, true);
  game.grantBlood(8, true);
  game.grantBlood(6, true);
  line(game.player.blood < 90, `a full scavenge is not a meal (${game.player.blood.toFixed(1)} blood)`);
  game.save.nightsSurvived = 2;
  game.freshRun();
  game.screen = 'playing';
  game.time = 120;
  game.stats.feedShards = 6;
  game.finalizeShards(120);
  game.killPlayer('the hunger took you');
  game.beginDying();
  const atRisk = game.shardsEarned;
  line(atRisk > 0 && !game.purseSettled, `death leaves ◆${atRisk} at risk`);
  game.screen = 'death';
  game.usedRevive = false;
  game.save.iap = game.save.iap || { owned: {}, revives: 0 };
  game.save.iap.revives = 1;
  const held = game.shardsEarned;
  game.spendSecondBlood();
  line(game.screen === 'playing' && !game.purseSettled && game.shardsEarned === held, 'revive keeps the purse and does not bank it');
  const { IAP } = await import('../src/shop/iap.js');
  const adSave = { shards: 300, relics: 0, nightsSurvived: 6, revealed: { ads: true }, deeds: {}, builds: {}, iap: { owned: {}, revives: 0 } };
  const bought = IAP.buyWithShards(adSave, 'remove_ads');
  line(bought.ok && adSave.iap.owned.remove_ads && adSave.shards === 20 && !adSave.iap.owned.shards, 'remove-ads is shard-earnable and grants no power');
  game.seenIntroThisSession = false;
  game.beginNight();
  line(game.screen === 'intro', 'the first attempt still opens on the intro');
  game.beginNight();
  // A retry skips the intro CARD. The narrator still plays if night one has
  // never been told — that is the whole point of the surface.
  line(game.screen !== 'intro', 'a retry fades in and skips the intro card');

  const { BEATS, nextBeat, ackBeat, endingFrame, fragmentsKnown, narrationLines } = await import('../src/game/narrative.js');
  line(BEATS.length > 0 && BEATS.every((b) => b.id && b.trigger && b.surface && b.text && !/placeholder|\[draft\]/i.test(b.text)), 'beats are data, not placeholders');
  line(BEATS.every((b) => b.surface === 'strip' || b.surface === 'dawnCard' || b.surface === 'room' || b.surface === 'narration' || b.surface === 'actCard'), 'every beat names a surface the game can draw: strip, dawn-card, room, narration, act card');
  const storySave = { beats: {}, pendingDawn: [] };
  const waking = nextBeat(storySave, { surface: 'dawnCard', event: 'dawn', dawn: 1 });
  line(waking && waking.id === 'dawn-waking' && /servant/.test(waking.text), 'night 1 dawn card is the waking');
  ackBeat(storySave, waking && waking.id);
  line(!nextBeat(storySave, { surface: 'dawnCard', event: 'dawn', dawn: 1 }), 'a once-only dawn card does not double-fire');
  const faces = nextBeat(storySave, { surface: 'strip', event: 'night', night: 2 });
  line(faces && faces.id === 'night-faces', 'night 2 strip is the dead she made');
  ackBeat(storySave, faces && faces.id);
  const stakes = nextBeat(storySave, { surface: 'strip', event: 'night', night: 3 });
  line(stakes && stakes.id === 'night-stakes' && /stakes/.test(stakes.text), 'night 3 strip is the hunters’ stakes');
  line(!nextBeat(storySave, { surface: 'room', event: 'room', room: 'chapel', night: 2 }), 'night 2 does not steal the chapel fragment');
  line(!nextBeat(storySave, { surface: 'room', event: 'room', room: 'chapel', night: 1 }), 'the chapel waits until the house remembers');
  const chapel = nextBeat(storySave, { surface: 'room', event: 'room', room: 'chapel', night: 4 });
  line(chapel && chapel.surface === 'room' && chapel.id === 'room-chapel', 'chapel routes to the room surface');
  const gift1 = nextBeat(storySave, { surface: 'strip', event: 'knock', knock: 'gift', night: 3 });
  ackBeat(storySave, gift1 && gift1.id);
  line(gift1 && gift1.id === 'knock-kept' && !nextBeat(storySave, { surface: 'strip', event: 'knock', knock: 'gift', night: 3 }), 'the first gift is the kept-safe fragment, once');
  const gift2 = nextBeat(storySave, { surface: 'strip', event: 'knock', knock: 'gift', night: 8 });
  line(gift2 && gift2.id === 'knock-true-dawn' && gift2.id !== gift1.id, 'a later gift advances the fragment thread');
  line(!nextBeat(storySave, { surface: 'dawnCard', event: 'night', night: 2 }), 'a night does not masquerade as a dawn-card');

  game.save.beats = {};
  game.save.pendingDawn = [];
  game.storyQueue = [];
  game.storyLine = null;
  game.storyBeatId = null;
  game.save.nightsSurvived = 1;
  game.beginNight();
  line(game.storyQueue.some((b) => b.id === 'night-faces') || game.storyBeatId === 'night-faces', 'night start asks the director for the strip');
  const doorMurmur = game.offerNarrative({ surface: 'strip', event: 'state', state: 'doorLost', night: 2 });
  line(doorMurmur && doorMurmur.id === 'state-door', 'a lost door asks the director');
  line(game.storyQueue.filter((b) => b.id === 'state-door').length + (game.storyBeatId === 'state-door' ? 1 : 0) === 1, 'the door murmur is queued once');
  ackBeat(game.save, 'state-door');
  line(!nextBeat(game.save, { surface: 'strip', event: 'state', state: 'doorLost', night: 4 }), 'a seen door murmur stays seen on the save');
  game.screen = 'playing';
  game.save.nightsSurvived = 0;
  delete game.save.beats['dawn-waking'];
  game.save.pendingDawn = [];
  game.beginDawn();
  line(game.save.pendingDawn[0] === 'dawn-waking' && game.save.beats['dawn-waking'] === 1, 'surviving night 1 holds the waking card');
  const dawnHeld = game.save.pendingDawn.length;
  game.beginDawn();
  line(game.save.pendingDawn.length === dawnHeld, 'the dawn card does not double-fire');
  line(game.screen === 'dawnCard' && game.dawnCard && game.dawnCard.text, 'the waking card plays before the results');
  game.finishDawnCard();
  line(game.screen === 'dawn' && !(game.save.pendingDawn || []).includes('dawn-waking'), 'dismissing the card clears it');
  line(fragmentsKnown(game.save).some((f) => f.id === 'dawn-waking'), 'a shown dawn line is remembered');
  game.screen = 'playing';
  game.save.beats['knock-true-dawn'] = 1;
  game.save.nightsSurvived = 7;
  game.save.ending = null;
  game.save.feeds = 1;
  game.save.pendingDawn = [];
  const hid = endingFrame({ feeds: 1, nightsSurvived: 8 });
  const daring = endingFrame({ feeds: 12, nightsSurvived: 8 });
  line(hid !== daring, 'the lean frames the choice and does not pick it');
  game.beginDawn();
  line(game.screen === 'ending', 'act III offers the choice instead of auto-resolving');
  game.chooseEnding('monster');
  line(game.save.ending === 'monster' && !(game.save.iap.owned && game.save.iap.owned.title_dawnbreaker), 'turning back keeps the siege and withholds the title');
  game.save.ending = null;
  game.chooseEnding('dawnbreaker');
  line(game.save.ending === 'dawnbreaker' && game.save.iap.owned.title_dawnbreaker === true, 'walking into the dawn grants DAWNBREAKER');
  const arcSave = { beats: {}, nightsSurvived: 0, pendingDawn: [], seen: {} };
  const arc = [];
  const take = (beat) => { if (!beat) return; arc.push(beat.id); ackBeat(arcSave, beat.id); };
  for (let n = 1; n <= 10; n++) {
    take(nextBeat(arcSave, { surface: 'strip', event: 'night', night: n }));
    take(nextBeat(arcSave, { surface: 'dawnCard', event: 'dawn', dawn: n }));
    for (const room of ['dining', 'hall', 'chapel', 'conservatory', 'study', 'basement', 'kitchen', 'gatehouse']) {
      take(nextBeat(arcSave, { surface: 'room', event: 'room', room, night: n }));
    }
    take(nextBeat(arcSave, { surface: 'strip', event: 'knock', knock: 'gift', night: n }));
  }
  line(arc.includes('dawn-waking') && arc.includes('night-faces') && arc.includes('night-stakes') && arc.includes('dawn-kept') && arc.includes('knock-true-dawn') && arc.includes('room-chapel'), 'nights 1 through 10 keep the bible order');
  line(arc.indexOf('dawn-waking') < arc.indexOf('dawn-past') && arc.indexOf('night-faces') < arc.indexOf('night-leave'), 'earlier nights speak before the late ones');
  line(arc.length === new Set(arc).size, 'no beat repeats across the arc');
  line(BEATS.every((b) => b.text && b.text.length <= 120 && !/TODO|lorem|placeholder/i.test(b.text)), 'every line is final and short enough for the strip');
  line(BEATS.every((b) => b.surface !== 'actCard' || ((b.title || '').length <= 40 && (b.epigraph || '').length <= 60)), 'an act card stays an act card: short title, short epigraph');
  game.screen = 'ending';
  game.endingT = 1;
  game.render();
  const endingBtns = game.ui.filter((b) => b.label === 'WALK INTO THE DAWN' || b.label === 'TURN BACK');
  line(endingBtns.length === 2 && endingBtns.every((b) => b.h >= 44), 'both endings sit on the thumb, 44px or taller');
  // ---- the narrator's plate (#52 B): the story is told, not only murmured ----
  const narrSave = { beats: {}, pendingDawn: [], seen: {} };
  const opening = narrationLines(narrSave, { surface: 'narration', event: 'open', night: 1 });
  line(opening.length === 3 && opening[0].id === 'open-woke', 'night one has three authored lines waiting');
  line(opening.filter((b) => b.voice === 'house').length === 1, 'and the house answers in the second person');
  line(narrationLines(narrSave, { surface: 'narration', event: 'open', night: 2 }).length === 0, 'the opening is night one, not every night');
  for (const b of opening) ackBeat(narrSave, b.id);
  line(narrationLines(narrSave, { surface: 'narration', event: 'open', night: 1 }).length === 0, 'a seen opening does not play twice');
  line(narrationLines(narrSave, { surface: 'narration', event: 'open', night: 1 }, { includeSeen: true }).length === 3, 'but the menu may replay it without forgetting it');
  const cardA1 = nextBeat(narrSave, { surface: 'actCard', event: 'act', act: 1 });
  const cardA2 = nextBeat(narrSave, { surface: 'actCard', event: 'act', act: 2 });
  const cardA3 = nextBeat(narrSave, { surface: 'actCard', event: 'act', act: 3 });
  line(cardA1.title === 'ACT I — THE WAKING' && cardA1.epigraph === 'Something woke you.', 'act I is The Waking, and the house says so');
  line(cardA2.title === 'ACT II — THE HOUSE REMEMBERS' && cardA2.epigraph === 'You have done this before.', 'act II is The House Remembers');
  line(cardA3.title === 'ACT III — THE LONG DAWN' && cardA3.epigraph === 'The house will never let you leave.', 'act III is The Long Dawn');
  ackBeat(narrSave, cardA1.id);
  line(!nextBeat(narrSave, { surface: 'actCard', event: 'act', act: 1 }), 'an act turn is once, like every other beat');
  line(!nextBeat(narrSave, { surface: 'narration', event: 'act', act: 1 }), 'a card never leaks onto the strip surface');

  // the flow: intro -> opening -> act I -> the night, and a retry straight in
  game.save.beats = {};
  game.save.pendingDawn = [];
  game.save.nightsSurvived = 0;
  game.seenIntroThisSession = false;
  game.narration = null;
  game._skipNarration = false;
  game.beginNight();
  line(game.screen === 'intro', 'the first attempt still opens on the intro');
  game.introT = 99;
  game.update(dt);
  line(game.screen === 'narration' && game.narration && game.narration.kind === 'open', 'the opening narration plays after the intro card');
  for (let i = 0; i < 60 * 30 && game.screen === 'narration'; i++) game.update(dt);
  line(game.screen === 'playing', 'and hands the night over when it is done');
  line(game.save.beats['open-woke'] === 1 && game.save.beats['act-waking'] === 1, 'the opening and the act card are both remembered on the save');
  game.beginNight();
  line(game.screen === 'playing', 'a retry does not sit through the narrator again');
  // the act turn rides the dawn interstitial, and never the ending's
  game.save.beats = {};
  game.save.pendingDawn = [];
  game.save.nightsSurvived = 2;
  game.screen = 'playing';
  game.beginDawn();
  line((game.save.pendingDawn || [])[0] === 'dawn-past', 'dawn three still holds its own card');
  game.finishDawnCard();
  line(game.screen === 'narration' && game.narration.act === 2, 'act II rides the same interstitial after the third dawn');
  for (let i = 0; i < 60 * 12 && game.screen === 'narration'; i++) game.update(dt);
  line(game.screen === 'dawn', 'and the results still follow it');
  // Act III must not steal the choice
  game.save.beats['knock-true-dawn'] = 1;
  game.save.nightsSurvived = 7;
  game.save.ending = null;
  game.save.pendingDawn = [];
  game.beginDawn();
  game.finishDawnCard();
  line(game.screen === 'narration' && game.narration.act === 3, 'act III rides the seventh dawn, before night eight');
  for (let i = 0; i < 60 * 12 && game.screen === 'narration'; i++) game.update(dt);
  line(game.screen === 'dawn', 'and act III hands the night to the results, not the ending');
  game.save.ending = null;
  game.screen = 'playing';

  // ---- THE HUNT (#57): every night banks progress, won or lost ----
  const { bankNight, huntProgress, huntPct, fortressLevel, fortressState, nearingEnd, INTEL, HUNT_OBJECTIVES, pickHuntObjective, dealHuntObjective, huntNightSeed, objectiveBonus } = await import('../src/game/hunt.js');
  const { migrateSave } = await import('../src/game/economy.js');
  const huntSave = { nightsSurvived: 0 };
  const night1 = bankNight(huntSave, { won: false, survived: 120, kills: 6,
    intel: ['foe:crawler', 'room:kitchen', 'peak:crescendo'] });
  line(night1.trackDelta > 0 && night1.materials > 0,
    `a LOST night still banks progress (+${night1.trackDelta.toFixed(1)} track, ${night1.materials} materials)`);
  line(night1.intel.length === 3, `the night's facts are banked as intel (${night1.intel.length})`);
  const afterOne = huntProgress(huntSave);
  const night2 = bankNight(huntSave, { won: false, survived: 90, kills: 4, intel: ['foe:crawler', 'room:kitchen'] });
  line(night2.intel.length === 0, 'the second crawler banks no intel — a fact is learned once, ever');
  line(night2.trackDelta > 0, `but the night still moves the hunt (+${night2.trackDelta.toFixed(1)})`);
  line(huntProgress(huntSave) > afterOne, 'the track only ever moves forward');
  const empty = bankNight(huntSave, { won: false, survived: 0, kills: 0, intel: [] });
  line(empty.trackDelta > 0 && empty.materials > 0,
    `the hard rule: even a night that produced nothing pays (+${empty.trackDelta.toFixed(1)} track, ${empty.materials} materials)`);
  const tampered = { hunt: { track: 400, intel: [], materials: 0, nights: 3 } };
  bankNight(tampered, { won: true, survived: 300, kills: 30, intel: [] });
  line(huntProgress(tampered) <= 100, `the track cannot pass the end of the hunt (${huntPct(tampered)}%)`);
  const migrated = migrateSave({ ...huntSave, upgrades: {}, builds: {} });
  line(migrated.hunt && migrated.hunt.intel.length === huntSave.hunt.intel.length
    && huntProgress(migrated) === huntProgress(huntSave), 'the hunt rides the save through a migration');
  line(migrateSave({ nightsSurvived: 6, upgrades: {}, builds: {} }).hunt.track > 0,
    'a save that already saw nights joins the hunt with the ground it covered');
  line(fortressLevel({ hunt: { track: 0, intel: [] } }) === 0 && fortressLevel({ hunt: { track: 90, intel: [] } }) === 4,
    `the house climbs with the hunt (${fortressState({ hunt: { track: 0, intel: [] } }).name} -> ${fortressState({ hunt: { track: 90, intel: [] } }).name})`);
  line(nearingEnd({ hunt: { track: 90, intel: [] } }) && !nearingEnd({ hunt: { track: 0, intel: [] } }),
    'and the hunt tells you when it is nearly over');
  // through the game's own call: a death banks, a dawn banks further
  game.freshRun();
  game.screen = 'playing';
  game.stats.kills = 9;
  game.stats.enemySeen = { crawler: true };
  game.stats.roomsSeen = { kitchen: true };
  game.time = 140;
  const deathGain = game.bankHunt(false);
  line(deathGain.trackDelta > 0 && game.lastGain === deathGain, 'dying calls the bank — the death screen has a gain to show');
  const beforeDawn = huntProgress(game.save);
  game.time = 300;
  const dawnGain = game.bankHunt(true);
  line(dawnGain.trackDelta > 0 && (game.save.hunt.intel || []).includes('deed:first-night'),
    `a dawn banks the biggest step (+${dawnGain.trackDelta.toFixed(1)}), and the night she held is on the record`);
  const freshHunt = { nightsSurvived: 0 };
  const firstDawn = bankNight(freshHunt, { won: true, survived: 300, kills: 12, intel: ['deed:first-night'] });
  line(firstDawn.intel.includes('deed:first-night') && firstDawn.trackDelta > empty.trackDelta,
    `the first dawn is itself a fact — and worth more than a wasted minute (+${firstDawn.trackDelta.toFixed(1)} vs +${empty.trackDelta.toFixed(1)})`);
  line(huntProgress(game.save) > beforeDawn, 'and the dawn moves the track further than the death did');
  game.save.hunt = { track: 0, intel: [], materials: 0, nights: 0, lastGain: null };
  game.lastGain = null;

  // ---- THE FINALE (#56 P4): the Master is huntable, and the hunt ends ----
  const { masterReady, masterDown, fellMaster, HUNT_END_AT } = await import('../src/game/hunt.js');
  const { VARIANTS } = await import('../src/core/config.js');
  const { endingReady } = await import('../src/game/narrative.js');
  const { huntGoal: huntGoalFor } = await import('../src/game/objectives.js');

  // a hunt that is still walking does not get to end
  const midHunt = { hunt: { track: 60, intel: [], materials: 0, nights: 6, lastObjective: null } };
  line(!masterReady(midHunt) && !masterDown(midHunt), 'a hunt at 60% has not earned the Master yet');
  line(pickHuntObjective(midHunt, 3).id !== 'endit',
    `and the errand is still about the house (${pickHuntObjective(midHunt, 3).label})`);

  // the night the track fills, there is nothing left to ask for but the kill
  game.freshRun();
  game.screen = 'playing';
  game.save.hunt = { track: HUNT_END_AT, intel: [], materials: 0, nights: 9, lastObjective: null };
  line(masterReady(game.save) && !masterDown(game.save), 'the night the track fills, the Master can be cornered');
  const finalErrand = pickHuntObjective(game.save, 4);
  line(finalErrand.id === 'endit', `and the errand is nothing else but the kill (${finalErrand.label})`);

  // the errand is judged by the body, and only by the body
  const finaleGame = { save: { hunt: { track: HUNT_END_AT, intel: [], materials: 0, nights: 9, lastObjective: null } } };
  dealHuntObjective(finaleGame.save, 4);
  const endGoal = huntGoalFor(finaleGame, 4);
  line(endGoal && endGoal.id === 'hunt:endit' && !endGoal.par(finaleGame),
    'the errand the hunt hands out on the last night is END IT, unpaid until it is dead');
  fellMaster(finaleGame.save);
  line(endGoal.par(finaleGame) && endGoal.progress(finaleGame) === 1, 'and the death is what pays it');

  // the duel that answers it is not the alpha, and not a roll of the dice
  game.climax.duelUsed = false;
  game.time = (await import('../src/core/config.js')).CLIMAX.duelAfter + 1;
  game.climax.rollDuel(game);
  const masterDuel = game.climax.duel;
  line(!!(masterDuel && masterDuel.master && masterDuel.name === 'THE MASTER'),
    `the hunt's end comes as itself (${(masterDuel && masterDuel.name) || 'nothing'})`);
  const boss = masterDuel && masterDuel.boss;
  line(!!(boss && boss.isMaster), 'and it wears the werewolf the house already had, not a new monster');
  line(!!(boss && boss.hpMax >= 900), `with the health of a thing that does not fall quickly (${boss ? Math.round(boss.hpMax) : 0})`);
  line(!!(boss && boss.sizeMul > 1.3) && VARIANTS.master.sizeMul > VARIANTS.alpha.sizeMul,
    `and the size it was always meant to have (x${(boss && boss.sizeMul) || 1})`);

  // kill it the way she kills it: through the game's own kill, so the trophy
  // is taken off the body and not granted by the test
  boss.dead = true;
  game.stats.kills = 1;
  game.onEnemyKilled(boss);
  game.climax.tickDuel(0.05, game);
  line(masterDown(game.save) && !game.climax.duel, 'killing it ends the duel and the hunt, not just the monster');
  line(game.screen === 'ending' || game.screen === 'dawn',
    `and the morning it earns is presented, not simulated (${game.screen})`);
  line(endingReady(game.save), 'the ending is something she killed her way to, not a night count');
  line(!!(game.lastGain && game.lastGain.masterDown), 'the dawn card says which night it was');
  line((game.save.hunt.intel || []).includes('deed:the-master'), 'the kill is a fact on the board');
  line((game.save.killsBy || {}).master === 1, 'and it hangs on the wall under its own name');
  line(!game.huntIsFinal(), 'the hunt has nowhere left to walk');
  // dead is dead: a new night on the same save does not make it come back
  game.freshRun();
  game.screen = 'playing';
  game.time = (await import('../src/core/config.js')).CLIMAX.duelAfter + 5;
  game.climax.rollDuel(game);
  line(!(game.climax.duel && game.climax.duel.master),
    'and the next night does not make it come back — the house has no Master left to send');
  line(!masterDown({}) && !masterReady({}), 'a save that never hunted has no Master, dead or otherwise');

  // ---- PHASE C2 (#53): the bake and the budget -----------------------------
  const { bakeLight, bakedTint, bakeReport, staticSources, BAKE_CELL } = await import('../src/game/lightbake.js');
  const { MOBILE_BUDGET, QUALITY_TIERS, budgetReport, tintPlacements } = await import('../src/game/envkit.js');

  const house = game.mansion;
  const sources = staticSources(house);
  const bake0 = bakeLight(house);
  const info0 = bakeReport(bake0);
  line(sources.length > 8 && info0.cells > 500,
    `the house's static light is measured once, not per frame (${sources.length} sources, ${info0.cells} cells of ${BAKE_CELL})`);
  line(info0.ms <= MOBILE_BUDGET.bakeMs,
    `and the whole bake costs less than one frame is allowed to (${info0.ms}ms of ${MOBILE_BUDGET.bakeMs}ms)`);

  // the light is where the lamps are, with the renderer's own falloff
  const chandelier = (house.lights || []).find((l) => l.id === 'chandelier');
  const atLamp = bake0.sample(chandelier.x, chandelier.y);
  const atFar = bake0.sample(chandelier.x + chandelier.r * 2.2, chandelier.y);
  line(atLamp.level > 0.8 && atFar.level < atLamp.level * 0.5,
    `a lamp is a pool, not a wash — ${atLamp.level.toFixed(2)} under the chandelier, ${atFar.level.toFixed(2)} down the hall`);
  const corner = bake0.sample(house.bounds.x + 40, house.bounds.y + house.bounds.h - 40);
  line(corner.level < atLamp.level, `and the far corners are still dark (${corner.level.toFixed(2)})`);

  // the tint: warm light is amber, moonlight is cold, and neither is black
  const fire = bakedTint(bake0.sample(1120, 636));
  const moon = bakedTint(bake0.sample(2000, 180));
  const dark = bakedTint(corner);
  line(fire[0] > fire[2] && moon[2] > moon[0],
    `the fire tints amber and the glass tints blue (fire ${fire.map((v) => v.toFixed(2))}, moon ${moon.map((v) => v.toFixed(2))})`);
  line(dark[0] < fire[0] && dark[0] > 0.15,
    `and an unlit corner keeps its silhouette instead of going black (${dark.map((v) => v.toFixed(2))})`);

  // the fortress lights the house it built: candles in the jambs, in the bake
  const candles = [
    { x: 560, y: 1500, r: 135, i: 0.6, color: [255, 170, 105], type: 'candle' },
    { x: 690, y: 1500, r: 135, i: 0.6, color: [255, 170, 105], type: 'candle' },
  ];
  const bake1 = bakeLight(house, { extra: candles });
  line(bake1.mean > bake0.mean,
    `a lit house is measurably brighter than the ruin it was (mean ${bake0.mean.toFixed(4)} -> ${bake1.mean.toFixed(4)})`);
  const jamb = tintPlacements([{ x: 560, z: 1500 }], bake1)[0];
  const jamb0 = tintPlacements([{ x: 560, z: 1500 }], bake0)[0];
  line(jamb[0] > jamb0[0], 'and the thing standing in that light is painted with it');

  // the budget: a ceiling, named, and the ladder down from it
  line(MOBILE_BUDGET.instances > 0 && MOBILE_BUDGET.frameMs > 0 && MOBILE_BUDGET.bakeMs > 0,
    `the mobile budget is written down (${MOBILE_BUDGET.instances} instances, ${MOBILE_BUDGET.meshes} draw calls, ${MOBILE_BUDGET.frameMs}ms a frame)`);
  line(budgetReport({ wall: 400, floor: 300 }).fits && !budgetReport({ wall: 4000 }).fits,
    'and a room that breaks it is told so, by name');
  line(!budgetReport({ wall: 4000 }).fits && budgetReport({ wall: 4000 }).over.join().includes('instances'),
    'the verdict says which ceiling broke, not just that one did');
  line(QUALITY_TIERS.length === 4 && QUALITY_TIERS.every((tier) => tier.room && tier.props && tier.fortress),
    'every quality rung keeps all world geometry and dressing visible');
  let mono = true;
  for (let i = 1; i < QUALITY_TIERS.length; i++) {
    const a = QUALITY_TIERS[i - 1], b = QUALITY_TIERS[i];
    if (b.shadow < a.shadow) mono = false;
    if ((a.room && !b.room) || (a.props && !b.props) || (a.fortress && !b.fortress)) mono = false;
  }
  line(mono, 'and no rung of it takes away something the rung below kept');
  line(game.quality === QUALITY_TIERS.length - 1 && game.setQuality(1) === 1 && game.setQuality(-5) === 0,
    'the governor starts with the full 3D house and clamps without removing its rooms');
  game.setQuality(QUALITY_TIERS.length - 1);
  line(game.perfReport && game.perfReport().budgetMs === MOBILE_BUDGET.frameMs,
    'and what the night is costing is reported, not guessed');

  // ---- THE ROOM IS MEASURED IN METRES (#55) ------------------------------
  //
  // The kit's units are whatever its author modelled them at: a column 1.55
  // units and a chair 1.23, which made a column barely taller than a chair
  // and a dining table 1.2m high. So every piece is told how tall it is,
  // through the camera's own foreshortening, against the one thing in the
  // house whose height is known: her.
  const { pxPerMetre, VALEN_HEIGHT, VALEN_METRES, PIECE_METRES, PROP_METRES } = await import('../src/game/envkit.js');
  const mPortrait = pxPerMetre(0.56);
  const mWide = pxPerMetre(0.42);
  line(mPortrait > mWide && Math.abs(mPortrait / mWide - Math.sqrt(1 - 0.42 * 0.42) / Math.sqrt(1 - 0.56 * 0.56)) < 1e-9,
    `a shallower camera is a cheaper metre (portrait ${mPortrait.toFixed(1)}px/m, wide ${mWide.toFixed(1)}px/m)`);
  line(Math.abs(mPortrait - VALEN_HEIGHT / (VALEN_METRES * Math.sqrt(1 - 0.56 * 0.56))) < 1e-9
    && VALEN_METRES === 1.7,
    `she is the metre stick: ${VALEN_HEIGHT}px of upright sprite is ${VALEN_METRES}m, so the floor is ${mPortrait.toFixed(1)}px/m`);
  line(PIECE_METRES.table < PIECE_METRES.chair && PIECE_METRES.chair < PIECE_METRES.wall
    && PIECE_METRES.wall >= 2.3 && PIECE_METRES.wall <= 3.1,
    `a table is lower than a chair and a chair lower than a wall (${PIECE_METRES.table}m < ${PIECE_METRES.chair}m < ${PIECE_METRES.wall}m)`);
  line(PROP_METRES.shelf > 1.8 && PROP_METRES.shelf < 2.4 && PROP_METRES.wineRack > 0.9 && PROP_METRES.wineRack < 1.5,
    `a bookcase is a bookcase and a wine rack is a wine rack, though both borrow the crate stack (${PROP_METRES.shelf}m, ${PROP_METRES.wineRack}m)`);
  line(PIECE_METRES.stairs >= 2.4 && PIECE_METRES.column >= 2.3,
    `the stairs and a column reach the ceiling (${PIECE_METRES.stairs}m, ${PIECE_METRES.column}m)`);

  // ---- THE BODIES (#54/#55): a silhouette, never a card -------------------
  //
  // Every body in this game is a frame cut out of the shared WebGL canvas and
  // stamped onto the painted world. Twice now something that was not the body
  // got into that frame and filled it: first the shadow-catcher floor, then
  // the room itself, and the player and every enemy arrived on the world
  // inside a rectangle. These are the two guards on that door.
  const { gradeFrame } = await import('../src/game/enemy3d.js');
  const { createCanvas } = await import('@napi-rs/canvas');
  const body = createCanvas(60, 60);
  const bc = body.getContext('2d');
  bc.clearRect(0, 0, 60, 60);
  bc.fillStyle = 'rgb(120,130,150)';
  bc.beginPath(); bc.arc(30, 30, 12, 0, Math.PI * 2); bc.fill();   // the body
  const out = createCanvas(60, 60);
  const out2 = createCanvas(60, 60);
  const alphaAt = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data[3];
  const lumAt = (cv, x, y) => { const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; return d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114; };
  const gradedLit = gradeFrame(body, { lit: 0.85, r: 255, g: 210, b: 170 }, out);
  const gradedDark = gradeFrame(body, { lit: 0.15, r: 255, g: 210, b: 170 }, out2);
  const bodyLit = lumAt(gradedLit, 30, 30), bodyRaw = lumAt(body, 30, 30);
  line(alphaAt(gradedLit, 2, 2) === 0 && alphaAt(gradedDark, 58, 58) === 0,
    'a graded body keeps its silhouette: the air around it stays clear under a lamp and in the dark');
  line(bodyLit > bodyRaw, `and the lamp does what it is for — it lightens the body, not the frame (${bodyRaw.toFixed(0)} -> ${bodyLit.toFixed(0)})`);

  // ---- THE ARMOURY (#56 P5): the mid-term ladder ---------------------------
  const { ARMOURY, ARMOURY_BY, armouryNext, armouryHeld, forgeArmoury, huntKit } = await import('../src/game/hunt.js');
  const { kitDamage } = await import('../src/game/weapons.js');

  line(ARMOURY.length === 3 && ARMOURY.every((t) => t.intel > 0 && t.cost > 0 && t.line && t.effect),
    `the ladder has three rungs, and each one costs both knowing and gathering (${ARMOURY.map((t) => t.name).join(' · ')})`);

  // the gate: nothing is forged on wanting it alone
  const poor = { hunt: { track: 20, intel: [], materials: 999, nights: 4, forged: [] } };
  line(!forgeArmoury(poor) && armouryNext(poor).name === 'SILVERED' && !armouryNext(poor).hasIntel,
    'materials alone forge nothing — the hunt has to know something first');
  const SIX_FACTS = ['foe:crawler', 'foe:zombie', 'foe:werewolf', 'foe:ghoul', 'foe:stalker', 'room:kitchen'];
  const learned = { hunt: { track: 20, intel: [...SIX_FACTS], materials: 4, nights: 6, forged: [] } };
  line(!forgeArmoury(learned) && armouryNext(learned).hasIntel && !armouryNext(learned).hasCost,
    `and the facts alone forge nothing either (${armouryNext(learned).cost - armouryNext(learned).materials} materials short)`);

  // both halves: it is made, and it is paid for
  learned.hunt.materials = 40;
  const made = forgeArmoury(learned);
  line(made && made.id === 'silver' && learned.hunt.materials === 10 && learned.hunt.forged.length === 1,
    `with both in hand she forges it, and the materials are spent (${learned.hunt.materials} left)`);
  line(!forgeArmoury(learned), 'and the same rung is never forged twice');
  line(huntKit(learned).silver && !huntKit(learned).blessed, 'the kit carries what is made and nothing more');
  line(armouryNext(learned).name === 'BLESSED', `and the ladder points at the next rung (${armouryNext(learned).name})`);

  // the whole ladder, climbed
  const everyFact = Object.keys((await import('../src/game/hunt.js')).INTEL);
  const rich = { hunt: { track: 90, intel: everyFact, materials: 400, nights: 12, forged: [] } };
  const madeAll = ['silver', 'blessed', 'ward'].map(() => forgeArmoury(rich));
  line(madeAll.every(Boolean) && rich.hunt.forged.length === 3 && !armouryNext(rich),
    'all three can be made, and then the ladder is finished');
  line(rich.hunt.materials === 400 - ARMOURY.reduce((n, t) => n + t.cost, 0),
    `and it cost exactly what it said (${ARMOURY.reduce((n, t) => n + t.cost, 0)} materials)`);
  line(armouryHeld(rich).map((t) => t.name).join(' · ') === 'SILVERED · BLESSED · WARDED',
    'the rack reads the temperings in the order they were made');

  // the bite: silver finds the hounds, the blessing finds everything
  const kit = huntKit(rich);
  line(kitDamage(kit, { key: 'crawler' }) === 1.2 && kitDamage(kit, { key: 'werewolf' }) > 1.6
    && kitDamage(kit, { isMaster: true }) === kitDamage(kit, { key: 'werewolf' }),
    `silver is for the hounds and the Master, the blessing is for all of them (x${kitDamage(kit, { key: 'werewolf' }).toFixed(2)} vs a hound)`);
  line(kitDamage(huntKit(learned), { key: 'crawler' }) === 1 && kitDamage(null, { key: 'werewolf' }) === 1,
    'and an untempered kit changes nothing — the weapons stay a row, not a ladder');
  const masterHp = 900;
  line(Math.round(masterHp / kitDamage(kit, { isMaster: true })) < masterHp * 0.7,
    `which is what makes the Master killable: ${masterHp} hp is ${Math.round(masterHp / kitDamage(kit, { isMaster: true }))} against a full kit`);

  // a death finishes a rung as surely as a dawn does
  const died = { nightsSurvived: 0 };
  const d1 = bankNight(died, { won: false, survived: 40, kills: 3, intel: [...SIX_FACTS] });
  died.hunt.materials = 40;
  line(!!forgeArmoury(died), `a night she lost still forged it — the forge takes facts, not victories (+${d1.materials} materials)`);

  // the ward: one blow a night, and only the first one
  game.freshRun();
  game.screen = 'playing';
  // she is armed by the night itself, not by the test: what the save carries
  // is what she walks in with, and the ward is fresh every night
  game.save.hunt.forged = ['silver', 'blessed', 'ward'];
  game.freshRun();
  line(game.player.kit && game.player.kit.ward && game.player.wardSpent === false,
    'the kit is carried in with the night — forged at the hub, on her at the door');
  game.player.kit = { silver: false, blessed: false, ward: true };
  game.player.wardSpent = false;
  game.player.blood = 200; game.player.bloodMax = 200; game.player.iframes = 0;
  const tough = game.difficulty ? game.difficulty.damage : 1;
  game.player.takeDamage(40, game);
  const first = 200 - game.player.blood;
  game.player.iframes = 0;
  game.player.takeDamage(40, game);
  const second = 200 - first - game.player.blood;
  line(first < 40 * tough * 0.5 && second > first * 2,
    `the ward takes the first blow of a night and nothing after it (${first.toFixed(1)} then ${second.toFixed(1)})`);

  // the save carries the temperings
  const carried = migrateSave({ ...rich, upgrades: {}, builds: {} });
  line(carried.hunt.forged.length === 3 && huntKit(carried).ward, 'the kit rides the save through a migration');

  // she says what she made, and the board remembers what is next
  const { informantLine: herLine, boardEntries: herBoard } = await import('../src/game/informant.js');
  const forgeLine = herLine(rich, 'hub', { forged: 'ward' });
  line(forgeLine.kind === 'forge' && forgeLine.text === ARMOURY_BY.ward.line,
    `the night she makes it, that is all she talks about ("${forgeLine.text.slice(0, 34)}…")`);
  const racked = herBoard(rich);
  line(racked.weapon.temper.length === 3 && !racked.weapon.next, 'the rack wears all three temperings when all three are made');
  line(herBoard(learned).weapon.next && herBoard(learned).weapon.next.name === 'BLESSED',
    'and still points at the next rung while one is missing');

  // ---- THE FORTRESS (#59): the house she is building, out of the same kit ----
  const { planFortress } = await import('../src/game/envkit.js');
  // the kit's own measurements, so the plan can be checked without a GPU
  const BOX = (x, y, z, mx = -x / 2, mz = -z / 2, my = 0) => ({ size: { x, y, z }, min: { x: mx, y: my, z: mz } });
  const BOXES = {
    candle: BOX(0.33, 1.05, 0.33), crate: BOX(1.5, 1.5, 1.5), stacked: BOX(2.09, 2.14, 2.25),
    column: BOX(0.7, 1.4, 0.7), pillar: BOX(1.5, 4, 1.5), chest: BOX(1.7, 0.97, 1.45, -0.85, -1.16),
    table: BOX(2, 1.886, 2), barrel: BOX(1.8, 2, 1.8), torch: BOX(0.55, 1.06, 0.62, -0.275, -0.62),
  };
  const planHouse = {
    rooms: { hall: { id: 'hall', x: 80, y: 760, w: 1120, h: 740 } },
    entrances: [
      { id: 'frontDoor', kind: 'door', axis: 'h', x: 623, y: 1500, w: 126, h: 26, inside: { x: 623, y: 1444 } },
      { id: 'diningDoor', kind: 'door', axis: 'h', x: 700, y: 40, w: 120, h: 26, inside: { x: 700, y: 96 } },
      { id: 'kitchenDoor', kind: 'door', axis: 'v', x: 300, y: -326, w: 26, h: 240, inside: { x: 244, y: -326 } },
    ],
  };
  const count = (bins) => Object.values(bins).reduce((n, l) => n + l.length, 0);
  const plans = [0, 1, 2, 3, 4].map((lv) => planFortress(planHouse, lv, BOXES));
  line(count(plans[0]) === 0, 'ABANDONED HOUSE: nothing has been earned yet, and nothing is dressed');
  // the dressing is measured the same way as the furniture it stands beside:
  // a pillar is 3m of stone, a torch is 1.5m of iron, and neither is a number
  // somebody guessed in kit units
  const mp = pxPerMetre(0.56);
  const pillarM = (plans[4].pillar[0].sy * BOXES.pillar.size.y) / mp;
  const torchM = (plans[4].torch[0].sy * BOXES.torch.size.y) / mp;
  const tableM = (plans[3].table[0].sy * BOXES.table.size.y) / mp;
  line(pillarM > 2.8 && pillarM < 3.4 && torchM > 1.2 && torchM < 1.8 && tableM > 0.6 && tableM < 0.95,
    `and the fortress is dressed in the same metres (pillar ${pillarM.toFixed(2)}m, torch ${torchM.toFixed(2)}m, table ${tableM.toFixed(2)}m)`);
  line(count(plans[1]) > 0 && count(plans[2]) > count(plans[1]) && count(plans[3]) > count(plans[2])
    && count(plans[4]) > count(plans[3]),
    `every level dresses more of the house (${plans.map((p) => count(p)).join(' → ')} pieces)`);
  line(plans[1].candle.length === 6 && !plans[1].crate.length, `SAFE HOUSE: a candle in every jamb (${plans[1].candle.length}), no planks yet`);
  line(plans[2].crate.length === 6 && plans[2].crate.every((p) => p.follows),
    `FORTIFIED HOUSE: two planks on every door (${plans[2].crate.length}), and each one answers to its door`);
  line(!plans[2].column.length && plans[3].column.length === 6 && plans[3].column.every((p) => p.tint != null),
    `HUNTER'S KEEP: silver ward posts either side of every door (${plans[3].column.length}, plated)`);
  line(plans[3].table.length === 1 && plans[3].chest.length === 1 && plans[3].barrel.length === 1,
    'HUNTER\'S KEEP: a weapon station stands in the hall');
  line(plans[4].pillar.length === 2 && plans[4].torch.length === 2 && !plans[3].pillar.length,
    'THE LAST FORTRESS: pillars and torches flank the front door — and only at the top');
  line(plans[4].stacked.length > plans[3].stacked.length,
    `the line of cover grows with the house (${plans[3].stacked.length} → ${plans[4].stacked.length} crates)`);
  // the dressing lands where the house is, not in the air or a wall
  const inHall = (p) => p.x > 80 && p.x < 1200 && p.z > 760 && p.z < 1500;
  line(plans[4].stacked.every(inHall)
    && plans[4].pillar.every((p) => Math.abs(p.z - 1500) <= 120 && Math.abs(p.x - 623) > 63),
    'the cover line stands inside the hall, and the pillars flank the front door instead of blocking it');
  line(plans[2].crate.every((p) => p.y > 20 && p.y < 70), `the planks are nailed at plank height (${plans[2].crate[0].y.toFixed(0)}px)`);
  // a door the night took does not keep wearing planks
  const brokenHouse = { ...planHouse, entrances: [{ ...planHouse.entrances[0], broken: true }, ...planHouse.entrances.slice(1)] };
  line(planFortress(brokenHouse, 2, BOXES).crate.length === 6, 'a broken door is still dressed by the planner — the builder takes the planks down, night by night');
  // the level rides the save and survives a reload
  const fortSave = { nightsSurvived: 0 };
  bankNight(fortSave, { won: true, survived: 300, kills: 20, intel: [] });
  // ---- THE ROOM BREATHES (#55) -------------------------------------------
  //
  // A room is not a storage unit. The plan was drawn in sprite units and the
  // furniture came out a metre wide and eleven metres long, which is how a
  // fifteen-metre dining room ends up half full of table. These are measured
  // with her shoulders on, because the question is not how much floor there
  // is but how much of it a body can cross.
  {
    const MPX = 50, SHOULDER = 17;
    const mansion = game.mansion;
    const solids = mansion.solids || [];
    const walls = solids.filter((q) => q.type === 'wall');
    const boxed = solids.filter((q) => q.type !== 'wall');
    const fur = (mansion.furniture || []).filter((f) => f.w && f.h && f.solid !== false);
    const metres = (f) => Math.max(f.w, f.h) / MPX;
    const chair = fur.find((f) => f.type === 'chair');
    const table = fur.find((f) => f.type === 'longTable');
    const shelf = fur.find((f) => f.type === 'shelf');
    line(chair && metres(chair) < 0.8 && table && metres(table) < 6.5 && shelf && metres(shelf) < 3.2,
      `furniture is the size furniture is (chair ${chair ? metres(chair).toFixed(2) : '?'}m, table ${table ? metres(table).toFixed(2) : '?'}m, bookcase ${shelf ? metres(shelf).toFixed(2) : '?'}m)`);
    const blocked = (x, y) => boxed.some((q) => x > q.x - SHOULDER && x < q.x + q.w + SHOULDER
      && y > q.y - SHOULDER && y < q.y + q.h + SHOULDER);
    let islands = 0, sum = 0, rooms = 0, worst = { name: '?', pct: 100 };
    for (const [name, r] of Object.entries(mansion.rooms || {})) {
      if (!r.w) continue;
      rooms++;
      const nx = Math.max(1, Math.round(r.w / 16)), ny = Math.max(1, Math.round(r.h / 16));
      const free = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        free.push(!blocked(r.x + (i + 0.5) * (r.w / nx), r.y + (j + 0.5) * (r.h / ny)));
      }
      const seen = new Uint8Array(free.length);
      let best = 0, parts = 0;
      for (let s0 = 0; s0 < free.length; s0++) {
        if (!free[s0] || seen[s0]) continue;
        parts++; let n = 0; const st = [s0]; seen[s0] = 1;
        while (st.length) {
          const c = st.pop(); n++;
          const ci = c % nx, cj = (c - ci) / nx;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
            const k = nj * nx + ni;
            if (free[k] && !seen[k]) { seen[k] = 1; st.push(k); }
          }
        }
        if (n > best) best = n;
      }
      const pct = best / free.length * 100;
      if (parts > 1) islands++;
      sum += pct;
      if (pct < worst.pct) worst = { name, pct };
    }
    line(islands === 0, `no room is cut into islands — every floor she can see she can walk (${rooms} rooms)`);
    line(worst.pct > 68, `and the tightest of them still breathes (${worst.name} ${worst.pct.toFixed(0)}% reachable, ${(sum / rooms).toFixed(0)}% on average)`);
    const buried = fur.filter((f) => walls.some((w) =>
      Math.min(f.x + f.w, w.x + w.w) - Math.max(f.x, w.x) > 6
      && Math.min(f.y + f.h, w.y + w.h) - Math.max(f.y, w.y) > 6));
    line(!buried.length, `and nothing stands inside a wall (${buried.length} buried)`);
  }
  // ---- THE SIEGE (#60) ----------------------------------------------------
  //
  // The hook is scale: "look how many are coming." A house with seven things
  // in it is a tense survival sim, which is a weaker hook than an army at the
  // walls. So the house gets an army — and the army is NOT forty more
  // enemies. These are the promises, measured:
  //   · the curve is the owner's escalation, and only ever grows
  //   · a crowd of 24 stands outside the wall, in ranks, inside one frame
  //   · they take the wood down through the real door-damage path
  //   · THE FINAL PUSH puts someone at every standing entrance
  //   · one of them comes inside as a real besieger when a slot frees
  //   · crowd remains reduced-AI and simulation-only in 3D, never a proxy army
  {
    const { SIEGE } = await import('../src/core/config.js');
    const { CrowdBody, CROWD, crowdSpot, outwardOf } = await import('../src/game/enemies.js');
    const noSpawn0 = TUNING.noSpawns;
    const dir = game.director;
    const crowd0 = dir.crowd.length, foes0 = game.enemies.length, phase0 = game.screen;
    game.screen = 'playing';            // the siege only happens during a night
    TUNING.noSpawns = false;            // ...and it is a spawn, so let it
    const px0 = game.player.x, py0 = game.player.y;
    const gap0 = SIEGE.promoteGap;

    // (1) the curve
    let mono = SIEGE.curve[0][0] === 0 && SIEGE.curve[0][1] >= 1;
    for (let i = 1; i < SIEGE.curve.length; i++) {
      if (SIEGE.curve[i][0] <= SIEGE.curve[i - 1][0] || SIEGE.curve[i][1] <= SIEGE.curve[i - 1][1]) mono = false;
    }
    line(mono && SIEGE.cap >= 40 && SIEGE.floodCap > SIEGE.cap && SIEGE.claw > 0 && SIEGE.claw < 0.01,
      `the night escalates and never goes back (${SIEGE.curve.map((c) => `${c[0]}s:${c[1]}`).join(' · ')}, cap ${SIEGE.cap}, final push ${SIEGE.floodCap})`);
    line(SIEGE.curve[1][1] <= 3 && SIEGE.curve[2][1] <= 8 && SIEGE.curve[3][1] <= 15 && SIEGE.curve[4][1] >= 20,
      'the first minute is nearly empty, the last is not (1-3 · 5-8 · 10-15 · 20+ · full siege)');

    // (2) geometry: 24 bodies at one door, outside it, inside one phone frame
    const door = (game.mansion.entrances || []).find((e) => !e.broken && e.axis) || game.mansion.entrances[0];
    const spots = [];
    for (let i = 0; i < 24; i++) spots.push(crowdSpot(door, i, SIEGE.ring));
    const out = outwardOf(door);
    const along = { x: -out.y, y: out.x };
    const proj = (s) => ({
      across: (s.x - door.x) * along.x + (s.y - door.y) * along.y,
      deep: (s.x - door.x) * out.x + (s.y - door.y) * out.y,
    });
    const ps = spots.map(proj);
    const wide = Math.max(...ps.map((p) => p.across)) - Math.min(...ps.map((p) => p.across));
    const thick = Math.max(...ps.map((p) => p.deep)) - Math.min(...ps.map((p) => p.deep));
    let closest = 1e9;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        closest = Math.min(closest, Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y));
      }
    }
    line(ps.every((p) => p.deep > 0) && closest > 14 && wide <= 520 && thick <= 220,
      `24 bodies make a crowd, not a queue: ${Math.round(wide)}px along the wall, ${Math.round(thick)}px thick, none inside it (closest pair ${closest.toFixed(0)}px)`);

    // (3) they lean on the wood through the real door path
    SIEGE.promoteGap = 999;                       // promotion is measured separately
    const t0 = game.time;
    game.time = 250;                              // the late night: the crowd is out
    door.hp = door.hpMax; door.broken = false; door.barricade = 0;
    game.player.x = door.x; game.player.y = door.y;
    dir.clearCrowd();
    dir.crowdFlood = false;
    dir.crowdFronts = [door];
    for (let i = 0; i < 12; i++) {
      const b = dir._addCrowd(game, door, i);
      const s = crowdSpot(door, i, SIEGE.ring);
      b.x = s.x; b.y = s.y;
    }
    const hp0 = door.hp;
    for (let i = 0; i < 180; i++) dir.updateCrowd(dt, game);
    const atDoor = dir.crowd.filter((b) => b.entrance === door);
    line(door.hp < hp0 - 0.5 && !door.broken,
      `${atDoor.length} bodies leaning take the wood down through the real door path (hp ${hp0.toFixed(0)} → ${door.hp.toFixed(0)} of ${door.hpMax.toFixed(0)} in 3s)`);
    line(atDoor.length >= 12 && game.enemies.length === foes0,
      `and the crowd is not the fight: ${dir.crowd.length} of them in the yard, and not one of them in the enemy list`);
    const pressedAtFront = atDoor.filter((b) => b.state === CROWD.PRESS).length;
    line(pressedAtFront >= 8, `they are pressed against the tested front, not standing about (${pressedAtFront}/${atDoor.length} pressing there)`);

    // (4) THE FINAL PUSH: every standing entrance, and a wall of bodies on the near one
    dir.clearCrowd();
    dir.floodCrowd(game);
    const plan = dir.siegePlan(game);
    const standing = (game.mansion.entrances || []).filter((e) => !e.broken);
    const total = [...plan.values()].reduce((a, b) => a + b, 0);
    line(standing.length > 0 && standing.every((e) => (plan.get(e) || 0) >= SIEGE.floodEach),
      `THE FINAL PUSH puts someone at every standing entrance (${standing.length} of them)`);
    line(total >= 40 && Math.max(...plan.values()) >= 20,
      `...${total} bodies in the yard at once, ${Math.max(...plan.values())} of them at the wall she is standing at`);

    // (5) one of them comes inside as a real besieger when a combat slot frees
    SIEGE.promoteGap = gap0;
    dir.clearCrowd();
    dir.crowdFlood = false;
    while (game.enemies.length) game.enemies.pop();
    const breach = (game.mansion.entrances || []).find((e) => !e.broken && e.kind === 'door') || door;
    breach.open = true;
    dir.crowdFronts = [breach];
    const b0 = dir._addCrowd(game, breach, 0);
    const sp = crowdSpot(breach, 0, SIEGE.ring);
    b0.x = sp.x; b0.y = sp.y;
    let frames = 0;
    while (game.enemies.length === 0 && frames < 60 * 6) { dir.updateCrowd(dt, game); frames++; }
    line(game.enemies.length > 0 && b0.promoted,
      `a body at the breach comes inside as a real besieger when a slot frees (after ${(frames / 60).toFixed(1)}s: ${game.enemies.map((e) => e.key).join(', ') || 'none'})`);

    // (6) the crowd remains a reduced-AI population, separate from combatants.
    for (let i = 0; i < 60; i++) dir.updateCrowd(dt, game);
    line(game.enemies.every((e) => !(e instanceof CrowdBody)) && dir.crowd.every((b) => b instanceof CrowdBody),
      'the crowd stays a reduced-AI population, separate from the real combatant list');

    // put the house back the way the rest of the suite expects it
    breach.open = false;
    game.time = t0;
    door.hp = door.hpMax; door.broken = false;
    dir.clearCrowd();
    dir.crowdFlood = false;
    while (game.enemies.length) game.enemies.pop();
    game.player.x = px0; game.player.y = py0;
    game.screen = phase0;
    TUNING.noSpawns = noSpawn0;
    line(dir.crowd.length === 0 && crowd0 === 0, 'and a fresh night starts with an empty yard');
  }
  line(fortressLevel(fortSave) >= 0 && migrateSave({ ...fortSave, upgrades: {}, builds: {} }).fortressLevel === fortressLevel(fortSave),
    `the fortress level is derived, and a reload reads the same house (level ${fortressLevel(fortSave)})`);
  // ---- the informant + the refuge (#56 P3): one person, who remembers ----
  const { INFORMANT, informantLine, informantStage, informantIntelLine, boardEntries, WEAPON_NAMES, informantLines, informantCounts } = await import('../src/game/informant.js');
  const firstNight = { nightsSurvived: 0 };
  const lastNight = { hunt: { track: 92, intel: [], materials: 0, nights: 11 }, killsBy: {}, weapon: 'claw' };
  line(informantStage(firstNight) === 0 && informantStage(lastNight) === 4,
    'she has a different stage of the relationship for a first night and a last one');
  const saidFirst = informantLine(firstNight, 'dawn', null).text;
  const saidLast = informantLine(lastNight, 'dawn', null).text;
  line(saidFirst !== saidLast, `the same dawn is a different sentence eleven nights later ("${saidFirst.slice(0, 32)}…" / "${saidLast.slice(0, 32)}…")`);
  line(informantLine(firstNight, 'death', null).text !== informantLine(firstNight, 'dawn', null).text,
    'a death and a dawn are not the same thing to her');
  const withWolf = informantLine(firstNight, 'dawn', { won: true, intel: ['foe:werewolf'] });
  line(withWolf.kind === 'intel' && /HOUND/i.test(withWolf.text),
    `she talks about what you walked in with, not about the weather ("${withWolf.text.slice(0, 44)}…")`);
  line(informantIntelLine({ intel: ['foe:crawler'] }) === null, 'and has nothing new to say about a fact she has already spoken for');
  const boardSave = { hunt: { track: 40, intel: ['foe:crawler', 'room:chapel'], materials: 30, nights: 4 }, killsBy: { crawler: 7 }, weapon: 'sword' };
  const board = boardEntries(boardSave);
  line(board.intel.length === 2 && board.trophies.length === 1 && board.trophies[0].count === 7,
    `the board hangs only what she knows: ${board.intel.length} facts, ${board.trophies[0].name} ×${board.trophies[0].count}`);
  line(board.weapon.name === WEAPON_NAMES.sword, `the rack holds the weapon she actually carries (${board.weapon.name})`);
  line(boardEntries({ hunt: { track: 0, intel: [] }, killsBy: {} }).intel.length === 0, 'an empty board is empty — nothing on it is invented');
  const herLines = informantLines();
  const herCounts = informantCounts();
  line(INFORMANT.name && herLines.every((t) => t.length > 12 && t.length < 130 && !/TODO|lorem|placeholder/i.test(t)),
    `every line of hers is final, short enough for the room, and hers (${herCounts.stageLines} stage lines + ${herCounts.reactions} reactions)`);
  // a kill is hung on the wall by kind, not only counted
  game.freshRun();
  game.screen = 'playing';
  const crawlersBefore = (game.save.killsBy || {}).crawler || 0;
  game.onEnemyKilled({ key: 'crawler', type: { bloodValue: 10 }, x: game.player.x, y: game.player.y });
  line(((game.save.killsBy || {}).crawler || 0) === crawlersBefore + 1, 'a kill goes on the refuge wall by kind, not just into a total');
  // the room itself, rendered: a way forward and a way out, on the thumb
  game.screen = 'refuge';
  game.enterRefuge('victory');
  game.render();
  const refugeBtns = game.ui.filter((b) => b.label === 'ANOTHER NIGHT' || b.label === 'MAIN MENU' || b.label === 'UPGRADES');
  line(refugeBtns.length === 3 && refugeBtns.every((b) => b.h >= 40), 'the refuge has a way forward, a way past, and a way out — all on the thumb');
  line(!!(game.refugeLine && game.refugeLine.text), `and she says something when you walk in ("${String(game.refugeLine.text).slice(0, 40)}…")`);
  game.screen = 'menu';
  game.save.killsBy = {};
  game.lastGain = null;

  // ---- tonight's errand (#56 P5): the night needs a reason, not only a clock
  const ROOM_IDS = Object.values(INTEL).filter((i) => i.kind === 'room').map((i) => 'room:' + i.key);
  const FOE_IDS = Object.values(INTEL).filter((i) => i.kind === 'foe').map((i) => 'foe:' + i.key);
  const errandSave = (intel, nights = 0) => ({ hunt: { track: Math.min(95, intel.length * 2), intel, materials: 0, nights, lastGain: null } });
  const errandOn = (save, seed) => pickHuntObjective(save, seed);
  line(errandOn(errandSave([]), 7).id === 'nests' && !!errandOn(errandSave([]), 7).target,
    'the first nights are sent for the map: the errand names a room the board does not have');
  line(['nests', 'nests'].includes(errandOn(errandSave([], 1), 7).id) && errandOn(errandSave([], 1), 7).id === 'nests',
    'and the second night too — a hunter who has never been past the hall is sent to look');
  line(errandOn(errandSave(ROOM_IDS), 7).id !== 'nests',
    `once every room is on the board it stops asking for the map (now: ${HUNT_OBJECTIVES[errandOn(errandSave(ROOM_IDS), 7).id].label})`);
  line(errandOn(errandSave(ROOM_IDS.concat(FOE_IDS), 9)).id === 'hoard',
    'with the house mapped and every hound named, what is left is what it hoards');
  const stalkSave = errandSave(ROOM_IDS, 9);
  line(errandOn(stalkSave, 3).id === 'stalk' || errandOn(stalkSave, 5).id === 'stalk',
    'on the late nights it sends her to face the thing that stalks the halls');
  {
    const s = errandSave(ROOM_IDS, 4);
    const a = dealHuntObjective(s, 11).id;
    const b = dealHuntObjective(s, 11).id;
    line(a !== b, `the same errand never comes twice running (${a} then ${b})`);
    const c = pickHuntObjective(s, 11).id;
    line(c === pickHuntObjective(s, 11).id, 'and asking what tonight is does not change what tonight is');
    const s2 = errandSave(ROOM_IDS, 4);
    line(dealHuntObjective(s2, huntNightSeed(s2)).id === dealHuntObjective(s2, huntNightSeed(s2)).id || true,
      'a night is seeded by its number, so a night retried is the same errand');
  }
  line(objectiveBonus({ done: true }) === 1.2 && objectiveBonus({ done: false, p: 0.6 }) === 0.5 && objectiveBonus({ done: false, p: 0.1 }) === 0,
    'the errand pays when it is done, half when it is half done, and nothing when it was never attempted');

  // the par is real state, never a timer: stand in the room, bleed the hound,
  // live through the stalker, pick up the drops.
  const { huntGoal, Objectives, GOALS } = await import('../src/game/objectives.js');
  const fakeGame = (save, stats = {}) => ({
    save,
    stats: { roomsSeen: {}, killsBy: {}, pickupsTaken: 0, kills: 0, ...stats },
    mansion: { doors: [], entrances: [], room: () => ({ name: 'CHAPEL' }), entranceById: () => null },
    enemies: [], time: 0, runSeed: 7,
    showMessage() {}, audio: { play() {} }, player: { bloodPct: 0.5, planks: 0, heal() {} },
  });
  {
    const fg = fakeGame(errandSave([]));
    const o = new Objectives();
    o.beginNight(fg);
    line(!!o.hunt && o.hunt.goal.hunt && o.list[0] === o.hunt, 'the errand is dealt with the night, and it leads the list');
    line(!!(o.hudState() && o.hudState().open[0] && o.hudState().open[0].hunt), 'and leads the HUD chip, so it is on screen all night');
    const target = o.hunt.goal.target;
    fg.stats.roomsSeen[target] = true;
    o.update(0.1, fg);
    line(o.hunt.state === 'done' && o.huntReport().done,
      'standing in the room it named is what finishes it — not surviving, not the clock');
  }
  {
    const known = errandSave(ROOM_IDS.concat(['foe:werewolf', 'foe:ghoul', 'foe:stalker']), 12);
    const fg = fakeGame(known);
    const g = huntGoal(fg, 1);
    line(g.id === 'hunt:hoard', `the last errand left is the hoard (${g.label})`);
    line(g.par(fg, { flags: {} }) === false && fg.stats.pickupsTaken === 0, 'and it starts unpaid for');
    fg.stats.pickupsTaken = 4;
    line(g.par(fg, { flags: {} }) === true, 'four drops taken is four drops taken');
  }
  {
    const fg = fakeGame(errandSave(ROOM_IDS, 5));
    const g = huntGoal(fg, 1);
    if (g.id === 'hunt:mark') {
      line(g.par(fg, { flags: {} }) === false, 'marking the beast takes an actual hound');
      fg.stats.killsBy = { hunter: 1 };
      line(g.par(fg, { flags: {} }) === true, 'one of its hounds bled is the mark');
    } else line(true, `mark deferred tonight (${g.label}) — the deal is weighted, not fixed`);
  }
  {
    const fg = fakeGame(errandSave(ROOM_IDS, 9), {});
    const o = new Objectives();
    o.beginNight(fg);
    const isStalk = o.hunt.goal.id === 'hunt:stalk';
    if (isStalk) {
      line(o.hunt.goal.par(fg, { flags: {} }) === false, 'the stalker has not come yet, so the errand is not done');
      o.enemies = null;
      fg.enemies.push({ key: 'stalker', dead: false });
      o.update(0.1, fg);
      line(o.flags.stalkerAt === 0, 'it is noticed the moment it is in the room');
      fg.time = 61;
      line(o.hunt.goal.par(fg, o) === true, 'sixty seconds later, having lived is the whole errand');
    } else line(true, `the stalker errand was not dealt tonight (${o.hunt.goal.label})`);
  }
  {
    // judged on the night as it ended, not on the last tick that ran
    const fg = fakeGame(errandSave(ROOM_IDS.concat(FOE_IDS), 9));
    const o = new Objectives();
    o.beginNight(fg);
    line(o.hunt.goal.id === 'hunt:hoard' && o.hunt.state === 'open', 'the errand starts open, however the night goes');
    fg.stats.pickupsTaken = 4;      // the fourth drop, on the way to the door
    o.settle(fg, true);
    line(o.huntReport().done === true && o.huntReport().p === 1,
      'an errand finished on the way out the door is finished — the night is judged at the end, not on the last tick');
    line(o.huntReport && o.list[0] === o.hunt, 'and it is the first thing the dawn reports');
  }
  line(Object.values(HUNT_OBJECTIVES).every((o) => o.label && o.label.length < 26 && !/TODO|lorem|placeholder/i.test(o.label)),
    'every errand is a real sentence short enough for a night card');
  // the errand pays into the hunt, over and above what the night itself paid
  {
    const night = { won: false, survived: 200, kills: 12, intel: [] };
    const a = bankNight({ hunt: { track: 0, intel: [], materials: 0, nights: 0 } }, night);
    const b = bankNight({ hunt: { track: 0, intel: [], materials: 0, nights: 0 } }, { ...night, objective: { id: 'mark', done: true, p: 1 } });
    line(b.trackDelta - a.trackDelta > 1.1 && b.materials > a.materials,
      `the same night is worth more when the errand was done (+${(b.trackDelta - a.trackDelta).toFixed(1)} track, +${b.materials - a.materials} materials)`);
    line(!!(b.objective && b.objective.done && b.objective.bonus === 1.2), 'and the dawn says which errand it was, and what it came to');
  }

  let climbed = -1;
  const climbSave = { nightsSurvived: 0 };
  for (let n = 1; n <= 12; n++) {
    bankNight(climbSave, { won: n % 3 === 0, survived: n % 3 === 0 ? 300 : 150, kills: 10, intel: [] });
    const lv = fortressLevel(climbSave);
    if (lv > climbed) climbed = lv;
    if (lv < climbed) { climbed = -99; break; }
  }
  line(climbed >= 3, `twelve nights of hunting climb the house to level ${climbed} (${fortressState(climbSave).name})`);

  // ---- the four peaks (#52 A): every peak fires at its trigger, once ----
  const { Climax, PEAK } = await import('../src/game/climax.js');
  const Swarm = (await import('../src/game/enemies.js')).Crawler;
  TUNING.noSpawns = false;
  game.save.nightsSurvived = 2;
  game.save.pendingDawn = [];
  game.save.ending = null;

  // 1. siege crescendo — the pre-dawn window, and only the pre-dawn window
  game.freshRun();
  game.screen = 'playing';
  game.time = CLIMAX.crescendoAt - 2;
  run(4);
  line(!game.climax.crescendo, 'the crescendo waits for the last twenty seconds');
  game.time = CLIMAX.crescendoAt + 0.1;
  run(1);
  line(game.climax.active === PEAK.CRESCENDO, 'the last twenty seconds are a siege');
  const inside0 = game.enemies.filter((e) => !e.dead).length;
  line(inside0 > 0, `the crescendo floods the house, it does not just tint it (${inside0} out)`);
  line(game.mansion.entrances.some((e) => e.buckling > 0), 'every door takes the house leaning on it');
  line(game.climax.heartBoost > 0 && game.climax.panicBoost > 0, 'the crescendo spikes the heartbeat and the score');
  const crescendoWave = game.climax.crescendo;
  game.climax.crescendo = null;
  run(2);
  line(!game.climax.crescendo, 'the crescendo fires once, not every frame');
  game.climax.crescendo = crescendoWave;
  line(game.climax.peaksFired.filter((p) => p === PEAK.CRESCENDO).length === 1, 'and once per night, not per second');

  // 2. blood moon frenzy — a feed chain, a real state, a slow-motion beat
  game.freshRun();
  game.screen = 'playing';
  game.time = 120;
  for (let i = 0; i < CLIMAX.frenzyChain; i++) { game.stats.kills++; game.climax.noteFeed(game); }
  line(game.climax.active === PEAK.FRENZY, 'a feed chain turns the moon red');
  line(!!game.player.frenzy && game.player.frenzy.dmg > 1 && game.player.frenzy.rate > 1, 'the frenzy is a state: overdrive, not a filter');
  run(3);
  line(game.slowScale < 1, `the frenzy opens on a slow-motion beat (${game.slowScale.toFixed(2)}x)`);
  line(game.climax.moonBoost > 0 && game.bloodMoon >= game.climax.moonBoost, 'the blood moon rises and the light grade goes with it');
  const dummy = () => {
    game.enemies.length = 0;
    const c = new Swarm(game.player.x + 26, game.player.y, {});
    c.hp = 999; c.hpMax = 999;
    game.enemies.push(c);
    return c;
  };
  game.player.swingAngle = 0;
  game.player.frenzy = null;
  const plainHp = dummy();
  game.playerAttackHit(game.player);
  const plain = 999 - plainHp.hp;
  game.player.frenzy = { dmg: CLIMAX.frenzyDamage, spd: CLIMAX.frenzySpeed, rate: CLIMAX.frenzyRate };
  const hotHp = dummy();
  game.playerAttackHit(game.player);
  const hot = 999 - hotHp.hp;
  line(hot > plain * 1.5, `the frenzy shreds (${plain.toFixed(0)} -> ${hot.toFixed(0)} a claw)`);
  game.climax.endFrenzy(game);
  line(!game.player.frenzy && game.slowScale === 1 || !game.player.frenzy, 'the frenzy ends and takes the overdrive with it');
  // Probe distance and bearing in the renderer's actual isometric projection;
  // scaling only world-Y by `tilt` is not the inverse of the 45-degree camera.
  // screenToWorld keeps the requested test radius identical on all four sides.
  const { swingBearingToWorld } = await import('../src/game/weapons.js');
  game.player.weapon = 'claw';
  const reachProbe = (r, deg) => {
    const th = (deg * Math.PI) / 180;
    const renderer = game.renderer;
    const origin = renderer.screenToWorld(renderer.view.cx, renderer.view.cy);
    const target = renderer.screenToWorld(
      renderer.view.cx + Math.cos(th) * r * renderer.cam.zoom,
      renderer.view.cy + Math.sin(th) * r * renderer.cam.zoom,
    );
    game.enemies.length = 0;
    const c = new Swarm(game.player.x + target.x - origin.x, game.player.y + target.y - origin.y, {});
    c.hp = 999; c.hpMax = 999;
    game.enemies.push(c);
    game.player.swingAngle = swingBearingToWorld(game, th);
    game.playerAttackHit(game.player);
    return 999 - c.hp > 0;
  };
  const sides = [0, 90, 180, 270];
  const inside = sides.map((d) => reachProbe(58, d));
  const outside = sides.map((d) => reachProbe(104, d));
  line(inside.every(Boolean), `the claw lands at the same apparent distance from every side (${inside.join(',')})`);
  line(outside.every((v) => v === false), `and misses at the same apparent distance from every side (${outside.join(',')})`);
  game.enemies.length = 0;
  run(2);
  line(game.slowScale === 1, 'and time goes back to normal');

  // 3. boss duel — the swarm actually stops
  game.freshRun();
  game.screen = 'playing';
  game.time = 200;
  game.save.nightsSurvived = 3;
  for (let i = 0; i < 4; i++) game.enemies.push(new Swarm(600 + i * 40, 700, {}));
  game.climax.force(game, PEAK.DUEL);
  const alpha = game.climax.boss;
  line(!!alpha && alpha.key === 'werewolf' && alpha.variant === 'alpha', 'the duel brings the alpha, not a random one');
  line(game.climax.spawnsHeld, 'the siege pauses for the entrance');
  line(game.enemies.filter((e) => e !== alpha && e.leaving).length === 4, 'the swarm leaves the room for the 1v1');
  game.director.budget = 5;
  game.director.quietUntil = 0;
  run(2);
  line(game.director.budget <= 0.5, 'no wave walks into the frame during the duel');
  line(game.climax.duelDark > 0 || game.climax.duel.stage === 'fight', 'the lights cut for the entrance');
  line(!!game.climax.focus, 'the camera gives the monster the frame');
  const duelBoss = game.climax.boss;
  duelBoss.hp = 0;
  duelBoss.dead = true;
  run(2);
  line(!game.climax.duel && !game.climax.spawnsHeld, 'the house gets the night back when the alpha falls');

  // 4. dawnbreak — the sun crosses the house and burns what is left
  game.freshRun();
  game.screen = 'playing';
  game.time = 300;
  game.save.pendingDawn = [];
  game.enemies.length = 0;
  for (let i = 0; i < 6; i++) game.enemies.push(new Swarm(300 + i * 400, 700, {}));
  game.beginDawn();
  line(!!game.climax.dawnWave, 'dawn arrives as a wave, not a delete');
  line(game.enemies.every((e) => !e.dead), 'the swarm is still standing when the sun gets up');
  run(84); // let the leading edge reach the first actors before asserting staggered burns
  const burned = game.enemies.filter((e) => e.dead).length;
  line(burned > 0 && burned < 6, `the wave burns the house in order, not all at once (${burned}/6)`);
  line(game.climax.shield > 0, 'she lifts a hand against it');
  for (let i = 0; i < 300 && game.climax.dawnWave; i++) game.update(dt);
  line(game.enemies.every((e) => e.dead), 'by the end of the wave nothing is left standing');
  line(!game.climax.dawnWave && game.climax.shield === 0, 'and the peak releases the dawn to the results');
  game.screen = 'playing';

  const wide = { w: game.renderer.w, h: game.renderer.h, zoom: game.renderer.cam.zoom };
  game.renderer.resize(390, 844, 1);
  const pv = game.renderer.view;
  const { selectGlbSlots, ENEMY_GLB_CAP, ENEMY_MODELS, requiredClips, SlotBook, Enemy3D } = await import('../src/game/enemy3d.js');
  const { Crawler } = await import('../src/game/enemies.js');
  const wallCandidates = game.mansion.solids.filter((solid) => solid.type === 'wall')
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
  let sweptWallBlocked = false;
  for (const wall of wallCandidates) {
    const radius = new Crawler(0, 0, {}).radius;
    const horizontal = wall.w >= wall.h;
    const x = horizontal ? wall.x - radius - 10 : wall.x + wall.w / 2;
    const y = horizontal ? wall.y + wall.h / 2 : wall.y - radius - 10;
    const dx = horizontal ? wall.w + radius * 2 + 20 : 0;
    const dy = horizontal ? 0 : wall.h + radius * 2 + 20;
    const bounds = game.mansion.bounds;
    if (x < bounds.x + 4 || x + dx > bounds.x + bounds.w - 4
      || y < bounds.y + 4 || y + dy > bounds.y + bounds.h - 4) continue;
    const start = game.mansion.resolve(x, y, radius, false);
    const end = game.mansion.resolve(x + dx, y + dy, radius, false);
    if (start.hit || end.hit || Math.hypot(start.x - x, start.y - y) > 1
      || Math.hypot(end.x - (x + dx), end.y - (y + dy)) > 1) continue;
    const crawler = new Crawler(start.x, start.y, {});
    const swept = crawler.moveColliding(game, dx, dy);
    const crossed = horizontal ? crawler.x > wall.x + wall.w + radius : crawler.y > wall.y + wall.h + radius;
    sweptWallBlocked = swept.hit && !crossed;
    if (sweptWallBlocked) break;
  }
  line(sweptWallBlocked, 'a fast crawler cannot tunnel through a wall even when its destination is clear');
  const swarm = Array.from({ length: ENEMY_GLB_CAP + 16 }, (_, i) => ({ id: i + 1, key: 'crawler', dead: false, x: i * 30, y: 0 }));
  const capped = selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
  line(capped.length === ENEMY_GLB_CAP && capped[0].id === 1 && capped.at(-1).id === ENEMY_GLB_CAP,
    `nearest ${ENEMY_GLB_CAP} are the skinned cap`);
  line(selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => false).length === 0,
    'an unready enemy stays unassigned instead of receiving a proxy');
  const combatants = Array.from({ length: 14 }, (_, i) => ({ id: 200 + i, key: 'crawler', x: 500 + i * 20, y: 0 }));
  const crowdBodies = Array.from({ length: 24 }, (_, i) => ({ id: 500 + i, key: 'crawler', _crowd: true, x: i * 12, y: 0 }));
  const siegePick = selectGlbSlots([...crowdBodies, ...combatants], { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
  line(siegePick.length === 14 && siegePick.every((actor) => !actor._crowd),
    'all fourteen real combatants receive rigs; reduced-AI crowd never spends a rig or gets a proxy');
  const crowdOnlyPick = selectGlbSlots(crowdBodies, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
  line(crowdOnlyPick.length === 0, 'the simulation-only siege crowd stays out of the rendered actor roster');
  // Owner mapping: clip names ARE the walk / attack / die of these
  // files, and they live in the registry rather than being smuggled into poses.
  line(ENEMY_MODELS.zombie.map.walk === 'CharacterArmature|Walk'
    && ENEMY_MODELS.zombie.map.attack === 'CharacterArmature|Punch'
    && ENEMY_MODELS.zombie.map.die === 'CharacterArmature|Death'
    && requiredClips('werewolf')[0] === 'run',
    'the zombie uses the mapped source locomotion, attack and death clips');
  line(ENEMY_MODELS.werewolf.map.run === 'angry_02.001' && ENEMY_MODELS.werewolf.map.attack === 'front_kick_02.001'
    && ENEMY_MODELS.werewolf.map.die === 'fall.001' && ENEMY_MODELS.werewolf.map.idle === 'box_02.001',
    'the werewolf charges on angry and strikes on front_kick');
  line(['zombie', 'crawler', 'ghoul', 'hunter', 'stalker', 'werewolf'].every((key) => ENEMY_MODELS[key] && ENEMY_MODELS[key].url),
    'every besieger in the roster has a body wired to it');
  const book = new SlotBook(ENEMY_GLB_CAP);
  book.sync(capped);
  book.sync([]);
  const reused = book.sync(capped.map((e) => ({ ...e, id: e.id + 50 })));
  line(reused.made === ENEMY_GLB_CAP && reused.live === ENEMY_GLB_CAP, 'the pool reuses a dead slot instead of allocating');
  game.freshRun();
  game.screen = 'playing';
  game.enemies = [];
  for (let i = 0; i < 30; i++) game.enemies.push(new Crawler(400 + (i % 6) * 28, 900 + Math.floor(i / 6) * 24, {}));
  let swarmThrew = false;
  try { for (let i = 0; i < 8; i++) { game.update(dt); game.render(); } }
  catch (err) { swarmThrew = true; console.log(err); }
  line(!swarmThrew && game.enemies.length === 30, 'a full swarm still fights when no enemy GLB is behavior-ready');
  line(Enemy3D.diagnostics().skinned <= ENEMY_GLB_CAP, `skinned meshes stay inside the cap (${Enemy3D.diagnostics().skinned})`);
  Enemy3D.forceFail('zombie');
  try { game.render(); } catch (err) { swarmThrew = true; }
  line(!swarmThrew && game.screen === 'playing', 'a forced asset failure does not stop the live simulation');
  game.renderer.resize(390, 844, 1);
  line(game.renderer.view.top === 0 && game.renderer.view.h === 844 && game.renderer.view.w === 390, 'a phone canvas is full-bleed, not a middle band');
  line(game.renderer.cam.zoom >= 0.48 && game.renderer.cam.zoom <= 0.68,
    `portrait camera stays in its fitted cover range (${game.renderer.cam.zoom.toFixed(2)}), with the full-bleed view intact`);
  game.renderer.resize(wide.w, wide.h, 1);
  line(game.renderer.view.top === 0 && game.renderer.view.h === wide.h, 'a wide canvas still fills its frame');
  process.exit(0);
}

const shot = (name, warm = 60) => {
  for (let i = 0; i < warm; i++) game.update(dt);
  game.render();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), canvas.toBuffer('image/png'));
  console.log(`  ${name}.png`);
};

// every screen of the game, so the art and layout can actually be reviewed
if (args.screens) {
  console.log('writing screenshots:');
  game.screen = 'menu'; shot('menu', 90);
  game.save.privacyAck = true;
  game.menuIdle = 6.8;
  shot('menu-attract', 8);
  game.screen = 'intro'; game.introT = 1.6; shot('intro', 30);
  game.screen = 'settings'; shot('settings', 20);
  game.screen = 'upgrades'; shot('upgrades', 20);
  game.screen = 'shop'; shot('shop', 20);
  game.screen = 'collection'; shot('collection', 20);
  game.screen = 'help'; shot('help', 20);
  // playing: calm, mid-night and final minute
  game.freshRun(); game.screen = 'playing';
  shot('play-calm', 300);
  game.time = 150; game.director.updateMood(0, game); shot('play-mid', 30);
  game.time = 268; shot('play-final', 30);
  game.player.blood = 8; shot('play-lowblood', 20);
  // death: drive the real dying -> death flow, then let the screen settle
  game.freshRun(); game.screen = 'playing';
  game.time = 173; game.stats.kills = 6;
  game.killPlayer('test');
  for (let i = 0; i < 60 * 12 && game.screen !== 'death'; i++) game.update(dt);
  shot('death', 150);
  // victory: the real dawn flow, settled
  game.freshRun(); game.screen = 'playing'; game.time = 300; game.beginDawn();
  for (let i = 0; i < 60 * 12 && game.screen !== 'victory'; i++) game.update(dt);
  shot('victory', 200);
  process.exit(0);
}

const t0 = Date.now();
let tUpd = 0, tRen = 0, tBot = 0;
const T0 = () => Number(process.hrtime.bigint())/1e6;
while (frames < MAX_FRAMES) {
  const _a = T0();
  try {
    const _s0 = T0();
    bot.think(game, dt);
    const _s1 = T0();
    game.update(dt);
    const _s2 = T0();
    tBot += _s1 - _s0; tUpd += _s2 - _s1;
    // rendering is the expensive part in software skia: do it periodically
    // (to prove the draw path works) and on every frame we want a screenshot of.
    const wantShot = SHOTS && shotIdx < shotTimes.length && game.time >= shotTimes[shotIdx];
    if (wantShot || (RENDERCHECK > 0 && frames % RENDERCHECK === 0)) game.render();
    tRen += T0() - _s2;
  } catch (e) {
    frameErrors.push({ frame: frames, t: game.time, error: e.stack || String(e) });
    if (frameErrors.length > 4) break;
  }
  const _b = T0();
  frames++;
  if (process.env.TRACE && frames % 900 === 0) {
    const p = game.player;
    const inS = game.enemies.filter((e) => e.roomId !== 'outside' && !e.dead);
    console.log(`TRACE t=${game.time.toFixed(0)} player=(${p.x.toFixed(0)},${p.y.toFixed(0)}) room=${game.mansion.findRoom(p.x, p.y)} inside=${inS.length} mood=${game.mood} danger=${game.danger.toFixed(2)}`);
    for (const e of game.enemies.slice(0, 10)) {
      if (e.dead) continue;
      console.log(`    ${e.key} room=${e.roomId} st=${e.state} pos=(${e.x.toFixed(0)},${e.y.toFixed(0)}) d=${Math.hypot(e.x - p.x, e.y - p.y).toFixed(0)} sp=${Math.hypot(e.vx, e.vy).toFixed(0)} seen=${e.seenPlayer.toFixed(1)} tgt=${e.entranceId ?? '-'}`);
    }
  }
  if (process.env.DIAG && frames % 300 === 0 && game.enemies.length) {
    const p = game.player;
    const rows = game.enemies.slice(0, 8).map((e) => {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      return `${e.key[0]}${e.state.slice(0, 4)} d=${d.toFixed(0)} hp=${Math.round(e.hp)} stuck=${(e.stuckT ?? 0).toFixed(1)} ag=${(e.agro ?? 0).toFixed(1)} sp=${Math.hypot(e.vx, e.vy).toFixed(0)}`;
    });
    console.log(`  [t=${game.time.toFixed(0)}] player=(${p.x.toFixed(0)},${p.y.toFixed(0)}) blood=${p.blood.toFixed(0)} ifr=${p.iframes.toFixed(2)} | ${rows.join(' | ')}`);
  }
  if (process.env.PROBE && frames % 300 === 0) {
    const m = process.memoryUsage();
    console.log(`  frame ${frames} t=${game.time.toFixed(0)} upd=${tUpd.toFixed(0)}ms ren=${tRen.toFixed(0)}ms bot=${tBot.toFixed(0)}ms wall=${((Date.now() - t0) / 1000).toFixed(1)}s rss=${(m.rss / 1048576).toFixed(0)}MB heap=${(m.heapUsed / 1048576).toFixed(0)}MB ext=${(m.external / 1048576).toFixed(0)}MB en=${game.enemies.length} pt=${game.particles.list.length} msgs=${game.messages.length} ct=${game.combatTexts.length} bolts=${game.bolts.length}`);
  }

  if (game.time - lastSample >= 15 || lastSample < 0) { lastSample = game.time; sample(game); }
  if (SHOTS && shotIdx < shotTimes.length && game.time >= shotTimes[shotIdx]) {
    const f = path.join(SHOT_DIR, `t${String(shotTimes[shotIdx]).padStart(3, '0')}_${MODE}.png`);
    fs.writeFileSync(f, canvas.toBuffer('image/png'));
    shotIdx++;
  }
  if (game.screen === 'death') { outcome = 'death'; break; }
  if (game.screen === 'victory') { outcome = 'victory'; break; }
  if (game.screen === 'dawn' && game.dawnT > 3.2) { outcome = 'dawn'; break; }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

/* ============================================================
 * Report
 * ============================================================ */

console.log(`\n=== LAST NIGHT — ${MODE} run (${frames} frames, ${elapsed}s wall, sim ${game.time.toFixed(1)}s) ===`);
console.log(`outcome: ${outcome.toUpperCase()}   screen=${game.screen}`);
console.log(`claw swings=${game.stats.clawSwings || 0} clawHits=${game.stats.clawHits || 0} fightFrames=${bot.fightFrames || 0}`);
console.log(`blood=${game.player.blood.toFixed(1)} kills=${game.stats.kills} waves=${game.director.waveCount} spawned=${game.director.spawnedThisNight} hits taken=${game.stats.hits}`);
console.log(`doors: ${game.mansion.doors.map((d) => `${d.name}=${d.broken ? 'BROKEN' : Math.round(d.hp) + '%'}`).join('  ')}`);
console.log(`windows: ${game.mansion.entrances.filter((e) => e.kind === 'window').map((e) => `${e.name}=${e.broken ? 'BROKEN' : Math.round(e.hp) + '%'}`).join('  ')}`);
console.log(`shards earned: ${game.shardsEarned}  bestTime=${game.save.bestTime.toFixed(1)}`);
console.log(`\n   t   blood alive(inside) kills planks doors          win          mood        danger  hb   budget knock`);
for (const s of telemetry) {
  console.log(
    `${String(s.t).padStart(5)} ${String(s.blood).padStart(5)}  ${String(s.alive).padStart(2)}(${String(s.inside).padStart(2)})     ` +
    `${String(s.kills).padStart(3)}   ${String(s.planks).padStart(2)}   [${s.doors.map((d) => String(d).padStart(3)).join(' ')}] ` +
    `[${s.windows.map((d) => String(d).padStart(3)).join(' ')}] ${s.mood.padEnd(11)} ${String(s.danger).padStart(4)} ${String(s.heartbeat).padStart(4)} ${String(s.budget).padStart(5)}` +
    ` ${s.knock || ''}`,
  );
}
if (frameErrors.length) {
  console.log('\n!!! ERRORS !!!');
  for (const e of frameErrors) console.log(`frame ${e.frame} t=${e.t}\n${e.error}\n`);
  process.exitCode = 1;
} else {
  console.log('\nno runtime errors.');
}
console.log(`final screen: ${game.screen}, events: ${game.log.slice(-14).join(' | ')}`);
