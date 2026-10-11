/* DUSKHOLD — deterministic survival bots shared by the harness and the
 * balance probe. They drive the real Input object (virtual stick + the
 * Interact key for Flare); nothing here reaches into enemy internals.
 *
 *   botNight(game, state, { ROOM, ISO_CAMERA })  active defender, one frame
 *   botDay(game, plan)                           'idle' | 'builder' day turn
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
 * Engaged defender: hold the firelight between the hearth and the nearest
 * intruder, fall back to the Perapian when it is being clawed, Flare clusters.
 */
export function botNight(game, state, { ROOM, ISO_CAMERA }) {
  const mode = game.survival;
  const p = game.player;
  const fire = mode.hearth();
  game.input.keys.interact = false;
  if (!fire) return;
  const live = game.enemies.filter((e) => e._survivalType && !e.dead && !e.removeMe);
  const inside = live.filter((e) => e._inHouse || (e.roomId && e.roomId !== ROOM.OUTSIDE));
  const radius = mode.getFireRadius();
  let goal = { x: fire.x + 60, y: fire.y + 190 };
  const nearFire = inside.filter((e) => dist(e, fire) < 520);
  if (mode.hearthFeeders > 0 || nearFire.length) {
    goal = { x: fire.x + 30, y: fire.y + 170 };
  } else if (inside.length) {
    inside.sort((a, b) => dist(a, fire) - dist(b, fire));
    const t = inside[0];
    const d = dist(t, fire) || 1;
    // Never stray far from the hearth: intercept inside ~600 px of the fire.
    const reach = Math.min(d * 0.6, radius * 0.72, 600);
    goal = { x: fire.x + (t.x - fire.x) / d * reach, y: fire.y + (t.y - fire.y) / d * reach };
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

/** One day decision. Returns true when the night was started. */
export function botDay(game, plan) {
  const mode = game.survival;
  if (mode.rewardPending()) mode.ackRewards();
  if (plan !== 'builder') return mode.startNight();
  if (mode.builderJob) return false;
  const rooms = mode.buildableRooms();
  const counts = Object.values(mode.buildings).reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {});
  const tryBuild = (type, roomId) => mode.startBuild(type, roomId);
  if (mode.perapianLevel < 2 && tryBuild('perapian')) return false;
  if (!counts.extractor && rooms[0] && tryBuild('extractor', rooms[0].id)) return false;
  if (!mode.gateBuilt && tryBuild('gate')) return false;
  if (!counts.sawmill && rooms[0] && tryBuild('sawmill', rooms[0].id)) return false;
  if (mode.perapianLevel < 3 && tryBuild('perapian')) return false;
  if ((counts.extractor || 0) < 2 && rooms[0] && tryBuild('extractor', rooms[0].id)) return false;
  if (!counts.shelter && rooms[0] && tryBuild('shelter', rooms[0].id)) return false;
  return mode.startNight();
}
