/* Keep jobs. One id, one job, one use.
 *
 * A building is not a cottage. It is a station the hunter walks into
 * (or a yard they tap) and spends a button press on. Numbers without a
 * use are not allowed here.
 */

export const SURVIVAL_BUILDINGS = Object.freeze({
  extractor: Object.freeze({
    id: 'extractor', label: 'OIL STILL', oil: 2, wood: 10, seconds: 7,
    produces: { oil: 6 }, job: 'fuel',
    hint: 'DRAWS OIL EACH DAWN', useLabel: 'DRAW OIL', use: 'collect',
  }),
  sawmill: Object.freeze({
    id: 'sawmill', label: 'TIMBER YARD', oil: 2, wood: 10, seconds: 7,
    produces: { wood: 7 }, job: 'timber',
    hint: 'CUTS WOOD EACH DAWN', useLabel: 'TAKE TIMBER', use: 'collect',
  }),
  shelter: Object.freeze({
    id: 'shelter', label: 'SICK WARD', oil: 4, wood: 14, seconds: 9,
    produces: { survivors: 1 }, job: 'crew',
    hint: 'WALK IN · BIND WOUNDS', useLabel: 'BIND WOUNDS', use: 'heal', useHeal: 38, useCd: 9,
  }),
  watch: Object.freeze({
    id: 'watch', label: 'WATCH TOWER', oil: 4, wood: 12, seconds: 8, job: 'tower',
    hint: 'SHOOTS THE ROAD FROM ABOVE', useLabel: 'WATCH', use: 'tower',
  }),
  armory: Object.freeze({
    id: 'armory', label: 'ARMORY', oil: 3, wood: 12, seconds: 8, job: 'arms',
    hint: 'WALK IN · HONE THE SHOT', useLabel: 'HONE ARMS', use: 'arms', useCd: 14, useMul: 1.28,
  }),
  kitchen: Object.freeze({
    id: 'kitchen', label: 'KITCHEN', oil: 3, wood: 10, seconds: 8, job: 'mess',
    hint: 'WALK IN · EAT, BURN LESS OIL', useLabel: 'EAT', use: 'meal', useHeal: 22, useCd: 12, feedSeconds: 36,
  }),
});

export const SURVIVAL_START_ROOMS = Object.freeze(['hall', 'library']);

/** Courtyard south of the hall. Outdoor jobs live here, not in the forest. */
export const SURVIVAL_COURTYARD = Object.freeze({ x: 0, y: 640, w: 880, h: 380 });

/** The outdoor beacon the keep is built to guard. */
export const SURVIVAL_HEARTH = Object.freeze({ x: 310, y: 760 });

/** Adjacent plots the keep can grow into. A building unlocks the room and gives it a job. */
export const SURVIVAL_WINGS = Object.freeze([
  Object.freeze({ roomId: 'dining', requires: Object.freeze(['hall']), label: 'SICK WARD', accepts: Object.freeze(['shelter']), hearthNeed: 1 }),
  Object.freeze({ roomId: 'study', requires: Object.freeze(['hall']), label: 'ARMORY', accepts: Object.freeze(['armory']), hearthNeed: 1 }),
  Object.freeze({ roomId: 'oratory', requires: Object.freeze(['library']), label: 'CREW DORM', accepts: Object.freeze(['shelter']), hearthNeed: 1 }),
  Object.freeze({ roomId: 'kitchen', requires: Object.freeze(['dining']), label: 'KITCHEN', accepts: Object.freeze(['kitchen']), hearthNeed: 2 }),
  Object.freeze({ roomId: 'basement', requires: Object.freeze(['hall']), label: 'OIL CELLAR', accepts: Object.freeze(['extractor']), hearthNeed: 2 }),
]);

/** Outdoor jobs in the hall courtyard. One plot, one job. */
export const SURVIVAL_YARD = Object.freeze([
  Object.freeze({
    id: 'yard-lumber', name: 'TIMBER YARD', kind: 'yard',
    x: 500, y: 655, w: 170, h: 120,
    accepts: Object.freeze(['sawmill']),
  }),
  Object.freeze({
    id: 'yard-oil', name: 'OIL STILL', kind: 'yard',
    x: 700, y: 655, w: 160, h: 120,
    accepts: Object.freeze(['extractor']),
  }),
  Object.freeze({
    id: 'yard-watch', name: 'WATCH', kind: 'yard',
    x: 720, y: 850, w: 140, h: 140,
    accepts: Object.freeze(['watch']),
  }),
]);

export function buildingSpec(type) {
  return SURVIVAL_BUILDINGS[type] || null;
}
