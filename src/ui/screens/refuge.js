/* DUSKHOLD — The refuge board: informant portrait, trophies and the night debrief panels (Phase 3 split of ui/screens.js). */

import { TAU } from '../../core/util.js';
import { huntPct, huntProgress, fortressState, masterReady, masterDown } from '../../game/sim/hunt.js';
import { INFORMANT, informantLine, boardEntries } from '../../game/meta/informant.js';
import { SERIF, SANS, isPhone, fitType, wrapLines, uiButton, buttonVisual, drawBrandPlate, FIELD_TABS, FIELD_PANELS } from './shared.js';

function drawInformantPortrait(ctx, cx, cy, w, h, t) {
  ctx.save();
  ctx.translate(cx, cy);
  // the frame: gilt, a little crooked, like everything else in this house
  ctx.save();
  ctx.rotate(-0.012);
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, '#4a3a1c');
  g.addColorStop(0.45, '#8d6c31');
  g.addColorStop(0.6, '#c9a45a');
  g.addColorStop(1, '#3a2c15');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // the dark inside
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2 - 7, h / 2 - 7, 0, 0, TAU);
  ctx.fillStyle = '#0b0a0e';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // the room behind her: a wall, and the light of one candle off to the left
  const room = ctx.createRadialGradient(-w * 0.22, h * 0.12, 4, -w * 0.1, 0, w * 0.75);
  room.addColorStop(0, 'rgba(214,146,64,0.42)');
  room.addColorStop(0.45, 'rgba(112,66,34,0.16)');
  room.addColorStop(1, 'rgba(6,6,10,0)');
  ctx.fillStyle = room;
  ctx.fillRect(-w, -h, w * 2, h * 2);
  // her: a hood, shoulders, and the suggestion of a face you cannot see
  const sway = Math.sin(t * 0.7) * 0.6;
  ctx.save();
  ctx.translate(sway, 0);
  ctx.fillStyle = 'rgba(9,8,12,0.96)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.30, h * 0.52);                       // left shoulder
  ctx.bezierCurveTo(-w * 0.30, -h * 0.06, -w * 0.17, -h * 0.30, 0, -h * 0.32);
  ctx.bezierCurveTo(w * 0.17, -h * 0.30, w * 0.30, -h * 0.06, w * 0.30, h * 0.52);
  ctx.closePath();
  ctx.fill();
  // the rim the candle puts on her left side
  ctx.strokeStyle = 'rgba(226,164,92,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.30, h * 0.52);
  ctx.bezierCurveTo(-w * 0.30, -h * 0.06, -w * 0.17, -h * 0.30, 0, -h * 0.32);
  ctx.stroke();
  // two glints, and nothing else — you never quite see her face
  const flick = 0.55 + 0.45 * Math.sin(t * 5.1) * Math.sin(t * 2.3);
  ctx.fillStyle = `rgba(240,204,150,${0.35 + flick * 0.4})`;
  ctx.beginPath(); ctx.ellipse(-w * 0.07, -h * 0.10, 2.1, 1.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w * 0.05, -h * 0.10, 2.1, 1.5, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // the candle, at the edge of the frame
  const fx = -w * 0.40, fy = h * 0.16;
  ctx.fillStyle = 'rgba(228,226,214,0.5)';
  ctx.fillRect(fx - 2, fy, 4, h * 0.30);
  const fl = ctx.createRadialGradient(fx, fy - 2, 0.5, fx, fy - 2, 13);
  fl.addColorStop(0, `rgba(255,236,190,${0.85 + flick * 0.15})`);
  fl.addColorStop(0.35, `rgba(240,168,70,${0.45 + flick * 0.2})`);
  fl.addColorStop(1, 'rgba(200,110,40,0)');
  ctx.fillStyle = fl;
  ctx.beginPath(); ctx.ellipse(fx, fy - 2, 13, 15, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // glass over it all
  const glass = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  glass.addColorStop(0, 'rgba(255,255,255,0.10)');
  glass.addColorStop(0.4, 'rgba(255,255,255,0.02)');
  glass.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2 - 7, h / 2 - 7, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A trophy glyph for each kind of thing she has put down. */

/** A trophy glyph for each kind of thing she has put down. */
function drawTrophy(ctx, glyph, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(214,204,182,0.85)';
  ctx.fillStyle = 'rgba(214,204,182,0.85)';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  if (glyph === 'crawl') {                       // a hand, reaching
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.5);
    ctx.quadraticCurveTo(-s * 0.2, -s * 0.2, -s * 0.1, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.2, -s * 0.1, s * 0.5, s * 0.2);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.1 + i * s * 0.22, -s * 0.5 + i * s * 0.06);
      ctx.lineTo(-s * 0.16 + i * s * 0.22, -s * 0.78 + i * s * 0.06);
      ctx.stroke();
    }
  } else if (glyph === 'bone') {                 // a knuckle bone
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.15);
    ctx.lineTo(s * 0.5, s * 0.15);
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.arc(sx * s * 0.5, sx * s * 0.15, s * 0.19, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(sx * s * 0.5, -sx * s * 0.22, s * 0.17, 0, TAU); ctx.fill();
    }
  } else if (glyph === 'fang') {                 // a hound's tooth
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.05, -s * 0.1, s * 0.02, s * 0.55);
    ctx.quadraticCurveTo(-s * 0.28, s * 0.1, -s * 0.32, -s * 0.5);
    ctx.fill();
  } else if (glyph === 'crown') {                // what killed the house, mounted
    ctx.strokeStyle = 'rgba(232,192,116,0.95)';
    ctx.fillStyle = 'rgba(232,192,116,0.95)';
    ctx.beginPath();                              // the band
    ctx.moveTo(-s * 0.46, s * 0.24);
    ctx.lineTo(s * 0.46, s * 0.24);
    ctx.stroke();
    ctx.beginPath();                              // the points
    ctx.moveTo(-s * 0.46, s * 0.24);
    ctx.lineTo(-s * 0.34, -s * 0.34);
    ctx.lineTo(-s * 0.14, s * 0.02);
    ctx.lineTo(0, -s * 0.52);
    ctx.lineTo(s * 0.14, s * 0.02);
    ctx.lineTo(s * 0.34, -s * 0.34);
    ctx.lineTo(s * 0.46, s * 0.24);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === 'jaw') {                  // a jaw, hinged open
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.1);
    ctx.quadraticCurveTo(0, s * 0.45, s * 0.5, -s * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.1);
    ctx.quadraticCurveTo(0, -s * 0.6, s * 0.5, -s * 0.1);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.2, -s * 0.08 + Math.abs(i) * s * 0.06);
      ctx.lineTo(i * s * 0.2, s * 0.14 + Math.abs(i) * s * 0.02);
      ctx.stroke();
    }
  } else if (glyph === 'bolt') {                 // a crossbow bolt
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, s * 0.45); ctx.lineTo(s * 0.5, -s * 0.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.4); ctx.lineTo(s * 0.16, -s * 0.42);
    ctx.lineTo(s * 0.44, -s * 0.08); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, s * 0.45); ctx.lineTo(-s * 0.4, s * 0.1);
    ctx.lineTo(-s * 0.7, s * 0.2); ctx.closePath(); ctx.fill();
  } else {                                       // an eye, open in the dark
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, 0);
    ctx.quadraticCurveTo(0, -s * 0.45, s * 0.55, 0);
    ctx.quadraticCurveTo(0, s * 0.45, -s * 0.55, 0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, TAU); ctx.fill();
  }
  ctx.restore();
}


