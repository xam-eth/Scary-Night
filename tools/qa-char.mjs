import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/shots-browser/qa');
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8095', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
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
  protocolTimeout: 120000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

async function boot(page, w, h, mobile) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await page.goto('http://127.0.0.1:8095/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const d = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (d && (d.ready || d.failed)) return d;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
async function night(page) {
  await page.evaluate(() => {
    const v = document.getElementById('veil'); if (v) v.remove();
    window.__LN_API.beginNight();
    window.__LN.input.touchSeen = true;
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => window.__LN_API.skipIntro());
  await page.waitForFunction(() => window.__LN && window.__LN.fadeFromBlack < 0.02, { timeout: 4000 }).catch(() => {});
}
async function pose(page, x, y, ang, speed) {
  return page.evaluate((x, y, ang, speed) => {
    const g = window.__LN;
    g.player.x = x; g.player.y = y;
    g.player.angle = ang;
    g.player.vx = Math.cos(ang) * speed;
    g.player.vy = Math.sin(ang) * speed;
    g.player.state = speed > 20 ? 'walk' : 'idle';
    g.renderer.snapCamera(x, y - 80);
    const p = g.player;
    const s = g.renderer.worldToScreen(p.x, p.y);
    return {
      screen: s,
      zoom: g.renderer.cam.zoom,
      tilt: g.renderer.tilt,
      place: p._valenPlace && { h: p._valenPlace.height, anchor: p._valenPlace.anchor, head: p._valenPlace.head },
    };
  }, x, y, ang, speed);
}
async function raw(page, name) {
  const data = await page.evaluate(() => {
    const c = window.__LN.player._valenFrame;
    if (!c) return null;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    out.getContext('2d').drawImage(c, 0, 0);
    return out.toDataURL('image/png');
  });
  if (data) fs.writeFileSync(path.join(OUT, name), Buffer.from(data.split(',')[1], 'base64'));
}

try {
  const phone = await browser.newPage();
  console.log('valen', JSON.stringify(await boot(phone, 390, 844, true)));
  await night(phone);
  const faces = [
    ['idle-north', -Math.PI / 2, 0],
    ['idle-south', Math.PI / 2, 0],
    ['idle-east', 0, 0],
    ['walk-north', -Math.PI / 2, 80],
  ];
  for (const [name, ang, speed] of faces) {
    const info = await pose(phone, 400, 480, ang, speed);
    await new Promise((r) => setTimeout(r, 220));
    const settled = await pose(phone, 400, 480, ang, speed);
    console.log(name, JSON.stringify(settled || info));
    await phone.screenshot({ path: path.join(OUT, `${name}.png`) });
    await raw(phone, `raw-${name}.png`);
  }

  await phone.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 250));
  await pose(phone, 400, 420, -Math.PI / 2, 0);
  await new Promise((r) => setTimeout(r, 250));
  console.log('land', JSON.stringify(await pose(phone, 400, 420, -Math.PI / 2, 0)));
  await phone.screenshot({ path: path.join(OUT, 'land.png') });

  const desk = await browser.newPage();
  console.log('desk-boot', JSON.stringify(await boot(desk, 1280, 720, false)));
  await night(desk);
  console.log('desk', JSON.stringify(await pose(desk, 400, 480, -Math.PI / 2, 0)));
  await desk.screenshot({ path: path.join(OUT, 'desk.png') });
  console.log('DONE');
} finally {
  await browser.close();
  server.kill();
}
