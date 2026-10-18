/* DUSKHOLD — deterministic survival bots shared by the harness and the
 * balance probe. They drive the real Input object (virtual stick + the
 * Interact key for Flare); nothing here reaches into enemy internals.
 *
 *   botNight(game, state, { ROOM, ISO_CAMERA })  active defender, one frame
 *   botDay(game, plan)                           'idle' | 'keep' | 'hunter' | 'builder' | 'tower' day turn
 */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Push the virtual stick toward a world-space direction. */
export function steerStick(game, wx, wy, ISO_CAMERA) {
  const s = game.input.stick;
  const len = Math.hypot(wx, wy);
  if (len < 1e-3) { s.active = false; return; }
  const h = ISO_CAMERA.horizontal, k = ISO_CAMERA.vertical;
  let sx = h * (wx - wy), sy = k * (wx + wy);
  const sl = Math.hypot(sx, sy) || 1;
  sx /= sl; sy /= sl;
  s.active = true; s.pointer = true; s.ox = 100; s.oy = 700;
  s.x = s.ox + sx * s.r; s.y = s.oy + sy * s.r;
}

export function releaseControls(game) {
  const s = game.input.stick;
  s.active = false; s.mag = 0;
  game.input.keys.interact = false;
}

/**
 * Engaged defender (K1): hold a spot beside the keep between it and the
 * nearest intruder, fall back to the keep when it is being clawed, Flare
 * clusters. When a guard is down (and the keep is not being clawed, and he is
 * not hurt) he goes and stands beside it until it is back up; state.rescue
 * === false turns that off (measurement only). With nothing inside he holds
 * the busiest gate from its mouth and steps back to rest (BUILD 10: a shut
 * gate stops his bolts; see peekSpot).
 */
export function botNight(game, state, { ROOM, ISO_CAMERA }) {
  const mode = game.survival;
  const p = game.player;
  const keep = mode.keep();
  game.input.keys.interact = false;
  if (!keep) return;
  const live = game.enemies.filter((e) => e._survivalType && !e.dead && !e.removeMe && !e.fleeing);
  const inside = live.filter((e) => e._inHouse || (e.roomId && e.roomId !== ROOM.OUTSIDE));
  const home = mode.hunterHome();
  let goal = { x: home.x, y: home.y };
  const nearKeep = inside.filter((e) => dist(e, keep) < 520);
  const hurt = p.blood < p.bloodMax * 0.45;
  const fallen = state.rescue === false ? [] : (mode.guards || []).filter((gd) => gd.down);
  if (mode.keepAttackers > 0 || nearKeep.length || hurt) {
    // stand at the keep's wall on the side the trouble is on
    const t = nearKeep.sort((a, b) => dist(a, keep) - dist(b, keep))[0];
    const a = t ? Math.atan2(t.y - keep.y, t.x - keep.x) : 0;
    goal = { x: keep.x + Math.cos(a) * (keep.r + 70), y: keep.y + Math.sin(a) * (keep.r + 70) };
  } else if (fallen.length) {
    fallen.sort((a, b) => dist(a, p) - dist(b, p));
    goal = { x: fallen[0].x, y: fallen[0].y };
    state.rescueTrips = (state.rescueTrips || 0) + (state.lastRescue === fallen[0] ? 0 : 1);
    state.lastRescue = fallen[0];
  } else if (inside.length) {
    inside.sort((a, b) => dist(a, keep) - dist(b, keep));
    const t = inside[0];
    const d = dist(t, keep) || 1;
    // never stray far from the keep: intercept inside ~600 px of it
    const reach = Math.min(d * 0.6, 600);
    goal = { x: keep.x + (t.x - keep.x) / d * reach, y: keep.y + (t.y - keep.y) / d * reach };
  } else if (state.doors !== false && mode.besiegedDoors) {
    // Nothing inside (BUILD 10): a shut gate stops his bolts. He steps into
    // the busiest gate's mouth (it swings open for him) and shoots the crowd
    // while its front rank claws back through the opening; at half HP he
    // steps back to get his breath (SORTIE.rest) and goes again.
    const spot = peekSpot(game, state, p);
    if (spot) goal = spot;
    else if (state.rally) {
      // survival-uxprobe's `rally` player only (BUILD 16, R6): he walks to
      // the gate the first wave's call named as the night begins, instead of
      // waiting at the keep until it is clawed. The balance bots never set it.
      const door = gatesOf(game).find((e) => e.id === state.rally);
      if (door) { const o = outward(door); goal = { x: door.x - o.x * 20, y: door.y - o.y * 20, tight: true }; }
    } else if (state.hunt && mode.stragglers) {
      // and goes after the night's marked last few (BUILD 16, R5), to a
      // shot's length (his auto-shot reaches 540 px)
      const last = live.slice().sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (last) {
        const d = dist(last, p) || 1;
        const k = Math.max(0, d - 300) / d;
        goal = { x: p.x + (last.x - p.x) * k, y: p.y + (last.y - p.y) * k };
      }
    }
  } else state.peek = null;
  // in and out of the walls only by a gate (it opens for him)
  const leg = travel(game, p, goal, ROOM);
  const final = leg.goal === goal;
  if (dist(p, leg.goal) > (final ? (goal.tight ? 8 : 46) : 10)) {
    const path = leg.path ? game.mansion.navPath(p.x, p.y, leg.goal.x, leg.goal.y) : null;
    const wp = path && path.length ? (path.length > 1 && dist(p, path[0]) < 30 ? path[1] : path[0]) : leg.goal;
    steerStick(game, wp.x - p.x, wp.y - p.y, ISO_CAMERA);
  } else {
    game.input.stick.active = false;
  }
  if (mode.skillCooldown <= 0 && mode.enemiesNear(p.x, p.y, mode.tuning.skillRadius * 0.9) >= 3) {
    game.input.keys.interact = !state.flareHeld;
    state.flareHeld = !state.flareHeld;
    if (game.input.keys.interact) state.flares = (state.flares || 0) + 1;
  } else state.flareHeld = false;
}

