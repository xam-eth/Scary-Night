/* LAST NIGHT — Survival mode HUD and daytime builder panel.
 * Canvas is UI-only; the mansion and every placed object remain in World3D.
 */

import { clamp, TAU } from '../core/util.js';
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

function addIconTile(game, ctx, box, {
  icon, cost = '', caption = '', onClick, disabled = false, selected = false, color = AMBER,
  costOil = null, costWood = null,
}) {
  const item = {
    ...box,
    idx: game.ui.length,
    label: `survival:${icon}:${cost || caption}`,
    onClick,
    disabled: !!disabled,
    costOil, costWood,
  };
  game.ui.push(item);
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 8);
  ctx.fillStyle = disabled ? 'rgba(28,29,33,0.72)' : selected ? 'rgba(89,65,32,0.92)' : 'rgba(22,24,30,0.92)';
  ctx.fill();
  ctx.strokeStyle = disabled ? 'rgba(142,137,126,0.2)' : selected ? 'rgba(238,197,113,0.95)' : 'rgba(191,168,119,0.42)';
  ctx.lineWidth = selected ? 1.7 : 1;
  ctx.stroke();
  const iconSize = Math.min(22, box.h * 0.42);
  const ink = disabled ? '#77746c' : color;
  drawGameIcon(ctx, icon, box.x + box.w / 2, box.y + box.h * 0.32, iconSize, ink);
  const oil = Number(item.costOil);
  const wood = Number(item.costWood);
  if (Number.isFinite(oil) && Number.isFinite(wood) && (oil > 0 || wood > 0)) {
    drawChip(ctx, box.x + 4, box.y + box.h - 18, (box.w - 10) / 2, 'oil', oil, '#e0b36a');
    drawChip(ctx, box.x + box.w / 2 + 1, box.y + box.h - 18, (box.w - 10) / 2, 'plank', wood, '#c8b48a');
  } else {
    const sub = cost || caption;
    if (sub) text(ctx, sub, box.x + box.w / 2, box.y + box.h * 0.78, 7, disabled ? '#6f6c66' : PAPER, 'center');
  }
  ctx.restore();
  return item;
}

