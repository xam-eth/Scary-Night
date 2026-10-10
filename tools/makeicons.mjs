/* DUSKHOLD — Play/PWA app icons.
 *
 * Launcher icons stay emblem-only: lettering is unreadable at icon size.
 * The existing mark.svg is retained as the source. Key art, including the
 * Play feature graphic, is generated separately by `tools/brandassets.mjs`
 * so rebuilding an icon can never overwrite the DUSKHOLD artwork.
 *
 *   node tools/makeicons.mjs
 *
 * Writes into assets/brand/:
 *   icon-192.png           PWA icon (Chrome installability)
 *   icon-512.png           PWA + Bubblewrap + Play Store icon
 *   icon-maskable-512.png  Android adaptive icon, with the emblem in the
 *                          80% safe area
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const INK = '#05060b';
const mark = await loadImage(path.join(BRAND, 'mark.svg'));

function write(name, canvas) {
  const file = path.join(BRAND, name);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  return { name, bytes: fs.statSync(file).size };
}

/** The emblem, full bleed, at any size. */
function icon(size) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(mark, 0, 0, size, size);
  return canvas;
}

/** The emblem pulled inside the maskable safe zone. */
function maskable(size, fill = 0.62) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, size, size);
  const markSize = Math.round(size * fill);
  ctx.drawImage(mark, Math.round((size - markSize) / 2), Math.round((size - markSize) / 2), markSize, markSize);
  return canvas;
}

const out = [
  write('icon-192.png', icon(192)),
  write('icon-512.png', icon(512)),
  write('icon-maskable-512.png', maskable(512)),
];
for (const item of out) console.log(`  ${item.name.padEnd(28)} ${(item.bytes / 1024).toFixed(0)} KB`);
console.log('DUSKHOLD emblem icons written to assets/brand/');
