/* DUSKHOLD Survival — the 2026-10-17 fix pass, checked in a real browser.
 *
 * The playtest asked for five things ("ada beberapa masih perlu di fix"):
 *   1 the camera a little further out, and draggable ("bisa di geser");
 *   2 the build plots laid out tidily ("letak build bangunan ... rapi");
 *   3 real downloaded building assets, not prototypes;
 *   4 smaller cards ("card juga masih besar");
 *   5 the opening trailer kept (tools/survival-intro.mjs checks that one).
 * This boots a fresh save at sideways-phone size (844 x 390), checks 1-4
 * against the running game and writes the frames that show them. Section 5
 * checks BUILD 13's visual pass (the bright captain, names only near,
 * tonight's gates by day); 6 BUILD 14's guard bows; 7 BUILD 15's night fight
 * in sight; 8 BUILD 16's night tempo (NIGHT CLEARED and its early dawn, the
 * wave's call, the last few marked on the playfield's frame).
 *
 *   node tools/survival-plotsqa.mjs [--out=qa-evidence/survival-plots] [--dpr=1] [--port=8125]
 *
 * Exit code 1 when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const OUT = path.resolve(ROOT, args.out || '/tmp/plotsqa');
const PORT = Number(args.port || 8125);
// BUILD 17 (R8): a run's gate rotation comes from a seed. Fixed here so a
// check measures the same run every time and an evidence shot replays.
const SEED = Number(args.seed || 20261007);   // the base whose rotation is BUILD 16's
const DPR = Number(args.dpr || 1);
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
fs.mkdirSync(path.join(ROOT, 'tools', '.cache', 'al2023-lib'), { recursive: true });
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  const br = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
  const tar = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'al2023.tar');
  fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', tar, '-C', path.join(ROOT, 'tools', '.cache', 'al2023-lib')]);
  fs.rmSync(tar);
}
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true, protocolTimeout: 300000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e.message).slice(0, 300)); console.log('PAGEERROR', String(e.message).slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text().slice(0, 300)); console.log('CONSOLE', m.text().slice(0, 300)); } });
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) { /* ignore */ } });
let failures = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 420)}` : ''}`);
  if (!ok) failures++;
};
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/?cine=0&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__LN;
  return !!(g && g.mode === 'survival' && g.screen === 'playing' && g.survival && g.survival.phase === 'night');
}, { timeout: 180000, polling: 100 });
console.log(`boot ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.evaluate(async () => {
  window.__pW = (await import('./src/game/world3d.js')).World3D;
  window.__pK = (await import('./src/game/buildings3d.js')).Buildings3D;
  const g = window.__LN;
  g.setQuality(99);
  window.__pOrig = g.update;
  g.update = () => {};
  window.__pStep = (n = 1) => { for (let i = 0; i < n; i++) { window.__pOrig.call(g, 1 / 60); g.render(); } };
  window.__pFast = (until) => { let n = 0; while (until() && n < 20000) { window.__pOrig.call(g, 1 / 60); n++; } return n; };
});
await page.waitForFunction(() => window.__pW?.diagnostics?.().ready, { timeout: 90000, polling: 100 });
const shot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  console.log(`SHOT ${name}`);
};

/* ---- 1. the camera: further out, and the player's to drag ---- */
const cam = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.restart(); window.__pStep(90);
  return { zoom: +g.renderer.cam.zoom.toFixed(3), play: +(m.frameMul(true) * g.renderer.baseZoom).toFixed(3), user: m.userZoom() };
});
// build 8 framed a sideways phone at 0.775 (FRAME_CLOSER 1.3); 1.1 is ~15% further out
check('camera: the night frame is further out than build 8 (zoom < 0.70, was 0.775)', cam.zoom < 0.7 && cam.zoom > 0.55, cam);
await shot('cam-1-night-frame');
const drag = async (x, y, dx, dy, steps = 6) => {
  await page.touchscreen.touchStart(x, y);
  await page.evaluate(() => window.__pStep(1));
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(x + dx * i / steps, y + dy * i / steps);
    await page.evaluate(() => window.__pStep(1));
  }
  await page.touchscreen.touchEnd();
  await page.evaluate(() => window.__pStep(2));
};
const before = await page.evaluate(() => ({ p: [window.__LN.player.x, window.__LN.player.y], cam: [window.__LN.renderer.cam.x, window.__LN.renderer.cam.y] }));
await drag(640, 230, -220, -90);
const after = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  window.__pStep(20);
  const chip = g.ui.find((item) => item.label === 'survival:RECENTER');
  return { p: [g.player.x, g.player.y], cam: [g.renderer.cam.x, g.renderer.cam.y], pan: { ...m.camPan }, offset: Math.round(m.cameraOffset()), chip: chip ? { x: chip.x, y: chip.y, w: chip.w, h: chip.h } : null };
});
const camMoved = Math.hypot(after.cam[0] - before.cam[0], after.cam[1] - before.cam[1]);
const playerMoved = Math.hypot(after.p[0] - before.p[0], after.p[1] - before.p[1]);
check('camera: a drag on the right half slides the view (the ground follows the finger) and the captain stays put',
  camMoved > 150 && playerMoved < 4 && after.offset > 150, { camMoved: Math.round(camMoved), playerMoved: +playerMoved.toFixed(1), offset: after.offset });
check('camera: dragged away, a CAPTAIN chip appears to bring the view back', !!after.chip, after.chip);
await shot('cam-2-dragged');
if (after.chip) {
  await page.touchscreen.tap(after.chip.x + after.chip.w / 2, after.chip.y + after.chip.h / 2);
  await page.evaluate(() => window.__pStep(70));
}
const recentered = await page.evaluate(() => Math.round(window.__LN.survival.cameraOffset()));
check('camera: the CAPTAIN chip eases the view back onto him', recentered < 5, { offset: recentered });
// pinch (two fingers on the free half) and the mouse wheel zoom within the limits
const zoomed = await page.evaluate(async () => {
  const g = window.__LN; const m = g.survival;
  const c = g.input.canvas;
  const rect = c.getBoundingClientRect();
  const z0 = m.userZoom();
  // the wheel: three notches in, then far out (clamped)
  for (let i = 0; i < 3; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: rect.left + 600, clientY: rect.top + 200, bubbles: true, cancelable: true }));
  window.__pStep(30);
  const zIn = m.userZoom();
  for (let i = 0; i < 30; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, clientX: rect.left + 600, clientY: rect.top + 200, bubbles: true, cancelable: true }));
  window.__pStep(60);
  const zOut = m.userZoom();
  const camZoom = g.renderer.cam.zoom;
  return { z0, zIn: +zIn.toFixed(3), zOut: +zOut.toFixed(3), camZoom: +camZoom.toFixed(3), saved: g.save.survival && g.save.survival.camZoom };
});
// BUILD 12: the range is 0.42 (the whole bailey) to 1.6 (a close-up)
check('camera: the wheel zooms in and out within 0.42–1.6 of the frame, and the choice is saved', zoomed.zIn > zoomed.z0 && Math.abs(zoomed.zOut - 0.42) < 0.01 && zoomed.saved === zoomed.zOut, zoomed);
await shot('cam-3-zoomed-out');
// two fingers: spread them apart on the right half
const pinch = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const c = g.input.canvas;
  const rect = c.getBoundingClientRect();
  const z0 = m.userZoom();
  const T = (id, x, y) => new Touch({ identifier: id, target: c, clientX: rect.left + x, clientY: rect.top + y });
  const fire = (type, touches, changed) => c.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
  const a0 = T(11, 600, 220), b0 = T(12, 680, 220);
  fire('touchstart', [a0], [a0]); window.__pStep(1);
  fire('touchstart', [a0, b0], [b0]); window.__pStep(1);
  for (let i = 1; i <= 6; i++) {
    const a = T(11, 600 - i * 15, 220), b = T(12, 680 + i * 15, 220);
    fire('touchmove', [a, b], [a, b]); window.__pStep(1);
  }
  const a1 = T(11, 510, 220), b1 = T(12, 770, 220);
  fire('touchend', [b1], [a1]); fire('touchend', [], [b1]); window.__pStep(30);
  return { z0: +z0.toFixed(3), z1: +m.userZoom().toFixed(3) };
});
check('camera: two fingers spread on the right half zoom in', pinch.z1 > pinch.z0 * 1.3, pinch);

/* ---- BUILD 12: the dynamic camera ("bisa di pebesar perkecil geser") ---- */
const reset = () => page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m._userZoom = 1; m._zoomGoal = null; g.save.survival.camZoom = 1; m.recenterCamera(true); window.__pStep(40);
});
await reset();
// a zoom about the cursor keeps the ground under it where it was
const anchor = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival; const r = g.renderer;
  const c = g.input.canvas; const rect = c.getBoundingClientRect();
  const sx = 700, sy = 120;
  const w0 = r.screenToWorld(sx, sy);
  for (let i = 0; i < 4; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 160, clientX: rect.left + sx, clientY: rect.top + sy, bubbles: true, cancelable: true }));
  window.__pStep(1);
  const s1 = r.worldToScreen(w0.x, w0.y);
  return { z: +m.userZoom().toFixed(3), drift: +Math.hypot(s1.x - sx, s1.y - sy).toFixed(1) };
});
check('camera: the wheel zooms about the cursor (the ground under it stays within 12 px)', anchor.z < 0.8 && anchor.drift < 12, anchor);
await reset();
// two fingers landing together anywhere pinch, even with one on the stick's half
const pinchAny = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const c = g.input.canvas; const rect = c.getBoundingClientRect();
  const T = (id, x, y) => new Touch({ identifier: id, target: c, clientX: rect.left + x, clientY: rect.top + y });
  const fire = (type, touches, changed) => c.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
  const run = (ax, bx, y, spread) => {
    const z0 = m.userZoom();
    const p0 = [g.player.x, g.player.y];
    const a0 = T(21, ax, y), b0 = T(22, bx, y);
    fire('touchstart', [a0], [a0]); window.__pStep(1);
    fire('touchstart', [a0, b0], [b0]); window.__pStep(1);
    let a = a0, b = b0;
    for (let i = 1; i <= 6; i++) {
      a = T(21, ax - i * spread, y); b = T(22, bx + i * spread, y);
      fire('touchmove', [a, b], [a, b]); window.__pStep(1);
    }
    fire('touchend', [b], [a]); fire('touchend', [], [b]); window.__pStep(20);
    return { z0: +z0.toFixed(3), z1: +m.userZoom().toFixed(3), moved: +Math.hypot(g.player.x - p0[0], g.player.y - p0[1]).toFixed(1), stick: g.input.stick.active };
  };
  const split = run(330, 520, 230, -16);     // one each side of the middle, pinched together: out
  m._userZoom = 1; window.__pStep(5);
  const left = run(120, 260, 260, 14);       // both on the stick's half, spread: in
  return { split, left };
});
check('camera: two fingers anywhere pinch (one each side: zoom out; both on the stick side: zoom in) and the captain stays put',
  pinchAny.split.z1 < pinchAny.split.z0 * 0.8 && pinchAny.left.z1 > pinchAny.left.z0 * 1.2 && pinchAny.split.moved < 4 && pinchAny.left.moved < 4 && !pinchAny.left.stick, pinchAny);
await reset();
// the + / - buttons on the right edge, and the + / - keys
const buttons = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  window.__pStep(2);
  const pick = (label) => { const u = g.ui.find((item) => item.label === label); return u ? { x: u.x, y: u.y, w: u.w, h: u.h } : null; };
  return { zin: pick('survival:ZOOM IN'), zout: pick('survival:ZOOM OUT'), w: g.renderer.w, h: g.renderer.h, z0: m.userZoom() };
});
let zoomSteps = null;
if (buttons.zin && buttons.zout) {
  await page.touchscreen.tap(buttons.zin.x + buttons.zin.w / 2, buttons.zin.y + buttons.zin.h / 2);
  const zIn = await page.evaluate(() => { window.__pStep(40); return window.__LN.survival.userZoom(); });
  await page.touchscreen.tap(buttons.zout.x + buttons.zout.w / 2, buttons.zout.y + buttons.zout.h / 2);
  await page.evaluate(() => window.__pStep(40));
  await page.touchscreen.tap(buttons.zout.x + buttons.zout.w / 2, buttons.zout.y + buttons.zout.h / 2);
  const zOut = await page.evaluate(() => { window.__pStep(40); return window.__LN.survival.userZoom(); });
  await page.keyboard.press('Equal');
  const zKey = await page.evaluate(() => { window.__pStep(40); return window.__LN.survival.userZoom(); });
  const moved = await page.evaluate(() => Math.round(window.__LN.survival.cameraOffset()));
  zoomSteps = { zIn: +zIn.toFixed(3), zOut: +zOut.toFixed(3), zKey: +zKey.toFixed(3), offset: moved };
}
check('camera: + / - on the right edge (between the counters and the thumb corner) zoom a step each, eased; the + key too',
  zoomSteps && Math.abs(zoomSteps.zIn - 1.35) < 0.01 && Math.abs(zoomSteps.zOut - 1 / 1.35) < 0.01 && Math.abs(zoomSteps.zKey - 1) < 0.01
    && buttons.zin.x > buttons.w - 70 && buttons.zin.y > 120 && buttons.zout.y + buttons.zout.h < buttons.h - 96,
  { ...buttons, steps: zoomSteps });
await reset();
// a flick glides on after the finger lifts, then stops
const flick = await (async () => {
  await page.touchscreen.touchStart(700, 200);
  await page.evaluate(() => window.__pStep(1));
  for (let i = 1; i <= 3; i++) {
    await page.touchscreen.touchMove(700 - i * 60, 200 - i * 14);
    await page.evaluate(() => window.__pStep(1));
  }
  await page.touchscreen.touchEnd();
  return page.evaluate(() => {
    const m = window.__LN.survival;
    window.__pStep(1);
    const atLift = m.cameraOffset();
    window.__pStep(20);
    const glided = m.cameraOffset();
    window.__pStep(120);
    const settled = m.cameraOffset();
    window.__pStep(30);
    return { atLift: Math.round(atLift), glided: Math.round(glided), settled: Math.round(settled), still: Math.round(m.cameraOffset()) };
  });
})();
check('camera: a flick glides on after the finger lifts, then comes to rest', flick.glided > flick.atLift + 40 && Math.abs(flick.still - flick.settled) < 2, flick);
await reset();
// all the way out: the whole bailey, wall to wall, on a sideways phone
const overview = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival; const r = g.renderer;
  const keep = m.keep();
  const B = g.mansion.bailey;
  m.completeNight && m.phase === 'night' && m.completeNight();
  window.__pStep(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  const home = m.hunterHome();
  g.player.x = home.x; g.player.y = home.y;
  m._userZoom = 0.42; m._zoomGoal = null;
  m.camPan.x = keep.x - home.x; m.camPan.y = keep.y - home.y + 40;
  r.snapCamera(keep.x, keep.y);
  window.__pStep(90);
  const corners = [[B.x, B.y], [B.x + B.w, B.y], [B.x, B.y + B.h], [B.x + B.w, B.y + B.h]].map(([x, y]) => r.worldToScreen(x, y));
  const inView = corners.every((c) => c.x >= 0 && c.x <= r.w && c.y >= 0 && c.y <= r.h);
  return { phase: m.phase, zoom: +r.cam.zoom.toFixed(3), corners: corners.map((c) => [Math.round(c.x), Math.round(c.y)]), inView };
});
check('camera: all the way out the whole bailey (2080 x 1520) fits a sideways phone', overview.inView && overview.zoom < 0.3, overview);
await shot('cam-4-overview-day');
await page.evaluate(() => { const g = window.__LN; const m = g.survival; m._userZoom = 1.6; window.__pStep(60); });
await shot('cam-5-closeup-day');
await reset();

/* ---- 2 + 3. the plots and the KayKit buildings ---- */
const kit = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  if (m.phase === 'night') { m.completeNight(); window.__pStep(2); }
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  m.gold = 400; m.wood = 400; m.keepLevel = 3; m.keepHp = m.keepHpMax();
  m._syncTerritory && m._syncTerritory();
  const want = { ward: 'barracks', south: 'sawmill', north: 'mine', 'south:tower': 'tower', 'east:tower': 'tower', east: 'mine', west: 'sawmill' };
  for (const [slot, type] of Object.entries(want)) { m.buildings[slot] = type; m.buildingLevels[slot] = 1; }
  m.buildingLevels.ward = 2; m.buildingLevels['south:tower'] = 3; m.buildingLevels.north = 2;
  m._syncTowers && m._syncTowers();
  g.survivalBakeDirty = true;
  const keep = m.keep();
  g.player.x = keep.x + 190; g.player.y = keep.y + 40;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(30);
  const d = window.__pW.diagnostics();
  const meshes = [...window.__pW.survivalBuildingMeshes.entries()].filter(([, mesh]) => mesh.visible).map(([slot, mesh]) => ({ slot, kit: !!mesh.userData.kit, level: mesh.userData.level, dressed: !!mesh.getObjectByName('survival-building-level') }));
  return { kit: d.buildingKit, meshes, plots: m.dayPoints().filter((p) => p.kind === 'slot').length };
});
check('assets: the KayKit kit is loaded and every placed building is a kit model (0 procedural)',
  kit.kit.ready && kit.kit.models >= 22 && kit.kit.kitBuildings === kit.meshes.length && kit.kit.proceduralBuildings === 0 && kit.meshes.length === 7, kit);
check('assets: every plot stands on its pad, so do the armory and the arms rack (the pack\'s racks), the yard has its well',
  kit.kit.pads === kit.plots + 2 && kit.plots === 15 && kit.kit.armoryKit && kit.kit.armsKit && kit.kit.wells === 1,
  { pads: kit.kit.pads, plots: kit.plots, armory: kit.kit.armoryKit, arms: kit.kit.armsKit, wells: kit.kit.wells });
check('assets: a levelled building shows it (Lv2/Lv3 flags and stock from the pack)',
  kit.meshes.filter((m) => m.level >= 2).every((m) => m.dressed) && kit.meshes.some((m) => m.level >= 2), kit.meshes);
await shot('plots-1-day-town');
const wideDay = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m._userZoom = 0.8;
  const keep = m.keep();
  g.player.x = keep.x + 60; g.player.y = keep.y + 230;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(40);
  return { zoom: +g.renderer.cam.zoom.toFixed(3) };
});
await shot('plots-2-gate-street');
await page.evaluate(() => { const g = window.__LN; const m = g.survival; m._userZoom = 1; window.__pStep(30); });

/* ---- construction: the pack's stages rise on the plot ---- */
const stage = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const spot = m.buildingSpot('north:tower');
  g.player.x = spot.x + 90; g.player.y = spot.y + 70;
  g.renderer.snapCamera(g.player.x, g.player.y);
  const ok = m.startBuild('tower', 'north:tower');
  const seen = new Set();
  let n = 0;
  while (m.builderJob && n++ < 3000) {
    window.__pOrig.call(g, 1 / 60);
    if (n % 20 === 0) { g.render(); const s = window.__pW.diagnostics().buildingKit.stage; if (s) seen.add(s); }
    if (n === 200) g.render();
  }
  window.__pStep(4);
  return { ok, stages: [...seen], built: m.buildings['north:tower'] };
});
check('build: a new building rises through the pack\'s three construction stages, then pops up', stage.ok && ['stageA', 'stageB', 'stageC'].every((s) => stage.stages.includes(s)) && stage.built === 'tower', stage);

/* ---- 4. the dock: one row in the thumb corner ---- */
const dock = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const spot = m.buildingSpot('south:tower');
  g.player.x = spot.x; g.player.y = spot.y;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(30);
  const pick = (re) => { const u = g.ui.find((item) => re.test(item.label || '')); return u ? { x: u.x, y: u.y, w: u.w, h: u.h, label: u.label } : null; };
  return { action: pick(/^survival:(BUILD|UPGRADE)/), night: pick(/START NIGHT/), view: { w: g.renderer.w, h: g.renderer.h } };
});
// the build-8 card + button: 232 x 100 over 210 x 56 (166 px tall, 35 k px2)
const dockH = dock.action ? dock.action.h : 999;
const dockArea = dock.action ? dock.action.w * dock.action.h + 182 * dock.action.h : 1e9;
check('cards: the build/upgrade dock is one row (<= 56 px tall, was 166) under half the old area',
  dock.action && dockH <= 56 && dock.action.y >= dock.view.h - 70 && dockArea < 35000 * 0.5, { ...dock, dockArea });
check('cards: NIGHT is a chip (<= 130 x 44, was 148 x 50), still top-left (R18a)',
  dock.night && dock.night.w <= 130 && dock.night.h <= 44 && dock.night.x < dock.view.w * 0.2 && dock.night.y < dock.view.h * 0.35, dock.night);
await shot('cards-1-dock-ballista');
const dock2 = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const keep = m.keep();
  m.keepHp = Math.round(m.keepHpMax() * 0.6);
  g.player.x = keep.x + 60; g.player.y = keep.y + 150;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(30);
  const items = g.ui.filter((item) => /^survival:(UPGRADE KEEP|REPAIR KEEP|UPGRADE MAX)/.test(item.label || '')).map((item) => ({ label: item.label, x: item.x, y: item.y, w: item.w, h: item.h }));
  return { here: m.dayContext() && m.dayContext().id, items };
});
check('cards: the keep\'s two actions (UPGRADE + REPAIR) share the same one-row dock', dock2.here === 'keep' && dock2.items.length === 2 && dock2.items.every((i) => i.h <= 56 && Math.abs(i.y - dock2.items[0].y) < 1), dock2);
await shot('cards-2-dock-keep');

/* ---- 5. BUILD 13 (docs/VISUAL-LAYOUT-RESEARCH.md §7, the cheap-but-visible
 * pass): the captain the brightest thing on the field (V8), names only near
 * the captain (V4), the coming night's gates shown by day (V10). V9 (the
 * merged damage numbers) is a rule, checked in tools/harness.mjs ---- */
await page.evaluate(async () => {
  window.__pV = (await import('./src/game/valen3d.js')).Valen3D;
  window.__pE = (await import('./src/game/envkit.js')).EnvKit;
});
// the captain's own pixels: the frame with him minus the frame without him
const captainLum = () => page.evaluate(() => {
  const g = window.__LN, W = window.__pW, V = window.__pV, E = window.__pE;
  const gl = E.renderer.getContext(), width = E.canvas.width, height = E.canvas.height;
  const frame = () => {
    E.renderer.render(W.scene, E.camera); gl.finish();
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  g.render();
  const look = V.lookState();
  // the captain's own colours: his see-through silhouette (BUILD 15) off meanwhile
  const xray = V.xrayState ? V.xrayState().on : false;
  if (V.setXray) V.setXray(false);
  const mean = (A, B) => {
    let n = 0, sum = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 18) {
        n++; sum += 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
      }
    }
    return { px: n, mean: n ? +(sum / n).toFixed(1) : 0 };
  };
  const pass = (state) => { V.setLook(state); const A = frame(); V.model.visible = false; const B = frame(); V.model.visible = true; return mean(A, B); };
  const on = pass(look);
  const bare = pass({ look: 0, rim: 0, lift: 0 });
  V.setLook(look);
  if (V.setXray) V.setXray(xray);
  g.render();
  return { phase: g.survival.phase, look, on, bare, diag: W.diagnostics().captainLook || null };
});
const lumNight = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.restart(); m._userZoom = 1.6; m._zoomGoal = null; m.recenterCamera(true);
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(60);
  return true;
}).then(captainLum);
const lumDay = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.completeNight(); window.__pStep(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  const home = m.hunterHome(); g.player.x = home.x; g.player.y = home.y;
  m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(60);
  return true;
}).then(captainLum);
await shot('b13-1-captain-day');
check('V8: the captain is bright — his own pixels average >= 70/255 by night and by day and >= 3x the bare Tripo texture (royal-blue tabard, leather hat and boots, rim light; the GLB untouched)',
  [lumNight, lumDay].every((r) => r.on.px > 400 && r.on.mean >= 70 && r.on.mean >= 3 * r.bare.mean && r.look.look === 1)
    && lumNight.look.rim > lumDay.look.rim,
  { night: { on: lumNight.on, bare: lumNight.bare, look: lumNight.look }, day: { on: lumDay.on, bare: lumDay.bare, look: lumDay.look } });

// V4: in the middle of the mines' yard (three empty circles ~160 px away;
// keep Lv2 opens the third)
const near = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  for (const id of Object.keys(m.buildings)) delete m.buildings[id];
  m.keepLevel = 2;
  g.survivalBakeDirty = true;
  m._userZoom = 1; m._zoomGoal = null;
  const spots = ['north', 'east', 'southeast'].map((id) => m.buildingSpot(id));
  g.player.x = spots.reduce((a, q) => a + q.x, 0) / 3; g.player.y = spots.reduce((a, q) => a + q.y, 0) / 3;
  m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(40);
  const L = g._survivalLabels || {};
  const reach = spots.map((q) => Math.round(Math.hypot(q.x - g.player.x, q.y - g.player.y)));
  return { names: L.names, icons: L.icons, pills: L.pills, overview: L.overview, reach, here: m.dayContext() && m.dayContext().id };
});
await shot('b13-2-names-near');
const far = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.buildings.north = 'mine'; m.buildingLevels.north = 1;
  m.buildings.ward = 'barracks'; m.buildingLevels.ward = 1;
  m.buildings.south = 'sawmill'; m.buildingLevels.south = 1;
  g.survivalBakeDirty = true;
  const keep = m.keep(); const home = m.hunterHome();
  g.player.x = home.x; g.player.y = home.y;
  m._userZoom = 0.42; m._zoomGoal = null;
  m.camPan.x = keep.x - home.x; m.camPan.y = keep.y - home.y + 40;
  g.renderer.snapCamera(keep.x, keep.y);
  window.__pStep(60);
  const L = g._survivalLabels || {};
  return { names: L.names, icons: L.icons, pills: L.pills, overview: L.overview, user: m.userZoom(), tonight: L.tonight, plan: m.tonightPlan().map((r) => `${r.id} ${r.swarm}/${r.individuals}/${r.breakers}`) };
});
await shot('b13-3-overview-tonight');
check('V4: a circle spells its name and cost only near the captain — never more than 2 at once (3 empty circles within reach: 2 names), and the overview shows icons only (0 names, 0 pills)',
  near.names === 2 && near.icons >= 1 && !near.overview && near.reach.every((d) => d <= 380)
    && far.overview && far.names === 0 && far.pills === 0 && far.icons >= 4,
  { near, far: { names: far.names, icons: far.icons, pills: far.pills, user: far.user } });
const plannedIds = far.plan.map((r) => r.split(' ')[0]);
check('V10: by day every gate the coming night will hit is marked (a red badge in view, a red edge pointer with the count out of view), the same gates as the night\'s plan',
  far.tonight && far.tonight.length === plannedIds.length && plannedIds.length >= 3
    && far.tonight.every((row, i) => row.id === plannedIds[i] && row.total > 0) && far.tonight.some((row) => row.inView),
  { plan: far.plan, drawn: far.tonight });

/* ---- 6. BUILD 14 (2026-10-17: "senjata pasukan bisa di-upgrade"): the
 * garrison's crossbows, bought at the arms rack, on every guard and in
 * their bolts. The rules (cost, damage, rate, pierce, save) are in
 * tools/harness.mjs ---- */
const b14a = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.restart();
  m.completeNight(); window.__pStep(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  m.gold = 99; m.wood = 99;
  m._userZoom = 1; m._zoomGoal = null;
  const keep = m.keep();
  // between the two stations: both show their level, both their arrow
  g.player.x = keep.x + 465; g.player.y = keep.y + 150;
  m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(30);
  const stations = (g._survivalLabels && g._survivalLabels.stations) || [];
  const arms = m.armsSpot();
  g.player.x = arms.x; g.player.y = arms.y + 10;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pStep(30);
  const pick = (re) => { const u = g.ui.find((item) => re.test(item.label || '')); return u ? { x: u.x, y: u.y, w: u.w, h: u.h, label: u.label, disabled: !!u.disabled } : null; };
  const d = window.__pW.diagnostics();
  return { stations, here: m.dayContext() && m.dayContext().kind, button: pick(/^survival:UPGRADE ARMS/), display: d.buildingKit.armsDisplay, bows: d.guardBows };
});
await shot('b14-1-arms-card');
check('B14: the arms rack beside the armory — both stations show their level near the captain with the gold arrow when affordable; at the rack one UPGRADE ARMS LV2 button in the dock, the rack shows the Lv1 bow, every guard holds it',
  b14a.stations.length === 2 && b14a.stations.every((st) => st.near && st.arrow) && b14a.here === 'arms'
    && b14a.button && b14a.button.label === 'survival:UPGRADE ARMS LV2' && b14a.button.h <= 56 && !b14a.button.disabled
    && b14a.display === 1 && b14a.bows.length >= 1 && b14a.bows.every((lv) => lv === 1), b14a);
const b14b = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const fx0 = (window.__pW.diagnostics().fx || { played: {} }).played.arm || 0;
  const u = g.ui.find((item) => /^survival:UPGRADE ARMS LV2/.test(item.label || ''));
  if (u && u.run) u.run(); else m.startBuild('arms');
  const job = m.builderJob && m.builderJob.kind;
  window.__pStep(30);
  const working = g.ui.some((item) => /UPGRADING ARMS/.test(item.label || ''));
  window.__pFast(() => !!m.builderJob);
  m.floaters.length = m.floaters.length; // the pops are pushed on completion
  const pops = m.floaters.filter((f) => f.icon === 'crossbow' && f.text === 'Lv2').length;
  window.__pStep(4);
  const d2 = window.__pW.diagnostics();
  m.gold = 99; m.wood = 99;
  m.startBuild('arms');
  window.__pFast(() => !!m.builderJob);
  // the guards up close (they stand by the keep by day)
  const a = m.guards[0], b = m.guards[1] || a;
  m._userZoom = 1.6; m._zoomGoal = null;
  g.player.x = 260; g.player.y = 30;
  m.camPan.x = (a.x + b.x) / 2 - g.player.x; m.camPan.y = (a.y + b.y) / 2 - 10 - g.player.y;
  g.renderer.snapCamera((a.x + b.x) / 2, (a.y + b.y) / 2);
  window.__pStep(40);
  const d3 = window.__pW.diagnostics();
  return { job, working, pops, guards: m.guards.length, lv2: { bows: d2.guardBows, display: d2.buildingKit.armsDisplay }, lv3: { level: m.armsLevel, bows: d3.guardBows, twoHanded: d3.guardTwoHanded, display: d3.buildingKit.armsDisplay }, armFx: ((d3.fx || { played: {} }).played.arm || 0) - fx0 };
});
await shot('b14-2-guards-lv3');
check('B14: bought, the rack works on it (UPGRADING ARMS), then every guard holds the Lv2 royal-blue bow (a "Lv2" pop over each, a flash on each) and the rack shows it; Lv3 is the blue-and-gold arbalest held two-handed',
  b14b.job === 'arms' && b14b.working && b14b.pops === b14b.guards && b14b.pops > 0
    && b14b.lv2.bows.length >= 1 && b14b.lv2.bows.every((lv) => lv === 2) && b14b.lv2.display === 2
    && b14b.lv3.level === 3 && b14b.lv3.bows.every((lv) => lv === 3) && b14b.lv3.twoHanded === b14b.lv3.bows.length && b14b.lv3.display === 3
    && b14b.armFx >= b14b.guards * 2, b14b);
const b14c = await page.evaluate(async () => {
  const g = window.__LN; const m = g.survival;
  const { SurvivalCrowdZombie: Crowd } = await import('./src/game/survival.js');
  m.startNight();
  m.armsLevel = 3;
  m.keepHp = 99999;
  if (m.cine) m.cine = null;
  m.waveIndex = 99; m.breakerIndex = 99; m.individualIndex = 99;
  g.enemies.length = 0; g.bolts.length = 0;
  const south = m.entranceById('southGate');
  south.hp = south.hpMax = 99999;
  m.guards.length = Math.min(2, m.guards.length);
  m.guards.forEach((gd, i) => { const post = m._doorPost(south, i); gd.x = post.x; gd.y = post.y + 6; m._setGuardPost(gd, post); });
  m._guardAssignT = 99;
  const park = () => { g.player.x = south.x - 20; g.player.y = south.y - 130; g.player.vx = 0; g.player.vy = 0; m._userZoom = 1.5; m._zoomGoal = null; m.camPan.x = 0; m.camPan.y = 0; m._guardAssignT = 99; };
  park(); g.renderer.snapCamera(g.player.x, g.player.y);
  window.__pFast(() => { park(); return m.guards.some((gd) => gd.lift < 1) && m.elapsed < 20; });
  for (let k = 0; k < 7; k++) {
    const z = new Crowd(south.x - 150 + k * 50, south.y + 150 + (k % 2) * 40, south, 0, 1);
    z.hp = z.hpMax = 99999; z.update = () => {};
    g.enemies.push(z);
  }
  const until = Math.max(m.elapsed + 1.2, 6);
  window.__pFast(() => { park(); return m.elapsed < until; });
  m.guards.forEach((gd, i) => { gd.cd = 0.02 + i * 0.05; });
  for (let i = 0; i < 9; i++) { park(); window.__pStep(1); }
  const meshes = [...window.__pW.bolts.values()].filter((mesh) => mesh.visible && mesh.name === 'guard-bolt-3d');
  return { up: m.guards.filter((gd) => gd.lift === 1).length, bolts: g.bolts.filter((b) => b.guard).map((b) => ({ arms: b.arms, pierce: b.pierce || 0, damage: b.damage })), meshLevels: meshes.map((mesh) => mesh.userData.armsLevel) };
});
await shot('b14-3-night-gold-bolts');
check('B14: at night a Lv3 guard up on its tower shoots the gold bolt (18 damage, runs on through a body), drawn as the Lv3 bolt',
  // (a bolt that has already run through one body has pierce 0 left)
  b14c.up >= 1 && b14c.bolts.length >= 1 && b14c.bolts.every((b) => b.arms === 3 && b.pierce <= 1 && b.damage === 18) && b14c.bolts.some((b) => b.pierce === 1)
    && b14c.meshLevels.length >= 1 && b14c.meshLevels.every((lv) => lv === 3), b14c);

/* ---- 7. BUILD 15 (docs/VISUAL-LAYOUT-RESEARCH.md §7 V6 / V7): the night
 * fight in sight — the captain seen through cover, the felled kill zones,
 * the squat south / east towers, the frame that leans onto the fight. The
 * rules are in tools/harness.mjs, the sightlines in tools/survival-map.mjs ---- */
const b15a = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const W = window.__pW, V = window.__pV, E = window.__pE;
  m.startNight();
  if (m.cine) m.cine = null;
  m.keepHp = 99999;
  m.waveIndex = 99; m.breakerIndex = 99; m.individualIndex = 99;
  g.enemies.length = 0; g.bolts.length = 0;
  // outside the north gate, 60 px east of its middle: from the camera the
  // gate's east tower stands in front of him (survival-map: head hidden)
  const north = m.entranceById('northGate');
  const park = () => { g.player.x = north.x + 60; g.player.y = north.y - 80; g.player.vx = 0; g.player.vy = 0; m._userZoom = 1.3; m._zoomGoal = null; m.camPan.x = 0; m.camPan.y = 0; };
  park(); m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  for (let i = 0; i < 40; i++) { park(); window.__pStep(1); }
  const gl = E.renderer.getContext(), width = E.canvas.width, height = E.canvas.height;
  const frame = () => {
    E.renderer.render(W.scene, E.camera); gl.finish();
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const diff = (A, B) => {
    let n = 0, r = 0, b = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 18) { n++; r += A[i]; b += A[i + 2]; }
    }
    return { n, r: n ? Math.round(r / n) : 0, b: n ? Math.round(b / n) : 0 };
  };
  const state0 = V.xrayState();
  V.setXray(true);
  const withX = frame();
  V.model.visible = false;
  const none = frame();
  V.model.visible = true;
  V.setXray(false);
  const plain = frame();
  V.setXray(true);
  g.render();
  const seen = diff(withX, none), bare = diff(plain, none);
  // the silhouette's own pixels: on with the twin, not with the plain body
  let sil = 0, silB = 0, silR = 0;
  for (let i = 0; i < withX.length; i += 4) {
    const dX = Math.abs(withX[i] - plain[i]) + Math.abs(withX[i + 1] - plain[i + 1]) + Math.abs(withX[i + 2] - plain[i + 2]);
    if (dX > 18) { sil++; silB += withX[i + 2]; silR += withX[i]; }
  }
  return { state0, xray: V.xrayState(), seen, bare, sil, silBlue: sil ? Math.round(silB / sil) : 0, silRed: sil ? Math.round(silR / sil) : 0, diag: W.diagnostics().sightlines };
});
await shot('b15-1-captain-through-tower');
check('B15: the captain is seen through cover — behind the north gate\'s east tower his figure shows through it as a blue silhouette (a twin of his skinned mesh, GreaterDepth, survival only); in plain sight he paints over it',
  b15a.state0.on && b15a.xray.on && b15a.xray.twins >= 1 && b15a.sil >= 300 && b15a.silBlue > b15a.silRed + 40 && b15a.seen.n > b15a.bare.n,
  b15a);
const b15b = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const W = window.__pW;
  // two guards up on their posts: the south gate's bastion, the north gate's
  // tower. The climb is the sim's (tools/harness.mjs BUILD 15 #2: they climb
  // and their bolts leave from the bastion); here, how high World3D stands them
  const south = m.entranceById('southGate'), north = m.entranceById('northGate');
  m.guards.length = Math.min(2, m.guards.length);
  const posts = [m._doorPost(south, 0), m._doorPost(north, 0)];
  m.guards.forEach((gd, i) => { const post = posts[i]; gd.x = post.x; gd.y = post.y; m._setGuardPost(gd, post); });
  m._guardAssignT = 99;
  m.guards.forEach((gd, i) => { gd.lift = 1; gd.liftPost = posts[i].wall; gd.moving = false; gd.path = null; });
  g.render(); g.render();
  const ys = m.guards.map((gd, i) => {
    const mesh = W.survivalGuardMeshes && W.survivalGuardMeshes[i];
    return mesh ? +mesh.position.y.toFixed(1) : null;
  });
  const lifts = m.guards.map((gd) => gd.lift);
  const stumps = W.scene.getObjectByName('forest-felled-trunk-stumps-3d');
  const cuts = W.scene.getObjectByName('forest-felled-stump-cuts-3d');
  const d = W.diagnostics().sightlines;
  // the south gate up close: the bastions, the stumps in front
  const park = () => { g.player.x = south.x + 40; g.player.y = south.y - 90; g.player.vx = 0; g.player.vy = 0; m._userZoom = 1; m._zoomGoal = null; m.camPan.x = 0; m.camPan.y = 0; m._guardAssignT = 99; };
  park(); m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  for (let i = 0; i < 20; i++) { park(); window.__pStep(1); }
  return { lifts, ys, stumps: stumps ? stumps.count : 0, cuts: cuts ? cuts.count : 0, d };
});
await shot('b15-2-south-gate-bastions');
check('B15: the south / east gates have squat bastions (no bridge over them; the north / west keep their towers and bridges), the south-east corner is cut down, the felled kill zones show stumps; a guard on the south bastion stands ~68 px lower than one on the north tower',
  b15b.d && b15b.d.felled >= 10 && b15b.stumps === b15b.d.felled && b15b.cuts === b15b.d.felled
    && b15b.d.lowTowers && b15b.d.lowTowers.length === 5 && b15b.d.lowTowers.includes('corner')
    && ['southGate:-1', 'southGate:1', 'eastGate:-1', 'eastGate:1'].every((id) => b15b.d.lowTowers.includes(id))
    && JSON.stringify((b15b.d.bridges || []).slice().sort()) === JSON.stringify(['northGate', 'westGate'])
    && b15b.lifts.every((l) => l === 1) && b15b.ys[0] != null && b15b.ys[1] != null && Math.abs((b15b.ys[1] - b15b.ys[0]) - 68) <= 2,
  b15b);
const b15c = await page.evaluate(async () => {
  const g = window.__LN; const m = g.survival;
  const { SurvivalCrowdZombie: Crowd } = await import('./src/game/survival.js');
  const south = m.entranceById('southGate');
  g.enemies.length = 0; g.bolts.length = 0;
  m.guards.length = 0; m.survivors = 0;
  const park = () => { g.player.x = south.inside.x; g.player.y = south.inside.y - 60; g.player.vx = 0; g.player.vy = 0; m._userZoom = 1; m._zoomGoal = null; m.camPan.x = 0; m.camPan.y = 0; };
  park(); m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  m._lean = null;
  for (let i = 0; i < 10; i++) {
    const z = new Crowd(south.outside.x - 90 + (i % 5) * 45, south.outside.y + 70 + Math.floor(i / 5) * 60, south, 0, 1);
    z.hp = z.hpMax = 99999; z.update = () => {};
    g.enemies.push(z);
  }
  for (let i = 0; i < 180; i++) { park(); window.__pStep(1); }
  const knot = g.enemies.reduce((a, e) => ({ x: a.x + e.x / g.enemies.length, y: a.y + e.y / g.enemies.length }), { x: 0, y: 0 });
  const sk = g.renderer.worldToScreen(knot.x, knot.y), sc = g.renderer.worldToScreen(g.player.x, g.player.y);
  return { lean: m.threatLean(), knot: { x: Math.round(sk.x), y: Math.round(sk.y) }, captain: { x: Math.round(sc.x), y: Math.round(sc.y) }, h: g.renderer.h, w: g.renderer.w };
});
await shot('b15-3-fight-frame');
check('B15: holding the main gate from inside, the night frame leans onto the knot outside — knot and captain both in the playfield (below the HUD band, above the stick / FLARE band)',
  b15c.lean.w > 0.9 && b15c.lean.y > 120 && b15c.knot.y > 85 && b15c.knot.y < b15c.h - 105 && b15c.captain.y > 85 && b15c.captain.y < b15c.h - 95,
  b15c);
// clean up for anything after: the fake knot goes
await page.evaluate(() => { const g = window.__LN; g.enemies.length = 0; g.survival._lean = null; });

/* ---- 8. BUILD 16 (docs/UX-REPLAY-RESEARCH.md §5 R5 / R6): night tempo —
 * a cleared night ends early (NIGHT CLEARED!, the light warming to an early
 * dawn, the gold it saved on the dawn card), the last few marked while they
 * still fight, every wave called with its gate. The rules are in
 * tools/harness.mjs, the tempo in tools/survival-uxprobe.mjs ---- */
await page.evaluate(async () => {
  window.__pV = window.__pV || (await import('./src/game/valen3d.js')).Valen3D;
  window.__pE = window.__pE || (await import('./src/game/envkit.js')).EnvKit;
  window.__pS = await import('./src/game/survival.js');
  const g = window.__LN;
  // a night as the day's START NIGHT opens it
  window.__pNight = (day) => {
    const m = g.survival;
    m.restart();
    m.phase = 'day'; m.day = day; m.nightsCompleted = day - 1; m.rewardAck = day - 1;
    g.screen = 'playing'; g.uiPanel = 'survival-day';
    m.startNight();
    if (m.cine) m.cine = null;
    m.keepHp = 99999;
    const home = m.hunterHome();
    g.player.x = home.x; g.player.y = home.y; g.player.vx = 0; g.player.vy = 0;
    m._userZoom = 1; m._zoomGoal = null; m.camPan.x = 0; m.camPan.y = 0;
    m.recenterCamera(true); g.renderer.snapCamera(g.player.x, g.player.y);
  };
  // the mean colour of the ground in the 3D frame (a band across the lower middle)
  window.__pGround = () => {
    const E = window.__pE, W = window.__pW;
    const gl = E.renderer.getContext(), width = E.canvas.width, height = E.canvas.height;
    E.renderer.render(W.scene, E.camera); gl.finish();
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.45); y += 2) {
      for (let x = Math.floor(width * 0.1); x < Math.floor(width * 0.9); x += 2) {
        const i = (y * width + x) * 4; r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++;
      }
    }
    return { r: Math.round(r / n), g: Math.round(gg / n), b: Math.round(b / n), lum: Math.round((0.299 * r + 0.587 * gg + 0.114 * b) / n) };
  };
  // one pixel of the HUD (the 2D canvas over the 3D one), in CSS px
  window.__pHud = (x, y) => {
    const c = g.canvas; const k = c.width / g.renderer.w;
    const d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
});
const b16a = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const { SurvivalCrowdZombie: Crowd } = window.__pS;
  window.__pNight(2);
  m.buildings.north = 'mine'; m.buildingLevels.north = 1;
  m.elapsed = 50; m.waveIndex = 3; m.breakerIndex = 1; m.individualIndex = 2;
  m.nightStats.spawned = 40;
  g.enemies.length = 0; g.bolts.length = 0;
  const last = new Crowd(g.player.x + 150, g.player.y + 40, m.entranceById('southGate'), 0, 2);
  last._inHouse = true; last.hp = last.hpMax = 40;
  g.enemies.push(last);
  window.__pStep(2);
  // a spot of the night pill's own face (right of its clock, above its timeline)
  const pillAt = [g.renderer.w / 2 + Math.min(156, g.renderer.w - 216) / 2 - 12, 38];
  const night = { ground: window.__pGround(), pill: window.__pHud(...pillAt) };
  // the sim runs on undrawn (window.__pFast) and draws the moments it is
  // judged at: at DPR 2 hundreds of queued frames stall a screenshot
  window.__pFast(() => !m.cleared && m.phase === 'night');
  const cleared = m.cleared ? { ...m.cleared } : null;
  window.__pStep(2);
  const at = { ground: window.__pGround(), pill: window.__pHud(...pillAt), banner: m.banner && { kind: m.banner.kind, text: m.banner.text, sub: m.banner.sub } };
  return { cleared, night, at };
});
await shot('b16-1-night-cleared');
const b16a2 = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  let n = 0;
  window.__pFast(() => n++ < 56);
  window.__pStep(2);
  return { blend: +m.dawnBlend().toFixed(2), ground: window.__pGround(), phase: m.phase };
});
await shot('b16-2-dawn-warming');
const b16a3 = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  // the keep as a night leaves it (the scripted 99999 would read as a patch on the card)
  m.keepHp = Math.min(m.keepHp, m.keepHpMax());
  window.__pFast(() => m.phase === 'night');
  let n = 0;
  window.__pFast(() => n++ < 28);
  window.__pStep(2);
  const rw = m.lastRewards || {};
  return { phase: m.phase, panel: g.uiPanel, pending: m.rewardPending(), cleared: rw.cleared || null, endAt: rw.endAt, ground: window.__pGround() };
});
await shot('b16-3-dawn-card');
check('B16: a cleared night ends early — NIGHT CLEARED! with the gold it saves, the night pill turns to DAWN, the light warms over the 2 s to the early dawn, and the dawn card says NIGHT 2 CLEARED with its clock-gold row',
  b16a.cleared && b16a.at.banner && b16a.at.banner.kind === 'cleared' && b16a.at.banner.text === 'NIGHT CLEARED!'
    && /^DAWN COMES EARLY · \+\d+ GOLD$/.test(b16a.at.banner.sub)
    && b16a.night.pill[2] > b16a.night.pill[0] && b16a.at.pill[0] > 200 && b16a.at.pill[0] > b16a.at.pill[2] + 60
    && Math.abs(b16a2.blend - 0.5) < 0.06 && b16a2.phase === 'night'
    && b16a2.ground.lum > b16a.at.ground.lum + 4 && b16a3.ground.lum > b16a2.ground.lum
    && b16a3.phase === 'day' && b16a3.panel === 'survival-day' && b16a3.pending && b16a3.cleared && b16a3.cleared.bonus === b16a.cleared.bonus
    && Math.abs(b16a3.endAt - b16a.cleared.dawnAt) < 0.05,
  { cleared: b16a.cleared, banner: b16a.at.banner, pill: [b16a.night.pill, b16a.at.pill], ground: [b16a.night.ground.lum, b16a.at.ground.lum, b16a2.ground.lum, b16a3.ground.lum], blend: b16a2.blend, card: b16a3 });
// clear the card for what comes next
await page.evaluate(() => { const m = window.__LN.survival; if (m.rewardPending()) m.ackRewards(); });

const b16b = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  window.__pNight(2);
  g.enemies.length = 0; g.bolts.length = 0;
  // the wave's call shows once the night's own banner has had its say
  window.__pFast(() => !(m.banner && m.banner.kind === 'wave'));
  let n = 0;
  window.__pFast(() => n++ < 10);
  window.__pStep(2);
  return { at: +m.elapsed.toFixed(2), wave: m.waveIndex, banner: m.banner && { kind: m.banner.kind, text: m.banner.text, sub: m.banner.sub }, horns: m.horns || 0 };
});
await shot('b16-4-wave-call');
check('B16: Night 2 sends its first wave at once and calls it with its gate and count (WAVE 1/3 · WEST GATE ×24), the horde\'s horn blown',
  b16b.wave >= 1 && b16b.banner && b16b.banner.text === 'WAVE 1/3' && b16b.banner.sub === 'WEST GATE ×24' && b16b.horns >= 1,
  b16b);

const b16c = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  const { SurvivalCrowdZombie: Crowd, SurvivalIndividualZombie: Ind } = window.__pS;
  window.__pNight(3);
  m.elapsed = 60; m.waveIndex = 3; m.breakerIndex = 2; m.individualIndex = 2;
  m.nightStats.spawned = 90;
  g.enemies.length = 0; g.bolts.length = 0;
  const west = m.entranceById('westGate');
  west.hp = west.hpMax = 99999;
  const far1 = new Ind(1400, 900, m.entranceById('eastGate'), 3, 0);
  const far2 = new Ind(-1300, -950, m.entranceById('northGate'), 3, 1);
  const claw = new Crowd(west.outside.x - 40, west.outside.y, west, 0, 3);
  claw.hp = claw.hpMax = 99999;
  g.enemies.push(far1, far2, claw);
  m.guards.length = 0; m.survivors = 0;
  const flee = [];
  let n = 0;
  window.__pFast(() => n++ < 6);
  flee.push(!!far1.fleeing, !!far2.fleeing, !!claw.fleeing);
  // the night's own banner has its 2.6 s first; the call comes after it
  n = 0;
  window.__pFast(() => n++ < 163);
  window.__pStep(2);
  const w = g.renderer.w, h = g.renderer.h;
  // the clawing one is off the screen (the west gate: up and left on the
  // screen): a red pointer on the playfield's frame (with the gate's), not
  // over the captain
  const cap = g.renderer.worldToScreen(g.player.x, g.player.y);
  const sk = (g._edgeMarks || []).find((mk) => mk.icon === 'skull');
  let red = 0;
  if (sk) {
    for (let y = sk.y - 22; y <= sk.y + 22; y += 2) for (let x = sk.x - 22; x <= sk.x + 22; x += 2) {
      const [r, gg, b] = window.__pHud(x, y);
      if (r > 200 && gg < 110 && b < 110) red++;
    }
  }
  return {
    fleeing: flee, alive: m.aliveEnemies(), stragglers: m.stragglers, gone: !g.enemies.includes(far1) && !g.enemies.includes(far2),
    banner: m.banner && { kind: m.banner.kind, text: m.banner.text }, red, marks: (g._edgeMarks || []).slice(),
    captain: { x: Math.round(cap.x), y: Math.round(cap.y) }, w, h,
    onScreen: (() => { const s = g.renderer.worldToScreen(claw.x, claw.y); return s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h; })(),
  };
});
await shot('b16-5-last-one');
const skullMark = b16c.marks.find((mk) => mk.icon === 'skull');
const gateMark = b16c.marks.find((mk) => mk.icon === 'door' || mk.icon === 'swarm');
// on the frame the night's pointers run round (nightPointerBand: 84 px under
// the top, 100 over the bottom, 28 in from the sides; BUILD 15's sat on a
// 92 px band through the middle of a sideways phone, over the captain)
const onFrame = (mk) => mk.x <= 30 || mk.x >= b16c.w - 30 || mk.y <= 84 + 12 || mk.y >= b16c.h - 100 - 12;
check('B16: the night\'s last few — the two out of the fight run for the trees and are gone, the one clawing the west gate is called LAST 1! and pointed at by a red pointer on the playfield\'s frame (a sideways phone\'s night pointers run round its edge now, not over the captain)',
  b16c.fleeing[0] && b16c.fleeing[1] && !b16c.fleeing[2] && b16c.gone && b16c.alive === 1 && b16c.stragglers && b16c.banner && b16c.banner.text === 'LAST 1!'
    && !b16c.onScreen && b16c.red >= 20 && skullMark && gateMark && [skullMark, gateMark].every((mk) => onFrame(mk) && Math.hypot(mk.x - b16c.captain.x, mk.y - b16c.captain.y) > 140),
  b16c);
await page.evaluate(() => { const g = window.__LN; g.enemies.length = 0; });

/* ---- 9. BUILD 17 (docs/UX-REPLAY-RESEARCH.md §5 R8): the round rotates and
 * the day says which round it is. Nights 2–3 come at the gates in an order of
 * their own per run; the TONIGHT chip in the day's top band reads that order
 * and what the night sends, and each gate's badge carries the wave that
 * reaches it first. The rules (authored rotations, the seed in the save, the
 * night really playing what the day announced) are in tools/harness.mjs ---- */
const b17day = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  // a real day 2: the run restarted, its first night survived, its card taken
  m.restart();
  m.completeNight(); window.__pStep(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  m.gold = 60; m.wood = 40;
  const keep = m.keep(); const home = m.hunterHome();
  g.player.x = home.x; g.player.y = home.y;
  m._userZoom = 0.42; m._zoomGoal = null;
  m.camPan.x = keep.x - home.x; m.camPan.y = keep.y - home.y + 40;
  g.renderer.snapCamera(keep.x, keep.y);
  window.__pStep(60);
  const L = g._survivalLabels || {};
  const w = g.renderer.w, h = g.renderer.h;
  const chip = L.tonightChip || null;
  // the band it must sit in: clear of PAUSE, the DAY pill and the counters
  const pillW = Math.min(212, w - 216);
  const band = { pauseRight: 8 + 44, pillLeft: w / 2 - pillW / 2, countersLeft: w - 88 - 8, top: 48 };
  // is it really painted? sample its own face and its text line
  const face = chip ? window.__pHud(chip.box.x + 8, chip.box.y + chip.box.h / 2) : null;
  let ink = 0;
  if (chip) {
    // the order line is 12 px centred on box.y + 31: sample the band it lives
    // in, not one pixel row a glyph may straddle
    for (let y = chip.box.y + 26; y <= chip.box.y + 36; y += 2) {
      for (let x = Math.round(chip.box.x) + 6; x < Math.round(chip.box.x + chip.box.w) - 6; x += 2) {
        const [r, gg, b] = window.__pHud(x, y);
        if (r > 200 && gg > 200 && b > 200) ink++;
      }
    }
  }
  return {
    day: m.day, phase: m.phase, w, h, chip, band, face, ink,
    plan: m.nightDoors().slice(), call: m.tonightCall(),
    badges: (L.tonight || []).slice(),
    seed: m.runSeed,
  };
});
await shot('b17-1-tonight-chip');
// the same screen with two other runs' seeds: the round turns
const b17turn = [];
for (const seed of [20276850, 20261013]) {
  const row = await page.evaluate((sd) => {
    const g = window.__LN; const m = g.survival;
    m.seedBase = sd; m.runSeed = m.newRunSeed();
    window.__pStep(3);
    const L = g._survivalLabels || {};
    return { seed: sd, runSeed: m.runSeed, chip: L.tonightChip || null, plan: m.nightDoors().slice(), badges: (L.tonight || []).slice() };
  }, seed);
  b17turn.push(row);
  await shot(`b17-2-tonight-chip-s${seed}`);
}
// and at night the chip is gone: the night HUD is BUILD 16's
const b17night = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  window.__pNight(2);
  window.__pStep(4);
  const L = g._survivalLabels || {};
  return { phase: m.phase, chip: L.tonightChip || null, key: 'tonightChip' in L };
});
const chipOk = b17day.chip;
const chipInBand = chipOk && chipOk.box.y >= 8 && chipOk.box.y + chipOk.box.h <= b17day.band.top + 8
  && chipOk.box.x >= b17day.band.pauseRight && chipOk.box.x + chipOk.box.w <= b17day.band.pillLeft
  && chipOk.box.h <= 48;
// named, so a FAIL says which part of the chip did not hold
const b17flags = {
  drawn: !!chipOk,
  inBand: !!chipInBand,
  day2: b17day.phase === 'day' && b17day.day === 2,
  order: !!(chipOk && chipOk.order.replace(/\s+/g, '').length),
  counts: !!(chipOk && chipOk.counts.length >= 2),
  callMatches: !!(chipOk && chipOk.first === b17day.call.first && chipOk.breakers === b17day.call.breakers),
  painted: !!(b17day.face && b17day.face[2] > b17day.face[0] + 20),
  legible: b17day.ink >= 8,
  badges: b17day.badges.length >= 3 && b17day.badges.filter((r) => r.order >= 1).length === 3,
  goneAtNight: b17night.phase === 'night' && !b17night.chip,
};
const S = await page.evaluate(() => window.__pS.gateShort(window.__LN.survival.entranceById('westGate'), 'wide'));
const wantOrder = b17day.plan.slice(0, 3).join(' → ');
check('B17: the day announces tonight in the top band — a TONIGHT chip naming the gates in the order the night comes at them and what it sends, inside the 48 px band, clear of PAUSE, the DAY pill and the counters, painted and legible; each gate\'s badge carries the wave that reaches it first; at night the chip is gone (the night HUD is BUILD 16\'s)',
  Object.values(b17flags).every(Boolean),
  { flags: b17flags, chip: chipOk, band: b17day.band, plan: b17day.plan, call: { first: b17day.call.first, breakers: b17day.call.breakers }, face: b17day.face, ink: b17day.ink, badges: b17day.badges.map((b) => `${b.id}[${b.order}]`), night: b17night, sample: S, wantOrder });
const orders = [b17day, ...b17turn].map((r) => (r.chip && r.chip.order) || '');
const distinct = new Set(orders).size;
check(`B17: the round turns with the run — three seeds on the same day 2 screen give ${distinct} different TONIGHT orders (${orders.join(' | ')}), each the plan its night plays, and each badge's wave pip follows it`,
  distinct >= 3 && orders.every(Boolean)
    && [b17day, ...b17turn].every((r) => r.chip && r.chip.order.replace(/\s+/g, ' ').length > 0
      && r.badges.filter((b) => b.order >= 1).length === 3
      && r.badges.every((b) => b.order === 0 || r.plan.slice(0, 3).includes(b.id))),
  { orders, plans: [b17day, ...b17turn].map((r) => r.plan.join(' → ')), runSeeds: [b17day, ...b17turn].map((r) => r.seed || r.runSeed) });

