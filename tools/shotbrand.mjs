// LAST NIGHT — brand page QA shot. node tools/shotbrand.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'shots-browser');
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
try {
  fs.mkdirSync(LIB_DIR, { recursive: true });
  if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
    const brPath = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
    if (fs.existsSync(brPath)) {
      const tar = path.join(LIB_DIR, 'al2023.tar');
      fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(brPath)));
      execFileSync('tar', ['-xf', tar, '-C', LIB_DIR]);
      fs.rmSync(tar);
    }
  }
} catch { }

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'],
  headless: true,
  protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:8080/brand/', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.screenshot({ path: path.join(OUT, 'brand-page.png'), fullPage: true });
  console.log('shot: brand-page.png');
} finally {
  await browser.close();
  server.kill();
}
