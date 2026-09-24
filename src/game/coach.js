/* First-night coach.
 * Not a menu. A hand taps the button you must press, and a bouncing arrow
 * marks the thing you must walk to. The step changes only when you do it.
 */

import { TAU, writeSave } from '../core/util.js';

const ORDER = ['walk', 'planks', 'door', 'board', 'planks2', 'stakes', 'raise'];

export function updateCoach(game) {
  if (game.save.coachDone) {
    game.coach = { step: 'done' };
    return;
  }
  if (!game.coach) {
    game.coach = {
      step: 'walk',
      t: 0,
      originX: game.player.x,
      originY: game.player.y,
      clawed: false,
    };
  }
  const c = game.coach;
  if (c.step === 'done') return;
  c.t += 1 / 60;
  const p = game.player;
  const door = game.mansion.entranceById('diningDoor');
  const stakes = stakeProp(game);

  if (!c.clawed && c.step !== 'claw' && enemyClose(game)) {
    c.hold = c.step;
    c.step = 'claw';
  }

  if (c.step === 'walk') {
    const moved = Math.hypot(p.x - c.originX, p.y - c.originY);
    if (moved > 70) advance(c);
  } else if (c.step === 'planks' || c.step === 'planks2') {
    if (p.planks >= 3 || !nearestPlank(game)) advance(c);
  } else if (c.step === 'door') {
    if (door && Math.hypot(p.x - door.x, p.y - door.y) < 108) advance(c);
  } else if (c.step === 'board') {
    if (door && (door.barricade > 0 || door.open)) advance(c);
  } else if (c.step === 'claw') {
    if (game.input.attackPressed || (p.attackCd > 0.05)) {
      c.clawed = true;
      c.step = c.hold && c.hold !== 'claw' ? c.hold : 'walk';
      c.hold = null;
    }
  } else if (c.step === 'stakes') {
    if (stakes && Math.hypot(p.x - stakes.x, p.y - stakes.y) < 88) advance(c);
    else if (!stakes) advance(c);
  } else if (c.step === 'raise') {
    if (game.mansion.stakesUp) c.step = 'done';
  }
}

function advance(c) {
  const i = ORDER.indexOf(c.step);
  c.step = ORDER[i + 1] || 'done';
  c.t = 0;
}

function stakeProp(game) {
  return game.mansion.props.find((pr) => pr.type === 'stakes') || null;
}

function nearestPlank(game) {
  let best = null;
  let d = 1e9;
  for (const pk of game.pickups) {
    if (pk.taken || pk.kind !== 'planks') continue;
    const dd = Math.hypot(pk.x - game.player.x, pk.y - game.player.y);
    if (dd < d) { d = dd; best = pk; }
  }
  return best;
}

