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
  // BUILD 17 (R8): a run's gate rotation comes from a seed. This base is the
  // one whose rotation is BUILD 16's (Night 2 west → NW postern → south,
  // Night 3 SE postern → north → south), so these checks measure the same run
  // they measured before the rotation existed. The rotation itself is checked
  // over many seeds (harness §BUILD 17, survival-balance, survival-uxprobe).
  DUSKHOLD_SEED: 20261007,
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
const { SURVIVAL_SLOTS, CIRCLE, PLOT, BANNER } = await import('../src/game/survival.js');
const { FORT_SCALE, PLAZA_R, ROAD_HALF } = await import('../src/game/fortress.js');

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
  return { id: slot.id, type: slot.type, room: slot.room, level: slot.level, x: spot.x, y: spot.y, doorId: spot.doorId || null, face: spot.face == null ? null : spot.face };
});
const armory = mode.armorySpot();
const arms = mode.armsSpot();   // BUILD 14: the garrison's crossbows
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
for (const [name, q] of [['armory', armory], ['arms rack', arms], ['barricade', gateSpot], ['home', home]]) {
  const hit = plots.filter((p) => Math.hypot(p.x - q.x, p.y - q.y) < plotR + 40);
  check(`${name} clear of the plots`, hit.length === 0, hit.map((p) => p.id).join(','));
}
// BUILD 14: the two stations (the armory, the arms rack) stand on pads like
// the plots: clear of the masonry and the props, 120+ px of grass apart
for (const [name, q] of [['armory', armory], ['arms rack', arms]]) {
  const hitWall = solids.filter((s) => rectCircle(s, q.x, q.y, plotR + 6));
  const hitProp = props.filter((f) => rectCircle(f, q.x, q.y, plotR + 10));
  check(`${name} pad clear of masonry and props`, hitWall.length === 0 && hitProp.length === 0, [...hitWall, ...hitProp].map((s) => s.type).join(','));
}
const stationGap = Math.hypot(arms.x - armory.x, arms.y - armory.y) - plotR * 2;
check(`the arms rack is the armory's neighbour on its row (gap ${Math.round(stationGap)} >= 120)`, arms.y === armory.y && stationGap >= 120);
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
const columns = [120, 330, 465, 600, 870];
for (const p of plots) check(`plot ${p.id} on a plan column (|x| in ${columns.join('/')})`, columns.includes(Math.abs(p.x - keep.x)));
// the armory is the ward barracks' twin through the keep (the south-east
// district mirrors the north-west one); the captain starts on a road axis at
// the plaza's edge
const ward = byId.get('ward');
check('armory is the ward barracks\' twin through the keep', ward && Math.abs((armory.x - keep.x) + (ward.x - keep.x)) <= 2 && Math.abs((armory.y - keep.y) + (ward.y - keep.y)) <= 2);
const nw = byId.get('northwest');
check('the arms rack is the north-west barracks\' twin through the keep', nw && Math.abs((arms.x - keep.x) + (nw.x - keep.x)) <= 2 && Math.abs((arms.y - keep.y) + (nw.y - keep.y)) <= 2);
const homeD = Math.hypot(home.x - keep.x, home.y - keep.y);
check('the captain starts on a road axis at the plaza\'s edge', (Math.abs(home.x - keep.x) <= 2 || Math.abs(home.y - keep.y) <= 2)
  && homeD > keep.r + 40 && homeD < PLAZA_R + 40, `${Math.round(homeD)} px from the keep`);

/* BUILD 12 (layout B, docs/VISUAL-LAYOUT-RESEARCH.md §6): a bigger, zoned bailey */
const B0 = m.bailey;
check('the bailey is layout B\'s 2080 x 1520 (1.6x BUILD 11)', B0.w === 2080 && B0.h === 1520 && FORT_SCALE === 0.8, `${B0.w} x ${B0.h}, FORT_SCALE ${FORT_SCALE}`);
const quarter = (p) => `${p.y - keep.y < 0 ? 'N' : 'S'}${p.x - keep.x < 0 ? 'W' : 'E'}`;
const economy = plots.filter((p) => p.type !== 'tower');
const districts = new Map();
for (const p of economy) {
  const q = quarter(p);
  if (!districts.has(q)) districts.set(q, new Set());
  districts.get(q).add(p.type);
}
check('each district (grass quarter) holds one trade', [...districts.values()].every((types) => types.size === 1),
  [...districts].map(([q, types]) => `${q}:${[...types].join('+')}`).join(' '));
