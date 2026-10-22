/* DUSKHOLD — The day builder: contextual dock (action button + info row), plot labels/status pills, the TONIGHT chip, reward modal and the whole day screen (Phase 3 split of ui/survival.js). */

import { clamp } from '../../core/util.js';
import { SURVIVAL_BUILDINGS, BUILDING_MAX_LEVEL, HUNTER_MAX_LEVEL, ARMS_MAX_LEVEL, GUARD, gateShort, UNLOCK_TIERS, SURVIVAL_CAMERA } from '../../game/sim/survival.js';
import { drawSurvivalIcon, drawLabel, measureLabel, drawPanel, drawBar, roundRectPath, INK, COLORS } from '../survivalIcons.js';
import { TAU, clock, project, addHit, affordable, onScreen, edgeAvoid, drawEdgeMarker, drawFloaters, drawHunterBar, drawStatusPill, statusPillWidth, drawCounters, drawPauseButton, drawButton, costRow, costWidth, BUTTON_COLORS, zoomButtonLayout, tonightChipBox, BUILD } from './shared.js';
import { offerSurvivalHint, drawHint } from './hints.js';
import { drawPhasePill, drawObjectiveChain } from './chain.js';
import { drawZoomButtons, drawRecenterChip } from './controls.js';

// color: each type's own colour (BUILD 11, playtest 2026-10-17: "tidak tau
// build yg mana") — the same as its kit model's roof and its circle on the
// ground (buildings3d.js BUILDING_COLOR)
const BUILD_META = Object.freeze({
  mine: { icon: 'mine', name: 'GOLD MINE', color: '#ffc22e' },      // digs gold during the night
  sawmill: { icon: 'sawmill', name: 'SAWMILL', color: '#4cc35e' },  // wood every dawn + door planks
  barracks: { icon: 'barracks', name: 'BARRACKS', color: '#3e7bff' },// houses soldiers = gate guards
  tower: { icon: 'tower', name: 'BALLISTA', color: '#ff5640' },     // shoots over the wall
});
/**
 * BUILD 13 (V4, docs/VISUAL-LAYOUT-RESEARCH.md §7: "label hanya saat dekat"):
 * an empty circle spells its name and cost only within about one circle of
 * the captain (world px; the yards' circles stand ~270 apart), two at most;
 * every other circle is its icon on its colour. A built building's status
 * pill shows within STATUS_REACH (or where you stand). Zoomed out to the
 * overview the world shows icons only: the plan of the fort, no words.
 */
const PLOT_NAME_REACH = 380;
const PLOT_NAMES_MAX = 2;
const STATUS_REACH = 560;
const OVERVIEW_ZOOM = 0.62;

/**
 * What a building does at one level, as icon rows (main row first), each
 * with WHEN it pays: moon = during the night, sun = at dawn, instant = now.
 */
