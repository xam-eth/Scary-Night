/**
 * THE LAST FORTRESS — the world of the Survival mode (K1 "Benteng Terakhir").
 *
 * The house in mansion.js tells a different story: a family's rooms, a
 * dining table, a chapel. Survival is a captain holding a walled bailey for
 * three nights until relief comes, so its world is a bailey: an open
 * courtyard inside a curtain wall, the keep in the middle of the inner ward,
 * roads paved from the keep to four gates, grass yards in the corners where
 * the mine, the sawmill and the barracks go up, and the forest outside the
 * wall where the horde comes from (docs/concepts/k1-benteng-terakhir.jpg).
 *
 * It reuses all of the Mansion machinery — collision grid, nav grid, doors,
 * routes, the exterior forest, the EnvKit room kit — by speaking the same
 * data:
 *   - "rooms" are the bailey's zones. They tile the courtyard exactly, with
 *     no wall between them, so findRoom() names the yard you stand in and
 *     the keep's banner can grow yard by yard;
 *   - "entrances" are the gates in the curtain wall (kind 'door');
 *   - the wall is only built along the outside of the bailey, with the
 *     gates cut out of it, plus solid towers on the corners and either side
 *     of the four big gates.
 * The legacy route (?legacy=1) keeps the house.
 */
import { Mansion, ROOM } from './mansion.js';

const WALL_T = 26;

/** Zone ids. They are room ids as far as the rest of the game knows. */
export const FORT = Object.freeze({
  WARD: 'ward',
  NORTH: 'north',
  SOUTH: 'south',
  EAST: 'east',
  WEST: 'west',
  NW: 'northwest',
  NE: 'northeast',
  SW: 'southwest',
  SE: 'southeast',
  OUTSIDE: ROOM.OUTSIDE,
});

/**
 * The bailey's scale. The first fortress (scale 1: 2600 x 1900 px, ~50 x 37 m)
 * read as a huge empty courtyard with small pieces in it (playtest
 * 2026-10-16: "benteng awal terlalu besar luas sedangkan component game nya
 * kecil"); 0.7 changed nothing on a phone, and 0.5 (1300 x 950 px, BUILD 8-11)
 * went the other way: 15 plots, the keep and the gates in 0.8 of a screen read
 * as crammed (2026-10-17: "lebar benteng dengan component di dalam terlihat
 * sangat padat"), and colours and labels alone did not change that.
 *
 * BUILD 12 is layout option B of docs/VISUAL-LAYOUT-RESEARCH.md (chosen
 * 2026-10-17: "untuk opsi nya B"): the same 15 plots in a bailey 1.6x the
 * size, 0.8: 2080 x 1520 px (~40 x 29 m), about two phone screens at the play
 * framing, laid out like a Rise of Kingdoms city — the keep on a stone plaza
 * in the middle, narrow paved roads to the four gates, each grass quarter one
 * district of one building type, open ground between the districts and the
 * wall. The camera zooms out far enough to see the whole bailey
 * (SURVIVAL_CAMERA). Gate widths, towers and props keep their size.
 */
export const FORT_SCALE = 0.8;
const S = (v) => Math.round(v * FORT_SCALE);
/**
 * The curtain wall is low, ~2 m (the house's walls are 2.6): with the actors
 * x1.6 a 2.6 m wall hid the horde at the north and side gates from the
 * camera — only heads showed over it, so the fight read as numbers popping
 * behind masonry. At 2 m the front ranks show from the chest up between the
 * merlons; the towers and the gatehouses stay tall.
 */
export const FORT_WALL_METRES = 2.0;
/** The courtyard inside the curtain wall: 2080 x 1520 px at FORT_SCALE 0.8. */
export const BAILEY = Object.freeze({ x: S(-1300), y: S(-950), w: S(2600), h: S(1900) });
/**
 * Half the width of a paved road (BUILD 12): the four gate roads are 260 px
 * wide streets between the districts, not a third of the bailey each (at
 * BUILD 11's proportions they would be 720 px of bare stone). The inner ward
 * is the square where they cross; World3D lays the keep's round plaza on it.
 */
