/* DUSKHOLD — Shared immediate-mode UI kit for every DUSKHOLD screen (Phase 3 split of ui/screens.js): type fitting, buttons, brand plate, story-plate shading, field-card tab data. Screens import from here; nothing here knows which screen calls it. */

import { clamp, TAU } from '../../core/util.js';
import { buttonIconForLabel, drawGameIcon } from '../icons.js';
import { drawPlateCover } from '../storycards.js';

export const SERIF = '"IM Fell English SC", Georgia, serif';
export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO = 'ui-monospace, "SFMono-Regular", Consolas, monospace';

/** Phone first: portrait, and the short landscape most people actually hold. */
export function isPhone(w, h) { return w < 840 || h < 500; }

export function fitType(ctx, text, maxW, size, family, weight = 500) {
  let px = size;
  let track = px >= 18 ? 2 : 0.6;
  const apply = () => {
    ctx.font = `${weight} ${px}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = track + 'px';
  };
  apply();
  while (text && ctx.measureText(text).width > maxW && px > 11) {
    px -= 1;
    track = 0;
    apply();
  }
  return px;
}


export function wrapLines(ctx, text, maxW) {
  const words = String(text).split(' ');
  const out = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && ctx.measureText(next).width > maxW) { out.push(cur); cur = word; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}


/* ================= UI primitives ================= */

export function uiButton(game, { x, y, w, h, label, sub, onClick, disabled, small, align = 'center', accent = '#a8833c' }) {
  const idx = game.ui.length;
  const input = game.input;
  const mx = input.touchSeen ? -9999 : input.mouse.x;
  const my = input.touchSeen ? -9999 : input.mouse.y;
  const hover = !disabled && mx > x && mx < x + w && my > y && my < y + h;
  if (hover && game.uiHoverIdx !== idx) { game.uiHoverIdx = idx; game.audio.play('uiHover', { vol: 0.35 }); }
  const selected = game.uiIndex === idx;
  const active = (hover || selected) && !disabled;
  const b = { x, y, w, h, label, sub, onClick: disabled ? null : onClick, disabled, idx };
  game.ui.push(b);
  return { b, active, hover, selected };
}

export function buttonVisual(ctx, { x, y, w, h }, { active, disabled, label, sub, small, accent, showLabel = false }) {
  ctx.save();
  const a = active ? 1 : 0.72;
  const gold = accent === '#a8833c';
  const rgb = gold ? '168,131,60' : '140,150,190';
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, active ? 'rgba(42,28,16,0.94)' : 'rgba(8,9,14,0.88)');
  g.addColorStop(1, active ? 'rgba(22,14,10,0.9)' : 'rgba(8,9,14,0.82)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = disabled ? 'rgba(90,88,84,0.35)' : `rgba(${rgb},${active ? 0.85 : 0.35})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (active) {
    ctx.strokeStyle = `rgba(${rgb},0.25)`;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  }

  const glyph = buttonIconForLabel(label);
  const ink = disabled ? 'rgba(140,138,132,0.5)' : active ? '#f2ead6' : `rgba(214,206,190,${a})`;
  if (glyph && !showLabel) {
    // Icon-only gameplay controls stay visually clean; their action names are
    // kept for keyboard help and focus captions.
    drawGameIcon(ctx, glyph, x + w / 2, y + h / 2, Math.min(small ? 20 : 24, h * 0.54, w * 0.54), ink);
  } else {
    ctx.textAlign = glyph ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    if (glyph && showLabel) {
      drawGameIcon(ctx, glyph, x + 24, y + h / 2, Math.min(small ? 18 : 22, h * 0.52), ink);
    }
    const textX = glyph && showLabel ? x + 46 : x + w / 2;
    const textW = glyph && showLabel ? Math.max(40, w - 58) : Math.max(40, w - 18);
    fitType(ctx, label, textW, small ? 15 : 18, SERIF);
    ctx.fillStyle = ink;
    if (active) {
      ctx.shadowColor = 'rgba(255,200,120,0.35)';
      ctx.shadowBlur = 12;
    }
    ctx.fillText(label, textX, y + h / 2 + (sub ? -5 : 0));
    ctx.shadowBlur = 0;
    if (sub) {
      fitType(ctx, sub, textW, 11, SANS, 400);
      ctx.fillStyle = 'rgba(190,182,168,0.6)';
      ctx.fillText(sub, textX, y + h / 2 + 14);
    }
  }

  if (active) {
    ctx.fillStyle = `rgba(${gold ? '200,160,80' : '160,175,220'},0.9)`;
    ctx.beginPath(); ctx.moveTo(x - 10, y + h / 2); ctx.lineTo(x - 4, y + h / 2 - 4); ctx.lineTo(x - 4, y + h / 2 + 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w + 10, y + h / 2); ctx.lineTo(x + w + 4, y + h / 2 - 4); ctx.lineTo(x + w + 4, y + h / 2 + 4); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** External hover/focus caption: icon buttons stay visually clean, but the
 * player can still discover their action without relying on icon memory. */

/** External hover/focus caption: icon buttons stay visually clean, but the
 * player can still discover their action without relying on icon memory. */
export function drawFocusCaption(game, ctx, w, h) {
  if (game.screen === 'menu' && game.save && game.save.privacyAck) return;
  const input = game.input;
  if (!input || !game.ui || !game.ui.length) return;
  let index = -1;
  if (!input.touchSeen) {
    index = game.ui.findIndex((b) => input.mouse.x >= b.x && input.mouse.x <= b.x + b.w
      && input.mouse.y >= b.y && input.mouse.y <= b.y + b.h);
  }
  if (index < 0 && game.usingKeyboard) index = game.uiIndex;
  const b = game.ui[index];
  if (!b || !buttonIconForLabel(b.label)) return;

  const maxW = Math.max(96, Math.min(w - 28, 280));
  const cx = clamp(b.x + b.w / 2, maxW / 2 + 8, w - maxW / 2 - 8);
  let y = b.y + b.h + 17;
  let below = true;
  if (y + 18 > h - 8) { y = b.y - 12; below = false; }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = below ? 'top' : 'bottom';
  fitType(ctx, String(b.label).toUpperCase(), maxW, 11, SERIF, 500);
  ctx.fillStyle = 'rgba(232,220,198,0.96)';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 8;
  ctx.fillText(String(b.label).toUpperCase(), cx, y);
  ctx.shadowBlur = 0;
  if (b.sub) {
    fitType(ctx, b.sub, maxW, 9, SANS, 400);
    ctx.fillStyle = 'rgba(184,176,160,0.85)';
    ctx.fillText(b.sub, cx, below ? y + 14 : y - 13);
  }
  ctx.strokeStyle = 'rgba(168,131,60,0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 22, below ? y - 4 : y + 4); ctx.lineTo(cx + 22, below ? y - 4 : y + 4); ctx.stroke();
  ctx.restore();
}

const BRAND_PLATE = './assets/brand/menu-9x16-clean.jpg';
const BRAND_WORDMARK = './assets/brand/wordmark-duskhold-lockup.png';
export let brandWordmark = null;
export let brandPlate = null;


export function ensureBrandPlate() {
  if (typeof Image === 'undefined') return;
  if (!brandPlate) {
    brandPlate = new Image();
    brandPlate.decoding = 'async';
    brandPlate.src = BRAND_PLATE;
  }
  if (!brandWordmark) {
    brandWordmark = new Image();
    brandWordmark.decoding = 'async';
    brandWordmark.src = BRAND_WORDMARK;
  }
}

/** The mansion plate already in the repo. One house, not a new generated set. */
export function drawBrandPlate(ctx, w, h, { focus = 0.18, dim = 0.55 } = {}) {
  ensureBrandPlate();
  const img = brandPlate;
  if (!img || !img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, w, h);
    return false;
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) * focus, dw, dh);
  ctx.fillStyle = `rgba(5,6,11,${dim})`;
  ctx.fillRect(0, 0, w, h);
  return true;
}

/* ================= menu scene ================= */

/**
 * The attract loop: the house is awake and she is in it.
 *
 * Not a diagram of a clock and a door. A slow push-in on the hall, a lamp
 * that will not settle, dust in the beam, Valen breathing — then she walks a
 * few steps, then something knocks and the frame takes the hit.
 *
 * Silent on purpose: a menu that starts talking before you touch it is a menu
 * people mute. Everything is a function of `idle`, so the loop is
 * deterministic and cannot jitter between two frames of the same second.
 */

export function drawValenShade(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(10,7,12,0.88)';
  ctx.beginPath();
  ctx.ellipse(0, -52, 7, 8, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8, -42);
  ctx.quadraticCurveTo(-16, -8, -14, 28);
  ctx.lineTo(14, 28);
  ctx.quadraticCurveTo(16, -8, 8, -42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


export function drawPlateGrade(ctx, w, h, key, warm) {
  ctx.fillStyle = '#100c0a';
  ctx.fillRect(0, 0, w, h);
  drawPlateCover(ctx, key, 0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (warm) {
    g.addColorStop(0, 'rgba(255,186,96,0.38)');
    g.addColorStop(0.45, 'rgba(90,36,28,0.12)');
    g.addColorStop(1, 'rgba(6,4,8,0.72)');
  } else {
    g.addColorStop(0, 'rgba(232,168,96,0.28)');
    g.addColorStop(0.5, 'rgba(40,24,20,0.18)');
    g.addColorStop(1, 'rgba(6,4,8,0.78)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}


export function wrapText(ctx, text, x, y, maxW, lh) {
  let yy = y;
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy); yy += lh; line = word;
      } else line = test;
    }
    ctx.fillText(line, x, yy); yy += lh;
  }
  return yy;
}

/* ================= help ================= */

/* ================= the narrator's plate =================
 *
 * Legacy narration is told, not only murmured on the strip. Two surfaces share
 * this plate: the opening narration (three authored lines, in her voice, with
 * the house answering) and the act-title cards at each act turn. Same grade as a dawn-card, different typography: Valen is
 * first person and italic, the house is second person and small caps, so the
 * two voices read as two voices even with the sound off.
 *
 * Phone first: the block is centred in the safe area, the type scales with the
 * short axis, and short landscape keeps the same order on one screen.
 */

export const FIELD_TABS = [
  { id: 'bag', icon: 'bag', title: 'PACK' },
  { id: 'missions', icon: 'mission', title: 'MISSIONS' },
  { id: 'upgrades', icon: 'upgrade', title: 'UPGRADES' },
];
export const FIELD_PANELS = {
  ...Object.fromEntries(FIELD_TABS.map((entry) => [entry.id, entry])),
  // Privacy is intentionally reachable only from the purchase gate, not a
  // permanent navigation stop inside the night.
  privacy: { id: 'privacy', icon: 'shield', title: 'PRIVACY' },
};

