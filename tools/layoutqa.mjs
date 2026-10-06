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
const browserErrors = [];
page.on('pageerror', (e) => {
  browserErrors.push(`page: ${e.message}`);
  console.log('PAGEERROR', String(e.message).slice(0, 200));
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    browserErrors.push(`console: ${message.text()}`);
    console.log('CONSOLE ERROR', String(message.text()).slice(0, 200));
  }
});

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
  // Catch regressions where the old Canvas room renderer starts painting the
  // playfield under the WebGL scene again.
  window.__legacyWorldDrawCalls = 0;
  const proto = Object.getPrototypeOf(g.mansion);
  for (const name of ['drawFloor', 'drawProps', 'drawFurniture']) {
    const old = proto[name];
    proto[name] = function (...args) {
      window.__legacyWorldDrawCalls++;
      return old.apply(this, args);
    };
  }
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
      foeReady: !!(N && Object.keys(N.types || {}).length
        && Object.values(N.types || {}).every((r) => r && r.behaviorReady)),
    };
  });
  const t = Date.now() - tNight;
  if (!seen.screen && s.screen === 'playing') { seen.screen = t; console.log(`night on screen          ${t} ms`); }
  if (!seen.room && s.room) { seen.room = t; console.log(`room built               ${t} ms`); }
  if (!seen.props && s.props) { seen.props = t; console.log(`furniture placed         ${t} ms`); }
  if (!seen.bake && s.bake) { seen.bake = t; console.log(`light baked              ${t} ms`); }
  if (s.foeTypes && s.foeReady && !seen.foes) { seen.foes = t; console.log(`all ${s.foeTypes} enemy rigs ready    ${t} ms`); }
  if (seen.screen && seen.room && seen.props && seen.bake && seen.foes) break;
  await wait(120);
}
for (const k of ['screen', 'room', 'props', 'bake', 'foes']) if (seen[k] == null) console.log(`${k.padEnd(24)} NEVER`);

/* ---------- full-3D migration gate ---------- */
const world3d = await page.evaluate(async () => {
  const world = window.__LN_API.world3d();
  const game = window.__LN;
  const env = window.__env;
  const THREE = await import('./src/vendor/three/three.module.min.js');
  const points = [
    [game.player.x, game.player.y],
    [game.player.x + 200, game.player.y],
    [game.player.x, game.player.y + 200],
    [game.player.x - 240, game.player.y + 160],
    [700, 300],
  ];
  const errors = points.map(([x, z]) => {
    const p = new THREE.Vector3(x, 0, z).project(env.camera);
    const sx = (p.x * 0.5 + 0.5) * env.canvas.width / game.renderer.dpr;
    const sy = (1 - (p.y * 0.5 + 0.5)) * env.canvas.height / game.renderer.dpr;
    const expected = game.renderer.worldToScreen(x, z);
    return Math.hypot(sx - expected.x - game.renderer.cam.sx, sy - expected.y - game.renderer.cam.sy);
  });
  return {
    world,
    projectionMaxError: Math.max(...errors),
    legacyWorldDrawCalls: window.__legacyWorldDrawCalls || 0,
    overlayAlpha: document.getElementById('game').getContext('2d').getContextAttributes().alpha,
    stageMode: document.getElementById('stage').dataset.renderMode,
  };
});
const full3DPass = world3d.world.mode === 'webgl-3d'
  && world3d.world.fullScene
  && world3d.world.rooms === 11
  && world3d.world.portals === 26
  && world3d.world.roomInstances && world3d.world.roomInstances.floor > 0
  && world3d.world.roomInstances.walls > 0
  && world3d.world.riggedPlayer
  && world3d.world.roomMarks3D === 9
  && world3d.world.decalsMapped
  && world3d.overlayAlpha
  && world3d.stageMode === 'webgl-3d'
  && world3d.legacyWorldDrawCalls === 0
  && world3d.projectionMaxError < 2;
