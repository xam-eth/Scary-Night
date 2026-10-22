/* DUSKHOLD — Shared kit of the survival HUD (Phase 3 split of ui/survival.js): projection, hit registration, buttons/costs, edge markers, floaters, counters, status pills, the TONIGHT chip box, zoom/recenter boxes, hint-agnostic clock/stamp helpers. */

import { clamp } from '../../core/util.js';
import { SURVIVAL_ACTOR_SCALE } from '../../core/config.js';
import { SURVIVAL_CAMERA } from '../../game/sim/survival.js';
import { pauseButtonBox } from '../hud.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel, drawCounter, drawBar, roundRectPath, INK } from '../survivalIcons.js';

export const TAU = Math.PI * 2;
const VERT = 0.8165; // screen height of one vertical world unit in the iso camera


export const BUTTON_COLORS = Object.freeze({
  green: ['#7ef08e', '#33b552', '#1d7a36'],
  blue: ['#7ab8ff', '#3b7be8', '#25509e'],
  orange: ['#ffcc66', '#ff9124', '#b4590b'],
  red: ['#ff8f80', '#e5463b', '#982520'],
  purple: ['#a596ff', '#5c49d8', '#382a90'],
  gold: ['#ffe27a', '#f0b21e', '#a8740a'],
  gray: ['#a3a8ba', '#6c7189', '#43485c'],
});

// color: each type's own colour (BUILD 11, playtest 2026-10-17: "tidak tau
// build yg mana") — the same as its kit model's roof and its circle on the
// ground (buildings3d.js BUILDING_COLOR)

export function clock(game) { return (game.survival && game.survival.uiClock) || 0; }

export function timeLabel(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export function project(game, x, y, height = 0) {
  const r = game.renderer;
  const p = r.worldToScreen(x, y);
  return { x: p.x, y: p.y - height * r.cam.zoom * VERT };
}

/** `passive` items take taps but never block the movement stick (world chips). */
export function addHit(game, box, id, onClick, disabled = false, passive = false) {
  const item = { x: box.x, y: box.y, w: box.w, h: box.h, idx: game.ui.length, label: `survival:${id}`, onClick, disabled: !!disabled, passive };
  game.ui.push(item);
  return item;
}


export function drawButton(game, ctx, box, label, onClick, opts = {}) {
  const disabled = !!opts.disabled;
  const colors = BUTTON_COLORS[disabled ? 'gray' : (opts.color || 'green')];
  const item = addHit(game, box, opts.id || label, onClick, disabled);
  const r = opts.radius == null ? Math.min(16, box.h / 2) : opts.radius;
  const focused = game.usingKeyboard && game.uiIndex === item.idx;
  ctx.save();
  roundRectPath(ctx, box.x, box.y + 4, box.w, box.h, r);
  ctx.fillStyle = colors[2];
  ctx.fill();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
  const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = focused ? 3.5 : 2.5;
  ctx.strokeStyle = focused ? '#ffffff' : INK;
  ctx.stroke();
  roundRectPath(ctx, box.x + 4, box.y + 3, box.w - 8, Math.max(4, box.h * 0.36), Math.max(2, r - 4));
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.restore();
  // BUILD 18 (R18b): a hold chip fills with light while the press sits on it
  if (opts.hold) {
    item.hold = opts.hold;
    // the hit list is rebuilt every frame, so the press progress comes from
    // the game, not from the stale item the input handler touched
    if (opts.holdT != null) item.holdT = opts.holdT;
    const t = item.holdT || 0;
    if (t > 0) {
      ctx.save();
      roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,243,196,0.32)';
      ctx.fillRect(box.x, box.y, box.w * t, box.h);
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, box.x - 2.5, box.y - 2.5, box.w + 5, box.h + 5, r + 2.5);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff3c4';
      ctx.stroke();
      ctx.restore();
    }
  }
  const size = opts.fontSize || Math.round(clamp(box.h * 0.38, 11, 20));
  const icon = opts.icon;
  const iconSize = opts.iconSize || Math.round(box.h * 0.62);
  const textW = label ? measureLabel(ctx, label, size) : 0;
  const gap = icon && label ? 6 : 0;
  const total = (icon ? iconSize : 0) + gap + textW;
  let cx = box.x + box.w / 2 - total / 2;
  const cy = box.y + box.h / 2;
  if (icon) {
    drawSurvivalIcon(ctx, icon, cx + iconSize / 2, cy, iconSize, { alpha: disabled ? 0.7 : 1 });
    cx += iconSize + gap;
  }
  if (label) drawLabel(ctx, label, cx, cy + 1, size, disabled ? '#e6e8f0' : '#ffffff', { align: 'left' });
  return item;
}

