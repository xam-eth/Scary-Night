/* export-house.mjs — write the house out as data, so another engine can
 * build it out of the same pieces.
 *
 *   node tools/export-house.mjs [out.json]      # default assets/house.json
 *
 * All eleven rooms in LAST NIGHT are assembled at runtime from assets/env-kit/*.glb
 * — floor slabs inside rooms and passages, wall panels off shared wall runs,
 * corners, windows, doors, and room-relative furniture. The camera projection,
 * room graph and exterior points are exported alongside those placements.
 *
 * The build needs a browser (THREE + GLTFLoader), so this opens the game
 * headlessly, lets the kit finish, and reads the placements the room was
 * ACTUALLY built from — not a second description of it that could drift.
 *
 * The format, for whoever imports it:
 *
 *   meta.units        world px. Valen is 72px and 1.70m; 1m = 51.872px at
 *                     the current shared isometric camera scale.
 *   meta.kitScale     33 — the kit's GLBs are authored in metres and scaled
 *                     by this to become px. Divide the scale by it to work
 *                     in metres; the rotation is already in radians.
 *   axes              x east, y UP (height above the floor), z south.
 *                     Godot's axes are the same: no swizzle needed.
 *   pieces            name -> { file, size } where size is the GLB's own
 *                     bounding box in kit units (metres).
 *   placements        one per instance: { piece, group, x, y, z, ry, sx, sy, sz }
 *                     y is the piece's own lift off the floor, already
 *                     corrected for the corner its author measured from.
 *
 * A Godot importer is then: for each placement, instance pieces[piece].file,
 * set transform (origin at x,y,z, rotation_y = ry, scale = sx,sy,sz), and
 * parent it to a node per group. ~40 lines of GDScript.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'assets', 'house.json'));
const PORT = 8111;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
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
  headless: true, protocolTimeout: 300000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.message).slice(0, 200)));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
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
  window.__kit = await import('./src/game/envkit.js');
  window.__env = window.__kit.EnvKit;
});
await page.waitForFunction(() => window.__LN && window.__LN.screen === 'playing', { timeout: 60000, polling: 200 }).catch(() => {});
for (let i = 0; i < 90; i++) {
  const d = await page.evaluate(() => window.__env.diagnostics());
  if ((d.ready && d.props && d.room) || d.failed) break;
  await wait(500);
}

const house = await page.evaluate(() => {
  const kit = window.__kit;
  const E = window.__env;
  const g = window.__LN;
  const m = g.mansion;
  const round = (v) => (Number.isFinite(v) ? +v.toFixed(3) : 0);
  const pieces = {};
  for (const name of Object.keys(E.pieces || {})) {
    const src = E.pieces[name];
    pieces[name] = {
      file: 'assets/env-kit/' + (kit.KIT_FILES ? kit.KIT_FILES[name] : name + '.glb'),
      size: { x: round(src.size.x), y: round(src.size.y), z: round(src.size.z) },
      min: { x: round(src.min.x), y: round(src.min.y), z: round(src.min.z) },
    };
  }
  const placements = [];
  const dump = (group, bins) => {
    for (const key of Object.keys(bins || {})) {
      const list = bins[key] || [];
      for (const p of list) {
        placements.push({
          piece: key, group,
          x: round(p.x), y: round(p.y), z: round(p.z),
          ry: round(p.ry || 0),
          sx: round(p.sx), sy: round(p.sy), sz: round(p.sz),
          ...(p.tint ? { tint: p.tint } : {}),
          ...(p.follows ? { follows: p.follows } : {}),
        });
      }
    }
  };
  dump('room', E.roomBins);
  dump('props', Object.fromEntries(Object.keys(E.propMeshes || {})
    .map((k) => [k, (E.propMeshes[k] && E.propMeshes[k].userData || {}).placements || []])));
  dump('fortress', Object.fromEntries(Object.keys(E.fortressMeshes || {})
    .map((k) => [k, (E.fortressMeshes[k] && E.fortressMeshes[k].userData || {}).placements || []])));
  return {
    meta: {
      game: 'LAST NIGHT',
      generated: new Date().toISOString(),
      units: `world px — Valen is ${kit.VALEN_HEIGHT}px tall; 1m = ${round(kit.pxPerMetre(g.renderer.tilt))}px at this camera`,
      axes: 'x east, y up, z south — the same axes Godot uses',
      camera: {
        projection: 'orthographic-isometric',
        azimuthRad: Math.PI / 4,
        elevationRad: Math.asin(g.renderer.tilt),
        horizontal: Math.SQRT1_2,
        vertical: 1 / Math.sqrt(6),
      },
      kitScale: kit.KIT_SCALE,
      kitDir: kit.KIT_DIR,
      valen: { px: kit.VALEN_HEIGHT, metres: kit.VALEN_METRES },
      pxPerMetre: round(kit.pxPerMetre(g.renderer.tilt)),
      pieces,
    },
    rooms: m.roomList.map((r) => ({
      id: r.id, name: r.name,
      x: r.x, y: r.y, w: r.w, h: r.h,
      floor: r.floor, dark: r.dark,
    })),
    entrances: (m.entrances || []).map((e) => ({
      id: e.id, name: e.name, kind: e.kind, axis: e.axis, room: e.room,
      exterior: !!e.exterior,
      x: round(e.x), y: round(e.y), w: round(e.w), h: round(e.h),
      inside: e.inside ? { x: round(e.inside.x), y: round(e.inside.y) } : null,
      outside: e.outside ? { x: round(e.outside.x), y: round(e.outside.y) } : null,
    })),
    portals: (m.portals || []).map((p) => ({
      id: p.id, kind: p.kind, room: p.room, to: p.to || null, axis: p.axis,
      x: round(p.x), y: round(p.y), width: round(p.width),
    })),
    passages: (m.passages || []).map((p) => ({
      id: p.id, from: p.a, to: p.b, x: round(p.x), y: round(p.y), r: round(p.r),
    })),
    furniture: (m.furniture || []).map((f) => ({
      type: f.type, room: f.room || null, x: round(f.x), y: round(f.y),
      w: round(f.w), h: round(f.h), rot: round(f.rot || 0), solid: f.solid !== false,
    })),
    lights: (m.lights || []).map((l) => ({
      id: l.id || null, type: l.type, room: l.room || null,
      x: round(l.x), y: round(l.y), r: round(l.r), i: round(l.i),
    })),
    spawns: (m.spawns || []).map((s) => ({
      x: round(s.x), y: round(s.y), entrance: s.entrance || null, weight: round(s.weight),
    })),
    solids: (m.solids || []).filter((s) => s.type === 'wall')
      .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
    placements,
  };
});

await browser.close();
server.kill();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(house));
const byPiece = {};
for (const p of house.placements) byPiece[p.piece] = (byPiece[p.piece] || 0) + 1;
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${house.rooms.length} rooms, ${house.portals.length} portals, `
  + `${house.entrances.length} exterior entrances, ${house.solids.length} wall segments, `
  + `${house.placements.length} placements across ${Object.keys(byPiece).length} distinct kit-piece types`);
console.log('  ' + Object.entries(byPiece).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}`).join('  '));
