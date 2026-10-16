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
 * === false turns that off (measurement only).
 */
export function botNight(game, state, { ROOM, ISO_CAMERA }) {
  const mode = game.survival;
  const p = game.player;
  const keep = mode.keep();
  game.input.keys.interact = false;
  if (!keep) return;
  const live = game.enemies.filter((e) => e._survivalType && !e.dead && !e.removeMe);
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
    // Nothing inside: go and shoot the crowd through the door it is clawing
    // (door slits), standing a step back from the wood.
    const doors = mode.besiegedDoors().sort((a, b) => mode.doorPressure(b.id) - mode.doorPressure(a.id));
    const door = doors[0];
    if (door && door.inside) {
      const ix = door.inside.x - door.x, iy = door.inside.y - door.y;
      const il = Math.hypot(ix, iy) || 1;
      goal = { x: door.inside.x + ix / il * 70, y: door.inside.y + iy / il * 70 };
    }
  }
  if (dist(p, goal) > 46) {
    const path = game.mansion.navPath(p.x, p.y, goal.x, goal.y);
    const wp = path && path.length ? (path.length > 1 && dist(p, path[0]) < 30 ? path[1] : path[0]) : goal;
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

/**
 * One day decision. Returns true when the night was started. Bots buy on
 * the typed circles directly (the walk between circles costs no clock).
 *   keep     only ever raises the keep
 *   hunter   the Hunter's track first, then the keep
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
