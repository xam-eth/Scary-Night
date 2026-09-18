/* LAST NIGHT — HUD & in-world prompts
 *
 * Rules taken from the design brief:
 *  - the screen must stay readable but never become a spreadsheet
 *  - top centre: the night clock. bottom left: blood. bottom right: actions
 *  - door durability lives in the *world*, attached to the door, not on the HUD
 *  - the knock is communicated by sound first, then by a discreet marker
 */

import { clamp, lerp, damp, fmtClock, TAU } from '../core/util.js';
import { PAL } from '../core/render.js';
import { PLAYER, UPGRADES, SHARDS } from '../core/config.js';

const SERIF = 'Georgia, "Palatino Linotype", "Times New Roman", serif';
const SANS = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'Consolas, "SF Mono", Menlo, monospace';

function setLetter(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
}

export function drawHUD(game, ctx, w, h) {
  const p = game.player;
  const pulse = game.hbPulse;
  drawClock(game, ctx, w, h, pulse);
  drawBlood(game, ctx, w, h, pulse);
  drawActions(game, ctx, w, h);
  drawDoorStatus(game, ctx, w, h);
  drawThreat(game, ctx, w, h);
}

/* ---------------- top centre: the night clock ---------------- */

function drawClock(game, ctx, w, h, pulse) {
  const cx = w / 2;
  const y = h * 0.055;
  const t = game.time;
  const phase = game.phase;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // label
  ctx.font = `500 13px ${SANS}`;
  setLetter(ctx, 5);
  const labelA = 0.5 + 0.25 * Math.sin(t * 1.4) * (game.danger > 0.5 ? 1 : 0.4);
  ctx.fillStyle = `rgba(190,180,160,${labelA})`;
  ctx.fillText(phase.id === 'panic' || phase.id === 'silence' ? 'PANIC' : 'DAWN IN', cx, y - 26);

  // clock
  const timeLeft = clamp(game.timeLeft, 0, 999);
  const clockStr = fmtClock(timeLeft);
  const critical = timeLeft < 61;
  ctx.font = `400 ${critical ? 46 : 40}px ${MONO}`;
  setLetter(ctx, 1);
  const glow = 0.35 + game.danger * 0.4 + pulse * 0.25;
  if (critical) {
    // red pulse as the night runs out
    const k = Math.min(1, (61 - timeLeft) / 60);
    ctx.shadowColor = `rgba(190,30,40,${0.5 + 0.4 * Math.sin(t * 6)})`;
    ctx.shadowBlur = 18 + 10 * Math.sin(t * 6);
    ctx.fillStyle = `rgb(${230 - k * 20 | 0},${215 - k * 90 | 0},${200 - k * 80 | 0})`;
  } else {
    ctx.shadowColor = `rgba(150,170,220,${glow * 0.6})`;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e8e3d4';
  }
  ctx.fillText(clockStr, cx, y + 8);
  ctx.shadowBlur = 0;

  // tick marks — a very thin progress rail so the player can feel time moving
  const railW = 190;
  const railY = y + 36;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - railW / 2 - 1, railY - 1, railW + 2, 4);
  ctx.fillStyle = 'rgba(150,160,190,0.28)';
  ctx.fillRect(cx - railW / 2, railY, railW, 2);
  const pr = clamp(game.time / game.nightDuration, 0, 1);
  const g = ctx.createLinearGradient(cx - railW / 2, 0, cx + railW / 2, 0);
  g.addColorStop(0, '#3a4a72'); g.addColorStop(0.6, '#7d1220'); g.addColorStop(1, '#b8202e');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(cx - railW / 2, railY, railW * pr, 2);
  // phase pips
  ctx.globalAlpha = 0.6;
  for (const ph of [60, 120, 180, 240, 270, 290]) {
    const x = cx - railW / 2 + (ph / 300) * railW;
    ctx.fillStyle = ph === 290 ? 'rgba(210,60,60,0.9)' : 'rgba(200,195,180,0.45)';
    ctx.fillRect(x, railY - 3, 1.5, 8);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ---------------- bottom left: blood ---------------- */

function drawBlood(game, ctx, w, h, pulse) {
  const p = game.player;
  const x = 34, y = h - 52;
  const cells = 10;
  const cw = 15, gap = 3.5;
  const pct = p.bloodPct;
  const low = p.lowBlood;
  const critical = pct < 0.14;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = `500 12px ${SANS}`;
  setLetter(ctx, 4);
  ctx.fillStyle = low ? `rgba(220,${120 - 60 * Math.sin(game.time * 5)},110,0.95)` : 'rgba(190,180,165,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('BLOOD', x, y - 20);

  ctx.font = `400 12px ${MONO}`;
  ctx.fillStyle = 'rgba(190,180,165,0.5)';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(pct * 100) + '%', x + cells * (cw + gap) - gap, y - 20);

  // cells
  const scale = 1 + pulse * 0.08 * (low ? 1.6 : 0.6);
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  for (let i = 0; i < cells; i++) {
    const fill = clamp(pct * cells - i, 0, 1);
    const cx = i * (cw + gap);
    // frame
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx - 1, -1, cw + 2, 20);
    ctx.fillStyle = 'rgba(120,110,100,0.18)';
    ctx.fillRect(cx, 0, cw, 18);
    if (fill > 0) {
      const gg = ctx.createLinearGradient(cx, 0, cx, 18);
      if (critical) { gg.addColorStop(0, '#ff3a44'); gg.addColorStop(1, '#7d0f18'); }
      else if (low) { gg.addColorStop(0, '#c8323c'); gg.addColorStop(1, '#5e0d16'); }
      else { gg.addColorStop(0, '#9c1a26'); gg.addColorStop(1, '#4a0a12'); }
      ctx.fillStyle = gg;
      ctx.fillRect(cx, 18 * (1 - fill), cw, 18 * fill);
      // highlight
      ctx.fillStyle = 'rgba(255,180,180,0.18)';
      ctx.fillRect(cx, 18 * (1 - fill), cw, 1.5);
    }
    ctx.strokeStyle = fill > 0 ? 'rgba(255,90,90,0.18)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, 0.5, cw - 1, 17);
  }
  ctx.scale(1 / scale, 1 / scale);
  ctx.translate(-x, -y);

  // warning text
  if (low) {
    const a = 0.5 + 0.5 * Math.sin(game.time * (critical ? 8 : 4));
    ctx.font = `500 12px ${SANS}`;
    setLetter(ctx, 3);
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(230,60,60,${a})`;
    ctx.fillText(critical ? 'THE HUNGER IS TAKING YOU' : 'YOU NEED BLOOD', x, y + 40);
  }
  ctx.restore();
}

/* ---------------- bottom right: actions ---------------- */

function drawActions(game, ctx, w, h) {
  const p = game.player;
  const x = w - 40, y = h - 48;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const touch = game.input.touchSeen;

  // dash cooldown ring
  const cd = clamp(1 - p.dashCd / PLAYER.dashCooldown, 0, 1);
  const r = 26;
  ctx.save();
  ctx.translate(x - 132, y);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(140,150,180,0.22)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = cd >= 1 ? 'rgba(180,200,240,0.85)' : 'rgba(120,140,190,0.6)';
  ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * cd); ctx.stroke();
  ctx.font = `500 10px ${SANS}`; setLetter(ctx, 2);
  ctx.fillStyle = 'rgba(200,205,220,0.75)';
  ctx.textAlign = 'center';
  ctx.fillText('DASH', 0, 0);
  ctx.restore();

  // claw readiness
  ctx.save();
  ctx.translate(x - 132 + 74, y);
  const ready = p.attackCd <= 0 && p.blood > 1;
  ctx.strokeStyle = ready ? 'rgba(200,140,150,0.7)' : 'rgba(120,90,100,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(-6, i * 7 - 3);
    ctx.quadraticCurveTo(2, i * 7 + 5, 9, i * 7 + 1);
  }
  ctx.stroke();
  ctx.font = `500 10px ${SANS}`; setLetter(ctx, 2);
  ctx.fillStyle = 'rgba(200,205,220,0.75)';
  ctx.textAlign = 'center';
  ctx.fillText('CLAW', 0, 26);
  ctx.restore();

  // planks
  ctx.textAlign = 'right';
  ctx.font = `500 13px ${SANS}`;
  setLetter(ctx, 3);
  ctx.fillStyle = p.planks > 0 ? 'rgba(205,180,140,0.9)' : 'rgba(130,120,110,0.6)';
  ctx.fillText(`PLANKS  ${p.planks}`, x, y - 46);
  // little plank icons
  for (let i = 0; i < Math.min(p.planks, 6); i++) {
    ctx.fillStyle = 'rgba(120,86,48,0.9)';
    ctx.fillRect(x - 6 - i * 9, y - 32, 6, 16);
    ctx.fillStyle = 'rgba(190,150,100,0.18)';
    ctx.fillRect(x - 6 - i * 9, y - 32, 6, 2);
  }
  ctx.restore();
}

/* ---------------- door status readout (world) ---------------- */

function drawDoorStatus(game, ctx, w, h) {
  // A small compass-like list of the four doors: only appears when a door is
  // damaged or being attacked. This is the "which entrance should I protect?"
  // decision surface, kept as far from the centre of the screen as possible.
  const doors = game.mansion.doors;
  const shown = doors.filter((d) => d.hp < d.hpMax - 1 || d.attackers > 0 || d.broken || game.time - (d.lastTouched || -99) < 6);
  if (!shown.length) return;
  const x = w - 34;
  let y = 96;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `500 11px ${SANS}`;
  setLetter(ctx, 2);
  for (const d of shown) {
    const pct = clamp(d.hp / d.hpMax, 0, 1);
    const barW = 76, barH = 5;
    const bw = x - barW;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bw - 1, y - 1, barW + 2, barH + 2);
    const dmg = 1 - pct;
    const col = d.broken ? '#2a2a30' : pct > 0.6 ? '#6a6a52' : pct > 0.3 ? '#8a6a2a' : '#9c1a26';
    ctx.fillStyle = col;
    ctx.fillRect(bw, y, barW * pct, barH);
    if (d.attackers > 0) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin(game.time * 7));
      ctx.strokeStyle = `rgba(220,40,40,${a})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bw - 1.5, y - 1.5, barW + 3, barH + 3);
    }
    ctx.fillStyle = d.broken ? 'rgba(200,80,80,0.85)' : 'rgba(190,180,165,0.75)';
    ctx.fillText(d.broken ? `${d.name} — BROKEN` : d.name, bw - 10, y + 2);
    y += 22;
  }
  ctx.restore();
}

