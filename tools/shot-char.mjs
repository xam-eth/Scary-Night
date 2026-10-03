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
const server = spawn('python3', ['-m', 'http.server', '8094', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
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

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8094/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now();
  let ready = null;
  while (Date.now() - t0 < 20000) {
    ready = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (ready && (ready.ready || ready.failed)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('valen', JSON.stringify(ready));
  await page.evaluate(() => {
    const v = document.getElementById('veil'); if (v) v.remove();
    window.__LN_API.beginNight();
    window.__LN.input.touchSeen = true;
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => window.__LN_API.skipIntro());
  await page.waitForFunction(() => window.__LN && window.__LN.fadeFromBlack < 0.02, { timeout: 4000 }).catch(() => {});

  for (const [name, ang] of [['south', Math.PI / 2], ['north', -Math.PI / 2], ['east', 0], ['west', Math.PI]]) {
    await page.evaluate((a) => {
      const g = window.__LN;
      g.player.x = 400; g.player.y = 480;
      g.player.angle = a;
      g.renderer.snapCamera(400, 400);
    }, ang);
    await new Promise((r) => setTimeout(r, 180));
    const info = await page.evaluate(() => {
      const g = window.__LN;
      const p = g.player;
      const s = g.renderer.worldToScreen(p.x, p.y);
      return { place: p._valenPlace && { h: p._valenPlace.height, anchor: p._valenPlace.anchor, head: p._valenPlace.head, drop: p._valenPlace.drop }, screen: s, zoom: g.renderer.cam.zoom };
    });
    console.log(name, JSON.stringify(info));
    await page.screenshot({ path: path.join(OUT, `char-${name}.png`) });
    if (name === 'south' || name === 'north') {
      const data = await page.evaluate(() => {
        const c = window.__LN.player._valenFrame;
        if (!c) return null;
        const out = document.createElement('canvas');
        out.width = c.width; out.height = c.height;
        out.getContext('2d').drawImage(c, 0, 0);
        return out.toDataURL('image/png');
      });
      if (data) fs.writeFileSync(path.join(OUT, `raw-${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
  }
} finally {
  await browser.close();
  server.kill();
}
