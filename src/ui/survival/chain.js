/* DUSKHOLD — The chain-objective widget: phase pill with the goal track, the objective chain card and the night timeline (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { drawSurvivalIcon, drawLabel, drawPanel, drawBar, INK } from '../survivalIcons.js';
import { TAU, clock, timeLabel, BUILD } from './shared.js';

export function drawPhasePill(game, ctx, w, phase) {
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
export function drawObjectiveChain(game, ctx, w, h, night) {
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
