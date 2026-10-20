/* DUSKHOLD — Survival HUD (K1 "Benteng Terakhir"): the night HUD, the day's
 * walk-to-a-circle builder (P1), the dawn card and the end panels.
 *
 * Visual language: the "build by day, defend by night" mobile genre. Icons
 * carry the meaning (gold coin, log, soldier, the keep, skull, moon/sun),
 * text is a short outlined label or a number. Canvas is UI-only: the keep,
 * the build circles and their ghost buildings, the banner's yards, the crowd
 * and every placed object are 3D, in World3D.
 *
 * The day has no side panel and no "+" bubbles. The Hunter walks into a
 * circle on the floor (or taps it and walks there) and ONE contextual dock
 * appears in the right thumb corner: a single 50 px row of the building's
 * name, level pips and two stats (now → next) beside its BUILD / UPGRADE
 * button (REPAIR joins the row at the keep). NIGHT is a chip top-left.
 * The right half of the screen drags the camera (the stick keeps the left);
 * dragged far, a CAPTAIN chip under the phase pill brings the view back.
 *
 * Interaction contract (QA relies on it):
 *   - every tappable item is pushed to game.ui with label `survival:<ID>`;
 *   - the night HUD registers only the PAUSE item (combat is the touch stick,
 *     the auto-shot and the Flare button drawn by drawSurvivalControls);
 *   - `survival:RECENTER` (day and night) while the view is dragged off
 *     the captain;
 *   - day: `survival:BUILD <type>` (the circle the Hunter stands in),
 *     `survival:UPGRADE <type> LV<n>`, `survival:UPGRADE KEEP LV<n>`,
 *     `survival:REPAIR KEEP`, `survival:UPGRADE HUNTER LV<n>`, `survival:GATE`,
 *     `survival:START NIGHT`, `survival:COLLECT`; world chips over circles are
 *     `survival:walk:<circle id>` (tap: the Hunter walks there);
 *   - K1 bookends (the opening, the reinforcements' arrival): letterbox,
 *     one caption at a time and ONE item, `survival:SKIP`, the whole screen
 *     (live after CINE.armAfter so the tap that started the run can't skip).
 */

import { clamp, writeSave } from '../core/util.js';
import { SURVIVAL_ACTOR_SCALE } from '../core/config.js';
import { SURVIVAL_BUILDINGS, BUILDING_MAX_LEVEL, HUNTER_MAX_LEVEL, ARMS_MAX_LEVEL, GUARD, CINE, SURVIVAL_CAMERA, gateShort, UNLOCK_TIERS } from '../game/survival.js';
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

// color: each type's own colour (BUILD 11, playtest 2026-10-17: "tidak tau
// build yg mana") — the same as its kit model's roof and its circle on the
// ground (buildings3d.js BUILDING_COLOR)
const BUILD_META = Object.freeze({
  mine: { icon: 'mine', name: 'GOLD MINE', color: '#ffc22e' },      // digs gold during the night
  sawmill: { icon: 'sawmill', name: 'SAWMILL', color: '#4cc35e' },  // wood every dawn + door planks
  barracks: { icon: 'barracks', name: 'BARRACKS', color: '#3e7bff' },// houses soldiers = gate guards
  tower: { icon: 'tower', name: 'BALLISTA', color: '#ff5640' },     // shoots over the wall
});
/**
 * BUILD 13 (V4, docs/VISUAL-LAYOUT-RESEARCH.md §7: "label hanya saat dekat"):
 * an empty circle spells its name and cost only within about one circle of
 * the captain (world px; the yards' circles stand ~270 apart), two at most;
 * every other circle is its icon on its colour. A built building's status
 * pill shows within STATUS_REACH (or where you stand). Zoomed out to the
 * overview the world shows icons only: the plan of the fort, no words.
 */
const PLOT_NAME_REACH = 380;
const PLOT_NAMES_MAX = 2;
const STATUS_REACH = 560;
const OVERVIEW_ZOOM = 0.62;

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

/** SURVIVAL_ACTOR_SCALE (config.js): bars and badges sit over the taller bodies. */
const ACTOR = SURVIVAL_ACTOR_SCALE;

/* ------------------------------------------------------------------ */
/* FTUE hint chips (once each, persisted in save.survival.hints)       */
/* ------------------------------------------------------------------ */

const HINTS = Object.freeze({
  move: { icon: 'joystick', text: 'DRAG TO MOVE', life: 6 },
  auto: { icon: 'target', text: 'AUTO-SHOOTS IN RANGE', life: 5 },
  banner: { icon: 'banner', text: 'BLUE GROUND: YOU HIT HARDER', life: 5.5 },
  keep: { icon: 'keep', text: 'GUARD THE KEEP', life: 5 },
  flare: { icon: 'flare', text: 'TAP FLARE TO BLAST THEM', life: 6 },
  build: { icon: 'hammer', text: 'WALK INTO A CIRCLE TO BUILD', life: 7 },
  guard: { icon: 'guard', text: 'SOLDIERS GUARD THE GATES', life: 5 },
  // BUILD 10: a shut gate stops every shot; the gates open for the captain
  door: { icon: 'door', text: 'WALK OUT A GATE TO FIGHT THEM', life: 6 },
  out: { icon: 'door', text: 'OUT HERE THEY COME FOR YOU', life: 5 },
  level: { icon: 'up', text: 'STAND BY A BUILDING TO LEVEL IT UP', life: 6 },
  rescue: { icon: 'medic', text: 'STAND BY A FALLEN GUARD TO HELP', life: 6 },
  // BUILD 18 (R18b): the one time the night chip shrugs off a tap
  holdnight: { icon: 'moon', text: 'HOLD THE NIGHT CHIP TO START', life: 3.5 },
  watch: { icon: 'star', text: 'STARS EARN THE CAPTAIN NEW COLOURS', life: 3.5 },
  pan: { icon: 'pan', text: 'DRAG THE RIGHT SIDE TO LOOK AROUND', life: 6 },
  // BUILD 12: the dynamic camera (a new id, so players who saw 'pan' see it)
  zoom: { icon: 'zoom', text: 'PINCH OR TAP + / - TO ZOOM', life: 6 },
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
    if (state.id === 'pan' && mode._panUsed) state.t = Math.max(state.t, state.life - 0.35);
    if (state.id === 'zoom' && mode._zoomUsed) state.t = Math.max(state.t, state.life - 0.35);
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
    // a gate is being clawed and the captain has nothing to shoot: send him
    // out (a shut gate stops his bolts since BUILD 10)
    if (mode.elapsed > 12 && !mode.currentTarget && mode.besiegedDoors().length > 0) offerSurvivalHint(game, 'door');
    // the first time he stands outside at night: the horde comes for him
    if (mode.captainExposed && !mode.captainInGate) offerSurvivalHint(game, 'out');
  } else if (mode.phase === 'day' && !mode.rewardPending()) {
    offerSurvivalHint(game, 'build');
    // once the first build is under way: the view can be dragged around
    if (hintStore(game).build && !mode._panUsed && (mode.builderJob || Object.keys(mode.buildings).length)) offerSurvivalHint(game, 'pan');
    // then the zoom (BUILD 12): the whole bailey is two screens wide
    if (hintStore(game).pan && !mode._zoomUsed && (mode.builderJob || Object.keys(mode.buildings).length)) offerSurvivalHint(game, 'zoom');
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
  const bh = (game.renderer && game.renderer.h < 560) ? 34 : 40;
  const x = cx - bw / 2;
  const yy = y + (1 - fadeIn) * -8;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPanel(ctx, x, yy, bw, bh, { radius: 20, top: 'rgba(255,255,255,0.96)', bottom: 'rgba(232,236,255,0.96)', highlight: false });
  const bob = Math.sin(clock(game) * 6) * 1.5;
  drawSurvivalIcon(ctx, spec.icon, x + 24, yy + bh / 2 + bob, bh < 40 ? 22 : 26);
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
  // BUILD 16 (R5): a cleared night's pill is already the dawn's
  const cleared = night && !!mode.cleared;
  const pillW = night ? Math.min(156, w - 216) : Math.min(212, w - 216);
  const pillH = night ? 68 : 46;
  const x = w / 2 - pillW / 2, y = 8;
  drawPanel(ctx, x, y, pillW, pillH, {
    radius: 22,
    top: night && !cleared ? '#4a51a8' : '#ffcf6a',
    bottom: night && !cleared ? '#262a66' : '#f08c2a',
  });
  drawSurvivalIcon(ctx, night && !cleared ? 'moon' : 'sun', x + 24, y + 22, 32);
  if (night) {
    drawLabel(ctx, cleared ? 'CLEARED' : `NIGHT ${mode.day}`, x + 48, y + 13, 11, cleared ? '#fff6dc' : '#d6dcff', { align: 'left', outline: 2.5 });
    drawLabel(ctx, cleared ? 'DAWN' : timeLabel(mode.nightDuration - mode.elapsed), x + 48, y + 30, 19, '#ffffff', { align: 'left' });
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

/**
 * BUILD 22 (H3/R22): the first run's objective chain — three checked steps
 * on the left edge (build a mine, build a tower, hold night 2). The active
 * step's ring pulses, a done step is a green check, and when the third one
 * closes the whole chain holds for a short all-checked celebration at dawn
 * before it leaves for good. "One clear visual goal" that survives the intro
 * captions, Kingdom Rush style: one mechanic per step. Returns what it drew
 * so QA can read it off `game._survivalLabels.objectiveChain`.
 */
function drawObjectiveChain(game, ctx, w, h, night) {
  const mode = game.survival;
  const chain = mode.objectiveChain();
  if (!chain || !chain.visible) return null;
  const short = h < 560;
  const pad = 12;
  const rowH = 22;
  const x = pad;
  const y = night ? (short ? 60 : 96) : (short ? pad + 96 : pad + 104);
  const width = 158;
  const height = rowH * chain.steps.length + 10;
  const t = clock(game);
  const flash = chain.all ? clamp(1 - (mode.uiClock - chain.allAt) / 2.6, 0, 1) : 0;
  ctx.save();
  ctx.globalAlpha = chain.all ? 0.5 + 0.5 * flash : 0.92;
  drawPanel(ctx, x, y, width, height, {
    radius: 12,
    top: chain.all ? '#6a5416' : '#2c2440',
    bottom: chain.all ? '#3a2f0a' : '#1c1730',
    lineWidth: 2,
  });
  ctx.restore();
  chain.steps.forEach((step, i) => {
    const cy = y + 5 + rowH * i + rowH / 2;
    const active = !step.done && chain.steps.slice(0, i).every((other) => other.done);
    const r = active ? 6 + Math.sin(t * 5) * 0.8 : 5.5;
    ctx.save();
    ctx.beginPath(); ctx.arc(x + 14, cy, r, 0, TAU);
    ctx.fillStyle = step.done ? '#45d06a' : active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.28)';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    if (step.done) {
      ctx.strokeStyle = '#0c2a14'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + 11, cy); ctx.lineTo(x + 13.5, cy + 2.6); ctx.lineTo(x + 17.5, cy - 2.6); ctx.stroke();
    }
    ctx.restore();
    drawLabel(ctx, step.label, x + 27, cy + 1, 10,
      step.done ? 'rgba(255,255,255,0.55)' : active ? '#fff6dc' : 'rgba(255,255,255,0.62)',
      { align: 'left', outline: 2.5 });
  });
  return { visible: true, all: chain.all, steps: chain.steps.map((step) => ({ id: step.id, done: step.done })) };
}

