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
const server = spawn('python3', ['-m', 'http.server', '8092', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
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
  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const d = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (d && (d.ready || d.failed)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.evaluate(() => { const v = document.getElementById('veil'); if (v) v.remove(); });
}
try {
  const phone = await browser.newPage();
  await boot(phone, 390, 844, true);
  await phone.evaluate(() => { window.__LN_API.beginNight(); window.__LN.input.touchSeen = true; });
  await new Promise((r) => setTimeout(r, 250));
  await phone.evaluate(() => window.__LN_API.skipIntro());
  await new Promise((r) => setTimeout(r, 500));
  await phone.screenshot({ path: path.join(OUT, '11-phone-start.png') });
  await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 400));
  await phone.screenshot({ path: path.join(OUT, '12-landscape.png') });
  const desk = await browser.newPage();
  await boot(desk, 1280, 720, false);
  await desk.evaluate(() => window.__LN_API.beginNight());
  await new Promise((r) => setTimeout(r, 250));
  await desk.evaluate(() => window.__LN_API.skipIntro());
  await new Promise((r) => setTimeout(r, 700));
  await desk.screenshot({ path: path.join(OUT, '13-desktop.png') });
  console.log('DONE');
} finally {
  await browser.close();
  server.kill();
}
