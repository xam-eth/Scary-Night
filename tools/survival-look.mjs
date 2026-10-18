/* DUSKHOLD Survival — quick "what does a player see" captures.
 *
 * A short landscape run at phone size that frames the moments a playtester
 * judges the game by: the horde at a gate (are the troops GLB? do the shots
 * land?), the bailey at night (is the fortress too big for its pieces?), the
 * day with buildings at work, and a build circle with its card. Used for
 * before/after comparisons of a visual pass; prints the 3D diagnostics of
 * each frame (horde kinds, GLB guards, effects).
 *
 * Usage: node tools/survival-look.mjs [--out=/tmp/look] [--dpr=2]
 *        [--port=8123] [--only=gate,fight,outside,posts,wide,south,day0,day,build,overview,closeup]
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
const OUT = path.resolve(ROOT, args.out || '/tmp/look');
const PORT = Number(args.port || 8123);
const DPR = Number(args.dpr || 2);
const ONLY = args.only ? String(args.only).split(',') : null;
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
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/?cine=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__LN;
  return !!(g && g.mode === 'survival' && g.screen === 'playing' && g.survival && g.survival.phase === 'night');
}, { timeout: 180000, polling: 100 });
console.log(`boot ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.evaluate(async () => {
  window.__lkWorld = (await import('./src/game/world3d.js')).World3D;
  window.__lkTroop = (await import('./src/game/troop3d.js')).Troop3D;
});
await page.waitForFunction(() => window.__lkWorld?.diagnostics?.().ready, { timeout: 90000, polling: 100 });
await page.evaluate(() => {
  const g = window.__LN;
  g.setQuality(99);
  g._frameCheck = -Infinity;
  g.survival.restart();
  window.__lkOrig = g.update;
  g.update = () => {};
  window.__lkReal = (n) => { for (let i = 0; i < n; i++) { window.__lkOrig.call(g, 1 / 60); g.render(); } };
  window.__lkFast = (until) => { let n = 0; while (until() && n < 20000) { window.__lkOrig.call(g, 1 / 60); n++; } return n; };
  window.__lkDiag = () => {
    const d = window.__lkWorld.diagnostics();
    return { horde: d.horde, primitiveCrowd: d.primitiveCrowd, rigs: d.visibleRiggedEnemies, glbGuards: d.glbGuards, troop: d.troop3d && d.troop3d.ready, fx: d.fx && d.fx.played, zoom: +window.__LN.renderer.cam.zoom.toFixed(3) };
  };
  g.render();
});
await page.evaluate(() => window.__lkReal(2));
await page.waitForFunction(() => window.__lkTroop && (window.__lkTroop.ready || window.__lkTroop.failed), { timeout: 90000, polling: 200 }).catch(() => {});

const want = (name) => !ONLY || ONLY.includes(name);
async function shot(name, fn) {
  if (!want(name)) return null;
  const state = await page.evaluate(fn);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  console.log(`SHOT ${name} ${JSON.stringify(state).slice(0, 700)}`);
  return state;
}

await shot('gate', () => {
  const g = window.__LN; const m = g.survival;
  // a mine and two ballistas standing from the first night, so their work
  // shows (coins into the purse, kill tallies over the decks)
  m.buildings.north = 'mine'; m.buildingLevels.north = 1;
  m.buildings['north:tower'] = 'tower'; m.buildingLevels['north:tower'] = 1;
  m.buildings['south:tower'] = 'tower'; m.buildingLevels['south:tower'] = 1;
  g.survivalBakeDirty = true;
  // BUILD 10: a shut gate stops his shot, so he holds it from its mouth
  // (20 px inside the wall line): the leaf swings open for him, the crowd
  // claws back through the opening, the guards shoot from the towers
  const door = g.mansion.entrances.find((e) => e.id === 'northGate');
  const mouth = () => { g.player.x = door.x; g.player.y = door.y + 20; };
  window.__lkFast(() => { if (m.elapsed > 9) mouth(); return m.elapsed < 11; });
  mouth();
  for (let i = 0; i < 10; i++) { mouth(); window.__lkReal(1); }
  return { t: +m.elapsed.toFixed(1), alive: m.aliveEnemies(), open: !!door.sortie, exposed: !!m.captainExposed, guardsUp: m.guards.filter((gd) => gd.lift === 1).length, ...window.__lkDiag() };
});
await shot('fight', () => {
  const g = window.__LN; const m = g.survival;
  const door = g.mansion.entrances.find((e) => e.id === 'northGate');
  for (let i = 0; i < 16; i++) { g.player.x = door.x; g.player.y = door.y + 20; window.__lkReal(1); }
  return { kills: m.nightStats.kills, hp: Math.round(g.player.blood), open: !!door.sortie, ...window.__lkDiag() };
});
// BUILD 10: out in the field, past the wall — the crowd at the north gate
// shot from the side; the nearest bodies leave the gate and come for him
await shot('outside', () => {
  const g = window.__LN; const m = g.survival;
  const door = g.mansion.entrances.find((e) => e.id === 'northGate');
  const park = () => { g.player.x = door.x + 280; g.player.y = door.y - 170; g.player.blood = Math.max(g.player.blood, 80); };
  park();
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  for (let i = 0; i < 40; i++) { park(); window.__lkReal(1); }
  return { t: +m.elapsed.toFixed(1), exposed: !!m.captainExposed, onHim: g.enemies.filter((e) => e._onCaptain).length, target: !!m.currentTarget, ...window.__lkDiag() };
});
// BUILD 10: the guards' posts up on the wall — the north gate's towers seen
// from the yard (their ladders face the camera) with a guard on each
await shot('posts', () => {
  const g = window.__LN; const m = g.survival;
  const door = g.mansion.entrances.find((e) => e.id === 'northGate');
  const park = () => { g.player.x = door.x + 70; g.player.y = door.y + 120; };
  park();
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  for (let i = 0; i < 30; i++) { park(); window.__lkReal(1); }
  return { posts: m.guards.map((gd) => gd.post && gd.post.key), lift: m.guards.map((gd) => +gd.lift.toFixed(2)), ...window.__lkDiag() };
});
await shot('wide', () => {
  const g = window.__LN; const m = g.survival;
  const keep = m.keep();
  g.player.x = keep.x + 160; g.player.y = keep.y + 150;
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  window.__lkFast(() => m.elapsed < 24);
  window.__lkReal(8);
  return { t: +m.elapsed.toFixed(1), alive: m.aliveEnemies(), bailey: g.mansion.bailey, ...window.__lkDiag() };
});
await shot('south', () => {
  const g = window.__LN; const m = g.survival;
  const door = g.mansion.entrances.find((e) => e.id === 'southGate');
  const inside = door.inside || door;
  g.player.x = inside.x + 40; g.player.y = inside.y - 80;
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  // a capture, not a balance run: the keep may not fall before the frame
  m.keepHp = 99999;
  window.__lkFast(() => m.phase === 'night' && m.elapsed < 46);
  window.__lkReal(12);
  return { t: +m.elapsed.toFixed(1), alive: m.aliveEnemies(), kills: m.nightStats.kills, ...window.__lkDiag() };
});
// the first day: nothing built yet — where does a player look? (BUILD 11)
await shot('day0', () => {
  const g = window.__LN; const m = g.survival;
  m.restart();
  m.completeNight();
  window.__lkReal(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  g.survivalBakeDirty = true;
  const home = m.hunterHome();
  g.player.x = home.x; g.player.y = home.y;
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  window.__lkReal(20);
  return { phase: m.phase, day: m.day, ...window.__lkDiag() };
});
await shot('day', () => {
  const g = window.__LN; const m = g.survival;
  if (m.phase === 'failed' || m.phase === 'complete') m.restart();
  if (m.phase === 'night') m.completeNight();
  window.__lkReal(2);
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  m.gold = 99; m.wood = 99;
  m.buildings.north = 'mine'; m.buildingLevels.north = 1;
  m.buildings['north:tower'] = 'tower'; m.buildingLevels['north:tower'] = 2;
  m.buildings.ward = 'barracks'; m.buildingLevels.ward = 1;
  m.buildings.south = 'sawmill'; m.buildingLevels.south = 1;
  g.survivalBakeDirty = true;
  const keep = m.keep();
  g.player.x = keep.x + 190; g.player.y = keep.y + 60;
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  window.__lkReal(20);
  return { phase: m.phase, ...window.__lkDiag() };
});
await shot('build', () => {
  const g = window.__LN; const m = g.survival;
  const spot = m.buildingSpot('south:tower');
  g.player.x = spot.x; g.player.y = spot.y;
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  window.__lkReal(12);
  return { here: m.dayContext && m.dayContext(), ...window.__lkDiag() };
});
// BUILD 12: the dynamic camera — all the way out (the whole bailey, wall to
// wall, on a sideways phone) and all the way in (one district up close)
await shot('overview', () => {
  const g = window.__LN; const m = g.survival;
  if (m.phase === 'night') m.completeNight();
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  const keep = m.keep(); const home = m.hunterHome();
  g.player.x = home.x; g.player.y = home.y;
  m._userZoom = 0.42; m._zoomGoal = null;
  m.camPan.x = keep.x - home.x; m.camPan.y = keep.y - home.y + 40;
  g.renderer.snapCamera && g.renderer.snapCamera(keep.x, keep.y);
  window.__lkReal(60);
  return { zoom: +g.renderer.cam.zoom.toFixed(3), user: m.userZoom(), ...window.__lkDiag() };
});
await shot('closeup', () => {
  const g = window.__LN; const m = g.survival;
  const spot = m.buildingSpot('ward');
  g.player.x = spot.x + 90; g.player.y = spot.y + 90;
  m._userZoom = 1.6; m._zoomGoal = null; m.recenterCamera(true);
  g.renderer.snapCamera && g.renderer.snapCamera(g.player.x, g.player.y);
  window.__lkReal(60);
  return { zoom: +g.renderer.cam.zoom.toFixed(3), ...window.__lkDiag() };
});
console.log(`errors ${errors.length}`);
await browser.close();
server.kill('SIGTERM');
process.exit(0);
