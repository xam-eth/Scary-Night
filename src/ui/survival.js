/* LAST NIGHT — Survival mode HUD and daytime builder panel.
 * Canvas is UI-only; the mansion and every placed object remain in World3D.
 */

import { clamp } from '../core/util.js';
import { SURVIVAL_BUILDINGS } from '../game/survival.js';
import { pauseButtonBox } from '../game/hud.js';
import { drawGameIcon } from './icons.js';
import { drawIconButton, iconButtonState, UI_TOKENS } from './components.js';

const SERIF = '"IM Fell English SC", Georgia, serif';
const MONO = 'ui-monospace, "SFMono-Regular", Consolas, monospace';
const AMBER = '#e4bd73';
const PAPER = '#eee7d6';
const DIM = '#aaa18f';

function roundRect(ctx, x, y, w, h, r = 8) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillPanel(ctx, x, y, w, h, alpha = 0.9) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = `rgba(8, 10, 14, ${alpha})`;
  ctx.fill();
  ctx.strokeStyle = 'rgba(213, 181, 119, 0.34)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function text(ctx, value, x, y, size, color = PAPER, align = 'left', font = MONO) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), x, y);
}

function timeLabel(seconds) {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function addButton(game, ctx, box, label, onClick, options = {}) {
  const item = {
    ...box,
    idx: game.ui.length,
    label: `survival:${label}`,
    onClick,
    disabled: !!options.disabled,
  };
  game.ui.push(item);
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, options.radius || 8);
  ctx.fillStyle = options.disabled ? 'rgba(33,34,37,0.72)' : options.selected ? 'rgba(89,65,32,0.86)' : 'rgba(24,27,33,0.92)';
  ctx.fill();
  ctx.strokeStyle = options.disabled ? 'rgba(142,137,126,0.22)' : options.selected ? 'rgba(238,197,113,0.92)' : 'rgba(191,168,119,0.46)';
  ctx.lineWidth = options.selected ? 1.8 : 1;
  ctx.stroke();
  text(ctx, label, box.x + box.w / 2, box.y + box.h / 2, options.fontSize || 10, options.disabled ? '#77746c' : options.color || PAPER, 'center', options.font || MONO);
  ctx.restore();
  return item;
}

function drawPause(game, ctx, w, h) {
  const hit = pauseButtonBox(w, h);
  const item = { ...hit, label: 'PAUSE', idx: game.ui.length, onClick: () => game.togglePause(true) };
  game.ui.push(item);
  const size = h < 500 ? UI_TOKENS.size.pauseShort : UI_TOKENS.size.pauseStandard;
  drawIconButton(ctx, hit.x + (hit.w - size) / 2, hit.y + (hit.h - size) / 2, size, 'pause', {
    state: iconButtonState(game, item), shape: 'rounded', iconSize: h < 500 ? 12 : 14,
  });
}

function drawResource(ctx, x, y, label, value, icon, width, accent) {
  ctx.save();
  roundRect(ctx, x, y, width, 32, 8);
  ctx.fillStyle = 'rgba(8,9,13,0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(196,170,118,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawGameIcon(ctx, icon, x + 14, y + 16, 16, accent);
  text(ctx, `${label} ${value}`, x + 27, y + 16, 10, PAPER, 'left');
  ctx.restore();
}

