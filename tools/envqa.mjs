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
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const MODE = args.mode || 'all';
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
  window.__valen = (await import('./src/game/valen3d.js')).Valen3D;
  window.__enemy = (await import('./src/game/enemy3d.js')).Enemy3D;
  window.__eh = (await import('./src/game/enemy3d.js')).ENEMY_HEIGHT;
  window.__foes = await import('./src/game/enemies.js');
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
/* ---------- the sizes ----------
 * A room is only the right size next to the thing standing in it, and the
 * woman is 72 world px because the game says she is. Every piece the kit is
 * built from is measured against her: the walls and the doors have to stand
 * over her, and the furniture has to stand UNDER her. Scaled to their 2D
 * footprints instead, a chair came out at 88px and a dining table at 132 —
 * level with the wall — and the house read as a giant's house. */

/* ==========================================================================
 * THE SIEGE (#60) — density, and what the crowd costs a phone frame.
 *
 * The promise is "twenty to forty bodies on screen at once". Cheap bodies or
 * not, that has to be paid for somewhere, so this measures it the same way
 * everything else in this file is measured: render, take the crowd away,
 * render again, and look at what changed — here the milliseconds.
 * ========================================================================== */
async function siegeSection() {
  console.log('\n---- THE SIEGE (#60): density, and what it costs ----');
  await page.evaluate(() => {
    const g = window.__LN;
    window.__LN_API.stopMove();
    g.screen = 'playing';
    g.save.nightsSurvived = 8;          // a late night: the yard is full
    g.save.ending = null;
    g.enemies.length = 0;
    g.messages.length = 0;
    g.time = 279;
    g.player.blood = g.player.bloodMax;
    g.player.state = 'idle';
    g.player.iframes = 999;
    g.climax.reset();
    const front = g.mansion.entrances.find((e) => e.id === 'frontDoor') || g.mansion.entrances[0];
    const out = front.outside || { x: front.x, y: front.y + 78 };
    const ux = out.x - front.x, uy = out.y - front.y;
    const d = Math.hypot(ux, uy) || 1;
    g.player.x = front.x + (ux / d) * 150;
    g.player.y = front.y + (uy / d) * 150;
    g.renderer.snapCamera(g.player.x, g.player.y);
    window.__anchor = { x: g.player.x, y: g.player.y };
  });
  await wait(600);
  await page.evaluate(() => window.__LN_API.peak('crescendo'));
  // hold her in the yard while they arrive: a house full of besiegers shoves
  for (let i = 0; i < 45; i++) {
    await wait(200);
    await page.evaluate(() => {
      const g = window.__LN;
      g.player.x = window.__anchor.x; g.player.y = window.__anchor.y;
      g.player.iframes = 999; g.player.blood = g.player.bloodMax;
    });
  }
  /* Software WebGL on a shared box is a noisy clock: a single run of renders
   * can come out slower WITHOUT the crowd than with it. So take the best of
   * three alternating passes — the fastest run is the one nothing else
   * interrupted, and that is the number worth quoting. */
  const frameMs = () => page.evaluate(() => {
    const g = window.__LN;
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      const t0 = performance.now();
      for (let i = 0; i < 8; i++) g.render();
      best = Math.min(best, (performance.now() - t0) / 8);
    }
    return best;
  });
  const read = await page.evaluate(() => {
    const g = window.__LN, r = g.renderer;
    const crowd = g.director.crowd.filter((b) => !b.gone);
    const on = (o) => Math.abs(o.x - r.cam.x) < r.cam.viewW / 2 + 40
      && Math.abs(o.y - r.cam.y) < r.cam.viewH / 2 + 40;
    return {
      crowd: crowd.length,
      onScreen: crowd.filter(on).length,
      drawn: crowd.filter((b) => r.isVisible(b.x, b.y, 120)).length,
      walls: [...new Set(crowd.map((b) => b.entrance && b.entrance.id))].length,
      foes: g.enemies.filter((e) => !e.dead).length,
      glb: (window.__enemy && window.__enemy.diagnostics ? window.__enemy.diagnostics() : {}) || {},
    };
  });
  const park = (on) => page.evaluate((flip) => {
    const g = window.__LN;
    if (flip) {
      window.__parked = g.director.crowd.map((b) => ({ b, x: b.x, y: b.y }));
      for (const p of window.__parked) { p.b.x += 99999; p.b.y += 99999; }
    } else if (window.__parked) {
      for (const p of window.__parked) { p.b.x = p.x; p.b.y = p.y; }
      window.__parked = null;
    }
  }, on);
  let msWith = Infinity, msWithout = Infinity;
  for (let round = 0; round < 3; round++) {
    msWith = Math.min(msWith, await frameMs());
    await park(true);
    msWithout = Math.min(msWithout, await frameMs());
    await park(false);
  }
  const cost = msWith - msWithout;
  const glbSlots = read.glb && read.glb.assigned != null ? read.glb.assigned : null;
  console.log(`  peak: ${read.crowd} bodies outside, ${read.onScreen} of them on screen at once`
    + ` (${read.drawn} drawn), massed at ${read.walls} entrances; ${read.foes} besiegers in the house`);
  console.log(`  frame: ${msWith.toFixed(2)}ms with the crowd, ${msWithout.toFixed(2)}ms without`
    + ` — ${cost.toFixed(2)}ms for ${read.drawn} bodies (${(cost / Math.max(1, read.drawn)).toFixed(3)}ms each)`);
  const ok = (b, msg) => console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}`);
  ok(read.onScreen >= 20,
    `a phone frame holds twenty or more of them at the finale (${read.onScreen} on screen, ${read.crowd} in the yard)`);
  ok(cost / Math.max(1, msWithout) < 0.06 && read.drawn <= 70,
    `and the crowd is cheap bodies, not forty more besiegers (${read.drawn} of them cost ${(cost / Math.max(1, msWithout) * 100).toFixed(1)}% of a frame, ${(cost / Math.max(1, read.drawn)).toFixed(2)}ms each on this software renderer)`);
  /* The cost has to be flat in the number of bodies, not quadratic in the
   * crowd: the whole promise is that the spectacle does not buy a slideshow. */
  const half = await page.evaluate(() => {
    const g = window.__LN;
    const keep = g.director.crowd.filter((b) => !b.gone).length;
    for (let i = 0; i < Math.floor(keep / 2); i++) g.director.crowd[i].x += 99999;
    return keep - Math.floor(keep / 2);
  });
  let msHalf = Infinity;
  for (let round = 0; round < 2; round++) msHalf = Math.min(msHalf, await frameMs());
  await page.evaluate(() => {
    const g = window.__LN;
    for (const b of g.director.crowd) if (b.x > 90000) b.x -= 99999;
  });
  console.log(`  ...and ${half} of them cost ${(msHalf - msWithout).toFixed(1)}ms against the same empty frame`
    + ` — at this size the difference is inside the noise of a software renderer, which is the point:`
    + ` the crowd is a flat charge per body, not a frame of its own`);
  ok(read.drawn <= 70 && (glbSlots == null || glbSlots <= 8),
    `the skinned bodies stay capped — ${glbSlots == null ? 'no GLB slots spent on the crowd' : `${glbSlots} GLB slots, none of them the crowd's`}`);
}

async function sizeSection() {
  console.log('\n---- THE SIZES, IN METRES (#55) ----');
  const { sizes, metre, fit } = await page.evaluate(() => ({
    sizes: window.__env.sizes(), metre: window.__env._metre(), fit: window.__env.propFit || [],
  }));
  console.log(`  a metre costs ${metre.toFixed(1)} world px on this camera; she is 1.70m`);
  const rows = Object.keys(sizes).map((k) => ({ piece: k, ...sizes[k] }));
  const top = (r) => (Array.isArray(r.h) ? r.h[1] : r.h);
  const low = (r) => (Array.isArray(r.h) ? r.h[0] : r.h);
  rows.sort((a, b) => top(b) - top(a));
  for (const r of rows) {
    const h = Array.isArray(r.h) ? `${r.h[0]}-${r.h[1]}` : r.h;
    const w = Array.isArray(r.w) ? `${r.w[0]}-${r.w[1]}` : r.w;
    const m = `${(low(r) / metre).toFixed(2)}${Array.isArray(r.h) ? `-${(top(r) / metre).toFixed(2)}` : ''}m`;
    console.log(`  ${r.piece.padEnd(12)} n=${String(r.count).padStart(3)}  h ${String(h).padStart(8)}px  w ${String(w).padStart(8)}px  ${m.padStart(11)}  ${String(r.hxValen).padStart(5)}x her`);
  }
  const ok = (b, msg) => console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}`);
  const at = (k) => sizes[k] || null;
  const mOf = (k) => (at(k) ? top(at(k)) / metre : null);
  const band = (k, lo, hi) => mOf(k) != null && mOf(k) >= lo && mOf(k) <= hi;

  /* The room is no longer measured against her height — it is measured in
   * metres, and she is 1.7 of them. A wall is a wall whether or not a woman
   * is standing next to it. */
  ok(band('wall', 2.3, 3.1) && band('window', 2.3, 3.1),
    `walls and windows are walls and windows (wall ${mOf('wall').toFixed(2)}m, window ${mOf('window').toFixed(2)}m)`);
  ok(band('door', 2.0, 2.7), `a door is a door you walk under (${mOf('door').toFixed(2)}m)`);
  ok(band('chair', 0.7, 1.05), `a chair comes up to her thigh, not her chest (${mOf('chair').toFixed(2)}m)`);
  ok(band('table', 0.65, 1.1), `a table is a table, not a plinth (${mOf('table').toFixed(2)}m)`);
  ok(band('barrel', 0.7, 1.1) && band('chest', 0.8, 1.3),
    `a barrel and a chest are things you lean over (${mOf('barrel').toFixed(2)}m, ${mOf('chest').toFixed(2)}m)`);
  ok(mOf('stairs') == null || band('stairs', 2.3, 3.4),
    `the stairs reach the floor above (${mOf('stairs') ? mOf('stairs').toFixed(2) + 'm' : 'none in this house'})`);
  // a bookcase is allowed to stand over her — it is the furniture she does
  // not sit at. What must never happen is the old house, where a DINING
  // TABLE stood 1.2m and a column stood 1.0m.
  ok(mOf('stacked') == null || band('stacked', 1.0, 2.4),
    `a bookcase is allowed to stand over her (${mOf('stacked') ? mOf('stacked').toFixed(2) + 'm' : 'none'})`);

  /* The other half of "the sizes are wrong": a piece whose mesh is bigger or
   * smaller than the box you bump into. You see a floor you cannot walk on,
   * or walk into furniture that is not there. */
  const boxed = fit.filter((r) => (r.box.w || r.box.h) && r.solid !== false);
  const over = boxed.filter((r) => r.over > 8);
  const under = boxed.filter((r) => r.short > 20);
  ok(boxed.length > 20 && !over.length,
    `every one of the ${boxed.length} pieces you can bump into fills its box — none of them stand wider than the floor they own`);
  ok(!under.length, `and none of them leave a gap you bump into (${under.length} short)`);
  const tall = fit.length ? fit.reduce((a, r) => Math.max(a, r.tall), 0) : 0;
  ok(tall / metre < 3.6, `nothing in the house is a giant's (tallest piece ${(tall / metre).toFixed(2)}m)`);
}

