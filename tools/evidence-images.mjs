/* DUSKHOLD — small image jobs for QA evidence.
 *
 *   node tools/evidence-images.mjs half <srcDir> <dstDir> [scale=0.5]
 *     every PNG in srcDir, resized (the land-*.png evidence is kept at half
 *     of its DPR-2 capture: 844 x 390).
 *   node tools/evidence-images.mjs compare <beforeDir> <afterDir> <outDir> [--before=label] [--after=label] [--shots=name:caption;...]
 *     before/after pairs of tools/survival-look.mjs captures (same script,
 *     same moment, two builds), stacked with a label band each:
 *     outDir/compare-<shot>.png (default shots: south, wide, fight, day).
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--')).map((x) => {
  const i = x.indexOf('=');
  return i < 0 ? [x.slice(2), true] : [x.slice(2, i), x.slice(i + 1)];
}));
const [cmd, a, b, c] = positional;

if (cmd === 'half') {
  const scale = Number(c || 0.5);
  fs.mkdirSync(b, { recursive: true });
  for (const f of fs.readdirSync(a)) {
    if (!f.endsWith('.png')) continue;
    const img = await loadImage(path.join(a, f));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    fs.writeFileSync(path.join(b, f), canvas.toBuffer('image/png'));
  }
  console.log(`half: ${a} → ${b} (x${scale})`);
} else if (cmd === 'compare') {
  fs.mkdirSync(c, { recursive: true });
  const shots = flags.shots ? String(flags.shots).split(';').map((row) => { const i = row.indexOf(':'); return [row.slice(0, i), row.slice(i + 1)]; }) : [
    ['south', 'Gerbang utama, malam 1 (detik 26)'],
    ['wide', 'Benteng dari dekat keep, malam 1 (detik 24)'],
    ['fight', 'Gerbang utara, malam 1 (detik 11)'],
    ['day', 'Hari 2: barak, sawmill, guard'],
  ];
  const beforeLabel = flags.before || 'SEBELUM (0df19b6)';
  const afterLabel = flags.after || 'SESUDAH (build 8)';
  for (const [name, caption] of shots) {
    const before = await loadImage(path.join(a, `${name}.png`));
    const after = await loadImage(path.join(b, `${name}.png`));
    const W = 844, H = 390, band = 34;
    const canvas = createCanvas(W, (H + band) * 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14122a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const label = (y, text, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, y, W, band);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 17px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 12, y + band / 2 + 1);
    };
    label(0, `${beforeLabel} — ${caption}`, '#7a2a2a');
    ctx.drawImage(before, 0, band, W, H);
    label(H + band, `${afterLabel} — ${caption}`, '#25713a');
    ctx.drawImage(after, 0, H + band * 2, W, H);
    fs.writeFileSync(path.join(c, `compare-${name}.png`), canvas.toBuffer('image/png'));
  }
  console.log(`compare: ${c}/compare-*.png`);
} else {
  console.log('usage: evidence-images.mjs half <src> <dst> [scale] | compare <beforeDir> <afterDir> <outDir>');
  process.exit(1);
}
