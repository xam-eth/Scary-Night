#!/usr/bin/env node
/* DUSKHOLD — Survival device QA (headless Chromium, phone viewport, touch).
 *
 * Asserts the device-facing behaviour the node harness cannot see:
 *   boot      the night clock does not run before the 3D house is on screen
 *   touch     the floating stick starts anywhere below the HUD band
 *   flare     a tap on the drawn edge of the Flare button fires it
 *   controls  Survival shows one action button (no redundant attack button)
 *   pause     pausing freezes the Flare cooldown; the end panel has no pause
 *   hidden    a hidden tab pauses the night
 *   context   a lost WebGL context freezes the night until it is restored
 *   framing   portrait and landscape phones get the same night zoom
 *   guards    one 3D guard pawn per survivor at night
 *   pooling   bolt meshes are pooled (the scene does not grow per shot)
 *   reload    a mid-night reload resumes the clock and the enemies
 *   health    0 page errors, 0 console errors, 0 failed requests
 *
 *   node tools/survival-devqa.mjs [--port=8112] [--json=out.json]
 *
 * Exit code 1 when any assertion fails. Every browser step has a timeout and
 * the process always exits (the scratch version could hang on close). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const PORT = Number(args.port || 8112);
// A full run takes ~6 min on software WebGL (three page loads + ~100 renders).
const HARD_LIMIT_MS = 12 * 60 * 1000;
let server = null;
const killTimer = setTimeout(() => {
  console.log('FAIL  devqa hard time limit reached');
  try { if (server) server.kill('SIGTERM'); } catch (_) { /* ignore */ }
  process.exit(2);
}, HARD_LIMIT_MS);
killTimer.unref();

server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  fs.mkdirSync(path.join(ROOT, 'tools', '.cache', 'al2023-lib'), { recursive: true });
  const br = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
  const tar = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'al2023.tar');
  fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', tar, '-C', path.join(ROOT, 'tools', '.cache', 'al2023-lib')]);
  fs.rmSync(tar);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
]);

