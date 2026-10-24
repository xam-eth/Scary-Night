#!/usr/bin/env node
/* DUSKHOLD — review renders for img2threejs reconstructions (assets-src/img2threejs/<asset>).
 *
 * The img2threejs skill (.agents/skills/img2threejs) generates a TypeScript THREE.Group factory per
 * build pass and asks for browser screenshots of it: the fixed review view at the reference camera
 * plus a turntable (front/right/rear/left). This tool:
 *   1. bundles the generated TS with esbuild (three -> the game's vendored three.module.min.js; the
 *      look-dev helpers' three/examples imports are stubbed — only create<Name>Model is kept);
 *   2. measures the reference image's foreground box so the fixed view frames the model the same way
 *      (the Tier-1 silhouette gates compare aligned masks);
 *   3. renders in headless Chromium with the game's lighting model (tools/img2threejs-harness.html);
 *   4. writes fixed.png, fixed-clay.png (map-stripped clay, the blockout's "silhouette without materials"
 *      evidence), front.png, right.png, rear.png, left.png, top.png, render.json (stats, framing),
 *      meshes.json (world-space triangles for self_intersection.py) and nodes.json (component pivots
 *      for attachment_anchor.py).
 *
 *   node tools/img2threejs-render.mjs --asset=assets-src/img2threejs/mine-cart --pass=blockout
 *        [--ts=src/createMineCartModel.ts] [--out=renders/blockout] [--port=8196] [--exposure=1.25]
 *        [--fit-camera]   fit the reference camera to the silhouette (writes camera-fit.json, no review shots)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
if (!args.asset || !args.pass) { console.error('usage: --asset=<dir> --pass=<pass-id> [--ts=] [--out=]'); process.exit(2); }
const ASSET = path.resolve(ROOT, args.asset);
const SPEC = JSON.parse(fs.readFileSync(path.join(ASSET, 'object-sculpt-spec.json'), 'utf8'));
const TS = path.resolve(ASSET, args.ts || fs.readdirSync(path.join(ASSET, 'src')).filter((f) => f.endsWith('.ts')).map((f) => `src/${f}`)[0]);
const OUT = path.resolve(ASSET, args.out || `renders/${args.pass}`);
const PORT = Number(args.port || 8196);
fs.mkdirSync(OUT, { recursive: true });

// ---- 1. bundle ------------------------------------------------------------------------------
const src = fs.readFileSync(TS, 'utf8');
const exportName = (src.match(/export function (create\w+Model)\(/) || [])[1];
if (!exportName) throw new Error(`no create*Model export in ${TS}`);
const cacheDir = path.join(ROOT, 'tools', '.cache', 'img2threejs');
fs.mkdirSync(cacheDir, { recursive: true });
const bundleName = `${path.basename(ASSET)}-${args.pass}.js`;
const STUB_EXPORTS = ['RoomEnvironment', 'EffectComposer', 'RenderPass', 'BokehPass', 'UnrealBloomPass', 'OrbitControls', 'OutputPass', 'ShaderPass'];
await esbuild.build({
  stdin: { contents: `export { ${exportName} } from ${JSON.stringify(TS)};`, resolveDir: path.dirname(TS), loader: 'ts' },
  bundle: true, format: 'esm', target: 'es2020', outfile: path.join(cacheDir, bundleName), logLevel: 'warning',
  plugins: [{
    name: 'duskhold-three',
    setup(build) {
      build.onResolve({ filter: /^three$/ }, () => ({ path: '/src/vendor/three/three.module.min.js', external: true }));
      build.onResolve({ filter: /^three\/examples\// }, (a) => ({ path: a.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB_EXPORTS.map((n) => `export const ${n} = null;`).join('\n'), loader: 'js' }));
    },
  }],
});

// ---- the Tier-1 gate's foreground mask, ported from img2threejs forge (extract_pbr_evidence.py
// build_foreground_mask + diagnose_render.py load_mask/largest_component) so the camera fit
// optimises the same silhouette the gate measures -------------------------------------------
const GRID = 224;
function gateMask(data, W, H) {
  const r0 = Math.max(3, Math.floor(Math.min(W, H) / 40));
  const samples = [];
  for (const [x0, x1, y0, y1] of [[0, r0, 0, r0], [W - r0, W, 0, r0], [0, r0, H - r0, H], [W - r0, W, H - r0, H]]) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; samples.push([data[i], data[i + 1], data[i + 2]]); }
  }
  const med = [0, 1, 2].map((c) => { const v = samples.map((s) => s[c]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const dists = samples.map((s) => dist(s, med)).sort((a, b) => a - b);
  const noise = dists[Math.min(dists.length - 1, Math.floor(0.75 * (dists.length - 1)))] || 0;
  const thr = Math.max(24, noise * 2.4);
  const full = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4; const rgb = [data[i], data[i + 1], data[i + 2]];
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    const sat = hi <= 0 ? 0 : (hi - lo) / hi;
    const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    full[p] = (dist(rgb, med) > thr || (sat > 0.16 && luma < 0.94)) ? 1 : 0;
  }
  const m = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) { const sy = Math.min(H - 1, Math.floor(y * H / GRID)); for (let x = 0; x < GRID; x++) { const sx = Math.min(W - 1, Math.floor(x * W / GRID)); m[y * GRID + x] = full[sy * W + sx]; } }
  // largest 4-connected component
  const seen = new Uint8Array(m.length); let best = [];
  for (let s0 = 0; s0 < m.length; s0++) {
    if (!m[s0] || seen[s0]) continue;
    const stack = [s0]; seen[s0] = 1; const blob = [];
    while (stack.length) { const k = stack.pop(); blob.push(k); const y = Math.floor(k / GRID), x = k % GRID;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) { const nb = ny * GRID + nx; if (m[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); } } }
    if (blob.length > best.length) best = blob;
  }
  const out = new Uint8Array(m.length); for (const k of best) out[k] = 1;
  return out;
}
function iouOf(a, b) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] || b[k]) { u++; if (a[k] && b[k]) i++; } } return u ? i / u : 0; }
async function maskFromDataUrl(url) {
  const img = await loadImage(Buffer.from(url.split(',')[1], 'base64'));
  const c = createCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return gateMask(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
}


// ---- 2. reference foreground box -----------------------------------------------------------
const refPath = path.join(ASSET, SPEC.sourceImage || 'reference.png');
const refImg = await loadImage(fs.readFileSync(refPath));
const RW = refImg.width, RH = refImg.height;
const rc = createCanvas(RW, RH);
const rctx = rc.getContext('2d');
rctx.drawImage(refImg, 0, 0);
const rdata = rctx.getImageData(0, 0, RW, RH).data;
const corner = (x, y) => { const i = (y * RW + x) * 4; return [rdata[i], rdata[i + 1], rdata[i + 2]]; };
const corners = [corner(4, 4), corner(RW - 5, 4), corner(4, RH - 5), corner(RW - 5, RH - 5)];
const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
const rowCount = new Array(RH).fill(0), colCount = new Array(RW).fill(0);
for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
  const i = (y * RW + x) * 4;
  const d = Math.abs(rdata[i] - bg[0]) + Math.abs(rdata[i + 1] - bg[1]) + Math.abs(rdata[i + 2] - bg[2]);
  if (d > 48) { rowCount[y]++; colCount[x]++; }
}
const minRun = (arr, n) => arr.findIndex((v) => v > n);
const maxRun = (arr, n) => arr.length - 1 - [...arr].reverse().findIndex((v) => v > n);
const y0 = minRun(rowCount, RW * 0.004), y1 = maxRun(rowCount, RW * 0.004);
const x0 = minRun(colCount, RH * 0.004), x1 = maxRun(colCount, RH * 0.004);
const ref = { width: RW, height: RH, bg: `#${bg.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
  bbox: { x0: x0 / RW, y0: y0 / RH, x1: (x1 + 1) / RW, y1: (y1 + 1) / RH } };
// frame to the box of the Tier-1 gate's own mask (224 grid, largest component), so the fixed view
// matches what diagnose_render.py measures (aspect / scale deltas), not a private estimate
{
  const gm = gateMask(rdata, RW, RH);
  let gx0 = GRID, gy0 = GRID, gx1 = -1, gy1 = -1;
  for (let k = 0; k < gm.length; k++) if (gm[k]) { const y = Math.floor(k / GRID), x = k % GRID; gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
  ref.bboxEstimate = ref.bbox;
  ref.bbox = { x0: gx0 / GRID, y0: gy0 / GRID, x1: (gx1 + 1) / GRID, y1: (gy1 + 1) / GRID, source: 'tier1-gate-mask' };
}
const ndc = { mode: 'match', cx: ref.bbox.x0 + ref.bbox.x1 - 1, cy: 1 - (ref.bbox.y0 + ref.bbox.y1),
  w: (ref.bbox.x1 - ref.bbox.x0) * 2, h: (ref.bbox.y1 - ref.bbox.y0) * 2 };


// ---- 3. render -------------------------------------------------------------------------------
const cam = SPEC.referenceCamera || {};
const az = Number(cam.azimuthDeg ?? 0), el = Number(cam.elevationDeg ?? 25), fov = Number(cam.fovDegrees ?? 30);
const orbitEl = Number(args.orbitElevation ?? 18);
const views = [
  { id: 'fixed', azimuthDeg: az, elevationDeg: el, fov, width: RW, height: RH, frame: ndc },
  { id: 'fixed-clay', azimuthDeg: az, elevationDeg: el, fov, width: RW, height: RH, frame: ndc, clay: true },
  { id: 'front', azimuthDeg: 0, elevationDeg: orbitEl, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 } },
  { id: 'right', azimuthDeg: 90, elevationDeg: orbitEl, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 } },
  { id: 'rear', azimuthDeg: 180, elevationDeg: orbitEl, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 } },
  { id: 'left', azimuthDeg: 270, elevationDeg: orbitEl, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 } },
  { id: 'top', azimuthDeg: az, elevationDeg: 62, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 } },
  // lighting checks (img2threejs surface + lighting passes): reference-matched and grazing light on the
  // fixed view, and a grazing close-up of one named part (--focus=<mesh name>)
  { id: 'fixed-reference', azimuthDeg: az, elevationDeg: el, fov, width: RW, height: RH, frame: ndc, light: 'reference' },
  { id: 'fixed-grazing', azimuthDeg: az, elevationDeg: el, fov, width: RW, height: RH, frame: ndc, light: 'grazing' },
  // --pose=<json>: an action pose on the factory's pivot nodes (interaction pass evidence), rendered
  // from the fixed camera and from the front orbit
  ...(args.pose ? [
    { id: 'posed-fixed', azimuthDeg: az, elevationDeg: el, fov, width: RW, height: RH, frame: ndc, pose: JSON.parse(String(args.pose)) },
    { id: 'posed-front', azimuthDeg: 0, elevationDeg: orbitEl, fov, width: 768, height: 768, frame: { mode: 'fit', margin: 1.3 }, pose: JSON.parse(String(args.pose)) },
  ] : []),
  ...(args.focus ? [{ id: 'closeup-grazing', azimuthDeg: az + 8, elevationDeg: 10, fov: 24, width: 768, height: 768,
    frame: { mode: 'fit', margin: 1.15 }, focus: String(args.focus), light: 'grazing' }] : []),
];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const LIB_PARENT = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
const LIB_DIR = path.join(LIB_PARENT, 'lib');
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  fs.mkdirSync(LIB_PARENT, { recursive: true });
  const br = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
  const tar = path.join(LIB_PARENT, 'al2023.tar');
  fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', tar, '-C', LIB_PARENT]);
  fs.rmSync(tar);
}
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true, protocolTimeout: 300000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
let result;
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/tools/img2threejs-harness.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.harnessReady === true, { timeout: 60000 });
  if (args['fit-camera']) {
    const refMask = gateMask(rdata, RW, RH);
    const fitW = 352, fitH = Math.round(352 * RH / RW);
    const evalSet = async (cands) => {
      const res = await page.evaluate((o) => window.renderModel(o), {
        moduleUrl: `/tools/.cache/img2threejs/${bundleName}?v=fit`, exportName, bg: ref.bg, exposure: 1.25, shadowOpacity: 0,
        views: cands.map((c, k) => ({ id: `c${k}`, azimuthDeg: c.az, elevationDeg: c.el, fov: c.fov, width: fitW, height: fitH, frame: ndc, clay: true })),
      });
      const out = [];
      for (let k = 0; k < cands.length; k++) out.push({ ...cands[k], iou: +iouOf(refMask, await maskFromDataUrl(res.shots[`c${k}`])).toFixed(4) });
      return out;
    };
    const grid = [];
    for (let a = az - 24; a <= az + 24; a += 4) for (let e = 4; e <= 40; e += 4) grid.push({ az: a, el: e, fov });
    let results = await evalSet(grid);
    results.sort((p, q) => q.iou - p.iou);
    const top = results[0];
    const fine = [];
    for (let a = top.az - 3; a <= top.az + 3; a += 1) for (let e = Math.max(1, top.el - 3); e <= top.el + 3; e += 1) for (const f of [fov - 8, fov - 4, fov, fov + 4]) fine.push({ az: a, el: e, fov: f });
    const fineRes = (await evalSet(fine)).sort((p, q) => q.iou - p.iou);
    const fit = { coarse: results.slice(0, 12), fine: fineRes.slice(0, 12), best: fineRes[0], evaluated: grid.length + fine.length,
      note: 'Silhouette camera fit (analysis-by-synthesis): clay renders vs the reference foreground mask, IoU on the Tier-1 224 grid.' };
    fs.writeFileSync(path.join(OUT, 'camera-fit.json'), JSON.stringify(fit, null, 2));
    console.log(JSON.stringify({ best: fit.best, coarseBest: results[0], evaluated: fit.evaluated }));
    await browser.close(); server.kill('SIGTERM'); process.exit(0);
  }
  result = await page.evaluate((o) => window.renderModel(o), {
    moduleUrl: `/tools/.cache/img2threejs/${bundleName}?v=${Date.now()}`, exportName, bg: ref.bg, views,
    exposure: Number(args.exposure || 1.25), exportMeshes: true, buildOptions: { textureSize: 256 },
    shadowOpacity: Number(args.shadow ?? 0),
  });
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
for (const [id, url] of Object.entries(result.shots)) fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'meshes.json'), JSON.stringify({ meshes: result.meshes }));
fs.writeFileSync(path.join(OUT, 'nodes.json'), JSON.stringify(result.nodes, null, 1));
fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify(result.parts, null, 1));
const report = { asset: path.relative(ROOT, ASSET), pass: args.pass, factory: path.relative(ROOT, TS), exportName,
  bundle: path.relative(ROOT, path.join(cacheDir, bundleName)), reference: ref, stats: result.info, framing: result.framing, errors };
fs.writeFileSync(path.join(OUT, 'render.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), stats: result.info, errors: errors.length, refBbox: ref.bbox, bg: ref.bg }));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
