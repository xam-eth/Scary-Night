/* LAST NIGHT — the modular 3D room (issue #55, phase C1)
 *
 * The CC0 kit at assets/env-kit (KayKit Dungeon Remastered) is the mansion's
 * architecture in three dimensions. It is rendered into the SAME scene phase B
 * built (#54): same rig, same floor, same shadow. One lamp lights the door and
 * the woman standing in it, because there is only one lamp.
 *
 * Doors first. They are the thing the player touches all night and the one
 * whose state — shut, ajar, barricaded, broken — has to read at a glance. The
 * 2D door keeps its logic, its hp, its knock and its repair; the mesh is only
 * how it looks. Nothing here is allowed to change a number in the sim.
 *
 * The pieces are byte-exact vendored files, cloned at runtime. If the kit
 * fails to load, nothing is drawn and the painted room carries the night: a
 * night never blocks on an asset.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { Valen3D } from './valen3d.js';

export const KIT_DIR = './assets/env-kit/';

/**
 * World units per kit unit. The pieces are authored on a 4-unit grid, so a
 * wall and a doorway are both 4 units tall: at 33 that stands ~132px on the
 * camera as tuned — twice Valen, which is what a door in a house this size
 * should be.
 */
export const KIT_SCALE = 33;

/**
 * What the room needs: doors (phase C1) and now the floor and the walls.
 * Props land next; the loader does not care how many names are in here.
 */
const FILES = Object.freeze({
  doorway: 'doorway.glb',
  gate: 'door_gate.glb',
  broken: 'wall_broken.glb',
  crate: 'crate.glb',
  floorWood: 'floor_wood.glb',
  floorStone: 'floor_stone.glb',
  wall: 'wall.glb',
  wallCorner: 'wall_corner.glb',
  wallCracked: 'wall_cracked.glb',
  window: 'wall_window.glb',
  stairs: 'stairs.glb',
  table: 'table.glb',
  chair: 'chair.glb',
  shelf: 'shelf.glb',
  chest: 'chest.glb',
  barrel: 'barrel.glb',
  stacked: 'crates_stacked.glb',
  column: 'column.glb',
  candle: 'candle.glb',
  torch: 'torch.glb',
});

/**
 * The house's own furniture, mapped onto the kit.
 *
 * Scale is the piece's: a chair is 1.2 kit units to a wall's 4, so at one
 * shared scale a chair is 40px against Valen's 72 — the kit and the woman
 * agree, and nothing here resizes either. Each piece is scaled to the
 * footprint the 2D prop already had and BAILED OUT if that needs more than
 * the clamp: a 560px refectory table would have to become a 2.5m long table
 * standing 130cm high, and a mesh that does not fit its own collision box is
 * worse than the painted one it replaced.
 *
 * One honest substitution: the kit's `shelf` is a wall bracket, 0.45 units —
 * 15px, a hip-high ledge. The mansion's bookcases are floor-standing, so
 * they borrow the crate stack, which is the right height and the right
 * silhouette from across a dark room.
 */
const PROP_FOR = Object.freeze({
  longTable: 'table', sideTable: 'table', desk: 'table', pottingBench: 'table', altar: 'table',
  chair: 'chair', armchair: 'chair', sofa: 'chair', pew: 'chair',
  cabinet: 'chest',
  barrel: 'barrel',
  crates: 'stacked',
  staircase: 'stairs',
  shelf: 'stacked', wineRack: 'stacked',
});
/** Pieces with no footprint of their own get a scale, not a measurement. */
const PROP_SCALE = Object.freeze({ planter: 2.2, basin: 2.2, candleStand: 1.6, candelabra: 1.9 });
/**
 * Pieces that keep the wall's scale for their HEIGHT however wide they have
 * to grow. The stairs are a 5.1-unit flight against a 4-unit wall: filling a
 * 250px opening needs one and a half times the kit, and grown in all three
 * directions they stand two walls tall and turn the hall into a shaft. Spread
 * them sideways instead — a wide, shallow flight, which is what a grand
 * staircase is, and 5.1 units over a 4-unit run is the kit's own pitch.
 */
