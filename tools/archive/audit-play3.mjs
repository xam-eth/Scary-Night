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
const server = spawn('python3', ['-m', 'http.server', '8093', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
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
  await page.goto('http://127.0.0.1:8093/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const d = await page.evaluate(() => window.__LN_API && window.__LN_API.valen());
    if (d && (d.ready || d.failed)) return d;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
function sampleFrame() {
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const at = (x, y) => {
    const d = ctx.getImageData(x | 0, y | 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const g = window.__LN;
  const r = g.renderer;
  return {
    css: [r.w, r.h], buf: [w, h], zoom: +r.cam.zoom.toFixed(3), tilt: r.tilt,
    viewH: Math.round(r.cam.viewH), viewW: Math.round(r.cam.viewW),
    cam: [Math.round(r.cam.x), Math.round(r.cam.y)],
    fade: +g.fadeFromBlack.toFixed(3),
    rug: world(460, 330),
    table: world(460, 250),
    floor: world(400, 450),
  };
  function world(wx, wy) {
    const s = r.worldToScreen(wx, wy);
    return at(s.x * (w / r.w), s.y * (h / r.h));
  }
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
  await new Promise((r) => setTimeout(r, 200));
}

try {
  const phone = await browser.newPage();
  console.log('valen', JSON.stringify(await boot(phone, 390, 844, true)));
  await night(phone);
  await phone.screenshot({ path: path.join(OUT, 'a-start.png') });
  console.log('phone', JSON.stringify(await phone.evaluate(sampleFrame)));
  await phone.evaluate(() => {
    const g = window.__LN;
    g.player.x = 700; g.player.y = 120;
    g.renderer.snapCamera(700, 120);
  });
  await new Promise((r) => setTimeout(r, 400));
  await phone.screenshot({ path: path.join(OUT, 'b-door.png') });
  await phone.evaluate(() => {
    const g = window.__LN;
    g.player.x = 400; g.player.y = 520;
    g.renderer.snapCamera(400, 520);
    const e = g.enemies[0];
    if (e) { e.x = 460; e.y = 500; e.dead = false; e.seenPlayer = 2; }
    g.player.startAttack(g);
  });
  await new Promise((r) => setTimeout(r, 120));
  await phone.screenshot({ path: path.join(OUT, 'c-attack.png') });
  await phone.evaluate(() => {
    const g = window.__LN;
    g.player.x = -150; g.player.y = 980;
    g.renderer.snapCamera(-150, 980);
    g.messages.length = 0;
  });
  await new Promise((r) => setTimeout(r, 350));
  await phone.screenshot({ path: path.join(OUT, 'd-stakes.png') });
  console.log('stakes', JSON.stringify(await phone.evaluate(() => {
    const g = window.__LN;
    const t = g.interactTarget;
    return {
      step: g.coach && g.coach.step,
      prompt: t && t.ent && t.ent.name,
      label: t && t.actions && t.actions[0] && t.actions[0].label,
      px: Math.round(g.player.x), py: Math.round(g.player.y),
    };
  })));

  await phone.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 300));
  await phone.evaluate(() => {
    const g = window.__LN;
    g.player.x = 400; g.player.y = 420;
    g.renderer.snapCamera(400, 420);
    window.__LN_API.setTime(20);
  });
  await new Promise((r) => setTimeout(r, 300));
  await phone.screenshot({ path: path.join(OUT, 'e-land.png') });
  console.log('land', JSON.stringify(await phone.evaluate(sampleFrame)));

  const desk = await browser.newPage();
  await boot(desk, 1280, 720, false);
  await night(desk);
  await desk.screenshot({ path: path.join(OUT, 'f-desk.png') });
  console.log('desk', JSON.stringify(await desk.evaluate(sampleFrame)));
  console.log('DONE');
} finally {
  await browser.close();
  server.kill();
}
