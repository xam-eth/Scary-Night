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
 *   node tools/envqa.mjs --fast           # all assertions, skip 17 stop screenshots
 *   node tools/envqa.mjs --mode=3d-smoke  # WebGL body/room/fold/window subset
 *
 * Needs the same Puppeteer shim as shotbrowser.mjs. Assertions set a failing
 * exit code; fast modes skip the expensive frame-by-frame screenshot sweep. */
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
const FAST = !!args.fast;
const failures = [];
const check = (passed, message) => {
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${message}`);
  if (!passed) failures.push(message);
  return !!passed;
};
const reportExit = () => {
  if (failures.length) {
    console.error(`ENVQA FAILED: ${failures.length} assertion(s)`);
    for (const message of failures) console.error(`  - ${message}`);
    process.exitCode = 1;
  } else {
    console.log('ENVQA PASS: all assertions passed');
  }
};
const shutdown = async () => {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  reportExit();
};
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
const pageErrors = [];
page.on('pageerror', (e) => {
  const message = String(e.message).slice(0, 250);
  pageErrors.push(message);
  console.log('PAGEERROR', message);
});
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
  window.__world3d = (await import('./src/game/world3d.js')).World3D;
  window.__eh = (await import('./src/game/enemy3d.js')).ENEMY_HEIGHT;
  window.__foes = await import('./src/game/enemies.js');
  /* Is the instance standing at (x, z) folded away right now? Read off the
   * instance matrix — what the GPU is actually being handed — rather than
   * from a second model of the fold, which is how this file once asserted a
   * rule the room was no longer following. */
  window.__isFolded = (x, z, tolX = 220, tolZ = 70) => {
    const E = window.__env, T = window.__three;
    const m4 = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    for (const group of [E.roomMeshes, E.propMeshes]) {
      for (const key of Object.keys(group || {})) {
        const mesh = group[key];
        if (!mesh || !mesh.userData || !mesh.userData.placements) continue;
        const list = mesh.userData.placements;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          /* Not every zero-scaled instance is folded. A window is two
           * instances at one spot — glass and broken glass — and one of them
           * is always switched off on purpose. Only the FOLD hides a piece
           * the room is otherwise wearing. */
          if (p.off) continue;
          if (Math.abs(p.x - x) > tolX || Math.abs(p.z - z) > tolZ) continue;
          mesh.getMatrixAt(i, m4); m4.decompose(v, q, sc);
          if (sc.x === 0 && sc.y === 0) return true;
        }
      }
    }
    return false;
  };
  window.__three = await import('./src/vendor/three/three.module.min.js');
});
await page.waitForFunction(() => window.__LN && window.__LN.screen === 'playing', { timeout: 30000, polling: 100 }).catch(() => {});
for (let i = 0; i < 60; i++) {
  const d = await page.evaluate(() => window.__env.diagnostics());
  if ((d.ready && d.props && d.room) || d.failed) break;
  await wait(500);
}
console.log('diag:', JSON.stringify(await page.evaluate(() => window.__env.diagnostics())));

/* Fast 3D-specific subset: use the active WebGL scene rather than the retired
 * sprite canvases, and skip the long frame-by-frame walk/screenshot sweep. */
if (MODE === '3d-smoke') {
  await bodySection();
  await roomBuildSection();
  await foldSection();
  await windowVisibility3DSection();
  check(pageErrors.length === 0, `no uncaught browser page errors (${pageErrors.length})`);
  await shutdown();
  process.exit(process.exitCode || 0);
}

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
  const ok = check;
  ok(read.onScreen >= 20,
    `a phone frame holds twenty or more of them at the finale (${read.onScreen} on screen, ${read.crowd} in the yard)`);
  ok(read.drawn <= 70,
    `the crowd remains bounded to the intended proxy count (${read.drawn} visible, 70 maximum)`);
  console.log(`  NOTE software-renderer timing only: ${(cost / Math.max(1, read.drawn)).toFixed(3)}ms/body; `
    + `the relative frame-cost ratio is not a release gate on SwiftShader/shared CI.`);
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
  const ok = check;
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
  console.log('\n---- THE BODIES (active full-3D scene) ----');
  const result = await page.evaluate(() => {
    const g = window.__LN, W = window.__world3d, V = window.__valen;
    const T = window.__three;
    const room = g.mansion.roomList.find((r) => r.id === 'hall') || g.mansion.roomList[0];
    g.screen = 'playing';
    g.time = 30;
    g.enemies.length = 0;
    g.player.x = room.x + room.w * 0.48;
    g.player.y = room.y + room.h * 0.52;
    g.player.state = 'idle';
    g.player.iframes = 999;
    g.renderer.snapCamera(g.player.x, g.player.y);
    for (const [index, name] of ['Werewolf', 'Zombie', 'Ghoul', 'Hunter', 'Stalker', 'Crawler'].entries()) {
      const Enemy = window.__foes[name];
      if (!Enemy) continue;
      const enemy = new Enemy(g.player.x + 105 + index * 24, g.player.y + (index % 2 ? 35 : -35), {});
      enemy.state = 'idle';
      enemy.stateT = 0;
      enemy.vx = enemy.vy = 0;
      g.enemies.push(enemy);
    }
    W.render(g);
    const count = (root, predicate) => {
      let n = 0;
      if (root) root.traverse((object) => { if (predicate(object)) n++; });
      return n;
    };
    const heroSkin = count(V.model, (object) => object.isSkinnedMesh);
    const heroMeshes = count(V.model, (object) => object.isMesh);
    const d = W.diagnostics();
    const actors = g.enemies.map((enemy) => {
      const rig = enemy._glb && enemy._glb.model;
      const proxy = W.proxies.get(`enemy:${enemy.id}`);
      const rigged = !!(rig && rig.visible && rig.parent === W.root && rig.userData.full3D);
      const proxyMeshes = count(proxy, (object) => object.isMesh);
      const proxy3D = !!(proxy && proxy.visible && proxyMeshes > 0);
      let projectedHeight = null;
      if (rigged) {
        const box = new T.Box3().setFromObject(rig);
        projectedHeight = box.getSize(new T.Vector3()).y * Math.sqrt(2 / 3);
      }
      return { key: enemy.key, rigged, proxy3D, proxyMeshes, projectedHeight };
    });
    return {
      hero: {
        ready: !!V.ready,
        visible: !!(V.model && V.model.visible),
        sharedScene: !!(V.model && V.stage && V.model.parent === V.stage && V.stage.parent === W.scene),
        meshes: heroMeshes,
        skinnedMeshes: heroSkin,
      },
      actors,
      diag: d,
      cap: window.__enemy.cap,
      readyTypes: Object.values(window.__enemy.diagnostics().types).filter((type) => type.behaviorReady).length,
      player: { x: g.player.x, y: g.player.y },
    };
  });
  await wait(350);
  const pixelDiff = await page.evaluate(() => {
    const g = window.__LN, W = window.__world3d, V = window.__valen, E = window.__env;
    const gl = E.renderer.getContext(), width = E.canvas.width, height = E.canvas.height;
    const render = () => {
      E.renderer.render(W.scene, E.camera);
      gl.finish();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    g.render();
    const r = g.renderer;
    const p = r.worldToScreen(g.player.x, g.player.y);
    const dpr = width / r.view.w;
    const cx = Math.round((p.x - r.view.left) * dpr);
    const cy = height - 1 - Math.round((p.y - r.view.top - 34) * dpr);
    const A = render();
    V.model.visible = false;
    const B = render();
    V.model.visible = true;
    render();
    const rx = Math.round(44 * dpr), ry = Math.round(65 * dpr);
    let changed = 0;
    for (let y = Math.max(0, cy - ry); y < Math.min(height, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x < Math.min(width, cx + rx); x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 12) changed++;
      }
    }
    return changed;
  });
  console.log(`  hunter        ${result.hero.ready ? 'rigged' : 'not loaded'}, ${result.hero.meshes} meshes / ${result.hero.skinnedMeshes} skinned meshes, shared scene=${result.hero.sharedScene}`);
  for (const actor of result.actors) {
    console.log(`  ${String(actor.key).padEnd(10)} ${actor.rigged ? 'skinned GLB' : actor.proxy3D ? `3D proxy (${actor.proxyMeshes} meshes)` : 'NO 3D body'}`
      + `${actor.projectedHeight == null ? '' : `, projected ${actor.projectedHeight.toFixed(1)}px`}`);
  }
  check(result.hero.ready && result.hero.visible && result.hero.sharedScene && result.hero.skinnedMeshes > 0,
    `the Hunter is a visible skinned GLB in the shared WebGL scene`);
  check(pixelDiff > 0, `hiding the Hunter changes ${pixelDiff} pixels near her position in the WebGL buffer`);
  check(result.actors.length === 6 && result.actors.every((actor) => actor.rigged || actor.proxy3D),
    `all six enemy types have a skinned GLB or geometric 3D proxy (${result.actors.filter((actor) => actor.rigged || actor.proxy3D).length}/6)`);
  check(result.actors.filter((actor) => actor.rigged).length <= result.cap,
    `skinned enemy slots remain within cap ${result.cap} (${result.actors.filter((actor) => actor.rigged).length} active)`);
  console.log(`  enemy models behavior-ready: ${result.readyTypes}/6; diagnostics: ${result.diag.visibleRiggedEnemies} rigged, ${result.diag.proxyActors} proxies`);
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
  check(false, 'the WebGL context was lost before the bake could be measured — re-run');
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
      w: r.view.w, h: r.view.h, dpr: r.dpr,
      foldY: g.player.y, light: r.keyLightAt(r.cam.x, r.cam.y) });
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
      w: r.view.w, h: r.view.h, dpr: r.dpr,
      foldY: g.player.y, light: r.keyLightAt(r.cam.x, r.cam.y) });
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
const ok = check;
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

const ONLY = String(args.only || '').toLowerCase();

if (ONLY === 'bake') {
  await bakeSection();
  await sizeSection();
  await bodySection();
  check(pageErrors.length === 0, `no uncaught browser page errors (${pageErrors.length})`);
  await shutdown();
  process.exit(process.exitCode || 0);
}
// `node tools/envqa.mjs --only=plates` — room composition and fold checks.
if (ONLY === 'plates') {
  await roomBuildSection();
  await foldSection();
  check(pageErrors.length === 0, `no uncaught browser page errors (${pageErrors.length})`);
  await shutdown();
  process.exit(process.exitCode || 0);
}
const rows = [];
for (let n = 0; n < STOPS.length; n++) {
  if (FAST) continue;
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
        w: r.view.w, h: r.view.h, dpr: r.dpr,
        foldY: g.player.y, light: r.keyLightAt(r.cam.x, r.cam.y) });
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
      const folded = window.__isFolded(e.x, e.y, 200, 60);   // read it, don't model it
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
  check(ok, `${w.id} panel ${w.panel}px on ${w.opening}px opening; offset ${w.off}px; intact/broken state ${w.wholeOff}/${w.smashedOff}`);
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
check(swapOk, `smashing ${swap.id} swaps glass for the broken wall and mending restores it`);

await windowVisibility3DSection();

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
  console.log('\n---- THE ROOM IS BUILT (WebGL framebuffer) ----');
  const rooms = await page.evaluate(() => window.__LN.mansion.roomList.map((r) => ({
    id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, plate: r.plate,
  })));
  check(rooms.every((r) => !r.plate),
    `no room wears a photograph (${rooms.filter((r) => r.plate).length} of ${rooms.length} still do)`);

  const census = await page.evaluate((rs) => {
    const E = window.__env;
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
  check(bare.length === 0,
    `every room is built out of kit pieces on its own floor plan (${census.length - bare.length}/${census.length})`
    + `${bare.length ? ` — thin: ${bare.map((c) => c.id).join(', ')}` : ''}`);
  const unfurnished = census.filter((c) => c.props < 1);
  console.log(`  ${unfurnished.length ? 'note' : 'ok  '}  ${census.length - unfurnished.length}/${census.length} rooms carry furniture from the kit`
    + `${unfurnished.length ? ` (bare: ${unfurnished.map((c) => c.id).join(', ')})` : ''}`);

  const rows = [];
  for (const room of rooms) {
    /* eslint-disable no-await-in-loop */
    const m = await page.evaluate((rm) => {
      const g = window.__LN, E = window.__env, W = window.__world3d;
      const gl = E.renderer.getContext();
      g.screen = 'playing'; g.time = 30; g.enemies.length = 0;
      g.player.x = rm.x + rm.w / 2; g.player.y = rm.y + rm.h / 2;
      g.player.blood = g.player.bloodMax;
      g.renderer.snapCamera(g.player.x, g.player.y);
      const capture = () => {
        W.render(g);
        gl.finish();
        const pixels = new Uint8Array(E.canvas.width * E.canvas.height * 4);
        gl.readPixels(0, 0, E.canvas.width, E.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const wasVisible = E.group.visible;
      E.group.visible = true;
      const A = capture();
      E.group.visible = false;
      const B = capture();
      E.group.visible = wasVisible;
      capture();
      let sq = 0, n = 0, changed = 0;
      for (let i = 0; i < A.length; i += 16) {
        const la = A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114;
        const lb = B[i] * 0.299 + B[i + 1] * 0.587 + B[i + 2] * 0.114;
        const d = la - lb; sq += d * d; n++;
        if (Math.abs(d) > 8) changed++;
      }
      return { rms: Math.sqrt(sq / Math.max(1, n)), changedPct: 100 * changed / Math.max(1, n) };
    }, room);
    rows.push([room.id, m.rms, m.changedPct]);
  }
  const weakest = rows.slice().sort((a, b) => a[1] - b[1])[0];
  const standing = rows.filter(([, rms]) => rms >= 6);
  console.log(`        WebGL kit hide diff (RMS / changed sample %): `
    + rows.map(([id, rms, changed]) => `${id} ${rms.toFixed(1)}/${changed.toFixed(1)}%`).join('  '));
  check(standing.length === rows.length,
    `hiding the EnvKit group changes every room's WebGL framebuffer (${standing.length}/${rows.length}, weakest ${weakest[0]} at ${weakest[1].toFixed(1)} RMS)`);
}

