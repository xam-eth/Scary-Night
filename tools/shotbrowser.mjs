/* LAST NIGHT — real-browser visual QA.
 *
 * Unlike tools/harness.mjs (2D canvas only), this drives a real headless
 * Chromium with software WebGL (SwiftShader via @sparticuz/chromium, shipped
 * inside the npm tarball — no CDN download), so the GLB character actually
 * renders and screenshots show what a player sees.
 *
 *   node tools/shotbrowser.mjs            # serve repo on :8080 + shoot
 *   node tools/shotbrowser.mjs --url=...  # shoot an already-running server
 *
 * Shots land in tools/shots-browser/ (gitignored).
 */

import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const URL_BASE = args.url || 'http://127.0.0.1:8080';
const OUT = path.resolve(args.out || path.join(ROOT, 'tools/shots-browser'));
fs.mkdirSync(OUT, { recursive: true });

let server = null;
if (!args.url) {
  server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '0.0.0.0'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
}

/* ---------- portable system-lib shim ----------
 * The bundled Chromium is built for Amazon Linux; on slim Debian containers
 * libnss3/libnspr4 are missing. The npm package ships them in al2023.tar.br —
 * inflate locally and hand it over via LD_LIBRARY_PATH. Silently skipped when
 * the host already provides the libraries.
 */
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
const ensureAlLibs = async () => {
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
  } catch { /* host already fine, or extraction unavailable — chromium will say so itself */ }
};
await ensureAlLibs();

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'],
  headless: true,
  protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

const waitValen = async (page, ms = 60000) => {
  const started = Date.now();
  for (;;) {
    const d = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
    if (d && (d.ready || d.failed)) return d;
    if (Date.now() - started > ms) return d || { timeout: true };
    await new Promise((r) => setTimeout(r, 500));
  }
};

const shoot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot:', name + '.png');
};

try {
  /* ---------- desktop 16:9 ---------- */
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });

  // the boot veil is tied to the 27 MB GLB — wait for the real thing
  const diag = await waitValen(page);
  console.log('valen:', JSON.stringify(diag));
  const glInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    return g ? g.getParameter(g.RENDERER) : 'NO WEBGL';
  });
  console.log('renderer:', glInfo);

  await page.waitForFunction(() => !document.getElementById('veil'), { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1100)));
  await shoot(page, '01-menu');

  await page.evaluate(() => {
    window.__LN_API.beginNight();
  });
  await page.waitForFunction(() => window.__LN && window.__LN.screen === 'intro', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { window.__LN_API.skipIntro(); window.__LN_API.skipIntro(); });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, '01b-intro.png') });
  await shoot(page, '02-night-start');

  // walk (clip-driven stride), with a camera nudge for a lived-in frame
  await page.evaluate(() => {
    window.__LN_API.hold('down', true);
    window.__LN_API.hold('right', true);
  });
  await new Promise((r) => setTimeout(r, 1400));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await shoot(page, '03-walk');

  // attack: box_01 clip mid-swing — freeze on the active window
  await page.evaluate(() => {
    const p = window.__LN.player;
    window.__LN_API.hold('attack', false);
    p.startAttack(window.__LN);
  });
  await new Promise((r) => setTimeout(r, 220));
  await shoot(page, '04-attack');

  // low blood: eye-glow tell + panic tint territory
  await page.evaluate(() => {
    window.__LN_API.setTime(262);
    window.__LN.player.blood = 8;
    window.__LN_API.hold('up', true);
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await shoot(page, '05-lowblood-panic');

  // pause overlay
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '06-pause');

  // close-up of the GLB body (vision QA: fabric, pose, foot anchor)
  await page.evaluate(() => {
    gameEscape();
    const p = window.__LN.player;
    window.__LN_API.setTime(10);
    p.blood = 80;
  }).catch(() => {});
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => { window.__LN_API.hold('down', true); });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await new Promise((r) => setTimeout(r, 300));
  const pp = await page.evaluate(() => { const r = window.__LN.renderer; const s = r.cam.zoom; return { x: window.__LN.player.x, y: window.__LN.player.y, sx: r.w / 2, sy: r.h / 2, zoom: s }; });
  await page.screenshot({ path: path.join(OUT, '08-closeup.png'), clip: { x: Math.max(0, pp.sx - 130), y: Math.max(0, pp.sy - 200), width: 260, height: 260 } });
  console.log('shot: 08-closeup.png');

  // shop screen (Blood Market) — exercise the real sandbox flow first:
  // buy a shard bundle with store money, then a coat with the earned shards.
  await page.evaluate(() => { window.__LN.setScreen('shop'); });
  await new Promise((r) => setTimeout(r, 400));
  await shoot(page, '09-shop');
  await page.evaluate(() => { window.__LN.purchaseSku('shards_s'); });
  await new Promise((r) => setTimeout(r, 2400)); // sandbox latency + toast
  await page.evaluate(() => { window.__LN.buySkuWithShards('coat_bloodmoon'); });
  await new Promise((r) => setTimeout(r, 900));
  await shoot(page, '10-shop-after');
  // the cosmetic actually on the body, back in the world
  await page.evaluate(() => { window.__LN.setScreen('playing'); window.__LN_api_nope; });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => { window.__LN_API.setTime(20); });
  await shoot(page, '11-coat-ingame');

  /* ---------- mobile portrait (touch) ---------- */
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitValen(m, 60000);
  await m.evaluate(() => {
    window.__LN_API.beginNight();
    window.__LN.input.touchSeen = true;
    setTimeout(() => window.__LN_API.skipIntro(), 200);
  });
  await new Promise((r) => setTimeout(r, 900));
  await m.screenshot({ path: path.join(OUT, '07-mobile-play.png') });
  console.log('shot: 07-mobile-play.png');

  console.log('DONE');
} finally {
  await browser.close();
  if (server) server.kill();
}
