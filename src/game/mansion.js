/* LAST NIGHT — the mansion
 *
 * One hand-authored gothic mansion assembled from a data-driven floor plan:
 * eleven rooms, shared masonry, internal passages, exterior doors and
 * windows, room-relative furniture, lights, collision and navigation. The
 * Survival simulation and full WebGL scene consume the same world layout.
 *
 * Floor plan (world pixels; north is negative Y):
 *
 *                  GALLERY ─ DINING ─ HALL ─ LIBRARY ─ CONSERVATORY
 *                       │         │       │        │
 *                  GATEHOUSE   KITCHEN  STUDY   ORATORY
 *                       │              BASEMENT ─ CHAPEL
 *
 * The hall is the cross-wing hub; side rooms connect through deliberate
 * openings. Shared boundaries are merged so walls and collision agree.
 */

import { clamp, rand, randInt, chance, TAU } from '../core/util.js';
import { DOOR } from '../core/config.js';
import { makeExterior } from './exterior.js';

export const ROOM = {
  DINING: 'dining',
  LIBRARY: 'library',
  HALL: 'hall',
  BASEMENT: 'basement',
  CONSERV: 'conservatory',
  CHAPEL: 'chapel',
  KITCHEN: 'kitchen',
  STUDY: 'study',
  GALLERY: 'gallery',
  GATEHOUSE: 'gatehouse',
  ORATORY: 'oratory',
  OUTSIDE: 'outside',
};

const WALL_T = 26;

export class Mansion {
  constructor() {
    this.bounds = { x: -1500, y: -700, w: 4080, h: 2500 };
    this.camBounds = { x: -2900, y: -2100, w: 6880, h: 5300 };
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
    this.dressFurniture();
    // Outdoor dressing is generated from the same house bounds as the room
    // kit. Its tree and boulder footprints enter collision/pathfinding before
    // the grid is baked, so the forest is scenery you can actually walk around.
    this.exterior = makeExterior(this);
    this.solids.push(...this.exterior.blockers);
    this.buildGrid();
    // rasterise walkability only after the collision grid exists
    this.buildNav();
  }

  /* ================= geometry ================= */

  rooms = {};

