/* LAST NIGHT — Survival mode HUD and daytime builder panel.
 * Canvas is UI-only; the mansion and every placed object remain in World3D.
 */

import { clamp, TAU } from '../core/util.js';
import { SURVIVAL_BUILDINGS } from '../game/survival.js';
import { pauseButtonBox } from '../game/hud.js';
import { drawDrag, guideScale } from '../game/coach.js';
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

function meter(ctx, x, y, w, h, amount, fill, back = 'rgba(234,220,188,0.16)') {
  roundRect(ctx, x, y, w, h, 2);
  ctx.fillStyle = back; ctx.fill();
  const width = w * clamp(amount, 0, 1);
  if (width > 0.5) {
    roundRect(ctx, x, y, width, h, 2);
    ctx.fillStyle = fill; ctx.fill();
  }
}

function drawNightHud(game, ctx, w, h) {
  const mode = game.survival;
  const compact = w < 500 || h < 560;
  drawPause(game, ctx, w, h);
  const titleY = compact ? 22 : 30;
  text(ctx, `NIGHT ${mode.day}`, w / 2, titleY, compact ? 14 : 16, AMBER, 'center', SERIF);
  text(ctx, timeLabel(mode.nightDuration - mode.elapsed), w / 2, titleY + 20, 12, PAPER, 'center');

  const gap = 6;
  const resourceW = Math.min(88, Math.max(64, (w - 86) / 3));
  const rowW = resourceW * 3 + gap * 2;
  const startX = Math.max(12, (w - rowW) / 2);
  const rowY = compact ? 56 : 68;
  drawResource(ctx, startX, rowY, 'OIL', Math.floor(mode.oil), 'lamp', resourceW, '#f0ae53');
  drawResource(ctx, startX + resourceW + gap, rowY, 'WOOD', Math.floor(mode.wood), 'plank', resourceW, '#c89a5a');
  drawResource(ctx, startX + (resourceW + gap) * 2, rowY, 'HEARTH', mode.perapianLevel, 'lamp', resourceW, AMBER);

  const barW = Math.min(210, w * 0.5);
  const barX = (w - barW) / 2;
  const barY = rowY + 36;
  meter(ctx, barX, barY, barW, 4, mode.elapsed / Math.max(1, mode.nightDuration), 'rgba(225,176,90,0.9)');
  const wave = Math.min(3, Math.max(1, mode.waveIndex || (mode.incoming && mode.incoming.kind === 'swarm' ? mode.incoming.wave : 1)));
  const waveLabel = mode.waveIndex >= 3 ? 'WAVE 3/3' : `WAVE ${wave}/3`;
  text(ctx, waveLabel, w - 12, titleY + 1, 9, 'rgba(231,210,167,0.86)', 'right');
  text(ctx, `CREW ${mode.survivors}`, w - 12, titleY + 20, 9, PAPER, 'right');

  const p = game.player;
  const gate = mode.mainGate();
  const hpPct = p.bloodMax > 0 ? p.blood / p.bloodMax : 0;
  const gatePct = gate && gate.hpMax > 0 ? gate.hp / gate.hpMax : 0;
  const hpFill = hpPct < 0.28 ? 'rgba(214,74,74,0.95)' : hpPct < 0.55 ? 'rgba(232,168,74,0.95)' : 'rgba(214,196,140,0.92)';
  const gateFill = gate && gate.broken ? 'rgba(160,40,48,0.9)' : 'rgba(168,196,214,0.9)';
  const statY = barY + 12;
  const half = (rowW - gap) / 2;
  text(ctx, 'HP', startX, statY + 6, 8, DIM, 'left');
  meter(ctx, startX + 18, statY, half - 18, 7, hpPct, hpFill);
  const gateX = startX + half + gap;
  text(ctx, 'GATE', gateX, statY + 6, 8, DIM, 'left');
  meter(ctx, gateX + 30, statY, half - 30, 7, gatePct, gateFill);

  if (mode.incoming) {
    const eta = Math.max(0, Math.ceil(mode.incoming.in));
    const line = mode.incoming.kind === 'breaker'
      ? `BREAKER · ${mode.incoming.label} · ${eta}s`
      : `THEY COME · ${mode.incoming.label} · ${eta}s`;
    const pulse = 0.72 + 0.28 * Math.abs(Math.sin((game.now || mode.elapsed) * 6));
    ctx.save();
    ctx.globalAlpha = pulse;
    roundRect(ctx, w / 2 - 108, statY + 16, 216, 22, 8);
    ctx.fillStyle = 'rgba(42,16,14,0.88)'; ctx.fill();
    ctx.strokeStyle = 'rgba(232,120,86,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, line, w / 2, statY + 27, 9, '#f0c2a0', 'center');
    ctx.restore();
  }

  drawThreatCue(game, ctx, w, h);
  drawFtue(game, ctx, w, h);
  const feeding = mode.ftue && mode.ftue.step === 'done' && mode.nearHearth()
    && mode.oil >= mode.tuning.feedOil && mode.feedCd <= 0;
  if (feeding) drawLessonChip(ctx, w, h, 'FEED HEARTH', 'KEEP THE LIGHT');
  const lock = mode.currentTarget && !mode.currentTarget.dead ? mode.currentTarget : null;
  if (lock) {
    const kind = lock._survivalType === 'breaker' ? 'BREAKER' : lock._survivalType === 'individual' ? 'ZOMBIE' : 'SWARM';
    text(ctx, `LOCK · ${kind}`, w / 2, statY + (mode.incoming ? 48 : 22), 8, AMBER, 'center');
  }
}