console.log(`\n---- FULL 3D WORLD GATE: ${full3DPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  renderer=${world3d.world.mode}, orthographic=${world3d.world.fullScene}, rooms=${world3d.world.rooms}, portals=${world3d.world.portals}`);
console.log(`  room meshes=${JSON.stringify(world3d.world.roomInstances)}, rigged player=${world3d.world.riggedPlayer}, 3D room marks=${world3d.world.roomMarks3D}, decals mapped=${world3d.world.decalsMapped}`);
console.log(`  Canvas overlay alpha=${world3d.overlayAlpha}, camera projection max error=${world3d.projectionMaxError.toFixed(4)}px, legacy Canvas world draw calls=${world3d.legacyWorldDrawCalls}`);
if (!full3DPass) process.exitCode = 1;

/* ---------- gameplay objects and controls stay live in the 3D scene ---------- */
const beforeMove = await page.evaluate(() => [window.__LN.player.x, window.__LN.player.y]);
await page.evaluate(() => window.__LN_API.hold('right', true));
await wait(500);
await page.evaluate(() => window.__LN_API.hold('right', false));
const movementDistance = await page.evaluate((start) => Math.hypot(window.__LN.player.x - start[0], window.__LN.player.y - start[1]), beforeMove);
const movementPass = movementDistance > 8;
console.log(`\n---- GAMEPLAY CONTROL: ${movementPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  keyboard movement=${movementDistance.toFixed(1)} world px`);
if (!movementPass) process.exitCode = 1;

const testDoorId = await page.evaluate(() => {
  const g = window.__LN;
  const door = g.mansion.entrances
    .filter((item) => item.kind === 'door' && !item.broken && !item.open)
    .sort((a, b) => Math.hypot(a.inside.x - g.player.x, a.inside.y - g.player.y)
      - Math.hypot(b.inside.x - g.player.x, b.inside.y - g.player.y))[0];
  if (!door) return null;
  g.player.x = door.inside.x;
  g.player.y = door.inside.y;
  g.player.vx = g.player.vy = 0;
  g.updateInteraction(1 / 60);
  return door.id;
});
if (testDoorId) {
  await page.evaluate(async () => {
    const g = window.__LN;
    const World3D = (await import('./src/game/world3d.js')).World3D;
    g.input.interactPressed = true;
    g.updateInteraction(1 / 60);
    g.input.interactPressed = false;
    World3D.render(g);
  });
}
const doorState = await page.evaluate((id) => {
  const g = window.__LN;
  const door = g.mansion.entrances.find((item) => item.id === id);
  const view = window.__env.doors.get(id);
  return { open: !!(door && door.open), env3d: !!(door && door.env3d), angle: view && view.pivot ? view.pivot.rotation.y : null };
}, testDoorId);
const doorPass = !!testDoorId && doorState.open && doorState.env3d && doorState.angle < -1;
console.log(`---- DOOR INTERACTION: ${doorPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  door=${testDoorId}, sim open=${doorState.open}, 3D mesh angle=${doorState.angle}`);
if (!doorPass) process.exitCode = 1;

