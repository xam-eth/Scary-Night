/* Visual audit of a live night. Writes PNGs under tools/shots-browser/audit/. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/shots-browser/audit');
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', '8091', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
fs.mkdirSync(LIB_DIR, { recursive: true });
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  const brPath = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
  const tar = path.join(LIB_DIR, 'al2023.tar');
  fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(brPath)));
  execFileSync('tar', ['-xf', tar, '-C', LIB_DIR]);
  fs.rmSync(tar);
}

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

const notes = [];
const log = (s) => { notes.push(s); console.log(s); };

async function boot(page, w, h, mobile) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await page.goto('http://127.0.0.1:8091/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const started = Date.now();
  let diag = null;
  while (Date.now() - started < 25000) {
    diag = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
    if (diag && (diag.ready || diag.failed)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  log(`boot ${w}x${h} valen=${JSON.stringify(diag)}`);
  await page.evaluate(() => {
    const v = document.getElementById('veil');
    if (v) v.remove();
  });
}

async function startNight(page) {
  await page.evaluate(() => {
    window.__LN_API.beginNight();
    window.__LN.input.touchSeen = true;
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.__LN_API.skipIntro());
  await new Promise((r) => setTimeout(r, 700));
}

async function snap(page, name) {
  const info = await page.evaluate(() => {
    const g = window.__LN;
    const r = g.renderer;
    const p = g.player;
    const buttons = {};
    for (const [k, b] of Object.entries(g.input.buttons || {})) {
      buttons[k] = { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r), hidden: !!b.hidden };
    }
    const s = g.input.stick || {};
    return {
      screen: g.screen,
      time: Math.round(g.time),
      px: Math.round(p.x), py: Math.round(p.y),
      blood: Math.round(p.blood),
      planks: p.planks,
      enemies: g.enemies.filter((e) => !e.dead).length,
      w: r.w, h: r.h,
      zoom: +r.cam.zoom.toFixed(2),
      buttons,
      stick: { x: Math.round(s.homeX || 0), y: Math.round(s.homeY || 0), r: Math.round(s.r || 0) },
      coach: g.coach && g.coach.step,
      interact: g.interactTarget && g.interactTarget.kind,
    };
  });
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  log(`shot ${name} ${JSON.stringify(info)}`);
}

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('CONSOLE ' + m.text()); });

  await boot(page, 390, 844, true);
  await page.screenshot({ path: path.join(OUT, '00-menu-phone.png') });
  log('shot 00-menu-phone');
  await startNight(page);
  await snap(page, '01-start-phone');

  await page.evaluate(() => window.__LN_API.hold('up', true));
  await new Promise((r) => setTimeout(r, 1600));
  await page.evaluate(() => window.__LN_API.stopMove());
  await snap(page, '02-walk-north-phone');

  await page.evaluate(() => window.__LN_API.hold('down', true));
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => window.__LN_API.stopMove());
  await snap(page, '03-walk-south-phone');

  // dusk / darker
  await page.evaluate(() => window.__LN_API.setTime(180));
  await new Promise((r) => setTimeout(r, 500));
  await snap(page, '04-dusk-phone');

  await page.evaluate(() => {
    window.__LN_API.setTime(40);
    const p = window.__LN.player;
    p.x = 700; p.y = 90;
  });
  await new Promise((r) => setTimeout(r, 600));
  await snap(page, '05-door-phone');

  await page.evaluate(() => {
    const p = window.__LN.player;
    p.x = -150; p.y = 980;
  });
  await new Promise((r) => setTimeout(r, 600));
  await snap(page, '06-stakes-phone');

  await page.evaluate(() => {
    const p = window.__LN.player;
    p.x = 400; p.y = 520;
    p.startAttack(window.__LN);
  });
  await new Promise((r) => setTimeout(r, 180));
  await snap(page, '07-attack-phone');

  // landscape phone
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const p = window.__LN.player;
    p.x = 400; p.y = 520;
    window.__LN_API.setTime(20);
  });
  await new Promise((r) => setTimeout(r, 500));
  await snap(page, '08-landscape');

  // desktop
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const p = window.__LN.player;
    p.x = 400; p.y = 520;
    window.__LN_API.setTime(30);
  });
  await new Promise((r) => setTimeout(r, 500));
  await snap(page, '09-desktop');

  const desk = await browser.newPage();
  await boot(desk, 1280, 720, false);
  await desk.evaluate(() => window.__LN_API.beginNight());
  await new Promise((r) => setTimeout(r, 300));
  await desk.evaluate(() => window.__LN_API.skipIntro());
  await new Promise((r) => setTimeout(r, 600));
  await snap(desk, '09-desktop');
  await desk.evaluate(() => window.__LN_API.hold('up', true));
  await new Promise((r) => setTimeout(r, 800));
  await desk.evaluate(() => window.__LN_API.stopMove());
  await snap(desk, '10-desktop-walk');

  fs.writeFileSync(path.join(OUT, 'notes.txt'), notes.join('\n'));
  log('DONE');
} finally {
  await browser.close();
  server.kill();
}
