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
  run(48);
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
  const swarm = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, key: 'crawler', dead: false, x: i * 30, y: 0 }));
  const capped = selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
  line(capped.length === ENEMY_GLB_CAP && capped[0].id === 1, `nearest ${ENEMY_GLB_CAP} are the skinned cap`);
  line(selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => false).length === 0, 'an unready model stays on the 2D path');
  // Owner mapping: Tripo's clip names ARE the walk / attack / die of these
  // files, and they live in the registry rather than being smuggled into poses.
  line(ENEMY_MODELS.zombie.map.walk === 'flee_02' && ENEMY_MODELS.zombie.map.attack === 'cast_a_spell'
    && ENEMY_MODELS.zombie.map.die === 'defeat_03' && requiredClips('werewolf')[0] === 'run',
    'the zombie walks on flee_02 by the owner map, not by accident');
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
  line(!swarmThrew && game.screen === 'playing', 'a forced load failure leaves the night on the 2D bodies');
  game.renderer.resize(390, 844, 1);
  line(game.renderer.view.top === 0 && game.renderer.view.h === 844 && game.renderer.view.w === 390, 'a phone canvas is full-bleed, not a middle band');
  line(game.renderer.cam.zoom >= 0.9 && game.renderer.cam.zoom <= 1.2, `phone cover zoom stays readable (${game.renderer.cam.zoom.toFixed(2)})`);
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
