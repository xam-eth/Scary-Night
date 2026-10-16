/* DUSKHOLD — Survival HUD (K1 "Benteng Terakhir"): the night HUD, the day's
 * walk-to-a-circle builder (P1), the dawn card and the end panels.
 *
 * Visual language: the "build by day, defend by night" mobile genre. Icons
 * carry the meaning (gold coin, log, soldier, the keep, skull, moon/sun),
 * text is a short outlined label or a number. Canvas is UI-only: the keep,
 * the build circles and their ghost buildings, the banner's rooms, the crowd
 * and every placed object are 3D, in World3D.
 *
 * The day has no side panel and no "+" bubbles. The Hunter walks into a
 * circle on the floor (or taps it and walks there) and ONE contextual button
 * appears in the right thumb corner — BUILD, UPGRADE, REPAIR — with a mini
 * card above it (two stats, now → next). NIGHT sits beside it.
 *
 * Interaction contract (QA relies on it):
 *   - every tappable item is pushed to game.ui with label `survival:<ID>`;
 *   - the night HUD registers only the PAUSE item (combat is the touch stick,
 *     the auto-shot and the Flare button drawn by drawSurvivalControls);
 *   - day: `survival:BUILD <type>` (the circle the Hunter stands in),
 *     `survival:UPGRADE <type> LV<n>`, `survival:UPGRADE KEEP LV<n>`,
 *     `survival:REPAIR KEEP`, `survival:UPGRADE HUNTER LV<n>`, `survival:GATE`,
 *     `survival:START NIGHT`, `survival:COLLECT`; world chips over circles are
 *     `survival:walk:<circle id>` (tap: the Hunter walks there).
 */

import { clamp, writeSave } from '../core/util.js';
import { SURVIVAL_BUILDINGS, BUILDING_MAX_LEVEL, HUNTER_MAX_LEVEL, GUARD } from '../game/survival.js';
import { pauseButtonBox } from '../game/hud.js';
import {
  drawSurvivalIcon, drawLabel, measureLabel, drawPanel, drawCounter, drawBar,
  roundRectPath, COLORS, INK,
} from './survivalIcons.js';

const TAU = Math.PI * 2;
const VERT = 0.8165; // screen height of one vertical world unit in the iso camera

const BUTTON_COLORS = Object.freeze({
  green: ['#7ef08e', '#33b552', '#1d7a36'],
  blue: ['#7ab8ff', '#3b7be8', '#25509e'],
  orange: ['#ffcc66', '#ff9124', '#b4590b'],
  red: ['#ff8f80', '#e5463b', '#982520'],
  purple: ['#a596ff', '#5c49d8', '#382a90'],
  gold: ['#ffe27a', '#f0b21e', '#a8740a'],
  gray: ['#a3a8ba', '#6c7189', '#43485c'],
});

const BUILD_META = Object.freeze({
  mine: { icon: 'mine', name: 'GOLD MINE' },      // digs gold during the night
  sawmill: { icon: 'sawmill', name: 'SAWMILL' },  // wood every dawn + door planks
  barracks: { icon: 'barracks', name: 'BARRACKS' },// houses soldiers = door guards
  tower: { icon: 'tower', name: 'BALLISTA' },     // shoots through its room's door
});

/**
 * What a building does at one level, as icon rows (main row first), each
 * with WHEN it pays: moon = during the night, sun = at dawn, instant = now.
 */
