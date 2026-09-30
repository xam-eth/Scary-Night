/* envqa.mjs — frame-by-frame QA of the 3D room.
 *
 * Walks the player to a list of stops around the house and, at each one,
 * measures what is actually on the pixels rather than trusting the plan:
 * is there floor under her feet and out to the walls, do the panels stand
 * on the wall solids, do the props stand on the floor. Every measurement is
 * a hide-and-diff: render, hide one family of meshes, render again, and count
 * the pixels that changed. A frame is written per stop under
 * tools/shots-browser/qa/ so a human can look at the same frames.
 *
 *   node tools/envqa.mjs
 *
 * Needs the same Puppeteer shim as shotbrowser.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/shots-browser/qa');
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8102', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
fs.mkdirSync(path.join(ROOT, 'tools', '.cache', 'al2023-lib'), { recursive: true });
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
  headless: true, protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 250)));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8102/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  const d = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
  if (d && (d.ready || d.failed)) break;
  await wait(500);
}
await page.evaluate(async () => {
  const g = window.__LN;
  g.save.privacyAck = true;
  g.beginNight(); g.introT = 99; g.skipNarration();
  await new Promise((r) => setTimeout(r, 300));
  g.skipNarration();
  window.__env = (await import('./src/game/envkit.js')).EnvKit;
  window.__three = await import('./src/vendor/three/three.module.min.js');
});
await page.waitForFunction(() => window.__LN && window.__LN.screen === 'playing', { timeout: 30000, polling: 100 }).catch(() => {});
for (let i = 0; i < 60; i++) {
  const d = await page.evaluate(() => window.__env.diagnostics());
  if ((d.ready && d.props && d.room) || d.failed) break;
  await wait(500);
}
console.log('diag:', JSON.stringify(await page.evaluate(() => window.__env.diagnostics())));

const STOPS = [
  ['main hall', 600, 1100], ['hall north corridor', 380, 700], ['dining room', 500, 350],
  ['library', 1330, 350], ['basement', 1500, 1160], ['chapel', 2050, 1150],
  ['kitchen', -150, 320], ['outside the front door', 620, 1600],
];
const rows = [];
for (let n = 0; n < STOPS.length; n++) {
  const [name, x, y] = STOPS[n];
  await page.evaluate(([x, y]) => {
    const g = window.__LN;
    g.enemies.length = 0;
    g.player.x = x; g.player.y = y; g.player.blood = g.player.bloodMax;
    g.renderer.snapCamera(x, y);
  }, [x, y]);
  await wait(2500);
  const m = await page.evaluate(() => {
    const g = window.__LN;
    const E = window.__env;
    const THREE = window.__three;
    const r = g.renderer;
    const gl = E.renderer.getContext();
    const cw = E.canvas.width, ch = E.canvas.height;
    const px = new Uint8Array(cw * ch * 4);
    const grab = () => gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const dpr = cw / r.view.w;
    const at = (sx, sy) => {                 // CSS px inside the view -> pixel
      // readPixels counts rows from the BOTTOM of the framebuffer: every
      // height on the page has to be flipped, or a probe 30px above a
      // candle's base lands 30px below it, in the floor.
      const x = Math.round(sx * dpr);
      const y = ch - 1 - Math.round(sy * (ch / r.view.h));
      if (x < 0 || y < 0 || x >= cw || y >= ch) return null;
      const i = (y * cw + x) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    };
    const shot = (label) => {
      E.render({ camX: r.cam.x, camY: r.cam.y, zoom: r.cam.zoom, tilt: r.tilt,
        w: r.view.w, h: r.view.h, dpr: r.dpr, light: r.keyLightAt(r.cam.x, r.cam.y) });
      grab();
      return label;
    };
    const diff = (a, b) => (a && b)
      ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 999;

    // ---- sample points: floor under her, wall panels, props ----
    const feet = r.worldToScreen(g.player.x, g.player.y);
    const feetPts = [];
    for (let dy = -6; dy <= 26; dy += 4) for (let dx = -60; dx <= 60; dx += 6) {
      feetPts.push([feet.x + dx, feet.y + dy - r.view.top]);
    }
    // a wall is long and its centre is usually off screen: sample the part of
    // it that the camera can actually see, at a panel's mid-height
    const wallPts = [];
    for (const w of g.mansion.solids) {
      if (w.type !== 'wall') continue;
      const horiz = w.w >= w.h;
      const line = horiz ? w.y + w.h / 2 : w.x + w.w / 2;
      if ((horiz ? line : line) > r.cam.y && horiz) continue;   // folded: it would stand in front of her
      const a = horiz ? w.x : w.y, bEnd = horiz ? w.x + w.w : w.y + w.h;
      const lo = Math.max(a, (horiz ? r.cam.x : r.cam.y) - 150);
      const hi = Math.min(bEnd, (horiz ? r.cam.x : r.cam.y) + 150);
      if (hi - lo < 20) continue;
      const n = Math.min(5, Math.max(1, Math.round((hi - lo) / 60)));
      for (let i = 0; i < n; i++) {
        const t = lo + (hi - lo) * ((i + 0.5) / n);
        const wx = horiz ? t : line, wy = horiz ? line : t;
        if (!horiz && wy > r.cam.y) continue;
        const p = r.worldToScreen(wx, wy);
        wallPts.push([p.x, p.y - 60 - r.view.top]);     // mid-height of a panel
      }
    }
    const propPts = [];
    const propInfo = [];
    for (const f of g.mansion.furniture) {
      if (!f.env3d) continue;
      const p = r.worldToScreen(f.x, f.y);
      if (Math.abs(p.x - r.view.w / 2) > r.view.w * 0.5) continue;
      if (Math.abs(p.y - r.view.h / 2) > r.view.h * 0.55) continue;
      for (const up of [10, 30, 60, 90]) propPts.push([p.x, p.y - up - r.view.top]);
      propInfo.push({ type: f.type, w: Math.round(f.w), h: Math.round(f.h), sx: Math.round(p.x), sy: Math.round(p.y) });
    }

    shot('all');
    let covered = 0, total = 0;
    for (let yy = 0; yy < ch; yy += 4) for (let xx = 0; xx < cw; xx += 4) {
      total++; if (px[(yy * cw + xx) * 4 + 3] > 40) covered++;
    }
    const feetA = feetPts.map((q) => at(q[0], q[1]));
    const wallA = wallPts.map((q) => at(q[0], q[1]));
    const propA = propPts.map((q) => at(q[0], q[1]));
    let feetHit = 0;
    for (const a of feetA) if (a && a[3] > 40) feetHit++;

    for (const m2 of Object.values(E.roomMeshes || {})) m2.visible = false;
    shot('no room');
    for (const m2 of Object.values(E.roomMeshes || {})) m2.visible = true;
    for (const m2 of Object.values(E.propMeshes || {})) m2.visible = false;
    shot('no props');
    const propB = propPts.map((q) => at(q[0], q[1]));   // read it while it is still hidden
    for (const m2 of Object.values(E.propMeshes || {})) m2.visible = true;
    shot('back');
    let propHit = 0;
    const propDetail = [];
    for (let i = 0; i < propInfo.length; i++) {
      const ds = [0, 1, 2, 3].map((k) => diff(propA[i * 4 + k], propB[i * 4 + k]));
      const best = Math.max(...ds);
      if (best > 25) propHit++;
      propDetail.push(`${propInfo[i].type}(${propInfo[i].w}x${propInfo[i].h}@${propInfo[i].sx},${propInfo[i].sy}) up10/30/60/90 = ${ds.join('/')}`);
    }
    if (propDetail.length) console.log('    props: ' + propDetail.join(' | '));

    for (const key of ['wall', 'cracked', 'corner']) {
      if (E.roomMeshes[key]) E.roomMeshes[key].visible = false;
    }
    shot('no walls');
    const wallB = wallPts.map((q) => at(q[0], q[1]));
    for (const key of ['wall', 'cracked', 'corner']) {
      if (E.roomMeshes[key]) E.roomMeshes[key].visible = true;
    }
    let wallHit = 0;
    for (let i = 0; i < wallPts.length; i++) if (diff(wallA[i], wallB[i]) > 25) wallHit++;
    shot('restored');
    return {
      coverage: +(100 * covered / total).toFixed(1),
      feet: feetPts.length ? +(100 * feetHit / feetPts.length).toFixed(0) : -1,
      walls: `${wallHit}/${wallPts.length}`,
      props: `${propHit}/${propInfo.length}`,
    };
  });
  await page.screenshot({ path: path.join(OUT, `qa-${String(n + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  rows.push([name, m.coverage, m.feet, m.walls, m.props]);
  console.log(`${String(n + 1)}. ${name.padEnd(24)} floor ${String(m.coverage).padStart(5)}%  under-her-feet ${String(m.feet).padStart(3)}%  panels-on-walls ${m.walls.padStart(6)}  props-standing ${m.props}`);
}
await browser.close();
server.kill('SIGTERM');
