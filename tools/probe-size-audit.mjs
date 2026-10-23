// Size QA probe (build 28, user: "size sangat tidak tepat"): boots the real
// game headless, jumps to the day phase and dumps every character-like rig's
// name, model scale and world-space height (scene units = world px at zoom 1)
// so the keep-plaza figures can be compared against tower guards, the captain
// and the world's doors.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8153;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
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
  headless: true, protocolTimeout: 300000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) { /* ignore */ } });
await page.goto(`http://127.0.0.1:${PORT}/?cine=0&seed=20261007`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__LN && window.__LN.screen === 'playing' && window.__LN.survival, { timeout: 120000 });
await page.evaluate(async () => {
  window.__lkWorld = (await import('./src/game/render3d/world3d.js')).World3D;
  window.__lkTroop = (await import('./src/game/render3d/troop3d.js')).Troop3D;
});
await page.waitForFunction(() => window.__lkWorld?.diagnostics?.().ready, { timeout: 90000, polling: 100 });
await page.evaluate(() => {
  const g = window.__LN;
  g.setQuality(99);
  g._frameCheck = -Infinity;
  g.survival.restart();
  window.__lkOrig = g.update;
  g.update = () => {};
  window.__lkReal = (n) => { for (let i = 0; i < n; i++) { window.__lkOrig.call(g, 1 / 60); g.render(); } };
  window.__lkFast = (until) => { let n = 0; while (until() && n < 20000) { window.__lkOrig.call(g, 1 / 60); n++; } return n; };
  g.render();
});
await page.evaluate(() => {
  window.__lkFast(() => window.__LN.survival.elapsed < 3);
  const m = window.__LN.survival;
  if (m.phase === 'night') m.completeNight();
  window.__lkReal(30);
});
const dump = await page.evaluate(() => {
  const g = window.__LN;
  const scene = window.__lkWorld.scene || window.__lkWorld.root;
  const xform = (e, x, y, z) => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
  const heightOf = (o) => {
    o.updateMatrixWorld(true);
    let min = Infinity, max = -Infinity;
    o.traverse((m2) => {
      if (!m2.isMesh || !m2.geometry) return;
      if (!m2.geometry.boundingBox) m2.geometry.computeBoundingBox();
      const bb = m2.geometry.boundingBox;
      const e = m2.matrixWorld.elements;
      for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
        const p = xform(e, cx, cy, cz);
        if (p[1] < min) min = p[1];
        if (p[1] > max) max = p[1];
      }
    });
    return Number.isFinite(min) ? +(max - min).toFixed(1) : 0;
  };
  const out = [];
  const walk = (o, depth) => {
    const interesting = o.name && /troop-3d|valen|kaykit|captain|statue|decor|swarm|crowd/i.test(o.name);
    if (interesting) out.push({ name: o.name, h: heightOf(o), scale: +o.scale.x.toFixed(2), visible: o.visible, parent: (o.parent && o.parent.name) || '?' });
    if (depth < 4) o.children.forEach((c) => walk(c, depth + 1));
  };
  walk(scene, 0);
  return { rigs: out, zoom: g.renderer.cam ? +g.renderer.cam.zoom.toFixed(3) : null, phase: g.survival.phase };
});
console.log(JSON.stringify(dump));
await browser.close();
server.kill();
