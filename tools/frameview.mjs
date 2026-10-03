/* frameview.mjs — read a frame as text.
 *
 * I cannot look at a photograph of the game, but I can read one: this prints
 * a frame as a luminance ramp so the composition is legible — where the floor
 * is, where the walls stand, whether the woman is in the picture and how big
 * she is against the things around her.
 *
 *   node tools/frameview.mjs shot.png [cols] [x0,y0,x1,y1]
 *   node tools/frameview.mjs a.png b.png 40      where two frames differ
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';

const RAMP = ' .:-=+*#%@';
const args = process.argv.slice(2);
const fa = args[0];
const cols = Number(args[1]) || 96;
const region = args[2] && args[2].includes(',') ? args[2].split(',').map(Number) : null;
const fb = args[1] && String(args[1]).endsWith('.png') ? args[1] : null;
const cols2 = fb ? (Number(args[2]) || 96) : cols;
const region2 = fb ? (args[3] ? args[3].split(',').map(Number) : null) : region;

const load = async (f) => {
  const img = await loadImage(f);
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  return { d: x.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
};

const A = await load(fa);
const B = fb ? await load(fb) : null;
const [rx0, ry0, rx1, ry1] = (B ? region2 : region) || [0, 0, A.w, A.h];
const rw = rx1 - rx0, rh = ry1 - ry0;
const cw = rw / (B ? cols2 : cols);
const rows = Math.max(1, Math.round(rh / (cw * 2.1)));
const ch = rh / rows;

console.log(`--- ${fa}${B ? ' vs ' + fb : ''} [${rx0},${ry0}-${rx1},${ry1}] ${Math.round(cols)}x${rows} (1 char = ${cw.toFixed(1)}x${ch.toFixed(1)}px) ---`);
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < (B ? cols2 : cols); c++) {
    const x = Math.min(A.w - 1, Math.floor(rx0 + c * cw + cw / 2));
    const y = Math.min(A.h - 1, Math.floor(ry0 + r * ch + ch / 2));
    const i = (y * A.w + x) * 4;
    if (B) {
      const j = i;
      const d = Math.abs(A.d[j] - B.d[j]) + Math.abs(A.d[j + 1] - B.d[j + 1]) + Math.abs(A.d[j + 2] - B.d[j + 2]);
      line += d > 120 ? '#' : d > 60 ? '+' : d > 24 ? '.' : ' ';
    } else {
      const lum = (A.d[i] * 0.299 + A.d[i + 1] * 0.587 + A.d[i + 2] * 0.114) / 255;
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
    }
  }
  console.log(String(r).padStart(3) + '|' + line);
}
