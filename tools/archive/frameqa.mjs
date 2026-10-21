/* frameqa.mjs — frame-by-frame QA of how the night actually looks.
 *
 * Not a measurement of the plan: a stack of photographs of the screen, taken
 * often enough to see a thing arrive late, and at enough places to see the
 * house. Shots are cut to the play canvas (390x693) so a pixel in a shot is a
 * pixel the game drew.
 *
 *   node tools/frameqa.mjs             stops + a walk
 *   node tools/frameqa.mjs boot        the first five seconds, half a second apart
 *   node tools/frameqa.mjs stop 3      one stop from the list
 *
 * Needs the same Puppeteer shim as shotbrowser.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/shots-browser');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8112;
const MODE = process.argv[2] || 'stops';

/* Places in the house worth looking at: the hall she starts in, the rooms off
 * it, the dark, and the door she defends. */
const STOPS = [
  ['1-hall', 620, 1000],
  ['2-dining', 405, 330],
  ['3-library', null, null],
  ['4-basement', null, null],
  ['5-kitchen', null, null],
  ['6-chapel', null, null],
  ['7-frontdoor', 893, 1720],
  ['8-conservatory', null, null],
];

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
  headless: true, protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
page.on('console', (c) => { if (c.type() === 'error') errs.push('console: ' + c.text().slice(0, 200)); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  const d = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
  if (d && (d.ready || d.failed)) break;
  await wait(500);
}
await page.evaluate(async () => {
  const g = window.__LN;
  g.save.privacyAck = true;
  window.__env = (await import('./src/game/envkit.js')).EnvKit;
  window.__enemy = (await import('./src/game/enemy3d.js')).Enemy3D;
  window.__foes = await import('./src/game/enemies.js');
});
await wait(1200);

const canvas = await page.$('#game');
/** The play canvas only: a pixel in the shot is a pixel the game drew. */
const shot = async (name) => {
  const f = path.join(OUT, `${name}.png`);
  await canvas.screenshot({ path: f });
  return f;
};

if (MODE === 'boot') {
  await shot('boot-0-menu');
  await page.evaluate(async () => {
    const g = window.__LN;
    g.beginNight(); g.introT = 99; g.skipNarration();
  });
  for (const ms of [150, 300, 500, 800, 1200, 1800, 2600, 4000, 6000]) {
    await wait(ms === 150 ? 150 : 0);
    if (ms !== 150) await wait(0);
    await shot(`boot-${String(ms).padStart(4, '0')}ms`);
    await wait(150);
  }
  const done = await page.evaluate(() => ({
    kit: window.__env.ready, foes: window.__enemy ? Object.keys(window.__enemy.types || {}).length : 0,
    ready: Object.values(window.__enemy.types || {}).filter((r) => r.behaviorReady).length,
  }));
  console.log('after boot:', JSON.stringify(done));
} else {
  await page.evaluate(async () => {
    const g = window.__LN;
    g.beginNight(); g.introT = 99; g.skipNarration();
    await new Promise((r) => setTimeout(r, 400));
    g.skipNarration();
  });
  await page.waitForFunction(() => window.__LN && window.__LN.screen === 'playing', { timeout: 30000, polling: 100 }).catch(() => {});
  await wait(3000);

  const list = MODE === 'stop' ? [STOPS[Number(process.argv[3] || 1) - 1]] : STOPS;
  for (const [name, x, y] of list) {
    const at = await page.evaluate(async (sx, sy, nm) => {
      const g = window.__LN;
      let px = sx, py = sy;
      if (px == null) {
        const room = (g.mansion.rooms || {})[nm.slice(2)] || null;
        if (!room) return null;
        px = room.x + room.w / 2;
        py = room.y + room.h / 2;
      }
      g.player.x = px; g.player.y = py;
      g.renderer.snapCamera(px, py);
      await new Promise((r) => setTimeout(r, 600));
      const r = g.renderer;
      return { x: Math.round(px), y: Math.round(py), room: g.mansion.roomAt ? (g.mansion.roomAt(px, py) || {}).name : null };
    }, x, y, name);
    if (!at) { console.log(`${name}: no such room`); continue; }
    await wait(2200);
    await shot(`stop-${name}`);
    console.log(`${name.padEnd(16)} at ${at.x},${at.y} ${at.room ? '(' + at.room + ')' : ''}`);
  }
  // and one with a werewolf in the room with her
  if (MODE !== 'stop') {
    await page.evaluate(async () => {
      const g = window.__LN;
      const e = new window.__foes.Werewolf(g.player.x + 120, g.player.y - 10, {});
      e.state = 'idle'; e.stateT = 0;
      g.enemies.push(e);
      await new Promise((r) => setTimeout(r, 1500));
      window.__LN_TIME_SCALE = 0.0001;
    });
    await wait(1800);
    await shot('stop-9-foe');
    console.log('stop-9-foe');
  }
}
console.log('ERRORS', errs.length ? errs.slice(0, 6) : 'none');
server.kill();
await browser.close();
