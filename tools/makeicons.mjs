/* LAST NIGHT — every icon the Play build needs, drawn from the brand mark.
 *
 * The mark is the one piece of art the game already owns (assets/brand/
 * mark.svg: a ring, a moon, a lit pane, one drop of blood on near-black).
 * Everything the store and the launcher ask for is that mark at another
 * size, plus a wordmark set in the same serif the game uses. Nothing here
 * is hand-drawn, so a change to the mark is one run away from every icon.
 *
 *   node tools/makeicons.mjs
 *
 * Writes into assets/brand/:
 *   icon-192.png           PWA icon (Chrome installability)
 *   icon-512.png           PWA + Bubblewrap + Play Store icon (512 is the
 *                          minimum Bubblewrap accepts and what Play wants)
 *   icon-maskable-512.png  Android adaptive icon — the mark pulled inside
 *                          the 80% safe circle so no mask crops it
 *   play-feature-1024x500.png  Play Store feature graphic
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const INK = '#05060b';        // the near-black every screen in the game sits on
const BONE = '#e6e1d2';       // the mark's light stroke
const GOLD = '#a8833c';       // the ring
const BLOOD = '#7d1220';

const mark = await loadImage(path.join(BRAND, 'mark.svg'));

function write(name, canvas) {
  const file = path.join(BRAND, name);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
  return { name, bytes: fs.statSync(file).size };
}

/** The mark, full bleed, at any size. */
function icon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.drawImage(mark, 0, 0, size, size);
  return c;
}

/** The mark pulled inside the maskable safe zone (a circle 80% of the box). */
function maskable(size, fill = 0.62) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, size, size);
  const s = Math.round(size * fill);
  ctx.drawImage(mark, Math.round((size - s) / 2), Math.round((size - s) / 2), s, s);
  return c;
}

/* ---- the feature graphic ----
 * 1024x500. Play crops the edges on some surfaces, so the mark and the
 * wordmark live inside a centred 900px band.
 */
function feature() {
  const W = 1024, H = 500;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);

  // one warm pool of light, the way a lit window falls on a floor
  const glow = ctx.createRadialGradient(W * 0.30, H * 0.52, 10, W * 0.30, H * 0.52, W * 0.42);
  glow.addColorStop(0, 'rgba(255,178,87,0.20)');
  glow.addColorStop(0.45, 'rgba(168,131,60,0.10)');
  glow.addColorStop(1, 'rgba(5,6,11,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // a cold rim from the other side, so it is a room and not a gradient
  const cold = ctx.createRadialGradient(W * 0.86, H * 0.16, 10, W * 0.86, H * 0.16, W * 0.40);
  cold.addColorStop(0, 'rgba(120,150,190,0.12)');
  cold.addColorStop(1, 'rgba(5,6,11,0)');
  ctx.fillStyle = cold;
  ctx.fillRect(0, 0, W, H);

  // the mark, left of centre
  const size = 300;
  ctx.drawImage(mark, 96, Math.round((H - size) / 2), size, size);

  // the wordmark
  const x = 96 + size + 56;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BONE;
  ctx.font = '86px serif';
  ctx.fillText('LAST NIGHT', x, H / 2 - 6);

  // a rule the width of the wordmark, in the ring's gold
  const ruleW = Math.min(ctx.measureText('LAST NIGHT').width, W - x - 96);
  ctx.fillStyle = GOLD;
  ctx.fillRect(x, H / 2 + 18, ruleW, 2);

  ctx.fillStyle = 'rgba(230,225,210,0.78)';
  ctx.font = '30px serif';
  ctx.fillText('Survive until dawn.', x, H / 2 + 68);

  // one drop of blood under the rule — the mark's own accent, not decoration
  ctx.fillStyle = BLOOD;
  ctx.beginPath();
  ctx.arc(x + ruleW - 4, H / 2 + 19, 5, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

const out = [
  write('icon-192.png', icon(192)),
  write('icon-512.png', icon(512)),
  write('icon-maskable-512.png', maskable(512)),
  write('play-feature-1024x500.png', feature()),
];
for (const o of out) console.log(`  ${o.name.padEnd(28)} ${(o.bytes / 1024).toFixed(0)} KB`);
console.log('icons written to assets/brand/');
