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
  drawBearings(game, ctx, w, h);
  drawThreat(game, ctx, w, h);
  drawGoals(game, ctx, w, h);
}

/* ---------------- top left: tonight's goals (the night's purpose) ---------------- */

function drawGoals(game, ctx, w, h) {
  const st = game.objectives && game.objectives.hudState();
  if (!st) return;
  const narrow = w < 620;
  // The clock plate owns the top centre. If the goal panel would crawl into
  // it (phones, short landscape), drop the list under the rail instead.
  const x = 14;
  const clockClear = h * 0.055 + 52;
  const collide = x + 190 > w / 2 - 120;
  const y = (narrow || collide) ? Math.max(clockClear, 78) : 16;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 10px ${SANS}`;
  setLetter(ctx, 3);
  ctx.fillStyle = 'rgba(200,160,74,0.75)';
  ctx.fillText(`GOALS ${st.done}/${st.total}`, x, y);
  let ly = y + 16;
  for (const g of (narrow ? st.open.slice(0, 2) : st.open)) {
    const maxW = narrow ? w - 30 : Math.min(210, w * 0.3);
    ctx.font = `400 10px ${SANS}`;
    setLetter(ctx, 1);
    ctx.fillStyle = 'rgba(178,172,160,0.6)';
    let label = g.label;
    // never let the goal panel crawl under the clock plate (desktop)
    const safe = narrow ? maxW : Math.min(maxW, w * 0.5 - 130 - x);
    while (ctx.measureText(label).width > safe && label.length > 6) label = label.slice(0, -2);
    ctx.fillText(label, x, ly);
    // micro progress bar
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, ly + 7, maxW * 0.5, 2.5);
    ctx.fillStyle = 'rgba(200,160,74,0.6)';
    ctx.fillRect(x, ly + 7, maxW * 0.5 * g.progress, 2.5);
    ly += 22;
  }
  if (st.bank > 0) {
    ctx.font = `400 9px ${MONO}`;
    ctx.fillStyle = 'rgba(200,160,74,0.45)';
    ctx.fillText(`◆ ${st.bank} BANKED`, x, ly + 2);
  }
  ctx.restore();

  // completion banner under the clock
  const b = game.objectives.banner;
  if (b) {
    const a = b.t < 0.4 ? b.t / 0.4 : clamp(1 - (b.t - 3.2) / 0.8, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `500 15px ${SERIF}`;
    setLetter(ctx, 5);
    ctx.fillStyle = '#c8a04a';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText('✓ ' + b.text, w / 2, h * 0.145);
    ctx.restore();
  }
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

  // readability plate: clock digits never fight chandeliers or moonlight —
  // one soft dark ellipse, industry-standard HUD grounding
  const plate = ctx.createRadialGradient(cx, y - 4, 10, cx, y - 4, 150);
  plate.addColorStop(0, 'rgba(2,3,7,0.62)');
  plate.addColorStop(0.7, 'rgba(2,3,7,0.28)');
  plate.addColorStop(1, 'rgba(2,3,7,0)');
  ctx.save();
  ctx.translate(cx, y - 4);
  ctx.scale(1.5, 0.62);
  ctx.translate(-cx, -(y - 4));
  ctx.fillStyle = plate;
  ctx.beginPath(); ctx.arc(cx, y - 4, 150, 0, TAU); ctx.fill();
  ctx.restore();

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
  // Thumbs own the bottom (Vampire Survivors / Hades mobile). Blood sits just
  // above the stick well so the hunger readout is never under the finger.
  const stick = game.input && game.input.stick;
  const stickTop = stick ? (stick.homeY || h - 120) - (stick.r || 52) : h - 80;
  const phone = w < 840 || h < 500;
  const x = 14;
  const barW = phone ? Math.min(w - 36, 280) : Math.min(168, Math.max(120, w * 0.28));
  const barH = phone ? 16 : 12;
  const plateH = phone ? 52 : 34;
  const y = game.input && game.input.gameplay
    ? Math.max(8, Math.min(h - plateH - 8, stickTop - plateH - 10))
    : h - plateH - 16;
  const pct = p.bloodPct;
  const low = p.lowBlood;
  const critical = pct < 0.14;

  ctx.save();
  ctx.fillStyle = 'rgba(8,6,8,0.78)';
  ctx.fillRect(x - 8, y - 22, barW + 16, plateH);
  ctx.strokeStyle = low ? 'rgba(180,40,48,0.7)' : 'rgba(140,110,70,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 21.5, barW + 15, plateH - 1);
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${phone ? 13 : 11}px ${SANS}`;
  setLetter(ctx, 1);
  ctx.fillStyle = low ? `rgba(220,${120 - 60 * Math.sin(game.time * 5)},110,0.95)` : 'rgba(190,180,165,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText('BLOOD', x, y - 10);

  ctx.font = `400 ${phone ? 13 : 11}px ${MONO}`;
  ctx.fillStyle = 'rgba(200,160,74,0.9)';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(pct * 100) + '%', x + barW, y - 10);

  const scale = 1 + pulse * 0.06 * (low ? 1.8 : 0.4);
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(-2, -2, barW + 4, barH + 4);
  ctx.fillStyle = 'rgba(40,16,20,0.85)';
  ctx.fillRect(0, 0, barW, barH);
  if (pct > 0) {
    const gg = ctx.createLinearGradient(0, 0, 0, barH);
    if (critical) { gg.addColorStop(0, '#ff4a50'); gg.addColorStop(1, '#6e0c14'); }
    else if (low) { gg.addColorStop(0, '#d03842'); gg.addColorStop(1, '#5a0c14'); }
    else { gg.addColorStop(0, '#a81e2c'); gg.addColorStop(1, '#4a0a12'); }
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, barW * pct, barH);
    ctx.fillStyle = 'rgba(255,190,190,0.22)';
    ctx.fillRect(0, 0, barW * pct, 2);
  }
  ctx.strokeStyle = 'rgba(200,170,140,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, barW - 1, barH - 1);
  // quarter ticks — you can read "about half" without the number
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 4; i++) ctx.fillRect(barW * i / 4, 0, 1, barH);
  ctx.scale(1 / scale, 1 / scale);
  ctx.translate(-x, -y);

  if (low) {
    const a = 0.5 + 0.5 * Math.sin(game.time * (critical ? 8 : 4));
    ctx.font = `500 10px ${SANS}`;
    setLetter(ctx, 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(230,60,60,${a})`;
    ctx.fillText(critical ? 'THE HUNGER IS TAKING YOU' : 'YOU NEED BLOOD', x, y + 26);
  }
  ctx.restore();
}

/* ---------------- bottom right: actions ---------------- */

function drawActions(game, ctx, w, h) {
  const p = game.player;
  const input = game.input;
  const live = !!(input && input.gameplay);
  // Planks sit above the right thumb cluster, never on top of CLAW.
  // The previous build referenced an undeclared `touch` and threw every frame,
  // which killed the HUD — and the loop — the moment the night started.
  const clusterTop = live && input.buttons.interact
    ? input.buttons.interact.y - input.buttons.interact.r - 18
    : h - 78;
  const px = w - 18;
  const py = live ? clusterTop : h - 36;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `500 11px ${SANS}`;
  setLetter(ctx, 2);
  ctx.fillStyle = p.planks > 0 ? 'rgba(205,180,140,0.9)' : 'rgba(130,120,110,0.55)';
  ctx.fillText(`PLANKS  ${p.planks}`, px, py - 14);
  for (let i = 0; i < Math.min(p.planks, 6); i++) {
    ctx.fillStyle = 'rgba(120,86,48,0.9)';
    ctx.fillRect(px - 6 - i * 9, py, 6, 14);
    ctx.fillStyle = 'rgba(190,150,100,0.18)';
    ctx.fillRect(px - 6 - i * 9, py, 6, 2);
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
  const rank = (d) => (d.attackers > 0 ? 4 : 0) + (d.broken ? 2 : 0) + (1 - d.hp / Math.max(1, d.hpMax));
  shown.sort((a, b) => rank(b) - rank(a));
  const list = shown.slice(0, 4);
  const x = w - 18;
  let y = Math.max(88, h * 0.14);
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `500 11px ${SANS}`;
  setLetter(ctx, 2);
  const barW = Math.min(76, w * 0.16);
  for (const d of list) {
    const pct = clamp(d.hp / d.hpMax, 0, 1);
    const barH = 5;
    const bw = x - barW;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bw - 1, y - 1, barW + 2, barH + 2);
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
    const bear = bearing(game, d.x, d.y);
    let name = d.broken ? `${d.name} BROKEN` : d.name;
    const maxName = Math.max(72, bw - 36);
    while (ctx.measureText(name + '  ' + bear.card).width > maxName && name.length > 4) name = name.slice(0, -1);
    ctx.fillText(name + `  ${bear.card}`, bw - 22, y + 2);
    // wedge points the way to run — letters alone are a translation step
    ctx.save();
    ctx.translate(bw - 12, y + 2);
    ctx.rotate(bear.screen);
    ctx.fillStyle = d.attackers > 0 ? 'rgba(220,70,60,0.95)' : 'rgba(210,200,180,0.8)';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
    ctx.restore();
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
  // --- interaction prompt for the nearest entrance ---
  const target = game.interactTarget;
  if (target) {
    const e = target.ent;
    const defs = target.actions;
    const anchor = promptAnchor(e);
    const y = anchor.y;
    const ax = anchor.x;
    ctx.save();
    if (game.renderer.upright) game.renderer.upright(ctx, ax, y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `${e.name}`;
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(230,225,210,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(label, ax, y - 16);
    ctx.shadowBlur = 0;
    ctx.font = `400 12px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    const parts = defs.map((d) => `${verbFor(d)}${d.cost ? ` (${d.cost} plank${d.cost > 1 ? 's' : ''})` : ''}`);
    ctx.fillStyle = target.disabled ? 'rgba(150,140,130,0.55)' : 'rgba(215,205,185,0.92)';
    ctx.fillText(parts.join('   '), ax, y);
    ctx.restore();

    // durability bar above the door (only while you are close to it)
    const hpPct = clamp(e.hp / e.hpMax, 0, 1);
    if (hpPct < 1 || e.barricade) {
      const bw = 84;
      ctx.save();
      ctx.translate(ax - bw / 2, y + 20);
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
    }
  }
}

