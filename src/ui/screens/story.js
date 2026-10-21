/* DUSKHOLD — Story beats: the opening-adjacent intro card and the between-night narration (Phase 3 split of ui/screens.js). */

import { clamp } from '../../core/util.js';
import { SERIF, SANS, MONO, isPhone, uiButton, buttonVisual, drawValenShade, drawPlateGrade, wrapText } from './shared.js';

export function drawIntro(game, ctx, w, h) {
  // A brief, wordless hand-off into play. Keep the world visible; do not put a
  // paragraph, title card, or cinematic copy between the player and control.
  const fade = clamp(1 - (game.introT || 0) / Math.max(0.01, game.introLen || 0.55), 0, 1);
  ctx.save();
  ctx.fillStyle = `rgba(3,4,8,${0.22 * fade})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ================= pause ================= */


/* ================= the narrator's plate =================
 *
 * Legacy narration is told, not only murmured on the strip. Two surfaces share
 * this plate: the opening narration (three authored lines, in her voice, with
 * the house answering) and the act-title cards at each act turn. Same grade as a dawn-card, different typography: Valen is
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

