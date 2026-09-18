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
const { TUNING, NIGHT_DURATION } = await import('../src/core/config.js');

const canvas = createCanvas(1280, 720);
canvas.addEventListener = () => { };
canvas.removeEventListener = () => { };
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
canvas.clientWidth = 1280;
canvas.clientHeight = 720;
canvas.style = {};
const game = new Game(canvas);
const input = game.input;
input.touchSeen = false;

await Audio.unlock();
game.applySettings();

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
  line(game.messages.some((m) => /WAITING|NOT WAIT|INVITATION/i.test(m.text)), 'the answer is narrated, not yet revealed');

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
  game.screen = 'intro'; game.introT = 1.6; shot('intro', 30);
  game.screen = 'settings'; shot('settings', 20);
  game.screen = 'upgrades'; shot('upgrades', 20);
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
