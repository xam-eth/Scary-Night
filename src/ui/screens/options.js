/* DUSKHOLD — The settings screen: volume/shake/flash/captions sliders, difficulty (Phase 3 split of ui/screens.js). */

import { clamp } from '../../core/util.js';
import { DIFFICULTY } from '../../core/config.js';
import { SERIF, SANS, MONO, isPhone, fitType, uiButton, buttonVisual, drawBrandPlate } from './shared.js';

export function drawSettings(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  const s = game.save.settings;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitType(ctx, 'SETTINGS', w - 32, isPhone(w, h) ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('SETTINGS', w / 2, isPhone(w, h) ? 26 : h * 0.14);
  ctx.restore();

  const phone = isPhone(w, h);
  const nRows = 8;
  const header = phone ? 42 : h * 0.18;
  const footer = phone ? 56 : 96;
  const rowH = phone ? clamp((h - header - footer) / nRows, 34, 46) : 46;
  let y = phone ? header + rowH * 0.45 : h * 0.24;
  const cx = w / 2;

  const slider = (label, key, min, max, fmt) => {
    // v1.0 (QA P0-3): a fixed label column and a track that starts after it.
    // Labels are right-aligned to `x - 26` so the longest ("SOUND EFFECTS")
    // keeps 26px of air before the bar, on every screen width this layout ships.
    const short = { 'MASTER VOLUME': 'VOLUME', 'SOUND EFFECTS': 'SFX', 'CAMERA SHAKE': 'SHAKE', 'FLASH EFFECTS': 'FLASH' };
    const shown = phone ? (short[label] || label) : label;
    const wdt = phone ? Math.max(80, w - 176) : Math.min(300, Math.max(160, w * 0.3));
    const x = phone ? 96 : cx - wdt / 2 + 92;
    const val = s[key];
    ctx.save();
    ctx.textAlign = phone ? 'left' : 'right';
    ctx.font = `500 ${phone ? 12 : 13}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = phone ? '0.4px' : '2px';
    ctx.fillStyle = 'rgba(205,196,180,0.85)';
    ctx.fillText(shown, phone ? 14 : x - 26, y);
    ctx.textAlign = phone ? 'right' : 'left';
    ctx.font = `400 ${phone ? 12 : 13}px ${MONO}`;
    ctx.fillStyle = 'rgba(205,196,180,0.7)';
    ctx.fillText(fmt ? fmt(val) : Math.round(val * 100) + '%', phone ? w - 14 : x + wdt + 16, y);
    // track
    const tx = x, tw = wdt, th = 6;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(tx - 1, y - th / 2 - 1, tw + 2, th + 2);
    ctx.fillStyle = 'rgba(120,116,108,0.35)';
    ctx.fillRect(tx, y - th / 2, tw, th);
    const k = (val - min) / (max - min);
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, '#6a1a22'); g.addColorStop(1, '#c09a4a');
    ctx.fillStyle = g;
    ctx.fillRect(tx, y - th / 2, tw * k, th);
    ctx.fillStyle = '#e8ddc4';
    ctx.fillRect(tx + tw * k - 1.5, y - 9, 3, 18);
    ctx.restore();
    // register hit area
    const b = { x: tx - 10, y: y - 16, w: tw + 20, h: 32, slider: { key, min, max, x: tx, w: tw }, idx: game.ui.length };
    game.ui.push(b);
    const input = game.input;
    const mx = input.mouse.x, my = input.mouse.y;
    if (input.mouse.down && mx > b.x && mx < b.x + b.w && my > b.y && my < b.y + b.h) {
      s[key] = clamp(min + ((mx - tx) / tw) * (max - min), min, max);
      game.applySettings();
    }
    const tpm = game.touchAim;
    if (tpm && tpm.slider && tpm.slider.key === key) {
      s[key] = clamp(min + ((tpm.x - tx) / tw) * (max - min), min, max);
      game.applySettings();
    }
    y += rowH;
  };

  slider('MASTER VOLUME', 'master', 0, 1);
  slider('MUSIC', 'music', 0, 1);
  slider('SOUND EFFECTS', 'sfx', 0, 1);
  slider('CAMERA SHAKE', 'shake', 0, 1);
  slider('FLASH EFFECTS', 'flashes', 0, 1);

  // toggles
  const toggle = (label, key, fmt) => {
    const on = !!s[key];
    const bw = phone ? 96 : 130, bh = Math.min(34, rowH - 8);
    const bx = phone ? w - 16 - bw : cx + 90;
    const r = uiButton(game, {
      x: bx, y: y - bh / 2, w: bw, h: bh, label: on ? (fmt ? fmt(true) : 'ON') : (fmt ? fmt(false) : 'OFF'),
      small: true, onClick: () => { s[key] = on ? 0 : 1; game.applySettings(); },
    });
    ctx.save();
    ctx.textAlign = phone ? 'left' : 'right';
    ctx.font = `500 ${phone ? 12 : 13}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = phone ? '0.4px' : '2px';
    ctx.fillStyle = 'rgba(205,196,180,0.85)';
    const tShown = phone ? (label === 'INVERT PANIC FLASH' ? 'PANIC FLASH' : label === 'SCREEN CAPTIONS' ? 'CAPTIONS' : label) : label;
    ctx.fillText(tShown, phone ? 14 : bx - 20, y);
    ctx.restore();
    buttonVisual(ctx, r.b, { active: r.hover, label: on ? (fmt ? fmt(true) : 'ON') : (fmt ? fmt(false) : 'OFF'), small: true, accent: '#6a6a80' });
    y += rowH;
  };
  toggle('SCREEN CAPTIONS', 'captions');
  toggle('INVERT PANIC FLASH', 'invertPanic');

  // difficulty
  ctx.save();
  ctx.textAlign = phone ? 'left' : 'right';
  ctx.font = `500 ${phone ? 12 : 13}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = phone ? '0.4px' : '2px';
  ctx.fillStyle = 'rgba(205,196,180,0.85)';
  ctx.fillText('DIFFICULTY', phone ? 14 : cx + 90 - 20, y);
  ctx.restore();
  const diffKeys = Object.keys(DIFFICULTY);
  const bw2 = phone ? 120 : 130, bh2 = Math.min(34, rowH - 8), bx2 = phone ? w - 16 - bw2 : cx + 90;
  const r = uiButton(game, {
    x: bx2, y: y - bh2 / 2, w: bw2, h: bh2, label: DIFFICULTY[s.difficulty].label, small: true,
    onClick: () => {
      const i = diffKeys.indexOf(s.difficulty);
      s.difficulty = diffKeys[(i + 1) % diffKeys.length];
      game.applySettings();
    },
  });
  buttonVisual(ctx, r.b, { active: r.hover, label: DIFFICULTY[s.difficulty].label, small: true, accent: '#6a6a80' });
  y += rowH + 10;

  // Short phones already overflow. The menu footer and the HTML link cover them.
  if (h >= 700 && y < h - 150) {
    const pr = uiButton(game, {
      x: cx - 110, y: y - 16, w: 220, h: 36, label: 'PRIVACY & DELETE', small: true,
      onClick: () => game.setScreen('privacy', back),
    });
    buttonVisual(ctx, pr.b, { active: pr.hover, label: 'PRIVACY & DELETE', small: true, accent: '#6a6a80' });
  }

  const backBtn = uiButton(game, { x: cx - 110, y: h - 90, w: 220, h: 46, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(back) });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

/* ================= upgrades ================= */

