#!/usr/bin/env node
/* DUSKHOLD — headless survival balance probe.
 *
 * Plays the real SurvivalMode (Night 1 → Night 3) with three deterministic
 * bots and prints what happened each night:
 *   idle     no input at all; Hunter only auto-shoots; skips building
 *   active   defends (positions in the firelight, uses Flare), never builds
 *   builder  active defence + spends every day on the builder queue
 *   passive-builder  builds every day but never moves or uses Flare
 *   flare    never moves, never builds, taps Flare on clusters
 *   fire-builder  active defence, but only ever upgrades the Perapian
 *
 *   node tools/survival-balance.mjs [--seeds=3] [--duration=72] [--bots=idle,active,builder] [--json=out.json] [--economy]
 *   bots: idle, active, flare, builder, passive-builder, fire-builder, hunter-builder
 *
 * --economy prints every day decision with the purse before/after.
 * Diagnostics (print and exit): --debug (6 s snapshots of enemy states/doors),
 * --layout (rooms + entrances), --navprobe (hearth flow-field distances per
 * door/room), --cellprobe=x,y (nav cells/solids around a point),
 * --walkprobe=x,y (one breached Swarm body walking to the hearth).
 *
 * This is a measurement tool, not a gate: the balance target (idle should not
 * reliably win three nights, an engaged player should) is reported, and the
 * harness keeps the hard assertions.
 */

import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const SEEDS = Math.max(1, parseInt(args.seeds || '3', 10));
const DURATION = parseInt(args.duration || '72', 10);
const BOTS = String(args.bots || 'idle,active,builder').split(',');

/* ---------------- minimal browser shims (same contract as harness) -------- */
class StubParam { constructor(v = 0) { this.value = v; } setValueAtTime() { return this; } linearRampToValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } setTargetAtTime() { return this; } cancelScheduledValues() { return this; } setValueCurveAtTime() { return this; } }
class StubNode { constructor() { this.gain = new StubParam(1); this.frequency = new StubParam(440); this.Q = new StubParam(1); this.detune = new StubParam(0); this.playbackRate = new StubParam(1); this.pan = new StubParam(0); this.offset = new StubParam(0); } connect() { return this; } disconnect() { return this; } start() { return this; } stop() { return this; } }
class StubAudioContext {
  constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = new StubNode(); this.listener = {}; }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
  createGain() { return new StubNode(); } createOscillator() { return Object.assign(new StubNode(), { type: 'sine' }); }
  createBiquadFilter() { return Object.assign(new StubNode(), { type: 'lowpass' }); } createStereoPanner() { return new StubNode(); }
  createConvolver() { return Object.assign(new StubNode(), { buffer: null }); }
  createDynamicsCompressor() { return Object.assign(new StubNode(), { threshold: new StubParam(), knee: new StubParam(), ratio: new StubParam(), attack: new StubParam(), release: new StubParam() }); }
  createWaveShaper() { return Object.assign(new StubNode(), { curve: null, oversample: 'none' }); }
  createBufferSource() { return Object.assign(new StubNode(), { buffer: null, loop: false }); }
  createBuffer(ch, len, rate) { const data = []; for (let i = 0; i < ch; i++) data.push(new Float32Array(len)); return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: (i) => data[i] }; }
}
const stubDoc = {
  hidden: false,
  createElement(tag) { if (tag === 'canvas') return createCanvas(64, 64); return { style: {}, classList: { add() { }, remove() { } }, appendChild() { }, remove() { }, addEventListener() { } }; },
  getElementById() { return null; }, addEventListener() { }, body: { appendChild() { }, style: {} },
  documentElement: { requestFullscreen() { } }, fullscreenElement: null, exitFullscreen() { },
};
const win = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, addEventListener() { }, removeEventListener() { },
  AudioContext: StubAudioContext, requestAnimationFrame() { return 0; },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
};
globalThis.window = win;
globalThis.document = stubDoc;
globalThis.localStorage = win.localStorage;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-balance' }, configurable: true }); } catch (_) { /* ignore */ }
globalThis.addEventListener = () => { };
globalThis.requestAnimationFrame = () => 0;