export function drawRefuge(game, ctx, w, h) {
  const phone = isPhone(w, h);
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.86 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const pad = phone ? 14 : Math.max(24, (w - 520) / 2);
  const colW = w - pad * 2;
  const t = game.refugeT || 0;
  let y = phone ? 26 : 34;

  fitType(ctx, "THE HUNTER'S REFUGE", colW, phone ? 17 : 22, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText("THE HUNTER'S REFUGE", w / 2, y);
  y += phone ? 20 : 26;
  ctx.font = `500 ${phone ? 9 : 10.5}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.8)';
  ctx.fillText('DAWN · THE HOUSE IS ASLEEP · FOR NOW', w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- her ----
  const pw = Math.min(colW * 0.40, 132), ph = pw * 1.18;
  drawInformantPortrait(ctx, w / 2, y + ph / 2, pw, ph, t);
  y += ph + (phone ? 12 : 16);
  fitType(ctx, INFORMANT.name, colW, phone ? 15 : 18, SERIF, 400);
  ctx.fillStyle = '#efe4c6';
  ctx.fillText(INFORMANT.name, w / 2, y);
  y += phone ? 15 : 18;
  ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(190,176,148,0.8)';
  ctx.fillText(`${INFORMANT.title} · ${INFORMANT.line}`, w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- what she says tonight ----
  const said = game.refugeLine || informantLine(game.save, 'hub', game.lastGain);
  ctx.font = `italic 400 ${phone ? 12.5 : 14}px ${SERIF}`;
  ctx.fillStyle = 'rgba(232,214,176,0.95)';
  ctx.textAlign = 'center';
  const saidLines = wrapLines(ctx, said.text, colW - 12);
  for (const ln of saidLines) { ctx.fillText(ln, w / 2, y); y += phone ? 16 : 18; }
  y += phone ? 6 : 8;

  // ---- the hunt, and the state of the house ----
  const pct = huntPct(game.save);
  const cells = 10, cellW = phone ? 14 : 17, gap = 3;
  const barW = cells * cellW + (cells - 1) * gap;
  const filled = Math.round((huntProgress(game.save) / 100) * cells);
  let bx = w / 2 - barW / 2;
  for (let i = 0; i < cells; i++) {
    ctx.fillStyle = i < filled ? 'rgba(200,160,74,0.92)' : 'rgba(120,110,92,0.22)';
    ctx.fillRect(bx, y - 4, cellW, 7);
    bx += cellW + gap;
  }
  y += 14;
  ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  ctx.fillText(`THE HUNT · ${pct}%`, w / 2, y);
  y += phone ? 13 : 15;
  ctx.font = `italic 400 ${phone ? 10.5 : 12}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
  ctx.fillStyle = 'rgba(206,196,170,0.85)';
  ctx.fillText(fortressState(game.save).name, w / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += phone ? 16 : 20;

  // ---- and whether the hunt can be ended yet ----
  if (masterDown(game.save) || masterReady(game.save)) {
    ctx.font = `500 ${phone ? 9.5 : 11}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.2px';
    ctx.fillStyle = masterDown(game.save) ? 'rgba(232,192,116,0.98)' : 'rgba(232,150,110,0.95)';
    ctx.fillText(masterDown(game.save) ? 'THE MASTER IS DEAD' : 'TONIGHT IT CAN BE ENDED', w / 2, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    y += phone ? 16 : 20;
  }

  // ---- the thumb comes first: everything above it has to fit over it ----
  const bwRef = phone ? Math.min(w - 28, 420) : Math.min(240, w * 0.6);
  const bhRef = h < 620 ? 40 : 46;
  const stackTop = h - (bhRef + 8) * 3 - (phone ? 10 : 18);

  // ---- the board she keeps ----
  const board = boardEntries(game.save);
  const cardX = pad, cardW = colW;
  const boardTop = y;
  const boardH = Math.max(78, stackTop - boardTop - (phone ? 12 : 18));
  const boardFloor = boardTop + boardH - 6;
  const roomFor = (need) => ly + need <= boardFloor;
  ctx.fillStyle = 'rgba(10,10,14,0.62)';
  ctx.fillRect(cardX, boardTop, cardW, boardH);
  ctx.strokeStyle = 'rgba(140,120,70,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cardX + 0.5, boardTop + 0.5, cardW - 1, boardH - 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cardX, boardTop, cardW, boardH);
  ctx.clip();

  ctx.textAlign = 'left';
  let ly = boardTop + 14;
  if (roomFor(phone ? 15 : 17)) {
    ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
    ctx.fillStyle = 'rgba(200,160,74,0.8)';
    ctx.fillText('THE BOARD SHE KEEPS', cardX + 12, ly);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 15 : 17;
  }

  if (!board.intel.length) {
    ctx.font = `italic 400 ${phone ? 11 : 12.5}px ${SERIF}`;
    ctx.fillStyle = 'rgba(170,162,146,0.75)';
    ctx.fillText('Empty. Bring her something.', cardX + 12, ly);
    ly += 16;
  } else {
    // pinned slips: the last three things you learned, newest first
    const slips = board.intel.slice(-3).reverse();
    for (const s of slips) {
      if (!roomFor(phone ? 27 : 30)) break;
      ctx.save();
      ctx.translate(cardX + 20, ly);
      ctx.rotate(-0.014);
      ctx.fillStyle = 'rgba(226,216,192,0.90)';
      ctx.fillRect(-8, -8, cardW - 30, 25);
      ctx.fillStyle = 'rgba(150,40,40,0.85)';       // the pin
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.font = `400 ${phone ? 8.5 : 10}px ${SERIF}`;
      ctx.fillStyle = 'rgba(40,34,26,0.95)';
      const txt = s.line.length > 52 ? s.line.slice(0, 51) + '…' : s.line;
      ctx.fillText(txt, 2, 3);
      ctx.restore();
      ly += phone ? 27 : 30;
    }
    if (board.intel.length > slips.length && roomFor(phone ? 15 : 17)) {
      ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
      ctx.fillStyle = 'rgba(170,162,146,0.7)';
      ctx.fillText(`+ ${board.intel.length - slips.length} MORE PINNED BEHIND HER`, cardX + 12, ly);
      ly += phone ? 14 : 16;
    }
  }

  // trophies, hung
  if (board.trophies.length && roomFor(phone ? 38 : 42)) {
    ctx.font = `500 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2.5px';
    ctx.fillStyle = 'rgba(200,160,74,0.8)';
    ctx.fillText('TROPHIES', cardX + 12, ly);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 16 : 18;
    let tx = cardX + 26;
    for (const tr of board.trophies) {
      drawTrophy(ctx, tr.glyph, tx, ly, phone ? 13 : 15);
      ctx.font = `400 ${phone ? 9 : 10.5}px ${SANS}`;
      ctx.fillStyle = 'rgba(214,204,182,0.9)';
      ctx.fillText(`×${tr.count}`, tx + 12, ly + 1);
      tx += Math.max(78, ctx.measureText(`×${tr.count}`).width + 46);
      if (tx > cardX + cardW - 40 && roomFor(phone ? 20 : 22)) { tx = cardX + 26; ly += phone ? 20 : 22; }
    }
    ly += phone ? 4 : 6;
  }

  // the rack: the weapon she carries, the temperings it wears, and the rung
  // the hunt is still reaching for (#56 P5 — the mid-term goal layer)
  if (roomFor(phone ? 16 : 18)) {
    const marks = (board.weapon.temper || []).join(' · ');
    ctx.font = `400 ${phone ? 9.5 : 11}px ${SANS}`;
    ctx.fillStyle = (board.weapon.temper || []).length ? 'rgba(214,226,246,0.92)' : 'rgba(196,186,164,0.85)';
    ctx.fillText(board.weapon.name + (marks ? ` · ${marks}` : ''), cardX + 12, Math.min(ly, boardFloor - 2));
    ly += phone ? 14 : 16;
  }
  if (roomFor(phone ? 16 : 18)) {
    const n = board.weapon.next;
    ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(200,160,74,0.85)';
    const line = !n ? 'THE KIT IS FULLY TEMPERED'
      : !n.hasIntel ? `NEXT · ${n.name} · ${n.need - n.facts} MORE FACTS`
      : !n.hasCost ? `NEXT · ${n.name} · ${n.cost - n.materials} MORE MATERIALS`
      : `NEXT · ${n.name} · READY`;
    ctx.fillText(line, cardX + 12, Math.min(ly, boardFloor - 2));
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ly += phone ? 14 : 16;
  }
  if (roomFor(phone ? 16 : 18)) {
    ctx.font = `400 ${phone ? 8.5 : 10}px ${SANS}`;
    ctx.fillStyle = 'rgba(160,152,134,0.75)';
    ctx.fillText(`◆ ${board.materials} MATERIALS · ${board.nights} NIGHTS BANKED`, cardX + 12, Math.min(ly, boardFloor - 1));
  }
  ctx.restore();      // the board's clip

  // ---- the thumb ----
  const items = [
    { label: 'ANOTHER NIGHT', onClick: () => game.beginNight(), accent: '#a8833c' },
    { label: 'UPGRADES', onClick: () => game.setScreen('upgrades', 'refuge'), accent: '#8a7a52' },
    { label: 'MAIN MENU', onClick: () => game.toMenu(), accent: '#6a6a80' },
  ];
  let by = stackTop;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const r = uiButton(game, { x: w / 2 - bwRef / 2, y: by, w: bwRef, h: bhRef, label: it.label, onClick: it.onClick, accent: it.accent, small: true });
    buttonVisual(ctx, r.b, { active: r.hover || (game.usingKeyboard && game.uiIndex === i), label: it.label, small: true, accent: it.accent });
    by += bhRef + 8;
  });
  ctx.restore();
}

/* =======================================================================
 * THE FIELD CARD — the three in-run destinations for stock, objectives and
 * progression. The simulation pauses while it is open; the live 3D night
 * remains behind the card.
 * ======================================================================= */

