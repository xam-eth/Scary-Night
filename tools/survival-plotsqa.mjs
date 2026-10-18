/* DUSKHOLD Survival — the 2026-10-17 fix pass, checked in a real browser.
 *
 * The playtest asked for five things ("ada beberapa masih perlu di fix"):
 *   1 the camera a little further out, and draggable ("bisa di geser");
 *   2 the build plots laid out tidily ("letak build bangunan ... rapi");
 *   3 real downloaded building assets, not prototypes;
 *   4 smaller cards ("card juga masih besar");
 *   5 the opening trailer kept (tools/survival-intro.mjs checks that one).
 * This boots a fresh save at sideways-phone size (844 x 390), checks 1-4
 * against the running game and writes the frames that show them.
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
await page.goto(`http://127.0.0.1:${PORT}/?cine=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
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
check('assets: every plot stands on its pad, the armory is the pack\'s racks, the yard has its well',
  kit.kit.pads === kit.plots + 1 && kit.plots === 15 && kit.kit.armoryKit && kit.kit.wells === 1, { pads: kit.kit.pads, plots: kit.plots, armory: kit.kit.armoryKit, wells: kit.kit.wells });
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

fs.writeFileSync(path.join(OUT, 'plotsqa.json'), JSON.stringify({ results, errors }, null, 2));
console.log(`errors ${errors.length}`);
console.log(`SUMMARY ${results.length - failures}/${results.length} PASS`);
await browser.close();
server.kill('SIGTERM');
process.exit(failures || errors.length ? 1 : 0);
