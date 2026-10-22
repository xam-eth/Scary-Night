/* DUSKHOLD — The coach hints of the survival night (offer/update/draw) — save-backed, so a hint never repeats across runs (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { writeSave } from '../../core/save.js';
import { GUARD } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel } from '../survivalIcons.js';
import { clock, BUILD } from './shared.js';

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

export function drawHint(game, ctx, w, y, cx = w / 2, maxW = w - 24, size = 14) {
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

