/* LAST NIGHT — the bake (issue #53, phase C2)
 *
 * The house's lamps do not move. A candle in the jamb, the fire in the
 * library, the moon at the conservatory glass — they are in the same place
 * every night, and only their flicker changes. So the light a wall stands in
 * can be measured once and written down, instead of being recomputed for
 * every piece of every frame. That is the bake.
 *
 * What it buys:
 *   - the modular room takes the house's own light. A wall by the hearth is
 *     amber; the same wall at the end of the hall is cold and nearly black.
 *     Before this, every piece was lit by the one rig that follows Valen, so
 *     the room she was not standing in was lit as if she were.
 *   - it costs nothing per frame. One instance-colour buffer, uploaded when
 *     the house changes, not when the camera does. That is the mobile budget
 *     the brief asks for (docs/BRIEF.md §3, #53 guardrails).
 *   - the fortress lights the house for free. Candles in the jambs are static
 *     too, so their light is in the bake: the house she is building is a
 *     house that is visibly getting lighter (docs/PURPOSE.md P6).
 *
 * The numbers are the RENDERER's own (render.js keyLightAt): the same
 * falloff, the same accumulation, the same floor. A mesh and the painted
 * floor under it are lit by one house, because they are computed by one
 * formula. Nothing here invents a light the 2D world does not have.
 *
 * Pure on purpose: no THREE, no canvas, no GPU. The harness can bake a whole
 * mansion and measure it in node, which is the only way a lighting change on
 * a phone can be trusted.
 */

import { clamp } from '../core/util.js';

/** World units per bake cell. ~4 cells across a door, ~2.5 across a body. */
export const BAKE_CELL = 48;

/** The colour of the moon through the windows, and of the house's own flame. */
const COLD = [0.58, 0.68, 0.95];
const WARM = [1.00, 0.84, 0.62];

/** Nothing in the house is ever fully black: the eye needs the silhouette. */
const LIT_FLOOR = 0.30;

/**
 * The lightmap's own falloff, taken off render.js `addLight`: a lamp is a
 * radial gradient whose alpha runs 1.0 → 0.55 → 0.20 → 0 across its radius.
 * The bake uses the same curve, so a mesh and the painted floor under it are
 * lit by one house and not by two opinions.
 */
export function lampFalloff(t) {
  if (!(t > 0)) return 1;
  if (t >= 1) return 0;
  if (t < 0.35) return 1 + (0.55 - 1) * (t / 0.35);
  if (t < 0.72) return 0.55 + (0.20 - 0.55) * ((t - 0.35) / 0.37);
  return 0.2 * (1 - (t - 0.72) / 0.28);
}

/**
 * The static sources of the mansion, in the renderer's own units.
 * Rooms contribute the same even wash `submitLights` gives them — the corners
 * are not a black frame around the candle pools — and every lamp on the
 * mansion's list contributes its falloff. The player's lantern is NOT here:
 * it moves, and a moving light is what the rig at runtime is for.
 */
export function staticSources(mansion) {
  const out = [];
  if (!mansion) return out;
  for (const room of mansion.roomList || []) {
    const stone = room.floor === 'stone';
    const glass = room.floor === 'glass';
    const reach = Math.hypot(room.w, room.h) * 0.58;
    out.push({
      x: room.x + room.w / 2, y: room.y + room.h / 2, r: reach,
      i: (glass ? 0.26 : stone ? 0.14 : 0.2),
      color: stone ? [148, 156, 174] : glass ? [180, 198, 216] : [178, 186, 202],
      type: 'wash',
    });
  }
  for (const l of mansion.lights || []) {
    const i = l.curI ?? l.i;
    if (!(i > 0.01)) continue;
    out.push({ x: l.x, y: l.y, r: l.r * (0.94 + 0.06 * (l.f ?? 1)), i, color: l.color || [255, 186, 120], type: l.type || 'lamp' });
  }
  return out;
}

/**
 * Measure the house's static light onto a grid.
 *
 * `extra` is for light the mansion does not know about yet — the fortress's
 * own candles are placed by the kit, and they are as static as the rest.
 */