function buildingRows(mode, type, level) {
  const st = mode.buildingStats(type, level);
  if (type === 'mine') return [{ icon: 'gold', value: `+${st.yield || 0}`, when: 'moon' }];
  if (type === 'sawmill') {
    return [
      { icon: 'wood', value: `+${st.dawnWood || 0}`, when: 'sun' },
      { icon: 'planks', value: `+${Math.round((st.doorBonus || 0) * 100)}%`, when: null },
    ];
  }
  if (type === 'tower') {
    return [
      { icon: 'crossbow', value: `${st.damage || 0}`, when: null },
      { icon: 'target', value: `${st.range || 0}`, when: null },
    ];
  }
  return [{ icon: 'guard', value: `+${st.houses || 0}`, when: 'instant' }];
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */


/**
 * What the circle the Hunter stands in offers: the button(s) and the mini
 * card. Returns null when he stands in nothing.
 */
function dayAction(mode, here) {
  if (!here) return null;
  const busy = !!mode.builderJob;
  if (here.kind === 'keep') {
    const level = mode.keepLevel;
    const max = level >= 3;
    const cost = mode.keepUpgradeCost();
    const repair = mode.keepRepairCost();
    const hp = mode.keepHpMax(level), hpNext = mode.keepHpMax(Math.min(3, level + 1));
    // the banner row: how many build plots this keep level opens (BUILD 12:
    // plots, not yards — layout B mixes levels within a district)
    const plots = mode.territoryPlots().length;
    return {
      icon: 'keep', name: 'KEEP', level, maxLevel: 3,
      rows: [
        { icon: 'heart', now: `${hp}`, next: max ? null : `${hpNext}` },
        { icon: 'banner', now: `${plots}`, next: max ? null : `${mode.territoryPlots(level + 1).length}` },
      ],
      main: max
        ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
        : { label: 'UPGRADE', icon: 'up', id: `UPGRADE KEEP LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('keep') },
      second: repair
        ? { label: 'REPAIR', icon: 'hammer', id: 'REPAIR KEEP', cost: repair, color: 'blue', disabled: busy || !affordable(mode, repair), run: () => mode.startBuild('repair') }
        : null,
    };
  }
  if (here.kind === 'armory') {
    const level = mode.hunterLevel;
    const max = level >= HUNTER_MAX_LEVEL;
    const cost = mode.hunterUpgradeCost();
    const now = mode.hunterStats(level);
    const next = mode.hunterStats(Math.min(HUNTER_MAX_LEVEL, level + 1));
    const tag = max ? (now.fan > 1 ? '×3' : '') : next.fan > now.fan ? '×3 FAN' : next.pierce > now.pierce ? 'PIERCE' : '';
    return {
      icon: 'hunter', name: 'CAPTAIN', level, maxLevel: HUNTER_MAX_LEVEL, tag,
      rows: [
        { icon: 'crossbow', now: `${now.damage}`, next: max ? null : `${next.damage}` },
        { icon: 'heart', now: `${now.hp}`, next: max ? null : `${next.hp}` },
      ],
      main: max
        ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
        : { label: 'UPGRADE', icon: 'up', id: `UPGRADE HUNTER LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('hunter') },
    };
  }
  if (here.kind === 'arms') {
    // BUILD 14: the garrison's crossbows — one level for every guard, seen
    // on each of them (and on the rack) the moment it is done
    const level = mode.armsLevel;
    const max = level >= ARMS_MAX_LEVEL;
    const cost = mode.armsUpgradeCost();
    const now = mode.armsStats(level);
    const next = mode.armsStats(Math.min(ARMS_MAX_LEVEL, level + 1));
    const tag = max ? (now.pierce ? 'PIERCE' : '') : next.pierce > now.pierce ? 'PIERCE' : next.every < now.every ? 'FASTER' : '';
    const job = mode.builderJob;
    const pct = job && job.kind === 'arms' ? 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1) : null;
    return {
      icon: 'crossbow', name: 'GUARD BOWS', level, maxLevel: ARMS_MAX_LEVEL, tag,
      rows: [
        { icon: 'crossbow', now: `${now.damage}`, next: max ? null : `${next.damage}` },
        { icon: 'guard', now: `×${mode.survivors}`, next: null },
      ],
      main: pct != null
        ? { label: `UPGRADING ${Math.round(pct * 100)}%`, icon: 'up', id: 'UPGRADING ARMS', disabled: true, color: 'gold' }
        : max
          ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
          : { label: 'UPGRADE', icon: 'up', id: `UPGRADE ARMS LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('arms') },
    };
  }
  if (here.kind === 'gate') {
    const cost = mode.tuning.gateCost;
    const gate = mode.mainGate();
    return {
      icon: 'gate', name: 'BARRICADE', level: mode.gateBuilt ? 1 : 0, maxLevel: 1,
      rows: [{ icon: 'heart', now: mode.gateBuilt && gate ? `${Math.round(gate.hpMax)}` : `+${mode.tuning.gateHpBonus}`, next: null }],
      main: mode.gateBuilt
        ? { label: 'BUILT', icon: 'check', id: 'GATE BUILT', disabled: true, color: 'green' }
        : { label: 'BUILD', icon: 'hammer', id: 'GATE', cost, color: 'green', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('gate') },
    };
  }
  // a build circle
  const meta = BUILD_META[here.type] || BUILD_META.barracks;
  if (here.locked) {
    const need = mode.slotUnlockLevel(here.id);
    return {
      icon: meta.icon, name: meta.name, tint: meta.color, level: 0, maxLevel: BUILDING_MAX_LEVEL, locked: need,
      rows: buildingRows(mode, here.type, 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `KEEP Lv${need}`, icon: 'lock', id: `LOCKED ${here.type}`, disabled: true, color: 'gray' },
    };
  }
  const job = mode.builderJob;
  if (job && job.slotId === here.id) {
    // the builder is at work on this circle: the button shows his progress
    const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
    return {
      icon: meta.icon, name: meta.name, tint: meta.color, level: here.built ? mode.buildingLevel(here.id) : 0, maxLevel: BUILDING_MAX_LEVEL,
      rows: buildingRows(mode, job.type, job.targetLevel || 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: `BUILDING ${Math.round(pct * 100)}%`, icon: 'hammer', id: 'BUILDING', disabled: true, color: 'green' },
    };
  }
  if (!here.built) {
    const spec = SURVIVAL_BUILDINGS[here.type];
    return {
      icon: meta.icon, name: meta.name, tint: meta.color, level: 0, maxLevel: BUILDING_MAX_LEVEL,
      rows: buildingRows(mode, here.type, 1).map((row) => ({ icon: row.icon, now: row.value, next: null, when: row.when })),
      main: { label: 'BUILD', icon: 'hammer', id: `BUILD ${here.type}`, cost: spec, color: 'green', disabled: busy || !affordable(mode, spec), run: () => mode.startBuild(here.type, here.id) },
    };
  }
  const level = mode.buildingLevel(here.id);
  const max = level >= BUILDING_MAX_LEVEL;
  const cost = mode.upgradeCost(here.id);
  const nowRows = buildingRows(mode, here.built, level);
  const nextRows = max ? nowRows : buildingRows(mode, here.built, level + 1);
  return {
    icon: meta.icon, name: meta.name, tint: meta.color, level, maxLevel: BUILDING_MAX_LEVEL,
    rows: nowRows.map((row, i) => ({ icon: row.icon, now: row.value, next: max ? null : nextRows[i].value, when: row.when })),
    main: max
      ? { label: 'MAX', icon: 'star', id: 'UPGRADE MAX', disabled: true, color: 'gold' }
      : { label: 'UPGRADE', icon: 'up', id: `UPGRADE ${here.built} LV${level + 1}`, cost, color: 'gold', disabled: busy || !affordable(mode, cost), run: () => mode.startBuild('upgrade', here.id) },
  };
}

/** Icon + verb on top, the cost underneath (red where short). */
function drawActionButton(game, ctx, box, action) {
  const mode = game.survival;
  const disabled = !!action.disabled;
  const colors = BUTTON_COLORS[disabled ? 'gray' : (action.color || 'green')];
  addHit(game, box, action.id, action.run || (() => {}), disabled);
  const r = 16;
  ctx.save();
  roundRectPath(ctx, box.x, box.y + 4, box.w, box.h, r);
  ctx.fillStyle = colors[2]; ctx.fill();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
  const g = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.stroke();
  roundRectPath(ctx, box.x + 4, box.y + 3, box.w - 8, Math.max(4, box.h * 0.32), Math.max(2, r - 4));
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
  ctx.restore();
  const iconSize = Math.round(box.h * 0.56);
  drawSurvivalIcon(ctx, action.icon, box.x + 12 + iconSize / 2, box.y + box.h / 2, iconSize, { alpha: disabled ? 0.75 : 1 });
  const tx = box.x + 18 + iconSize;
  if (action.cost && (action.cost.gold || action.cost.wood)) {
    drawLabel(ctx, action.label, tx, box.y + box.h * 0.32, Math.round(clamp(box.h * 0.3, 13, 19)), '#ffffff', { align: 'left' });
    costRow(ctx, tx, box.y + box.h * 0.72, action.cost, mode, Math.round(clamp(box.h * 0.27, 13, 17)));
  } else {
    drawLabel(ctx, action.label, tx, box.y + box.h / 2 + 1, Math.round(clamp(box.h * 0.32, 13, 20)), disabled ? '#eef0f6' : '#ffffff', { align: 'left' });
  }
}

/**
 * The info half of the action dock: icon, name and level pips on one line,
 * the stats (now → next, the gain in green) on the next. It used to be a
 * 232 x 100 card standing over the button — with the button, 166 px of a
 * 390 px sideways phone (playtest 2026-10-17: "card juga masih besar masih
 * mamakan banyak tempat pada frame gameplay nya"); the dock is one row.
 */
function drawDockInfo(game, ctx, box, action) {
  drawPanel(ctx, box.x, box.y, box.w, box.h, { radius: 14, top: '#3a4190', bottom: '#20244f', lineWidth: 2.4 });
  const x = box.x + 8;
  const row1 = box.y + Math.round(box.h * 0.31);
  const row2 = box.y + Math.round(box.h * 0.72);
  if (action.tint) {
    // the building's own colour behind its icon, as on its circle and roof
    ctx.save();
    ctx.beginPath(); ctx.arc(x + 10, row1, 11.5, 0, TAU);
    ctx.fillStyle = action.tint; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
  }
  drawSurvivalIcon(ctx, action.icon, x + 10, row1, action.tint ? 17 : 20);
  let nameSize = 12;
  const pipW = action.locked ? 34 : action.maxLevel > 1 ? action.maxLevel * 10 + 4 : 0;
  const room = box.w - 32 - pipW - 8;
  while (nameSize > 9 && measureLabel(ctx, action.name, nameSize) > room) nameSize--;
  drawLabel(ctx, action.name, x + 24, row1 + 1, nameSize, '#ffffff', { align: 'left', outline: 2.4 });
  if (action.locked) {
    drawSurvivalIcon(ctx, 'lock', box.x + box.w - 30, row1, 15);
    drawSurvivalIcon(ctx, 'keep', box.x + box.w - 14, row1, 16);
  } else if (action.maxLevel > 1) {
    for (let i = 0; i < action.maxLevel; i++) {
      const px = box.x + box.w - 10 - (action.maxLevel - 1 - i) * 10;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, row1, 3.8, 0, TAU);
      ctx.fillStyle = i < action.level ? '#ffd24a' : 'rgba(255,255,255,0.25)';
      ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    }
  }
  // the stats side by side; a tag (x3 FAN, PIERCE) takes the second seat
  const rows = action.rows.slice(0, 2);
  const cells = rows.map((row) => ({ row, text: row.next != null ? `${row.now} → ${row.next}` : `${row.now}` }));
  let size = 13;
  const cellW = (cell) => 18 + measureLabel(ctx, cell.text, size) + (cell.row.when ? 15 : 0);
  const fit = () => cells.reduce((w, cell) => w + cellW(cell) + 8, 0) + (action.tag ? measureLabel(ctx, action.tag, 9) + 18 : 0);
  while (size > 10 && fit() > box.w - 12) size--;
  let cx = x;
  for (const cell of cells) {
    const { row } = cell;
    drawSurvivalIcon(ctx, row.icon, cx + 8, row2, 16);
    drawLabel(ctx, cell.text, cx + 18, row2 + 1, size, row.next != null ? '#ffffff' : '#e6eaff', { align: 'left', outline: 2.2 });
    if (row.next != null) {
      const before = measureLabel(ctx, `${row.now} → `, size);
      drawLabel(ctx, `${row.next}`, cx + 18 + before, row2 + 1, size, '#7ef08e', { align: 'left', outline: 2.2 });
    }
    let w = 18 + measureLabel(ctx, cell.text, size);
    if (row.when) { drawSurvivalIcon(ctx, row.when, cx + w + 8, row2, 13); w += 15; }
    cx += w + 8;
  }
  if (action.tag) {
    const tw = measureLabel(ctx, action.tag, 9) + 10;
    drawPanel(ctx, cx, row2 - 7, tw, 14, { radius: 7, top: '#ffd24a', bottom: '#f09a1a', lineWidth: 1.4, highlight: false, shadow: false });
    drawLabel(ctx, action.tag, cx + tw / 2, row2 + 0.5, 9, '#3a2400', { outline: 0 });
  }
}

/**
 * Small chips over the circles in view: the building it makes (available),
 * a lock with the keep level (beyond the banner), a gold chevron over a
 * building whose next level you can pay for. Tap one: the Hunter walks there.
 */
/**
 * World height a building's chip floats at: just over the KayKit model
 * (buildings3d.js: the sawmill's roof stands ~170 px, the ballista's swivel
 * ~180, the barracks ~140, the mine's rock ~85).
 */

/**
 * Small chips over the circles in view: the building it makes (available),
 * a lock with the keep level (beyond the banner), a gold chevron over a
 * building whose next level you can pay for. Tap one: the Hunter walks there.
 */
/**
 * World height a building's chip floats at: just over the KayKit model
 * (buildings3d.js: the sawmill's roof stands ~170 px, the ballista's swivel
 * ~180, the barracks ~140, the mine's rock ~85).
 */
function chipHeight(type) {
  return type === 'tower' ? 200 : type === 'sawmill' ? 182 : type === 'barracks' ? 158 : type === 'mine' ? 112 : 120;
}

/** A built building's function as icon + number (null: nothing to say). */
function buildingStatus(mode, point) {
  const level = point.level || mode.buildingLevel(point.id) || 1;
  const stats = mode.buildingStats(point.type, level) || {};
  if (point.type === 'mine') return { icon: 'gold', text: `+${stats.yield || 0}`, tail: 'moon', color: '#ffd24a' };
  if (point.type === 'sawmill') return { icon: 'wood', text: `+${stats.dawnWood || 0}`, tail: 'sun', color: '#ffcf8a' };
  if (point.type === 'barracks') return { icon: 'guard', text: `${stats.houses || 0}`, color: '#8fd4ff' };
  if (point.type === 'tower') {
    const tower = (mode.towers || []).find((t) => t.slotId === point.id);
    const kills = tower ? tower.kills || 0 : 0;
    return kills > 0 ? { icon: 'skull', text: `${kills}`, color: '#ffb36a' } : { icon: 'target', text: `${stats.damage || 0}`, color: '#ffb36a' };
  }
  return null;
}


/**
 * An empty circle's label, on its pad (BUILD 11): the building's icon on its
 * own colour, and when `full` its name and what it costs (red where short;
 * BUILD 13). Returns the box it covers.
 */
function drawPlotLabel(ctx, x, y, icon, name, color, full, cost = null, mode = null) {
  if (!full) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, icon, x, y, 17);
    return { x: x - 18, y: y - 18, w: 36, h: 36 };
  }
  const size = 11;
  const costSize = 13;
  const nameW = measureLabel(ctx, name, size);
  const cw = cost && mode && (cost.gold || cost.wood) ? costWidth(ctx, cost, costSize) : 0;
  const pw = nameW + 36 + (cw ? cw + 8 : 0), ph = 24;
  const left = x - pw / 2;
  drawPanel(ctx, left, y - ph / 2, pw, ph, { radius: 12, top: '#2e2b58', bottom: '#1a1736', lineWidth: 2, stroke: INK, highlight: false, shadow: false });
  ctx.save();
  ctx.beginPath(); ctx.arc(left + 13, y, 10, 0, TAU);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
  drawSurvivalIcon(ctx, icon, left + 13, y, 15);
  drawLabel(ctx, name, left + 27, y + 1, size, '#ffffff', { align: 'left', outline: 2 });
  if (cw) costRow(ctx, left + 27 + nameW + 8, y, cost, mode, costSize);
  return { x: left, y: y - ph / 2, w: pw, h: ph };
}

/**
 * Tonight at one gate, by day (BUILD 13, V10): a red pill with the moon, then
 * the swarm and its count, an Individual's head and a Breaker's helm where
 * they come. Icons and numbers, no words.
 */
function drawTonightBadge(ctx, x, y, row) {
  const items = [];
  if (row.swarm) items.push({ icon: 'swarm', text: `×${row.swarm}` });
  if (row.individuals) items.push({ icon: 'zombie', text: row.individuals > 1 ? `×${row.individuals}` : '' });
  if (row.breakers) items.push({ icon: 'breaker', text: row.breakers > 1 ? `×${row.breakers}` : '' });
  const size = 14, icon = 20, ph = 28;
  let pw = 10 + 18 + 6 + 4;
  for (const it of items) pw += icon + (it.text ? 3 + measureLabel(ctx, it.text, size) : 0) + 6;
  const left = x - pw / 2;
  drawPanel(ctx, left, y - ph / 2, pw, ph, { radius: ph / 2, top: '#ff6a52', bottom: '#b3261c', lineWidth: 2.2, highlight: false, shadow: false });
  let cx = left + 10;
  drawSurvivalIcon(ctx, 'moon', cx + 9, y, 18);
  cx += 18 + 6;
  for (const it of items) {
    drawSurvivalIcon(ctx, it.icon, cx + icon / 2, y, icon);
    cx += icon;
    if (it.text) {
      cx += 3;
      drawLabel(ctx, it.text, cx, y + 1, size, '#ffffff', { align: 'left', outline: 2.5 });
      cx += measureLabel(ctx, it.text, size);
    }
    cx += 6;
  }
  // BUILD 17 (R8): which wave comes at this gate first, as a pip on the
  // badge's corner — the badges by day were a set of gates, and a set does
  // not say where to stand when the night starts
  if (row.order) {
    const r = 9, cx = left + 2, cy = y - ph / 2 + 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = '#1b1530'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    drawLabel(ctx, String(row.order), cx, cy + 1, 11, '#ffffff', { align: 'center', outline: 0 });
    ctx.restore();
  }
  return { x: left, y: y - ph / 2, w: pw, h: ph };
}

/**
 * BUILD 17 (R8, docs/UX-REPLAY-RESEARCH.md §5: "sifat horde per malam
 * diumumkan di senja"): the day's TONIGHT chip. The badges over the gates
 * (BUILD 13, V10) say *which* gates tonight comes at and how many; the chip
 * says it in one read, in order, before the player commits the day's build
 * to a side of the bailey — and it sits in the top band, between PAUSE and
 * the DAY pill, so it costs no world (DESIGN-SYSTEM-PLAN §8.8: the top bar
 * stays ≤ 48 px, the middle stays the world).
 * Null when it does not apply: night, a bookend, the dawn card, or a screen
 * too narrow to fit it clear of the pill (then the badges carry it alone).
 */

function drawTonightChip(game, ctx, w, h) {
  const box = tonightChipBox(game, w, h);
  if (!box) return null;
  const mode = game.survival;
  const call = mode.tonightCall();
  const plan = mode.nightDoors();
  const pad = 10;
  const inner = box.w - pad * 2;
  // the order line, in the longest wording that fits this screen
  let order = null, tier = 'tiny';
  for (const t of ['wide', 'short', 'tiny']) {
    const text = plan.slice(0, 3).map((id) => gateShort(mode.entranceById(id), t)).join(' → ');
    tier = t; order = text;
    if (measureLabel(ctx, text, 12) <= inner) break;
  }
  // the title line: TONIGHT + what the night sends (icons, as everywhere else)
  const counts = [];
  if (call.swarm) counts.push({ icon: 'swarm', text: `${call.swarm}` });
  if (call.runners) counts.push({ icon: 'zombie', text: `${call.runners}` });
  if (call.breakers) counts.push({ icon: 'breaker', text: `${call.breakers}` });
  const titleSize = 10, countSize = 12, iconSize = 16;
  const titleW = measureLabel(ctx, 'TONIGHT', titleSize);
  const countW = (list) => list.reduce((n, it) => n + iconSize + 3 + measureLabel(ctx, it.text, countSize) + 8, 0);
  let shown = counts.slice();
  while (shown.length && titleW + 10 + countW(shown) > inner) shown.pop();
  const line1 = titleW + (shown.length ? 10 + countW(shown) : 0);
  const cw = Math.min(box.w, Math.max(line1, measureLabel(ctx, order, 12)) + pad * 2);
  const x = box.x, y = box.y, ch = box.h;
  drawPanel(ctx, x, y, cw, ch, { radius: 12, top: '#4a51a8', bottom: '#262a66', lineWidth: 2.2 });
  drawLabel(ctx, 'TONIGHT', x + pad, y + 12, titleSize, '#c3caff', { align: 'left', outline: 0 });
  let cx = x + pad + titleW + 10;
  for (const it of shown) {
    drawSurvivalIcon(ctx, it.icon, cx + iconSize / 2, y + 12, iconSize);
    cx += iconSize + 3;
    drawLabel(ctx, it.text, cx, y + 13, countSize, '#ffffff', { align: 'left', outline: 2 });
    cx += measureLabel(ctx, it.text, countSize) + 8;
  }
  drawLabel(ctx, order, x + pad, y + 31, 12, '#ffffff', { align: 'left', outline: 2.5 });
  const drawn = {
    box: { x, y, w: cw, h: ch }, order, tier,
    counts: shown.map((it) => `${it.icon}×${it.text}`),
    breakers: call.breakers, breakerGate: call.breakerGate, first: call.first,
  };
  return drawn;
}


function drawDayWorldLayer(game, ctx, w, h, view) {
  const mode = game.survival;
  const t = clock(game);
  const p = game.player;
  edgeAvoid(game, w, h);
  const here = mode.dayContext();
  let nearestOff = null, nearestD = Infinity;
  const overview = mode.userZoom() <= OVERVIEW_ZOOM;
  const shown = { names: 0, icons: 0, pills: 0, overview };
  // BUILD 11 (playtest 2026-10-17: "lebar benteng dengan component di dalam
  // terlihat sangat padat ... tidak tau build yg mana"): only the circles
  // under the keep's banner show, each with a small label ON its pad in its
  // building's colour; the two nearest within reach of the captain spell the
  // name and cost (BUILD 13), the rest show the icon. A locked circle shows
  // nothing until the banner reaches its yard (no lock badges over the
  // bailey).
  const empty = [];
  for (const point of mode.dayPoints()) {
    if (point.kind === 'keep' || point.kind === 'armory' || point.kind === 'arms') continue;
    if (here && here.id === point.id) continue;
    if (point.locked) continue;
    const built = point.kind === 'slot' ? !!point.built : mode.gateBuilt;
    if (point.kind === 'gate' || !built) {
      if (built) continue;
      const meta = point.kind === 'gate' ? { icon: 'gate', name: 'BARRICADE', color: '#d9a75f' } : (BUILD_META[point.type] || BUILD_META.barracks);
      empty.push({ point, meta, d: Math.hypot(point.x - p.x, point.y - p.y) });
      continue;
    }
    // a building that can go up a level: the arrow over its roof
    if (!(point.level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(point.id)))) continue;
    const at = project(game, point.x, point.y, chipHeight(point.type));
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const bob = Math.sin(t * 4 + point.x * 0.01) * 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(at.x, at.y + bob, 15, 0, TAU);
    ctx.fillStyle = '#fff3c4'; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    drawSurvivalIcon(ctx, 'up', at.x, at.y + bob, 21);
    addHit(game, { x: at.x - 24, y: at.y + bob - 24, w: 48, h: 48 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
  }
  empty.sort((a, b) => a.d - b.d);
  empty.forEach((row) => {
    const { point, meta } = row;
    const at = project(game, point.x, point.y, point.kind === 'gate' ? 60 : 16);
    const inView = at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1;
    if (!inView) {
      if (row.d < nearestD) { nearestD = row.d; nearestOff = { point, at, icon: meta.icon }; }
      return;
    }
    const full = !overview && shown.names < PLOT_NAMES_MAX && row.d <= PLOT_NAME_REACH;
    if (full) shown.names++; else shown.icons++;
    const cost = point.kind === 'gate' ? mode.tuning.gateCost : SURVIVAL_BUILDINGS[point.type];
    const box = drawPlotLabel(ctx, at.x, at.y, meta.icon, meta.name, meta.color, full, cost, mode);
    addHit(game, { x: box.x - 4, y: box.y - 8, w: box.w + 8, h: box.h + 16 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
  });
  // what every built building does, at a glance (R19; playtest 2026-10-16:
  // "bangunan yg di build juga tidak berfungsi"): a mine's gold a night, a
  // sawmill's planks at dawn, the soldiers a barracks houses, a ballista's
  // kills — icon + number, no words
  for (const point of mode.dayPoints()) {
    if (point.kind !== 'slot' || !point.built) continue;
    // near the captain only (V4), never in the overview, always where he stands
    const standing = !!(here && here.id === point.id);
    if (!standing && (overview || Math.hypot(point.x - p.x, point.y - p.y) > STATUS_REACH)) continue;
    const status = buildingStatus(mode, point);
    if (!status) continue;
    // at the bubble's height; beside the upgrade arrow when one is showing
    const at = project(game, point.x, point.y, chipHeight(point.type));
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const arrow = !(here && here.id === point.id) && point.level < BUILDING_MAX_LEVEL && affordable(mode, mode.upgradeCost(point.id));
    const pw = statusPillWidth(ctx, status);
    const meta = BUILD_META[point.type];
    drawStatusPill(ctx, arrow ? at.x + 22 + pw / 2 : at.x, at.y + (arrow ? 0 : 2), { ...status, tint: meta && meta.color }, standing ? 1 : 0.94);
    shown.pills++;
  }
  // BUILD 14: the two upgrade stations of the south-east district — the
  // armory (the captain's crossbow) and the arms rack (every guard's) — each
  // with its level as a pill when the captain is near, and the gold arrow
  // whenever its next level is affordable (as over a building's roof)
  shown.stations = [];
  for (const point of mode.dayPoints()) {
    if (point.kind !== 'armory' && point.kind !== 'arms') continue;
    if (here && here.id === point.id) continue;
    const arms = point.kind === 'arms';
    const at = project(game, point.x, point.y, arms ? 112 : 104);
    if (!(at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1)) continue;
    const cost = arms ? mode.armsUpgradeCost() : mode.hunterUpgradeCost();
    const arrow = !!cost && !mode.builderJob && affordable(mode, cost);
    const near = !overview && Math.hypot(point.x - p.x, point.y - p.y) <= STATUS_REACH;
    const status = arms
      ? { icon: 'guard', text: `Lv${mode.armsLevel}`, color: mode.armsLevel >= 3 ? '#ffd24a' : '#9fd0ff', tint: '#3e7bff' }
      : { icon: 'hunter', text: `Lv${mode.hunterLevel}`, color: '#ffd24a', tint: '#ffd24a' };
    const pw = near ? statusPillWidth(ctx, status) : 0;
    if (near) { drawStatusPill(ctx, arrow ? at.x + 22 + pw / 2 : at.x, at.y + (arrow ? 0 : 2), status, 0.94); shown.pills++; }
    if (arrow) {
      const bob = Math.sin(t * 4 + point.x * 0.01) * 2;
      ctx.save();
      ctx.beginPath(); ctx.arc(at.x, at.y + bob, 15, 0, TAU);
      ctx.fillStyle = '#fff3c4'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
      drawSurvivalIcon(ctx, 'up', at.x, at.y + bob, 21);
      addHit(game, { x: at.x - 24, y: at.y + bob - 24, w: 48, h: 48 }, `walk:${point.id}`, () => mode.walkTo(point.x, point.y), false, true);
    }
    shown.stations.push({ id: point.id, near, arrow });
  }
  // BUILD 13 (V10, research §7: "info gelombang sebelum malam"; Thronefall's
  // edge icons): tonight's attack by day — every gate it will hit, what comes
  // and how many (the plan the night plays: game/sim/survival.js tonightPlan). In
  // view a red badge over the gate; out of view a red pointer on the edge
  // with the count. Not under the dawn reward (this layer isn't drawn then).
  const tonight = [];
  for (const row of mode.tonightPlan()) {
    const e = row.entrance;
    const at = project(game, e.x, e.y, 120);
    const inView = at.x > view.x0 && at.x < view.x1 && at.y > view.y0 && at.y < view.y1;
    const total = row.swarm + row.individuals + row.breakers;
    if (inView) drawTonightBadge(ctx, at.x, at.y + Math.sin(t * 3 + e.x * 0.01) * 2, row);
    else drawEdgeMarker(ctx, w, h, at, row.breakers ? 'breaker' : row.swarm ? 'swarm' : 'zombie', '#ff5a4d', view.y0 + 10, h - view.y1 + 10, total);
    tonight.push({ id: row.id, total, inView, order: row.order || 0, swarm: row.swarm, individuals: row.individuals, breakers: row.breakers });
  }
  shown.tonight = tonight;
  game._survivalLabels = shown;   // QA (survival-plotsqa): what the day layer wrote
  // nothing to build in view: one pointer to the nearest empty circle
  if (nearestOff && !here) {
    drawEdgeMarker(ctx, w, h, nearestOff.at, nearestOff.icon, '#ffffff', view.y0 + 10, h - view.y1 + 10);
  }
  // the keep shows its life by day too once it is hurt
  const keep = mode.keep();
  if (mode.keepHp < mode.keepHpMax()) {
    // over the battlements, but never up under the DAY pill (the closer
    // camera puts the keep's top in the HUD band)
    const at = project(game, keep.x, keep.y, 250);
    at.y = Math.max(at.y, view.y0 + 16);
    if (onScreen(at, w, h, 30)) {
      const pct = clamp(mode.keepHp / Math.max(1, mode.keepHpMax()), 0, 1);
      drawSurvivalIcon(ctx, 'keep', at.x - 44, at.y, 24);
      drawBar(ctx, at.x - 30, at.y - 6, 74, 12, pct, pct > 0.5 ? COLORS.keep : pct > 0.25 ? '#ffb22e' : '#ff4d4d', { lineWidth: 1.8 });
    }
  }
  // the job under way: a progress ring over the scaffold
  const job = mode.builderJob;
  const spot = job ? mode.jobSpot(job) : null;
  if (spot) {
    const at = project(game, spot.x, spot.y, job.kind === 'keep' || job.kind === 'repair' ? 150 : 130);
    if (onScreen(at, w, h, 20)) {
      const pct = 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1);
      ctx.save();
      ctx.beginPath(); ctx.arc(at.x, at.y, 20, 0, TAU);
      ctx.fillStyle = 'rgba(20,18,40,0.72)'; ctx.fill();
      ctx.beginPath(); ctx.arc(at.x, at.y, 17, -Math.PI / 2, -Math.PI / 2 + TAU * pct);
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = '#45d06a'; ctx.stroke();
      ctx.restore();
      const upgrade = job.kind === 'hunter' || job.kind === 'arms';
      drawSurvivalIcon(ctx, upgrade ? 'up' : 'hammer', at.x, at.y, 22, { rotate: upgrade ? 0 : Math.sin(t * 10) * 0.3 });
    }
  }
  drawHunterBar(game, ctx, p);
  drawFloaters(game, ctx, w, h);
}


function drawRewardModal(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.lastRewards || { gold: 0, wood: 0, kills: 0 };
  ctx.save();
  ctx.fillStyle = 'rgba(12,10,30,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const rows = [
    { icon: 'skull', value: `${reward.kills || 0}`, color: '#3a2a50' },
    { icon: 'gold', value: `+${reward.gold || 0}`, color: '#1f8a3a' },
    { icon: 'wood', value: `+${reward.wood || 0}`, color: '#1f8a3a' },
  ];
  // BUILD 16 (R5): the gold a cleared night's early dawn paid (a clock on the coin)
  if (reward.cleared && reward.cleared.bonus > 0) rows.push({ icon: 'gold', value: `+${reward.cleared.bonus}`, color: '#1f8a3a', badge: 'clock' });
  if (reward.mined) rows.push({ icon: 'mine', value: `+${reward.mined}`, color: '#1f8a3a' });   // dug overnight
  if (reward.sawn) rows.push({ icon: 'sawmill', value: `+${reward.sawn}`, color: '#1f8a3a' });  // the sawmills' planks
  // what the ballistas and the guards brought down tonight (the building MVP)
  if (reward.towerKills) rows.push({ icon: 'tower', value: `${reward.towerKills}`, color: '#3a2a50', badge: 'skull' });
  if (reward.killsBy && reward.killsBy.guard) rows.push({ icon: 'guard', value: `${reward.killsBy.guard}`, color: '#3a2a50', badge: 'skull' });
  if (reward.survivors > 0) rows.push({ icon: 'guard', value: `+${reward.survivors}`, color: '#1f8a3a' });
  if (reward.keepDamage) rows.push({ icon: 'keep', value: `-${reward.keepDamage}`, color: '#d23a2a' });
  if (reward.keepPatched) rows.push({ icon: 'hammer', value: `+${reward.keepPatched}`, color: '#1f8a3a' });
  // a guard nobody helped up by dawn: one soldier fewer
  if (reward.lost) rows.push({ icon: 'guard', value: `-${reward.lost}`, color: '#d23a2a' });
  const cols = 2;
  const short = h < 560;
  const cellH = short ? 36 : 44;
  const gap = short ? 6 : 8;
  const bw = Math.min(short ? 420 : 330, w - 32);
  const cols2 = short ? 3 : cols;
  const bh = (short ? 84 : 92) + Math.ceil(rows.length / cols2) * (cellH + gap) + 34 + (short ? 62 : 74);
  const x = (w - bw) / 2, y = Math.max(28, (h - bh) / 2 + 10);
  const t = clock(game);
  ctx.save();
  ctx.translate(w / 2, y + 4);
  ctx.rotate(t * 0.3);
  ctx.fillStyle = 'rgba(255,214,90,0.28)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-14, -120); ctx.lineTo(14, -120); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  drawPanel(ctx, x, y, bw, bh, { radius: 22, top: '#fff6e0', bottom: '#ffdca0', lineWidth: 3 });
  drawSurvivalIcon(ctx, 'sun', w / 2, y + 2, short ? 60 : 76);
  drawLabel(ctx, `NIGHT ${Math.max(1, mode.nightsCompleted)} ${reward.cleared ? 'CLEARED' : 'SURVIVED'}!`, w / 2, y + (short ? 50 : 62), short ? 18 : 20, '#ffffff', { stroke: '#7a3a00' });
  const cellW = (bw - 40) / cols2;
  const top = y + (short ? 72 : 92);
  rows.forEach((row, i) => {
    const cx = x + 20 + (i % cols2) * cellW;
    const cy = top + Math.floor(i / cols2) * (cellH + gap);
    drawPanel(ctx, cx + 4, cy, cellW - 8, cellH, { radius: 14, top: '#ffffff', bottom: '#f3ead8', lineWidth: 2, highlight: false, shadow: false });
    drawSurvivalIcon(ctx, row.icon, cx + 26, cy + cellH / 2, short ? 24 : 30);
    if (row.badge) drawSurvivalIcon(ctx, row.badge, cx + 36, cy + cellH / 2 + 8, short ? 13 : 15);
    drawLabel(ctx, row.value, cx + 46, cy + cellH / 2 + 1, short ? 17 : 20, row.color, { align: 'left', outline: 0 });
  });
  // the goal, one night closer
  const left = reward.reinforcements != null ? reward.reinforcements : Math.max(0, 3 - mode.nightsCompleted);
  const gy = top + Math.ceil(rows.length / cols2) * (cellH + gap) + 12;
  drawSurvivalIcon(ctx, 'banner', w / 2 - 70, gy, 24);
  drawLabel(ctx, left > 0 ? `REINFORCEMENTS IN ${left}` : 'REINFORCEMENTS AT DAWN', w / 2 - 54, gy + 1, 13, '#3a2a50', { align: 'left', outline: 0 });
  drawButton(game, ctx, { x: x + 40, y: y + bh - (short ? 58 : 66), w: bw - 80, h: short ? 44 : 50 }, 'COLLECT',
    () => mode.ackRewards(), { id: 'COLLECT', icon: 'check', color: 'green' });
}

/** The action dock's size on this screen: one row, bottom right. */
/**
 * BUILD 18 (R18c): what the purse would still have bought by day. Shown under
 * the NIGHT chip while its hold ring fills, so the hold itself is the
 * confirmation ("52 GOLD UNSPENT") — no modal, no second tap.
 */
function unspentNote(mode) {
  let cheapest = null;
  for (const pt of mode.dayPoints()) {
    let cost = null;
    if (pt.kind === 'keep') cost = mode.keepUpgradeCost();
    else if (pt.kind === 'armory') cost = mode.hunterUpgradeCost();
    else if (pt.kind === 'gate') cost = mode.gateBuilt ? null : mode.tuning.gateCost;
    else if (pt.kind === 'slot' && !pt.locked) cost = pt.built ? mode.upgradeCost(pt.id) : mode.buildingCost(pt.type);
    if (cost && mode.canAfford(cost) && (!cheapest || (cost.gold || 0) < (cheapest.gold || 0))) cheapest = cost;
  }
  if (!cheapest) return null;
  return `${Math.floor(mode.gold)} GOLD UNSPENT`;
}

function dockLayout(w, h) {
  const short = h < 560;
  const pad = 12;
  const dockH = short ? 50 : 56;
  const btnW = Math.min(short ? 148 : 164, Math.round(w * 0.24));
  const infoW = Math.min(short ? 182 : 200, Math.round(w * 0.3));
  return { short, pad, dockH, btnW, infoW, y: h - pad - dockH, right: w - pad };
}

export function drawDayScreen(game, ctx, w, h) {
  const mode = game.survival;
  const reward = mode.rewardPending();
  const L = dockLayout(w, h);
  const { short, pad } = L;
  const btnX = L.right - L.btnW;
  const btnY = L.y;
  const view = { x0: 30, x1: w - 30, y0: short ? 70 : 128, y1: btnY - 10 };

  if (!reward) drawDayWorldLayer(game, ctx, w, h, view);

  // the dawn reward is modal: no pause button underneath it
  if (!reward) drawPauseButton(game, ctx, w, h);
  drawPhasePill(game, ctx, w, 'day');
  drawCounters(game, ctx, w, [
    { icon: 'gold', value: Math.floor(mode.gold) },
    { icon: 'wood', value: Math.floor(mode.wood) },
    { icon: 'guard', value: mode.survivors },
  ], short ? 34 : 40);
  // the builder: a small chip while he works (no READY pill when idle)
  const job = mode.builderJob;
  if (job && !reward) {
    const cw = 80, cx = w - cw - 8, cy = 10 + 3 * (short ? 34 : 40);
    drawPanel(ctx, cx, cy, cw, 24, { radius: 12, top: '#4a51a8', bottom: '#262a66', lineWidth: 2 });
    const chipIcon = job.kind === 'hunter' ? 'hunter' : job.kind === 'arms' ? 'crossbow' : 'hammer';
    drawSurvivalIcon(ctx, chipIcon, cx + 13, cy + 12, 18, { rotate: chipIcon === 'hammer' ? Math.sin(clock(game) * 10) * 0.3 : 0 });
    drawBar(ctx, cx + 26, cy + 7, cw - 34, 10, 1 - clamp(job.remaining / Math.max(0.01, job.duration), 0, 1), '#45d06a');
  }

  if (reward) {
    drawRewardModal(game, ctx, w, h);
    return;
  }

  const here = mode.dayContext();
  const action = dayAction(mode, here);
  let dockLeft = w;
  if (action) {
    // one row in the thumb corner: [REPAIR] [info] [BUILD / UPGRADE]
    drawActionButton(game, ctx, { x: btnX, y: btnY, w: L.btnW, h: L.dockH }, action.main);
    const info = { x: btnX - 6 - L.infoW, y: btnY, w: L.infoW, h: L.dockH };
    drawDockInfo(game, ctx, info, action);
    dockLeft = info.x;
    if (action.second) {
      const sw = short ? 124 : 134;
      drawActionButton(game, ctx, { x: info.x - 6 - sw, y: btnY, w: sw, h: L.dockH }, action.second);
      dockLeft = info.x - 6 - sw;
    }
  }
  // NIGHT stands apart from BUILD / UPGRADE (R18a, NN/g: keep the action you
  // cannot take back away from the everyday one): top-left, under PAUSE,
  // across the screen from the thumb's build corner — a chip, not a slab
  const nightBtn = { x: pad, y: pad + (short ? 50 : 58), w: short ? 112 : 124, h: short ? 38 : 42 };
  const nightHoldT = game._uiHoldLabel === 'survival:START NIGHT'
    ? clamp(Math.max(game._uiHoldT || 0, game._kbdHoldT || 0) / mode.tuning.nightHold, 0, 1) : 0;
  const nightItem = drawButton(game, ctx, nightBtn, `NIGHT ${mode.day}`,
    () => mode.startNight(), { id: 'START NIGHT', icon: 'moon', color: 'purple', disabled: !!job, fontSize: short ? 14 : 15, hold: mode.tuning.nightHold, holdT: nightHoldT });
  // while the ring fills: what the day would still have bought (R18c); after
  // a tap that left early: the chip says what it wants instead of starting
  const holdT = nightItem.holdT || 0;
  const holdNote = holdT > 0 ? unspentNote(mode) : null;
  const miss = game._uiHoldMiss && game._uiHoldMiss.label === nightItem.label ? game._uiHoldMiss : null;
  if (miss) offerSurvivalHint(game, 'holdnight');
  if (mode._newBanner) offerSurvivalHint(game, 'watch');
  if (!reward && (holdNote || miss)) {
    drawLabel(ctx, holdNote || 'HOLD TO START', nightBtn.x + nightBtn.w / 2, nightBtn.y + nightBtn.h + 11,
      10, holdNote ? '#ffd76a' : '#fff3c4', { align: 'center', outline: 2.5 });
  }
  if (game._survivalLabels) game._survivalLabels.nightHold = { holdT, note: holdNote, miss: !!miss };

  // BUILD 17 (R8): what tonight is, read in one line before the day's builds
  // are committed — the gates in order and what the night sends
  const tonightChip = !reward ? drawTonightChip(game, ctx, w, h) : null;
  if (game._survivalLabels) game._survivalLabels.tonightChip = tonightChip;

  // BUILD 22 (H3/R22): day 2's objective chain under the NIGHT chip
  const dayChain = !reward ? drawObjectiveChain(game, ctx, w, h, false) : null;
  if (game._survivalLabels) game._survivalLabels.objectiveChain = dayChain;

  drawZoomButtons(game, ctx, w, h);
  drawRecenterChip(game, ctx, w, h);
  // FTUE chip: a sideways phone puts it at the foot of the screen between the
  // stick and the dock (the top band shows the keep); a tall screen under
  // the pill
  if (short) {
    const left = 140, right = Math.min(dockLeft, w - pad) - 10;
    drawHint(game, ctx, w, h - pad - 36, (left + right) / 2, Math.min(right - left, 440), 12);
  } else drawHint(game, ctx, w, 136, w / 2, Math.min(w - 24, 420));
}

/**
 * BUILD 12, the dynamic camera (SURVIVAL_CAMERA): + and - on the right edge,
 * between the counters and the thumb's corner, by day and by night — beside
 * the pinch, as Rise of Kingdoms players asked for on-screen zoom buttons.
 * A button at its end of the range dims. Where they sit: zoomButtonLayout.
 */
