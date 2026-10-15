/* DUSKHOLD — Survival HUD, day builder, rewards and controls.
 *
 * Visual language: the "build by day, defend by night" mobile genre. Icons
 * carry the meaning (oil drop, log, survivor, flame, skull, moon/sun), text is
 * a short outlined label or a number. Canvas is UI-only; the mansion, the
 * crowd and every placed object stay in World3D.
 *
 * Interaction contract (QA relies on it):
 *   - every tappable item is pushed to game.ui with label `survival:<ID>`;
 *   - the night HUD registers only the PAUSE item (combat is the touch stick,
 *     the auto-shot and the Flare button drawn by drawSurvivalControls);
 *   - the Perapian upgrade button keeps the `survival:UPGRADE…` prefix;
 *     building levels are `survival:UPGRADE <type> LV<n>` and the Hunter's
 *     track `survival:UPGRADE HUNTER LV<n>` (bubble `survival:select:hunter`).
 */

import { clamp, writeSave } from '../core/util.js';
import { SURVIVAL_BUILDINGS, BUILDING_MAX_LEVEL, HUNTER_MAX_LEVEL, GUARD, daySideColumn } from '../game/survival.js';
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
  gray: ['#a3a8ba', '#6c7189', '#43485c'],
});

const BUILD_ORDER = ['extractor', 'sawmill', 'shelter', 'tower'];
const BUILD_META = Object.freeze({
  extractor: { icon: 'extractor', name: 'OIL PUMP', out: 'oil' },     // pumped during the night
  sawmill: { icon: 'sawmill', name: 'SAWMILL', out: 'wood' },        // every dawn + door planks
  shelter: { icon: 'shelter', name: 'SHELTER', out: 'guard' },       // houses survivors = door guards
  tower: { icon: 'tower', name: 'TOWER', out: 'damage' },            // shoots through its room's door
});

/**
 * What a building does at one level, as icon rows (main row first). The
 * sheet shows `now → next`; build cards show the main row at Lv1.
 */
function buildingRows(mode, type, level) {
  const st = mode.buildingStats(type, level);
  if (type === 'extractor') return [{ icon: 'oil', value: `+${st.pump || 0}`, label: 'EVERY NIGHT' }];
  if (type === 'sawmill') {
    return [
      { icon: 'wood', value: `+${st.dawnWood || 0}`, label: 'EVERY DAWN' },
      { icon: 'planks', value: `+${Math.round((st.doorBonus || 0) * 100)}%`, label: 'DOOR HP' },
    ];
  }
  if (type === 'tower') {
    return [
      { icon: 'crossbow', value: `${st.damage || 0}`, label: 'BOLT DAMAGE' },
      { icon: 'target', value: `${st.range || 0}`, label: 'RANGE' },
    ];
  }
  return [{ icon: 'guard', value: `+${st.houses || 0}`, label: 'GUARDS' }];
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

function addHit(game, box, id, onClick, disabled = false) {
  const item = { x: box.x, y: box.y, w: box.w, h: box.h, idx: game.ui.length, label: `survival:${id}`, onClick, disabled: !!disabled };
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
  for (const [key, icon] of [['oil', 'oil'], ['wood', 'wood']]) {
    const need = cost[key] || 0;
    if (!need) continue;
    const short = reason === key;
    const reserve = key === 'oil' && reason === 'reserve';
    drawSurvivalIcon(ctx, icon, cx + size / 2, y, size);
    drawLabel(ctx, need, cx + size + 2, y + 1, Math.round(size * 0.86), short ? '#ff6b5e' : reserve ? '#ffb347' : '#ffffff', { align: 'left' });
    cx += size + 6 + measureLabel(ctx, need, Math.round(size * 0.86)) + 6;
  }
  return cx - x;
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
  light: { icon: 'fire', text: 'STAY IN THE FIRELIGHT', life: 5.5 },
  fire: { icon: 'perapian', text: 'GUARD THE PERAPIAN', life: 5 },
  flare: { icon: 'flare', text: 'TAP FLARE TO BLAST THEM', life: 6 },
  build: { icon: 'hammer', text: 'TAP + TO BUILD IN LIT ROOMS', life: 7 },
  guard: { icon: 'guard', text: 'SURVIVORS GUARD THE DOORS', life: 5 },
  door: { icon: 'door', text: 'GO TO THE DOOR: SHOOT THROUGH IT', life: 6 },
  level: { icon: 'up', text: 'TAP A GREEN ARROW TO LEVEL UP', life: 6 },
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
    if (state.id === 'rescue' && mode.guards && mode.guards.some((guard) => guard.down && guard.rescueT > 0.3)) state.t = Math.max(state.t, state.life - 0.35);
    if (state.t >= state.life) game._survivalHint = null;
  }
  if (game.screen !== 'playing') return;
  if (mode.phase === 'night' && !game.uiPanel) {
    if (mode.elapsed > 0.6) offerSurvivalHint(game, 'move');
    if (mode.currentTarget && mode.elapsed > 2) offerSurvivalHint(game, 'auto');
    if (mode.elapsed > 9 && !mode.isLit(game.player.x, game.player.y)) offerSurvivalHint(game, 'light');
    else if (mode.elapsed > 16) offerSurvivalHint(game, 'light');
    if (mode.hearthFeeders > 0) offerSurvivalHint(game, 'fire');
    if (mode.skillCooldown <= 0 && mode.enemiesNear(game.player.x, game.player.y, mode.tuning.skillRadius) >= 3) offerSurvivalHint(game, 'flare');
    if ((mode.nightStats.guardShots || 0) > 0 && mode.elapsed > 6) offerSurvivalHint(game, 'guard');
    if (mode.guards && mode.guards.some((guard) => guard.down)) offerSurvivalHint(game, 'rescue');
    // a door is being clawed and the Hunter has nothing to shoot: send him there
    if (mode.elapsed > 12 && !mode.currentTarget && mode.besiegedDoors().length > 0) offerSurvivalHint(game, 'door');
  } else if (mode.phase === 'day' && !mode.rewardPending()) {
    offerSurvivalHint(game, 'build');
    // once something stands (or on the last day), point at the level-up arrows
    if (hintStore(game).build && !mode.builderJob && (Object.keys(mode.buildings).length || mode.day >= 3)) offerSurvivalHint(game, 'level');
  }
}

