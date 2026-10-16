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
 *   fx-horde             (2026-10-17) the main gate's horde: every swarm body
 *                        an animated GLB monster (instanced, crowd3d.js), a
 *                        ballista's kills over its deck, blue crested helmets,
 *                        the build stamp
 *   fx-mine              a mine digs: a 3D coin pops out of its shaft, "+1"
 *   fx-dawn              the dawn panel credits the sawmill and the guards
 *   fx-sawmill           COLLECT: the sawmill throws its planks, "+N"
 *   fx-day               day: NIGHT top-left apart from the build corner,
 *                        icon + number status pills over built buildings
 *   fx-barracks          a new barracks: its soldier steps out and walks
 *                        to the keep (blue rally ring, "+1")
 *   fx-end               a loss on Night 2: the whole run by source, the
 *                        night's track ("Ns TO DAWN") and one tip (R1, R4)
 *   fx-win               a real three-night win played by the builder bot
 *                        (tools/survival-bots.mjs) in the page: stars, the
 *                        MVP building, the records, NEW BEST! (R1-R3, R19)
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
  return { coins: window.__fxDiag().fx.played.coin - before, income: m.floaters.filter((f) => f.kind === 'income').map((f) => `${f.text}:${f.icon}`), hud: (m.hudPops || []).filter((q) => q.icon === 'gold' && q.from === 'mine').length };
});
check('mine: a dug coin pops out of the mine with "+1", and beside the purse in the HUD wherever the captain stands',
  mine.coins >= 1 && mine.income.includes('+1:gold') && mine.hud >= 1, mine);

// 2b. the horde at the main gate (2026-10-17 pass): every swarm body is an
// animated GLB monster (instanced, no primitive figure left), a built
// ballista credits its kills over its deck, the guards wear the keep's blue
// helmet with a gold crest, and the page says which build it is
const horde = await shot('fx-horde', () => {
  const g = window.__LN; const m = g.survival;
  m.buildings['south:tower'] = 'tower'; m.buildingLevels['south:tower'] = 1;
  g.survivalBakeDirty = true;
  const door = g.mansion.entrances.find((e) => e.id === 'southGate');
  const inside = door.inside || door;
  g.player.x = inside.x + 40; g.player.y = inside.y - 90;
  g.renderer.snapCamera(g.player.x, g.player.y);
  const keepHp = m.keepHp;
  m.keepHp = 99999;                       // a capture: the keep may not fall first
  // count the "+1" skulls the ballista pops while the night runs (a pop
  // lives 1.2 s, so most are gone by the captured frame)
  let skulls = 0;
  const proto = Object.getPrototypeOf(m).pushFloater;
  m.pushFloater = function (x, y, text, color, opts = {}) {
    if (opts.kind === 'income' && opts.icon === 'skull') skulls++;
    return proto.call(this, x, y, text, color, opts);
  };
  window.__fxFast(() => m.phase === 'night' && m.elapsed < 45);
  window.__fxRealtime(12);
  delete m.pushFloater;
  m.keepHp = Math.min(keepHp, m.keepHpMax());
  const d = window.__fxWorld.diagnostics();
  const tower = (m.towers || []).find((t) => t.slotId === 'south:tower');
  const knights = [];
  d && window.__fxWorld.survivalGuardMeshes && window.__fxWorld.survivalGuardMeshes.forEach((mesh) => {
    const troop = mesh.userData.troop;
    if (!troop) return;
    let crest = false, helmet = false;
    troop.model.traverse((o) => { if (o.name === 'knight-crest') crest = true; if (o.material && o.material.name === 'knight-helmet-royal-blue') helmet = true; });
    knights.push({ crest, helmet });
  });
  return {
    t: +m.elapsed.toFixed(1), horde: d.horde, primitiveCrowd: d.primitiveCrowd, rigs: d.visibleRiggedEnemies,
    towerKills: tower ? tower.nightKills || 0 : -1, skullPops: skulls,
    knights, build: window.DUSKHOLD_BUILD || null,
  };
});
check('horde: every swarm body is an animated GLB monster (instanced, 3 kinds), no primitive figure',
  horde.horde && horde.horde.ready && horde.horde.drawn >= 10 && horde.primitiveCrowd === 0
    && Object.values(horde.horde.byKind || {}).filter((n) => n > 0).length >= 2,
  { drawn: horde.horde && horde.horde.drawn, byKind: horde.horde && horde.horde.byKind, primitive: horde.primitiveCrowd, rigs: horde.rigs });
check('ballista: a built ballista kills and says so over its deck ("+1" skull, the night tally)',
  horde.towerKills >= 1 && horde.skullPops >= horde.towerKills, { towerKills: horde.towerKills, skullPops: horde.skullPops });
check('troops: every GLB guard wears the keep\'s blue helmet with a gold crest; the page names its build',
  horde.knights.length >= 2 && horde.knights.every((k) => k.crest && k.helmet) && horde.build === '8', { knights: horde.knights, build: horde.build });

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

