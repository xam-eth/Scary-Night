/* survivalshots.mjs — quick readability evidence for the default Survival route.
 *
 * Captures the phone viewport (390×844 @2x) at fixed simulation times and
 * measures what is actually on the pixels: mean luma of the playfield and
 * the share of near-black pixels. Use it for before/after comparisons when
 * the lighting or HUD changes. K1 "Benteng Terakhir": the keep in the Main
 * Hall, the day's walk-to-a-circle builder (P1) and its contextual button.
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
 * --no-progression skips the keep-level / Hunter captures, --no-towers the
 * ballista ones, --no-guards the fallen-guard ones; --towers-only /
 * --guards-only capture just those. */
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
    gold: Math.floor(g.survival.gold), keep: Math.round(g.survival.keepHp), hp: Math.round(g.player.blood), phase: g.survival.phase,
    ui: g.ui.length,
  };
};
const stepFrames = (n) => {
  const g = window.__LN;
  for (let i = 0; i < n; i++) window.__origUpdate.call(g, 1 / 60);
  g.render();
};
// --towers-only: just the tower captures (each starts its own run)
const TOWERS_ONLY = !!args['towers-only'];
const GUARDS_ONLY = !!args['guards-only'];
const finishJob = () => {
  const g = window.__LN;
  let n = 0;
  while (g.survival.builderJob && n++ < 3000) window.__origUpdate.call(g, 1 / 60);
};
// walk the Hunter (the real day walk) to a day point by id, then settle
const walkTo = (id) => {
  const g = window.__LN;
  const m = g.survival;
  const point = m.dayPoints().find((q) => q.id === id);
  if (!point) return null;
  m.walkTo(point.x, point.y);
  let n = 0;
  while (m.walkPath && n++ < 900) window.__origUpdate.call(g, 1 / 60);
  for (let i = 0; i < 40; i++) window.__origUpdate.call(g, 1 / 60);
  g.render();
  const here = m.dayContext();
  return here ? here.id : null;
};
// a capture that is about the UI keeps the keep standing (not the balance)
const holdKeep = () => { const m = window.__LN.survival; m.keepHp = Math.max(m.keepHp, m.keepHpMax() * 0.55); };
if (!TOWERS_ONLY && !GUARDS_ONLY) {
await shot('night-00s', `(${advanceTo})(0.2)`);
await shot('night-20s', `(${advanceTo})(20)`);
await shot('night-40s', `(${advanceTo})(40)`);
await shot('day-reward', `(() => {
  const g = window.__LN;
  g.survival.completeNight();
  (${stepFrames})(30);
  return { phase: g.survival.phase, day: g.survival.day, rewards: g.survival.lastRewards, ui: g.ui.map((b) => b.label).slice(0, 14) };
})()`);
await shot('day-keep', `(() => {
  const g = window.__LN;
  const collect = g.ui.find((b) => b.label === 'survival:COLLECT');
  if (collect) collect.onClick();
  (${stepFrames})(60);
  const m = g.survival;
  return { collected: !!collect, context: m.dayContext() && m.dayContext().id, ui: g.ui.map((b) => b.label).filter((l) => !/walk:/.test(l)) };
})()`);
await shot('day-circle', `(() => {
  const g = window.__LN;
  const at = (${walkTo})('hall:tower');
  const w = window.__survWorld;
  return { at, ring: !!(w.survivalTowerRing && w.survivalTowerRing.visible), ui: g.ui.map((b) => b.label).filter((l) => !/walk:/.test(l)) };
})()`);
await shot('day-build', `(() => {
  const g = window.__LN;
  const m = g.survival;
  const btn = g.ui.find((b) => b.label === 'survival:BUILD tower' && !b.disabled);
  if (btn) btn.onClick();
  (${stepFrames})(150);
  return { clicked: btn ? btn.label : null, job: m.builderJob && { kind: m.builderJob.kind, slot: m.builderJob.slotId, left: +m.builderJob.remaining.toFixed(1) } };
})()`);
await shot('day-built', `(() => {
  const g = window.__LN;
  const m = g.survival;
  (${finishJob})();
  const at = (${walkTo})('dining');
  return { at, buildings: { ...m.buildings }, chips: g.ui.filter((b) => /walk:/.test(b.label)).length, ui: g.ui.map((b) => b.label).filter((l) => !/walk:/.test(l)) };
})()`);
await shot('night2-flare', `(() => {
  const g = window.__LN;
  const m = g.survival;
  (${finishJob})();
  m.startNight();
  let steps = 0;
  while (m.elapsed < 34 && m.phase === 'night' && steps++ < 4000) { (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
  m.skillCooldown = 0;
  m.useSkill();
  for (let i = 0; i < 12; i++) window.__origUpdate.call(g, 1 / 60);
  g.render();
  return { t: +m.elapsed.toFixed(1), day: m.day, alive: m.aliveEnemies(), keep: Math.round(m.keepHp), attackers: m.keepAttackers, state: m.keepState(), floaters: m.floaters.length };
})()`);
await shot('failed', `(() => {
  const g = window.__LN;
  g.survival.startNight();
  for (let i = 0; i < 60; i++) window.__origUpdate.call(g, 1 / 60);
  g.survival.fail('THE KEEP FELL');
  g.render();
  return { phase: g.survival.phase, ui: g.ui.map((b) => b.label) };
})()`);

// Door-slit defence: the Hunter steps up behind the door wave 1 claws (K1:
// the chapel door — Night 1 opens on the far side of the house); guards post
// beside him; the camera leans toward the crowd.
await shot('night-door', `(() => {
  const g = window.__LN;
  const m = g.survival;
  m.restart();
  let steps = 0;
  while (m.elapsed < 9 && m.phase === 'night' && steps++ < 2000) window.__origUpdate.call(g, 1 / 60);
  const door = m.entranceById('chapelDoor');
  const ix = door.inside.x - door.x, iy = door.inside.y - door.y, il = Math.hypot(ix, iy) || 1;
  g.player.x = door.inside.x + ix / il * 60; g.player.y = door.inside.y + iy / il * 60;
  g.renderer.snapCamera(g.player.x, g.player.y);
  steps = 0;
  while (m.elapsed < 13 && m.phase === 'night' && steps++ < 2000) window.__origUpdate.call(g, 1 / 60);
  g.render();
  return { t: +m.elapsed.toFixed(1), door: door.id, doorHp: Math.round(door.hp), target: !!m.currentTarget, guardsAtDoor: m.guards.filter((gd) => gd.post && gd.post.doorId === door.id).length, kills: m.nightStats.kills, zoom: +g.renderer.cam.zoom.toFixed(3) };
})()`);
}

