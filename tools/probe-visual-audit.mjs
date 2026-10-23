// Visual-sync audit probe: one studio lineup of every character the game
// actually puts on screen — the captain (egyptian pack 'Commander'), a garrison
// soldier ('King'), the three horde variants — under ONE neutral light, with
// the same palette grades the game applies (valen3d.buildUniformGrade for the
// people, enemy3d.hordeGradeMaterial for the horde), so the picture answers
// "do these bodies belong to the same world?" without gameplay noise.
// Two cameras: front and three-quarter.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'qa-evidence/.tmp-visual-audit';
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? '/index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('no'); return; }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(8148, '0.0.0.0', r));

const PAGE = `<!doctype html><html><head><meta charset=utf8><style>body{margin:0;background:#20303c}canvas{display:block}</style></head>
<body><script type=module>
import * as THREE from '/src/vendor/three/three.module.min.js';
import { People3D, PEOPLE_ROLES } from '/src/game/render3d/pack3d.js';
import { ZombiPack3D } from '/src/game/render3d/zombipack3d.js';
import { cloneRig, hordeGradeMaterial } from '/src/game/render3d/enemy3d.js';
import { buildUniformGrade } from '/src/game/render3d/valen3d.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1100, 520);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20303c);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2622, 1.1); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffe6c0, 1.4); dir.position.set(2, 4, 3); scene.add(dir);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a4a44 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const cam = new THREE.PerspectiveCamera(32, 1100 / 520, 0.1, 100);

await People3D.stage();
await ZombiPack3D.stage();
const stand = (rig, x) => {
  rig.visible = true;
  rig.traverse((o) => { o.visible = true; });
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(new THREE.Vector3());
  const k = 1.75 / Math.max(0.001, size.y);
  rig.scale.setScalar(k);
  rig.position.set(x, -box.min.y * k, 0);
  scene.add(rig);
  return rig;
};
const captain = People3D.make(PEOPLE_ROLES.captain);
const soldier = People3D.make(PEOPLE_ROLES.soldier);
if (captain) buildUniformGrade(captain.model);
if (soldier) buildUniformGrade(soldier.model);
if (captain) stand(captain.model, -2.4);
if (soldier) stand(soldier.model, -1.2);
const zk = ['shambler', 'lurcher', 'wretch'];
zk.forEach((key, i) => {
  const v = ZombiPack3D.forKind(key);
  const rig = cloneRig(v.template);
  rig.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => hordeGradeMaterial(key, m));
    }
  });
  stand(rig, i * 1.2);
});
window.__shot = (tag, pos, look) => {
  cam.position.set(...pos); cam.lookAt(...look);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
};
window.__urls = {};
window.__urls.lineup = window.__shot('lineup', [0, 1.15, 7.2], [0, 0.88, 0]);
window.__urls.threeq = window.__shot('threeq', [4.6, 1.5, 5.4], [0, 0.85, 0]);
window.__done = true;
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, '.probe-visual-audit.html'), PAGE);

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
await page.setViewport({ width: 1120, height: 540 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8148/.probe-visual-audit.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__done === true', { timeout: 90000 });
for (const tag of ['lineup', 'threeq']) {
  const url = await page.evaluate((t) => window.__urls[t], tag);
  fs.writeFileSync(path.join(OUT, `audit-${tag}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', tag);
}
await browser.close();
fs.unlinkSync(path.join(ROOT, '.probe-visual-audit.html'));
server.close();
console.log('AUDIT-DONE');