/* ---- 10. BUILD 18 (R18b/c): NIGHT is a hold, not a tap ------------------- */
const b18day = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.restart();
  m.completeNight(); window.__pStep(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  m.gold = 60; m.wood = 40;
  window.__pStep(3);
  const u = g.ui.find((it) => it.label === 'survival:START NIGHT');
  return { box: u ? { x: u.x, y: u.y, w: u.w, h: u.h, hold: u.hold } : null, phase: m.phase, day: m.day, gold: Math.floor(m.gold) };
});
const press = (type, x, y) => page.evaluate(([tp, px, py]) => {
  const c = window.__LN.input.canvas;
  const rect = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent(tp, { clientX: rect.left + px, clientY: rect.top + py, button: 0, bubbles: true, cancelable: true }));
}, [type, x, y]);
const b18cx = b18day.box.x + b18day.box.w / 2, b18cy = b18day.box.y + b18day.box.h / 2;
// a tap: press, a sixth of the ring, leave
await press('mousedown', b18cx, b18cy);
await page.evaluate(() => window.__pStep(10));
const b18mid = await page.evaluate(() => {
  const g = window.__LN;
  const u = g.ui.find((it) => it.label === 'survival:START NIGHT');
  return { holdT: u ? +(u.holdT || 0).toFixed(3) : null, note: ((g._survivalLabels || {}).nightHold || {}).note || null, phase: g.survival.phase };
});
await shot('b18-1-hold-ring');
await press('mouseup', b18cx, b18cy);
await page.evaluate(() => window.__pStep(3));
const b18tap = await page.evaluate(() => {
  const g = window.__LN;
  return { phase: g.survival.phase, miss: ((g._survivalLabels || {}).nightHold || {}).miss === true, hint: g._survivalHint && g._survivalHint.id };
});
await shot('b18-2-tap-refused');
// a hold: press until the ring closes
await press('mousedown', b18cx, b18cy);
await page.evaluate(() => window.__pStep(40));
const b18held = await page.evaluate(() => ({ phase: window.__LN.survival.phase, consumed: window.__LN.input.uiDown === null }));
await press('mouseup', b18cx, b18cy);
check('B18: NIGHT is a hold, not a tap — a press that leaves at a sixth of the ring starts nothing and the chip answers (HOLD TO START, then a once-only hint); while the ring fills it names what the day would still have bought (R18c); a press held to the ring starts the night once and consumes itself',
  !!b18day.box && b18day.box.hold > 0 && b18mid.holdT > 0.1 && b18mid.holdT < 0.4 && b18mid.phase === 'day' && !!b18mid.note
    && b18tap.phase === 'day' && b18tap.miss && b18tap.hint === 'holdnight'
    && b18held.phase === 'night' && b18held.consumed,
  { box: b18day.box, gold: b18day.gold, mid: b18mid, tap: b18tap, held: b18held });

/* ---- 12. BUILD 20 (R21): the watch ladder lives in PAUSE ---------------- */
const b20pause = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.records.totalStars = 4;
  g.togglePause(true);
  window.__pStep(3);
  return { screen: g.screen, lab: (g._survivalLabels || {}).pauseLadder || null };
});
await shot('b20-1-pause-ladder');
const b20resume = await page.evaluate(() => {
  const g = window.__LN;
  g.togglePause(false);
  window.__pStep(2);
  return g.screen;
});
check('B20: PAUSE is the mini unlocks screen — before any run ends it shows the watch ladder: the colour worn, the next colour and the stars still owed to it (R21)',
  b20pause.screen === 'paused' && !!b20pause.lab && b20pause.lab.tier === 'iron'
    && b20pause.lab.next === 'CRIMSON WATCH' && b20pause.lab.total === 4 && b20resume === 'playing',
  b20pause);

fs.writeFileSync(path.join(OUT, 'plotsqa.json'), JSON.stringify({ results, errors }, null, 2));
console.log(`errors ${errors.length}`);
console.log(`SUMMARY ${results.length - failures}/${results.length} PASS`);
await browser.close();
server.kill('SIGTERM');
process.exit(failures || errors.length ? 1 : 0);
