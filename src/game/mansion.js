/* LAST NIGHT — the mansion
 *
 * One hand-authored gothic mansion: six rooms, five windows, five doors.
 * Everything is built in code: geometry, collision, baked floor rendering,
 * light sources, spawn points and the room graph used by enemy navigation.
 *
 * Floor plan (world pixels):
 *
 *      +----------------+   +-----------------+   +···············+
 *      |  DINING ROOM   |   |     LIBRARY     |===|  CONSERVATORY |   glass
 *      |  80,60 780x600 |   | 940,60 780x600  |   |  moonlit, 2   |   roof
 *      +----==+---------+   +--------+==------+   +-------==------+   reads
 *           ||  passage             ||  passage                      as
 *      +----++---------------------++----------+                      green-
 *      |              MAIN HALL                 |                     house
 *      |            80,760  1120x740            |   +---------------+
 *      +----------------------+-------==-------+   |    CHAPEL     |
 *                             |    BASEMENT    |===| altar refuge  |
 *                             | 1280,820 500x680  |  +==== door ====+
 *                             +-----------------+   +---------------+
 *
 * The Conservatory hangs off the library's east wall (shared masonry — the
 * gothic window looks *into* it now, which is its own small horror). The
 * Chapel is entered from the basement: worship and hunger one floor apart.
 */

import { clamp, rand, randInt, chance, hash2, hashRange, Rng, TAU } from '../core/util.js';
import { PAL } from '../core/render.js';
import { DOOR } from '../core/config.js';

export const ROOM = {
  DINING: 'dining',
  LIBRARY: 'library',
  HALL: 'hall',
  BASEMENT: 'basement',
  CONSERV: 'conservatory',
  CHAPEL: 'chapel',
  KITCHEN: 'kitchen',
  STUDY: 'study',
  OUTSIDE: 'outside',
};

const WALL_T = 26;

export class Mansion {
  constructor() {
    this.bounds = { x: -540, y: -520, w: 3140, h: 2480 };
    // Camera must be able to follow into the new wings, not stop at the old hall.
    this.camBounds = { x: -460, y: -420, w: 2860, h: 2020 };
    this.solids = [];          // {x,y,w,h,type,solid}
    this.furniture = [];
    this.props = [];
    this.lights = [];
    this.entrances = [];
    this.spawns = [];
    this.grid = new Map();
    this.cell = 90;
    this.litSurfaces = [];
    this.bloodMoon = 0;
    this.blackout = 0;
    this.build();
    this.bake();
    this.buildGrid();
    // rasterise walkability only after the collision grid exists
    this.buildNav();
  }

  /* ================= geometry ================= */

  rooms = {};

  build() {
    const S = this.solids;
    const addWall = (x, y, w, h, type = 'wall') => {
      const r = { x, y, w, h, type, solid: true };
      S.push(r); return r;
    };

    // ---- room rects (interior play space) ----
    const DINING = this.rooms.dining = { id: ROOM.DINING, name: 'DINING ROOM', x: 80, y: 60, w: 780, h: 600, floor: 'wood', dark: 0.72 };
    const LIBRARY = this.rooms.library = { id: ROOM.LIBRARY, name: 'LIBRARY', x: 940, y: 60, w: 780, h: 600, floor: 'wood', dark: 0.78 };
    const HALL = this.rooms.hall = { id: ROOM.HALL, name: 'MAIN HALL', x: 80, y: 760, w: 1120, h: 740, floor: 'marble', dark: 0.62 };
    const BASEMENT = this.rooms.basement = { id: ROOM.BASEMENT, name: 'BASEMENT', x: 1280, y: 820, w: 500, h: 680, floor: 'stone', dark: 1.35 };
    // v1.0 east wing: the Conservatory (glass roof — moonlight you can't govern)
    // and the Chapel (an altar light the house itself seems to respect).
    const CONSERV = this.rooms.conserv = { id: ROOM.CONSERV, name: 'CONSERVATORY', x: 1746, y: 60, w: 554, h: 580, floor: 'glass', dark: 0.42 };
    const CHAPEL = this.rooms.chapel = { id: ROOM.CHAPEL, name: 'CHAPEL', x: 1793, y: 806, w: 507, h: 694, floor: 'tile', dark: 0.68 };
    // West scullery: a weak door and a larder. You cannot watch it from the hall.
    const KITCHEN = this.rooms.kitchen = { id: ROOM.KITCHEN, name: 'KITCHEN', x: -300, y: 90, w: 354, h: 500, floor: 'stone', dark: 0.7 };
    // North of the library: a lamp that can hold them, and a window that cannot.
    const STUDY = this.rooms.study = { id: ROOM.STUDY, name: 'STUDY', x: 980, y: -280, w: 720, h: 320, floor: 'wood', dark: 0.66 };
    this.roomList = [DINING, LIBRARY, HALL, BASEMENT, CONSERV, CHAPEL, KITCHEN, STUDY];

    /* ---- outer + inner walls ----
     * gaps = [[start,end,name]] along the wall's axis, turned into entrances below.
     */
    const H = (x1, x2, y, gaps = []) => this.wallRun('h', x1, x2, y, gaps);
    const V = (y1, y2, x, gaps = []) => this.wallRun('v', y1, y2, x, gaps);

    // Dining room shell
    H(54, 886, 40, [[340, 470, 'diningWindow'], [640, 760, 'diningDoor']]);   // north
    V(14, 666, 54, [[250, 390, null]]);                                        // west — passage into the kitchen
    H(54, 886, 640, [[300, 462, null]]);                                       // south (passage to hall)
    V(40, 666, 860, []);                                                       // east (party wall)

    // Library shell
    H(914, 1746, 40, [[1510, 1650, null]]);                                    // north — passage into the study, east of the shelves
    V(14, 666, 914, []);                                                       // west (party wall)
    H(914, 1746, 640, [[1024, 1164, null]]);                                   // south (passage to hall)
    V(40, 666, 1720, [[262, 424, null], [500, 600, null]]);                   // east — the gothic window now opens INSIDE, into the glass house

    // Conservatory shell (v1.0) — glass north + glass east, moonlit and exposed
    H(1733, 2320, 40, [[1960, 2120, 'glassNorth']]);                          // north (glass roof edge)
    H(1733, 2320, 640, []);                                                    // south
    V(14, 666, 2320, [[240, 420, 'glassEast']]);                              // east

    // Chapel shell (v1.0) — reached through the basement; one door to the night.
    // Its north wall is the basement's north wall, extended; its west wall is
    // the basement's east wall, with a passage cut into it below.
    H(1780, 2320, 1500, [[1960, 2086, 'chapelDoor']]);                        // south (new exterior door)
    V(794, 1526, 2320, [[980, 1140, 'chapelWindow']]);                        // east

    // Main hall shell
    V(734, 1526, 54, [[1080, 1186, 'sideDoor']]);                              // west
    H(54, 1246, 734, [[300, 462, null], [1024, 1164, null]]);                  // north
    H(54, 1246, 1500, [[560, 686, 'frontDoor'], [820, 966, 'hallWindow']]);    // south
    V(734, 1526, 1200, [[1058, 1202, null]]);                                  // east

    // Basement shell (north wall now runs all the way over the chapel too)
    V(794, 1526, 1254, [[1058, 1202, null]]);                                  // west
    H(1246, 2320, 794, []);                                                    // north
    H(1246, 1806, 1500, [[1400, 1516, 'cellarDoor']]);                         // south
    V(794, 1526, 1780, [[1058, 1180, null]]);                                  // east → chapel passage

    // Kitchen shell — west of the dining room. The west door is the sacrifice door.
    H(-326, 67, 64, [[-160, -40, 'kitchenWindow']]);
    V(38, 616, -326, [[240, 360, 'kitchenDoor']]);
    H(-326, 67, 616, []);
    // Study shell — north of the library. One glass window, no second exit.
    H(954, 1726, -306, [[1240, 1380, 'studyWindow']]);
    V(-332, 66, 954, []);
    V(-332, 66, 1726, []);

    // passage side walls (make passages read as corridors)
    H(280, 300, 640, []); H(462, 482, 640, []);   // dining passage shoulders
    V(640, 760, 280, []); V(640, 760, 462, []);
    H(1004, 1024, 640, []); H(1164, 1184, 640, []);
    V(640, 760, 1004, []); V(640, 760, 1164, []);
    // basement stair passage (the two side walls of the stairwell opening)
    H(1180, 1300, 1038, []); H(1180, 1300, 1222, []);

    // invisible threshold: the vampire cannot cross the outer shell, only the
    // interior is walkable. (Lore: you cannot cross the threshold of the house.)
    this.threshold = [
      { x: 54, y: 30, w: 2286, h: 12, solid: false },
      { x: 54, y: 1512, w: 2286, h: 12, solid: false },
      { x: 44, y: 30, w: 12, h: 1494, solid: false },
      { x: 2300, y: 30, w: 12, h: 1494, solid: false },
    ];

    // ---- entrances (doors & windows) ----
    const E = (o) => { this.entrances.push(o); return o; };
    this.frontDoor = E(this.makeDoor('frontDoor', 'FRONT DOOR', 560, 686, 1500, 'h', 'south', ROOM.HALL));
    this.sideDoor = E(this.makeDoor('sideDoor', 'SIDE DOOR', 1080, 1186, 54, 'v', 'west', ROOM.HALL));
    this.diningDoor = E(this.makeDoor('diningDoor', 'SERVANT DOOR', 640, 760, 40, 'h', 'north', ROOM.DINING));
    this.cellarDoor = E(this.makeDoor('cellarDoor', 'CELLAR DOOR', 1400, 1516, 1500, 'h', 'south', ROOM.BASEMENT));
    this.diningWindow = E(this.makeWindow('diningWindow', 'BAY WINDOW', 340, 470, 40, 'h', 'north', ROOM.DINING));
    this.hallWindow = E(this.makeWindow('hallWindow', 'TALL WINDOW', 820, 966, 1500, 'h', 'south', ROOM.HALL));
    // v1.0 — the east wing's own openings. Glass is weaker than oak but it
    // shows you the dark coming, which is worth something at 3 a.m.
    this.glassNorth = E(this.makeWindow('glassNorth', 'SKYLIGHT ROW', 1960, 2120, 40, 'h', 'north', ROOM.CONSERV));
    this.glassEast = E(this.makeWindow('glassEast', 'PANE WALL', 240, 420, 2320, 'v', 'east', ROOM.CONSERV));
    this.chapelDoor = E(this.makeDoor('chapelDoor', 'CHAPEL DOOR', 1960, 2086, 1500, 'h', 'south', ROOM.CHAPEL));
    this.chapelWindow = E(this.makeWindow('chapelWindow', 'ROSE WINDOW', 980, 1140, 2320, 'v', 'east', ROOM.CHAPEL));
    this.kitchenDoor = E(this.makeDoor('kitchenDoor', 'KITCHEN DOOR', 240, 360, -326, 'v', 'west', ROOM.KITCHEN));
    this.kitchenDoor.hp = this.kitchenDoor.hpMax = this.kitchenDoor.baseHpMax = 78;
    this.kitchenWindow = E(this.makeWindow('kitchenWindow', 'SCULLERY WINDOW', -160, -40, 64, 'h', 'north', ROOM.KITCHEN));
    this.studyWindow = E(this.makeWindow('studyWindow', 'STUDY WINDOW', 1240, 1380, -306, 'h', 'north', ROOM.STUDY));
    // the old gothic window is now an interior arch between library and glass house
    this.libraryArch = { x: 1720, y: 343, w: WALL_T, h: 162 };

    // room graph: which rooms connect through interior passages
    this.passages = [
      { a: ROOM.DINING, b: ROOM.HALL, x: 381, y: 700, r: 62 },
      { a: ROOM.LIBRARY, b: ROOM.HALL, x: 1094, y: 700, r: 62 },
      { a: ROOM.BASEMENT, b: ROOM.HALL, x: 1240, y: 1130, r: 58 },
      { a: ROOM.LIBRARY, b: ROOM.CONSERV, x: 1733, y: 550, r: 62 },
      { a: ROOM.BASEMENT, b: ROOM.CHAPEL, x: 1800, y: 1119, r: 62 },
      { a: ROOM.KITCHEN, b: ROOM.DINING, x: 54, y: 320, r: 58 },
      { a: ROOM.STUDY, b: ROOM.LIBRARY, x: 1580, y: 40, r: 58 },
    ];

    this.furnish();
    this.makeLights();
    this.makeSpawns();
    this.buildRing();
  }

