#!/usr/bin/env node
/* DUSKHOLD Survival — top-down plan of the bailey (layout QA).
 *
 * Draws the real Fortress + SurvivalMode geometry from above: the yards, the
 * curtain wall and its towers, the gates (inside/outside points), the props,
 * the keep, every build plot with its footprint, the armory, the barricade
 * spot, the captain's home and each ballista's line of fire through its
 * gate. Then it checks the plan is tidy: no plot overlaps a wall, a tower, a
 * prop, the keep, a gate passage or another plot; every ballista sees out of
 * its gate; mirrored plots really are mirrored.
 *
 *   node tools/survival-map.mjs [--out=qa-evidence/survival-layout/plan.png] [--json=f]
 *
 * Exit code 1 when a check fails.
 */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const OUT = args.out || null;
const JSON_OUT = args.json || null;

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
  innerWidth: 844, innerHeight: 390, devicePixelRatio: 1, addEventListener() { }, removeEventListener() { },
  AudioContext: StubAudioContext, requestAnimationFrame() { return 0; },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
};
globalThis.window = win;
globalThis.document = stubDoc;
globalThis.localStorage = win.localStorage;
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-map' }, configurable: true }); } catch (_) { /* ignore */ }
globalThis.addEventListener = () => { };
globalThis.requestAnimationFrame = () => 0;

const { Game } = await import('../src/game/game.js');
const { SURVIVAL_SLOTS, CIRCLE, PLOT } = await import('../src/game/survival.js');

function makeCanvas() {
  const canvas = createCanvas(844, 390);
  canvas.addEventListener = () => { };
  canvas.removeEventListener = () => { };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 844, height: 390 });
  canvas.clientWidth = 844; canvas.clientHeight = 390; canvas.style = {};
  return canvas;
}

const game = new Game(makeCanvas(), { mode: 'survival', nightDuration: 60 });
const mode = game.survival;
mode.restart();
const m = game.mansion;
const keep = mode.keep();
const plotR = (PLOT && PLOT.radius) || CIRCLE.radius;

const plots = SURVIVAL_SLOTS.map((slot) => {
  const spot = mode.buildingSpot(slot.id);
  return { id: slot.id, type: slot.type, room: slot.room, x: spot.x, y: spot.y, doorId: spot.doorId || null, face: spot.face == null ? null : spot.face };
});
const armory = mode.armorySpot();
const gateSpot = mode.gateSpot();
const home = mode.hunterHome();

