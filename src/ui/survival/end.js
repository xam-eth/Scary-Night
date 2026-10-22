/* DUSKHOLD — Pause panel and the run-end panels (victory/defeat debrief, unlock ladder) (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { UNLOCK_TIERS } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel, roundRectPath, INK } from '../survivalIcons.js';
import { clock, drawButton, drawBuildStamp, BUILD } from './shared.js';

export function drawPausePanel(game, ctx, w, h) {
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
export function drawEndPanel(game, ctx, w, h, failed) {
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
