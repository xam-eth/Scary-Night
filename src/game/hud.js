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
import { unlocked, projectDawn, LANES } from './economy.js';

const SERIF = 'Georgia, "Palatino Linotype", "Times New Roman", serif';
const SANS = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'Consolas, "SF Mono", Menlo, monospace';

function setLetter(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
}

export function hudEmphasis(game) {
  const p = game.player;
  const doors = game.mansion && game.mansion.entrances.some((e) => e.attackers > 0);
  const knock = !!(game.director && game.director.knock);
  const panic = game.phase && (game.phase.id === 'panic' || game.phase.id === 'silence');
  const hungry = !!(p && (p.lowBlood || game.hungerFailing));
  const floor = 0.28;
  let clock = 0.72, blood = 0.5, door = 0.4, goals = 0.66, actions = 0.8, badge = 0.4;
  if (!hungry && !doors && !panic) { clock = 1; goals = 0.92; blood = 0.52; }
  if (doors) { door = 1; blood = 0.88; goals = 0.44; clock = 0.7; }
  if (knock) { door = Math.max(door, 0.86); clock = Math.max(clock, 0.9); }
  if (hungry) { blood = 1; clock = 0.9; goals = 0.4; badge = 0.36; }
  if (panic) { clock = 1; blood = 1; goals = 0.4; actions = 1; door = doors ? 1 : 0.46; badge = 0.34; }
  const a = (v) => Math.max(floor, v);
  return { clock: a(clock), blood: a(blood), door: a(door), goals: a(goals), actions: a(actions), badge: a(badge) };
}

function withPriority(ctx, em, ax, ay, draw) {
  ctx.save();
  const s = 0.9 + em * 0.12;
  ctx.translate(ax, ay);
  ctx.scale(s, s);
  ctx.translate(-ax, -ay);
  draw();
  ctx.restore();
}