  build() {
    const plan = [
      { key: 'dining', id: ROOM.DINING, name: 'DINING ROOM', x: -806, y: 0, w: 780, h: 600, floor: 'wood', dark: 0.72 },
      { key: 'library', id: ROOM.LIBRARY, name: 'LIBRARY', x: 906, y: 0, w: 780, h: 600, floor: 'wood', dark: 0.78 },
      { key: 'hall', id: ROOM.HALL, name: 'MAIN HALL', x: 0, y: 0, w: 880, h: 620, floor: 'marble', dark: 0.62 },
      { key: 'basement', id: ROOM.BASEMENT, name: 'BASEMENT', x: 190, y: 646, w: 500, h: 680, floor: 'stone', dark: 1.35 },
      { key: 'conserv', id: ROOM.CONSERV, name: 'CONSERVATORY', x: 1712, y: 10, w: 554, h: 580, floor: 'glass', dark: 0.42 },
      { key: 'chapel', id: ROOM.CHAPEL, name: 'CHAPEL', x: 716, y: 646, w: 507, h: 694, floor: 'tile', dark: 0.68 },
      { key: 'kitchen', id: ROOM.KITCHEN, name: 'KITCHEN', x: -1186, y: 50, w: 354, h: 500, floor: 'stone', dark: 0.7 },
      { key: 'study', id: ROOM.STUDY, name: 'STUDY', x: 80, y: -346, w: 720, h: 320, floor: 'wood', dark: 0.66 },
      { key: 'gallery', id: ROOM.GALLERY, name: 'GALLERY', x: -686, y: -306, w: 540, h: 280, floor: 'wood', dark: 0.68 },
      { key: 'gatehouse', id: ROOM.GATEHOUSE, name: 'GATEHOUSE', x: -593, y: 626, w: 354, h: 850, floor: 'stone', dark: 0.7 },
      { key: 'oratory', id: ROOM.ORATORY, name: 'ORATORY', x: 1056, y: -306, w: 480, h: 280, floor: 'tile', dark: 0.6 },
    ];
    this.rooms = Object.create(null);
    this.roomList = plan.map((r) => {
      const room = { ...r };
      this.rooms[room.key] = room;
      return room;
    });
    this.solids = [];
    this.furniture = [];
    this.props = [];
    this.lights = [];
    this.entrances = [];
    this.spawns = [];
    this.portals = [];
    this.passages = [];
    this.bounds = { x: -1500, y: -700, w: 4080, h: 2500 };
    const cameraPad = 1400;
    this.camBounds = {
      x: this.bounds.x - cameraPad, y: this.bounds.y - cameraPad,
      w: this.bounds.w + cameraPad * 2, h: this.bounds.h + cameraPad * 2,
    };

    /*
     * A clear, connected cross-wing plan: the hall is the hub; dining and
     * library form its west/east arms; kitchen and conservatory cap those
     * arms; the gallery, study and oratory are quiet north rooms; the
     * gatehouse, cellar and chapel make a legible south route. Every room has
     * an intentional opening and its furniture is authored relative to that
     * room, so moving a wing can never strand its props or collision boxes.
     *
     * Interiors are separated by one 26px wall. Shared boundaries are
     * collected into one wall run before openings are cut, avoiding doubled
     * masonry and making the collision plan match the 3D kit exactly.
     */
    const roomByKey = (key) => this.rooms[key];
    const edgeOf = (room, side) => {
      if (side === 'north') return { axis: 'h', pos: room.y - WALL_T / 2, from: room.x, to: room.x + room.w };
      if (side === 'south') return { axis: 'h', pos: room.y + room.h + WALL_T / 2, from: room.x, to: room.x + room.w };
      if (side === 'west') return { axis: 'v', pos: room.x - WALL_T / 2, from: room.y, to: room.y + room.h };
      return { axis: 'v', pos: room.x + room.w + WALL_T / 2, from: room.y, to: room.y + room.h };
    };
    const edgeKey = (axis, pos) => `${axis}:${Math.round(pos * 100) / 100}`;
    const edges = new Map();
    for (const room of this.roomList) {
      for (const side of ['north', 'east', 'south', 'west']) {
        const edge = edgeOf(room, side);
        const key = edgeKey(edge.axis, edge.pos);
        let line = edges.get(key);
        if (!line) edges.set(key, (line = { axis: edge.axis, pos: edge.pos, spans: [] }));
        line.spans.push([edge.from, edge.to]);
      }
    }

    const specs = [
      { id: 'galleryPassage', kind: 'arch', room: 'gallery', side: 'south', at: -416, width: 140, to: 'dining' },
      { id: 'studyPassage', kind: 'arch', room: 'study', side: 'south', at: 440, width: 156, to: 'hall' },
      { id: 'oratoryPassage', kind: 'arch', room: 'oratory', side: 'south', at: 1296, width: 136, to: 'library' },
      { id: 'kitchenPassage', kind: 'arch', room: 'kitchen', side: 'east', at: 300, width: 142, to: 'dining' },
      { id: 'diningHallPassage', kind: 'arch', room: 'dining', side: 'east', at: 300, width: 160, to: 'hall' },
      { id: 'hallLibraryPassage', kind: 'arch', room: 'hall', side: 'east', at: 300, width: 160, to: 'library' },
      { id: 'glassWingPassage', kind: 'arch', room: 'library', side: 'east', at: 300, width: 156, to: 'conserv' },
      { id: 'galleryGatePassage', kind: 'arch', room: 'dining', side: 'south', at: -416, width: 146, to: 'gatehouse' },
      { id: 'cellarStair', kind: 'arch', room: 'hall', side: 'south', at: 440, width: 154, to: 'basement' },
      { id: 'chapelPassage', kind: 'arch', room: 'basement', side: 'east', at: 985, width: 148, to: 'chapel' },

      { id: 'diningDoor', kind: 'door', name: 'SERVANT DOOR', room: 'dining', side: 'north', at: -746, width: 112 },
      { id: 'frontDoor', kind: 'door', name: 'FRONT DOOR', room: 'hall', side: 'south', at: 100, width: 136 },
      { id: 'cellarDoor', kind: 'door', name: 'CELLAR DOOR', room: 'basement', side: 'south', at: 440, width: 126 },
      { id: 'chapelDoor', kind: 'door', name: 'CHAPEL DOOR', room: 'chapel', side: 'south', at: 969.5, width: 126 },
      { id: 'kitchenDoor', kind: 'door', name: 'SCULLERY DOOR', room: 'kitchen', side: 'west', at: 300, width: 118 },
      { id: 'palisade', kind: 'door', name: 'PALISADE GATE', room: 'gatehouse', side: 'west', at: 865, width: 124 },
      { id: 'postern', kind: 'door', name: 'POSTERN', room: 'gatehouse', side: 'west', at: 1215, width: 116 },

      { id: 'diningWindow', kind: 'window', name: 'BAY WINDOW', room: 'dining', side: 'south', at: -700, width: 116 },
      { id: 'hallWindow', kind: 'window', name: 'TALL WINDOW', room: 'hall', side: 'south', at: 750, width: 116 },
      { id: 'kitchenWindow', kind: 'window', name: 'SCULLERY WINDOW', room: 'kitchen', side: 'north', at: -1010, width: 112 },
      { id: 'studyWindow', kind: 'window', name: 'STUDY WINDOW', room: 'study', side: 'north', at: 440, width: 128 },
      { id: 'galleryWindow', kind: 'window', name: 'GALLERY WINDOW', room: 'gallery', side: 'north', at: -416, width: 132 },
      { id: 'oratoryWindow', kind: 'window', name: 'ORATORY WINDOW', room: 'oratory', side: 'north', at: 1296, width: 132 },
      { id: 'glassNorth', kind: 'window', name: 'SKYLIGHT ROW', room: 'conserv', side: 'north', at: 1989, width: 150 },
      { id: 'glassEast', kind: 'window', name: 'PANE WALL', room: 'conserv', side: 'east', at: 300, width: 166 },
      { id: 'chapelWindow', kind: 'window', name: 'ROSE WINDOW', room: 'chapel', side: 'east', at: 1000, width: 132 },
    ];

    for (const spec of specs) {
      const room = roomByKey(spec.room);
      const side = spec.side;
      const edge = edgeOf(room, side);
      const a1 = spec.at - spec.width / 2;
      const a2 = spec.at + spec.width / 2;
      const x = edge.axis === 'h' ? spec.at : edge.pos;
      const y = edge.axis === 'h' ? edge.pos : spec.at;
      const portal = { ...spec, axis: edge.axis, pos: edge.pos, a1, a2, x, y, room: room.id };
      this.portals.push(portal);
      if (spec.kind === 'door' || spec.kind === 'window') {
        const make = spec.kind === 'door' ? this.makeDoor.bind(this) : this.makeWindow.bind(this);
        const entrance = make(spec.id, spec.name, a1, a2, edge.pos, edge.axis, side, room.id);
        entrance.exterior = true;
        entrance.portal = portal;
        this.entrances.push(entrance);
        this[spec.id] = entrance;
      } else if (spec.to) {
        const target = roomByKey(spec.to);
        this.passages.push({ a: room.id, b: target.id, x, y, r: spec.width / 2, id: spec.id });
      }
    }

    const gapsByLine = new Map();
    for (const portal of this.portals) {
      const key = edgeKey(portal.axis, portal.pos);
      let gaps = gapsByLine.get(key);
      if (!gaps) gapsByLine.set(key, (gaps = []));
      gaps.push([portal.a1, portal.a2]);
    }
    for (const line of edges.values()) {
      const sorted = line.spans.slice().sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const span of sorted) {
        const last = merged[merged.length - 1];
        if (last && span[0] <= last[1] + 2) last[1] = Math.max(last[1], span[1]);
        else merged.push(span.slice());
      }
      const openings = gapsByLine.get(edgeKey(line.axis, line.pos)) || [];
      for (const [from, to] of merged) {
        const gaps = openings
          .filter(([a, b]) => b > from && a < to)
          .map(([a, b]) => [Math.max(from, a), Math.min(to, b)]);
        this.wallRun(line.axis, from, to, line.pos, gaps);
      }
    }

