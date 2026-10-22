/* DUSKHOLD — The night HUD: keep bar, banner, guard counter, the world layer (edge markers, hunter bars, status pills) and the HUD composition (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { SURVIVAL_ACTOR_SCALE } from '../../core/config.js';
import { GUARD } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel, drawBar, INK, COLORS } from '../survivalIcons.js';
import { TAU, clock, project, onScreen, edgeAvoid, nightPointerBand, drawEdgeMarker, drawFloaters, drawHunterBar, drawStatusPill, drawCounters, drawPauseButton, ACTOR, BUILD } from './shared.js';
import { drawPhasePill, drawObjectiveChain } from './chain.js';
import { drawHint } from './hints.js';
import { drawZoomButtons, drawRecenterChip } from './controls.js';

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


export function drawNightHud(game, ctx, w, h) {
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
