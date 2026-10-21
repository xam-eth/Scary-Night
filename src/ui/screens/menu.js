/* DUSKHOLD — Attract diorama, title, main menu, consent & privacy screens (Phase 3 split of ui/screens.js). */

import { clamp, lerp, TAU, fmtClock, hash2 } from '../../core/util.js';
import { DIFFICULTY } from '../../core/config.js';
import { unlocked, nextRevealLine, houseTitle } from '../../game/sim/economy.js';
import { Valen3D } from '../../game/render3d/valen3d.js';
import { Enemy3D } from '../../game/render3d/enemy3d.js';
import { IAP } from '../../shop/iap.js';
import { drawGameIcon } from '../icons.js';
import { SERIF, SANS, MONO, isPhone, fitType, wrapLines, uiButton, buttonVisual, ensureBrandPlate, drawBrandPlate } from './shared.js';

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
function drawAttract(game, ctx, w, h, idle) {
  const LOOP = 15;
  const u = ((idle - 2.4) % LOOP + LOOP) % LOOP;
  const t = u / LOOP;
  const bw = w * 0.8;
  if (Math.min(h * 0.3, h * 0.47 - h * 0.155) < 72) return;

  // beats: she stands · she walks a few steps · something knocks · she settles
  const walkU = clamp((u - 5.4) / 3.2, 0, 1);
  const walking = walkU > 0.02 && walkU < 0.98;
  const step = walkU * walkU * (3 - 2 * walkU);
  const knockU = clamp((u - 9.6) / 2.1, 0, 1);
  const knockHit = Math.sin(Math.PI * knockU);

  // ---- the hall, breathing in, drifting, and taking the knock ----
  ctx.save();
  const push = 1.05 + 0.028 * Math.sin(t * TAU);
  const drift = Math.sin(t * TAU) * 7;
  const jolt = knockHit * 3.4;
  ctx.translate(w / 2, h * 0.32);
  ctx.scale(push, push);
  ctx.translate(-w / 2 + drift + Math.sin(u * 47) * jolt, -h * 0.32);
  drawBrandPlate(ctx, w, h, { focus: 0.46, dim: 0 });
  ctx.restore();

  // ---- the lamp: warm, and it will not settle ----
  const flick = clamp(0.78 + 0.22 * Math.sin(u * 11.3) * Math.sin(u * 3.7 + 1.2) - knockHit * 0.4, 0.12, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const lampX = w * 0.74;
  const lampY = h * 0.2;
  const lg = ctx.createRadialGradient(lampX, lampY, 6, lampX, lampY, Math.max(w, h) * 0.5);
  lg.addColorStop(0, `rgba(255,198,124,${0.3 * flick})`);
  lg.addColorStop(0.32, `rgba(176,116,58,${0.13 * flick})`);
  lg.addColorStop(1, 'rgba(120,70,30,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // ---- dust in the beam ----
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 44; i++) {
    const sx = hash2(i, 11);
    const sy = hash2(i, 23);
    const sr = hash2(i, 37);
    const rise = (u * (7 + sr * 15) + sy * h) % (h * 0.62);
    const x = sx * (w + 60) + Math.sin(u * 0.6 + i) * 7 - 30;
    const y = h * 0.52 - rise;
    const a = (0.05 + sr * 0.13) * (0.55 + 0.45 * Math.sin(u * 1.7 + i * 1.3));
    ctx.fillStyle = `rgba(255,234,200,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + sr * 1.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // ---- the knock: a red edge from the servant door, and the frame takes it ----
  if (knockHit > 0.01) {
    ctx.save();
    const kg = ctx.createLinearGradient(0, 0, w * 0.46, 0);
    kg.addColorStop(0, `rgba(148,24,32,${0.34 * knockHit})`);
    kg.addColorStop(1, 'rgba(148,24,32,0)');
    ctx.fillStyle = kg;
    ctx.fillRect(0, 0, w * 0.46, h);
    ctx.restore();
  }

  // ---- she is in the hall ----
  const frame = Valen3D.render({
    state: walking ? 'walk' : 'idle',
    angle: walking ? -0.44 : lerp(0.32, -0.14, knockHit),
    speed: walking ? 118 : 0,
    stepPhase: (u * 6.4) % (Math.PI * 2),
    attackProgress: 0,
    view: 'portrait',
  });
  const px = lerp(w * 0.43, w * 0.57, step) + Math.sin(u * 1.3) * 2;
  const py = h * 0.46 + Math.sin(u * 1.1) * 2.2;
  ctx.save();
  ctx.translate(Math.sin(u * 41) * jolt, 0);
  ctx.save();
  ctx.globalAlpha = 0.5;
  const sg = ctx.createLinearGradient(px, py, px + 160, py - 160);
  sg.addColorStop(0, 'rgba(0,0,0,0.8)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(px - 18, py + 8);
  ctx.lineTo(px + 14, py + 8);
  ctx.lineTo(px + 170, py - 150);
  ctx.lineTo(px + 136, py - 178);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (frame) {
    const sc = h / 760;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(sc, sc);
    // `stand`: the plate asks for a hero 20% of the screen tall and means the
    // BODY, not the photograph around it — her feet land on the plate either way.
    Valen3D.draw(ctx, frame, (h * 0.2) / sc, { footInset: 8, stand: true });
    ctx.restore();
  }
  ctx.restore();

  // ---- the frame holds it ----
  ctx.save();
  const vg = ctx.createRadialGradient(w / 2, h * 0.34, Math.min(w, h) * 0.22, w / 2, h * 0.34, Math.max(w, h) * 0.7);
  vg.addColorStop(0, 'rgba(4,5,9,0)');
  vg.addColorStop(1, 'rgba(4,5,9,0.58)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();


}


export function drawMenuScene(game, ctx, w, h, t) {
  // Vertical hall plate. A light wash only — the architecture is the identity.
  drawBrandPlate(ctx, w, h, { focus: 0.5, dim: 0 });
  const botWash = ctx.createLinearGradient(0, h * 0.52, 0, h);
  botWash.addColorStop(0, 'rgba(5,6,11,0)');
  botWash.addColorStop(1, 'rgba(5,6,11,0.42)');
  ctx.fillStyle = botWash;
  ctx.fillRect(0, h * 0.52, w, h * 0.48);
  ctx.strokeStyle = 'rgba(168,131,60,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(10.5, 10.5, w - 21, h - 21);

  if (game.save && game.save.privacyAck && (game.menuIdle || 0) > 2.4) {
    drawAttract(game, ctx, w, h, game.menuIdle);
  } else {
  // ---- the character, in the hall, under the window ----
  // Industry rule for a hero screen: the menu shows WHAT YOU PLAY, so the
  // loaded GLB itself stands in the hall (its rest pose, evaluated once).
  // The procedural figure survives only while the GLB is unavailable.
  const px = w * 0.5, py = h * 0.46;
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
    Valen3D.draw(ctx, vframe, h * 0.2 / scale, { footInset: 8, stand: true });
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
  }

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
  vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}


export function drawTitle(game, ctx, w, h, t) {
  const phone = isPhone(w, h);
  const short = h < 500;
  const cx = w / 2;
  const top = h * (short ? 0.04 : phone ? 0.045 : 0.05);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ensureBrandPlate();

  if (brandWordmark && brandWordmark.complete && brandWordmark.naturalWidth) {
    const aspect = brandWordmark.naturalHeight / brandWordmark.naturalWidth;
    const maxHeight = h * (short ? 0.30 : phone ? 0.24 : 0.26);
    const logoWidth = Math.min(w * 0.9, 520, maxHeight / aspect);
    const logoHeight = logoWidth * aspect;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = phone ? 12 : 18;
    ctx.drawImage(brandWordmark, cx - logoWidth / 2, top, logoWidth, logoHeight);
    ctx.shadowBlur = 0;
  } else {
    // Keep a readable text lockup if the PNG is unavailable or fails to load.
    const titleY = top + (short ? 18 : phone ? 28 : 38);
    fitType(ctx, 'DUSKHOLD', w * 0.88, short ? 27 : phone ? 38 : 54, SERIF, 400);
    ctx.fillStyle = '#e6e1d2';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = phone ? 12 : 20;
    ctx.fillText('DUSKHOLD', cx, titleY);
    ctx.shadowBlur = 0;
    fitType(ctx, 'HOLD UNTIL DAWN', w * 0.82, short ? 10 : phone ? 12 : 16, SANS, 500);
    ctx.fillStyle = '#a8833c';
    ctx.fillText('HOLD UNTIL DAWN', cx, titleY + (short ? 23 : phone ? 34 : 48));
  }
  ctx.restore();
}

/* ================= main menu ================= */


export function drawMenu(game, ctx, w, h) {
  drawMenuScene(game, ctx, w, h, game.time);
  drawTitle(game, ctx, w, h, game.time);
  const B = game.save;
  if (!B.privacyAck) {
    drawConsent(game, ctx, w, h);
    return;
  }

  // The background is a clean art plate; the outlined DUSKHOLD lockup is
  // drawn once above it, with a text fallback if its PNG cannot load.
  const phone = isPhone(w, h);
  const marketOpen = unlocked(B, 'market');
  const modelState = Enemy3D.readiness();
  const playReady = modelState.ready;
  const playTitle = playReady ? 'ENTER THE NIGHT'
    : modelState.failed.length ? 'THE HOUSE IS NOT READY' : 'PREPARING THE NIGHT';
  const playSub = playReady ? (nextRevealLine(B) || 'THE HOUSE IS WAITING.')
    : modelState.failed.length ? 'A CREATURE MODEL FAILED. RELOAD THE GAME.'
      : `WAKING 3D FORMS · ${modelState.loaded}/${modelState.total} READY.`;
  const defs = [
    { label: 'PLAY', title: playTitle, sub: playSub, disabled: !playReady, icon: 'doorOpen', onClick: () => game.beginNight() },
    { label: 'UPGRADES', title: 'BLOOD SHARDS', sub: (B.shards || 0) ? `${B.shards} AVAILABLE` : 'EARNED BY SURVIVING', icon: 'upgrade', onClick: () => game.setScreen('upgrades') },
    ...(marketOpen ? [{ label: 'BLOOD MARKET', title: 'THE BLOOD MARKET', sub: 'OPTIONAL PURCHASES', icon: 'blood', onClick: () => game.setScreen('shop') }] : []),
    { label: 'SETTINGS', title: 'SETTINGS', sub: `DIFFICULTY · ${DIFFICULTY[B.settings.difficulty]?.label || 'STANDARD'}`, icon: 'settings', onClick: () => game.setScreen('settings') },
  ];
  game.uiIndex = clamp(game.uiIndex, 0, defs.length - 1);

  // Keep the portrait cinematic, then group navigation and run stats in one
  // quiet command panel. Action nodes remain icon-only; the focused action name
  // sits in a separate readable caption above them.
  const wash = ctx.createLinearGradient(0, h * 0.48, 0, h);
  wash.addColorStop(0, 'rgba(4,5,10,0)');
  wash.addColorStop(0.24, 'rgba(4,5,10,0.34)');
  wash.addColorStop(1, 'rgba(4,5,10,0.92)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, h * 0.48, w, h * 0.52);

  const navY = clamp(h * 0.74, 238, h - (h < 500 ? 112 : 136));
  const titleY = navY - 55;
  const eyebrowY = navY - 92;
  const statsY = Math.min(h - 82, navY + 54);
  const panelX = 12;
  const panelY = eyebrowY - 18;
  const panelBottom = Math.min(h - 18, statsY + 38);
  const panelH = Math.max(1, panelBottom - panelY);
  ctx.save();
  const panelFill = ctx.createLinearGradient(0, panelY, 0, panelBottom);
  panelFill.addColorStop(0, 'rgba(7,8,13,0.83)');
  panelFill.addColorStop(1, 'rgba(3,4,8,0.94)');
  ctx.fillStyle = panelFill;
  ctx.fillRect(panelX, panelY, w - panelX * 2, panelH);
  ctx.strokeStyle = 'rgba(190,165,116,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, w - panelX * 2 - 1, panelH - 1);
  ctx.fillStyle = 'rgba(149,43,49,0.84)';
  ctx.fillRect(panelX + 1, panelY + 12, 2, Math.max(1, panelH - 24));
  ctx.restore();
  const outerGutter = 18;
  const cellWidth = defs.length ? Math.max(32, (w - outerGutter * 2) / defs.length) : 32;
  const nodeSize = Math.min(54, Math.max(32, cellWidth - 8));
  const railWidth = Math.min(360, Math.max(0, w - outerGutter * 2 - nodeSize));
  const spacing = defs.length > 1 ? railWidth / (defs.length - 1) : 0;
  const firstX = w / 2 - railWidth / 2;

  // The night number and a fine register rule act as the dashboard's header.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${phone ? 9 : 10}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
  ctx.fillStyle = 'rgba(200,160,74,0.72)';
  ctx.fillText(`NIGHT WATCH  /  ${String((B.nightsSurvived || 0) + 1).padStart(2, '0')}`, w / 2, eyebrowY);
  const ruleW = Math.min(112, w * 0.34);
  ctx.strokeStyle = 'rgba(168,131,60,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w / 2 - ruleW / 2, eyebrowY + 12); ctx.lineTo(w / 2 + ruleW / 2, eyebrowY + 12); ctx.stroke();
  ctx.restore();

  // Connecting hairline is the only container; the icons read as a ritual dial.
  ctx.save();
  ctx.strokeStyle = 'rgba(174,150,98,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(firstX, navY); ctx.lineTo(firstX + railWidth, navY); ctx.stroke();
  ctx.restore();

  let hoverIndex = -1;
  defs.forEach((item, i) => {
    const x = defs.length > 1 ? firstX + spacing * i : w / 2;
    const r = uiButton(game, {
      x: x - nodeSize / 2, y: navY - nodeSize / 2, w: nodeSize, h: nodeSize,
      label: item.label, sub: item.sub, small: true, disabled: item.disabled, onClick: item.onClick,
    });
    const active = r.active;
    if (r.hover) hoverIndex = i;
    drawMenuGlyphNode(ctx, r.b, item.icon, active, i === 0, !!item.disabled);
  });

  const focus = hoverIndex >= 0 ? hoverIndex : game.uiIndex;
  const item = defs[focus] || defs[0];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitType(ctx, item.title, w - 36, phone ? 19 : 23, SERIF, 500);
  ctx.fillStyle = '#e8dfca';
  ctx.shadowColor = 'rgba(0,0,0,0.92)';
  ctx.shadowBlur = 10;
  ctx.fillText(item.title, w / 2, titleY);
  ctx.shadowBlur = 0;
  let sub = String(item.sub || '').toUpperCase();
  ctx.font = `400 ${phone ? 9 : 10}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.35px';
  const maxSubW = w - 44;
  while (sub && ctx.measureText(sub).width > maxSubW && sub.length > 10) sub = sub.slice(0, -2);
  if (sub !== String(item.sub || '').toUpperCase()) sub = sub.replace(/[\s,.;:-]+$/, '') + '…';
  ctx.fillStyle = 'rgba(196,186,167,0.78)';
  ctx.fillText(sub, w / 2, titleY + 20);
  ctx.restore();

  // Compact record strip: three live facts, divided by rules rather than cards.
  const gutter = phone ? 18 : 30;
  const colW = (w - gutter * 2) / 3;
  const stats = [
    { name: 'NIGHTS', value: String(B.nightsSurvived || 0).padStart(2, '0') },
    { name: 'BEST RUN', value: B.bestTime > 0 ? fmtClock(B.bestTime) : '--:--' },
    { name: 'SHARDS', value: String(B.shards || 0).padStart(2, '0') },
  ];
  ctx.save();
  ctx.strokeStyle = 'rgba(168,131,60,0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(gutter, statsY - 5); ctx.lineTo(w - gutter, statsY - 5); ctx.stroke();
  stats.forEach((stat, i) => {
    const cx = gutter + colW * (i + 0.5);
    if (i > 0) {
      const sx = gutter + colW * i;
      ctx.strokeStyle = 'rgba(168,131,60,0.22)';
      ctx.beginPath(); ctx.moveTo(sx, statsY + 2); ctx.lineTo(sx, statsY + 36); ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${phone ? 8 : 9}px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(180,170,150,0.66)';
    ctx.fillText(stat.name, cx, statsY + 7);
    ctx.font = `400 ${phone ? 15 : 17}px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
    ctx.fillStyle = i === 2 && (B.shards || 0) > 0 ? '#c6a45c' : '#e5ddcb';
    ctx.fillText(stat.value, cx, statsY + 27);
  });
  ctx.restore();

  const stamp = IAP.owns(B, 'title_dawnbreaker') ? 'DAWNBREAKER' : houseTitle(B);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${phone ? 8 : 9}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.45px';
  ctx.fillStyle = 'rgba(180,172,158,0.48)';
  ctx.fillText(`18+${stamp ? '  ·  ' + stamp : ''}`, 14, h - 12);
  ctx.restore();
}


function drawMenuGlyphNode(ctx, rect, icon, active, primary = false, disabled = false) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const enabled = active && !disabled;
  const r = Math.min(rect.w, rect.h) * (primary ? (enabled ? 0.48 : 0.44) : (enabled ? 0.46 : 0.41));
  ctx.save();
  if (disabled) ctx.globalAlpha = 0.52;
  if (enabled) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.15);
    glow.addColorStop(0, primary ? 'rgba(142,28,38,0.28)' : 'rgba(168,131,60,0.2)');
    glow.addColorStop(1, 'rgba(20,10,10,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 2.15, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = enabled ? 'rgba(18,14,13,0.96)' : primary ? 'rgba(31,11,15,0.94)' : 'rgba(6,7,12,0.83)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = enabled
    ? (primary ? 'rgba(206,109,90,0.96)' : 'rgba(201,169,104,0.9)')
    : primary ? 'rgba(166,69,68,0.78)' : 'rgba(186,174,150,0.42)';
  ctx.lineWidth = enabled ? 1.7 : 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  if (enabled || primary) {
    ctx.strokeStyle = primary ? 'rgba(151,36,46,0.75)' : 'rgba(168,131,60,0.62)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, -Math.PI * 0.78, -Math.PI * 0.22); ctx.stroke();
  }
  ctx.fillStyle = disabled ? 'rgba(169,159,148,0.7)'
    : enabled ? (primary ? '#dc8271' : '#d1b36f') : primary ? '#d39a89' : 'rgba(205,196,178,0.78)';
  drawGameIcon(ctx, icon, cx, cy, Math.min(primary ? 25 : 22, rect.w * 0.52), ctx.fillStyle);
  ctx.restore();
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
    '18+ horror. No account. No location.',
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
  drawBrandPlate(ctx, w, h, { dim: 0.86 });
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

  // v1.0 FIX: this block referenced `phone`, `by0` and `bh` without ever
  // declaring them — a ReferenceError on every render of this screen, which
  // killed the rAF loop stone dead (main.js never reaches its next
  // requestAnimationFrame once render() throws). Reachable from the very
  // first consent dialog's PRIVACY button, so this froze the game before a
  // player even started a night.
  const phone = isPhone(w, h);
  const bh = 40;
  const btnGap = 8;
  const bw = phone ? Math.min(w - 24, 420) : Math.min(200, (w - 48) / 3);
  const stackH = phone ? bh * 3 + btnGap * 2 : bh;
  const by0 = Math.min(h - stackH - 16, Math.max(top + lines.length * gap + 8, h - stackH - 40));
  const page = uiButton(game, {
    x: phone ? (w - bw) / 2 : w / 2 - bw * 1.5 - 12, y: by0, w: bw, h: bh, label: 'FULL POLICY', small: true,
    onClick: () => { try { window.open('./privacy.html', '_blank', 'noopener'); } catch (e) { /* blocked */ } },
  });
  buttonVisual(ctx, page.b, { active: page.hover, label: 'FULL POLICY', small: true, accent: '#6a6a80' });
  const delLabel = game.privacyDeleteArmed ? 'CONFIRM DELETE' : 'DELETE MY DATA';
  const del = uiButton(game, {
    x: phone ? (w - bw) / 2 : w / 2 - bw / 2, y: phone ? by0 + bh + btnGap : by0, w: bw, h: bh, label: delLabel, small: true,
    onClick: () => {
      if (!game.privacyDeleteArmed) { game.privacyDeleteArmed = true; return; }
      game.wipeLocalData();
    },
  });
  buttonVisual(ctx, del.b, { active: del.hover, label: delLabel, small: true, accent: '#8a3030' });
  const bk = uiButton(game, {
    x: phone ? (w - bw) / 2 : w / 2 + bw / 2 + 12, y: phone ? by0 + (bh + btnGap) * 2 : by0, w: bw, h: bh, label: 'BACK', small: true,
    onClick: () => { game.privacyDeleteArmed = false; game.setScreen(back); },
  });
  buttonVisual(ctx, bk.b, { active: bk.hover, label: 'BACK', small: true, accent: '#a8833c' });
}

/* ================= intro card ================= */