export function costRow(ctx, x, y, cost, mode, size = 16) {
  let cx = x;
  const reason = mode.affordReason(cost);
  for (const [key, icon] of [['gold', 'gold'], ['wood', 'wood']]) {
    const need = cost[key] || 0;
    if (!need) continue;
    const short = reason === key || (key === 'gold' && mode.gold < need) || (key === 'wood' && mode.wood < need);
    drawSurvivalIcon(ctx, icon, cx + size / 2, y, size);
    drawLabel(ctx, need, cx + size + 2, y + 1, Math.round(size * 0.86), short ? '#ff6b5e' : '#ffffff', { align: 'left' });
    cx += size + 6 + measureLabel(ctx, need, Math.round(size * 0.86)) + 6;
  }
  return cx - x;
}

export function costWidth(ctx, cost, size = 16) {
  let w = 0;
  for (const key of ['gold', 'wood']) {
    const need = cost && cost[key];
    if (need) w += size + 12 + measureLabel(ctx, need, Math.round(size * 0.86));
  }
  return Math.max(0, w - 6);
}

export function affordable(mode, cost) {
  return !!cost && mode.canAfford(cost);
}

/** SURVIVAL_ACTOR_SCALE (config.js): bars and badges sit over the taller bodies. */

/** SURVIVAL_ACTOR_SCALE (config.js): bars and badges sit over the taller bodies. */
export const ACTOR = SURVIVAL_ACTOR_SCALE;

/* ------------------------------------------------------------------ */
/* FTUE hint chips (once each, persisted in save.survival.hints)       */
/* ------------------------------------------------------------------ */


export function drawPauseButton(game, ctx, w, h) {
  const hit = pauseButtonBox(w, h);
  addHit(game, hit, 'PAUSE', () => { if (game.survivalCanPause()) game.togglePause(true); });
  game.ui[game.ui.length - 1].label = 'PAUSE';
  const size = 38;
  const x = hit.x + (hit.w - size) / 2;
  const y = hit.y + (hit.h - size) / 2;
  drawPanel(ctx, x, y, size, size, { radius: 12, top: '#5a62b8', bottom: '#343a7e', lineWidth: 2.2 });
  drawSurvivalIcon(ctx, 'pause', x + size / 2, y + size / 2, 20);
}


export function drawCounters(game, ctx, w, rows, gap = 36) {
  const cw = 88, ch = 30;
  const x = w - cw - 8;
  const mode = game.survival;
  const now = clock(game);
  rows.forEach((row, i) => {
    // a counter that just took income pulses (a mine's coin, a sawmill's planks)
    const fresh = (mode.hudPops || []).some((p) => p.icon === row.icon && now - p.t0 < 0.3);
    drawCounter(ctx, x, 10 + i * gap, cw, ch, row.icon, row.value, { flash: row.flash, glow: fresh, color: row.color });
  });
  drawHudPops(game, ctx, x, rows, gap, ch);
}

/**
 * Income beside the counter it lands in: "+1" with the icon of the building
 * that made it (a pickaxe-and-cart mine), sliding up and fading. The mine
 * digs while the captain holds a gate on the far side of the bailey; this is
 * how he sees it work.
 */
