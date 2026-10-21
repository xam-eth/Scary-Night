/* DUSKHOLD — overview sheets for ASSET_CHARACTER (the generated character
 * and weapon concept images; see ASSET_CHARACTER/README.md).
 *
 *   node tools/asset-sheet.mjs
 *
 * Reads the transparent cut-outs in ASSET_CHARACTER/cutout/ (made by
 * tools/asset-cutout.py) and writes:
 *   ASSET_CHARACTER/preview/characters.jpg  the roster side by side, to scale
 *                                           by role (the boss and the breaker
 *                                           stand taller), with names
 *   ASSET_CHARACTER/preview/weapons.jpg     every weapon by owner and level;
 *                                           a weapon not generated yet shows
 *                                           as a dashed "MENYUSUL" slot
 *   ASSET_CHARACTER/preview/palette.png     the colour palette (hex)
 * The source images are only read.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'ASSET_CHARACTER');
const CUT = path.join(DIR, 'cutout');
const OUT = path.join(DIR, 'preview');

// height: the figure's height relative to the captain (to scale in the lineup)
export const ROSTER = [
  { file: '01-captain-duskhold', name: 'KAPTEN DUSKHOLD', role: 'Pemain · Captain', side: 'ally', height: 1.0 },
  { file: '02-guard', name: 'PRAJURIT PENJAGA', role: 'Guard · Barracks', side: 'ally', height: 0.97 },
  { file: '03-enemy-ghoul', name: 'GHOUL', role: 'Musuh · swarm', side: 'enemy', height: 0.97 },
  { file: '04-enemy-undead-soldier', name: 'PRAJURIT MAYAT', role: 'Musuh · individual', side: 'enemy', height: 1.0 },
  { file: '05-enemy-breaker', name: 'PENDOBRAK', role: 'Musuh · breaker', side: 'enemy', height: 1.18 },
  { file: '06-boss-night-lord', name: 'RAJA MALAM', role: 'Boss · baru', side: 'boss', height: 1.24 },
];

export const WEAPONS = [
  { owner: 'KAPTEN', items: [
    { file: 'captain-crossbow-lv1', name: 'Crossbow Lv1', note: 'Armory Lv1' },
    { file: 'captain-crossbow-lv2', name: 'Crossbow Lv2', note: 'Armory Lv2 · tembus' },
    { file: 'captain-crossbow-lv3', name: 'Crossbow Lv3', note: 'Armory Lv3 · 3 baut' },
    { file: 'captain-sword', name: 'Pedang', note: 'jarak dekat' },
  ] },
  { owner: 'PRAJURIT', items: [
    { file: 'guard-crossbow-lv1', name: 'Crossbow Lv1', note: 'Barracks Lv1' },
    { file: 'guard-crossbow-lv2', name: 'Crossbow Lv2', note: 'Barracks Lv2' },
    { file: 'guard-crossbow-lv3', name: 'Crossbow Lv3', note: 'Barracks Lv3' },
    { file: 'guard-shield', name: 'Perisai', note: 'tangan kiri' },
  ] },
  { owner: 'MUSUH', items: [
    { file: 'ghoul-cleaver', name: 'Golok berkarat', note: 'Ghoul' },
    { file: 'undead-soldier-axe', name: 'Kapak', note: 'Prajurit Mayat' },
    { file: 'breaker-maul', name: 'Palu godam', note: 'Pendobrak' },
    { file: 'night-lord-greatsword', name: 'Pedang besar', note: 'Raja Malam' },
  ] },
];

export const PALETTE = [
  ['Biru kerajaan', '#216aad', 'tabard Kapten, panji'],
  ['Biru prajurit', '#325389', 'gambeson prajurit'],
  ['Emas', '#e6b459', 'lis, lambang menara'],
  ['Baja', '#dedcda', 'zirah, helm'],
  ['Kulit cokelat', '#68412d', 'sabuk, sepatu, topi'],
  ['Kulit mayat', '#b8b99b', 'kulit musuh'],
  ['Merah tua', '#7c2d37', 'kain musuh'],
  ['Karat', '#744f39', 'besi musuh'],
  ['Ungu malam', '#4c325e', 'jubah Raja Malam'],
  ['Hijau rune', '#42b882', 'cahaya Raja Malam'],
  ['Mata', '#dfe668', 'mata menyala'],
];

const exists = (f) => fs.existsSync(f);
const cut = (kind, file) => path.join(CUT, kind, `${file}.png`);

function label(ctx, text, x, y, size, color, weight = 'bold', align = 'center') {
  ctx.font = `${weight} ${size}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

async function characters() {
  const colW = 300, figH = 640, top = 70, W = colW * ROSTER.length, H = top + figH + 96;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#cfe6f7');
  sky.addColorStop(0.78, '#eef6fb');
  sky.addColorStop(0.78, '#8fbf62');
  sky.addColorStop(1, '#6f9f48');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'ASSET_CHARACTER · roster (konsep untuk model 3D)', 20, 40, 26, '#1d2b45', 'bold', 'left');
  const ground = top + figH;
  for (let i = 0; i < ROSTER.length; i++) {
    const r = ROSTER[i];
    const cx = i * colW + colW / 2;
    const f = cut('characters', r.file);
    if (exists(f)) {
      const img = await loadImage(f);
      const h = figH * 0.8 * r.height;
      const w = img.width * (h / img.height);
      const s = Math.min(1, (colW - 16) / w);
      ctx.save();
      ctx.fillStyle = 'rgba(30,40,20,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx, ground - 6, w * s * 0.32, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(img, cx - (w * s) / 2, ground - h * s, w * s, h * s);
    }
    const tone = r.side === 'ally' ? '#173a7a' : r.side === 'boss' ? '#4c1d6b' : '#6e1f2a';
    label(ctx, r.name, cx, ground + 38, 22, '#ffffff');
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(i * colW + 18, ground + 50, colW - 36, 30);
    ctx.globalAlpha = 1;
    label(ctx, r.role, cx, ground + 71, 17, '#ffffff', '600');
  }
  return canvas;
}

async function weapons() {
  const cellW = 300, cellH = 230, head = 70, rowLabel = 150;
  const cols = 4, rows = WEAPONS.length;
  const W = rowLabel + cols * cellW + 20, H = head + rows * cellH + 20;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef3f8';
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'ASSET_CHARACTER · senjata terpisah (bisa ditempel & di-upgrade)', 20, 42, 26, '#1d2b45', 'bold', 'left');
  let missing = 0;
  for (let r = 0; r < rows; r++) {
    const row = WEAPONS[r];
    const y0 = head + r * cellH;
    label(ctx, row.owner, 20, y0 + cellH / 2, 24, '#1d2b45', 'bold', 'left');
    for (let c = 0; c < row.items.length; c++) {
      const it = row.items[c];
      const x0 = rowLabel + c * cellW;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0 + 8, y0 + 8, cellW - 16, cellH - 16);
      const f = cut('weapons', it.file);
      if (exists(f)) {
        const img = await loadImage(f);
        const maxW = cellW - 40, maxH = cellH - 84;
        const s = Math.min(maxW / img.width, maxH / img.height);
        ctx.drawImage(img, x0 + cellW / 2 - (img.width * s) / 2, y0 + 20 + (maxH - img.height * s) / 2, img.width * s, img.height * s);
      } else {
        missing++;
        ctx.save();
        ctx.strokeStyle = '#9aa7b8';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(x0 + 24, y0 + 22, cellW - 48, cellH - 96);
        ctx.restore();
        label(ctx, 'MENYUSUL', x0 + cellW / 2, y0 + 22 + (cellH - 96) / 2 + 8, 22, '#7d8a9c');
      }
      label(ctx, it.name, x0 + cellW / 2, y0 + cellH - 42, 19, '#1d2b45');
      label(ctx, it.note, x0 + cellW / 2, y0 + cellH - 20, 15, '#55657a', '600');
    }
  }
  return { canvas, missing };
}

function palette() {
  const sw = 150, W = sw * PALETTE.length, H = 210;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  PALETTE.forEach(([name, hex, use], i) => {
    ctx.fillStyle = hex;
    ctx.fillRect(i * sw + 8, 8, sw - 16, 110);
    label(ctx, hex, i * sw + sw / 2, 144, 18, '#1d2b45');
    label(ctx, name, i * sw + sw / 2, 168, 15, '#1d2b45', '600');
    label(ctx, use, i * sw + sw / 2, 190, 12, '#55657a', '500');
  });
  return canvas;
}

fs.mkdirSync(OUT, { recursive: true });
const ch = await characters();
fs.writeFileSync(path.join(OUT, 'characters.jpg'), ch.toBuffer('image/jpeg', 90));
const { canvas: wp, missing } = await weapons();
fs.writeFileSync(path.join(OUT, 'weapons.jpg'), wp.toBuffer('image/jpeg', 90));
fs.writeFileSync(path.join(OUT, 'palette.png'), palette().toBuffer('image/png'));
console.log(`asset-sheet: preview/characters.jpg, preview/weapons.jpg (${missing} weapon(s) still to generate), preview/palette.png`);
