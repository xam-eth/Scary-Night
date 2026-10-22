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
 *   guards    one 3D guard pawn per survivor at night; a fallen one lies
 *             flat on a red ring and stands again once the Hunter helps
 *   pooling   bolt meshes are pooled (the scene does not grow per shot)
 *   keep      K1: the 3D keep stands in the bailey's inner ward (banner, townsfolk)
 *   day       P1: by day the stick walks the Hunter; standing in a circle
 *             shows ONE contextual BUILD button (no side panel, no "+"),
 *             and a real tap on it starts the builder
 *   reload    a mid-night reload resumes the clock and the enemies, and the
 *             run records (save.survival.records, R3) survive it
 *   cine      K1 bookends on the real route (no ?cine=0): a fresh save opens
 *             on the intro (clock and horde wait, only SKIP is live), a real
 *             tap hands over to the night, a reload does not replay it, and
 *             the third dawn marches the 3D relief column in before the panel
 *   health    0 page errors, 0 console errors, 0 failed requests
 *
 * Every other section loads `/?cine=0` (scripted from the night's first second).
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
const HARD_LIMIT_MS = 15 * 60 * 1000;
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
  await withTimeout(page.goto(`http://127.0.0.1:${PORT}/?cine=0`, { waitUntil: 'domcontentloaded', timeout: 120000 }), 130000, 'goto');

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
  const pan0 = await page.evaluate(() => ({ ...window.__LN.survival.camPan }));
  const rightMove = await drag(300, 520, -60, -80);
  const pan1 = await page.evaluate(() => ({ ...window.__LN.survival.camPan }));
  const topBand = await drag(120, 60, 0, 60);
  const panned = Math.hypot(pan1.x - pan0.x, pan1.y - pan0.y);
  // 2026-10-17 ("camera ... bisa di geser"): the stick keeps the left half,
  // a drag on the right half slides the view and leaves the captain standing
  check('touch: the stick floats in the left half below the HUD band; a right-half drag moves the camera, not the captain',
    leftMove > 40 && rightMove < 10 && panned > 60 && topBand < 10,
    { leftHalf: Math.round(leftMove), rightHalf: Math.round(rightMove), cameraPan: Math.round(panned), hudBand: Math.round(topBand) });
  // walking takes the view back onto the captain
  await drag(90, 640, 40, -60);
  const back = await page.evaluate(() => { window.__step(90); return Math.round(window.__LN.survival.cameraOffset()); });
  check('camera: walking eases the dragged view back onto the captain', back < 20, { offsetAfterWalk: back, dragged: Math.round(panned) });

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
    // BUILD 17: a fresh save plays Siege 1, whose first wave (11 bodies of 28
    // HP, one captain shot each) is over in ~19 shots: too few to exercise
    // the pool. This scenario plays Siege 3 (BUILD 16's horde); the tower
    // section below goes back to Siege 1.
    g.survival._setSiege(3);
    g.survival.restart();
    // the captain holds the gate wave 1 claws (K1 bailey: Night 1 opens at
    // the north gate, across the bailey from the camera). BUILD 10: a shut
    // gate stops every shot, so he steps into its mouth (it swings open), 2 s
    // at a time with 3 s back inside to get his breath; the guards shoot from
    // its towers: enough shots to exercise the pool.
    const door = g.survival.entranceById('northGate');
    const ix = door.inside.x - door.x, iy = door.inside.y - door.y, il = Math.hypot(ix, iy) || 1;
    window.__hold = (k) => {
      const back = k % 20 < 8 ? 20 : 150;
      g.player.x = door.x + ix / il * back; g.player.y = door.y + iy / il * back;
    };
    window.__hold(0);
    return g.stats.shotsFired || 0;
  });
  // 20 s of night with a render every 0.25 s (one render per __step call;
  // bolts fly >= 0.3 s), so bolts are created, retired and reused the way they
  // are in a session. Separate evaluate calls keep each CDP call short on
  // software WebGL.
  for (let k = 0; k < 80; k++) await page.evaluate((k) => { window.__hold(k); window.__step(15); }, k);
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

  // a fallen guard: flat on a red ring; the Hunter beside it gets it up
  const fallen = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    const W = window.__W;
    const guard = m.guards[0];
    if (!guard || m.phase !== 'night') return { skipped: true, phase: m.phase, guards: m.guards.length };
    m._downGuard(guard);
    g.player.x = guard.x + 300; g.player.y = guard.y;   // not beside it yet
    window.__step(1);
    const ud = W.survivalGuardMeshes[0].userData;
    const down = {
      visible: W.survivalGuardMeshes[0].visible, figureRotX: +ud.figure.rotation.x.toFixed(3), figureY: ud.figure.position.y,
      ring: ud.ring.material.color.getHexString(), xray: ud.xray.material.color.getHexString(), hud: m.standingGuards() + '/' + m.guards.length,
      // the GLB crossbowman (KayKit Knight) when it has loaded: Lie_Down / Lie_Idle
      troop: ud.troop ? { state: ud.troop.state, visible: ud.troop.model.visible } : null,
    };
    g.player.x = guard.x + 30; g.player.y = guard.y;
    for (let i = 0; i < 110 && guard.down; i++) { g.player.x = guard.x + 30; g.player.y = guard.y; window.__orig.call(g, 1 / 60); }
    window.__step(1);
    const up = {
      down: guard.down, hp: guard.hp, figureRotX: +ud.figure.rotation.x.toFixed(3), ring: ud.ring.material.color.getHexString(),
      troop: ud.troop ? { state: ud.troop.state } : null,
    };
    return { down, up, glb: !!ud.troop };
  });
  // with the GLB guard the body itself lies down (Lie_Down / Lie_Idle) and
  // gets back up (Lie_StandUp, then its standing loop); the primitive pawn
  // (hidden behind it, or the fallback when the GLB fails) still tips over
  const troopOk = !fallen.glb || (fallen.down.troop && /^(down|lie)$/.test(fallen.down.troop.state)
    && fallen.up.troop && !/^(down|lie)$/.test(fallen.up.troop.state));
  check('guards: a fallen guard lies down on a red ring; helped up it stands on its blue ring',
    !fallen.skipped && fallen.down.visible && Math.abs(fallen.down.figureRotX + Math.PI / 2) < 0.01 && fallen.down.ring === 'ff4a3d'
      && fallen.down.xray === 'ff4a3d' && !fallen.up.down && fallen.up.hp === 20 && fallen.up.figureRotX === 0 && fallen.up.ring === '5ab8ff'
      && troopOk, fallen);

  // ---------------- towers: ring by day, swivel + pooled bolts by night ----------------
  const towerDay = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    m._setSiege(1);   // back to the fresh save's siege (the pool played Siege 3)
    m.restart();
    m.phase = 'night'; m.completeNight(); m.ackRewards();
    m.gold = 200; m.wood = 200;
    const queued = m.startBuild('tower', 'south:tower');
    let n = 0;
    while (m.builderJob && n++ < 3000) window.__orig.call(g, 1 / 60);
    // the Hunter stands on the ballista's circle: its reach ring shows
    const spot = m.buildingSpot('south:tower');
    g.player.x = spot.x; g.player.y = spot.y;
    window.__step(5);
    const W = window.__W;
    const mesh = W.survivalBuildingMeshes.get('south:tower');
    return {
      queued, built: m.buildings['south:tower'], model: !!(mesh && mesh.visible && mesh.userData.yaw),
      at: mesh ? [Math.round(mesh.position.x), Math.round(mesh.position.z)] : null, spot: [spot.x, spot.y],
      ring: !!(W.survivalTowerRing && W.survivalTowerRing.visible), ringR: W.survivalTowerRing ? W.survivalTowerRing.scale.x : 0,
    };
  });
  check('tower: model on its circle by the main gate, red reach ring while the Hunter stands at it by day',
    towerDay.queued && towerDay.built === 'tower' && towerDay.model && towerDay.at && towerDay.at[0] === towerDay.spot[0]
      && towerDay.at[1] === towerDay.spot[1] && towerDay.ring && towerDay.ringR === 520, towerDay);
  await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    const home = m.hunterHome();
    g.player.x = home.x; g.player.y = home.y;
    m.startNight();
    m.waveIndex = 99; m.breakerIndex = 99; m.individualIndex = 99;
    g.enemies.length = 0; g.bolts.length = 0;
    m.spawnSwarm(21, 0, m.entranceById('southGate'));
    m.entranceById('southGate').hp = m.entranceById('southGate').hpMax = 99999;
    window.__towerShots0 = m.nightStats.towerShots || 0;
  });
  for (let k = 0; k < 60; k++) await page.evaluate(() => window.__step(15));
  const towerNight = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    const W = window.__W;
    const t = m.towers[0];
    const mesh = W.survivalBuildingMeshes.get('south:tower');
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
  await page.evaluate(() => { const g = window.__LN; g.survival.fail('THE KEEP FELL'); window.__step(3); });
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

  // ---------------- K1: the keep, and the day's walk-to-a-circle builder (landscape) ----------------
  const keep3d = await page.evaluate(() => {
    const g = window.__LN;
    const W = window.__W;
    const m = g.survival;
    const k = m.keep();
    const hall = g.mansion.room('ward');   // the bailey's inner ward
    const mesh = W.survivalKeep;
    const ud = mesh ? mesh.userData : {};
    return {
      visible: !!(mesh && mesh.visible), at: mesh ? [Math.round(mesh.position.x), Math.round(mesh.position.z)] : null,
      hallCentre: [Math.round(hall.x + hall.w / 2), Math.round(hall.y + hall.h / 2)], keep: [k.x, k.y],
      villagers: ud.villagers ? ud.villagers.filter((v) => v.person.visible).length : 0, banner: !!(ud.flag && ud.flag.visible),
      solid: !!g.mansion.solidAt(k.x, k.y), diag: W.diagnostics().survivalKeepVisible,
    };
  });
  check('keep: the 3D keep stands in the middle of the inner ward (solid), banner up, three townsfolk on top',
    keep3d.visible && keep3d.diag && keep3d.at && keep3d.at[0] === keep3d.hallCentre[0] && keep3d.at[1] === keep3d.hallCentre[1]
      && keep3d.villagers === 3 && keep3d.banner && keep3d.solid, keep3d);
  await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    m.completeNight(); m.ackRewards();
    m.gold = 200; m.wood = 200;
    window.__step(10);
  });
  const dayWalk = await drag(330, 250, 60, 0);
  const dayAt = await page.evaluate(() => {
    const g = window.__LN;
    const m = g.survival;
    const spot = m.buildingSpot('south:tower');
    m.walkTo(spot.x, spot.y);
    let n = 0;
    while (m.walkPath && n++ < 900) window.__orig.call(g, 1 / 60);
    window.__step(20);
    const labels = g.ui.map((u) => u.label);
    const build = g.ui.find((u) => u.label === 'survival:BUILD tower');
    const W = window.__W;
    return {
      context: m.dayContext() && m.dayContext().id, gameplay: g.input.gameplay, build: build ? { x: build.x, y: build.y, w: build.w, h: build.h, disabled: build.disabled } : null,
      oldLabels: labels.filter((l) => /survival:(slot|select):/.test(l)), circles: W.diagnostics().visibleSurvivalBuildSlots, ghosts: W.diagnostics().visibleSurvivalGhosts,
      tallPanels: g.ui.filter((u) => u.h > 150).length,
    };
  });
  if (dayAt.build) {
    await page.touchscreen.tap(dayAt.build.x + dayAt.build.w / 2, dayAt.build.y + dayAt.build.h / 2);
    await page.evaluate(() => window.__step(3));
  }
  const dayJob = await page.evaluate(() => { const m = window.__LN.survival; return m.builderJob ? { kind: m.builderJob.kind, slot: m.builderJob.slotId } : null; });
  check('day (P1): the stick walks the Hunter by day; in a circle ONE contextual BUILD button shows (no side panel, no "+"); a real tap on it starts the builder',
    dayWalk > 40 && dayAt.gameplay && dayAt.context === 'south:tower' && dayAt.build && !dayAt.build.disabled
      // BUILD 11 ("terlihat sangat padat"): one ghost, the circle he stands in
      && dayAt.oldLabels.length === 0 && dayAt.tallPanels === 0 && dayAt.circles >= 3 && dayAt.ghosts === 1
      && dayJob && dayJob.kind === 'building' && dayJob.slot === 'south:tower',
    { stickMoved: Math.round(dayWalk), ...dayAt, job: dayJob });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => { window.__LN.survival.restart(); window.__step(5); });

  // ---------------- reload mid-night ----------------
  const pre = await page.evaluate(() => { const g = window.__LN; window.__step(60 * 15); g.survival._persist(true); return { t: +g.survival.elapsed.toFixed(2), alive: g.survival.aliveEnemies(), records: { ...g.survival.records } }; });
  await page.evaluate(() => sessionStorage.setItem('devqaKeep', '1'));
  await withTimeout(page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }), 130000, 'reload');
  await page.waitForFunction(() => window.__LN && window.__LN.survival && window.__LN.screen === 'playing', { timeout: 120000 });
  const post = await page.evaluate(() => { const g = window.__LN; return { t: +g.survival.elapsed.toFixed(2), alive: g.survival.aliveEnemies(), phase: g.survival.phase, records: { ...g.survival.records } }; });
  check('reload: a mid-night reload resumes the clock and the enemies',
    post.phase === 'night' && Math.abs(post.t - pre.t) < 1.5 && Math.abs(post.alive - pre.alive) <= 2, { before: pre, after: post });
  // the lost run of the end-panel step above is on the record (R3)
  check('records: the run records (save.survival.records) survive a reload',
    pre.records.runs >= 1 && JSON.stringify(post.records) === JSON.stringify(pre.records), { before: pre.records, after: post.records });

  // ---------------- K1 bookends: the real route (cinematics on), landscape ----------------
  // The first page scripted its nights with ?cine=0; it closes first so its
  // save cannot land in the fresh storage this page starts from.
  await withTimeout(page.close(), 15000, 'page.close');
  const cine = await browser.newPage();
  cine.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  cine.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  cine.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure() && r.failure().errorText}`));
  cine.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await cine.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await cine.evaluateOnNewDocument(() => {
    try { if (sessionStorage.getItem('devqaKeep') !== '1') localStorage.clear(); } catch (_) { /* ignore */ }
  });
  await withTimeout(cine.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 }), 130000, 'goto cine');
  const freeze = async () => {
    await cine.waitForFunction(() => {
      const g = window.__LN;
      const host = document.querySelector('#game') && document.querySelector('#game').parentElement;
      return !!(g && g.survival && g.screen === 'playing' && host && host.dataset.renderMode === 'webgl-3d');
    }, { timeout: 120000, polling: 50 });
    await cine.evaluate(async () => {
      const g = window.__LN;
      window.__W = (await import('./src/game/world3d.js')).World3D;
      window.__orig = g.update;
      g.update = () => {};
      window.__step = (n = 1) => { for (let i = 0; i < n; i++) window.__orig.call(g, 1 / 60); g.render(); };
    });
  };
  await freeze();
  const opening = await cine.evaluate(() => {
    const g = window.__LN; const m = g.survival;
    const at0 = m.cine ? { kind: m.cine.kind, t: +m.cine.t.toFixed(2) } : null;
    const elapsed0 = m.elapsed;
    const swarm0 = g.enemies.filter((e) => e._survivalType === 'swarm' && !e.dead).map((e) => [e.x, e.y]);
    const playZoom = m.frameMul(true) * g.renderer.baseZoom;
    window.__step(54);
    const swarm1 = g.enemies.filter((e) => e._survivalType === 'swarm' && !e.dead);
    const still = swarm1.length === swarm0.length && swarm1.every((e, i) => Math.hypot(e.x - swarm0[i][0], e.y - swarm0[i][1]) < 0.01);
    const cap = m.cineCaption();
    return {
      cine: at0, t: m.cine && +m.cine.t.toFixed(2), elapsed: [+elapsed0.toFixed(2), +m.elapsed.toFixed(2)], horde: swarm1.length, still,
      siege: m.siege, wave1: m.waveCounts()[0],
      closeUp: +(g.renderer.cam.zoom / playZoom).toFixed(2), caption: cap && cap.title, labels: g.ui.map((u) => u.label),
      panel: g.uiPanel, gameplay: g.input.gameplay, stick: !g.input.buttons.interact.hidden, introSeen: !!g.save.survival.introSeen,
    };
  });
  // (BUILD 17: a fresh save is Siege 1, so the horde at the gate is its first
  // wave of 11; BUILD 16 checked for its 21)
  check('cine: a fresh save opens on the K1 intro — keep close-up, captioned, the clock and the horde (Siege 1\'s whole first wave) wait, no HUD but SKIP',
    opening.cine && opening.cine.kind === 'intro' && opening.t > 0.8 && opening.elapsed[0] === opening.elapsed[1]
      && opening.siege === 1 && opening.wave1 === 11 && opening.horde >= opening.wave1 && opening.still
      && opening.closeUp > 1.25 && opening.caption === 'PROTECT THE KEEP' && opening.labels.length === 1 && opening.labels[0] === 'survival:SKIP'
      && opening.panel === 'survival-cine' && !opening.gameplay && !opening.stick && opening.introSeen, opening);
  await cine.touchscreen.tap(422, 195);
  await cine.evaluate(() => window.__step(3));
  const handover = await cine.evaluate(() => {
    const g = window.__LN; const m = g.survival;
    const elapsed0 = m.elapsed;
    window.__step(60);
    return { cine: !!m.cine, panel: g.uiPanel, banner: m.banner && m.banner.text, gameplay: g.input.gameplay, labels: g.ui.map((u) => u.label).filter((l) => /PAUSE|SKIP/.test(l)), ran: +(m.elapsed - elapsed0).toFixed(2), zoom: +(g.renderer.cam.zoom / (m.frameMul(true) * g.renderer.baseZoom)).toFixed(2) };
  });
  check('cine: a real tap skips to the hand-over — the siege\'s banner (BUILD 17: SIEGE 1: FIRST WATCH on a fresh save), the night clock runs, the HUD and the stick are back',
    !handover.cine && handover.panel === null && handover.banner === 'SIEGE 1: FIRST WATCH' && handover.gameplay && handover.labels.includes('PAUSE')
      && !handover.labels.includes('survival:SKIP') && handover.ran > 0.9 && Math.abs(handover.zoom - 1) < 0.08, handover);
  await cine.evaluate(() => { window.__LN.survival._persist(true); sessionStorage.setItem('devqaKeep', '1'); });
  await withTimeout(cine.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }), 130000, 'reload cine');
  await freeze();
  const replay = await cine.evaluate(() => { const g = window.__LN; const m = g.survival; window.__step(5); return { cine: !!m.cine, phase: m.phase, panel: g.uiPanel, elapsed: +m.elapsed.toFixed(2) }; });
  check('cine: a reload mid-night plays straight on (the intro opens every run, not every page load)', !replay.cine && replay.phase === 'night' && replay.panel === null, replay);
  const again = await cine.evaluate(() => { const g = window.__LN; const m = g.survival; m.restart(); window.__step(3); const kind = m.cine && m.cine.kind; m.endCine(); window.__step(3); return { kind, seen: !!g.save.survival.introSeen }; });
  check('cine: RESTART opens on the intro again (playtest 2026-10-17: the trailer must stay)', again.kind === 'intro' && again.seen, again);
  const arrival = await cine.evaluate(() => {
    const g = window.__LN; const m = g.survival;
    m.keepLevel = 3; m.keepHp = m.keepHpMax();
    m.day = 3; m.nightsCompleted = 2;
    m.completeNight();
    window.__step(150);
    const mid = { cine: m.cine && m.cine.kind, gateOpen: !!m.mainGate().open, relief: m.getNightSnapshot().relief, troops3d: window.__W.diagnostics().visibleReliefTroops, caption: m.cineCaption() && m.cineCaption().title, labels: g.ui.map((u) => u.label), panel: g.uiPanel };
    window.__step(60 * 6);
    return { ...mid, after: { cine: !!m.cine, panel: g.uiPanel, relief: m.getNightSnapshot().relief, troops3d: window.__W.diagnostics().visibleReliefTroops, labels: g.ui.map((u) => u.label), phase: m.phase } };
  });
  check('cine: the third dawn plays the arrival — gate open, nine 3D troops march in under REINFORCEMENTS ARRIVED!, then the end panel with the column in line',
    arrival.cine === 'arrival' && arrival.gateOpen && arrival.relief && arrival.relief.troops === 9 && arrival.relief.marching > 0 && arrival.troops3d === 9
      && arrival.caption === 'REINFORCEMENTS ARRIVED!' && arrival.labels.length === 1 && arrival.labels[0] === 'survival:SKIP' && arrival.panel === 'survival-cine'
      && !arrival.after.cine && arrival.after.panel === 'survival-complete' && arrival.after.relief.inLine === 9 && arrival.after.troops3d === 9
      && arrival.after.labels.includes('survival:PLAY AGAIN') && arrival.after.phase === 'complete', arrival);

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