export const ROAD_HALF = 130;
const COLS = Object.freeze([BAILEY.x, -ROAD_HALF, ROAD_HALF, BAILEY.x + BAILEY.w]);
const ROWS = Object.freeze([BAILEY.y, -ROAD_HALF, ROAD_HALF, BAILEY.y + BAILEY.h]);
/** The stone plaza round the keep (World3D), px from the keep's centre. */
export const PLAZA_R = 235;

/** The gates, clockwise from the main gate that faces the camera. */
export const GATES = Object.freeze([
  Object.freeze({ id: 'southGate', name: 'MAIN GATE', room: FORT.SOUTH, side: 'south', at: 0, width: 170, hp: 260, big: true }),
  Object.freeze({ id: 'westGate', name: 'WEST GATE', room: FORT.WEST, side: 'west', at: 0, width: 160, hp: 200, big: true }),
  Object.freeze({ id: 'posternNW', name: 'NORTHWEST POSTERN', room: FORT.NW, side: 'west', at: S(-640), width: 118, hp: 110, big: false }),
  Object.freeze({ id: 'northGate', name: 'NORTH GATE', room: FORT.NORTH, side: 'north', at: 0, width: 160, hp: 200, big: true }),
  Object.freeze({ id: 'eastGate', name: 'EAST GATE', room: FORT.EAST, side: 'east', at: 0, width: 160, hp: 200, big: true }),
  Object.freeze({ id: 'posternSE', name: 'SOUTHEAST POSTERN', room: FORT.SE, side: 'east', at: S(640), width: 118, hp: 110, big: false }),
]);

const CORNER_TOWER = 130;   // footprint of a corner tower, px
const GATE_TOWER = 84;      // footprint of a gatehouse tower, px
const POSTERN_POST = 22;    // px from a postern's frame to the middle of its guard deck
const POSTERN_DECK = 40;    // px square: the plank platform behind the wall beside a postern
const POSTERN_DECK_IN = 33; // px from the wall's line into the yard to the deck's middle
const LADDER_FOOT = 18;     // px from the masonry's (or the deck's) yard edge to where a ladder stands

/**
 * BUILD 15 (V6, docs/VISUAL-LAYOUT-RESEARCH.md §7): how far a tower's
 * masonry rises over the top of the curtain wall, px (World3D builds the
 * towers from it; the guards on a gate tower stand on it). The camera looks
 * from the south-east, so a tower on the south or east side stands between
 * it and a fight at that side's gate: in BUILD 14 the main gate's east tower
 * hid the captain whole while he held the gate from inside. Those are squat
 * bastions now, a merlon row over the wall-walk, and the south-east corner
 * (the bottom of the frame) is cut down too. The tall towers keep to the
 * north and west edge, the top of the frame, with the keep.
 */
export const TOWER_RISE = Object.freeze({ corner: 108, gate: 88, bastion: 20, cornerLow: 44 });
/** The sides of the bailey between the camera and the yard (BUILD 15). */
export const NEAR_SIDES = Object.freeze(['south', 'east']);
const nearCamera = (side) => NEAR_SIDES.includes(side);

