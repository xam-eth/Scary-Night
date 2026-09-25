/* First-night coach.
 * One pointer at a time. A hand taps a button only when that tap will work.
 * A bouncing arrow marks the thing to walk to. The step changes when the
 * action actually happens, not when the player is merely nearby.
 */

import { TAU, writeSave } from '../core/util.js';

const ORDER = ['walk', 'planks', 'door', 'board', 'planks2', 'stakes', 'raise'];
const DOOR_RANGE = 90;
const STAKE_RANGE = 64;

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
  const door = servantDoor(game);
  const stakes = stakeProp(game);

  if (!c.clawed && c.step !== 'claw' && enemyClose(game)) {
    c.hold = c.step;
    c.step = 'claw';
  }

  if (c.step === 'walk') {
    if (Math.hypot(p.x - c.originX, p.y - c.originY) > 70) advance(c);
  } else if (c.step === 'planks' || c.step === 'planks2') {
    if (p.planks >= 3 || !nearestPlank(game)) advance(c);
  } else if (c.step === 'door') {
    if (door && distTo(p, door) < DOOR_RANGE) advance(c);
  } else if (c.step === 'board') {
    if (door && (door.barricade > 0 || door.open)) advance(c);
  } else if (c.step === 'claw') {
    if (game.input.attackPressed) {
      c.clawed = true;
      c.step = c.hold && c.hold !== 'claw' ? c.hold : 'walk';
      c.hold = null;
    }
  } else if (c.step === 'stakes') {
    if (!stakes) advance(c);
    else if (distTo(p, stakes) < STAKE_RANGE) advance(c);
  } else if (c.step === 'raise') {
    if (game.mansion.stakesUp) finish(game, c);
    else if (p.planks < 3 && !nearestPlank(game)) finish(game, c);
  }
}

function advance(c) {
  const i = ORDER.indexOf(c.step);
  c.step = ORDER[i + 1] || 'done';
  c.t = 0;
}

function finish(game, c) {
  c.step = 'done';
  if (!game.save.coachDone) {
    game.save.coachDone = true;
    writeSave(game.save);
  }
}