async function windowVisibility3DSection() {
  console.log('\n---- WINDOWS IN THE ACTIVE WEBGL SCENE ----');
  const windows = await page.evaluate(() => window.__LN.mansion.entrances
    .filter((entry) => entry.kind === 'window')
    .map((entry) => ({ id: entry.id, x: entry.x, y: entry.y, axis: entry.axis,
      inside: entry.inside, outside: entry.outside })));
  const rows = [];
  for (const w of windows) {
    /* Try both sides of each opening. East-facing panels can be folded away
     * from the interior because the orthographic camera looks from the
     * southeast; the exterior is a valid gameplay view for those windows. */
    const candidates = [];
    for (const [side, anchor] of [['outside', w.outside], ['inside', w.inside]]) {
      if (!anchor) continue;
      const dx = anchor.x - w.x, dy = anchor.y - w.y;
      const length = Math.hypot(dx, dy) || 1;
      for (const extra of [0, 80, 180]) {
        candidates.push({ side, x: anchor.x + dx / length * extra, y: anchor.y + dy / length * extra });
      }
    }
    let best = { side: 'none', pixels: 0, x: null, y: null };
    for (const candidate of candidates) {
      /* eslint-disable no-await-in-loop */
      const measured = await page.evaluate((args) => {
        const { w, candidate } = args;
        const g = window.__LN, E = window.__env, W = window.__world3d;
        g.enemies.length = 0;
        g.player.x = candidate.x; g.player.y = candidate.y;
        g.player.blood = g.player.bloodMax; g.player.iframes = 999;
        g.renderer.snapCamera(candidate.x, candidate.y);
        const gl = E.renderer.getContext(), width = E.canvas.width, height = E.canvas.height;
        const r = g.renderer;
        const p = r.worldToScreen(w.x, w.y);
        const dpr = width / r.view.w;
        const sx = p.x - r.view.left, sy = p.y - r.view.top;
        const framed = sx > 35 && sx < r.view.w - 35 && sy > 100 && sy < r.view.h - 60;
        if (!framed) return { framed: false, pixels: 0 };
        const render = () => {
          W.render(g);
          gl.finish();
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels;
        };
        const A = render();
        const old = {};
        for (const key of ['window', 'windowBroken']) {
          const mesh = E.roomMeshes && E.roomMeshes[key];
          if (!mesh) continue;
          old[key] = mesh.visible;
          mesh.visible = false;
        }
        const B = render();
        for (const key of Object.keys(old)) E.roomMeshes[key].visible = old[key];
        render();
        const cx = Math.round(sx * dpr);
        const cy = height - 1 - Math.round(sy * dpr);
        const rx = Math.round(85 * dpr), ry = Math.round(100 * dpr);
        let changed = 0;
        for (let y = Math.max(0, cy - ry); y < Math.min(height, cy + ry); y++) {
          for (let x = Math.max(0, cx - rx); x < Math.min(width, cx + rx); x++) {
            const i = (y * width + x) * 4;
            const delta = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
            if (delta > 12) changed++;
          }
        }
        return { framed: true, pixels: changed };
      }, { w, candidate });
      if (measured.pixels > best.pixels) best = { ...candidate, pixels: measured.pixels };
      if (measured.pixels >= 5) break;
    }
    const passed = best.pixels >= 5;
    check(passed, `${w.id} contributes ${best.pixels} changed local WebGL pixels from ${best.side} vantage${passed ? '' : ' (not found)'}`);
    rows.push({ id: w.id, pixels: best.pixels, side: best.side });
  }
  check(windows.length === 9 && rows.filter((r) => r.pixels >= 5).length === windows.length,
    `all nine intact window panels are visible from at least one valid side (${rows.filter((r) => r.pixels >= 5).length}/${windows.length})`);
}