// Progression: the keep's levels (Lv3: two banners and a roof ballista),
// the armory rack (the Hunter's track), then a real night with both.
if (!args['no-progression'] && !TOWERS_ONLY && !GUARDS_ONLY) {
  await shot('prog-keep', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    m.completeNight();
    m.ackRewards();
    m.gold = 160; m.wood = 160;
    for (const lv of [2, 3]) { if (m.startBuild('keep')) (${finishJob})(); }
    for (const [type, id] of [['mine', 'basement'], ['sawmill', 'dining'], ['barracks', 'library'], ['tower', 'hall:tower']]) { if (m.startBuild(type, id)) (${finishJob})(); }
    m.keepHp = m.keepHpMax() * 0.45;   // hurt: the cracks and the REPAIR button show
    const k = m.keep();
    g.player.x = k.x + 30; g.player.y = k.y + k.r + 70;
    (${stepFrames})(60);
    return { keepLevel: m.keepLevel, hp: Math.round(m.keepHp) + '/' + m.keepHpMax(), territory: m.territoryRooms().length, context: m.dayContext() && m.dayContext().id, ui: g.ui.map((b) => b.label).filter((l) => !/walk:/.test(l)) };
  })()`);
  await shot('prog-hunter', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const at = (${walkTo})('armory');
    return { at, hunter: m.hunterLevel, ui: g.ui.map((b) => b.label).filter((l) => !/walk:/.test(l)) };
  })()`);
  await shot('prog-night', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.gold = Math.max(m.gold, 60); m.wood = Math.max(m.wood, 60);
    for (let i = 0; i < 2; i++) { if (m.startBuild('hunter')) (${finishJob})(); }
    m.startNight();
    let steps = 0;
    while (m.elapsed < 24 && m.phase === 'night' && steps++ < 3000) { (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    g.render();
    return { t: +m.elapsed.toFixed(1), keep: m.keepLevel, roofShots: m.keepBallista.shots, hunter: m.hunterLevel, hp: Math.round(g.player.blood) + '/' + g.player.bloodMax, mined: +(m.nightStats.mined || 0).toFixed(2), kills: m.nightStats.kills };
  })()`);
  await shot('complete', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.nightsCompleted = 2; m.day = 3;
    m.completeNight();
    g.render();
    return { phase: m.phase, ui: g.ui.map((b) => b.label) };
  })()`);
}

