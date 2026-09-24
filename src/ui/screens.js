/* LAST NIGHT — menus & screens
 *
 * Immediate-mode UI. Buttons register themselves into game.ui each frame, which
 * gives us mouse, touch and keyboard navigation from one place.
 *
 * The menu is not a flat image: it is a small procedurally drawn diorama of the
 * mansion interior (moonlight, fog, candle, the vampire in the foreground) so it
 * uses exactly the same visual language as the game itself.
 */

import { clamp, lerp, damp, TAU, rand, chance, fmtClock, hash2, fmtBar } from '../core/util.js';
import { PAL } from '../core/render.js';
import { UPGRADES, upgradeLevel, DIFFICULTY, CODEX, NIGHT_DURATION, GAME_VERSION } from '../core/config.js';
import { Valen3D } from '../game/valen3d.js';
import { IAP, CATALOG } from '../shop/iap.js';
import { Ads } from '../shop/ads.js';

const SERIF = 'Georgia, "Palatino Linotype", "Times New Roman", serif';
const SANS = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'Consolas, "SF Mono", Menlo, monospace';

/** Phone first: portrait, and the short landscape most people actually hold. */
function isPhone(w, h) { return w < 840 || h < 500; }

function fitType(ctx, text, maxW, size, family, weight = 500) {
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


function wrapLines(ctx, text, maxW) {
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

function uiButton(game, { x, y, w, h, label, sub, onClick, disabled, small, align = 'center', accent = '#a8833c' }) {
  const idx = game.ui.length;
  const input = game.input;
  const mx = input.touchSeen ? -9999 : input.mouse.x;
  const my = input.touchSeen ? -9999 : input.mouse.y;
  const hover = !disabled && mx > x && mx < x + w && my > y && my < y + h;
  if (hover && game.uiHoverIdx !== idx) { game.uiHoverIdx = idx; game.audio.play('uiHover', { vol: 0.35 }); }
  const selected = game.uiIndex === idx;
  const active = (hover || selected) && !disabled;
  const b = { x, y, w, h, label, onClick: disabled ? null : onClick, disabled, idx };
  game.ui.push(b);
  return { b, active, hover, selected };
}

function buttonVisual(ctx, { x, y, w, h }, { active, disabled, label, sub, small, accent }) {
  ctx.save();
  const a = active ? 1 : 0.72;
  // backing
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, active ? 'rgba(60,42,20,0.55)' : 'rgba(16,16,22,0.55)');
  g.addColorStop(1, active ? 'rgba(30,20,10,0.35)' : 'rgba(10,10,14,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // frame
  ctx.strokeStyle = disabled ? 'rgba(90,88,84,0.35)' : `rgba(${accent === '#a8833c' ? '168,131,60' : '140,150,190'},${active ? 0.85 : 0.35})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (active) {
    ctx.strokeStyle = `rgba(${accent === '#a8833c' ? '168,131,60' : '140,150,190'},0.25)`;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  }
  // text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitType(ctx, label, Math.max(40, w - 18), small ? 15 : 18, SERIF);
  ctx.fillStyle = disabled ? 'rgba(140,138,132,0.5)' : active ? '#f2ead6' : 'rgba(214,206,190,' + a + ')';
  if (active) {
    ctx.shadowColor = 'rgba(255,200,120,0.35)';
    ctx.shadowBlur = 12;
  }
  ctx.fillText(label, x + w / 2, y + h / 2 + (sub ? -5 : 0));
  ctx.shadowBlur = 0;
  if (sub) {
    fitType(ctx, sub, Math.max(40, w - 16), 11, SANS, 400);
    ctx.fillStyle = 'rgba(190,182,168,0.6)';
    ctx.fillText(sub, x + w / 2, y + h / 2 + 14);
  }
  if (active) {
    // left/right ticks
    ctx.fillStyle = `rgba(${accent === '#a8833c' ? '200,160,80' : '160,175,220'},0.9)`;
    ctx.beginPath(); ctx.moveTo(x - 10, y + h / 2); ctx.lineTo(x - 4, y + h / 2 - 4); ctx.lineTo(x - 4, y + h / 2 + 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w + 10, y + h / 2); ctx.lineTo(x + w + 4, y + h / 2 - 4); ctx.lineTo(x + w + 4, y + h / 2 + 4); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ================= menu scene ================= */

export function drawMenuScene(game, ctx, w, h, t) {
  // ---- the hall, seen from the floor ----
  // back wall
  const wallG = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  wallG.addColorStop(0, '#0a0c14'); wallG.addColorStop(0.5, '#12131c'); wallG.addColorStop(1, '#080910');
  ctx.fillStyle = wallG;
  ctx.fillRect(0, 0, w, h * 0.72);
  // floor
  const floorG = ctx.createLinearGradient(0, h * 0.7, 0, h);
  floorG.addColorStop(0, '#161219'); floorG.addColorStop(1, '#08070a');
  ctx.fillStyle = floorG;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);

  // ---- tall gothic window with moonlight ----
  const wx = w * 0.66, wy = h * 0.1, ww = w * 0.2, wh = h * 0.5;
  ctx.save();
  ctx.fillStyle = '#070a12';
  ctx.fillRect(wx - 10, wy - 10, ww + 20, wh + 20);
  const glass = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  glass.addColorStop(0, '#1d2a44'); glass.addColorStop(0.55, '#2a3b5c'); glass.addColorStop(1, '#16203a');
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);
  // arched top
  ctx.beginPath();
  ctx.moveTo(wx - 10, wy);
  ctx.quadraticCurveTo(wx + ww / 2, wy - wh * 0.22, wx + ww + 10, wy);
  ctx.lineTo(wx + ww + 10, wy - 20); ctx.lineTo(wx - 10, wy - 20);
  ctx.closePath();
  ctx.fillStyle = '#0a0c14';
  ctx.fill();
  // mullions
  ctx.strokeStyle = '#0b0b10'; ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh * 0.34); ctx.lineTo(wx + ww, wy + wh * 0.34);
  ctx.moveTo(wx, wy + wh * 0.67); ctx.lineTo(wx + ww, wy + wh * 0.67);
  ctx.stroke();
  // the moon
  ctx.globalAlpha = 0.8;
  const mg = ctx.createRadialGradient(wx + ww * 0.62, wy + wh * 0.22, 0, wx + ww * 0.62, wy + wh * 0.22, 66);
  mg.addColorStop(0, 'rgba(226,238,255,0.95)');
  mg.addColorStop(0.22, 'rgba(180,205,240,0.45)');
  mg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(wx + ww * 0.62, wy + wh * 0.22, 66, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // light shaft onto the floor
  ctx.globalCompositeOperation = 'screen';
  const shaft = ctx.createLinearGradient(wx, wy + wh, wx + ww * 0.2, h);
  shaft.addColorStop(0, 'rgba(140,175,235,0.16)');
  shaft.addColorStop(0.6, 'rgba(110,145,205,0.07)');
  shaft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(wx, wy + wh);
  ctx.lineTo(wx + ww, wy + wh);
  ctx.lineTo(wx + ww * 1.9, h);
  ctx.lineTo(wx - ww * 0.9, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ---- dust motes in the shaft ----
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 40; i++) {
    const s = hash2(i, 7, 3);
    const px = wx + (hash2(i, 3, 9) - 0.2) * ww * 2 + Math.sin(t * 0.3 + i) * 14;
    const py = wy + hash2(i, 11, 5) * wh * 1.6 + ((t * 6 * (0.3 + s) + i * 30) % (h - wy));
    const a = 0.10 + 0.16 * Math.sin(t * 2 + i);
    ctx.fillStyle = `rgba(200,220,255,${clamp(a, 0, 0.3)})`;
    ctx.beginPath(); ctx.arc(px, py % h, 1.4 + s * 1.6, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // ---- chandelier ----
  const chx = w * 0.3, chy = h * 0.2;
  ctx.save();
  ctx.strokeStyle = '#101018'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(chx, 0); ctx.lineTo(chx, chy); ctx.stroke();
  const flick = 0.75 + 0.25 * Math.sin(t * 5.2) + 0.08 * Math.sin(t * 17);
  ctx.globalCompositeOperation = 'screen';
  const cg = ctx.createRadialGradient(chx, chy, 0, chx, chy, 260 * flick);
  cg.addColorStop(0, 'rgba(255,208,150,0.5)');
  cg.addColorStop(0.4, 'rgba(255,150,60,0.16)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(chx, chy, 260 * flick, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const px = chx + Math.cos(a) * 54, py = chy + Math.sin(a) * 16;
    ctx.fillStyle = '#d8cfb8';
    ctx.fillRect(px - 1.5, py - 12, 3, 12);
    ctx.globalCompositeOperation = 'screen';
    const fg = ctx.createRadialGradient(px, py - 14, 0, px, py - 14, 16);
    fg.addColorStop(0, `rgba(255,225,170,${0.8 * flick})`);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(px, py - 14, 16, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = '#191922';
  ctx.beginPath(); ctx.ellipse(chx, chy, 62, 16, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // ---- fog bank ----
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    const fx = ((t * (12 + i * 5) + i * 400) % (w + 700)) - 350;
    const fy = h * (0.6 + hash2(i, 2, 4) * 0.34);
    const fr = 240 + hash2(i, 5, 6) * 260;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, 'rgba(70,84,116,0.075)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // ---- the character, in the foreground, three-quarter to camera ----
  // Industry rule for a hero screen: the menu shows WHAT YOU PLAY, so the
  // loaded GLB itself stands in the hall (its rest pose, evaluated once).
  // The procedural figure survives only while the GLB is unavailable.
  const px = w * 0.16, py = h * 0.86;
  const br = Math.sin(t * 1.1) * 2.6;
  const vframe = Valen3D.renderMenu();
  ctx.save();
  ctx.translate(px, py + br);
  const scale = h / 760;
  ctx.scale(scale, scale);
  // long shadow (kept for both renderers: it is the same hall light)
  ctx.save();
  ctx.globalAlpha = 0.55;
  const sg = ctx.createLinearGradient(0, 0, 120, -140);
  sg.addColorStop(0, 'rgba(0,0,0,0.75)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(-16, 6); ctx.lineTo(10, 6); ctx.lineTo(150, -120); ctx.lineTo(120, -150);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  if (vframe) {
    Valen3D.draw(ctx, vframe, h * 0.46 / scale, { footInset: 8 });
  } else {
    // coat
    const coatG = ctx.createLinearGradient(0, -180, 0, 10);
    coatG.addColorStop(0, '#1a1b26'); coatG.addColorStop(0.6, '#101119'); coatG.addColorStop(1, '#07080c');
    ctx.fillStyle = coatG;
    ctx.beginPath();
    ctx.moveTo(-34, 8);
    ctx.quadraticCurveTo(-46, -70, -30, -118);
    ctx.quadraticCurveTo(-16, -150, 0, -152);
    ctx.quadraticCurveTo(16, -150, 30, -118);
    ctx.quadraticCurveTo(46, -70, 34, 8);
    ctx.quadraticCurveTo(0, 16, -34, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#14151f';
    ctx.beginPath(); ctx.ellipse(0, -128, 34, 22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0c0d14';
    ctx.beginPath();
    ctx.moveTo(-16, -146); ctx.lineTo(0, -122); ctx.lineTo(16, -146);
    ctx.quadraticCurveTo(0, -152, -16, -146);
    ctx.fill();
    ctx.fillStyle = '#05060a';
    ctx.beginPath();
    ctx.moveTo(-15, -150);
    ctx.quadraticCurveTo(-22, -176, -10, -192);
    ctx.quadraticCurveTo(6, -200, 15, -184);
    ctx.quadraticCurveTo(22, -168, 15, -150);
    ctx.quadraticCurveTo(0, -158, -15, -150);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,20,32,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-30, -110); ctx.quadraticCurveTo(-40, -50, -30, 4);
    ctx.moveTo(30, -110); ctx.quadraticCurveTo(40, -50, 30, 4);
    ctx.stroke();
  }
  ctx.restore();

  // ---- lightning flash ----
  if (game.menuLightning > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(190,215,255,${clamp(game.menuLightning, 0, 0.5)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ---- vignette ----
  ctx.save();
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export function drawTitle(game, ctx, w, h, t) {
  const phone = isPhone(w, h);
  const cx = w / 2;
  const ty = phone ? Math.min(h * 0.13, 72) : h * 0.2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleSize = phone ? clamp(w * 0.085, 28, 46) : clamp(w * 0.075, 42, 96);
  fitType(ctx, 'LAST NIGHT', w - 36, titleSize, SERIF, 400);
  const g = ctx.createLinearGradient(cx, ty - 40, cx, ty + 40);
  g.addColorStop(0, '#f4ecd8');
  g.addColorStop(0.5, '#cfc4a8');
  g.addColorStop(1, '#8d7f5f');
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = phone ? 12 : 22;
  ctx.fillText('LAST NIGHT', cx, ty);
  ctx.shadowBlur = 0;
  const rule = Math.min(150, w * 0.28);
  ctx.strokeStyle = 'rgba(140,26,36,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - rule, ty + (phone ? 28 : 52)); ctx.lineTo(cx + rule, ty + (phone ? 28 : 52));
  ctx.stroke();
  fitType(ctx, 'SURVIVE UNTIL DAWN.', w - 36, phone ? 12 : clamp(w * 0.014, 13, 18), SANS, 400);
  ctx.fillStyle = 'rgba(200,190,172,0.75)';
  ctx.fillText('SURVIVE UNTIL DAWN.', cx, ty + (phone ? 46 : 86));
  ctx.restore();
}

/* ================= main menu ================= */

export function drawMenu(game, ctx, w, h) {
  const t = game.time;
  drawMenuScene(game, ctx, w, h, t);
  drawTitle(game, ctx, w, h, t);
  // build stamp — small, honest, visible: v1.0.0-beta line
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `400 10px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
  ctx.fillStyle = 'rgba(140,134,124,0.4)';
  ctx.fillText('v' + GAME_VERSION + '  ·  18+' + (IAP.owns(game.save, 'title_dawnbreaker') ? '  ·  DAWNBREAKER' : ''), 12, 16);
  ctx.restore();

  if (!game.save.privacyAck) {
    drawConsent(game, ctx, w, h);
    return;
  }

  // Short landscape phones used to push MAIN-equivalent rows off the bottom.
  // Fit the stack between the title and the footer instead of hoping h*0.41 works.
  const B = game.save;
  const canUpgrade = (B.shards || 0) > 0;
  const goalLine = B.goals && B.goals.done ? `${B.goals.done} GOALS MET ACROSS ${B.goals.nights} NIGHTS` : 'THE NIGHT HAS GOALS NOW';
  const marketOpen = (B.nightsAttempted || 0) > 0;
  const defs = [
    { label: 'PLAY', sub: 'ONE NIGHT. FIVE MINUTES. THREE GOALS.', onClick: () => game.beginNight() },
    { label: 'UPGRADES', sub: canUpgrade ? `${B.shards} BLOOD SHARDS` : 'EARNED BY SURVIVING', onClick: () => game.setScreen('upgrades') },
    ...(marketOpen ? [{ label: 'BLOOD MARKET', sub: 'OPTIONAL. THE NIGHT DOES NOT ASK.', onClick: () => game.setScreen('shop') }] : []),
    { label: 'COLLECTION', sub: `${Object.keys(B.seen || {}).length}/${CODEX.length} RECORDED`, onClick: () => game.setScreen('collection') },
    { label: 'SETTINGS', sub: DIFFICULTY[B.settings.difficulty]?.label || 'STANDARD', onClick: () => game.setScreen('settings') },
  ];
  const nButtons = defs.length;
  const phone = isPhone(w, h);
  const footerH = phone ? 64 : 78;
  const titleBottom = phone ? Math.min(h * 0.13, 72) + 58 : h * 0.18 + 72;
  const startY = phone ? titleBottom : Math.max(titleBottom, h < 520 ? h * 0.28 : h * 0.36);
  const avail = Math.max(96, h - footerH - startY);
  const gap = phone ? 6 : (avail < nButtons * 40 ? 4 : 8);
  const bh = clamp((avail - gap * (nButtons - 1)) / nButtons, phone ? 42 : 28, phone ? 56 : 48);
  const bw = phone ? Math.min(w - 32, 480) : clamp(w * 0.22, 188, 300);
  const bx = phone ? (w - bw) / 2 : w / 2 - bw / 2;
  let by = startY;
  game.uiIndex = clamp(game.uiIndex, 0, defs.length - 1);
  defs.forEach((d, i) => {
    const r = uiButton(game, { x: bx, y: by, w: bw, h: bh, label: d.label, sub: d.sub, onClick: d.onClick });
    buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: d.label, sub: d.sub, accent: i === 0 ? '#a8833c' : '#6a6a80' });
    by += bh + gap;
  });

  // stats footer
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 ${phone ? 11 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
  ctx.fillStyle = 'rgba(180,172,158,0.6)';
  const best = B.bestTime > 0 ? fmtClock(B.bestTime) : '--:--';
  const stat = phone
    ? `NIGHTS ${B.nightsSurvived}   ·   BEST ${best}   ·   ◆ ${B.shards}`
    : `NIGHTS SURVIVED ${B.nightsSurvived}     BEST ${best}     SHARDS ${B.shards}`;
  ctx.fillText(stat, w / 2, h - (phone ? 22 : 34));
  if (!phone) ctx.fillText(goalLine, w / 2, h - 48);
  if (!phone) {
    ctx.font = `400 10px ${SANS}`;
    ctx.fillStyle = 'rgba(140,134,124,0.45)';
    const hint = w < 720
      ? 'DRAG LEFT TO MOVE  ·  BUTTONS ON THE RIGHT  ·  ESC PAUSE'
      : 'DRAG LEFT TO MOVE  ·  RIGHT BUTTONS ACT  ·  WASD STILL WORKS  ·  F CLAW  ·  E USE  ·  ESC PAUSE';
    ctx.fillText(hint, w / 2, h - 16);
  }
  ctx.restore();

  const pr = uiButton(game, {
    x: phone ? w - 100 : w - 112, y: h - (phone ? 46 : 38), w: phone ? 88 : 96, h: phone ? 34 : 26, label: 'PRIVACY', small: true,
    onClick: () => game.setScreen('privacy'),
  });
  buttonVisual(ctx, pr.b, { active: pr.hover, label: 'PRIVACY', small: true, accent: '#6a6a80' });
}

function drawConsent(game, ctx, w, h) {
  const cardW = Math.min(540, w - 28);
  const cardH = Math.min(360, h - 96);
  const x = (w - cardW) / 2;
  const y = Math.max(64, (h - cardH) / 2);
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.94)';
  ctx.fillRect(x, y, cardW, cardH);
  ctx.strokeStyle = 'rgba(168,131,60,0.45)';
  ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e0cc';
  ctx.font = `400 ${cardW < 420 ? 16 : 20}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText('BEFORE THE NIGHT', w / 2, y + 32);
  ctx.font = `400 ${h < 420 ? 11 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
  ctx.fillStyle = 'rgba(205,196,180,0.82)';
  const lines = [
    '18+ horror. No account. No ads. No location.',
    'Progress stays on this device until you delete it.',
    'On Google Play, digital goods bill through Google Play Billing.',
    'In the browser, payment uses Midtrans. A random device id is created only when you pay, and sent to finish that payment.',
    'You can wipe the save from Privacy, in the game or on the web.',
  ].flatMap((t) => wrapLines(ctx, t, cardW - 36));
  const gap = Math.max(13, Math.min(20, (cardH - 108) / Math.max(1, lines.length)));
  lines.forEach((line, i) => ctx.fillText(line, w / 2, y + 54 + i * gap));
  ctx.restore();
  const bw = Math.min(200, (cardW - 36) / 2);
  const by = y + cardH - 58;
  const ok = uiButton(game, {
    x: w / 2 - bw - 8, y: by, w: bw, h: 40, label: 'I UNDERSTAND', small: true,
    onClick: () => game.acceptPrivacy(),
  });
  buttonVisual(ctx, ok.b, { active: ok.hover, label: 'I UNDERSTAND', small: true, accent: '#a8833c' });
  const pol = uiButton(game, {
    x: w / 2 + 8, y: by, w: bw, h: 40, label: 'PRIVACY', small: true,
    onClick: () => game.setScreen('privacy'),
  });
  buttonVisual(ctx, pol.b, { active: pol.hover, label: 'PRIVACY', small: true, accent: '#6a6a80' });
}

export function drawPrivacy(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.94)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e0cc';
  ctx.font = `400 26px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText('PRIVACY', w / 2, 46);
  ctx.font = `400 ${w < 720 ? 12 : 13}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3px';
  ctx.fillStyle = 'rgba(205,196,180,0.84)';
  let pid = 'not created — nothing has been sent';
  try { pid = localStorage.getItem('lastnight.playerId') || pid; } catch (e) { /* private mode */ }
  const lines = [
    '18+. This build does not show ads and does not read location, contacts, or photos.',
    'There is no account. The save lives on this device (lastnight.save.v1).',
    'Google Play digital goods are billed by Google Play Billing, not Midtrans.',
    'Browser payments use Midtrans, merchant M769336744. The server key is not in the app.',
    'Device id: ' + pid,
    'Delete removes the save, that id, and asks the payment server to drop the ledger.',
    'The same page is at privacy.html. Deletion without the game is at delete.html.',
  ].flatMap((t) => wrapLines(ctx, t, w - 48));
  const top = isPhone(w, h) ? 48 : 72;
  const gap = Math.max(13, Math.min(22, (h - (isPhone(w, h) ? 168 : 140)) / Math.max(1, lines.length)));
  lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * gap));
  ctx.restore();

  const bw = Math.min(200, (w - 48) / 3);
  const by = Math.min(h - 56, Math.max(top + lines.length * gap + 8, h - 72));
  const page = uiButton(game, {
    x: w / 2 - bw * 1.5 - 12, y: by, w: bw, h: 40, label: 'FULL POLICY', small: true,
    onClick: () => { try { window.open('./privacy.html', '_blank', 'noopener'); } catch (e) { /* blocked */ } },
  });
  buttonVisual(ctx, page.b, { active: page.hover, label: 'FULL POLICY', small: true, accent: '#6a6a80' });
  const delLabel = game.privacyDeleteArmed ? 'CONFIRM DELETE' : 'DELETE DATA';
  const del = uiButton(game, {
    x: phone ? 12 : w / 2 - bw / 2, y: phone ? by0 + bh + 6 : by0, w: bw, h: bh, label: delLabel, small: true,
    onClick: () => {
      if (!game.privacyDeleteArmed) { game.privacyDeleteArmed = true; return; }
      game.wipeLocalData();
    },
  });
  buttonVisual(ctx, del.b, { active: del.hover, label: delLabel, small: true, accent: '#8a3030' });
  const bk = uiButton(game, {
    x: phone ? 12 : w / 2 + bw / 2 + 12, y: phone ? by0 + (bh + 6) * 2 : by0, w: bw, h: bh, label: 'BACK', small: true,
    onClick: () => { game.privacyDeleteArmed = false; game.setScreen(back); },
  });
  buttonVisual(ctx, bk.b, { active: bk.hover, label: 'BACK', small: true, accent: '#a8833c' });
}