export function bakeLight(mansion, opts = {}) {
  const cell = Math.max(16, opts.cell || BAKE_CELL);
  const bounds = (mansion && mansion.bounds) || { x: 0, y: 0, w: 0, h: 0 };
  const pad = opts.pad == null ? cell : opts.pad;
  const x0 = bounds.x - pad;
  const y0 = bounds.y - pad;
  const cols = Math.max(1, Math.ceil((bounds.w + pad * 2) / cell));
  const rows = Math.max(1, Math.ceil((bounds.h + pad * 2) / cell));
  const sources = staticSources(mansion).concat(opts.extra || []);

  /* SPLAT, not scan.
   *
   * The obvious way to bake is to walk every cell and ask every lamp about it.
   * A house this size is 3,700 cells and the fortress's own candles bring the
   * lamp list past sixty — a third of a million questions, and a phone paid
   * 27ms for the privilege. A lamp, though, can only be seen by the cells
   * inside its own radius, and most of them reach a few dozen cells between
   * them. So: walk the LAMPS and paint the cells each one owns, in the same
   * order the lightmap would have drawn them. Same numbers, a twentieth of
   * the work — and the bake lands inside the frame it is allowed to cost.
   */
  const n = cols * rows;
  const acc = new Float32Array(n);        // source-over, as the canvas stacks
  const cr = new Float32Array(n);
  const cg = new Float32Array(n);
  const cb = new Float32Array(n);
  const cw = new Float32Array(n);
  const lampW = new Float32Array(n);
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  for (const s of sources) {
    const r = Math.max(1, s.r || 1);
    const i0 = clamp(s.i, 0, 1);
    if (i0 <= 0) continue;
    const col = s.color || [255, 186, 120];
    const isLamp = (s.type === 'moon' || s.type === 'wash') ? 0 : 1;
    // the block of cells this one can touch, in grid space
    const gx0 = Math.max(0, Math.floor((s.x - r - x0) / cell));
    const gx1 = Math.min(cols - 1, Math.ceil((s.x + r - x0) / cell));
    const gy0 = Math.max(0, Math.floor((s.y - r - y0) / cell));
    const gy1 = Math.min(rows - 1, Math.ceil((s.y + r - y0) / cell));
    const r2 = r * r;
    for (let ry = gy0; ry <= gy1; ry++) {
      const y = y0 + (ry + 0.5) * cell;
      const row = ry * cols;
      for (let rx = gx0; rx <= gx1; rx++) {
        const x = x0 + (rx + 0.5) * cell;
        const dx = x - s.x, dy = y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;                    // no sqrt for the misses
        const t = Math.sqrt(d2) / r;
        const a = i0 * lampFalloff(t);
        if (a <= 0) continue;
        const i2 = row + rx;
        acc[i2] = a + acc[i2] * (1 - a);
        cr[i2] += (col[0] || 0) * a;
        cg[i2] += (col[1] || 0) * a;
        cb[i2] += (col[2] || 0) * a;
        cw[i2] += a;
        lampW[i2] += isLamp * a;
      }
    }
  }

  const level = new Float32Array(n);
  const warm = new Float32Array(n);
  const color = new Uint8Array(n * 3);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = clamp(acc[i], 0, 1);
    level[i] = l;
    warm[i] = cw[i] > 0 ? clamp(lampW[i] / cw[i], 0, 1) : 0;
    const inv = cw[i] > 0 ? 1 / cw[i] : 0;
    color[i * 3] = clamp(cr[i] * inv, 0, 255);
    color[i * 3 + 1] = clamp(cg[i] * inv, 0, 255);
    color[i * 3 + 2] = clamp(cb[i] * inv, 0, 255);
    peak = Math.max(peak, l);
    sum += l;
  }

  const bake = {
    cell, x0, y0, cols, rows, level, warm, color,
    sources: sources.length,
    peak,
    mean: n ? sum / n : 0,
    ms: +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - now).toFixed(2),
    /** The light at a world point, smoothed across the four cells it falls in. */
    sample(x, y, out = { level: 0, warm: 0, color: [0, 0, 0] }) {
      const fx = (x - this.x0) / this.cell - 0.5;
      const fy = (y - this.y0) / this.cell - 0.5;
      const gx = clamp(fx, 0, this.cols - 1);
      const gy = clamp(fy, 0, this.rows - 1);
      const x1 = Math.min(this.cols - 1, Math.max(0, Math.floor(gx)));
      const y1 = Math.min(this.rows - 1, Math.max(0, Math.floor(gy)));
      const x2 = Math.min(this.cols - 1, x1 + 1);
      const y2 = Math.min(this.rows - 1, y1 + 1);
      const tx = clamp(gx - x1, 0, 1);
      const ty = clamp(gy - y1, 0, 1);
      const bi = (cx, cy) => cy * this.cols + cx;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const i00 = bi(x1, y1), i10 = bi(x2, y1), i01 = bi(x1, y2), i11 = bi(x2, y2);
      out.level = this.level[i00] * w00 + this.level[i10] * w10 + this.level[i01] * w01 + this.level[i11] * w11;
      out.warm = this.warm[i00] * w00 + this.warm[i10] * w10 + this.warm[i01] * w01 + this.warm[i11] * w11;
      for (let c = 0; c < 3; c++) {
        out.color[c] = this.color[i00 * 3 + c] * w00 + this.color[i10 * 3 + c] * w10
          + this.color[i01 * 3 + c] * w01 + this.color[i11 * 3 + c] * w11;
      }
      return out;
    },
  };
  return bake;
}

/**
 * The colour a piece is painted at that spot: the colour of the light it
 * stands in, times how much of it there is. Multiplies the piece's own
 * albedo — a black candle does not become grey because it is in a dark room.
 */
export function bakedTint(s, out = [1, 1, 1]) {
  const lit = LIT_FLOOR + (1 - LIT_FLOOR) * clamp(s.level, 0, 1);
  const k = clamp(s.warm, 0, 1);
  // the light it stands in, warm flame to cold moon, never fully black
  for (let c = 0; c < 3; c++) out[c] = (COLD[c] + (WARM[c] - COLD[c]) * k) * lit;
  return out;
}

/** One line for the diagnostics: what the house's light looks like tonight. */
export function bakeReport(bake) {
  if (!bake) return null;
  const dark = bake.level.reduce((n, v) => n + (v < 0.25 ? 1 : 0), 0);
  const lit = bake.level.reduce((n, v) => n + (v > 0.6 ? 1 : 0), 0);
  return {
    cells: bake.cols * bake.rows,
    cell: bake.cell,
    sources: bake.sources,
    ms: bake.ms,
    mean: +bake.mean.toFixed(3),
    peak: +bake.peak.toFixed(3),
    darkCells: dark,
    litCells: lit,
  };
}