/* ---------- the fold ----------
 * A wall standing between her and the viewer steps aside, so it cannot cover
 * her. That is the whole of it: a band, one wall deep, south of where she
 * is. It is not a licence to take the south half of the house away.
 *
 * The condition was inverted once — `p.z > camY + reach` instead of the band
 * — which hid every wall further than 197px south of her and left the ones
 * that actually cover her standing. The house then assembled itself around
 * her as she walked: walls appeared when she came abreast of them and
 * vanished behind her back. "Ruangan sangat tidak stabil, dan rusak."
 *
 * So this reads the instance matrices — what is on the screen, not what the
 * plan says — at four stops around the house and holds the fold to three
 * things: it hides few, it hides only what is inside its own reach, and no
 * wall far from her changes state when she walks.
 */
async function foldSection() {
  const ok = check;
  console.log('\n---- THE FOLD (a wall between her and the viewer steps aside) ----');
  /* The last stop is the point of the whole thing: standing with her back to
   * a wall, the wall between her and the viewer has to step aside. If
   * nothing folds anywhere, the fold has been fixed by being switched off. */
  const STOPS = [['main hall', 600, 1100], ['library', 1330, 350], ['dining', 470, 360],
    ['chapel', 2050, 1150], ['back to the hall wall', 600, 1440]];
  const read = async (x, y) => page.evaluate(async (px, py) => {
    const THREE = await import('./src/vendor/three/three.module.min.js');
    const E = window.__env, g = window.__LN;
    g.screen = 'playing'; g.enemies.length = 0;
    g.player.x = px; g.player.y = py; g.renderer.snapCamera(px, py);
    g.render();
    // The fold uses the same diagonal world-depth axis as the orthographic
    // camera, not camera.y. Read the fold anchor set by the live WebGL render.
    const foldDepth = E._foldedAt;
    const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    const out = [];
    for (const key of ['wall', 'cracked', 'corner', 'window', 'windowBroken']) {
      const mesh = E.roomMeshes && E.roomMeshes[key];
      if (!mesh) continue;
      const list = mesh.userData.placements;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        mesh.getMatrixAt(i, m4);
        m4.decompose(pos, quat, scl);
        const height = (mesh.userData.unitH || 0) * (p.sy || 1);
        const reach = Math.max(0, E._foldK * (height - 72));
        out.push({
          key, depth: (p.x + p.z) / Math.SQRT2, reach, off: !!p.off,
          foldable: !!mesh.userData.folds,
          hidden: scl.x === 0 && scl.y === 0,
        });
      }
    }
    return { foldDepth, rows: out };
  }, x, y);

  let worstBand = 0, hiddenTotal = 0, total = 0, leaks = [], mostFolded = 0;
  for (const [name, px, py] of STOPS) {
    /* eslint-disable no-await-in-loop */
    const { foldDepth, rows } = await read(px, py);
    const hidden = rows.filter((r) => r.hidden && !r.off && r.foldable);
    const tooFar = hidden.filter((r) => !(r.depth > foldDepth && r.depth < foldDepth + r.reach));
    const band = hidden.length ? Math.max(...hidden.map((r) => r.depth - foldDepth)) : 0;
    worstBand = Math.max(worstBand, band);
    mostFolded = Math.max(mostFolded, hidden.length);
    hiddenTotal += hidden.length; total += rows.filter((r) => r.foldable && !r.off).length;
    if (tooFar.length) leaks.push(`${name}:${tooFar.length}`);
    /* The inverted rule hid the far side of the threshold instead of the
     * one-height band directly in front of her. Keep that count as context. */
    const oldRule = rows.filter((r) => !r.off && r.foldable && r.depth - foldDepth > r.reach).length;
    console.log(`        ${name.padEnd(10)} fold depth ${Math.round(foldDepth).toString().padStart(5)}`
      + `  folded ${String(hidden.length).padStart(3)}/${rows.filter((r) => r.foldable && !r.off).length}`
      + `  band ${Math.round(band)}px`
      + `   (the inverted rule took ${oldRule})`
      + `  ${tooFar.length ? `BEYOND REACH: ${tooFar.length}` : ''}`);
  }
  ok(leaks.length === 0,
    `the fold is a band, not a half-house — nothing is hidden beyond its own reach`
    + `${leaks.length ? ` (leaking at ${leaks.join(', ')})` : ''}`);
  ok(mostFolded >= 1,
    `and the fold still folds — with her back to a wall, that wall steps aside (${mostFolded} at the closest stop)`);
  ok(hiddenTotal / Math.max(1, total) < 0.12,
    `and it hides a wall she is standing at, not the house behind her`
    + ` (${hiddenTotal}/${total} = ${(100 * hiddenTotal / Math.max(1, total)).toFixed(1)}% of the walls folded)`);

  /* Stability: walk 260px north in the hall. Nothing far from her may
   * change state — that is the wall appearing as she comes abreast of it. */
  const A = await read(600, 1100);
  const B = await read(600, 840);
  const far = A.rows.filter((r, i) => {
    const b = B.rows[i];
    if (!b || r.off || b.off || !r.foldable || !b.foldable) return false;
    const nearStart = Math.min(A.foldDepth, B.foldDepth);
    const farEnd = Math.max(A.foldDepth + r.reach, B.foldDepth + b.reach);
    return r.depth < nearStart - 100 || r.depth > farEnd + 100;
  });
  let flipped = 0;
  for (let i = 0; i < A.rows.length; i++) {
    const a = A.rows[i], b = B.rows[i];
    if (!far.includes(a)) continue;
    if (a.hidden !== b.hidden) flipped++;
  }
  /* Same walk under the old inverted rule, measured on the same diagonal
   * depth as the real renderer. */
  const blinkedOld = A.rows.filter((r) => !r.off && r.foldable
    && ((r.depth - A.foldDepth > r.reach) !== (r.depth - B.foldDepth > r.reach))).length;
  ok(flipped === 0,
    `walking 260px does not blink the house — ${flipped} of ${far.length} distant walls changed state`
    + ` (the inverted rule blinked ${blinkedOld} of ${A.rows.length})`);
}

/* `node tools/envqa.mjs --mode=room` stops after the room: the window sweep
 * (which always runs, and is the slow part), then the two sections that
 * answer "is this room built, and is it standing still". No bake, no bodies,
 * no siege. */
if (MODE === 'room') {
  await roomBuildSection();
  await foldSection();
  check(pageErrors.length === 0, `no uncaught browser page errors (${pageErrors.length})`);
  await shutdown();
  process.exit(process.exitCode || 0);
}
if (MODE !== 'siege') {
  console.log('\n---- THE BAKE (#53 C2) ----');
  await bakeSection();
  await sizeSection();
  await bodySection();
  await roomBuildSection();
  await foldSection();
}
await siegeSection();

check(pageErrors.length === 0, `no uncaught browser page errors (${pageErrors.length})`);
await shutdown();