let browser = null;
let exitCode = 0;
try {
  browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    headless: true, protocolTimeout: 120000,
    env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  });
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    try { if (sessionStorage.getItem('devqaKeep') !== '1') localStorage.clear(); } catch (_) { /* ignore */ }
  });
  await withTimeout(page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 }), 130000, 'goto');

  // ---------------- boot: no night before the world ----------------
  let firstWorld = null;
  let firstNight = null;
  for (let i = 0; i < 900 && !firstWorld; i++) {
    const s = await page.evaluate(() => {
      const g = window.__LN;
      const host = document.querySelector('#game') && document.querySelector('#game').parentElement;
      return g ? { screen: g.screen, phase: g.survival && g.survival.phase, elapsed: g.survival ? g.survival.elapsed : null, mode: host && host.dataset.renderMode } : null;
    });
    if (s && !firstNight && s.phase === 'night' && s.screen === 'playing') firstNight = s;
    if (s && s.mode === 'webgl-3d') firstWorld = s;
    else await new Promise((r) => setTimeout(r, 50));
  }
  check('boot: the night clock waits for the 3D house', !!firstWorld && firstWorld.elapsed < 0.25,
    { nightArmedAt: firstNight && +firstNight.elapsed.toFixed(2), elapsedWhenWorldShown: firstWorld && +firstWorld.elapsed.toFixed(2) });

  // freeze the loop; step manually from here on
  await page.evaluate(async () => {
    const g = window.__LN;
    window.__W = (await import('./src/game/world3d.js')).World3D;
    window.__E = (await import('./src/game/envkit.js')).EnvKit;
    window.__orig = g.update;
    g.update = () => {};
    window.__step = (n = 1) => { for (let i = 0; i < n; i++) window.__orig.call(g, 1 / 60); g.render(); };
  });
  await page.waitForFunction(() => window.__W.diagnostics().ready, { timeout: 90000 });
  await page.evaluate(() => { const g = window.__LN; g.survival.restart(); window.__step(5); });

  // ---------------- touch: floating stick ----------------
  const drag = async (x, y, dx, dy) => {
    const before = await page.evaluate(() => ({ x: window.__LN.player.x, y: window.__LN.player.y }));
    await page.touchscreen.touchStart(x, y);
    await page.evaluate(() => window.__step(2));
    await page.touchscreen.touchMove(x + dx, y + dy);
    await page.evaluate(() => window.__step(50));
    await page.touchscreen.touchEnd();
    await page.evaluate(() => window.__step(2));
    const after = await page.evaluate(() => ({ x: window.__LN.player.x, y: window.__LN.player.y }));
    return Math.hypot(after.x - before.x, after.y - before.y);
  };
  const leftMove = await drag(90, 640, 0, -80);
  const rightMove = await drag(250, 520, 0, -80);
  const topBand = await drag(200, 60, 0, 60);
  check('touch: the stick starts anywhere below the HUD band', leftMove > 40 && rightMove > 40 && topBand < 10,
    { leftHalf: Math.round(leftMove), rightHalf: Math.round(rightMove), hudBand: Math.round(topBand) });

  // ---------------- controls: one Flare button, hit = drawn ----------------
  const btn = await page.evaluate(() => {
    const b = window.__LN.input.buttons;
    return { flare: { x: b.interact.x, y: b.interact.y, r: b.interact.r, hitR: b.interact.hitR, hidden: b.interact.hidden }, attackHidden: b.attack.hidden, vw: window.__LN.renderer.w, vh: window.__LN.renderer.h };
  });
  check('controls: Survival shows one action button (attack hidden)', btn.attackHidden && !btn.flare.hidden && btn.flare.r >= 34, btn);
  await page.evaluate(() => { window.__LN.survival.skillCooldown = 0; });
  const edge = btn.flare.r - 2;
  await page.touchscreen.touchStart(btn.flare.x - edge, btn.flare.y);
  await page.evaluate(() => window.__step(3));
  await page.touchscreen.touchEnd();
  await page.evaluate(() => window.__step(2));
  const cdEdge = await page.evaluate(() => window.__LN.survival.skillCooldown);
  check('flare: a tap on the drawn edge fires', cdEdge > 0, { tapAtPx: +edge.toFixed(1), cooldown: +cdEdge.toFixed(2) });

  // ---------------- pause ----------------
  await page.evaluate(() => { const m = window.__LN.survival; m.skillCooldown = 10; window.__LN.togglePause(true); window.__step(120); });
  const paused = await page.evaluate(() => ({ cd: window.__LN.survival.skillCooldown, screen: window.__LN.screen }));
  await page.evaluate(() => { window.__LN.resumeSurvival(); window.__step(2); });
  check('pause: 2 s paused leaves the Flare cooldown untouched', paused.cd === 10 && paused.screen === 'paused', paused);

  // ---------------- hidden tab ----------------
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await page.evaluate(() => window.__LN.screen);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__LN.resumeSurvival(); window.__step(2);
  });
  check('hidden: a hidden tab pauses the night', hidden === 'paused', { screen: hidden });

  // ---------------- context loss ----------------
  const ctx = await page.evaluate(async () => {
    const g = window.__LN;
    const gl = window.__E.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { ext: false };
    window.__step(1);
    const e0 = g.survival.elapsed;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    window.__step(120);
    const during = +(g.survival.elapsed - e0).toFixed(3);
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 900));
    window.__step(3);
    const e1 = g.survival.elapsed;
    window.__step(60);
    return { ext: true, elapsedDuringLoss: during, resumedAdvance: +(g.survival.elapsed - e1).toFixed(2), lost: window.__W.contextLost, lastError: window.__W.lastError };
  });
  check('context: a lost WebGL context freezes the night, restore resumes it',
    ctx.ext === false || (ctx.elapsedDuringLoss === 0 && ctx.resumedAdvance > 0.5 && !ctx.lost), ctx);

  // ---------------- guards + pooling ----------------
  const shots0 = await page.evaluate(() => {
    const g = window.__LN;
    g.survival.restart();
    return g.stats.shotsFired || 0;
  });
  // 20 s of night with a render every 0.25 s (one render per __step call;
  // bolts fly >= 0.3 s), so bolts are created, retired and reused the way they
  // are in a session. Separate evaluate calls keep each CDP call short on
  // software WebGL.
  for (let k = 0; k < 80; k++) await page.evaluate(() => window.__step(15));
  const pool = await page.evaluate((shots0) => {
    const g = window.__LN;
    const W = window.__W;
    const meshes = (W.survivalGuardMeshes || []).filter((m) => m.visible).length;
    let boltObjects = 0;
    W.root.traverse((o) => { if (o.name === 'crossbow-bolt-3d' || o.name === 'guard-bolt-3d') boltObjects++; });
    const shots = (g.stats.shotsFired || 0) - shots0 + (g.survival.nightStats.guardShots || 0);
    return { survivors: g.survival.survivors, guards: g.survival.guards.length, visibleGuardMeshes: meshes, boltObjects, shots };
  }, shots0);
  check('guards: one 3D guard pawn per survivor at night', pool.guards === pool.survivors && pool.visibleGuardMeshes === pool.guards, pool);
  check('pooling: bolt meshes do not grow with every shot', pool.shots > 20 && pool.boltObjects > 0 && pool.boltObjects < pool.shots / 2, { shots: pool.shots, boltObjectsInScene: pool.boltObjects });

  // ---------------- towers: ring by day, swivel + pooled bolts by night ----------------
  const towerDay = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    m.phase = 'night'; m.completeNight(); m.ackRewards();
    m.oil = 200; m.wood = 200;
    const queued = m.startBuild('tower', 'hall');
    let n = 0;
    while (m.builderJob && n++ < 3000) window.__orig.call(g, 1 / 60);
    m.dayFocus = 'hall'; m.selectedRoom = 'hall';
    window.__step(5);
    const W = window.__W;
    const mesh = W.survivalBuildingMeshes.get('hall');
    const spot = m.buildingSpot('hall');
    return {
      queued, built: m.buildings.hall, model: !!(mesh && mesh.visible && mesh.userData.yaw),
      at: mesh ? [Math.round(mesh.position.x), Math.round(mesh.position.z)] : null, spot: [spot.x, spot.y],
      ring: !!(W.survivalTowerRing && W.survivalTowerRing.visible), ringR: W.survivalTowerRing ? W.survivalTowerRing.scale.x : 0,
    };
  });
  check('tower: model on its spot by the front door, red reach ring when selected by day',
    towerDay.queued && towerDay.built === 'tower' && towerDay.model && towerDay.at && towerDay.at[0] === towerDay.spot[0]
      && towerDay.at[1] === towerDay.spot[1] && towerDay.ring && towerDay.ringR === 520, towerDay);
  await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    m.dayFocus = 'perapian';
    m.startNight();
    m.waveIndex = 99; m.breakerIndex = 99; m.individualIndex = 99;
    g.enemies.length = 0; g.bolts.length = 0;
    m.spawnSwarm(21, 0, m.entranceById('frontDoor'));
    m.entranceById('frontDoor').hp = m.entranceById('frontDoor').hpMax = 99999;
    window.__towerShots0 = m.nightStats.towerShots || 0;
  });
  for (let k = 0; k < 60; k++) await page.evaluate(() => window.__step(15));
  const towerNight = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    const W = window.__W;
    const t = m.towers[0];
    const mesh = W.survivalBuildingMeshes.get('hall');
    let towerBolts = 0;
    W.root.traverse((o) => { if (o.name === 'tower-bolt-3d') towerBolts++; });
    const yaw = mesh && mesh.userData.yaw ? mesh.userData.yaw.rotation.y : null;
    const want = t ? Math.PI / 2 - t.aim : null;
    const diff = yaw == null || want == null ? 9 : Math.abs(Math.atan2(Math.sin(yaw - want), Math.cos(yaw - want)));
    return {
      shots: (m.nightStats.towerShots || 0) - window.__towerShots0, kills: m.nightStats.kills,
      ringHidden: !(W.survivalTowerRing && W.survivalTowerRing.visible), towerBolts, swivelDiff: +diff.toFixed(3),
    };
  });
  check('tower: by night the ballista swivels to its aim and its bolts are pooled',
    towerNight.shots >= 8 && towerNight.swivelDiff < 0.01 && towerNight.towerBolts > 0 && towerNight.towerBolts < towerNight.shots / 2 && towerNight.ringHidden,
    towerNight);

  // ---------------- end panel: no pause ----------------
  await page.evaluate(() => { const g = window.__LN; g.survival.fail('THE FIRE WENT OUT'); window.__step(3); });
  await page.touchscreen.tap(30, 30);
  await page.evaluate(() => window.__step(3));
  const endTap = await page.evaluate(() => ({ screen: window.__LN.screen, phase: window.__LN.survival.phase }));
  check('pause: the end panel has no pause hit area', endTap.screen === 'playing' && endTap.phase === 'failed', endTap);

  // ---------------- framing: portrait vs landscape ----------------
  const portraitZoom = await page.evaluate(() => { const g = window.__LN; g.survival.restart(); window.__step(240); return g.renderer.cam.zoom; });
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 400));
  const land = await page.evaluate(() => {
    window.__step(240);
    const g = window.__LN; const b = g.input.buttons;
    return { zoom: g.renderer.cam.zoom, w: g.renderer.w, h: g.renderer.h, flare: [b.interact.x, b.interact.y, b.interact.r] };
  });
  const flareInside = land.flare[0] + land.flare[2] <= land.w && land.flare[1] + land.flare[2] <= land.h;
  check('framing: landscape night zoom matches portrait (short-side framing)',
    Math.abs(land.zoom - portraitZoom) / portraitZoom < 0.12 && flareInside,
    { portrait: +portraitZoom.toFixed(3), landscape: +land.zoom.toFixed(3), flare: land.flare });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.__step(5));

  // ---------------- reload mid-night ----------------
  const pre = await page.evaluate(() => { const g = window.__LN; window.__step(60 * 15); g.survival._persist(true); return { t: +g.survival.elapsed.toFixed(2), alive: g.survival.aliveEnemies() }; });
  await page.evaluate(() => sessionStorage.setItem('devqaKeep', '1'));
  await withTimeout(page.reload({ waitUntil: 'domcontentloaded' }), 130000, 'reload');
  await page.waitForFunction(() => window.__LN && window.__LN.survival && window.__LN.screen === 'playing', { timeout: 120000 });
  const post = await page.evaluate(() => { const g = window.__LN; return { t: +g.survival.elapsed.toFixed(2), alive: g.survival.aliveEnemies(), phase: g.survival.phase }; });
  check('reload: a mid-night reload resumes the clock and the enemies',
    post.phase === 'night' && Math.abs(post.t - pre.t) < 1.5 && Math.abs(post.alive - pre.alive) <= 2, { before: pre, after: post });

  check('health: 0 page errors, 0 console errors, 0 failed requests', !errors.length && !consoleErrors.length && !failed.length,
    { pageErrors: errors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3), failed: failed.slice(0, 3) });
} catch (error) {
  check('devqa run completed', false, String(error && error.message || error));
}

const failedChecks = results.filter((r) => !r.pass);
if (failedChecks.length) exitCode = 1;
console.log(`SUMMARY ${results.length - failedChecks.length}/${results.length} PASS`);
if (args.json) fs.writeFileSync(String(args.json), `${JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
try { if (browser) await withTimeout(browser.close(), 10000, 'browser.close'); } catch (_) { /* exit anyway */ }
try { server.kill('SIGTERM'); } catch (_) { /* ignore */ }
process.exit(exitCode);