function drawHudPops(game, ctx, x, rows, gap, ch) {
  const mode = game.survival;
  const pops = mode.hudPops;
  if (!pops || !pops.length) return;
  const now = clock(game);
  const life = 1.2;
  for (let i = pops.length - 1; i >= 0; i--) if (now - pops[i].t0 > life || now < pops[i].t0) pops.splice(i, 1);
  const stack = {};
  for (const p of pops) {
    const row = rows.findIndex((r) => r.icon === p.icon);
    if (row < 0) continue;
    const k = stack[row] = (stack[row] || 0) + 1;
    const age = (now - p.t0) / life;
    const alpha = age < 0.15 ? age / 0.15 : age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
    const cy = 10 + row * gap + ch / 2 - age * 16 - (k - 1) * 4;
    const size = 15;
    const tw = measureLabel(ctx, p.text, size);
    const pw = tw + 44;
    const px = x - pw - 6;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawPanel(ctx, px, cy - 13, pw, 26, { radius: 13, top: '#3a2f6e', bottom: '#241c4a', lineWidth: 2, highlight: false, shadow: false });
    ctx.restore();
    drawSurvivalIcon(ctx, p.from || p.icon, px + 15, cy, 20, { alpha });
    drawLabel(ctx, p.text, px + 30 + tw / 2, cy + 1, size, p.icon === 'gold' ? '#ffd24a' : '#ffffff', { alpha, outline: 3 });
  }
}

/* ------------------------------------------------------------------ */
/* night HUD                                                           */
/* ------------------------------------------------------------------ */

/** Night progress: wave/breaker pips on a bar that ends at the sun (dawn). */

export function drawHpBar(ctx, x, y, w, h, pct) {
  const color = pct > 0.5 ? '#45d06a' : pct > 0.25 ? '#ffcc33' : '#ff4d4d';
  drawBar(ctx, x - w / 2, y - h / 2, w, h, pct, color, { lineWidth: 1.6 });
}


export function onScreen(p, w, h, pad = 0) {
  return p.x >= pad && p.x <= w - pad && p.y >= pad && p.y <= h - pad;
}

/**
 * Where an edge pointer must not sit (BUILD 14, a BUILD 13 note): the stick's
 * ring (bottom left) and the CAPTAIN chip (top middle). Set once a frame by
 * the world layers (edgeAvoid); drawEdgeMarker slides a pointer along its
 * edge until it is clear of them.
 */

/**
 * Where an edge pointer must not sit (BUILD 14, a BUILD 13 note): the stick's
 * ring (bottom left) and the CAPTAIN chip (top middle). Set once a frame by
 * the world layers (edgeAvoid); drawEdgeMarker slides a pointer along its
 * edge until it is clear of them.
 */
let EDGE_AVOID = [];
const EDGE_MARKS = [];
export function edgeAvoid(game, w, h) {
  const out = [];
  const input = game.input;
  const s = input && input.stick;
  if (s && input.gameplay) {
    const hx = s.active ? s.ox : (s.homeX || w * 0.16), hy = s.active ? s.oy : (s.homeY || h - 120);
    out.push({ kind: 'circle', x: hx, y: hy, r: (s.r || 52) + 16 });
  }
  const chip = recenterChipBox(game, w, h);
  if (chip) out.push({ kind: 'rect', ...chip });
  // BUILD 17 (R8): the day's TONIGHT chip sits in the top band, so a gate's
  // edge pointer must not land under it
  const tonight = tonightChipBox(game, w, h);
  if (tonight) out.push({ kind: 'rect', ...tonight });
  if (h < 560) {
    // BUILD 16: on a sideways phone the night's pointers run round the
    // screen's edge (nightPointerBand), past the HUD that sits on it — the
    // zoom buttons and FLARE on the right, the counters top right
    const z = zoomButtonLayout(w, h);
    out.push({ kind: 'circle', x: z.zoomIn.x, y: z.zoomIn.y, r: z.r + 4 }, { kind: 'circle', x: z.zoomOut.x, y: z.zoomOut.y, r: z.r + 4 });
    const flare = input && input.buttons && input.buttons.interact;
    if (flare && flare.r) out.push({ kind: 'circle', x: flare.x, y: flare.y, r: flare.r + 6 });
    out.push({ kind: 'rect', x: w - 104, y: 0, w: 104, h: 118 });
  }
  EDGE_AVOID = out;
  // what the pointers drew this frame (QA: survival-plotsqa §8)
  EDGE_MARKS.length = 0;
  game._edgeMarks = EDGE_MARKS;
  return out;
}

