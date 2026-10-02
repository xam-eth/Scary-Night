/* layoutqa.mjs — is the house easy to walk through, and is it all there?
 *
 * Two of the complaints this exists to answer:
 *
 *   "letak perabotnya tidak tepat, tidak tersusun rapi yang membuat jalan
 *    susah" — a piece whose mesh is WIDER than the box you bump into is a
 *    lie you can see: the floor looks blocked where it is free, and free
 *    where it is not. Every piece of furniture is measured against its own
 *    collision box here.
 *
 *   "banyak element yang render-nya telat" — the room, the bake and the
 *    bodies are all assets that arrive after the night has started. This
 *    times them: how long after the first frame of the night until each one
 *    is on the screen.
 *
 *   node tools/layoutqa.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8113;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  fs.mkdirSync(LIB_DIR, { recursive: true });
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
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));

/* ---------- 1. the boot: how late is everything? ---------- */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
const t0 = Date.now();
for (let i = 0; i < 200; i++) {
  const d = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
  if (d && (d.ready || d.failed)) break;
  await wait(100);
}
console.log(`valen GLB ready          ${Date.now() - t0} ms`);
await page.evaluate(async () => {
  const g = window.__LN;
  g.save.privacyAck = true;
  window.__env = (await import('./src/game/envkit.js')).EnvKit;
  window.__enemy = (await import('./src/game/enemy3d.js')).Enemy3D;
  window.__foes = await import('./src/game/enemies.js');
});
await wait(1500);
const kit = await page.evaluate(() => ({ ready: window.__env.ready, pieces: Object.keys(window.__env.pieces || {}).length }));
console.log(`env kit ready            ${Date.now() - t0} ms (${kit.pieces} pieces)`);

const tNight = Date.now();
await page.evaluate(async () => {
  const g = window.__LN;
  g.beginNight(); g.introT = 99; g.skipNarration();
  await new Promise((r) => setTimeout(r, 300));
  g.skipNarration();
});
const seen = {};
for (let i = 0; i < 160; i++) {
  const s = await page.evaluate(() => {
    const g = window.__LN, E = window.__env, N = window.__enemy;
    return {
      screen: g.screen,
      room: E.ready && !!E.roomMeshes,
      props: E.ready && !!E.propMeshes,
      bake: !!(E.bakeInfo),
      foeFrames: N ? Object.values(N.types || {}).filter((r) => r && r.preview).length : 0,
      foeTypes: N ? Object.keys(N.types || {}).length : 0,
    };
  });
  const t = Date.now() - tNight;
  if (!seen.screen && s.screen === 'playing') { seen.screen = t; console.log(`night on screen          ${t} ms`); }
  if (!seen.room && s.room) { seen.room = t; console.log(`room built               ${t} ms`); }
  if (!seen.props && s.props) { seen.props = t; console.log(`furniture placed         ${t} ms`); }
  if (!seen.bake && s.bake) { seen.bake = t; console.log(`light baked              ${t} ms`); }
  if (s.foeTypes && s.foeFrames >= s.foeTypes && !seen.foes) { seen.foes = t; console.log(`all ${s.foeTypes} enemy bodies baked   ${t} ms`); }
  if (seen.screen && seen.room && seen.props && seen.bake && seen.foes) break;
  await wait(120);
}
for (const k of ['screen', 'room', 'props', 'bake', 'foes']) if (seen[k] == null) console.log(`${k.padEnd(24)} NEVER`);

/* ---------- 2. furniture against the box you walk into ---------- */
await wait(1500);
const layout = await page.evaluate(() => {
  const E = window.__env;
  return (E && E.propFit) || [];
});
// a prop with no box (a candle on a stand) is not a thing you bump into
const boxed = layout.filter((r) => (r.box.w || r.box.h) && r.solid !== false);
const over = boxed.filter((r) => r.over > 8).sort((a, b) => b.over - a.over);
const under = boxed.filter((r) => r.short > 20).sort((a, b) => b.short - a.short);
const byPiece = {};
for (const r of layout) {
  (byPiece[r.piece] ||= []).push(r);
}
console.log(`\n---- FURNITURE AGAINST THE BOX YOU WALK INTO ----`);
console.log(`${layout.length} pieces standing in the kit, ${boxed.length} of them furniture you can walk into`);
if (over.length) {
  console.log(`\n  ${over.length} stand WIDER than the box you bump into (a floor that looks blocked where it is free):`);
  for (const r of over.slice(0, 14)) console.log(`    ${String(r.type).padEnd(12)} -> ${r.piece.padEnd(8)} box ${`${Math.round(r.box.w)}x${Math.round(r.box.h)}`.padEnd(9)} mesh ${`${r.foot.w}x${r.foot.d}`.padEnd(9)} overhang ${r.over}px`);
} else console.log('  none overhang their box — what you see is what you bump into');
if (under.length) {
  console.log(`\n  ${under.length} stand NARROWER than their box by more than 20px (you bump into air):`);
  for (const r of under.slice(0, 10)) console.log(`    ${String(r.type).padEnd(12)} -> ${r.piece.padEnd(8)} box ${`${Math.round(r.box.w)}x${Math.round(r.box.h)}`.padEnd(9)} mesh ${`${r.foot.w}x${r.foot.d}`.padEnd(9)} short by ${r.short}px`);
} else console.log('  none leave a gap you can bump into');
console.log(`\n  ---- how tall each thing stands, in metres ----`);
const M = await page.evaluate(() => (window.__env ? window.__env._metre() : 51.1));
for (const [piece, list] of Object.entries(byPiece)) {
  const h = list.map((r) => r.tall);
  const lo = Math.min(...h), hi = Math.max(...h);
  console.log(`    ${piece.padEnd(8)} ${String(list.length).padStart(2)}x  ${lo === hi ? String(lo) : `${lo}-${hi}`}px  =  ${(lo / M).toFixed(2)}${lo === hi ? '' : `-${(hi / M).toFixed(2)}`}m tall`);
}
console.log(`    (1m = ${M.toFixed(1)}px on this camera; she is 1.70m)`);

