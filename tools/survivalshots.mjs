/* survivalshots.mjs — quick readability evidence for the default Survival route.
 *
 * Captures the phone viewport (390×844 @2x) at fixed simulation times and
 * measures what is actually on the pixels: mean luma of the playfield and
 * the share of near-black pixels. Use it for before/after comparisons when
 * the lighting or HUD changes.
 *
 *   node tools/survivalshots.mjs                    # writes tools/shots-browser/survival/*.png
 *   node tools/survivalshots.mjs --out=qa-evidence  # write elsewhere
 *   node tools/survivalshots.mjs --tag=before       # file prefix
 *
 * The playfield metric ignores the top 120 and bottom 90 CSS pixels so the
 * HUD chrome does not inflate or hide the result.
 *
 * The adaptive quality ladder reacts to wall-clock frame time, which in a
 * software-WebGL browser depends on machine load; captures therefore pin the
 * top tier (override with --quality=N) so two runs are comparable.
 * --no-progression skips the building-level / Hunter captures. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const OUT = path.resolve(ROOT, args.out || 'tools/shots-browser/survival');
const TAG = args.tag ? `${args.tag}-` : '';
const PORT = Number(args.port || 8103);
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
  headless: true, protocolTimeout: 240000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e.message).slice(0, 250)); console.log('PAGEERROR', String(e.message).slice(0, 250)); });
const VIEW = args.landscape ? { width: 844, height: 390 } : { width: 390, height: 844 };
await page.setViewport({ ...VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) { /* ignore */ } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__LN;
  return !!(g && g.mode === 'survival' && g.screen === 'playing' && g.survival && g.survival.phase === 'night');
}, { timeout: 120000, polling: 100 });
await page.evaluate(async () => {
  window.__survWorld = (await import('./src/game/world3d.js')).World3D;
  window.__survEnemy = (await import('./src/game/enemy3d.js')).Enemy3D;
});
await page.waitForFunction(() => window.__survWorld?.diagnostics?.().ready, { timeout: 90000, polling: 100 });
await page.waitForFunction(() => {
  const state = window.__survEnemy?.readiness?.();
  return !!(state && (state.ready || state.failed.length));
}, { timeout: 90000, polling: 100 }).catch(() => {});
await page.evaluate((tier) => {
  const g = window.__LN;
  g.setQuality(tier == null ? 99 : tier);
  g._frameCheck = -Infinity;          // no adaptive steps during the captures
  g.survival.restart();
  window.__origUpdate = g.update;
  g.update = () => {};
  g.render();
}, args.quality == null ? null : Number(args.quality));

async function luma(file) {
  const img = await loadImage(fs.readFileSync(file));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const scale = img.width / VIEW.width;
  const top = Math.round(120 * scale), bottom = Math.round(img.height - 90 * scale);
  const data = ctx.getImageData(0, top, img.width, bottom - top).data;
  let sum = 0, dark = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += l; n++;
    if (l < 28) dark++;
  }
  return { meanLuma: +(sum / n).toFixed(1), darkPct: +((dark / n) * 100).toFixed(1) };
}