function drawThreatCue(game, ctx, w, h) {
  const mode = game.survival;
  const mark = mode.threatPoint && mode.threatPoint();
  if (!mark || !game.renderer.worldToScreen) return;
  const view = game.renderer.view || { left: 0, top: 0, w, h };
  const sp = game.renderer.worldToScreen(mark.x, mark.y);
  const pad = 36;
  const on = sp.x > view.left + pad && sp.x < view.left + view.w - pad
    && sp.y > view.top + 88 && sp.y < view.top + view.h - 120;
  if (on && !mark.incoming) return;
  const cx = view.left + view.w / 2;
  const cy = view.top + view.h / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const hx = view.w / 2 - 40, hy = view.h / 2 - 96;
  const tx = Math.abs(dx) > 0.001 ? hx / Math.abs(dx) : 1e9;
  const ty = Math.abs(dy) > 0.001 ? hy / Math.abs(dy) : 1e9;
  const t = Math.min(tx, ty);
  const x = on ? sp.x : cx + dx * t;
  const y = on ? sp.y - 28 : cy + dy * t;
  const pulse = 0.7 + 0.3 * Math.abs(Math.sin((game.now || mode.elapsed) * 5));
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.translate(x, y);
  ctx.rotate(on ? -Math.PI / 2 : ang);
  ctx.fillStyle = mark.incoming ? '#e88962' : '#e4bd73';
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(-8, -7); ctx.lineTo(-8, 7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = pulse;
  text(ctx, mark.label, x - dx * 18, y - dy * 18 - 2, 8, mark.incoming ? '#f0c2a0' : AMBER, 'center');
  ctx.restore();
}

function drawLessonChip(ctx, w, h, title, sub) {
  ctx.save();
  ctx.font = `600 12px ${MONO}`;
  const tw = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width * 0.92);
  const bw = Math.min(w - 24, tw + 28);
  const bh = 38;
  const x = (w - bw) / 2;
  const y = Math.min(h - 210, h * 0.62);
  roundRect(ctx, x, y, bw, bh, 10);
  ctx.fillStyle = 'rgba(8,7,6,0.9)'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,208,120,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
  text(ctx, title, w / 2, y + 13, 11, AMBER, 'center');
  text(ctx, sub, w / 2, y + 27, 9, PAPER, 'center');
  ctx.restore();
}

