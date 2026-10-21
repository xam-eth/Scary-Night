/* DUSKHOLD — Run outcomes: dawn card, ending plate, death & victory screens with the hunt debrief (Phase 3 split of ui/screens.js). */

import { clamp, TAU, fmtClock } from '../../core/util.js';
import { unlocked, houseTitle } from '../../game/sim/economy.js';
import { endingFrame } from '../../game/meta/narrative.js';
import { intelLine, huntPct, huntProgress, fortressState, huntTells, masterReady, masterDown, FORTRESS_STATES } from '../../game/sim/hunt.js';
import { INFORMANT, informantLine } from '../../game/meta/informant.js';
import { IAP } from '../../shop/iap.js';
import { Ads } from '../../shop/ads.js';
import { SERIF, SANS, MONO, isPhone, fitType, wrapLines, uiButton, buttonVisual, drawValenShade, drawPlateGrade, wrapText } from './shared.js';

export function drawDawnCard(game, ctx, w, h) {
  const card = game.dawnCard;
  const t = game.dawnCardT || 0;
  const short = h < 520;
  drawPlateGrade(ctx, w, h, 'gallery', false);
  const scrim = ctx.createLinearGradient(0, short ? 0 : h * 0.42, 0, h);
  scrim.addColorStop(0, 'rgba(6,4,8,0)');
  scrim.addColorStop(short ? 0.2 : 0.35, 'rgba(6,4,8,0.72)');
  scrim.addColorStop(1, 'rgba(6,4,8,0.88)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, short ? 0 : h * 0.38, w, h);
  drawValenShade(ctx, short ? w * 0.22 : w * 0.5, short ? h * 0.55 : h * 0.34, short ? 0.42 : 0.62);
  ctx.save();
  ctx.textAlign = short ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,214,190,0.8)';
  ctx.font = `400 ${short ? 11 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  const labelX = short ? w * 0.42 : w / 2;
  ctx.fillText('DAWN', labelX, short ? 22 : h * 0.46);
  const text = (card && card.text) || 'The house raises a morning. It is not the true one.';
  ctx.fillStyle = '#f4eadc';
  ctx.font = `400 ${short ? 14 : 17}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.3px';
  const maxW = short ? w * 0.52 : Math.min(w - 48, 420);
  wrapText(ctx, text, labelX, short ? 42 : h * 0.52, maxW, short ? 18 : 24);
  ctx.restore();
  if (t > 0.35) {
    const bw = Math.min(w - 36, short ? 200 : 280);
    const bh = 46;
    const btn = uiButton(game, {
      x: short ? w - bw - 16 : (w - bw) / 2,
      y: h - (short ? 58 : 78),
      w: bw, h: bh,
      label: 'CONTINUE', small: true, accent: '#a8833c',
      onClick: () => game.finishDawnCard(),
    });
    buttonVisual(ctx, btn.b, { active: btn.hover, label: 'CONTINUE', small: true, accent: '#a8833c' });
  }
}