/* ---------------- checks ---------------- */
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const rectCircle = (r, x, y, rad) => {
  const cx = Math.max(r.x, Math.min(x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(y, r.y + r.h));
  return Math.hypot(x - cx, y - cy) < rad;
};
const solids = m.solids.filter((s) => s.solid !== false);
const props = (m.furniture || []).filter((f) => f && f.w && f.h);
for (const p of plots) {
  const hitWall = solids.filter((s) => rectCircle(s, p.x, p.y, plotR + 6));
  check(`plot ${p.id} clear of masonry (r${plotR}+6)`, hitWall.length === 0, hitWall.map((s) => s.type).join(','));
  const hitProp = props.filter((f) => rectCircle(f, p.x, p.y, plotR + 10));
  check(`plot ${p.id} clear of props (+10)`, hitProp.length === 0, hitProp.map((f) => f.type).join(','));
  const dk = Math.hypot(p.x - keep.x, p.y - keep.y) - keep.r - plotR;
  check(`plot ${p.id} clear of the keep (gap ${Math.round(dk)} >= 24)`, dk >= 24);
  for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door')) {
    // the gate passage: the doorway plus 120 px of road inside it
    const inX = e.inside ? e.inside.x : e.x, inY = e.inside ? e.inside.y : e.y;
    const len = 120;
    const out = { x: inX - e.x, y: inY - e.y };
    const ol = Math.hypot(out.x, out.y) || 1;
    const nx = out.x / ol, ny = out.y / ol;
    const half = (e.axis === 'v' ? e.h : e.w) / 2 || 60;
    let blocked = false;
    for (let s = 0; s <= len; s += 10) {
      const cx = e.x + nx * s, cy = e.y + ny * s;
      const px = -ny, py = nx;
      const lat = (p.x - cx) * px + (p.y - cy) * py;
      const along = (p.x - cx) * nx + (p.y - cy) * ny;
      if (Math.abs(along) < 10 && Math.abs(lat) < half + plotR) blocked = true;
    }
    check(`plot ${p.id} leaves the ${e.id} passage open`, !blocked);
  }
}
for (let i = 0; i < plots.length; i++) {
  for (let j = i + 1; j < plots.length; j++) {
    const a = plots[i], b = plots[j];
    const gap = Math.hypot(a.x - b.x, a.y - b.y) - plotR * 2;
    if (gap < 30) check(`plots ${a.id} / ${b.id} apart (gap ${Math.round(gap)} >= 30)`, false);
  }
}
check('every pair of plots at least 30 px apart', !results.some((r) => r.name.startsWith('plots ') && !r.ok));
for (const p of plots.filter((q) => q.type === 'tower')) {
  const door = p.doorId && mode.entranceById(p.doorId);
  check(`ballista ${p.id} guards a gate`, !!door, p.doorId || 'none');
  if (door) check(`ballista ${p.id} sees out of ${door.id}`, mode.boltPath(p.x, p.y, door.outside.x, door.outside.y));
}
for (const [name, q] of [['armory', armory], ['barricade', gateSpot], ['home', home]]) {
  const hit = plots.filter((p) => Math.hypot(p.x - q.x, p.y - q.y) < plotR + 40);
  check(`${name} clear of the plots`, hit.length === 0, hit.map((p) => p.id).join(','));
}
// tidy: plots that share a yard pattern line up (same |x| or |y| as their mirror)
const byId = new Map(plots.map((p) => [p.id, p]));
const mirror = (a, b, axis) => {
  const p = byId.get(a), q = byId.get(b);
  if (!p || !q) return false;
  const kx = p.x - keep.x, ky = p.y - keep.y, qx = q.x - keep.x, qy = q.y - keep.y;
  if (axis === 'p') return Math.abs(kx + qx) <= 2 && Math.abs(ky + qy) <= 2;
  return axis === 'x' ? Math.abs(kx + qx) <= 2 && Math.abs(ky - qy) <= 2 : Math.abs(ky + qy) <= 2 && Math.abs(kx - qx) <= 2;
};
const pairs = (PLOT && PLOT.mirrors) || [];
const axisName = { p: 'through the keep', x: 'across the north-south axis', y: 'across the east-west axis' };
for (const [a, b, axis] of pairs) check(`plots ${a} / ${b} mirrored ${axisName[axis] || axis}`, mirror(a, b, axis));
check('the plan has its twins (PLOT.mirrors)', pairs.length >= 7, `${pairs.length}`);
// every plot stands on one of the plan's columns
const columns = [130, 165, 340, 480];
for (const p of plots) check(`plot ${p.id} on a plan column (|x| in ${columns.join('/')})`, columns.includes(Math.abs(p.x - keep.x)));
// the armory mirrors the ward's barracks; the captain's home stands between them
const ward = byId.get('ward');
check('armory mirrors the ward barracks across the gate road', ward && Math.abs((armory.x - keep.x) + (ward.x - keep.x)) <= 2 && Math.abs(armory.y - ward.y) <= 2);
check('the captain starts on a road axis just off the keep', (Math.abs(home.x - keep.x) <= 2 || Math.abs(home.y - keep.y) <= 2)
  && Math.hypot(home.x - keep.x, home.y - keep.y) > keep.r + 40 && Math.hypot(home.x - keep.x, home.y - keep.y) < keep.r + 140);

