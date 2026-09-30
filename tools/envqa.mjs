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
  // one stop per window, standing inside looking at it: the wall solids stop
  // at every opening, so each of the nine has to be filled by a panel
  ['dining window', 405, 210], ['hall window', 893, 1340],
  ['conservatory north', 2040, 210], ['conservatory east', 2180, 330],
  ['chapel window', 2180, 1060], ['scullery window', -100, 230],
  ['study window', 1310, -150], ['gallery window', 380, -240],
  ['oratory window', 2030, -240],
];
const ONLY = (process.argv[2] || '').toLowerCase();
const rows = [];
for (let n = 0; n < STOPS.length; n++) {
  if (ONLY && !STOPS[n][0].toLowerCase().includes(ONLY)) continue;
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
        for (const up of [18, 55, 92]) wallPts.push([p.x, p.y - up - r.view.top]);
      }
    }
    // windows: the wall solids stop at an opening, so each one has to be
    // filled by a panel — otherwise the room has a hole in it
    const winPts = [];
    const winInfo = [];
    for (const e of g.mansion.entrances) {
      if (e.kind !== 'window') continue;
      const p = r.worldToScreen(e.x, e.y);
      const folded = e.y > r.cam.y;                // folded: it would stand in front of her
      const off = Math.abs(p.x - r.view.w / 2) > r.view.w * 0.5
        || Math.abs(p.y - r.view.h / 2) > r.view.h * 0.55;
      if (folded || off) {
        winInfo.push({ id: e.id, skip: folded ? 'folded' : 'offscreen', sx: Math.round(p.x), sy: Math.round(p.y) });
        continue;
      }
      for (const up of [8, 30, 55, 80, 105]) winPts.push([p.x, p.y - up - r.view.top]);
      winInfo.push({ id: e.id, broken: !!e.broken, sx: Math.round(p.x), sy: Math.round(p.y) });
    }

    const propPts = [];
    const propInfo = [];
    for (const f of g.mansion.furniture) {
      if (!f.env3d) continue;
      const p = r.worldToScreen(f.x + (f.w || 0) / 2, f.y + (f.h || 0) / 2);
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
    const winA = winPts.map((q) => at(q[0], q[1]));
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
    let propHit = 0, propSeen = 0;
    const propDetail = [];
    for (let i = 0; i < propInfo.length; i++) {
      const ds = [0, 1, 2, 3].map((k) => diff(propA[i * 4 + k], propB[i * 4 + k])).filter((d) => d !== 999);
      if (!ds.length) { propDetail.push(`${propInfo[i].type}=unframed`); continue; }
      propSeen++;
      if (Math.max(...ds) > 25) propHit++;
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
    // one reading per sample point: three heights, and a point only counts if
    // at least one of them landed on the canvas
    let wallHit = 0, wallSeen = 0;
    for (let i = 0; i < wallPts.length; i += 3) {
      const ds = [0, 1, 2].map((k) => diff(wallA[i + k], wallB[i + k])).filter((d) => d !== 999);
      if (!ds.length) continue;
      wallSeen++;
      if (Math.max(...ds) > 25) wallHit++;
    }

    for (const key of ['window', 'windowBroken']) {
      if (E.roomMeshes[key]) E.roomMeshes[key].visible = false;
    }
    shot('no windows');
    const winB = winPts.map((q) => at(q[0], q[1]));
    for (const key of ['window', 'windowBroken']) {
      if (E.roomMeshes[key]) E.roomMeshes[key].visible = true;
    }
    let winHit = 0, winSeen = 0;
    const winDetail = [];
    for (let i = 0; i < winInfo.length; i++) {
      const w = winInfo[i];
      if (w.skip) { winDetail.push(`${w.id}=${w.skip}`); continue; }
      const ds = [0, 1, 2, 3, 4].map((k) => diff(winA[i * 5 + k], winB[i * 5 + k])).filter((d) => d !== 999);
      if (!ds.length) { winDetail.push(`${w.id}=unframed`); continue; }
      winSeen++;
      if (Math.max(...ds) > 25) winHit++;
      winDetail.push(`${w.id}${w.broken ? '(broken)' : ''}@${w.sx},${w.sy} +8/30/55/80/105 = ${ds.join('/')}`);
    }
    if (winDetail.length) console.log('    windows: ' + winDetail.join(' | '));
    shot('restored');
    return {
      coverage: +(100 * covered / total).toFixed(1),
      feet: feetPts.length ? +(100 * feetHit / feetPts.length).toFixed(0) : -1,
      walls: `${wallHit}/${wallSeen}`,
      windows: `${winHit}/${winSeen}`,
      winDetail: winDetail.join(' '),
      propDetail: propDetail.join(' '),
      props: `${propHit}/${propSeen}`,
    };
  });
  await page.screenshot({ path: path.join(OUT, `qa-${String(n + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  rows.push([name, m.coverage, m.feet, m.walls, m.windows, m.props]);
  console.log(`${String(n + 1)}. ${name.padEnd(24)} floor ${String(m.coverage).padStart(5)}%  under-her-feet ${String(m.feet).padStart(3)}%`
    + `  panels-on-walls ${m.walls.padStart(6)}  windows-filled ${m.windows.padStart(5)}  props-standing ${m.props}`);
  if (m.winDetail) console.log(`      windows: ${m.winDetail}`);
  if (m.propDetail) console.log(`      props:   ${m.propDetail}`);
}

/* ---------- the windows ----------
 * A wall solid stops at an opening, so a window the kit does not fill is a
 * hole in the room. Two checks: that every one of the nine HAS a panel, on
 * its own opening, in the state the glass is in (camera-independent); and
 * that the ones a player can actually stand in front of are drawn.
 */
const winGeom = await page.evaluate(() => {
  const E = window.__env, g = window.__LN;
  const s = 33 * 4;
  const out = [];
  for (const w of E.windows) {
    const whole = E.roomMeshes.window.userData.placements[w.intact];
    const smashed = E.roomMeshes.windowBroken.userData.placements[w.smashed];
    out.push({
      id: w.id, broken: !!w.e.broken,
      off: Math.round(Math.hypot(whole.x - w.e.x, whole.z - w.e.y)),
      panel: Math.round(whole.sx * 4), opening: Math.round(w.e.axis === 'h' ? w.e.w : w.e.h),
      wholeOff: !!whole.off, smashedOff: !!smashed.off,
    });
  }
  return out;
});
console.log('\nwindows — a panel on every opening:');
let geomOk = 0;
for (const w of winGeom) {
  const ok = w.off <= 1 && Math.abs(w.panel - w.opening) <= 2 && w.wholeOff === w.broken && w.smashedOff !== w.broken;
  if (ok) geomOk++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${w.id.padEnd(16)} panel ${String(w.panel).padStart(4)}px on a ${String(w.opening).padStart(4)}px opening`
    + `  ${w.off}px off its line  glass ${w.broken ? 'BROKEN' : 'whole'}: ${w.wholeOff ? 'panel off' : 'panel on'}/${w.smashedOff ? 'broken off' : 'broken on'}`);
}
console.log(`windows: ${geomOk}/${winGeom.length} have a panel standing on the opening`);

// the glass is a real state: break one and the wall has to keep up
const swap = await page.evaluate(async () => {
  const E = window.__env, g = window.__LN;
  const w = E.windows[0];
  const before = { whole: !!E.roomMeshes.window.userData.placements[w.intact].off, smashed: !!E.roomMeshes.windowBroken.userData.placements[w.smashed].off };
  w.e.broken = true; w.e.hp = 0;
  E.sync(g.mansion.entrances);
  await new Promise((r) => setTimeout(r, 400));
  const after = { whole: !!E.roomMeshes.window.userData.placements[w.intact].off, smashed: !!E.roomMeshes.windowBroken.userData.placements[w.smashed].off };
  w.e.broken = false; w.e.hp = w.e.hpMax;
  E.sync(g.mansion.entrances);
  await new Promise((r) => setTimeout(r, 400));
  const back = { whole: !!E.roomMeshes.window.userData.placements[w.intact].off, smashed: !!E.roomMeshes.windowBroken.userData.placements[w.smashed].off };
  return { id: w.id, before, after, back };
});
const swapOk = swap.before.whole === false && swap.before.smashed === true
  && swap.after.whole === true && swap.after.smashed === false
  && swap.back.whole === false && swap.back.smashed === true;
console.log(`  ${swapOk ? 'PASS' : 'FAIL'}  smashing ${swap.id} swaps its glass panel for the broken wall — and mending it puts the glass back`);

console.log('\nwindows, drawn where a player can stand to look at them:');
const winList = await page.evaluate(() => window.__LN.mansion.entrances
  .filter((e) => e.kind === 'window')
  .map((e) => ({ id: e.id, x: e.x, y: e.y, axis: e.axis })));
let winOk = 0, winTried = 0;
const ONLY_WIN = (process.argv[3] || '').toLowerCase();
for (const w of winList) {
  if (ONLY_WIN && !w.id.toLowerCase().includes(ONLY_WIN)) continue;
  // The camera sits south of her looking north, so a panel south of the
  // camera is folded away: a window is only ever seen from its south side (a
  // wall-side one from the yard it looks out on). Back off until it frames.
  let vantage = null, framedAt = null;
  for (const dist of [120, 220, 330, 450, 600, 780]) {
    const x = w.axis === 'h' ? w.x : w.x - dist;
    const y = w.axis === 'h' ? w.y + dist : w.y + 70;
    await page.evaluate(([x, y]) => {
      const g = window.__LN;
      g.enemies.length = 0;
      g.player.x = x; g.player.y = y; g.player.blood = g.player.bloodMax;
      g.renderer.snapCamera(x, y);
    }, [x, y]);
    await wait(900);
    framedAt = await page.evaluate(([wx, wy]) => {
      const r = window.__LN.renderer;
      const p = r.worldToScreen(wx, wy);
      const sy = p.y - r.view.top;
      return { ok: p.x > 40 && p.x < r.view.w - 40 && sy > 190 && sy < r.view.h - 160,
        sx: Math.round(p.x), sy: Math.round(sy), zoom: +r.cam.zoom.toFixed(2) };
    }, [w.x, w.y]);
    if (framedAt.ok) { vantage = { x, y }; break; }
  }
  if (!vantage) {
    console.log(`  ----  ${w.id.padEnd(16)} not framed from anywhere a player can stand (best ${framedAt.sx},${framedAt.sy} at zoom ${framedAt.zoom})`);
    continue;
  }
  winTried++;
  await page.evaluate(([x, y]) => {
    const g = window.__LN;
    g.enemies.length = 0;
    g.player.x = x; g.player.y = y; g.player.blood = g.player.bloodMax;
    g.renderer.snapCamera(x, y);
  }, [vantage.x, vantage.y]);
  await wait(2500);
  const m = await page.evaluate(([wx, wy, id]) => {
    const g = window.__LN, E = window.__env, r = g.renderer;
    const gl = E.renderer.getContext();
    const cw = E.canvas.width, ch = E.canvas.height;
    const px = new Uint8Array(cw * ch * 4);
    const dpr = cw / r.view.w;
    const at = (sx, sy) => {
      const x = Math.round(sx * dpr);
      const y = ch - 1 - Math.round(sy * (ch / r.view.h));
      if (x < 0 || y < 0 || x >= cw || y >= ch) return null;
      const i = (y * cw + x) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    };
    const shot = () => {
      E.render({ camX: r.cam.x, camY: r.cam.y, zoom: r.cam.zoom, tilt: r.tilt,
        w: r.view.w, h: r.view.h, dpr: r.dpr, light: r.keyLightAt(r.cam.x, r.cam.y) });
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    const diff = (a, b) => (a && b) ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 999;
    const p = r.worldToScreen(wx, wy);
    const ups = [6, 20, 45, 75, 105];
    const pts = ups.map((up) => [p.x, p.y - up - r.view.top]);
    shot();
    const A = pts.map((q) => at(q[0], q[1]));
    for (const key of ['window', 'windowBroken']) if (E.roomMeshes[key]) E.roomMeshes[key].visible = false;
    shot();
    const B = pts.map((q) => at(q[0], q[1]));
    for (const key of ['window', 'windowBroken']) if (E.roomMeshes[key]) E.roomMeshes[key].visible = true;
    shot();
    const wv = E.windows.find((v) => v.id === id);
    return { sx: Math.round(p.x), sy: Math.round(p.y), ds: pts.map((q, i) => diff(A[i], B[i])),
      folded: wv ? wv.e.y > r.cam.y : null, camY: Math.round(r.cam.y), wy: Math.round(wy) };
  }, [w.x, w.y, w.id]);
  const read = m.ds.filter((d) => d !== 999);
  const stone = read.filter((d) => d > 25).length;
  const open = read.filter((d) => d <= 25).length;
  // A window on an east or west wall is seen edge-on — the camera never yaws —
  // so it reads as a solid sliver with no opening in it. One on a north or
  // south wall has to show stone, then the hole, then the lintel above it.
  const ok = w.axis === 'h' ? (stone >= 1 && open >= 1) : stone >= 1;
  if (ok) winOk++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${w.id.padEnd(16)} from (${vantage.x},${vantage.y})  base@${m.sx},${m.sy}`
    + `  stone/open at +6/20/45/75/105px = ${m.ds.join('/')}`
    + `  [window y ${m.wy} vs camera ${m.camY}${m.folded ? ' — folded' : ''}]`);
}
console.log(`windows drawn: ${winOk}/${winTried} of the ones a player can stand in front of`);

await browser.close();
server.kill('SIGTERM');