async function bodySection() {
  console.log('\n---- THE BODIES (#54/#55) ----');
  const herCov = await page.evaluate(async () => {
    const V = window.__valen, g = window.__LN;
    V.render({ state: 'walk', speed: 122, stepPhase: 1.2, view: 'play', weapon: 'claw',
      angle: Math.PI / 2, world: { x: g.player.x, y: g.player.y, light: g.renderer.keyLightAt(g.player.x, g.player.y) } });
    const cv = V.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    const t = tmp.getContext('2d', { willReadFrequently: true });
    t.drawImage(cv, 0, 0);
    const d = t.getImageData(0, 0, tmp.width, tmp.height).data;
    let solid = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 240) solid++;
    return { solid: +(solid / (d.length / 4) * 100).toFixed(1), w: tmp.width, h: tmp.height };
  });
  console.log(`  her frame            ${herCov.solid}% of ${herCov.w}x${herCov.h} is body, the rest is air`);
  /* Which box the draw is sized from: the pixels that are her, or the model's
   * bind pose, which runs a fifth tall and would shrink her by that much. */
  const box = await page.evaluate(() => {
    const V = window.__valen;
    const scan = V._opaqueBox(V.canvas);
    const geo = V._bodyBox ? V._bodyBox(V.canvas) : null;
    return { scan, geo, canvas: `${V.canvas.width}x${V.canvas.height}` };
  });
  if (box.scan) console.log(`  her body in it       ${box.scan.w}x${box.scan.h}px of ${box.canvas} — measured off the pixels, not the bind pose`);

  await page.evaluate(async () => {
    const g = window.__LN;
    g.enemies.length = 0;
    const e = new window.__foes.Werewolf(g.player.x + 130, g.player.y - 10, {});
    e.state = 'idle';
    g.enemies.push(e);
  });
  await wait(2500);
  const foeCov = await page.evaluate(() => {
    const g = window.__LN, E = window.__enemy;
    const e = g.enemies[0];
    const packed = e && E.frameFor(e);
    const cv = packed && packed.frame;
    if (!cv) return null;
    const tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    const t = tmp.getContext('2d', { willReadFrequently: true });
    t.drawImage(cv, 0, 0);
    const d = t.getImageData(0, 0, tmp.width, tmp.height).data;
    let solid = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 240) solid++;
    return { solid: +(solid / (d.length / 4) * 100).toFixed(1), w: tmp.width, h: tmp.height, crop: packed.crop };
  });
  console.log(`  werewolf frame       ${foeCov ? foeCov.solid + '% of ' + foeCov.w + 'x' + foeCov.h + ' is body' : 'none'}`);
  await page.evaluate(() => { window.__LN.enemies.length = 0; });
  await wait(1200);

  /* And is a monster the size the game says it is? A body is stamped from a
   * frame with a `crop` — the part of that frame that is the creature. Crop it
   * to the bind pose and a 74px zombie comes out at 43; crop it to its own
   * silhouette every frame and it breathes as it walks. */
  const foes = await page.evaluate(async () => {
    const g = window.__LN, E = window.__enemy, H = window.__eh;
    g.enemies.length = 0;
    let i = 0;
    for (const K of ['Werewolf', 'Zombie', 'Ghoul', 'Hunter', 'Stalker', 'Crawler']) {
      if (!window.__foes[K]) continue;
      const e = new window.__foes[K](g.player.x + 110 + i * 80, g.player.y - 10, {});
      e.state = 'idle'; e.stateT = 0;
      g.enemies.push(e);
      i++;
    }
    await new Promise((r) => setTimeout(r, 2500));
    const out = [];
    for (const e of g.enemies) {
      const packed = E.frameFor(e);
      if (!packed || !packed.frame || !packed.crop) { out.push({ key: e.key, design: H[e.key] || null, drawn: null }); continue; }
      const f = packed.frame;
      const tmp = document.createElement('canvas');
      tmp.width = f.width; tmp.height = f.height;
      const t = tmp.getContext('2d', { willReadFrequently: true });
      t.drawImage(f, 0, 0);
      const d = t.getImageData(0, 0, f.width, f.height).data;
      let minY = 1e9, maxY = -1;
      for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
        if (d[(y * f.width + x) * 4 + 3] > 40) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      const scale = (H[e.key] || 74) / packed.crop.h;
      out.push({ key: e.key, design: H[e.key] || null, drawn: maxY < 0 ? null : +(((maxY - minY) * scale).toFixed(1)) });
    }
    return out;
  });
  for (const f of foes) {
    if (f.drawn == null) { console.log(`  ${f.key.padEnd(9)} — no frame`); continue; }
    console.log(`  ${String(f.key).padEnd(9)} design ${String(f.design).padStart(3)}px  drawn ${String(f.drawn).padStart(5)}px  = ${String(Math.round(f.drawn / f.design * 100)).padStart(3)}%`);
  }
  await page.evaluate(() => { window.__LN.enemies.length = 0; });
  await wait(1200);

  const ok = (b, msg) => console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}`);
  ok(herCov.solid > 1 && herCov.solid < 45, `she is cut out, not carded (${herCov.solid}% of her frame is her)`);
  ok(!!foeCov && foeCov.solid > 1 && foeCov.solid < 45,
    `and so is the thing in the room with her (${foeCov ? foeCov.solid : 'no frame'}% body)`);
  const measured = foes.filter((f) => f.drawn != null && f.design);
  ok(measured.length >= 3 && measured.every((f) => f.drawn > f.design * 0.6 && f.drawn < f.design * 1.4),
    `and each of them is the height the game gave it (${measured.map((f) => `${f.key} ${Math.round(f.drawn / f.design * 100)}%`).join(', ')})`);
  const tallest = measured.reduce((a, f) => (!a || f.drawn > a.drawn ? f : a), null);
  const lowest = measured.reduce((a, f) => (!a || f.drawn < a.drawn ? f : a), null);
  ok(!!tallest && !!lowest && tallest.drawn > lowest.drawn * 1.6,
    `the roster has a shape to it: ${tallest ? tallest.key : '?'} towers over ${lowest ? lowest.key : '?'} (${tallest ? Math.round(tallest.drawn) : 0} vs ${lowest ? Math.round(lowest.drawn) : 0}px)`);
}

async function bakeSection() {
/* -------------------------------------------------------------------------
 * THE BAKE (#53 C2) — the house lighting itself, measured on the pixels.
 *
 * Every lamp in this house is nailed down, so the light a wall stands in is
 * answered once per house and written into the instance colours. Three
 * claims, each checked against the framebuffer rather than the plan: the
 * room's instances are NOT all one colour, a wall under the chandelier is
 * brighter on screen than a wall in a corner with no lamp in it, and the
 * answer is measured once a house instead of once a frame.
 */
console.log('\n---- THE BAKE (#53 C2) ----');
const BAKE_STOPS = [
  ['main hall, under the chandelier', 620, 1000],
  ['library', 1330, 350],
  ['basement, no lamp down there', 1500, 1160],
];
const lost = await page.evaluate(() => {
  const gl = window.__env.renderer && window.__env.renderer.getContext();
  return !!(gl && gl.isContextLost && gl.isContextLost());
});
if (lost) {
  console.log('  FAIL  the WebGL context was lost before the bake could be measured — re-run');
  return;
}
const bakesBefore = await page.evaluate(() => window.__env.diagnostics().bakes);
const bakeRows = [];
for (const [name, x, y] of BAKE_STOPS) {
  await page.evaluate(([px_, py_]) => {
    const g = window.__LN;
    g.enemies.length = 0;
    // pin the rung: a headless browser is slow enough that the governor will
    // have climbed down, and then this would be measuring the governor
    g.setQuality(3);
    g.player.x = px_; g.player.y = py_; g.player.blood = g.player.bloodMax;
    g.renderer.snapCamera(px_, py_);
  }, [x, y]);
  await wait(2200);
  const m = await page.evaluate(() => {
    const E = window.__env, g = window.__LN, r = g.renderer;
    const gl = E.renderer.getContext();
    const cw = E.canvas.width, ch = E.canvas.height;
    const px = new Uint8Array(cw * ch * 4);
    // pin the rung in the same breath as the measurement: a headless browser
    // is slow enough that the governor climbs down on its own, and then this
    // would be measuring the governor instead of the bake
    g.setQuality(3);
    const drew = E.render({ camX: r.cam.x, camY: r.cam.y, zoom: r.cam.zoom, tilt: r.tilt,
      w: r.view.w, h: r.view.h, dpr: r.dpr, light: r.keyLightAt(r.cam.x, r.cam.y) });
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // the kit draws on a transparency: only its own pixels count
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue;
      sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      n++;
    }
    const d = E.diagnostics();
    return { lum: n ? sum / n : 0, covered: n, drew: !!drew, quality: d.quality,
      lit: d.lit, bake: d.bake, budget: d.budget, bakes: d.bakes };
  });
  bakeRows.push([name, m]);
  const room = m.lit && m.lit.room;
  console.log(`  ${name.padEnd(34)} on-screen lum ${m.lum.toFixed(1).padStart(5)} at rung ${m.quality}`
    + ` | room tint ${room ? `${room.min}–${room.max}` : 'none'}`);
}

// the same frame, painted flat: if the bake is doing anything you can see,
// these are two different pictures
await page.evaluate(([x, y]) => {
  const g = window.__LN;
  g.setQuality(3);
  g.player.x = x; g.player.y = y; g.renderer.snapCamera(x, y);
}, [620, 1000]);
await wait(1800);
const ab = await page.evaluate(() => {
  const E = window.__env, g = window.__LN, r = g.renderer;
  g.setQuality(3);
  const gl = E.renderer.getContext();
  const cw = E.canvas.width, ch = E.canvas.height;
  const shot = () => {
    const px = new Uint8Array(cw * ch * 4);
    E.render({ camX: r.cam.x, camY: r.cam.y, zoom: r.cam.zoom, tilt: r.tilt,
      w: r.view.w, h: r.view.h, dpr: r.dpr, light: r.keyLightAt(r.cam.x, r.cam.y) });
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const A = shot();
  E.flatTint(true);
  const B = shot();
  E.flatTint(false);
  shot();
  let diff = 0, big = 0, n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (A[i + 3] < 8 && B[i + 3] < 8) continue;
    const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
    const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
    const d = Math.abs(la - lb);
    diff += d; if (d > 8) big++; n++;
  }
  return { diff: n ? diff / n : 0, pct: n ? (big / n) * 100 : 0, n };
});
console.log(`  ${'bake vs the same room painted flat'.padEnd(34)} mean |diff| ${ab.diff.toFixed(1)} over ${ab.n} px, ${ab.pct.toFixed(1)}% of them changed`);

const byLum = bakeRows.slice().sort((a, b) => b[1].lum - a[1].lum);
const lit = byLum[0][1], dark = byLum[byLum.length - 1][1];
const bakesAfter = await page.evaluate(() => window.__env.diagnostics().bakes);
const ok = (b, msg) => console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}`);
ok(!!(lit.lit && lit.lit.room) && lit.lit.room.max - lit.lit.room.min > 0.15,
  `the room is lit by the house, not by a constant (room tint ${lit.lit.room.min}–${lit.lit.room.max})`);