function drawCounters(game, ctx, w, rows, gap = 36) {
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
function drawTimeline(game, ctx, x, y, width) {
  const mode = game.survival;
  let progress = clamp(mode.elapsed / Math.max(1, mode.nightDuration), 0, 1);
  // BUILD 16 (R5): a cleared night's bar runs on to the sun as dawn comes early
  if (mode.cleared && mode.dawnBlend) progress += (1 - progress) * mode.dawnBlend();
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

/**
 * Where an edge pointer must not sit (BUILD 14, a BUILD 13 note): the stick's
 * ring (bottom left) and the CAPTAIN chip (top middle). Set once a frame by
 * the world layers (edgeAvoid); drawEdgeMarker slides a pointer along its
 * edge until it is clear of them.
 */
let EDGE_AVOID = [];
const EDGE_MARKS = [];
function edgeAvoid(game, w, h) {
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

function drawEdgeMarker(ctx, w, h, p, icon, color, top = 128, bottom = 150, count = 0) {
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
 * further hit adds into it (game/survival.js pushDamageNumber), so its rise
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

function drawFloaters(game, ctx, w = 0, h = 0) {
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

function drawNightWorldLayer(game, ctx, w, h) {
  const mode = game.survival;
  const t = clock(game);
  const p = game.player;
  const zoom = game.renderer.cam.zoom;
  edgeAvoid(game, w, h);
  const band = nightPointerBand(h);

  // Gates: a wave marching on one (amber: where to go next — R6's marker),
  // one under siege (its HP), a fresh breach. Off screen each becomes a
  // pointer on the screen's edge with how many are there.
  for (const e of game.mansion.entrances) {
    if (!e.exterior || e.kind !== 'door') continue;
    const crowd = mode.crowdAt(e.id).length;
    const besieged = mode.doorPressure(e.id) > 0 || (e.flash || 0) > 0.05;
    const freshBreak = e.broken && mode.breachAge(e.id) < 6;
    const incoming = !besieged && !e.broken && crowd > 0;
    if (!besieged && !freshBreak && !incoming) continue;
    const at = project(game, e.x, e.y, 120);
    if (onScreen(at, w, h, 20)) {
      if (freshBreak) {
        const s = 34 + Math.sin(t * 9) * 3;
        drawSurvivalIcon(ctx, 'doorBroken', at.x, at.y, s);
      } else if (besieged) {
        drawSurvivalIcon(ctx, 'door', at.x - 26, at.y, 24);
        drawBar(ctx, at.x - 12, at.y - 6, 52, 12, e.hp / Math.max(1, e.hpMax), e.hp / Math.max(1, e.hpMax) > 0.35 ? '#ffb22e' : '#ff4d4d');
      } else {
        const bob = Math.sin(t * 6) * 3;
        drawSurvivalIcon(ctx, 'swarm', at.x - 16, at.y + bob, 26);
        drawLabel(ctx, `×${crowd}`, at.x + 14, at.y + bob + 1, 16, '#ffcf4a', { outline: 3 });
      }
    } else {
      drawEdgeMarker(ctx, w, h, at, freshBreak ? 'doorBroken' : incoming ? 'swarm' : 'door',
        freshBreak ? '#ff5a4d' : incoming ? '#ffcf4a' : '#ffb22e', band.top, band.bottom, crowd);
    }
  }

  // BUILD 16 (R5): the night's last few (LAST N!), each marked — a red skull
  // chip over it on the screen, a red pointer at the edge off it
  if (mode.stragglers && !mode.cleared) {
    for (const e of game.enemies) {
      if (!e || e.dead || e.removeMe || !e._survivalType || e.fleeing) continue;
      const lift = (e._survivalType === 'breaker' ? 104 : e._survivalType === 'swarm' ? 66 : 84) * ACTOR + 34;
      const at = project(game, e.x, e.y, lift);
      if (onScreen(at, w, h, 20)) {
        const r = 15 + Math.sin(t * 8) * 1.5;
        ctx.save();
        ctx.beginPath(); ctx.arc(at.x, at.y, r, 0, TAU);
        ctx.fillStyle = '#e8322a'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
        ctx.restore();
        drawSurvivalIcon(ctx, 'skull', at.x, at.y, 22);
      } else {
        drawEdgeMarker(ctx, w, h, at, 'skull', '#ff4d4d', band.top, band.bottom);
      }
    }
  }

  // Every ballista says what it has done tonight: a skull and its kills over
  // its deck (the keep's roof ballista too). A building that fights shows it.
  for (const tower of mode.towers || []) {
    const at = project(game, tower.x, tower.y, 236);
    if (!onScreen(at, w, h, 10)) continue;
    drawStatusPill(ctx, at.x, at.y, { icon: 'skull', text: `${tower.nightKills || 0}`, color: '#ffb36a' }, 0.92);
  }
  if (mode.keepLevel >= 2 && mode.keepBallista) {
    const keepAt = mode.keep();
    const at = project(game, keepAt.x, keepAt.y, 330);
    if (onScreen(at, w, h, 10)) drawStatusPill(ctx, at.x + 44, at.y, { icon: 'skull', text: `${mode.keepBallistaKills || 0}`, color: '#ffb36a' }, 0.92);
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
      drawEdgeMarker(ctx, w, h, at, 'keep', '#ff5a4d', band.top, band.bottom);
    }
  }

  // Enemy bars (big enemies always, swarm only once hurt)
  for (const e of game.enemies) {
    if (!e || e.dead || e.removeMe || !e._survivalType) continue;
    const big = e._survivalType !== 'swarm';
    if (!big && !(e.hp < e.hpMax)) continue;
    // bodies stand taller in Survival (SURVIVAL_ACTOR_SCALE, config.js)
    const height = (e._survivalType === 'breaker' ? 104 : big ? 84 : 66) * ACTOR;
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
      const at = project(game, guard.x, guard.y, 84 * ACTOR);
      if (!onScreen(at, w, h, 16)) { drawEdgeMarker(ctx, w, h, at, 'medic', '#ff5a4d', band.top, band.bottom); continue; }
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
    // over the GLB crossbowman's helmet (84 px x the actor scale)
    const at = project(game, guard.x, guard.y, 90 * ACTOR);
    if (!onScreen(at, w, h, -10)) continue;
    const pct = clamp(guard.hp / Math.max(1, guard.hpMax), 0, 1);
    const flash = guard.hurtFlash > 0.5 ? '#ffffff' : pct > 0.5 ? '#5ab8ff' : pct > GUARD.woundedAt ? '#ffcc33' : '#ff4d4d';
    drawBar(ctx, at.x - 14, at.y - 3, 28, 6, pct, flash, { lineWidth: 1.4 });
  }

  drawHunterBar(game, ctx, p);
  drawFloaters(game, ctx, w, h);
}

/** Hunter HP over his hat, with his level on a gold chip. */
function drawHunterBar(game, ctx, p) {
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
    keepLow: ['#ff6a52', '#b3261c'], keep: ['#ff6a52', '#b3261c'], dawn: ['#ffd65a', '#f08c1a'], cleared: ['#ffd65a', '#f08c1a'],
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
  drawZoomButtons(game, ctx, w, h);
  drawRecenterChip(game, ctx, w, h);
  // BUILD 22: the chain keeps teaching through the night it asks you to hold
  const nightChain = drawObjectiveChain(game, ctx, w, h, true);
  if (game._survivalLabels) game._survivalLabels.objectiveChain = nightChain;
  drawHint(game, ctx, w, h < 560 ? h - 52 : 126);
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
    // the banner row: how many build plots this keep level opens (BUILD 12:
    // plots, not yards — layout B mixes levels within a district)
    const plots = mode.territoryPlots().length;
    return {
      icon: 'keep', name: 'KEEP', level, maxLevel: 3,
      rows: [
        { icon: 'heart', now: `${hp}`, next: max ? null : `${hpNext}` },
        { icon: 'banner', now: `${plots}`, next: max ? null : `${mode.territoryPlots(level + 1).length}` },
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
      icon: 'hunter', name: 'CAPTAIN', level, maxLevel: HUNTER_MAX_LEVEL, tag,
      rows: [
        { icon: 'crossbow', now: `${now.damage}`, next: max ? null : `${next.damage}` },
        { icon: 'heart', now: `${now.hp}`, next: max ? null : `${next.hp}` },
      ],
      main: max
        ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
        : { label: 'UPGRADE', icon: 'up', id: `UPGRADE HUNTER LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('hunter') },
    };
  }
  if (here.kind === 'arms') {
    // BUILD 14: the garrison's crossbows — one level for every guard, seen
    // on each of them (and on the rack) the moment it is done
    const level = mode.armsLevel;
    const max = level >= ARMS_MAX_LEVEL;
    const cost = mode.armsUpgradeCost();
    const now = mode.armsStats(level);
    const next = mode.armsStats(Math.min(ARMS_MAX_LEVEL, level + 1));
    const tag = max ? (now.pierce ? 'PIERCE' : '') : next.pierce > now.pierce ? 'PIERCE' : next.every < now.every ? 'FASTER' : '';
    const job = mode.builderJob;
    const pct = job && job.kind === 'arms' ? 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1) : null;
    return {
      icon: 'crossbow', name: 'GUARD BOWS', level, maxLevel: ARMS_MAX_LEVEL, tag,
      rows: [
        { icon: 'crossbow', now: `${now.damage}`, next: max ? null : `${next.damage}` },
        { icon: 'guard', now: `×${mode.survivors}`, next: null },
      ],
      main: pct != null
        ? { label: `UPGRADING ${Math.round(pct * 100)}%`, icon: 'up', id: 'UPGRADING ARMS', disabled: true, color: 'gold' }
        : max
          ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
          : { label: 'UPGRADE', icon: 'up', id: `UPGRADE ARMS LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('arms') },
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
      icon: meta.icon, name: meta.name, tint: meta.color, level: 0, maxLevel: BUILDING_MAX_LEVEL, locked: need,
      rows: buildingRows(mode, here.type, 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `KEEP Lv${need}`, icon: 'lock', id: `LOCKED ${here.type}`, disabled: true, color: 'gray' },
    };
  }
  const job = mode.builderJob;
  if (job && job.slotId === here.id) {
    // the builder is at work on this circle: the button shows his progress
    const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    return {
      icon: meta.icon, name: meta.name, tint: meta.color, level: here.built ? mode.buildingLevel(here.id) : 0, maxLevel: BUILDING_MAX_LEVEL,
      rows: buildingRows(mode, job.type, job.targetLevel || 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `BUILDING ${Math.round(pct * 100)}%`, icon: 'hammer', id: 'BUILDING', disabled: true, color: 'green' },
    };
  }
  if (!here.built) {
    const spec = SURVIVAL_BUILDINGS[here.type];
    return {
      icon: meta.icon, name: meta.name, tint: meta.color, level: 0, maxLevel: BUILDING_MAX_LEVEL,
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
    icon: meta.icon, name: meta.name, tint: meta.color, level, maxLevel: BUILDING_MAX_LEVEL,
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

/**
 * The info half of the action dock: icon, name and level pips on one line,
 * the stats (now → next, the gain in green) on the next. It used to be a
 * 232 x 100 card standing over the button — with the button, 166 px of a
 * 390 px sideways phone (playtest 2026-10-17: "card juga masih besar masih
 * mamakan banyak tempat pada frame gameplay nya"); the dock is one row.
 */
function drawDockInfo(game, ctx, box, action) {
  drawPanel(ctx, box.x, box.y, box.w, box.h, { radius: 14, top: '#3a4190', bottom: '#20244f', lineWidth: 2.4 });
  const x = box.x + 8;
  const row1 = box.y + Math.round(box.h * 0.31);
  const row2 = box.y + Math.round(box.h * 0.72);
  if (action.tint) {
    // the building's own colour behind its icon, as on its circle and roof
    ctx.save();
    ctx.beginPath(); ctx.arc(x + 10, row1, 11.5, 0, TAU);
    ctx.fillStyle = action.tint; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
  }
  drawSurvivalIcon(ctx, action.icon, x + 10, row1, action.tint ? 17 : 20);
  let nameSize = 12;
  const pipW = action.locked ? 34 : action.maxLevel > 1 ? action.maxLevel * 10 + 4 : 0;
  const room = box.w - 32 - pipW - 8;
  while (nameSize > 9 && measureLabel(ctx, action.name, nameSize) > room) nameSize--;
  drawLabel(ctx, action.name, x + 24, row1 + 1, nameSize, '#ffffff', { align: 'left', outline: 2.4 });
  if (action.locked) {
    drawSurvivalIcon(ctx, 'lock', box.x + box.w - 30, row1, 15);
    drawSurvivalIcon(ctx, 'keep', box.x + box.w - 14, row1, 16);
  } else if (action.maxLevel > 1) {
    for (let i = 0; i < action.maxLevel; i++) {
      const px = box.x + box.w - 10 - (action.maxLevel - 1 - i) * 10;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, row1, 3.8, 0, TAU);
      ctx.fillStyle = i < action.level ? '#ffd24a' : 'rgba(255,255,255,0.25)';
      ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    }
  }
  // the stats side by side; a tag (x3 FAN, PIERCE) takes the second seat
  const rows = action.rows.slice(0, 2);
  const cells = rows.map((row) => ({ row, text: row.next != null ? `${row.now} → ${row.next}` : `${row.now}` }));
  let size = 13;
  const cellW = (cell) => 18 + measureLabel(ctx, cell.text, size) + (cell.row.when ? 15 : 0);
  const fit = () => cells.reduce((w, cell) => w + cellW(cell) + 8, 0) + (action.tag ? measureLabel(ctx, action.tag, 9) + 18 : 0);
  while (size > 10 && fit() > box.w - 12) size--;
  let cx = x;
  for (const cell of cells) {
    const { row } = cell;
    drawSurvivalIcon(ctx, row.icon, cx + 8, row2, 16);
    drawLabel(ctx, cell.text, cx + 18, row2 + 1, size, row.next != null ? '#ffffff' : '#e6eaff', { align: 'left', outline: 2.2 });
    if (row.next != null) {
      const before = measureLabel(ctx, `${row.now} → `, size);
      drawLabel(ctx, `${row.next}`, cx + 18 + before, row2 + 1, size, '#7ef08e', { align: 'left', outline: 2.2 });
    }
    let w = 18 + measureLabel(ctx, cell.text, size);
    if (row.when) { drawSurvivalIcon(ctx, row.when, cx + w + 8, row2, 13); w += 15; }
    cx += w + 8;
  }
  if (action.tag) {
    const tw = measureLabel(ctx, action.tag, 9) + 10;
    drawPanel(ctx, cx, row2 - 7, tw, 14, { radius: 7, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 1.4, highlight: false, shadow: false });
    drawLabel(ctx, action.tag, cx + tw / 2, row2 + 0.5, 9, '#3a2400', { outline: 0 });
  }
}

/**
 * Small chips over the circles in view: the building it makes (available),
 * a lock with the keep level (beyond the banner), a gold chevron over a
 * building whose next level you can pay for. Tap one: the Hunter walks there.
 */
/**
 * World height a building's chip floats at: just over the KayKit model
 * (buildings3d.js: the sawmill's roof stands ~170 px, the ballista's swivel
 * ~180, the barracks ~140, the mine's rock ~85).
 */
function chipHeight(type) {
  return type === 'tower' ? 200 : type === 'sawmill' ? 182 : type === 'barracks' ? 158 : type === 'mine' ? 112 : 120;
}

/** A built building's function as icon + number (null: nothing to say). */
function buildingStatus(mode, point) {
  const level = point.level || mode.buildingLevel(point.id) || 1;
  const stats = mode.buildingStats(point.type, level) || {};
  if (point.type === 'mine') return { icon: 'gold', text: `+${stats.yield || 0}`, tail: 'moon', color: '#ffd24a' };
  if (point.type === 'sawmill') return { icon: 'wood', text: `+${stats.dawnWood || 0}`, tail: 'sun', color: '#ffcf8a' };
  if (point.type === 'barracks') return { icon: 'guard', text: `${stats.houses || 0}`, color: '#8fd4ff' };
  if (point.type === 'tower') {
    const tower = (mode.towers || []).find((t) => t.slotId === point.id);
    const kills = tower ? tower.kills || 0 : 0;
    return kills > 0 ? { icon: 'skull', text: `${kills}`, color: '#ffb36a' } : { icon: 'target', text: `${stats.damage || 0}`, color: '#ffb36a' };
  }
  return null;
}

function statusPillWidth(ctx, status) {
  return measureLabel(ctx, status.text, 13) + 24 + (status.tail ? 16 : 0);
}

function drawStatusPill(ctx, x, y, status, alpha = 1) {
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
function drawPlotLabel(ctx, x, y, icon, name, color, full, cost = null, mode = null) {
  if (!full) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, icon, x, y, 17);
    return { x: x - 18, y: y - 18, w: 36, h: 36 };
  }
  const size = 11;
  const costSize = 13;
  const nameW = measureLabel(ctx, name, size);
  const cw = cost && mode && (cost.gold || cost.wood) ? costWidth(ctx, cost, costSize) : 0;
  const pw = nameW + 36 + (cw ? cw + 8 : 0), ph = 24;
  const left = x - pw / 2;
  drawPanel(ctx, left, y - ph / 2, pw, ph, { radius: 12, top: '#2e2b58', bottom: '#1a1736', lineWidth: 2, stroke: INK, highlight: false, shadow: false });
  ctx.save();
  ctx.beginPath(); ctx.arc(left + 13, y, 10, 0, TAU);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  drawSurvivalIcon(ctx, icon, left + 13, y, 15);
  drawLabel(ctx, name, left + 27, y + 1, size, '#ffffff', { align: 'left', outline: 2 });
  if (cw) costRow(ctx, left + 27 + nameW + 8, y, cost, mode, costSize);
  return { x: left, y: y - ph / 2, w: pw, h: ph };
}

/**
 * Tonight at one gate, by day (BUILD 13, V10): a red pill with the moon, then
 * the swarm and its count, an Individual's head and a Breaker's helm where
 * they come. Icons and numbers, no words.
 */
function drawTonightBadge(ctx, x, y, row) {
  const items = [];
  if (row.swarm) items.push({ icon: 'swarm', text: `×${row.swarm}` });
  if (row.individuals) items.push({ icon: 'zombie', text: row.individuals > 1 ? `×${row.individuals}` : '' });
  if (row.breakers) items.push({ icon: 'breaker', text: row.breakers > 1 ? `×${row.breakers}` : '' });
  const size = 14, icon = 20, ph = 28;
  let pw = 10 + 18 + 6 + 4;
  for (const it of items) pw += icon + (it.text ? 3 + measureLabel(ctx, it.text, size) : 0) + 6;
  const left = x - pw / 2;
  drawPanel(ctx, left, y - ph / 2, pw, ph, { radius: ph / 2, top: '#ff6a52', bottom: '#b3261c', lineWidth: 2.2, highlight: false, shadow: false });
  let cx = left + 10;
  drawSurvivalIcon(ctx, 'moon', cx + 9, y, 18);
  cx += 18 + 6;
  for (const it of items) {
    drawSurvivalIcon(ctx, it.icon, cx + icon / 2, y, icon);
    cx += icon;
    if (it.text) {
      cx += 3;
      drawLabel(ctx, it.text, cx, y + 1, size, '#ffffff', { align: 'left', outline: 2.5 });
      cx += measureLabel(ctx, it.text, size);
    }
    cx += 6;
  }
  // BUILD 17 (R8): which wave comes at this gate first, as a pip on the
  // badge's corner — the badges by day were a set of gates, and a set does
  // not say where to stand when the night starts
  if (row.order) {
    const r = 9, cx = left + 2, cy = y - ph / 2 + 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = '#1b1530'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    drawLabel(ctx, String(row.order), cx, cy + 1, 11, '#ffffff', { align: 'center', outline: 0 });
    ctx.restore();
  }
  return { x: left, y: y - ph / 2, w: pw, h: ph };
}

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

function drawTonightChip(game, ctx, w, h) {
  const box = tonightChipBox(game, w, h);
  if (!box) return null;
  const mode = game.survival;
  const call = mode.tonightCall();
  const plan = mode.nightDoors();
  const pad = 10;
  const inner = box.w - pad * 2;
  // the order line, in the longest wording that fits this screen
  let order = null, tier = 'tiny';
  for (const t of ['wide', 'short', 'tiny']) {
    const text = plan.slice(0, 3).map((id) => gateShort(mode.entranceById(id), t)).join(' → ');
    tier = t; order = text;
    if (measureLabel(ctx, text, 12) <= inner) break;
  }
  // the title line: TONIGHT + what the night sends (icons, as everywhere else)
  const counts = [];
  if (call.swarm) counts.push({ icon: 'swarm', text: `${call.swarm}` });
  if (call.runners) counts.push({ icon: 'zombie', text: `${call.runners}` });
  if (call.breakers) counts.push({ icon: 'breaker', text: `${call.breakers}` });
  const titleSize = 10, countSize = 12, iconSize = 16;
  const titleW = measureLabel(ctx, 'TONIGHT', titleSize);
  const countW = (list) => list.reduce((n, it) => n + iconSize + 3 + measureLabel(ctx, it.text, countSize) + 8, 0);
  let shown = counts.slice();
  while (shown.length && titleW + 10 + countW(shown) > inner) shown.pop();
  const line1 = titleW + (shown.length ? 10 + countW(shown) : 0);
  const cw = Math.min(box.w, Math.max(line1, measureLabel(ctx, order, 12)) + pad * 2);
  const x = box.x, y = box.y, ch = box.h;
  drawPanel(ctx, x, y, cw, ch, { radius: 12, top: '#4a51a8', bottom: '#262a66', lineWidth: 2.2 });
  drawLabel(ctx, 'TONIGHT', x + pad, y + 12, titleSize, '#c3caff', { align: 'left', outline: 0 });
  let cx = x + pad + titleW + 10;
  for (const it of shown) {
    drawSurvivalIcon(ctx, it.icon, cx + iconSize / 2, y + 12, iconSize);
    cx += iconSize + 3;
    drawLabel(ctx, it.text, cx, y + 13, countSize, '#ffffff', { align: 'left', outline: 2 });
    cx += measureLabel(ctx, it.text, countSize) + 8;
  }
  drawLabel(ctx, order, x + pad, y + 31, 12, '#ffffff', { align: 'left', outline: 2.5 });
  const drawn = {
    box: { x, y, w: cw, h: ch }, order, tier,
    counts: shown.map((it) => `${it.icon}×${it.text}`),
    breakers: call.breakers, breakerGate: call.breakerGate, first: call.first,
  };
  return drawn;
}

function drawDayWorldLayer(game, ctx, w, h, view) {
  const mode = game.survival;
  const t = clock(game);
  const p = game.player;
  edgeAvoid(game, w, h);
  const here = mode.dayContext();
  let nearestOff = null, nearestD = Infinity;
  const overview = mode.userZoom() <= OVERVIEW_ZOOM;
  const shown = { names: 0, icons: 0, pills: 0, overview };
  // BUILD 11 (playtest 2026-10-17: "lebar benteng dengan component di dalam
  // terlihat sangat padat ... tidak tau build yg mana"): only the circles
  // under the keep's banner show, each with a small label ON its pad in its
  // building's colour; the two nearest within reach of the captain spell the
  // name and cost (BUILD 13), the rest show the icon. A locked circle shows
  // nothing until the banner reaches its yard (no lock badges over the
  // bailey).
  const empty = [];
  for (const point of mode.dayPoints()) {
    if (point.kind === 'keep' || point.kind === 'armory' || point.kind === 'arms') continue;
    if (here && here.id === point.id) continue;
    if (point.locked) continue;
    const built = point.kind === 'slot' ? !!point.built : mode.gateBuilt;
    if (point.kind === 'gate' || !built) {
      if (built) continue;
      const meta = point.kind === 'gate' ? { icon: 'gate', name: 'BARRICADE', color: '#d9a75f' } : (BUILD_META[point.type] || BUILD_META.barracks);
      empty.push({ point, meta, d: Math.hypot(point.x - p.x, point.y - p.y) });
      continue;
    }
    // a building that can go up a level: the arrow over its roof
    if (!(point.level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(point.id)))) continue;
    const at = project(game, point.x, point.y, chipHeight(point.type));
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const bob = Math.sin(t * 4 + point.x * 0.01) * 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(at.x, at.y + bob, 15, 0, TAU);
    ctx.fillStyle = '#fff3c4'; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, 'up', at.x, at.y + bob, 21);
    addHit(game, { x: at.x - 24, y: at.y + bob - 24, w: 48, h: 48 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
  }
  empty.sort((a, b) => a.d - b.d);
  empty.forEach((row) => {
    const { point, meta } = row;
    const at = project(game, point.x, point.y, point.kind === 'gate' ? 60 : 16);
    const inView = at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1;
    if (!inView) {
      if (row.d < nearestD) { nearestD = row.d; nearestOff = { point, at, icon: meta.icon }; }
      return;
    }
    const full = !overview && shown.names < PLOT_NAMES_MAX && row.d <= PLOT_NAME_REACH;
    if (full) shown.names++; else shown.icons++;
    const cost = point.kind === 'gate' ? mode.tuning.gateCost : SURVIVAL_BUILDINGS[point.type];
    const box = drawPlotLabel(ctx, at.x, at.y, meta.icon, meta.name, meta.color, full, cost, mode);
    addHit(game, { x: box.x - 4, y: box.y - 8, w: box.w + 8, h: box.h + 16 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
  });
  // what every built building does, at a glance (R19; playtest 2026-10-16:
  // "bangunan yg di build juga tidak berfungsi"): a mine's gold a night, a
  // sawmill's planks at dawn, the soldiers a barracks houses, a ballista's
  // kills — icon + number, no words
  for (const point of mode.dayPoints()) {
    if (point.kind !== 'slot' || !point.built) continue;
    // near the captain only (V4), never in the overview, always where he stands
    const standing = !!(here && here.id === point.id);
    if (!standing && (overview || Math.hypot(point.x - p.x, point.y - p.y) > STATUS_REACH)) continue;
    const status = buildingStatus(mode, point);
    if (!status) continue;
    // at the bubble's height; beside the upgrade arrow when one is showing
    const at = project(game, point.x, point.y, chipHeight(point.type));
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const arrow = !(here && here.id === point.id) && point.level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(point.id));
    const pw = statusPillWidth(ctx, status);
    const meta = BUILD_META[point.type];
    drawStatusPill(ctx, arrow ? at.x + 22 + pw / 2 : at.x, at.y + (arrow ? 0 : 2), { ...status, tint: meta && meta.color }, standing ? 1 : 0.94);
    shown.pills++;
  }
  // BUILD 14: the two upgrade stations of the south-east district — the
  // armory (the captain's crossbow) and the arms rack (every guard's) — each
  // with its level as a pill when the captain is near, and the gold arrow
  // whenever its next level is affordable (as over a building's roof)
  shown.stations = [];
  for (const point of mode.dayPoints()) {
    if (point.kind !== 'armory' && point.kind !== 'arms') continue;
    if (here && here.id === point.id) continue;
    const arms = point.kind === 'arms';
    const at = project(game, point.x, point.y, arms ? 112 : 104);
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const cost = arms ? mode.armsUpgradeCost() : mode.hunterUpgradeCost();
    const arrow = !!cost && !mode.builderJob && affordable(mode, cost);
    const near = !overview && Math.hypot(point.x - p.x, point.y - p.y) <= STATUS_REACH;
    const status = arms
      ? { icon: 'guard', text: `Lv${mode.armsLevel}`, color: mode.armsLevel >= 3 ? '#ffd24a' : '#9fd0ff', tint: '#3e7bff' }
      : { icon: 'hunter', text: `Lv${mode.hunterLevel}`, color: '#ffd24a', tint: '#ffd24a' };
    const pw = near ? statusPillWidth(ctx, status) : 0;
    if (near) { drawStatusPill(ctx, arrow ? at.x + 22 + pw / 2 : at.x, at.y + (arrow ? 0 : 2), status, 0.94); shown.pills++; }
    if (arrow) {
      const bob = Math.sin(t * 4 + point.x * 0.01) * 2;
      ctx.save();
      ctx.beginPath(); ctx.arc(at.x, at.y + bob, 15, 0, TAU);
      ctx.fillStyle = '#fff3c4'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
      drawSurvivalIcon(ctx, 'up', at.x, at.y + bob, 21);
      addHit(game, { x: at.x - 24, y: at.y + bob - 24, w: 48, h: 48 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
    }
    shown.stations.push({ id: point.id, near, arrow });
  }
  // BUILD 13 (V10, research §7: "info gelombang sebelum malam"; Thronefall's
  // edge icons): tonight's attack by day — every gate it will hit, what comes
  // and how many (the plan the night plays: game/survival.js tonightPlan). In
  // view a red badge over the gate; out of view a red pointer on the edge
  // with the count. Not under the dawn reward (this layer isn't drawn then).
  const tonight = [];
  for (const row of mode.tonightPlan()) {
    const e = row.entrance;
    const at = project(game, e.x, e.y, 120);
    const inView = at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1;
    const total = row.swarm + row.individuals + row.breakers;
    if (inView) drawTonightBadge(ctx, at.x, at.y + Math.sin(t * 3 + e.x * 0.01) * 2, row);
    else drawEdgeMarker(ctx, w, h, at, row.breakers ? 'breaker' : row.swarm ? 'swarm' : 'zombie', '#ff5a4d', view.y0 + 10, h - view.y1 + 10, total);
    tonight.push({ id: row.id, total, inView, order: row.order || 0, swarm: row.swarm, individuals: row.individuals, breakers: row.breakers });
  }
  shown.tonight = tonight;
  game._survivalLabels = shown;   // QA (survival-plotsqa): what the day layer wrote
  // nothing to build in view: one pointer to the nearest empty circle
  if (nearestOff && !here) {
    drawEdgeMarker(ctx, w, h, nearestOff.at, nearestOff.icon, '#ffffff', view.y0 + 10, h - view.y1 + 10);
  }
  // the keep shows its life by day too once it is hurt
  const keep = mode.keep();
  if (mode.keepHp < mode.keepHpMax()) {
    // over the battlements, but never up under the DAY pill (the closer
    // camera puts the keep's top in the HUD band)
    const at = project(game, keep.x, keep.y, 250);
    at.y = Math.max(at.y, view.y0 + 16);
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
      const upgrade = job.kind === 'hunter' || job.kind === 'arms';
      drawSurvivalIcon(ctx, upgrade ? 'up' : 'hammer', at.x, at.y, 22, { rotate: upgrade ? 0 : Math.sin(t * 10) * 0.3 });
    }
  }
  drawHunterBar(game, ctx, p);
  drawFloaters(game, ctx, w, h);
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
  // BUILD 16 (R5): the gold a cleared night's early dawn paid (a clock on the coin)
  if (reward.cleared && reward.cleared.bonus > 0) rows.push({ icon: 'gold', value: `+${reward.cleared.bonus}`, color: '#1f8a3a', badge: 'clock' });
  if (reward.mined) rows.push({ icon: 'mine', value: `+${reward.mined}`, color: '#1f8a3a' });   // dug overnight
  if (reward.sawn) rows.push({ icon: 'sawmill', value: `+${reward.sawn}`, color: '#1f8a3a' });  // the sawmills' planks
  // what the ballistas and the guards brought down tonight (the building MVP)
  if (reward.towerKills) rows.push({ icon: 'tower', value: `${reward.towerKills}`, color: '#3a2a50', badge: 'skull' });
  if (reward.killsBy && reward.killsBy.guard) rows.push({ icon: 'guard', value: `${reward.killsBy.guard}`, color: '#3a2a50', badge: 'skull' });
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
  drawLabel(ctx, `NIGHT ${Math.max(1, mode.nightsCompleted)} ${reward.cleared ? 'CLEARED' : 'SURVIVED'}!`, w / 2, y + (short ? 50 : 62), short ? 18 : 20, '#ffffff', { stroke: '#7a3a00' });
  const cellW = (bw - 40) / cols2;
  const top = y + (short ? 72 : 92);
  rows.forEach((row, i) => {
    const cx = x + 20 + (i % cols2) * cellW;
    const cy = top + Math.floor(i / cols2) * (cellH + gap);
    drawPanel(ctx, cx + 4, cy, cellW - 8, cellH, { radius: 14, top: '#ffffff', bottom: '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + 26, cy + cellH / 2, short ? 24 : 30);
    if (row.badge) drawSurvivalIcon(ctx, row.badge, cx + 36, cy + cellH / 2 + 8, short ? 13 : 15);
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

/** The action dock's size on this screen: one row, bottom right. */
/**
 * BUILD 18 (R18c): what the purse would still have bought by day. Shown under
 * the NIGHT chip while its hold ring fills, so the hold itself is the
 * confirmation ("52 GOLD UNSPENT") — no modal, no second tap.
 */
function unspentNote(mode) {
  let cheapest = null;
  for (const pt of mode.dayPoints()) {
    let cost = null;
    if (pt.kind === 'keep') cost = mode.keepUpgradeCost();
    else if (pt.kind === 'armory') cost = mode.hunterUpgradeCost();
    else if (pt.kind === 'gate') cost = mode.gateBuilt ? null : mode.tuning.gateCost;
    else if (pt.kind === 'slot' && !pt.locked) cost = pt.built ? mode.upgradeCost(pt.id) : mode.buildingCost(pt.type);
    if (cost && mode.canAfford(cost) && (!cheapest || (cost.gold || 0) < (cheapest.gold || 0))) cheapest = cost;
  }
  if (!cheapest) return null;
  return `${Math.floor(mode.gold)} GOLD UNSPENT`;
}

function dockLayout(w, h) {
  const short = h < 560;
  const pad = 12;
  const dockH = short ? 50 : 56;
  const btnW = Math.min(short ? 148 : 164, Math.round(w * 0.24));
  const infoW = Math.min(short ? 182 : 200, Math.round(w * 0.3));
  return { short, pad, dockH, btnW, infoW, y: h - pad - dockH, right: w - pad };
}

function drawDayScreen(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.rewardPending();
  const L = dockLayout(w, h);
  const { short, pad } = L;
  const btnX = L.right - L.btnW;
  const btnY = L.y;
  const view = { x0: 30, x1: w - 30, y0: short ? 70 : 128, y1: btnY - 10 };

  if (!reward) drawDayWorldLayer(game, ctx, w, h, view);

  // the dawn reward is modal: no pause button underneath it
  if (!reward) drawPauseButton(game, ctx, w, h);
  drawPhasePill(game, ctx, w, 'day');
  drawCounters(game, ctx, w, [
    { icon: 'gold', value: Math.floor(mode.gold) },
    { icon: 'wood', value: Math.floor(mode.wood) },
    { icon: 'guard', value: mode.survivors },
  ], short ? 34 : 40);
  // the builder: a small chip while he works (no READY pill when idle)
  const job = mode.builderJob;
  if (job && !reward) {
    const cw = 80, cx = w - cw - 8, cy = 10 + 3 * (short ? 34 : 40);
    drawPanel(ctx, cx, cy, cw, 24, { radius: 12, top: '#4a51a8', bottom: '#262a66', lineWidth: 2 });
    const chipIcon = job.kind === 'hunter' ? 'hunter' : job.kind === 'arms' ? 'crossbow' : 'hammer';
    drawSurvivalIcon(ctx, chipIcon, cx + 13, cy + 12, 18, { rotate: chipIcon === 'hammer' ? Math.sin(clock(game) * 10) * 0.3 : 0 });
    drawBar(ctx, cx + 26, cy + 7, cw - 34, 10, 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1), '#45d06a');
  }

  if (reward) {
    drawRewardModal(game, ctx, w, h);
    return;
  }

  const here = mode.dayContext();
  const action = dayAction(mode, here);
  let dockLeft = w;
  if (action) {
    // one row in the thumb corner: [REPAIR] [info] [BUILD / UPGRADE]
    drawActionButton(game, ctx, { x: btnX, y: btnY, w: L.btnW, h: L.dockH }, action.main);
    const info = { x: btnX - 6 - L.infoW, y: btnY, w: L.infoW, h: L.dockH };
    drawDockInfo(game, ctx, info, action);
    dockLeft = info.x;
    if (action.second) {
      const sw = short ? 124 : 134;
      drawActionButton(game, ctx, { x: info.x - 6 - sw, y: btnY, w: sw, h: L.dockH }, action.second);
      dockLeft = info.x - 6 - sw;
    }
  }
  // NIGHT stands apart from BUILD / UPGRADE (R18a, NN/g: keep the action you
  // cannot take back away from the everyday one): top-left, under PAUSE,
  // across the screen from the thumb's build corner — a chip, not a slab
  const nightBtn = { x: pad, y: pad + (short ? 50 : 58), w: short ? 112 : 124, h: short ? 38 : 42 };
  const nightHoldT = game._uiHoldLabel === 'survival:START NIGHT'
    ? clamp(Math.max(game._uiHoldT || 0, game._kbdHoldT || 0) / mode.tuning.nightHold, 0, 1) : 0;
  const nightItem = drawButton(game, ctx, nightBtn, `NIGHT ${mode.day}`,
    () => mode.startNight(), { id: 'START NIGHT', icon: 'moon', color: 'purple', disabled: !!job, fontSize: short ? 14 : 15, hold: mode.tuning.nightHold, holdT: nightHoldT });
  // while the ring fills: what the day would still have bought (R18c); after
  // a tap that left early: the chip says what it wants instead of starting
  const holdT = nightItem.holdT || 0;
  const holdNote = holdT > 0 ? unspentNote(mode) : null;
  const miss = game._uiHoldMiss && game._uiHoldMiss.label === nightItem.label ? game._uiHoldMiss : null;
  if (miss) offerSurvivalHint(game, 'holdnight');
  if (mode._newBanner) offerSurvivalHint(game, 'watch');
  if (!reward && (holdNote || miss)) {
    drawLabel(ctx, holdNote || 'HOLD TO START', nightBtn.x + nightBtn.w / 2, nightBtn.y + nightBtn.h + 11,
      10, holdNote ? '#ffd76a' : '#fff3c4', { align: 'center', outline: 2.5 });
  }
  if (game._survivalLabels) game._survivalLabels.nightHold = { holdT, note: holdNote, miss: !!miss };

  // BUILD 17 (R8): what tonight is, read in one line before the day's builds
  // are committed — the gates in order and what the night sends
  const tonightChip = !reward ? drawTonightChip(game, ctx, w, h) : null;
  if (game._survivalLabels) game._survivalLabels.tonightChip = tonightChip;

  // BUILD 22 (H3/R22): day 2's objective chain under the NIGHT chip
  const dayChain = !reward ? drawObjectiveChain(game, ctx, w, h, false) : null;
  if (game._survivalLabels) game._survivalLabels.objectiveChain = dayChain;

  drawZoomButtons(game, ctx, w, h);
  drawRecenterChip(game, ctx, w, h);
  // FTUE chip: a sideways phone puts it at the foot of the screen between the
  // stick and the dock (the top band shows the keep); a tall screen under
  // the pill
  if (short) {
    const left = 140, right = Math.min(dockLeft, w - pad) - 10;
    drawHint(game, ctx, w, h - pad - 36, (left + right) / 2, Math.min(right - left, 440), 12);
  } else drawHint(game, ctx, w, 136, w / 2, Math.min(w - 24, 420));
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

function drawZoomButtons(game, ctx, w, h) {
  const mode = game.survival;
  if (!mode || mode.cine || typeof mode.zoomStep !== 'function') return;
  const L = zoomButtonLayout(w, h);
  const [lo, hi] = SURVIVAL_CAMERA.zoom;
  const goal = mode.zoomGoal();
  for (const row of [
    { id: 'ZOOM IN', at: L.zoomIn, dir: 1, end: goal >= hi - 1e-3 },
    { id: 'ZOOM OUT', at: L.zoomOut, dir: -1, end: goal <= lo + 1e-3 },
  ]) {
    const { x, y } = row.at;
    const r = L.r;
    addHit(game, { x: x - r - 4, y: y - r - 4, w: r * 2 + 8, h: r * 2 + 8 }, row.id, () => mode.zoomStep(row.dir));
    ctx.save();
    ctx.globalAlpha = row.end ? 0.45 : 0.94;
    ctx.beginPath();
    ctx.arc(x, y + 3, r, 0, TAU);
    ctx.fillStyle = 'rgba(20,16,40,0.45)';
    ctx.fill();
    const g = ctx.createLinearGradient(0, y - r, 0, y + r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#dde4ff');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // the glyph: a fat plus / minus in ink
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * 0.22);
    ctx.strokeStyle = '#2a2350';
    const k = r * 0.46;
    ctx.beginPath();
    ctx.moveTo(x - k, y); ctx.lineTo(x + k, y);
    if (row.dir > 0) { ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The view has been dragged off the captain: a small chip with his face at
 * the top of the screen brings it back (so does walking, or a tap on free
 * ground).
 */
function recenterChipBox(game, w, h) {
  const mode = game.survival;
  if (!mode || mode.cine || typeof mode.cameraOffset !== 'function' || mode.cameraOffset() < 90) return null;
  const short = h < 560;
  const bw = 96, bh = 30;
  return { x: w / 2 - bw / 2, y: short ? (mode.phase === 'night' ? 80 : 60) : (mode.phase === 'night' ? 112 : 92), w: bw, h: bh };
}

function drawRecenterChip(game, ctx, w, h) {
  const box = recenterChipBox(game, w, h);
  if (!box) return;
  const mode = game.survival;
  const bw = box.w, bh = box.h;
  const x = box.x;
  const y = box.y;
  addHit(game, { x: x - 4, y: y - 4, w: bw + 8, h: bh + 8 }, 'RECENTER', () => mode.recenterCamera());
  drawPanel(ctx, x, y, bw, bh, { radius: 15, top: '#ffffff', bottom: '#e3e8ff', lineWidth: 2, highlight: false });
  drawSurvivalIcon(ctx, 'hunter', x + 16, y + bh / 2, 22);
  drawLabel(ctx, 'CAPTAIN', x + 30, y + bh / 2 + 1, 11, '#2a2350', { align: 'left', outline: 0 });
}

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

/**
 * The build this page runs (index.html's DUSKHOLD_BUILD): printed small in
 * the HUD's corner and on the pause panel, so a screenshot from a phone says
 * which build it came from (2026-10-17: the build on a playtester's screen
 * was not the build in the branch).
 */
const BUILD = (typeof window !== 'undefined' && window.DUSKHOLD_BUILD) ? String(window.DUSKHOLD_BUILD) : 'dev';
function drawBuildStamp(ctx, x, y, align = 'left', size = 9) {
  drawLabel(ctx, `BUILD ${BUILD}`, x, y, size, 'rgba(255,255,255,0.72)', { align, outline: 2 });
}

function drawPausePanel(game, ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const bw = Math.min(300, w - 32), bh = 292;
  const x = (w - bw) / 2, y = (h - bh) / 2;
  drawPanel(ctx, x, y, bw, bh, { radius: 22, top: '#3a4190', bottom: '#20244f', lineWidth: 3 });
  drawSurvivalIcon(ctx, 'pause', w / 2, y + 36, 34);
  drawLabel(ctx, 'PAUSED', w / 2, y + 74, 22, '#ffffff');
  drawButton(game, ctx, { x: x + 28, y: y + 100, w: bw - 56, h: 50 }, 'RESUME',
    () => game.resumeSurvival(), { id: 'RESUME', icon: 'play', color: 'green' });
  drawButton(game, ctx, { x: x + 28, y: y + 162, w: bw - 56, h: 44 }, 'RESTART',
    () => game.survival.restart(), { id: 'RESTART 3-DAY RUN', icon: 'restart', color: 'red' });
  // BUILD 20 (R21): the ladder is visible before a run ends — Vampire
  // Survivors keeps its Unlocks in the menu for a reason
  const mode = game.survival;
  const us = mode.unlockSummary ? mode.unlockSummary() : null;
  if (us) {
    const ly = y + 232;
    drawLabel(ctx, `CAPTAIN'S WATCH ★${us.total}`, w / 2, ly, 11, '#cdd3ff', { outline: 0 });
    const seg = (bw - 56) / UNLOCK_TIERS.length;
    const cur = UNLOCK_TIERS.find((u) => u.id === us.tier) || UNLOCK_TIERS[0];
    const nextTier = UNLOCK_TIERS.find((u) => u.name === us.next) || null;
    UNLOCK_TIERS.forEach((t, i) => {
      const cx = x + 28 + seg * i + seg / 2;
      const earned = t.stars <= cur.stars;
      const here = t.id === cur.id;
      const isNext = nextTier && t.id === nextTier.id;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, ly + 22, here ? 8 : 6.5, 0, Math.PI * 2);
      ctx.fillStyle = earned ? `#${t.royal.toString(16).padStart(6, '0')}` : 'rgba(255,255,255,0.14)';
      ctx.fill();
      if (here) { ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      else if (isNext) { ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([3, 3]); ctx.stroke(); }
      ctx.restore();
      drawLabel(ctx, here ? t.name.split(' ')[0] : (isNext ? `${nextTier.stars - us.total}★` : ''), cx, ly + 38, 9,
        here ? '#ffffff' : 'rgba(255,255,255,0.6)', { outline: 0 });
    });
    if (game._survivalLabels) game._survivalLabels.pauseLadder = { tier: us.tier, next: us.next, total: us.total };
  }
  drawBuildStamp(ctx, w / 2, y + bh - 10, 'center', 10);
}

/** m:ss for the end panel's run clock. */
function runTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** When each closed run's panel first showed (its stars pop in from there). */
const END_SHOWN = new WeakMap();

/**
 * The end panel's rows, top to bottom (offsets from the panel's top), so the
 * panel's height is known before anything is drawn: icon + title, the band
 * (stars on a win, the dawn track on a loss), the run's numbers, the crew row
 * and the MVP line, the foot (records on a win, the tip on a loss), PLAY AGAIN.
 */
function endLayout(short, failed, boxRows) {
  const k = short ? 1 : 1.16;
  const o = { k };
  o.title = Math.round(48 * k);
  o.band = o.title + Math.round(18 * k);
  o.boxes = o.band + Math.round((failed ? 50 : 62) * k);
  o.boxH = Math.round(50 * k);
  const below = o.boxes + boxRows * (o.boxH + 8) + 2;
  o.crew = below + Math.round(12 * k);
  o.mvp = o.crew + Math.round(26 * k);
  o.foot = o.mvp + Math.round(28 * k);
  o.unlock = o.foot + Math.round(22 * k);   // BUILD 19 (R9): the watch ladder line
  o.button = o.unlock + Math.round(22 * k);
  o.buttonH = short ? 48 : 54;
  o.h = o.button + o.buttonH + Math.round(18 * k);
  return o;
}

/**
 * The end of a run (UX-REPLAY-RESEARCH §5 P0). A win: up to three stars (the
 * next one's goal under them), the run's numbers, the crew and the MVP
 * building, the records. A loss: how close dawn was on the night's track, the
 * same numbers and one tip read off what happened. "NEW BEST!" when a record
 * fell. The numbers are the whole run's, never the last night's.
 */
function drawEndPanel(game, ctx, w, h, failed) {
  const mode = game.survival;
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.66)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const run = mode.runStats || { kills: 0, by: {} };
  const by = run.by || {};
  const res = (mode.endSummary && mode.endSummary()) || { stars: 0, nights: 0, kills: run.kills || 0, built: 0, time: 0, keepLeft: 0, toDawn: 0, progress: 0, night: mode.day };
  const t = clock(game);
  if (!END_SHOWN.has(res)) END_SHOWN.set(res, t);
  const age = t - END_SHOWN.get(res);
  const short = h < 560;
  const bw = Math.min(short ? 480 : 520, w - 32);
  const cols = bw >= 440 ? 5 : 3;
  const stats = [
    { icon: 'moon', value: `${res.nights}/3` },
    { icon: 'skull', value: `${res.kills}` },
    failed ? { icon: 'keep', value: `Lv${mode.keepLevel}` } : { icon: 'keep', value: `${res.keepLeft}%` },
    { icon: 'hammer', value: `${res.built}` },
    { icon: 'clock', value: runTime(res.time) },
  ];
  const L = endLayout(short, failed, Math.ceil(stats.length / cols));
  const bh = L.h;
  const x = (w - bw) / 2, y = Math.max(short ? 30 : 40, (h - bh) / 2 + 8);
  const light = !failed;
  const ink = light ? '#3a2a50' : '#ffffff';
  drawPanel(ctx, x, y, bw, bh, failed
    ? { radius: 22, top: '#4a3a6a', bottom: '#241a3a', lineWidth: 3 }
    : { radius: 22, top: '#fff6e0', bottom: '#ffd890', lineWidth: 3 });
  const reason = String(mode.failureReason || '');
  const keepFell = /KEEP/i.test(reason);
  const icon = failed ? (keepFell ? 'keep' : 'skull') : 'trophy';
  drawSurvivalIcon(ctx, icon, w / 2, y + 2, Math.round(62 * L.k), { gray: failed && keepFell });
  const title = failed ? (keepFell ? 'THE KEEP FELL' : 'THE CAPTAIN FELL') : 'REINFORCEMENTS ARRIVED!';
  drawLabel(ctx, title, w / 2, y + L.title, Math.round(20 * L.k), '#ffffff', { stroke: failed ? INK : '#7a3a00' });
  // the reveal, in order: the earned stars slam in one by one, then the line
  // under them, then NEW BEST! (a loss opens straight on its numbers)
  const landed = failed ? 0.3 : 0.2 + Math.max(1, res.stars) * 0.28 + 0.1;

  if (!failed) {
    // the stars: earned ones pop in one by one, the middle one raised
    const size = Math.round(36 * L.k), gap = Math.round(48 * L.k);
    for (let i = 0; i < 3; i++) {
      const sx = w / 2 + (i - 1) * gap;
      const sy = y + L.band + Math.round(18 * L.k) - (i === 1 ? 6 : 0);
      const earned = i < res.stars;
      // each earned star slams in (big → its slot) 0.28 s after the last
      const p = clamp((age - 0.2 - i * 0.28) / 0.26, 0, 1);
      drawSurvivalIcon(ctx, 'starEmpty', sx, sy, size);
      if (earned && p > 0) drawSurvivalIcon(ctx, 'star', sx, sy, size * (1 + 0.35 * (1 - p)), { alpha: Math.min(1, p * 1.6) });
    }
    const next = res.stars >= 3 ? 'FLAWLESS DEFENCE!' : (res.stars === 2 ? 'NEXT STAR: LOSE NO GUARDS' : 'NEXT STAR: KEEP ABOVE HALF HP');
    drawLabel(ctx, next, w / 2, y + L.band + Math.round(48 * L.k), Math.round(13 * L.k), res.stars >= 3 ? '#1f8a3a' : '#7a5a2a',
      { outline: 0, alpha: clamp((age - landed) / 0.25, 0, 1) });
  } else {
    // the near miss: how far into the night the keep held, and how close dawn was
    const close = res.toDawn <= 10;
    const label = close ? `SO CLOSE! ${res.toDawn}s TO DAWN` : `NIGHT ${res.night} · ${res.toDawn}s TO DAWN`;
    drawLabel(ctx, label, w / 2, y + L.band + Math.round(6 * L.k), Math.round(15 * L.k), close ? '#ffd24a' : '#ffffff', { stroke: INK });
    const ty = y + L.band + Math.round(30 * L.k);
    const tx0 = x + 64, tx1 = x + bw - 64;
    const bar = Math.round(10 * L.k);
    drawSurvivalIcon(ctx, 'moon', tx0 - 22, ty, Math.round(22 * L.k));
    drawSurvivalIcon(ctx, 'sun', tx1 + 22, ty, Math.round(24 * L.k));
    ctx.save();
    roundRectPath(ctx, tx0, ty - bar / 2, tx1 - tx0, bar, bar / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fill();
    const fx = tx0 + (tx1 - tx0) * clamp(res.progress || 0, 0, 1);
    if (fx > tx0 + 2) {
      const grad = ctx.createLinearGradient(tx0, 0, tx1, 0);
      grad.addColorStop(0, '#5a63c8'); grad.addColorStop(1, '#ffb84a');
      roundRectPath(ctx, tx0, ty - bar / 2, fx - tx0, bar, bar / 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    roundRectPath(ctx, tx0, ty - bar / 2, tx1 - tx0, bar, bar / 2);
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, keepFell ? 'keep' : 'skull', fx, ty - 1, Math.round(24 * L.k), { gray: true });
  }

  // the run in numbers: nights held, every kill of the run, the keep (HP
  // left at dawn on a win, its level on a loss), buildings standing, time
  const cellW = (bw - 40) / cols;
  stats.forEach((row, i) => {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, stats.length - r * cols);
    const cx = x + 20 + (bw - 40 - inRow * cellW) / 2 + (i % cols) * cellW;
    const cy = y + L.boxes + r * (L.boxH + 8);
    drawPanel(ctx, cx + 4, cy, cellW - 8, L.boxH, { radius: 14, top: failed ? '#5a4a80' : '#ffffff', bottom: failed ? '#3a2d5a' : '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + cellW / 2, cy + Math.round(16 * L.k), Math.round(24 * L.k));
    drawLabel(ctx, row.value, cx + cellW / 2, cy + L.boxH - Math.round(13 * L.k), Math.round(15 * L.k), ink, { outline: failed ? 3 : 0 });
  });

  // who held the walls: the captain, the guards, the ballistas (+ keep roof);
  // the MVP's group wears the gold tag and the line under it names the MVP
  const mvp = res.mvp || null;
  const mvpGroup = mvp ? (mvp.id === 'guard' ? 'guard' : 'tower') : null;
  const crew = [
    { id: 'captain', icon: 'hunter', value: (by.captain || 0) + (by.flare || 0) },
    { id: 'guard', icon: 'guard', value: by.guard || 0 },
    { id: 'tower', icon: 'tower', value: (by.tower || 0) + (by.keep || 0) },
  ];
  const crewW = (bw - 40) / 3;
  const ry = y + L.crew;
  crew.forEach((row, i) => {
    const cx = x + 20 + i * crewW + crewW / 2;
    if (row.id === mvpGroup) {
      ctx.save();
      roundRectPath(ctx, cx - 44, ry - 15, 88, 30, 15);
      ctx.fillStyle = light ? 'rgba(255,196,60,0.45)' : 'rgba(255,196,60,0.28)';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#e0a020'; ctx.stroke();
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, cx + 22, ry - 25, 38, 18, 9);
      ctx.fillStyle = '#ffcf3a'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
      drawLabel(ctx, 'MVP', cx + 41, ry - 16, 11, INK, { outline: 0, weight: 900 });
    }
    drawSurvivalIcon(ctx, row.icon, cx - 20, ry, Math.round(24 * L.k));
    drawSurvivalIcon(ctx, 'skull', cx - 8, ry + 8, 12);
    drawLabel(ctx, `${row.value}`, cx + 4, ry + 1, Math.round(17 * L.k), ink, { align: 'left', outline: failed ? 3 : 0 });
  });
  if (mvp) {
    drawLabel(ctx, `MVP: ${mvp.name} · ${mvp.kills} KILLS`, w / 2, y + L.mvp, Math.round(13 * L.k), light ? '#8a5a00' : '#ffd24a', { outline: light ? 0 : 3 });
  }

  const bestP = res.newBest ? clamp((age - landed - 0.15) / 0.25, 0, 1) : 0;
  if (bestP > 0) {
    // the record fell: a gold tag stamps onto the panel's corner, then breathes
    ctx.save();
    ctx.globalAlpha *= bestP;
    ctx.translate(x + bw - 52, y + 18);
    ctx.rotate(0.2);
    const sc = (1 + 0.4 * (1 - bestP)) * (1 + 0.05 * Math.sin(t * 5));
    ctx.scale(sc, sc);
    roundRectPath(ctx, -50, -14, 100, 28, 14);
    const grad = ctx.createLinearGradient(0, -14, 0, 14);
    grad.addColorStop(0, '#ffe27a'); grad.addColorStop(1, '#f0a21a');
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    drawLabel(ctx, 'NEW BEST!', 0, 1, 14, '#ffffff', { stroke: '#7a3a00' });
    ctx.restore();
  }

  const fy = y + L.foot;
  if (failed && res.tip) {
    // one tip, read off what happened (R4); on a narrow panel the words
    // shrink to fit the pill rather than run out of it
    let size = Math.round(14 * L.k);
    while (size > 10 && measureLabel(ctx, res.tip.text, size) + 58 > bw - 40) size--;
    const pw = Math.min(bw - 40, measureLabel(ctx, res.tip.text, size) + 58);
    drawPanel(ctx, w / 2 - pw / 2, fy - 15, pw, 30, { radius: 15, top: '#fff6e0', bottom: '#f1dfb8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, res.tip.icon, w / 2 - pw / 2 + 22, fy, 22);
    drawLabel(ctx, res.tip.text, w / 2 - pw / 2 + 40, fy + 1, size, '#3a2a50', { align: 'left', outline: 0 });
  } else if (!failed) {
    const rec = mode.records || {};
    drawLabel(ctx, `WINS ${rec.wins || 0}/${rec.runs || 0} · TOTAL KILLS ${rec.totalKills || 0}`, w / 2, fy, Math.round(13 * L.k), '#7a5a2a', { outline: 0 });
  }
  // BUILD 19 (R9): every closed run names the watch ladder — what the banked
  // stars earned, the next colour and the stars still owed to it
  const us = mode.unlockSummary ? mode.unlockSummary() : null;
  if (us) {
    const ua = clamp((age - landed) / 0.25, 0, 1);
    const ucol = us.unlocked ? '#b8860b' : (failed ? '#ffd8a8' : '#7a5a2a');
    const usize = Math.round(12 * L.k);
    if (us.banked) {
      // BUILD 20 (H5): what the run banked slams in first, then the ladder line
      const wp = measureLabel(ctx, us.prefix, usize);
      const wr = measureLabel(ctx, us.text.slice(us.prefix.length), usize);
      const x0 = w / 2 - (wp + wr) / 2;
      const pop = clamp((age - landed - 0.1) / 0.3, 0, 1);
      ctx.save();
      const sc = 1 + 0.6 * (1 - pop);
      ctx.translate(x0 + wp / 2, y + L.unlock); ctx.scale(sc, sc); ctx.translate(-(x0 + wp / 2), -(y + L.unlock));
      drawLabel(ctx, us.prefix, x0, y + L.unlock, usize, failed ? '#ffd24a' : '#b8860b',
        { align: 'left', outline: failed ? 2.5 : 0, alpha: ua });
      ctx.restore();
      drawLabel(ctx, us.text.slice(us.prefix.length), x0 + wp, y + L.unlock, usize, ucol,
        { align: 'left', outline: failed ? 2.5 : 0, alpha: ua });
    } else {
      drawLabel(ctx, us.text, w / 2, y + L.unlock, usize, ucol,
        { outline: failed ? 2.5 : 0, alpha: ua });
    }
    if (game._survivalLabels) game._survivalLabels.endUnlock = us;
  }

  drawButton(game, ctx, { x: x + 30, y: y + L.button, w: bw - 60, h: L.buttonH }, 'PLAY AGAIN',
    () => mode.restart(), { id: 'PLAY AGAIN', icon: 'restart', color: 'green' });
}

/* ------------------------------------------------------------------ */
/* K1 bookends: the opening and the reinforcements' arrival            */
/* ------------------------------------------------------------------ */

/**
 * Letterbox bars, one caption at a time (icon + title in a chip above the
 * lower bar, the line under it inside the bar) and "TAP TO SKIP" — a label,
 * not a button: the whole screen is the skip target (`survival:SKIP`).
 */
function drawCine(game, ctx, w, h) {
  const mode = game.survival;
  const c = mode.cine;
  const bar = Math.round(clamp(h * 0.11, 30, 76));
  const open = Math.min(clamp(c.t / 0.35, 0, 1), clamp((c.dur - c.t) / 0.4, 0, 1));
  const eased = 1 - (1 - open) * (1 - open);
  const bh = Math.round(bar * eased);
  ctx.save();
  ctx.fillStyle = '#07060d';
  ctx.fillRect(0, 0, w, bh);
  ctx.fillRect(0, h - bh, w, bh);
  ctx.restore();

  const cap = mode.cineCaption();
  if (cap) drawCineCaption(game, ctx, w, h, cap, bar, bh);
  if (c.kind === 'intro' && cap && cap.track) drawCaptainMarker(game, ctx, cap);

  const armed = c.t >= CINE.armAfter;
  if (armed && bh > 18) drawLabel(ctx, 'TAP TO SKIP', w - 16, h - bh / 2, 11, '#ffffff', { align: 'right', alpha: 0.62, outline: 0 });
  addHit(game, { x: 0, y: 0, w, h }, 'SKIP', () => mode.skipCine(), !armed);
}

function drawCineCaption(game, ctx, w, h, cap, bar, bh) {
  const fadeIn = clamp(cap.age / 0.3, 0, 1);
  const fadeOut = clamp(cap.left / 0.3, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);
  if (alpha <= 0) return;
  const dawn = cap.tone === 'dawn';
  let size = h < 560 ? 21 : 26;
  const trackW = cap.track ? 132 : 0;
  let textW = measureLabel(ctx, cap.title, size);
  while (size > 14 && textW + trackW + 78 > w - 28) { size -= 1; textW = measureLabel(ctx, cap.title, size); }
  const cw = Math.min(w - 28, textW + trackW + 78);
  const ch = h < 560 ? 48 : 58;
  const x = w / 2 - cw / 2;
  const y = h - bar - ch - 10 + (1 - fadeIn) * 10;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawPanel(ctx, x, y, cw, ch, dawn
    ? { radius: 20, top: '#ffd65a', bottom: '#f08c1a', lineWidth: 3 }
    : { radius: 20, top: '#5a62b8', bottom: '#343a7e', lineWidth: 3 });
  drawSurvivalIcon(ctx, cap.icon, x + 32, y + ch / 2, ch * 0.74);
  drawLabel(ctx, cap.title, x + 60, y + ch / 2 + 1, size, '#ffffff', { align: 'left', stroke: dawn ? '#7a3a00' : INK });
  if (cap.track) drawCineTrack(game, ctx, x + 60 + textW + 18, y + ch / 2, trackW - 18);
  ctx.restore();
  // the line under the title reads inside the lower bar
  if (cap.sub && bh > 16) {
    drawLabel(ctx, cap.sub, w / 2, h - bh / 2, h < 560 ? 13 : 15, dawn ? '#ffe7a8' : '#e8ebff', { alpha: alpha * 0.95, outline: 0 });
  }
}

/** The goal in the opening: three nights, then the reinforcements' banner. */
function drawCineTrack(game, ctx, x, y, width) {
  const step = (width - 26) / 3;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + width - 14, y); ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 3; i++) drawSurvivalIcon(ctx, 'moon', x + 9 + i * step, y, 22);
  const bob = Math.sin(clock(game) * 5) * 1.5;
  drawSurvivalIcon(ctx, 'banner', x + width - 8, y - 2 + bob, 28);
}

/** "This is you": a bouncing chevron over the Hunter while the camera finds him. */
function drawCaptainMarker(game, ctx, cap) {
  const p = game.player;
  if (!p) return;
  const at = project(game, p.x, p.y, 92 * ACTOR);
  const bob = Math.abs(Math.sin(clock(game) * 4.2)) * 7;
  const alpha = clamp(cap.age / 0.3, 0, 1) * clamp(cap.left / 0.4, 0, 1);
  const s = 13;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(at.x, at.y - bob);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.9); ctx.lineTo(0, s * 0.35); ctx.lineTo(s, -s * 0.9);
  ctx.lineTo(s * 0.55, -s * 1.15); ctx.lineTo(0, -s * 0.38); ctx.lineTo(-s * 0.55, -s * 1.15);
  ctx.closePath();
  ctx.fillStyle = '#ffd24a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
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
  // BUILD 17: the day layer owns game._survivalLabels — the record QA reads
  // off the screen. On a frame that does not draw it (night, the cine, the
  // pause panel, an end panel) the day's labels must go with it, or a probe
  // reads last day's TONIGHT chip while the night HUD is up.
  const mode0 = game.survival;
  if (game._survivalLabels && (!mode0 || mode0.phase !== 'day' || mode0.cine || game.screen === 'paused')) {
    game._survivalLabels.tonightChip = null;
    game._survivalLabels.tonight = [];
  }
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
  if (game.survival.cine) { drawCine(game, ctx, w, h); return; }
  const phase = game.survival.phase;
  if (phase === 'day') { drawDayScreen(game, ctx, w, h); drawBuildStamp(ctx, 10, h - 8); return; }
  if (phase === 'complete') { drawEndPanel(game, ctx, w, h, false); return; }
  if (phase === 'failed') { drawEndPanel(game, ctx, w, h, true); return; }
  drawNightHud(game, ctx, w, h);
  drawBuildStamp(ctx, 10, h - 8);
}

export { COLORS };