function drawChip(ctx, x, y, w, icon, value, accent) {
  ctx.save();
  roundRect(ctx, x, y, w, 20, 6);
  ctx.fillStyle = 'rgba(8,9,13,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(196,170,118,0.26)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawGameIcon(ctx, icon, x + 11, y + 10, 12, accent);
  text(ctx, String(value), x + 22, y + 10, 9, PAPER, 'left');
  ctx.restore();
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

function drawResourcePill(ctx, x, y, width, icon, value, accent) {
  ctx.save();
  roundRect(ctx, x, y, width, 26, 8);
  ctx.fillStyle = 'rgba(8,9,13,0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(196,170,118,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawGameIcon(ctx, icon, x + 13, y + 13, 14, accent);
  text(ctx, String(value), x + 24, y + 13, 11, PAPER, 'left');
  ctx.restore();
}

function drawTopDock(game, ctx, w, h) {
  const mode = game.survival;
  const landscape = w >= h;
  const dockH = landscape ? 34 : 38;
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,11,0.78)';
  ctx.fillRect(0, 0, w, dockH + 6);
  ctx.fillStyle = 'rgba(218,181,112,0.3)';
  ctx.fillRect(0, dockH + 5, w, 1);
  ctx.restore();
  drawPause(game, ctx, w, h);
  const pillW = landscape ? 70 : 62;
  const gap = 8;
  const pills = [
    { icon: 'oil', value: Math.floor(mode.oil), color: '#f0ae53' },
    { icon: 'plank', value: Math.floor(mode.wood), color: '#c89a5a' },
    { icon: 'lamp', value: mode.perapianLevel, color: AMBER },
  ];
  const total = pills.length * pillW + gap * (pills.length - 1);
  let x = Math.max(48, (w - total) / 2);
  for (const pill of pills) {
    drawResourcePill(ctx, x, 8, pillW, pill.icon, pill.value, pill.color);
    x += pillW + gap;
  }
  if (mode.phase === 'night') {
    text(ctx, timeLabel(mode.nightDuration - mode.elapsed), w - 12, 16, 11, PAPER, 'right');
    const wave = Math.min(3, Math.max(1, mode.waveIndex || (mode.incoming && mode.incoming.kind === 'swarm' ? mode.incoming.wave : 1)));
    text(ctx, `${mode.day}:${mode.waveIndex >= 3 ? 3 : wave}`, w - 12, 30, 9, AMBER, 'right');
  } else {
    text(ctx, `DAWN ${mode.day}`, w - 14, 22, 11, AMBER, 'right', SERIF);
  }
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
  const landscape = w >= h;
  const barY = landscape ? 46 : 50;
  const barW = Math.min(220, w * 0.42);
  const barX = (w - barW) / 2;
  meter(ctx, barX, barY, barW, 3, mode.elapsed / Math.max(1, mode.nightDuration), 'rgba(225,176,90,0.9)');

  const p = game.player;
  const gate = mode.mainGate();
  const hpPct = p.bloodMax > 0 ? p.blood / p.bloodMax : 0;
  const gatePct = gate && gate.hpMax > 0 ? gate.hp / gate.hpMax : 0;
  const hpFill = hpPct < 0.28 ? 'rgba(214,74,74,0.95)' : hpPct < 0.55 ? 'rgba(232,168,74,0.95)' : 'rgba(214,196,140,0.92)';
  const gateFill = gate && gate.broken ? 'rgba(160,40,48,0.9)' : 'rgba(168,196,214,0.9)';
  const statY = barY + 8;
  const gap = 10;
  const half = (barW - gap) / 2;
  drawGameIcon(ctx, 'blood', barX + 7, statY + 4, 10, hpFill);
  meter(ctx, barX + 16, statY, half - 16, 6, hpPct, hpFill);
  drawGameIcon(ctx, 'gate', barX + half + gap + 7, statY + 4, 10, gateFill);
  meter(ctx, barX + half + gap + 16, statY, half - 16, 6, gatePct, gateFill);
  drawGameIcon(ctx, 'crew', w - 28, statY + 4, 11, PAPER);
  text(ctx, String(mode.survivors), w - 14, statY + 4, 9, PAPER, 'right');

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
  const door = mode.nearestDoor && mode.nearestDoor();
  if (door && !door.broken) {
    drawLessonChip(ctx, w, h, door.open ? 'CLOSE DOOR' : 'OPEN DOOR', 'HOLD THE GATE');
  } else {
    const feeding = mode.ftue && mode.ftue.step === 'done' && mode.nearHearth()
      && mode.oil >= mode.tuning.feedOil && mode.feedCd <= 0;
    if (feeding) drawLessonChip(ctx, w, h, 'FEED HEARTH', 'KEEP THE LIGHT');
  }
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
    drawLessonChip(ctx, w, h, 'MOVE', 'DRAG TO RUN');
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

export function dayPanelHeight(h, w = 0) {
  const landscape = (w > 0 && w >= h) || h < 520;
  return landscape ? 52 : 56;
}

function drawPlotPrices(game, ctx, w, h) {
  const mode = game.survival;
  if (!mode || !game.renderer || !game.renderer.worldToScreen) return;
  const rooms = mode.buildableRooms();
  for (const room of rooms) {
    const cost = mode.plotCost(room.id);
    if (!cost) continue;
    const sp = game.renderer.worldToScreen(room.x + room.w / 2, room.y + room.h / 2);
    if (sp.x < 40 || sp.x > w - 40 || sp.y < 70 || sp.y > h - 90) continue;
    const bw = 78;
    const x = sp.x - bw / 2;
    const y = sp.y - 18;
    ctx.save();
    roundRect(ctx, x, y, bw, 22, 7);
    ctx.fillStyle = 'rgba(8,9,12,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(196,170,118,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawGameIcon(ctx, 'oil', x + 12, y + 11, 11, '#e0b36a');
    text(ctx, String(cost.oil), x + 22, y + 11, 9, PAPER, 'left');
    drawGameIcon(ctx, 'plank', x + 46, y + 11, 11, '#c8b48a');
    text(ctx, String(cost.wood), x + 56, y + 11, 9, PAPER, 'left');
    ctx.restore();
  }
}

function drawDayPanel(game, ctx, w, h) {
  const mode = game.survival;
  const btn = 44;
  const gap = 8;
  const margin = 12;
  const playX = w - margin - btn;
  const btnY = h - margin - btn;

  ctx.save();
  if (mode.builderJob) {
    const job = mode.builderJob;
    const amount = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    const barW = Math.min(240, w * 0.42);
    const barX = (w - barW) / 2;
    roundRect(ctx, barX, 44, barW, 4, 2);
    ctx.fillStyle = 'rgba(205,192,160,0.18)'; ctx.fill();
    roundRect(ctx, barX, 44, barW * amount, 4, 2);
    ctx.fillStyle = 'rgba(230,185,99,0.95)'; ctx.fill();
    text(ctx, mode.buildingName(job.type), w / 2, 38, 9, AMBER, 'center');
  }

  const busy = !!mode.builderJob;
  addIconTile(game, ctx, { x: playX, y: btnY, w: btn, h: btn }, {
    icon: 'play', caption: '', onClick: () => mode.startNight(),
    disabled: busy, color: '#f0d9a3',
  });

  if (!busy && !mode.buildMenuOpen) {
    drawLessonChip(ctx, w, h, 'TAP A PLOT', 'OIL + WOOD TO RAISE IT');
  }
  drawPlotPrices(game, ctx, w, h);

  if (mode.buildMenuOpen && !busy) {
    const choices = mode.buildChoices();
    const tile = 44;
    const sheetW = Math.min(w - 32, Math.max(168, choices.length * (tile + gap) + 24));
    const sheetH = 102;
    const sheetX = (w - sheetW) / 2;
    const sheetY = btnY - sheetH - 10;
    fillPanel(ctx, sheetX, sheetY, sheetW, sheetH, 0.95);
    text(ctx, mode.buildMenuTitle(), sheetX + 12, sheetY + 14, 9, AMBER, 'left');
    addButton(game, ctx, { x: sheetX + sheetW - 36, y: sheetY + 6, w: 28, h: 18 }, 'X',
      () => mode.closeBuildMenu(), { fontSize: 10, radius: 6, color: DIM });
    if (!choices.length) {
      text(ctx, 'NOTHING TO PLACE HERE', w / 2, sheetY + 52, 8, DIM, 'center');
    } else {
      const rowW = choices.length * tile + gap * (choices.length - 1);
      const rowX = sheetX + (sheetW - rowW) / 2;
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        addIconTile(game, ctx, {
          x: rowX + i * (tile + gap), y: sheetY + 28, w: tile, h: 62,
        }, {
          icon: choice.icon, cost: choice.cost, color: '#ddc58f',
          costOil: choice.costOil, costWood: choice.costWood,
          disabled: choice.disabled,
          onClick: () => mode.startBuild(choice.type, mode.selectedRoom),
        });
      }
    }
  }

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
  if (game.survival.phase === 'complete') {
    drawEndPanel(game, ctx, w, h, false);
    return;
  }
  if (game.survival.phase === 'failed') {
    drawEndPanel(game, ctx, w, h, true);
    return;
  }
  drawTopDock(game, ctx, w, h);
  if (game.survival.phase === 'day') {
    drawDayPanel(game, ctx, w, h);
    return;
  }
  drawNightHud(game, ctx, w, h);
}
