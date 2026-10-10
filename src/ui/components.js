/* Shared canvas UI primitives.
 *
 * The game has one visual language for utility icons in the live HUD and field
 * cards. Input hit areas deliberately stay at least 44 CSS pixels even when
 * their painted icon tiles are smaller, so compact layouts remain touchable.
 */

import { drawGameIcon } from './icons.js';

export const UI_TOKENS = Object.freeze({
  palette: Object.freeze({
    controlFill: 'rgba(7,9,14,0.82)',
    controlFillActive: 'rgba(56,42,26,0.94)',
    controlStroke: 'rgba(192,174,135,0.48)',
    controlStrokeActive: 'rgba(220,185,112,0.92)',
    controlIcon: '#ddd3c0',
    controlIconActive: '#f1dbab',
    controlIconDisabled: 'rgba(172,163,146,0.70)',
    runFill: 'rgba(23,25,35,0.78)',
    runFillActive: 'rgba(83,57,22,0.92)',
    runStroke: 'rgba(197,160,96,0.68)',
    runStrokeActive: '#efd086',
    runIcon: 'rgba(228,208,166,0.96)',
    runIconActive: '#ffe2a1',
  }),
  size: Object.freeze({
    minHitTarget: 44,
    utilityShort: 30,
    utilityStandard: 34,
    fieldTabShort: 40,
    fieldTabStandard: 42,
    fieldTabPortrait: 44,
    runIcon: 20,
  }),
  spacing: Object.freeze({
    utilityShort: 14,
    utilityStandard: 10,
    fieldInset: 16,
    fieldShortTab: 4,
    fieldTab: 7,
    fieldPortraitTab: 4,
  }),
});

/** Return a centered, minimum-size input area for a visually smaller control. */
export function iconHitArea(x, y, size, minSize = UI_TOKENS.size.minHitTarget) {
  const target = Math.max(size, minSize);
  const inset = (target - size) / 2;
  return { x: x - inset, y: y - inset, w: target, h: target };
}

/** Shared hover, keyboard-focus, and selected state for icon-only controls. */
export function iconButtonState(game, box, selected = false, disabled = false) {
  if (disabled) return 'disabled';
  const input = game && game.input;
  const focused = !!(game && game.usingKeyboard && game.uiIndex === box.idx);
  const hovered = !!(input && !input.touchSeen
    && input.mouse.x >= box.x && input.mouse.x <= box.x + box.w
    && input.mouse.y >= box.y && input.mouse.y <= box.y + box.h);
  return selected || focused || hovered ? 'active' : 'idle';
}

/** Draw one icon button with a deliberate, reusable shape variant. */
export function drawIconButton(ctx, x, y, size, icon, {
  state = 'idle',
  shape = 'rounded',
  iconSize = Math.min(23, size * 0.56),
} = {}) {
  if (!ctx) return;
  const active = state === 'active';
  const disabled = state === 'disabled';
  const cx = x + size / 2;
  const cy = y + size / 2;
  const palette = UI_TOKENS.palette;

  ctx.save();
  if (disabled) ctx.globalAlpha *= 0.58;
  ctx.fillStyle = active ? palette.controlFillActive : palette.controlFill;
  ctx.strokeStyle = active ? palette.controlStrokeActive : palette.controlStroke;
  ctx.lineWidth = active ? 1.5 : 1;
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'square') {
    ctx.fillRect(x, y, size, size);
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  } else {
    const radius = Math.min(6, Math.max(3, size * 0.14));
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, radius);
    ctx.fill();
    ctx.stroke();
  }
  const ink = disabled ? palette.controlIconDisabled
    : active ? palette.controlIconActive : palette.controlIcon;
  drawGameIcon(ctx, icon, cx, cy, iconSize, ink);
  ctx.restore();
}