/* ---------------- drawing ---------------- */
const B = m.bailey;
const margin = 220;
const S = Number(args.scale || 0.62);
const W = Math.round((B.w + margin * 2) * S), H = Math.round((B.h + margin * 2) * S) + 40;
const cv = createCanvas(W, H);
const ctx = cv.getContext('2d');
const X = (x) => (x - B.x + margin) * S;
const Y = (y) => (y - B.y + margin) * S + 40;
ctx.fillStyle = '#2f3a2c'; ctx.fillRect(0, 0, W, H);
for (const r of m.roomList) {
  ctx.fillStyle = r.floor === 'grass' ? '#6f8a4c' : '#b7aa92';
  ctx.fillRect(X(r.x), Y(r.y), r.w * S, r.h * S);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
  ctx.strokeRect(X(r.x), Y(r.y), r.w * S, r.h * S);
}
for (const s of solids) {
  ctx.fillStyle = s.type === 'tower' ? '#4d4a48' : '#5f5a55';
  ctx.fillRect(X(s.x), Y(s.y), s.w * S, s.h * S);
}
for (const f of props) {
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(X(f.x), Y(f.y), f.w * S, f.h * S);
}
for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door')) {
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), 6, 0, Math.PI * 2); ctx.fill();
  if (e.inside) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(e.inside.x), Y(e.inside.y), 3, 0, Math.PI * 2); ctx.fill(); }
  if (e.outside) { ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(X(e.outside.x), Y(e.outside.y), 3, 0, Math.PI * 2); ctx.fill(); }
}
ctx.fillStyle = '#3a3f55';
ctx.beginPath(); ctx.arc(X(keep.x), Y(keep.y), keep.r * S, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KEEP', X(keep.x), Y(keep.y) + 4);
const colors = { tower: '#e74c3c', mine: '#f1c40f', sawmill: '#e67e22', barracks: '#3498db' };
for (const p of plots) {
  if (p.type === 'tower' && p.doorId) {
    const door = mode.entranceById(p.doorId);
    if (door) {
      ctx.strokeStyle = 'rgba(231,76,60,0.6)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(door.outside.x), Y(door.outside.y)); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.fillStyle = colors[p.type] || '#fff';
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), plotR * S, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
  if (p.face != null) {
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(p.x + Math.cos(p.face) * plotR), Y(p.y + Math.sin(p.face) * plotR)); ctx.stroke();
  }
  ctx.fillStyle = '#111'; ctx.font = '10px sans-serif';
  ctx.fillText(`${p.id}`, X(p.x), Y(p.y) - plotR * S - 3);
  ctx.fillText(`(${p.x}, ${p.y})`, X(p.x), Y(p.y) + 3);
}
for (const [name, q, c] of [['ARMORY', armory, '#9b59b6'], ['GATE', gateSpot, '#16a085'], ['HOME', home, '#ffffff']]) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = 'bold 10px sans-serif'; ctx.fillText(name, X(q.x), Y(q.y) - 10);
}
const fails = results.filter((r) => !r.ok);
ctx.fillStyle = fails.length ? '#c0392b' : '#27ae60';
ctx.fillRect(0, 0, W, 34);
ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
ctx.fillText(`Bailey plan — ${plots.length} plots, ${results.length - fails.length}/${results.length} layout checks pass`, 12, 23);

for (const r of results) if (!r.ok || args.verbose) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(`plots: ${plots.map((p) => `${p.id}@(${p.x},${p.y})`).join(' ')}`);
console.log(`armory (${armory.x},${armory.y}) gate (${gateSpot.x},${gateSpot.y}) home (${home.x},${home.y})`);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} layout checks pass`);
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, cv.toBuffer('image/png'));
  console.log(`wrote ${OUT}`);
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ plots, armory, gateSpot, home, results }, null, 2));
process.exit(fails.length ? 1 : 0);