export class Fortress extends Mansion {
  /*
   * Note: no class fields here. Mansion's constructor calls build() before
   * a subclass's fields would be initialised, and they would then overwrite
   * what build() made.
   */
  build() {
    this.isFortress = true;
    this.wallMetres = FORT_WALL_METRES;
    this.bailey = BAILEY;
    this.keepSpot = { x: BAILEY.x + BAILEY.w / 2, y: BAILEY.y + BAILEY.h / 2 };

    const zone = (key, name, c, r, floor) => ({
      key, id: key, name, floor, dark: 0.2,
      x: COLS[c], y: ROWS[r], w: COLS[c + 1] - COLS[c], h: ROWS[r + 1] - ROWS[r],
    });
    // Paved cross (the inner ward and the four gate roads), grass corners.
    const plan = [
      zone(FORT.WARD, 'INNER WARD', 1, 1, 'stone'),
      zone(FORT.NORTH, 'NORTH ROAD', 1, 0, 'stone'),
      zone(FORT.SOUTH, 'GATE ROAD', 1, 2, 'stone'),
      zone(FORT.WEST, 'WEST ROAD', 0, 1, 'stone'),
      zone(FORT.EAST, 'EAST ROAD', 2, 1, 'stone'),
      zone(FORT.NW, 'NORTHWEST YARD', 0, 0, 'grass'),
      zone(FORT.NE, 'NORTHEAST YARD', 2, 0, 'grass'),
      zone(FORT.SW, 'SOUTHWEST YARD', 0, 2, 'grass'),
      zone(FORT.SE, 'SOUTHEAST YARD', 2, 2, 'grass'),
    ];
    this.rooms = {};
    this.roomList = plan.map((r) => (this.rooms[r.key] = { ...r }));
    this.solids = [];
    this.furniture = [];
    this.props = [];
    this.lights = [];
    this.entrances = [];
    this.spawns = [];
    this.portals = [];
    this.passages = [];
    this.towers = [];
    this.threshold = [];
    this.libraryArch = null;
    this.fireplaceLight = null;
    this.chapelAltar = null;
    this.studyWard = null;
    this.stakesUp = false;

    // Room outside the wall for the horde to gather and for the forest edge.
    const margin = 760;
    this.bounds = { x: BAILEY.x - margin, y: BAILEY.y - margin, w: BAILEY.w + margin * 2, h: BAILEY.h + margin * 2 };
    const cameraPad = 1400;
    this.camBounds = {
      x: this.bounds.x - cameraPad, y: this.bounds.y - cameraPad,
      w: this.bounds.w + cameraPad * 2, h: this.bounds.h + cameraPad * 2,
    };

    // Open ground between neighbouring yards, for the room-graph route().
    for (const a of this.roomList) {
      for (const b of this.roomList) {
        if (a.id >= b.id) continue;
        const sharedX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const sharedY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (sharedX > 0 && (a.y + a.h === b.y || b.y + b.h === a.y)) {
          const y = a.y + a.h === b.y ? b.y : a.y;
          this.passages.push({ a: a.id, b: b.id, x: Math.max(a.x, b.x) + sharedX / 2, y, r: sharedX / 2, id: `${a.id}-${b.id}` });
        } else if (sharedY > 0 && (a.x + a.w === b.x || b.x + b.w === a.x)) {
          const x = a.x + a.w === b.x ? b.x : a.x;
          this.passages.push({ a: a.id, b: b.id, x, y: Math.max(a.y, b.y) + sharedY / 2, r: sharedY / 2, id: `${a.id}-${b.id}` });
        }
      }
    }

    // ---- the gates in the curtain wall ----
    const half = WALL_T / 2;
    const wallPos = {
      north: BAILEY.y - half,
      south: BAILEY.y + BAILEY.h + half,
      west: BAILEY.x - half,
      east: BAILEY.x + BAILEY.w + half,
    };
    for (const g of GATES) {
      const axis = g.side === 'north' || g.side === 'south' ? 'h' : 'v';
      const pos = wallPos[g.side];
      const a1 = g.at - g.width / 2;
      const a2 = g.at + g.width / 2;
      const x = axis === 'h' ? g.at : pos;
      const y = axis === 'h' ? pos : g.at;
      const portal = { id: g.id, kind: 'door', name: g.name, room: g.room, side: g.side, at: g.at, width: g.width, axis, pos, a1, a2, x, y };
      this.portals.push(portal);
      const gate = this.makeDoor(g.id, g.name, a1, a2, pos, axis, g.side, g.room);
      gate.exterior = true;
      gate.portal = portal;
      gate.gate = true;
      gate.big = g.big;
      gate.hp = gate.hpMax = gate.baseHpMax = g.hp;
      this.entrances.push(gate);
      this[g.id] = gate;
    }
    // Code shared with the house knows the main entrance as the front door.
    this.frontDoor = this.southGate;

    // ---- the curtain wall: the outside of the bailey only ----
    const gaps = (side) => GATES.filter((g) => g.side === side).map((g) => [g.at - g.width / 2, g.at + g.width / 2]);
    this.wallRun('h', BAILEY.x, BAILEY.x + BAILEY.w, wallPos.north, gaps('north'));
    this.wallRun('h', BAILEY.x, BAILEY.x + BAILEY.w, wallPos.south, gaps('south'));
    this.wallRun('v', BAILEY.y, BAILEY.y + BAILEY.h, wallPos.west, gaps('west'));
    this.wallRun('v', BAILEY.y, BAILEY.y + BAILEY.h, wallPos.east, gaps('east'));

    // ---- towers: solid stone, so nobody walks through what you see ----
    const tower = (x, y, size, kind, extra = {}) => {
      const t = { x, y, size, kind, ...extra };
      this.towers.push(t);
      this.solids.push({ x: x - size / 2, y: y - size / 2, w: size, h: size, type: 'tower', solid: true, tower: t });
      return t;
    };
    for (const [x, y] of [
      [wallPos.west, wallPos.north], [wallPos.east, wallPos.north],
      [wallPos.west, wallPos.south], [wallPos.east, wallPos.south],
    ]) {
      // BUILD 15 (V6): the south-east corner is the one nearest the camera
      const low = x > 0 && y > 0;
      tower(x, y, CORNER_TOWER, 'corner', { low, rise: low ? TOWER_RISE.cornerLow : TOWER_RISE.corner });
    }
    for (const g of GATES) {
      if (!g.big) continue;
      const axis = g.side === 'north' || g.side === 'south' ? 'h' : 'v';
      const low = nearCamera(g.side);
      for (const s of [-1, 1]) {
        const along = g.at + s * (g.width / 2 + GATE_TOWER / 2);
        const x = axis === 'h' ? along : wallPos[g.side];
        const y = axis === 'h' ? wallPos[g.side] : along;
        tower(x, y, GATE_TOWER, 'gate', { gate: g.id, side: g.side, flank: s, low, rise: low ? TOWER_RISE.bastion : TOWER_RISE.gate });
      }
    }

    // ---- the garrison's night posts up on the wall (BUILD 10) ----
    // Two per gate: the tops of a big gate's two towers, or a plank platform
    // against the yard face of the wall either side of a postern (a guard's
    // chest clears the merlons). A guard walks to the foot of the ladder on
    // the yard side and climbs; from up there he shoots over the wall at
    // whatever comes for the gate (playtest 2026-10-17: the gate is shut, so
    // nobody shoots through it any more).
    this.wallPosts = [];
    const inwardOf = { north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, west: { x: 1, y: 0 }, east: { x: -1, y: 0 } };
    for (const g of GATES) {
      const axis = g.side === 'north' || g.side === 'south' ? 'h' : 'v';
      const inward = inwardOf[g.side];
      for (const s of [-1, 1]) {
        const along = g.at + s * (g.width / 2 + (g.big ? GATE_TOWER / 2 : POSTERN_POST));
        const into = g.big ? 0 : POSTERN_DECK_IN;
        const x = (axis === 'h' ? along : wallPos[g.side]) + inward.x * into;
        const y = (axis === 'h' ? wallPos[g.side] : along) + inward.y * into;
        const depth = (g.big ? GATE_TOWER / 2 : POSTERN_DECK / 2) + LADDER_FOOT;
        this.wallPosts.push(Object.freeze({
          gate: g.id, slot: s < 0 ? 0 : 1, kind: g.big ? 'tower' : 'wall', side: g.side,
          towerSize: g.big ? GATE_TOWER : 0, deck: g.big ? 0 : POSTERN_DECK,
          // BUILD 15: the top a guard stands on (a bastion on the near sides)
          rise: g.big ? (nearCamera(g.side) ? TOWER_RISE.bastion : TOWER_RISE.gate) : 0,
          x, y, foot: Object.freeze({ x: x + inward.x * depth, y: y + inward.y * depth }), inward,
        }));
      }
    }

    this.furnish();
    this.makeLights();
    this.makeSpawns();
    this.buildRing();
  }