    this.furnish();
    this.makeLights();
    this.makeSpawns();
    this.threshold = [];
    const libraryOpening = this.portals.find((p) => p.id === 'glassWingPassage');
    this.libraryArch = libraryOpening ? { x: libraryOpening.x, y: libraryOpening.y, w: WALL_T, h: libraryOpening.width } : null;
    this.kitchenDoor.hp = this.kitchenDoor.hpMax = this.kitchenDoor.baseHpMax = 78;
    this.palisade.hp = this.palisade.hpMax = this.palisade.baseHpMax = 210;
    this.postern.hp = this.postern.hpMax = this.postern.baseHpMax = 72;
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
    const b = this.bounds;
    this.navX0 = Math.floor((b.x - 80) / this.navCell) * this.navCell;
    this.navY0 = Math.floor((b.y - 80) / this.navCell) * this.navCell;
    this.navX1 = Math.ceil((b.x + b.w + 80) / this.navCell) * this.navCell;
    this.navY1 = Math.ceil((b.y + b.h + 80) / this.navCell) * this.navCell;
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
    this.navVersion = (this.navVersion || 0) + 1;
  }

  /**
   * Recompute only the cells an entrance can affect. A door that breaks (or is
   * rebuilt) changes routing; rebuilding the whole grid for that is wasteful.
   */
  refreshNavAround(e, pad = 1) {
    if (!this.nav || !e) return;
    const c = this.navCell;
    const r = 13 + c * pad;
    const gx0 = Math.max(0, Math.floor((e.x - e.w / 2 - r - this.navX0) / c));
    const gx1 = Math.min(this.navW - 1, Math.floor((e.x + e.w / 2 + r - this.navX0) / c));
    const gy0 = Math.max(0, Math.floor((e.y - e.h / 2 - r - this.navY0) / c));
    const gy1 = Math.min(this.navH - 1, Math.floor((e.y + e.h / 2 + r - this.navY0) / c));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = this.navX0 + (gx + 0.5) * c;
        const cy = this.navY0 + (gy + 0.5) * c;
        this.nav[gy * this.navW + gx] = this.navBlocked(cx, cy) ? 1 : 0;
      }
    }
    this.navVersion = (this.navVersion || 0) + 1;
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
   * space) or null when there is genuinelyly no way through.
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
    const b = this.bounds;
    const x0 = b.x + 100, y0 = b.y + 100;
    const x1 = b.x + b.w - 100, y1 = b.y + b.h - 100;
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
    const F = (room, fx, fy, w, h, type, o = {}) => this.addF(
      room.x + room.w * fx - w / 2,
      room.y + room.h * fy - h / 2,
      w, h, type, { room: room.id, ...o },
    );
    const P = (room, fx, fy, type, o = {}) => this.addP(
      type, room.x + room.w * fx, room.y + room.h * fy, { room: room.id, ...o },
    );

    /* ---------- MAIN HALL — broad centre, with a clean cross-wing lane ---------- */
    F(R.hall, 0.20, 0.22, 210, 190, 'staircase');
    F(R.hall, 0.20, 0.22, 210, 28, 'stairRail', { solid: false });
    F(R.hall, 0.70, 0.20, 112, 82, 'sofa');
    F(R.hall, 0.83, 0.20, 112, 82, 'sofa');
    F(R.hall, 0.77, 0.72, 132, 66, 'sideTable');
    F(R.hall, 0.19, 0.73, 66, 132, 'sideTable');
    F(R.hall, 0.50, 0.82, 172, 72, 'cabinet');
    F(R.hall, 0.78, 0.86, 102, 102, 'armchair');
    P(R.hall, 0.50, 0.61, 'carpet', { w: 300, h: 380, color: 'crimson', seed: 11 });
    P(R.hall, 0.45, 0.40, 'candelabra', { light: true });
    P(R.hall, 0.58, 0.68, 'candelabra', { light: true });
    P(R.hall, 0.83, 0.38, 'clock');
    P(R.hall, 0.05, 0.35, 'portrait', { vertical: true, big: true });
    P(R.hall, 0.95, 0.36, 'portrait', { vertical: true });
    P(R.hall, 0.08, 0.08, 'cobweb');
    P(R.hall, 0.91, 0.92, 'cobweb');

    /* ---------- DINING — the servant-door apron stays empty ---------- */
    F(R.dining, 0.53, 0.53, 360, 110, 'longTable');
    for (let i = 0; i < 8; i++) {
      const col = (i % 4) / 5 + 0.30;
      F(R.dining, col, i < 4 ? 0.35 : 0.71, 54, 54, 'chair', { rot: i < 4 ? 0 : Math.PI });
    }
    F(R.dining, 0.18, 0.18, 130, 54, 'cabinet');
    F(R.dining, 0.82, 0.82, 128, 90, 'sideTable');
    P(R.dining, 0.53, 0.53, 'carpet', { w: 520, h: 360, color: 'purple', seed: 12 });
    for (let i = 0; i < 5; i++) P(R.dining, 0.30 + i * 0.10, 0.53, 'candleStand', { light: i % 2 === 0 });
    P(R.dining, 0.53, 0.53, 'candelabra', { light: true, onTable: true });
    P(R.dining, 0.27, 0.04, 'portrait');
    P(R.dining, 0.76, 0.04, 'portrait');
    P(R.dining, 0.96, 0.07, 'cobweb');

    /* ---------- LIBRARY — perimeter stacks, an open centre aisle ---------- */
    for (let i = 0; i < 4; i++) F(R.library, 0.16 + i * 0.16, 0.13, 58, 150, 'shelf');
    F(R.library, 0.91, 0.20, 58, 150, 'shelf');
    F(R.library, 0.91, 0.80, 58, 150, 'shelf');
    F(R.library, 0.28, 0.40, 340, 76, 'desk');
    F(R.library, 0.59, 0.42, 86, 78, 'armchair');
    F(R.library, 0.68, 0.78, 72, 148, 'cabinet');
    P(R.library, 0.50, 0.06, 'fireplace', { w: 220, h: 70 });
    P(R.library, 0.56, 0.67, 'carpet', { w: 360, h: 250, color: 'dark', seed: 13 });
    P(R.library, 0.62, 0.41, 'deskLamp', { light: true });
    P(R.library, 0.84, 0.35, 'candleStand', { light: true });
    P(R.library, 0.33, 0.39, 'books');
    P(R.library, 0.50, 0.04, 'portrait');
    P(R.library, 0.96, 0.08, 'cobweb');

    /* ---------- BASEMENT — a dark store room with the basin on its flank ---------- */
    for (let i = 0; i < 3; i++) F(R.basement, 0.22 + i * 0.18, 0.16, 82, 82, 'crates');
    F(R.basement, 0.17, 0.48, 190, 58, 'wineRack');
    F(R.basement, 0.17, 0.72, 190, 58, 'wineRack');
    F(R.basement, 0.84, 0.26, 64, 210, 'wineRack', { vertical: true });
    F(R.basement, 0.58, 0.82, 140, 82, 'crates');
    F(R.basement, 0.27, 0.87, 66, 66, 'barrel');
    F(R.basement, 0.42, 0.90, 66, 66, 'barrel');
    P(R.basement, 0.78, 0.78, 'basin', { w: 76, h: 76 });
    P(R.basement, 0.12, 0.14, 'candleStand', { light: true, dim: true });
    P(R.basement, 0.88, 0.08, 'cobweb');
    P(R.basement, 0.91, 0.92, 'cobweb');
    P(R.basement, 0.48, 0.43, 'bones');
    P(R.basement, 0.70, 0.57, 'bones');

    /* ---------- CONSERVATORY — glass, overgrowth, a fountain, clear exits ---------- */
    for (let i = 0; i < 4; i++) {
      F(R.conserv, 0.18 + i * 0.20, 0.14, 68, 68, 'planter');
      F(R.conserv, 0.18 + i * 0.20, 0.86, 68, 68, 'planter');
    }
    F(R.conserv, 0.52, 0.50, 116, 116, 'fountain');
    F(R.conserv, 0.88, 0.25, 54, 140, 'pottingBench');
    F(R.conserv, 0.88, 0.76, 54, 140, 'pottingBench');
    P(R.conserv, 0.22, 0.50, 'mossPatch');
    P(R.conserv, 0.76, 0.64, 'mossPatch');
    P(R.conserv, 0.10, 0.12, 'urn');
    P(R.conserv, 0.92, 0.12, 'urn');
    P(R.conserv, 0.32, 0.72, 'candleStand', { light: true, dim: true });
    P(R.conserv, 0.74, 0.34, 'candleStand', { light: true, dim: true });
    P(R.conserv, 0.24, 0.05, 'hangingVine');
    P(R.conserv, 0.58, 0.05, 'hangingVine');
    P(R.conserv, 0.88, 0.05, 'hangingVine');
    P(R.conserv, 0.96, 0.96, 'cobweb');

    /* ---------- CHAPEL — paired pew banks frame a strong, readable aisle ---------- */
    F(R.chapel, 0.50, 0.18, 190, 62, 'altar');
    for (let i = 0; i < 3; i++) {
      const fy = 0.43 + i * 0.15;
      F(R.chapel, 0.28, fy, 156, 38, 'pew');
      F(R.chapel, 0.72, fy, 156, 38, 'pew');
    }
    F(R.chapel, 0.86, 0.86, 78, 78, 'font', { solid: false });
    P(R.chapel, 0.50, 0.04, 'stainedGlass', { w: 210, h: 74 });
    P(R.chapel, 0.25, 0.26, 'candleStand', { light: true });
    P(R.chapel, 0.75, 0.26, 'candleStand', { light: true });
    P(R.chapel, 0.50, 0.64, 'carpet', { w: 178, h: 400, color: 'crimson', seed: 17 });
    P(R.chapel, 0.12, 0.22, 'urn');
    P(R.chapel, 0.90, 0.88, 'bones');
    P(R.chapel, 0.96, 0.08, 'cobweb');

    /* ---------- KITCHEN — apron between the two doors, larder within reach ---------- */
    F(R.kitchen, 0.22, 0.16, 148, 52, 'cabinet');
    F(R.kitchen, 0.72, 0.16, 112, 52, 'cabinet');
    F(R.kitchen, 0.16, 0.83, 66, 66, 'barrel');
    F(R.kitchen, 0.82, 0.82, 66, 66, 'barrel');
    F(R.kitchen, 0.84, 0.50, 58, 128, 'sideTable');
    P(R.kitchen, 0.70, 0.58, 'larder', { w: 86, h: 54 });
    P(R.kitchen, 0.25, 0.30, 'candleStand', { light: true });
    P(R.kitchen, 0.70, 0.80, 'candleStand', { light: true, dim: true });
    P(R.kitchen, 0.92, 0.10, 'cobweb');

    /* ---------- STUDY — the lamp-lit ward is a meaningful detour, not a trap ---------- */
    F(R.study, 0.48, 0.28, 210, 70, 'desk');
    F(R.study, 0.86, 0.64, 54, 160, 'shelf');
    F(R.study, 0.22, 0.70, 84, 84, 'armchair');
    P(R.study, 0.51, 0.63, 'ward');
    P(R.study, 0.47, 0.24, 'deskLamp', { light: true });
    P(R.study, 0.16, 0.78, 'candleStand', { light: true, dim: true });
    P(R.study, 0.20, 0.27, 'books');
    P(R.study, 0.78, 0.04, 'portrait');
    this.studyWard = { x: R.study.x + R.study.w * 0.51, y: R.study.y + R.study.h * 0.63, r: 150, until: 0, readyAt: 0 };

    /* ---------- GALLERY — quiet portrait room, approached from dining ---------- */
    F(R.gallery, 0.24, 0.56, 132, 32, 'pew');
    F(R.gallery, 0.76, 0.56, 132, 32, 'pew');
    F(R.gallery, 0.50, 0.78, 64, 40, 'sideTable');
    P(R.gallery, 0.18, 0.06, 'portrait');
    P(R.gallery, 0.82, 0.06, 'portrait', { big: true });
    P(R.gallery, 0.42, 0.78, 'candleStand', { light: true });
    P(R.gallery, 0.68, 0.78, 'candleStand', { light: true, dim: true });

    /* ---------- GATEHOUSE — two outer approaches, cover kept to the sides ---------- */
    F(R.gatehouse, 0.17, 0.27, 72, 72, 'crates');
    F(R.gatehouse, 0.82, 0.30, 72, 54, 'barrel');
    F(R.gatehouse, 0.18, 0.82, 86, 52, 'crates');
    P(R.gatehouse, 0.50, 0.58, 'stakes');
    P(R.gatehouse, 0.16, 0.45, 'candleStand', { light: true });
    P(R.gatehouse, 0.82, 0.76, 'candleStand', { light: true, dim: true });

    /* ---------- ORATORY — the cold, private counterpoint to the chapel ---------- */
    F(R.oratory, 0.50, 0.30, 150, 48, 'altar');
    F(R.oratory, 0.22, 0.74, 94, 42, 'pew', { solid: false });
    F(R.oratory, 0.78, 0.74, 94, 42, 'pew', { solid: false });
    P(R.oratory, 0.22, 0.66, 'candleStand', { light: true, dim: true });
    P(R.oratory, 0.78, 0.66, 'candleStand', { light: true, dim: true });
    P(R.oratory, 0.12, 0.18, 'urn');
  }

  makeLights() {
    const R = this.rooms;
    const point = (room, fx = 0.5, fy = 0.5) => ({ x: room.x + room.w * fx, y: room.y + room.h * fy });
    const L = (o) => this.lights.push({ on: true, flicker: 1, seed: rand(0, 100), ...o });

    const hall = point(R.hall, 0.50, 0.48);
    L({ id: 'chandelier', ...hall, r: 350, i: 0.95, color: [255, 186, 120], flick: 0.1, room: ROOM.HALL, type: 'chandelier' });
    for (const p of this.props) {
      if (p.type === 'candelabra' && p.light) L({ x: p.x, y: p.y, r: 175, i: 0.72, color: [255, 175, 110], flick: 0.3, room: p.room, type: 'candle' });
      if (p.type === 'candleStand' && p.light) L({ x: p.x, y: p.y, r: 135, i: p.dim ? 0.34 : 0.6, color: [255, 170, 105], flick: 0.35, room: p.room, type: 'candle' });
      if (p.type === 'deskLamp' && p.light) L({ x: p.x, y: p.y, r: 155, i: 0.55, color: [255, 190, 130], flick: 0.12, room: p.room, type: 'lamp' });
    }

    const hearth = this.props.find((p) => p.type === 'fireplace');
    const fireplace = hearth || point(R.library, 0.50, 0.10);
    L({ id: 'fireplace', x: fireplace.x, y: fireplace.y, r: 300, i: 0.95, color: [255, 145, 60], flick: 0.5, room: ROOM.LIBRARY, type: 'fire' });
    this.fireplaceLight = this.lights[this.lights.length - 1];

    const altar = point(R.chapel, 0.50, 0.18);
    L({ id: 'altar', ...altar, r: 300, i: 0.8, color: [238, 214, 160], flick: 0.22, room: ROOM.CHAPEL, type: 'relic' });
    this.altarLight = this.lights[this.lights.length - 1];
    this.chapelAltar = { ...altar, r: 175 };
    L({ ...point(R.chapel, 0.50, 0.20), r: 190, i: 0.5, color: [190, 190, 235], flick: 0.15, room: ROOM.CHAPEL, type: 'moon' });

    const glass = R.conserv;
    L({ ...point(glass, 0.33, 0.34), r: 260, i: 0.55, color: [150, 190, 245], flick: 0, room: ROOM.CONSERV, type: 'moon' });
    L({ ...point(glass, 0.74, 0.68), r: 230, i: 0.5, color: [150, 190, 245], flick: 0, room: ROOM.CONSERV, type: 'moon' });

    for (const e of this.entrances) {
      if (e.kind !== 'window') continue;
      L({ x: e.inside.x, y: e.inside.y, r: 250, i: 0.5, color: [150, 190, 245], flick: 0, room: e.room, type: 'moon' });
      L({ x: e.x, y: e.y, r: 210, i: 0.42, color: [140, 180, 240], flick: 0, room: e.room, type: 'moon' });
    }
    L({ x: this.frontDoor.inside.x, y: this.frontDoor.inside.y, r: 190, i: 0.35, color: [140, 175, 235], flick: 0, room: ROOM.HALL, type: 'moon' });

    const basement = point(R.basement, 0.50, 0.55);
    const kitchen = point(R.kitchen, 0.50, 0.52);
    const study = point(R.study, 0.53, 0.62);
    const gallery = point(R.gallery, 0.50, 0.57);
    const gatehouse = point(R.gatehouse, 0.50, 0.58);
    const oratory = point(R.oratory, 0.50, 0.55);
    L({ id: 'basementLamp', ...basement, r: 210, i: 0.3, color: [255, 160, 90], flick: 0.6, room: ROOM.BASEMENT, type: 'lamp' });
    L({ id: 'kitchenLamp', ...kitchen, r: 220, i: 0.45, color: [255, 170, 110], flick: 0.2, room: ROOM.KITCHEN, type: 'lamp' });
    L({ id: 'studyLamp', ...study, r: 200, i: 0.4, color: [210, 190, 150], flick: 0.08, room: ROOM.STUDY, type: 'lamp' });
    L({ id: 'galleryLamp', ...gallery, r: 220, i: 0.48, color: [255, 176, 110], flick: 0.18, room: ROOM.GALLERY, type: 'candle' });
    L({ id: 'gatehouseFire', ...gatehouse, r: 220, i: 0.5, color: [255, 150, 80], flick: 0.28, room: ROOM.GATEHOUSE, type: 'fire' });
    L({ id: 'oratoryMoon', ...oratory, r: 230, i: 0.46, color: [170, 190, 230], flick: 0.05, room: ROOM.ORATORY, type: 'moon' });
  }

  makeSpawns() {
    const S = (x, y, entrance, weight = 1) => this.spawns.push({ x, y, entrance, weight });
    for (const e of this.entrances) {
      if (!e.exterior || !e.outside) continue;
      const offsets = e.kind === 'door' ? [-86, 0, 86] : [-72, 72];
      for (const offset of offsets) {
        const x = e.outside.x + (e.axis === 'h' ? offset : 0);
        const y = e.outside.y + (e.axis === 'v' ? offset : 0);
        S(x, y, e.id, e.kind === 'door' ? 1 : 0.78);
      }
    }
    const b = this.bounds;
    S(b.x + 120, b.y + b.h * 0.36, null, 0.65);
    S(b.x + b.w - 120, b.y + b.h * 0.42, null, 0.65);
    S(b.x + b.w * 0.42, b.y + 120, null, 0.55);
    S(b.x + b.w * 0.68, b.y + b.h - 120, null, 0.55);
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
    for (const s of this.barriers()) {
      // The fortress's gates open for the captain (BUILD 10: he walks out to
      // fight; survival.js swings the leaf when he walks at it). Only while it
      // is swinging open or open (sortieT > 0): shut, it is a wall to him too
      // (BUILD 11). They never open for the horde: a body is held until the
      // gate is broken.
      if (isPlayer && s.gate && this.isFortress && s.sortieT > 0) continue;
      // Entrances are authored by their CENTER (see makeDoor/makeWindow and
      // navBlocked). Treating x/y as a corner left the left/top half of every
      // closed door walkable.
      const left = s.x - s.w / 2, top = s.y - s.h / 2;
      const nx = clamp(x, left, left + s.w);
      const ny = clamp(y, top, top + s.h);
      const dx = x - nx, dy = y - ny, d = Math.hypot(dx, dy);
      if (d < r) {
        if (d < 0.0001) {
          const l = x - left, rr = left + s.w - x, t = y - top, b = top + s.h - y;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = left - r; else if (m === rr) x = left + s.w + r;
          else if (m === t) y = top - r; else y = top + s.h + r;
        } else { const push = (r - d) / d; x += dx * push * 1.2; y += dy * push * 1.2; }
        hit = true;
      }
    }
    return { x, y, hit };
  }

  /**
   * Continuous circle movement. `resolve()` only tests the destination, so a
   * fast actor could tunnel through a thin wall between frames. Substep every
   * displacement to less than half a body radius and resolve each sample;
   * this keeps doors, walls and furniture authoritative at any frame rate.
   */
  moveCircle(x, y, dx, dy, r, isPlayer = false) {
    const distance = Math.hypot(dx, dy);
    const maxStep = Math.max(2, Math.min(6, Math.max(1, r) * 0.45));
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    const sx = dx / steps, sy = dy / steps;
    let px = x, py = y, hit = false;
    for (let i = 0; i < steps; i++) {
      const result = this.resolve(px + sx, py + sy, r, isPlayer);
      px = result.x; py = result.y;
      hit = hit || result.hit;
    }
    return { x: px, y: py, hit };
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

  blocksSight(x, y, throughDoors = false) {
    for (const e of this.entrances) {
      // a closed door blocks sight, an open/broken one does not; nor does a
      // fortress gate swung open for the captain (e.sortie). throughDoors is
      // the legacy slit rule, no longer used by Survival (BUILD 10)
      if (e.kind === 'door' && !e.open && !e.broken && !e.sortie && x > e.x - e.w / 2 - 2 && x < e.x + e.w / 2 + 2 && y > e.y - e.h / 2 - 2 && y < e.y + e.h / 2 + 2) {
        if (!throughDoors) return true;
      }
      if (e.kind === 'window' && !e.broken && x > e.x - e.w / 2 && x < e.x + e.w / 2 && y > e.y - e.h / 2 && y < e.y + e.h / 2) return true;
    }
    const s = this.solidAt(x, y);
    if (!s) return false;
    if (s.type === 'furniture' && s.f && (s.f.type === 'chair' || s.f.type === 'sideTable')) return false;
    return true;
  }

  hasLOS(x1, y1, x2, y2, opts = null) {
    const through = !!(opts && opts.throughDoors);
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.ceil(d / 15));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksSight(x1 + dx * t, y1 + dy * t, through)) return false;
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
    const mul = (game && game.player && game.player.barricadeMul) || 1;
    if (e.kind === 'door') {
      e.hpMax = e.baseHpMax + DOOR.barricadeHp * mul;
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
      l.curI = l.i * (l.f ?? 1) * (1 - this.bloodMoon * 0.25) * (game.powerOut ? 0.6 : 1) * (1 - (game.duelDark || 0));
    }
    // fire in the library dies down during a blackout, embers only
  }

  /**
   * THE SIZE FURNITURE ACTUALLY IS.
   *
   * The plan was drawn in sprite units, and a sprite is drawn at whatever
   * size reads well next to a 72px woman: a "chair" is 54px across and the
   * dining table is 560 long. Measured against the floor — 50 world px to
   * the metre, which is what the woman's 1.7m buys — that chair is a metre
   * wide and that table is eleven metres long, in a fifteen metre room. The
   * rooms were not cramped by design; they were cramped by arithmetic.
   *
   * So every piece keeps the spot it was given and takes the size the thing
   * is in a house. It shrinks TOWARD whichever wall it was standing against
   * (or about its own middle, if it stood in the middle of the room), so
   * nothing that was flush is left floating. The solids a body collides with
   * are updated with it: this is the same furniture, smaller.
   */
  dressFurniture() {
    const M = 50;                       // world px to the metre, on the floor
    const SIZE = {                      // metres, the two sides of the footprint
      chair: [0.55, 0.55], armchair: [0.9, 0.9], sofa: [1.7, 0.9], pew: [3.0, 0.5],
      longTable: [5.0, 1.1], desk: [2.0, 0.8], sideTable: [0.9, 0.6],
      pottingBench: [1.5, 0.6], altar: [2.0, 0.8], cabinet: [1.5, 0.5],
      barrel: [0.6, 0.6], crates: [0.8, 0.8], shelf: [2.5, 0.4], wineRack: [1.2, 0.4],
      staircase: [3.0, 2.6], stairRail: [3.0, 0.4],
      fountain: [2.0, 2.0], planter: [0.8, 0.8], font: [0.9, 0.9],
    };
    const roomOf = (f) => Object.values(this.rooms).find((r) =>
      f.x + f.w / 2 >= r.x && f.x + f.w / 2 < r.x + r.w
      && f.y + f.h / 2 >= r.y && f.y + f.h / 2 < r.y + r.h) || null;
    // A room's rect is measured over its masonry, so the face a chair leans
    // on is WALL_T inside it. Anchor to the wall and the chair ends up in it.
    const WALL = 26;
    /** Shrink one axis: toward the wall it leans on, or about its middle. */
    const axis = (pos, size, want, lo, hi) => {
      // never negative: a piece the plan left standing in the masonry keeps
      // that gap and stays buried in it, which is how a shelf ends up 9px
      // inside a wall. Clamped, it comes out flush.
      const dLo = Math.max(0, pos - lo), dHi = Math.max(0, hi - (pos + size));
      // stood clear of both walls on this axis: it was a centrepiece, so keep
      // it one — a fountain dragged into a corner is not the same room
      if (dLo > (hi - lo) * 0.2 && dHi > (hi - lo) * 0.2) return pos + size / 2 - want / 2;
      return dLo < dHi ? lo + Math.min(dLo, hi - lo - want) : hi - Math.min(dHi, hi - lo - want) - want;
    };
    for (const f of this.furniture) {
      const want = SIZE[f.type];
      if (!want || !f.w || !f.h) continue;
      const wide = f.w >= f.h;
      const nw = (wide ? Math.max(want[0], want[1]) : Math.min(want[0], want[1])) * M;
      const nh = (wide ? Math.min(want[0], want[1]) : Math.max(want[0], want[1])) * M;
      const room = roomOf(f);
      if (room) {
        f.x = axis(f.x, f.w, nw, room.x + WALL, room.x + room.w - WALL);
        f.y = axis(f.y, f.h, nh, room.y + WALL, room.y + room.h - WALL);
      } else {
        f.x += (f.w - nw) / 2;
        f.y += (f.h - nh) / 2;
      }
      f.w = nw; f.h = nh;
      const box = this.solids.find((q) => q.f === f);
      if (box) { box.x = f.x; box.y = f.y; box.w = f.w; box.h = f.h; }
    }
    /* The chairs were spaced along an eleven-metre table. They follow it
     * down, or they stand around a table that is no longer there. */
    const table = this.furniture.find((f) => f.type === 'longTable');
    if (table) {
      const seats = this.furniture.filter((f) => f.type === 'chair' && f.room === table.room);
      const mid = table.y + table.h / 2;
      for (const row of [seats.filter((s) => s.y + s.h / 2 < mid), seats.filter((s) => s.y + s.h / 2 >= mid)]) {
        if (!row.length) continue;
        row.sort((a, b) => a.x - b.x);
        const gap = (table.w - row.length * row[0].w) / (row.length + 1);
        row.forEach((s, i) => {
          s.x = table.x + gap * (i + 1) + row[0].w * i;
          s.y = row[0].y < mid ? table.y - s.h - 14 : table.y + table.h + 14;
          const box = this.solids.find((q) => q.f === s);
          if (box) { box.x = s.x; box.y = s.y; }
        });
      }
    }
  }

  /** Three planks turn the gatehouse into a one-at-a-time lane. */
  raiseStakes() {
    if (this.stakesUp) return;
    this.stakesUp = true;
    const room = this.rooms.gatehouse;
    const x = room.x + room.w - 76;
    const posts = [
      { x, y: room.y + 70, w: 28, h: 270 },
      { x, y: room.y + 470, w: 28, h: 300 },
    ];
    for (const s of posts) this._indexSolid({ ...s, type: 'fort', solid: true });
  }

  lowerStakes() {
    if (!this.stakesUp && !this.solids.some((s) => s.type === 'fort')) return;
    this.stakesUp = false;
    this.solids = this.solids.filter((s) => s.type !== 'fort');
    this.buildGrid();
    this.buildNav();
  }

  _indexSolid(s) {
    this.solids.push(s);
    const c = this.cell;
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