let seedState = 1;
const reseed = (n) => { seedState = (n >>> 0) || 1; };
Math.random = function () {
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { Game } = await import('../src/game/game.js');
const { ROOM } = await import('../src/game/mansion.js');
const { ISO_CAMERA } = await import('../src/core/util.js');

function makeCanvas() {
  const canvas = createCanvas(390, 844);
  canvas.addEventListener = () => { };
  canvas.removeEventListener = () => { };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
  canvas.clientWidth = 390; canvas.clientHeight = 844; canvas.style = {};
  return canvas;
}

const { botNight, botDay, releaseControls } = await import('./survival-bots.mjs');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const release = releaseControls;

function debugDump(game) {
  const mode = game.survival;
  const rows = {};
  const live = game.enemies.filter((e) => e._survivalType && !e.dead);
  for (const e of live) {
    const key = `${e._survivalType}:${e.roomId === ROOM.OUTSIDE ? 'out' : e.roomId}:${e.state}`;
    rows[key] = (rows[key] || 0) + 1;
  }
  const doors = game.mansion.entrances.filter((e) => e.exterior && e.kind === 'door').map((e) => `${e.id}:${e.broken ? 'X' : Math.round(e.hp)}`).join(' ');
  const sample = live.filter((e) => e.roomId !== ROOM.OUTSIDE).slice(0, 4).map((e) => {
    const d = mode.flowDir('hearth', e.x, e.y);
    return `(${Math.round(e.x)},${Math.round(e.y)} v${Math.round(Math.hypot(e.vx, e.vy))} dir${d ? d.x.toFixed(2) + ',' + d.y.toFixed(2) : 'null'})`;
  }).join(' ');
  console.log(`  t=${mode.elapsed.toFixed(1)} oil=${mode.oil.toFixed(1)} ${doors}\n    ${JSON.stringify(rows)}\n    ${sample}`);
}

/** --economy: print every day decision with the purse before and after. */
function traceEconomy(mode, kind, seed) {
  const purse = () => `oil=${Math.floor(mode.oil)} wood=${Math.floor(mode.wood)} surv=${mode.survivors}`;
  const wrap = (name, label) => {
    const orig = mode[name].bind(mode);
    mode[name] = (...a) => {
      const before = purse();
      const ok = orig(...a);
      if (ok) console.log(`  [${kind} s${seed}] D${mode.day} ${label(...a)}  ${before} -> ${purse()}`);
      return ok;
    };
  };
  wrap('startBuild', (type, room) => `build ${type}${room ? '@' + room : ''}`);
  if (mode.startUpgrade) wrap('startUpgrade', (room) => `upgrade @${room}`);
  if (mode.startHunterUpgrade) wrap('startHunterUpgrade', () => 'upgrade hunter');
  wrap('startNight', () => 'START NIGHT');
}

function runOne(kind, seed) {
  reseed(seed);
  win.localStorage._d = {};
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  game.input.touchSeen = true;
  game.input.layout(390, 844);
  const mode = game.survival;
  mode.restart();
  if (args.economy) traceEconomy(mode, kind, seed);
  const nights = [];
  const step = 1 / 60;
  let guard = 0;
  let night = null;
  const state = { flareHeld: false };
  const t0 = performance.now();
  while (guard++ < 60 * 60 * 30) {
    if (mode.phase === 'night' && !game.uiPanel) {
      if (!night) night = { day: mode.day, spawned: 0, peakAlive: 0, peakFeeders: 0, minHp: game.player.bloodMax, hpMax: game.player.bloodMax, hunter: mode.hunterLevel || 1, seen: new Set() };
      if (kind === 'active' || kind === 'builder' || kind === 'fire-builder' || kind === 'hunter-builder') botNight(game, state, { ROOM, ISO_CAMERA });
      else if (kind === 'flare') {
        // stands still, only taps Flare when three or more are in reach
        release(game);
        if (mode.skillCooldown <= 0 && mode.enemiesNear(game.player.x, game.player.y, mode.tuning.skillRadius * 0.9) >= 3) {
          game.input.keys.interact = !state.flareHeld; state.flareHeld = !state.flareHeld;
        } else state.flareHeld = false;
      } else release(game);
      game.update(step);
      for (const e of game.enemies) if (e._survivalType && !night.seen.has(e)) { night.seen.add(e); night.spawned++; }
      night.peakAlive = Math.max(night.peakAlive, mode.aliveEnemies());
      night.peakFeeders = Math.max(night.peakFeeders, mode.hearthFeeders);
      night.minHp = Math.min(night.minHp, Math.round(game.player.blood));
      night.kills = mode.nightStats.kills;
      night.drained = Math.round(mode.nightStats.drained || 0);
      night.oil = Math.round(mode.oil * 10) / 10;
      night.elapsed = Math.round(mode.elapsed * 10) / 10;
      night.breaches = game.mansion.entrances.filter((e) => e.exterior && e.kind === 'door' && e.broken).length;
      if (args.debug && Math.floor(mode.elapsed / 6) !== state.lastDump) { state.lastDump = Math.floor(mode.elapsed / 6); debugDump(game); }
      if (args.oiltrace && mode.elapsed < 9 && Math.floor(mode.elapsed) !== state.lastOil) {
        state.lastOil = Math.floor(mode.elapsed);
        console.log(`  N${mode.day} t=${mode.elapsed.toFixed(2)} oil=${mode.oil.toFixed(2)} feeders=${mode.hearthFeeders} drained=${(mode.nightStats.drained || 0).toFixed(1)}`);
      }
      continue;
    }
    if (night) {
      night.result = mode.phase === 'failed' ? `FAIL:${mode.failureReason}` : 'OK';
      delete night.seen;
      nights.push(night);
      night = null;
      release(game);
    }
    if (mode.phase === 'day') {
      botDay(game, kind === 'builder' || kind === 'passive-builder' ? 'builder' : kind === 'fire-builder' ? 'fire' : kind === 'hunter-builder' ? 'hunter' : 'idle');
      game.update(step);
      continue;
    }
    break;
  }
  return {
    kind, seed, complete: mode.phase === 'complete', phase: mode.phase,
    failure: mode.phase === 'failed' ? mode.failureReason : null,
    perapian: mode.perapianLevel, hunter: mode.hunterLevel || 1,
    buildings: { ...mode.buildings }, buildingLevels: { ...(mode.buildingLevels || {}) }, gate: mode.gateBuilt,
    nights, ms: Math.round(performance.now() - t0),
  };
}

if (args.walkprobe) {
  reseed(1);
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  const mode = game.survival;
  const m = game.mansion;
  const { SurvivalCrowdZombie } = await import('../src/game/survival.js');
  const door = m.entranceById('frontDoor');
  door.broken = true; door.open = true; m.refreshNavAround(door);
  mode._fields.clear();
  const [px, py] = String(args.walkprobe).split(',').map(Number);
  const body = new SurvivalCrowdZombie(px, py, door, 0, 1);
  game.enemies.length = 0;
  game.enemies.push(body);
  game.player.x = -3000; game.player.y = -3000;
  for (let i = 0; i < 60 * 30; i++) {
    body.update(1 / 60, game);
    if (i % 30 === 0) {
      const d = mode.flowDir('hearth', body.x, body.y);
      console.log((i / 60).toFixed(1), Math.round(body.x), Math.round(body.y), m.findRoom(body.x, body.y), body.state, 'v', Math.round(Math.hypot(body.vx, body.vy)), 'dir', d ? d.x.toFixed(2) + ',' + d.y.toFixed(2) : null, 'lit', mode.isLit(body.x, body.y));
    }
  }
  process.exit(0);
}

if (args.layout) {
  reseed(1);
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  const m = game.mansion;
  for (const r of m.roomList) console.log('room', r.id.padEnd(13), Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.level || '');
  for (const e of m.entrances) console.log('ent ', e.id.padEnd(14), e.kind.padEnd(6), Math.round(e.x), Math.round(e.y), e.w, e.h, 'ext', !!e.exterior, 'in', e.inside && Math.round(e.inside.x) + ',' + Math.round(e.inside.y), 'out', e.outside && Math.round(e.outside.x) + ',' + Math.round(e.outside.y));
  console.log('bounds', JSON.stringify(m.bounds), 'nav', m.navX0, m.navY0, m.navW, m.navH);
  process.exit(0);
}

if (args.cellprobe) {
  reseed(1);
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  const mode = game.survival;
  const m = game.mansion;
  for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door' && ['frontDoor', 'cellarDoor', 'chapelDoor'].includes(d.id))) {
    e.broken = true; e.open = true; m.refreshNavAround(e);
  }
  mode._fields.clear();
  const f = mode._field('hearth');
  const [px, py] = String(args.cellprobe).split(',').map(Number);
  const gx0 = Math.floor((px - m.navX0) / m.navCell), gy0 = Math.floor((py - m.navY0) / m.navCell);
  console.log('room at point', m.findRoom(px, py));
  for (let gy = gy0 - 4; gy <= gy0 + 4; gy++) {
    let row = '';
    for (let gx = gx0 - 6; gx <= gx0 + 6; gx++) {
      const i = gy * m.navW + gx;
      const v = m.nav[i] ? '###' : String(f.dist[i]).padStart(3);
      row += (gx === gx0 && gy === gy0 ? '[' : ' ') + v + (gx === gx0 && gy === gy0 ? ']' : ' ');
    }
    console.log(String(m.navY0 + gy * m.navCell).padStart(6), row);
  }
  const solids = m.querySolids(px, py, 70).map((s2) => `${s2.type || '?'}(${Math.round(s2.x)},${Math.round(s2.y)} ${Math.round(s2.w)}x${Math.round(s2.h)})`);
  console.log('solids near', solids.join(' '));
  const bars = m.barriers().filter((e) => Math.abs(e.x - px) < 160 && Math.abs(e.y - py) < 160).map((e) => `${e.id}(${e.kind} ${Math.round(e.x)},${Math.round(e.y)} ${e.w}x${e.h} ext${!!e.exterior})`);
  console.log('barriers near', bars.join(' '));
  process.exit(0);
}

