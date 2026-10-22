/* DUSKHOLD — Touch controls layer: zoom buttons, the CAPTAIN recenter chip and the stick/flare controls main.js draws over everything (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { SURVIVAL_CAMERA } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, drawPanel, INK } from '../survivalIcons.js';
import { TAU, clock, addHit, BUTTON_COLORS, zoomButtonLayout, recenterChipBox } from './shared.js';

export function drawZoomButtons(game, ctx, w, h) {
  const mode = game.survival;
  if (!mode || mode.cine || typeof mode.zoomStep !== 'function') return;
  const L = zoomButtonLayout(w, h);
  const [lo, hi] = SURVIVAL_CAMERA.zoom;
  const goal = mode.zoomGoal();
  for (const row of [
    { id: 'ZOOM IN', at: L.zoomIn, dir: 1, end: goal >= hi - 1e-3 },
    { id: 'ZOOM OUT', at: L.zoomOut, dir: -1, end: goal <= lo + 1e-3 },
  ]) {
    const { x, y } = row.at;
    const r = L.r;
    addHit(game, { x: x - r - 4, y: y - r - 4, w: r * 2 + 8, h: r * 2 + 8 }, row.id, () => mode.zoomStep(row.dir));
    ctx.save();
    ctx.globalAlpha = row.end ? 0.45 : 0.94;
    ctx.beginPath();
    ctx.arc(x, y + 3, r, 0, TAU);
    ctx.fillStyle = 'rgba(20,16,40,0.45)';
    ctx.fill();
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#dde4ff');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // the glyph: a fat plus / minus in ink
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.22);
    ctx.strokeStyle = '#2a2350';
    const k = r * 0.46;
    ctx.beginPath();
    ctx.moveTo(x - k, y); ctx.lineTo(x + k, y);
    if (row.dir > 0) { ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The view has been dragged off the captain: a small chip with his face at
 * the top of the screen brings it back (so does walking, or a tap on free
 * ground).
 */

export function drawRecenterChip(game, ctx, w, h) {
  const box = recenterChipBox(game, w, h);
  if (!box) return;
  const mode = game.survival;
  const bw = box.w, bh = box.h;
  const x = box.x;
  const y = box.y;
  addHit(game, { x: x - 4, y: y - 4, w: bw + 8, h: bh + 8 }, 'RECENTER', () => mode.recenterCamera());
  drawPanel(ctx, x, y, bw, bh, { radius: 15, top: '#ffffff', bottom: '#e3e8ff', lineWidth: 2, highlight: false });
  drawSurvivalIcon(ctx, 'hunter', x + 16, y + bh / 2, 22);
  drawLabel(ctx, 'CAPTAIN', x + 30, y + bh / 2 + 1, 11, '#2a2350', { align: 'left', outline: 0 });
}

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

/**
 * The build this page runs (index.html's DUSKHOLD_BUILD): printed small in
 * the HUD's corner and on the pause panel, so a screenshot from a phone says
 * which build it came from (2026-10-17: the build on a playtester's screen
 * was not the build in the branch).
 */

export function drawSurvivalControls(game, ctx, w, h) {
  const input = game.input;
  if (!input || !input.gameplay || game.screen !== 'playing') return;
  const mode = game.survival;
  const t = clock(game);
  const s = input.stick;
  ctx.save();
  if (s.active) {
    ctx.beginPath();
    ctx.arc(s.ox, s.oy, s.r, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    const kx = s.ox + s.dx * s.r * s.mag, ky = s.oy + s.dy * s.r * s.mag;
    ctx.beginPath();
    ctx.arc(kx, ky, 24, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
  } else {
    const hx = s.homeX || w * 0.16, hy = s.homeY || h - 120, hr = s.r || 52;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    drawSurvivalIcon(ctx, 'joystick', hx, hy, 40, { alpha: 0.85 });
  }
  ctx.restore();

  const drawRound = (b, icon, colors, opts = {}) => {
    if (!b || b.hidden) return;
    const r = (opts.visualR || b.r) * (b.down ? 0.94 : 1) + (b.pulse || 0) * 2;
    ctx.save();
    if (opts.glow) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 6 + Math.sin(t * 6) * 2, 0, TAU);
      ctx.fillStyle = 'rgba(255,200,80,0.45)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y + 4, r, 0, TAU);
    ctx.fillStyle = colors[2];
    ctx.fill();
    const g = ctx.createLinearGradient(0, b.y - r, 0, b.y + r);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, icon, b.x, b.y, r * 1.15, { alpha: opts.cd > 0 ? 0.6 : 1 });
    if (opts.cd > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * opts.cd);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20,16,40,0.55)';
      ctx.fill();
      ctx.restore();
      if (opts.cdText) drawLabel(ctx, opts.cdText, b.x, b.y + 1, Math.round(r * 0.7), '#ffffff');
    }
  };
  const b = input.buttons;
  // One action button: the Hunter shoots by himself, the thumb only Flares.
  const cd = mode ? clamp(mode.skillCooldown / Math.max(0.01, mode.skillCooldownMax), 0, 1) : 0;
  drawRound(b.interact, 'flare', BUTTON_COLORS.orange, {
    cd, cdText: cd > 0 ? `${Math.ceil(mode.skillCooldown)}` : null, glow: cd <= 0,
  });
}

/* ------------------------------------------------------------------ */
/* entry                                                               */
/* ------------------------------------------------------------------ */