/**
 * Where the night's edge pointers run (their frame's top and bottom margins,
 * px). A tall phone keeps BUILD 9's band under the night pill and above the
 * thumbs. BUILD 16: a sideways phone's 390 px left that band 92 px tall
 * round the middle of the screen — a pointer for a gate off to the side sat
 * on the captain's head; now it runs round the edge, under the top HUD and
 * above the thumbs (the HUD on the edge itself is in edgeAvoid).
 */
export function nightPointerBand(h) {
  return h < 560 ? { top: 84, bottom: 100 } : { top: 128, bottom: 150 };
}


function edgeClear(x, y, pad = 24) {
  for (const ob of EDGE_AVOID) {
    if (ob.kind === 'circle') { if (Math.hypot(x - ob.x, y - ob.y) < ob.r + pad) return false; continue; }
    const nx = clamp(x, ob.x, ob.x + ob.w), ny = clamp(y, ob.y, ob.y + ob.h);
    if (Math.hypot(x - nx, y - ny) < pad) return false;
  }
  return true;
}


export function drawEdgeMarker(ctx, w, h, p, icon, color, top = 128, bottom = 150, count = 0) {
  const cx = w / 2, cy = (top + (h - bottom)) / 2;
  const dx = p.x - cx, dy = p.y - cy;
  const hw = w / 2 - 28, hh = (h - bottom - top) / 2 - 10;
  const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
  let x = cx + dx * k, y = cy + dy * k;
  if (!edgeClear(x, y)) {
    // slide along the edge it sits on, away from what it would cover, the
    // shorter way round (a step at a time, never past the edge's ends)
    const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
    const vertical = Math.abs(x - x0) < 0.5 || Math.abs(x - x1) < 0.5;
    let best = null;
    for (const dir of [-1, 1]) {
      for (let step = 6; step <= 360; step += 6) {
        const nx = vertical ? x : clamp(x + dir * step, x0, x1);
        const ny = vertical ? clamp(y + dir * step, y0, y1) : y;
        if (edgeClear(nx, ny)) { if (!best || step < best.step) best = { x: nx, y: ny, step }; break; }
        if ((vertical && (ny === y0 || ny === y1)) || (!vertical && (nx === x0 || nx === x1))) break;
      }
    }
    if (best) { x = best.x; y = best.y; }
  }
  const a = Math.atan2(p.y - y, p.x - x);
  EDGE_MARKS.push({ icon, x: Math.round(x), y: Math.round(y) });
  if (count > 0) {
    // how many are at that gate, on the screen-side of the pointer: the
    // number that says "go there now" (the idle loss's tip, R4)
    const label = `×${count}`;
    const size = 15;
    const bw = measureLabel(ctx, label, size) + 14;
    const bx = x - Math.cos(a) * 38 - bw / 2, by = y - Math.sin(a) * 30 - 11;
    drawPanel(ctx, bx, by, bw, 22, { radius: 11, top: '#ff6a52', bottom: '#b3261c', lineWidth: 2, highlight: false, shadow: false });
    drawLabel(ctx, label, bx + bw / 2, by + 11.5, size, '#ffffff', { outline: 2.5 });
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(30, 0); ctx.lineTo(16, -10); ctx.lineTo(16, 10); ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  drawSurvivalIcon(ctx, icon, x, y, 22);
}

/**
 * Floating numbers. A hit pops in with an overshoot, drifts aside as it
 * rises and fades; a heavy hit (ballista, Flare) is orange-rimmed; the
 * killing blow is bigger with a hot outline and a little wobble; an income
 * pop (a mine's coin, a sawmill's planks, a barracks' soldier) sits on a dark
 * pill with its icon so it reads over any floor. A damage number (BUILD 13,
 * V9) starts over the head, rides with its body, and pops again each time a
 * further hit adds into it (game/sim/survival.js pushDamageNumber), so its rise
 * and fade run on its own clock, not on its (growing) life.
 */

/**
 * Floating numbers. A hit pops in with an overshoot, drifts aside as it
 * rises and fades; a heavy hit (ballista, Flare) is orange-rimmed; the
 * killing blow is bigger with a hot outline and a little wobble; an income
 * pop (a mine's coin, a sawmill's planks, a barracks' soldier) sits on a dark
 * pill with its icon so it reads over any floor. A damage number (BUILD 13,
 * V9) starts over the head, rides with its body, and pops again each time a
 * further hit adds into it (game/sim/survival.js pushDamageNumber), so its rise
 * and fade run on its own clock, not on its (growing) life.
 */
const DMG_LANES = 3;   // steps a damage number may climb to keep clear

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The top HUD's boxes (BUILD 14, a BUILD 13 note): the pause button, the
 * phase pill, the counters (and the builder chip under them by day) and, at
 * night, the keep's bar. A damage number never climbs in under them.
 */

/**
 * The top HUD's boxes (BUILD 14, a BUILD 13 note): the pause button, the
 * phase pill, the counters (and the builder chip under them by day) and, at
 * night, the keep's bar. A damage number never climbs in under them.
 */
function hudBand(game, w, h) {
  const mode = game.survival;
  if (!(w > 0 && h > 0) || !mode) return [];
  const night = mode.phase === 'night';
  const short = h < 560;
  const out = [];
  const pause = pauseButtonBox(w, h);
  out.push({ x: 0, y: 0, w: pause.x + pause.w + 4, h: pause.y + pause.h + 4 });
  const pillW = night ? Math.min(156, w - 216) : Math.min(212, w - 216);
  out.push({ x: w / 2 - pillW / 2 - 4, y: 0, w: pillW + 8, h: 8 + (night ? 68 : 46) + 4 });
  // BUILD 17 (R8): the day's TONIGHT chip is part of the top band
  const tonight = !night ? tonightChipBox(game, w, h) : null;
  if (tonight) out.push({ x: tonight.x - 4, y: 0, w: tonight.w + 8, h: tonight.y + tonight.h + 4 });
  const gap = night ? 36 : short ? 34 : 40;
  const chip = !night && mode.builderJob ? 24 + 4 : 0;
  out.push({ x: w - 88 - 8 - 4, y: 0, w: 88 + 12, h: 10 + 2 * gap + 30 + 4 + (chip ? gap - 30 + chip : 0) });
  if (night) {
    const kw = short ? Math.min(210, w * 0.26) : Math.min(220, w - 220);
    out.push(short ? { x: 60, y: 0, w: kw + 8, h: 14 + 28 + 4 } : { x: w / 2 - kw / 2 - 4, y: 78, w: kw + 8, h: 28 + 8 });
  }
  return out;
}


export function drawFloaters(game, ctx, w = 0, h = 0) {
  const mode = game.survival;
  const band = hudBand(game, w, h);
  // Damage numbers keep clear of each other and of the captain's bar (BUILD
  // 13): a new number that would land on one already showing takes the next
  // free step up (at most DMG_LANES) and keeps that step for its life, so a
  // crowd at a gate reads as a short stack, not a pile.
  const taken = [];
  const p = game.player;
  if (p) {
    const head = project(game, p.x, p.y, 98 * ACTOR - 10);
    taken.push({ x: head.x - 42, y: head.y - 10, w: 70, h: 20 });
  }
  for (const f of mode.floaters) {
    const life = clamp(f.t / f.life, 0, 1);
    const dmg = !!f.target;
    const rise = f.kind === 'income' ? 34 : dmg ? 34 : 52;
    const riseT = dmg ? clamp(f.t / 0.9, 0, 1) : life;
    const at = project(game, f.x, f.y, f.h + (1 - (1 - riseT) * (1 - riseT)) * rise);
    at.x += (f.drift || 0) * Math.min(1, riseT * 1.6);
    if (dmg) {
      const bw = measureLabel(ctx, f.text, f.size) + 6, bh = f.size * 0.92, step = f.size * 0.95;
      const boxAt = (lane) => ({ x: at.x - bw / 2, y: at.y - lane * step - bh / 2, w: bw, h: bh });
      if (f.lane == null) {
        let lane = 0;
        while (lane < DMG_LANES && taken.some((box) => boxesOverlap(box, boxAt(lane)))) lane++;
        // a step up that would put it under the top HUD is not taken
        while (lane > 0 && band.some((box) => boxesOverlap(box, boxAt(lane)))) lane--;
        f.lane = lane;
      }
      at.y -= f.lane * step;
      // rising, it stops under the HUD's boxes instead of going in under them
      for (let pass = 0; pass < 2; pass++) {
        const hit = band.find((box) => boxesOverlap(box, boxAt(0)));
        if (hit) at.y = hit.y + hit.h + bh / 2 + 2;
      }
      taken.push(boxAt(0));
    }
    const peak = f.pop || 1.2;
    // overshoot to the peak in the first 12%, settle back to 1 by 40%
    const popT = dmg ? clamp((f.t - (f.bump || 0)) / 0.9, 0, 1) : life;
    const pop = popT < 0.12 ? 0.55 + popT / 0.12 * (peak - 0.55)
      : popT < 0.4 ? peak - (popT - 0.12) / 0.28 * (peak - 1) : 1;
    const alpha = dmg ? clamp((f.life - f.t) / 0.25, 0, 1) : life > 0.72 ? 1 - (life - 0.72) / 0.28 : 1;
    const size = Math.round(f.size * pop);
    if (f.kind === 'income') {
      const tw = measureLabel(ctx, f.text, size) + (f.icon ? size * 1.15 : 0) + 18;
      ctx.save();
      ctx.globalAlpha = alpha * 0.82;
      ctx.fillStyle = 'rgba(20,16,40,0.78)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(at.x - tw / 2, at.y - size * 0.72, tw, size * 1.44, size * 0.72);
      else ctx.rect(at.x - tw / 2, at.y - size * 0.72, tw, size * 1.44);
      ctx.fill();
      ctx.restore();
      if (f.icon) drawSurvivalIcon(ctx, f.icon, at.x - tw / 2 + 9 + size * 0.55, at.y, size * 1.1, { alpha });
      drawLabel(ctx, f.text, at.x + (f.icon ? size * 0.55 : 0), at.y + 1, size, f.color, { alpha, outline: Math.max(2, size * 0.16) });
      continue;
    }
    if (f.icon) drawSurvivalIcon(ctx, f.icon, at.x - measureLabel(ctx, f.text, f.size) / 2 - 10, at.y, f.size * 1.1, { alpha });
    const kill = f.kind === 'kill';
    const heavy = f.kind === 'heavy';
    ctx.save();
    if (kill) {
      ctx.translate(at.x, at.y);
      ctx.rotate(Math.sin(f.t * 30) * 0.08 * (1 - life));
      ctx.translate(-at.x, -at.y);
    }
    // a soft drop shadow first, so the number stands off the floor
    drawLabel(ctx, f.text, at.x + (f.icon ? 6 : 0) + 2, at.y + 3, size, 'rgba(10,6,20,0.55)', { alpha: alpha * 0.7, outline: 0 });
    drawLabel(ctx, f.text, at.x + (f.icon ? 6 : 0), at.y, size, f.color, {
      alpha, outline: Math.max(3, size * (kill ? 0.26 : heavy ? 0.24 : 0.21)), stroke: kill ? '#5a1200' : heavy ? '#4a1a00' : undefined,
    });
    ctx.restore();
  }
}


/** Hunter HP over his hat, with his level on a gold chip. */
export function drawHunterBar(game, ctx, p) {
  const mode = game.survival;
  const head = project(game, p.x, p.y, 98 * ACTOR - 10);
  drawHpBar(ctx, head.x, head.y, 50, 9, clamp(p.blood / Math.max(1, p.bloodMax), 0, 1));
  ctx.save();
  ctx.beginPath();
  ctx.arc(head.x - 31, head.y, 8.5, 0, TAU);
  ctx.fillStyle = '#ffc93a';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, `${mode.hunterLevel || 1}`, head.x - 31, head.y + 1, 11, '#3a2400', { outline: 0 });
}


