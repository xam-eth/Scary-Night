// LAST NIGHT — brand kit generator.
// Rasterises the logo system, store assets and social templates into assets/brand/.
// Run: node tools/brandkit.mjs   (needs: cd tools && npm i)
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'assets', 'brand');
mkdirSync(OUT, { recursive: true });

GlobalFonts.registerFromPath(path.join(HERE, 'fonts', 'Gelasio.ttf'), 'Gelasio');
GlobalFonts.registerFromPath(path.join(HERE, 'fonts', 'Lato-Regular.ttf'), 'Lato');

// ---- palette (single source of truth, mirrors brand/index.html) ----
const C = {
  ink: '#05060b', bone: '#e6e1d2', ash: '#cfc6b0', blood: '#7d1220',
  gold: '#a8833c', candle: '#ffb257', moon: '#8fb6e8',
  sky0: '#070a14', sky1: '#0a101d', sil: '#04060c', silFar: '#0a0f1a',
};
const SERIF = 'Gelasio', SANS = 'Lato';

// ---- tiny utils ----
const mulberry32 = a => () => (a |= 0, a = a + 0x6D2B79F5 | 0,
  ((Math.imul(a ^ a >>> 15, 1 | a) + Math.imul(a ^ a >>> 7, 61 | a) ^ a) >>> 0) / 4294967296);

function tracked(ctx, text, x, y, o) {
  const { px, family = SERIF, tracking = 0.2, color = C.bone, align = 'center' } = o;
  ctx.font = `400 ${px}px "${family}", Georgia, serif`;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = color;
  const tr = px * tracking, chars = [...text];
  const ws = chars.map(ch => ctx.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0) + tr * (chars.length - 1);
  let sx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  chars.forEach((ch, i) => { ctx.fillText(ch, sx, y); sx += ws[i] + tr; });
  return total;
}
const trackedW = (ctx, text, px, family = SERIF, tracking = 0.2) => {
  ctx.font = `400 ${px}px "${family}", Georgia, serif`;
  const tr = px * tracking, chars = [...text];
  return chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + tr * (chars.length - 1);
};

let P2D = null;
try { const m = await import('@napi-rs/canvas'); P2D = m.Path2D; new P2D('M0 0h1v1z'); } catch { P2D = null; }