function drawNightHud(game, ctx, w, h) {
  const mode = game.survival;
  const compact = w < 500 || h < 560;
  drawPause(game, ctx, w, h);
  const titleY = compact ? 25 : 30;
  text(ctx, `NIGHT ${mode.day}`, w / 2, titleY, compact ? 14 : 16, AMBER, 'center', SERIF);
  text(ctx, timeLabel(mode.nightDuration - mode.elapsed), w / 2, titleY + 22, 12, PAPER, 'center');

  const gap = 7;
  const resourceW = Math.min(94, Math.max(72, (w - 100) / 2));
  const rowW = resourceW * 2 + gap;
  const startX = Math.max(62, (w - rowW) / 2);
  const rowY = compact ? 62 : 72;
  drawResource(ctx, startX, rowY, 'OIL', Math.floor(mode.oil), 'lamp', resourceW, '#f0ae53');
  drawResource(ctx, startX + resourceW + gap, rowY, 'WOOD', Math.floor(mode.wood), 'plank', resourceW, '#c89a5a');

  const barW = Math.min(210, w * 0.5);
  const barX = (w - barW) / 2;
  const barY = rowY + 37;
  roundRect(ctx, barX, barY, barW, 4, 2);
  ctx.fillStyle = 'rgba(234,220,188,0.18)'; ctx.fill();
  const progress = clamp(mode.elapsed / Math.max(1, mode.nightDuration), 0, 1);
  roundRect(ctx, barX, barY, barW * progress, 4, 2);
  ctx.fillStyle = 'rgba(225,176,90,0.9)'; ctx.fill();
  text(ctx, `PERAPIAN LV${mode.perapianLevel}`, w - 12, titleY + 1, 9, 'rgba(231,210,167,0.86)', 'right');
}

