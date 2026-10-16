#!/usr/bin/env node
/* DUSKHOLD — survival UX probe ("play it as a gamer", docs/UX-REPLAY-RESEARCH.md).
 *
 * Plays the real SurvivalMode (Night 1 → Night 3) with the shared bots from
 * tools/survival-bots.mjs and measures what a player FEELS rather than whether
 * the run is won:
 *   first       night clock (s) when the Hunter first has something to shoot
 *   target%     share of the night with a target in reach
 *   longestQuiet  longest stretch (s) with nothing to shoot
 *   deadTail    seconds between the night's last kill and dawn (waiting on the clock)
 *   bins        kills per twelfth of the night (pacing)
 *   options     affordable actions at the start of a day (choice breadth)
 *   human≈      a day in human time: walk between circles at run speed (the bots
 *               buy in place) + build wait + 2 s per decision + START NIGHT
 *
 *   node tools/survival-uxprobe.mjs [--kinds=builder,tower,active,idle]
 *        [--seedlist=20261012,20268931,20276850,20261013,20261014] [--duration=72] [--json=out.json]
 *
 * A measurement tool, not a gate: it prints, it does not assert. Cinematics
 * are off (the node default), so Night 1 starts at clock 0 here; in the
 * browser the opening hands over at 4 % of the night.
 */

import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const DURATION = parseInt(args.duration || '72', 10);

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
const { PLAYER } = await import('../src/core/config.js');

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

