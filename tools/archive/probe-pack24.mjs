/**
 * BUILD 24 probe sheet: the three pack characters side by side — captain
 * (Commander), gate guard (Warrior + crossbow), bearer (Resident) — front and
 * three-quarter views on a neutral stage, to judge that they are genuinely
 * different people in one art family.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/tmp/probe24';
const PORT = 8129;
fs.mkdirSync(OUT, { recursive: true });

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
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e.message).slice(0, 300)); console.log('PAGEERROR', String(e.message).slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text().slice(0, 300)); console.log('CONSOLE', m.text().slice(0, 300)); } });
await page.setViewport({ width: 900, height: 500, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const report = await page.evaluate(async () => {
  document.body.innerHTML = '<canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas>';
  const THREE = await import('./src/vendor/three/three.module.min.js');
  const PK = await import('./src/game/pack3d.js');
  const TM = await import('./src/game/troop3d.js');
  await PK.People3D.stage();
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(2);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x22303f);
  const cam = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.01, 40);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2622, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
  sun.position.set(2, 3, 2.4);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x3c4650 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const lineup = [];
  const captain = PK.People3D.make(PK.PEOPLE_ROLES.captain);
  captain.model.scale.setScalar(0.72);
  scene.add(captain.model);
  lineup.push(captain.model);
  // guard with the garrison crossbow via the real troop factory
  TM.Troop3D.init();
  for (let i = 0; i < 400 && !TM.Troop3D.ready; i++) await new Promise((r) => setTimeout(r, 50));
  const guard = TM.Troop3D.make('soldier', 66, { arms: 2 });
  if (guard) {
    // this sheet is in pack units, not world px
    guard.model.scale.setScalar(0.68);
    guard.model.position.set(0.62, 0, 0);
    scene.add(guard.model); lineup.push(guard.model);
  }
  const melee = TM.Troop3D.make('guard', 66, { arms: 1 });
  if (melee) {
    melee.model.scale.setScalar(0.68);
    melee.model.position.set(1.24, 0, 0);
    scene.add(melee.model);
  }
  const bearer = PK.People3D.make(PK.PEOPLE_ROLES.bearer);
  bearer.model.scale.setScalar(0.66);
  bearer.model.position.x = -0.5;
  scene.add(bearer.model);
  lineup.push(bearer.model);

  captain.model.position.x = -0.62;
  guard && (guard.model.position.x = 0) && (guard.model.scale.setScalar(0.68));
  melee && (melee.model.position.x = 0.62) && (melee.model.scale.setScalar(0.68));
  bearer.model.position.x = 1.24;
  bearer.model.position.x = -0.62;
  const views = {
    front: [0, 0.62, 2.9],
    three: [1.9, 0.8, 2.0],
    back: [0, 0.62, -2.9],
  };
  // pose them: captain mid-cheer, bearer mid-walk, guard firing
  const capMx = new THREE.AnimationMixer(captain.model);
  capMx.clipAction(captain.clips.cheer).play();
  const bearMx = new THREE.AnimationMixer(bearer.model);
  bearMx.clipAction(bearer.clips.walk).play();
  if (guard && guard.loop) guard.loop('shoot', 0);
  // numeric bow-axis audit
  let audit = null;
  if (guard) {
    guard.model.updateMatrixWorld(true);
    const bow = guard.model.getObjectByName('troop-crossbow');
    const hand = guard.model.getObjectByName('L_Hand');
    if (bow) {
      const q = bow.getWorldQuaternion(new THREE.Quaternion());
      const axes = {};
      for (const [n, v] of Object.entries({ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] })) {
        axes[n] = new THREE.Vector3(...v).applyQuaternion(q).toArray().map((x) => +x.toFixed(2));
      }
      audit = { axes, handQ: hand ? hand.getWorldQuaternion(new THREE.Quaternion()).toArray().map((x) => +x.toFixed(2)) : null };
    }
  }
  window.__sheet = { THREE, scene, cam, views, renderer, guard, melee, lineup, capMx, bearMx };
  window.__audit = audit;
  return {
    ready: PK.People3D.ready, diag: PK.People3D.diagnostics(),
    troopReady: TM.Troop3D.ready, troopError: TM.Troop3D.error,
    lineup: lineup.map((m) => m.name || m.children[0]?.name),
  };
});
console.log('REPORT', JSON.stringify(report).slice(0, 700));
console.log('AUDIT', JSON.stringify(await page.evaluate(() => window.__audit)));

for (const [name, pos] of Object.entries(report.views || {})) {
  // views come back undefined through JSON; re-read in page
}
const shots = await page.evaluate(async () => {
  const { THREE, scene, cam, views, renderer, capMx, bearMx, guard } = window.__sheet;
  capMx.update(0.32); bearMx.update(0.21);
  if (guard && guard.update) guard.update(0.16);
  return Object.keys(views);
});
for (const name of shots) {
  await page.evaluate((n) => {
    const { THREE, scene, cam, views, renderer } = window.__sheet;
    cam.position.set(...views[n]);
    cam.lookAt(0, 0.4, 0);
    renderer.render(scene, cam);
  }, name);
  await page.screenshot({ path: path.join(OUT, `sheet-${name}.png`) });
  console.log('SHOT', name);
}
// bind sheet: every role in rest pose, front and side, to measure hands
await page.evaluate(() => {
  const { THREE, scene, cam, renderer, lineup } = window.__sheet;
  const PKroles = ['Commander', 'Warrior', 'Resident', 'King', 'Slave'];
  lineup.forEach((m) => { m.visible = false; });
  const row = [];
  for (const role of PKroles) {
    // fresh un-posed rigs via the pack module already loaded in page scope
  }
  window.__bind = window.__bind || null;
});
const bindShot = await page.evaluate(async () => {
  const THREE = await import('./src/vendor/three/three.module.min.js');
  const PK = await import('./src/game/pack3d.js');
  const scene = window.__sheet.scene;
  const cam = window.__sheet.cam;
  const renderer = window.__sheet.renderer;
  window.__sheet.lineup.forEach((m) => { m.visible = false; });
  const row = new THREE.Group();
  const roles = ['Commander', 'Warrior', 'Resident', 'King', 'Slave'];
  roles.forEach((role, i) => {
    const p = PK.People3D.make(role);
    p.model.scale.setScalar(0.6);
    p.model.position.x = (i - 2) * 0.75;
    row.add(p.model);
  });
  scene.add(row);
  cam.position.set(0, 0.5, 3.4);
  cam.lookAt(0, 0.35, 0);
  renderer.render(scene, cam);
  window.__bindRow = row;
  row.visible = true;
  return true;
});
await page.screenshot({ path: path.join(OUT, 'bind-front.png') });
console.log('SHOT bind-front');
await page.evaluate(() => {
  const { cam, renderer, scene } = window.__sheet;
  cam.position.set(3.4, 0.5, 0);
  cam.lookAt(0, 0.35, 0);
  renderer.render(scene, cam);
});
await page.screenshot({ path: path.join(OUT, 'bind-side.png') });
console.log('SHOT bind-side');

// solo portraits: no ambiguity about who wears what
for (const name of ['captain', 'guard', 'melee', 'bearer']) {
  await page.evaluate((n) => {
    const { scene, cam, renderer, lineup, melee } = window.__sheet;
    const all = { captain: lineup[0], guard: lineup[1], bearer: lineup[2], melee: melee && melee.model };
    Object.values(all).forEach((m) => { if (m) m.visible = false; });
    if (window.__bindRow) window.__bindRow.visible = false;
    const m = all[n];
    m.visible = true;
    m.position.x = 0;
    cam.position.set(0.7, 0.55, 1.5);
    cam.lookAt(0, 0.38, 0);
    renderer.render(scene, cam);
  }, name);
  await page.screenshot({ path: path.join(OUT, `solo-${name}.png`) });
  console.log('SHOT solo-' + name);
  if (name === 'guard') {
    // bind pose of the same rig: is the tear animation or skinning?
    await page.evaluate(() => {
      const { scene, cam, renderer, guard } = window.__sheet;
      guard.model.traverse((o) => { if (o.isSkinnedMesh) o.visible = true; });
      const mx = guard.model.userData.__mx || null;
      if (guard.stopAll) guard.stopAll();
      if (guard.mixer) guard.mixer.stopAllAction();
      if (guard.update) guard.update(0);
      cam.position.set(0.7, 0.55, 1.5);
      cam.lookAt(0, 0.38, 0);
      renderer.render(scene, cam);
    });
    await page.screenshot({ path: path.join(OUT, 'solo-guard-bind.png') });
    console.log('SHOT solo-guard-bind');
  }
}
console.log('ERRORS', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
server.kill();
process.exit(0);
