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
 * tonight's gates by day).
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

fs.writeFileSync(path.join(OUT, 'plotsqa.json'), JSON.stringify({ results, errors }, null, 2));
console.log(`errors ${errors.length}`);
console.log(`SUMMARY ${results.length - failures}/${results.length} PASS`);
await browser.close();
server.kill('SIGTERM');
process.exit(failures || errors.length ? 1 : 0);