/* ================= direction helpers ================= */

const CARDS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

function bearing(game, x, y) {
  const p = game.player;
  const tilt = (game.renderer && game.renderer.tilt) || 1;
  const dx = x - p.x;
  const dy = y - p.y;
  const world = Math.atan2(dy, dx);
  const screen = Math.atan2(dy * tilt, dx);
  const idx = Math.round(((world % TAU) + TAU) % TAU / (Math.PI / 4)) % 8;
  return { world, screen, card: CARDS[idx] };
}

function promptAnchor(e) {
  const d = 54;
  if (e.facing === 'north') return { x: e.x, y: e.y - d };
  if (e.facing === 'south') return { x: e.x, y: e.y + d };
  if (e.facing === 'east') return { x: e.x + d, y: e.y };
  if (e.facing === 'west') return { x: e.x - d, y: e.y };
  return { x: e.x, y: e.y - d };
}

function verbFor(d) {
  if (d.act === 'repair') return 'HOLD FIX';
  if (d.act === 'barricade') return 'BOARD';
  if (d.act === 'drink') return 'HOLD USE';
  if (d.act === 'open') return 'USE';
  return d.label;
}

/** Screen-edge chevrons. Hades-style: if it is off camera, the edge points at it. */
function drawBearings(game, ctx, w, h) {
  if (!game.knocks || !game.knocks.length || !game.renderer.worldToScreen) return;
  const margin = 36;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 10px ${SANS}`;
  setLetter(ctx, 2);
  for (const k of game.knocks) {
    const e = game.mansion.entranceById(k.entranceId);
    if (!e) continue;
    const sp = game.renderer.worldToScreen(e.x, e.y);
    if (sp.x > margin && sp.x < w - margin && sp.y > 64 && sp.y < h - margin) continue;
    const cx = w / 2, cy = h / 2;
    const ang = Math.atan2(sp.y - cy, sp.x - cx);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hx = w / 2 - 46, hy = h / 2 - 52;
    const tx = Math.abs(dx) > 0.001 ? hx / Math.abs(dx) : 1e9;
    const ty = Math.abs(dy) > 0.001 ? hy / Math.abs(dy) : 1e9;
    const t = Math.min(tx, ty);
    const x = cx + dx * t, y = cy + dy * t;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(game.time * 4));
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = pulse;
    ctx.rotate(ang);
    ctx.fillStyle = '#e6dcc4';
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
    ctx.rotate(-ang);
    ctx.fillStyle = 'rgba(230,220,196,0.9)';
    ctx.fillText('KNOCK', 0, 16);
    ctx.restore();
  }
  ctx.restore();
}

/* ================= touch controls =================
 * Visible on every device during the night. Vampire Survivors players
 * learned the hard way that an invisible joystick makes direction feel
 * random; Hades puts a cooldown on the button itself, not in a manual.
 */

export function drawTouchControls(game, ctx, w, h) {
  const input = game.input;
  if (!input || !input.gameplay) return;
  const alive = game.screen === 'playing' || game.screen === 'dying';
  const p = game.player;
  ctx.save();
  ctx.globalAlpha = alive ? 1 : 0.28;

  const s = input.stick;
  if (s.active) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200,195,180,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, s.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(10,10,16,0.32)';
    ctx.beginPath(); ctx.arc(s.ox, s.oy, s.r, 0, TAU); ctx.fill();
    // cardinal ticks so "up" is obvious
    ctx.strokeStyle = 'rgba(200,195,180,0.28)';
    ctx.beginPath();
    ctx.moveTo(s.ox, s.oy - s.r + 6); ctx.lineTo(s.ox, s.oy - s.r + 12);
    ctx.stroke();
    const kx = s.ox + s.dx * s.r * s.mag, ky = s.oy + s.dy * s.r * s.mag;
    if (s.mag > 0.08) {
      ctx.strokeStyle = 'rgba(200,210,230,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.ox, s.oy); ctx.lineTo(kx, ky); ctx.stroke();
    }
    const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, 22);
    kg.addColorStop(0, 'rgba(230,224,208,0.72)');
    kg.addColorStop(1, 'rgba(120,116,110,0.16)');
    ctx.fillStyle = kg;
    ctx.beginPath(); ctx.arc(kx, ky, 22, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(230,224,208,0.55)';
    ctx.beginPath(); ctx.arc(kx, ky, 22, 0, TAU); ctx.stroke();
    ctx.restore();
  } else {
    const hx = s.homeX || w * 0.16, hy = s.homeY || h - 120, hr = s.r || 52;
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.strokeStyle = 'rgba(200,195,180,0.22)';
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 10px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(200,195,180,0.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MOVE', hx, hy);
    ctx.restore();
  }

  const drawBtn = (b, label, hint, opts = {}) => {
    if (!b || b.hidden) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    const pressed = b.down ? 1 : 0;
    const hot = b.hot ? 1 : 0;
    const r = b.r * (1 - pressed * 0.06) + (b.pulse || 0) * 3;
    const cd = opts.cd || 0;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${opts.big ? '96,22,32' : '28,30,42'},${0.62 + pressed * 0.2 + hot * 0.08})`);
    g.addColorStop(1, 'rgba(8,9,14,0.4)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${opts.big ? '210,90,98' : hot ? '210,186,120' : '170,175,200'},${0.4 + pressed * 0.35 + hot * 0.25})`;
    ctx.lineWidth = hot ? 2.5 : 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    if (cd > 0.02) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r - 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cd));
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
    }
    ctx.font = `500 ${r < 28 ? 9 : 11}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = cd > 0.02 ? 'rgba(180,174,160,0.55)' : 'rgba(232,226,210,0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, hint && w > 720 ? -2 : 0);
    if (hint && w > 720) {
      ctx.font = `400 8px ${MONO}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(190,182,168,0.55)';
      ctx.fillText(hint, 0, 10);
    }
    ctx.restore();
  };
  const dashCd = p && PLAYER.dashCooldown ? clamp(p.dashCd / PLAYER.dashCooldown, 0, 1) : 0;
  const atkCd = p && PLAYER.attackCooldown ? clamp(p.attackCd / PLAYER.attackCooldown, 0, 1) : 0;
  drawBtn(input.buttons.attack, 'CLAW', 'F', { big: true, cd: atkCd });
  drawBtn(input.buttons.dash, 'DASH', 'SHIFT', { cd: dashCd });
  drawBtn(input.buttons.interact, 'USE', 'E');
  drawBtn(input.buttons.repair, 'FIX', 'R');
  drawBtn(input.buttons.barricade, 'BOARD', 'B');
  ctx.restore();
}