/* ---------------- measurement ---------------- */
const RUN_SPEED = PLAYER.runSpeed;   // the stick at full tilt
const release = releaseControls;
function pathLen(game, a, b) {
  const pts = game.mansion.navPath(a.x, a.y, b.x, b.y) || [];
  let len = 0, prev = a;
  for (const p of pts) { len += dist(prev, p); prev = p; }
  len += dist(prev, b);
  return len;
}
function dayOptions(mode) {
  let n = 0; const kinds = [];
  for (const pt of mode.dayPoints()) {
    let cost = null;
    if (pt.kind === 'keep') cost = mode.keepUpgradeCost();
    else if (pt.kind === 'armory') cost = mode.hunterUpgradeCost();
    else if (pt.kind === 'gate') cost = mode.gateBuilt ? null : mode.tuning.gateCost;
    else if (pt.kind === 'slot' && !pt.locked) cost = pt.built ? mode.upgradeCost(pt.id) : mode.buildingCost(pt.type);
    if (cost && mode.canAfford(cost)) { n++; kinds.push(pt.kind === 'slot' ? (pt.built ? 'up:' + pt.built : pt.type) : pt.kind); }
  }
  return { n, kinds: [...new Set(kinds)] };
}
function runGamer(kind, seed) {
  reseed(seed);
  win.localStorage._d = {};
  const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: DURATION });
  game.input.touchSeen = true;
  game.input.layout(390, 844);
  const mode = game.survival;
  mode.restart();
  const step = 1 / 60;
  const state = { flareHeld: false, rescue: true };
  const nights = []; const days = [];
  let night = null, day = null, guard = 0;
  // wrap the build calls to log where the human would have to walk
  const origStart = mode.startBuild.bind(mode);
  mode.startBuild = (type, slotId) => {
    const ok = origStart(type, slotId);
    if (ok && day) {
      const pts = mode.dayPoints();
      const id = type === 'keep' || type === 'repair' ? 'keep' : type === 'hunter' ? 'armory' : type === 'gate' ? 'gate' : slotId;
      const pt = pts.find((p) => p.id === id) || pts[0];
      const walk = pathLen(game, day.at, pt) / RUN_SPEED;
      const job = mode.builderJob ? mode.builderJob.duration : 0;
      day.buys.push({ type: type === 'upgrade' ? 'up:' + (mode.buildings[slotId] || '?') : type, walk: +walk.toFixed(1), job });
      day.at = { x: pt.x, y: pt.y };
    }
    return ok;
  };
  while (guard++ < 60 * 60 * 30) {
    if (mode.phase === 'night' && !game.uiPanel) {
      if (!night) night = { day: mode.day, frames: 0, targetFrames: 0, firstTarget: null, quiet: 0, longestQuiet: 0, lastKillAt: 0, kills: 0, bins: new Array(12).fill(0), keepMin: 1, flares: 0, hurtMin: 1 };
      if (kind !== 'idle') botNight(game, state, { ROOM, ISO_CAMERA }); else release(game);
      const before = mode.nightStats.kills;
      game.update(step);
      if (mode.phase !== 'night') continue;
      night.frames++;
      const has = !!mode.currentTarget;
      if (has) { night.targetFrames++; if (night.firstTarget == null) night.firstTarget = +mode.elapsed.toFixed(1); night.quiet = 0; }
      else { night.quiet += step; night.longestQuiet = Math.max(night.longestQuiet, night.quiet); }
      const k = mode.nightStats.kills;
      if (k > before) { night.lastKillAt = mode.elapsed; night.bins[Math.min(11, Math.floor(mode.elapsed / (DURATION / 12)))] += k - before; }
      night.kills = k;
      night.keepMin = Math.min(night.keepMin, mode.keepHp / mode.keepHpMax());
      night.hurtMin = Math.min(night.hurtMin, game.player.blood / game.player.bloodMax);
      night.flares = state.flares || 0;
      continue;
    }
    if (night) {
      night.result = mode.phase === 'failed' ? 'FAIL' : 'OK';
      night.endAt = night.result === 'OK' ? DURATION : +mode.elapsed.toFixed(1);
      night.targetPct = Math.round(100 * night.targetFrames / Math.max(1, night.frames));
      night.deadTail = +(night.endAt - night.lastKillAt).toFixed(1);
      night.longestQuiet = +night.longestQuiet.toFixed(1);
      night.lastKillAt = +night.lastKillAt.toFixed(1);
      night.keepMin = Math.round(night.keepMin * 100);
      night.hurtMin = Math.round(night.hurtMin * 100);
      delete night.frames; delete night.targetFrames; delete night.quiet;
      nights.push(night); night = null;
      state.flares = 0;
      release(game);
    }
    if (mode.phase === 'day') {
      if (!day) {
        const o = dayOptions(mode);
        day = { day: mode.day, gold: Math.floor(mode.gold), wood: Math.floor(mode.wood), options: o.n, kinds: o.kinds, buys: [], at: { x: game.player.x, y: game.player.y } };
      }
      const started = botDay(game, kind === 'idle' || kind === 'active' ? 'idle' : kind);
      if (started || mode.phase !== 'day') {
        let t = 0, prevJob = 0;
        for (const b of day.buys) { t += Math.max(b.walk, prevJob) + 2; prevJob = b.job; }
        t += prevJob + 1.5;   // last job, then tap START NIGHT
        day.humanSeconds = Math.round(t);
        delete day.at; days.push(day); day = null;
      }
      game.update(step);
      continue;
    }
    break;
  }
  return { kind, seed, result: mode.phase, nights, days };
}
const KINDS = String(args.kinds || 'builder,tower,active,idle').split(',');
// the balance probe's three seeds (20261012 + i·7919) plus two neighbours
const SEEDLIST = String(args.seedlist || '20261012,20268931,20276850,20261013,20261014').split(',').map(Number);
const all = [];
for (const kind of KINDS) for (const seed of SEEDLIST) all.push(runGamer(kind, seed));
if (args.json) fs.writeFileSync(args.json, JSON.stringify(all, null, 1));
for (const r of all) {
  console.log(`\n${r.kind} s${r.seed} -> ${r.result}`);
  for (const n of r.nights) console.log(`  N${n.day} ${n.result} end@${n.endAt}s kills=${n.kills} target%=${n.targetPct} first@${n.firstTarget}s longestQuiet=${n.longestQuiet}s lastKill@${n.lastKillAt}s deadTail=${n.deadTail}s keepMin=${n.keepMin}% hpMin=${n.hurtMin}% flares=${n.flares} bins=${n.bins.join(',')}`);
  for (const d of r.days) console.log(`  D${d.day} purse=${d.gold}g/${d.wood}w options=${d.options} [${d.kinds.join(' ')}] buys=${d.buys.map((b) => `${b.type}(walk${b.walk}s,job${b.job}s)`).join(' ')} human≈${d.humanSeconds}s`);
}