ok(bakeRows.every(([, m]) => m.quality === 3) && lit.covered > 1000 && dark.covered > 1000 && lit.lum > dark.lum * 1.05,
  `and the brightest room reads brighter on screen than the darkest (${byLum[0][0]} ${lit.lum.toFixed(1)} vs ${byLum[byLum.length - 1][0]} ${dark.lum.toFixed(1)})`);
ok(ab.pct > 5, 'and the bake is visible: repainting the room changes the picture');
ok(bakesAfter === bakesBefore,
  `measured once a house, not once a frame (${bakesBefore} bakes across ${BAKE_STOPS.length} stops and ~8s of play)`);
ok(lit.budget.fits,
  `inside the mobile budget (${lit.budget.instances} instances in ${lit.budget.meshes} draw calls)`);
ok(lit.bake.ms <= 24, `and the bake itself costs less than a frame (${lit.bake.ms}ms)`);
}

const ONLY = (process.argv[2] || '').toLowerCase();

if (ONLY === 'bake') {
  await bakeSection();
  await sizeSection();
  await bodySection();
  await browser.close();
  server.kill('SIGTERM');
  process.exit(0);
}
// `node tools/envqa.mjs plates` — just the photographed rooms, ~2 minutes.
if (ONLY === 'plates') {
  await roomBuildSection();
  await browser.close();
  server.kill('SIGTERM');
  process.exit(0);
}
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