// Towers: a ballista built on the front-door circle through the real day
// walk + BUILD button, then Lv2 firing on a real Night 2 (Hunter parked by
// the front door so the camera holds the tower, the door slit and the crowd).
if (!args['no-towers'] && !GUARDS_ONLY) {
  await shot('tower-day', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    m.completeNight();
    const collect = g.ui.find((b) => b.label === 'survival:COLLECT');
    if (collect) collect.onClick(); else m.ackRewards();
    m.gold = Math.max(m.gold, 60); m.wood = Math.max(m.wood, 60);
    (${stepFrames})(10);
    const at = (${walkTo})('hall:tower');
    const card = g.ui.find((b) => b.label === 'survival:BUILD tower' && !b.disabled);
    if (card) card.onClick();
    (${finishJob})();
    (${stepFrames})(30);
    const w = window.__survWorld;
    return { at, built: m.buildings['hall:tower'] || null, spot: m.buildingSpot('hall:tower'), ring: !!(w.survivalTowerRing && w.survivalTowerRing.visible), ui: g.ui.map((b) => b.label).filter((l) => /UPGRADE|BUILD/.test(l)) };
  })()`);
  await shot('tower-night', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.gold = Math.max(m.gold, 60); m.wood = Math.max(m.wood, 60);
    (${stepFrames})(5);
    const up = g.ui.find((b) => b.label === 'survival:UPGRADE tower LV2' && !b.disabled);
    if (up) up.onClick();
    (${finishJob})();
    m.startNight();
    const park = () => { g.player.x = 236; g.player.y = 610; };
    park();
    g.renderer.snapCamera(g.player.x, g.player.y);
    const flying = () => g.bolts.some((b) => b.tower && !b.keepBolt && Math.hypot(b.x - b.ox, b.y - b.oy) > 50);
    let steps = 0;
    while (m.phase === 'night' && steps++ < 4800 && !((m.nightStats.towerShots || 0) >= 3 && flying())) {
      (${holdKeep})(); park();
      window.__origUpdate.call(g, 1 / 60);
    }
    g.render();
    const t = m.towers[0];
    return { t: +m.elapsed.toFixed(1), day: m.day, level: m.buildingLevel('hall:tower'), upgraded: !!up, shots: m.nightStats.towerShots || 0, kills: m.nightStats.kills, flying: flying(), aim: t && +t.aim.toFixed(2) };
  })()`);
}

// Guards can fall: a real Night 1 until the chapel door (wave 1) gives way; just
// inside it one guard down with the Hunter beside it (green ring = his help),
// one down alone (red ring = time it has left), one hurt (HP bar). Then the
// lone one's clock runs out (GUARD LOST), and dawn shows the loss.
if (!args['no-guards'] && !TOWERS_ONLY) {
  await shot('guard-down', `(() => {
    const g = window.__LN;
    const m = g.survival;
    m.restart();
    m.survivors = 3;
    let steps = 0;
    while (m.elapsed < 8 && m.phase === 'night' && steps++ < 2000) { (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    const door = m.entranceById('chapelDoor');
    door.hp = Math.min(door.hp, 1);
    steps = 0;
    while (!door.broken && m.phase === 'night' && steps++ < 1200) { (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    const [a, b, c] = m.guards;
    const pa = m._doorPost(door, 0), pb = m._doorPost(door, 1);
    const place = (gd, x, y) => { gd.x = x; gd.y = y; gd.post = { key: 'shot', x, y, doorId: null }; gd.path = null; };
    place(a, pa.x, pa.y);
    place(b, pb.x + 150, pb.y - 40);
    place(c, pb.x + 40, pb.y - 120);
    m._downGuard(a); a.rescueT = 0.75;
    m._downGuard(b); b.downT = 9;
    c.hp = 16;
    const park = () => { g.player.x = a.x + 34; g.player.y = a.y - 24; g.player.blood = Math.max(g.player.blood, 70); };
    park();
    g.renderer.snapCamera(g.player.x, g.player.y);
    for (let i = 0; i < 10; i++) { m._guardAssignT = 99; park(); (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    g.render();
    return { t: +m.elapsed.toFixed(1), broken: door.broken, helped: +a.rescueT.toFixed(2), aloneLeft: +(20 - b.downT).toFixed(1), hurt: c.hp, hud: m.standingGuards() + '/' + m.guards.length, banner: m.banner && m.banner.kind, alive: m.aliveEnemies() };
  })()`);
  await shot('guard-lost', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const [a, b] = m.guards;
    let steps = 0;
    while (a.down && steps++ < 120) { m._guardAssignT = 99; g.player.x = a.x + 34; g.player.y = a.y - 24; (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    b.downT = Math.max(b.downT, 19.9);
    m.banner = null; m.bannerQueue.length = 0;
    steps = 0;
    while (m.guards.includes(b) && steps++ < 60) { m._guardAssignT = 99; (${holdKeep})(); window.__origUpdate.call(g, 1 / 60); }
    for (let i = 0; i < 8; i++) window.__origUpdate.call(g, 1 / 60);
    g.render();
    return { t: +m.elapsed.toFixed(1), survivors: m.survivors, guards: m.guards.length, lost: m.nightStats.lost || 0, rescued: m.nightStats.rescued || 0, banner: m.banner && m.banner.kind, queue: m.bannerQueue.map((ev) => ev.kind) };
  })()`);
  await shot('guard-reward', `(() => {
    const g = window.__LN;
    const m = g.survival;
    const home = m.hunterHome();
    g.player.x = home.x; g.player.y = home.y;
    m.completeNight();
    (${stepFrames})(30);
    return { phase: m.phase, survivors: m.survivors, lost: m.lastRewards && m.lastRewards.lost, rescued: m.lastRewards && m.lastRewards.rescued, guards: m.guards.map((gd) => gd.hp) };
  })()`);
}

fs.writeFileSync(path.join(OUT, `${TAG}metrics.json`), `${JSON.stringify({ capturedAt: new Date().toISOString(), results, pageErrors }, null, 2)}\n`);
console.log(`pageErrors=${pageErrors.length}`);
await browser.close();
server.kill('SIGTERM');
process.exit(0);