  /* =================================================================
   * NAVIGATION GRID
   * -----------------------------------------------------------------
   * Rooms have interior walls (the library corridors, the basement
   * stairwell), so steering straight at a target wedges enemies against
   * masonry forever. A coarse walkability grid plus BFS gives them real
   * routes without any authoring: same trick for inside and outside.
   * ================================================================= */
  buildNav() {
    this.navCell = 40;
    this.navX0 = -500;
    this.navY0 = -480;
    this.navX1 = 2520;
    this.navY1 = 1880;
    this.navW = Math.ceil((this.navX1 - this.navX0) / this.navCell);
    this.navH = Math.ceil((this.navY1 - this.navY0) / this.navCell);
    this.nav = new Uint8Array(this.navW * this.navH);
    for (let gy = 0; gy < this.navH; gy++) {
      for (let gx = 0; gx < this.navW; gx++) {
        const cx = this.navX0 + (gx + 0.5) * this.navCell;
        const cy = this.navY0 + (gy + 0.5) * this.navCell;
        this.nav[gy * this.navW + gx] = this.navBlocked(cx, cy) ? 1 : 0;
      }
    }
    this._navQueue = new Int32Array(this.navW * this.navH);
    this._navPrev = new Int32Array(this.navW * this.navH);
  }

  /** Can a body of enemy size stand here? */
  navBlocked(cx, cy) {
    const r = 13;
    const probes = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (const [ox, oy] of probes) {
      if (this.solidAt(cx + ox, cy + oy)) return true;
    }
    // a closed door or intact window is not a route
    for (const e of this.entrances) {
      if (e.kind === 'door' && (e.open || e.broken)) continue;
      if (e.kind === 'window' && e.broken) continue;
      if (Math.abs(cx - e.x) < e.w / 2 + r && Math.abs(cy - e.y) < e.h / 2 + r) return true;
    }
    return false;
  }

