/**
 * THE BAILEY'S BUILDINGS IN 3D — KayKit Medieval Hexagon Pack 1.0 (CC0).
 *
 * Until 2026-10-17 every building the captain raised was a procedural
 * placeholder: a blue cone for the barracks, three logs and a disc for the
 * sawmill, a timber frame for the mine, a scaffold of sticks for the ballista
 * (playtest: "bangunan yg di build belum memakai asset visual yg layak dan
 * tepat masih berupa prototype harus cari dan download asset dari platform
 * penyedia asset free"). They are now Kay Lousberg's Medieval Hexagon Pack
 * (assets/buildings/kaykit-hex/CREDITS.txt), the same author as the
 * garrison's Knight and the fortress' kit. Each type has its own colour of
 * the pack (BUILD 11, playtest 2026-10-17: "tidak tau build yg mana"), the
 * same one its circle, its label and its card use (BUILD_COLOR):
 *
 *   BARRACKS   building_barracks_blue      blue: soldiers, the keep's livery
 *   SAWMILL    building_lumbermill_green   green: wood (its saw node spins while it works)
 *   GOLD MINE  building_mine_yellow        yellow: gold (+ the pack's wheelbarrow as a cart)
 *   BALLISTA   building_tower_base_red     red: it fights, + the Adventurers pack's
 *              crossbow_2handed on a swivel on top (it aims and recoils)
 *   plot pad   building_dirt              (the foundation under every plot)
 *   building   building_stage_A / B / C   (a build's thirds)
 *   upgrade    building_scaffolding
 *   levels     flag_blue (Lv2), flag_yellow (Lv3) and stock props
 *   armory     weaponrack, target, bucket_arrows
 *   the well   building_well_blue (the northeast yard)
 *
 * One fetch and one parse per file; every placed building is a clone of the
 * template (shared geometry and materials; a ghost swaps the materials on its
 * own clone). The source files are never modified. Until the kit arrives —
 * or if a core file fails — world3d keeps its procedural buildings, so a
 * plot never stands empty.
 */
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const DIR = 'assets/buildings/kaykit-hex/';

export const BUILDING_KIT = Object.freeze({
  barracks: `${DIR}building_barracks_blue.gltf`,
  sawmill: `${DIR}building_lumbermill_green.gltf`,
  mine: `${DIR}building_mine_yellow.gltf`,
  towerBase: `${DIR}building_tower_base_red.gltf`,
  ballista: 'assets/troops/kaykit/crossbow_2handed.gltf',
  pad: `${DIR}building_dirt.gltf`,
  stageA: `${DIR}building_stage_A.gltf`,
  stageB: `${DIR}building_stage_B.gltf`,
  stageC: `${DIR}building_stage_C.gltf`,
  scaffold: `${DIR}building_scaffolding.gltf`,
  weaponrack: `${DIR}weaponrack.gltf`,
  target: `${DIR}target.gltf`,
  bucketArrows: `${DIR}bucket_arrows.gltf`,
  flagBlue: `${DIR}flag_blue.gltf`,
  flagYellow: `${DIR}flag_yellow.gltf`,
  lumber: `${DIR}resource_lumber.gltf`,
  stone: `${DIR}resource_stone.gltf`,
  wheelbarrow: `${DIR}wheelbarrow.gltf`,
  crate: `${DIR}crate_A_big.gltf`,
  barrel: `${DIR}barrel.gltf`,
  sack: `${DIR}sack.gltf`,
  well: `${DIR}building_well_blue.gltf`,
  // BUILD 12: the bailey's districts and open ground (fortress.js furnish)
  treeA: `${DIR}tree_single_A.gltf`,
  treeB: `${DIR}tree_single_B.gltf`,
  treesA: `${DIR}trees_A_small.gltf`,
  treesB: `${DIR}trees_B_small.gltf`,
  rockA: `${DIR}rock_single_A.gltf`,
  rockC: `${DIR}rock_single_C.gltf`,
  rockE: `${DIR}rock_single_E.gltf`,
});
/**
 * Bailey dressing a fortress lays out as furniture `kit:<key>` (fortress.js
 * furnish): World3D stands the kit model on the footprint, fitted to it.
 */
export const KIT_DECOR = Object.freeze([
  'well', 'target', 'weaponrack', 'bucketArrows', 'lumber', 'stone', 'wheelbarrow', 'crate', 'barrel', 'sack',
  'treeA', 'treeB', 'treesA', 'treesB', 'rockA', 'rockC', 'rockE',
]);

/** What a building cannot be drawn without; the rest is dressing. */
export const BUILDING_CORE = Object.freeze(['barracks', 'sawmill', 'mine', 'towerBase', 'ballista', 'pad']);

/** Which kit model each building type stands on. */
export const BUILDING_MODEL = Object.freeze({ barracks: 'barracks', sawmill: 'sawmill', mine: 'mine', tower: 'towerBase' });

/**
 * Each building type's colour (BUILD 11): its kit model's roof, its circle on
 * the ground, the name label over the circle and its card in the dock, so a
 * player tells a gold mine from a ballista at a glance.
 */
export const BUILDING_COLOR = Object.freeze({
  barracks: 0x3e7bff,
  mine: 0xffc22e,
  sawmill: 0x4cc35e,
  tower: 0xff5640,
});
/** The saw node of the lumbermill (it spins while the sawmill works). */
export const SAW_NODE = 'building_lumbermill_saw_green';

class BuildingKit {
  constructor() {
    this.started = false;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.templates = new Map();
    this.errors = [];
    this.settled = 0;
    this.total = Object.keys(BUILDING_KIT).length;
  }

  /** Start every fetch (idempotent). Without a DOM (node QA) it is a no-op. */
  init() {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    const loader = new GLTFLoader();
    for (const [key, url] of Object.entries(BUILDING_KIT)) {
      loader.load(url, (gltf) => {
        try { this._accept(key, gltf); } catch (error) { this.errors.push(`${key}: ${error && error.message || error}`); }
        this._settle();
      }, undefined, (error) => {
        this.errors.push(`${key}: ${error && error.message || error}`);
        this._settle();
      });
    }
  }

  get progress() { return this.total ? this.settled / this.total : 1; }

  _accept(key, gltf) {
    const scene = gltf.scene;
    scene.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    this.templates.set(key, { scene, box, size: box.getSize(new THREE.Vector3()) });
  }

  _settle() {
    this.settled++;
    if (this.settled < this.total) return;
    const missing = BUILDING_CORE.filter((key) => !this.templates.has(key));
    if (missing.length) {
      this.failed = true;
      this.error = `building kit missing: ${missing.join(', ')}${this.errors.length ? ` (${this.errors.join('; ')})` : ''}`;
    } else {
      this.ready = true;
    }
  }

  has(key) { return this.templates.has(key); }

  /** The template's bounding box (kit units), or null. */
  box(key) {
    const t = this.templates.get(key);
    return t ? t.box.clone() : null;
  }

  size(key) {
    const t = this.templates.get(key);
    return t ? t.size.clone() : null;
  }

  /** A clone of a template (shared geometry and materials), or null. */
  clone(key) {
    const t = this.templates.get(key);
    if (!t) return null;
    const copy = t.scene.clone(true);
    copy.name = `kit-${key}`;
    return copy;
  }
}

export const Buildings3D = new BuildingKit();