function servantDoor(game) {
  return game.mansion.entranceById('diningDoor');
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
  return game.enemies.some((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 280);
}

function distTo(p, o) {
  return Math.hypot(p.x - o.x, p.y - o.y);
}

function worldMark(game) {
  const step = game.coach && game.coach.step;
  const p = game.player;
  if (step === 'planks' || step === 'planks2' || (step === 'raise' && p.planks < 3)) {
    const pk = nearestPlank(game);
    return pk ? { x: pk.x, y: pk.y } : null;
  }
  if (step === 'door' || step === 'board') {
    const e = servantDoor(game);
    if (!e) return null;
    const boardReady = step === 'board' && distTo(p, e) < DOOR_RANGE
      && game.input.buttons.barricade && !game.input.buttons.barricade.hidden;
    if (boardReady) return null;
    if (step === 'board' && distTo(p, e) < DOOR_RANGE && p.planks < 3) return null;
    return { x: e.x, y: e.y };
  }
  if (step === 'stakes' || step === 'raise') {
    const s = stakeProp(game);
    if (!s) return null;
    const raiseReady = step === 'raise' && p.planks >= 3 && distTo(p, s) < STAKE_RANGE;
    if (raiseReady) return null;
    if (step === 'raise' && p.planks < 3) {
      const pk = nearestPlank(game);
      return pk ? { x: pk.x, y: pk.y } : { x: s.x, y: s.y };
    }
    return { x: s.x, y: s.y };
  }
  return null;
}

function promptPoint(ent) {
  if (!ent) return null;
  const d = 54;
  if (ent.facing === 'south') return { x: ent.x, y: ent.y + d };
  if (ent.facing === 'east') return { x: ent.x + d, y: ent.y };
  if (ent.facing === 'west') return { x: ent.x - d, y: ent.y };
  return { x: ent.x, y: ent.y - d };
}

/** Screen box of the interact label, so the floor arrow can stay off the words. */
function promptBox(game) {
  const t = game.interactTarget;
  const r = game.renderer;
  if (!t || !t.ent || !r.worldToScreen) return null;
  const p = r.worldToScreen(promptPoint(t.ent).x, promptPoint(t.ent).y);
  const zoom = r.cam.zoom || 1;
  return { x: p.x, top: p.y - 16 * zoom - 14, bot: p.y + 14, half: 132 };
}

function markerClearance(game, mark) {
  const box = promptBox(game);
  const r = game.renderer;
  const zoom = (r.cam && r.cam.zoom) || 1;
  if (!box || !r.worldToScreen) return { lift: 56, ring: true };
  const mp = r.worldToScreen(mark.x, mark.y);
  const nearX = Math.abs(mp.x - box.x) < box.half + 18;
  const ring = !(nearX && mp.y > box.top - 10 && mp.y < box.bot + 10);
  let lift = 56;
  const tipY = () => mp.y - (lift - 18) * zoom;
  const topY = () => mp.y - (lift + 8) * zoom;
  if (nearX && tipY() > box.top - 6 && topY() < box.bot + 6) {
    lift = Math.max(56, Math.min(200, (mp.y - (box.top - 12)) / zoom + 18));
  }
  return { lift, ring };
}

export function drawCoachWorld(game, ctx) {
  const mark = worldMark(game);
  if (!mark) return;
  const clear = markerClearance(game, mark);
  const bob = Math.sin(game.time * 5) * 8;
  if (clear.ring) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 208, 120, 0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(mark.x, mark.y, 28, 12, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  if (game.renderer.upright) game.renderer.upright(ctx, mark.x, mark.y);
  ctx.translate(mark.x, mark.y - clear.lift + bob);
  ctx.fillStyle = '#f0d078';
  ctx.strokeStyle = '#1a140c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(-11, -6);
  ctx.lineTo(11, -6);
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
  const cue = cueFor(game);
  if (!cue) return;

  if (cue.kind === 'drag') {
    const s = input.stick;
    const hx = s.homeX || w * 0.16;
    const hy = s.homeY || h - 120;
    const hr = s.r || 52;
    drawDrag(ctx, hx, hy, hr, game.time);
    chip(ctx, w, h, 'DRAG UP', 'TO WALK');
    return;
  }

  if (cue.kind === 'button') {
    const b = input.buttons[cue.id];
    if (!b || b.hidden) {
      drawWorldCue(game, ctx, w, h);
      return;
    }
    pointAtButton(ctx, w, h, b, input, game.time, cue.title, cue.sub);
    return;
  }

  drawWorldCue(game, ctx, w, h, cue);
}

function cueFor(game) {
  const step = game.coach.step;
  const p = game.player;
  const door = servantDoor(game);
  const stakes = stakeProp(game);
  const boardBtn = game.input.buttons.barricade;
  if (step === 'walk') return { kind: 'drag' };
  if (step === 'claw') return { kind: 'button', id: 'attack', title: 'TAP CLAW', sub: 'HIT THEM' };
  if (step === 'board') {
    const near = door && distTo(p, door) < DOOR_RANGE;
    if (near && boardBtn && !boardBtn.hidden && p.planks >= 3) {
      return { kind: 'button', id: 'barricade', title: 'TAP BOARD', sub: 'THREE PLANKS' };
    }
    if (near && p.planks < 3) return { kind: 'button', id: 'interact', title: 'TAP USE', sub: 'OPEN AND FEED' };
    return { kind: 'world', label: 'DOOR', sub: 'SERVANT DOOR' };
  }
  if (step === 'raise') {
    const near = stakes && distTo(p, stakes) < STAKE_RANGE;
    if (near && p.planks >= 3) return { kind: 'button', id: 'interact', title: 'TAP USE', sub: 'RAISE THE STAKES' };
    if (p.planks < 3) return { kind: 'world', label: 'PLANKS', sub: 'WALK ONTO THEM' };
    return { kind: 'world', label: 'STAKES', sub: 'FOLLOW THE ARROW' };
  }
  if (step === 'planks' || step === 'planks2') return { kind: 'world', label: 'PLANKS', sub: 'WALK ONTO THEM' };
  if (step === 'door') return { kind: 'world', label: 'DOOR', sub: 'SERVANT DOOR' };
  if (step === 'stakes') return { kind: 'world', label: 'STAKES', sub: 'FOLLOW THE ARROW' };
  return null;
}

function drawWorldCue(game, ctx, w, h, cue) {
  const mark = worldMark(game);
  if (!mark || !game.renderer.worldToScreen) return;
  const label = (cue && cue.label) || 'GO';
  const sub = (cue && cue.sub) || 'FOLLOW THE ARROW';
  const sp = game.renderer.worldToScreen(mark.x, mark.y);
  const view = game.renderer.view || { left: 0, top: 0, w, h };
  const on = sp.x > view.left + 36 && sp.x < view.left + view.w - 36 && sp.y > view.top + 24 && sp.y < view.top + view.h - 28;
  if (!on) {
    edgeArrow(ctx, view, sp, label, game.time);
    return;
  }
  // On screen, the floor arrow is the pointer. A second chevron here was
  // drawn over "RAISE STAKES" and the door name.
  chip(ctx, w, h, label, sub);
}

function pointAtButton(ctx, w, h, b, input, time, title, sub) {
  const aim = aimHand(b, w, h, input);
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
  ctx.save();
  ctx.strokeStyle = `rgba(240, 208, 120, ${0.55 + pulse * 0.4})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r + 7 + pulse * 3, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ripple(ctx, b.x, b.y, time);
  drawTapHand(ctx, aim.tipX, aim.tipY, aim.angle, time);
  chip(ctx, w, h, title, sub);
}

function aimHand(b, w, h, input) {
  const buttons = Object.values(input.buttons).filter((o) => o && o !== b && !o.hidden);
  const stick = input.stick;
  const candidates = [];
  for (let i = 0; i < 16; i++) {
    const outward = -Math.PI + (i / 16) * TAU;
    for (const back of [28, 42, 58]) {
      const tipX = b.x + Math.cos(outward) * (b.r + 8);
      const tipY = b.y + Math.sin(outward) * (b.r + 8);
      const angle = outward + Math.PI;
      const palmX = tipX - Math.cos(angle) * back;
      const palmY = tipY - Math.sin(angle) * back;
      const onScreen = palmX > 16 && palmY > 64 && palmX < w - 16 && palmY < h - 16;
      let clear = onScreen ? 80 : -200;
      for (const o of buttons) clear = Math.min(clear, Math.hypot(palmX - o.x, palmY - o.y) - o.r - 16);
      if (stick) clear = Math.min(clear, Math.hypot(palmX - (stick.homeX || 0), palmY - (stick.homeY || h)) - (stick.r || 52) - 16);
      candidates.push({ tipX, tipY, angle, clear });
    }
  }
  const clean = candidates.filter((c) => c.clear > 0);
  let best = (clean.length ? clean : candidates).slice().sort((a, c) => c.clear - a.clear)[0] || null;
  if (!best) {
    best = {
      tipX: b.x - b.r - 8,
      tipY: b.y,
      angle: 0,
      chipX: b.x - b.r - 36,
      chipY: b.y - b.r - 28,
    };
  }
  return best;
}

function drawDrag(ctx, hx, hy, hr, time) {
  const u = (time % 1.25) / 1.25;
  const slide = u < 0.7 ? u / 0.7 : 1;
  const y = hy + hr * 0.15 - slide * (hr * 0.85);
  ctx.save();
  ctx.strokeStyle = 'rgba(240, 208, 120, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(hx, hy + hr * 0.2);
  ctx.lineTo(hx, hy - hr * 0.72);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ripple(ctx, hx, hy, time * 0.85);
  drawTapHand(ctx, hx, y, -Math.PI / 2, 0.5 + slide);
}

function drawTapHand(ctx, tipX, tipY, angle, time) {
  const cycle = ((time % 1.1) + 1.1) % 1.1;
  const press = cycle < 0.22 ? Math.sin((cycle / 0.22) * Math.PI) : 0;
  const bob = Math.sin(time * 6.5) * 3.5 * (1 - press);
  const back = 26 + bob - press * 9;
  const x = tipX - Math.cos(angle) * back;
  const y = tipY - Math.sin(angle) * back;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(2, 16, 12, 5, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f6ead8';
  ctx.strokeStyle = '#1c1610';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-4.5, 4);
  ctx.lineTo(-4.5, -24);
  ctx.quadraticCurveTo(0, -31, 4.5, -24);
  ctx.lineTo(4.5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8ee';
  ctx.fillRect(-2.6, -26, 5.2, 6);
  ctx.fillStyle = '#f6ead8';
  ctx.beginPath();
  ctx.ellipse(2, 12, 10, 8, 0.3, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (press > 0.15) ripple(ctx, tipX, tipY, cycle);
}

function ripple(ctx, x, y, time) {
  const u = ((time % 1.1) + 1.1) % 1.1;
  if (u < 0.2) return;
  const k = (u - 0.2) / 0.9;
  ctx.save();
  ctx.globalAlpha = (1 - k) * 0.9;
  ctx.strokeStyle = '#f0d078';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8 + k * 22, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function chip(ctx, w, h, title, sub) {
  ctx.save();
  ctx.font = '500 13px "Segoe UI", Roboto, sans-serif';
  const tw = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width);
  const bw = tw + 22;
  const bh = 36;
  const phone = w < 840 || h < 500;
  const short = h < 500;
  const tall = h > w * 1.2 && h >= 620;
  let top;
  let left;
  if (short) {
    // A centered chip on a short phone lands on the dining table. Park it
    // under the goals, on the wall, where the thumb is not.
    top = 76;
    left = 12;
  } else if (tall) {
    const clockY = 40;
    const digitBottom = clockY + 8 + 15;
    const railBottom = clockY + 32;
    top = Math.ceil(Math.max(digitBottom, railBottom) + 8);
    left = Math.max(148, Math.min(w / 2 - bw / 2, w - bw - 8));
  } else {
    const clockY = h * 0.055;
    const digitBottom = clockY + 8 + 20;
    const railBottom = clockY + 42;
    top = Math.ceil(Math.max(digitBottom, railBottom) + 8);
    left = Math.max(8, Math.min(w / 2 - bw / 2, w - bw - 8));
  }
  ctx.fillStyle = 'rgba(8,7,6,0.9)';
  ctx.strokeStyle = 'rgba(240, 208, 120, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(left, top, bw, bh);
  ctx.strokeRect(left + 0.5, top + 0.5, bw - 1, bh - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0d078';
  ctx.fillText(title, left + bw / 2, top + 12);
  ctx.font = '400 10px "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(232, 224, 204, 0.85)';
  ctx.fillText(sub, left + bw / 2, top + 26);
  ctx.restore();
}

function edgeArrow(ctx, view, sp, label, time) {
  const cx = view.left + view.w / 2, cy = view.top + view.h / 2;
  const ang = Math.atan2(sp.y - cy, sp.x - cx);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const hx = view.w / 2 - 36, hy = view.h / 2 - 28;
  const tx = Math.abs(dx) > 0.001 ? hx / Math.abs(dx) : 1e9;
  const ty = Math.abs(dy) > 0.001 ? hy / Math.abs(dy) : 1e9;
  const t = Math.min(tx, ty);
  const x = cx + dx * t;
  const y = cy + dy * t;
  const pulse = 0.7 + 0.3 * Math.abs(Math.sin(time * 5));
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = pulse;
  ctx.rotate(ang);
  ctx.fillStyle = '#f0d078';
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-9, -8);
  ctx.lineTo(-9, 8);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-ang);
  ctx.font = '500 11px "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#f0d078';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 18);
  ctx.restore();
}