if (args.navprobe) {
  reseed(1);
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  const mode = game.survival;
  const m = game.mansion;
  const fire = mode.hearth();
  const field = mode._field('hearth');
  const cellD = (x, y) => {
    const gx = Math.floor((x - m.navX0) / m.navCell), gy = Math.floor((y - m.navY0) / m.navCell);
    if (gx < 0 || gy < 0 || gx >= m.navW || gy >= m.navH) return 'off';
    return field.dist[gy * m.navW + gx];
  };
  const goal = m.navNearest(fire.x, fire.y + 70, 6);
  console.log('fire', fire.x, fire.y, 'goal cell', goal, 'center', m.navX0 + (goal.gx + 0.5) * m.navCell, m.navY0 + (goal.gy + 0.5) * m.navCell);
  for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door')) {
    e.broken = true; e.open = true; m.refreshNavAround(e);
  }
  mode._fields.clear();
  const f2 = mode._field('hearth');
  for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door')) {
    const ins = e.inside || e, out = e.outside || e;
    const gx = Math.floor((ins.x - m.navX0) / m.navCell), gy = Math.floor((ins.y - m.navY0) / m.navCell);
    const ox = Math.floor((out.x - m.navX0) / m.navCell), oy = Math.floor((out.y - m.navY0) / m.navCell);
    console.log(e.id, 'inside', Math.round(ins.x), Math.round(ins.y), 'd', f2.dist[gy * m.navW + gx], 'outside d', f2.dist[oy * m.navW + ox], 'room', m.findRoom(ins.x, ins.y));
  }
  for (const r of m.roomList) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const near = m.navNearest(cx, cy, 6);
    console.log('room', r.id.padEnd(14), 'centerD', near ? f2.dist[near.gy * m.navW + near.gx] : 'none');
  }
  process.exit(0);
}

