// Cast-candidate prototype (visual-sync audit, research step): the CURRENT
// cast next to CC0 KayKit candidates, one light, one frame — so the eye decides
// before any wiring happens. KayKit packs (CC0 1.0, Kay Lousberg) are cached
// uncommitted in tools/.cache/kaykit/ by:
//   curl -fsL -o adv.tar.gz  https://codeload.github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/tar.gz/HEAD
//   curl -fsL -o skel.tar.gz https://codeload.github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0/tar.gz/HEAD
// Left half heroes: egyptian 'Commander' (current captain) | KayKit Knight |
// KayKit Barbarian.  Right half horde: polyart shambler (current) | KayKit
// Skeleton_Minion | Skeleton_Warrior.  Clip names print to the console.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'qa-evidence/.tmp-cast-proto';
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? '/index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { console.log('404', u); res.statusCode = 404; res.end('no'); return; }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(8149, '0.0.0.0', r));

const K = '/tools/.cache/kaykit';
const PAGE = `<!doctype html><html><head><meta charset=utf8><style>body{margin:0;background:#20303c}canvas{display:block}</style></head>
<body><script type=module>
import * as THREE from '/src/vendor/three/three.module.min.js';
import { GLTFLoader } from '/src/vendor/three/GLTFLoader.js';
import { People3D, PEOPLE_ROLES } from '/src/game/render3d/pack3d.js';
import { ZombiPack3D } from '/src/game/render3d/zombipack3d.js';
import { cloneRig } from '/src/game/render3d/enemy3d.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 520);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20303c);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2622, 1.1));
const dir = new THREE.DirectionalLight(0xffe6c0, 1.4); dir.position.set(2, 4, 3); scene.add(dir);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a4a44 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const cam = new THREE.PerspectiveCamera(30, 1200 / 520, 0.1, 100);
const load = (url) => new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
window.__clips = {};
const stand = (rig, x, clip, tag) => {
  rig.visible = true; rig.traverse((o) => { o.visible = true; });
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);
  const size = box.getSize(new THREE.Vector3());
  const k = 1.75 / Math.max(0.001, size.y);
  rig.scale.setScalar(k);
  rig.position.set(x, -box.min.y * k, 0);
  scene.add(rig);
  if (clip) { const m = new THREE.AnimationMixer(rig); m.clipAction(clip).play(); m.update(0.4); }
  window.__clips[tag] = 'stood';
};
await People3D.stage();
await ZombiPack3D.stage();
const cap = People3D.make(PEOPLE_ROLES.captain);
stand(cap.model, -3.0, null, 'egypt-captain');
const z = ZombiPack3D.forKind('shambler');
stand(cloneRig(z.template), 0.0, z.clips.walk, 'polyart-shambler');
const KITS = [
  ['${K}/KayKit-Character-Pack-Adventures-1.0-HEAD/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb', -1.8, 'kaykit-knight'],
  ['${K}/KayKit-Character-Pack-Adventures-1.0-HEAD/addons/kaykit_character_pack_adventures/Characters/gltf/Barbarian.glb', -0.7, 'kaykit-barbarian'],
  ['${K}/KayKit-Character-Pack-Skeletons-1.0-HEAD/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Minion.glb', 1.2, 'kaykit-skel-minion'],
  ['${K}/KayKit-Character-Pack-Skeletons-1.0-HEAD/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Warrior.glb', 2.4, 'kaykit-skel-warrior'],
];
for (const [url, x, tag] of KITS) {
  const g = await load(url);
  window.__clips[tag] = (g.animations || []).map((c) => c.name);
  const walk = (g.animations || []).find((c) => /^Walk$/i.test(c.name)) || null;
  stand(g.scene, x, walk, tag + '-stood');
}
window.__shot = (tag, pos, look) => {
  cam.position.set(...pos); cam.lookAt(...look);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
};
window.__urls = {};
window.__urls.lineup = window.__shot('lineup', [-0.3, 1.15, 8.6], [-0.3, 0.88, 0]);
window.__urls.heroes = window.__shot('heroes', [-1.6, 1.1, 4.4], [-1.6, 0.88, 0]);
window.__urls.horde = window.__shot('horde', [1.0, 1.1, 4.4], [1.0, 0.88, 0]);
// same cast under the survival world's bright daylight rig, to judge world-sync
scene.background = new THREE.Color(0x9fc7e8);
scene.children.forEach((o) => { if (o.isHemisphereLight) { o.intensity = 1.7; o.color.set(0xcfe4ff); } if (o.isDirectionalLight) { o.intensity = 2.1; } });
window.__urls.daylit = window.__shot('daylit', [-0.3, 1.15, 8.6], [-0.3, 0.88, 0]);
window.__done = true;
</script></body></html>`;
fs.writeFileSync(path.join(ROOT, '.probe-cast-candidates.html'), PAGE);

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
await page.setViewport({ width: 1220, height: 540 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:8149/.probe-cast-candidates.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__done === true', { timeout: 120000 });
const clips = await page.evaluate(() => window.__clips);
for (const [k, v] of Object.entries(clips)) {
  if (Array.isArray(v)) console.log('CLIPS', k, ':', v.slice(0, 14).join(', '), v.length > 14 ? `…(+${v.length - 14})` : '');
}
for (const tag of ['lineup', 'heroes', 'horde', 'daylit']) {
  const url = await page.evaluate((t) => window.__urls[t], tag);
  fs.writeFileSync(path.join(OUT, `proto-${tag}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', tag);
}
await browser.close();
fs.unlinkSync(path.join(ROOT, '.probe-cast-candidates.html'));
server.close();
console.log('PROTO-DONE');