function drawDayPanel(game, ctx, w, h) {
  const mode = game.survival;
  const panelH = Math.min(360, Math.max(296, h * 0.47));
  const panelY = h - panelH;
  const inset = 12;
  const innerW = w - inset * 2;
  const roomPageSize = 6;
  const rooms = mode.buildableRooms();
  const pages = Math.max(1, Math.ceil(rooms.length / roomPageSize));
  mode.roomPage = clamp(mode.roomPage || 0, 0, pages - 1);
  const pageRooms = rooms.slice(mode.roomPage * roomPageSize, (mode.roomPage + 1) * roomPageSize);
  const selected = pageRooms.find((room) => room.id === mode.selectedRoom) || pageRooms[0] || null;
  if (selected && mode.selectedRoom !== selected.id) mode.selectedRoom = selected.id;

  ctx.save();
  const gradient = ctx.createLinearGradient(0, panelY, 0, h);
  gradient.addColorStop(0, 'rgba(9,10,14,0.90)');
  gradient.addColorStop(1, 'rgba(6,7,10,0.98)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, panelY, w, panelH);
  ctx.strokeStyle = 'rgba(218,181,112,0.44)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, panelY + 1); ctx.lineTo(w, panelY + 1); ctx.stroke();

  text(ctx, `DAY ${mode.day}  ·  BUILD`, inset, panelY + 20, 14, AMBER, 'left', SERIF);
  const statY = panelY + 42;
  const statFont = w < 440 ? 9 : 10;
  text(ctx, `OIL ${Math.floor(mode.oil)}   WOOD ${Math.floor(mode.wood)}   SURVIVORS ${mode.survivors}`, w - inset, statY, statFont, PAPER, 'right');

  const queueY = panelY + 64;
  if (mode.builderJob) {
    const job = mode.builderJob;
    const name = job.kind === 'perapian' ? `PERAPIAN LV${job.targetLevel}`
      : job.kind === 'gate' ? 'REINFORCED GATE'
        : (SURVIVAL_BUILDINGS[job.type]?.label || job.type.toUpperCase());
    text(ctx, `BUILDER · ${name} · ${job.remaining.toFixed(1)}s`, inset, queueY, 9, '#e3d3ac');
    const barX = Math.min(w - 82, inset + 210);
    const barW = Math.max(36, w - inset - barX);
    roundRect(ctx, barX, queueY - 3, barW, 5, 2);
    ctx.fillStyle = 'rgba(205,192,160,0.18)'; ctx.fill();
    const amount = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    roundRect(ctx, barX, queueY - 3, barW * amount, 5, 2);
    ctx.fillStyle = 'rgba(230,185,99,0.9)'; ctx.fill();
  } else {
    text(ctx, 'BUILDER QUEUE · IDLE', inset, queueY, 9, DIM);
  }

  const slotsY = panelY + 88;
  text(ctx, `LIT ROOMS · ${rooms.length} SLOTS · SELECT THEN BUILD`, inset, slotsY, 9, '#bcb19a');
  const cardGap = 6;
  const cardW = (innerW - cardGap) / 2;
  const cardH = 31;
  const cardsTop = slotsY + 10;
  const busy = !!mode.builderJob;
  for (let i = 0; i < pageRooms.length; i++) {
    const room = pageRooms[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = inset + col * (cardW + cardGap);
    const y = cardsTop + row * (cardH + 4);
    const built = mode.useBuilding(room.id);
    const label = built ? `${room.name} · ${mode.buildingName(built)}` : room.name;
    addButton(game, ctx, { x, y, w: cardW, h: cardH }, label,
      () => { mode.selectedRoom = room.id; mode.roomPage = Math.floor(i / roomPageSize); },
      { selected: !!selected && selected.id === room.id, disabled: false, fontSize: w < 430 ? 8 : 9, color: built ? '#d4bb86' : PAPER });
  }
  if (!pageRooms.length) {
    ctx.save();
    roundRect(ctx, inset, cardsTop, innerW, cardH, 7);
    ctx.fillStyle = 'rgba(18,20,24,0.76)'; ctx.fill();
    text(ctx, 'NO EMPTY LIT ROOM · PERAPIAN UPGRADE OPENS MORE', w / 2, cardsTop + cardH / 2, 8, DIM, 'center');
    ctx.restore();
  }

  if (pages > 1) {
    const pgY = slotsY - 9;
    addButton(game, ctx, { x: w - 56, y: pgY, w: 18, h: 18 }, '‹',
      () => { mode.roomPage = (mode.roomPage + pages - 1) % pages; mode.selectedRoom = null; },
      { disabled: false, fontSize: 14, color: AMBER });
    addButton(game, ctx, { x: w - 34, y: pgY, w: 18, h: 18 }, '›',
      () => { mode.roomPage = (mode.roomPage + 1) % pages; mode.selectedRoom = null; },
      { disabled: false, fontSize: 14, color: AMBER });
  }

  const rows = Math.max(1, Math.ceil(pageRooms.length / 2));
  const typesY = cardsTop + rows * (cardH + 4) + 5;
  const typeGap = 5;
  const typeW = (innerW - typeGap * 2) / 3;
  const buildingLabels = [
    ['extractor', 'EXTRACTOR'], ['sawmill', 'SAWMILL'], ['shelter', 'SHELTER'],
  ];
  for (let i = 0; i < buildingLabels.length; i++) {
    const [type, label] = buildingLabels[i];
    const spec = SURVIVAL_BUILDINGS[type];
    const affordable = mode.oil >= spec.oil && mode.wood >= spec.wood;
    const available = !!selected && !mode.useBuilding(selected.id);
    addButton(game, ctx, { x: inset + i * (typeW + typeGap), y: typesY, w: typeW, h: 34 },
      `${label} · ${spec.oil}O/${spec.wood}W`,
      () => mode.startBuild(type, selected && selected.id),
      { disabled: busy || !affordable || !available || !selected, fontSize: w < 430 ? 8 : 9, color: '#ddc58f' });
  }

  const actionsY = Math.min(h - 43, typesY + 39);
  const actionGap = 5;
  const actionW = (innerW - actionGap * 2) / 3;
  const upgrade = mode.buildingCost('perapian');
  const canUpgrade = !!upgrade && mode.oil >= upgrade.oil && mode.wood >= upgrade.wood;
  addButton(game, ctx, { x: inset, y: actionsY, w: actionW, h: 36 },
    mode.perapianLevel >= 3 ? 'PERAPIAN · MAX' : `UPGRADE · ${upgrade ? upgrade.oil : 0}O ${upgrade ? upgrade.wood : 0}W`,
    () => mode.startBuild('perapian'),
    { disabled: busy || !canUpgrade, fontSize: w < 430 ? 8 : 9, color: AMBER });
  addButton(game, ctx, { x: inset + actionW + actionGap, y: actionsY, w: actionW, h: 36 },
    mode.gateBuilt ? `GATE · ${Math.round(mode.gateHp)}` : `GATE · ${mode.tuning.gateCost.oil}O/${mode.tuning.gateCost.wood}W`,
    () => mode.startBuild('gate'),
    { disabled: busy || mode.gateBuilt || mode.oil < mode.tuning.gateCost.oil || mode.wood < mode.tuning.gateCost.wood, fontSize: w < 430 ? 8 : 9, color: '#d0aa75' });
  addButton(game, ctx, { x: inset + 2 * (actionW + actionGap), y: actionsY, w: actionW, h: 36 },
    `START NIGHT ${mode.day}`,
    () => mode.startNight(),
    { disabled: busy, fontSize: w < 430 ? 8 : 9, color: '#f0d9a3' });

  ctx.restore();
}

function drawPausePanel(game, ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(2,3,6,0.72)';
  ctx.fillRect(0, 0, w, h);
  const boxW = Math.min(300, w - 28);
  const boxH = 185;
  const x = (w - boxW) / 2;
  const y = (h - boxH) / 2;
  fillPanel(ctx, x, y, boxW, boxH, 0.97);
  text(ctx, 'PAUSED', w / 2, y + 36, 20, AMBER, 'center', SERIF);
  text(ctx, `DAY ${game.survival.day} · ${game.survival.phase.toUpperCase()}`, w / 2, y + 64, 10, DIM, 'center');
  addButton(game, ctx, { x: x + 24, y: y + 88, w: boxW - 48, h: 38 }, 'RESUME',
    () => game.resumeSurvival(), { selected: true, fontSize: 12 });
  addButton(game, ctx, { x: x + 24, y: y + 135, w: boxW - 48, h: 32 }, 'RESTART 3-DAY RUN',
    () => game.survival.restart(), { fontSize: 10 });
  ctx.restore();
}

function drawEndPanel(game, ctx, w, h, failed = false) {
  ctx.save();
  ctx.fillStyle = 'rgba(2,3,6,0.72)'; ctx.fillRect(0, 0, w, h);
  const boxW = Math.min(340, w - 28);
  const boxH = 230;
  const x = (w - boxW) / 2;
  const y = (h - boxH) / 2;
  fillPanel(ctx, x, y, boxW, boxH, 0.97);
  text(ctx, failed ? 'THE FIRE GOES OUT' : 'THREE NIGHTS HELD', w / 2, y + 38, 19, AMBER, 'center', SERIF);
  if (failed) {
    text(ctx, game.survival.failureReason || 'THE HUNTER FELL', w / 2, y + 74, 10, PAPER, 'center');
  } else {
    const reward = game.survival.lastRewards || { oil: 0, wood: 0, kills: 0 };
    text(ctx, `FINAL PERAPIAN · LV${game.survival.perapianLevel}`, w / 2, y + 73, 10, PAPER, 'center');
    text(ctx, `+${reward.oil} OIL · +${reward.wood} WOOD · ${reward.kills} KILLS`, w / 2, y + 96, 9, DIM, 'center');
  }
  addButton(game, ctx, { x: x + 28, y: y + 132, w: boxW - 56, h: 42 }, 'PLAY AGAIN',
    () => game.survival.restart(), { selected: true, fontSize: 12 });
  addButton(game, ctx, { x: x + 28, y: y + 182, w: boxW - 56, h: 32 }, 'CONTINUE',
    () => { if (failed) game.survival.restart(); else game.survival.enter(); }, { fontSize: 10 });
  ctx.restore();
}

export function drawSurvivalScreen(game, ctx, w, h, worldReady = true) {
  game.ui.length = 0;
  if (!worldReady) {
    ctx.save();
    ctx.fillStyle = 'rgba(5,7,13,0.96)'; ctx.fillRect(0, 0, w, h);
    text(ctx, 'BUILDING THE MANSION IN 3D…', w / 2, h / 2, 12, '#c9c0ad', 'center');
    ctx.restore();
    return;
  }
  if (game.screen === 'paused') {
    drawPausePanel(game, ctx, w, h);
    return;
  }
  if (game.survival.phase === 'day') {
    drawDayPanel(game, ctx, w, h);
    return;
  }
  if (game.survival.phase === 'complete') {
    drawEndPanel(game, ctx, w, h, false);
    return;
  }
  if (game.survival.phase === 'failed') {
    drawEndPanel(game, ctx, w, h, true);
    return;
  }
  drawNightHud(game, ctx, w, h);
}