export function statusPillWidth(ctx, status) {
  return measureLabel(ctx, status.text, 13) + 24 + (status.tail ? 16 : 0);
}

export function drawStatusPill(ctx, x, y, status, alpha = 1) {
  const size = 13;
  const tw = statusPillWidth(ctx, status);
  ctx.save();
  ctx.globalAlpha = alpha;
  // the building's own colour as the rim (BUILD 11): which building says it
  drawPanel(ctx, x - tw / 2, y - 11, tw, 22, { radius: 11, top: '#3b3570', bottom: '#211c45', lineWidth: status.tint ? 2.6 : 1.8, stroke: status.tint || INK, highlight: false, shadow: false });
  ctx.restore();
  drawSurvivalIcon(ctx, status.icon, x - tw / 2 + 12, y, 16, { alpha });
  drawLabel(ctx, status.text, x - tw / 2 + 22, y + 1, size, status.color, { align: 'left', outline: 0, alpha });
  if (status.tail) drawSurvivalIcon(ctx, status.tail, x + tw / 2 - 11, y, 13, { alpha });
}

/**
 * An empty circle's label, on its pad (BUILD 11): the building's icon on its
 * own colour, and when `full` its name and what it costs (red where short;
 * BUILD 13). Returns the box it covers.
 */

/**
 * BUILD 17 (R8, docs/UX-REPLAY-RESEARCH.md §5: "sifat horde per malam
 * diumumkan di senja"): the day's TONIGHT chip. The badges over the gates
 * (BUILD 13, V10) say *which* gates tonight comes at and how many; the chip
 * says it in one read, in order, before the player commits the day's build
 * to a side of the bailey — and it sits in the top band, between PAUSE and
 * the DAY pill, so it costs no world (DESIGN-SYSTEM-PLAN §8.8: the top bar
 * stays ≤ 48 px, the middle stays the world).
 * Null when it does not apply: night, a bookend, the dawn card, or a screen
 * too narrow to fit it clear of the pill (then the badges carry it alone).
 */