function drawTopScrim(ctx, w, h) {
  const scrimH = Math.min(132, h * 0.18);
  const g = ctx.createLinearGradient(0, 0, 0, scrimH);
  g.addColorStop(0, 'rgba(4,5,10,0.78)');
  g.addColorStop(1, 'rgba(4,5,10,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, scrimH);
  ctx.restore();
}

export function drawHUD(game, ctx, w, h) {
  const pulse = game.hbPulse;
  const em = hudEmphasis(game);
  const phone = w < 840 || h < 500;
  drawTopScrim(ctx, w, h);
  drawTopBar(game, ctx, w, h, em, pulse);
  drawBuildBadge(game, ctx, w, h, em.badge);
  withPriority(ctx, em.clock, w / 2, phone ? 58 : h * 0.07, () => drawClock(game, ctx, w, h, pulse, em.clock));
  withPriority(ctx, em.door, w - 48, phone ? 108 : 96, () => drawDoorStatus(game, ctx, w, h, em.door));
  drawBearings(game, ctx, w, h);
  drawThreat(game, ctx, w, h);
  withPriority(ctx, em.goals, 48, phone ? 108 : 108, () => drawGoals(game, ctx, w, h, em.goals));
  drawGuidanceStrip(game, ctx, w, h);
}

/* ---------------- top left: tonight's goals (the night's purpose) ---------------- */

function drawBuildBadge(game, ctx, w, h, em) {
  if (!unlocked(game.save, 'builds')) return;
  const builds = (game.save && game.save.builds) || {};
  let best = null;
  let n = 0;
  for (const lane of LANES) {
    const owned = lane.ranks.filter((r) => builds[r.id]).length;
    if (owned > n) { n = owned; best = lane; }
  }
  if (!best) return;
  ctx.save();
  ctx.globalAlpha = em;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `500 10px ${SANS}`;
  setLetter(ctx, 1.2);
  ctx.fillStyle = 'rgba(206,186,140,0.8)';
  ctx.fillText(best.name.replace('THE ', ''), w - 14, phoneHud(w, h).short ? 28 : 34);
  ctx.restore();
}

function phoneHud(w, h) {
  return { phone: w < 840 || h < 500, short: h < 500 };
}

function drawGoals(game, ctx, w, h, em = 1) {
  const st = game.objectives && game.objectives.hudState();
  if (!st) return;
  const { phone, short } = phoneHud(w, h);
  if (phone) {
    // One chip. The night is the picture; a goal spreadsheet is not.
    const x = 14;
    const y = short ? 64 : 100;
    ctx.save();
    ctx.globalAlpha = em;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 12px ${SANS}`;
    setLetter(ctx, 0.6);
    ctx.fillStyle = 'rgba(200,160,74,0.9)';
    ctx.fillText(`GOALS ${st.done}/${st.total}`, x, y);
    if (!short && st.open[0]) {
      ctx.font = `400 11px ${SANS}`;
      setLetter(ctx, 0.3);
      ctx.fillStyle = 'rgba(178,172,160,0.75)';
      let label = st.open[0].label;
      const maxW = Math.min(132, (game.input && game.input.clusterLeft ? game.input.clusterLeft - 28 : w * 0.34));
      while (ctx.measureText(label).width > maxW && label.length > 6) label = label.slice(0, -2);
      ctx.fillText(label, x, y + 16);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y + 26, maxW, 3);
      ctx.fillStyle = 'rgba(200,160,74,0.7)';
      ctx.fillRect(x, y + 26, maxW * st.open[0].progress, 3);
    }
    ctx.restore();
    const b = game.objectives.banner;
    if (b) {
      const a = b.t < 0.4 ? b.t / 0.4 : clamp(1 - (b.t - 3.2) / 0.8, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = `500 ${short ? 12 : 14}px ${SERIF}`;
      setLetter(ctx, 1);
      ctx.fillStyle = '#c8a04a';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      let text = '✓ ' + b.text;
      while (ctx.measureText(text).width > w - 28 && text.length > 8) text = text.slice(0, -2);
      ctx.fillText(text, w / 2, short ? h * 0.42 : h * 0.16);
      ctx.restore();
    }
    return;
  }
  const narrow = w < 620;
  // The clock plate owns the top centre. If the goal panel would crawl into
  // it (phones, short landscape), drop the list under the rail instead.
  const x = 14;
  const clockClear = h * 0.055 + 52;
  const collide = x + 190 > w / 2 - 120;
  const y = (narrow || collide) ? Math.max(clockClear, 78) : 16;
  ctx.save();
  ctx.globalAlpha = em;
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

function drawClock(game, ctx, w, h, pulse, em = 1) {
  const { phone, short } = phoneHud(w, h);
  const cx = w / 2;
  const y = short ? 36 : phone ? 58 : h * 0.07;
  const t = game.time;
  const phase = game.phase;

  ctx.save();
  ctx.globalAlpha = em;
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
  ctx.scale(phone ? 1.15 : 1.5, phone ? 0.7 : 0.62);
  ctx.translate(-cx, -(y - 4));
  ctx.fillStyle = plate;
  ctx.beginPath(); ctx.arc(cx, y - 4, 150, 0, TAU); ctx.fill();
  ctx.restore();

  // label
  ctx.font = `500 ${phone ? 11 : 13}px ${SANS}`;
  setLetter(ctx, phone ? 1 : 5);
  const labelA = 0.5 + 0.25 * Math.sin(t * 1.4) * (game.danger > 0.5 ? 1 : 0.4);
  ctx.fillStyle = `rgba(190,180,160,${labelA})`;
  ctx.fillText(phase.id === 'panic' || phase.id === 'silence' ? 'PANIC' : 'DAWN IN', cx, y - (short ? 14 : 22));

  // clock
  const timeLeft = clamp(game.timeLeft, 0, 999);
  const clockStr = fmtClock(timeLeft);
  const critical = timeLeft < 61;
  const digit = short ? 24 : phone ? 30 : (critical ? 46 : 40);
  ctx.font = `400 ${digit}px ${MONO}`;
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
  const railW = phone ? Math.min(140, w * 0.38) : 190;
  const railY = y + (short ? 16 : phone ? 26 : 36);
  ctx.globalAlpha = 0.5 * em;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - railW / 2 - 1, railY - 1, railW + 2, 4);
  ctx.fillStyle = 'rgba(150,160,190,0.28)';
  ctx.fillRect(cx - railW / 2, railY, railW, 2);
  const pr = clamp(game.time / game.nightDuration, 0, 1);
  const g = ctx.createLinearGradient(cx - railW / 2, 0, cx + railW / 2, 0);
  g.addColorStop(0, '#3a4a72'); g.addColorStop(0.6, '#7d1220'); g.addColorStop(1, '#b8202e');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.85 * em;
  ctx.fillRect(cx - railW / 2, railY, railW * pr, 2);
  // phase pips
  ctx.globalAlpha = 0.6 * em;
  for (const ph of [60, 120, 180, 240, 270, 290]) {
    const x = cx - railW / 2 + (ph / 300) * railW;
    ctx.fillStyle = ph === 290 ? 'rgba(210,60,60,0.9)' : 'rgba(200,195,180,0.45)';
    ctx.fillRect(x, railY - 3, 1.5, 8);
  }
  ctx.globalAlpha = em;
  ctx.restore();
}

/** Teaching, a live door, hunger, or a knock. Story waits, then resumes. */
export function urgentGuidance(game) {
  if (!game || !game.player) return null;
  const step = game.coach && game.coach.step;
  if (step && step !== 'done') {
    if (step === 'walk') return 'DRAG TO WALK. BLOOD IS ALREADY DRAINING.';
    if (step === 'hunt') return 'WALK TO THE MEAL.';
    if (step === 'feed' || step === 'claw') return 'KILL TO DRINK.';
    if (step === 'knock') return 'A KNOCK. ANSWER, OR LEAVE IT.';
    if (step === 'board' || step === 'door') return 'BAR THE SERVANT DOOR, OR OPEN AND FEED.';
    if (step === 'raise') return 'RAISE THE STAKES.';
    if (step === 'planks' || step === 'planks2') return 'WALK ONTO THE PLANKS.';
    if (step === 'stakes') return 'WALK TO THE STAKES.';
  }
  const door = game.mansion && game.mansion.entrances && game.mansion.entrances.find((e) => e.attackers > 0);
  if (door) return `BAR THE ${door.name || 'DOOR'}.`;
  if (game.player.lowBlood || game.hungerFailing) {
    return (game.timeLeft || 0) > 80 ? 'FEED — DAWN IS FAR.' : 'FEED, OR THE DAWN IS LOST.';
  }
  const knock = game.director && game.director.knock;
  if (knock && knock.tell) {
    if (knock.tell.class === 'gift') return 'THE KNOCK IS OFFERING SOMETHING.';
    if (knock.tell.class === 'empty') return 'THE DOOR IS ONLY WOOD.';
    return 'THE WOOD WARNS YOU.';
  }
  return null;
}

/**
 * One line for the bottom strip.
 * Urgent guidance pre-empts a story murmur. When the night quiets, the murmur
 * resumes. `narrativeLine` is that murmur — do not add a second caption channel.
 */
export function guidanceLine(game) {
  if (!game || !game.player) return null;
  const urgent = urgentGuidance(game);
  if (urgent) return urgent;
  const story = game.storyLine || (typeof game.narrativeLine === 'string' ? game.narrativeLine : '');
  if (story) return story;
  const open = game.objectives && game.objectives.hudState && game.objectives.hudState();
  if (open && open.open && open.open[0]) return open.open[0].label;
  if (game._roomLine && game.time - (game._roomLineAt || 0) < 4.2) return game._roomLine;
  return null;
}

function drawTopBar(game, ctx, w, h, em, pulse) {
  const p = game.player;
  if (!p) return;
  const { phone, short } = phoneHud(w, h);
  const y = short ? 14 : phone ? 16 : 20;
  const pct = Math.round((p.bloodPct || 0) * 100);
  const low = p.lowBlood || game.hungerFailing;
  const purse = unlocked(game.save, 'risk') && game.livePurse ? game.livePurse() : ((game.save && game.save.shards) || 0);
  if (game._purseSeen != null && purse !== game._purseSeen) game._purseFlashAt = game.time;
  game._purseSeen = purse;
  const flash = game._purseFlashAt != null && game.time - game._purseFlashAt < 0.7;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 11 : 13}px ${SANS}`;
  setLetter(ctx, 0.6);
  ctx.globalAlpha = em.blood;
  ctx.textAlign = 'left';
  ctx.fillStyle = low
    ? `rgba(230,${80 + 40 * Math.abs(Math.sin(game.time * 5))},70,0.96)`
    : 'rgba(232,220,206,0.92)';
  if (low) ctx.shadowColor = 'rgba(160,20,30,0.8)', ctx.shadowBlur = 8;
  ctx.fillText(`BLOOD  ${pct}%`, 12, y);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = flash ? 1 : em.badge;
  ctx.textAlign = 'right';
  ctx.fillStyle = flash ? '#f0d48a' : 'rgba(214,186,120,0.92)';
  const right = `◆ ${purse}    PLANKS  ${p.planks | 0}`;
  ctx.fillText(right, w - 12, y);
  if (pulse && low) {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(10, y + 8, 72, 2);
  }
  ctx.restore();
}

function drawGuidanceStrip(game, ctx, w, h) {
  const line = guidanceLine(game);
  if (line !== game._guideShown) {
    game._guidePrev = game._guideShown;
    game._guideShown = line;
    game._guideAt = game.time;
  }
  const shown = line || game._guidePrev;
  if (!shown) return;
  const age = game.time - (game._guideAt || 0);
  const fade = line ? Math.min(1, age / 0.22) : Math.max(0, 1 - age / 0.35);
  if (fade <= 0.02) return;
  const live = (game.messages || []).some((m) => m.life - m.t > 0.05);
  if (live) return;
  const input = game.input;
  const stick = input && input.stick;
  const stickTop = stick && input.gameplay
    ? (stick.homeY || h - 120) - (stick.r || 52)
    : h - 86;
  // Above the thumb cluster, over the world — never in a reserved black band.
  const y = Math.min(stickTop - 28, h - 168);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${h < 520 ? 12 : 13}px ${SANS}`;
  setLetter(ctx, 0.8);
  const maxW = Math.min((view ? view.w : w) - 36, 420);
  const words = String(shown).split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = word; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  const shownLines = lines.slice(0, 2);
  if (lines.length > 2) shownLines[1] = shownLines[1].replace(/[,.]?$/, '') + '…';
  let tw = 0;
  for (const ln of shownLines) tw = Math.max(tw, ctx.measureText(ln).width);
  const boxH = shownLines.length * 16 + 10;
  ctx.fillStyle = 'rgba(6,7,12,0.72)';
  ctx.fillRect(w / 2 - tw / 2 - 12, y - boxH / 2, tw + 24, boxH);
  ctx.fillStyle = 'rgba(232,220,200,0.94)';
  shownLines.forEach((ln, i) => ctx.fillText(ln, w / 2, y - (shownLines.length - 1) * 8 + i * 16));
  ctx.restore();
}

/* ---------------- bottom left: blood (folded into the top bar) ---------------- */

function drawBlood(game, ctx, w, h, pulse, em = 1) {
  const p = game.player;
  // Thumbs own the bottom (Vampire Survivors / Hades mobile). Blood sits just
  // above the stick well so the hunger readout is never under the finger.
  const stick = game.input && game.input.stick;
  const stickTop = stick ? (stick.homeY || h - 120) - (stick.r || 52) : h - 80;
  const phone = w < 840 || h < 500;
  const x = 14;
  const cluster = game.input && game.input.clusterLeft;
  const room = cluster ? cluster - x - 18 : w - 36;
  const barW = phone ? Math.min(Math.max(108, room), 200) : Math.min(168, Math.max(120, w * 0.28));
  const barH = phone ? 10 : 8;
  const plateH = phone ? 44 : 30;
  const y = game.input && game.input.gameplay
    ? Math.max(8, Math.min(h - plateH - 8, stickTop - plateH - 10))
    : h - plateH - 16;
  const pct = p.bloodPct;
  const low = p.lowBlood || game.hungerFailing;
  const critical = pct < 0.14 || (game.hungerFailing && pct < 0.3);

  ctx.save();
  ctx.globalAlpha = em;
  ctx.fillStyle = 'rgba(8,6,8,0.55)';
  ctx.fillRect(x - 8, y - 22, barW + 16, plateH);
  ctx.strokeStyle = low ? 'rgba(180,40,48,0.7)' : 'rgba(140,110,70,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 7.5, y - 21.5, barW + 15, plateH - 1);
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${phone ? 13 : 11}px ${SANS}`;
  setLetter(ctx, 1);
  ctx.fillStyle = low ? `rgba(220,${120 - 60 * Math.sin(game.time * 5)},110,0.95)` : 'rgba(190,180,165,0.8)';
  ctx.textAlign = 'left';
  ctx.fillText('BLOOD', x, y - 8);

  ctx.font = `400 ${phone ? 13 : 11}px ${MONO}`;
  ctx.fillStyle = 'rgba(200,160,74,0.9)';
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(pct * 100) + '%', x + barW, y - 8);

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
    const shown = game.bloodShown == null ? pct : game.bloodShown;
    ctx.fillRect(0, 0, barW * shown, barH);
    if (game.bloodGulp > 0) {
      ctx.fillStyle = `rgba(255,150,140,${game.bloodGulp})`;
      ctx.fillRect(0, 0, barW * shown, barH);
    }
    ctx.fillStyle = 'rgba(255,190,190,0.22)';
    ctx.fillRect(0, 0, barW * pct, 2);
    if (game.bloodTick > 0) {
      ctx.fillStyle = `rgba(255,70,70,${game.bloodTick})`;
      ctx.fillRect(0, 0, barW * pct, barH);
    }
    if (game.hungerFailing) {
      const k = 0.35 + 0.35 * Math.abs(Math.sin(game.time * 5));
      ctx.strokeStyle = `rgba(220,40,40,${k})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(-1, -1, barW + 2, barH + 2);
    }
  }
  const proj = projectDawn(p.blood, game.timeLeft || 0, game.save, p.state === 'run');
  const mark = clamp(proj.atDawn <= 0 ? 0 : proj.atDawn / Math.max(1, p.bloodMax), 0, 1);
  ctx.fillStyle = proj.failing
    ? `rgba(255,214,150,${0.5 + 0.45 * Math.abs(Math.sin(game.time * 5))})`
    : 'rgba(214,204,180,0.75)';
  ctx.fillRect(barW * mark - 1, -4, 2, barH + 8);
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
    ctx.fillText(critical ? 'THE HUNGER IS TAKING YOU' : (game.hungerFailing ? 'FEED, OR THE DAWN IS LOST' : 'YOU NEED BLOOD'), x, y + 26);
  }
  if (game.screen === 'playing' && unlocked(game.save, 'risk')) {
    const atRisk = game.livePurse ? game.livePurse() : 0;
    ctx.font = `500 10px ${SANS}`;
    setLetter(ctx, 1);
    ctx.textAlign = 'left';
    const failing = game.hungerFailing || p.lowBlood;
    ctx.fillStyle = failing ? `rgba(255,196,90,${0.75 + 0.25 * Math.abs(Math.sin(game.time * 5))})` : 'rgba(200,160,74,0.7)';
    ctx.fillText(`◆ ${atRisk} AT RISK`, x, y - 28);
  }
  ctx.restore();
}

/* ---------------- bottom right: actions ---------------- */

function drawActions(game, ctx, w, h, em = 1) {
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
  ctx.globalAlpha = em;
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

function drawDoorStatus(game, ctx, w, h, em = 1) {
  // A small compass-like list of the four doors: only appears when a door is
  // damaged or being attacked. This is the "which entrance should I protect?"
  // decision surface, kept as far from the centre of the screen as possible.
  const doors = game.mansion.doors;
  const shown = doors.filter((d) => d.hp < d.hpMax - 1 || d.attackers > 0 || d.broken || game.time - (d.lastTouched || -99) < 6);
  if (!shown.length) return;
  const rank = (d) => (d.attackers > 0 ? 4 : 0) + (d.broken ? 2 : 0) + (1 - d.hp / Math.max(1, d.hpMax));
  shown.sort((a, b) => rank(b) - rank(a));
  const { phone, short } = phoneHud(w, h);
  const list = shown.slice(0, phone ? (short ? 2 : 3) : 4);
  if (phone) {
    // One door, in the top-right margin. A stack of three names was sitting
    // on the room photo and reading as broken UI.
    const d = list[0];
    const bear = bearing(game, d.x, d.y);
    // Tall phones: the coach chip owns the row under the clock. Drop the door
    // mark below that row so "WALK ONTO THEM" cannot eat the door name.
    const y = short ? 64 : 156;
    const maxW = Math.min(132, w * 0.34);
    ctx.save();
    ctx.globalAlpha = em;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `500 11px ${SANS}`;
    setLetter(ctx, 0.3);
    let name = d.broken ? 'BROKEN' : d.name;
    while (ctx.measureText(name + ' ' + bear.card).width > maxW - 16 && name.length > 3) name = name.slice(0, -1);
    const label = `${name} ${bear.card}`;
    const tw = ctx.measureText(label).width;
    const x = w - 12;
    ctx.fillStyle = 'rgba(6,7,10,0.82)';
    ctx.fillRect(x - tw - 22, y - 12, tw + 28, 24);
    const pct = clamp(d.hp / d.hpMax, 0, 1);
    ctx.fillStyle = d.broken ? '#9c1a26' : pct > 0.6 ? '#6a6a52' : pct > 0.3 ? '#8a6a2a' : '#9c1a26';
    ctx.fillRect(x - tw - 22, y + 8, (tw + 28) * pct, 2);
    ctx.fillStyle = d.broken || d.attackers > 0 ? 'rgba(230,120,110,0.95)' : 'rgba(210,200,180,0.9)';
    ctx.fillText(label, x - 14, y);
    ctx.translate(x - 6, y);
    ctx.rotate(bear.screen);
    ctx.fillStyle = d.attackers > 0 ? 'rgba(230,80,70,0.95)' : 'rgba(210,200,180,0.85)';
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
    return;
  }
  const x = w - 18;
  let y = Math.max(88, h * 0.14);
  ctx.save();
  ctx.globalAlpha = em;
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
    const label = name + `  ${bear.card}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(6,7,10,0.78)';
    ctx.fillRect(bw - 30 - tw, y - 10, tw + 16, 20);
    ctx.fillStyle = d.broken ? 'rgba(230,120,110,0.95)' : 'rgba(220,210,190,0.92)';
    ctx.fillText(label, bw - 22, y + 2);
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
    const view = game.renderer.view || { left: 0, top: 0, w, h };
    const onPlay = sp.x > view.left + margin && sp.x < view.left + view.w - margin
      && sp.y > view.top + 16 && sp.y < view.top + view.h - 16;
    if (onPlay) continue;
    const cx = view.left + view.w / 2, cy = view.top + view.h / 2;
    const ang = Math.atan2(sp.y - cy, sp.x - cx);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hx = view.w / 2 - 28, hy = view.h / 2 - 22;
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
  const shade = ctx.createLinearGradient(0, h * 0.58, 0, h);
  shade.addColorStop(0, 'rgba(4,5,10,0)');
  shade.addColorStop(0.42, 'rgba(4,5,10,0.22)');
  shade.addColorStop(1, 'rgba(4,5,10,0.58)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, h * 0.58, w, h * 0.42);
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
    if (hint && w > 720 && h > 500) {
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