const objectSetup = await page.evaluate(async () => {
  const g = window.__LN;
  const room = g.mansion.rooms.hall;
  const pickupAt = g.pickSpotInRoom(room);
  const boltAt = g.pickSpotInRoom(room);
  if (!pickupAt || !boltAt) return null;
  g.addPickup(pickupAt.x, pickupAt.y, 'planks', 1);
  const pickup = g.pickups[g.pickups.length - 1];
  pickup.id = 'qa-pickup';
  const { Bolt } = await import('./src/game/enemies.js');
  const bolt = new Bolt(boltAt.x, boltAt.y, 0.2, 0, 1, g.player);
  bolt.id = 'qa-bolt';
  bolt.vx = bolt.vy = 0;
  g.bolts.push(bolt);
  g.particles.burst('blood', pickupAt.x, pickupAt.y, 8, { color: '#c22a35', sizeMin: 2, sizeMax: 5, lifeMin: 0.8, lifeMax: 1.2 });
  g.particles.burst('mist', boltAt.x, boltAt.y, 4, { color: 'rgba(120,150,205,0.35)', sizeMin: 5, sizeMax: 11, lifeMin: 0.8, lifeMax: 1.2 });
  g.particles.burst('shard', boltAt.x + 12, boltAt.y, 3, { color: '#d7cfbd', sizeMin: 3, sizeMax: 6, lifeMin: 0.8, lifeMax: 1.2 });
  g.decals.splat(pickupAt.x, pickupAt.y, 22, 'rgba(100,18,26,0.55)', 8);
  const World3D = (await import('./src/game/world3d.js')).World3D;
  World3D.render(g);
  return { pickup: pickupAt, bolt: boltAt };
});
const objectVisibility = await page.evaluate(() => {
  const W = window.__LN_API.world3d();
  return {
    pickup: window.__LN.pickups.find((p) => p.id === 'qa-pickup')?.taken === false,
    bolt: window.__LN.bolts.find((b) => b.id === 'qa-bolt')?.dead === false,
    particles: W.visibleParticles,
    decalsMapped: W.decalsMapped,
    decalSize: W.decalTextureSize,
  };
});
const meshVisibility = await page.evaluate(async () => {
  const W = (await import('./src/game/world3d.js')).World3D;
  return {
    pickup: !!(W.pickups.get('qa-pickup') && W.pickups.get('qa-pickup').visible),
    bolt: !!(W.bolts.get('qa-bolt') && W.bolts.get('qa-bolt').visible),
  };
});
const entitiesPass = !!objectSetup && objectVisibility.pickup && objectVisibility.bolt
  && meshVisibility.pickup && meshVisibility.bolt && objectVisibility.particles >= 10
  && objectVisibility.decalsMapped && objectVisibility.decalSize && objectVisibility.decalSize[0] <= 2048;
console.log(`---- PICKUP / BOLT / WORLD VFX: ${entitiesPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  pickup mesh=${meshVisibility.pickup}, bolt mesh=${meshVisibility.bolt}, particles=${objectVisibility.particles}, decals=${objectVisibility.decalsMapped} (${(objectVisibility.decalSize || []).join('x')})`);
if (!entitiesPass) process.exitCode = 1;

const pickupCollected = await page.evaluate(async () => {
  const g = window.__LN;
  const W = (await import('./src/game/world3d.js')).World3D;
  const pickup = g.pickups.find((item) => item.id === 'qa-pickup');
  g.player.x = pickup.x; g.player.y = pickup.y; g.player.vx = g.player.vy = 0;
  pickup.update(1 / 60, g);
  W.render(g);
  return { taken: !!pickup.taken, meshVisible: !!(W.pickups.get('qa-pickup') && W.pickups.get('qa-pickup').visible) };
});
const pickupPass = pickupCollected.taken && !pickupCollected.meshVisible;
console.log(`---- PICKUP COLLECTION: ${pickupPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  simulation taken=${pickupCollected.taken}, 3D mesh hidden=${!pickupCollected.meshVisible}`);
if (!pickupPass) process.exitCode = 1;

const enemyScene = await page.evaluate(async () => {
  const g = window.__LN;
  const F = window.__foes;
  g.enemies.length = 0;
  const types = [F.Crawler, F.Zombie, F.Hunter, F.Werewolf, F.Ghoul, F.Stalker];
  for (let i = 0; i < 11; i++) {
    const a = i * Math.PI * 2 / 11;
    const radius = 120 + i * 34;
    const Type = types[i % types.length];
    const enemy = new Type(g.player.x + Math.cos(a) * radius, g.player.y + Math.sin(a) * radius * 0.82, {});
    enemy.alpha = 1;
    g.enemies.push(enemy);
  }
  g.player.weapon = 'claw';
  g.player.slashAge = 0.12;
  g.player.swingAngle = g.player.angle;
  g.house.cat = { x: g.player.x + 80, y: g.player.y + 50, tx: g.player.x + 140, t: 0.5 };
  g.haunts.watchers = [{ x: g.player.x + 160, y: g.player.y + 90, t: 0.5, life: 1.5 }];
  const door = g.mansion.entrances.find((item) => item.id === 'frontDoor');
  if (door) { door.attackers = 1; g.house.drafts = [{ e: door, t: 0.8 }]; }
  window.__LN_TIME_SCALE = 0;
  const World3D = (await import('./src/game/world3d.js')).World3D;
  World3D.render(g);
  return true;
});
await wait(350);
const actors = await page.evaluate(() => ({
  world: window.__LN_API.world3d(),
  enemySlots: window.__LN_API.enemy3d().skinned,
  riggedTypes: window.__enemy.slots.map((slot) => slot.type),
}));
const allEnemyTypes = ['crawler', 'zombie', 'hunter', 'werewolf', 'ghoul', 'stalker'].every((type) => actors.riggedTypes.includes(type));
const enemyPass = !!enemyScene && actors.world.visibleRiggedEnemies >= 6 && actors.enemySlots >= 6 && allEnemyTypes
  && actors.world.proxyActors >= 3 && actors.world.visiblePlayerSwing3D && actors.world.visibleHouseCat3D
  && actors.world.visibleWatchers3D === 1 && actors.world.visibleDoorCues3D > 0 && actors.world.visibleDrafts3D > 0;