const results = [];
for (const kind of BOTS) {
  for (let i = 0; i < SEEDS; i++) {
    const r = runOne(kind, 20261012 + i * 7919);
    results.push(r);
    const line = r.nights.map((n) => `N${n.day}:${n.result === 'OK' ? 'ok' : 'FAIL'} H${n.hunter} sp${n.spawned} pk${n.peakAlive} k${n.kills} feed${n.peakFeeders} drain${n.drained} oil${n.oil} hp${n.minHp}/${n.hpMax} br${n.breaches}${n.result === 'OK' ? '' : ' @' + n.elapsed + 's ' + n.result.slice(5)}`).join(' | ');
    const levels = Object.entries(r.buildings).map(([roomId, type]) => `${type}${r.buildingLevels[roomId] || 1}`).join(',') || '-';
    console.log(`${kind.padEnd(8)} seed${i} ${r.complete ? 'WIN ' : 'LOSS'} Lv${r.perapian} H${r.hunter} [${levels}${r.gate ? ',gate' : ''}] ${line} (${r.ms}ms)`);
  }
}
const summary = {};
for (const kind of BOTS) {
  const rows = results.filter((r) => r.kind === kind);
  summary[kind] = { wins: rows.filter((r) => r.complete).length, runs: rows.length };
}
console.log('SUMMARY', JSON.stringify(summary));
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify({ duration: DURATION, summary, results }, null, 2));
