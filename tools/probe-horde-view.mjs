// scratch probe (BUILD 26): render the three horde variants walking, side and
// front views, so the upright pose and facing are unambiguous. Deletes itself
// from the catalog afterwards (not a permanent gate).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'qa-evidence/.tmp-b26-probe';
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
await new Promise((r) => server.listen(8147, '0.0.0.0', r));

const PAGE = `<!doctype html><html><head><meta charset=utf8><style>body{margin:0;background:#20303c}canvas{display:block}</style></head>
<body><script type=module>
import * as THREE from '/src/vendor/three/three.module.min.js';
import { ZombiPack3D } from '/src/game/render3d/zombipack3d.js';
import { cloneRig } from '/src/game/render3d/enemy3d.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(900, 500);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20303c);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2622, 1.1); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffe6c0, 1.4); dir.position.set(2, 4, 3); scene.add(dir);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x3a4a44 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const cam = new THREE.PerspectiveCamera(35, 900 / 500, 0.1, 100);
await ZombiPack3D.stage();
const kinds = ['shambler', 'lurcher', 'wretch'];
const mixers = [];
kinds.forEach((key, i) => {
  const v = ZombiPack3D.forKind(key);
  const rig = cloneRig(v.template);
  rig.visible = true;
  rig.traverse((o) => { o.visible = true; });
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(new THREE.Vector3());
  const k = 1.7 / Math.max(0.001, size.y);
  rig.scale.setScalar(k);
  rig.position.set((i - 1) * 1.1, -box.min.y * k, 0);
  scene.add(rig);
  const m = new THREE.AnimationMixer(rig);
  const clip = v.clips.walk;
  m.clipAction(clip).play();
  mixers.push(m);
});
for (let f = 0; f < 60; f++) mixers.forEach((m) => m.update(1 / 30));
window.__shot = (tag, pos, look) => {
  cam.position.set(...pos); cam.lookAt(...look);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = tag;
  return url;
};
window.__urls = {};
window.__urls.side = window.__shot('side', [0, 1.1, 5], [0, 0.9, 0]);
window.__urls.front = window.__shot('front', [5, 1.1, 0.6], [0, 0.9, 0]);
window.__done = true;
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, '.probe-b26.html'), PAGE);

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
await page.setViewport({ width: 920, height: 520 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8147/.probe-b26.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__done === true', { timeout: 60000 });
for (const tag of ['side', 'front']) {
  const url = await page.evaluate((t) => window.__urls[t], tag);
  fs.writeFileSync(path.join(OUT, `probe-${tag}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', tag);
}
await browser.close();
fs.unlinkSync(path.join(ROOT, '.probe-b26.html'));
server.close();
console.log('PROBE-DONE');
