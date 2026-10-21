import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/shots-browser/qa');
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8097', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 250));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  protocolTimeout: 90000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

async function pose(page, angle) {
  await page.evaluate((angle) => {
    const g = window.__LN;
    // Open marble in the main hall, clear of the dining table.
    g.player.x = 500; g.player.y = 1000; g.player.angle = angle;
    g.renderer.snapCamera(500, 1000);
  }, angle);
  await new Promise((r) => setTimeout(r, 180));
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8097/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 16000) {
    const d = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (d && (d.ready || d.failed)) { console.log('valen', d.ready, d.failed); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.evaluate(() => {
    const v = document.getElementById('veil'); if (v) v.remove();
    window.__LN_API.beginNight();
    window.__LN_API.skipIntro();
  });
  await new Promise((r) => setTimeout(r, 300));
  for (const [name, ang] of [['north', -Math.PI / 2], ['south', Math.PI / 2], ['east', 0]]) {
    await pose(page, ang);
    await page.screenshot({ path: path.join(OUT, `fix-${name}.png`) });
    const data = await page.evaluate(() => {
      const c = window.__LN.player._valenFrame;
      if (!c) return null;
      const out = document.createElement('canvas');
      out.width = c.width; out.height = c.height;
      out.getContext('2d').drawImage(c, 0, 0);
      return out.toDataURL('image/png');
    });
    if (data) fs.writeFileSync(path.join(OUT, `fix-raw-${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('saved', name);
  }
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await pose(page, Math.PI / 2);
  await page.screenshot({ path: path.join(OUT, 'fix-land.png') });
  console.log('saved land');
} finally {
  await browser.close();
  server.kill();
}
