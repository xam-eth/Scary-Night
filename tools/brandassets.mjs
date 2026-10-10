/* DUSKHOLD brand plates. Run from this directory with `node brandassets.mjs`.
 * Source: the original AI-generated dusk-fortress master plus the hand-built,
 * outlined SVG wordmark. All crops share one scene; no lettering is baked into
 * the clean plates. `convert` is used only to palette-encode the Play PNG. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'assets/brand');
const SOURCE_PNG = path.join(BRAND, 'duskhold-master-clean.png');
const SOURCE_JPG = path.join(BRAND, 'duskhold-master-clean.jpg');
const LOCKUP = path.join(BRAND, 'wordmark-duskhold-lockup.svg');
const MAX_BYTES = 600 * 1024;

const saveJpeg = (canvas, file, quality = 86) => {
  fs.writeFileSync(file, canvas.toBuffer('image/jpeg', quality));
};
function cover(ctx, image, width, height, focalX = 0.5, focalY = 0.5, zoom = 1) {
  const want = width / height;
  let sw = image.width, sh = image.height;
  if (sw / sh > want) sw = sh * want; else sh = sw / want;
  sw /= zoom; sh /= zoom;
  const sx = Math.max(0, Math.min(image.width - sw, (image.width - sw) * focalX));
  const sy = Math.max(0, Math.min(image.height - sh, (image.height - sh) * focalY));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}
function drawLockup(ctx, image, width, height, { x = 0, y = 0, anchor = 'center' } = {}) {
  const aspect = image.width / image.height;
  const w = width;
  const h = w / aspect;
  const left = anchor === 'left' ? x : x - w / 2;
  ctx.drawImage(image, left, y, w, h);
}
async function makeJpeg(name, size, focalX, focalY, opts = {}) {
  const [w, h] = size;
  const canvas = createCanvas(w, h), ctx = canvas.getContext('2d');
  cover(ctx, master, w, h, focalX, focalY, opts.zoom || 1);
  if (opts.dark) {
    ctx.fillStyle = `rgba(3,4,9,${opts.dark})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (opts.logo) {
    const position = { ...opts.logo, x: opts.logo.x ?? w / 2 };
    drawLockup(ctx, lockup, position.width, h, position);
  }
  const file = path.join(BRAND, name);
  saveJpeg(canvas, file, opts.quality || 86);
  verify(file, w, h);
}
function verify(file, w, h) {
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_BYTES) throw new Error(`${path.basename(file)} is ${bytes} bytes (limit ${MAX_BYTES})`);
  console.log(`${path.basename(file)}  ${w}x${h}  ${(bytes / 1024).toFixed(1)} KB`);
}
async function makeFeaturePng(name, branded) {
  const w = 1024, h = 500;
  const canvas = createCanvas(w, h), ctx = canvas.getContext('2d');
  cover(ctx, master, w, h, 0.5, 0.50);
  if (branded) drawLockup(ctx, lockup, 390, h, { x: 42, y: 26, anchor: 'left' });
  const raw = path.join(os.tmpdir(), `duskhold-${process.pid}-${name}`);
  fs.writeFileSync(raw, canvas.toBuffer('image/png'));
  const out = path.join(BRAND, name);
  try {
    execFileSync('convert', [raw, '-strip', '-dither', 'FloydSteinberg', '-colors', '256', '-depth', '8', `PNG8:${out}`]);
  } finally { fs.rmSync(raw, { force: true }); }
  verify(out, w, h);
}

if (!fs.existsSync(SOURCE_JPG)) {
  if (!fs.existsSync(SOURCE_PNG)) throw new Error('Missing duskhold-master-clean source art.');
  const original = await loadImage(SOURCE_PNG);
  const masterCanvas = createCanvas(original.width, original.height);
  masterCanvas.getContext('2d').drawImage(original, 0, 0);
  saveJpeg(masterCanvas, SOURCE_JPG, 89);
}
// Keep the PNG as the crop source whenever the original is present; the JPEG
// beside it is a compact clean-master deliverable, not an intermediate that
// should add a lossy generation to every finished plate.
const master = await loadImage(fs.existsSync(SOURCE_PNG) ? SOURCE_PNG : SOURCE_JPG);
const lockup = await loadImage(LOCKUP);
if (!master.width || !lockup.width) throw new Error('Could not load the master or outlined SVG lockup.');

// Requested transparent wordmark PNGs, 2048 px wide.
for (const [svg, png] of [
  ['wordmark-duskhold.svg', 'wordmark-duskhold.png'],
  ['wordmark-duskhold-gold.svg', 'wordmark-duskhold-gold.png'],
  ['wordmark-duskhold-lockup.svg', 'wordmark-duskhold-lockup.png'],
]) {
  const image = await loadImage(path.join(BRAND, svg));
  const canvas = createCanvas(2048, Math.round(2048 * image.height / image.width));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const out = path.join(BRAND, png);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  if (fs.statSync(out).size > MAX_BYTES) throw new Error(`${png} exceeds ${MAX_BYTES} bytes`);
  console.log(`${png}  ${canvas.width}x${canvas.height}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}

// 9:16 crops: the tower stays centred; the loading plate is a closer, darker crop.
await makeJpeg('menu-9x16-clean.jpg', [1080, 1920], 0.51, 0.53);
await makeJpeg('menu-9x16.jpg', [1080, 1920], 0.51, 0.53, { logo: { width: 790, y: 74 }, quality: 85 });
await makeJpeg('loading-9x16-clean.jpg', [1080, 1920], 0.51, 0.54, { zoom: 1.08, dark: 0.16 });
await makeJpeg('loading-9x16.jpg', [1080, 1920], 0.51, 0.54, { zoom: 1.08, dark: 0.16, logo: { width: 760, y: 64 }, quality: 84 });

// Landscape deliverables are crops from the same master, with a central safe area.
await makeJpeg('hero-16x9-clean.jpg', [1920, 1080], 0.5, 0.5, { quality: 86 });
await makeJpeg('hero-16x9.jpg', [1920, 1080], 0.5, 0.5, { logo: { width: 610, x: 66, y: 46, anchor: 'left' }, quality: 86 });
await makeJpeg('social-1200x630-clean.jpg', [1200, 630], 0.5, 0.5, { quality: 86 });
await makeJpeg('social-1200x630.jpg', [1200, 630], 0.5, 0.5, { logo: { width: 510, x: 48, y: 28, anchor: 'left' }, quality: 86 });
await makeFeaturePng('play-feature-1024x500-clean.png', false);
await makeFeaturePng('play-feature-1024x500.png', true);

console.log('DUSKHOLD brand plates built from one clean master.');