check('the trades are NW barracks, NE mines, SW sawmills; SE the armory', districts.get('NW')?.has('barracks') && districts.get('NE')?.has('mine')
  && districts.get('SW')?.has('sawmill') && !districts.has('SE') && quarter(armory) === 'SE' && quarter(arms) === 'SE');
let econGap = Infinity;
for (let i = 0; i < economy.length; i++) for (let j = i + 1; j < economy.length; j++) {
  econGap = Math.min(econGap, Math.hypot(economy[i].x - economy[j].x, economy[i].y - economy[j].y) - plotR * 2);
}
check(`economy plots keep 120+ px of grass between pads (min ${Math.round(econGap)})`, econGap >= 120);
for (const p of [...economy, { id: 'armory', x: armory.x, y: armory.y }, { id: 'arms rack', x: arms.x, y: arms.y }]) {
  const wall = Math.min(p.x - plotR - B0.x, B0.x + B0.w - p.x - plotR, p.y - plotR - B0.y, B0.y + B0.h - p.y - plotR);
  const offRoad = Math.abs(p.x - keep.x) - plotR >= ROAD_HALF && Math.abs(p.y - keep.y) - plotR >= ROAD_HALF;
  const offPlaza = Math.hypot(p.x - keep.x, p.y - keep.y) - plotR >= PLAZA_R;
  check(`${p.id}: off the roads and the plaza, ${Math.round(wall)} >= 180 px from the wall`, offRoad && offPlaza && wall >= 180);
}
// the banner reaches every plot its keep level opens; Lv3 the whole bailey
for (const level of [1, 2, 3]) {
  const reach = BANNER[level];
  const out = plots.filter((p) => p.level <= level && Math.hypot(p.x - keep.x, p.y - keep.y) > reach);
  check(`the Lv${level} banner (${reach} px) reaches every Lv${level} plot`, out.length === 0, out.map((p) => p.id).join(','));
}
const far = Math.max(...[[B0.x, B0.y], [B0.x + B0.w, B0.y], [B0.x, B0.y + B0.h], [B0.x + B0.w, B0.y + B0.h]].map(([x, y]) => Math.hypot(x - keep.x, y - keep.y)));
check('the Lv3 banner covers the whole bailey', BANNER[3] >= far, `${Math.round(far)} px to the far corner`);
check('plots open 9 / 13 / 15 by keep level', [1, 2, 3].map((l) => plots.filter((p) => p.level <= l).length).join('/') === '9/13/15');
// the dressing (fortress.js furnish): off the plots, the roads, the plaza
// and every ballista's line of fire, clear of the wall
const decor = props.filter((f) => f.type === 'well' || String(f.type).startsWith('kit:'));
check(`the districts are dressed (${decor.length} kit props)`, decor.length >= 16);
const segRect = (ax, ay, bx, by, r, pad) => {
  for (let k = 0; k <= 40; k++) {
    const x = ax + (bx - ax) * (k / 40), y = ay + (by - ay) * (k / 40);
    if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
  }
  return false;
};
const towerPlots = plots.filter((p) => p.type === 'tower' && p.doorId);
for (const f of decor) {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const onRoad = Math.abs(cx - keep.x) - f.w / 2 < ROAD_HALF || Math.abs(cy - keep.y) - f.h / 2 < ROAD_HALF;
  const onPlaza = rectCircle(f, keep.x, keep.y, PLAZA_R);
  const wall = Math.min(f.x - B0.x, B0.x + B0.w - f.x - f.w, f.y - B0.y, B0.y + B0.h - f.y - f.h);
  const towerHit = solids.filter((s) => s.type === 'tower' || s.type === 'wall').some((s) => f.x < s.x + s.w + 30 && f.x + f.w > s.x - 30 && f.y < s.y + s.h + 30 && f.y + f.h > s.y - 30);
  const fire = towerPlots.filter((p) => {
    const door = mode.entranceById(p.doorId);
    return door && segRect(p.x, p.y, door.outside.x, door.outside.y, f, 12);
  });
  check(`${f.type} @(${Math.round(cx)},${Math.round(cy)}): off road / plaza, clear of masonry, out of every line of fire`,
    !onRoad && !onPlaza && wall >= 30 && !towerHit && fire.length === 0,
    [onRoad && 'road', onPlaza && 'plaza', wall < 30 && `wall ${Math.round(wall)}`, towerHit && 'masonry', fire.length && `fire:${fire.map((p) => p.id).join(',')}`].filter(Boolean).join(' '));
}

