/* DUSKHOLD Survival — evidence for the 2026-10-16 feedback pass.
 *
 * The user's playtest note: the fortress was too big for its small actors,
 * the troops were placeholders, shots and damage had no punch, built
 * buildings did not seem to work, and the UI has to be right. This captures
 * one landscape run that shows each fix where it happens and checks the
 * parts a script can see:
 *
 *   fx-gate / fx-gate-b  GLB knights (royal-blue livery) at the north gate,
 *                        glowing bolts with streaks, hit flashes, numbers
 *   fx-mine              a mine digs: a 3D coin pops out of its shaft, "+1"
 *   fx-dawn              the dawn panel credits the sawmill and the guards
 *   fx-sawmill           COLLECT: the sawmill throws its planks, "+N"
 *   fx-day               day: NIGHT top-left apart from the build corner,
 *                        icon + number status pills over built buildings
 *   fx-barracks          a new barracks: its soldier steps out and walks
 *                        to the keep (blue rally ring, "+1")
 *   fx-end               the end panel counts the whole run, by source
 *
 * Usage: node tools/survival-fxshots.mjs [--out=qa-evidence/survival-fixes]
 *        [--dpr=1] [--port=8106]
 * Captures are single frames of a headless software renderer: they show
 * that an effect is there, not how it feels on a phone.
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
const OUT = path.resolve(ROOT, args.out || 'qa-evidence/survival-fixes');
const PORT = Number(args.port || 8106);
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
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e.message).slice(0, 250)); console.log('PAGEERROR', String(e.message).slice(0, 250)); });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 250)); });
const VIEW = { width: 844, height: 390 };
await page.setViewport({ ...VIEW, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) { /* ignore */ } });
await page.goto(`http://127.0.0.1:${PORT}/?cine=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__LN;
  return !!(g && g.mode === 'survival' && g.screen === 'playing' && g.survival && g.survival.phase === 'night');
}, { timeout: 120000, polling: 100 });
await page.evaluate(async () => {
  window.__fxWorld = (await import('./src/game/world3d.js')).World3D;
  window.__fxEnemy = (await import('./src/game/enemy3d.js')).Enemy3D;
  window.__fxTroop = (await import('./src/game/troop3d.js')).Troop3D;
});
await page.waitForFunction(() => window.__fxWorld?.diagnostics?.().ready, { timeout: 90000, polling: 100 });
await page.waitForFunction(() => {
  const s = window.__fxEnemy?.readiness?.();
  return !!(s && (s.ready || s.failed.length));
}, { timeout: 90000, polling: 100 }).catch(() => {});
await page.evaluate(() => {
  const g = window.__LN;
  g.setQuality(99);
  g._frameCheck = -Infinity;
  g.survival.restart();
  window.__fxOrig = g.update;
  g.update = () => {};
  // n frames of play, each one drawn (effects age on the game clock)
  window.__fxRealtime = (n) => { for (let i = 0; i < n; i++) { window.__fxOrig.call(g, 1 / 60); g.render(); } };
  window.__fxFast = (until) => { let n = 0; while (until() && n < 20000) { window.__fxOrig.call(g, 1 / 60); n++; } return n; };
  window.__fxDiag = () => { const d = window.__fxWorld.diagnostics(); return { troop3d: d.troop3d, glbGuards: d.glbGuards, fx: d.fx }; };
  g.render();
});
// the knight GLB arrives on its own fetch; the guards dress as soon as it lands
await page.evaluate(() => { window.__fxRealtime(2); });
await page.waitForFunction(() => window.__fxTroop && (window.__fxTroop.ready || window.__fxTroop.failed), { timeout: 90000, polling: 200 }).catch(() => {});

const results = [];
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${JSON.stringify(detail)}`);
};
async function shot(name, prepare) {
  const state = await page.evaluate(prepare);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  results.push({ name, file: path.relative(ROOT, file), state });
  console.log(`  SHOT ${name.padEnd(12)} ${JSON.stringify(state).slice(0, 400)}`);
  return state;
}

