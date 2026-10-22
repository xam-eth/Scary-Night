/* DUSKHOLD — The between-night cine: caption bar, track and the captain marker (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { CINE } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel, INK } from '../survivalIcons.js';
import { clock, project, ACTOR, addHit } from './shared.js';

/**
 * Letterbox bars, one caption at a time (icon + title in a chip above the
 * lower bar, the line under it inside the bar) and "TAP TO SKIP" — a label,
 * not a button: the whole screen is the skip target (`survival:SKIP`).
 */
export function drawCine(game, ctx, w, h) {
  const mode = game.survival;
  const c = mode.cine;
  const bar = Math.round(clamp(h * 0.11, 30, 76));
  const open = Math.min(clamp(c.t / 0.35, 0, 1), clamp((c.dur - c.t) / 0.4, 0, 1));
  const eased = 1 - (1 - open) * (1 - open);
  const bh = Math.round(bar * eased);
  ctx.save();
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, w, bh);
  ctx.fillRect(0, h - bh, w, bh);
  ctx.restore();

  const cap = mode.cineCaption();
  if (cap) drawCineCaption(game, ctx, w, h, cap, bar, bh);
  if (c.kind === 'intro' && cap && cap.track) drawCaptainMarker(game, ctx, cap);

  const armed = c.t >= CINE.armAfter;
  if (armed && bh > 18) drawLabel(ctx, 'TAP TO SKIP', w - 16, h - bh / 2, 11, '#ffffff', { align: 'right', alpha: 0.62, outline: 0 });
  addHit(game, { x: 0, y: 0, w, h }, 'SKIP', () => mode.skipCine(), !armed);
}

function drawCineCaption(game, ctx, w, h, cap, bar, bh) {
  const fadeIn = clamp(cap.age / 0.3, 0, 1);
  const fadeOut = clamp(cap.left / 0.3, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;
  const dawn = cap.tone === 'dawn';
  let size = h < 560 ? 21 : 26;
  const trackW = cap.track ? 132 : 0;
  let textW = measureLabel(ctx, cap.title, size);
  while (size > 14 && textW + trackW + 78 > w - 28) { size -= 1; textW = measureLabel(ctx, cap.title, size); }
  const cw = Math.min(w - 28, textW + trackW + 78);
  const ch = h < 560 ? 48 : 58;
  const x = w / 2 - cw / 2;
  const y = h - bar - ch - 10 + (1 - fadeIn) * 10;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPanel(ctx, x, y, cw, ch, dawn
    ? { radius: 20, top: '#ffd65a', bottom: '#f08c1a', lineWidth: 3 }
    : { radius: 20, top: '#5a62b8', bottom: '#343a7e', lineWidth: 3 });
  drawSurvivalIcon(ctx, cap.icon, x + 32, y + ch / 2, ch * 0.74);
  drawLabel(ctx, cap.title, x + 60, y + ch / 2 + 1, size, '#ffffff', { align: 'left', stroke: dawn ? '#7a3a00' : INK });
  if (cap.track) drawCineTrack(game, ctx, x + 60 + textW + 18, y + ch / 2, trackW - 18);
  ctx.restore();
  // the line under the title reads inside the lower bar
  if (cap.sub && bh > 16) {
    drawLabel(ctx, cap.sub, w / 2, h - bh / 2, h < 560 ? 13 : 15, dawn ? '#ffe7a8' : '#e8ebff', { alpha: alpha * 0.95, outline: 0 });
  }
}

/** The goal in the opening: three nights, then the reinforcements' banner. */
function drawCineTrack(game, ctx, x, y, width) {
  const step = (width - 26) / 3;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + width - 14, y); ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 3; i++) drawSurvivalIcon(ctx, 'moon', x + 9 + i * step, y, 22);
  const bob = Math.sin(clock(game) * 5) * 1.5;
  drawSurvivalIcon(ctx, 'banner', x + width - 8, y - 2 + bob, 28);
}

/** "This is you": a bouncing chevron over the Hunter while the camera finds him. */
function drawCaptainMarker(game, ctx, cap) {
  const p = game.player;
  if (!p) return;
  const at = project(game, p.x, p.y, 92 * ACTOR);
  const bob = Math.abs(Math.sin(clock(game) * 4.2)) * 7;
  const alpha = clamp(cap.age / 0.3, 0, 1) * clamp(cap.left / 0.4, 0, 1);
  const s = 13;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(at.x, at.y - bob);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.9); ctx.lineTo(0, s * 0.35); ctx.lineTo(s, -s * 0.9);
  ctx.lineTo(s * 0.55, -s * 1.15); ctx.lineTo(0, -s * 0.38); ctx.lineTo(-s * 0.55, -s * 1.15);
  ctx.closePath();
  ctx.fillStyle = '#ffd24a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* touch controls (survival skin)                                      */
/* ------------------------------------------------------------------ */