/* ---------- 3. can a body actually get through? ---------- */
/* The clear-floor percentage was a lie: a room can be 80% clear and still be
 * impossible to cross if the 20% is arranged as a wall of chairs. So the
 * solids are INFLATED by her shoulders and the free space is flood-filled:
 * what is left is the floor a body can stand on, and whether it is one piece.
 */
const walk = await page.evaluate(() => {
  const g = window.__LN, m = g.mansion;
  const R = 17;                     // her shoulders, in world px
  const step = 14;
  const out = [];
  const solidAt = (x, y) => {
    for (const s of m.solids) {
      if (s.type === 'wall') continue;
      if (x > s.x - R && x < s.x + s.w + R && y > s.y - R && y < s.y + s.h + R) return true;
    }
    return false;
  };
  for (const [name, room] of Object.entries(m.rooms || {})) {
    if (!room || !room.w) continue;
    const nx = Math.max(1, Math.round(room.w / step));
    const ny = Math.max(1, Math.round(room.h / step));
    const free = [];
    let total = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = room.x + (i + 0.5) * (room.w / nx);
        const y = room.y + (j + 0.5) * (room.h / ny);
        free.push(!solidAt(x, y));
        total++;
      }
    }
    // flood fill the free cells
    const seen = new Array(total).fill(0);
    const comps = [];
    for (let s0 = 0; s0 < total; s0++) {
      if (!free[s0] || seen[s0]) continue;
      let n = 0; const stack = [s0]; seen[s0] = 1;
      while (stack.length) {
        const c = stack.pop(); n++;
        const ci = c % nx, cj = (c - ci) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
          const k = nj * nx + ni;
          if (free[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      comps.push(n);
    }
    comps.sort((a, b) => b - a);
    const biggest = comps[0] || 0;
    out.push({
      name, w: Math.round(room.w), h: Math.round(room.h),
      body: total ? Math.round(free.filter(Boolean).length / total * 100) : 0,
      reach: total ? Math.round(biggest / total * 100) : 0,
      parts: comps.length,
    });
  }
  return out;
});
console.log(`\n---- CAN A BODY GET THROUGH? (solids inflated by her shoulders) ----`);
for (const r of walk) {
  const flag = r.parts > 1 ? `  <-- ${r.parts} islands` : '';
  console.log(`  ${String(r.name).padEnd(14)} ${String(r.w).padStart(4)}x${String(r.h).padStart(4)}  ${String(r.body).padStart(3)}% standable, ${String(r.reach).padStart(3)}% of the room reachable in one piece${flag}`);
}

/* ---------- 4. is the furniture arranged, or just standing about? ---------- */
const tidy = await page.evaluate(() => {
  const g = window.__LN, m = g.mansion, E = window.__env;
  const rows = [];
  const walls = (m.solids || []).filter((w) => w.type === 'wall');
  const near = (f) => walls.some((w) =>
    f.x + f.w > w.x - 26 && f.x < w.x + w.w + 26 && f.y + f.h > w.y - 26 && f.y < w.y + w.h + 26);
  const rooms = Object.values(m.rooms || {});
  const inRoom = (f) => rooms.find((r) => f.x + f.w / 2 >= r.x && f.x + f.w / 2 < r.x + r.w
    && f.y + f.h / 2 >= r.y && f.y + f.h / 2 < r.y + r.h) || null;
  let float = 0, overlap = 0, spun = 0, n = 0;
  const floating = [], clashes = [];
  for (const f of (m.furniture || [])) {
    if (!E.propFit || !E.propFit.some((r) => Math.abs(r.box.x - f.x) < 1 && Math.abs(r.box.y - f.y) < 1)) continue;
    n++;
    if (!near(f)) { float++; floating.push(`${f.type} at ${Math.round(f.x)},${Math.round(f.y)}`); }
    if (f.rot) spun++;
    for (const o of (m.furniture || [])) {
      if (o === f || !o.w) continue;
      const ox = Math.min(f.x + f.w, o.x + o.w) - Math.max(f.x, o.x);
      const oy = Math.min(f.y + f.h, o.y + o.h) - Math.max(f.y, o.y);
      if (ox > 6 && oy > 6) {
        overlap++;
        if (clashes.length < 6) clashes.push(`${f.type} into ${o.type} (${Math.round(ox)}x${Math.round(oy)}px)`);
        break;
      }
    }
  }
  return { n, float, overlap, spun, floating: floating.slice(0, 10), clashes };
});
console.log(`\n---- IS IT ARRANGED, OR JUST STANDING ABOUT? ----`);
console.log(`  ${tidy.n} pieces of kit furniture in the house`);
console.log(`  ${tidy.n - tidy.float} stand against a wall, ${tidy.float} stand out in the room${tidy.float ? ':' : ' — the room is dressed, not littered'}`);
for (const f of tidy.floating) console.log(`      ${f}`);
console.log(`  ${tidy.overlap} overlap another piece${tidy.overlap ? ':' : ''}`);
for (const f of tidy.clashes) console.log(`      ${f}`);

/* ---------- 5. are the corners clean? ---------- */
const corners = await page.evaluate(() => {
  const E = window.__env, m = window.__LN.mansion;
  const s = 33, LEG = 2 * s;
  const VEC = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cnr = E.roomBins.corner || [];
  const panels = [...(E.roomBins.wall || []), ...(E.roomBins.wallCracked || [])];
  let doubled = 0, bricked = 0;
  const worst = [];
  for (const c of cnr) {
    // where the two legs lie: the L reaches -x and +z before its rotation
    const cos = Math.cos(c.ry), sin = Math.sin(c.ry);
    const legs = [[-1, 0], [0, 1]].map(([lx, lz]) => {
      const x = lx * cos + lz * sin, z = -lx * sin + lz * cos;
      return [x, z];
    });
    for (const [vx, vz] of legs) {
      // a panel whose centre is inside the leg's reach is drawn twice
      for (const p of panels) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const along = dx * vx + dz * vz;
        const across = Math.abs(dx * (-vz) + dz * vx);
        if (along > -8 && along < LEG - 8 && across < 20) {
          doubled++;
          if (worst.length < 5) worst.push(`corner ${Math.round(c.x)},${Math.round(c.z)} doubled by a panel ${Math.round(along)}px along its leg`);
          break;
        }
      }
      // and a leg laid across a doorway is a doorway bricked up
      const mx = c.x + vx * LEG * 0.6, mz = c.z + vz * LEG * 0.6;
      for (const e of (m.entrances || [])) {
        if (Math.abs(mx - e.x) < (e.w || 0) / 2 + 20 && Math.abs(mz - e.y) < (e.h || 0) / 2 + 20) {
          bricked++;
          if (worst.length < 8) worst.push(`corner ${Math.round(c.x)},${Math.round(c.z)} lays a leg across ${e.id}`);
          break;
        }
      }
    }
  }
  return { n: cnr.length, panels: panels.length, doubled, bricked, worst };
});
console.log(`\n---- ARE THE CORNERS CLEAN? ----`);
console.log(`  ${corners.n} corners, ${corners.panels} wall panels`);
console.log(`  ${corners.doubled} corners standing on top of a panel that already covers the same ground${corners.doubled ? ' — those are the seams:' : ' — no z-fighting seams'}`);
for (const w of corners.worst) console.log(`      ${w}`);

/* ---------- 6. is anything standing inside a wall? ---------- */
const inWall = await page.evaluate(() => {
  const m = window.__LN.mansion, E = window.__env;
  const walls = (m.solids || []).filter((w) => w.type === 'wall');
  const out = [];
  for (const f of (E.propFit || [])) {
    if (!f.box.w || !f.box.h) continue;
    for (const w of walls) {
      const ox = Math.min(f.box.x + f.box.w, w.x + w.w) - Math.max(f.box.x, w.x);
      const oy = Math.min(f.box.y + f.box.h, w.y + w.h) - Math.max(f.box.y, w.y);
      if (ox > 6 && oy > 6) { out.push(`${f.type} at ${Math.round(f.box.x)},${Math.round(f.box.y)} is ${Math.round(ox)}x${Math.round(oy)}px inside a wall`); break; }
    }
  }
  return out;
});
console.log(`\n---- IS ANYTHING STANDING INSIDE A WALL? ----`);
console.log(`  ${inWall.length ? inWall.length + ' pieces are:' : 'nothing — every piece stands on floor'}`);
for (const w of inWall.slice(0, 8)) console.log(`      ${w}`);

server.kill();
await browser.close();