// 1. the north gate at night: knights, bolts, hits, numbers
const gate = await shot('fx-gate', () => {
  const g = window.__LN; const m = g.survival;
  const door = g.mansion.entrances.find((e) => e.id === 'northGate');
  const inside = door.inside || door;
  g.player.x = inside.x; g.player.y = inside.y + 60;
  window.__fxFast(() => m.elapsed < 11);
  window.__fxRealtime(10);
  return { t: +m.elapsed.toFixed(1), guards: m.guards.length, ...window.__fxDiag() };
});
check('troops: the guards are GLB knights in the keep\'s blue livery',
  gate.troop3d && gate.troop3d.ready && !gate.troop3d.failed && gate.troop3d.livery >= 1 && gate.glbGuards === gate.guards && gate.guards > 0, gate);
const gateB = await shot('fx-gate-b', () => {
  window.__fxRealtime(14);
  const m = window.__LN.survival;
  return { kills: m.nightStats.kills, by: m.nightStats.by, ...window.__fxDiag() };
});
const played = (gateB.fx && gateB.fx.played) || {};
check('fx: hits flash, kills burst and shots flash at the muzzle',
  played.impact > 0 && played.kill > 0 && played.muzzle > 0 && gateB.fx.live > 0, gateB.fx);
check('kills: every kill is credited to a source (captain / guard / ballista / keep / flare)',
  gateB.kills > 0 && Object.values(gateB.by || {}).reduce((a, b) => a + b, 0) === gateB.kills, { kills: gateB.kills, by: gateB.by });

// 2. a mine digs: a coin out of its shaft and "+1"
const mine = await shot('fx-mine', () => {
  const g = window.__LN; const m = g.survival;
  m.buildings.north = 'mine'; m.buildingLevels.north = 1;
  g.survivalBakeDirty = true;
  const spot = m.buildingSpot('north');
  g.player.x = spot.x + 120; g.player.y = spot.y + 70;
  g.renderer.snapCamera(g.player.x, g.player.y);
  const before = window.__fxDiag().fx.played.coin;
  m._mineBank.north = 0.995;
  window.__fxRealtime(12);
  return { coins: window.__fxDiag().fx.played.coin - before, income: m.floaters.filter((f) => f.kind === 'income').map((f) => `${f.text}:${f.icon}`) };
});
check('mine: a dug coin pops out of the mine with "+1"', mine.coins >= 1 && mine.income.includes('+1:gold'), mine);

// 3. dawn: the panel credits the sawmill and the guards
const dawn = await shot('fx-dawn', () => {
  const g = window.__LN; const m = g.survival;
  m.buildings.south = 'sawmill'; m.buildingLevels.south = 1;
  g.survivalBakeDirty = true;
  window.__fxFast(() => m.phase === 'night' && m.elapsed < 30);
  m.completeNight();
  // two played frames, so the HUD has left its night layout (no FLARE, no
  // stick) exactly as a player sees the panel
  window.__fxRealtime(2);
  return { phase: m.phase, rewards: m.lastRewards, run: m.runStats, ui: g.ui.map((u) => u.label).filter(Boolean) };
});
check('dawn: the reward counts the sawmill\'s planks and the kills by source',
  dawn.phase === 'day' && dawn.rewards && dawn.rewards.sawn > 0 && dawn.rewards.killsBy && dawn.run && dawn.run.kills === dawn.rewards.kills,
  { sawn: dawn.rewards && dawn.rewards.sawn, killsBy: dawn.rewards && dawn.rewards.killsBy, runKills: dawn.run && dawn.run.kills });

// 4. COLLECT: the sawmill hands over its planks where you can see it
const saw = await shot('fx-sawmill', () => {
  const g = window.__LN; const m = g.survival;
  const before = window.__fxDiag().fx.played.log;
  m.ackRewards();
  const spot = m.buildingSpot('south');
  g.player.x = spot.x + 140; g.player.y = spot.y - 20;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__fxRealtime(14);
  return { logs: window.__fxDiag().fx.played.log - before, income: m.floaters.filter((f) => f.kind === 'income').map((f) => `${f.text}:${f.icon}`) };
});
check('sawmill: COLLECT throws its planks off the sawmill with "+N"', saw.logs >= 1 && saw.income.some((s) => /^\+\d+:wood$/.test(s)), saw);

