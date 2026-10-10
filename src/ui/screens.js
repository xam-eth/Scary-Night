/* DUSKHOLD — menus & screens
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
import { unlocked, nextRevealLine, LANES, nextRank, rankCost, rankCount, LANE_CAP, houseTitle } from '../game/economy.js';
import { fragmentsKnown, endingFrame } from '../game/narrative.js';
import { intelLine, huntPct, huntProgress, fortressState, huntTells, masterReady, masterDown, armouryNext, FORTRESS_STATES } from '../game/hunt.js';
import { INFORMANT, informantLine, boardEntries } from '../game/informant.js';
import { drawPlateCover } from './storycards.js';
import { Valen3D } from '../game/valen3d.js';
import { Enemy3D } from '../game/enemy3d.js';
import { IAP, CATALOG } from '../shop/iap.js';
import { Ads } from '../shop/ads.js';
import { buttonIconForLabel, drawGameIcon } from './icons.js';
import { weaponById } from '../game/weapons.js';

const SERIF = '"IM Fell English SC", Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Consolas, monospace';

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
  const b = { x, y, w, h, label, sub, onClick: disabled ? null : onClick, disabled, idx };
  game.ui.push(b);
  return { b, active, hover, selected };
}

function buttonVisual(ctx, { x, y, w, h }, { active, disabled, label, sub, small, accent }) {
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
  if (glyph) {
    // Icon controls are intentionally icon-only. The action name remains on
    // the input record for keyboard help and the external focus caption.
    drawGameIcon(ctx, glyph, x + w / 2, y + h / 2, Math.min(small ? 20 : 24, h * 0.54, w * 0.54), ink);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitType(ctx, label, Math.max(40, w - 18), small ? 15 : 18, SERIF);
    ctx.fillStyle = ink;
    if (active) {
      ctx.shadowColor = 'rgba(255,200,120,0.35)';
      ctx.shadowBlur = 12;
    }
    ctx.fillText(label, x + w / 2, y + h / 2 + (sub ? -5 : 0));
    ctx.shadowBlur = 0;
    if (sub) {
      fitType(ctx, sub, Math.max(40, w - 18), 11, SANS, 400);
      ctx.fillStyle = 'rgba(190,182,168,0.6)';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 14);
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
let brandWordmark = null;
let brandPlate = null;

function ensureBrandPlate() {
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
function drawBrandPlate(ctx, w, h, { focus = 0.18, dim = 0.55 } = {}) {
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
  const seen = Object.keys(B.seen || {}).length;
  const goalLine = B.goals && B.goals.done
    ? `${B.goals.done} GOALS KEPT ACROSS ${B.goals.nights || 0} NIGHTS`
    : 'THE HOUSE KEEPS EVERY PROMISE.';
  const modelState = Enemy3D.readiness();
  const playReady = modelState.ready;
  const playTitle = playReady ? 'ENTER THE NIGHT'
    : modelState.failed.length ? 'THE HOUSE IS NOT READY' : 'PREPARING THE NIGHT';
  const playSub = playReady ? (nextRevealLine(B) || 'THE HOUSE IS WAITING.')
    : modelState.failed.length ? 'A CREATURE MODEL FAILED. RELOAD THE GAME.'
      : `WAKING 3D FORMS · ${modelState.loaded}/${modelState.total} READY.`;
  const defs = [
    { label: 'PLAY', title: playTitle, sub: playSub, disabled: !playReady, icon: 'doorOpen', onClick: () => game.beginNight() },
    { label: 'UPGRADES', title: 'BLOOD SHARDS', sub: (B.shards || 0) ? `${B.shards} SHARDS WAITING TO BE SPENT.` : 'EARNED ONLY BY SURVIVING.', icon: 'upgrade', onClick: () => game.setScreen('upgrades') },
    ...(marketOpen ? [{ label: 'BLOOD MARKET', title: 'THE BLOOD MARKET', sub: 'OPTIONAL. THE NIGHT NEVER ASKS.', icon: 'blood', onClick: () => game.setScreen('shop') }] : []),
    { label: 'COLLECTION', title: 'THE HOUSE RECORD', sub: `${seen} OF ${CODEX.length} ENTRIES REMEMBERED.`, icon: 'book', onClick: () => game.setScreen('collection') },
    { label: 'SETTINGS', title: 'HOUSE RULES', sub: `DIFFICULTY · ${DIFFICULTY[B.settings.difficulty]?.label || 'STANDARD'}.`, icon: 'settings', onClick: () => game.setScreen('settings') },
    { label: 'THE OPENING', title: 'REPLAY THE OPENING', sub: 'RETURN TO THE FIRST NIGHT.', icon: 'book', onClick: () => game.replayOpening() },
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
  const panelBottom = Math.min(h - 18, statsY + 58);
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
  ctx.font = `400 ${phone ? 8 : 9}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
  ctx.fillStyle = 'rgba(151,143,129,0.64)';
  let record = goalLine;
  while (ctx.measureText(record).width > w - 36 && record.length > 10) record = record.slice(0, -2);
  if (record !== goalLine) record = record.replace(/[\s,.;:-]+$/, '') + '…';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(record, w / 2, statsY + 49);
  ctx.restore();

  const stamp = IAP.owns(B, 'title_dawnbreaker') ? 'DAWNBREAKER' : houseTitle(B);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${phone ? 8 : 9}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.45px';
  ctx.fillStyle = 'rgba(180,172,158,0.48)';
  ctx.fillText(`v${GAME_VERSION}  ·  18+${stamp ? '  ·  ' + stamp : ''}`, 14, h - 12);
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
    ...wrap((game.save.nightsSurvived || 0) > 0
      ? `Night ${(game.save.nightsSurvived || 0) + 1}. The house kept every dawn. More of them are coming.`
      : 'The gatehouse is west of the hall. Raise the stakes. Dawn is at 05:00.', bodyFont),
  ];
  const draw = (text, { f, style, ls, y, c }) => {
    ctx.font = `400 ${f}px ${style}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';
    ctx.fillStyle = c;
    ctx.fillText(text, w / 2, h * y);
  };
  draw('DUSKHOLD', { f: 40 * sc, style: SERIF, ls: 10 * sc, y: 0.24, c: '#efe7d4' });
  let fy = 0.36;
  for (const b of body) { draw(b, { f: 15 * sc, style: SANS, ls: 2 * sc, y: fy, c: 'rgba(200,192,176,0.8)' }); fy += 0.042; }
  fy = Math.max(0.55, fy + 0.03);
  draw('SURVIVE UNTIL DAWN.', { f: 22 * sc, style: SERIF, ls: 6 * sc, y: fy, c: '#c8a04a' });

  // TONIGHT'S ERRAND — the hunt's short goal layer (docs/PURPOSE.md §2 P5).
  // Surviving is the clock; this is the reason to go out, and it is dealt
  // before the first door shakes so the night has a shape from the start.
  let ny = fy + 0.062;
  const errand = game.objectives && game.objectives.hunt ? game.objectives.hunt.goal : null;
  if (errand) {
    ctx.save();
    ctx.globalAlpha = a * 0.45;
    ctx.strokeStyle = 'rgba(200,160,74,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.26, h * (ny - 0.022));
    ctx.lineTo(w * 0.74, h * (ny - 0.022));
    ctx.stroke();
    ctx.restore();
    // Type is floored, not only scaled: at 0.58 the card's own body type is
    // 8.7px, and an errand nobody can read is not an errand.
    draw('TONIGHT', { f: 9.5, style: SANS, ls: 3, y: ny, c: 'rgba(200,160,74,0.8)' });
    draw(errand.label, { f: Math.max(13, 17 * sc), style: SERIF, ls: 2.5, y: ny + 0.038, c: '#e8dfc8' });
    draw(errand.hint, { f: Math.max(10, 12 * sc), style: SANS, ls: 1, y: ny + 0.068, c: 'rgba(186,178,160,0.82)' });
    ny += 0.104;
  }
  // THE LADDER — the hunt's middle goal layer (docs/PURPOSE.md §2 P5): not
  // what tonight asks of her, and not the end of the hunt, but the thing being
  // built between the two. One line at nightfall, so the pull is never a menu.
  const rung = armouryNext(game.save);
  if (rung) {
    const wait = !rung.hasIntel ? `${rung.need - rung.facts} MORE FACTS`
      : !rung.hasCost ? `${rung.cost - rung.materials} MORE MATERIALS`
      : 'READY';
    draw(`MARTHE IS MAKING · ${rung.name} · ${wait}`, { f: Math.max(9, 10.5 * sc), style: SANS, ls: 2, y: ny + 0.012, c: 'rgba(196,210,238,0.8)' });
    ny += 0.038;
  }
  draw('00:00  →  05:00', { f: 20 * sc, style: MONO, ls: 4 * sc, y: ny + 0.02, c: 'rgba(220,214,198,0.9)' });
  const hintY = ny + 0.08;
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
    buttonVisual(ctx, stay.b, { active: stay.hover, label: 'STAY', small: true, accent: '#6a6a80' });
    const leave = uiButton(game, {
      x: w / 2 - bw / 2, y: y1 + bh + 10, w: bw, h: bh, label: 'LEAVE', small: true, accent: '#8a3038',
      onClick: () => game.toMenu(),
    });
    buttonVisual(ctx, leave.b, { active: leave.hover, label: 'LEAVE', small: true, accent: '#8a3038' });
    return;
  }
  const items = [
    { label: 'RESUME', onClick: () => game.togglePause(false) },
    { label: 'RESTART NIGHT', onClick: () => game.beginNight() },
    { label: 'SETTINGS', onClick: () => game.setScreen('settings', 'paused') },
    { label: 'HOW TO SURVIVE', onClick: () => game.setScreen('help', 'paused') },
    { label: 'MAIN MENU', onClick: () => { game.pauseConfirm = true; } },
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

export function drawUpgrades(game, ctx, w, h) {
  const B = game.save;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
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
  const rowH = clamp((bottom - top) / LANES.length, phone ? 78 : 92, 120);
  let y = top;
  const bx = pad;
  const openLanes = unlocked(B, 'builds');
  LANES.forEach((lane) => {
    const nxt = nextRank(B, lane.id);
    const owned = lane.ranks.filter((r) => B.builds && B.builds[r.id]).length;
    const maxed = !nxt;
    const capped = rankCount(B) >= LANE_CAP && !maxed;
    const cost = nxt ? rankCost(B, nxt) : 0;
    const afford = openLanes && !maxed && !capped && B.shards >= cost;
    const u = { id: lane.id, name: lane.name, desc: openLanes ? (nxt ? nxt.name + ' — ' + lane.blurb : lane.blurb) : 'THE LANES OPEN AFTER TWO DAWNS.', max: lane.ranks.length, icon: lane.id === 'glutton' ? 'claw' : lane.id === 'warden' ? 'plank' : 'boot' };
    const lvl = owned;
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
      label: !openLanes ? 'LATER' : maxed ? 'MASTERED' : capped ? 'CAPPED' : `◆ ${cost}`, small: true,
      disabled: !afford,
      accent: '#a8833c',
      onClick: () => game.buyUpgrade(lane.id),
    });
    buttonVisual(ctx, r.b, { active: r.hover, label: !openLanes ? 'LATER' : maxed ? 'MASTERED' : capped ? 'CAPPED' : `◆ ${cost}`, small: true, disabled: !afford, accent: '#a8833c' });
    y += rowH;
  });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 12px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(170,162,150,0.6)';
  if (!phone) ctx.fillText('SIX RANKS. ONE LANE DEEP, OR TWO LANES SHALLOW. YOU CANNOT OWN THE HOUSE.', w / 2, h - 128);
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
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'COLLECTION', w - 32, phone ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('COLLECTION', w / 2, phone ? 26 : h * 0.13);
  ctx.restore();

  const remembered = fragmentsKnown(B).slice(-3);
  const fragReserve = remembered.length ? (phone ? 6 + remembered.length * 32 : 10 + remembered.length * 36) : 0;
  const cols = phone ? 1 : Math.min(3, Math.max(1, Math.floor(w / 380)));
  const gap = phone ? 8 : 16;
  const cw = phone ? w - 24 : Math.min(340, (w - 80) / cols - gap);
  const rows = Math.ceil(CODEX.length / cols);
  const top = phone ? 44 : h * 0.22;
  const bottom = h - (phone ? 56 : 84) - fragReserve;
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
    if (ch >= 70 && ch < 88) wrapText(ctx, txt.split('\n')[0], x + 18, yy + 50, cw - 36, 15);
    else if (ch >= 88) wrapText(ctx, txt, x + 18, yy + 56, cw - 36, 17);
    ctx.restore();
  });

  if (remembered.length) {
    const fx = phone ? 12 : w / 2 - 220;
    const fw = phone ? w - 24 : 440;
    const rowH = phone ? 30 : 34;
    let fy = h - (phone ? 48 : 84) - fragReserve + 4;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    remembered.forEach((row) => {
      ctx.fillStyle = 'rgba(14,12,16,0.82)';
      ctx.fillRect(fx, fy, fw, rowH - 4);
      ctx.strokeStyle = 'rgba(180,140,70,0.4)';
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, rowH - 5);
      ctx.font = `500 ${phone ? 11 : 12}px ${SERIF}`;
      ctx.fillStyle = '#e0c48a';
      let name = row.name;
      while (ctx.measureText(name).width > 118 && name.length > 6) name = name.slice(0, -2);
      if (name !== row.name) name = name.replace(/\s$/, '') + '…';
      ctx.fillText(name, fx + 10, fy + (rowH - 4) / 2);
      const nameW = Math.min(126, ctx.measureText(name).width + 18);
      ctx.font = `400 ${phone ? 11 : 12}px ${SANS}`;
      ctx.fillStyle = 'rgba(226,216,198,0.88)';
      let line = row.text;
      while (ctx.measureText(line).width > fw - nameW - 20 && line.length > 8) line = line.slice(0, -2);
      if (line !== row.text) line = line.replace(/[,.;]$/, '') + '…';
      ctx.fillText(line, fx + 10 + nameW, fy + (rowH - 4) / 2);
      fy += rowH;
    });
    ctx.restore();
  }

  const backBtn = uiButton(game, { x: phone ? 12 : w / 2 - 110, y: h - (phone ? 48 : 84), w: phone ? w - 24 : 220, h: phone ? 40 : 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

function drawValenShade(ctx, x, y, s) {
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

function drawPlateGrade(ctx, w, h, key, warm) {
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

export function drawDawnCard(game, ctx, w, h) {
  const card = game.dawnCard;
  const t = game.dawnCardT || 0;
  const short = h < 520;
  drawPlateGrade(ctx, w, h, 'gallery', false);
  const scrim = ctx.createLinearGradient(0, short ? 0 : h * 0.42, 0, h);
  scrim.addColorStop(0, 'rgba(6,4,8,0)');
  scrim.addColorStop(short ? 0.2 : 0.35, 'rgba(6,4,8,0.72)');
  scrim.addColorStop(1, 'rgba(6,4,8,0.88)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, short ? 0 : h * 0.38, w, h);
  drawValenShade(ctx, short ? w * 0.22 : w * 0.5, short ? h * 0.55 : h * 0.34, short ? 0.42 : 0.62);
  ctx.save();
  ctx.textAlign = short ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,214,190,0.8)';
  ctx.font = `400 ${short ? 11 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  const labelX = short ? w * 0.42 : w / 2;
  ctx.fillText('DAWN', labelX, short ? 22 : h * 0.46);
  const text = (card && card.text) || 'The house raises a morning. It is not the true one.';
  ctx.fillStyle = '#f4eadc';
  ctx.font = `400 ${short ? 14 : 17}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3px';
  const maxW = short ? w * 0.52 : Math.min(w - 48, 420);
  wrapText(ctx, text, labelX, short ? 42 : h * 0.52, maxW, short ? 18 : 24);
  ctx.restore();
  if (t > 0.35) {
    const bw = Math.min(w - 36, short ? 200 : 280);
    const bh = 46;
    const btn = uiButton(game, {
      x: short ? w - bw - 16 : (w - bw) / 2,
      y: h - (short ? 58 : 78),
      w: bw, h: bh,
      label: 'CONTINUE', small: true, accent: '#a8833c',
      onClick: () => game.finishDawnCard(),
    });
    buttonVisual(ctx, btn.b, { active: btn.hover, label: 'CONTINUE', small: true, accent: '#a8833c' });
  }
}

export function drawEnding(game, ctx, w, h) {
  const short = h < 520;
  const t = game.endingT || 0;
  drawPlateGrade(ctx, w, h, 'oratory', true);
  const scrim = ctx.createLinearGradient(0, short ? 0 : h * 0.34, 0, h);
  scrim.addColorStop(0, 'rgba(6,4,8,0)');
  scrim.addColorStop(0.4, 'rgba(6,4,8,0.7)');
  scrim.addColorStop(1, 'rgba(6,4,8,0.9)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, short ? 0 : h * 0.3, w, h);
  drawValenShade(ctx, short ? w * 0.2 : w * 0.5, short ? h * 0.5 : h * 0.32, short ? 0.36 : 0.58);
  ctx.save();
  ctx.textAlign = short ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f3e7d4';
  ctx.font = `400 ${short ? 14 : 16}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
  const frame = endingFrame(game.save);
  const textX = short ? w * 0.4 : w / 2;
  const maxW = short ? w * 0.56 : Math.min(w - 40, 420);
  let y = short ? 18 : h * 0.46;
  y = wrapText(ctx, 'The true dawn is in the glass. The house cannot raise this one.', textX, y, maxW, short ? 18 : 22);
  ctx.fillStyle = 'rgba(214,186,120,0.92)';
  ctx.font = `400 ${short ? 12 : 14}px ${SANS}`;
  wrapText(ctx, frame, textX, y + 6, maxW, 16);
  ctx.restore();
  if (t > 0.4) {
    const bh = 46;
    if (short) {
      const bw = Math.min(210, (w - 36) / 2);
      const y1 = h - 58;
      const walk = uiButton(game, {
        x: 12, y: y1, w: bw, h: bh, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060',
        onClick: () => game.chooseEnding('dawnbreaker'),
      });
      buttonVisual(ctx, walk.b, { active: walk.hover, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060' });
      const stay = uiButton(game, {
        x: w - bw - 12, y: y1, w: bw, h: bh, label: 'TURN BACK', small: true, accent: '#6a2230',
        onClick: () => game.chooseEnding('monster'),
      });
      buttonVisual(ctx, stay.b, { active: stay.hover, label: 'TURN BACK', small: true, accent: '#6a2230' });
    } else {
      const bw = Math.min(w - 36, 320);
      const x = (w - bw) / 2;
      const y1 = h - 168;
      const walk = uiButton(game, {
        x, y: y1, w: bw, h: bh, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060',
        onClick: () => game.chooseEnding('dawnbreaker'),
      });
      buttonVisual(ctx, walk.b, { active: walk.hover, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060' });
      const stay = uiButton(game, {
        x, y: y1 + bh + 10, w: bw, h: bh, label: 'TURN BACK', small: true, accent: '#6a2230',
        onClick: () => game.chooseEnding('monster'),
      });
      buttonVisual(ctx, stay.b, { active: stay.hover, label: 'TURN BACK', small: true, accent: '#6a2230' });
    }
  }
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

/* ================= the narrator's plate =================
 *
 * The story is TOLD, not only murmured on the strip (docs/STORY.md §2.3 / §3 /
 * §10). Two surfaces share this plate: the opening narration (three authored
 * lines, in her voice, with the house answering) and the act-title cards at
 * each turn of §8. Same grade as a dawn-card, different typography: Valen is
 * first person and italic, the house is second person and small caps, so the
 * two voices read as two voices even with the sound off.
 *
 * Phone first: the block is centred in the safe area, the type scales with the
 * short axis, and short landscape keeps the same order on one screen.
 */