const gatesOf = (game) => game.mansion.entrances.filter((e) => e.gate && e.exterior);
const outward = (e) => {
  const dx = e.outside.x - e.x, dy = e.outside.y - e.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};

/**
 * The next leg toward `goal`. Inside to outside (or back) goes by the gate
 * that makes the shortest walk: to its near side by the nav grid, then
 * straight through (the gate opens for the captain, BUILD 10; the nav grid
 * still counts a shut gate as a wall). Returns { goal, path }.
 */
function travel(game, from, goal, ROOM) {
  const m = game.mansion;
  const b = m.bailey;
  const inside = (pt) => (b ? pt.x > b.x && pt.x < b.x + b.w && pt.y > b.y && pt.y < b.y + b.h
    : m.findRoom(pt.x, pt.y) !== ROOM.OUTSIDE);
  const goalIn = inside(goal);
  // at a gate (or in it): straight on through to the goal's side and a step past
  for (const e of gatesOf(game)) {
    const o = outward(e);
    const rx = from.x - e.x, ry = from.y - e.y;
    const across = rx * o.x + ry * o.y, along = -rx * o.y + ry * o.x;
    const half = (e.axis === 'v' ? e.h : e.w) / 2;
    if (Math.abs(along) > half - 8 || Math.abs(across) > 84) continue;
    if (goalIn && across > -30) return { goal: e.inside, path: false };
    if (!goalIn && across < 30) return { goal: e.outside, path: false };
  }
  const a = !inside(from);
  if (a === !goalIn) return { goal, path: true };
  // never through a crowd: a gate with bodies at it costs a long detour
  const crowds = game.enemies.filter((e) => e._survivalType && !e.dead && !e.removeMe && !e._inHouse);
  let best = null, bestD = Infinity;
  for (const e of gatesOf(game)) {
    const near = a ? e.outside : e.inside, far = a ? e.inside : e.outside;
    const busy = crowds.filter((z) => dist(z, e.outside) < 190).length;
    const d = dist(from, near) + dist(far, goal) + busy * 400;
    if (d < bestD) { best = e; bestD = d; }
  }
  if (!best) return { goal, path: true };
  return { goal: a ? best.outside : best.inside, path: true };
}

/**
 * The gate the captain holds and where he stands for it: in its mouth (20 px
 * inside the wall line, so the leaf is open and his bolts fly out) while he
 * is above half HP, then 140 px back inside (the gate shuts, the claws stop)
 * until he has his breath back. Sticks with one gate while it is besieged.
 */
