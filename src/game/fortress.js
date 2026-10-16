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
 * kecil"). 0.7 makes it 1820 x 1330 px (~35 x 26 m): the yards, roads and
 * gate positions keep their proportions, gate widths and props keep their
 * size, and the camera frames closer (SurvivalMode.frameMul).
 */
export const FORT_SCALE = 0.7;
const S = (v) => Math.round(v * FORT_SCALE);
/** The courtyard inside the curtain wall: 1820 x 1330 px at FORT_SCALE 0.7. */
export const BAILEY = Object.freeze({ x: S(-1300), y: S(-950), w: S(2600), h: S(1900) });
const COLS = Object.freeze([-1300, -450, 450, 1300].map(S));
const ROWS = Object.freeze([-950, -320, 320, 950].map(S));

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

export class Fortress extends Mansion {
  /*
   * Note: no class fields here. Mansion's constructor calls build() before
   * a subclass's fields would be initialised, and they would then overwrite
   * what build() made.
   */
  build() {
    this.isFortress = true;
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
    ]) tower(x, y, CORNER_TOWER, 'corner');
    for (const g of GATES) {
      if (!g.big) continue;
      const axis = g.side === 'north' || g.side === 'south' ? 'h' : 'v';
      for (const s of [-1, 1]) {
        const along = g.at + s * (g.width / 2 + GATE_TOWER / 2);
        const x = axis === 'h' ? along : wallPos[g.side];
        const y = axis === 'h' ? wallPos[g.side] : along;
        tower(x, y, GATE_TOWER, 'gate', { gate: g.id, side: g.side, flank: s });
      }
    }

    this.furnish();
    this.makeLights();
    this.makeSpawns();
    this.buildRing();
  }

  /**
   * The bailey's life: stores by the gates, a well, a market table. Laid out
   * for the compact bailey (FORT_SCALE 0.7; the inner face of the wall is at
   * x = +-910, y = +-665): clusters keep their own spacing, so nothing
   * overlaps, and every prop stays clear of the build circles and the roads.
   */
  furnish() {
    const F = (cx, cy, w, h, type, o = {}) => this.addF(cx - w / 2, cy - h / 2, w, h, type, { room: this.findRoom(cx, cy), ...o });
    const barrel = (x, y) => F(x, y, 32, 32, 'barrel');
    const crates = (x, y) => F(x, y, 60, 50, 'crates');
    // gate road: supplies stacked either side of the main gate
    barrel(-200, 626); barrel(-238, 632); crates(-306, 622);
    barrel(202, 626); crates(306, 622);
    // north road
    crates(-300, -622); barrel(200, -626); barrel(238, -620);
    // west and east roads, against the curtain wall
    crates(-872, -160); barrel(-876, 150); barrel(-874, 188);
    crates(872, 160); barrel(876, -150); barrel(874, -188);
    // the yards
    F(756, -532, 96, 96, 'fountain');                      // the well
    barrel(866, -392);
    crates(-560, -626); crates(-490, -630); barrel(-868, -300);
    F(-640, 625, 150, 56, 'longTable');                    // market table
    crates(-866, 392); barrel(-866, 440);
    crates(830, 606); barrel(536, 640); crates(632, 628);
  }

  /** Lighting is the survival mode's (the keep's lamp); no house fixtures. */
  makeLights() {
    this.lights = [];
    this.fireplaceLight = null;
  }

  /** The house shrinks its oversized sprite furniture; the bailey is drawn to scale. */
  dressFurniture() {}

  /** Where the captain stands when a run starts: beside the keep. */
  startPoint() {
    return { x: this.keepSpot.x + 200, y: this.keepSpot.y + 40 };
  }
}