function buildingRows(mode, type, level) {
  const st = mode.buildingStats(type, level);
  if (type === 'mine') return [{ icon: 'gold', value: `+${st.yield || 0}`, when: 'moon' }];
  if (type === 'sawmill') {
    return [
      { icon: 'wood', value: `+${st.dawnWood || 0}`, when: 'sun' },
      { icon: 'planks', value: `+${Math.round((st.doorBonus || 0) * 100)}%`, when: null },
    ];
  }
  if (type === 'tower') {
    return [
      { icon: 'crossbow', value: `${st.damage || 0}`, when: null },
      { icon: 'target', value: `${st.range || 0}`, when: null },
    ];
  }
  return [{ icon: 'guard', value: `+${st.houses || 0}`, when: 'instant' }];
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function clock(game) { return (game.survival && game.survival.uiClock) || 0; }

function timeLabel(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function project(game, x, y, height = 0) {
  const r = game.renderer;
  const p = r.worldToScreen(x, y);
  return { x: p.x, y: p.y - height * r.cam.zoom * VERT };
}

/** `passive` items take taps but never block the movement stick (world chips). */
function addHit(game, box, id, onClick, disabled = false, passive = false) {
  const item = { x: box.x, y: box.y, w: box.w, h: box.h, idx: game.ui.length, label: `survival:${id}`, onClick, disabled: !!disabled, passive };
  game.ui.push(item);
  return item;
}

function drawButton(game, ctx, box, label, onClick, opts = {}) {
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

function costRow(ctx, x, y, cost, mode, size = 16) {
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

function costWidth(ctx, cost, size = 16) {
  let w = 0;
  for (const key of ['gold', 'wood']) {
    const need = cost && cost[key];
    if (need) w += size + 12 + measureLabel(ctx, need, Math.round(size * 0.86));
  }
  return Math.max(0, w - 6);
}

function affordable(mode, cost) {
  return !!cost && mode.canAfford(cost);
}

/* ------------------------------------------------------------------ */
/* FTUE hint chips (once each, persisted in save.survival.hints)       */
/* ------------------------------------------------------------------ */

const HINTS = Object.freeze({
  move: { icon: 'joystick', text: 'DRAG TO MOVE', life: 6 },
  auto: { icon: 'target', text: 'AUTO-SHOOTS IN RANGE', life: 5 },
  banner: { icon: 'banner', text: 'BLUE ROOMS: YOU HIT HARDER', life: 5.5 },
  keep: { icon: 'keep', text: 'GUARD THE KEEP', life: 5 },
  flare: { icon: 'flare', text: 'TAP FLARE TO BLAST THEM', life: 6 },
  build: { icon: 'hammer', text: 'WALK INTO A CIRCLE TO BUILD', life: 7 },
  guard: { icon: 'guard', text: 'SOLDIERS GUARD THE DOORS', life: 5 },
  door: { icon: 'door', text: 'GO TO THE DOOR: SHOOT THROUGH IT', life: 6 },
  level: { icon: 'up', text: 'STAND BY A BUILDING TO LEVEL IT UP', life: 6 },
  rescue: { icon: 'medic', text: 'STAND BY A FALLEN GUARD TO HELP', life: 6 },
});

function hintStore(game) {
  const ns = game.save.survival || (game.save.survival = {});
  if (!ns.hints || typeof ns.hints !== 'object') ns.hints = {};
  return ns.hints;
}

/** Queue a hint once. Returns true when it was newly shown. */
export function offerSurvivalHint(game, id) {
  const spec = HINTS[id];
  if (!spec) return false;
  const seen = hintStore(game);
  if (seen[id]) return false;
  const state = game._survivalHint;
  if (state && state.t < state.life) return false;
  seen[id] = 1;
  game._survivalHint = { id, t: 0, life: spec.life };
  try { writeSave(game.save); } catch (_) { /* storage blocked */ }
  return true;
}

/** Per-frame hint triggers; cheap checks only. */
export function updateSurvivalHints(game, dt) {
  const mode = game.survival;
  if (!mode) return;
  const state = game._survivalHint;
  if (state) {
    state.t += dt;
    if (state.id === 'move' && mode._movedSinceStart > 80) state.t = Math.max(state.t, state.life - 0.35);
    if (state.id === 'flare' && mode.skillCooldown > 0) state.t = Math.max(state.t, state.life - 0.35);
    if ((state.id === 'build' || state.id === 'level') && mode.builderJob) state.t = Math.max(state.t, state.life - 0.35);
    if (state.id === 'build' && mode.phase === 'day' && mode.dayContext()) state.t = Math.max(state.t, state.life - 0.35);
    if (state.id === 'rescue' && mode.guards && mode.guards.some((guard) => guard.down && guard.rescueT > 0.3)) state.t = Math.max(state.t, state.life - 0.35);
    if (state.t >= state.life) game._survivalHint = null;
  }
  if (game.screen !== 'playing') return;
  if (mode.phase === 'night' && !game.uiPanel) {
    if (mode.elapsed > 0.6) offerSurvivalHint(game, 'move');
    if (mode.currentTarget && mode.elapsed > 2) offerSurvivalHint(game, 'auto');
    if (mode.elapsed > 9) offerSurvivalHint(game, 'banner');
    if (mode.keepAttackers > 0) offerSurvivalHint(game, 'keep');
    if (mode.skillCooldown <= 0 && mode.enemiesNear(game.player.x, game.player.y, mode.tuning.skillRadius) >= 3) offerSurvivalHint(game, 'flare');
    if ((mode.nightStats.guardShots || 0) > 0 && mode.elapsed > 6) offerSurvivalHint(game, 'guard');
    if (mode.guards && mode.guards.some((guard) => guard.down)) offerSurvivalHint(game, 'rescue');
    // a door is being clawed and the Hunter has nothing to shoot: send him there
    if (mode.elapsed > 12 && !mode.currentTarget && mode.besiegedDoors().length > 0) offerSurvivalHint(game, 'door');
  } else if (mode.phase === 'day' && !mode.rewardPending()) {
    offerSurvivalHint(game, 'build');
    // once something stands (or on the last day): upgrades are where it stands
    if (hintStore(game).build && !mode.builderJob && (Object.keys(mode.buildings).length || mode.day >= 3)) offerSurvivalHint(game, 'level');
  }
}

function drawHint(game, ctx, w, y, cx = w / 2, maxW = w - 24, size = 14) {
  const state = game._survivalHint;
  if (!state) return;
  const spec = HINTS[state.id];
  if (!spec) return;
  const fadeIn = clamp(state.t / 0.25, 0, 1);
  const fadeOut = clamp((state.life - state.t) / 0.35, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;
  // shrink the label until the chip fits its slot (never overflow it)
  let textW = measureLabel(ctx, spec.text, size);
  while (size > 10 && textW + 64 > maxW) { size -= 1; textW = measureLabel(ctx, spec.text, size); }
  const bw = Math.min(maxW, textW + 64);
  const bh = 40;
  const x = cx - bw / 2;
  const yy = y + (1 - fadeIn) * -8;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPanel(ctx, x, yy, bw, bh, { radius: 20, top: 'rgba(255,255,255,0.96)', bottom: 'rgba(232,236,255,0.96)', highlight: false });
  const bob = Math.sin(clock(game) * 6) * 1.5;
  drawSurvivalIcon(ctx, spec.icon, x + 24, yy + bh / 2 + bob, 26);
  drawLabel(ctx, spec.text, x + 44, yy + bh / 2 + 1, size, '#2a2350', { align: 'left', outline: 0 });
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* shared top chrome                                                   */
/* ------------------------------------------------------------------ */

function drawPauseButton(game, ctx, w, h) {
  const hit = pauseButtonBox(w, h);
  addHit(game, hit, 'PAUSE', () => { if (game.survivalCanPause()) game.togglePause(true); });
  game.ui[game.ui.length - 1].label = 'PAUSE';
  const size = 38;
  const x = hit.x + (hit.w - size) / 2;
  const y = hit.y + (hit.h - size) / 2;
  drawPanel(ctx, x, y, size, size, { radius: 12, top: '#5a62b8', bottom: '#343a7e', lineWidth: 2.2 });
  drawSurvivalIcon(ctx, 'pause', x + size / 2, y + size / 2, 20);
}

function drawPhasePill(game, ctx, w, phase) {
  const mode = game.survival;
  const night = phase === 'night';
  const pillW = night ? Math.min(156, w - 216) : Math.min(212, w - 216);
  const pillH = night ? 68 : 46;
  const x = w / 2 - pillW / 2, y = 8;
  drawPanel(ctx, x, y, pillW, pillH, {
    radius: 22,
    top: night ? '#4a51a8' : '#ffcf6a',
    bottom: night ? '#262a66' : '#f08c2a',
  });
  drawSurvivalIcon(ctx, night ? 'moon' : 'sun', x + 24, y + 22, 32);
  if (night) {
    drawLabel(ctx, `NIGHT ${mode.day}`, x + 48, y + 13, 11, '#d6dcff', { align: 'left', outline: 2.5 });
    drawLabel(ctx, timeLabel(mode.nightDuration - mode.elapsed), x + 48, y + 30, 19, '#ffffff', { align: 'left' });
    drawTimeline(game, ctx, x + 12, y + 50, pillW - 46);
  } else {
    drawLabel(ctx, `DAY ${mode.day}`, x + 48, y + 15, 16, '#ffffff', { align: 'left' });
    drawGoalTrack(game, ctx, x + 50, y + 34, pillW - 62);
  }
}

/**
 * The goal you can see: three night pips and the reinforcements' banner at
 * the end. A survived night is filled; tonight pulses.
 */
function drawGoalTrack(game, ctx, x, y, width) {
  const mode = game.survival;
  const t = clock(game);
  const step = (width - 18) / 3;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(58,36,0,0.55)';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width - 12, y); ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const cx = x + i * step + 5;
    const done = i < mode.nightsCompleted;
    const now = i === mode.nightsCompleted;
    const r = now ? 6 + Math.sin(t * 5) * 0.8 : 5;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, y, r, 0, TAU);
    ctx.fillStyle = done ? '#45d06a' : now ? '#ffffff' : 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
  }
  drawSurvivalIcon(ctx, 'banner', x + width - 6, y - 2, 20);
}

function drawCounters(game, ctx, w, rows, gap = 36) {
  const cw = 88, ch = 30;
  const x = w - cw - 8;
  rows.forEach((row, i) => {
    drawCounter(ctx, x, 10 + i * gap, cw, ch, row.icon, row.value, { flash: row.flash, color: row.color });
  });
}

/* ------------------------------------------------------------------ */
/* night HUD                                                           */
/* ------------------------------------------------------------------ */

/** Night progress: wave/breaker pips on a bar that ends at the sun (dawn). */
function drawTimeline(game, ctx, x, y, width) {
  const mode = game.survival;
  const progress = clamp(mode.elapsed / Math.max(1, mode.nightDuration), 0, 1);
  drawBar(ctx, x, y - 5, width, 10, progress, '#ffb84a');
  for (const mark of mode.nightSchedule()) {
    const mx = x + width * mark.at;
    const breaker = mark.kind === 'breaker';
    drawSurvivalIcon(ctx, breaker ? 'breaker' : 'swarm', mx, y, breaker ? 17 : 15, { alpha: mark.done ? 1 : 0.6 });
  }
  drawSurvivalIcon(ctx, 'sun', x + width + 14, y, 20);
}

/**
 * The keep's life, under the night pill: the most important bar on screen.
 * The tower icon pulses red while something claws it; the chip is its level.
 */
function drawKeepBar(game, ctx, cx, y, width = 210) {
  const mode = game.survival;
  const t = clock(game);
  const pct = clamp(mode.keepHp / Math.max(1, mode.keepHpMax()), 0, 1);
  const state = mode.keepState();
  const danger = state === 'attacked' || state === 'critical';
  const x = cx - width / 2;
  const shake = state === 'attacked' ? Math.sin(t * 40) * 1.5 : 0;
  drawPanel(ctx, x + shake, y, width, 28, { radius: 14, top: '#2a2f62', bottom: '#1b1f45', lineWidth: 2.2, highlight: false });
  if (danger) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x + 16 + shake, y + 14, 19 + Math.sin(t * 10) * 2, 0, TAU);
    ctx.fillStyle = 'rgba(255,60,50,0.45)'; ctx.fill();
    ctx.restore();
  }
  drawSurvivalIcon(ctx, 'keep', x + 16 + shake, y + 13, 30);
  const color = pct > 0.5 ? COLORS.keep : pct > 0.25 ? '#ffb22e' : '#ff4d4d';
  drawBar(ctx, x + 36 + shake, y + 8, width - 82, 12, pct, state === 'critical' && Math.sin(t * 12) > 0 ? '#ffffff' : color, { lineWidth: 1.8 });
  drawLabel(ctx, `${Math.ceil(mode.keepHp)}`, x + 36 + (width - 82) / 2 + shake, y + 14.5, 10, '#ffffff', { outline: 2.4 });
  drawPanel(ctx, x + width - 40 + shake, y + 6, 32, 16, { radius: 8, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 1.8, highlight: false, shadow: false });
  drawLabel(ctx, `Lv${mode.keepLevel}`, x + width - 24 + shake, y + 14.5, 10, '#3a2400', { outline: 0 });
}

function drawHpBar(ctx, x, y, w, h, pct) {
  const color = pct > 0.5 ? '#45d06a' : pct > 0.25 ? '#ffcc33' : '#ff4d4d';
  drawBar(ctx, x - w / 2, y - h / 2, w, h, pct, color, { lineWidth: 1.6 });
}

function onScreen(p, w, h, pad = 0) {
  return p.x >= pad && p.x <= w - pad && p.y >= pad && p.y <= h - pad;
}

function drawEdgeMarker(ctx, w, h, p, icon, color, top = 128, bottom = 150) {
  const cx = w / 2, cy = (top + (h - bottom)) / 2;
  const dx = p.x - cx, dy = p.y - cy;
  const hw = w / 2 - 28, hh = (h - bottom - top) / 2 - 10;
  const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
  const x = cx + dx * k, y = cy + dy * k;
  const a = Math.atan2(dy, dx);
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

function drawFloaters(game, ctx) {
  const mode = game.survival;
  for (const f of mode.floaters) {
    const life = clamp(f.t / f.life, 0, 1);
    const at = project(game, f.x, f.y, f.h + life * 46);
    const peak = f.pop || 1.2;
    const pop = life < 0.15 ? 0.7 + life / 0.15 * (peak - 0.7) : peak - Math.min(peak - 1, (life - 0.15) * 0.9);
    const alpha = life > 0.7 ? 1 - (life - 0.7) / 0.3 : 1;
    if (f.icon) drawSurvivalIcon(ctx, f.icon, at.x - measureLabel(ctx, f.text, f.size) / 2 - 10, at.y, f.size * 1.1, { alpha });
    drawLabel(ctx, f.text, at.x + (f.icon ? 6 : 0), at.y, Math.round(f.size * pop), f.color, { alpha });
  }
}

function drawNightWorldLayer(game, ctx, w, h) {
  const mode = game.survival;
  const t = clock(game);
  const p = game.player;
  const zoom = game.renderer.cam.zoom;

  // Doors under siege and fresh breaches
  for (const e of game.mansion.entrances) {
    if (!e.exterior || e.kind !== 'door') continue;
    const besieged = mode.doorPressure(e.id) > 0 || (e.flash || 0) > 0.05;
    const freshBreak = e.broken && mode.breachAge(e.id) < 6;
    if (!besieged && !freshBreak) continue;
    const at = project(game, e.x, e.y, 120);
    if (onScreen(at, w, h, 20)) {
      if (freshBreak) {
        const s = 34 + Math.sin(t * 9) * 3;
        drawSurvivalIcon(ctx, 'doorBroken', at.x, at.y, s);
      } else {
        drawSurvivalIcon(ctx, 'door', at.x - 26, at.y, 24);
        drawBar(ctx, at.x - 12, at.y - 6, 52, 12, e.hp / Math.max(1, e.hpMax), e.hp / Math.max(1, e.hpMax) > 0.35 ? '#ffb22e' : '#ff4d4d');
      }
    } else if (freshBreak || mode.doorPressure(e.id) > 0) {
      drawEdgeMarker(ctx, w, h, at, freshBreak ? 'doorBroken' : 'door', freshBreak ? '#ff5a4d' : '#ffb22e');
    }
  }

  // The keep under attack: a red ring at its foot, or an edge pointer to it
  const keep = mode.keep();
  const state = mode.keepState();
  if (state === 'attacked' || state === 'critical') {
    const at = project(game, keep.x, keep.y, 40);
    if (onScreen(at, w, h, 24)) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y + 30 * zoom, (keep.r + 60) * zoom, (keep.r + 60) * zoom * 0.62, 0, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(255,60,50,${0.5 + 0.4 * Math.sin(t * 10)})`;
      ctx.stroke();
      ctx.restore();
    } else {
      drawEdgeMarker(ctx, w, h, at, 'keep', '#ff5a4d');
    }
  }

  // Enemy bars (big enemies always, swarm only once hurt)
  for (const e of game.enemies) {
    if (!e || e.dead || e.removeMe || !e._survivalType) continue;
    const big = e._survivalType !== 'swarm';
    if (!big && !(e.hp < e.hpMax)) continue;
    const height = e._survivalType === 'breaker' ? 104 : big ? 84 : 66;
    const at = project(game, e.x, e.y, height);
    if (!onScreen(at, w, h, -10)) continue;
    const bw = e._survivalType === 'breaker' ? 44 : big ? 34 : 24;
    const pct = clamp(e.hp / Math.max(1, e.hpMax), 0, 1);
    drawBar(ctx, at.x - bw / 2, at.y - 3, bw, big ? 7 : 6, pct, '#ff4d4d', { lineWidth: 1.4 });
    if (e._survivalType === 'breaker') drawSurvivalIcon(ctx, 'breaker', at.x - bw / 2 - 10, at.y, 18);
  }

  // Guards: a bar once hurt; a fallen one gets a first-aid badge (edge
  // pointer off screen) ringed by the time it has left (red, draining) or,
  // while the Hunter stands beside it, his help (green, filling)
  for (const guard of mode.guards || []) {
    if (guard.down) {
      const at = project(game, guard.x, guard.y, 84);
      if (!onScreen(at, w, h, 16)) { drawEdgeMarker(ctx, w, h, at, 'medic', '#ff5a4d'); continue; }
      const help = clamp(guard.rescueT / GUARD.rescueTime, 0, 1);
      const left = clamp(1 - guard.downT / GUARD.bleedOut, 0, 1);
      const r = 18;
      const urgent = left < 0.3;
      const bob = help > 0 ? 0 : Math.sin(t * (urgent ? 12 : 6) + guard.index) * 3;
      const foot = project(game, guard.x, guard.y, 12);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(at.x, at.y + bob + r + 3);
      ctx.lineTo(foot.x, foot.y);
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = help > 0 ? '#5ee07a' : '#ff4d4d';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y + bob, r + 4, 0, TAU);
      ctx.fillStyle = help > 0 ? 'rgba(20,40,24,0.6)' : `rgba(60,10,12,${0.5 + 0.15 * Math.sin(t * (urgent ? 14 : 8))})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(at.x, at.y + bob, r + 1, -Math.PI / 2, -Math.PI / 2 + TAU * (help > 0 ? help : left));
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = help > 0 ? '#5ee07a' : urgent && Math.sin(t * 14) > 0 ? '#ffffff' : '#ff4d4d';
      ctx.stroke();
      ctx.restore();
      drawSurvivalIcon(ctx, 'medic', at.x, at.y + bob, 26);
      continue;
    }
    if (!(guard.hp < guard.hpMax)) continue;
    const at = project(game, guard.x, guard.y, 70);
    if (!onScreen(at, w, h, -10)) continue;
    const pct = clamp(guard.hp / Math.max(1, guard.hpMax), 0, 1);
    const flash = guard.hurtFlash > 0.5 ? '#ffffff' : pct > 0.5 ? '#5ab8ff' : pct > GUARD.woundedAt ? '#ffcc33' : '#ff4d4d';
    drawBar(ctx, at.x - 14, at.y - 3, 28, 6, pct, flash, { lineWidth: 1.4 });
  }

  drawHunterBar(game, ctx, p);
  drawFloaters(game, ctx);
}

/** Hunter HP over his hat, with his level on a gold chip. */
function drawHunterBar(game, ctx, p) {
  const mode = game.survival;
  const head = project(game, p.x, p.y, 98);
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

function drawBanner(game, ctx, w, h) {
  const mode = game.survival;
  const ev = mode.currentBanner();
  if (!ev) return;
  const life = ev.life || 2;
  const t = ev.age;
  const scale = t < 0.18 ? 0.65 + (t / 0.18) * 0.35 : 1;
  const alpha = t > life - 0.35 ? clamp((life - t) / 0.35, 0, 1) : 1;
  const palette = {
    wave: ['#a35bff', '#5a2bb0'], breaker: ['#ff6a52', '#b3261c'], breach: ['#ff6a52', '#b3261c'],
    keepLow: ['#ff6a52', '#b3261c'], keep: ['#ff6a52', '#b3261c'], dawn: ['#ffd65a', '#f08c1a'],
    build: ['#6ee77f', '#259a43'], guardDown: ['#ff6a52', '#b3261c'], guardLost: ['#9a3a3a', '#4a1414'],
    night: ['#5a62b8', '#343a7e'],
  }[ev.kind] || ['#5a62b8', '#343a7e'];
  const size = 22;
  const textW = measureLabel(ctx, ev.text, size);
  const bw = Math.min(w - 30, textW + 86);
  const bh = 50;
  // a short (sideways) screen: low, between the Hunter and the thumbs, so it
  // never covers the keep bar or what stands north of the Hunter
  const y = h < 560 ? h - 150 : Math.round(h * 0.27);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, y + bh / 2);
  ctx.scale(scale, scale);
  drawPanel(ctx, -bw / 2, -bh / 2, bw, bh, { radius: 18, top: palette[0], bottom: palette[1], lineWidth: 3 });
  drawSurvivalIcon(ctx, ev.icon, -bw / 2 + 30, 0, 36);
  drawLabel(ctx, ev.text, -bw / 2 + 56, 1, size, '#ffffff', { align: 'left' });
  if (ev.sub) drawLabel(ctx, ev.sub, 0, bh / 2 + 13, 13, '#ffffff', { alpha: 0.95 });
  ctx.restore();
}

function guardCounter(mode) {
  const all = mode.guards ? mode.guards.length : 0;
  const standing = mode.standingGuards ? mode.standingGuards() : all;
  if (standing >= all) return { icon: 'guard', value: all };
  return { icon: 'guard', value: `${standing}/${all}`, color: '#ffb0a8', flash: Math.sin(clock(mode.game) * 9) > 0.6 };
}

function drawNightHud(game, ctx, w, h) {
  const mode = game.survival;
  drawNightWorldLayer(game, ctx, w, h);
  drawPauseButton(game, ctx, w, h);
  drawPhasePill(game, ctx, w, 'night');
  drawCounters(game, ctx, w, [
    { icon: 'gold', value: Math.floor(mode.gold) },
    // wood does nothing at night; the guards on the doors do (standing/all
    // once one has fallen)
    guardCounter(mode),
    { icon: 'skull', value: mode.aliveEnemies() },
  ]);
  // a sideways phone: beside the pause button, so the top-centre shows the
  // keep's battlements; a tall screen: under the night pill
  if (h < 560) drawKeepBar(game, ctx, 64 + Math.min(210, w * 0.26) / 2, 14, Math.min(210, w * 0.26));
  else drawKeepBar(game, ctx, w / 2, 82, Math.min(220, w - 220));
  drawBanner(game, ctx, w, h);
  drawHint(game, ctx, w, h < 560 ? h - 58 : 126);
}

/* ------------------------------------------------------------------ */
/* day: walk into a circle, one contextual button (P1)                 */
/* ------------------------------------------------------------------ */

/**
 * What the circle the Hunter stands in offers: the button(s) and the mini
 * card. Returns null when he stands in nothing.
 */
function dayAction(mode, here) {
  if (!here) return null;
  const busy = !!mode.builderJob;
  if (here.kind === 'keep') {
    const level = mode.keepLevel;
    const max = level >= 3;
    const cost = mode.keepUpgradeCost();
    const repair = mode.keepRepairCost();
    const hp = mode.keepHpMax(level), hpNext = mode.keepHpMax(Math.min(3, level + 1));
    const rooms = mode.territoryRooms().length;
    return {
      icon: 'keep', name: 'KEEP', level, maxLevel: 3,
      rows: [
        { icon: 'heart', now: `${hp}`, next: max ? null : `${hpNext}` },
        { icon: 'banner', now: `${rooms}`, next: max ? null : `${({ 1: 5, 2: 8, 3: 11 })[level + 1] || rooms}` },
      ],
      main: max
        ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
        : { label: 'UPGRADE', icon: 'up', id: `UPGRADE KEEP LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('keep') },
      second: repair
        ? { label: 'REPAIR', icon: 'hammer', id: 'REPAIR KEEP', cost: repair, color: 'blue', disabled: busy || !affordable(mode, repair), run: () => mode.startBuild('repair') }
        : null,
    };
  }
  if (here.kind === 'armory') {
    const level = mode.hunterLevel;
    const max = level >= HUNTER_MAX_LEVEL;
    const cost = mode.hunterUpgradeCost();
    const now = mode.hunterStats(level);
    const next = mode.hunterStats(Math.min(HUNTER_MAX_LEVEL, level + 1));
    const tag = max ? (now.fan > 1 ? '×3' : '') : next.fan > now.fan ? '×3 FAN' : next.pierce > now.pierce ? 'PIERCE' : '';
    return {
      icon: 'hunter', name: 'HUNTER', level, maxLevel: HUNTER_MAX_LEVEL, tag,
      rows: [
        { icon: 'crossbow', now: `${now.damage}`, next: max ? null : `${next.damage}` },
        { icon: 'heart', now: `${now.hp}`, next: max ? null : `${next.hp}` },
      ],
      main: max
        ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
        : { label: 'UPGRADE', icon: 'up', id: `UPGRADE HUNTER LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('hunter') },
    };
  }
  if (here.kind === 'gate') {
    const cost = mode.tuning.gateCost;
    const gate = mode.mainGate();
    return {
      icon: 'gate', name: 'BARRICADE', level: mode.gateBuilt ? 1 : 0, maxLevel: 1,
      rows: [{ icon: 'heart', now: mode.gateBuilt && gate ? `${Math.round(gate.hpMax)}` : `+${mode.tuning.gateHpBonus}`, next: null }],
      main: mode.gateBuilt
        ? { label: 'BUILT', icon: 'check', id: 'GATE BUILT', disabled: true, color: 'green' }
        : { label: 'BUILD', icon: 'hammer', id: 'GATE', cost, color: 'green', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('gate') },
    };
  }
  // a build circle
  const meta = BUILD_META[here.type] || BUILD_META.barracks;
  if (here.locked) {
    const need = mode.slotUnlockLevel(here.id);
    return {
      icon: meta.icon, name: meta.name, level: 0, maxLevel: BUILDING_MAX_LEVEL, locked: need,
      rows: buildingRows(mode, here.type, 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `KEEP Lv${need}`, icon: 'lock', id: `LOCKED ${here.type}`, disabled: true, color: 'gray' },
    };
  }
  const job = mode.builderJob;
  if (job && job.slotId === here.id) {
    // the builder is at work on this circle: the button shows his progress
    const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    return {
      icon: meta.icon, name: meta.name, level: here.built ? mode.buildingLevel(here.id) : 0, maxLevel: BUILDING_MAX_LEVEL,
      rows: buildingRows(mode, job.type, job.targetLevel || 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `BUILDING ${Math.round(pct * 100)}%`, icon: 'hammer', id: 'BUILDING', disabled: true, color: 'green' },
    };
  }
  if (!here.built) {
    const spec = SURVIVAL_BUILDINGS[here.type];
    return {
      icon: meta.icon, name: meta.name, level: 0, maxLevel: BUILDING_MAX_LEVEL,
      rows: buildingRows(mode, here.type, 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: 'BUILD', icon: 'hammer', id: `BUILD ${here.type}`, cost: spec, color: 'green', disabled: busy || !affordable(mode, spec), run: () => mode.startBuild(here.type, here.id) },
    };
  }
  const level = mode.buildingLevel(here.id);
  const max = level >= BUILDING_MAX_LEVEL;
  const cost = mode.upgradeCost(here.id);
  const nowRows = buildingRows(mode, here.built, level);
  const nextRows = max ? nowRows : buildingRows(mode, here.built, level + 1);
  return {
    icon: meta.icon, name: meta.name, level, maxLevel: BUILDING_MAX_LEVEL,
    rows: nowRows.map((row, i) => ({ icon: row.icon, now: row.value, next: max ? null : nextRows[i].value, when: row.when })),
    main: max
      ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
      : { label: 'UPGRADE', icon: 'up', id: `UPGRADE ${here.built} LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('upgrade', here.id) },
  };
}

/** Icon + verb on top, the cost underneath (red where short). */
function drawActionButton(game, ctx, box, action) {
  const mode = game.survival;
  const disabled = !!action.disabled;
  const colors = BUTTON_COLORS[disabled ? 'gray' : (action.color || 'green')];
  addHit(game, box, action.id, action.run || (() => {}), disabled);
  const r = 16;
  ctx.save();
  roundRectPath(ctx, box.x, box.y + 4, box.w, box.h, r);
  ctx.fillStyle = colors[2]; ctx.fill();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
  const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.stroke();
  roundRectPath(ctx, box.x + 4, box.y + 3, box.w - 8, Math.max(4, box.h * 0.32), Math.max(2, r - 4));
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
  ctx.restore();
  const iconSize = Math.round(box.h * 0.56);
  drawSurvivalIcon(ctx, action.icon, box.x + 12 + iconSize / 2, box.y + box.h / 2, iconSize, { alpha: disabled ? 0.75 : 1 });
  const tx = box.x + 18 + iconSize;
  if (action.cost && (action.cost.gold || action.cost.wood)) {
    drawLabel(ctx, action.label, tx, box.y + box.h * 0.32, Math.round(clamp(box.h * 0.3, 13, 19)), '#ffffff', { align: 'left' });
    costRow(ctx, tx, box.y + box.h * 0.72, action.cost, mode, Math.round(clamp(box.h * 0.27, 13, 17)));
  } else {
    drawLabel(ctx, action.label, tx, box.y + box.h / 2 + 1, Math.round(clamp(box.h * 0.32, 13, 20)), disabled ? '#eef0f6' : '#ffffff', { align: 'left' });
  }
}

/** The mini card: name, level pips, at most two stats (now → next). */
function drawMiniCard(game, ctx, box, action) {
  drawPanel(ctx, box.x, box.y, box.w, box.h, { radius: 16, top: '#3a4190', bottom: '#20244f', lineWidth: 2.6 });
  const x = box.x + 10;
  drawSurvivalIcon(ctx, action.icon, x + 14, box.y + 20, 26);
  drawLabel(ctx, action.name, x + 32, box.y + 20, 14, '#ffffff', { align: 'left' });
  // level pips (●●○) or the lock's keep level
  if (action.locked) {
    drawSurvivalIcon(ctx, 'lock', box.x + box.w - 44, box.y + 20, 18);
    drawSurvivalIcon(ctx, 'keep', box.x + box.w - 22, box.y + 20, 20);
  } else if (action.maxLevel > 1) {
    for (let i = 0; i < action.maxLevel; i++) {
      const px = box.x + box.w - 14 - (action.maxLevel - 1 - i) * 13;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, box.y + 20, 5, 0, TAU);
      ctx.fillStyle = i < action.level ? '#ffd24a' : 'rgba(255,255,255,0.25)';
      ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    }
  }
  if (action.tag) {
    const tw = measureLabel(ctx, action.tag, 10) + 12;
    drawPanel(ctx, x + 32, box.y + 30, tw, 15, { radius: 7, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 1.6, highlight: false, shadow: false });
    drawLabel(ctx, action.tag, x + 32 + tw / 2, box.y + 38, 10, '#3a2400', { outline: 0 });
  }
  const rowY0 = box.y + (action.tag ? 58 : 50);
  action.rows.slice(0, 2).forEach((row, i) => {
    const y = rowY0 + i * 24;
    drawSurvivalIcon(ctx, row.icon, x + 12, y, 22);
    const text = row.next != null ? `${row.now} → ${row.next}` : `${row.now}`;
    drawLabel(ctx, text, x + 28, y + 1, 15, row.next != null ? '#ffffff' : '#e6eaff', { align: 'left' });
    if (row.next != null) {
      // the gain in green after the arrow reads as "this is what you get"
      const before = measureLabel(ctx, `${row.now} → `, 15);
      drawLabel(ctx, `${row.next}`, x + 28 + before, y + 1, 15, '#7ef08e', { align: 'left' });
    }
    if (row.when) drawSurvivalIcon(ctx, row.when, box.x + box.w - 18, y, 18);
  });
}

/**
 * Small chips over the circles in view: the building it makes (available),
 * a lock with the keep level (beyond the banner), a gold chevron over a
 * building whose next level you can pay for. Tap one: the Hunter walks there.
 */
function drawDayWorldLayer(game, ctx, w, h, view) {
  const mode = game.survival;
  const t = clock(game);
  const p = game.player;
  const here = mode.dayContext();
  let nearestOff = null, nearestD = Infinity;
  for (const point of mode.dayPoints()) {
    if (point.kind === 'keep' || point.kind === 'armory') continue;
    if (here && here.id === point.id) continue;
    const built = point.kind === 'slot' ? !!point.built : mode.gateBuilt;
    let icon = null, chip = '#ffffff', tag = null;
    if (point.kind === 'gate') { if (built) continue; icon = 'gate'; }
    else if (point.locked) { icon = 'lock'; chip = '#c9ccd8'; tag = `Lv${mode.slotUnlockLevel(point.id)}`; }
    else if (!built) icon = (BUILD_META[point.type] || BUILD_META.barracks).icon;
    else if (point.level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(point.id))) { icon = 'up'; chip = '#fff3c4'; }
    if (!icon) continue;
    const height = point.kind === 'slot' && point.type === 'tower' ? 150 : 100;
    const at = project(game, point.x, point.y, height);
    const inView = at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1;
    if (!inView) {
      if (!point.locked && !built) {
        const d = Math.hypot(point.x - p.x, point.y - p.y);
        if (d < nearestD) { nearestD = d; nearestOff = { point, at, icon }; }
      }
      continue;
    }
    const bob = Math.sin(t * 4 + point.x * 0.01) * 2;
    const r = point.locked ? 13 : 16;
    ctx.save();
    ctx.globalAlpha = point.locked ? 0.85 : 1;
    ctx.beginPath(); ctx.arc(at.x, at.y + bob, r, 0, TAU);
    ctx.fillStyle = chip; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, icon, at.x, at.y + bob, r * 1.45);
    if (tag) {
      drawPanel(ctx, at.x - 15, at.y + bob + r - 5, 30, 14, { radius: 7, top: '#8a90a6', bottom: '#5c6278', lineWidth: 1.6, highlight: false, shadow: false });
      drawLabel(ctx, tag, at.x, at.y + bob + r + 2, 9, '#ffffff', { outline: 0 });
    }
    addHit(game, { x: at.x - 24, y: at.y + bob - 24, w: 48, h: 48 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
  }
  // nothing to build in view: one pointer to the nearest empty circle
  if (nearestOff && !here) {
    drawEdgeMarker(ctx, w, h, nearestOff.at, nearestOff.icon, '#ffffff', view.y0 + 10, h - view.y1 + 10);
  }
  // the keep shows its life by day too once it is hurt
  const keep = mode.keep();
  if (mode.keepHp < mode.keepHpMax()) {
    const at = project(game, keep.x, keep.y, 300);
    if (onScreen(at, w, h, 30)) {
      const pct = clamp(mode.keepHp / Math.max(1, mode.keepHpMax()), 0, 1);
      drawSurvivalIcon(ctx, 'keep', at.x - 44, at.y, 24);
      drawBar(ctx, at.x - 30, at.y - 6, 74, 12, pct, pct > 0.5 ? COLORS.keep : pct > 0.25 ? '#ffb22e' : '#ff4d4d', { lineWidth: 1.8 });
    }
  }
  // the job under way: a progress ring over the scaffold
  const job = mode.builderJob;
  const spot = job ? mode.jobSpot(job) : null;
  if (spot) {
    const at = project(game, spot.x, spot.y, job.kind === 'keep' || job.kind === 'repair' ? 150 : 130);
    if (onScreen(at, w, h, 20)) {
      const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
      ctx.save();
      ctx.beginPath(); ctx.arc(at.x, at.y, 20, 0, TAU);
      ctx.fillStyle = 'rgba(20,18,40,0.72)'; ctx.fill();
      ctx.beginPath(); ctx.arc(at.x, at.y, 17, -Math.PI / 2, -Math.PI / 2 + TAU * pct);
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = '#45d06a'; ctx.stroke();
      ctx.restore();
      drawSurvivalIcon(ctx, job.kind === 'hunter' ? 'up' : 'hammer', at.x, at.y, 22, { rotate: job.kind === 'hunter' ? 0 : Math.sin(t * 10) * 0.3 });
    }
  }
  drawHunterBar(game, ctx, p);
  drawFloaters(game, ctx);
}

function drawRewardModal(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.lastRewards || { gold: 0, wood: 0, kills: 0 };
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const rows = [
    { icon: 'skull', value: `${reward.kills || 0}`, color: '#3a2a50' },
    { icon: 'gold', value: `+${reward.gold || 0}`, color: '#1f8a3a' },
    { icon: 'wood', value: `+${reward.wood || 0}`, color: '#1f8a3a' },
  ];
  if (reward.mined) rows.push({ icon: 'mine', value: `+${reward.mined}`, color: '#1f8a3a' });   // dug overnight
  if (reward.survivors > 0) rows.push({ icon: 'guard', value: `+${reward.survivors}`, color: '#1f8a3a' });
  if (reward.keepDamage) rows.push({ icon: 'keep', value: `-${reward.keepDamage}`, color: '#d23a2a' });
  if (reward.keepPatched) rows.push({ icon: 'hammer', value: `+${reward.keepPatched}`, color: '#1f8a3a' });
  // a guard nobody helped up by dawn: one soldier fewer
  if (reward.lost) rows.push({ icon: 'guard', value: `-${reward.lost}`, color: '#d23a2a' });
  const cols = 2;
  const short = h < 560;
  const cellH = short ? 36 : 44;
  const gap = short ? 6 : 8;
  const bw = Math.min(short ? 420 : 330, w - 32);
  const cols2 = short ? 3 : cols;
  const bh = (short ? 84 : 92) + Math.ceil(rows.length / cols2) * (cellH + gap) + 34 + (short ? 62 : 74);
  const x = (w - bw) / 2, y = Math.max(28, (h - bh) / 2 + 10);
  const t = clock(game);
  ctx.save();
  ctx.translate(w / 2, y + 4);
  ctx.rotate(t * 0.3);
  ctx.fillStyle = 'rgba(255,214,90,0.28)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14, -120); ctx.lineTo(14, -120); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  drawPanel(ctx, x, y, bw, bh, { radius: 22, top: '#fff6e0', bottom: '#ffdca0', lineWidth: 3 });
  drawSurvivalIcon(ctx, 'sun', w / 2, y + 2, short ? 60 : 76);
  drawLabel(ctx, `NIGHT ${Math.max(1, mode.nightsCompleted)} SURVIVED!`, w / 2, y + (short ? 50 : 62), short ? 18 : 20, '#ffffff', { stroke: '#7a3a00' });
  const cellW = (bw - 40) / cols2;
  const top = y + (short ? 72 : 92);
  rows.forEach((row, i) => {
    const cx = x + 20 + (i % cols2) * cellW;
    const cy = top + Math.floor(i / cols2) * (cellH + gap);
    drawPanel(ctx, cx + 4, cy, cellW - 8, cellH, { radius: 14, top: '#ffffff', bottom: '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + 26, cy + cellH / 2, short ? 24 : 30);
    drawLabel(ctx, row.value, cx + 46, cy + cellH / 2 + 1, short ? 17 : 20, row.color, { align: 'left', outline: 0 });
  });
  // the goal, one night closer
  const left = reward.reinforcements != null ? reward.reinforcements : Math.max(0, 3 - mode.nightsCompleted);
  const gy = top + Math.ceil(rows.length / cols2) * (cellH + gap) + 12;
  drawSurvivalIcon(ctx, 'banner', w / 2 - 70, gy, 24);
  drawLabel(ctx, left > 0 ? `REINFORCEMENTS IN ${left}` : 'REINFORCEMENTS AT DAWN', w / 2 - 54, gy + 1, 13, '#3a2a50', { align: 'left', outline: 0 });
  drawButton(game, ctx, { x: x + 40, y: y + bh - (short ? 58 : 66), w: bw - 80, h: short ? 44 : 50 }, 'COLLECT',
    () => mode.ackRewards(), { id: 'COLLECT', icon: 'check', color: 'green' });
}

function drawDayScreen(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.rewardPending();
  const short = h < 560;
  const pad = 12;
  // the thumb corner: the contextual button, NIGHT beside it, the card above
  const btnH = short ? 56 : 62;
  const btnW = Math.min(short ? 210 : 230, Math.round(w * 0.42));
  const btnX = w - pad - btnW;
  const btnY = h - pad - btnH;
  const nightW = Math.min(short ? 148 : 160, Math.round(w * 0.3));
  const nightX = btnX - 10 - nightW;
  const view = { x0: 30, x1: w - 30, y0: short ? 70 : 128, y1: btnY - 10 };

  if (!reward) drawDayWorldLayer(game, ctx, w, h, view);

  // the dawn reward is modal: no pause button underneath it
  if (!reward) drawPauseButton(game, ctx, w, h);
  drawPhasePill(game, ctx, w, 'day');
  drawCounters(game, ctx, w, [
    { icon: 'gold', value: Math.floor(mode.gold) },
    { icon: 'wood', value: Math.floor(mode.wood) },
    { icon: 'guard', value: mode.survivors },
  ], short ? 36 : 42);
  // the builder: a small chip while he works (no READY pill when idle)
  const job = mode.builderJob;
  if (job && !reward) {
    const cw = 88, cx = w - cw - 8, cy = 10 + 3 * (short ? 36 : 42);
    drawPanel(ctx, cx, cy, cw, 26, { radius: 13, top: '#4a51a8', bottom: '#262a66', lineWidth: 2 });
    drawSurvivalIcon(ctx, job.kind === 'hunter' ? 'hunter' : 'hammer', cx + 14, cy + 13, 20, { rotate: job.kind === 'hunter' ? 0 : Math.sin(clock(game) * 10) * 0.3 });
    drawBar(ctx, cx + 28, cy + 8, cw - 36, 10, 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1), '#45d06a');
  }

  if (reward) {
    drawRewardModal(game, ctx, w, h);
    return;
  }

  const here = mode.dayContext();
  const action = dayAction(mode, here);
  if (action) {
    const card = { w: Math.min(btnW, 232), h: action.tag ? 108 : 100 };
    card.x = w - pad - card.w;
    card.y = btnY - 10 - card.h;
    drawMiniCard(game, ctx, card, action);
    drawActionButton(game, ctx, { x: btnX, y: btnY, w: btnW, h: btnH }, action.main);
    if (action.second) {
      const sw = Math.min(150, nightW);
      drawActionButton(game, ctx, { x: nightX, y: btnY - btnH - 10, w: sw, h: btnH }, action.second);
    }
  }
  drawButton(game, ctx, { x: nightX, y: btnY + (btnH - 50), w: nightW, h: 50 }, `NIGHT ${mode.day}`,
    () => mode.startNight(), { id: 'START NIGHT', icon: 'moon', color: 'purple', disabled: !!job });

  // FTUE chip: a sideways phone puts it at the foot of the screen between the
  // stick and NIGHT (the top band shows the keep); a tall screen under the pill
  if (short) {
    const left = 150, right = nightX - 10;
    drawHint(game, ctx, w, h - pad - 44, (left + right) / 2, right - left, 13);
  } else drawHint(game, ctx, w, 136, w / 2, Math.min(w - 24, 420));
}

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

function drawPausePanel(game, ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const bw = Math.min(300, w - 32), bh = 230;
  const x = (w - bw) / 2, y = (h - bh) / 2;
  drawPanel(ctx, x, y, bw, bh, { radius: 22, top: '#3a4190', bottom: '#20244f', lineWidth: 3 });
  drawSurvivalIcon(ctx, 'pause', w / 2, y + 36, 34);
  drawLabel(ctx, 'PAUSED', w / 2, y + 74, 22, '#ffffff');
  drawButton(game, ctx, { x: x + 28, y: y + 100, w: bw - 56, h: 50 }, 'RESUME',
    () => game.resumeSurvival(), { id: 'RESUME', icon: 'play', color: 'green' });
  drawButton(game, ctx, { x: x + 28, y: y + 162, w: bw - 56, h: 44 }, 'RESTART',
    () => game.survival.restart(), { id: 'RESTART 3-DAY RUN', icon: 'restart', color: 'red' });
}

function drawEndPanel(game, ctx, w, h, failed) {
  const mode = game.survival;
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.66)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const bw = Math.min(330, w - 32), bh = 262;
  const x = (w - bw) / 2, y = (h - bh) / 2 + 12;
  drawPanel(ctx, x, y, bw, bh, failed
    ? { radius: 22, top: '#4a3a6a', bottom: '#241a3a', lineWidth: 3 }
    : { radius: 22, top: '#fff6e0', bottom: '#ffd890', lineWidth: 3 });
  const reason = String(mode.failureReason || '');
  const keepFell = /KEEP/i.test(reason);
  const icon = failed ? (keepFell ? 'keep' : 'skull') : 'trophy';
  drawSurvivalIcon(ctx, icon, w / 2, y + 4, 78, { gray: failed && keepFell });
  const title = failed ? (keepFell ? 'THE KEEP FELL' : 'THE HUNTER FELL') : 'REINFORCEMENTS ARRIVED!';
  drawLabel(ctx, title, w / 2, y + 66, 21, '#ffffff', { stroke: failed ? INK : '#7a3a00' });
  const stats = [
    { icon: 'moon', value: failed ? `${mode.day}` : '3' },
    { icon: 'skull', value: `${(mode.nightStats && mode.nightStats.kills) || 0}` },
    { icon: 'keep', value: `Lv${mode.keepLevel}` },
  ];
  const cellW = (bw - 40) / 3;
  stats.forEach((row, i) => {
    const cx = x + 20 + i * cellW;
    const cy = y + 96;
    drawPanel(ctx, cx + 4, cy, cellW - 8, 64, { radius: 14, top: failed ? '#5a4a80' : '#ffffff', bottom: failed ? '#3a2d5a' : '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + cellW / 2, cy + 22, 28);
    drawLabel(ctx, row.value, cx + cellW / 2, cy + 48, 16, failed ? '#ffffff' : '#3a2a50', { outline: failed ? 3 : 0 });
  });
  drawButton(game, ctx, { x: x + 30, y: y + bh - 76, w: bw - 60, h: 54 }, 'PLAY AGAIN',
    () => mode.restart(), { id: 'PLAY AGAIN', icon: 'restart', color: 'green' });
}

/* ------------------------------------------------------------------ */
/* touch controls (survival skin)                                      */
/* ------------------------------------------------------------------ */

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

export function drawSurvivalScreen(game, ctx, w, h, worldReady = true) {
  game.ui.length = 0;
  if (!worldReady) {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a4190');
    g.addColorStop(1, '#1b1f3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    drawSurvivalIcon(ctx, 'keep', w / 2, h / 2 - 30, 70);
    drawLabel(ctx, 'RAISING THE KEEP…', w / 2, h / 2 + 30, 15, '#ffffff');
    return;
  }
  if (game.screen === 'paused') {
    drawPausePanel(game, ctx, w, h);
    return;
  }
  const phase = game.survival.phase;
  if (phase === 'day') { drawDayScreen(game, ctx, w, h); return; }
  if (phase === 'complete') { drawEndPanel(game, ctx, w, h, false); return; }
  if (phase === 'failed') { drawEndPanel(game, ctx, w, h, true); return; }
  drawNightHud(game, ctx, w, h);
}

export { COLORS };