export function drawEnding(game, ctx, w, h) {
  const short = h < 520;
  const t = game.endingT || 0;
  drawPlateGrade(ctx, w, h, 'oratory', true);
  const scrim = ctx.createLinearGradient(0, short ? 0 : h * 0.34, 0, h);
  scrim.addColorStop(0, 'rgba(6,4,8,0)');
  scrim.addColorStop(0.4, 'rgba(6,4,8,0.7)');
  scrim.addColorStop(1, 'rgba(6,4,8,0.9)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, short ? 0 : h * 0.3, w, h);
  drawValenShade(ctx, short ? w * 0.2 : w * 0.5, short ? h * 0.5 : h * 0.32, short ? 0.36 : 0.58);
  ctx.save();
  ctx.textAlign = short ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f3e7d4';
  ctx.font = `400 ${short ? 14 : 16}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
  const frame = endingFrame(game.save);
  const textX = short ? w * 0.4 : w / 2;
  const maxW = short ? w * 0.56 : Math.min(w - 40, 420);
  let y = short ? 18 : h * 0.46;
  y = wrapText(ctx, 'The true dawn is in the glass. The house cannot raise this one.', textX, y, maxW, short ? 18 : 22);
  ctx.fillStyle = 'rgba(214,186,120,0.92)';
  ctx.font = `400 ${short ? 12 : 14}px ${SANS}`;
  wrapText(ctx, frame, textX, y + 6, maxW, 16);
  ctx.restore();
  if (t > 0.4) {
    const bh = 46;
    if (short) {
      const bw = Math.min(210, (w - 36) / 2);
      const y1 = h - 58;
      const walk = uiButton(game, {
        x: 12, y: y1, w: bw, h: bh, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060',
        onClick: () => game.chooseEnding('dawnbreaker'),
      });
      buttonVisual(ctx, walk.b, { active: walk.hover, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060' });
      const stay = uiButton(game, {
        x: w - bw - 12, y: y1, w: bw, h: bh, label: 'TURN BACK', small: true, accent: '#6a2230',
        onClick: () => game.chooseEnding('monster'),
      });
      buttonVisual(ctx, stay.b, { active: stay.hover, label: 'TURN BACK', small: true, accent: '#6a2230' });
    } else {
      const bw = Math.min(w - 36, 320);
      const x = (w - bw) / 2;
      const y1 = h - 168;
      const walk = uiButton(game, {
        x, y: y1, w: bw, h: bh, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060',
        onClick: () => game.chooseEnding('dawnbreaker'),
      });
      buttonVisual(ctx, walk.b, { active: walk.hover, label: 'WALK INTO THE DAWN', small: true, accent: '#c4a060' });
      const stay = uiButton(game, {
        x, y: y1 + bh + 10, w: bw, h: bh, label: 'TURN BACK', small: true, accent: '#6a2230',
        onClick: () => game.chooseEnding('monster'),
      });
      buttonVisual(ctx, stay.b, { active: stay.hover, label: 'TURN BACK', small: true, accent: '#6a2230' });
    }
  }
}


/**
 * The hunt's payoff beat: what the night bought, on a death and on a dawn
 * alike. A night that ends in blood still taught you
 * something about the thing you came to kill, and the screen says so — this is
 * the difference between TRY AGAIN and "I am one step closer to it."
 *
 * Drawn as a hunter's journal: the intel first (what you learned), then what
 * you carry, then the one meter that only ever moves forward.
 */
function drawHuntGain(game, ctx, w, h, y, heading = 'WHAT THE NIGHT TAUGHT YOU', floorY = Infinity) {
  const gain = game.lastGain;
  if (!gain) return y;
  const phone = isPhone(w, h);
  const maxW = w - 34;
  // The block stops at its floor: on a dawn the screen is full of buttons and
  // stat rows, and a hunt readout that runs under the thumb is worse than a
  // short one. Rows are drawn in order of worth, so what gets dropped first is
  // the flavour, never the meter and never her.
  const roomFor = (need) => y + need <= floorY;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!roomFor(phone ? 15 : 18)) { ctx.restore(); return y; }
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.85)';
  ctx.fillText(heading, w / 2, y);
  y += phone ? 15 : 18;

  // The end of the hunt, when this was the night it ended. It outranks
  // everything else on the card — the other rows are what it cost.
  if ((gain.masterDown || gain.masterReady) && roomFor(phone ? 16 : 18)) {
    ctx.font = `500 ${phone ? 10.5 : 12}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.4px';
    ctx.fillStyle = gain.masterDown ? 'rgba(240,196,120,0.98)' : 'rgba(232,150,110,0.95)';
    ctx.fillText(gain.masterDown ? 'THE MASTER IS DEAD · THE HUNT IS OVER' : 'THE HUNT IS FULL · IT CAN BE ENDED', w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 16 : 18;
  }

  // tonight's errand, answered: asked at nightfall, paid here. One line — the
  // point is the verdict, not a second spreadsheet.
  if (gain.objective && roomFor(phone ? 15 : 17)) {
    const ob = gain.objective;
    const verdict = ob.done ? 'DONE' : (ob.bonus > 0 ? 'HALF DONE' : 'MISSED');
    const text = `TONIGHT · ${ob.label} — ${verdict}${ob.bonus > 0 ? `  +${ob.bonus.toFixed(1)}` : ''}`;
    const px = fitType(ctx, text, maxW, phone ? 10 : 11.5, SANS, 500);
    ctx.font = `500 ${px}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = ob.done ? 'rgba(214,178,96,0.95)' : 'rgba(160,152,138,0.8)';
    ctx.fillText(text, w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 15 : 17;
  }

  // the freshest facts first — two is what fits and what reads
  const shown = gain.intel.slice(0, 2);
  for (const id of shown) {
    const line = intelLine(id);
    if (!line || !roomFor(phone ? 14 : 16)) continue;
    const px = fitType(ctx, line, maxW - 16, phone ? 11.5 : 13, SERIF, 400);
    ctx.font = `italic 400 ${px}px ${SERIF}`;
    ctx.fillStyle = 'rgba(226,212,178,0.92)';
    ctx.fillText(line, w / 2, y);
    y += phone ? 14 : 16;
  }
  if (gain.intel.length > shown.length && roomFor(phone ? 14 : 16)) {
    ctx.font = `400 10px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    ctx.fillStyle = 'rgba(170,160,140,0.7)';
    ctx.fillText(`+ ${gain.intel.length - shown.length} MORE IN THE JOURNAL`, w / 2, y);
    y += phone ? 14 : 16;
  }

  // what the night paid, in one line
  if (!roomFor(phone ? 16 : 19)) { ctx.restore(); return y; }
  ctx.font = `500 ${phone ? 10.5 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(196,190,172,0.9)';
  ctx.fillText(`+ ${gain.materials} MATERIALS`, w / 2, y);
  y += phone ? 16 : 19;

  // THE HUNT — one meter, ten cells, forward only
  if (!roomFor(phone ? 30 : 34)) { ctx.restore(); return y; }
  const pct = huntPct(game.save);
  const cells = 10;
  const cellW = phone ? 15 : 18;
  const gap = 3;
  const barW = cells * cellW + (cells - 1) * gap;
  let x = w / 2 - barW / 2;
  const filled = Math.round((huntProgress(game.save) / 100) * cells);
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i < filled ? 'rgba(200,160,74,0.92)' : 'rgba(120,110,92,0.22)';
    ctx.fillRect(x, y - 4, cellW, 7);
    x += cellW + gap;
  }
  y += 14;
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`THE HUNT · ${pct}%`, w / 2, y);
  y += phone ? 14 : 16;

  // the house is becoming hers (P6) — and the end is in sight
  if (gain.levelUp && roomFor(phone ? 15 : 17)) {
    // The Clash-base beat, in one line: what the house was, and what it is now.
    const st = fortressState(game.save);
    const from = FORTRESS_STATES[gain.levelBefore] || FORTRESS_STATES[0];
    ctx.font = `italic 400 ${phone ? 11 : 12.5}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(232,200,140,0.95)';
    ctx.fillText(`THE HOUSE IS BECOMING YOURS · ${from.name} ▸ ${st.name}`, w / 2, y);
    y += phone ? 15 : 17;
  }
  for (const tell of huntTells(game.save)) {
    if (!roomFor(phone ? 14 : 16)) break;
    ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(206,120,96,0.9)';
    ctx.fillText(tell, w / 2, y);
    y += phone ? 14 : 16;
  }
  // And the one person who is still in the house, waiting up. She speaks on a
  // death too — the run that ends in blood is the one that needs her most.
  const said = informantLine(game.save, gain.won ? 'dawn' : 'death', gain);
  if (said && said.text && roomFor(phone ? 14 : 16)) {
    ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(196,180,150,0.9)';
    const lines = wrapLines(ctx, said.text, maxW).slice(0, 2);
    for (const ln of lines) { if (!roomFor(phone ? 14 : 16)) break; ctx.fillText(ln, w / 2, y); y += phone ? 14 : 16; }
    ctx.font = `500 ${phone ? 8 : 9}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(150,140,120,0.7)';
    ctx.fillText(`— ${INFORMANT.name}`, w / 2, y - (phone ? 3 : 4));
    y += phone ? 12 : 14;
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
  return y;
}


export function drawDeath(game, ctx, w, h) {
  const t = game.deathScreenT;
  const a = clamp(t / 1.6, 0, 1);
  ctx.save();
  ctx.fillStyle = `rgba(2,3,6,${0.55 + a * 0.4})`;
  ctx.fillRect(0, 0, w, h);
  // the vampire's blood pooling on the floor
  ctx.globalAlpha = clamp(t / 4, 0, 0.8);
  const g = ctx.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, 260);
  g.addColorStop(0, 'rgba(90,8,16,0.75)');
  g.addColorStop(0.5, 'rgba(50,4,10,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, 260, 90, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  const fade = clamp((t - 1.2) / 1.4, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitType(ctx, 'THE NIGHT CLAIMED YOU', w - 28, isPhone(w, h) ? 22 : clamp(w * 0.035, 26, 44), SERIF, 400);
  ctx.fillStyle = '#8e1622';
  ctx.shadowColor = 'rgba(180,20,30,0.4)'; ctx.shadowBlur = 24;
  ctx.fillText('THE NIGHT CLAIMED YOU', w / 2, isPhone(w, h) ? Math.min(h * 0.22, 72) : h * 0.3);
  ctx.shadowBlur = 0;
  // v1.0 (QA P2-9): the death screen teaches. What actually got you.
  if (game.deathReason) {
    ctx.font = `italic 400 15px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(178,120,110,0.85)';
    ctx.fillText(String(game.deathReason).toUpperCase(), w / 2, h * 0.365);
  }
  const worn = IAP.equippedCoat(game.save);
  const laneDeath = houseTitle(game.save);
  const coatDeath = worn === 'coat_glutton' ? 'SHE DIED STILL HUNGRY.'
    : worn === 'coat_warden' ? 'THE WOOD OUTLASTED HER.'
    : worn === 'coat_shade' ? 'THE QUIET CLOSED OVER HER.'
    : laneDeath ? laneDeath + ' ENDS HERE. THE NAME DOES NOT.'
    : null;
  if (coatDeath) {
    ctx.font = `italic 400 13px ${SERIF}`;
    ctx.fillStyle = 'rgba(196,176,140,0.75)';
    ctx.fillText(coatDeath, w / 2, h * 0.4);
  }

  const stats = game.stats;
  const rows = [
    ['SURVIVED', fmtClock(game.time)],
    ['BEST', game.save.bestTime > 0 ? fmtClock(game.save.bestTime) : '--:--'],
    ['NIGHTS SURVIVED', String(game.save.nightsSurvived)],
  ];
  const phoneDeath = isPhone(w, h);
  const step = phoneDeath || h < 700 ? 40 : 52;
  let y = phoneDeath ? h * 0.34 : h * 0.4;
  for (const [k, v] of rows) {
    ctx.font = `500 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(170,162,150,0.7)';
    ctx.fillText(k, w / 2, y);
    ctx.font = `400 ${phoneDeath ? 18 : 20}px ${MONO}`;
    ctx.fillStyle = '#e2dac6';
    ctx.fillText(v, w / 2, y + 18);
    y += step;
  }
  const riskOpen = unlocked(game.save, 'risk') && (game.shardsEarned || 0) > 0;
  if (riskOpen) {
    ctx.font = `500 13px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(200,160,74,0.95)';
    const floor = game.purseSettled ? game.bankedNow : Math.max(1, Math.round((game.shardsEarned || 0) * 0.2));
    ctx.fillText(game.purseSettled ? `◆ ${game.bankedNow} KEPT` : `◆ ${game.shardsEarned} AT RISK · KEEP ${floor}`, w / 2, y + 4);
    ctx.font = `400 11px ${SANS}`;
    ctx.fillStyle = 'rgba(176,166,150,0.75)';
    ctx.fillText('KEEPS THE PURSE. NOT THE CLAW.', w / 2, y + 20);
    y += 36;
  }
  if (game.lastNightGoals && game.lastNightGoals.length) {
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    const done = game.lastNightGoals.filter((g) => g.state === 'done');
    ctx.fillStyle = 'rgba(160,154,142,0.8)';
    ctx.fillText(`GOALS ${done.length}/${game.lastNightGoals.length}`, w / 2, y + 8);
  }
  // THE HUNT: she died, and the night still paid. The spine's hard rule is
  // that this block is here at all — a death that banks nothing is a score.
  if (game.lastGain) {
    // the death screen's own button stack, so the block can stop above it:
    // up to three rows (TRY AGAIN, the revive offer, MAIN MENU) off the bottom.
    const dBh = h < 520 ? 42 : 48, dGap = h < 640 ? 6 : 8;
    const dTop = Math.min(h * 0.76, h - (3 * (dBh + dGap)) - 14);
    drawHuntGain(game, ctx, w, h, y + 26, 'WHAT THE NIGHT TAUGHT YOU', dTop - 8);
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : 220, bh = h < 520 ? 42 : 48;
    const items = [
      { label: 'TRY AGAIN', onClick: () => game.beginNight(), accent: '#a8833c' },
    ];
    const atRisk = game.shardsEarned || 0;
    const relief = unlocked(game.save, 'risk') && atRisk > 0 && !game.usedRevive;
    // Legacy revive relief: the offer is *tempting
    // but never forcing*. The offer is a snap decision on a short, visible
    // countdown that opens when the buttons fade in and closes after
    // REVIVE_WINDOW seconds. Letting it lapse forfeits nothing but the offer
    // itself — the purse still keeps its floor on TRY AGAIN / MAIN MENU.
    const REVIVE_OFFER_AT = 2.5, REVIVE_WINDOW = 6;
    const reviveLeft = clamp(REVIVE_WINDOW - (t - REVIVE_OFFER_AT), 0, REVIVE_WINDOW);
    const reviveOpen = reviveLeft > 0;
    const ownsRevive = !game.usedRevive && game.save.iap && game.save.iap.revives > 0;
    const canBuyRevive = relief && IAP.mode !== 'disabled' && IAP.offered(game.save, 'revive1');
    const canAdRevive = !game.usedRevive && Ads.isAvailable('revive');
    const hasReviveOffer = !game.usedRevive && (ownsRevive || canBuyRevive || canAdRevive);
    if (reviveOpen) {
      if (relief && ownsRevive) {
        items.push({ label: `KEEP ◆ ${atRisk}`, onClick: () => game.spendSecondBlood(), accent: '#a8833c' });
      } else if (ownsRevive) {
        items.push({ label: 'USE SECOND BLOOD', onClick: () => game.spendSecondBlood(), accent: '#6a6a80' });
      } else if (canBuyRevive) {
        items.push({ label: `KEEP ◆ ${atRisk}`, onClick: () => game.purchaseSku('revive1'), accent: '#a8833c' });
      }
      if (canAdRevive) {
        items.push({
          label: relief ? `WATCH · KEEP ◆ ${atRisk}` : Ads.label('revive'),
          onClick: () => game.requestAdRevive(),
          accent: '#6a2230',
        });
      }
    }
    items.push(
      { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'death'), accent: '#6a6a80' },
      { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
    );
    // v1.0 (QA P0-2): stack from the bottom edge upward — landscape phones
    // never clip the last button, whatever the row count.
    const gap = h < 640 ? 6 : 8;
    let by = Math.min(h * 0.76, h - (items.length * (bh + gap)) - 14);

    // The countdown sits just above the button stack while an offer is live;
    // once it lapses, one quiet line tells the player the moment is gone.
    if (hasReviveOffer) {
      ctx.save();
      ctx.textAlign = 'center';
      const barW = bw, bx = w / 2 - barW / 2, cy = by - 22;
      if (reviveOpen) {
        ctx.font = `600 11px ${SANS}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
        ctx.fillStyle = 'rgba(200,160,74,0.95)';
        ctx.fillText(`DECIDE · ${Math.ceil(reviveLeft)}`, w / 2, cy - 4);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.fillStyle = 'rgba(120,90,40,0.3)';
        ctx.fillRect(bx, cy + 6, barW, 3);
        ctx.fillStyle = 'rgba(200,160,74,0.92)';
        ctx.fillRect(bx, cy + 6, barW * (reviveLeft / REVIVE_WINDOW), 3);
      } else {
        ctx.font = `italic 400 12px ${SERIF}`;
        ctx.fillStyle = 'rgba(150,120,110,0.7)';
        ctx.fillText('THE MOMENT PASSED. THE PURSE KEEPS ONLY ITS FLOOR.', w / 2, cy);
      }
      ctx.restore();
    }

    items.forEach((it, i) => {
      const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
      buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
      by += bh + gap;
    });
  }
}

/* ================= victory ================= */


export function drawVictory(game, ctx, w, h) {
  const t = game.victoryScreenT;
  const dawnA = clamp(t / 2.5, 0, 1);
  ctx.save();
  // dawn flooding the room
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(232,168,96,${0.30 * dawnA})`);
  g.addColorStop(0.5, `rgba(150,92,80,${0.22 * dawnA})`);
  g.addColorStop(1, `rgba(20,16,26,${0.5 + 0.3 * dawnA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // sun shafts
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.15 + i * 0.18);
    const sg = ctx.createLinearGradient(x, 0, x + 260, h);
    sg.addColorStop(0, `rgba(255,214,150,${0.10 * dawnA})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 90, 0); ctx.lineTo(x + 420, h); ctx.lineTo(x + 240, h);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  const fade = clamp((t - 0.8) / 1.2, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'DUSKHOLD', w - 28, phone ? 16 : clamp(w * 0.026, 20, 34), SERIF, 400);
  ctx.fillStyle = 'rgba(226,218,200,0.85)';
  ctx.fillText('DUSKHOLD', w / 2, phone ? 28 : h * 0.14);
  fitType(ctx, 'SURVIVED', w - 28, phone ? 32 : clamp(w * 0.05, 36, 64), SERIF, 400);
  ctx.fillStyle = '#f0e6c8';
  ctx.shadowColor = 'rgba(255,200,120,0.45)'; ctx.shadowBlur = 30;
  ctx.fillText('SURVIVED', w / 2, phone ? 64 : h * 0.23);
  ctx.shadowBlur = 0;
  const dawnName = IAP.owns(game.save, 'title_dawnbreaker') ? 'DAWNBREAKER' : houseTitle(game.save);
  if (dawnName) {
    ctx.font = `400 14px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(224, 180, 92, 0.9)';
    const call = dawnName.length > 16 ? dawnName : 'THE HOUSE CALLS YOU ' + dawnName;
    ctx.fillText(call, w / 2, h * 0.29);
  }
  if (game.endingJustChosen) {
    ctx.font = `400 ${phone ? 13 : 15}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = '#f0e6d4';
    ctx.fillText(game.endingJustChosen === 'monster' ? 'She stayed. The siege is hers now.' : 'It burned. She was free.', w / 2, phone ? 108 : h * 0.345);
  }
  ctx.restore();

  if (game.newRecord && fade > 0.6) {
    const p = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.save();
    ctx.globalAlpha = fade * (0.6 + p * 0.4);
    ctx.textAlign = 'center';
    ctx.font = `500 15px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillStyle = '#e0b45c';
    ctx.fillText('NEW RECORD', w / 2, h * 0.315);
    ctx.restore();
  }

  const s = game.stats;
  const rows = [
    ['SURVIVAL TIME', fmtClock(game.nightDuration)],
    ['BLOOD REMAINING', Math.round((game.player.blood / game.player.bloodMax) * 100) + '%'],
    ['DOORS SURVIVING', `${s.doorsSurviving}/${s.doorsTotal}`],
    ['ENEMIES DEFEATED', String(s.kills)],
    ['NEAREST OF DEATH', s.closestCall > 0 ? Math.round(s.closestCall * 100) + '% BLOOD' : '—'],
  ];
  const items = [
    { label: 'THE REFUGE', onClick: () => game.setScreen('refuge', 'victory'), accent: '#a8833c' },
    { label: 'ANOTHER NIGHT', onClick: () => game.beginNight(), accent: '#a8833c' },
    { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
  ];
  const gap = h < 640 ? 5 : 8;
  const bh = h < 520 ? 36 : 46;
  const buttonStack = (bh + gap) * items.length - gap;
  const buttonTop = h - buttonStack - 12;
  const rowH = h < 520 ? 18 : 34;
  ctx.save();
  ctx.globalAlpha = fade;
  const cx = w / 2;
  let y = Math.min(h * 0.38, buttonTop - rowH * rows.length - 36);
  ctx.textAlign = 'left';
  for (const [k, v] of rows) {
    ctx.font = `500 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(168,160,148,0.75)';
    const half = Math.min(200, w * 0.38);
    ctx.fillText(k, cx - half, y);
    ctx.textAlign = 'right';
    ctx.font = `400 ${w < 520 ? 14 : 19}px ${MONO}`;
    ctx.fillStyle = '#eae1c8';
    ctx.fillText(v, cx + half, y);
    ctx.textAlign = 'left';
    // dotted leader
    ctx.strokeStyle = 'rgba(140,132,118,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 40, y - 4); ctx.lineTo(cx + 40, y - 4); ctx.stroke();
    y += rowH;
  }
  ctx.font = `500 13px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`◆ ${game.bankedNow || game.shardsEarned} BANKED`, cx, y + 12);
  if (game.lastNightGoals && game.lastNightGoals.length) {
    const done = game.lastNightGoals.filter((g) => g.state === 'done');
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(190,184,170,0.8)';
    const goalLine = w < 640
      ? `GOALS ${done.length}/${game.lastNightGoals.length}`
      : `GOALS ${done.length}/${game.lastNightGoals.length} — ` + game.lastNightGoals.map((g) => (g.state === 'done' ? '✓' : '·') + ' ' + g.label).join('   ');
    ctx.fillText(goalLine, cx, Math.min(y + 28, buttonTop - 16));
  }
  // THE HUNT: a dawn is the biggest step of the night, and the screen says
  // what it was worth. Clamped so it never runs into the buttons.
  if (game.lastGain) {
    const huntTop = Math.max(y + 30, buttonTop - 150);
    drawHuntGain(game, ctx, w, h, huntTop, 'WHAT THE NIGHT PAID', buttonTop - 8);
  }
  ctx.restore();

  if (fade > 0.9) {
    const bw = isPhone(w, h) ? Math.min(w - 28, 420) : Math.min(220, w * 0.72);
    let by = buttonTop;
    items.forEach((it, i) => {
      const r = uiButton(game, { x: w / 2 - bw / 2, y: by, w: bw, h: bh, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
      buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
      by += bh + gap;
    });
  }
}

/* ================= in-run tutorial hints ================= */

