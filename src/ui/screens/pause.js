/* DUSKHOLD — The pause screen (Phase 3 split of ui/screens.js). */

import { clamp } from '../../core/util.js';
import { SERIF, isPhone, fitType, uiButton, buttonVisual, wrapText } from './shared.js';

export function drawPause(game, ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.82)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'PAUSED', w - 32, phone ? 26 : 34, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  const titleY = phone ? Math.min(h * 0.16, 48) : h * 0.2;
  ctx.fillText('PAUSED', w / 2, titleY);
  ctx.restore();

  const bw = phone ? Math.min(w - 28, 420) : Math.min(280, w * 0.7);
  if (game.pauseConfirm) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,220,200,0.9)';
    ctx.font = `400 ${phone ? 14 : 16}px ${SERIF}`;
    wrapText(ctx, 'The house keeps the floor. The rest of this night is lost.', w / 2, titleY + 36, Math.min(w - 40, 420), phone ? 20 : 22);
    ctx.restore();
    const bh = 48;
    const y1 = h - (phone ? 148 : 160);
    const stay = uiButton(game, {
      x: w / 2 - bw / 2, y: y1, w: bw, h: bh, label: 'STAY', small: true, accent: '#6a6a80',
      onClick: () => { game.pauseConfirm = false; },
    });
    buttonVisual(ctx, stay.b, { active: stay.hover, label: 'STAY', small: true, accent: '#6a6a80', showLabel: true });
    const leave = uiButton(game, {
      x: w / 2 - bw / 2, y: y1 + bh + 10, w: bw, h: bh, label: 'LEAVE', small: true, accent: '#8a3038',
      onClick: () => game.toMenu(),
    });
    buttonVisual(ctx, leave.b, { active: leave.hover, label: 'LEAVE', small: true, accent: '#8a3038', showLabel: true });
    return;
  }
  const items = [
    { label: 'RESUME', onClick: () => game.togglePause(false) },
    { label: 'RESTART NIGHT', onClick: () => game.beginNight() },
    { label: 'SETTINGS', onClick: () => game.setScreen('settings', 'paused') },
    { label: 'MAIN MENU', onClick: () => { game.pauseConfirm = true; } },
  ];
  const gap = h < 520 ? 4 : 8;
  const bh = clamp((h * 0.62 - gap * (items.length - 1)) / items.length, 28, 46);
  const stack = (bh + gap) * items.length - gap;
  const centered = (h - stack) / 2;
  let by = Math.max(titleY + 36, Math.min(centered, h - stack - 12));
  items.forEach((it, i) => {
    const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, small: true, accent: '#6a6a80' });
    buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: '#6a6a80', showLabel: true });
    by += bh + gap;
  });
}

/* ================= settings ================= */

