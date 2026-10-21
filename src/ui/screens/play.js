/* DUSKHOLD — In-play overlays: peak frenzy/boss/shield plates, the tutorial hint and the field card dock (Phase 3 split of ui/screens.js). */

import { clamp, TAU } from '../../core/util.js';
import { unlocked, LANES, nextRank, rankCost, rankCount, LANE_CAP } from '../../game/sim/economy.js';
import { IAP } from '../../shop/iap.js';
import { Ads } from '../../shop/ads.js';
import { drawIconButton, iconButtonState, iconHitArea, UI_TOKENS } from '../components.js';
import { drawGameIcon } from '../icons.js';
import { SERIF, SANS, MONO, isPhone, fitType, FIELD_TABS, FIELD_PANELS } from './shared.js';

export function drawTutorial() {
  // The first night is taught by the pointing hand in coach.js, not by a page.
}

/* ================= the Blood Market (IAP) — src/shop/iap.js =================
 * Catalog policy lives in iap.js; this screen is only its face. Every card
 * states plainly what it is, every item is also shard-buyable, the sandbox
 * mark (⌁) tells beta testers no real money moves. Ads are off until a
 * provider is configured; money never buys a claw.
 */

function capsule(ctx, x, y, ww, hh, r) {
  const rr = Math.min(r, ww / 2, hh / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + ww - rr, y);
  ctx.arcTo(x + ww, y, x + ww, y + rr, rr);
  ctx.lineTo(x + ww, y + hh - rr);
  ctx.arcTo(x + ww, y + hh, x + ww - rr, y + hh, rr);
  ctx.lineTo(x + rr, y + hh);
  ctx.arcTo(x, y + hh, x, y + hh - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 2. The blood moon is up: one word, and how much of it is left. */

/** 2. The blood moon is up: one word, and how much of it is left. */
function drawFrenzyPlate(game, ctx, w, h, phone, short) {
  const f = game.climax.frenzy;
  if (!f) return;
  const left = clamp(1 - f.t / f.dur, 0, 1);
  const a = clamp(f.t / 0.22, 0, 1) * clamp((f.dur - f.t) / 0.9, 0, 1);
  const y = short ? h * 0.3 : h * 0.32;
  const size = clamp(short ? w * 0.085 : w * (phone ? 0.16 : 0.08), 26, 86);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${size}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = (size * 0.2).toFixed(1) + 'px';
  ctx.shadowColor = 'rgba(206,20,34,0.9)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#f4dedb';
  ctx.fillText('FRENZY', w / 2, y);
  ctx.shadowBlur = 0;
  const bw = Math.min(w * 0.52, 300);
  const bh = short ? 3 : 5;
  const bx = w / 2 - bw / 2;
  const by = y + size * 0.62;
  ctx.fillStyle = 'rgba(6,7,10,0.6)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#d0202e';
  ctx.fillRect(bx, by, bw * left, bh);
  ctx.font = `500 ${short ? 9 : 11}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(232,190,186,0.8)';
  ctx.fillText('THE MOON IS UP', w / 2, by + bh + (short ? 11 : 16));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** 3. The duel: the thing in the dark has a name and a bar of its own. */

/** 3. The duel: the thing in the dark has a name and a bar of its own. */
function drawBossPlate(game, ctx, w, h, boss, phone, short) {
  const d = game.climax.duel;
  const a = clamp((d.t - 0.25) / 0.5, 0, 1) * clamp((d.dur - d.t) / 0.4, 0, 1);
  const y = phone ? 132 : h * 0.27;
  const bw = Math.min(w * 0.46, 320);
  const bx = w / 2 - bw / 2;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 10 : 12}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3.4px';
  const isMaster = !!(d && d.master);
  ctx.fillStyle = isMaster ? 'rgba(240,150,110,0.98)' : 'rgba(232,110,96,0.95)';
  ctx.shadowColor = isMaster ? 'rgba(120,20,20,0.9)' : 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = isMaster ? 14 : 8;
  ctx.fillText((d && d.name) || 'THE ALPHA', w / 2, y);
  ctx.shadowBlur = 0;
  const hp = clamp(boss.hp / boss.hpMax, 0, 1);
  const bh = short ? 3 : 5;
  ctx.fillStyle = 'rgba(6,7,10,0.72)';
  ctx.fillRect(bx, y + 11, bw, bh);
  ctx.fillStyle = '#8e1b26';
  ctx.fillRect(bx, y + 11, bw * hp, bh);
  ctx.strokeStyle = 'rgba(232,110,96,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, y + 11.5, bw - 1, bh - 1);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** 4. Dawnbreak: she lifts a hand she has not needed in a hundred years. */

/** 4. Dawnbreak: she lifts a hand she has not needed in a hundred years. */
function drawShieldingHand(ctx, w, h, k) {
  const s = Math.min(w, h * 1.15);
  ctx.save();
  ctx.globalAlpha = clamp(k, 0, 1);
  ctx.translate(w * 0.46, h * 0.86);
  ctx.rotate(-0.42);
  // forearm
  ctx.fillStyle = 'rgba(7,6,9,0.95)';
  capsule(ctx, -s * 0.15, -s * 0.1, s * 0.3, s * 0.62, s * 0.15);
  ctx.fill();
  // palm and fingers, tipped toward the sun
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.13, s * 0.2, s * 0.15, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const fx = -s * 0.15 + i * s * 0.1;
    capsule(ctx, fx - s * 0.038, -s * 0.34 - (i === 1 || i === 2 ? s * 0.03 : 0), s * 0.076, s * 0.24, s * 0.038);
    ctx.fill();
  }
  // the light gets past her: a gold rim along the top of the hand
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = 'rgba(255,214,150,0.9)';
  ctx.shadowColor = 'rgba(255,200,130,0.95)';
  ctx.shadowBlur = 22;
  ctx.lineWidth = Math.max(1.6, s * 0.008);
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.13, s * 0.2, s * 0.15, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}


export function drawPeakOverlay(game, ctx, w, h) {
  const c = game.climax;
  if (!c) return;
  const phone = isPhone(w, h);
  const short = h < 520;
  if (c.frenzy) drawFrenzyPlate(game, ctx, w, h, phone, short);
  const boss = c.boss;
  if (boss && c.duel) drawBossPlate(game, ctx, w, h, boss, phone, short);
  if (c.shield > 0.01) drawShieldingHand(ctx, w, h, c.shield);
}

/* ================= the refuge =================
 *
 * THE HUNTER'S REFUGE — the legacy dawn safehouse and the one person in it.
 * Between nights you come back to a room with
 * someone in it who has watched every night you survived and who is still in
 * the house when you leave it. This is also the visible-progression screen:
 * the board she keeps fills as the hunt does — the facts you won, pinned; the
 * trophies you took, hung; the weapon you carry, racked. One glance says
 * "I am building toward something", and it says it in her room, not in a menu.
 *
 * She is painted, not photographed: a hooded figure in a gilt frame, lit from
 * the left by one candle, her face in shadow. You never quite see her, and
 * that is the point — you are meant to wonder whether she makes it out.
 */


function fieldIconButton(game, ctx, x, y, size, icon, onClick, opts = {}) {
  const disabled = !!opts.disabled;
  const idx = game.ui.length;
  const hit = iconHitArea(x, y, size);
  const box = { ...hit, onClick: disabled ? null : onClick, disabled, label: icon, idx };
  game.ui.push(box);
  const shape = opts.shape || (opts.round === false ? 'rounded' : 'circle');
  drawIconButton(ctx, x, y, size, icon, {
    state: iconButtonState(game, box, !!opts.active, disabled),
    shape,
    iconSize: Math.min(23, size * 0.56),
  });
  return box;
}


function fieldFit(ctx, text, x, y, maxW, px, family = SANS, color = '#e5ddcb', weight = 400) {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(String(text)).width > maxW && size > 8) {
    size -= 0.5;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  ctx.fillStyle = color;
  ctx.fillText(String(text), x, y);
}


function drawFieldBag(game, ctx, x, y, w, h, short) {
  const bag = game.inventory ? game.inventory() : ((game.save && game.save.inventory) || {});
  const p = game.player;
  const items = [
    // Health is already persistent in the HUD; the pack is for carried stock.
    { icon: 'shard', name: 'SHARDS', amount: game.save.shards || 0, tint: '#d3b66f', always: true },
    { icon: 'plank', name: 'PLANKS', amount: p.planks | 0, tint: '#c29a63', always: true },
    { icon: 'arrow', name: 'ARROWS', amount: bag.arrows | 0, tint: '#b8c5d0', action: { icon: 'shot', weapon: 'shot', count: bag.arrows | 0 } },
    { icon: 'knife', name: 'KNIVES', amount: bag.knives | 0, tint: '#b8c5d0', action: { icon: 'knife', weapon: 'knife', count: bag.knives | 0 } },
    { icon: 'bandage', name: 'BANDAGES', amount: bag.bandages | 0, tint: '#d2b68b', action: { icon: 'plus', use: true, count: bag.bandages | 0 } },
    { icon: 'relic', name: 'RELICS', amount: game.save.relics || 0, tint: '#a4b6c8' },
  ].filter((item) => item.always || Number(item.amount) > 0);
  const cols = w < 520 ? 1 : w > 720 ? Math.min(3, items.length) : Math.min(2, items.length);
  const gap = short ? 6 : 10;
  const rows = Math.ceil(items.length / cols);
  const cw = (w - gap * (cols - 1)) / cols;
  const preferredH = short ? 58 : (w < 520 ? 72 : 120);
  const ch = Math.max(48, Math.min(preferredH, (h - gap * (rows - 1)) / rows));
  const listH = rows * ch + gap * (rows - 1);
  const listY = y + Math.max(0, (h - listH) / 2);
  items.forEach((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = x + col * (cw + gap), cy = listY + row * (ch + gap);
    ctx.save();
    ctx.fillStyle = 'rgba(16,19,26,0.84)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = 'rgba(174,151,105,0.27)';
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
    drawGameIcon(ctx, item.icon, cx + 19, cy + Math.min(24, ch * 0.37), short ? 17 : 20, item.tint);
    ctx.textBaseline = 'middle';
    fieldFit(ctx, item.name, cx + 34, cy + Math.min(18, ch * 0.28), Math.max(52, cw - 44), short ? 9 : 10.5, SANS, 'rgba(204,197,181,0.76)', 600);
    ctx.textAlign = 'right';
    fieldFit(ctx, item.amount, cx + cw - (item.action ? 54 : 10), cy + Math.min(37, ch * 0.58), cw - (item.action ? 80 : 48), short ? 15 : 19, MONO, '#f0e7d6', 400);
    ctx.textAlign = 'left';
    if (item.action) {
      const actionX = cx + cw - 38;
      const actionY = cy + ch / 2 - 15;
      const disabled = item.action.count < 1 || (item.action.use && p.blood >= p.bloodMax - 0.1);
      fieldIconButton(game, ctx, actionX, actionY, 30, item.action.icon,
        () => item.action.use ? game.useBandage() : game.setWeapon(item.action.weapon), {
          disabled,
          active: !item.action.use && p.weapon === item.action.weapon,
        });
    }
    ctx.restore();
  });
}


function drawFieldRewards(ctx, reward, x, y, maxW, short) {
  const rows = [
    ['shards', 'shard'], ['planks', 'plank'], ['arrows', 'arrow'],
    ['knives', 'knife'], ['bandages', 'bandage'], ['blood', 'blood'],
  ].filter(([key]) => (reward && reward[key]) > 0);
  const step = short ? 30 : 38;
  const visible = rows.slice(0, Math.max(1, Math.floor(maxW / step)));
  let dx = x;
  for (const [key, icon] of visible) {
    drawGameIcon(ctx, icon, dx + 7, y, short ? 13 : 15, key === 'shards' ? '#d2b166' : key === 'blood' ? '#cc616b' : '#bac3c4');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${short ? 8 : 9}px ${MONO}`;
    ctx.fillStyle = 'rgba(220,212,195,0.85)';
    ctx.fillText(String(reward[key]), dx + 16, y + 0.5);
    dx += step;
  }
}


function drawFieldMissions(game, ctx, x, y, w, h, short) {
  const list = game.objectives && game.objectives.list || [];
  const complete = list.filter((slot) => slot.state === 'done').length;
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 9 : 10}px ${SANS}`;
  ctx.fillStyle = 'rgba(201,178,122,0.88)';
  ctx.fillText(`${complete}/${list.length} DONE`, x, y + 7);
  if (!list.length) {
    ctx.font = `400 ${short ? 12 : 14}px ${SANS}`;
    ctx.fillStyle = '#ded5c4';
    ctx.fillText('No missions tonight.', x + 4, y + 50);
    ctx.restore();
    return;
  }
  const top = y + 20;
  const gap = short ? 5 : 8;
  const rowH = Math.max(35, Math.min(78, (h - 24 - gap * (list.length - 1)) / list.length));
  list.forEach((slot, i) => {
    const ry = top + i * (rowH + gap);
    const rw = slot.goal.reward || {};
    ctx.fillStyle = slot.state === 'done' ? 'rgba(37,31,24,0.82)' : 'rgba(15,18,25,0.82)';
    ctx.fillRect(x, ry, w, rowH);
    ctx.strokeStyle = slot.state === 'done' ? 'rgba(202,166,91,0.46)' : 'rgba(149,151,155,0.2)';
    ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rowH - 1);
    drawGameIcon(ctx, slot.state === 'done' ? 'confirm' : slot.goal.hunt ? 'profile' : 'mission', x + 19, ry + rowH * 0.5, short ? 17 : 21, slot.state === 'done' ? '#c7a85f' : '#c6c1b5');
    const rewardW = Math.min(short ? 152 : 205, w * 0.32);
    const textX = x + 39;
    const textW = w - rewardW - 48;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fieldFit(ctx, slot.goal.label, textX, ry + rowH * 0.52, textW, short ? 9.5 : 12, SANS, slot.state === 'done' ? '#e2ca91' : '#e2daca', 600);
    ctx.textAlign = 'right';
    ctx.font = `500 ${short ? 8 : 9}px ${MONO}`;
    ctx.fillStyle = slot.state === 'done' ? '#ddc27d' : 'rgba(181,174,158,0.78)';
    ctx.fillText(slot.state === 'done' ? 'DONE' : `${Math.round((slot.p || 0) * 100)}%`, x + w - 8, ry + 13);
    drawFieldRewards(ctx, rw, x + w - rewardW + 7, ry + rowH * 0.62, rewardW - 12, short);
  });
  ctx.restore();
}


function drawFieldUpgrades(game, ctx, x, y, w, h, short) {
  const save = game.save;
  const open = unlocked(save, 'builds');
  const gap = short ? 7 : 10;
  const rowH = Math.max(48, (h - 24 - gap * (LANES.length - 1)) / LANES.length);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${short ? 9 : 10}px ${SANS}`;
  ctx.fillStyle = 'rgba(211,180,112,0.92)';
  ctx.fillText(`◆ ${save.shards || 0} SHARDS`, x, y + 7);
  LANES.forEach((lane, i) => {
    const ry = y + 21 + i * (rowH + gap);
    const next = nextRank(save, lane.id);
    const owned = lane.ranks.filter((rank) => save.builds && save.builds[rank.id]).length;
    const capped = rankCount(save) >= LANE_CAP && !!next;
    const cost = next ? rankCost(save, next) : 0;
    const afford = open && !!next && !capped && save.shards >= cost;
    const icon = lane.id === 'glutton' ? 'claw' : lane.id === 'warden' ? 'plank' : 'run';
    ctx.fillStyle = 'rgba(16,18,25,0.84)';
    ctx.fillRect(x, ry, w, rowH);
    ctx.strokeStyle = 'rgba(168,148,102,0.28)';
    ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rowH - 1);
    drawGameIcon(ctx, icon, x + 22, ry + rowH * 0.46, short ? 18 : 23, '#c6ad78');
    ctx.textAlign = 'left';
    fieldFit(ctx, lane.name, x + 43, ry + rowH * 0.35, w - 126, short ? 10 : 13, SANS, '#e2d7c2', 600);
    const detail = !open ? 'LOCKED · 2 DAWNS' : next ? `${next.name}  ·  ${owned}/${lane.ranks.length}` : `MASTERED · ${owned}/${lane.ranks.length}`;
    fieldFit(ctx, detail, x + 43, ry + rowH * 0.69, w - 128, short ? 8 : 9.5, SANS, 'rgba(175,169,155,0.76)', 400);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${short ? 9 : 10}px ${MONO}`;
    ctx.fillStyle = afford ? '#d5b56c' : 'rgba(170,161,145,0.65)';
    ctx.fillText(next ? `◆ ${cost}` : '—', x + w - 49, ry + rowH / 2);
    fieldIconButton(game, ctx, x + w - 39, ry + rowH / 2 - 15, 30, 'plus', () => game.buyUpgrade(lane.id), { disabled: !afford });
  });
  ctx.restore();
}



function drawFieldPrivacy(game, ctx, x, y, w, h, short) {
  const ack = !!game.save.privacyAck;
  const lines = [
    '18+ horror. No account.',
    'Save stays on this device; delete it any time.',
    'Optional purchases never sell power or mission supplies.',
  ];
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `400 ${short ? 9 : 12}px ${SANS}`;
  ctx.fillStyle = 'rgba(217,208,189,0.86)';
  const gap = short ? 25 : 34;
  lines.forEach((line, i) => fieldFit(ctx, line, x + 12, y + 24 + i * gap, w - 24, short ? 9 : 12, SANS, 'rgba(217,208,189,0.86)', 400));
  ctx.font = `500 ${short ? 8 : 10}px ${MONO}`;
  ctx.fillStyle = ack ? '#d4bf86' : 'rgba(195,165,108,0.9)';
  ctx.fillText(ack ? 'NOTICE ACCEPTED' : 'REQUIRED BEFORE PURCHASE', x + 12, y + gap * lines.length + 30);
  ctx.restore();

  const size = short ? 38 : 44;
  const by = y + h - size - 14;
  const gapX = short ? 14 : 20;
  const start = x + w / 2 - (size * 3 + gapX * 2) / 2;
  fieldIconButton(game, ctx, start, by, size, 'shield', () => {
    try { window.open('./privacy.html', '_blank', 'noopener'); } catch (e) { /* blocked */ }
  }, { active: false });
  fieldIconButton(game, ctx, start + size + gapX, by, size, 'confirm', () => {
    if (ack) return;
    game.acceptPrivacy();
  }, { disabled: ack, active: !ack });
  fieldIconButton(game, ctx, start + (size + gapX) * 2, by, size, game.privacyDeleteArmed ? 'confirm' : 'close', () => {
    if (!game.privacyDeleteArmed) {
      game.privacyDeleteArmed = true;
      game.showMessage('TAP DELETE AGAIN TO WIPE THIS DEVICE.', { tone: 'cold', life: 3 });
    } else game.wipeLocalData();
  }, { active: !!game.privacyDeleteArmed });
}


export function drawFieldCard(game, ctx, w, h) {
  const tab = FIELD_PANELS[game.uiPanel] || FIELD_TABS[0];
  const short = h < 500;
  const cardW = Math.min(960, w - 20);
  const bodyW = cardW - UI_TOKENS.spacing.fieldInset * 2;
  const headerH = short ? 42 : 48;
  const inner = cardW - 24;
  const n = FIELD_TABS.length;
  const portraitNav = w < 600 && !short;
  const cols = portraitNav ? Math.min(5, n) : n;
  const tabGap = short ? UI_TOKENS.spacing.fieldShortTab
    : portraitNav ? UI_TOKENS.spacing.fieldPortraitTab : UI_TOKENS.spacing.fieldTab;
  const preferredSize = portraitNav ? UI_TOKENS.size.fieldTabPortrait
    : short ? UI_TOKENS.size.fieldTabShort : UI_TOKENS.size.fieldTabStandard;
  const tabSize = Math.min(preferredSize, Math.floor((inner - tabGap * (cols - 1)) / cols));
  const tabRows = Math.ceil(n / cols);
  const tabTotalW = tabSize * cols + tabGap * (cols - 1);
  const tabTotalH = tabSize * tabRows + tabGap * (tabRows - 1);

  const bag = game.inventory ? game.inventory() : ((game.save && game.save.inventory) || {});
  const bagItems = 2 + [bag.arrows, bag.knives, bag.bandages, game.save.relics]
    .filter((amount) => Number(amount) > 0).length;
  const bagCols = bodyW < 520 ? 1 : bodyW > 720 ? Math.min(3, bagItems) : Math.min(2, bagItems);
  const bagRows = Math.ceil(bagItems / bagCols);
  const bagGap = short ? 6 : 10;
  const bagRowH = short ? 58 : (bodyW < 520 ? 72 : 120);
  const bagBodyH = bagRows * bagRowH + bagGap * (bagRows - 1);
  const missionCount = game.objectives && game.objectives.list ? game.objectives.list.length : 0;
  const missionGap = short ? 5 : 8;
  const missionsBodyH = missionCount
    ? 20 + missionCount * (short ? 52 : 72) + missionGap * (missionCount - 1)
    : (short ? 80 : 100);
  const upgradeGap = short ? 7 : 10;
  const upgradesBodyH = 21 + LANES.length * (short ? 52 : 62) + upgradeGap * (LANES.length - 1);
  const bodyContentH = tab.id === 'bag' ? bagBodyH
    : tab.id === 'missions' ? missionsBodyH
      : tab.id === 'upgrades' ? upgradesBodyH
        : tab.id === 'privacy' ? (short ? 200 : 240) : bagBodyH;
  const cardH = Math.min(700, h - 20, Math.max(short ? 176 : 200,
    headerH + tabTotalH + 20 + bodyContentH + 14));
  const x = (w - cardW) / 2;
  const y = (h - cardH) / 2;
  game._fieldCardBounds = { x, y, w: cardW, h: cardH };

  ctx.save();
  ctx.fillStyle = 'rgba(2,3,7,0.68)';
  ctx.fillRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
  bg.addColorStop(0, 'rgba(14,17,23,0.98)');
  bg.addColorStop(0.55, 'rgba(8,11,17,0.97)');
  bg.addColorStop(1, 'rgba(13,13,19,0.98)');
  ctx.fillStyle = bg; ctx.fillRect(x, y, cardW, cardH);
  ctx.strokeStyle = 'rgba(186,154,94,0.66)'; ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);
  ctx.fillStyle = 'rgba(164,117,57,0.72)'; ctx.fillRect(x + 1, y + 1, 3, cardH - 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  fieldFit(ctx, tab.title, x + 18, y + (short ? 20 : 24), cardW - 80, short ? 13 : 17, SANS, '#eee3d0', 600);
  fieldIconButton(game, ctx, x + cardW - 38, y + 8, 30, 'close', () => game.closePanel(), { round: false });

  const tabY = y + headerH;
  const gap = tabGap;
  const tabX = x + (cardW - tabTotalW) / 2;
  FIELD_TABS.forEach((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tx = tabX + col * (tabSize + gap);
    const ty = tabY + row * (tabSize + gap);
    fieldIconButton(game, ctx, tx, ty, tabSize, entry.icon, () => game.openPanel(entry.id), { active: entry.id === tab.id, round: false });
  });
  ctx.strokeStyle = 'rgba(165,146,109,0.24)';
  ctx.beginPath(); ctx.moveTo(x + 14, tabY + tabTotalH + 8); ctx.lineTo(x + cardW - 14, tabY + tabTotalH + 8); ctx.stroke();

  const bodyX = x + UI_TOKENS.spacing.fieldInset;
  const bodyY = tabY + tabTotalH + 20;
  const bodyH = Math.max(24, y + cardH - 14 - bodyY);
  ctx.save();
  ctx.beginPath(); ctx.rect(bodyX, bodyY, bodyW, bodyH); ctx.clip();
  switch (tab.id) {
    case 'bag': drawFieldBag(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'missions': drawFieldMissions(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'upgrades': drawFieldUpgrades(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    case 'privacy': drawFieldPrivacy(game, ctx, bodyX, bodyY, bodyW, bodyH, short); break;
    default: break;
  }
  ctx.restore();
  ctx.restore();
}

