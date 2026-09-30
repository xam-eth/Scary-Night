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
  shelf: 'stacked', wineRack: 'stacked',
});
/** Pieces with no footprint of their own get a scale, not a measurement. */
const PROP_SCALE = Object.freeze({ planter: 2.2, basin: 2.2, candleStand: 1.6, candelabra: 1.9 });
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
    this.props = null;         // the mansion the furniture was built from
    this.propMeshes = null;
    this.propCounts = null;
    this.diagnostics = () => ({
      ready: this.ready, loading: this.loading, failed: this.failed, error: this.error,
      pieces: Object.keys(this.pieces), doors: this.doors.size,
      room: this.roomCounts || null, props: this.propCounts || null,
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
    const dummy = new THREE.Object3D();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      dummy.position.set(p.x, p.y || 0, p.z);
      dummy.rotation.set(0, p.ry || 0, 0);
      dummy.scale.set(p.sx == null ? 1 : p.sx, p.sy == null ? 1 : p.sy, p.sz == null ? 1 : p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.placements = placements;
    this.group.add(mesh);
    return mesh;
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
    if (!this._dummy) this._dummy = new THREE.Object3D();
    const dummy = this._dummy;
    for (const key of ['wall', 'cracked', 'corner']) {
      const mesh = this.roomMeshes[key];
      if (!mesh) continue;
      const list = mesh.userData.placements;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const near = p.z > camY;
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.ry || 0, 0);
        dummy.scale.set(near ? 0 : p.sx, near ? 0 : p.sy, near ? 0 : p.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Floor and walls for every room, instanced, built once. The 2D mansion
   * stays the only map: these are its rects and its door openings, so a wall
   * can never stand where the sim says there is a way through.
   */
  buildRoom(mansion) {
    if (!this.ready || !mansion || !mansion.rooms || this.room === mansion) return;
    const s = KIT_SCALE;
    const cell = TILE * s;                 // one grid cell, in world px
    const reach = CORNER_REACH * s;        // how far a corner's legs run
    const rooms = Object.values(mansion.rooms || {});
    // A door already fills its own gap, so the wall run steps around it.
    const openings = (mansion.doors || []).map((d) => {
      const horiz = d.axis === 'h';
      const len = horiz ? d.w : d.h;
      const mid = horiz ? d.x : d.y;
      return { horiz, line: horiz ? d.y : d.x, from: mid - len / 2, to: mid + len / 2 };
    });
    const blocked = (horiz, line, a, b) => openings.some((o) =>
      o.horiz === horiz && Math.abs(o.line - line) < 70 && o.to > a - 10 && o.from < b + 10);

    const floors = { floorWood: [], floorStone: [] };
    const walls = [];
    const cracked = [];
    const corners = [];

    for (const room of rooms) {
      // ---- floor: the room's own rect, tiled to fit exactly ----
      const nx = Math.max(1, Math.round(room.w / cell));
      const nz = Math.max(1, Math.round(room.h / cell));
      const tx = room.w / nx;
      const tz = room.h / nz;
      const list = floors[FLOOR_FOR(room.floor)];
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          // A piece is authored 4 units wide and the scene measures in px, so
          // the scale that makes it span tx px is tx / TILE — not tx / cell.
          list.push({
            x: room.x + (i + 0.5) * tx, y: 0, z: room.y + (j + 0.5) * tz,
            sx: tx / TILE, sy: s, sz: tz / TILE,
          });
        }
      }

      // ---- walls: the four edges, between the corners ----
      const x0 = room.x; const x1 = room.x + room.w;
      const y0 = room.y; const y1 = room.y + room.h;
      const runs = [
        { horiz: true, line: y0, from: x0, to: x1 },
        { horiz: true, line: y1, from: x0, to: x1 },
        { horiz: false, line: x0, from: y0, to: y1 },
        { horiz: false, line: x1, from: y0, to: y1 },
      ];
      for (const run of runs) {
        const a = run.from + reach;
        const b = run.to - reach;
        const span = b - a;
        if (span < cell * 0.5) continue;
        const cells = Math.max(1, Math.round(span / cell));
        const size = span / cells;
        for (let i = 0; i < cells; i++) {
          const from = a + i * size;
          const to = from + size;
          if (blocked(run.horiz, run.line, from, to)) continue;   // a door stands here
          const mid = (from + to) / 2;
          const stretch = size / TILE;          // the cell spans `size` px
          const height = s;                     // 4 units tall, like the door
          // one cell in nine is a tired wall, so a long room is not a ruler
          const tired = (((mid * 7 + run.line * 13) | 0) % 9) === 3;
          (tired ? cracked : walls).push(run.horiz
            ? { x: mid, y: 0, z: run.line, ry: 0, sx: stretch, sy: height, sz: s }
            : { x: run.line, y: 0, z: mid, ry: Math.PI / 2, sx: stretch, sy: height, sz: s });
        }
      }

      // ---- corners: the L is chiral, so each corner gets its own angle ----
      corners.push(
        { x: x0, y: 0, z: y0, ry: CORNER_ANGLES[0], sx: s, sy: s, sz: s },
        { x: x1, y: 0, z: y0, ry: CORNER_ANGLES[1], sx: s, sy: s, sz: s },
        { x: x1, y: 0, z: y1, ry: CORNER_ANGLES[2], sx: s, sy: s, sz: s },
        { x: x0, y: 0, z: y1, ry: CORNER_ANGLES[3], sx: s, sy: s, sz: s },
      );
    }

    this.roomMeshes = {
      wood: this._instanced('floorWood', floors.floorWood),
      stone: this._instanced('floorStone', floors.floorStone),
      wall: this._instanced('wall', walls),
      cracked: this._instanced('wallCracked', cracked),
      corner: this._instanced('wallCorner', corners),
    };
    this.roomCounts = {
      floor: floors.floorWood.length + floors.floorStone.length,
      walls: walls.length + cracked.length, corners: corners.length,
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
    const bins = { table: [], chair: [], shelf: [], chest: [], barrel: [], stacked: [], column: [], candle: [], torch: [] };
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
      bins[piece].push({
        x, y: -src.min.y * scale, z, ry: item.rot || 0, sx: scale, sy: scale, sz: scale,
      });
      item.env3d = true;                          // its 2D twin stands down
    };
    for (const f of mansion.furniture || []) {
      const piece = PROP_FOR[f.type];
      if (piece) place(piece, f, f.x, f.y, null);
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