// 5. day: NIGHT apart from the build corner; status pills over the buildings
const day = await shot('fx-day', () => {
  const g = window.__LN; const m = g.survival;
  m.keepHp = Math.round(m.keepHpMax() * 0.7);      // the keep's day bar shows
  const keep = m.keep();
  g.player.x = keep.x + 200; g.player.y = keep.y + 40;
  g.renderer.snapCamera(g.player.x, g.player.y);
  window.__fxRealtime(6);
  const pick = (re) => { const u = g.ui.find((item) => re.test(item.label || '')); return u ? { x: u.x, y: u.y, w: u.w, h: u.h, label: u.label } : null; };
  return { night: pick(/START NIGHT/), action: pick(/^survival:(BUILD|UPGRADE|REPAIR)/), view: { w: innerWidth, h: innerHeight } };
});
const dist = day.night && day.action ? Math.hypot((day.night.x + day.night.w / 2) - (day.action.x + day.action.w / 2), (day.night.y + day.night.h / 2) - (day.action.y + day.action.h / 2)) : 0;
check('ui: NIGHT sits top-left, far from the build corner (R18a)',
  day.night && day.night.x < day.view.w * 0.25 && day.night.y < day.view.h * 0.4 && (!day.action || dist > day.view.w * 0.5), { ...day, dist: Math.round(dist) });

// 6. a new barracks: its soldier steps out and walks to the keep
const barracks = await shot('fx-barracks', () => {
  const g = window.__LN; const m = g.survival;
  const slot = 'ward';
  const spot = m.buildingSpot(slot);
  g.player.x = spot.x + 70; g.player.y = spot.y + 80;
  g.renderer.snapCamera(g.player.x, g.player.y);
  m.gold = 99; m.wood = 99;
  const ok = m.startBuild('barracks', slot);
  const rally0 = window.__fxDiag().fx.played.rally;
  window.__fxFast(() => !!m.builderJob);
  const fresh = m.guards[m.guards.length - 1];
  const start = { x: Math.round(fresh.x), y: Math.round(fresh.y) };
  window.__fxRealtime(14);
  return { ok, survivors: m.survivors, start, fromSpot: Math.round(Math.hypot(start.x - spot.x, start.y - spot.y)), rally: window.__fxDiag().fx.played.rally - rally0 };
});
const walked = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  window.__fxFast(() => { const q = m.guards[m.guards.length - 1]; return !!(q.path && q.pathI < q.path.length); });
  const q = m.guards[m.guards.length - 1];
  return { at: [Math.round(q.x), Math.round(q.y)], post: q.post ? [Math.round(q.post.x), Math.round(q.post.y)] : null };
});
check('barracks: the housed soldier steps out of its door, a blue rally ring pops, and it walks to its post',
  barracks.ok && barracks.fromSpot <= 80 && barracks.rally >= 1 && walked.post && Math.hypot(walked.at[0] - walked.post[0], walked.at[1] - walked.post[1]) < 24,
  { ...barracks, walked });

// 7. the end panel: the whole run, by source
const end = await shot('fx-end', () => {
  const g = window.__LN; const m = g.survival;
  m.fail('THE KEEP FELL');
  window.__fxRealtime(2);
  const by = m.runStats.by;
  return { phase: m.phase, run: m.runStats, sum: Object.values(by).reduce((a, b) => a + b, 0), ui: g.ui.map((u) => u.label).filter(Boolean) };
});
check('end: the panel counts every kill of the run and who made it (R1)',
  end.phase === 'failed' && end.run.kills > 0 && end.sum === end.run.kills && end.ui.includes('survival:PLAY AGAIN'), { kills: end.run.kills, by: end.run.by });

check('health: 0 page errors, 0 console errors', !pageErrors.length && !consoleErrors.length, { pageErrors: pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3) });
const passed = checks.filter((c) => c.ok).length;
console.log(`SUMMARY ${passed}/${checks.length} PASS`);
fs.writeFileSync(path.join(OUT, 'fxshots.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), view: { ...VIEW, dpr: DPR }, checks, results, pageErrors, consoleErrors }, null, 2)}\n`);
await browser.close();
server.kill('SIGTERM');
process.exit(passed === checks.length ? 0 : 1);