/* ================= intro card ================= */

export function drawIntro(game, ctx, w, h) {
  const t = game.introT;
  const a = clamp(t / 0.6, 0, 1) * clamp((game.introLen - t) / 0.8, 0, 1);
  ctx.save();
  ctx.fillStyle = `rgba(3,4,8,${clamp(1 - t / 0.4, 0, 1) * 0.85})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Mobile-safe: the intro type scales with the shorter axis and the body
  // copy re-wraps inside the viewport, flowing top-down so narrow screens
  // can never make two lines collide. A launch card that clips off-screen
  // reads as a broken game before the game has even started.
  const sc = clamp(Math.min(w / 900, h / 620), 0.58, 1);
  const maxW = w * 0.86;
  const wrap = (text, font) => {
    ctx.font = font;
    const words = text.split(' ');
    const out = []; let cur = '';
    for (const word of words) {
      const next = cur ? cur + ' ' + word : word;
      if (ctx.measureText(next).width > maxW && cur) { out.push(cur); cur = word; }
      else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const bodyFont = `400 ${15 * sc}px ${SANS}`;
  const body = [
    ...wrap('You woke hungry. The servant door is already shaking.', bodyFont),
    ...wrap('Bar it, or open it and feed. You cannot do both.', bodyFont),
  ];
  const draw = (text, { f, style, ls, y, c }) => {
    ctx.font = `400 ${f}px ${style}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';
    ctx.fillStyle = c;
    ctx.fillText(text, w / 2, h * y);
  };
  draw('LAST NIGHT', { f: 40 * sc, style: SERIF, ls: 10 * sc, y: 0.24, c: '#efe7d4' });
  let fy = 0.36;
  for (const b of body) { draw(b, { f: 15 * sc, style: SANS, ls: 2 * sc, y: fy, c: 'rgba(200,192,176,0.8)' }); fy += 0.042; }
  fy = Math.max(0.55, fy + 0.03);
  draw('SURVIVE UNTIL DAWN.', { f: 22 * sc, style: SERIF, ls: 6 * sc, y: fy, c: '#c8a04a' });
  draw('00:00  →  05:00', { f: 20 * sc, style: MONO, ls: 4 * sc, y: fy + 0.06, c: 'rgba(220,214,198,0.9)' });
  const hintY = fy + 0.12;
  ctx.globalAlpha = a * 0.6;
  ctx.font = `400 12px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(190,182,168,0.9)';
  ctx.fillText('TAP TO WAKE', w / 2, h * hintY);
  ctx.restore();
}

/* ================= pause ================= */

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

  const bw = phone ? Math.min(w - 28, 420) : Math.min(240, w * 0.7);
  const items = [
    { label: 'RESUME', onClick: () => game.togglePause(false) },
    { label: 'RESTART NIGHT', onClick: () => game.beginNight() },
    { label: 'SETTINGS', onClick: () => game.setScreen('settings', 'paused') }, // v1.0 FIX: 'pause' was no real screen — BACK from settings black-holed the game
    { label: 'HOW TO SURVIVE', onClick: () => game.setScreen('help', 'paused') }, // same black-hole as the SETTINGS row above
    { label: 'ABANDON', onClick: () => game.toMenu() },
  ];
  const gap = h < 520 ? 4 : 8;
  const bh = clamp((h * 0.62 - gap * (items.length - 1)) / items.length, 28, 46);
  const stack = (bh + gap) * items.length - gap;
  const centered = (h - stack) / 2;
  let by = Math.max(titleY + 36, Math.min(centered, h - stack - 12));
  items.forEach((it, i) => {
    const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, small: true, accent: '#6a6a80' });
    buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: '#6a6a80' });
    by += bh + gap;
  });
}

/* ================= settings ================= */

export function drawSettings(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  const s = game.save.settings;
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.9)';
  ctx.fillRect(0, 0, w, h);
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

export function drawUpgrades(game, ctx, w, h) {
  const B = game.save;
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.92)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phoneTitle = isPhone(w, h);
  fitType(ctx, 'BLOOD SHARDS', w - 32, phoneTitle ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('BLOOD SHARDS', w / 2, phoneTitle ? 28 : h * 0.12);
  ctx.font = `400 14px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.9)';
  ctx.fillText(`◆ ${B.shards} AVAILABLE`, w / 2, h * 0.175);
  ctx.restore();

  const phone = isPhone(w, h);
  const pad = phone ? 12 : Math.max(24, (w - 640) / 2);
  const rowW = w - pad * 2;
  const top = phone ? 64 : h * 0.24;
  const bottom = h - (phone ? 58 : 108);
  const rowH = clamp((bottom - top) / UPGRADES.length, phone ? 54 : 64, 76);
  let y = top;
  const bx = pad;
  UPGRADES.forEach((u, i) => {
    const lvl = upgradeLevel(B, u.id);
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : u.costs[lvl];
    const afford = !maxed && B.shards >= cost;
    ctx.save();
    // row backing
    ctx.fillStyle = 'rgba(12,12,18,0.7)';
    ctx.fillRect(bx, y, rowW, rowH - 8);
    ctx.strokeStyle = 'rgba(140,120,70,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, rowW - 1, rowH - 9);
    // icon
    ctx.translate(bx + 40, y + (rowH - 10) / 2);
    drawUpgradeIcon(ctx, u.icon, lvl);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'left';
    ctx.font = `500 16px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = '#ded4bc';
    ctx.fillText(u.name, bx + 78, y + 22);
    ctx.font = `400 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(180,172,158,0.7)';
    const descMax = rowW - 78 - (phone ? 100 : 150);
    let desc = u.desc;
    while (ctx.measureText(desc).width > descMax && desc.length > 8) desc = desc.slice(0, -2);
    if (desc !== u.desc) desc = desc.replace(/[,.;]$/, '') + '…';
    if (rowH >= 62) ctx.fillText(desc, bx + 78, y + 40);
    // pips
    for (let k = 0; k < u.max; k++) {
      const px = bx + 78 + k * 20;
      ctx.fillStyle = k < lvl ? '#b8202e' : 'rgba(120,116,110,0.3)';
      ctx.beginPath();
      ctx.moveTo(px + 6, y + 52 - 6);
      ctx.lineTo(px + 12, y + 52);
      ctx.lineTo(px + 6, y + 52 + 6);
      ctx.lineTo(px, y + 52);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // buy button
    const bw = phone ? 88 : 130, bh = Math.min(36, rowH - 16);
    const r = uiButton(game, {
      x: bx + rowW - bw - 10, y: y + (rowH - 8) / 2 - bh / 2, w: bw, h: bh,
      label: maxed ? 'MASTERED' : `◆ ${cost}`, small: true,
      disabled: maxed || !afford,
      accent: '#a8833c',
      onClick: () => game.buyUpgrade(u.id),
    });
    buttonVisual(ctx, r.b, { active: r.hover, label: maxed ? 'MASTERED' : `◆ ${cost}`, small: true, disabled: maxed || !afford, accent: '#a8833c' });
    y += rowH;
  });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 12px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(170,162,150,0.6)';
  if (!phone) ctx.fillText('BLOOD SHARDS ARE EARNED BY SURVIVING. THE LONGER YOU LAST, THE MORE YOU KEEP.', w / 2, h - 128);
  ctx.restore();

  const backBtn = uiButton(game, { x: w / 2 - 110, y: h - 88, w: 220, h: 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

function drawUpgradeIcon(ctx, kind, lvl) {
  ctx.save();
  ctx.globalAlpha = 0.25 + lvl * 0.25;
  ctx.strokeStyle = '#c09040';
  ctx.fillStyle = '#c09040';
  ctx.lineWidth = 2;
  switch (kind) {
    case 'blood':
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.quadraticCurveTo(11, 2, 0, 13);
      ctx.quadraticCurveTo(-11, 2, 0, -14);
      ctx.fill();
      break;
    case 'boot':
      ctx.beginPath();
      ctx.moveTo(-6, -14); ctx.lineTo(4, -14); ctx.lineTo(4, 4); ctx.lineTo(12, 8);
      ctx.lineTo(12, 14); ctx.lineTo(-6, 14); ctx.closePath();
      ctx.stroke();
      break;
    case 'plank':
      ctx.beginPath(); ctx.rect(-14, -6, 28, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-8, 6); ctx.moveTo(6, -6); ctx.lineTo(6, 6); ctx.stroke();
      break;
    case 'claw':
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-9, i * 7 - 4);
        ctx.quadraticCurveTo(0, i * 7 + 8, 10, i * 7 + 1);
        ctx.stroke();
      }
      break;
    case 'fangs':
      ctx.beginPath();
      ctx.moveTo(-8, -8); ctx.lineTo(-2, 12); ctx.lineTo(-1, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(8, -8); ctx.lineTo(2, 12); ctx.lineTo(1, -8); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}

/* ================= collection ================= */

export function drawCollection(game, ctx, w, h) {
  const B = game.save;
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.93)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'COLLECTION', w - 32, phone ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('COLLECTION', w / 2, phone ? 26 : h * 0.13);
  ctx.restore();

  const cols = phone ? 1 : Math.min(3, Math.max(1, Math.floor(w / 380)));
  const gap = phone ? 8 : 16;
  const cw = phone ? w - 24 : Math.min(340, (w - 80) / cols - gap);
  const rows = Math.ceil(CODEX.length / cols);
  const top = phone ? 44 : h * 0.22;
  const bottom = h - (phone ? 56 : 84);
  const ch = clamp((bottom - top) / rows - gap, phone ? 40 : 120, phone ? 108 : 170);
  const x0 = phone ? 12 : w / 2 - (cols * (cw + gap) - gap) / 2;
  let y = top;
  CODEX.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = x0 + col * (cw + gap);
    const yy = y + row * (ch + gap);
    const known = !!B.seen[c.id];
    ctx.save();
    ctx.fillStyle = known ? 'rgba(14,14,20,0.75)' : 'rgba(8,8,12,0.6)';
    ctx.fillRect(x, yy, cw, ch);
    ctx.strokeStyle = known ? 'rgba(150,125,70,0.35)' : 'rgba(80,78,74,0.22)';
    ctx.strokeRect(x + 0.5, yy + 0.5, cw - 1, ch - 1);
    ctx.textAlign = 'left';
    ctx.font = `500 16px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = known ? '#ded4bc' : 'rgba(120,116,110,0.6)';
    ctx.fillText(known ? c.name : '??? ' + c.name.slice(0, 2) + '· · ·', x + 18, ch < 64 ? yy + ch / 2 : yy + 30);
    if (!known && ch >= 80) {
      // blind-box teaser: the initials, a silhouette, and nothing else
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#9aa4bd';
      ctx.beginPath(); ctx.ellipse(x + cw - 44, yy + ch - 52, 16, 22, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + cw - 44, yy + ch - 82, 7, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.font = `400 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = known ? 'rgba(190,182,166,0.8)' : 'rgba(110,106,100,0.5)';
    const txt = known ? c.text
      : 'A shape the house has not handed over yet. ' +
        'Every night keeps its names in a different room.';
    if (ch >= 70) wrapText(ctx, txt, x + 18, yy + 56, cw - 36, 17);
    ctx.restore();
  });

  const backBtn = uiButton(game, { x: phone ? 12 : w / 2 - 110, y: h - (phone ? 48 : 84), w: phone ? w - 24 : 220, h: phone ? 40 : 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

function wrapText(ctx, text, x, y, maxW, lh) {
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

export function drawHelp(game, ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.93)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'HOW TO SURVIVE', w - 28, phone ? 20 : 28, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('HOW TO SURVIVE', w / 2, phone ? 26 : h * 0.12);

  const lines = [
    ['WHICH WAY.', 'Drag the left stick — she walks the way you push. The floor mark shows where the claw will go. WASD still works.'],
    ['YOU ARE NOT A SOLDIER.', 'You are a wounded predator in a locked house. You do not have to kill anything.'],
    ['DOORS ARE YOUR LIFE.', 'You cannot hold every door. The kitchen door is weak on purpose. FIX repairs. BOARD spends planks.'],
    ['BLOOD IS EVERYTHING.', 'It drains with time. The larder feeds you and calls the kitchen door. The study lamp and the altar only slow them.'],
    ['LISTEN.', 'A knock you cannot see leaves a chevron on the screen edge. It points at the door. It does not say what is there.'],
    ['DAWN IS AT 05:00.', 'Five minutes. Do not spend them fighting. Spend them surviving.'],
  ];
  let y = h * 0.2;
  ctx.textAlign = 'left';
  const x = Math.max(20, w / 2 - Math.min(330, w * 0.42));
  const maxW = Math.min(660, w - x - 20);
  const slot = Math.max(46, (h - 96 - y) / lines.length);
  for (const [head, body] of lines) {
    ctx.font = `500 ${slot < 52 ? 13 : 15}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = '#c8a04a';
    ctx.fillText(head, x, y);
    ctx.font = `400 ${slot < 52 ? 12 : 13}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(198,190,176,0.85)';
    wrapText(ctx, body, x, y + 16, maxW, slot < 52 ? 14 : 16);
    y += slot;
  }
  ctx.restore();

  const backBtn = uiButton(game, { x: phone ? 12 : w / 2 - 110, y: h - (phone ? 48 : 80), w: phone ? w - 24 : 220, h: phone ? 40 : 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

/* ================= death ================= */

export function drawDeath(game, ctx, w, h) {
  const t = game.deathScreenT;
  const a = clamp(t / 1.6, 0, 1);
  ctx.save();
  ctx.fillStyle = `rgba(2,3,6,${0.55 + a * 0.4})`;
  ctx.fillRect(0, 0, w, h);
  // the vampire's blood pooling on the floor
  ctx.globalAlpha = clamp(t / 4, 0, 0.8);
  const g = ctx.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, 260);
  g.addColorStop(0, 'rgba(90,8,16,0.75)');
  g.addColorStop(0.5, 'rgba(50,4,10,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, 260, 90, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  const fade = clamp((t - 1.2) / 1.4, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitType(ctx, 'THE NIGHT CLAIMED YOU', w - 28, isPhone(w, h) ? 22 : clamp(w * 0.035, 26, 44), SERIF, 400);
  ctx.fillStyle = '#8e1622';
  ctx.shadowColor = 'rgba(180,20,30,0.4)'; ctx.shadowBlur = 24;
  ctx.fillText('THE NIGHT CLAIMED YOU', w / 2, isPhone(w, h) ? Math.min(h * 0.22, 72) : h * 0.3);
  ctx.shadowBlur = 0;
  // v1.0 (QA P2-9): the death screen teaches. What actually got you.
  if (game.deathReason) {
    ctx.font = `italic 400 15px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(178,120,110,0.85)';
    ctx.fillText(String(game.deathReason).toUpperCase(), w / 2, h * 0.365);
  }

  const stats = game.stats;
  const rows = [
    ['SURVIVED', fmtClock(game.time)],
    ['BEST', game.save.bestTime > 0 ? fmtClock(game.save.bestTime) : '--:--'],
    ['NIGHTS SURVIVED', String(game.save.nightsSurvived)],
  ];
  let y = h * 0.43;
  for (const [k, v] of rows) {
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(170,162,150,0.7)';
    ctx.fillText(k, w / 2, y);
    ctx.font = `400 22px ${MONO}`;
    ctx.fillStyle = '#e2dac6';
    ctx.fillText(v, w / 2, y + 26);
    y += 62;
  }
  // shards earned
  if (game.shardsEarned > 0) {
    ctx.font = `500 13px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(200,160,74,0.9)';
    ctx.fillText(`◆ +${game.shardsEarned} BLOOD SHARDS`, w / 2, y + 6);
  }
  // tonight's goals board — partial credit, shown honestly
  if (game.lastNightGoals && game.lastNightGoals.length) {
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    const done = game.lastNightGoals.filter((g) => g.state === 'done');
    ctx.fillStyle = 'rgba(160,154,142,0.75)';
    ctx.fillText(`GOALS ${done.length}/${game.lastNightGoals.length} — ` + game.lastNightGoals.map((g) => (g.state === 'done' ? '✓' : '·') + ' ' + g.label).join('   '), w / 2, y + 30);
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : 220, bh = h < 520 ? 42 : 48;
    const items = [
      { label: 'TRY AGAIN', onClick: () => game.beginNight(), accent: '#a8833c' },
    ];
    if (!game.usedRevive && game.save.iap && game.save.iap.revives > 0) {
      items.push({ label: 'USE SECOND BLOOD', onClick: () => game.spendSecondBlood(), accent: '#6a6a80' });
    }
    items.push(
      { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'death'), accent: '#6a6a80' },
      { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
    );
    // v1.0 — rewarded revive offer, opt-in, once per night (src/shop/ads.js).
    if (!game.usedRevive && Ads.isAvailable('revive')) {
      items.unshift({ label: Ads.label('revive'), onClick: () => game.requestAdRevive(), accent: '#6a2230' });
    }
    // v1.0 (QA P0-2): stack from the bottom edge upward — landscape phones
    // never clip the last button, whatever the row count.
    const gap = h < 640 ? 6 : 8;
    let by = Math.min(h * 0.76, h - (items.length * (bh + gap)) - 14);
    items.forEach((it, i) => {
      const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
      buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
      by += bh + gap;
    });
  }
}

/* ================= victory ================= */

export function drawVictory(game, ctx, w, h) {
  const t = game.victoryScreenT;
  const dawnA = clamp(t / 2.5, 0, 1);
  ctx.save();
  // dawn flooding the room
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(232,168,96,${0.30 * dawnA})`);
  g.addColorStop(0.5, `rgba(150,92,80,${0.22 * dawnA})`);
  g.addColorStop(1, `rgba(20,16,26,${0.5 + 0.3 * dawnA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // sun shafts
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.15 + i * 0.18);
    const sg = ctx.createLinearGradient(x, 0, x + 260, h);
    sg.addColorStop(0, `rgba(255,214,150,${0.10 * dawnA})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 90, 0); ctx.lineTo(x + 420, h); ctx.lineTo(x + 240, h);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  const fade = clamp((t - 0.8) / 1.2, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'LAST NIGHT', w - 28, phone ? 16 : clamp(w * 0.026, 20, 34), SERIF, 400);
  ctx.fillStyle = 'rgba(226,218,200,0.85)';
  ctx.fillText('LAST NIGHT', w / 2, phone ? 28 : h * 0.14);
  fitType(ctx, 'SURVIVED', w - 28, phone ? 32 : clamp(w * 0.05, 36, 64), SERIF, 400);
  ctx.fillStyle = '#f0e6c8';
  ctx.shadowColor = 'rgba(255,200,120,0.45)'; ctx.shadowBlur = 30;
  ctx.fillText('SURVIVED', w / 2, phone ? 64 : h * 0.23);
  ctx.shadowBlur = 0;
  if (IAP.owns(game.save, 'title_dawnbreaker')) {
    ctx.font = `400 14px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(224, 180, 92, 0.9)';
    ctx.fillText('THE HOUSE CALLS YOU DAWNBREAKER', w / 2, h * 0.29);
  }
  ctx.restore();

  if (game.newRecord && fade > 0.6) {
    const p = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.save();
    ctx.globalAlpha = fade * (0.6 + p * 0.4);
    ctx.textAlign = 'center';
    ctx.font = `500 15px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillStyle = '#e0b45c';
    ctx.fillText('NEW RECORD', w / 2, h * 0.315);
    ctx.restore();
  }

  const s = game.stats;
  const rows = [
    ['SURVIVAL TIME', fmtClock(game.nightDuration)],
    ['BLOOD REMAINING', Math.round((game.player.blood / game.player.bloodMax) * 100) + '%'],
    ['DOORS SURVIVING', `${s.doorsSurviving}/${s.doorsTotal}`],
    ['ENEMIES DEFEATED', String(s.kills)],
    ['NEAREST OF DEATH', s.closestCall > 0 ? Math.round(s.closestCall * 100) + '% BLOOD' : '—'],
  ];
  const gap = h < 640 ? 5 : 8;
  const bh = h < 520 ? 36 : 46;
  const buttonStack = (bh + gap) * 3 - gap;
  const buttonTop = h - buttonStack - 12;
  const rowH = h < 520 ? 18 : 34;
  ctx.save();
  ctx.globalAlpha = fade;
  const cx = w / 2;
  let y = Math.min(h * 0.38, buttonTop - rowH * rows.length - 36);
  ctx.textAlign = 'left';
  for (const [k, v] of rows) {
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(168,160,148,0.75)';
    const half = Math.min(200, w * 0.38);
    ctx.fillText(k, cx - half, y);
    ctx.textAlign = 'right';
    ctx.font = `400 ${w < 520 ? 14 : 19}px ${MONO}`;
    ctx.fillStyle = '#eae1c8';
    ctx.fillText(v, cx + half, y);
    ctx.textAlign = 'left';
    // dotted leader
    ctx.strokeStyle = 'rgba(140,132,118,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 40, y - 4); ctx.lineTo(cx + 40, y - 4); ctx.stroke();
    y += rowH;
  }
  ctx.font = `500 13px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`◆ +${game.shardsEarned} BLOOD SHARDS`, cx, y + 12);
  if (game.lastNightGoals && game.lastNightGoals.length) {
    const done = game.lastNightGoals.filter((g) => g.state === 'done');
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(190,184,170,0.8)';
    const goalLine = w < 640
      ? `GOALS ${done.length}/${game.lastNightGoals.length}`
      : `GOALS ${done.length}/${game.lastNightGoals.length} — ` + game.lastNightGoals.map((g) => (g.state === 'done' ? '✓' : '·') + ' ' + g.label).join('   ');
    ctx.fillText(goalLine, cx, Math.min(y + 28, buttonTop - 16));
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : Math.min(220, w * 0.72);
    const items = [
      { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'victory'), accent: '#a8833c' },
      { label: 'ANOTHER NIGHT', onClick: () => game.beginNight(), accent: '#a8833c' },
      { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
    ];
    let by = buttonTop;
    items.forEach((it, i) => {
      const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
      buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
      by += bh + gap;
    });
  }
}

/* ================= in-run tutorial hints ================= */

export function drawTutorial(game, ctx, w, h) {
  if (game.save.tutorialSeen && !game.showTutorialHints) return;
  const t = game.time;
  const touch = game.input && (game.input.touchSeen || w < 900);
  const hints = [
    { at: 14, life: 6, text: touch ? 'CLAW FEEDS YOU. DASH COSTS BLOOD.' : 'F CLAWS. SHIFT DASHES. BOTH COST BLOOD.' },
    { at: 24, life: 6, text: 'YOU CANNOT HOLD EVERY DOOR. PICK ONE TO ABANDON.' },
  ];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const hnt of hints) {
    const dt = t - hnt.at;
    if (dt < 0 || dt > hnt.life) continue;
    const a = clamp(dt / 0.6, 0, 1) * clamp((hnt.life - dt) / 1.2, 0, 1);
    ctx.globalAlpha = a * 0.85;
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = '#cfc4a8';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    const maxW = w * 0.86;
    const words = hnt.text.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? cur + ' ' + word : word;
      if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = word; }
      else cur = next;
    }
    if (cur) lines.push(cur);
    const y0 = h * 0.22;
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, y0 + i * 16));
  }
  ctx.restore();
}

/* ================= the Blood Market (IAP) — src/shop/iap.js =================
 * Catalog policy lives in iap.js; this screen is only its face. Every card
 * states plainly what it is, every item is also shard-buyable, the sandbox
 * mark (⌁) tells beta testers no real money moves. No ads anywhere in the
 * game — that is a feature, and it is written on the wall.
 */
export function drawShop(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  const B = game.save;
  ctx.save();
  ctx.fillStyle = 'rgba(4,5,9,0.94)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'BLOOD MARKET', w - 32, phone ? 22 : clamp(w * 0.03, 22, 32), SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('BLOOD MARKET', w / 2, phone ? 28 : h * 0.075);
  fitType(ctx, `◆ ${B.shards}`, w - 32, phone ? 12 : 13, MONO, 400);
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  const purse = phone
    ? `◆ ${B.shards} EARNED   ·   MERCY ${(B.iap && B.iap.revives) | 0}`
    : `◆ ${B.shards} EARNED   ·   MERCY HELD ${(B.iap && B.iap.revives) | 0}   ·   NOTHING HERE CHANGES THE CLAW`;
  ctx.fillText(purse, w / 2, phone ? 48 : h * 0.125);
  // v1.0 — the daily rewarded crate (opt-in, capped, invisible when no ad
  // network is configured). AdMob SSV is required before real keys: docs/IAP.md.
  if (Ads.isAvailable('crate')) {
    const aw = Math.min(260, w * 0.42), ah = 30;
    const ar = uiButton(game, { x: w / 2 - aw / 2, y: h * 0.155, w: aw, h: ah, label: Ads.label('crate'), onClick: () => game.requestAdCrate(), small: true, accent: '#6a2230' });
    buttonVisual(ctx, ar.b, { active: ar.hover, label: Ads.label('crate'), small: true, accent: '#6a2230' });
  }
  ctx.restore();

  const wide = !phone && w >= 980 && h >= 640;
  const cols = wide ? 2 : 1;
  const gap = phone ? 8 : 12;
  const padX = phone ? 12 : (wide ? 60 : 24);
  const cardW = (w - padX * 2 - gap * (cols - 1)) / cols;
  const rows = Math.ceil(CATALOG.length / cols);
  const gridTop = phone ? 62 : h * 0.175;
  const footY = h - (phone ? 58 : (wide ? 76 : 62));
  const cardH = clamp((footY - gridTop - gap * (rows - 1)) / rows, phone ? 64 : 72, phone ? 128 : 108);
  let cy = gridTop;
  let cx = padX;
  const iapBag = (B.iap && B.iap.owned) || {};

  CATALOG.forEach((sku) => {
    if (wide && cx > padX) { /* keep */ }
    const ownId = Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned;
    const isOwned = !!(ownId && iapBag[ownId]);
    const open = IAP.offered(B, sku);
    const wearing = IAP.equippedCoat(B) === sku.id;
    // card body
    ctx.save();
    ctx.fillStyle = isOwned ? 'rgba(20,22,30,0.5)' : 'rgba(14,14,20,0.72)';
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeStyle = wearing ? 'rgba(200,160,74,0.7)' : 'rgba(90,88,110,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cardW - 1, cardH - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `500 15px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = '#e6dcc4';
    const tight = cardH < 84;
    ctx.fillText(sku.name, cx + 14, cy + (tight ? 20 : 24));
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(178,172,160,0.75)';
    const showBuy = open && !(isOwned && sku.play !== 'consumable');
    const stackBtns = cardH >= 96;
    const blurbMax = stackBtns ? cardW - 28 : cardW - 168;
    let blurb = open ? sku.blurb : sku.locked;
    while (ctx.measureText(blurb).width > blurbMax && blurb.length > 8) blurb = blurb.slice(0, -2);
    if (blurb !== sku.blurb) blurb = blurb.replace(/[,.;]$/, '') + '…';
    if (!tight) ctx.fillText(blurb, cx + 14, cy + 44);
    ctx.font = `400 11px ${MONO}`;
    ctx.fillStyle = 'rgba(150,146,136,0.6)';
    const foot = !open ? 'NOT YET — PLAY THE NIGHT'
      : isOwned && sku.kind === 'title' ? 'THE HOUSE ALREADY KNOWS THE NAME'
      : isOwned ? (wearing ? 'WORN' : 'YOURS — NOT WORN')
      : `${IAP.priceLabel(sku)}   or   ◆${sku.shardPrice}`;
    if (!tight) ctx.fillText(foot, cx + 14, cy + 62);
    ctx.restore();
    // actions
    if (showBuy) {
      const bh2 = tight ? 28 : 36;
      const bw2 = stackBtns ? (cardW - 28) / 2 : Math.min(108, (cardW - 36) / 2);
      const by2 = cy + cardH - bh2 - (tight ? 4 : 8);
      const x1 = stackBtns ? cx + 10 : cx + cardW - bw2 * 2 - 16;
      const x2 = stackBtns ? cx + 14 + bw2 : cx + cardW - bw2 - 8;
      const busy = IAP.busy === sku.id;
      const pay = IAP.mode === 'native' ? 'PLAY' : IAP.mode === 'midtrans' ? 'PAY' : 'STORE';
      const r1 = uiButton(game, {
        x: x1, y: by2, w: bw2, h: bh2,
        label: busy ? '…' : pay, small: true, disabled: busy || IAP.mode === 'disabled',
        onClick: () => game.purchaseSku(sku.id),
      });
      buttonVisual(ctx, r1.b, { active: r1.hover || r1.selected, label: busy ? '…' : pay, small: true, accent: '#6a6a80' });
      const canShard = sku.shardPrice && B.shards >= sku.shardPrice;
      const r2 = uiButton(game, {
        x: x2, y: by2, w: bw2, h: bh2,
        label: '◆ SHARDS', small: true, disabled: !canShard,
        onClick: () => game.buySkuWithShards(sku.id),
      });
      buttonVisual(ctx, r2.b, { active: r2.hover || r2.selected, label: '◆ SHARDS', small: true, accent: '#6a6a80', disabled: !canShard });
    } else if (open && sku.kind === 'cosmetic' && isOwned) {
      const bw2 = cardW - 20, bh2 = tight ? 28 : 36;
      const label = wearing ? 'TAKE OFF' : 'WEAR';
      const r = uiButton(game, {
        x: cx + 10,
        y: cy + cardH - bh2 - (tight ? 4 : 8),
        w: bw2, h: bh2,
        label, small: true, onClick: () => game.wearCoat(sku.id),
      });
      buttonVisual(ctx, r.b, { active: r.hover, label, small: true, accent: wearing ? '#6a6a80' : '#a8833c' });
    }
    cx += cardW + gap;
    if (cx + cardW > w - padX / 2) { cx = padX; cy += cardH + gap; }
  });

  // policy line + actions — pinned above the buttons, never on top of cards
  const rowsEnd = cx === padX ? cy : cy + cardH;
  const policyY = Math.min(rowsEnd + 26, h - (wide ? 96 : 88));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 10px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
  ctx.fillStyle = 'rgba(140,134,124,0.55)';
  const policy = ['SHARDS ARE EARNED BY THE NIGHT · MONEY IS OPTIONAL · NO STATS SOLD · NO ADS',
    IAP.mode === 'native' ? 'GOOGLE PLAY BILLING · THE GAME GRANTS ONLY AFTER CONSUME OR ACKNOWLEDGE'
      : IAP.mode === 'midtrans' ? 'WEB RAIL · THE SAME FOUR GOODS · THE SERVER CONFIRMS SETTLEMENT'
      : IAP.mode === 'sandbox' ? 'SANDBOX — NO REAL MONEY MOVES'
      : 'STORE OFFLINE'];
  const pLines = wide ? policy : [policy[0].split(' · ').slice(0, 3).join(' · '), policy[1]];
  pLines.forEach((line, i) => ctx.fillText(line, w / 2, policyY + i * 16));
  ctx.restore();

  const restoreLabel = wide ? 'RESTORE PURCHASES' : 'RESTORE';
  const backLabel = wide ? 'BACK TO THE HOUSE' : 'BACK';
  const bw = phone ? (w - 36) / 2 : (wide ? 224 : Math.min(160, w * 0.4));
  const bh = phone ? 42 : (wide ? 42 : 34);
  const r3 = uiButton(game, { x: phone ? 12 : w / 2 - bw - 8, y: h - (phone ? 50 : (wide ? 66 : 52)), w: bw, h: bh, label: restoreLabel, onClick: () => game.restorePurchases(), small: true, accent: '#6a6a80' });
  buttonVisual(ctx, r3.b, { active: r3.hover || r3.selected, label: restoreLabel, small: true, accent: '#6a6a80' });
  const r4 = uiButton(game, { x: w / 2 + 8, y: h - (wide ? 66 : 52), w: bw, h: bh, label: backLabel, onClick: () => game.setScreen(back, 'shop'), small: true, accent: '#a8833c' });
  buttonVisual(ctx, r4.b, { active: r4.hover || r4.selected, label: backLabel, small: true, accent: '#a8833c' });
}

, small: true, accent: '#a8833c' });
}

a8833c' });
}

4.b, { active: r4.hover || r4.selected, label: backLabel, small: true, accent: '#a8833c' });
}

, small: true, accent: '#a8833c' });
}

a8833c' });
}

