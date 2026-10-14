/* Walk-in stations. A built room does nothing until the hunter stands in it
 * and spends the use. Watch towers fire on their own and are not stations.
 */

import { dist } from '../../core/util.js';
import { SURVIVAL_BUILDINGS } from './catalog.js';

const YARD_REACH = 70;

function plotCenter(plot) {
  if (!plot) return null;
  return { x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 };
}

function stationFrom(roomId, type, plot, fallback) {
  const spec = SURVIVAL_BUILDINGS[type];
  if (!spec || !spec.use || spec.use === 'tower') return null;
  const at = plotCenter(plot) || fallback;
  return { roomId, type, spec, x: at.x, y: at.y };
}

/** Station under the hunter, or null. Indoor rooms win over yard reach. */
export function findStation(mode) {
  const player = mode.game.player;
  const roomId = mode.game.mansion.findRoom(player.x, player.y);
  if (roomId && mode.buildings[roomId]) {
    const indoor = stationFrom(roomId, mode.buildings[roomId], mode.plotById(roomId), player);
    if (indoor) return indoor;
  }
  for (const [id, type] of Object.entries(mode.buildings)) {
    const plot = mode.plotById(id);
    if (!plot || plot.kind !== 'yard') continue;
    const station = stationFrom(id, type, plot, player);
    if (station && dist(player.x, player.y, station.x, station.y) < YARD_REACH) return station;
  }
  return null;
}

/**
 * Apply the station job. Returns a result the sim and tests can assert:
 * { ok, reason, heal, armsBuff, fedT, collected }.
 */
export function useStation(mode, station) {
  if (!station || !station.spec) return { ok: false, reason: 'none' };
  const spec = station.spec;
  const cd = (mode.stationCd && mode.stationCd[station.roomId]) || 0;
  if (cd > 0) return { ok: false, reason: 'cooldown', remaining: cd };

  if (spec.use === 'collect') {
    const collected = mode.collectProduction(station.roomId);
    return collected ? { ok: true, reason: 'collect', collected } : { ok: false, reason: 'empty' };
  }

  if (spec.use === 'heal' || spec.use === 'meal') {
    const player = mode.game.player;
    const heal = spec.useHeal || 20;
    const before = player.blood;
    player.blood = Math.min(player.bloodMax, player.blood + heal);
    const gained = player.blood - before;
    if (spec.use === 'meal') mode.fedT = spec.feedSeconds || 36;
    if (!mode.stationCd) mode.stationCd = Object.create(null);
    mode.stationCd[station.roomId] = spec.useCd || 10;
    return {
      ok: true,
      reason: spec.use,
      heal: gained,
      fedT: mode.fedT || 0,
    };
  }

  if (spec.use === 'arms') {
    mode.armsBuff = spec.useMul || 1.28;
    if (!mode.stationCd) mode.stationCd = Object.create(null);
    mode.stationCd[station.roomId] = spec.useCd || 14;
    return { ok: true, reason: 'arms', armsBuff: mode.armsBuff };
  }

  return { ok: false, reason: 'idle' };
}