const results = [];
async function shot(name, prepare) {
  const state = await page.evaluate(prepare);
  const file = path.join(OUT, `${TAG}${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  const metrics = await luma(file);
  const quality = await page.evaluate(() => window.__LN.quality);
  results.push({ name, file: path.relative(ROOT, file), ...metrics, quality, state });
  console.log(`  SHOT ${name.padEnd(14)} luma=${metrics.meanLuma} dark=${metrics.darkPct}% ${JSON.stringify(state)}`);
}

const advanceTo = (target) => {
  const g = window.__LN;
  let steps = 0;
  while (g.survival.elapsed + 1e-6 < target && g.screen === 'playing' && g.survival.phase === 'night' && steps < 12000) {
    window.__origUpdate.call(g, 1 / 60);
    steps++;
  }
  g.render();
  return {
    t: +g.survival.elapsed.toFixed(1), alive: g.enemies.filter((e) => !e.dead).length,
    oil: Math.floor(g.survival.oil), hp: Math.round(g.player.blood), phase: g.survival.phase,
    ui: g.ui.length,
  };
};
await shot('night-00s', `(${advanceTo})(0.2)`);
await shot('night-20s', `(${advanceTo})(20)`);
await shot('night-40s', `(${advanceTo})(40)`);
const stepFrames = (n) => {
  const g = window.__LN;
  for (let i = 0; i < n; i++) window.__origUpdate.call(g, 1 / 60);
  g.render();
};
await shot('day-reward', `(() => {
  const g = window.__LN;
  g.survival.completeNight();
  (${stepFrames})(30);
  return { phase: g.survival.phase, day: g.survival.day, ui: g.ui.map((b) => b.label).slice(0, 14) };
})()`);
await shot('day-panel', `(() => {
  const g = window.__LN;
  const collect = g.ui.find((b) => b.label === 'survival:COLLECT');
  if (collect) collect.onClick();
  (${stepFrames})(90);
  return { collected: !!collect, ui: g.ui.map((b) => b.label).slice(0, 16) };
})()`);
await shot('day-select', `(() => {
  const g = window.__LN;
  const slot = g.ui.find((b) => /survival:slot:/i.test(b.label) && !b.disabled);
  if (slot && slot.onClick) slot.onClick();
  (${stepFrames})(90);
  return { clicked: slot ? slot.label : null, ui: g.ui.map((b) => b.label).slice(0, 16) };
})()`);
await shot('day-build', `(() => {
  const g = window.__LN;
  const card = g.ui.find((b) => /survival:BUILD extractor/i.test(b.label) && !b.disabled);
  if (card && card.onClick) card.onClick();
  (${stepFrames})(120);
  return { built: card ? card.label : null, job: g.survival.builderJob, ui: g.ui.map((b) => b.label).slice(0, 16) };
})()`);
await shot('night2-flare', `(() => {
  const g = window.__LN;
  const m = g.survival;
  while (m.builderJob) window.__origUpdate.call(g, 1 / 60);
  const collect = g.ui.find((b) => b.label === 'survival:COLLECT');
  if (collect) collect.onClick();
  m.startNight();
  let steps = 0;
  while (m.elapsed < 34 && m.phase === 'night' && steps++ < 4000) window.__origUpdate.call(g, 1 / 60);
  // walk the Hunter toward the nearest enemy inside the firelight and flare
  const p = g.player;
  const near = g.enemies.filter((e) => !e.dead && e._survivalType).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  m.skillCooldown = 0;
  m.useSkill();
  for (let i = 0; i < 12; i++) window.__origUpdate.call(g, 1 / 60);
  g.render();
  return { t: +m.elapsed.toFixed(1), day: m.day, alive: m.aliveEnemies(), feeders: m.hearthFeeders, oil: Math.floor(m.oil), nearest: near ? Math.round(Math.hypot(near.x - p.x, near.y - p.y)) : null, floaters: m.floaters.length };
})()`);
await shot('failed', `(() => {
  const g = window.__LN;
  g.survival.startNight();
  for (let i = 0; i < 60; i++) window.__origUpdate.call(g, 1 / 60);
  g.survival.fail('THE FIRE WENT OUT');
  g.render();
  return { phase: g.survival.phase, ui: g.ui.map((b) => b.label) };
})()`);

// Door-slit defence: the Hunter steps up behind the front door while wave 1
// claws it; guards post beside him; the camera leans toward the crowd.
await shot('night-door', `(() => {
  const g = window.__LN;
  const m = g.survival;
  m.restart();
  let steps = 0;
  while (m.elapsed < 9 && m.phase === 'night' && steps++ < 2000) window.__origUpdate.call(g, 1 / 60);
  const door = m.entranceById('frontDoor');
  const ix = door.inside.x - door.x, iy = door.inside.y - door.y, il = Math.hypot(ix, iy) || 1;
  g.player.x = door.inside.x + ix / il * 60; g.player.y = door.inside.y + iy / il * 60;
  g.renderer.snapCamera(g.player.x, g.player.y);
  steps = 0;
  while (m.elapsed < 13 && m.phase === 'night' && steps++ < 2000) window.__origUpdate.call(g, 1 / 60);
  g.render();
  return { t: +m.elapsed.toFixed(1), doorHp: Math.round(door.hp), target: !!m.currentTarget, guardsAtDoor: m.guards.filter((gd) => gd.post && gd.post.doorId === 'frontDoor').length, kills: m.nightStats.kills, zoom: +g.renderer.cam.zoom.toFixed(3) };
})()`);

// Progression: building levels + the Hunter's track. A real Night 2 with a
// pump, a sawmill and a shelter standing (hearth kept fed so the capture is
// about the UI, not the balance), then the dawn reward, sheets and pennants.
if (!args['no-progression']) {
  const finishJob = () => {
    const g = window.__LN;
    let n = 0;
    while (g.survival.builderJob && n++ < 3000) window.__origUpdate.call(g, 1 / 60);
  };
  await shot('prog-reward', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    let steps = 0;
    while (m.phase === 'night' && steps++ < 6000) { m.oil = Math.max(m.oil, 40); window.__origUpdate.call(g, 1 / 60); }
    const collect0 = g.ui.find((b) => b.label === 'survival:COLLECT');
    if (collect0) collect0.onClick(); else m.ackRewards();
    m.perapianLevel = 3; m.refreshFireplace(true);
    m.oil = 160; m.wood = 160;
    const rooms = m.buildableRooms();
    const plan = [['extractor', rooms[0]], ['sawmill', rooms[1]], ['shelter', rooms[2]]];
    for (const [type, room] of plan) { if (room && m.startBuild(type, room.id)) (${finishJob})(); }
    m.startNight();
    steps = 0;
    while (m.phase === 'night' && steps++ < 6000) { m.oil = Math.max(m.oil, 60); window.__origUpdate.call(g, 1 / 60); }
    (${stepFrames})(30);
    return { phase: m.phase, day: m.day, rewards: m.lastRewards, buildings: { ...m.buildings }, ui: g.ui.map((b) => b.label).slice(0, 8) };
  })()`);
  await shot('prog-built', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const collect = g.ui.find((b) => b.label === 'survival:COLLECT');
    if (collect) collect.onClick();
    m.oil = 120; m.wood = 120;
    (${stepFrames})(20);
    const pump = Object.keys(m.buildings).find((r) => m.buildings[r] === 'extractor');
    const bubble = g.ui.find((b) => b.label === 'survival:select:' + pump);
    if (bubble) bubble.onClick();
    (${stepFrames})(30);
    return { pump, selected: m.dayFocus, ui: g.ui.map((b) => b.label).filter((l) => /UPGRADE|select:/.test(l)) };
  })()`);
  await shot('prog-upgrading', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const btn = g.ui.find((b) => /^survival:UPGRADE extractor LV2$/.test(b.label) && !b.disabled);
    if (btn) btn.onClick();
    (${stepFrames})(150);
    return { clicked: btn ? btn.label : null, job: m.builderJob };
  })()`);
  await shot('prog-hunter', `(() => {
    const g = window.__LN;
    const m = g.survival;
    (${finishJob})();
    (${stepFrames})(5);
    const bubble = g.ui.find((b) => b.label === 'survival:select:hunter');
    if (bubble) bubble.onClick();
    (${stepFrames})(30);
    return { selected: m.dayFocus, levels: { ...m.buildingLevels }, ui: g.ui.map((b) => b.label).filter((l) => /UPGRADE|hunter/.test(l)) };
  })()`);
  await shot('prog-levels', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const btn = g.ui.find((b) => /^survival:UPGRADE HUNTER LV2$/.test(b.label) && !b.disabled);
    if (btn) btn.onClick();
    (${finishJob})();
    const pump = Object.keys(m.buildings).find((r) => m.buildings[r] === 'extractor');
    const mill = Object.keys(m.buildings).find((r) => m.buildings[r] === 'sawmill');
    m.oil = 120; m.wood = 120;
    if (m.startBuild('upgrade', pump)) (${finishJob})();
    if (m.startBuild('upgrade', mill)) (${finishJob})();
    // look at the Lv3 pump: bigger model + two gold pennants
    m.dayFocus = pump; m.selectedRoom = pump;
    (${stepFrames})(60);
    return { hunter: m.hunterLevel, levels: { ...m.buildingLevels }, hp: g.player.blood + '/' + g.player.bloodMax, door: m.doorHpBonus(), focus: m.dayFocus };
  })()`);
  await shot('prog-night', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.startNight();
    let steps = 0;
    while (m.elapsed < 14 && m.phase === 'night' && steps++ < 3000) window.__origUpdate.call(g, 1 / 60);
    g.render();
    return { t: +m.elapsed.toFixed(1), hunter: m.hunterLevel, hp: Math.round(g.player.blood) + '/' + g.player.bloodMax, pumped: +(m.nightStats.pumped || 0).toFixed(2), kills: m.nightStats.kills };
  })()`);
}

fs.writeFileSync(path.join(OUT, `${TAG}metrics.json`), `${JSON.stringify({ capturedAt: new Date().toISOString(), results, pageErrors }, null, 2)}\n`);
console.log(`pageErrors=${pageErrors.length}`);
await browser.close();
server.kill('SIGTERM');
process.exit(0);