function drawFtue(game, ctx, w, h) {
  const mode = game.survival;
  const lesson = mode.ftue;
  if (!lesson || lesson.step === 'done' || mode.day !== 1 || mode.phase !== 'night') return;
  const input = game.input;
  const gs = guideScale(w, h);
  if (lesson.step === 'move') {
    const s = input && input.stick;
    const hx = (s && s.homeX) || w * 0.16;
    const hy = (s && s.homeY) || h - 120;
    const hr = (s && s.r) || 52;
    drawDrag(ctx, hx, hy, hr, game.now || mode.elapsed, gs);
    drawLessonChip(ctx, w, h, 'MOVE', 'DRAG TO WALK');
    return;
  }
  if (lesson.step === 'light') {
    drawLessonChip(ctx, w, h, 'HEARTH', 'SAFE ZONE — THEY WEAKEN HERE');
    return;
  }
  if (lesson.step === 'flare') {
    const b = input && input.buttons && input.buttons.interact;
    if (b && !b.hidden) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin((game.now || mode.elapsed) * 5));
      ctx.save();
      ctx.strokeStyle = `rgba(240, 208, 120, ${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 7 + pulse * 3, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    drawLessonChip(ctx, w, h, 'FLARE', 'PUSH THEM BACK');
  }
}

export function dayPanelHeight(h) {
  if (h < 500) return Math.min(210, Math.max(172, Math.round(h * 0.44)));
  return Math.min(360, Math.max(296, h * 0.47));
}

function drawDayPanel(game, ctx, w, h) {
  drawPause(game, ctx, w, h);
  const mode = game.survival;
  const short = h < 500;
  const panelH = dayPanelHeight(h);
  const panelY = h - panelH;
  const inset = 12;
  const innerW = w - inset * 2;
  const roomPageSize = short ? 2 : 6;
  const rooms = mode.buildableRooms();
  const pages = Math.max(1, Math.ceil(rooms.length / roomPageSize));
  if (mode.selectedRoom) {
    const selectedIdx = rooms.findIndex((room) => room.id === mode.selectedRoom);
    if (selectedIdx >= 0) mode.roomPage = Math.floor(selectedIdx / roomPageSize);
  }
  mode.roomPage = clamp(mode.roomPage || 0, 0, pages - 1);
  const pageRooms = rooms.slice(mode.roomPage * roomPageSize, (mode.roomPage + 1) * roomPageSize);
  let selected = rooms.find((room) => room.id === mode.selectedRoom) || null;
  if (!selected) {
    selected = pageRooms[0] || rooms[0] || null;
    if (selected) mode.selectedRoom = selected.id;
  }

  ctx.save();
  const gradient = ctx.createLinearGradient(0, panelY, 0, h);
  gradient.addColorStop(0, 'rgba(9,10,14,0.90)');
  gradient.addColorStop(1, 'rgba(6,7,10,0.98)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, panelY, w, panelH);
  ctx.strokeStyle = 'rgba(218,181,112,0.44)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, panelY + 1); ctx.lineTo(w, panelY + 1); ctx.stroke();

  text(ctx, `DAY ${mode.day}  ·  BUILD`, inset, panelY + (short ? 16 : 20), short ? 12 : 14, AMBER, 'left', SERIF);
  const statY = panelY + (short ? 34 : 42);
  const statFont = w < 440 || short ? 9 : 10;
  text(ctx, mode.hearthLabel(), inset, statY, 10, AMBER, 'left');
  const speedPct = Math.round((mode.builderSpeedMul() - 1) * 100);
  const crewNote = speedPct > 0 ? ` · +${speedPct}% BUILD` : ` · +${mode.crewGateHp()} GATE`;
  text(ctx, `OIL ${Math.floor(mode.oil)}   WOOD ${Math.floor(mode.wood)}   SURVIVORS ${mode.survivors}${crewNote}`, w - inset, statY, statFont, PAPER, 'right');

  const queueY = panelY + (short ? 50 : 64);
  if (mode.builderJob) {
    const job = mode.builderJob;
    const name = job.kind === 'perapian' ? mode.hearthLabel(job.targetLevel)
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
  } else if (mode.lastRewards) {
    const reward = mode.lastRewards;
    text(ctx, `LAST NIGHT · +${Math.round(reward.oil)} OIL · +${Math.round(reward.wood)} WOOD · ${reward.kills} KILLS`, inset, queueY, 9, '#e3d3ac');
  } else {
    text(ctx, 'BUILDER QUEUE · IDLE', inset, queueY, 9, DIM);
  }

  const slotsY = panelY + (short ? 68 : 88);
  text(ctx, short
    ? `SAFE ZONE · ${rooms.length} · TAP A SLOT`
    : `SAFE ZONE · ${rooms.length} ROOMS · WALK THE HOUSE · TAP A GLOWING SLOT`, inset, slotsY, 9, '#bcb19a');
  const cardGap = 6;
  const cardW = (innerW - cardGap) / 2;
  const cardH = short ? 24 : 31;
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
    text(ctx, 'NO SAFE ROOM · UPGRADE THE HEARTH TO LIGHT MORE', w / 2, cardsTop + cardH / 2, 8, DIM, 'center');
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
  const selectedReady = selected && mode.productionReady(selected.id);
  if (selectedReady) {
    const store = mode.stores[selected.id] || { oil: 0, wood: 0 };
    const loot = [
      store.oil >= 1 ? `+${Math.floor(store.oil)} OIL` : null,
      store.wood >= 1 ? `+${Math.floor(store.wood)} WOOD` : null,
    ].filter(Boolean).join(' · ');
    addButton(game, ctx, { x: inset, y: typesY, w: innerW, h: short ? 26 : 34 },
      `COLLECT · ${loot || 'READY'}`,
      () => mode.collectProduction(selected.id),
      { disabled: false, fontSize: w < 430 || short ? 8 : 9, color: AMBER });
  } else {
    for (let i = 0; i < buildingLabels.length; i++) {
      const [type, label] = buildingLabels[i];
      const spec = SURVIVAL_BUILDINGS[type];
      const affordable = mode.oil >= spec.oil && mode.wood >= spec.wood;
      const available = !!selected && !mode.useBuilding(selected.id);
      addButton(game, ctx, { x: inset + i * (typeW + typeGap), y: typesY, w: typeW, h: short ? 26 : 34 },
        `${label} · ${spec.oil}O/${spec.wood}W`,
        () => mode.startBuild(type, selected && selected.id),
        { disabled: busy || !affordable || !available || !selected, fontSize: w < 430 || short ? 8 : 9, color: '#ddc58f' });
    }
  }

  const actionsY = Math.min(h - (short ? 34 : 43), typesY + (short ? 30 : 39));
  const actionGap = 5;
  const actionW = (innerW - actionGap * 2) / 3;
  const upgrade = mode.buildingCost('perapian');
  const canUpgrade = !!upgrade && mode.oil >= upgrade.oil && mode.wood >= upgrade.wood;
  addButton(game, ctx, { x: inset, y: actionsY, w: actionW, h: short ? 28 : 36 },
    mode.perapianLevel >= 3 ? 'HEARTH · MAX' : `HEARTH LV${mode.perapianLevel + 1} · ${upgrade ? upgrade.oil : 0}O/${upgrade ? upgrade.wood : 0}W`,
    () => mode.startBuild('perapian'),
    { disabled: busy || !canUpgrade, fontSize: w < 430 || short ? 8 : 9, color: AMBER });
  addButton(game, ctx, { x: inset + actionW + actionGap, y: actionsY, w: actionW, h: short ? 28 : 36 },
    mode.gateBuilt ? `GATE · ${Math.round(mode.gateHp)}` : `GATE · ${mode.tuning.gateCost.oil}O/${mode.tuning.gateCost.wood}W`,
    () => mode.startBuild('gate'),
    { disabled: busy || mode.gateBuilt || mode.oil < mode.tuning.gateCost.oil || mode.wood < mode.tuning.gateCost.wood, fontSize: w < 430 || short ? 8 : 9, color: '#d0aa75' });
  addButton(game, ctx, { x: inset + 2 * (actionW + actionGap), y: actionsY, w: actionW, h: short ? 28 : 36 },
    `START NIGHT ${mode.day}`,
    () => mode.startNight(),
    { disabled: busy, fontSize: w < 430 || short ? 8 : 9, color: '#f0d9a3' });

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
  const boxH = 248;
  const x = (w - boxW) / 2;
  const y = (h - boxH) / 2;
  fillPanel(ctx, x, y, boxW, boxH, 0.97);
  text(ctx, failed ? 'THE FIRE GOES OUT' : 'THREE NIGHTS HELD', w / 2, y + 36, 19, AMBER, 'center', SERIF);
  const mode = game.survival;
  if (failed) {
    text(ctx, mode.failureReason || 'THE HUNTER FELL', w / 2, y + 70, 10, PAPER, 'center');
    text(ctx, `NIGHT ${mode.day} · ${mode.hearthLabel()} · ${mode.survivors} CREW`, w / 2, y + 92, 9, DIM, 'center');
  } else {
    const reward = mode.lastRewards || { oil: 0, wood: 0, kills: 0 };
    text(ctx, `HEARTH HELD · ${mode.hearthLabel()}`, w / 2, y + 70, 10, PAPER, 'center');
    text(ctx, `+${reward.oil} OIL · +${reward.wood} WOOD · ${reward.kills} KILLS`, w / 2, y + 90, 9, DIM, 'center');
    const built = Object.keys(mode.buildings).length;
    text(ctx, `SURVIVORS ${mode.survivors} · BUILDINGS ${built} · GATE ${mode.gateBuilt ? 'HELD' : 'OPEN'}`, w / 2, y + 108, 8, DIM, 'center');
  }
  addButton(game, ctx, { x: x + 28, y: y + 148, w: boxW - 56, h: 42 }, 'PLAY AGAIN',
    () => game.survival.restart(), { selected: true, fontSize: 12 });
  addButton(game, ctx, { x: x + 28, y: y + 198, w: boxW - 56, h: 32 }, 'CONTINUE',
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