/* ---------------- threat pulse / low blood frame ---------------- */

function drawThreat(game, ctx, w, h) {
  const p = game.player;
  // a subtle red frame when something is actively hunting you
  const chased = game.enemies.some((e) => !e.dead && e.seenPlayer > 0 && Math.hypot(e.x - p.x, e.y - p.y) < 520);
  if (chased || game.player.lowBlood) {
    const a = (game.hbPulse * 0.12) + (chased ? 0.05 : 0.02);
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(120,10,20,${a})`);
    g.addColorStop(0.25, 'rgba(0,0,0,0)');
    g.addColorStop(0.75, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(120,10,20,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

/* ================= in-world prompts ================= */

export function drawWorldPrompts(game, ctx) {
  const p = game.player;
  const t = game.time;
  const cam = game.renderer.cam;

  // --- interaction prompt for the nearest entrance ---
  const target = game.interactTarget;
  if (target) {
    const e = target.ent;
    const defs = target.actions;
    const y = e.y + (e.facing === 'north' ? -58 : 58);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `${e.name}`;
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(230,225,210,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(label, e.x, y - 16);
    ctx.shadowBlur = 0;
    ctx.font = `400 12px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    const parts = defs.map((d) => `[${d.key}] ${d.label}${d.cost ? ` (${d.cost} plank${d.cost > 1 ? 's' : ''})` : ''}`);
    ctx.fillStyle = target.disabled ? 'rgba(150,140,130,0.55)' : 'rgba(215,205,185,0.92)';
    ctx.fillText(parts.join('   '), e.x, y);
    ctx.restore();

    // durability bar above the door (only while you are close to it)
    const hpPct = clamp(e.hp / e.hpMax, 0, 1);
    if (hpPct < 1 || e.barricade) {
      const bw = 84;
      ctx.save();
      ctx.translate(e.x - bw / 2, y + 20);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-2, -2, bw + 4, 9);
      ctx.fillStyle = 'rgba(90,80,70,0.4)';
      ctx.fillRect(0, 0, bw, 5);
      const col = hpPct > 0.6 ? '#7d8a5a' : hpPct > 0.3 ? '#a8802a' : '#a01824';
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, bw * hpPct, 5);
      if (e.barricade > 0) {
        ctx.fillStyle = 'rgba(150,110,60,0.9)';
        for (let i = 0; i < e.barricade + 1; i++) ctx.fillRect(bw + 3 + i * 4, 0, 3, 5);
      }
      ctx.restore();
    }
  }

  // --- floating combat text ---
  ctx.save();
  ctx.textAlign = 'center';
  for (const ct of game.combatTexts) {
    const a = clamp(ct.life / 0.9, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = ct.color;
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText(ct.text, ct.x, ct.y);
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // --- knock markers: you heard it, so you get a direction, not an answer ---
  for (const k of game.knocks) {
    const e = game.mansion.entranceById(k.entranceId);
    if (!e) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > 1000) continue;
    const onScreen = game.renderer.isVisible(e.x, e.y, -40);
    if (onScreen) {
      // a question mark hovering over the door
      const bob = Math.sin(t * 3) * 3;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `400 22px ${SERIF}`;
      const a = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.shadowColor = `rgba(0,0,0,0.9)`; ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(220,215,200,${0.35 + a * 0.45})`;
      ctx.fillText('?', e.x, e.y - 60 + bob);
      ctx.restore();
    } else {
      // edge arrow pointing at it
      const cx = cam.x, cy = cam.y;
      const ang = Math.atan2(e.y - cy, e.x - cx);
      const rad = Math.min(cam.viewW, cam.viewH) * 0.42;
      const sx = (e.x - cx) / (cam.viewW / 2), sy = (e.y - cy) / (cam.viewH / 2);
      ctx.save();
      ctx.translate(Math.cos(ang) * rad, Math.sin(ang) * rad);
      ctx.rotate(ang);
      const a = 0.3 + 0.4 * Math.abs(Math.sin(t * 4));
      ctx.fillStyle = `rgba(215,205,190,${a})`;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

/* ================= touch controls (mobile) ================= */

export function drawTouchControls(game, ctx, w, h) {
  const input = game.input;
  const alive = game.screen === 'playing' || game.screen === 'dying';
  if (!input.touchSeen) return;
  ctx.save();
  ctx.globalAlpha = alive ? 1 : 0.28;

  // ---- virtual stick ----
  if (input.stick.active) {
    const s = input.stick;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,195,180,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, s.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(10,10,16,0.28)';
    ctx.beginPath(); ctx.arc(s.ox, s.oy, s.r, 0, TAU); ctx.fill();
    // knob
    const kx = s.ox + s.dx * s.r * s.mag, ky = s.oy + s.dy * s.r * s.mag;
    const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, 26);
    kg.addColorStop(0, 'rgba(220,215,200,0.5)');
    kg.addColorStop(1, 'rgba(120,116,110,0.12)');
    ctx.fillStyle = kg;
    ctx.beginPath(); ctx.arc(kx, ky, 26, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(220,215,200,0.35)';
    ctx.beginPath(); ctx.arc(kx, ky, 26, 0, TAU); ctx.stroke();
    ctx.restore();
  } else {
    // hint circle where the stick will appear
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.strokeStyle = 'rgba(200,195,180,0.10)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(w * 0.18, h - 130, 62, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 10px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(200,195,180,0.25)';
    ctx.textAlign = 'center';
    ctx.fillText('MOVE', w * 0.18, h - 130);
    ctx.restore();
  }

  // ---- buttons ----
  const drawBtn = (b, label, icon, big) => {
    if (b.hidden) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    const p = b.down ? 1 : 0;
    const r = b.r * (1 - p * 0.06) + b.pulse * 4;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${big ? '90,20,30' : '28,30,42'},${0.55 + p * 0.2})`);
    g.addColorStop(1, 'rgba(8,9,14,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${big ? '200,80,90' : '170,175,200'},${0.35 + p * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.font = `500 ${big ? 12 : 11}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(225,220,205,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  };
  drawBtn(input.buttons.attack, 'CLAW');
  drawBtn(input.buttons.dash, 'DASH');
  drawBtn(input.buttons.interact, 'E');
  drawBtn(input.buttons.repair, 'REPAIR');
  drawBtn(input.buttons.barricade, 'BOARD');
  ctx.restore();
}
