/* LAST NIGHT — live button click test.
 *
 * Real Chromium, REAL mouse/keyboard events against a RUNNING server (default
 * http://127.0.0.1:8080). Every menu/pause/death button gets a genuine
 * page.mouse.click at its live uiButton rect, then the game loop is PUMPED
 * deterministically (`update()+render()` from the harness) so headless rAF
 * starvation can never fake a result. This is the test that should have
 * existed since day one: it catches exactly what node --check can't — a
 * runtime freeze, an unreachable input branch, or hit-testing against an
 * empty immediate-mode list.
 *
 *   node tools/clicktest.mjs [--url=http://...]
 *   node tools/clicktest.mjs --hud-only [--url=http://...]
 *   node tools/clicktest.mjs --privacy-only [--url=http://...]
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v];
}));
const BASE = arg.url || 'http://127.0.0.1:8080';

const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
(() => {
  try {
    fs.mkdirSync(LIB_DIR, { recursive: true });
    if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
      const brPath = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
      if (!fs.existsSync(brPath)) return;
      const tar = path.join(LIB_DIR, 'al2023.tar');
      fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(brPath)));
      execFileSync('tar', ['-xf', tar, '-C', LIB_DIR]);
      fs.rmSync(tar);
    }
  } catch { /* host provides libs */ }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'],
  headless: true, protocolTimeout: 120000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String((e && e.message) || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
try {
  await page.waitForFunction('!!window.__LN', { timeout: 30000 });
} catch (e) {
  console.log('FAIL  boot: window.__LN never appeared — module graph or index.html is broken');
  console.log(errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await sleep(500);
await page.waitForFunction(() => {
  const diag = window.__LN_API && window.__LN_API.enemy3d && window.__LN_API.enemy3d();
  const types = diag && diag.types;
  return !!(types && (Object.values(types).every((type) => type.behaviorReady)
    || Object.values(types).some((type) => type.failed)));
}, { timeout: 60000, polling: 100 });
const modelLoad = await page.evaluate(() => window.__LN_API.enemy3d());
if (Object.values(modelLoad.types || {}).some((type) => type.failed || !type.behaviorReady)) {
  throw new Error(`cannot run live click test: enemy roster not behavior-ready (${Object.entries(modelLoad.types || {}).filter(([, type]) => !type.behaviorReady).map(([key]) => key).join(', ')})`);
}

/* ---------- deterministic pump ---------- */
// letFrame = one real rAF tick if the browser grants one; pump = guaranteed
// sim+render regardless of headless rAF starvation.
const pump = (frames = 3) => page.evaluate((n) => {
  const g = window.__LN;
  for (let i = 0; i < n; i++) { g.update(1 / 60); g.render(); }
  return true;
}, frames);
const screen = () => page.evaluate(() => (window.__LN ? window.__LN.screen : null));
const settle = async (want, maxPumps = 600, per = 2) => {
  for (let i = 0; i < maxPumps; i += per) {
    const s = await screen();
    if (Array.isArray(want) ? want.includes(s) : s === want) return true;
    await pump(per);
  }
  return false;
};

const clickLabel = async (label) => {
  const pt = await page.evaluate((lab) => {
    const g = window.__LN;
    if (!g) return null;
    const hit = g.ui.find((b) => String(b.label || '').toUpperCase().includes(lab.toUpperCase()));
    if (!hit) return { missing: true, labels: g.ui.map((b) => b.label).filter(Boolean) };
    const r = (g.input && g.input.canvas ? g.input.canvas : document.querySelector('canvas')).getBoundingClientRect();
    return { x: r.left + hit.x + hit.w / 2, y: r.top + hit.y + hit.h / 2 };
  }, label);
  if (!pt || pt.missing) return { clicked: false, seen: pt && pt.labels };
  await page.mouse.click(pt.x, pt.y);
  await pump(3); // let the tap be consumed deterministically
  await sleep(60);
  return { clicked: true };
};
const clickOk = async (label, want) => {
  const r = await clickLabel(label);
  if (!r.clicked) return { pass: false, why: `no such label; saw=${JSON.stringify(r.seen)}` };
  const got = await screen();
  const pass = got === want || (Array.isArray(want) && want.includes(got));
  return { pass, why: `screen=${got}` };
};

// Fast focused regression gate for the nested Privacy route; the full suite
// also covers it, but takes several minutes because it plays multiple screens.
if (arg['privacy-only']) {
  console.log('=== SETTINGS → PRIVACY (focused route) ===');
  const hasConsent = await page.evaluate(() => window.__LN.ui.some((button) => button.label === 'I UNDERSTAND'));
  if (hasConsent) {
    const consent = await clickOk('I UNDERSTAND', 'menu');
    ok('consent reaches the menu', consent.pass, consent.why);
  }
  if (await screen() !== 'menu') {
    await page.evaluate(() => window.__LN.toMenu());
    await pump(2);
  }
  const settings = await clickOk('SETTINGS', 'settings');
  ok('menu → settings', settings.pass, settings.why);
  const backTarget = await page.evaluate(() => window.__LN.settingsReturn || 'menu');
  const privacy = await clickOk('PRIVACY & DELETE', 'privacy');
  ok('settings → privacy', privacy.pass, privacy.why);
  const back = await clickOk('BACK', backTarget);
  ok(`privacy → ${backTarget}`, back.pass, back.why);
  ok('no browser runtime errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
}

console.log('\n=== LOADING-GATED NIGHT ENTRY ===');
// The app enters the opening automatically after the 3D roster is ready. Skip
// story plates here so this click test can focus on live gameplay controls.
await page.evaluate(() => {
  const g = window.__LN;
  g.save.privacyAck = true;
  g._openingPending = false;
  g.narration = null;
  g.seenIntroThisSession = true;
  g.startNightProper();
});
await pump(3);
ok('gameplay is available after the loading gate', await screen() === 'playing', `screen=${await screen()}`);
// BLOOD MARKET only appears after prior attempts; give the menu tour that
// returning-player state without changing the actual UI implementation.
await page.evaluate(() => { window.__LN.save.nightsAttempted = 4; window.__LN.save.nightsSurvived = 4; });
await pump(2);

console.log('\n=== LOOP ===');
const t0 = await page.evaluate(() => window.__LN.now);
await pump(10);
const t1 = await page.evaluate(() => window.__LN.now);
ok('update+render pump works (state advances)', t1 > t0, `Δ=${(t1 - t0).toFixed(3)}s`);

console.log('\n=== MENU BUTTONS (real clicks) ===');
await page.evaluate(() => window.__LN.toMenu());
await pump(3);
for (const [label, expect] of [['UPGRADES', 'upgrades'], ['BLOOD MARKET', 'shop'], ['SETTINGS', 'settings']]) {
  const r = await clickOk(label, expect);
  ok(`click ${label} → ${expect}`, r.pass, r.why);
  if ((await screen()) !== 'menu') { await clickLabel('BACK'); await pump(2); }
}
ok('menu intact after the tour', (await screen()) === 'menu');
{ const r = await clickOk('PLAY', ['intro', 'narration', 'playing']); ok('click PLAY leaves menu', r.pass, r.why); }
await page.evaluate(() => {
  const g = window.__LN;
  if (g.narration) g.skipNarration();
  if (g.screen !== 'playing') { g._openingPending = false; g.startNightProper(); }
});
await pump(3);
ok('reached playing', await screen() === 'playing', `screen=${await screen()}`);

console.log('\n=== FIELD CARD (four in-run destinations) ===');
await clickLabel('bag'); await pump(2);
ok('HUD pack icon opens the card', await page.evaluate(() => window.__LN.uiPanel === 'bag'));
const fieldTabs = await page.evaluate(() => window.__LN.ui.map((b) => b.label).filter((label) => ['bag', 'mission', 'upgrade', 'profile', 'collection', 'settings', 'help', 'shield', 'blood'].includes(label)));
ok('card keeps only pack, missions, upgrades and profile', JSON.stringify(fieldTabs) === JSON.stringify(['bag', 'mission', 'upgrade', 'profile']), JSON.stringify(fieldTabs));
await clickLabel('profile'); await pump(2);
ok('profile remains reachable from the card', await page.evaluate(() => window.__LN.uiPanel === 'profile'));
await clickLabel('close'); await pump(2);
ok('card closes back to the night', await page.evaluate(() => window.__LN.uiPanel === null && window.__LN.screen === 'playing'));
await clickLabel('mission'); await pump(2);
ok('HUD missions icon opens missions directly', await page.evaluate(() => window.__LN.uiPanel === 'missions'));
await clickLabel('close'); await pump(2);
const weaponBefore = await page.evaluate(() => window.__LN.player.weapon);
await clickLabel('weapon'); await pump(2);
const weaponAfter = await page.evaluate(() => window.__LN.player.weapon);
ok('HUD weapon icon cycles the equipped tool', weaponAfter !== weaponBefore, `${weaponBefore} → ${weaponAfter}`);

console.log('\n=== PAUSE (real keys) + PAUSE MENU (real clicks) ===');
{ const r = await clickOk('PAUSE', 'paused'); ok('pause button opens the menu', r.pass, r.why); }
{ const r = await clickOk('RESUME', 'playing'); ok('resume returns to the night', r.pass, r.why); }
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
ok('ESC pauses', (await screen()) === 'paused', `screen=${await screen()}`);
{ const r = await clickOk('SETTINGS', 'settings'); ok('pause→settings reachable', r.pass, r.why); }
{ const r = await clickOk('BACK', 'paused'); ok('settings→back to pause (no black hole)', r.pass, r.why); }
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
ok('ESC unpauses', (await screen()) === 'playing', `screen=${await screen()}`);
if (arg['hud-only']) {
  console.log('\n=== ERRORS ===');
  ok('no runtime errors during the focused HUD flow', errors.length === 0, errors.slice(0, 6).join(' | ') || 'clean');
  await browser.close();
  console.log(fails === 0 ? '\nclicktest --hud-only: all PASS' : `\nclicktest --hud-only: ${fails} FAILURE(S)`);
  process.exit(fails ? 1 : 0);
}
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
{ const r = await clickOk('MAIN MENU', 'paused'); ok('main menu asks before leaving', r.pass, r.why); }
{ const r = await clickOk('LEAVE', 'menu'); ok('leave returns home and banks the floor', r.pass, r.why); }

console.log('\n=== DEATH → TRY AGAIN ===');
await clickLabel('PLAY'); await settle('playing', 400);
await page.evaluate(() => window.__LN.killPlayer('CLICKTEST'));
ok('death screen reached', await settle('death', 2000, 4), `screen=${await screen()}`);
await pump(150); // the death overlay fades its buttons in (~1.5s sim) — click only once they are registered
{ const r = await clickOk('TRY AGAIN', ['intro', 'playing']); ok('TRY AGAIN restarts the night', r.pass, r.why); }

console.log('\n=== THE REFUGE (the dawn hub — #56 P3) ===');
// Land on the victory screen the way a survived night does, then walk into
// her room and back out. The buttons are the point: the hub has to answer.
await page.evaluate(() => {
  const g = window.__LN;
  g.screen = 'victory'; g.victoryScreenT = 3; g.bankedNow = 40; g.newRecord = false;
  g.time = 300; g.stats.kills = 12;
  g.bankHunt(true);
});
await pump(6);
{ const r = await clickOk('THE REFUGE', 'refuge'); ok('the dawn offers the way back to her', r.pass, r.why); }
ok('she is in the room, and says something', await page.evaluate(() => !!(window.__LN.refugeLine && window.__LN.refugeLine.text)));
{ const r = await clickOk('UPGRADES', 'upgrades'); ok('the refuge reaches the upgrades', r.pass, r.why); }
{ const r = await clickOk('BACK', 'refuge'); ok('back returns to her room, not the menu', r.pass, r.why); }
{ const r = await clickOk('MAIN MENU', 'menu'); ok('the refuge lets you leave for the menu', r.pass, r.why); }

console.log('\n=== SETTINGS SCREEN (toggles + sliders by click) ===');
await settle(['death', 'intro', 'playing', 'menu'], 400);
if ((await screen()) !== 'menu') { await page.evaluate(() => window.__LN.toMenu()); await pump(2); }
await clickOk('SETTINGS', 'settings');
{
  const backTarget = await page.evaluate(() => window.__LN.settingsReturn || 'menu');
  const privacy = await clickOk('PRIVACY & DELETE', 'privacy');
  ok('settings→privacy reaches the privacy screen', privacy.pass, privacy.why);
  const back = await clickOk('BACK', backTarget);
  ok('privacy→back returns to its parent screen', back.pass, back.why);
  if ((await screen()) !== 'settings') await clickOk('SETTINGS', 'settings');
}
{
  const r = await page.evaluate(() => {
    const g = window.__LN;
    const sl = g.ui.find((b) => b.slider && b.slider.key === 'master');
    if (!sl) return { skip: true };
    const before = g.save.settings.master;
    // click at 25% along the track
    const x = sl.x + sl.w * 0.25;
    const r2 = g.input.canvas.getBoundingClientRect();
    return { clientX: r2.left + x, clientY: r2.top + sl.y + sl.h / 2, before };
  });
  if (r.skip) { ok('slider present', false); }
  else {
    await page.mouse.move(r.clientX, r.clientY); await page.mouse.down(); await pump(2); await page.mouse.up(); await pump(2);
    const after = await page.evaluate(() => window.__LN.save.settings.master);
    ok('slider drag changes value', Math.abs(after - 0.25) < 0.06, `before=${r.before.toFixed(2)} after=${after.toFixed(2)}`);
  }
}

console.log('\n=== ENEMY GLB FALLBACK ===');
{
  const d = await page.evaluate(async () => {
    const started = performance.now();
    let diag = window.__LN_API.enemy3d();
    while (diag && diag.types && diag.types.zombie && diag.types.zombie.loading && performance.now() - started < 8000) {
      await new Promise((r) => setTimeout(r, 200));
      diag = window.__LN_API.enemy3d();
    }
    window.__LN.screen = 'playing';
    window.__LN.enemies = window.__LN.enemies || [];
    window.__LN.render();
    window.__LN_API.forceEnemyFail('zombie');
    window.__LN.render();
    return window.__LN_API.enemy3d();
  });
  const z = d && d.types && d.types.zombie;
  ok('enemy diagnostics are on the same path as Valen', !!z, JSON.stringify(z || d));
  ok('zombie is not driven until walk and attack exist', !!(z && z.behaviorReady === false),
    z ? `missing=${(z.missing || []).join(',')} clips=${(z.clips || []).join(',')}` : 'no diag');
  ok('skinned cap holds', !!(d && d.skinned <= d.cap), `skinned=${d && d.skinned}`);
  ok('a forced load failure still renders', !!(z && z.failed === true));
}
console.log('\n=== ERRORS ===');
ok('no runtime errors during the whole click run', errors.length === 0, errors.slice(0, 6).join(' | ') || 'clean');

await browser.close();
console.log(fails === 0 ? '\nclicktest: all PASS — every button answers' : `\nclicktest: ${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
