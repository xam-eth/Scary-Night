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
await sleep(1500);

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

console.log('\n=== LOOP ===');
const t0 = await page.evaluate(() => window.__LN.now);
await pump(10);
const t1 = await page.evaluate(() => window.__LN.now);
ok('update+render pump works (state advances)', t1 > t0, `Δ=${(t1 - t0).toFixed(3)}s`);

console.log('\n=== MENU BUTTONS (real clicks) ===');
for (const [label, expect] of [['UPGRADES', 'upgrades'], ['BLOOD MARKET', 'shop'], ['COLLECTION', 'collection'], ['SETTINGS', 'settings']]) {
  const r = await clickOk(label, expect);
  ok(`click ${label} → ${expect}`, r.pass, r.why);
  if ((await screen()) !== 'menu') { await clickLabel('BACK'); await pump(2); }
}
ok('menu intact after the tour', (await screen()) === 'menu');
{ const r = await clickOk('PLAY', ['intro', 'playing']); ok('click PLAY leaves menu', r.pass, r.why); }
ok('reached playing', await settle('playing'), `screen=${await screen()}`);

console.log('\n=== PAUSE (real keys) + PAUSE MENU (real clicks) ===');
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
ok('ESC pauses', (await screen()) === 'paused', `screen=${await screen()}`);
{ const r = await clickOk('SETTINGS', 'settings'); ok('pause→settings reachable', r.pass, r.why); }
{ const r = await clickOk('BACK', 'paused'); ok('settings→back to pause (no black hole)', r.pass, r.why); }
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
ok('ESC unpauses', (await screen()) === 'playing', `screen=${await screen()}`);
await page.keyboard.down('Escape'); await pump(2); await page.keyboard.up('Escape'); await pump(2);
{ const r = await clickOk('ABANDON', 'menu'); ok('abandon returns to menu', r.pass, r.why); }

console.log('\n=== DEATH → TRY AGAIN ===');
await clickLabel('PLAY'); await settle('playing', 400);
await page.evaluate(() => window.__LN.killPlayer('CLICKTEST'));
ok('death screen reached', await settle('death', 2000, 4), `screen=${await screen()}`);
await pump(150); // the death overlay fades its buttons in (~1.5s sim) — click only once they are registered
{ const r = await clickOk('TRY AGAIN', ['intro', 'playing']); ok('TRY AGAIN restarts the night', r.pass, r.why); }

console.log('\n=== SETTINGS SCREEN (toggles + sliders by click) ===');
await settle(['death', 'intro', 'playing', 'menu'], 400);
if ((await screen()) !== 'menu') { await page.evaluate(() => window.__LN.toMenu()); await pump(2); }
await clickOk('SETTINGS', 'settings');
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

console.log('\n=== ERRORS ===');
ok('no runtime errors during the whole click run', errors.length === 0, errors.slice(0, 6).join(' | ') || 'clean');

await browser.close();
console.log(fails === 0 ? '\nclicktest: all PASS — every button answers' : `\nclicktest: ${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