// ---- the door mark (same geometry as assets/brand/mark.svg, 64u box) ----
function drawMark(ctx, x, y, s, { ring = true } = {}) {
  ctx.save(); ctx.translate(x, y); const k = s / 64; ctx.scale(k, k);
  if (ring) { ctx.strokeStyle = C.gold; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.arc(32, 32, 27.5, 0, 7); ctx.stroke(); }
  // crescent moon (kept clear of the arch)
  ctx.save(); ctx.translate(1.6, -2.2);
  if (P2D) { ctx.fillStyle = C.ash; ctx.fill(new P2D('M40.2 13.2a5.2 5.2 0 1 0 0 7.2 3.8 3.8 0 1 1 0-7.2z')); }
  else {
    ctx.fillStyle = C.ash; ctx.beginPath(); ctx.arc(41.4, 16.8, 5.2, 0, 7); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(43.6, 16.8, 4.1, 0, 7); ctx.fill(); ctx.restore();
  }
  ctx.restore();
  // arched door
  ctx.strokeStyle = C.bone; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(21, 47); ctx.lineTo(21, 29.5);
  ctx.arc(32, 29.5, 11, Math.PI, 0); ctx.lineTo(43, 47); ctx.stroke();
  // candle window
  ctx.fillStyle = '#1a120c'; ctx.fillRect(27.2, 31.2, 9.6, 9.2);
  ctx.fillStyle = C.candle; ctx.fillRect(29.2, 33, 5.6, 5.4);
  // blood drop
  ctx.fillStyle = C.blood;
  ctx.beginPath(); ctx.moveTo(32, 47.4); ctx.lineTo(30.3, 52.6); ctx.lineTo(33.7, 52.6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---- lockups ----
const WORD_TRACK = 0.16, TAG_TRACK = 0.4;
function lockupV(ctx, cx, top, M, col = { word: C.bone, tag: C.gold, rule: C.gold }) {
  drawMark(ctx, cx - M / 2, top, M);
  const px = M * 0.34, wy = top + M + M * 0.16 + px;
  const w = tracked(ctx, 'LAST NIGHT', cx, wy, { px, tracking: WORD_TRACK, color: col.word });
  ctx.fillStyle = col.rule; ctx.fillRect(cx - w / 2, wy + px * 0.42, w, Math.max(1.5, M * 0.008));
  tracked(ctx, 'SURVIVE UNTIL DAWN', cx, wy + px * 0.42 + M * 0.14, { px: M * 0.12, tracking: TAG_TRACK, color: col.tag });
  return wy + px * 0.42 + M * 0.14;
}
const lockupHW = (ctx, M) => M * 1.32 + trackedW(ctx, 'LAST NIGHT', M * 0.42, SERIF, WORD_TRACK);
function lockupH(ctx, x, cy, M, col = { word: C.bone, tag: C.gold, rule: C.gold }) {
  drawMark(ctx, x, cy - M / 2, M);
  const tx = x + M * 1.32, px = M * 0.42;
  const w = tracked(ctx, 'LAST NIGHT', tx, cy - M * 0.02, { px, tracking: WORD_TRACK, color: col.word, align: 'left' });
  ctx.fillStyle = col.rule; ctx.fillRect(tx, cy + M * 0.12, w, Math.max(1.5, M * 0.008));
  tracked(ctx, 'SURVIVE UNTIL DAWN', tx, cy + M * 0.40, { px: M * 0.15, tracking: TAG_TRACK, color: col.tag, align: 'left' });
  return tx + w;
}
const centerH = (ctx, w, cy, M, col) => lockupH(ctx, (w - lockupHW(ctx, M)) / 2, cy, M, col);
function chip(ctx, cx, cy, label, px = 20) {
  const w = trackedW(ctx, label, px, SANS, 0.32) + px * 2.4, h = px * 2.6;
  ctx.strokeStyle = 'rgba(168,131,60,0.9)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  tracked(ctx, label, cx, cy + px * 0.36, { px, family: SANS, tracking: 0.32, color: C.gold });
}

// ---- procedural night scene (the brand's secondary art style) ----
function scene(ctx, w, h, { seed = 7, moonAt = [0.78, 0.2] } = {}) {
  const rng = mulberry32(seed);
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.sky0); g.addColorStop(0.55, C.sky1); g.addColorStop(1, C.ink);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // stars
  const [mfx, mfy] = moonAt, mr = Math.min(w, h) * 0.055, mx = w * mfx, my = h * mfy;
  for (let i = 0; i < 170; i++) {
    const x = rng() * w, y = rng() * h * 0.62, a = 0.12 + rng() * 0.5;
    if (Math.hypot(x - mx, y - my) < mr * 4) continue;
    ctx.fillStyle = `rgba(230,225,210,${a.toFixed(2)})`;
    ctx.fillRect(x, y, rng() < 0.85 ? 1.5 : 2.5, rng() < 0.85 ? 1.5 : 2.5);
  }
  // moon
  g = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 6);
  g.addColorStop(0, 'rgba(143,182,232,0.30)'); g.addColorStop(1, 'rgba(143,182,232,0)');
  ctx.fillStyle = g; ctx.fillRect(mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
  ctx.fillStyle = '#e9e6da'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(5,6,11,0.08)';
  [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.35, 0.12]].forEach(([dx, dy, r]) => {
    ctx.beginPath(); ctx.arc(mx + dx * mr, my + dy * mr, r * mr, 0, 7); ctx.fill();
  });
  // far ridge
  ctx.fillStyle = C.silFar; ctx.beginPath(); ctx.moveTo(0, h * 0.74);
  for (let x = 0; x <= w; x += w / 24) ctx.lineTo(x, h * (0.74 + Math.sin(x * 0.01 + seed) * 0.012));
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  // mansion silhouette
  const gy = h * 0.88, sil = C.sil;
  ctx.fillStyle = sil;
  ctx.fillRect(w * 0.27, h * 0.66, w * 0.46, gy - h * 0.66); // main body
  const towers = [
    [0.50, 0.050, 0.30, 0.115], [0.40, 0.062, 0.47, 0.075], [0.60, 0.062, 0.45, 0.085],
    [0.305, 0.070, 0.55, 0.055], [0.695, 0.070, 0.53, 0.060],
  ];
  const wins = [];
  for (const [tx, tw, top, sp] of towers) {
    const bx = w * tx - w * tw / 2, bw = w * tw, ty = h * top;
    ctx.fillRect(bx, ty, bw, gy - ty);
    ctx.beginPath(); ctx.moveTo(bx - bw * 0.12, ty); ctx.lineTo(w * tx, h * (top - sp)); ctx.lineTo(bx + bw * 1.12, ty); ctx.closePath(); ctx.fill();
    ctx.fillRect(w * tx - 1.5, h * (top - sp) - h * 0.03, 3, h * 0.03); // finial
    wins.push([w * tx, h * top + h * 0.05]);
  }
  // lit windows
  for (const [wx, wy] of [wins[0], wins[2]]) {
    const ww = Math.max(3, w * 0.006), wh = ww * 1.8;
    g = ctx.createRadialGradient(wx, wy, 1, wx, wy, ww * 9);
    g.addColorStop(0, 'rgba(255,178,87,0.38)'); g.addColorStop(1, 'rgba(255,178,87,0)');
    ctx.fillStyle = g; ctx.fillRect(wx - ww * 9, wy - ww * 9, ww * 18, ww * 18);
    ctx.fillStyle = C.candle; ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);
  }
  // pines
  ctx.fillStyle = '#04070c';
  for (const [tx, th] of [[0.05, 0.42], [0.12, 0.34], [0.88, 0.40], [0.95, 0.33]]) {
    const x = w * tx, top = h * (0.9 - th);
    for (let l = 0; l < 3; l++) {
      const ly = top + th * h * 0.22 * l, lw = w * 0.016 * (l + 1);
      ctx.beginPath(); ctx.moveTo(x - lw, ly + h * th * 0.42); ctx.lineTo(x, ly); ctx.lineTo(x + lw, ly + h * th * 0.42); ctx.closePath(); ctx.fill();
    }
  }
  // ground fade so the silhouette melts into the dark
  g = ctx.createLinearGradient(0, h * 0.8, 0, h);
  g.addColorStop(0, 'rgba(3,4,9,0)'); g.addColorStop(1, 'rgba(3,4,9,0.92)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.8, w, h * 0.2);
  // fog
  for (let i = 0; i < 3; i++) {
    const fy = h * (0.8 + i * 0.06), fr = h * 0.16;
    g = ctx.createRadialGradient(w * (0.25 + i * 0.25), fy, 1, w * (0.25 + i * 0.25), fy, w * 0.4);
    g.addColorStop(0, 'rgba(143,182,232,0.07)'); g.addColorStop(1, 'rgba(143,182,232,0)');
    ctx.fillStyle = g; ctx.fillRect(0, fy - fr, w, fr * 2);
  }
  // vignette
  g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function shade(ctx, w, h, top = 0.5, bottom = 0.75) {
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(5,6,11,${top})`); g.addColorStop(0.35, 'rgba(5,6,11,0.12)');
  g.addColorStop(0.62, 'rgba(5,6,11,0.18)'); g.addColorStop(1, `rgba(5,6,11,${bottom})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

async function cover(ctx, img, w, h, sy, sh) {
  const sc = w / img.width;
  ctx.drawImage(img, 0, sy, img.width, sh, 0, 0, w, sh * sc === h ? h : h);
}

const save = (cv, name) => { writeFileSync(path.join(OUT, name), cv.toBuffer('image/png')); console.log('wrote', name); };

// =============================================================
const menu = await loadImage(path.join(OUT, 'menu-9x16.jpg'));
const loading = await loadImage(path.join(OUT, 'loading-9x16.jpg'));

// ---- icons ----
function icon(S, name) {
  const cv = createCanvas(S, S), ctx = cv.getContext('2d');
  let g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, '#0d1220'); g.addColorStop(1, C.ink);
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.62);
  g.addColorStop(0, 'rgba(168,131,60,0.16)'); g.addColorStop(1, 'rgba(168,131,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  drawMark(ctx, S * 0.14, S * 0.14, S * 0.72);
  save(cv, name);
}
icon(512, 'icon-512.png');
icon(192, 'icon-192.png');
icon(32, 'icon-32.png');

// ---- transparent lockups (bone + ink variants) ----
function sheet(w, h, draw, name) {
  const cv = createCanvas(w, h), ctx = cv.getContext('2d');
  draw(ctx); save(cv, name);
}
const BONE = { word: C.bone, tag: C.gold, rule: C.gold };
const INK = { word: '#14161f', tag: '#7a5a20', rule: '#7a5a20' };
sheet(1200, 900, ctx => lockupV(ctx, 600, 130, 330, BONE), 'lockup-vertical.png');
sheet(1200, 900, ctx => lockupV(ctx, 600, 130, 330, INK), 'lockup-vertical-ink.png');
sheet(1800, 460, ctx => lockupH(ctx, 40, 230, 340, BONE), 'lockup-horizontal.png');
sheet(1800, 460, ctx => lockupH(ctx, 40, 230, 340, INK), 'lockup-horizontal-ink.png');

// ---- Play feature graphic 1024x500 ----
{
  const cv = createCanvas(1024, 500), ctx = cv.getContext('2d');
  scene(ctx, 1024, 500, { seed: 11, moonAt: [0.85, 0.24] });
  shade(ctx, 1024, 500, 0.35, 0.5);
  centerH(ctx, 1024, 250, 200);
  save(cv, 'feature-1024x500.png');
}

// ---- social: square post 1080 ----
{
  const cv = createCanvas(1080, 1080), ctx = cv.getContext('2d');
  cover(ctx, menu, 1080, 1080, 500, 768);
  shade(ctx, 1080, 1080, 0.62, 0.82);
  tracked(ctx, 'A VAMPIRE SURVIVAL HORROR', 540, 170, { px: 26, family: SANS, tracking: 0.42, color: C.gold });
  lockupV(ctx, 540, 300, 210);
  chip(ctx, 540, 950, 'PLAY FREE IN YOUR BROWSER', 19);
  save(cv, 'post-1080x1080.png');
}

// ---- social: share post 1200x675 ----
{
  const cv = createCanvas(1200, 675), ctx = cv.getContext('2d');
  cover(ctx, loading, 1200, 675, 400, 432);
  shade(ctx, 1200, 675, 0.55, 0.7);
  centerH(ctx, 1200, 330, 190);
  save(cv, 'post-1200x675.png');
}

// ---- social: story 1080x1920 (uses the shipped 9:16 plate) ----
{
  const cv = createCanvas(1080, 1920), ctx = cv.getContext('2d');
  ctx.drawImage(loading, 0, 0, loading.width, loading.height, 0, 0, 1080, 1920);
  shade(ctx, 1080, 1920, 0.55, 0.0);
  tracked(ctx, '@LASTNIGHT', 540, 120, { px: 26, family: SANS, tracking: 0.5, color: C.gold });
  chip(ctx, 540, 200, 'PLAY FREE IN YOUR BROWSER', 19);
  save(cv, 'story-1080x1920.png');
}

// ---- YouTube banner 2560x1440 ----
{
  const cv = createCanvas(2560, 1440), ctx = cv.getContext('2d');
  scene(ctx, 2560, 1440, { seed: 4, moonAt: [0.82, 0.2] });
  shade(ctx, 2560, 1440, 0.3, 0.55);
  lockupV(ctx, 1280, 330, 330);
  tracked(ctx, 'A VAMPIRE SURVIVAL HORROR', 1280, 1240, { px: 30, family: SANS, tracking: 0.5, color: C.ash });
  tracked(ctx, 'NEW NIGHTS EVERY UPDATE', 2330, 1370, { px: 24, family: SANS, tracking: 0.4, color: C.gold, align: 'right' });
  tracked(ctx, '@LASTNIGHT', 230, 1370, { px: 24, family: SANS, tracking: 0.4, color: C.gold, align: 'left' });
  save(cv, 'banner-youtube-2560x1440.png');
}

// ---- X / Twitter header 1500x500 ----
{
  const cv = createCanvas(1500, 500), ctx = cv.getContext('2d');
  scene(ctx, 1500, 500, { seed: 9, moonAt: [0.9, 0.3] });
  shade(ctx, 1500, 500, 0.4, 0.55);
  centerH(ctx, 1500, 250, 180);
  save(cv, 'header-x-1500x500.png');
}

// ---- Facebook cover 820x312 ----
{
  const cv = createCanvas(820, 312), ctx = cv.getContext('2d');
  scene(ctx, 820, 312, { seed: 9, moonAt: [0.9, 0.3] });
  shade(ctx, 820, 312, 0.4, 0.55);
  centerH(ctx, 820, 156, 120);
  save(cv, 'cover-facebook-820x312.png');
}

// ---- Discord banner 960x540 ----
{
  const cv = createCanvas(960, 540), ctx = cv.getContext('2d');
  scene(ctx, 960, 540, { seed: 6, moonAt: [0.84, 0.22] });
  shade(ctx, 960, 540, 0.35, 0.55);
  lockupV(ctx, 480, 90, 170);
  save(cv, 'banner-discord-960x540.png');
}

// ---- YouTube thumb 1280x720 ----
{
  const cv = createCanvas(1280, 720), ctx = cv.getContext('2d');
  cover(ctx, menu, 1280, 720, 560, 432);
  shade(ctx, 1280, 720, 0.55, 0.75);
  lockupV(ctx, 640, 150, 190);
  chip(ctx, 640, 620, 'GAMEPLAY', 18);
  save(cv, 'thumb-1280x720.png');
}

console.log('brand kit raster done.');