function drawHint(game, ctx, w, y, cx = w / 2, maxW = w - 24) {
  const state = game._survivalHint;
  if (!state) return;
  const spec = HINTS[state.id];
  if (!spec) return;
  const fadeIn = clamp(state.t / 0.25, 0, 1);
  const fadeOut = clamp((state.life - state.t) / 0.35, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;
  const size = 14;
  const textW = measureLabel(ctx, spec.text, size);
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
  const pillW = Math.min(156, w - 216), pillH = night ? 68 : 44;
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
    drawLabel(ctx, `DAY ${mode.day}`, x + 48, y + 16, 17, '#ffffff', { align: 'left' });
    drawLabel(ctx, 'BUILD', x + 49, y + 33, 11, '#fff3d6', { align: 'left', outline: 2.5 });
  }
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

function drawHearthBadge(game, ctx, x, y) {
  const mode = game.survival;
  const t = clock(game);
  const base = mode.tuning.perapianRadius[mode.perapianLevel] || 1;
  const pct = clamp(mode.getFireRadius() / base, 0, 1);
  const danger = mode.hearthFeeders > 0;
  const r = 23;
  ctx.save();
  if (danger) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6 + Math.sin(t * 10) * 2, 0, TAU);
    ctx.fillStyle = 'rgba(255,60,50,0.45)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = '#2a2350';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - 4, -Math.PI / 2, -Math.PI / 2 + TAU * pct);
  ctx.lineWidth = 5;
  ctx.strokeStyle = pct > 0.35 ? '#ffb22e' : '#ff4d4d';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
  drawSurvivalIcon(ctx, 'fire', x, y - 1, 26);
  drawPanel(ctx, x - 17, y + r - 6, 34, 15, { radius: 7, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 2, highlight: false, shadow: false });
  drawLabel(ctx, `Lv${mode.perapianLevel}`, x, y + r + 2, 10, '#3a2400', { outline: 0 });
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

  // The Perapian's fuel is its life bar: the thing to protect, on the thing.
  const fire = mode.hearth();
  if (fire) {
    const at = project(game, fire.x, fire.y, 190);
    if (onScreen(at, w, h, 30)) {
      const full = Math.max(1, mode.nightOilStart || Math.max(mode.oil, mode.oilReserveForNight()));
      const pct = clamp(mode.oil / full, 0, 1);
      const bw = 78, bh = 14;
      const danger = mode.hearthFeeders > 0;
      const shake = danger ? Math.sin(t * 40) * 1.5 : 0;
      drawBar(ctx, at.x - bw / 2 + 10 + shake, at.y - bh / 2, bw, bh, pct, pct > 0.35 ? '#ffb22e' : '#ff4d4d', { lineWidth: 2 });
      drawSurvivalIcon(ctx, 'fire', at.x - bw / 2 - 4 + shake, at.y - 2, 30);
    }
  }

  // Hearth under attack
  if (fire && mode.hearthFeeders > 0) {
    const at = project(game, fire.x, fire.y, 60);
    if (onScreen(at, w, h, 24)) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y + 40 * zoom, 120 * zoom, 70 * zoom, 0, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(255,60,50,${0.5 + 0.4 * Math.sin(t * 10)})`;
      ctx.stroke();
      ctx.restore();
      drawSurvivalIcon(ctx, 'warning', at.x, at.y - 30 + Math.sin(t * 8) * 3, 34);
    } else {
      drawEdgeMarker(ctx, w, h, at, 'fire', '#ff5a4d');
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
      // high enough that the pawn lying on its red ring stays visible below
      const at = project(game, guard.x, guard.y, 84);
      if (!onScreen(at, w, h, 16)) { drawEdgeMarker(ctx, w, h, at, 'medic', '#ff5a4d'); continue; }
      const help = clamp(guard.rescueT / GUARD.rescueTime, 0, 1);
      const left = clamp(1 - guard.downT / GUARD.bleedOut, 0, 1);
      const r = 18;
      const urgent = left < 0.3;
      const bob = help > 0 ? 0 : Math.sin(t * (urgent ? 12 : 6) + guard.index) * 3;
      // a pin from the badge down to the pawn on the floor
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

  // Hunter HP, with his level on a gold chip
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

  // Floating combat numbers
  for (const f of mode.floaters) {
    const life = clamp(f.t / f.life, 0, 1);
    const at = project(game, f.x, f.y, f.h + life * 46);
    const pop = life < 0.15 ? 0.7 + life / 0.15 * 0.5 : 1.2 - Math.min(0.2, (life - 0.15) * 0.4);
    const alpha = life > 0.7 ? 1 - (life - 0.7) / 0.3 : 1;
    if (f.icon) drawSurvivalIcon(ctx, f.icon, at.x - measureLabel(ctx, f.text, f.size) / 2 - 10, at.y, f.size * 1.1, { alpha });
    drawLabel(ctx, f.text, at.x + (f.icon ? 6 : 0), at.y, Math.round(f.size * pop), f.color, { alpha });
  }
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
    fireLow: ['#ffb43a', '#d0600c'], hearth: ['#ff6a52', '#b3261c'], dawn: ['#ffd65a', '#f08c1a'],
    build: ['#6ee77f', '#259a43'], guardDown: ['#ff6a52', '#b3261c'], guardLost: ['#9a3a3a', '#4a1414'],
  }[ev.kind] || ['#5a62b8', '#343a7e'];
  const size = 22;
  const textW = measureLabel(ctx, ev.text, size);
  const bw = Math.min(w - 30, textW + 86);
  const bh = 54;
  // short (landscape) screens: right under the night pill, so the banner never
  // sits on the Hunter in the middle of the frame (the FTUE chip moves to the
  // bottom edge there, between the stick and the Flare button)
  const y = h < 560 ? 84 : Math.round(h * 0.27);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, y + bh / 2);
  ctx.scale(scale, scale);
  drawPanel(ctx, -bw / 2, -bh / 2, bw, bh, { radius: 18, top: palette[0], bottom: palette[1], lineWidth: 3 });
  drawSurvivalIcon(ctx, ev.icon, -bw / 2 + 32, 0, 40);
  drawLabel(ctx, ev.text, -bw / 2 + 60, 1, size, '#ffffff', { align: 'left' });
  if (ev.sub) drawLabel(ctx, ev.sub, 0, bh / 2 + 14, 13, '#ffffff', { alpha: 0.95 });
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
  const lowOil = mode.oil < mode.oilReserveForNight() * 0.5;
  const blink = Math.sin(clock(game) * 9) > 0;
  drawCounters(game, ctx, w, [
    { icon: 'oil', value: Math.floor(mode.oil), flash: lowOil && blink, color: lowOil ? '#ffb0a8' : '#ffffff' },
    // wood does nothing at night; the guards on the doors do (standing/all
    // once one has fallen)
    guardCounter(mode),
    { icon: 'skull', value: mode.aliveEnemies() },
  ]);
  drawHearthBadge(game, ctx, 30, 86);
  drawBanner(game, ctx, w, h);
  drawHint(game, ctx, w, h < 560 ? h - 58 : 126);
}

/* ------------------------------------------------------------------ */
/* day builder                                                         */
/* ------------------------------------------------------------------ */

function dayTargets(game) {
  const mode = game.survival;
  const out = [];
  const fire = mode.hearth();
  if (fire) {
    const cost = mode.buildingCost('perapian');
    out.push({
      key: 'perapian', icon: 'perapian', x: fire.x, y: fire.y, height: 150,
      badge: `Lv${mode.perapianLevel}`, up: mode.perapianLevel < 3 && affordable(mode, cost),
    });
  }
  const gate = mode.mainGate();
  if (gate) {
    out.push({
      key: 'gate', icon: 'gate', x: gate.x, y: gate.y, height: 140,
      badge: mode.gateBuilt ? 'Lv1' : null, up: !mode.gateBuilt && affordable(mode, mode.tuning.gateCost),
    });
  }
  // The Hunter is upgraded like a building: a bubble over his head.
  const p = game.player;
  if (p) {
    const hunterJob = mode.builderJob && mode.builderJob.kind === 'hunter' ? mode.builderJob : null;
    out.push({
      key: 'hunter', icon: 'hunter', x: p.x, y: p.y, height: 205,   // above his hat
      badge: `Lv${mode.hunterLevel}`, job: hunterJob,
      up: !hunterJob && mode.hunterLevel < HUNTER_MAX_LEVEL && affordable(mode, mode.hunterUpgradeCost()),
    });
  }
  const jobRoom = mode.builderJob && mode.builderJob.kind === 'building' ? mode.builderJob.roomId : null;
  for (const room of mode.buildableRooms()) {
    if (room.id === jobRoom) continue;
    out.push({ key: room.id, room, icon: 'plus', x: room.x + room.w / 2, y: room.y + room.h / 2, height: 40, slot: true });
  }
  for (const [roomId, type] of Object.entries(mode.buildings)) {
    const room = game.mansion.room(roomId);
    if (!room) continue;
    const level = mode.buildingLevel(roomId);
    const upJob = mode.builderJob && mode.builderJob.kind === 'upgrade' && mode.builderJob.roomId === roomId ? mode.builderJob : null;
    const spot = mode.buildingSpot(roomId, type) || { x: room.x + room.w / 2 + 48, y: room.y + room.h / 2 + 24 };
    out.push({
      key: roomId, room, built: type, level, icon: BUILD_META[type] ? BUILD_META[type].icon : 'shelter',
      // high enough that the model (and its level pennant) shows under the
      // bubble; a tower is taller than the rest
      x: spot.x, y: spot.y, height: (type === 'tower' ? 232 : 185) + (level - 1) * (type === 'tower' ? 34 : 26),
      badge: `Lv${level}`, job: upJob,
      up: !upJob && level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(roomId)),
    });
  }
  const job = mode.builderJob;
  if (job && job.kind === 'building' && job.roomId) {
    const room = game.mansion.room(job.roomId);
    // a tower under construction already marks the spot by its door
    const spot = job.type === 'tower' ? mode.buildingSpot(job.roomId, 'tower') : null;
    if (room) out.push({ key: job.roomId, room, building: job.type, icon: BUILD_META[job.type] ? BUILD_META[job.type].icon : 'hammer', x: spot ? spot.x : room.x + room.w / 2, y: spot ? spot.y : room.y + room.h / 2, height: 60, job });
  }
  return out;
}

/**
 * Where a bubble sits on screen: over its target, or clamped to the edge of
 * the world view (`view` = {x0, x1, y0, y1}) as a pointer.
 */
function bubbleAnchor(game, target, view) {
  let at = project(game, target.x, target.y, target.height);
  const inside = (r) => !!r && at.x >= r.x0 && at.x <= r.x1 && at.y >= r.y0 && at.y <= r.y1;
  // `view.extra`: a second visible strip (sideways: the world above the column)
  const off = !inside(view) && !inside(view.extra);
  let angle = 0;
  if (off) {
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    const dx = at.x - cx, dy = at.y - cy;
    const k = Math.min(((view.x1 - view.x0) / 2) / Math.max(1e-3, Math.abs(dx)), ((view.y1 - view.y0) / 2) / Math.max(1e-3, Math.abs(dy)));
    angle = Math.atan2(dy, dx);
    at = { x: cx + dx * k, y: cy + dy * k };
  }
  return { x: at.x, y: at.y, off, angle };
}

/**
 * Keep bubbles from stacking: edge pointers spread out along their edge
 * (order kept, squeezed evenly when the edge is crowded), then the Hunter's
 * bubble (he walks, and often stands under the Perapian's) slides clear of
 * everything else. Fixed on-screen bubbles never move.
 */
function layoutBubbles(game, targets, view) {
  const anchors = new Map(targets.map((t) => [t, bubbleAnchor(game, t, view)]));
  const spacing = 54;
  const edges = { left: [], right: [], top: [], bottom: [] };
  for (const a of anchors.values()) {
    if (!a.off) continue;
    if (a.x <= view.x0 + 1) edges.left.push(a);
    else if (a.x >= view.x1 - 1) edges.right.push(a);
    else if (a.y <= view.y0 + 1) edges.top.push(a);
    else edges.bottom.push(a);
  }
  // Spread one edge's pointers along `key`. A crowded edge (a short
  // landscape side) zig-zags: every other pointer steps `inset` px inward on
  // `cross`, so neighbours only need half the spacing along the edge.
  const spread = (list, key, lo, hi, cross, inset) => {
    if (list.length < 2) return;
    list.sort((p, q) => p[key] - q[key]);
    const room = (hi - lo) / (list.length - 1);
    const zig = room < spacing;
    const gap = zig ? Math.max(room, spacing / 2) : spacing;
    for (const a of list) a[key] = clamp(a[key], lo, hi);
    for (let i = 1; i < list.length; i++) list[i][key] = Math.max(list[i][key], list[i - 1][key] + gap);
    const last = list.length - 1;
    if (list[last][key] > hi) {
      list[last][key] = hi;
      for (let i = last - 1; i >= 0; i--) list[i][key] = Math.min(list[i][key], list[i + 1][key] - gap);
    }
    if (zig) for (let i = 1; i < list.length; i += 2) list[i][cross] += inset;
  };
  // every row keeps 40 px off the corners, so a side column and a top/bottom
  // row never meet; the right column also starts under the resource pills
  const corner = 40, inset = 48;
  spread(edges.left, 'y', view.y0 + corner, view.y1 - corner, 'x', inset);
  spread(edges.right, 'y', Math.max(view.y0, view.rightY0 || 0) + corner, view.y1 - corner, 'x', -inset);
  spread(edges.top, 'x', view.x0 + corner, view.x1 - corner, 'y', inset);
  spread(edges.bottom, 'x', view.x0 + corner, view.x1 - corner, 'y', -inset);
  const hunter = targets.find((t) => t.key === 'hunter');
  const h = hunter && anchors.get(hunter);
  if (h && !h.off) {
    const min = 80;   // circles + the Lv badge + the pointer tail
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const [t, a] of anchors) {
        if (t === hunter) continue;
        let dx = h.x - a.x, dy = h.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1) { dx = -1; dy = 0; } else { dx /= d; dy /= d; }
        h.x += dx * (min - d); h.y += dy * (min - d);
        moved = true;
      }
      if (!moved) break;
    }
  }
  return anchors;
}

function drawBubble(game, ctx, target, selected, anchor) {
  const mode = game.survival;
  const t = clock(game);
  const at = { x: anchor.x, y: anchor.y };
  const off = anchor.off;
  const angle = anchor.angle;
  const r = selected ? 27 : target.slot ? 21 : 23;
  const bob = target.slot ? Math.sin(t * 4 + target.x * 0.01) * 3 : 0;
  const y = at.y + bob;
  ctx.save();
  if (off) {
    ctx.translate(at.x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(r + 12, 0); ctx.lineTo(r - 2, -9); ctx.lineTo(r - 2, 9); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.beginPath();
    ctx.moveTo(at.x - 8, y + r - 3); ctx.lineTo(at.x, y + r + 11); ctx.lineTo(at.x + 8, y + r - 3);
    ctx.closePath();
    ctx.fillStyle = selected ? '#fff3c4' : '#ffffff'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  if (selected) {
    ctx.beginPath();
    ctx.arc(at.x, y, r + 5 + Math.sin(t * 5) * 1.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,214,90,0.55)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(at.x, y, r, 0, TAU);
  ctx.fillStyle = selected ? '#fff3c4' : '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  if (target.job) {
    const pct = 1 - clamp(target.job.remaining / Math.max(0.01, target.job.duration), 0, 1);
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, y, r - 3, -Math.PI / 2, -Math.PI / 2 + TAU * pct);
    ctx.lineWidth = 5; ctx.strokeStyle = '#45d06a'; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
  drawSurvivalIcon(ctx, target.icon, at.x, y, r * (target.slot ? 1.5 : 1.35), { rotate: target.job ? Math.sin(t * 8) * 0.25 : 0 });
  if (target.badge) {
    drawPanel(ctx, at.x - 16, y + r - 9, 32, 15, { radius: 7, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 1.8, highlight: false, shadow: false });
    drawLabel(ctx, target.badge, at.x, y + r - 1, 10, '#3a2400', { outline: 0 });
  }
  if (target.up) {
    const ux = at.x + r * 0.78, uy = y - r * 0.78 + Math.sin(t * 6) * 2;
    drawSurvivalIcon(ctx, 'up', ux, uy, 20);
  }
  const hitR = Math.max(26, r + 6);
  return { x: at.x - hitR, y: y - hitR, w: hitR * 2, h: hitR * 2 };
}

function selectTarget(game, key) {
  const mode = game.survival;
  mode.dayFocus = key;
  if (key !== 'perapian' && key !== 'gate' && key !== 'hunter') mode.selectedRoom = key;
}

function sheetFrame(w) {
  const width = Math.min(w - 20, 540);
  return { x: Math.round((w - width) / 2), width };
}

/**
 * Day screen layout. Tall screens: the sheet docks at the bottom with the
 * builder/NIGHT row under it and the world above. A phone held sideways is
 * too short for that (the world shrank to a strip and every bubble became an
 * edge pointer), so the sheet and the row become a left column and the world
 * view is the right-hand side.
 */
function dayLayout(w, h, sheetH) {
  const side = daySideColumn(w, h);
  if (!side) {
    const frame = sheetFrame(w);
    const bottomH = 64;
    const top = h - bottomH - sheetH - 6;
    return {
      side: false,
      sheet: { x: frame.x, width: frame.width, top, height: sheetH },
      row: { x: frame.x, width: frame.width, y: h - bottomH },
      view: { x0: 30, x1: w - 30, y0: 128, y1: top - 30 },
      hint: { cx: w / 2, maxW: w - 24, y: Math.max(h < 560 ? 60 : 136, top - 48) },
    };
  }
  const rowY = h - 62;
  const height = Math.min(sheetH, rowY - 6 - 58);
  const top = rowY - 6 - height;
  const colRight = side.x + side.width;
  return {
    side: true,
    sheet: { x: side.x, width: side.width, top, height },
    row: { x: side.x, width: side.width, y: rowY },
    view: {
      x0: colRight + 34, x1: w - 30, y0: 84, y1: h - 34, rightY0: 128,
      // the strip of world above the column shows its bubbles too
      extra: { x0: 30, x1: colRight + 34, y0: 74, y1: top - 30 },
    },
    // as in portrait, the chip sits just above the sheet
    hint: { cx: side.x + side.width / 2, maxW: side.width, y: Math.max(58, top - 48) },
  };
}

function drawSheet(game, ctx, frame, focus) {
  const mode = game.survival;
  const { x, width, top, height: sheetH } = frame;
  drawPanel(ctx, x, top, width, sheetH, { radius: 20, top: '#3a4190', bottom: '#20244f', lineWidth: 3 });
  const busy = !!mode.builderJob;
  const innerX = x + 12, innerW = width - 24;
  const titleY = top + 22;

  if (focus.key === 'perapian') {
    const level = mode.perapianLevel;
    const cost = mode.buildingCost('perapian');
    const max = level >= 3;
    drawSurvivalIcon(ctx, 'perapian', innerX + 16, titleY, 30);
    drawLabel(ctx, 'PERAPIAN', innerX + 38, titleY, 16, '#ffffff', { align: 'left' });
    drawLabel(ctx, max ? `Lv${level} MAX` : `Lv${level} → Lv${level + 1}`, x + width - 16, titleY, 14, '#ffd24a', { align: 'right' });
    const rowY = top + 64;
    const now = Math.round(mode.tuning.perapianRadius[level] || 0);
    const next = Math.round(mode.tuning.perapianRadius[Math.min(3, level + 1)] || now);
    drawSurvivalIcon(ctx, 'radius', innerX + 16, rowY, 30);
    drawLabel(ctx, max ? `${now}` : `${now} → ${next}`, innerX + 38, rowY - 7, 15, '#ffffff', { align: 'left' });
    drawLabel(ctx, 'FIRE RADIUS', innerX + 38, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    const burnNow = mode.hearthBurnDps(level);
    const burnNext = max ? burnNow : mode.hearthBurnDps(level + 1);
    drawSurvivalIcon(ctx, 'fire', innerX + innerW / 2 + 22, rowY, 28);
    drawLabel(ctx, max ? `${burnNow}/s` : `${burnNow} → ${burnNext}/s`, innerX + innerW / 2 + 42, rowY - 7, 15, '#ffffff', { align: 'left' });
    drawLabel(ctx, 'HEARTH BURN', innerX + innerW / 2 + 42, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    const btnY = top + sheetH - 62;
    if (!max && cost) costRow(ctx, innerX + 4, btnY + 24, cost, mode, 20);
    drawButton(game, ctx, { x: x + width - 170, y: btnY, w: 158, h: 48 }, max ? 'MAX' : 'UPGRADE',
      () => mode.startBuild('perapian'),
      { id: max ? 'UPGRADE MAX' : `UPGRADE PERAPIAN LV${level + 1}`, icon: max ? 'star' : 'up', color: 'green', disabled: max || busy || !affordable(mode, cost) });
    return;
  }

  if (focus.key === 'hunter' && !focus.job) {
    const level = mode.hunterLevel;
    const max = level >= HUNTER_MAX_LEVEL;
    const cost = mode.hunterUpgradeCost();
    const now = mode.hunterStats(level);
    const next = mode.hunterStats(Math.min(HUNTER_MAX_LEVEL, level + 1));
    drawSurvivalIcon(ctx, 'hunter', innerX + 16, titleY, 30);
    drawLabel(ctx, 'HUNTER', innerX + 38, titleY, 16, '#ffffff', { align: 'left' });
    drawLabel(ctx, max ? `Lv${level} MAX` : `Lv${level} → Lv${level + 1}`, x + width - 16, titleY, 14, '#ffd24a', { align: 'right' });
    const rowY = top + 64;
    drawSurvivalIcon(ctx, 'crossbow', innerX + 16, rowY, 30);
    drawLabel(ctx, max ? `${now.damage}` : `${now.damage} → ${next.damage}`, innerX + 38, rowY - 7, 15, '#ffffff', { align: 'left' });
    drawLabel(ctx, 'BOLT DAMAGE', innerX + 38, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    drawSurvivalIcon(ctx, 'heart', innerX + innerW / 2 + 22, rowY, 28);
    drawLabel(ctx, max ? `${now.hp}` : `${now.hp} → ${next.hp}`, innerX + innerW / 2 + 42, rowY - 7, 15, '#ffffff', { align: 'left' });
    drawLabel(ctx, 'HEALTH', innerX + innerW / 2 + 42, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    const btnY = top + sheetH - 62;
    if (!max && cost) costRow(ctx, innerX + 4, btnY + 24, cost, mode, 20);
    drawButton(game, ctx, { x: x + width - 170, y: btnY, w: 158, h: 48 }, max ? 'MAX' : 'UPGRADE',
      () => mode.startBuild('hunter'),
      { id: max ? 'UPGRADE MAX' : `UPGRADE HUNTER LV${level + 1}`, icon: max ? 'star' : 'up', color: 'green', disabled: max || busy || !affordable(mode, cost) });
    return;
  }

  if (focus.key === 'gate') {
    const cost = mode.tuning.gateCost;
    const gate = mode.mainGate();
    drawSurvivalIcon(ctx, 'gate', innerX + 16, titleY, 30);
    drawLabel(ctx, 'GATE', innerX + 38, titleY, 16, '#ffffff', { align: 'left' });
    const rowY = top + 66;
    if (mode.gateBuilt && gate) {
      drawLabel(ctx, 'BUILT', x + width - 16, titleY, 14, '#7ef08e', { align: 'right' });
      drawSurvivalIcon(ctx, 'heart', innerX + 16, rowY, 26);
      drawBar(ctx, innerX + 36, rowY - 8, innerW - 50, 16, gate.hp / Math.max(1, gate.hpMax), '#45d06a');
      drawLabel(ctx, `${Math.round(gate.hp)}/${Math.round(gate.hpMax)}`, innerX + 36 + (innerW - 50) / 2, rowY + 1, 11, '#ffffff');
      return;
    }
    drawSurvivalIcon(ctx, 'heart', innerX + 16, rowY, 26);
    drawLabel(ctx, `+${mode.tuning.gateHpBonus}`, innerX + 38, rowY - 7, 15, '#7ef08e', { align: 'left' });
    drawLabel(ctx, 'FRONT DOOR HP', innerX + 38, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    const btnY = top + sheetH - 62;
    costRow(ctx, innerX + 4, btnY + 24, cost, mode, 20);
    drawButton(game, ctx, { x: x + width - 170, y: btnY, w: 158, h: 48 }, 'BUILD',
      () => mode.startBuild('gate'),
      { id: 'GATE', icon: 'hammer', color: 'green', disabled: busy || !affordable(mode, cost) });
    return;
  }

  const room = focus.room;
  if (focus.job) {
    const job = focus.job;
    const hunter = job.kind === 'hunter';
    const meta = hunter ? { icon: 'hunter', name: 'HUNTER' } : (BUILD_META[job.type] || BUILD_META.shelter);
    const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    drawSurvivalIcon(ctx, meta.icon, innerX + 16, titleY, 30);
    drawLabel(ctx, meta.name, innerX + 38, titleY, 16, '#ffffff', { align: 'left' });
    if (job.targetLevel) drawLabel(ctx, `→ Lv${job.targetLevel}`, x + width - 16, titleY, 14, '#ffd24a', { align: 'right' });
    else drawLabel(ctx, room ? room.name : '', x + width - 16, titleY, 11, '#b9c2ff', { align: 'right', outline: 2 });
    const rowY = top + 70;
    drawSurvivalIcon(ctx, hunter ? 'up' : 'hammer', innerX + 18, rowY, 28, { rotate: hunter ? 0 : Math.sin(clock(game) * 10) * 0.3 });
    drawBar(ctx, innerX + 40, rowY - 9, innerW - 54, 18, pct, '#45d06a');
    drawLabel(ctx, `${job.remaining.toFixed(1)}s`, innerX + 40 + (innerW - 54) / 2, rowY + 1, 12, '#ffffff');
    return;
  }
  const built = focus.built || mode.useBuilding(focus.key);
  if (built) {
    // Built: what it does now → next level, and the level-up button.
    const meta = BUILD_META[built] || BUILD_META.shelter;
    const level = mode.buildingLevel(focus.key);
    const max = level >= BUILDING_MAX_LEVEL;
    const cost = mode.upgradeCost(focus.key);
    drawSurvivalIcon(ctx, meta.icon, innerX + 16, titleY, 30);
    drawLabel(ctx, meta.name, innerX + 38, titleY, 16, '#ffffff', { align: 'left' });
    drawLabel(ctx, max ? `Lv${level} MAX` : `Lv${level} → Lv${level + 1}`, x + width - 16, titleY, 14, '#ffd24a', { align: 'right' });
    const nowRows = buildingRows(mode, built, level);
    const nextRows = max ? nowRows : buildingRows(mode, built, level + 1);
    const rowY = top + 64;
    nowRows.forEach((row, i) => {
      const rx = innerX + (i === 0 ? 0 : innerW / 2 + 6);
      drawSurvivalIcon(ctx, row.icon, rx + 16, rowY, 28);
      drawLabel(ctx, max ? row.value : `${row.value} → ${nextRows[i].value}`, rx + 36, rowY - 7, 15, '#ffffff', { align: 'left' });
      drawLabel(ctx, row.label, rx + 36, rowY + 11, 10, '#b9c2ff', { align: 'left', outline: 2 });
    });
    const btnY = top + sheetH - 62;
    if (!max && cost) costRow(ctx, innerX + 4, btnY + 24, cost, mode, 20);
    drawButton(game, ctx, { x: x + width - 170, y: btnY, w: 158, h: 48 }, max ? 'MAX' : 'UPGRADE',
      () => mode.startBuild('upgrade', focus.key),
      { id: max ? 'UPGRADE MAX' : `UPGRADE ${built} LV${level + 1}`, icon: max ? 'star' : 'up', color: 'green', disabled: max || busy || !affordable(mode, cost) });
    return;
  }

  drawSurvivalIcon(ctx, 'plus', innerX + 14, titleY, 26);
  drawLabel(ctx, room ? room.name : 'LIT ROOM', innerX + 34, titleY, 14, '#ffffff', { align: 'left' });
  // four cards across (pump, sawmill, shelter, tower); a narrow card trims
  // its icon and cost row so the numbers keep their size
  const count = BUILD_ORDER.length;
  const gap = count > 3 ? 6 : 8;
  const cardW = (innerW - gap * (count - 1)) / count;
  const narrow = cardW < 96;
  const cardY = top + 42;
  const cardH = sheetH - 54;
  const costSize = narrow ? 14 : 15;
  for (let i = 0; i < count; i++) {
    const type = BUILD_ORDER[i];
    const spec = SURVIVAL_BUILDINGS[type];
    const meta = BUILD_META[type];
    const cx = innerX + i * (cardW + gap);
    const ok = affordable(mode, spec) && !busy && !!room;
    const box = { x: cx, y: cardY, w: cardW, h: cardH };
    addHit(game, box, `BUILD ${type}`, () => mode.startBuild(type, room && room.id), !ok);
    drawPanel(ctx, cx, cardY, cardW, cardH, {
      radius: narrow ? 12 : 14, top: ok ? '#fff8e8' : '#c9cbd6', bottom: ok ? '#ffe2b0' : '#a8abb9', lineWidth: 2.4,
    });
    const compact = cardH < 120;
    drawSurvivalIcon(ctx, meta.icon, cx + cardW / 2, cardY + (compact ? 22 : 30), compact ? 30 : narrow ? 36 : 40, { alpha: ok ? 1 : 0.7 });
    if (!compact) drawLabel(ctx, meta.name, cx + cardW / 2, cardY + 60, narrow ? 10 : 11, '#3a2a50', { outline: 0 });
    const main = buildingRows(mode, type, 1)[0];
    const outY = compact ? cardY + 48 : cardY + 80;
    drawSurvivalIcon(ctx, main.icon, cx + cardW / 2 - 14, outY, 18);
    drawLabel(ctx, main.value, cx + cardW / 2 + 2, outY + 1, 14, '#1f8a3a', { align: 'left', outline: 0 });
    // centre the cost row on what costRow() will actually draw
    const label = Math.round(costSize * 0.86);
    const costW = (spec.oil ? costSize + 12 + measureLabel(ctx, spec.oil, label) : 0)
      + (spec.wood ? costSize + 12 + measureLabel(ctx, spec.wood, label) : 0) - 6;
    costRow(ctx, cx + cardW / 2 - costW / 2, cardY + cardH - 16, spec, mode, costSize);
  }
}

function drawRewardModal(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.lastRewards || { oil: 0, wood: 0, kills: 0 };
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const rowsCount = 3 + (reward.survivors > 0 ? 1 : 0) + (reward.drained ? 1 : 0) + (reward.pumped ? 1 : 0) + (reward.lost ? 1 : 0);
  const bw = Math.min(330, w - 32), bh = 92 + Math.ceil(rowsCount / 2) * 52 + 86;
  const x = (w - bw) / 2, y = (h - bh) / 2 + 10;
  const t = clock(game);
  // sun rays behind the badge
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
  drawSurvivalIcon(ctx, 'sun', w / 2, y + 2, 76);
  drawLabel(ctx, `NIGHT ${Math.max(1, mode.nightsCompleted)} SURVIVED!`, w / 2, y + 62, 20, '#ffffff', { stroke: '#7a3a00' });
  const rows = [
    { icon: 'skull', value: `${reward.kills || 0}`, color: '#3a2a50' },
    { icon: 'oil', value: `+${reward.oil || 0}`, color: '#1f8a3a' },
    { icon: 'wood', value: `+${reward.wood || 0}`, color: '#1f8a3a' },
  ];
  if (reward.pumped) rows.push({ icon: 'extractor', value: `+${reward.pumped}`, color: '#1f8a3a' });   // pumped overnight
  if (reward.survivors > 0) rows.push({ icon: 'survivor', value: `+${reward.survivors}`, color: '#1f8a3a' });
  if (reward.drained) rows.push({ icon: 'fire', value: `-${reward.drained}`, color: '#d23a2a' });
  // a guard nobody helped up by dawn: one survivor fewer
  if (reward.lost) rows.push({ icon: 'guard', value: `-${reward.lost}`, color: '#d23a2a' });
  const cols = 2;
  const cellW = (bw - 40) / cols, cellH = 44;
  rows.forEach((row, i) => {
    const cx = x + 20 + (i % cols) * cellW;
    const cy = y + 92 + Math.floor(i / cols) * (cellH + 8);
    drawPanel(ctx, cx + 4, cy, cellW - 8, cellH, { radius: 14, top: '#ffffff', bottom: '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + 28, cy + cellH / 2, 30);
    drawLabel(ctx, row.value, cx + 50, cy + cellH / 2 + 1, 20, row.color, { align: 'left', outline: 0 });
  });
  drawButton(game, ctx, { x: x + 40, y: y + bh - 66, w: bw - 80, h: 50 }, 'COLLECT',
    () => mode.ackRewards(), { id: 'COLLECT', icon: 'check', color: 'green' });
}

function drawDayScreen(game, ctx, w, h) {
  const mode = game.survival;
  const targets = dayTargets(game);
  if (!mode.dayFocus || !targets.some((t) => t.key === mode.dayFocus)) mode.dayFocus = 'perapian';
  const focus = targets.find((t) => t.key === mode.dayFocus && !t.job) || targets.find((t) => t.key === mode.dayFocus) || targets[0];
  // Card rows need room; single-target sheets stay compact. Short screens
  // get a squeezed card row unless the sheet sits in the sideways column.
  const short = h < 560 && !daySideColumn(w, h);
  const sheetH = focus && focus.slot ? (short ? 132 : 196) : focus && focus.job ? 112 : (short ? 140 : 150);
  const layout = dayLayout(w, h, sheetH);
  const reward = mode.rewardPending();

  if (!reward) {
    const anchors = layoutBubbles(game, targets, layout.view);
    // world bubbles; selected last so it sits on top
    const ordered = targets.filter((t) => t !== focus).concat(focus ? [focus] : []);
    for (const target of ordered) {
      const box = drawBubble(game, ctx, target, target === focus, anchors.get(target));
      const id = target.slot ? `slot:${target.key}` : `select:${target.key}`;
      addHit(game, box, id, () => selectTarget(game, target.key));
    }
  }

  // the dawn reward is modal: no pause button underneath it
  if (!reward) drawPauseButton(game, ctx, w, h);
  drawPhasePill(game, ctx, w, 'day');
  drawCounters(game, ctx, w, [
    { icon: 'oil', value: Math.floor(mode.oil) },
    { icon: 'wood', value: Math.floor(mode.wood) },
    { icon: 'survivor', value: mode.survivors },
  ], 42);
  // Tonight's fuel is locked: a small flame tag hanging off the Oil pill.
  {
    const tagW = 58, tagH = 19;
    const tagX = w - 8 - tagW - 4, tagY = 10 + 30 - 8;
    drawPanel(ctx, tagX, tagY, tagW, tagH, { radius: 9, top: '#ffb347', bottom: '#e46b16', lineWidth: 1.8, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, 'moon', tagX + 11, tagY + tagH / 2, 14);
    drawLabel(ctx, `-${mode.oilReserveForNight()}`, tagX + 36, tagY + tagH / 2 + 1, 12, '#ffffff', { outline: 2.4 });
  }

  if (reward) {
    drawRewardModal(game, ctx, w, h);
    return;
  }

  // Oil reserve warning: a night burns fuel; arriving with too little is fatal.
  const reserve = mode.oilReserveForNight();
  if (mode.oil < reserve) {
    const bw = Math.min(w - 120, 230);
    const x = (w - bw) / 2, y = 62;
    drawPanel(ctx, x, y, bw, 32, { radius: 16, top: '#ff8a5a', bottom: '#d2401f', lineWidth: 2.2 });
    drawSurvivalIcon(ctx, 'warning', x + 20, y + 16, 22);
    drawLabel(ctx, `NEED ${reserve}`, x + 38, y + 17, 13, '#ffffff', { align: 'left' });
    drawSurvivalIcon(ctx, 'oil', x + 46 + measureLabel(ctx, `NEED ${reserve}`, 13), y + 16, 20);
    drawLabel(ctx, 'TONIGHT', x + bw - 12, y + 17, 11, '#fff1e0', { align: 'right', outline: 2 });
  }

  if (focus) drawSheet(game, ctx, layout.sheet, focus);

  // bottom row: builder status + START NIGHT
  const rowY = layout.row.y;
  const job = mode.builderJob;
  const pillW = 118;
  const frame = layout.row;
  const px = frame.x;
  drawPanel(ctx, px, rowY + 4, pillW, 48, { radius: 16, top: '#4a51a8', bottom: '#262a66', lineWidth: 2.5 });
  const training = job && job.kind === 'hunter';
  drawSurvivalIcon(ctx, training ? 'hunter' : 'hammer', px + 24, rowY + 28, 28, { alpha: job ? 1 : 0.55, rotate: job && !training ? Math.sin(clock(game) * 10) * 0.3 : 0 });
  if (job) {
    const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    drawBar(ctx, px + 44, rowY + 16, pillW - 52, 12, pct, '#45d06a');
    drawLabel(ctx, `${job.remaining.toFixed(1)}s`, px + 44 + (pillW - 52) / 2, rowY + 41, 11, '#ffffff');
  } else {
    drawLabel(ctx, 'READY', px + 44, rowY + 29, 13, '#c9d0ff', { align: 'left' });
  }
  drawButton(game, ctx, { x: px + pillW + 8, y: rowY + 4, w: frame.width - pillW - 8, h: 48 }, `NIGHT ${mode.day}`,
    () => mode.startNight(), { id: 'START NIGHT', icon: 'moon', color: 'purple', disabled: !!job });

  // FTUE chip sits just above the sheet (or at the foot of the sideways
  // world view), clear of the world bubbles
  drawHint(game, ctx, w, layout.hint.y, layout.hint.cx, layout.hint.maxW);
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
  const fireOut = /FIRE/i.test(reason);
  const icon = failed ? (fireOut ? 'fire' : 'skull') : 'trophy';
  drawSurvivalIcon(ctx, icon, w / 2, y + 4, 78, { gray: failed && fireOut });
  const title = failed ? (fireOut ? 'THE FIRE WENT OUT' : 'THE HUNTER FELL') : '3 NIGHTS SURVIVED!';
  drawLabel(ctx, title, w / 2, y + 66, 21, failed ? '#ffffff' : '#ffffff', { stroke: failed ? INK : '#7a3a00' });
  const stats = [
    { icon: 'moon', value: failed ? `${mode.day}` : '3' },
    { icon: 'skull', value: `${(mode.nightStats && mode.nightStats.kills) || 0}` },
    { icon: 'perapian', value: `Lv${mode.perapianLevel}` },
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
    drawSurvivalIcon(ctx, 'perapian', w / 2, h / 2 - 30, 70);
    drawLabel(ctx, 'LIGHTING THE PERAPIAN…', w / 2, h / 2 + 30, 15, '#ffffff');
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