export function drawNarration(game, ctx, w, h) {
  const n = game.narration;
  if (!n) return;
  const beat = n.list[n.i];
  if (!beat) return;
  const short = h < 520;
  const phone = isPhone(w, h);
  const dur = n.lineDur || 3;
  const t = n.t || 0;
  const a = clamp(t / 0.5, 0, 1) * clamp((dur - t) / 0.55, 0, 1);

  drawPlateGrade(ctx, w, h, 'gallery', false);
  // The plate is a Photograph: a lit wall can sit at 150 luminance, and white
  // type on that is not legible. The scrim starts above the first line and
  // holds the whole type block down, so the words always win.
  const scrim = ctx.createLinearGradient(0, short ? 0 : h * 0.12, 0, h);
  scrim.addColorStop(0, 'rgba(6,4,8,0)');
  scrim.addColorStop(short ? 0.18 : 0.22, 'rgba(6,4,8,0.72)');
  scrim.addColorStop(0.6, 'rgba(6,4,8,0.88)');
  scrim.addColorStop(1, 'rgba(6,4,8,0.93)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, short ? 0 : h * 0.12, w, h);
  drawValenShade(ctx, short ? w * 0.17 : w * 0.5, short ? h * 0.56 : h * 0.3, short ? 0.36 : 0.54);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = short ? 'left' : 'center';
  const tx = short ? w * 0.36 : w / 2;
  const maxW = short ? w * 0.58 : Math.min(w - 48, 440);
  const house = beat.voice === 'house';
  // a shadow under every glyph: the one thing that keeps a caption readable
  // over a photograph on a phone in daylight
  ctx.shadowColor = 'rgba(0,0,0,0.92)';
  ctx.shadowBlur = clamp(Math.min(w, h) * 0.018, 6, 16);

  if (n.kind === 'act') {
    // ACT II — THE HOUSE REMEMBERS, split so the number carries the beat
    const parts = String(beat.title || '').split('—').map((p) => p.trim());
    const num = parts[0] || '';
    const name = parts[1] || parts[0] || '';
    ctx.globalAlpha = a;
    ctx.font = `500 ${short ? 11 : 13}px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
    ctx.fillStyle = 'rgba(206,168,92,0.85)';
    ctx.fillText(num.toUpperCase(), tx, short ? h * 0.2 : h * 0.3);
    ctx.font = `400 ${clamp(Math.min(w, h * 1.5) * 0.052, 20, 38)}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = '#f0e6d2';
    ctx.fillText(name.toUpperCase(), tx, short ? h * 0.29 : h * 0.37);
    const rule = Math.min(140, maxW * 0.5);
    ctx.strokeStyle = 'rgba(140,26,36,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(short ? tx : tx - rule, short ? h * 0.35 : h * 0.43);
    ctx.lineTo(short ? tx + rule * 2 : tx + rule, short ? h * 0.35 : h * 0.43);
    ctx.stroke();
    // the house, second person, small caps
    ctx.font = `500 ${short ? 10 : 12}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3.4px';
    ctx.fillStyle = 'rgba(198,176,150,0.8)';
    ctx.fillText(String(beat.epigraph || '').toUpperCase(), tx, short ? h * 0.44 : h * 0.51);
    // Valen, first person, italic
    ctx.globalAlpha = a;
    ctx.font = `italic 400 ${clamp(Math.min(w, h * 1.5) * 0.042, 16, 27)}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = '#f4eadc';
    wrapText(ctx, beat.text, tx, short ? h * 0.56 : h * 0.6, maxW, short ? 22 : 30);
  } else {
    // the opening: one line at a time, no title, no furniture
    ctx.globalAlpha = a;
    if (n.i === 0) {
      ctx.font = `400 ${short ? 10 : 12}px ${MONO}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillStyle = 'rgba(206,168,92,0.8)';
      ctx.fillText('NIGHT ONE', tx, short ? h * 0.26 : h * 0.34);
    }
    if (house) {
      ctx.font = `500 ${clamp(Math.min(w, h * 1.5) * 0.036, 14, 23)}px ${SANS}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillStyle = 'rgba(206,190,176,0.92)';
      wrapText(ctx, String(beat.text).toUpperCase(), tx, short ? h * 0.42 : h * 0.5, maxW, short ? 21 : 28);
    } else {
      ctx.font = `italic 400 ${clamp(Math.min(w, h * 1.5) * 0.046, 17, 29)}px ${SERIF}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
      ctx.fillStyle = '#f4eadc';
      wrapText(ctx, beat.text, tx, short ? h * 0.42 : h * 0.5, maxW, short ? 25 : 32);
    }
  }

  // how far in we are: a line of pips, one per beat of this plate
  ctx.globalAlpha = a * 0.7;
  const pipW = 16, pipGap = 8;
  const total = n.list.length * pipW + (n.list.length - 1) * pipGap;
  const px = short ? tx : w / 2 - total / 2;
  for (let i = 0; i < n.list.length; i++) {
    ctx.fillStyle = i === n.i ? 'rgba(206,168,92,0.95)' : 'rgba(180,168,148,0.3)';
    ctx.fillRect(px + i * (pipW + pipGap), short ? h * 0.72 : h * 0.74, pipW, 2);
  }
  ctx.restore();

  // skip + the tap-to-continue hint. No dead input: every plate answers, and
  // the hint sits ABOVE the button so short landscape never stacks them.
  const bw = Math.min(w - 36, 200);
  const btnY = h - (short ? 48 : 84);
  const skip = uiButton(game, {
    x: w / 2 - bw / 2, y: btnY, w: bw, h: 40, label: 'SKIP', small: true,
    onClick: () => game.skipNarration(),
  });
  buttonVisual(ctx, skip.b, { active: skip.hover, label: 'SKIP', small: true, accent: '#6a6a80' });
  ctx.save();
  ctx.globalAlpha = a * 0.55;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 11px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(190,182,168,0.9)';
  ctx.fillText('TAP TO CONTINUE', w / 2, btnY - 14);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

export function drawHelp(game, ctx, w, h) {
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'HOW TO SURVIVE', w - 28, phone ? 20 : 28, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('HOW TO SURVIVE', w / 2, phone ? 26 : h * 0.12);

  const lines = [
    ['00:00 — SERVANT DOOR.', 'It is already shaking. BOARD it, or open it and feed. You cannot do both. Drag the left stick to walk.'],
    ['THE FORT.', 'Gatehouse is west of the hall. USE the stakes — three planks — so they come one at a time. BOARD the palisade. The postern is thin on purpose.'],
    ['THE PACK.', 'Zombies are slow and never alone. You do not have to kill them. Blood drains. The larder feeds you and calls the kitchen.'],
    ['THE NEW WINGS.', 'Gallery is north of the dining room. Oratory is above the glass. The lamp and the altar only slow them.'],
    ['A KNOCK.', 'A chevron points at the door. It does not say what is there. You cannot hold every door. Abandon one.'],
    ['04:30 — PANIC.', 'They come from every entrance. Stop chasing. Stand behind a door that still holds. Dawn is 05:00.'],
    ['THE NEXT NIGHT.', 'Every dawn you live, the next night brings a larger pack. The house remembers.'],
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

/**
 * The hunt's payoff beat: what the night bought, on a death and on a dawn
 * alike (docs/PURPOSE.md §2 P2). A night that ends in blood still taught you
 * something about the thing you came to kill, and the screen says so — this is
 * the difference between TRY AGAIN and "I am one step closer to it."
 *
 * Drawn as a hunter's journal: the intel first (what you learned), then what
 * you carry, then the one meter that only ever moves forward.
 */
function drawHuntGain(game, ctx, w, h, y, heading = 'WHAT THE NIGHT TAUGHT YOU', floorY = Infinity) {
  const gain = game.lastGain;
  if (!gain) return y;
  const phone = isPhone(w, h);
  const maxW = w - 34;
  // The block stops at its floor: on a dawn the screen is full of buttons and
  // stat rows, and a hunt readout that runs under the thumb is worse than a
  // short one. Rows are drawn in order of worth, so what gets dropped first is
  // the flavour, never the meter and never her.
  const roomFor = (need) => y + need <= floorY;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!roomFor(phone ? 15 : 18)) { ctx.restore(); return y; }
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.85)';
  ctx.fillText(heading, w / 2, y);
  y += phone ? 15 : 18;

  // The end of the hunt, when this was the night it ended. It outranks
  // everything else on the card — the other rows are what it cost.
  if ((gain.masterDown || gain.masterReady) && roomFor(phone ? 16 : 18)) {
    ctx.font = `500 ${phone ? 10.5 : 12}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.4px';
    ctx.fillStyle = gain.masterDown ? 'rgba(240,196,120,0.98)' : 'rgba(232,150,110,0.95)';
    ctx.fillText(gain.masterDown ? 'THE MASTER IS DEAD · THE HUNT IS OVER' : 'THE HUNT IS FULL · IT CAN BE ENDED', w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 16 : 18;
  }

  // tonight's errand, answered: asked at nightfall, paid here. One line — the
  // point is the verdict, not a second spreadsheet.
  if (gain.objective && roomFor(phone ? 15 : 17)) {
    const ob = gain.objective;
    const verdict = ob.done ? 'DONE' : (ob.bonus > 0 ? 'HALF DONE' : 'MISSED');
    const text = `TONIGHT · ${ob.label} — ${verdict}${ob.bonus > 0 ? `  +${ob.bonus.toFixed(1)}` : ''}`;
    const px = fitType(ctx, text, maxW, phone ? 10 : 11.5, SANS, 500);
    ctx.font = `500 ${px}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = ob.done ? 'rgba(214,178,96,0.95)' : 'rgba(160,152,138,0.8)';
    ctx.fillText(text, w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 15 : 17;
  }

  // the freshest facts first — two is what fits and what reads
  const shown = gain.intel.slice(0, 2);
  for (const id of shown) {
    const line = intelLine(id);
    if (!line || !roomFor(phone ? 14 : 16)) continue;
    const px = fitType(ctx, line, maxW - 16, phone ? 11.5 : 13, SERIF, 400);
    ctx.font = `italic 400 ${px}px ${SERIF}`;
    ctx.fillStyle = 'rgba(226,212,178,0.92)';
    ctx.fillText(line, w / 2, y);
    y += phone ? 14 : 16;
  }
  if (gain.intel.length > shown.length && roomFor(phone ? 14 : 16)) {
    ctx.font = `400 10px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = 'rgba(170,160,140,0.7)';
    ctx.fillText(`+ ${gain.intel.length - shown.length} MORE IN THE JOURNAL`, w / 2, y);
    y += phone ? 14 : 16;
  }

  // what the night paid, in one line
  if (!roomFor(phone ? 16 : 19)) { ctx.restore(); return y; }
  ctx.font = `500 ${phone ? 10.5 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(196,190,172,0.9)';
  ctx.fillText(`+ ${gain.materials} MATERIALS`, w / 2, y);
  y += phone ? 16 : 19;

  // THE HUNT — one meter, ten cells, forward only
  if (!roomFor(phone ? 30 : 34)) { ctx.restore(); return y; }
  const pct = huntPct(game.save);
  const cells = 10;
  const cellW = phone ? 15 : 18;
  const gap = 3;
  const barW = cells * cellW + (cells - 1) * gap;
  let x = w / 2 - barW / 2;
  const filled = Math.round((huntProgress(game.save) / 100) * cells);
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i < filled ? 'rgba(200,160,74,0.92)' : 'rgba(120,110,92,0.22)';
    ctx.fillRect(x, y - 4, cellW, 7);
    x += cellW + gap;
  }
  y += 14;
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`THE HUNT · ${pct}%`, w / 2, y);
  y += phone ? 14 : 16;

  // the house is becoming hers (P6) — and the end is in sight
  if (gain.levelUp && roomFor(phone ? 15 : 17)) {
    // The Clash-base beat, in one line: what the house was, and what it is now.
    const st = fortressState(game.save);
    const from = FORTRESS_STATES[gain.levelBefore] || FORTRESS_STATES[0];
    ctx.font = `italic 400 ${phone ? 11 : 12.5}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(232,200,140,0.95)';
    ctx.fillText(`THE HOUSE IS BECOMING YOURS · ${from.name} ▸ ${st.name}`, w / 2, y);
    y += phone ? 15 : 17;
  }
  for (const tell of huntTells(game.save)) {
    if (!roomFor(phone ? 14 : 16)) break;
    ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(206,120,96,0.9)';
    ctx.fillText(tell, w / 2, y);
    y += phone ? 14 : 16;
  }
  // And the one person who is still in the house, waiting up. She speaks on a
  // death too — the run that ends in blood is the one that needs her most.
  const said = informantLine(game.save, gain.won ? 'dawn' : 'death', gain);
  if (said && said.text && roomFor(phone ? 14 : 16)) {
    ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(196,180,150,0.9)';
    const lines = wrapLines(ctx, said.text, maxW).slice(0, 2);
    for (const ln of lines) { if (!roomFor(phone ? 14 : 16)) break; ctx.fillText(ln, w / 2, y); y += phone ? 14 : 16; }
    ctx.font = `500 ${phone ? 8 : 9}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(150,140,120,0.7)';
    ctx.fillText(`— ${INFORMANT.name}`, w / 2, y - (phone ? 3 : 4));
    y += phone ? 12 : 14;
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
  return y;
}

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
  const worn = IAP.equippedCoat(game.save);
  const laneDeath = houseTitle(game.save);
  const coatDeath = worn === 'coat_glutton' ? 'SHE DIED STILL HUNGRY.'
    : worn === 'coat_warden' ? 'THE WOOD OUTLASTED HER.'
    : worn === 'coat_shade' ? 'THE QUIET CLOSED OVER HER.'
    : laneDeath ? laneDeath + ' ENDS HERE. THE NAME DOES NOT.'
    : null;
  if (coatDeath) {
    ctx.font = `italic 400 13px ${SERIF}`;
    ctx.fillStyle = 'rgba(196,176,140,0.75)';
    ctx.fillText(coatDeath, w / 2, h * 0.4);
  }

  const stats = game.stats;
  const rows = [
    ['SURVIVED', fmtClock(game.time)],
    ['BEST', game.save.bestTime > 0 ? fmtClock(game.save.bestTime) : '--:--'],
    ['NIGHTS SURVIVED', String(game.save.nightsSurvived)],
  ];
  const phoneDeath = isPhone(w, h);
  const step = phoneDeath || h < 700 ? 40 : 52;
  let y = phoneDeath ? h * 0.34 : h * 0.4;
  for (const [k, v] of rows) {
    ctx.font = `500 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(170,162,150,0.7)';
    ctx.fillText(k, w / 2, y);
    ctx.font = `400 ${phoneDeath ? 18 : 20}px ${MONO}`;
    ctx.fillStyle = '#e2dac6';
    ctx.fillText(v, w / 2, y + 18);
    y += step;
  }
  const riskOpen = unlocked(game.save, 'risk') && (game.shardsEarned || 0) > 0;
  if (riskOpen) {
    ctx.font = `500 13px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(200,160,74,0.95)';
    const floor = game.purseSettled ? game.bankedNow : Math.max(1, Math.round((game.shardsEarned || 0) * 0.2));
    ctx.fillText(game.purseSettled ? `◆ ${game.bankedNow} KEPT` : `◆ ${game.shardsEarned} AT RISK · KEEP ${floor}`, w / 2, y + 4);
    ctx.font = `400 11px ${SANS}`;
    ctx.fillStyle = 'rgba(176,166,150,0.75)';
    ctx.fillText('KEEPS THE PURSE. NOT THE CLAW.', w / 2, y + 20);
    y += 36;
  }
  if (game.lastNightGoals && game.lastNightGoals.length) {
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    const done = game.lastNightGoals.filter((g) => g.state === 'done');
    ctx.fillStyle = 'rgba(160,154,142,0.8)';
    ctx.fillText(`GOALS ${done.length}/${game.lastNightGoals.length}`, w / 2, y + 8);
  }
  // THE HUNT: she died, and the night still paid. The spine's hard rule is
  // that this block is here at all — a death that banks nothing is a score.
  if (game.lastGain) {
    // the death screen's own button stack, so the block can stop above it:
    // up to three rows (TRY AGAIN, the revive offer, MAIN MENU) off the bottom.
    const dBh = h < 520 ? 42 : 48, dGap = h < 640 ? 6 : 8;
    const dTop = Math.min(h * 0.76, h - (3 * (dBh + dGap)) - 14);
    drawHuntGain(game, ctx, w, h, y + 26, 'WHAT THE NIGHT TAUGHT YOU', dTop - 8);
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : 220, bh = h < 520 ? 42 : 48;
    const items = [
      { label: 'TRY AGAIN', onClick: () => game.beginNight(), accent: '#a8833c' },
    ];
    const atRisk = game.shardsEarned || 0;
    const relief = unlocked(game.save, 'risk') && atRisk > 0 && !game.usedRevive;
    // Archero-style relief (docs/DESIGN.md §7 · D9): the revive is *tempting
    // but never forcing*. The offer is a snap decision on a short, visible
    // countdown that opens when the buttons fade in and closes after
    // REVIVE_WINDOW seconds. Letting it lapse forfeits nothing but the offer
    // itself — the purse still keeps its floor on TRY AGAIN / MAIN MENU.
    const REVIVE_OFFER_AT = 2.5, REVIVE_WINDOW = 6;
    const reviveLeft = clamp(REVIVE_WINDOW - (t - REVIVE_OFFER_AT), 0, REVIVE_WINDOW);
    const reviveOpen = reviveLeft > 0;
    const ownsRevive = !game.usedRevive && game.save.iap && game.save.iap.revives > 0;
    const canBuyRevive = relief && IAP.mode !== 'disabled' && IAP.offered(game.save, 'revive1');
    const canAdRevive = !game.usedRevive && Ads.isAvailable('revive');
    const hasReviveOffer = !game.usedRevive && (ownsRevive || canBuyRevive || canAdRevive);
    if (reviveOpen) {
      if (relief && ownsRevive) {
        items.push({ label: `KEEP ◆ ${atRisk}`, onClick: () => game.spendSecondBlood(), accent: '#a8833c' });
      } else if (ownsRevive) {
        items.push({ label: 'USE SECOND BLOOD', onClick: () => game.spendSecondBlood(), accent: '#6a6a80' });
      } else if (canBuyRevive) {
        items.push({ label: `KEEP ◆ ${atRisk}`, onClick: () => game.purchaseSku('revive1'), accent: '#a8833c' });
      }
      if (canAdRevive) {
        items.push({
          label: relief ? `WATCH · KEEP ◆ ${atRisk}` : Ads.label('revive'),
          onClick: () => game.requestAdRevive(),
          accent: '#6a2230',
        });
      }
    }
    items.push(
      { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'death'), accent: '#6a6a80' },
      { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
    );
    // v1.0 (QA P0-2): stack from the bottom edge upward — landscape phones
    // never clip the last button, whatever the row count.
    const gap = h < 640 ? 6 : 8;
    let by = Math.min(h * 0.76, h - (items.length * (bh + gap)) - 14);

    // The countdown sits just above the button stack while an offer is live;
    // once it lapses, one quiet line tells the player the moment is gone.
    if (hasReviveOffer) {
      ctx.save();
      ctx.textAlign = 'center';
      const barW = bw, bx = w / 2 - barW / 2, cy = by - 22;
      if (reviveOpen) {
        ctx.font = `600 11px ${SANS}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
        ctx.fillStyle = 'rgba(200,160,74,0.95)';
        ctx.fillText(`DECIDE · ${Math.ceil(reviveLeft)}`, w / 2, cy - 4);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.fillStyle = 'rgba(120,90,40,0.3)';
        ctx.fillRect(bx, cy + 6, barW, 3);
        ctx.fillStyle = 'rgba(200,160,74,0.92)';
        ctx.fillRect(bx, cy + 6, barW * (reviveLeft / REVIVE_WINDOW), 3);
      } else {
        ctx.font = `italic 400 12px ${SERIF}`;
        ctx.fillStyle = 'rgba(150,120,110,0.7)';
        ctx.fillText('THE MOMENT PASSED. THE PURSE KEEPS ONLY ITS FLOOR.', w / 2, cy);
      }
      ctx.restore();
    }

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
  fitType(ctx, 'DUSKHOLD', w - 28, phone ? 16 : clamp(w * 0.026, 20, 34), SERIF, 400);
  ctx.fillStyle = 'rgba(226,218,200,0.85)';
  ctx.fillText('DUSKHOLD', w / 2, phone ? 28 : h * 0.14);
  fitType(ctx, 'SURVIVED', w - 28, phone ? 32 : clamp(w * 0.05, 36, 64), SERIF, 400);
  ctx.fillStyle = '#f0e6c8';
  ctx.shadowColor = 'rgba(255,200,120,0.45)'; ctx.shadowBlur = 30;
  ctx.fillText('SURVIVED', w / 2, phone ? 64 : h * 0.23);
  ctx.shadowBlur = 0;
  const dawnName = IAP.owns(game.save, 'title_dawnbreaker') ? 'DAWNBREAKER' : houseTitle(game.save);
  if (dawnName) {
    ctx.font = `400 14px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(224, 180, 92, 0.9)';
    const call = dawnName.length > 16 ? dawnName : 'THE HOUSE CALLS YOU ' + dawnName;
    ctx.fillText(call, w / 2, h * 0.29);
  }
  if (game.endingJustChosen) {
    ctx.font = `400 ${phone ? 13 : 15}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = '#f0e6d4';
    ctx.fillText(game.endingJustChosen === 'monster' ? 'She stayed. The siege is hers now.' : 'It burned. She was free.', w / 2, phone ? 108 : h * 0.345);
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
  const items = [
    { label: 'THE REFUGE', onClick: () => game.setScreen('refuge', 'victory'), accent: '#a8833c' },
    { label: 'ANOTHER NIGHT', onClick: () => game.beginNight(), accent: '#a8833c' },
    { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
  ];
  const gap = h < 640 ? 5 : 8;
  const bh = h < 520 ? 36 : 46;
  const buttonStack = (bh + gap) * items.length - gap;
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
  ctx.fillText(`◆ ${game.bankedNow || game.shardsEarned} BANKED`, cx, y + 12);
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
  // THE HUNT: a dawn is the biggest step of the night, and the screen says
  // what it was worth. Clamped so it never runs into the buttons.
  if (game.lastGain) {
    const huntTop = Math.max(y + 30, buttonTop - 150);
    drawHuntGain(game, ctx, w, h, huntTop, 'WHAT THE NIGHT PAID', buttonTop - 8);
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : Math.min(220, w * 0.72);
    let by = buttonTop;
    items.forEach((it, i) => {
      const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
      buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
      by += bh + gap;
    });
  }
}

/* ================= in-run tutorial hints ================= */

export function drawTutorial() {
  // The first night is taught by the pointing hand in coach.js, not by a page.
}

/* ================= the Blood Market (IAP) — src/shop/iap.js =================
 * Catalog policy lives in iap.js; this screen is only its face. Every card
 * states plainly what it is, every item is also shard-buyable, the sandbox
 * mark (⌁) tells beta testers no real money moves. Ads are off until a
 * provider is configured; money never buys a claw.
 */
export function drawShop(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  const B = game.save;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'BLOOD MARKET', w - 32, phone ? 22 : clamp(w * 0.03, 22, 32), SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('BLOOD MARKET', w / 2, phone ? 28 : h * 0.075);
  fitType(ctx, `◆ ${B.shards}`, w - 32, phone ? 12 : 13, MONO, 400);
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  const relicBit = unlocked(B, 'relics') ? `   ·   ✦ ${B.relics || 0}` : '';
  const purse = phone
    ? `◆ ${B.shards}${relicBit}`
    : `◆ ${B.shards} EARNED${relicBit}   ·   MERCY ${(B.iap && B.iap.revives) | 0}   ·   NOTHING HERE CHANGES THE CLAW`;
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
  const shown = CATALOG.filter((sku) => sku.kind !== 'remove_ads' || unlocked(B, 'ads'));
  const rows = Math.ceil(shown.length / cols);
  const gridTop = phone ? 62 : h * 0.175;
  const footY = h - (phone ? 58 : (wide ? 76 : 62));
  const cardH = clamp((footY - gridTop - gap * (rows - 1)) / rows, phone ? 64 : 72, phone ? 128 : 108);
  let cy = gridTop;
  let cx = padX;
  const iapBag = (B.iap && B.iap.owned) || {};

  shown.forEach((sku) => {
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
      const useRelic = !sku.shardPrice && sku.relicPrice;
      const canShard = sku.shardPrice && B.shards >= sku.shardPrice;
      const canRelic = sku.relicPrice && (B.relics || 0) >= sku.relicPrice;
      const r2 = uiButton(game, {
        x: x2, y: by2, w: bw2, h: bh2,
        label: useRelic ? '✦ RELIC' : '◆ SHARDS', small: true, disabled: useRelic ? !canRelic : !canShard,
        onClick: () => (useRelic ? game.buySkuWithRelics(sku.id) : game.buySkuWithShards(sku.id)),
      });
      buttonVisual(ctx, r2.b, { active: r2.hover || r2.selected, label: useRelic ? '✦ RELIC' : '◆ SHARDS', small: true, accent: '#6a6a80', disabled: useRelic ? !canRelic : !canShard });
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
  const adsLine = Ads.provider() === 'none'
    ? 'ADS ARE OFF HERE · IF THEY RETURN THEY ARE OPT-IN, NEVER FORCED'
    : 'REWARDED ADS ARE OPT-IN AND HARD-CAPPED · NEVER FORCED';
  const policy = ['SHARDS ARE EARNED BY THE NIGHT · MONEY BUYS RELIEF AND IDENTITY · NEVER POWER',
    adsLine,
    IAP.mode === 'native' ? 'GOOGLE PLAY BILLING · THE GAME GRANTS ONLY AFTER CONSUME OR ACKNOWLEDGE'
      : IAP.mode === 'midtrans' ? 'WEB RAIL · RELIEF AND IDENTITY ONLY · THE SERVER CONFIRMS SETTLEMENT'
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
  const r4 = uiButton(game, { x: phone ? 20 + bw : w / 2 + 8, y: h - (phone ? 50 : (wide ? 66 : 52)), w: bw, h: bh, label: backLabel, onClick: () => game.setScreen(back, 'shop'), small: true, accent: '#a8833c' });
  buttonVisual(ctx, r4.b, { active: r4.hover || r4.selected, label: backLabel, small: true, accent: '#a8833c' });
}

/* ============================================================
 * THE PEAKS (src/game/climax.js)
 *
 * Drawn over the world, never as a menu: the crescendo, the frenzy, the duel
 * and the dawnbreak are part of the night. Everything here has to read in a
 * 2–3 second 9:16 clip with the sound off, at phone width and in short
 * landscape, which is why it is one word, one bar, one silhouette — never a
 * paragraph. No debug text, ever: these frames are the ad.
 * ============================================================ */

function capsule(ctx, x, y, ww, hh, r) {
  const rr = Math.min(r, ww / 2, hh / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + ww - rr, y);
  ctx.arcTo(x + ww, y, x + ww, y + rr, rr);
  ctx.lineTo(x + ww, y + hh - rr);
  ctx.arcTo(x + ww, y + hh, x + ww - rr, y + hh, rr);
  ctx.lineTo(x + rr, y + hh);
  ctx.arcTo(x, y + hh, x, y + hh - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 2. The blood moon is up: one word, and how much of it is left. */
function drawFrenzyPlate(game, ctx, w, h, phone, short) {
  const f = game.climax.frenzy;
  if (!f) return;
  const left = clamp(1 - f.t / f.dur, 0, 1);
  const a = clamp(f.t / 0.22, 0, 1) * clamp((f.dur - f.t) / 0.9, 0, 1);
  const y = short ? h * 0.3 : h * 0.32;
  const size = clamp(short ? w * 0.085 : w * (phone ? 0.16 : 0.08), 26, 86);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${size}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (size * 0.2).toFixed(1) + 'px';
  ctx.shadowColor = 'rgba(206,20,34,0.9)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#f4dedb';
  ctx.fillText('FRENZY', w / 2, y);
  ctx.shadowBlur = 0;
  const bw = Math.min(w * 0.52, 300);
  const bh = short ? 3 : 5;
  const bx = w / 2 - bw / 2;
  const by = y + size * 0.62;
  ctx.fillStyle = 'rgba(6,7,10,0.6)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#d0202e';
  ctx.fillRect(bx, by, bw * left, bh);
  ctx.font = `500 ${short ? 9 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(232,190,186,0.8)';
  ctx.fillText('THE MOON IS UP', w / 2, by + bh + (short ? 11 : 16));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** 3. The duel: the thing in the dark has a name and a bar of its own. */
function drawBossPlate(game, ctx, w, h, boss, phone, short) {
  const d = game.climax.duel;
  const a = clamp((d.t - 0.25) / 0.5, 0, 1) * clamp((d.dur - d.t) / 0.4, 0, 1);
  const y = phone ? 132 : h * 0.27;
  const bw = Math.min(w * 0.46, 320);
  const bx = w / 2 - bw / 2;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 10 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3.4px';
  const isMaster = !!(d && d.master);
  ctx.fillStyle = isMaster ? 'rgba(240,150,110,0.98)' : 'rgba(232,110,96,0.95)';
  ctx.shadowColor = isMaster ? 'rgba(120,20,20,0.9)' : 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = isMaster ? 14 : 8;
  ctx.fillText((d && d.name) || 'THE ALPHA', w / 2, y);
  ctx.shadowBlur = 0;
  const hp = clamp(boss.hp / boss.hpMax, 0, 1);
  const bh = short ? 3 : 5;
  ctx.fillStyle = 'rgba(6,7,10,0.72)';
  ctx.fillRect(bx, y + 11, bw, bh);
  ctx.fillStyle = '#8e1b26';
  ctx.fillRect(bx, y + 11, bw * hp, bh);
  ctx.strokeStyle = 'rgba(232,110,96,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, y + 11.5, bw - 1, bh - 1);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** 4. Dawnbreak: she lifts a hand she has not needed in a hundred years. */
function drawShieldingHand(ctx, w, h, k) {
  const s = Math.min(w, h * 1.15);
  ctx.save();
  ctx.globalAlpha = clamp(k, 0, 1);
  ctx.translate(w * 0.46, h * 0.86);
  ctx.rotate(-0.42);
  // forearm
  ctx.fillStyle = 'rgba(7,6,9,0.95)';
  capsule(ctx, -s * 0.15, -s * 0.1, s * 0.3, s * 0.62, s * 0.15);
  ctx.fill();
  // palm and fingers, tipped toward the sun
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.13, s * 0.2, s * 0.15, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const fx = -s * 0.15 + i * s * 0.1;
    capsule(ctx, fx - s * 0.038, -s * 0.34 - (i === 1 || i === 2 ? s * 0.03 : 0), s * 0.076, s * 0.24, s * 0.038);
    ctx.fill();
  }
  // the light gets past her: a gold rim along the top of the hand
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = 'rgba(255,214,150,0.9)';
  ctx.shadowColor = 'rgba(255,200,130,0.95)';
  ctx.shadowBlur = 22;
  ctx.lineWidth = Math.max(1.6, s * 0.008);
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.13, s * 0.2, s * 0.15, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}

export function drawPeakOverlay(game, ctx, w, h) {
  const c = game.climax;
  if (!c) return;
  const phone = isPhone(w, h);
  const short = h < 520;
  if (c.frenzy) drawFrenzyPlate(game, ctx, w, h, phone, short);
  const boss = c.boss;
  if (boss && c.duel) drawBossPlate(game, ctx, w, h, boss, phone, short);
  if (c.shield > 0.01) drawShieldingHand(ctx, w, h, c.shield);
}

/* ================= the refuge =================
 *
 * THE HUNTER'S REFUGE — the dawn safehouse, and the one person in it
 * (docs/PURPOSE.md P3, §5). Between nights you come back to a room with
 * someone in it who has watched every night you survived and who is still in
 * the house when you leave it. This is also the visible-progression screen:
 * the board she keeps fills as the hunt does — the facts you won, pinned; the
 * trophies you took, hung; the weapon you carry, racked. One glance says
 * "I am building toward something", and it says it in her room, not in a menu.
 *
 * She is painted, not photographed: a hooded figure in a gilt frame, lit from
 * the left by one candle, her face in shadow. You never quite see her, and
 * that is the point — you are meant to wonder whether she makes it out.
 */

function drawInformantPortrait(ctx, cx, cy, w, h, t) {
  ctx.save();
  ctx.translate(cx, cy);
  // the frame: gilt, a little crooked, like everything else in this house
  ctx.save();
  ctx.rotate(-0.012);
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, '#4a3a1c');
  g.addColorStop(0.45, '#8d6c31');
  g.addColorStop(0.6, '#c9a45a');
  g.addColorStop(1, '#3a2c15');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // the dark inside
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2 - 7, h / 2 - 7, 0, 0, TAU);
  ctx.fillStyle = '#0b0a0e';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // the room behind her: a wall, and the light of one candle off to the left
  const room = ctx.createRadialGradient(-w * 0.22, h * 0.12, 4, -w * 0.1, 0, w * 0.75);
  room.addColorStop(0, 'rgba(214,146,64,0.42)');
  room.addColorStop(0.45, 'rgba(112,66,34,0.16)');
  room.addColorStop(1, 'rgba(6,6,10,0)');
  ctx.fillStyle = room;
  ctx.fillRect(-w, -h, w * 2, h * 2);
  // her: a hood, shoulders, and the suggestion of a face you cannot see
  const sway = Math.sin(t * 0.7) * 0.6;
  ctx.save();
  ctx.translate(sway, 0);
  ctx.fillStyle = 'rgba(9,8,12,0.96)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.30, h * 0.52);                       // left shoulder
  ctx.bezierCurveTo(-w * 0.30, -h * 0.06, -w * 0.17, -h * 0.30, 0, -h * 0.32);
  ctx.bezierCurveTo(w * 0.17, -h * 0.30, w * 0.30, -h * 0.06, w * 0.30, h * 0.52);
  ctx.closePath();
  ctx.fill();
  // the rim the candle puts on her left side
  ctx.strokeStyle = 'rgba(226,164,92,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.30, h * 0.52);
  ctx.bezierCurveTo(-w * 0.30, -h * 0.06, -w * 0.17, -h * 0.30, 0, -h * 0.32);
  ctx.stroke();
  // two glints, and nothing else — you never quite see her face
  const flick = 0.55 + 0.45 * Math.sin(t * 5.1) * Math.sin(t * 2.3);
  ctx.fillStyle = `rgba(240,204,150,${0.35 + flick * 0.4})`;
  ctx.beginPath(); ctx.ellipse(-w * 0.07, -h * 0.10, 2.1, 1.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w * 0.05, -h * 0.10, 2.1, 1.5, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // the candle, at the edge of the frame
  const fx = -w * 0.40, fy = h * 0.16;
  ctx.fillStyle = 'rgba(228,226,214,0.5)';
  ctx.fillRect(fx - 2, fy, 4, h * 0.30);
  const fl = ctx.createRadialGradient(fx, fy - 2, 0.5, fx, fy - 2, 13);
  fl.addColorStop(0, `rgba(255,236,190,${0.85 + flick * 0.15})`);
  fl.addColorStop(0.35, `rgba(240,168,70,${0.45 + flick * 0.2})`);
  fl.addColorStop(1, 'rgba(200,110,40,0)');
  ctx.fillStyle = fl;
  ctx.beginPath(); ctx.ellipse(fx, fy - 2, 13, 15, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // glass over it all
  const glass = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  glass.addColorStop(0, 'rgba(255,255,255,0.10)');
  glass.addColorStop(0.4, 'rgba(255,255,255,0.02)');
  glass.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2 - 7, h / 2 - 7, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A trophy glyph for each kind of thing she has put down. */
function drawTrophy(ctx, glyph, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(214,204,182,0.85)';
  ctx.fillStyle = 'rgba(214,204,182,0.85)';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  if (glyph === 'crawl') {                       // a hand, reaching
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.5);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.2, -s * 0.1, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.1, s * 0.5, s * 0.2);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.1 + i * s * 0.22, -s * 0.5 + i * s * 0.06);
      ctx.lineTo(-s * 0.16 + i * s * 0.22, -s * 0.78 + i * s * 0.06);
      ctx.stroke();
    }
  } else if (glyph === 'bone') {                 // a knuckle bone
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.15);
    ctx.lineTo(s * 0.5, s * 0.15);
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.arc(sx * s * 0.5, sx * s * 0.15, s * 0.19, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(sx * s * 0.5, -sx * s * 0.22, s * 0.17, 0, TAU); ctx.fill();
    }
  } else if (glyph === 'fang') {                 // a hound's tooth
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.05, -s * 0.1, s * 0.02, s * 0.55);
    ctx.quadraticCurveTo(-s * 0.28, s * 0.1, -s * 0.32, -s * 0.5);
    ctx.fill();
  } else if (glyph === 'crown') {                // what killed the house, mounted
    ctx.strokeStyle = 'rgba(232,192,116,0.95)';
    ctx.fillStyle = 'rgba(232,192,116,0.95)';
    ctx.beginPath();                              // the band
    ctx.moveTo(-s * 0.46, s * 0.24);
    ctx.lineTo(s * 0.46, s * 0.24);
    ctx.stroke();
    ctx.beginPath();                              // the points
    ctx.moveTo(-s * 0.46, s * 0.24);
    ctx.lineTo(-s * 0.34, -s * 0.34);
    ctx.lineTo(-s * 0.14, s * 0.02);
    ctx.lineTo(0, -s * 0.52);
    ctx.lineTo(s * 0.14, s * 0.02);
    ctx.lineTo(s * 0.34, -s * 0.34);
    ctx.lineTo(s * 0.46, s * 0.24);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === 'jaw') {                  // a jaw, hinged open
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.1);
    ctx.quadraticCurveTo(0, s * 0.45, s * 0.5, -s * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.1);
    ctx.quadraticCurveTo(0, -s * 0.6, s * 0.5, -s * 0.1);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.2, -s * 0.08 + Math.abs(i) * s * 0.06);
      ctx.lineTo(i * s * 0.2, s * 0.14 + Math.abs(i) * s * 0.02);
      ctx.stroke();
    }
  } else if (glyph === 'bolt') {                 // a crossbow bolt
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, s * 0.45); ctx.lineTo(s * 0.5, -s * 0.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.4); ctx.lineTo(s * 0.16, -s * 0.42);
    ctx.lineTo(s * 0.44, -s * 0.08); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, s * 0.45); ctx.lineTo(-s * 0.4, s * 0.1);
    ctx.lineTo(-s * 0.7, s * 0.2); ctx.closePath(); ctx.fill();
  } else {                                       // an eye, open in the dark
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, 0);
    ctx.quadraticCurveTo(0, -s * 0.45, s * 0.55, 0);
    ctx.quadraticCurveTo(0, s * 0.45, -s * 0.55, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawRefuge(game, ctx, w, h) {
  const phone = isPhone(w, h);
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.86 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const pad = phone ? 14 : Math.max(24, (w - 520) / 2);
  const colW = w - pad * 2;
  const t = game.refugeT || 0;
  let y = phone ? 26 : 34;

  fitType(ctx, "THE HUNTER'S REFUGE", colW, phone ? 17 : 22, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText("THE HUNTER'S REFUGE", w / 2, y);
  y += phone ? 20 : 26;
  ctx.font = `500 ${phone ? 9 : 10.5}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.8)';
  ctx.fillText('DAWN · THE HOUSE IS ASLEEP · FOR NOW', w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- her ----
  const pw = Math.min(colW * 0.40, 132), ph = pw * 1.18;
  drawInformantPortrait(ctx, w / 2, y + ph / 2, pw, ph, t);
  y += ph + (phone ? 12 : 16);
  fitType(ctx, INFORMANT.name, colW, phone ? 15 : 18, SERIF, 400);
  ctx.fillStyle = '#efe4c6';
  ctx.fillText(INFORMANT.name, w / 2, y);
  y += phone ? 15 : 18;
  ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(190,176,148,0.8)';
  ctx.fillText(`${INFORMANT.title} · ${INFORMANT.line}`, w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- what she says tonight ----
  const said = game.refugeLine || informantLine(game.save, 'hub', game.lastGain);
  ctx.font = `italic 400 ${phone ? 12.5 : 14}px ${SERIF}`;
  ctx.fillStyle = 'rgba(232,214,176,0.95)';
  ctx.textAlign = 'center';
  const saidLines = wrapLines(ctx, said.text, colW - 12);
  for (const ln of saidLines) { ctx.fillText(ln, w / 2, y); y += phone ? 16 : 18; }
  y += phone ? 6 : 8;

  // ---- the hunt, and the state of the house ----
  const pct = huntPct(game.save);
  const cells = 10, cellW = phone ? 14 : 17, gap = 3;
  const barW = cells * cellW + (cells - 1) * gap;
  const filled = Math.round((huntProgress(game.save) / 100) * cells);
  let bx = w / 2 - barW / 2;
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i < filled ? 'rgba(200,160,74,0.92)' : 'rgba(120,110,92,0.22)';
    ctx.fillRect(bx, y - 4, cellW, 7);
    bx += cellW + gap;
  }
  y += 14;
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`THE HUNT · ${pct}%`, w / 2, y);
  y += phone ? 13 : 15;
  ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
  ctx.fillStyle = 'rgba(206,196,170,0.85)';
  ctx.fillText(fortressState(game.save).name, w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- and whether the hunt can be ended yet ----
  if (masterDown(game.save) || masterReady(game.save)) {
    ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.2px';
    ctx.fillStyle = masterDown(game.save) ? 'rgba(232,192,116,0.98)' : 'rgba(232,150,110,0.95)';
    ctx.fillText(masterDown(game.save) ? 'THE MASTER IS DEAD' : 'TONIGHT IT CAN BE ENDED', w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 16 : 20;
  }

  // ---- the thumb comes first: everything above it has to fit over it ----
  const bwRef = phone ? Math.min(w - 28, 420) : Math.min(240, w * 0.6);
  const bhRef = h < 620 ? 40 : 46;
  const stackTop = h - (bhRef + 8) * 3 - (phone ? 10 : 18);

  // ---- the board she keeps ----
  const board = boardEntries(game.save);
  const cardX = pad, cardW = colW;
  const boardTop = y;
  const boardH = Math.max(78, stackTop - boardTop - (phone ? 12 : 18));
  const boardFloor = boardTop + boardH - 6;
  const roomFor = (need) => ly + need <= boardFloor;
  ctx.fillStyle = 'rgba(10,10,14,0.62)';
  ctx.fillRect(cardX, boardTop, cardW, boardH);
  ctx.strokeStyle = 'rgba(140,120,70,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, boardTop + 0.5, cardW - 1, boardH - 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cardX, boardTop, cardW, boardH);
  ctx.clip();

  ctx.textAlign = 'left';
  let ly = boardTop + 14;
  if (roomFor(phone ? 15 : 17)) {
    ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
    ctx.fillStyle = 'rgba(200,160,74,0.8)';
    ctx.fillText('THE BOARD SHE KEEPS', cardX + 12, ly);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 15 : 17;
  }

  if (!board.intel.length) {
    ctx.font = `italic 400 ${phone ? 11 : 12.5}px ${SERIF}`;
    ctx.fillStyle = 'rgba(170,162,146,0.75)';
    ctx.fillText('Empty. Bring her something.', cardX + 12, ly);
    ly += 16;
  } else {
    // pinned slips: the last three things you learned, newest first
    const slips = board.intel.slice(-3).reverse();
    for (const s of slips) {
      if (!roomFor(phone ? 27 : 30)) break;
      ctx.save();
      ctx.translate(cardX + 20, ly);
      ctx.rotate(-0.014);
      ctx.fillStyle = 'rgba(226,216,192,0.90)';
      ctx.fillRect(-8, -8, cardW - 30, 25);
      ctx.fillStyle = 'rgba(150,40,40,0.85)';       // the pin
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.font = `400 ${phone ? 8.5 : 10}px ${SERIF}`;
      ctx.fillStyle = 'rgba(40,34,26,0.95)';
      const txt = s.line.length > 52 ? s.line.slice(0, 51) + '…' : s.line;
      ctx.fillText(txt, 2, 3);
      ctx.restore();
      ly += phone ? 27 : 30;
    }
    if (board.intel.length > slips.length && roomFor(phone ? 15 : 17)) {
      ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
      ctx.fillStyle = 'rgba(170,162,146,0.7)';
      ctx.fillText(`+ ${board.intel.length - slips.length} MORE PINNED BEHIND HER`, cardX + 12, ly);
      ly += phone ? 14 : 16;
    }
  }

  // trophies, hung
  if (board.trophies.length && roomFor(phone ? 38 : 42)) {
    ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
    ctx.fillStyle = 'rgba(200,160,74,0.8)';
    ctx.fillText('TROPHIES', cardX + 12, ly);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 16 : 18;
    let tx = cardX + 26;
    for (const tr of board.trophies) {
      drawTrophy(ctx, tr.glyph, tx, ly, phone ? 13 : 15);
      ctx.font = `400 ${phone ? 9 : 10.5}px ${SANS}`;
      ctx.fillStyle = 'rgba(214,204,182,0.9)';
      ctx.fillText(`×${tr.count}`, tx + 12, ly + 1);
      tx += Math.max(78, ctx.measureText(`×${tr.count}`).width + 46);
      if (tx > cardX + cardW - 40 && roomFor(phone ? 20 : 22)) { tx = cardX + 26; ly += phone ? 20 : 22; }
    }
    ly += phone ? 4 : 6;
  }

  // the rack: the weapon she carries, the temperings it wears, and the rung
  // the hunt is still reaching for (#56 P5 — the mid-term goal layer)
  if (roomFor(phone ? 16 : 18)) {
    const marks = (board.weapon.temper || []).join(' · ');
    ctx.font = `400 ${phone ? 9.5 : 11}px ${SANS}`;
    ctx.fillStyle = (board.weapon.temper || []).length ? 'rgba(214,226,246,0.92)' : 'rgba(196,186,164,0.85)';
    ctx.fillText(board.weapon.name + (marks ? ` · ${marks}` : ''), cardX + 12, Math.min(ly, boardFloor - 2));
    ly += phone ? 14 : 16;
  }
  if (roomFor(phone ? 16 : 18)) {
    const n = board.weapon.next;
    ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(200,160,74,0.85)';
    const line = !n ? 'THE KIT IS FULLY TEMPERED'
      : !n.hasIntel ? `NEXT · ${n.name} · ${n.need - n.facts} MORE FACTS`
      : !n.hasCost ? `NEXT · ${n.name} · ${n.cost - n.materials} MORE MATERIALS`
      : `NEXT · ${n.name} · READY`;
    ctx.fillText(line, cardX + 12, Math.min(ly, boardFloor - 2));
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 14 : 16;
  }
  if (roomFor(phone ? 16 : 18)) {
    ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
    ctx.fillStyle = 'rgba(160,152,134,0.75)';
    ctx.fillText(`◆ ${board.materials} MATERIALS · ${board.nights} NIGHTS BANKED`, cardX + 12, Math.min(ly, boardFloor - 1));
  }
  ctx.restore();      // the board's clip

  // ---- the thumb ----
  const items = [
    { label: 'ANOTHER NIGHT', onClick: () => game.beginNight(), accent: '#a8833c' },
    { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'refuge'), accent: '#8a7a52' },
    { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
  ];
  let by = stackTop;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const r = uiButton(game, { x: w / 2 - bwRef / 2, y: by, w: bwRef, h: bhRef, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
    buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
    by += bhRef + 8;
  });
  ctx.restore();
}

/* =======================================================================
 * THE FIELD CARD — icon-first inventory, missions and player menus.
 * It is rendered over the live WebGL night; the simulation pauses while the
 * card is open, but the manor remains in view behind the glass.
 * ===================================================================== */

const FIELD_TABS = [
  { id: 'bag', icon: 'bag', title: 'FIELD PACK', sub: 'STOCK THAT IS REALLY IN YOUR HANDS' },
  { id: 'missions', icon: 'mission', title: 'TONIGHT’S ERRANDS', sub: 'SUPPLIES ARRIVE WHEN AN ERRAND IS COMPLETE' },
  { id: 'upgrades', icon: 'upgrade', title: 'TEMPER THE HUNTER', sub: 'SPEND ONLY THE SHARDS YOU HAVE EARNED' },
  { id: 'profile', icon: 'profile', title: 'SURVIVOR RECORD', sub: 'THE HOUSE KEEPS WHAT YOU DID' },
  { id: 'collection', icon: 'book', title: 'HOUSE RECORD', sub: 'FACES AND FRAGMENTS THE NIGHT HAS SHOWN YOU' },
  { id: 'shop', icon: 'blood', title: 'BLOOD MARKET', sub: 'OPTIONAL RELIEF AND IDENTITY — NEVER POWER' },
  { id: 'settings', icon: 'settings', title: 'SETTINGS', sub: 'TUNE THE NIGHT WITHOUT LEAVING IT' },
  { id: 'help', icon: 'help', title: 'FIELD GUIDE', sub: 'MOVEMENT, TOOLS AND THE HOUSE' },
  { id: 'privacy', icon: 'shield', title: 'PRIVACY', sub: 'LOCAL SAVE · NO ACCOUNT · WIPE WHENEVER YOU CHOOSE' },
];

function fieldIconButton(game, ctx, x, y, size, icon, onClick, opts = {}) {
  const disabled = !!opts.disabled;
  const idx = game.ui.length;
  const box = { x, y, w: size, h: size, onClick: disabled ? null : onClick, disabled, label: icon, idx };
  game.ui.push(box);
  const active = !!opts.active || (game.usingKeyboard && game.uiIndex === idx);
  const cx = x + size / 2, cy = y + size / 2;
  ctx.save();
  ctx.globalAlpha = disabled ? 0.42 : 1;
  ctx.fillStyle = active ? 'rgba(55,39,22,0.96)' : 'rgba(11,13,18,0.92)';
  ctx.strokeStyle = active ? 'rgba(213,178,103,0.95)' : 'rgba(169,157,132,0.48)';
  ctx.lineWidth = active ? 1.6 : 1;
  if (opts.round !== false) {
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.47, 0, TAU); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillRect(x, y, size, size); ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
  const ink = disabled ? 'rgba(172,163,146,0.7)' : active ? '#f2d99c' : '#d5cbb6';
  drawGameIcon(ctx, icon, cx, cy, Math.min(23, size * 0.54), ink);
  ctx.restore();
  return box;
}

function fieldFit(ctx, text, x, y, maxW, px, family = SANS, color = '#e5ddcb', weight = 400) {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(String(text)).width > maxW && size > 8) {
    size -= 0.5;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  ctx.fillStyle = color;
  ctx.fillText(String(text), x, y);
}

function fieldBar(ctx, x, y, w, p, tint = '#b79354') {
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = 'rgba(174,164,145,0.18)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, w * clamp(p || 0, 0, 1), 2);
}

function drawFieldBag(game, ctx, x, y, w, h, short) {
  const bag = game.inventory ? game.inventory() : ((game.save && game.save.inventory) || {});
  const p = game.player;
  const items = [
    { icon: 'blood', name: 'BLOOD', amount: `${Math.ceil(p.blood)} / ${Math.ceil(p.bloodMax)}`, note: 'VITALITY', tint: '#ce5960' },
    { icon: 'shard', name: 'SHARDS', amount: game.save.shards || 0, note: 'UPGRADE CURRENCY', tint: '#d3b66f' },
    { icon: 'plank', name: 'PLANKS', amount: p.planks | 0, note: 'BUILD MATERIAL', tint: '#c29a63' },
    { icon: 'arrow', name: 'ARROWS', amount: bag.arrows | 0, note: 'MISSION CACHE', tint: '#b8c5d0', action: { icon: 'shot', weapon: 'shot', count: bag.arrows | 0 } },
    { icon: 'knife', name: 'KNIVES', amount: bag.knives | 0, note: 'MISSION CACHE', tint: '#b8c5d0', action: { icon: 'knife', weapon: 'knife', count: bag.knives | 0 } },
    { icon: 'bandage', name: 'BANDAGES', amount: bag.bandages | 0, note: 'MISSION CACHE', tint: '#d2b68b', action: { icon: 'plus', use: true, count: bag.bandages | 0 } },
    { icon: 'relic', name: 'RELICS', amount: game.save.relics || 0, note: 'RECORDED FINDS', tint: '#a4b6c8' },
  ];
  const cols = w > 720 ? 3 : 2;
  const gap = short ? 6 : 10;
  const rows = Math.ceil(items.length / cols);
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = Math.max(48, Math.min(180, (h - gap * (rows - 1)) / rows));
  items.forEach((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = x + col * (cw + gap), cy = y + row * (ch + gap);
    ctx.save();
    ctx.fillStyle = 'rgba(16,19,26,0.84)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = 'rgba(174,151,105,0.27)';
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
    drawGameIcon(ctx, item.icon, cx + 19, cy + Math.min(24, ch * 0.37), short ? 17 : 20, item.tint);
    ctx.textBaseline = 'middle';
    fieldFit(ctx, item.name, cx + 34, cy + Math.min(18, ch * 0.28), Math.max(52, cw - 44), short ? 9 : 10.5, SANS, 'rgba(204,197,181,0.76)', 600);
    ctx.textAlign = 'right';
    fieldFit(ctx, item.amount, cx + cw - (item.action ? 36 : 10), cy + Math.min(37, ch * 0.58), cw - 48, short ? 15 : 19, MONO, '#f0e7d6', 400);
    ctx.textAlign = 'left';
    if (ch > 62) fieldFit(ctx, item.note, cx + 12, cy + ch - 11, cw - 24, short ? 7.5 : 8.5, SANS, 'rgba(159,153,140,0.65)', 500);
    if (item.action) {
      const actionX = cx + cw - 33;
      const actionY = cy + ch / 2 - 15;
      const disabled = item.action.count < 1 || (item.action.use && p.blood >= p.bloodMax - 0.1);
      fieldIconButton(game, ctx, actionX, actionY, 30, item.action.icon,
        () => item.action.use ? game.useBandage() : game.setWeapon(item.action.weapon), {
          disabled,
          active: !item.action.use && p.weapon === item.action.weapon,
        });
    }
    ctx.restore();
  });
  if (h > 80) {
    ctx.save();
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    fieldFit(ctx, `EQUIPPED · ${weaponById(p.weapon).label}`, x + w, y + h - 2, w, short ? 8 : 9, MONO, 'rgba(193,181,153,0.72)', 400);
    ctx.restore();
  }
}

function drawFieldRewards(ctx, reward, x, y, maxW, short) {
  const rows = [
    ['shards', 'shard'], ['planks', 'plank'], ['arrows', 'arrow'],
    ['knives', 'knife'], ['bandages', 'bandage'], ['blood', 'blood'],
  ].filter(([key]) => (reward && reward[key]) > 0);
  const step = short ? 30 : 38;
  const visible = rows.slice(0, Math.max(1, Math.floor(maxW / step)));
  let dx = x;
  for (const [key, icon] of visible) {
    drawGameIcon(ctx, icon, dx + 7, y, short ? 13 : 15, key === 'shards' ? '#d2b166' : key === 'blood' ? '#cc616b' : '#bac3c4');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${short ? 8 : 9}px ${MONO}`;
    ctx.fillStyle = 'rgba(220,212,195,0.85)';
    ctx.fillText(String(reward[key]), dx + 16, y + 0.5);
    dx += step;
  }
}

function drawFieldMissions(game, ctx, x, y, w, h, short) {
  const list = game.objectives && game.objectives.list || [];
  const complete = list.filter((slot) => slot.state === 'done').length;
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 9 : 10}px ${SANS}`;
  ctx.fillStyle = 'rgba(201,178,122,0.88)';
  ctx.fillText(`NIGHT ${String((game.save.nightsSurvived || 0) + 1).padStart(2, '0')}  ·  ${complete} / ${list.length} COMPLETE`, x, y + 7);
  if (!list.length) {
    ctx.font = `400 ${short ? 12 : 14}px ${SANS}`;
    ctx.fillStyle = '#ded5c4';
    ctx.fillText('The next errand is being written by the house.', x + 4, y + 50);
    ctx.restore();
    return;
  }
  const top = y + 20;
  const gap = short ? 5 : 8;
  const rowH = Math.max(35, Math.min(78, (h - 24 - gap * (list.length - 1)) / list.length));
  list.forEach((slot, i) => {
    const ry = top + i * (rowH + gap);
    const rw = slot.goal.reward || {};
    ctx.fillStyle = slot.state === 'done' ? 'rgba(37,31,24,0.82)' : 'rgba(15,18,25,0.82)';
    ctx.fillRect(x, ry, w, rowH);
    ctx.strokeStyle = slot.state === 'done' ? 'rgba(202,166,91,0.46)' : 'rgba(149,151,155,0.2)';
    ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rowH - 1);
    drawGameIcon(ctx, slot.goal.hunt ? 'profile' : 'mission', x + 19, ry + rowH * 0.43, short ? 17 : 21, slot.state === 'done' ? '#c7a85f' : '#c6c1b5');
    const rewardW = Math.min(short ? 152 : 205, w * 0.32);
    const textX = x + 39;
    const textW = w - rewardW - 48;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fieldFit(ctx, slot.goal.label, textX, ry + rowH * 0.36, textW, short ? 9.5 : 12, SANS, slot.state === 'done' ? '#e2ca91' : '#e2daca', 600);
    if (rowH > 47) fieldFit(ctx, slot.goal.hint || '', textX, ry + rowH * 0.65, textW, short ? 8 : 9.5, SANS, 'rgba(178,172,158,0.76)', 400);
    ctx.textAlign = 'right';
    ctx.font = `500 ${short ? 8 : 9}px ${MONO}`;
    ctx.fillStyle = slot.state === 'done' ? '#ddc27d' : 'rgba(181,174,158,0.78)';
    ctx.fillText(slot.state === 'done' ? 'DONE' : `${Math.round((slot.p || 0) * 100)}%`, x + w - 8, ry + 13);
    drawFieldRewards(ctx, rw, x + w - rewardW + 7, ry + rowH * 0.62, rewardW - 12, short);
    fieldBar(ctx, textX, ry + rowH - 7, textW, slot.state === 'done' ? 1 : slot.p || 0, slot.state === 'done' ? '#c5a45a' : '#9b424d');
  });
  ctx.restore();
}

function drawFieldUpgrades(game, ctx, x, y, w, h, short) {
  const save = game.save;
  const open = unlocked(save, 'builds');
  const gap = short ? 7 : 10;
  const rowH = Math.max(48, (h - 24 - gap * (LANES.length - 1)) / LANES.length);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 9 : 10}px ${SANS}`;
  ctx.fillStyle = 'rgba(211,180,112,0.92)';
  ctx.fillText(`◆ ${save.shards || 0} SHARDS`, x, y + 7);
  LANES.forEach((lane, i) => {
    const ry = y + 21 + i * (rowH + gap);
    const next = nextRank(save, lane.id);
    const owned = lane.ranks.filter((rank) => save.builds && save.builds[rank.id]).length;
    const capped = rankCount(save) >= LANE_CAP && !!next;
    const cost = next ? rankCost(save, next) : 0;
    const afford = open && !!next && !capped && save.shards >= cost;
    const icon = lane.id === 'glutton' ? 'claw' : lane.id === 'warden' ? 'plank' : 'run';
    ctx.fillStyle = 'rgba(16,18,25,0.84)';
    ctx.fillRect(x, ry, w, rowH);
    ctx.strokeStyle = 'rgba(168,148,102,0.28)';
    ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rowH - 1);
    drawGameIcon(ctx, icon, x + 22, ry + rowH * 0.46, short ? 18 : 23, '#c6ad78');
    ctx.textAlign = 'left';
    fieldFit(ctx, lane.name, x + 43, ry + rowH * 0.35, w - 126, short ? 10 : 13, SANS, '#e2d7c2', 600);
    const detail = !open ? 'OPENS AFTER TWO DAWNS' : next ? `${next.name}  ·  ${owned}/${lane.ranks.length} RANKS` : `MASTERED  ·  ${owned}/${lane.ranks.length}`;
    fieldFit(ctx, detail, x + 43, ry + rowH * 0.69, w - 128, short ? 8 : 9.5, SANS, 'rgba(175,169,155,0.76)', 400);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${short ? 9 : 10}px ${MONO}`;
    ctx.fillStyle = afford ? '#d5b56c' : 'rgba(170,161,145,0.65)';
    ctx.fillText(next ? `◆ ${cost}` : '—', x + w - 49, ry + rowH / 2);
    fieldIconButton(game, ctx, x + w - 39, ry + rowH / 2 - 15, 30, 'plus', () => game.buyUpgrade(lane.id), { disabled: !afford });
  });
  ctx.restore();
}

function drawFieldProfile(game, ctx, x, y, w, h, short) {
  const save = game.save;
  const title = houseTitle(save) || (save.ending === 'monster' ? 'THE HOUSE’S HEART' : 'UNNAMED SURVIVOR');
  const stats = [
    { icon: 'profile', label: 'DAWNS', value: save.nightsSurvived || 0 },
    { icon: 'claw', label: 'KILLS', value: save.bestDefeated || 0 },
    { icon: 'mission', label: 'NIGHTS ENTERED', value: save.nightsAttempted || 0 },
    { icon: 'shard', label: 'SHARDS', value: save.shards || 0 },
    { icon: 'relic', label: 'RELICS', value: save.relics || 0 },
    { icon: 'shot', label: 'BEST HOLD', value: fmtClock(save.bestTime || 0) },
  ];
  ctx.save();
  ctx.fillStyle = 'rgba(18,20,27,0.88)';
  ctx.fillRect(x, y, w, short ? 45 : 62);
  ctx.strokeStyle = 'rgba(183,153,99,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, (short ? 45 : 62) - 1);
  drawGameIcon(ctx, 'profile', x + 26, y + (short ? 22 : 31), short ? 24 : 34, '#d0b777');
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  fieldFit(ctx, title, x + 54, y + (short ? 20 : 27), w - 74, short ? 14 : 19, SANS, '#eee4d2', 600);
  fieldFit(ctx, `NIGHT ${(save.nightsSurvived || 0) + 1}  ·  DUSKHOLD FIELD RECORD`, x + 54, y + (short ? 36 : 47), w - 74, short ? 8 : 9, MONO, 'rgba(188,178,158,0.72)', 400);
  const top = y + (short ? 54 : 78);
  const gap = 8;
  const cols = w > 720 ? 3 : 2;
  const rows = Math.ceil(stats.length / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = Math.min(86, (h - (top - y) - gap * (rows - 1)) / rows);
  stats.forEach((stat, i) => {
    const cx = x + (i % cols) * (cellW + gap);
    const cy = top + Math.floor(i / cols) * (cellH + gap);
    ctx.fillStyle = 'rgba(13,16,22,0.86)'; ctx.fillRect(cx, cy, cellW, cellH);
    ctx.strokeStyle = 'rgba(153,149,138,0.22)'; ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    drawGameIcon(ctx, stat.icon, cx + 20, cy + cellH / 2, short ? 17 : 20, '#c5ad78');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fieldFit(ctx, stat.label, cx + 37, cy + cellH * 0.34, cellW - 48, short ? 8 : 9, SANS, 'rgba(176,168,151,0.72)', 600);
    fieldFit(ctx, stat.value, cx + 37, cy + cellH * 0.69, cellW - 48, short ? 14 : 18, MONO, '#e8deca', 400);
  });
  ctx.restore();
}

function drawFieldCollection(game, ctx, x, y, w, h, short) {
  const seen = game.save.seen || {};
  const known = CODEX.filter((entry) => seen[entry.id]);
  const gap = short ? 6 : 9;
  const cols = w > 720 ? 4 : 2;
  const rows = Math.ceil(CODEX.length / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = Math.min(76, (h - gap * (rows - 1) - 22) / rows);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 8 : 9}px ${SANS}`;
  ctx.fillStyle = 'rgba(200,171,111,0.85)';
  ctx.fillText(`${known.length} / ${CODEX.length} REMEMBERED`, x, y + 6);
  CODEX.forEach((entry, i) => {
    const cx = x + (i % cols) * (cellW + gap);
    const cy = y + 18 + Math.floor(i / cols) * (cellH + gap);
    const unlockedEntry = !!seen[entry.id];
    ctx.fillStyle = unlockedEntry ? 'rgba(22,22,27,0.86)' : 'rgba(11,13,18,0.7)';
    ctx.fillRect(cx, cy, cellW, cellH);
    ctx.strokeStyle = unlockedEntry ? 'rgba(182,151,96,0.34)' : 'rgba(132,133,137,0.18)';
    ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    drawGameIcon(ctx, unlockedEntry ? (entry.id === 'dawn' ? 'lamp' : 'mission') : 'shield', cx + 18, cy + cellH / 2, short ? 15 : 18, unlockedEntry ? '#c9ad70' : 'rgba(146,144,137,0.55)');
    ctx.textAlign = 'left';
    fieldFit(ctx, unlockedEntry ? entry.name : 'UNSEEN', cx + 35, cy + cellH * 0.42, cellW - 44, short ? 8.5 : 10, SANS, unlockedEntry ? '#dfd4bf' : 'rgba(156,152,144,0.62)', 600);
    if (cellH > 52) fieldFit(ctx, unlockedEntry ? 'RECORDED' : 'THE NIGHT HIDES IT', cx + 35, cy + cellH * 0.7, cellW - 44, short ? 7 : 8, SANS, 'rgba(158,151,138,0.66)', 400);
  });
  ctx.restore();
  const fragments = fragmentsKnown(game.save);
  if (fragments.length && h > 170) {
    ctx.save(); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    fieldFit(ctx, `${fragments.length} HOUSE FRAGMENTS KEPT`, x + w, y + h - 2, w, short ? 8 : 9, MONO, 'rgba(177,169,153,0.68)', 400);
    ctx.restore();
  }
}

function drawFieldMarket(game, ctx, x, y, w, h, short) {
  const shown = CATALOG.filter((sku) => sku.kind !== 'remove_ads' || unlocked(game.save, 'ads'));
  const cols = 2;
  const gap = short ? 6 : 9;
  const rows = Math.ceil(shown.length / cols);
  const cellW = (w - gap) / cols;
  const cellH = Math.max(36, (h - (short ? 22 : 28) - gap * (rows - 1)) / rows);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `400 ${short ? 7.5 : 9}px ${SANS}`;
  ctx.fillStyle = 'rgba(180,172,156,0.65)';
  ctx.fillText('Shards buy only what the night has already offered. Money never buys power.', x, y + 7);
  shown.forEach((sku, i) => {
    const cx = x + (i % cols) * (cellW + gap);
    const cy = y + (short ? 18 : 23) + Math.floor(i / cols) * (cellH + gap);
    const ownId = Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned;
    const owned = ownId && IAP.owns(game.save, ownId);
    const offered = IAP.offered(game.save, sku);
    const available = offered && !(owned && sku.play !== 'consumable');
    const canBuy = available
      && (sku.gives.revives ? ((game.save.iap && game.save.iap.revives) || 0) < 2 : true)
      && (game.save.shards || 0) >= sku.shardPrice;
    ctx.fillStyle = 'rgba(16,18,25,0.85)'; ctx.fillRect(cx, cy, cellW, cellH);
    ctx.strokeStyle = owned ? 'rgba(187,158,96,0.4)' : 'rgba(148,146,142,0.2)';
    ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    drawGameIcon(ctx, sku.kind === 'consumable' ? 'blood' : sku.kind === 'title' ? 'relic' : 'shield', cx + 17, cy + cellH / 2, short ? 14 : 17, owned ? '#d3b16c' : '#aaa9a1');
    ctx.textAlign = 'left';
    fieldFit(ctx, sku.name, cx + 33, cy + cellH * 0.36, cellW - (short ? 88 : 98), short ? 7.5 : 10, SANS, '#e3d9c6', 600);
    const status = owned ? 'OWNED' : !offered ? 'NOT YET OFFERED' : `◆ ${sku.shardPrice}`;
    fieldFit(ctx, status, cx + 33, cy + cellH * 0.69, cellW - (short ? 88 : 98), short ? 6.8 : 8.5, MONO, offered ? 'rgba(190,170,125,0.77)' : 'rgba(155,151,141,0.55)', 400);
    const actionY = cy + cellH / 2 - 15;
    fieldIconButton(game, ctx, cx + cellW - 69, actionY, 30, 'shop', () => game.purchaseSku(sku.id), { disabled: !available || IAP.busy === sku.id });
    fieldIconButton(game, ctx, cx + cellW - 35, actionY, 30, 'shard', () => game.buySkuWithShards(sku.id), { disabled: !canBuy });
  });
  ctx.restore();
}

function drawFieldSettings(game, ctx, x, y, w, h, short) {
  const settings = game.save.settings;
  const rows = [
    { label: 'MASTER VOLUME', key: 'master', type: 'range' },
    { label: 'MUSIC', key: 'music', type: 'range' },
    { label: 'SOUND EFFECTS', key: 'sfx', type: 'range' },
    { label: 'CAMERA SHAKE', key: 'shake', type: 'toggle' },
    { label: 'FLASH EFFECTS', key: 'flashes', type: 'toggle' },
    { label: 'CAPTIONS', key: 'captions', type: 'toggle' },
    { label: 'DIFFICULTY', key: 'difficulty', type: 'difficulty' },
  ];
  const gap = short ? 4 : 7;
  const rowH = Math.max(24, (h - gap * (rows.length - 1)) / rows.length);
  rows.forEach((row, i) => {
    const ry = y + i * (rowH + gap);
    ctx.fillStyle = 'rgba(15,18,24,0.82)'; ctx.fillRect(x, ry, w, rowH);
    ctx.strokeStyle = 'rgba(150,145,133,0.2)'; ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rowH - 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fieldFit(ctx, row.label, x + 12, ry + rowH / 2, w * 0.33, short ? 8.5 : 10, SANS, 'rgba(202,195,178,0.82)', 600);
    if (row.type === 'range') {
      const value = clamp(Number(settings[row.key]) || 0, 0, 1);
      const trackX = x + w * 0.42, trackW = w * 0.39, trackY = ry + rowH / 2;
      ctx.fillStyle = 'rgba(124,119,109,0.3)'; ctx.fillRect(trackX, trackY - 2, trackW, 4);
      ctx.fillStyle = '#ac8547'; ctx.fillRect(trackX, trackY - 2, trackW * value, 4);
      ctx.fillStyle = '#e0d2b4'; ctx.fillRect(trackX + trackW * value - 2, trackY - 5, 4, 10);
      ctx.textAlign = 'right'; ctx.font = `400 ${short ? 8 : 9}px ${MONO}`; ctx.fillStyle = '#ddd3c1';
      ctx.fillText(`${Math.round(value * 100)}%`, x + w - 82, trackY);
      const rect = { x: trackX - 4, y: trackY - 12, w: trackW + 8, h: 24 };
      const idx = game.ui.length;
      game.ui.push({ ...rect, slider: { key: row.key, min: 0, max: 1, x: trackX, w: trackW }, idx });
      const input = game.input;
      if (input.mouse.down && input.mouse.x > rect.x && input.mouse.x < rect.x + rect.w && input.mouse.y > rect.y && input.mouse.y < rect.y + rect.h) {
        settings[row.key] = clamp((input.mouse.x - trackX) / trackW, 0, 1); game.applySettings();
      }
      if (game.touchAim && game.touchAim.slider && game.touchAim.slider.key === row.key) {
        settings[row.key] = clamp((game.touchAim.x - trackX) / trackW, 0, 1); game.applySettings();
      }
    } else if (row.type === 'toggle') {
      const on = !!settings[row.key];
      ctx.textAlign = 'right'; ctx.font = `400 ${short ? 8 : 9}px ${MONO}`; ctx.fillStyle = on ? '#d4bb7a' : 'rgba(165,158,145,0.65)';
      ctx.fillText(on ? 'ON' : 'OFF', x + w - 82, ry + rowH / 2);
      fieldIconButton(game, ctx, x + w - 40, ry + rowH / 2 - 14, 28, on ? 'confirm' : 'close', () => { settings[row.key] = on ? 0 : 1; game.applySettings(); });
    } else {
      const keys = Object.keys(DIFFICULTY);
      const current = keys.indexOf(settings.difficulty);
      const next = keys[(current + 1 + keys.length) % keys.length];
      const name = (DIFFICULTY[settings.difficulty] || DIFFICULTY.standard).label;
      ctx.textAlign = 'right'; ctx.font = `400 ${short ? 8 : 9}px ${MONO}`; ctx.fillStyle = '#d7c69c';
      ctx.fillText(name, x + w - 82, ry + rowH / 2);
      fieldIconButton(game, ctx, x + w - 40, ry + rowH / 2 - 14, 28, 'next', () => { settings.difficulty = next; game.applySettings(); });
    }
  });
}

function drawFieldHelp(game, ctx, x, y, w, h, short) {
  const groups = [
    { icon: 'move', title: 'MOVE', body: 'WASD / arrows · left stick' },
    { icon: 'run', title: 'RUN', body: 'Hold SHIFT · hold the boot icon' },
    { icon: 'dash', title: 'DASH', body: 'X / CTRL · dash icon' },
    { icon: 'claw', title: 'ATTACK', body: 'F · right-click · claw icon' },
    { icon: 'interact', title: 'USE', body: 'E / SPACE · doors, food, stakes' },
    { icon: 'repair', title: 'REPAIR', body: 'R · hold at a damaged entrance' },
    { icon: 'barricade', title: 'BARRICADE', body: 'B · spend planks at a doorway' },
    { icon: 'shot', title: 'WEAPON', body: 'Q cycles claw, sword, arrows, knives' },
  ];
  const cols = w > 720 ? 4 : 2;
  const gap = short ? 6 : 10;
  const rows = Math.ceil(groups.length / cols);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;
  groups.forEach((item, i) => {
    const cx = x + (i % cols) * (cellW + gap);
    const cy = y + Math.floor(i / cols) * (cellH + gap);
    ctx.fillStyle = 'rgba(15,18,25,0.83)'; ctx.fillRect(cx, cy, cellW, cellH);
    ctx.strokeStyle = 'rgba(155,150,136,0.22)'; ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    drawGameIcon(ctx, item.icon, cx + 20, cy + Math.min(cellH * 0.42, 26), short ? 17 : 20, '#c9af75');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fieldFit(ctx, item.title, cx + 38, cy + cellH * 0.32, cellW - 46, short ? 8.5 : 10, SANS, '#e0d5c0', 600);
    fieldFit(ctx, item.body, cx + 11, cy + cellH * 0.73, cellW - 20, short ? 7.2 : 9, SANS, 'rgba(182,175,161,0.77)', 400);
  });
}

function drawFieldPrivacy(game, ctx, x, y, w, h, short) {
  const ack = !!game.save.privacyAck;
  const lines = [
    '18+ horror. No account. No location, contacts or photos.',
    'Progress stays on this device until you delete it.',
    'Purchases are optional; the game never sells power or mission supplies.',
    'The full policy and data deletion page are available from this card.',
  ];
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `400 ${short ? 9 : 12}px ${SANS}`;
  ctx.fillStyle = 'rgba(217,208,189,0.86)';
  const gap = short ? 25 : 34;
  lines.forEach((line, i) => fieldFit(ctx, line, x + 12, y + 24 + i * gap, w - 24, short ? 9 : 12, SANS, 'rgba(217,208,189,0.86)', 400));
  ctx.font = `500 ${short ? 8 : 10}px ${MONO}`;
  ctx.fillStyle = ack ? '#d4bf86' : 'rgba(195,165,108,0.9)';
  ctx.fillText(ack ? 'NOTICE ACKNOWLEDGED' : 'NOTICE NOT YET ACKNOWLEDGED · REQUIRED BEFORE A PURCHASE', x + 12, y + gap * lines.length + 30);
  ctx.restore();

  const size = short ? 38 : 44;
  const by = y + h - size - 14;
  const gapX = short ? 14 : 20;
  const start = x + w / 2 - (size * 3 + gapX * 2) / 2;
  fieldIconButton(game, ctx, start, by, size, 'shield', () => {
    try { window.open('./privacy.html', '_blank', 'noopener'); } catch (e) { /* blocked */ }
  }, { active: false });
  fieldIconButton(game, ctx, start + size + gapX, by, size, 'confirm', () => {
    if (ack) return;
    game.acceptPrivacy();
  }, { disabled: ack, active: !ack });
  fieldIconButton(game, ctx, start + (size + gapX) * 2, by, size, game.privacyDeleteArmed ? 'confirm' : 'close', () => {
    if (!game.privacyDeleteArmed) {
      game.privacyDeleteArmed = true;
      game.showMessage('TAP DELETE AGAIN TO WIPE THIS DEVICE.', { tone: 'cold', life: 3 });
    } else game.wipeLocalData();
  }, { active: !!game.privacyDeleteArmed });
}

export function drawFieldCard(game, ctx, w, h) {
  const tab = FIELD_TABS.find((entry) => entry.id === game.uiPanel) || FIELD_TABS[0];
  const short = h < 500;
  const cardW = Math.min(960, w - 20);
  const cardH = Math.min(700, h - 20);
  const x = (w - cardW) / 2;
  const y = (h - cardH) / 2;
  game._fieldCardBounds = { x, y, w: cardW, h: cardH };

  ctx.save();
  ctx.fillStyle = 'rgba(2,3,7,0.68)';
  ctx.fillRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
  bg.addColorStop(0, 'rgba(14,17,23,0.98)');
  bg.addColorStop(0.55, 'rgba(8,11,17,0.97)');
  bg.addColorStop(1, 'rgba(13,13,19,0.98)');
  ctx.fillStyle = bg; ctx.fillRect(x, y, cardW, cardH);
  ctx.strokeStyle = 'rgba(186,154,94,0.66)'; ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);
  ctx.fillStyle = 'rgba(164,117,57,0.72)'; ctx.fillRect(x + 1, y + 1, 3, cardH - 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  fieldFit(ctx, tab.title, x + 18, y + (short ? 20 : 24), cardW - 80, short ? 13 : 17, SANS, '#eee3d0', 600);
  fieldFit(ctx, tab.sub, x + 18, y + (short ? 37 : 45), cardW - 82, short ? 7.5 : 8.5, MONO, 'rgba(183,171,148,0.67)', 400);
  fieldIconButton(game, ctx, x + cardW - 38, y + 8, 30, 'close', () => game.closePanel(), { round: false });

  const tabY = y + (short ? 49 : 58);
  const inner = cardW - 24;
  const n = FIELD_TABS.length;
  const gap = short ? 4 : 7;
  const tabSize = Math.min(short ? 40 : 42, Math.floor((inner - gap * (n - 1)) / n));
  const tabTotal = tabSize * n + gap * (n - 1);
  let tx = x + (cardW - tabTotal) / 2;
  FIELD_TABS.forEach((entry) => {
    fieldIconButton(game, ctx, tx, tabY, tabSize, entry.icon, () => game.openPanel(entry.id), { active: entry.id === tab.id, round: false });
    tx += tabSize + gap;
  });
  ctx.strokeStyle = 'rgba(165,146,109,0.24)';
  ctx.beginPath(); ctx.moveTo(x + 14, tabY + tabSize + 8); ctx.lineTo(x + cardW - 14, tabY + tabSize + 8); ctx.stroke();

  const bodyX = x + 16;
  const bodyY = tabY + tabSize + 20;
  const bodyW = cardW - 32;
  const bodyH = Math.max(24, y + cardH - 14 - bodyY);
  ctx.save();
  ctx.beginPath(); ctx.rect(bodyX, bodyY, bodyW, bodyH); ctx.clip();
  switch (tab.id) {
    case 'bag': drawFieldBag(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'missions': drawFieldMissions(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'upgrades': drawFieldUpgrades(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'profile': drawFieldProfile(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'collection': drawFieldCollection(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'shop': drawFieldMarket(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'settings': drawFieldSettings(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'help': drawFieldHelp(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'privacy': drawFieldPrivacy(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    default: break;
  }
  ctx.restore();
  ctx.restore();
}
