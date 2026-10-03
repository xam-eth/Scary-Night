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
const server = spawn('python3', ['-m', 'http.server', '8096', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 300));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  protocolTimeout: 120000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

async function saveRaw(page, name) {
  const data = await page.evaluate(() => {
    const g = window.__LN;
    g.player.angle = g.player.angle;
    const c = g.player._valenFrame;
    if (!c) return null;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    out.getContext('2d').drawImage(c, 0, 0);
    return out.toDataURL('image/png');
  });
  if (data) fs.writeFileSync(path.join(OUT, name), Buffer.from(data.split(',')[1], 'base64'));
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8096/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const d = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (d && (d.ready || d.failed)) { console.log('valen', d.ready, d.failed); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.evaluate(() => {
    const v = document.getElementById('veil'); if (v) v.remove();
    window.__LN_API.beginNight();
    window.__LN_API.skipIntro();
  });
  await new Promise((r) => setTimeout(r, 400));
  const pitches = [-0.7, -1.0, 0.7, 1.0];
  for (const pitch of pitches) {
    for (const [face, ang] of [['s', Math.PI / 2], ['n', -Math.PI / 2]]) {
      await page.evaluate((pitch, ang) => {
        window.__LN_PITCH = pitch;
        const g = window.__LN;
        g.player.x = 400; g.player.y = 480; g.player.angle = ang;
        g.renderer.snapCamera(400, 400);
      }, pitch, ang);
      await new Promise((r) => setTimeout(r, 80));
      const tag = `${pitch > 0 ? 'p' : 'm'}${Math.round(Math.abs(pitch) * 100)}-${face}`;
      await saveRaw(page, `pitch-${tag}.png`);
      console.log('saved', tag);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