/* ---------- the room is built, not photographed ----------
 * Eleven rooms, and every one of them is made of pieces: floor slabs cut to
 * the nav grid, wall panels off the wall solids, corners, windows, doors and
 * furniture — all instanced from assets/env-kit/*.glb. It is what lets the
 * house be rebuilt, piece for piece, in any engine that can read a GLB.
 *
 * A photograph was draped over all of it once (64bc927), as a tint at alpha
 * 0.85. The house was already standing underneath; the picture just buried
 * it, and a room built from assets became a room that was one asset. This is
 * the check that would have refused that, and now does:
 *
 *   1. no room carries a photograph — the field is gone, not unused;
 *   2. every room has a floor and walls FROM THE KIT, counted instance by
 *      instance inside its own rect, which a photograph cannot fake;
 *   3. take the kit away and the room has to go with it.
 */
async function roomBuildSection() {
  const ok = (b, msg) => console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}`);
  console.log('\n---- THE ROOM IS BUILT (and no room is a photograph) ----');
  const rooms = await page.evaluate(() => window.__LN.mansion.roomList.map((r) => ({
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, plate: r.plate,
  })));
  ok(rooms.every((r) => !r.plate),
    `no room wears a photograph (${rooms.filter((r) => r.plate).length} of ${rooms.length} still do)`);

  /* Instance by instance, inside each room's own rect — walls stand ON the
   * edge of it, so the wall family is counted in a band around the room. */
  const census = await page.evaluate((rs) => {
    const E = window.__env;
    /* Keyed by the bin the builder filled, not by the piece file it reads:
     * the floors are 'wood' and 'stone', the standing pieces are 'wall',
     * 'cracked', 'corner', 'window' and 'windowBroken'. Doors are not in
     * here at all — they live in EnvKit.doors, one group per opening. */
    const FLOORS = ['wood', 'stone'];
    const WALLS = ['wall', 'cracked', 'corner', 'window', 'windowBroken'];
    const out = [];
    for (const r of rs) {
      const counts = {};
      for (const group of [E.roomMeshes, E.propMeshes, E.fortressMeshes]) {
        for (const key of Object.keys(group || {})) {
          const list = group[key] && group[key].userData && group[key].userData.placements;
          if (!list) continue;
          for (const p of list) {
            const inX = p.x >= r.x && p.x <= r.x + r.w;
            const inZ = p.z >= r.y && p.z <= r.y + r.h;
            const band = p.x >= r.x - 60 && p.x <= r.x + r.w + 60
              && p.z >= r.y - 60 && p.z <= r.y + r.h + 60;
            if (!(WALLS.includes(key) ? band : (inX && inZ))) continue;
            counts[key] = (counts[key] || 0) + 1;
          }
        }
      }
      const sum = (keys) => keys.reduce((a, k) => a + (counts[k] || 0), 0);
      out.push({
        id: r.id,
        floor: sum(FLOORS),
        walls: sum(WALLS),
        props: Object.keys(counts).filter((k) => !WALLS.includes(k) && !FLOORS.includes(k))
          .reduce((a, k) => a + counts[k], 0),
      });
    }
    return out;
  }, rooms);
  for (const c of census) {
    console.log(`        ${c.id.padEnd(12)} floor ${String(c.floor).padStart(3)}   wall ${String(c.walls).padStart(3)}   furniture ${c.props}`);
  }
  const bare = census.filter((c) => c.floor < 4 || c.walls < 4);
  ok(bare.length === 0,
    `every room is built out of kit pieces on its own floor plan (${census.length - bare.length}/${census.length})`
    + `${bare.length ? ` — thin: ${bare.map((c) => c.id).join(', ')}` : ''}`);
  const unfurnished = census.filter((c) => c.props < 1);
  console.log(`  ${unfurnished.length ? 'note' : 'ok  '}  ${census.length - unfurnished.length}/${census.length} rooms carry furniture from the kit`
    + `${unfurnished.length ? ` (bare: ${unfurnished.map((c) => c.id).join(', ')})` : ''}`);

  /* Take the kit away and the room has to go with it. A room that is a
   * picture survives this; a room that is pieces does not. */
  const rows = [];
  for (const room of rooms) {
    /* eslint-disable no-await-in-loop */
    const m = await page.evaluate((rm) => {
      const g = window.__LN;
      const shot = () => {
        g.render();
        const c = g.renderer.canvas;
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      g.screen = 'playing'; g.time = 30; g.enemies.length = 0;
      g.player.x = rm.x + rm.w / 2; g.player.y = rm.y + rm.h / 2;
      g.renderer.snapCamera(rm.x + rm.w / 2, rm.y + rm.h / 2);
      window.__env.group.visible = true;
      const A = shot();
      window.__env.group.visible = false;
      const B = shot();
      window.__env.group.visible = true;
      let sq = 0, n = 0;
      for (let i = 0; i < A.length; i += 16) {
        const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
        const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
        const d = la - lb; sq += d * d; n++;
      }
      return { rms: Math.sqrt(sq / n) };
    }, room);
    rows.push([room.id, m.rms]);
  }
  const weakest = rows.slice().sort((a, b) => a[1] - b[1])[0];
  const standing = rows.filter(([, rms]) => rms >= 6);
  console.log(`        the kit owns this much of the picture (RMS with it hidden): `
    + rows.map(([id, rms]) => `${id} ${rms.toFixed(1)}`).join('  '));
  ok(standing.length === rows.length,
    `the room IS the kit — hide it and every room goes with it (${standing.length}/${rows.length}, weakest ${weakest[0]} at ${weakest[1].toFixed(1)})`);
}

/* `node tools/envqa.mjs --mode=room` runs the one section, for the ten
 * seconds it takes to answer "is this room built or is it a picture". */
if (MODE === 'room') {
  await roomBuildSection();
  await browser.close();
  server.kill('SIGTERM');
  process.exit(0);
}
if (MODE !== 'siege') {
  console.log('\n---- THE BAKE (#53 C2) ----');
  await bakeSection();
  await sizeSection();
  await bodySection();
  await roomBuildSection();
}
await siegeSection();

await browser.close();
server.kill('SIGTERM');