export function tonightChipBox(game, w, h) {
  const mode = game && game.survival;
  if (!mode || !(w > 0 && h > 0) || mode.phase !== 'day' || mode.cine) return null;
  if (typeof mode.rewardPending === 'function' && mode.rewardPending()) return null;
  const pause = pauseButtonBox(w, h);
  const pillW = Math.min(212, w - 216);
  const x = pause.x + pause.w + 8;
  const right = w / 2 - pillW / 2 - 8;
  const avail = right - x;
  if (!(avail >= 118)) return null;
  return { x, y: 8, w: avail, h: 46 };
}


/**
 * BUILD 12, the dynamic camera (SURVIVAL_CAMERA): + and - on the right edge,
 * between the counters and the thumb's corner, by day and by night — beside
 * the pinch, as Rise of Kingdoms players asked for on-screen zoom buttons.
 * A button at its end of the range dims. Where they sit: zoomButtonLayout.
 */
export function zoomButtonLayout(w, h) {
  const short = h < 560;
  const r = short ? 18 : 21;
  const x = w - (short ? 12 : 16) - r;
  const mid = Math.round(h * (short ? 0.5 : 0.48));
  const gap = short ? 22 : 26;
  return { r, x, zoomIn: { x, y: mid - gap }, zoomOut: { x, y: mid + gap } };
}


/**
 * The view has been dragged off the captain: a small chip with his face at
 * the top of the screen brings it back (so does walking, or a tap on free
 * ground).
 */
export function recenterChipBox(game, w, h) {
  const mode = game.survival;
  if (!mode || mode.cine || typeof mode.cameraOffset !== 'function' || mode.cameraOffset() < 90) return null;
  const short = h < 560;
  const bw = 96, bh = 30;
  return { x: w / 2 - bw / 2, y: short ? (mode.phase === 'night' ? 80 : 60) : (mode.phase === 'night' ? 112 : 92), w: bw, h: bh };
}


/**
 * The build this page runs (index.html's DUSKHOLD_BUILD): printed small in
 * the HUD's corner and on the pause panel, so a screenshot from a phone says
 * which build it came from (2026-10-17: the build on a playtester's screen
 * was not the build in the branch).
 */
export const BUILD = (typeof window !== 'undefined' && window.DUSKHOLD_BUILD) ? String(window.DUSKHOLD_BUILD) : 'dev';
export function drawBuildStamp(ctx, x, y, align = 'left', size = 9) {
  drawLabel(ctx, `BUILD ${BUILD}`, x, y, size, 'rgba(255,255,255,0.72)', { align, outline: 2 });
}