function peekSpot(game, state, p) {
  const mode = game.survival;
  const doors = mode.besiegedDoors().filter((e) => e.gate && e.outside);
  if (!doors.length) { state.peek = null; return null; }
  let pk = state.peek && doors.find((e) => e.id === state.peek.door) ? state.peek : null;
  const share = (e) => e.hp / Math.max(1, e.hpMax);
  if (pk) {
    // only an emergency pulls him off his gate: another one about to give
    // while his still holds
    const held = doors.find((e) => e.id === pk.door);
    const sos = doors.find((e) => e !== held && share(e) < 0.3 && mode.doorPressure(e.id) >= 3);
    if (sos && share(held) > 0.5) pk = state.peek = { door: sos.id, phase: pk.phase };
  }
  if (!pk) {
    // the busiest gate, the weakest first among equals
    doors.sort((a, b) => (mode.doorPressure(b.id) - mode.doorPressure(a.id)) || (share(a) - share(b)));
    pk = state.peek = { door: doors[0].id, phase: 'peek' };
  }
  const door = doors.find((e) => e.id === pk.door);
  if (pk.phase === 'peek' && p.blood < p.bloodMax * 0.5) pk.phase = 'rest';
  else if (pk.phase === 'rest' && p.blood >= p.bloodMax * 0.92) pk.phase = 'peek';
  const o = outward(door);
  const back = pk.phase === 'peek' ? 20 : 140;
  return { x: door.x - o.x * back, y: door.y - o.y * back, tight: pk.phase === 'peek' };
}

/**
 * One day decision. Returns true when the night was started. Bots buy on
 * the typed circles directly (the walk between circles costs no clock).
 *   keep     only ever raises the keep
 *   hunter   the Hunter's track first, then the keep
 *   arms     a barracks, then the guards' crossbows (BUILD 14), the keep
 *   tower    a mine, then a ballista on every ballista circle under the
 *            banner, the keep, and ballista levels
 *   builder  the balanced queue (keep, mine, barricade, sawmill, ...)
 * Every builder patches a badly hurt keep first (wood).
 */
export function botDay(game, plan) {
  const mode = game.survival;
  if (mode.rewardPending()) mode.ackRewards();
  if (mode.builderJob) return false;
  const free = (type) => mode.buildableSlots().find((slot) => slot.type === type);
  const tryBuild = (type) => { const slot = free(type); return !!slot && mode.startBuild(type, slot.id); };
  const repair = () => mode.keepHp < mode.keepHpMax() * 0.6 && mode.startBuild('repair');
  if (plan === 'keep' || plan === 'fire') {
    if (mode.keepLevel < 3 && mode.startBuild('keep')) return false;
    return mode.startNight();
  }
  if (plan === 'hunter') {
    if (mode.hunterLevel < 3 && mode.startBuild('hunter')) return false;
    if (mode.keepLevel < 3 && mode.startBuild('keep')) return false;
    return mode.startNight();
  }
  const built = Object.entries(mode.buildings);
  if (plan === 'arms') {
    if (repair()) return false;
    if (!built.some(([, t]) => t === 'barracks') && tryBuild('barracks')) return false;
    if (mode.armsLevel < 3 && mode.startBuild('arms')) return false;
    if (mode.keepLevel < 3 && mode.startBuild('keep')) return false;
    return mode.startNight();
  }
  if (plan === 'tower') {
    if (repair()) return false;
    if (mode.keepLevel < 2 && mode.startBuild('keep')) return false;
    if (!built.some(([, t]) => t === 'mine') && tryBuild('mine')) return false;
    if (tryBuild('tower')) return false;
    if (mode.keepLevel < 3 && mode.startBuild('keep')) return false;
    for (const [slotId, t] of built) if (t === 'tower' && mode.buildingLevel(slotId) < 2 && mode.startBuild('upgrade', slotId)) return false;
    return mode.startNight();
  }
  if (plan !== 'builder') return mode.startNight();
  const counts = built.reduce((m, [, t]) => { m[t] = (m[t] || 0) + 1; return m; }, {});
  const lastDay = mode.day >= 3;
  // raise the first building of a type to Lv2 (the builder's one queue)
  const tryLevel = (type) => {
    const row = built.find(([slotId, t]) => t === type && mode.buildingLevel(slotId) < 2);
    return !!row && mode.startBuild('upgrade', row[0]);
  };
  if (repair()) return false;
  if (mode.keepLevel < 2 && mode.startBuild('keep')) return false;
  // the mine digs gold every night, so it pays back even when bought late
  if (!counts.mine && tryBuild('mine')) return false;
  if (!mode.gateBuilt && mode.startBuild('gate')) return false;
  // a sawmill pays at dawn: never worth buying on the last day
  if (!counts.sawmill && !lastDay && tryBuild('sawmill')) return false;
  if (mode.keepLevel < 3 && mode.startBuild('keep')) return false;
  if (mode.hunterLevel < 2 && mode.startBuild('hunter')) return false;
  if (tryLevel('mine')) return false;
  if (!counts.barracks && tryBuild('barracks')) return false;
  if ((counts.mine || 0) < 2 && tryBuild('mine')) return false;
  return mode.startNight();
}