function enemyClose(game) {
  const p = game.player;
  return game.enemies.some((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 340);
}

function worldMark(game) {
  const step = game.coach && game.coach.step;
  if (step === 'planks' || step === 'planks2' || (step === 'raise' && game.player.planks < 3)) {
    const pk = nearestPlank(game);
    return pk ? { x: pk.x, y: pk.y, label: 'PLANKS' } : null;
  }
  if (step === 'door') {
    const e = game.mansion.entranceById('diningDoor');
    return e ? { x: e.x, y: e.y, label: 'DOOR' } : null;
  }
  if (step === 'stakes') {
    const s = stakeProp(game);
    return s ? { x: s.x, y: s.y, label: 'STAKES' } : null;
  }
  return null;
}

export function drawCoachWorld(game, ctx) {
  const mark = worldMark(game);
  if (!mark) return;
  const bob = Math.sin(game.time * 4.2) * 7;
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 196, 96, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(mark.x, mark.y, 26, 11, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  if (game.renderer.upright) game.renderer.upright(ctx, mark.x, mark.y);
  ctx.translate(mark.x, mark.y - 52 + bob);
  ctx.fillStyle = '#f0d078';
  ctx.strokeStyle = '#1a140c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(-9, -4);
  ctx.lineTo(9, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawCoach(game, ctx, w, h) {
  const c = game.coach;
  if (!c || c.step === 'done' || game.screen !== 'playing') return;
  const input = game.input;
  if (!input) return;

  if (c.step === 'walk') {
    const s = input.stick;
    const hx = s.homeX || w * 0.16;
    const hy = s.homeY || h - 120;
    const hr = s.r || 52;
    drawDrag(ctx, hx, hy, hr, game.time);
    chip(ctx, hx, hy - hr - 36, 'DRAG UP', 'TO WALK');
    return;
  }

  if (c.step === 'claw') {
    const b = input.buttons.attack;
    pointAtButton(ctx, b, game.time, 'TAP CLAW', 'IT FEEDS YOU');
    return;
  }

  if (c.step === 'board') {
    const door = game.mansion.entranceById('diningDoor');
    const canBoard = game.player.planks >= 3 && door && !door.open && door.barricade < 2;
    const b = canBoard ? input.buttons.barricade : input.buttons.interact;
    pointAtButton(ctx, b, game.time, canBoard ? 'TAP BOARD' : 'TAP USE', canBoard ? 'THREE PLANKS' : 'OPEN IT AND FEED');
    return;
  }

  if (c.step === 'raise') {
    const stakes = stakeProp(game);
    const near = stakes && Math.hypot(game.player.x - stakes.x, game.player.y - stakes.y) < 100;
    if (game.player.planks < 3) {
      drawWorldCue(game, ctx, w, h);
      return;
    }
    if (!near) {
      if (stakes && game.renderer.worldToScreen) {
        const sp = game.renderer.worldToScreen(stakes.x, stakes.y);
        const on = sp.x > 48 && sp.x < w - 48 && sp.y > 56 && sp.y < h - 72;
        if (!on) edgeArrow(ctx, w, h, sp, 'STAKES', game.time);
        else chip(ctx, sp.x, sp.y - 78, 'STAKES', 'FOLLOW THE ARROW');
      }
      return;
    }
    pointAtButton(ctx, input.buttons.interact, game.time, 'TAP USE', 'RAISE THE STAKES');
    return;
  }

  drawWorldCue(game, ctx, w, h);
}

function drawWorldCue(game, ctx, w, h) {
  const mark = worldMark(game);
  if (!mark || !game.renderer.worldToScreen) return;
  const sp = game.renderer.worldToScreen(mark.x, mark.y);
  const on = sp.x > 48 && sp.x < w - 48 && sp.y > 56 && sp.y < h - 72;
  if (!on) {
    edgeArrow(ctx, w, h, sp, mark.label, game.time);
    return;
  }
  const bob = Math.sin(game.time * 4.2) * 6;
  chip(ctx, sp.x, sp.y - 78 + bob, mark.label, 'FOLLOW THE ARROW');
}

function pointAtButton(ctx, b, time, title, sub) {
  if (!b) return;
  const pulse = 0.55 + 0.45 * Math.sin(time * 5);
  ctx.save();
  ctx.strokeStyle = `rgba(240, 208, 120, ${0.45 + pulse * 0.5})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r + 8 + pulse * 4, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ripple(ctx, b.x, b.y, time);
  // Finger comes from the upper left so the label on the button stays readable.
  const tipX = b.x - b.r * 0.15;
  const tipY = b.y - b.r * 0.2;
  drawTapHand(ctx, tipX, tipY, Math.PI * 0.72, time);
  chip(ctx, b.x - b.r - 28, b.y - b.r - 28, title, sub, 'right');
}

function drawDrag(ctx, hx, hy, hr, time) {
  const u = (time % 1.35) / 1.35;
  const slide = u < 0.72 ? u / 0.72 : 1;
  const y = hy - 8 - slide * (hr + 18);
  ctx.save();
  ctx.strokeStyle = 'rgba(240, 208, 120, 0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(hx, hy + 8);
  ctx.lineTo(hx, hy - hr + 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ripple(ctx, hx, hy, time * 0.8);
  drawTapHand(ctx, hx, y, -Math.PI / 2, 0.4);
}

function drawTapHand(ctx, tipX, tipY, angle, time) {
  const cycle = time % 1.05;
  const press = cycle < 0.16 ? Math.sin((cycle / 0.16) * Math.PI) : 0;
  const back = 34 - press * 12;
  const x = tipX - Math.cos(angle) * back;
  const y = tipY - Math.sin(angle) * back;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(4, 22, 16, 7, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f4e7d4';
  ctx.strokeStyle = '#1c1610';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, 6);
  ctx.lineTo(-5, -30);
  ctx.quadraticCurveTo(0, -38, 5, -30);
  ctx.lineTo(5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8ee';
  ctx.fillRect(-3.2, -32, 6.4, 7);
  ctx.fillStyle = '#f4e7d4';
  ctx.beginPath();
  ctx.ellipse(3, 16, 13, 11, 0.35, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#1c1610';
  ctx.beginPath();
  ctx.moveTo(-2, 10);
  ctx.quadraticCurveTo(6, 8, 12, 14);
  ctx.stroke();
  ctx.restore();
  if (press > 0.2) ripple(ctx, tipX, tipY, cycle);
}

function ripple(ctx, x, y, time) {
  const u = (time % 1.05);
  if (u < 0.18) return;
  const k = (u - 0.18) / 0.87;
  ctx.save();
  ctx.globalAlpha = (1 - k) * 0.85;
  ctx.strokeStyle = '#f0d078';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 10 + k * 26, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function chip(ctx, x, y, title, sub, align = 'center') {
  ctx.save();
  ctx.font = '500 13px "Segoe UI", Roboto, sans-serif';
  const tw = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width);
  const bw = tw + 22;
  const bh = 36;
  const left = Math.max(8, align === 'right' ? x - bw : x - bw / 2);
  ctx.fillStyle = 'rgba(8,7,6,0.88)';
  ctx.strokeStyle = 'rgba(240, 208, 120, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(left, y - bh / 2, bw, bh);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0d078';
  ctx.fillText(title, left + bw / 2, y - 7);
  ctx.font = '400 10px "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(232, 224, 204, 0.8)';
  ctx.fillText(sub, left + bw / 2, y + 8);
  ctx.restore();
}

function edgeArrow(ctx, w, h, sp, label, time) {
  const cx = w / 2, cy = h / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const hx = w / 2 - 54, hy = h / 2 - 64;
  const tx = Math.abs(dx) > 0.001 ? hx / Math.abs(dx) : 1e9;
  const ty = Math.abs(dy) > 0.001 ? hy / Math.abs(dy) : 1e9;
  const t = Math.min(tx, ty);
  const x = cx + dx * t, y = cy + dy * t;
  const pulse = 0.65 + 0.35 * Math.abs(Math.sin(time * 4));
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = pulse;
  ctx.rotate(ang);
  ctx.fillStyle = '#f0d078';
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, -7);
  ctx.lineTo(-8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-ang);
  ctx.font = '500 11px "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 18);
  ctx.restore();
}