/* ---------------- BUILD 15 (V6 / V7): the night fight in sight ----------------
 * docs/VISUAL-LAYOUT-RESEARCH.md §7. The towers as World3D builds them
 * (fortress.js TOWER_RISE over the wall's top, then the cap and merlons: +28
 * on a gate tower, +33 on a corner; a bridge over a north / west gate), the
 * camera's line of sight (azimuth 45°, elevation 35.26°: toward the camera is
 * (+1, +1) on the ground, rising 1/sqrt(2) px per px) and the captain's
 * height (x1.6). The captain's see-through silhouette is 3D
 * (survival-plotsqa §7); this is the masonry itself.
 */
const { TOWER_RISE, NEAR_SIDES } = await import('../src/game/fortress.js');
const { PX_PER_METRE, PIECE_METRES, VALEN_METRES, SURVIVAL_ACTOR_SCALE } = await import('../src/game/envkit.js');
const { KILL_ZONE, GLACIS } = await import('../src/game/exterior.js');
const wallTop = m.wallMetres * PX_PER_METRE;
const gateTop = Math.max(wallTop, PIECE_METRES.doorway * PX_PER_METRE + 6);
const sightSolids = [];
for (const t of m.towers) {
  const rise = Number.isFinite(t.rise) ? t.rise : (t.kind === 'corner' ? TOWER_RISE.corner : TOWER_RISE.gate);
  if (t.kind === 'corner') sightSolids.push({ id: `corner(${t.x},${t.y})`, kind: 'cyl', x: t.x, y: t.y, r: t.size / 2 + 8, top: wallTop + rise + 33 });
  else sightSolids.push({ id: `${t.gate}:${t.flank > 0 ? '+' : '-'}`, kind: 'box', x: t.x, y: t.y, hw: t.size / 2 + 5, hd: t.size / 2 + 5, top: wallTop + rise + 28 });
}
for (const e of m.entrances) {
  if (!e.gate || !e.big || NEAR_SIDES.includes(e.facing)) continue;
  const horiz = e.axis === 'h';
  const span = (horiz ? e.w : e.h) + 20;
  sightSolids.push({ id: `${e.id}:bridge`, kind: 'box', x: e.x, y: e.y, hw: horiz ? span / 2 : 21, hd: horiz ? 21 : span / 2, bottom: gateTop - 4, top: gateTop + 40 });
}
const LOS = Math.SQRT1_2;
function sightHit(px, py, z, sd) {
  let tin, tout;
  if (sd.kind === 'box') {
    const t1 = (sd.x - sd.hw - px) / LOS, t2 = (sd.x + sd.hw - px) / LOS;
    const t3 = (sd.y - sd.hd - py) / LOS, t4 = (sd.y + sd.hd - py) / LOS;
    tin = Math.max(Math.min(t1, t2), Math.min(t3, t4)); tout = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  } else {
    const fx = px - sd.x, fy = py - sd.y;
    const b = fx * LOS + fy * LOS, c = fx * fx + fy * fy - sd.r * sd.r;
    const disc = b * b - c;
    if (disc < 0) return false;
    tin = -b - Math.sqrt(disc); tout = -b + Math.sqrt(disc);
  }
  if (tout < 0 || tin > tout) return false;
  tin = Math.max(0, tin);
  return z + LOS * tin < sd.top && z + LOS * tout > (sd.bottom || 0);
}
const captainH = VALEN_METRES * PX_PER_METRE * SURVIVAL_ACTOR_SCALE;
const headZ = captainH * 0.85;
const gateDoors = m.entrances.filter((e) => e.exterior && e.kind === 'door');
const fightSpots = (e) => {
  const iw = { x: e.inside.x - e.x, y: e.inside.y - e.y };
  const il = Math.hypot(iw.x, iw.y) || 1; iw.x /= il; iw.y /= il;
  const lat = { x: -iw.y, y: iw.x };
  const out = [];
  for (const off of [-40, 0, 40]) out.push({ at: `in ${off}`, x: e.x + iw.x * 80 + lat.x * off, y: e.y + iw.y * 80 + lat.y * off });
  for (const d of [80, 200]) for (const off of [-60, 0, 60]) out.push({ at: `out ${d}/${off}`, x: e.x - iw.x * d + lat.x * off, y: e.y - iw.y * d + lat.y * off });
  return out;
};
const nearHidden = [], farHidden = [];
let farSpots = 0;
for (const e of gateDoors) {
  for (const sp of fightSpots(e)) {
    const by = sightSolids.filter((sd) => sightHit(sp.x, sp.y, headZ, sd)).map((sd) => sd.id);
    if (NEAR_SIDES.includes(e.facing)) { if (by.length) nearHidden.push(`${e.id} ${sp.at} (${by.join('+')})`); }
    else { farSpots++; if (by.length) farHidden.push(`${e.id} ${sp.at}`); }
  }
}
check(`V6: from every fight spot at a south / east gate (80 px inside, 80 / 200 px out) the captain's head clears the masonry`,
  nearHidden.length === 0,
  nearHidden.length ? nearHidden.join(', ') : `north / west gates: head behind a tall tower at ${farHidden.length}/${farSpots} spots (the see-through silhouette shows him there)`);
