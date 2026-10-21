/* DUSKHOLD — Meta screens: blood-shard upgrades, collection/codex, help (Phase 3 split of ui/screens.js). */

import { clamp, TAU } from '../../core/util.js';
import { CODEX } from '../../core/config.js';
import { unlocked, LANES, nextRank, rankCost, rankCount, LANE_CAP } from '../../game/sim/economy.js';
import { fragmentsKnown } from '../../game/meta/narrative.js';
import { SERIF, SANS, isPhone, fitType, uiButton, buttonVisual, drawBrandPlate, wrapText } from './shared.js';

export function drawUpgrades(game, ctx, w, h) {
  const B = game.save;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phoneTitle = isPhone(w, h);
  fitType(ctx, 'BLOOD SHARDS', w - 32, phoneTitle ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('BLOOD SHARDS', w / 2, phoneTitle ? 28 : h * 0.12);
  ctx.font = `400 14px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(200,160,74,0.9)';
  ctx.fillText(`◆ ${B.shards} AVAILABLE`, w / 2, h * 0.175);
  ctx.restore();

  const phone = isPhone(w, h);
  const pad = phone ? 12 : Math.max(24, (w - 640) / 2);
  const rowW = w - pad * 2;
  const top = phone ? 64 : h * 0.24;
  const bottom = h - (phone ? 58 : 108);
  const rowH = clamp((bottom - top) / LANES.length, phone ? 78 : 92, 120);
  let y = top;
  const bx = pad;
  const openLanes = unlocked(B, 'builds');
  LANES.forEach((lane) => {
    const nxt = nextRank(B, lane.id);
    const owned = lane.ranks.filter((r) => B.builds && B.builds[r.id]).length;
    const maxed = !nxt;
    const capped = rankCount(B) >= LANE_CAP && !maxed;
    const cost = nxt ? rankCost(B, nxt) : 0;
    const afford = openLanes && !maxed && !capped && B.shards >= cost;
    const u = { id: lane.id, name: lane.name, desc: openLanes ? (nxt ? nxt.name + ' — ' + lane.blurb : lane.blurb) : 'THE LANES OPEN AFTER TWO DAWNS.', max: lane.ranks.length, icon: lane.id === 'glutton' ? 'claw' : lane.id === 'warden' ? 'plank' : 'boot' };
    const lvl = owned;
    ctx.save();
    // row backing
    ctx.fillStyle = 'rgba(12,12,18,0.7)';
    ctx.fillRect(bx, y, rowW, rowH - 8);
    ctx.strokeStyle = 'rgba(140,120,70,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, rowW - 1, rowH - 9);
    // icon
    ctx.translate(bx + 40, y + (rowH - 10) / 2);
    drawUpgradeIcon(ctx, u.icon, lvl);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'left';
    ctx.font = `500 16px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = '#ded4bc';
    ctx.fillText(u.name, bx + 78, y + 22);
    ctx.font = `400 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(180,172,158,0.7)';
    const descMax = rowW - 78 - (phone ? 100 : 150);
    let desc = u.desc;
    while (ctx.measureText(desc).width > descMax && desc.length > 8) desc = desc.slice(0, -2);
    if (desc !== u.desc) desc = desc.replace(/[,.;]$/, '') + '…';
    if (rowH >= 62) ctx.fillText(desc, bx + 78, y + 40);
    // pips
    for (let k = 0; k < u.max; k++) {
      const px = bx + 78 + k * 20;
      ctx.fillStyle = k < lvl ? '#b8202e' : 'rgba(120,116,110,0.3)';
      ctx.beginPath();
      ctx.moveTo(px + 6, y + 52 - 6);
      ctx.lineTo(px + 12, y + 52);
      ctx.lineTo(px + 6, y + 52 + 6);
      ctx.lineTo(px, y + 52);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // buy button
    const bw = phone ? 88 : 130, bh = Math.min(36, rowH - 16);
    const r = uiButton(game, {
      x: bx + rowW - bw - 10, y: y + (rowH - 8) / 2 - bh / 2, w: bw, h: bh,
      label: !openLanes ? 'LATER' : maxed ? 'MASTERED' : capped ? 'CAPPED' : `◆ ${cost}`, small: true,
      disabled: !afford,
      accent: '#a8833c',
      onClick: () => game.buyUpgrade(lane.id),
    });
    buttonVisual(ctx, r.b, { active: r.hover, label: !openLanes ? 'LATER' : maxed ? 'MASTERED' : capped ? 'CAPPED' : `◆ ${cost}`, small: true, disabled: !afford, accent: '#a8833c' });
    y += rowH;
  });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 12px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillStyle = 'rgba(170,162,150,0.6)';
  if (!phone) ctx.fillText('SIX RANKS. ONE LANE DEEP, OR TWO LANES SHALLOW. YOU CANNOT OWN THE HOUSE.', w / 2, h - 128);
  ctx.restore();

  const backBtn = uiButton(game, { x: w / 2 - 110, y: h - 88, w: 220, h: 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}


function drawUpgradeIcon(ctx, kind, lvl) {
  ctx.save();
  ctx.globalAlpha = 0.25 + lvl * 0.25;
  ctx.strokeStyle = '#c09040';
  ctx.fillStyle = '#c09040';
  ctx.lineWidth = 2;
  switch (kind) {
    case 'blood':
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.quadraticCurveTo(11, 2, 0, 13);
      ctx.quadraticCurveTo(-11, 2, 0, -14);
      ctx.fill();
      break;
    case 'boot':
      ctx.beginPath();
      ctx.moveTo(-6, -14); ctx.lineTo(4, -14); ctx.lineTo(4, 4); ctx.lineTo(12, 8);
      ctx.lineTo(12, 14); ctx.lineTo(-6, 14); ctx.closePath();
      ctx.stroke();
      break;
    case 'plank':
      ctx.beginPath(); ctx.rect(-14, -6, 28, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-8, 6); ctx.moveTo(6, -6); ctx.lineTo(6, 6); ctx.stroke();
      break;
    case 'claw':
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-9, i * 7 - 4);
        ctx.quadraticCurveTo(0, i * 7 + 8, 10, i * 7 + 1);
        ctx.stroke();
      }
      break;
    case 'fangs':
      ctx.beginPath();
      ctx.moveTo(-8, -8); ctx.lineTo(-2, 12); ctx.lineTo(-1, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(8, -8); ctx.lineTo(2, 12); ctx.lineTo(1, -8); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}

/* ================= collection ================= */


export function drawCollection(game, ctx, w, h) {
  const B = game.save;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'COLLECTION', w - 32, phone ? 22 : 30, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('COLLECTION', w / 2, phone ? 26 : h * 0.13);
  ctx.restore();

  const remembered = fragmentsKnown(B).slice(-3);
  const fragReserve = remembered.length ? (phone ? 6 + remembered.length * 32 : 10 + remembered.length * 36) : 0;
  const cols = phone ? 1 : Math.min(3, Math.max(1, Math.floor(w / 380)));
  const gap = phone ? 8 : 16;
  const cw = phone ? w - 24 : Math.min(340, (w - 80) / cols - gap);
  const rows = Math.ceil(CODEX.length / cols);
  const top = phone ? 44 : h * 0.22;
  const bottom = h - (phone ? 56 : 84) - fragReserve;
  const ch = clamp((bottom - top) / rows - gap, phone ? 40 : 120, phone ? 108 : 170);
  const x0 = phone ? 12 : w / 2 - (cols * (cw + gap) - gap) / 2;
  let y = top;
  CODEX.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = x0 + col * (cw + gap);
    const yy = y + row * (ch + gap);
    const known = !!B.seen[c.id];
    ctx.save();
    ctx.fillStyle = known ? 'rgba(14,14,20,0.75)' : 'rgba(8,8,12,0.6)';
    ctx.fillRect(x, yy, cw, ch);
    ctx.strokeStyle = known ? 'rgba(150,125,70,0.35)' : 'rgba(80,78,74,0.22)';
    ctx.strokeRect(x + 0.5, yy + 0.5, cw - 1, ch - 1);
    ctx.textAlign = 'left';
    ctx.font = `500 16px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = known ? '#ded4bc' : 'rgba(120,116,110,0.6)';
    ctx.fillText(known ? c.name : '??? ' + c.name.slice(0, 2) + '· · ·', x + 18, ch < 64 ? yy + ch / 2 : yy + 30);
    if (!known && ch >= 80) {
      // blind-box teaser: the initials, a silhouette, and nothing else
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#9aa4bd';
      ctx.beginPath(); ctx.ellipse(x + cw - 44, yy + ch - 52, 16, 22, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + cw - 44, yy + ch - 82, 7, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.font = `400 12px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.fillStyle = known ? 'rgba(190,182,166,0.8)' : 'rgba(110,106,100,0.5)';
    const txt = known ? c.text
      : 'A shape the house has not handed over yet. ' +
        'Every night keeps its names in a different room.';
    if (ch >= 70 && ch < 88) wrapText(ctx, txt.split('\n')[0], x + 18, yy + 50, cw - 36, 15);
    else if (ch >= 88) wrapText(ctx, txt, x + 18, yy + 56, cw - 36, 17);
    ctx.restore();
  });

  if (remembered.length) {
    const fx = phone ? 12 : w / 2 - 220;
    const fw = phone ? w - 24 : 440;
    const rowH = phone ? 30 : 34;
    let fy = h - (phone ? 48 : 84) - fragReserve + 4;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    remembered.forEach((row) => {
      ctx.fillStyle = 'rgba(14,12,16,0.82)';
      ctx.fillRect(fx, fy, fw, rowH - 4);
      ctx.strokeStyle = 'rgba(180,140,70,0.4)';
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, rowH - 5);
      ctx.font = `500 ${phone ? 11 : 12}px ${SERIF}`;
      ctx.fillStyle = '#e0c48a';
      let name = row.name;
      while (ctx.measureText(name).width > 118 && name.length > 6) name = name.slice(0, -2);
      if (name !== row.name) name = name.replace(/\s$/, '') + '…';
      ctx.fillText(name, fx + 10, fy + (rowH - 4) / 2);
      const nameW = Math.min(126, ctx.measureText(name).width + 18);
      ctx.font = `400 ${phone ? 11 : 12}px ${SANS}`;
      ctx.fillStyle = 'rgba(226,216,198,0.88)';
      let line = row.text;
      while (ctx.measureText(line).width > fw - nameW - 20 && line.length > 8) line = line.slice(0, -2);
      if (line !== row.text) line = line.replace(/[,.;]$/, '') + '…';
      ctx.fillText(line, fx + 10 + nameW, fy + (rowH - 4) / 2);
      fy += rowH;
    });
    ctx.restore();
  }

  const backBtn = uiButton(game, { x: phone ? 12 : w / 2 - 110, y: h - (phone ? 48 : 84), w: phone ? w - 24 : 220, h: phone ? 40 : 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}


export function drawHelp(game, ctx, w, h) {
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'HOW TO SURVIVE', w - 28, phone ? 20 : 28, SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('HOW TO SURVIVE', w / 2, phone ? 26 : h * 0.12);

  const lines = [
    ['00:00 — SERVANT DOOR.', 'It is already shaking. BOARD it, or open it and feed. You cannot do both. Drag the left stick to walk.'],
    ['THE FORT.', 'Gatehouse is west of the hall. USE the stakes — three planks — so they come one at a time. BOARD the palisade. The postern is thin on purpose.'],
    ['THE PACK.', 'Zombies are slow and never alone. You do not have to kill them. Blood drains. The larder feeds you and calls the kitchen.'],
    ['THE NEW WINGS.', 'Gallery is north of the dining room. Oratory is above the glass. The lamp and the altar only slow them.'],
    ['A KNOCK.', 'A chevron points at the door. It does not say what is there. You cannot hold every door. Abandon one.'],
    ['04:30 — PANIC.', 'They come from every entrance. Stop chasing. Stand behind a door that still holds. Dawn is 05:00.'],
    ['THE NEXT NIGHT.', 'Every dawn you live, the next night brings a larger pack. The house remembers.'],
  ];
  let y = h * 0.2;
  ctx.textAlign = 'left';
  const x = Math.max(20, w / 2 - Math.min(330, w * 0.42));
  const maxW = Math.min(660, w - x - 20);
  const slot = Math.max(46, (h - 96 - y) / lines.length);
  for (const [head, body] of lines) {
    ctx.font = `500 ${slot < 52 ? 13 : 15}px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = '#c8a04a';
    ctx.fillText(head, x, y);
    ctx.font = `400 ${slot < 52 ? 12 : 13}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(198,190,176,0.85)';
    wrapText(ctx, body, x, y + 16, maxW, slot < 52 ? 14 : 16);
    y += slot;
  }
  ctx.restore();

  const backBtn = uiButton(game, { x: phone ? 12 : w / 2 - 110, y: h - (phone ? 48 : 80), w: phone ? w - 24 : 220, h: phone ? 40 : 44, label: 'BACK', small: true, accent: '#6a6a80', onClick: () => game.setScreen(game.settingsReturn || 'menu') });
  buttonVisual(ctx, backBtn.b, { active: backBtn.hover, label: 'BACK', small: true, accent: '#6a6a80' });
}

/* ================= death ================= */

/**
 * The hunt's payoff beat: what the night bought, on a death and on a dawn
 * alike. A night that ends in blood still taught you
 * something about the thing you came to kill, and the screen says so — this is
 * the difference between TRY AGAIN and "I am one step closer to it."
 *
 * Drawn as a hunter's journal: the intel first (what you learned), then what
 * you carry, then the one meter that only ever moves forward.
 */