// 7. a loss on Night 2: the whole run by source, the night's track and the
// tip. The night is played for real (no input: the captain only auto-shoots)
// up to 50 s; if the keep still stands then, the fall is forced there.
const end = await shot('fx-end', () => {
  const g = window.__LN; const m = g.survival;
  if (m.rewardPending && m.rewardPending()) m.ackRewards();
  const started = m.startNight();
  window.__fxFast(() => m.phase === 'night' && m.elapsed < 50);
  const natural = m.phase === 'failed';
  if (m.phase === 'night') m.fail('THE KEEP FELL');
  window.__fxRealtime(40);
  const by = m.runStats.by;
  const r = m.runResult || {};
  return {
    started, natural, phase: m.phase, run: m.runStats, sum: Object.values(by).reduce((a, b) => a + b, 0),
    result: { night: r.night, toDawn: r.toDawn, nights: r.nights, kills: r.kills, tip: r.tip, mvp: r.mvp, newBest: r.newBest },
    ui: g.ui.map((u) => u.label).filter(Boolean),
  };
});
check('end: a loss counts every kill of the run by source, shows the night\'s track with the seconds to dawn and one tip (R1, R4)',
  end.phase === 'failed' && end.run.kills > 0 && end.sum === end.run.kills && end.result.kills === end.run.kills && end.result.night === 2
    && end.result.toDawn > 0 && end.result.tip && end.result.tip.text.split(/\s+/).length <= 8 && end.result.newBest === false
    && end.ui.includes('survival:PLAY AGAIN'), { natural: end.natural, kills: end.run.kills, by: end.run.by, result: end.result });

// 8. a real three-night win: the builder bot plays it in the page, fast
await page.evaluate(async () => {
  window.__fxBots = await import('./tools/survival-bots.mjs');
  window.__fxRoom = (await import('./src/game/mansion.js')).ROOM;
  window.__fxIso = (await import('./src/core/util.js')).ISO_CAMERA;
});
const win = await shot('fx-win', () => {
  const g = window.__LN; const m = g.survival;
  const { botNight, botDay, releaseControls } = window.__fxBots;
  m.restart();
  g.input.touchSeen = true;
  const state = { flareHeld: false, rescue: true };
  const nightKills = [];
  let frames = 0;
  while (frames++ < 60 * 60 * 20 && m.phase !== 'complete' && m.phase !== 'failed') {
    if (m.phase === 'night' && !g.uiPanel) {
      botNight(g, state, { ROOM: window.__fxRoom, ISO_CAMERA: window.__fxIso });
      window.__fxOrig.call(g, 1 / 60);
      if (m.phase !== 'night') nightKills.push(m.phase === 'failed' ? m.nightStats.kills : m.lastRewards.kills);
      continue;
    }
    releaseControls(g);
    if (m.phase === 'day') botDay(g, 'builder');
    window.__fxOrig.call(g, 1 / 60);
  }
  releaseControls(g);
  window.__fxRealtime(90);
  const r = m.runResult || {};
  return {
    frames, phase: m.phase, nightKills, run: { kills: m.runStats.kills, by: m.runStats.by, towers: m.runStats.towers, keepMin: m.runStats.keepMin, lost: m.runStats.lost },
    result: { stars: r.stars, kills: r.kills, keepLeft: r.keepLeft, built: r.built, time: r.time, mvp: r.mvp, newBest: r.newBest },
    records: m.records, ui: g.ui.map((u) => u.label).filter(Boolean),
  };
});
check('win: the builder\'s real three nights end on stars from the keep\'s lowest point, the run\'s numbers, the MVP building, the records and NEW BEST! over the loss (R1-R3, R19)',
  win.phase === 'complete' && win.nightKills.length === 3 && win.result.kills === win.nightKills.reduce((a, b) => a + b, 0)
    && win.result.stars >= 1 && win.result.stars === (win.run.keepMin < 0.5 ? 1 : (win.run.lost > 0 ? 2 : 3))
    && win.result.newBest === true && win.records.runs === 2 && win.records.wins === 1 && win.records.bestStars === win.result.stars
    && (!win.result.mvp || win.result.mvp.name !== 'CAPTAIN') && win.ui.includes('survival:PLAY AGAIN'),
  { frames: win.frames, nightKills: win.nightKills, result: win.result, records: win.records, by: win.run.by, towers: win.run.towers });

check('health: 0 page errors, 0 console errors', !pageErrors.length && !consoleErrors.length, { pageErrors: pageErrors.slice(0, 3), consoleErrors: consoleErrors.slice(0, 3) });
const passed = checks.filter((c) => c.ok).length;
console.log(`SUMMARY ${passed}/${checks.length} PASS`);
fs.writeFileSync(path.join(OUT, 'fxshots.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), view: { ...VIEW, dpr: DPR }, checks, results, pageErrors, consoleErrors }, null, 2)}\n`);
await browser.close();
server.kill('SIGTERM');
process.exit(passed === checks.length ? 0 : 1);