  /** Walkable at cell level, with a small allowance so we never start off-grid. */
  navFree(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= this.navW || gy >= this.navH) return false;
    return this.nav[gy * this.navW + gx] === 0;
  }

  navCellOf(x, y) {
    const gx = clamp(Math.floor((x - this.navX0) / this.navCell), 0, this.navW - 1);
    const gy = clamp(Math.floor((y - this.navY0) / this.navCell), 0, this.navH - 1);
    return { gx, gy };
  }

  /** Nearest walkable cell to a point (spiral search). */
  navNearest(x, y, maxR = 4) {
    const { gx, gy } = this.navCellOf(x, y);
    if (this.navFree(gx, gy)) return { gx, gy };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (this.navFree(gx + dx, gy + dy)) return { gx: gx + dx, gy: gy + dy };
        }
      }
    }
    return null;
  }

  /**
   * Breadth-first route between two world points. Returns waypoints (world
   * space) or null when there is genuinely no way through.
   */
  navPath(fromX, fromY, toX, toY) {
    if (!this.nav) return null;
    const a = this.navNearest(fromX, fromY);
    const b = this.navNearest(toX, toY);
    if (!a || !b) return null;
    const w = this.navW;
    const start = a.gy * w + a.gx;
    const goal = b.gy * w + b.gx;
    if (start === goal) return [{ x: toX, y: toY }];
    const prev = this._navPrev;
    const queue = this._navQueue;
    prev.fill(-1);
    let head = 0, tail = 0;
    queue[tail++] = goal;
    prev[goal] = goal;
    const dirs = [1, -1, w, -w];
    while (head < tail) {
      const cur = queue[head++];
      if (cur === start) break;
      const cx = cur % w, cy = (cur - (cur % w)) / w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= this.navW || ny >= this.navH) continue;
        const ni = ny * w + nx;
        if (prev[ni] !== -1 || this.nav[ni] !== 0) continue;
        prev[ni] = cur;
        queue[tail++] = ni;
        if (tail >= queue.length) break;
      }
    }
    if (prev[start] === -1) return null;
    // follow the parent chain from the start cell to the goal cell: pts runs
    // start -> goal, so it can be walked in order
    const pts = [];
    let cur = start;
    let guard = 0;
    while (cur !== goal && guard++ < 4000) {
      cur = prev[cur];
      if (cur === -1) return null;
      const gx = cur % w, gy = (cur - (cur % w)) / w;
      pts.push({ x: this.navX0 + (gx + 0.5) * this.navCell, y: this.navY0 + (gy + 0.5) * this.navCell });
    }
    if (!pts.length) return [{ x: toX, y: toY }];
    const out = [];
    for (let i = 1; i < pts.length; i += 2) out.push(pts[i]);
    out.push({ x: toX, y: toY });
    return out;
  }

  /** A walking loop around the outside of the mansion. */
  buildRing() {
    const x0 = -480, y0 = -460, x1 = 2480, y1 = 1780;
    const step = 250;
    const pts = [];
    for (let x = x0; x < x1; x += step) pts.push({ x, y: y0 });
    for (let y = y0; y < y1; y += step) pts.push({ x: x1, y });
    for (let x = x1; x > x0; x -= step) pts.push({ x, y: y1 });
    for (let y = y1; y > y0; y -= step) pts.push({ x: x0, y });
    this.ring = pts;
  }

  /** Waypoints from one outside point to another, going around the house. */
  routeOutside(fromX, fromY, toX, toY) {
    if (!this.ring || !this.ring.length) return [{ x: toX, y: toY }];
    const near = (x, y) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < this.ring.length; i++) {
        const d = (this.ring[i].x - x) ** 2 + (this.ring[i].y - y) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    };
    const n = this.ring.length;
    const i0 = near(fromX, fromY), i1 = near(toX, toY);
    // if we are already close to the destination, just go there
    if (Math.hypot(fromX - toX, fromY - toY) < 320 && this.hasLOS(fromX, fromY, toX, toY)) return [{ x: toX, y: toY }];
    const cw = (i1 - i0 + n) % n, ccw = (i0 - i1 + n) % n;
    const dir = cw <= ccw ? 1 : -1;
    const steps = Math.min(cw <= ccw ? cw : ccw, 14);
    const out = [];
    for (let k = 1; k <= steps; k++) out.push(this.ring[(i0 + dir * k + n * 2) % n]);
    out.push({ x: toX, y: toY });
    return out;
  }

  wallRun(axis, a1, a2, pos, gaps) {
    const parts = [];
    let cur = a1;
    const sorted = (gaps || []).slice().sort((p, q) => p[0] - q[0]);
    for (const g of sorted) {
      if (g[0] > cur) parts.push([cur, g[0]]);
      cur = Math.max(cur, g[1]);
    }
    if (cur < a2) parts.push([cur, a2]);
    for (const [s, e] of parts) {
      const r = axis === 'h'
        ? { x: s, y: pos - WALL_T / 2, w: e - s, h: WALL_T, type: 'wall', solid: true }
        : { x: pos - WALL_T / 2, y: s, w: WALL_T, h: e - s, type: 'wall', solid: true };
      this.solids.push(r);
    }
  }

  makeDoor(id, name, a1, a2, pos, axis, facing, roomId) {
    const cx = axis === 'h' ? (a1 + a2) / 2 : pos;
    const cy = axis === 'h' ? pos : (a1 + a2) / 2;
    const len = a2 - a1;
    const out = 78, inn = 56;
    return {
      kind: 'door', id, name, axis, facing, room: roomId,
      x: cx, y: cy, w: axis === 'h' ? len : WALL_T, h: axis === 'h' ? WALL_T : len,
      hp: DOOR.hp, hpMax: DOOR.hp, baseHpMax: DOOR.hp,
      open: false, broken: false, barricade: 0,
      outside: axis === 'h' ? { x: cx, y: cy + (facing === 'south' ? out : -out) } : { x: cx + (facing === 'east' ? out : -out), y: cy },
      inside: axis === 'h' ? { x: cx, y: cy + (facing === 'south' ? -inn : inn) } : { x: cx + (facing === 'east' ? -inn : inn), y: cy },
      attackers: 0, knock: null, flash: 0, hint: 0,
    };
  }

  makeWindow(id, name, a1, a2, pos, axis, facing, roomId) {
    const cx = axis === 'h' ? (a1 + a2) / 2 : pos;
    const cy = axis === 'h' ? pos : (a1 + a2) / 2;
    const len = a2 - a1;
    const out = 78, inn = 56;
    return {
      kind: 'window', id, name, axis, facing, room: roomId,
      x: cx, y: cy, w: axis === 'h' ? len : WALL_T, h: axis === 'h' ? WALL_T : len,
      hp: 62, hpMax: 62, baseHpMax: 62,
      open: false, broken: false, barricade: 0, glass: true,
      outside: axis === 'h' ? { x: cx, y: cy + (facing === 'south' ? out : -out) } : { x: cx + (facing === 'east' ? out : -out), y: cy },
      inside: axis === 'h' ? { x: cx, y: cy + (facing === 'south' ? -inn : inn) } : { x: cx + (facing === 'east' ? -inn : inn), y: cy },
      attackers: 0, knock: null, flash: 0, hint: 0,
    };
  }

  /* ================= furniture ================= */

  addF(x, y, w, h, type, o = {}) {
    const f = { x, y, w, h, type, solid: o.solid !== false, room: o.room, rot: o.rot || 0, seed: randInt(0, 9999), ...o };
    this.furniture.push(f);
    if (f.solid) this.solids.push({ x, y, w, h, type: 'furniture', solid: true, f });
    return f;
  }
  addP(type, x, y, o = {}) {
    const p = { type, x, y, seed: randInt(0, 9999), ...o };
    this.props.push(p); return p;
  }

  furnish() {
    const R = this.rooms;
    /* ---------- MAIN HALL ---------- */
    // grand staircase (north-west corner), two flights
    this.addF(96, 772, 250, 210, 'staircase', { room: R.hall.id, solid: true });
    this.addF(96, 772, 250, 34, 'stairRail', { room: R.hall.id, solid: false });
    this.addP('carpet', 620, 1110, { w: 300, h: 420, color: 'crimson', seed: 11, room: R.hall.id });
    this.addF(760, 800, 96, 96, 'sofa', { room: R.hall.id, rot: 0 });
    this.addF(880, 800, 96, 96, 'sofa', { room: R.hall.id, rot: 0 });
    this.addF(1000, 1040, 170, 60, 'sideTable', { room: R.hall.id });
    this.addF(200, 1180, 60, 170, 'sideTable', { room: R.hall.id });
    this.addF(300, 1330, 210, 66, 'cabinet', { room: R.hall.id });
    this.addF(1000, 1330, 120, 120, 'armchair', { room: R.hall.id });
    this.addF(1090, 640 + 120, 0, 0, 'none', { solid: false });
    // portraits + decor
    this.addP('portrait', 500, 745, { room: R.hall.id, big: true });
    this.addP('portrait', 700, 745, { room: R.hall.id });
    this.addP('portrait', 1080, 745, { room: R.hall.id });
    this.addP('portrait', 66, 940, { room: R.hall.id, vertical: true });
    this.addP('candelabra', 620, 900, { room: R.hall.id, light: true });
    this.addP('candelabra', 620, 1320, { room: R.hall.id, light: true });
    this.addP('clock', 1160, 880, { room: R.hall.id });
    this.addP('cobweb', 100, 770, { room: R.hall.id });
    this.addP('cobweb', 1180, 1480, { room: R.hall.id });

    /* ---------- DINING ROOM ---------- */
    this.addF(180, 250, 560, 150, 'longTable', { room: R.dining.id });
    for (let i = 0; i < 8; i++) {
      const left = i < 4;
      const idx = i % 4;
      this.addF(210 + idx * 140, left ? 190 : 410, 54, 54, 'chair', { room: R.dining.id, rot: left ? 0 : Math.PI });
    }
    this.addF(640, 60 + 40, 150, 60, 'cabinet', { room: R.dining.id });
    this.addF(100, 90, 120, 54, 'cabinet', { room: R.dining.id });
    this.addF(700, 480, 120, 120, 'sideTable', { room: R.dining.id });
    this.addP('carpet', 460, 330, { w: 620, h: 420, color: 'purple', seed: 12, room: R.dining.id });
    for (let i = 0; i < 5; i++) this.addP('candleStand', 240 + i * 118, 325, { room: R.dining.id, light: i % 2 === 0 });
    this.addP('candelabra', 460, 325, { room: R.dining.id, light: true, onTable: true });
    this.addP('portrait', 300, 66, { room: R.dining.id });
    this.addP('portrait', 660, 66, { room: R.dining.id });
    this.addP('cobweb', 866, 70, { room: R.dining.id });

    /* ---------- LIBRARY ---------- */
    // bookshelves create lanes. The south pair is short so the study door
    // can cross to the hall passage instead of dead-ending behind the desk.
    for (let i = 0; i < 4; i++) this.addF(980 + i * 150, 80, 60, 230, 'shelf', { room: R.library.id });
    this.addF(980, 420, 60, 200, 'shelf', { room: R.library.id });
    this.addF(1130, 560, 60, 70, 'shelf', { room: R.library.id });
    this.addF(1280, 560, 60, 70, 'shelf', { room: R.library.id });
    this.addF(1668, 120, 48, 160, 'shelf', { room: R.library.id });
    this.addF(1000, 300, 420, 76, 'desk', { room: R.library.id });
    this.addF(1320, 470, 90, 80, 'armchair', { room: R.library.id });
    this.addF(1640, 430, 70, 150, 'cabinet', { room: R.library.id });
    this.addP('fireplace', 1120, 646, { room: R.library.id, w: 220, h: 70 });
    this.addP('carpet', 1200, 480, { w: 420, h: 300, color: 'dark', seed: 13, room: R.library.id });
    this.addP('deskLamp', 1420, 340, { room: R.library.id, light: true });
    this.addP('candleStand', 1660, 300, { room: R.library.id, light: true });
    this.addP('books', 1230, 330, { room: R.library.id });
    this.addP('portrait', 1250, 66, { room: R.library.id });
    this.addP('cobweb', 1700, 70, { room: R.library.id });

    /* ---------- BASEMENT ---------- */
    for (let i = 0; i < 3; i++) this.addF(1320 + i * 150, 900, 90, 90, 'crates', { room: R.basement.id });
    for (let i = 0; i < 2; i++) this.addF(1320, 1100 + i * 150, 200, 60, 'wineRack', { room: R.basement.id });
    this.addF(1600, 900, 90, 260, 'wineRack', { room: R.basement.id, vertical: true });
    this.addF(1560, 1280, 160, 90, 'crates', { room: R.basement.id });
    this.addF(1330, 1330, 70, 70, 'barrel', { room: R.basement.id });
    this.addF(1440, 1390, 70, 70, 'barrel', { room: R.basement.id });
    this.addP('basin', 1680, 1440, { room: R.basement.id, w: 120, h: 120 });
    this.addP('candleStand', 1300, 840, { room: R.basement.id, light: true, dim: true });
    this.addP('cobweb', 1290, 830, { room: R.basement.id });
    this.addP('cobweb', 1760, 1470, { room: R.basement.id });
    this.addP('bones', 1500, 1000, { room: R.basement.id });
    this.addP('bones', 1620, 1200, { room: R.basement.id });

    /* ---------- CONSERVATORY (v1.0) ----------
     * Greenhouse off the library. Planters make lanes, the fountain is the
     * only quiet center, and the glass roof means the moon is a fifth door. */
    for (let i = 0; i < 4; i++) {
      this.addF(1790 + i * 118, 120, 72, 72, 'planter', { room: R.conserv.id });
      this.addF(1790 + i * 118, 500, 72, 72, 'planter', { room: R.conserv.id });
    }
    this.addF(1990, 290, 130, 130, 'fountain', { room: R.conserv.id });
    this.addF(2190, 150, 60, 160, 'pottingBench', { room: R.conserv.id });
    this.addF(2190, 400, 60, 160, 'pottingBench', { room: R.conserv.id });
    this.addP('mossPatch', 1820, 300, { room: R.conserv.id });
    this.addP('mossPatch', 2150, 560, { room: R.conserv.id });
    this.addP('urn', 1760, 80, { room: R.conserv.id });
    this.addP('urn', 2280, 80, { room: R.conserv.id });
    this.addP('candleStand', 1900, 430, { room: R.conserv.id, light: true, dim: true });
    this.addP('candleStand', 2140, 260, { room: R.conserv.id, light: true, dim: true });
    this.addP('hangingVine', 1840, 70, { room: R.conserv.id });
    this.addP('hangingVine', 2060, 70, { room: R.conserv.id });
    this.addP('hangingVine', 2260, 70, { room: R.conserv.id });
    this.addP('cobweb', 1750, 636, { room: R.conserv.id });

    /* ---------- CHAPEL (v1.0) ----------
     * Pews in two banks facing the altar; the altar light is a refuge — not
     * safety, just fewer seconds between heartbeats (enemies slow inside it). */
    for (let i = 0; i < 3; i++) {
      this.addF(1846, 1020 + i * 96, 170, 40, 'pew', { room: R.chapel.id });
      this.addF(2080, 1020 + i * 96, 170, 40, 'pew', { room: R.chapel.id });
    }
    this.addF(1950, 846, 200, 66, 'altar', { room: R.chapel.id });
    this.addF(2000, 1420, 110, 64, 'font', { room: R.chapel.id, solid: false });
    this.addP('stainedGlass', 2046, 806, { room: R.chapel.id, w: 210, h: 74 });
    this.addP('candleStand', 1930, 930, { room: R.chapel.id, light: true });
    this.addP('candleStand', 2160, 930, { room: R.chapel.id, light: true });
    this.addP('carpet', 2046, 1220, { w: 170, h: 520, color: 'crimson', seed: 17, room: R.chapel.id });
    this.addP('urn', 1820, 860, { room: R.chapel.id });
    this.addP('bones', 2250, 1420, { room: R.chapel.id });
    this.addP('cobweb', 2290, 830, { room: R.chapel.id });

    /* ---------- KITCHEN ----------
     * Counters make a lane. The larder is the refill. The west door is thin
     * on purpose: boarding it is a choice, not a default. */
    this.addF(-250, 140, 160, 54, 'cabinet', { room: R.kitchen.id });
    this.addF(-80, 140, 110, 54, 'cabinet', { room: R.kitchen.id });
    this.addF(-260, 430, 70, 70, 'barrel', { room: R.kitchen.id });
    this.addF(-160, 470, 70, 70, 'barrel', { room: R.kitchen.id });
    this.addF(-40, 400, 70, 140, 'sideTable', { room: R.kitchen.id });
    this.addP('larder', -150, 300, { room: R.kitchen.id, w: 86, h: 54 });
    this.addP('candleStand', -220, 200, { room: R.kitchen.id, light: true });
    this.addP('candleStand', -60, 480, { room: R.kitchen.id, light: true, dim: true });
    this.addP('cobweb', -290, 110, { room: R.kitchen.id });

    /* ---------- STUDY ----------
     * One desk, one lamp. Lighting the ward slows whatever is in the circle.
     * The north window is the price of using it. */
    this.addF(1040, -220, 200, 70, 'desk', { room: R.study.id });
    this.addF(1500, -230, 50, 180, 'shelf', { room: R.study.id });
    this.addF(1120, -80, 90, 90, 'armchair', { room: R.study.id });
    this.addP('ward', 1320, -120, { room: R.study.id });
    this.addP('deskLamp', 1180, -180, { room: R.study.id, light: true });
    this.addP('candleStand', 1560, -80, { room: R.study.id, light: true, dim: true });
    this.addP('books', 1080, -190, { room: R.study.id });
    this.addP('portrait', 1400, -292, { room: R.study.id });
    this.studyWard = { x: 1320, y: -120, r: 150, until: 0, readyAt: 0 };
  }

  makeLights() {
    const L = (o) => this.lights.push({ on: true, flicker: 1, seed: rand(0, 100), ...o });
    // hall chandelier — the room's heart, and the first thing that dies in a blackout
    L({ id: 'chandelier', x: 620, y: 1000, r: 340, i: 0.95, color: [255, 186, 120], flick: 0.1, room: ROOM.HALL, type: 'chandelier' });
    for (const p of this.props) {
      if (p.type === 'candelabra' && p.light) L({ x: p.x, y: p.y, r: 175, i: 0.72, color: [255, 175, 110], flick: 0.3, room: p.room, type: 'candle' });
      if (p.type === 'candleStand' && p.light) L({ x: p.x, y: p.y, r: 135, i: p.dim ? 0.34 : 0.6, color: [255, 170, 105], flick: 0.35, room: p.room, type: 'candle' });
      if (p.type === 'deskLamp' && p.light) L({ x: p.x, y: p.y, r: 155, i: 0.55, color: [255, 190, 130], flick: 0.12, room: p.room, type: 'lamp' });
    }
    // fireplace
    L({ id: 'fireplace', x: 1120, y: 636, r: 300, i: 0.95, color: [255, 145, 60], flick: 0.5, room: ROOM.LIBRARY, type: 'fire' });
    this.fireplaceLight = this.lights[this.lights.length - 1];

    // v1.0 — the altar: a refuge field. Enemies do not fear God; they simply
    // move worse inside the light. Players can stand in it to breathe, not to
    // win. The conservatory gets the moon doubled through its glass roof.
    L({ id: 'altar', x: 2050, y: 900, r: 300, i: 0.8, color: [238, 214, 160], flick: 0.22, room: ROOM.CHAPEL, type: 'relic' });
    this.altarLight = this.lights[this.lights.length - 1];
    this.chapelAltar = { x: 2050, y: 900, r: 175 };
    L({ x: 2046, y: 850, r: 190, i: 0.5, color: [190, 190, 235], flick: 0.15, room: ROOM.CHAPEL, type: 'moon' });
    L({ x: 2000, y: 180, r: 260, i: 0.55, color: [150, 190, 245], flick: 0, room: ROOM.CONSERV, type: 'moon' });
    L({ x: 2160, y: 430, r: 230, i: 0.5, color: [150, 190, 245], flick: 0, room: ROOM.CONSERV, type: 'moon' });

    // moonlight through each window (cool, directional)
    for (const e of this.entrances) {
      if (e.kind !== 'window') continue;
      L({
        x: e.inside.x, y: e.inside.y, r: 250, i: 0.5, color: [150, 190, 245], flick: 0, room: e.room, type: 'moon',
      });
      L({
        x: e.x, y: e.y, r: 210, i: 0.42, color: [140, 180, 240], flick: 0, room: e.room, type: 'moon',
      });
    }
    // the front door leaks a little cold light
    L({ x: this.frontDoor.inside.x, y: this.frontDoor.inside.y, r: 190, i: 0.35, color: [140, 175, 235], flick: 0, room: ROOM.HALL, type: 'moon' });
    // basement: one weak lamp, a lot of dark
    L({ x: 1500, y: 1160, r: 210, i: 0.3, color: [255, 160, 90], flick: 0.6, room: ROOM.BASEMENT, type: 'lamp' });
    L({ x: -150, y: 320, r: 220, i: 0.45, color: [255, 170, 110], flick: 0.2, room: ROOM.KITCHEN, type: 'lamp' });
    L({ x: 1320, y: -120, r: 200, i: 0.4, color: [210, 190, 150], flick: 0.08, room: ROOM.STUDY, type: 'lamp' });
  }

  makeSpawns() {
    const S = (x, y, entrance, weight = 1) => this.spawns.push({ x, y, entrance, weight });
    // outside positions clustered near each entrance + a few wanderers
    S(620, 1760, 'frontDoor'); S(430, 1690, 'frontDoor'); S(860, 1700, 'frontDoor');
    S(890, 1760, 'hallWindow');
    S(-200, 1130, 'sideDoor'); S(-210, 890, 'sideDoor'); S(-200, 1380, 'sideDoor');
    S(690, -190, 'diningDoor'); S(520, -210, 'diningDoor');
    S(400, -200, 'diningWindow');
    S(2040, -190, 'glassNorth'); S(2210, -210, 'glassNorth');
    S(2440, 200, 'glassEast'); S(2440, 430, 'glassEast'); S(2420, -60, 'glassEast');
    S(2023, 1740, 'chapelDoor'); S(2160, 1690, 'chapelDoor');
    S(2440, 950, 'chapelWindow'); S(2440, 1250, 'chapelWindow');
    S(1460, 1750, 'cellarDoor'); S(1220, 1690, 'cellarDoor'); S(1700, 1700, 'cellarDoor');
    S(-460, 300, 'kitchenDoor'); S(-450, 200, 'kitchenDoor'); S(-440, 420, 'kitchenDoor');
    S(-100, -80, 'kitchenWindow');
    S(1310, -430, 'studyWindow'); S(1180, -420, 'studyWindow'); S(1460, -410, 'studyWindow');
    // dark wanderers (behind the house, in the fog)
    S(-250, 300, null); S(2520, 700, null); S(900, 2050, null); S(300, 2050, null); S(2350, 1900, null);
  }

  /* ================= collision grid ================= */

  buildGrid() {
    this.grid.clear();
    const c = this.cell;
    for (const s of this.solids) {
      const x0 = Math.floor(s.x / c), x1 = Math.floor((s.x + s.w) / c);
      const y0 = Math.floor(s.y / c), y1 = Math.floor((s.y + s.h) / c);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx + ',' + gy;
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(s);
      }
    }
  }

  querySolids(x, y, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const out = [];
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const arr = this.grid.get(gx + ',' + gy);
      if (arr) for (const s of arr) if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  /** Push a circle out of solids. Returns {x,y,hit}. */
  resolve(x, y, r, isPlayer = false) {
    const list = this.querySolids(x, y, r + 4);
    let hit = false;
    for (const s of list) {
      // entrance gaps: closed doors/windows are solid, open/broken are not
      const nx = clamp(x, s.x, s.x + s.w);
      const ny = clamp(y, s.y, s.y + s.h);
      let dx = x - nx, dy = y - ny;
      let d = Math.hypot(dx, dy);
      if (d < r) {
        if (d < 0.0001) {
          // deep inside: push out along the shallowest axis
          const left = x - s.x, right = s.x + s.w - x, top = y - s.y, bottom = s.y + s.h - y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = s.x - r; else if (m === right) x = s.x + s.w + r;
          else if (m === top) y = s.y - r; else y = s.y + s.h + r;
        } else {
          const push = (r - d) / d;
          x += dx * push; y += dy * push;
        }
        hit = true;
      }
    }
    if (isPlayer) {
      for (const s of this.barriers()) {
        const nx = clamp(x, s.x, s.x + s.w);
        const ny = clamp(y, s.y, s.y + s.h);
        const dx = x - nx, dy = y - ny, d = Math.hypot(dx, dy);
        if (d < r) {
          if (d < 0.0001) { y = s.y - r; }
          else { const push = (r - d) / d; x += dx * push * 1.2; y += dy * push * 1.2; }
          hit = true;
        }
      }
    }
    return { x, y, hit };
  }

  /** Dynamic barriers: closed doors, closed windows, barricades. */
  barriers() {
    const out = [];
    for (const e of this.entrances) {
      if (e.broken) continue;
      if (e.kind === 'door' && e.open) continue;
      out.push(e);
    }
    return out;
  }

  /** Is a point inside a solid (used for LOS + spawn validity)? */
  solidAt(x, y) {
    const list = this.querySolids(x, y, 1);
    for (const s of list) if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) return s;
    return null;
  }

  blocksSight(x, y) {
    for (const e of this.entrances) {
      // a closed door blocks sight, an open/broken one does not
      if (e.kind === 'door' && !e.open && !e.broken && x > e.x - e.w / 2 - 2 && x < e.x + e.w / 2 + 2 && y > e.y - e.h / 2 - 2 && y < e.y + e.h / 2 + 2) return true;
      if (e.kind === 'window' && !e.broken && x > e.x - e.w / 2 && x < e.x + e.w / 2 && y > e.y - e.h / 2 && y < e.y + e.h / 2) return true;
    }
    const s = this.solidAt(x, y);
    if (!s) return false;
    if (s.type === 'furniture' && s.f && (s.f.type === 'chair' || s.f.type === 'sideTable')) return false;
    return true;
  }

  hasLOS(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(d / 15));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksSight(x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  }

  /** Walkable check for spawn placement. */
  freeSpot(x, y, r = 14, tries = 24) {
    for (let i = 0; i < tries; i++) {
      const a = rand(0, TAU), d = i === 0 ? 0 : rand(20, 120);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (this.solidAt(px, py)) continue;
      let bad = false;
      for (const e of this.entrances) if (Math.hypot(px - e.x, py - e.y) < 40) bad = true;
      if (!bad) return { x: px, y: py };
    }
    return { x, y };
  }

  findRoom(x, y) {
    for (const r of this.roomList) {
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return r.id;
    }
    return ROOM.OUTSIDE;
  }
  room(id) {
    if (!id) return null;
    if (this.rooms[id]) return this.rooms[id];
    for (const r of this.roomList) if (r.id === id) return r;
    return null;
  }
  roomCenter(id) {
    const r = this.room(id);
    if (!r) return null;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** Route between rooms along the passage graph. Returns waypoints. */
  route(fromRoom, toRoom) {
    if (fromRoom === toRoom || fromRoom === ROOM.OUTSIDE || toRoom === ROOM.OUTSIDE) return [];
    const adj = new Map();
    const link = (a, b, p) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, p });
    };
    for (const p of this.passages) { link(p.a, p.b, p); link(p.b, p.a, p); }
    const q = [fromRoom];
    const prev = new Map([[fromRoom, null]]);
    while (q.length) {
      const cur = q.shift();
      if (cur === toRoom) break;
      for (const e of adj.get(cur) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, { room: cur, p: e.p });
        q.push(e.to);
      }
    }
    const c = this.roomCenter(toRoom);
    if (!prev.has(toRoom)) return c ? [c] : [];
    const pts = [];
    let cur = toRoom;
    while (cur && cur !== fromRoom) {
      const step = prev.get(cur);
      if (!step) break;
      pts.push({ x: step.p.x, y: step.p.y });
      cur = step.room;
    }
    pts.reverse();
    if (c) pts.push(c);
    return pts;
  }

  entranceById(id) { return this.entrances.find((e) => e.id === id); }
  get doors() { return this.entrances.filter((e) => e.kind === 'door'); }

  /* ================= entrances / damage ================= */

  damageEntrance(e, amount, game, fromX, fromY) {
    if (e.broken) return;
    e.hp -= amount;
    e.hits = (e.hits || 0) + 1; // objectives: a door nobody ever touched
    e.flash = 1;
    if (e.hp <= 0) {
      e.hp = 0; e.broken = true; e.open = true; e.barricade = 0;
      game.onEntranceBreak(e);
    } else {
      game.onEntranceHit(e, amount);
    }
  }

  repairEntrance(e, amount, game) {
    const cap = e.baseHpMax;
    const before = e.hp;
    e.hp = Math.min(Math.max(e.hp, e.barricade > 0 ? e.hpMax : cap), Math.max(e.hp + amount, 0));
    e.hp = Math.min(e.hp, Math.max(cap, e.barricade > 0 ? e.hpMax : 0));
    if (e.hp > 0) e.broken = false;
    return e.hp - before;
  }

  barricadeEntrance(e, game) {
    if (e.kind === 'door') {
      e.hpMax = e.baseHpMax + DOOR.barricadeHp;
      e.hp = e.hpMax;
      e.barricade++;
      e.open = false;
    } else {
      e.hpMax = e.baseHpMax + DOOR.barricadeHp * 0.8;
      e.hp = e.hpMax;
      e.barricade++;
      e.glass = false;
    }
    e.broken = false;
    return true;
  }

  /* ================= per-frame ================= */

  update(dt, game) {
    const t = game.time;
    this.blackout = game.blackoutT > 0 ? 1 : 0;
    this.bloodMoon = game.bloodMoon;
    for (const l of this.lights) {
      // flicker
      if (l.flick > 0) {
        const s = Math.sin(t * (5 + l.seed * 0.01) + l.seed) * 0.5 + 0.5;
        const s2 = Math.sin(t * 17.3 + l.seed * 2.1) * 0.5 + 0.5;
        l.f = 1 - l.flick * (0.35 * s + 0.25 * s2) - (chance(0.006 * l.flick) ? 0.4 : 0);
        l.f = clamp(l.f, 0.3, 1.05);
      } else l.f = 1;
      if (l.type === 'fire') l.f *= 0.85 + 0.3 * (Math.sin(t * 9.3 + l.seed) * 0.5 + 0.5);
      if (l.type === 'chandelier' && game.blackoutT > 0) l.f *= 0.05;
      if (l.type === 'candle' && game.blackoutT > 0) l.f *= 0.12;
      if ((l.type === 'lamp') && game.blackoutT > 0) l.f *= 0.06;
      // the blood moon / panic phase washes everything red
      l.curI = l.i * (l.f ?? 1) * (1 - this.bloodMoon * 0.25) * (game.powerOut ? 0.6 : 1);
    }
    // fire in the library dies down during a blackout, embers only
  }

  /* ================= baked floor + walls ================= */

  bake() {
    const W = 3400, H = 2400;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    this.floorCanvas = c;
    this.bakeOx = -520; this.bakeOy = -500;   // world (-520,-500) maps to (0,0)
    g.translate(-this.bakeOx, -this.bakeOy);

    // ---- exterior ground: dark gravel + dead grass
    g.fillStyle = '#1c2636';
    g.fillRect(this.bakeOx, this.bakeOy, W, H);
    const rng = new Rng(1337);
    for (let i = 0; i < 2600; i++) {
      const x = this.bakeOx + rng.float(0, W), y = this.bakeOy + rng.float(0, H);
      const room = this.findRoom(x, y);
      if (room !== ROOM.OUTSIDE) continue;
      const v = rng.float(0, 1);
      g.fillStyle = v > 0.7 ? 'rgba(62,72,90,0.45)' : v > 0.4 ? 'rgba(40,48,64,0.5)' : 'rgba(28,34,48,0.55)';
      g.beginPath(); g.ellipse(x, y, rng.float(2, 9), rng.float(1.5, 6), rng.float(0, TAU), 0, TAU); g.fill();
    }
    // pale gravel path to the front door
    g.fillStyle = 'rgba(96,102,118,0.4)';
    g.fillRect(560, 1500, 140, 420);

    // ---- rooms
    for (const r of this.roomList) this.bakeRoom(g, r);

    // ---- walls
    for (const s of this.solids) {
      if (s.type !== 'wall') continue;
      this.drawWallRect(g, s);
    }

    // ---- outer shell shadow
    g.save();
    g.globalCompositeOperation = 'multiply';
    const shell = { x: 54, y: 40, w: 1692, h: 1486 };
    const sh = g.createLinearGradient(shell.x, shell.y, shell.x + 90, shell.y + 90);
    g.restore();
  }

  bakeRoom(g, r) {
    const rng = new Rng(1000 + r.x + r.y);
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    if (r.floor === 'wood') {
      const base = r.id === ROOM.LIBRARY ? '#5e4236' : '#704e3a';
      g.fillStyle = base; g.fillRect(r.x, r.y, r.w, r.h);
      const plankH = 34;
      for (let y = r.y; y < r.y + r.h; y += plankH) {
        const row = Math.floor(y / plankH);
        for (let x = r.x - (row % 3) * 40; x < r.x + r.w; x += 120) {
          const v = hash2(x, y, 7 + row);
          const tone = 0.82 + v * 0.36;
          g.fillStyle = shade(base, tone);
          g.fillRect(x, y, 120 - 2, plankH - 2);
          if (v > 0.85) { g.fillStyle = 'rgba(28,16,10,0.2)'; g.fillRect(x, y, 120 - 2, plankH - 2); }
        }
      }
      // grain
      g.globalAlpha = 0.12;
      for (let i = 0; i < 260; i++) {
        const y = r.y + rng.float(0, r.h), x = r.x + rng.float(0, r.w);
        g.strokeStyle = rng.chance(0.5) ? '#3a281c' : '#8a6848';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.float(20, 70), y + rng.float(-2, 2)); g.stroke();
      }
      g.globalAlpha = 1;
    } else if (r.floor === 'marble') {
      g.fillStyle = '#6e7282'; g.fillRect(r.x, r.y, r.w, r.h);
      const s = 96;
      for (let y = r.y; y < r.y + r.h; y += s) for (let x = r.x; x < r.x + r.w; x += s) {
        const v = hash2(x, y, 21);
        g.fillStyle = v > 0.6 ? '#7c8090' : v > 0.3 ? '#686c7c' : '#5c6070';
        g.fillRect(x + 1, y + 1, s - 2, s - 2);
        // veins
        g.strokeStyle = 'rgba(120,128,145,0.10)'; g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + rng.float(0, s), y + rng.float(0, s));
        g.bezierCurveTo(x + rng.float(0, s), y + rng.float(0, s), x + rng.float(0, s), y + rng.float(0, s), x + rng.float(0, s), y + rng.float(0, s));
        g.stroke();
      }
      // checker centrepiece
      g.globalAlpha = 0.18;
      for (let y = r.y + 200; y < r.y + r.h - 140; y += 64) for (let x = r.x + 360; x < r.x + r.w - 260; x += 64) {
        if (((x / 64 | 0) + (y / 64 | 0)) % 2 === 0) { g.fillStyle = '#3a3e4a'; g.fillRect(x, y, 64, 64); }
      }
      g.globalAlpha = 1;
    } else if (r.floor === 'stone') {
      // stone
      g.fillStyle = '#4c505c'; g.fillRect(r.x, r.y, r.w, r.h);
      const s = 74;
      for (let y = r.y; y < r.y + r.h; y += s) {
        const off = ((y / s) | 0) % 2 ? s / 2 : 0;
        for (let x = r.x - s; x < r.x + r.w; x += s) {
          const v = hash2(x + off, y, 33);
          g.fillStyle = shade('#4c505c', 0.82 + v * 0.36);
          g.fillRect(x + off + 2, y + 2, s - 4, s - 4);
          if (v > 0.88) { g.fillStyle = 'rgba(90,60,40,0.2)'; g.fillRect(x + off + 6, y + 6, s - 12, 8); }
        }
      }
      // damp stains
      g.globalAlpha = 0.22;
      for (let i = 0; i < 30; i++) {
        const x = r.x + rng.float(0, r.w), y = r.y + rng.float(0, r.h);
        const rg = g.createRadialGradient(x, y, 0, x, y, rng.float(30, 100));
        rg.addColorStop(0, 'rgba(36,44,52,0.4)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, 100, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    } else if (r.floor === 'glass') {
      // v1.0 conservatory: worn flagstone gone mossy in the grout, the glass
      // roof's light lattice baked in, leaves nobody rakes anymore.
      g.fillStyle = '#3e5248'; g.fillRect(r.x, r.y, r.w, r.h);
      {
        const s = 64;
        for (let y = r.y; y < r.y + r.h; y += s) for (let x = r.x; x < r.x + r.w; x += s) {
          const v = hash2(x, y, 71);
          g.fillStyle = shade('#4a6256', 0.86 + v * 0.28);
          g.fillRect(x + 2, y + 2, s - 4, s - 4);
          if (v > 0.72) { g.fillStyle = 'rgba(52,84,54,0.35)'; g.fillRect(x + 4, y + s - 12, s - 8, 8); }
        }
      }
      g.strokeStyle = 'rgba(146,178,214,0.10)'; g.lineWidth = 26;
      for (let k = -2; k < 11; k++) { g.beginPath(); g.moveTo(r.x + k * 90, r.y); g.lineTo(r.x + k * 90 + 180, r.y + r.h); g.stroke(); }
      for (let i = 0; i < 90; i++) {
        const x = r.x + rng.float(0, r.w), y = r.y + rng.float(0, r.h);
        g.fillStyle = rng.chance(0.5) ? 'rgba(74,66,38,0.5)' : 'rgba(58,48,42,0.5)';
        g.beginPath(); g.ellipse(x, y, rng.float(3, 7), rng.float(2, 4), rng.float(0, TAU), 0, TAU); g.fill();
      }
    } else if (r.floor === 'tile') {
      // v1.0 chapel: bone-and-ink checker gone grey with age, traffic worn down the middle
      {
        const s = 56;
        for (let y = r.y, row = 0; y < r.y + r.h; y += s, row++) for (let x = r.x, col = 0; x < r.x + r.w; x += s, col++) {
          const light = ((row + col) & 1) === 0;
          const v = hash2(x, y, 83);
          g.fillStyle = shade(light ? '#8c8678' : '#3e424e', 0.92 + v * 0.16);
          g.fillRect(x, y, s, s);
        }
      }
      g.globalAlpha = 0.2;
      for (let i = 0; i < 60; i++) {
        const x = r.x + rng.float(0, r.w), y = r.y + rng.float(0, r.h);
        g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, y, rng.float(10, 44), rng.float(6, 20), 0, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // room-side shadow (ambient occlusion against walls)
    const ao = g.createLinearGradient(r.x, r.y, r.x, r.y + 90);
    ao.addColorStop(0, 'rgba(8,10,16,0.22)'); ao.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ao; g.fillRect(r.x, r.y, r.w, 90);
    const ao2 = g.createLinearGradient(r.x, r.y + r.h, r.x, r.y + r.h - 70);
    ao2.addColorStop(0, 'rgba(8,10,16,0.16)'); ao2.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ao2; g.fillRect(r.x, r.y + r.h - 70, r.w, 70);
    const ao3 = g.createLinearGradient(r.x, r.y, r.x + 70, r.y);
    ao3.addColorStop(0, 'rgba(8,10,16,0.16)'); ao3.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ao3; g.fillRect(r.x, r.y, 70, r.h);
    const ao4 = g.createLinearGradient(r.x + r.w, r.y, r.x + r.w - 70, r.y);
    ao4.addColorStop(0, 'rgba(0,0,0,0.4)'); ao4.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ao4; g.fillRect(r.x + r.w - 70, r.y, 70, r.h);
    g.restore();
  }

  drawWallRect(g, s) {
    // shadow cast on the floor
    g.fillStyle = 'rgba(8,10,16,0.32)';
    g.fillRect(s.x + 6, s.y + 8, s.w, s.h);
    // wall body — faded stone, not a black bar
    g.fillStyle = '#5e6272';
    g.fillRect(s.x, s.y, s.w, s.h);
    const grad = g.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
    grad.addColorStop(0, 'rgba(180,188,206,0.28)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(8,10,16,0.22)');
    g.fillStyle = grad;
    g.fillRect(s.x, s.y, s.w, s.h);
    // stone courses
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    if (s.w > s.h) {
      for (let x = s.x + 40; x < s.x + s.w; x += 40) { g.beginPath(); g.moveTo(x, s.y); g.lineTo(x, s.y + s.h); g.stroke(); }
    } else {
      for (let y = s.y + 40; y < s.y + s.h; y += 40) { g.beginPath(); g.moveTo(s.x, y); g.lineTo(s.x + s.w, y); g.stroke(); }
    }
    // top highlight for a chunky 3D read
    g.fillStyle = 'rgba(190,198,214,0.22)';
    g.fillRect(s.x, s.y, s.w, 3);
    const rng = new Rng(Math.floor(s.x * 7 + s.y * 13));
    g.globalAlpha = 0.18;
    for (let i = 0; i < Math.max(4, (s.w * s.h) / 2600); i++) {
      const x = s.x + rng.float(0, s.w), y = s.y + rng.float(0, s.h);
      g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, y, rng.float(2, 8), rng.float(1, 4), 0, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    // hanging cobwebs in corners
    g.strokeStyle = 'rgba(180,180,190,0.09)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(s.x, s.y); g.lineTo(s.x + 26, s.y + 26); g.moveTo(s.x + 26, s.y); g.lineTo(s.x, s.y + 26);
    g.stroke();
  }

  /* ================= drawing ================= */

  drawFloor(ctx) {
    ctx.drawImage(this.floorCanvas, this.bakeOx, this.bakeOy);
  }

  drawProps(ctx, game) {
    const t = game.time;
    for (const p of this.props) {
      if (!game.renderer.isVisible(p.x, p.y, 320)) continue;
      switch (p.type) {
        case 'carpet': {
          const w = p.w, h = p.h;
          ctx.save();
          ctx.translate(p.x, p.y);
          const grad = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
          const c1 = p.color === 'crimson' ? '#3a0c14' : p.color === 'purple' ? '#241633' : '#181a22';
          const c2 = p.color === 'crimson' ? '#57121f' : p.color === 'purple' ? '#33204a' : '#22242c';
          grad.addColorStop(0, c1); grad.addColorStop(1, c2);
          ctx.fillStyle = grad;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = 'rgba(168,131,60,0.28)'; ctx.lineWidth = 3;
          ctx.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-w / 2 + 24, -h / 2 + 24, w - 48, h - 48);
          ctx.globalAlpha = 0.12;
          for (let i = 0; i < 40; i++) {
            const x = hashRange(i, 3, 5, -w / 2, w / 2), y = hashRange(i, 7, 9, -h / 2, h / 2);
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.ellipse(x, y, 6, 3, 0, 0, TAU); ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.restore();
          break;
        }
        case 'portrait': {
          const w = p.big ? 74 : 52, h = p.big ? 92 : 64;
          ctx.save(); ctx.translate(p.x, p.y);
          if (p.vertical) ctx.rotate(Math.PI / 2);
          ctx.fillStyle = '#1a1409';
          ctx.fillRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10);
          ctx.fillStyle = '#8a6a2c';
          ctx.fillRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
          const g2 = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
          g2.addColorStop(0, '#14161f'); g2.addColorStop(1, '#0a0b12');
          ctx.fillStyle = g2;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          // a pale face that is *almost* looking at you
          ctx.fillStyle = 'rgba(190,185,175,0.16)';
          ctx.beginPath(); ctx.ellipse(0, -h * 0.12, w * 0.17, h * 0.16, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(120,20,26,0.22)';
          ctx.beginPath(); ctx.ellipse(0, h * 0.22, w * 0.3, h * 0.25, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.restore();
          break;
        }
        case 'candelabra': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#12131a';
          ctx.beginPath(); ctx.ellipse(0, 6, 16, 6, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#4a4e58';
          ctx.fillRect(-3, -22, 6, 30);
          ctx.beginPath(); ctx.moveTo(-16, -22); ctx.lineTo(16, -22); ctx.lineTo(0, -8); ctx.closePath(); ctx.fill();
          for (const dx of [-14, 0, 14]) {
            const lit = p.light && game.blackoutT <= 0;
            ctx.fillStyle = '#cfc9b8'; ctx.fillRect(dx - 2, -34, 4, 14);
            if (lit) {
              const fl = 0.7 + 0.3 * Math.sin(t * 11 + p.seed + dx);
              ctx.globalCompositeOperation = 'screen';
              const rg = ctx.createRadialGradient(dx, -38, 0, dx, -38, 16 * fl);
              rg.addColorStop(0, 'rgba(255,214,150,0.95)'); rg.addColorStop(0.4, 'rgba(255,150,60,0.5)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(dx, -38, 16 * fl, 0, TAU); ctx.fill();
              ctx.globalCompositeOperation = 'source-over';
            }
          }
          ctx.restore();
          break;
        }
        case 'candleStand': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#12131a'; ctx.beginPath(); ctx.ellipse(0, 4, 9, 4, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3a3e48'; ctx.fillRect(-2, -12, 4, 16);
          const lit = p.light && game.blackoutT <= 0;
          ctx.fillStyle = '#cfc9b8'; ctx.fillRect(-2, -24, 4, 13);
          if (lit) {
            const fl = 0.65 + 0.35 * Math.sin(t * 13 + p.seed);
            ctx.globalCompositeOperation = 'screen';
            const rg = ctx.createRadialGradient(0, -26, 0, 0, -26, 22 * fl);
            rg.addColorStop(0, 'rgba(255,226,170,0.95)'); rg.addColorStop(0.35, 'rgba(255,160,70,0.45)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, -26, 22 * fl, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.restore();
          break;
        }
        case 'deskLamp': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#2a2233'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#4e3a22'; ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(12, -4); ctx.lineTo(8, -16); ctx.lineTo(-8, -16); ctx.closePath(); ctx.fill();
          if (game.blackoutT <= 0) {
            const fl = 0.85 + 0.15 * Math.sin(t * 6.2 + p.seed);
            ctx.globalCompositeOperation = 'screen';
            const rg = ctx.createRadialGradient(0, -6, 0, 0, -6, 26 * fl);
            rg.addColorStop(0, 'rgba(255,214,150,0.8)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, -6, 26 * fl, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.restore();
          break;
        }
        case 'fireplace': {
          ctx.save(); ctx.translate(p.x, p.y);
          const w = p.w, h = p.h;
          ctx.fillStyle = '#15151a';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.fillStyle = '#2e2f38';
          ctx.fillRect(-w / 2, -h / 2, w, 10);
          ctx.fillStyle = '#0a0a0d';
          ctx.beginPath();
          ctx.moveTo(-w * 0.28, h / 2); ctx.lineTo(-w * 0.28, -h * 0.1);
          ctx.quadraticCurveTo(0, -h * 0.75, w * 0.28, -h * 0.1);
          ctx.lineTo(w * 0.28, h / 2); ctx.closePath(); ctx.fill();
          if (game.blackoutT <= 0) {
            const fl = 0.7 + 0.3 * Math.sin(t * 8.7) + 0.12 * Math.sin(t * 21);
            ctx.globalCompositeOperation = 'screen';
            const rg = ctx.createRadialGradient(0, -h * 0.1, 0, 0, -h * 0.1, 70 * fl);
            rg.addColorStop(0, 'rgba(255,214,150,0.95)');
            rg.addColorStop(0.3, 'rgba(255,130,40,0.6)');
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.ellipse(0, -h * 0.1, 70 * fl, 46 * fl, 0, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            // logs
            ctx.strokeStyle = '#1a120c'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.moveTo(-24, h / 2 - 4); ctx.lineTo(24, h / 2 - 12); ctx.stroke();
          } else {
            // embers only
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = 'rgba(120,40,10,0.25)';
            ctx.beginPath(); ctx.ellipse(0, h * 0.3, 26, 12, 0, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.restore();
          break;
        }
        case 'clock': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#2a1c10';
          ctx.fillRect(-26, -16, 52, 92);
          ctx.fillStyle = '#0d0c10';
          ctx.beginPath(); ctx.arc(0, -34, 22, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(168,131,60,0.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, -34, 22, 0, TAU); ctx.stroke();
          // hands move with the night clock — a small diegetic timer
          const mins = (game.time / 300) * 300;
          const hourA = -Math.PI / 2 + (mins / 60) * TAU / 12;
          const minA = -Math.PI / 2 + (mins % 60) / 60 * TAU;
          ctx.strokeStyle = '#c9c2ae'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(Math.cos(hourA) * 11, -34 + Math.sin(hourA) * 11); ctx.stroke();
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(Math.cos(minA) * 17, -34 + Math.sin(minA) * 17); ctx.stroke();
          // pendulum
          const sw = Math.sin(game.time * 2.1) * 0.35;
          ctx.save(); ctx.translate(0, -6); ctx.rotate(sw);
          ctx.fillStyle = '#a8833c'; ctx.fillRect(-1.5, 0, 3, 40);
          ctx.beginPath(); ctx.arc(0, 44, 7, 0, TAU); ctx.fill();
          ctx.restore();
          ctx.restore();
          break;
        }
        case 'basin': {
          ctx.save(); ctx.translate(p.x, p.y);
          const w = p.w, h = p.h;
          ctx.fillStyle = '#15161c';
          ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2a2c34';
          ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - 5, h / 2 - 5, 0, 0, TAU); ctx.fill();
          if (!game.basinUsed) {
            const pu = 0.85 + 0.15 * Math.sin(t * 1.7);
            const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
            rg.addColorStop(0, `rgba(140,10,22,${0.85 * pu})`);
            rg.addColorStop(0.7, `rgba(80,6,16,${0.7 * pu})`);
            rg.addColorStop(1, 'rgba(30,2,8,0.9)');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - 8, h / 2 - 8, 0, 0, TAU); ctx.fill();
          } else {
            ctx.fillStyle = '#231018';
            ctx.beginPath(); ctx.ellipse(0, 0, w / 2 - 8, h / 2 - 8, 0, 0, TAU); ctx.fill();
          }
          ctx.fillStyle = '#3a3c46';
          ctx.fillRect(-w / 2 - 4, -6, 8, 12); ctx.fillRect(w / 2 - 4, -6, 8, 12);
          ctx.restore();
          break;
        }
        case 'larder': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#3a2a1c';
          ctx.fillRect(-40, -22, 80, 44);
          ctx.strokeStyle = 'rgba(180,140,80,0.35)'; ctx.strokeRect(-40, -22, 80, 44);
          ctx.fillStyle = game.larderUsed ? '#2a140f' : '#6a1020';
          ctx.fillRect(-28, -8, 16, 18); ctx.fillRect(-6, -8, 16, 18); ctx.fillRect(16, -8, 12, 18);
          ctx.restore();
          break;
        }
        case 'ward': {
          const lit = game.mansion.studyWard && game.time < game.mansion.studyWard.until;
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.fillStyle = '#2a2418';
          ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
          ctx.fillStyle = lit ? '#e6c27a' : '#6a5a40';
          ctx.beginPath(); ctx.arc(0, -6, 6, 0, TAU); ctx.fill();
          if (lit) {
            ctx.globalCompositeOperation = 'screen';
            const rg = ctx.createRadialGradient(0, 0, 8, 0, 0, 150);
            rg.addColorStop(0, 'rgba(230,200,130,0.28)');
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'cobweb': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.strokeStyle = 'rgba(190,195,210,0.10)';
          ctx.lineWidth = 1;
          const R = 46;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 1.6 + 0.2;
            ctx.beginPath(); ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
          }
          for (let r2 = 12; r2 < R; r2 += 11) {
            ctx.beginPath();
            for (let i = 0; i <= 6; i++) {
              const a = (i / 6) * Math.PI * 1.6 + 0.2;
              const x = Math.cos(a) * r2, y = Math.sin(a) * r2;
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
          break;
        }
        case 'bones': {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#b8b2a2';
          for (let i = 0; i < 5; i++) {
            const a = hash2(i, p.seed, 3) * TAU;
            const d = hash2(i, p.seed, 9) * 30;
            ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(a);
            ctx.fillRect(-9, -2, 18, 4);
            ctx.beginPath(); ctx.arc(-9, -2, 3, 0, TAU); ctx.arc(-9, 2, 3, 0, TAU); ctx.fill();
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          ctx.restore();
          break;
        }
        case 'mossPatch': {
        for (let i = 0; i < 9; i++) {
          const a = (p.seed + i * 127) % 360 * TAU / 360;
          const rr = 12 + ((p.seed + i * 31) % 26);
          ctx.fillStyle = i % 2 ? 'rgba(38,58,40,0.5)' : 'rgba(30,46,34,0.55)';
          ctx.beginPath(); ctx.ellipse(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr * 0.5, 7, 4, a, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'urn': {
        ctx.fillStyle = '#000'; ctx.globalAlpha *= 0.3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 12, 11, 4, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha /= 0.3;
        ctx.fillStyle = '#494449';
        ctx.beginPath();
        ctx.moveTo(p.x - 8, p.y - 6); ctx.quadraticCurveTo(p.x - 12, p.y + 8, p.x - 5, p.y + 11);
        ctx.lineTo(p.x + 5, p.y + 11); ctx.quadraticCurveTo(p.x + 12, p.y + 8, p.x + 8, p.y - 6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5a555a'; ctx.fillRect(p.x - 10, p.y - 9, 20, 4);
        break;
      }
      case 'hangingVine': {
        ctx.strokeStyle = 'rgba(34,52,34,0.8)'; ctx.lineWidth = 2;
        const n = 3 + (p.seed % 3);
        for (let i = 0; i < n; i++) {
          const vx = p.x + (i - n / 2) * 13;
          const sw = Math.sin(game.time * 0.7 + i * 2.1 + p.seed) * 3;
          const len = 26 + ((p.seed + i * 53) % 34);
          ctx.beginPath(); ctx.moveTo(vx, p.y);
          ctx.quadraticCurveTo(vx + sw, p.y + len * 0.6, vx + sw * 1.6, p.y + len);
          ctx.stroke();
          ctx.fillStyle = 'rgba(40,64,40,0.75)';
          for (let k = 1; k <= 3; k++) {
            const ky = p.y + (len / 4) * k;
            ctx.beginPath(); ctx.ellipse(vx + sw * (k / 3) * 1.4, ky, 4, 2.2, 0.6, 0, TAU); ctx.fill();
          }
        }
        break;
      }
      case 'stainedGlass': {
        // a dead saint in a dead house: colour only at night, only moon
        const gw = (p.w || 200) / 2, gh = p.h || 70;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = '#141219';
        ctx.beginPath();
        ctx.moveTo(-gw, gh / 2); ctx.lineTo(-gw, -gh * 0.1);
        ctx.quadraticCurveTo(0, -gh * 1.5, gw, -gh * 0.1); ctx.lineTo(gw, gh / 2);
        ctx.closePath(); ctx.fill();
        const cols = ['#2c3a63', '#63202c', '#2c5038', '#5d4a22'];
        for (let i = 0; i < 8; i++) {
          const a = hash2(i, p.seed, 5);
          ctx.fillStyle = cols[i % 4];
          ctx.globalAlpha = 0.28 + a * 0.3;
          ctx.fillRect(-gw + 8 + (i % 4) * (gw / 2), -gh * 0.1 + Math.floor(i / 4) * gh * 0.3, gw / 2 - 6, gh * 0.26);
        }
        ctx.globalAlpha = 0.5 + Math.sin(game.time * 0.4) * 0.08;
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(120,150,210,0.2)';
        ctx.fillRect(-gw + 6, -gh * 0.05, gw * 2 - 12, gh * 0.5);
        ctx.restore();
        break;
      }
      case 'books': {
          ctx.save(); ctx.translate(p.x, p.y);
          for (let i = 0; i < 4; i++) {
            const a = hash2(i, p.seed, 5) * 1.2 - 0.6;
            ctx.save(); ctx.translate(i * 6 - 9, i * 3 - 6); ctx.rotate(a);
            ctx.fillStyle = i % 2 ? '#3a2a1a' : '#2a1a2a';
            ctx.fillRect(-8, -5, 16, 10);
            ctx.fillStyle = '#8a7a5a'; ctx.fillRect(-7, -1, 14, 1.5);
            ctx.restore();
          }
          ctx.restore();
          break;
        }
      }
    }
  }

  drawFurniture(ctx, game) {
    const t = game.time;
    for (const f of this.furniture) {
      if (f.type === 'none') continue;
      if (!game.renderer.isVisible(f.x, f.y, Math.max(f.w, f.h) + 60)) continue;
      ctx.save();
      drawFurnitureShape(ctx, f, game, t);
      ctx.restore();
    }
  }

  drawEntrances(ctx, game) {
    const t = game.time;
    for (const e of this.entrances) {
      if (!game.renderer.isVisible(e.x, e.y, 260)) continue;
      const horiz = e.axis === 'h';
      const w = e.w, h = e.h;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (!horiz) ctx.rotate(Math.PI / 2);

      // v1.0 (QA P1-6) — legibility at range: an entrance with company gets a
      // cold rim that survives any light grade. Project Zomboid's night mode
      // teaches the same lesson: at dark, edges are the interface.
      const urgent = e.attackers > 0 || e.hint > 0 || e.flash > 0 || (e.knock && !e.broken);
      if (urgent) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.34 + 0.22 * Math.sin(game.time * 5);
        ctx.strokeStyle = '#8fb0d8';
        ctx.lineWidth = 2;
        ctx.strokeRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14);
        ctx.restore();
      }

      // frame
      ctx.fillStyle = '#161419';
      const ext = e.kind === 'door' ? 6 : 3;
      ctx.fillRect(-w / 2 - ext, -h / 2 - ext, w + ext * 2, h + ext * 2);
      ctx.fillStyle = '#3a3025';
      ctx.fillRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);

      const dmg = 1 - clamp(e.hp / Math.max(1, e.hpMax), 0, 1);
      if (e.kind === 'door') {
        if (e.broken) {
          // hanging broken door
          ctx.fillStyle = '#231a12';
          ctx.fillRect(-w / 2 - 6, -h / 2 - 4, w + 12, 8);
          ctx.save();
          ctx.translate(-w / 2 + 6, 0); ctx.rotate(1.05);
          ctx.fillStyle = '#1c140d';
          ctx.fillRect(0, -h / 2, w * 0.45, h);
          ctx.restore();
          ctx.save();
          ctx.translate(w / 2 - 6, 0); ctx.rotate(-0.75);
          ctx.fillStyle = '#181009';
          ctx.fillRect(-w * 0.35, -h / 2, w * 0.35, h);
          ctx.restore();
          // splinters on the floor
          ctx.globalAlpha = 0.7;
          for (let i = 0; i < 7; i++) {
            const a = hash2(i, e.x | 0, 4) * 6.28;
            const d = hash2(i, e.y | 0, 8) * 46;
            ctx.save();
            ctx.translate(Math.cos(a) * d, Math.sin(a) * d + 14);
            ctx.rotate(a);
            ctx.fillStyle = '#2b1e13';
            ctx.fillRect(-7, -1.5, 14, 3);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        } else {
          // heavy oak door
          const openAmt = e.open ? 1 : 0;
          ctx.save();
          if (e.open) {
            ctx.translate(-w / 2, 0);
            ctx.rotate(-1.15);
            ctx.translate(w / 2, 0);
          }
          const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
          grad.addColorStop(0, '#4a3320'); grad.addColorStop(0.5, '#382514'); grad.addColorStop(1, '#241708');
          ctx.fillStyle = grad;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
          for (let x = -w / 2 + 22; x < w / 2 - 6; x += 22) {
            ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke();
          }
          ctx.fillStyle = '#6b5a3a';
          ctx.fillRect(-w / 2 + 8, -h / 2 + 5, w - 16, 4);
          ctx.fillRect(-w / 2 + 8, h / 2 - 9, w - 16, 4);
          // iron hinges + handle
          ctx.fillStyle = '#20222a';
          ctx.fillRect(-w / 2 + 10, -h / 2, 18, 5);
          ctx.fillRect(-w / 2 + 10, h / 2 - 5, 18, 5);
          ctx.beginPath(); ctx.arc(w / 2 - 16, 0, 4, 0, TAU); ctx.fill();
          // cracks grow with damage
          if (dmg > 0.15) {
            ctx.strokeStyle = `rgba(10,8,6,${0.5 + dmg * 0.4})`;
            ctx.lineWidth = 1 + dmg * 2;
            for (let i = 0; i < Math.floor(dmg * 6) + 1; i++) {
              const x0 = hashRange(i, e.y | 0, 3, -w / 2 + 6, w / 2 - 6);
              const y0 = hashRange(i, e.x | 0, 5, -h / 2, h / 2);
              ctx.beginPath();
              ctx.moveTo(x0, y0);
              ctx.lineTo(x0 + hashRange(i, 2, 7, -16, 16), y0 + hashRange(i, 3, 11, -h / 2, h / 2));
              ctx.stroke();
            }
          }
          ctx.restore();
        }
        // barricade planks
        if (e.barricade > 0) {
          for (let i = 0; i < 2 + e.barricade; i++) {
            const y = -h / 2 - 4 + i * ((h + 8) / (2 + e.barricade));
            ctx.save();
            ctx.translate(0, y);
            ctx.rotate(0.06 - hash2(i, e.x | 0, 2) * 0.12);
            ctx.fillStyle = i % 2 ? '#5a3d22' : '#4a3119';
            ctx.fillRect(-w / 2 - 10, -6, w + 20, 12);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(-w / 2 - 10, 2, w + 20, 3);
            ctx.restore();
          }
          ctx.fillStyle = 'rgba(200,190,170,0.5)';
          ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('BARRICADED', 0, h / 2 + 22);
        }
      } else {
        // ---- window ----
        ctx.fillStyle = '#0d1119';
        ctx.fillRect(-w / 2, -h / 2 - 2, w, h + 4);
        if (!e.broken && e.glass) {
          const lit = 0.25 + 0.1 * Math.sin(t * 0.7 + e.x);
          ctx.fillStyle = `rgba(120,170,230,${lit})`;
          ctx.fillRect(-w / 2 + 2, -h / 2 - 1, w - 4, h + 2);
          // mullions
          ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = 4;
          const n = Math.max(2, Math.round(w / 46));
          for (let i = 1; i < n; i++) {
            const x = -w / 2 + (w / n) * i;
            ctx.beginPath(); ctx.moveTo(x, -h / 2 - 2); ctx.lineTo(x, h / 2 + 2); ctx.stroke();
          }
          ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
          // the moon, faintly, through the glass
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#cfe0f5';
          ctx.beginPath(); ctx.arc(w * 0.2, -h * 0.2, 9, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          // shattered: jagged glass remains
          ctx.fillStyle = 'rgba(20,30,44,0.85)';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.fillStyle = 'rgba(150,190,235,0.16)';
          for (let i = 0; i < 12; i++) {
            const x = hashRange(i, e.y | 0, 3, -w / 2, w / 2);
            const y = hashRange(i, e.x | 0, 5, -h / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x, y); ctx.lineTo(x + 6, y - 7); ctx.lineTo(x + 9, y + 3); ctx.closePath(); ctx.fill();
          }
          ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = 4;
          ctx.strokeRect(-w / 2, -h / 2, w, h);
        }
        if (e.barricade > 0) {
          for (let i = 0; i < 2 + e.barricade; i++) {
            const y = -h / 2 + 4 + i * ((h - 8) / (1 + e.barricade));
            ctx.save(); ctx.translate(0, y); ctx.rotate(0.05 - hash2(i, e.x | 0, 2) * 0.1);
            ctx.fillStyle = i % 2 ? '#5a3d22' : '#452c17';
            ctx.fillRect(-w / 2 - 8, -5, w + 16, 10);
            ctx.restore();
          }
        }
      }

      // hit flash
      if (e.flash > 0.01) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = e.flash;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-w / 2 - 10, -h / 2 - 10, w + 20, h + 20);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  drawLightFixtures(ctx, game) {
    // chandelier hangs in the hall centre
    const l = this.lights.find((x) => x.type === 'chandelier');
    if (!l || !game.renderer.isVisible(l.x, l.y, 260)) return;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#1a1a22'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -400); ctx.lineTo(0, 0); ctx.stroke();
    ctx.fillStyle = '#2a2b34';
    ctx.beginPath(); ctx.ellipse(0, 0, 60, 16, 0, 0, TAU); ctx.fill();
    const lit = game.blackoutT <= 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const x = Math.cos(a) * 52, y = Math.sin(a) * 14;
      ctx.fillStyle = '#cfc9b8'; ctx.fillRect(x - 2, y - 16, 4, 16);
      if (lit) {
        const fl = 0.7 + 0.3 * Math.sin(game.time * 9 + i);
        ctx.globalCompositeOperation = 'screen';
        const rg = ctx.createRadialGradient(x, y - 18, 0, x, y - 18, 20 * fl);
        rg.addColorStop(0, 'rgba(255,220,160,0.9)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y - 18, 20 * fl, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
  }

  /** Feed all lights into the renderer's lightmap. */
  submitLights(renderer, game) {
    // Even faded wash across each room, so corners aren't a black frame
    // around the candle pools. Basement stays a step dimmer.
    const out = game.blackoutT > 0 ? 0.45 : 1;
    for (const room of this.roomList) {
      const stone = room.floor === 'stone';
      const glass = room.floor === 'glass';
      const reach = Math.hypot(room.w, room.h) * 0.58;
      const i = (glass ? 0.26 : stone ? 0.14 : 0.2) * out;
      const col = stone ? [148, 156, 174] : glass ? [180, 198, 216] : [178, 186, 202];
      renderer.addLight(room.x + room.w / 2, room.y + room.h / 2, reach, i, col);
    }
    for (const l of this.lights) {
      const i = l.curI ?? l.i;
      if (i <= 0.01) continue;
      let color = l.color;
      if (this.bloodMoon > 0.05) {
        // panic phase: warm lights sour toward red
        const b = this.bloodMoon;
        color = [l.color[0], l.color[1] * (1 - b * 0.5), l.color[2] * (1 - b * 0.6)];
      }
      renderer.addLight(l.x, l.y, l.r * (0.94 + 0.06 * (l.f ?? 1)), i, color);
      if (l.type === 'moon' && l.room) {
        // cast a shaft into the room from the window
        const e = this.entrances.find((en) => Math.hypot(en.inside.x - l.x, en.inside.y - l.y) < 40);
        if (e) {
          const ang = e.facing === 'north' ? Math.PI / 2 : e.facing === 'south' ? -Math.PI / 2 : e.facing === 'east' ? Math.PI : 0;
          renderer.addLightShaft(e.inside.x, e.inside.y, Math.abs(e.axis === 'h' ? e.w * 1.3 : e.h), 300, ang, e.broken ? 0.5 : 0.32, [150, 190, 240]);
        }
      }
    }
    // player's candle-lantern-ish self light is submitted by the player.
  }

  /** Faded room wash. The lightmap is multiply, so a near-zero ambient
   *  turns every floor into solid black. Stay in dusk: readable, not noon. */
  ambientFor(game) {
    const phase = game.phase?.ambient;
    let a = phase ? phase.slice() : [164, 170, 184];
    const b = this.bloodMoon;
    if (b > 0) {
      a[0] = a[0] * (1 - b * 0.2) + 176 * b;
      a[1] = a[1] * (1 - b * 0.4) + 100 * b;
      a[2] = a[2] * (1 - b * 0.35) + 108 * b;
    }
    if (game.blackoutT > 0) a = a.map((v) => v * 0.8);
    if (game.lightningFlash > 0.2) {
      const f = game.lightningFlash;
      a = a.map((v) => v + 60 * f);
    }
    return a.map((v) => clamp(v, 120, 236));
  }
}

/* ================= furniture drawing ================= */

function shade(hex, mul) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * mul, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * mul, 0, 255) | 0;
  const b = clamp((n & 255) * mul, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

function wood(ctx, x, y, w, h, base = '#3a2517', top = '#4d311c') {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top); g.addColorStop(0.35, base); g.addColorStop(1, shade(base, 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = 'rgba(255,220,180,0.06)';
  ctx.fillRect(x, y, w, 2);
}

function shadowBlob(ctx, x, y, w, h, a = 0.45) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawFurnitureShape(ctx, f, game, t) {
  const x = f.x, y = f.y, w = f.w, h = f.h;
  switch (f.type) {
    /* ---- v1.0: chapel + conservatory furniture ---- */
    case 'pew': {
      shadowBlob(ctx, x + w / 2, y + h + 4, w * 0.52, 7);
      ctx.fillStyle = '#241a12'; ctx.fillRect(x, y + h * 0.42, w, h * 0.58);   // seat
      ctx.fillStyle = '#2e2115'; ctx.fillRect(x, y, w, h * 0.3);               // back
      ctx.fillStyle = '#181009';
      ctx.fillRect(x + 3, y + h * 0.42 + 3, w - 6, 2);
      for (const ex of [x + 2, x + w - 8]) ctx.fillRect(ex, y, 6, h);          // ends
      break;
    }
    case 'altar': {
      shadowBlob(ctx, x + w / 2, y + h + 6, w * 0.55, 9);
      ctx.fillStyle = '#3a3a42'; ctx.fillRect(x, y + h * 0.3, w, h * 0.7);     // stone block
      ctx.fillStyle = '#4a4a54'; ctx.fillRect(x - 6, y, w + 12, h * 0.34);     // slab
      ctx.fillStyle = '#565660'; ctx.fillRect(x - 6, y, w + 12, 4);            // lit edge
      // cloth with a stitched hem
      ctx.fillStyle = 'rgba(120,26,38,0.85)';
      ctx.fillRect(x + 8, y + h * 0.1, w - 16, h * 0.3);
      ctx.strokeStyle = 'rgba(200,170,90,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 10, y + h * 0.12, w - 20, h * 0.26);
      break;
    }
    case 'font': {
      shadowBlob(ctx, x + w / 2, y + h * 0.8, w * 0.42, 8);
      ctx.fillStyle = '#33333c';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.4, w / 2, h * 0.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0e1622';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.38, w / 2 - 7, h * 0.28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(150,180,225,0.16)';
      ctx.beginPath(); ctx.ellipse(x + w / 2 - 4, y + h * 0.34, w / 5, h * 0.12, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'planter': {
      shadowBlob(ctx, x + w / 2, y + h + 3, w * 0.5, 7);
      ctx.fillStyle = '#4a3324';
      ctx.beginPath();
      ctx.moveTo(x + 6, y + h * 0.25); ctx.lineTo(x + w - 6, y + h * 0.25);
      ctx.lineTo(x + w - 13, y + h); ctx.lineTo(x + 13, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#59402c'; ctx.fillRect(x + 2, y + h * 0.16, w - 4, h * 0.14);   // rim
      // overgrown green: the plants outlived the gardeners
      const seed = (f.seed || 0) % 97;
      for (let i = 0; i < 7; i++) {
        const a = seed + i * 1.7 + Math.sin(t * 0.6 + i) * 0.05;
        const rr = w * (0.32 + ((i * 37 + seed) % 13) / 44);
        const bx = x + w / 2 + Math.cos(a) * rr * 0.5, by = y + h * 0.16 + Math.sin(a) * rr * 0.32 - rr * 0.42;
        ctx.fillStyle = i % 3 === 0 ? '#243d24' : '#1b301f';
        ctx.beginPath(); ctx.ellipse(bx, by, rr * 0.34, rr * 0.24, a, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'fountain': {
      const cx = x + w / 2, cy = y + h / 2, rr = w / 2;
      shadowBlob(ctx, cx, cy + h * 0.42, rr * 1.05, rr * 0.42);
      ctx.fillStyle = '#3b3b45';
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.66, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#26262e';
      ctx.beginPath(); ctx.ellipse(cx, cy, rr - 9, (rr - 9) * 0.64, 0, 0, TAU); ctx.fill();
      // standing water catching the glass roof
      ctx.fillStyle = 'rgba(60,86,116,0.7)';
      ctx.beginPath(); ctx.ellipse(cx, cy, rr - 13, (rr - 13) * 0.6, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = 'rgba(170,200,235,0.7)'; ctx.lineWidth = 1;
      const rip = (t * 0.9) % 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, (rr - 16) * rip, (rr - 16) * 0.6 * rip, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#454550';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 9, 6, 0, 0, TAU); ctx.fill();
      ctx.fillRect(cx - 3, cy - 26, 6, 24);
      break;
    }
    case 'pottingBench': {
      shadowBlob(ctx, x + w / 2, y + h + 2, w * 0.4, 6);
      ctx.fillStyle = '#2e2116'; ctx.fillRect(x, y + h * 0.22, w, h * 0.5);
      ctx.fillStyle = '#20160e'; ctx.fillRect(x + 3, y + h * 0.72, 5, h * 0.28); ctx.fillRect(x + w - 8, y + h * 0.72, 5, h * 0.28);
      ctx.fillStyle = '#4a3324';
      for (let i = 0; i < 3; i++) { const px = x + 8 + i * (w - 20) / 3; ctx.beginPath(); ctx.arc(px + 5, y + h * 0.18, 6, 0, TAU); ctx.fill(); }
      break;
    }
    case 'staircase': {
      shadowBlob(ctx, x + w * 0.6, y + h * 0.9, w * 0.7, h * 0.25);
      // landing + two flights going up-left
      ctx.fillStyle = '#2b2118';
      ctx.fillRect(x, y, w, h);
      const steps = 9;
      for (let i = 0; i < steps; i++) {
        const sx = x + (i / steps) * w * 0.62;
        const sw = w * 0.62 / steps;
        ctx.fillStyle = shade('#3a2a1a', 0.75 + (i / steps) * 0.5);
        ctx.fillRect(sx, y + 20, sw - 3, h - 40);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(sx, y + h - 24, sw - 3, 5);
      }
      // banisters
      ctx.fillStyle = '#20160e';
      ctx.fillRect(x, y + 6, w * 0.66, 12);
      ctx.fillRect(x, y + h - 18, w * 0.66, 12);
      // upper floor strip (dark)
      ctx.fillStyle = '#12100f';
      ctx.fillRect(x + w * 0.62, y, w * 0.38, h);
      ctx.fillStyle = 'rgba(255,200,140,0.05)';
      ctx.fillRect(x + w * 0.62, y, w * 0.38, 4);
      // red carpet runner up the middle
      ctx.fillStyle = 'rgba(90,16,26,0.55)';
      ctx.fillRect(x + 12, y + h * 0.34, w * 0.6, h * 0.3);
      break;
    }
    case 'sofa': {
      shadowBlob(ctx, x + w / 2, y + h * 0.85, w * 0.55, h * 0.22);
      wood(ctx, x, y + 8, w, h - 8, '#3a1f26', '#4a2830');
      ctx.fillStyle = '#542b34';
      ctx.fillRect(x + 4, y + 12, w - 8, h - 16);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + w / 2 - 2, y + 12, 4, h - 16);
      ctx.fillStyle = '#2a161c';
      ctx.fillRect(x, y, w, 12);
      break;
    }
    case 'armchair': {
      shadowBlob(ctx, x + w / 2, y + h * 0.85, w * 0.5, h * 0.2);
      wood(ctx, x, y, w, h, '#2f2233', '#3d2c42');
      ctx.fillStyle = '#3e2b45';
      ctx.fillRect(x + 6, y + 10, w - 12, h - 18);
      ctx.fillStyle = '#241a29';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.3, h * 0.28, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'longTable': {
      shadowBlob(ctx, x + w / 2, y + h * 0.9, w * 0.5, h * 0.22);
      wood(ctx, x, y, w, h, '#4a2f1a', '#5d3c22');
      ctx.fillStyle = 'rgba(220,190,150,0.07)';
      ctx.fillRect(x + 10, y + 8, w - 20, h - 16);
      ctx.strokeStyle = 'rgba(255,225,180,0.09)'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 12, y + 10, w - 24, h - 20);
      // dust rings left by glasses
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const cx = x + 40 + hash2(i, f.seed, 3) * (w - 80);
        const cy = y + 24 + hash2(i, f.seed, 9) * (h - 48);
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.stroke();
      }
      break;
    }
    case 'chair': {
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(f.rot || 0);
      shadowBlob(ctx, 0, h * 0.4, w * 0.4, h * 0.15, 0.4);
      wood(ctx, -w / 2, -h / 2, w, h, '#3a2718', '#4a3320');
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.28);
      ctx.restore();
      break;
    }
    case 'cabinet': {
      shadowBlob(ctx, x + w / 2, y + h * 0.92, w * 0.5, h * 0.18);
      wood(ctx, x, y, w, h, '#33210f', '#452c14');
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
      const vertical = f.vertical;
      const n = vertical ? Math.round(h / 46) : Math.round(w / 46);
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        if (vertical) { const yy = y + (h / n) * i; ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
        else { const xx = x + (w / n) * i; ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
        ctx.stroke();
      }
      ctx.fillStyle = '#8a6a2c';
      for (let i = 0; i < n; i++) {
        if (vertical) ctx.fillRect(x + w / 2 - 3, y + (h / n) * (i + 0.5) - 3, 6, 6);
        else ctx.fillRect(x + (w / n) * (i + 0.5) - 3, y + h / 2 - 3, 6, 6);
      }
      break;
    }
    case 'sideTable': {
      shadowBlob(ctx, x + w / 2, y + h * 0.88, w * 0.5, h * 0.2);
      wood(ctx, x, y, w, h, '#3a2718', '#4a3320');
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
      break;
    }
    case 'shelf': {
      shadowBlob(ctx, x + w / 2, y + h * 0.95, w * 0.55, h * 0.1);
      ctx.fillStyle = '#241708';
      ctx.fillRect(x, y, w, h);
      const rows = Math.max(2, Math.round(h / 54));
      for (let r = 0; r < rows; r++) {
        const ry = y + (h / rows) * r + 5;
        ctx.fillStyle = '#2e1d0e';
        ctx.fillRect(x + 2, ry, w - 4, h / rows - 8);
        // books
        let bx = x + 4;
        while (bx < x + w - 6) {
          const bw = 4 + hash2(bx | 0, ry | 0, f.seed) * 5;
          const bh = (h / rows - 12) * (0.7 + hash2(ry | 0, bx | 0, 3) * 0.3);
          const hue = hash2(bx | 0, ry | 0, 11);
          ctx.fillStyle = hue > 0.75 ? '#4a1f28' : hue > 0.5 ? '#2c3a2a' : hue > 0.25 ? '#3a2f1a' : '#2a2436';
          ctx.fillRect(bx, ry + (h / rows - 12) - bh, bw, bh);
          ctx.fillStyle = 'rgba(200,180,120,0.10)';
          ctx.fillRect(bx, ry + (h / rows - 12) - bh + 2, bw, 1.5);
          bx += bw + 1.5;
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + h - 4, w, 4);
      break;
    }
    case 'desk': {
      shadowBlob(ctx, x + w / 2, y + h * 0.9, w * 0.5, h * 0.2);
      wood(ctx, x, y, w, h, '#3d2a18', '#4e3520');
      // papers and a closed book
      ctx.fillStyle = 'rgba(210,200,175,0.35)';
      ctx.save(); ctx.translate(x + w * 0.28, y + h * 0.5); ctx.rotate(-0.12);
      ctx.fillRect(-26, -18, 52, 36); ctx.restore();
      ctx.fillStyle = '#5a1a22';
      ctx.fillRect(x + w * 0.62, y + h * 0.35, 44, 30);
      ctx.fillStyle = 'rgba(220,200,150,0.25)';
      ctx.fillRect(x + w * 0.62, y + h * 0.35 + 12, 44, 3);
      // quill
      ctx.strokeStyle = '#c9c2ae'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + w * 0.45, y + h * 0.6); ctx.lineTo(x + w * 0.52, y + h * 0.35); ctx.stroke();
      break;
    }
    case 'crates': {
      shadowBlob(ctx, x + w / 2, y + h * 0.92, w * 0.5, h * 0.16);
      wood(ctx, x, y, w, h, '#33240f', '#422f14');
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
      ctx.stroke();
      break;
    }
    case 'barrel': {
      shadowBlob(ctx, x + w / 2, y + h * 0.9, w * 0.5, h * 0.2);
      ctx.fillStyle = '#2c1e10';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2814';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 5, h / 2 - 5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4a4a52'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, 0, 0, TAU); ctx.stroke();
      break;
    }
    case 'wineRack': {
      shadowBlob(ctx, x + w / 2, y + h * 0.95, w * 0.5, h * 0.12);
      wood(ctx, x, y, w, h, '#241708', '#2f1e0b');
      const vertical = f.vertical;
      const n = vertical ? Math.round(h / 34) : Math.round(w / 34);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 2; j++) {
          const cx = vertical ? x + (j ? w * 0.72 : w * 0.28) : x + (w / n) * (i + 0.5);
          const cy = vertical ? y + (h / n) * (i + 0.5) : y + (j ? h * 0.72 : h * 0.28);
          ctx.fillStyle = '#0d0a08';
          ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.fill();
          ctx.fillStyle = hash2(i, j, f.seed) > 0.6 ? '#231018' : '#141a16';
          ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, TAU); ctx.fill();
        }
      }
      break;
    }
    case 'stairRail': {
      ctx.fillStyle = '#1c140c';
      ctx.fillRect(x, y, w, h);
      break;
    }
  }
}