  /**
   * The bailey's dressing (BUILD 12, layout B): each grass quarter is one
   * district, and its corner (the open ground between the plots and the
   * corner tower) carries that district's stock, so the trade reads from
   * across the bailey — targets and a weapon rack by the barracks (north-
   * west), stone and rocks by the gold mines (north-east), log piles by the
   * sawmills (south-west), the well and the stores by the armory (south-
   * east) — with a clump of trees in every corner and three single trees
   * framing the keep's plaza from behind, the way a Rise of Kingdoms city
   * frames its city hall. Everything is low (about the captain's height),
   * laid out with the plots (survival.js PLOT, checked by
   * tools/survival-map.mjs): never on a plot, a road, the plaza, a gate's
   * way in or a ballista's line of fire. KayKit models (`kit:<key>`,
   * buildings3d.js KIT_DECOR) that World3D stands on each footprint; `fit`
   * is how wide the model is drawn when it is wider than what blocks.
   */
  furnish() {
    const put = (cx, cy, w, h, type, o = {}) => this.addF(cx - w / 2, cy - h / 2, w, h, type, { room: this.findRoom(cx, cy), ...o });
    const kit = (key, x, y, w, h, o = {}) => put(x, y, w, h, `kit:${key}`, o);
    // north-west: the barracks' training ground
    kit('target', -700, -662, 46, 30, { rot: 0.25 });
    kit('target', -606, -676, 46, 30, { rot: -0.15 });
    kit('weaponrack', -796, -606, 52, 30, { rot: 0.5 });
    kit('bucketArrows', -742, -566, 30, 30);
    // north-east: the gold mines' stone and spoil
    kit('stone', 700, -648, 84, 70, { rot: 0.3 });
    kit('rockE', 806, -562, 60, 44, { rot: 1.1 });
    kit('rockC', 612, -700, 44, 44);
    kit('wheelbarrow', 770, -682, 50, 92, { rot: 2.2 });
    // south-west: the sawmills' log piles
    kit('lumber', -700, 652, 124, 60, { rot: 0.12 });
    kit('lumber', -572, 690, 124, 60, { rot: -0.1 });
    kit('wheelbarrow', -800, 584, 50, 92, { rot: 0.9 });
    // south-east: the well and the stores, by the armory
    put(640, 560, 96, 96, 'well');
    kit('crate', 532, 640, 44, 44, { rot: 0.3 });
    kit('barrel', 578, 676, 36, 36);
    kit('sack', 492, 604, 34, 40, { rot: 0.6 });
    // a clump of trees in every corner, inside the corner tower
    kit('treesA', -890, -655, 90, 90, { fit: 132, rot: 0.4 });
    kit('treesB', 890, -655, 90, 90, { fit: 132, rot: 2.1 });
    kit('treesB', -890, 655, 90, 90, { fit: 132, rot: -1.2 });
    kit('treesA', 890, 655, 90, 90, { fit: 132, rot: 3.3 });
    // single trees framing the plaza from behind and the sides (none in
    // front of the keep: the camera looks from the south-east)
    kit('treeA', -212, -212, 40, 40, { fit: 74 });
    kit('treeB', 212, -212, 40, 40, { fit: 80, rot: 1.3 });
    kit('treeB', -212, 212, 40, 40, { fit: 80, rot: 2.6 });
  }

  /** Lighting is the survival mode's (the keep's lamp); no house fixtures. */
  makeLights() {
    this.lights = [];
    this.fireplaceLight = null;
  }

  /** The house shrinks its oversized sprite furniture; the bailey is drawn to scale. */
  dressFurniture() {}

  /** Where the captain stands when a run starts: where the east road leaves the plaza (survival.js PLOT.home). */
  startPoint() {
    return { x: this.keepSpot.x + 240, y: this.keepSpot.y };
  }
}
