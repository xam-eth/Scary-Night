/* Procedural outdoor dressing for the full-3D mansion scene.
 *
 * The layout is deterministic and data-only: World3D turns these placements
 * into instanced meshes, while the same tree/rock footprints are added to the
 * mansion's collision grid so the player and combatants cannot walk through
 * the scenery. The siege crowd is deliberately not part of this module.
 */
import { hash2 } from '../core/util.js';

const hashRange = (x, y, seed, min, max) => min + hash2(x, y, seed) * (max - min);

function rectDistance(x, y, rect) {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * BUILD 15 (V7, docs/VISUAL-LAYOUT-RESEARCH.md §7): the fortress keeps its
 * ground clear where the fight is. Every gate has a kill zone (KILL_ZONE px
 * round the point the horde gathers on outside it) and the two faces nearest
 * the camera, south and east, have a glacis GLACIS px deep: a conifer there
 * stood between the camera and a crowd at the gate. Those trees are felled,
 * not removed — the stump keeps the trunk's footprint in the collision grid,
 * so nothing about the fight moves; only the crown that hid it is gone.
 */
export const KILL_ZONE = 380;
export const GLACIS = 460;

function felledByFortress(x, y, fortress, gates) {
  if (!fortress) return false;
  if (gates.some((e) => Math.hypot(x - e.outside.x, y - e.outside.y) < KILL_ZONE)) return true;
  const b = fortress.bailey;
  const south = y > b.y + b.h && y < b.y + b.h + GLACIS && x > b.x - GLACIS && x < b.x + b.w + GLACIS;
  const east = x > b.x + b.w && x < b.x + b.w + GLACIS && y > b.y - GLACIS && y < b.y + b.h + GLACIS;
  return south || east;
}

function overlapsSolid(x, y, solids, pad = 8) {
  return solids.some((s) => x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad);
}

/** Build a broken outer tree line, clearings, boulders and collision footprints. */
export function makeExterior(mansion) {
  const bounds = mansion.camBounds || mansion.bounds;
  const playable = mansion.bounds;
  const rooms = mansion.roomList || [];
  const entrances = mansion.entrances || [];
  const solids = mansion.solids || [];
  const trees = [];
  const rocks = [];
  const brush = [];
  const blockers = [];
  const step = 245;
  // BUILD 15: the fortress's kill zones and glacis (felledByFortress)
  const fortress = mansion.isFortress && mansion.bailey ? mansion : null;
  const gates = fortress ? entrances.filter((e) => e.exterior && e.gate && e.outside) : [];
  const cols = Math.ceil(bounds.w / step);
  const rows = Math.ceil(bounds.h / step);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = bounds.x + 82 + gx * step + hashRange(gx, gy, 41, -step * 0.3, step * 0.3);
      const y = bounds.y + 82 + gy * step + hashRange(gx, gy, 42, -step * 0.3, step * 0.3);
      if (x < bounds.x + 36 || x > bounds.x + bounds.w - 36 || y < bounds.y + 36 || y > bounds.y + bounds.h - 36) continue;

      // A generous clear moat around walls keeps the 3D kit and door swings
      // unobstructed. A separate clearance cone protects every exterior door.
      if (rooms.some((room) => rectDistance(x, y, room) < 142)) continue;
      if (overlapsSolid(x, y, solids, 34)) continue;
      const nearDoor = entrances.some((e) => e.exterior && e.outside
        && Math.hypot(x - e.outside.x, y - e.outside.y) < (e.kind === 'door' ? 220 : 118));
      if (nearDoor) continue;

      const roll = hash2(gx, gy, 43);
      const inPlayableBounds = x >= playable.x + 24 && x <= playable.x + playable.w - 24
        && y >= playable.y + 24 && y <= playable.y + playable.h - 24;
      if (roll < 0.58) {
        const crown = hashRange(gx, gy, 44, 50, 82);
        const radius = hashRange(gx, gy, 45, 17, 27);
        const tree = {
          x, y,
          height: hashRange(gx, gy, 46, 205, 365),
          crown,
          trunk: hashRange(gx, gy, 47, 9, 15),
          phase: hashRange(gx, gy, 48, 0, Math.PI * 2),
          shade: hash2(gx, gy, 49),
        };
        if (felledByFortress(x, y, fortress, gates)) tree.felled = true;
        trees.push(tree);
        if (inPlayableBounds) blockers.push({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2, type: 'exteriorTree', solid: true });
      } else if (roll < 0.82) {
        const radius = hashRange(gx, gy, 50, 24, 48);
        rocks.push({
          x, y,
          radius,
          height: radius * hashRange(gx, gy, 51, 0.42, 0.7),
          turn: hashRange(gx, gy, 52, 0, Math.PI * 2),
          shade: hash2(gx, gy, 53),
        });
        if (inPlayableBounds) blockers.push({ x: x - radius * 0.72, y: y - radius * 0.7, w: radius * 1.44, h: radius * 1.4, type: 'exteriorRock', solid: true });
      } else {
        brush.push({
          x: x + hashRange(gx, gy, 54, -28, 28),
          y: y + hashRange(gx, gy, 55, -28, 28),
          scale: hashRange(gx, gy, 56, 0.62, 1.3),
          turn: hashRange(gx, gy, 57, 0, Math.PI * 2),
          shade: hash2(gx, gy, 58),
        });
      }
    }
  }

  // Scatter a few smaller ground-cover tufts between the large silhouettes.
  // They are generated in the same deterministic grid but remain collision-free.
  for (let i = 0; i < Math.min(170, trees.length + rocks.length); i++) {
    const gx = i * 17 + 3;
    const gy = i * 29 + 7;
    const x = hashRange(gx, gy, 61, bounds.x + 80, bounds.x + bounds.w - 80);
    const y = hashRange(gx, gy, 62, bounds.y + 80, bounds.y + bounds.h - 80);
    if (rooms.some((room) => rectDistance(x, y, room) < 168)) continue;
    if (entrances.some((e) => e.exterior && e.outside && Math.hypot(x - e.outside.x, y - e.outside.y) < 150)) continue;
    brush.push({ x, y, scale: hashRange(gx, gy, 63, 0.56, 1.2), turn: hashRange(gx, gy, 64, 0, Math.PI * 2), shade: hash2(gx, gy, 65) });
  }

  return { trees, rocks, brush, blockers };
}
