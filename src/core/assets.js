/* LAST NIGHT — 2D asset pipeline (runtime)
 *
 * This manifest contains environment, enemy and interface art. Valen is not a
 * baked sprite: src/game/valen3d.js loads the uploaded animated GLB directly.
 * Missing 2D textures still fall back to procedural Canvas rendering.
 */

import { TAU } from './util.js';

const MANIFEST = [
  { n: 'hunter_idle' }, { n: 'hunter_aim' },
  { n: 'crawler_idle' }, { n: 'crawler_lunge' },
  { n: 'wolf_idle' }, { n: 'wolf_windup' },
  // architecture (full-bleed textures, no alpha)
  { n: 'floor_wood', flat: 1 }, { n: 'floor_marble', flat: 1 }, { n: 'floor_stone', flat: 1 },
  { n: 'wall_strip', flat: 1 }, { n: 'ext_ground', flat: 1 },
  // furniture
  { n: 'furn_longtable' }, { n: 'furn_chair' }, { n: 'furn_sofa' },
  { n: 'furn_cabinet' }, { n: 'furn_bookshelf' }, { n: 'furn_desk' },
  { n: 'furn_staircase' }, { n: 'furn_barrel' },
  // props
  { n: 'prop_candelabra' }, { n: 'prop_candlestand' }, { n: 'prop_portrait_a' },
  { n: 'prop_portrait_b' }, { n: 'prop_fireplace' }, { n: 'prop_clock' },
  { n: 'prop_basin' }, { n: 'prop_chandelier' }, { n: 'prop_bones' }, { n: 'prop_books' },
  // doors & windows (strips, drawn stretched along the wall)
  { n: 'door_oak' }, { n: 'door_broken' }, { n: 'window_strip' }, { n: 'window_broken' },
  // atmosphere (additive — keep the black background, screen blend)
  { n: 'fx_fog', additive: 1 }, { n: 'fx_moon', additive: 1 },
  // menu
  { n: 'title_bg', flat: 1 },
];

export const Assets = {
  ready: false,
  count: 0,
  loaded: 0,
  list: {},
  patterns: new Map(),

  has(name) { const a = this.list[name]; return !!(a && a.el); },
  get(name) { const a = this.list[name]; return a && a.el ? a : null; },

  /** Cached fill pattern for tiling full-bleed textures (world-space scale). */
  pattern(ctx, name, cellW, cellH) {
    const a = this.get(name);
    if (!a) return null;
    const key = name + ':' + cellW + 'x' + cellH;
    if (!this.patterns.has(key)) {
      try { this.patterns.set(key, ctx.createPattern(a.el, 'repeat')); }
      catch (e) { this.patterns.set(key, null); }
    }
    return this.patterns.get(key) || null;
  },

  /**
   * Load every asset in the manifest. Resolves when all are done (or failed).
   * Safe in any environment: without an Image constructor it resolves
   * immediately with an empty set (procedural fallback).
   */
  init(onProgress) {
    if (this.ready) return Promise.resolve(this);
    const ImageCtor = typeof Image !== 'undefined' ? Image : null;
    const tasks = MANIFEST.map(({ n, flat, additive }) => new Promise((resolve) => {
      if (!ImageCtor) { this.list[n] = { name: n, missing: true, flat: !!flat, additive: !!additive }; return resolve(); }
      const el = new ImageCtor();
      el.src = './assets/' + n + (flat ? '.jpg' : '.webp');
      const done = (ok) => {
        this.list[n] = {
          name: n, el: ok ? el : null, missing: !ok, flat: !!flat, additive: !!additive,
          w: ok ? el.naturalWidth || el.width : 0,
          h: ok ? el.naturalHeight || el.height : 0,
        };
        this.loaded++;
        if (onProgress) onProgress(this.loaded, MANIFEST.length);
        resolve();
      };
      el.onload = () => done(true);
      el.onerror = () => done(false);
      // already cached?
      if (el.complete) done(el.naturalWidth > 0);
    }));
    return Promise.all(tasks).then(() => {
      this.ready = true;
      this.count = this.loaded;
      return this;
    });
  },
};

/* ---------------- sprite drawing helpers ---------------- */

/**
 * Draw a transparent sprite centered on (x,y).
 * h = the on-screen height in world px; width follows the image aspect.
 * rot is a canvas rotation (radians); the image is drawn un-rotated within it.
 */
export function drawSprite(ctx, Assets_, name, x, y, h, opts = {}) {
  const a = Assets_.get(name);
  if (!a) return false;
  const w = h * (a.w / a.h);
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.scale) ctx.scale(opts.scale, opts.scale);
  if (opts.skew) ctx.transform(1, 0, opts.skew, 1, 0, 0);
  const img = a.el._raw || a.el;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

/**
 * Draw a "strip" asset (doors, windows) stretched along its length.
 * The image's long axis runs along the wall; `len` is the wall gap length.
 */
export function drawStrip(ctx, Assets_, name, x, y, len, thick, opts = {}) {
  const a = Assets_.get(name);
  if (!a) return false;
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  const img = a.el._raw || a.el;
  ctx.drawImage(img, -len / 2, -thick / 2, len, thick);
  ctx.restore();
  return true;
}

/**
 * Additive (screen-blended) draw for glow textures that keep a black
 * background (fog puffs, moon).
 */
export function drawAdditive(ctx, Assets_, name, x, y, w, h, opts = {}) {
  const a = Assets_.get(name);
  if (!a) return false;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = opts.alpha !== undefined ? opts.alpha : 1;
  if (opts.rot) { ctx.translate(x, y); ctx.rotate(opts.rot); }
  const img = a.el._raw || a.el;
  ctx.drawImage(img, opts.rot ? -w / 2 : x - w / 2, opts.rot ? -h / 2 : y - h / 2, w, h);
  ctx.restore();
  return true;
}