const PROP_RISE_AT_WALL = new Set(['stairs']);
const PROP_RANGE = Object.freeze({ default: [0.7, 2.4], column: [1.4, 3.0] });

/**
 * Autored footprints, in kit units, read off the vendored geometry.
 *
 *   wall         4 long (x -2..2), 4 tall, 1 thick — centred on its own line
 *   wall_corner  an L, legs reaching -x and +z from the corner point
 *   floor_*      4x4, 0.15 thick, centred
 *
 * The corner piece is chiral: no rotation turns {-x, +z} into {+x, +z}, so
 * each corner of a room gets its own angle. They are listed below, worked out
 * from the L above rather than guessed.
 */
const TILE = 4;                       // kit units per floor/wall cell
const CORNER_REACH = 2.5;             // how far a corner's legs run
const CORNER_ANGLES = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];   // TL, TR, BR, BL

/** Which floor a room is paved with. 'marble', 'tile' and 'stone' share a slab. */
const FLOOR_FOR = (kind) => (kind === 'wood' || kind === 'glass' ? 'floorWood' : 'floorStone');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class EnvKitRuntime {
  constructor() {
    this.ready = false;
    this.loading = false;
    this.failed = false;
    this.error = null;
    this.pieces = Object.create(null);
    this.group = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this.doors = new Map();
    this.room = null;          // the mansion the room was built from
    this.roomMeshes = null;
    this.roomCounts = null;
    this.windows = [];         // one entry per window: which instances are its two states
    this.props = null;         // the mansion the furniture was built from
    this.propMeshes = null;
    this.propCounts = null;
    this.diagnostics = () => ({
      ready: this.ready, loading: this.loading, failed: this.failed, error: this.error,
      pieces: Object.keys(this.pieces), doors: this.doors.size,
      room: this.roomCounts || null, props: this.propCounts || null,
      windows: this.windows.length,
    });
  }

  /** Idempotent: the shared scene belongs to Valen, so wait for her. */
  init() {
    if (this.ready || this.loading || this.failed) return this;
    if (typeof document === 'undefined') return this;
    if (!Valen3D.renderer || !Valen3D.scene) return this;
    this.loading = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, premultipliedAlpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.canvas = canvas;
      this.renderer = renderer;
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
      this.group = new THREE.Group();
      this.group.name = 'envkit';
      Valen3D.scene.add(this.group);

      const loader = new GLTFLoader();
      const names = Object.keys(FILES);
      let left = names.length;
      for (const name of names) {
        loader.load(
          KIT_DIR + FILES[name],
          (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene);
            this.pieces[name] = {
              scene: gltf.scene,
              size: box.getSize(new THREE.Vector3()),
              min: box.min.clone(),
            };
            if (--left <= 0) { this.ready = true; this.loading = false; }
          },
          undefined,
          (error) => {
            this.error = String((error && error.message) || error);
            this.failed = true;
            this.loading = false;
          },
        );
      }
    } catch (error) {
      this.error = String(error);
      this.failed = true;
      this.loading = false;
    }
    return this;
  }

  /** One usable copy of a piece, standing on the floor at unit scale. */
  piece(name) {
    const src = this.pieces[name];
    if (!src) return null;
    const obj = src.scene.clone(true);
    obj.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        node.frustumCulled = false;
      }
    });
    return obj;
  }

  _doorView(door) {
    const known = this.doors.get(door.id);
    if (known) return known;
    const horiz = door.axis === 'h';
    const len = horiz ? door.w : door.h;
    const s = KIT_SCALE;
    const stretch = len / (4 * s);          // the opening, not the grid
    const group = new THREE.Group();
    group.position.set(door.x, 0, door.y);
    group.rotation.y = horiz ? 0 : Math.PI / 2;
    const view = { group, frame: null, pivot: null, gate: null, broken: null, crate: null, len };

    const frame = this.piece('doorway');
    if (frame) {
      frame.scale.set(s * stretch, s, s);
      frame.position.y = -this.pieces.doorway.min.y * s;
      group.add(frame);
      view.frame = frame;
    }
    const gate = this.piece('gate');
    if (gate) {
      const pivot = new THREE.Group();
      pivot.position.set(-len / 2, 0, 0);
      gate.scale.set(s * stretch, s, s);
      gate.position.set(len / 2, -this.pieces.gate.min.y * s, 0);
      pivot.add(gate);
      group.add(pivot);
      view.pivot = pivot;
      view.gate = gate;
    }
    const broken = this.piece('broken');
    if (broken) {
      broken.scale.set(s * stretch, s, s);
      broken.position.y = -this.pieces.broken.min.y * s;
      broken.visible = false;
      group.add(broken);
      view.broken = broken;
    }
    const crate = this.piece('crate');
    if (crate) {
      crate.scale.setScalar(s * 0.62);
      crate.position.y = -this.pieces.crate.min.y * s * 0.62;
      crate.visible = false;
      group.add(crate);
      view.crate = crate;
    }
    this.group.add(group);
    this.doors.set(door.id, view);
    return view;
  }

  /**
   * One InstancedMesh for a list of placements. A whole floor is ~180 tiles
   * and a mansion's walls ~150 cells: five draw calls instead of five hundred
   * objects, which is the only reason a phone can carry a real room.
   */
  _instanced(name, placements) {
    const src = this.pieces[name];
    if (!src || !placements.length) return null;
    let geo = null; let mat = null;
    src.scene.traverse((node) => { if (node.isMesh && !geo) { geo = node.geometry; mat = node.material; } });
    if (!geo) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    mesh.userData.placements = placements;      // instances are written from it below
    for (let i = 0; i < placements.length; i++) this._writeInstance(mesh, i);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * One instance, written from its placement. `off` is a placement's own way
   * of saying "not me": a window's broken twin hides while the glass holds.
   * Folding (below) is the same gesture, so both go through here.
   */
  _writeInstance(mesh, i) {
    if (!mesh) return;
    const p = mesh.userData.placements[i];
    if (!p) return;
    if (!this._dummy) this._dummy = new THREE.Object3D();
    const d = this._dummy;
    const hide = p.off || (this._foldedAt != null && p.z > this._foldedAt);
    d.position.set(p.x, p.y || 0, p.z);
    d.rotation.set(0, p.ry || 0, 0);
    d.scale.set(hide ? 0 : (p.sx == null ? 1 : p.sx),
      hide ? 0 : (p.sy == null ? 1 : p.sy),
      hide ? 0 : (p.sz == null ? 1 : p.sz));
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  /**
   * The camera looks down the room from +z, so a wall between the camera and
   * the player is a wall in front of her: it would cover the floor she is
   * about to cross with an oak panel. Fold those away — zero scale, same
   * instance — and put them back when she walks past. Cheap: 170 matrices,
   * no allocation, one buffer upload.
   */
  _foldNear(camY) {
    if (!this.roomMeshes) return;
    if (this._foldedAt != null && Math.abs(this._foldedAt - camY) < 12) return;
    this._foldedAt = camY;
    for (const key of ['wall', 'cracked', 'corner', 'window', 'windowBroken']) {
      const mesh = this.roomMeshes[key];
      if (!mesh) continue;
      const list = mesh.userData.placements;
      for (let i = 0; i < list.length; i++) this._writeInstance(mesh, i);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Floor and walls, instanced, built once — from the mansion's OWN plan.
   *
   * The first pass walked the room rectangles. That was wrong in the one
   * place it mattered: it floored the rooms and left the passages between
   * them painted, and it stood the walls on the rectangles instead of on the
   * wall solids the collision and the painted house actually use. Walk out of
   * a room and the floor you were standing on stopped at the doorstep.
   *
   * So: the floor follows everywhere a body can stand (the nav grid, plus the
   * thresholds a closed door closes off), and the walls are the wall solids
   * themselves, gap by gap. A mesh now stands exactly where the house is.
   */
  buildRoom(mansion) {
    if (!this.ready || !mansion || !mansion.solids || this.room === mansion) return;
    const s = KIT_SCALE;
    const cell = TILE * s;
    const walls = (mansion.solids || []).filter((w) => w.type === 'wall');
    const rooms = Object.values(mansion.rooms || {});
    const entrances = mansion.entrances || [];

    const inWall = (x, y) => walls.some((w) =>
      x > w.x - 2 && x < w.x + w.w + 2 && y > w.y - 2 && y < w.y + w.h + 2);
    const roomAt = (x, y) => rooms.find((r) =>
      x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
    const canStand = (x, y) => {
      if (!mansion.navCellOf || !mansion.navFree) return false;
      const c = mansion.navCellOf(x, y);
      return mansion.navFree(c.gx, c.gy);
    };
    // A shut door blocks the nav grid, and a doorway with no floor under it
    // is a hole in the ground exactly where she walks most.
    const atThreshold = (x, y) => entrances.some((e) =>
      Math.abs(x - e.x) < (e.w || 0) / 2 + cell * 0.5 && Math.abs(y - e.y) < (e.h || 0) / 2 + cell * 0.5);

    // ---- floor ----
    const floors = { floorWood: [], floorStone: [] };
    const b = mansion.bounds || { x: -540, y: -520, w: 3140, h: 2480 };
    const nx = Math.max(1, Math.ceil(b.w / cell));
    const ny = Math.max(1, Math.ceil(b.h / cell));
    const tw = b.w / nx;
    const th = b.h / ny;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = b.x + (i + 0.5) * tw;
        const cy = b.y + (j + 0.5) * th;
        // Nine probes, not one. A tile is 130px and a passage can be 100px
        // wide, so a centre-only test steps right over the corridors — which
        // is how the first pass left the passages between rooms bare, with
        // floor under the rooms and nothing under the doorway.
        let room = null;
        let use = false;
        for (let sy2 = -1; sy2 <= 1 && !use; sy2++) {
          for (let sx2 = -1; sx2 <= 1 && !use; sx2++) {
            const px2 = cx + sx2 * tw * 0.33;
            const pz2 = cy + sy2 * th * 0.33;
            if (inWall(px2, pz2)) continue;
            const here = roomAt(px2, pz2);
            if (here) { room = here; use = true; }
            else if (canStand(px2, pz2) || atThreshold(px2, pz2)) use = true;
          }
        }
        if (!use) continue;
        floors[FLOOR_FOR(room ? room.floor : 'stone')].push({
          x: cx, y: 0, z: cy, sx: tw / TILE, sy: s, sz: th / TILE,
        });
      }
    }

    // ---- walls: the solids themselves, so a panel is the wall ----
    const wallCells = [];
    const cracked = [];
    for (const w of walls) {
      const horiz = w.w >= w.h;
      const len = horiz ? w.w : w.h;
      const line = horiz ? w.y + w.h / 2 : w.x + w.w / 2;
      const from = horiz ? w.x : w.y;
      const cells = Math.max(1, Math.round(len / cell));
      const size = len / cells;
      for (let i = 0; i < cells; i++) {
        const mid = from + (i + 0.5) * size;
        // one panel in nine is a tired one, so a long wall is not a ruler
        const tired = (((mid * 7 + line * 13) | 0) % 9) === 3;
        (tired ? cracked : wallCells).push(horiz
          ? { x: mid, y: 0, z: line, ry: 0, sx: size / TILE, sy: s, sz: s }
          : { x: line, y: 0, z: mid, ry: Math.PI / 2, sx: size / TILE, sy: s, sz: s });
      }
    }

    // ---- corners: where a run meets a run, an L stands ----
    // The L is chiral. Its legs reach -x and +z before any rotation, so each
    // pairing of directions has exactly one angle that fits.
    const DIR = { '+x': 0, '-x': 1, '+z': 2, '-z': 3 };
    const CORNER_ANGLE = { '1,2': 0, '0,2': Math.PI / 2, '0,3': Math.PI, '1,3': -Math.PI / 2 };
    const endsOf = (w) => {
      const horiz = w.w >= w.h;
      const line = horiz ? w.y + w.h / 2 : w.x + w.w / 2;
      if (horiz) {
        return [
          { x: w.x, z: line, into: DIR['+x'] },            // its start looks east
          { x: w.x + w.w, z: line, into: DIR['-x'] },
        ];
      }
      return [
        { x: line, z: w.y, into: DIR['+z'] },
        { x: line, z: w.y + w.h, into: DIR['-z'] },
      ];
    };
    const corners = [];
    const seen = new Set();
    const hs = walls.filter((w) => w.w >= w.h);
    const vs = walls.filter((w) => w.w < w.h);
    for (const h of hs) {
      for (const he of endsOf(h)) {
        for (const v of vs) {
          for (const ve of endsOf(v)) {
            if (Math.abs(he.x - ve.x) > 40 || Math.abs(he.z - ve.z) > 40) continue;
            const key = [he.into, ve.into].sort((a, b) => a - b).join(',');
            const ry = CORNER_ANGLE[key];
            if (ry == null) continue;
            const spot = `${Math.round(he.x)},${Math.round(he.z)}`;
            if (seen.has(spot)) continue;
            seen.add(spot);
            corners.push({ x: he.x, y: 0, z: he.z, ry, sx: s, sy: s, sz: s });
          }
        }
      }
    }

    // ---- windows ----
    // The wall solids stop at every opening, which is honest for a doorway
    // (its mesh fills it) and wrong for a window: nine of them stood as holes
    // you could see the night through. Each gets a panel with a real opening
    // in it, and its twin — the broken wall the swarm came in by — waiting
    // behind it, off, until the glass goes.
    const windows = [];
    const windowsBroken = [];
    this.windows = [];
    for (const e of entrances) {
      if (e.kind !== 'window') continue;
      const horiz = e.axis === 'h';
      const len = horiz ? e.w : e.h;
      const spot = {
        x: e.x, y: 0, z: e.y, ry: horiz ? 0 : Math.PI / 2,
        sx: len / TILE, sy: s, sz: s,
      };
      windows.push({ ...spot, off: !!e.broken });
      windowsBroken.push({ ...spot, off: !e.broken });
      this.windows.push({
        id: e.id, e, wasBroken: !!e.broken,
        intact: windows.length - 1, smashed: windowsBroken.length - 1,
      });
    }

    this.roomMeshes = {
      wood: this._instanced('floorWood', floors.floorWood),
      stone: this._instanced('floorStone', floors.floorStone),
      wall: this._instanced('wall', wallCells),
      cracked: this._instanced('wallCracked', cracked),
      corner: this._instanced('wallCorner', corners),
      window: this._instanced('window', windows),
      windowBroken: this._instanced('broken', windowsBroken),
    };
    this.roomCounts = {
      floor: floors.floorWood.length + floors.floorStone.length,
      walls: wallCells.length + cracked.length, corners: corners.length,
      windows: windows.length,
    };
    this.room = mansion;
  }

  /**
   * The house's furniture, instanced, standing on the anchors the 2D mansion
   * already uses. Candles and torches go where their light already is, so the
   * light that used to be a pool painted on the floor comes out of something.
   *
   * They draw with the room, under the actors. A prop never hides the player —
   * which is a choice, and the same one the painted furniture made when it
   * stood in the depth queue: you can always see her.
   */
  buildProps(mansion) {
    if (!this.ready || !mansion || this.props === mansion) return;
    const s = KIT_SCALE;
    const bins = {
      table: [], chair: [], shelf: [], chest: [], barrel: [], stacked: [],
      column: [], candle: [], torch: [], stairs: [],
    };
    const place = (piece, item, x, z, fit) => {
      const src = this.pieces[piece];
      if (!src || !bins[piece]) return;
      const foot = Math.max(src.size.x, src.size.z) * s;
      let k = fit;
      if (k == null) {
        const span = Math.max(item.w || 0, item.h || 0);
        if (!span) return;
        k = span / foot;
      }
      const range = PROP_RANGE[piece] || PROP_RANGE.default;
      if (k < range[0] || k > range[1]) return;   // the painted one keeps its place
      const scale = k * s;
      // A piece is not always modelled around its own middle. The stairs run
      // from z 0 to 4, so standing their origin on the anchor pushed the whole
      // flight two metres into the room; the chest sits the same way. Put each
      // piece's FOOTPRINT CENTRE on the anchor, whichever corner its author
      // measured from — and carry the offset through the piece's own rotation.
      const ry = item.rot || 0;
      const rise = PROP_RISE_AT_WALL.has(piece) ? s : scale;
      const lx = -(src.min.x + src.size.x / 2) * scale;
      const lz = -(src.min.z + src.size.z / 2) * scale;
      const cos = Math.cos(ry), sin = Math.sin(ry);
      bins[piece].push({
        x: x + lx * cos + lz * sin,
        y: -src.min.y * rise,
        z: z - lx * sin + lz * cos,
        ry, sx: scale, sy: rise, sz: scale,
      });
      item.env3d = true;                          // its 2D twin stands down
    };
    // Furniture is authored by its TOP-LEFT corner: the painting draws it from
    // (f.x, f.y) across w and h, and the foot a body is sorted against is
    // f.y + f.h. A mesh, though, is centred on its own origin — so standing it
    // on (f.x, f.y) put every table half a table north-west of the box you
    // bump into. Stand it on the middle of the rect instead.
    for (const f of mansion.furniture || []) {
      const piece = PROP_FOR[f.type];
      if (piece) place(piece, f, f.x + (f.w || 0) / 2, f.y + (f.h || 0) / 2, null);
    }
    for (const p of mansion.props || []) {
      const piece = p.type === 'planter' || p.type === 'basin' ? 'column'
        : (p.type === 'candleStand' || p.type === 'candelabra' ? 'candle' : null);
      if (piece) place(piece, p, p.x, p.y, PROP_SCALE[p.type] || 1.6);
    }
    for (const l of mansion.lights || []) {
      if (l.type !== 'fire') continue;
      place('torch', { x: l.x, y: l.y }, l.x, l.y, 2.2);
    }
    this.propMeshes = {};
    this.propCounts = {};
    for (const key of Object.keys(bins)) {
      const mesh = this._instanced(key, bins[key]);
      if (mesh) this.propMeshes[key] = mesh;
      if (bins[key].length) this.propCounts[key] = bins[key].length;
    }
    this.props = mansion;
  }

  /**
   * Point every mesh at the door state. Read-only on the sim: hp, open,
   * broken and barricade all stay exactly where the 2D game put them.
   */
  sync(entrances, mansion = null) {
    if (!this.ready || !this.group) return;
    if (mansion) { this.buildRoom(mansion); this.buildProps(mansion); }
    for (const e of entrances) {
      if (e.kind !== 'door') continue;
      const v = this._doorView(e);
      if (!v) continue;
      // The painted plate bows out; the mesh is the door now. The painted
      // knock flash and the urgent rim still draw — they are cues, not oak.
      e.env3d = true;
      const hurt = 1 - clamp(e.hp / Math.max(1, e.hpMax), 0, 1);
      if (v.frame) {
        v.frame.visible = !e.broken;
        // a door under siege sits crooked in its frame
        v.frame.rotation.z = hurt * 0.035 + (e.buckling || 0) * 0.02;
      }
      if (v.gate && v.pivot) {
        v.gate.visible = !e.broken;
        v.pivot.rotation.y = e.open ? -1.25 : 0;
        v.pivot.rotation.z = hurt * 0.05;
      }
      if (v.broken) v.broken.visible = !!e.broken;
      if (v.crate) {
        const bar = clamp((e.barricade || 0) / 2, 0, 1);   // two planks is a full barricade
        v.crate.visible = (e.barricade || 0) > 0;
        if (v.crate.visible && e.inside) {
          // the barricade goes up on the inside, where she would stack it
          v.crate.position.set((e.inside.x - e.x) * (e.axis === 'h' ? 1 : 0), v.crate.position.y,
            e.axis === 'h' ? (e.inside.y - e.y) : (e.inside.y - e.y));
          v.crate.scale.setScalar(KIT_SCALE * (0.42 + bar * 0.3));
        }
      }
    }
    // A window's glass is a real state in the sim, so the wall keeps up: the
    // glass holds, then it does not, and the broken panel the swarm came in
    // through is standing there the next frame. Two instances, one swap.
    for (const w of this.windows) {
      const e = w.e;
      if (!e || !!e.broken === w.wasBroken) continue;
      w.wasBroken = !!e.broken;
      const whole = this.roomMeshes && this.roomMeshes.window;
      const smashed = this.roomMeshes && this.roomMeshes.windowBroken;
      if (whole && whole.userData.placements[w.intact]) whole.userData.placements[w.intact].off = !!e.broken;
      if (smashed && smashed.userData.placements[w.smashed]) smashed.userData.placements[w.smashed].off = !e.broken;
      this._writeInstance(whole, w.intact);
      this._writeInstance(smashed, w.smashed);
      if (whole) whole.instanceMatrix.needsUpdate = true;
      if (smashed) smashed.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * The room pass. Same pitch and the same world→screen mapping the 2D
   * renderer uses, so a mesh lands exactly where the painted room says the
   * door is — and the bodies are hidden, because they have their own passes
   * and this one belongs to the house.
   */
  render(view) {
    if (!this.ready || !this.renderer || !Valen3D.scene) return null;
    const { camX, camY, zoom, tilt, w, h, dpr = 1, shakeX = 0, shakeY = 0, light = null } = view;
    const cw = Math.max(2, Math.floor(w * dpr));
    const ch = Math.max(2, Math.floor(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.renderer.setSize(cw, ch, false);
    }
    const t = clamp(tilt, 0.2, 1);
    const theta = Math.asin(t);
    const dist = 2400;
    const cam = this.camera;
    cam.left = -(w / 2) / zoom;
    cam.right = (w / 2) / zoom;
    cam.top = (h / 2) / zoom;
    cam.bottom = -(h / 2) / zoom;
    cam.near = 0.1;
    cam.far = dist * 3;
    const tx = camX - shakeX / zoom;
    const ty = camY - shakeY / (zoom * t);
    cam.position.set(tx, Math.tan(theta) * dist, ty + dist);
    cam.lookAt(tx, 0, ty);
    cam.updateProjectionMatrix();

    this._foldNear(camY);
    if (Valen3D._applyRig) Valen3D._applyRig({ x: camX, y: camY, light });
    if (Valen3D.renderer) this.renderer.toneMappingExposure = Valen3D.renderer.toneMappingExposure * 1.1;

    const stage = Valen3D.stage;
    const wasVisible = stage ? stage.visible : true;
    if (stage) stage.visible = false;
    this.renderer.clear();
    this.renderer.render(Valen3D.scene, cam);
    if (stage) stage.visible = wasVisible;
    return this.canvas;
  }
}

export const EnvKit = new EnvKitRuntime();