// how much of the screen one piece of masonry covers, at the night zoom on
// the 844 x 390 screen, the view centred inside, in the mouth and outside
game.renderer.resize(844, 390, 1);   // a phone held sideways (the stub never sized it)
const zNight = game.renderer.baseZoom * mode.frameMul(true);
const SW = game.renderer.w, SH = game.renderer.h;
const hull = (pts) => {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
};
const clipRect = (poly) => {
  const edges = [
    [(q) => q.x >= 0, (a, b) => ({ x: 0, y: a.y + (b.y - a.y) * (0 - a.x) / (b.x - a.x) })],
    [(q) => q.x <= SW, (a, b) => ({ x: SW, y: a.y + (b.y - a.y) * (SW - a.x) / (b.x - a.x) })],
    [(q) => q.y >= 0, (a, b) => ({ x: a.x + (b.x - a.x) * (0 - a.y) / (b.y - a.y), y: 0 })],
    [(q) => q.y <= SH, (a, b) => ({ x: a.x + (b.x - a.x) * (SH - a.y) / (b.y - a.y), y: SH })],
  ];
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    poly = out;
    if (!poly.length) break;
  }
  return poly;
};
const polyArea = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };
const screenShare = (sd, cx, cy) => {
  const proj = (x, y, hgt) => ({ x: SW / 2 + zNight * Math.SQRT1_2 * ((x - cx) - (y - cy)), y: SH / 2 + zNight / Math.sqrt(6) * ((x - cx) + (y - cy)) - zNight * Math.sqrt(2 / 3) * hgt });
  const pts = [];
  if (sd.kind === 'box') { for (const a of [-1, 1]) for (const b of [-1, 1]) for (const hgt of [sd.bottom || 0, sd.top]) pts.push(proj(sd.x + a * sd.hw, sd.y + b * sd.hd, hgt)); }
  else for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; for (const hgt of [0, sd.top]) pts.push(proj(sd.x + Math.cos(a) * sd.r, sd.y + Math.sin(a) * sd.r, hgt)); }
  return polyArea(clipRect(hull(pts))) / (SW * SH);
};
let worstShare = { f: 0, id: '', view: '' };
for (const e of gateDoors) {
  const iw = { x: e.inside.x - e.x, y: e.inside.y - e.y };
  const il = Math.hypot(iw.x, iw.y) || 1; iw.x /= il; iw.y /= il;
  for (const [view, d] of [['inside', -80], ['mouth', 0], ['outside', 200]]) {
    const cx = e.x - iw.x * d, cy = e.y - iw.y * d;
    for (const sd of sightSolids) {
      const f = screenShare(sd, cx, cy);
      if (f > worstShare.f) worstShare = { f, id: sd.id, view: `${e.id} ${view}` };
    }
  }
}
check(`V6: no tower or gate bridge covers more than 10% of the ${SW}x${SH} screen at the night zoom (${zNight.toFixed(3)}) from a gate's fight views`,
  worstShare.f <= 0.1, `worst ${(worstShare.f * 100).toFixed(1)}%: ${worstShare.id} seen from ${worstShare.view}`);
