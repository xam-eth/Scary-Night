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
 * kecil"). 0.7 was not enough to change that on a phone (2026-10-17: "tidak
 * ada perubahan"), so it is now 0.5: 1300 x 950 px (~25 x 18 m), while the
 * actors stand x1.6 (SURVIVAL_ACTOR_SCALE) and the camera frames 1.3x closer
 * (SurvivalMode.frameMul) — the captain, a guard and a demon each fill about
 * a quarter of a sideways phone's height, and from the keep most of the
 * bailey is in one screen. The yards, roads and gate positions keep their
 * proportions; gate widths and props keep their size.
 */
export const FORT_SCALE = 0.5;
const S = (v) => Math.round(v * FORT_SCALE);
/**
 * The curtain wall is low, ~2 m (the house's walls are 2.6): with the actors
 * x1.6 a 2.6 m wall hid the horde at the north and side gates from the
 * camera — only heads showed over it, so the fight read as numbers popping
 * behind masonry. At 2 m the front ranks show from the chest up between the
 * merlons; the towers and the gatehouses stay tall.
 */
export const FORT_WALL_METRES = 2.0;
/** The courtyard inside the curtain wall: 1300 x 950 px at FORT_SCALE 0.5. */
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
const POSTERN_POST = 22;    // px from a postern's frame to the middle of its guard deck
const LADDER_FOOT = 18;     // px from the masonry's yard face to where a ladder stands

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

    // ---- the garrison's night posts up on the wall (BUILD 10) ----
    // Two per gate: the tops of a big gate's two towers, or a wooden deck on
    // the wall-walk either side of a postern. A guard walks to the foot of
    // the ladder on the yard side and climbs; from up there he shoots over
    // the merlons at whatever comes for the gate (playtest 2026-10-17: the
    // gate is shut, so nobody shoots through it any more).
    this.wallPosts = [];
    const inwardOf = { north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, west: { x: 1, y: 0 }, east: { x: -1, y: 0 } };
    for (const g of GATES) {
      const axis = g.side === 'north' || g.side === 'south' ? 'h' : 'v';
      const inward = inwardOf[g.side];
      for (const s of [-1, 1]) {
        const along = g.at + s * (g.width / 2 + (g.big ? GATE_TOWER / 2 : POSTERN_POST));
        const x = axis === 'h' ? along : wallPos[g.side];
        const y = axis === 'h' ? wallPos[g.side] : along;
        const depth = (g.big ? GATE_TOWER / 2 : WALL_T / 2) + LADDER_FOOT;
        this.wallPosts.push(Object.freeze({
          gate: g.id, slot: s < 0 ? 0 : 1, kind: g.big ? 'tower' : 'wall', side: g.side, towerSize: g.big ? GATE_TOWER : 0,
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
   * The bailey's life: stores along the curtain wall, a well, a market
   * table. Laid out with the build plots (survival.js PLOT, checked by
   * tools/survival-map.mjs): in rows against the wall between the plots, in
   * the same point symmetry through the keep, never on a plot, a gate's way
   * in or a ballista's line of fire (playtest 2026-10-17: "letak build
   * bangunan masih belum rapi" — barrels stood on the plots).
   */
  furnish() {
    const put = (cx, cy, w, h, type) => this.addF(cx - w / 2, cy - h / 2, w, h, type, { room: this.findRoom(cx, cy) });
    const barrel = (x, y) => put(x, y, 32, 32, 'barrel');
    const crates = (x, y) => put(x, y, 60, 50, 'crates');
    // s = 1: the south and west walls; s = -1: their twins on the north and
    // east walls (x, y -> -x, -y)
    for (const s of [1, -1]) {
      // beside the main gate's west tower / the north gate's east tower
      barrel(-215 * s, 425 * s); barrel(-250 * s, 425 * s); crates(-320 * s, 416 * s);
      // the far corner of the same wall, short of the corner tower
      barrel(455 * s, 425 * s); crates(520 * s, 416 * s);
      // the west wall between the postern and the gate tower / the east wall
      barrel(-600 * s, -215 * s);
      // the west wall below the gate tower / the east wall above it
      crates(-598 * s, 235 * s); barrel(-600 * s, 300 * s);
    }
    put(300, -250, 96, 96, 'well');           // the well (KayKit), in the northeast yard
    put(-310, 245, 150, 56, 'longTable');     // the market table, its twin
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