console.log(`---- ENEMY + HAUNT SCENE: ${enemyPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  rigged GLB enemies=${actors.world.visibleRiggedEnemies}/${actors.enemySlots}, types=${[...new Set(actors.riggedTypes)].join(',')}, proxy actors=${actors.world.proxyActors}, swing=${actors.world.visiblePlayerSwing3D}, cat=${actors.world.visibleHouseCat3D}, watchers=${actors.world.visibleWatchers3D}, door cues=${actors.world.visibleDoorCues3D}, drafts=${actors.world.visibleDrafts3D}`);
if (!enemyPass) process.exitCode = 1;

/* Preserve reproducible visual evidence of the active scene at both shapes. */
const shots = path.join(ROOT, 'tools', 'shots');
fs.mkdirSync(shots, { recursive: true });
await page.screenshot({ path: path.join(shots, '3d-migration-mobile.png') });
const desktopPage = await browser.newPage();
const desktopErrors = [];
desktopPage.on('pageerror', (e) => desktopErrors.push(`page: ${e.message}`));
desktopPage.on('console', (message) => { if (message.type() === 'error') desktopErrors.push(`console: ${message.text()}`); });
await desktopPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await desktopPage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await desktopPage.evaluate(() => !!window.__LN_API);
  if (ready) break;
  await wait(100);
}
await desktopPage.evaluate(async () => {
  const g = window.__LN;
  g.save.privacyAck = true;
  g.beginNight(); g.introT = 99; g.skipNarration();
  await new Promise((r) => setTimeout(r, 300));
  g.skipNarration();
});
let desktopView = null;
for (let i = 0; i < 160; i++) {
  desktopView = await desktopPage.evaluate(async () => {
    const world = window.__LN_API.world3d();
    const stage = document.getElementById('stage').getBoundingClientRect();
    return { width: Math.round(stage.width), height: Math.round(stage.height), mode: world.mode, fullScene: world.fullScene, rooms: world.rooms, screen: window.__LN.screen };
  });
  if (desktopView.screen === 'playing' && desktopView.fullScene && desktopView.rooms === 11) break;
  await wait(120);
}
await wait(300);
await desktopPage.screenshot({ path: path.join(shots, '3d-migration-desktop.png') });
const desktopPass = desktopView.width > 0 && desktopView.height > 0 && desktopView.mode === 'webgl-3d'
  && desktopView.fullScene && desktopView.rooms === 11 && desktopView.screen === 'playing' && desktopErrors.length === 0;
console.log(`---- DESKTOP BOOT: ${desktopPass ? 'PASS' : 'FAIL'} ----`);
console.log(`  viewport=1280x720, game stage=${desktopView.width}x${desktopView.height}, mode=${desktopView.mode}, rooms=${desktopView.rooms}, errors=${desktopErrors.length}`);
if (!desktopPass) process.exitCode = 1;
await desktopPage.close();

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
console.log(`\n---- BROWSER ERRORS: ${browserErrors.length ? 'FAIL' : 'PASS'} ----`);
if (browserErrors.length) {
  for (const error of browserErrors.slice(0, 8)) console.log(`  ${error}`);
  process.exitCode = 1;
}

server.kill();
await browser.close();