// the kill zones and the glacis (exterior.js): open floor in front of every
// gate (rocks and stumps are low), no conifer on the near faces
const trees = m.exterior.trees;
const standingTrees = trees.filter((t) => !t.felled);
const zoneClear = gateDoors.map((e) => ({ id: e.id, d: Math.min(...standingTrees.map((t) => Math.hypot(t.x - e.outside.x, t.y - e.outside.y))) }));
check(`V7: at least 300 px of open floor in front of every gate (no standing tree within ${KILL_ZONE} px of its outside)`,
  zoneClear.every((z) => z.d >= Math.max(300, KILL_ZONE)), zoneClear.map((z) => `${z.id} ${Math.round(z.d)}`).join(', '));
const glacisTrees = standingTrees.filter((t) => (t.y > B0.y + B0.h && t.y < B0.y + B0.h + GLACIS && t.x > B0.x - GLACIS && t.x < B0.x + B0.w + GLACIS)
  || (t.x > B0.x + B0.w && t.x < B0.x + B0.w + GLACIS && t.y > B0.y - GLACIS && t.y < B0.y + B0.h + GLACIS));
check(`V7: the south / east glacis (${GLACIS} px) holds no standing conifer; ${trees.filter((t) => t.felled).length} felled to stumps`,
  glacisTrees.length === 0 && trees.some((t) => t.felled), glacisTrees.map((t) => `(${Math.round(t.x)},${Math.round(t.y)})`).join(' '));

/* ---------------- drawing ---------------- */
const B = m.bailey;
const margin = 220;
const S = Number(args.scale || 0.42);
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
  const t = String(f.type);
  ctx.fillStyle = /^kit:tree/.test(t) ? '#2f6b2a' : /^kit:rock/.test(t) ? '#7d7d7d' : '#8a5a34';
  ctx.fillRect(X(f.x), Y(f.y), f.w * S, f.h * S);
}
for (const e of m.entrances.filter((d) => d.exterior && d.kind === 'door')) {
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), 6, 0, Math.PI * 2); ctx.fill();
  if (e.inside) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(e.inside.x), Y(e.inside.y), 3, 0, Math.PI * 2); ctx.fill(); }
  if (e.outside) { ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(X(e.outside.x), Y(e.outside.y), 3, 0, Math.PI * 2); ctx.fill(); }
}
// the plaza and the banner's reach per keep level (clipped to the bailey)
ctx.fillStyle = '#c9bfae';
ctx.beginPath(); ctx.arc(X(keep.x), Y(keep.y), PLAZA_R * S, 0, Math.PI * 2); ctx.fill();
ctx.save();
ctx.beginPath(); ctx.rect(X(B.x), Y(B.y), B.w * S, B.h * S); ctx.clip();
for (const level of [1, 2, 3]) {
  ctx.strokeStyle = 'rgba(62,107,255,0.75)'; ctx.lineWidth = 2; ctx.setLineDash(level === 1 ? [] : [6, 5]);
  ctx.beginPath(); ctx.arc(X(keep.x), Y(keep.y), BANNER[level] * S, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2a4bd0'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`banner Lv${level}`, X(keep.x) + 4, Y(keep.y) - BANNER[level] * S + 12);
}
ctx.restore();
ctx.textAlign = 'center';
ctx.fillStyle = '#3a3f55';
ctx.beginPath(); ctx.arc(X(keep.x), Y(keep.y), keep.r * S, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KEEP', X(keep.x), Y(keep.y) + 4);
const colors = { tower: '#ff5640', mine: '#ffc22e', sawmill: '#4cc35e', barracks: '#3e7bff' };
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
  ctx.fillText(`${p.id} · Lv${p.level}`, X(p.x), Y(p.y) - plotR * S - 3);
  ctx.fillText(`(${p.x}, ${p.y})`, X(p.x), Y(p.y) + 3);
}
for (const [name, q, c] of [['ARMORY', armory, '#9b59b6'], ['ARMS', arms, '#3e7bff'], ['GATE', gateSpot, '#16a085'], ['HOME', home, '#ffffff']]) {
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
console.log(`armory (${armory.x},${armory.y}) arms (${arms.x},${arms.y}) gate (${gateSpot.x},${gateSpot.y}) home (${home.x},${home.y})`);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} layout checks pass`);
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, cv.toBuffer('image/png'));
  console.log(`wrote ${OUT}`);
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ plots, armory, arms, gateSpot, home, results }, null, 2));
process.exit(fails.length ? 1 : 0);
