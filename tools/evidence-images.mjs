/* DUSKHOLD — small image jobs for QA evidence.
 *
 *   node tools/evidence-images.mjs half <srcDir> <dstDir> [scale=0.5]
 *     every PNG in srcDir, resized (the land-*.png evidence is kept at half
 *     of its DPR-2 capture: 844 x 390).
 *   node tools/evidence-images.mjs compare <beforeDir> <afterDir> <outDir> [--before=label] [--after=label] [--shots=name:caption;...]
 *     before/after pairs of tools/survival-look.mjs captures (same script,
 *     same moment, two builds), stacked with a label band each:
 *     outDir/compare-<shot>.png (default shots: south, wide, fight, day).
 *   node tools/evidence-images.mjs levels <out.png> [--crop=x,y,w,h] [--title=text] [--height=360] <img|label> ...
 *     the same moment at several levels (BUILD 14: a guard's bow Lv1/Lv2/Lv3)
 *     side by side, each cropped to the same box (source px) under a label
 *     band, with a title band over the row.
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
} else if (cmd === 'levels') {
  const out = a;
  const panels = positional.slice(2).map((row) => { const i = row.indexOf('|'); return [row.slice(0, i), row.slice(i + 1)]; });
  const imgs = [];
  for (const [file] of panels) imgs.push(await loadImage(file));
  const crop = flags.crop ? String(flags.crop).split(',').map(Number) : [0, 0, imgs[0].width, imgs[0].height];
  const PH = Number(flags.height || 360);
  const PW = Math.round(PH * crop[2] / crop[3]);
  const band = 30, title = flags.title ? 34 : 0, gap = 8;
  const canvas = createCanvas(panels.length * PW + (panels.length - 1) * gap, title + band + PH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14122a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  if (title) {
    ctx.fillStyle = '#2a2f62';
    ctx.fillRect(0, 0, canvas.width, title);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(String(flags.title), 12, title / 2 + 1);
  }
  const colors = ['#5a4a3a', '#2f5bd0', '#b8860b', '#555555'];
  panels.forEach(([, label], i) => {
    const x = i * (PW + gap);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, title, PW, band);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(label, x + 10, title + band / 2 + 1);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgs[i], crop[0], crop[1], crop[2], crop[3], x, title + band, PW, PH);
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`levels: ${out} (${canvas.width} x ${canvas.height})`);
} else {
  console.log('usage: evidence-images.mjs half <src> <dst> [scale] | compare <beforeDir> <afterDir> <outDir> | levels <out.png> <img|label> ...');
  process.exit(1);
}
