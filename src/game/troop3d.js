/**
 * THE GARRISON IN 3D — Survival's door guards and the relief column.
 *
 * BUILD 21 (user bug report 2026-10-19: "pasukan perlu di-redesign karena
 * tidak sinkron dengan character — buat pasukan baru"): the garrison is cut
 * from the SAME character as its captain. Until BUILD 20 the guards were
 * KayKit's Knight — a chunky toy soldier standing next to a realistically
 * proportioned, palette-graded hunter; the two never read as one game. Every
 * troop is now a cloneRig() of the captain's own GLB
 * (hunter_run_walk_claw_sword_shot.glb, shared with valen3d.js), wearing the
 * same uniform-grade shader (valen3d.buildUniformGrade) in a darker
 * garrison palette: a deeper royal-blue tabard, brushed-steel trim where the
 * captain wears gold (gold stays his alone), a fainter rim — so the captain
 * remains the brightest figure on the field (V8) and his men read as his.
 *
 * The rig carries five authored clips (walk, run, shot, claw, sword) and no
 * idle/hit/down/up/cheer, so TroopRig keeps those states procedural: idle
 * and aim stand on the bind pose (exactly like the captain), a hit staggers,
 * down/lie/up topple and raise the whole body, a cheer hops. The crossbows
 * stay the KayKit pack's (CC0, assets/troops/kaykit/CREDITS.txt) — the BUILD
 * 14 arms levels with their painted atlases — now parented to the soldier's
 * R_Hand bone instead of the Knight's hand slot. Knight.glb itself is
 * retired: it stays vendored for provenance but is no longer loaded, so the
 * garrison shares one character file with the captain.
 *
 * One fetch and one parse per file; every troop is a cloneRig() of the
 * template (shared geometry, own skeleton, own materials so a hurt flash
 * stays on one body) with its own AnimationMixer. Until the files arrive —
 * or if they fail — world3d keeps the primitive figure, so the guards never
 * vanish.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { cloneRig } from './enemy3d.js';
import { VALEN_MODEL_URL, buildUniformGrade } from './valen3d.js';

export const TROOP_ASSETS = Object.freeze({
  soldier: VALEN_MODEL_URL,
  crossbow: 'assets/troops/kaykit/crossbow_1handed.gltf',
  arbalest: 'assets/troops/kaykit/crossbow_2handed.gltf',
});

/**
 * The garrison's cut of the captain's palette (valen3d UNIFORM_GRADE_PALETTE
 * is the captain's). BUILD 23, after the user's correction ("kapten dan pasukan
 * sama, harusnya beda — pakai visual reference di asset"): the cloth follows
 * the concept sheet ASSET_CHARACTER/characters/02-guard.png — a mid steel-blue
 * gambeson with a gold stripe — while the captain keeps his brighter royal
 * tabard, gold trim, hat and cape. The silhouette difference is carried by
 * TROOP_GEAR below, not by paint alone.
 */
export const TROOP_PALETTE = Object.freeze({
  navy: 0x14264c, royal: 0x2c4f96, sky: 0x9fb4d8, gold: 0xc9a23f,
  leather: 0x6b4a2f, leatherDark: 0x3a2718, skin: 0xd9a87f, rimColor: 0x9fc4f0,
});

/**
 * BUILD 23: the garrison's own silhouette, modelled after the guard concept
 * (02-guard.png): an open-face kettle helm with a blue plume (the captain
 * wears his feathered hat), a chain collar, rounded shoulder plates, a long
 * padded gambeson skirt with a gold stripe and tower emblem (the captain's
 * coat stops at the hip and he wears a cape), a bolt pouch and quiver on the
 * belt, and the garrison's round shield on the back where the captain's cape
 * hangs. Every node is procedural, parented to a bone, and named so QA can
 * find it; the captain's model carries none of these names.
 */
export const TROOP_GEAR = Object.freeze([
  'guard-helm', 'guard-helm-brim', 'guard-plume', 'guard-collar',
  'guard-pauldron-l', 'guard-pauldron-r', 'guard-skirt', 'guard-stripe',
  'guard-emblem', 'guard-belt', 'guard-pouch', 'guard-quiver',
  'guard-shield', 'guard-shield-boss',
]);

let troopBodyGeometry = null;

const GEAR_MAT = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.78, roughness: 0.34 }),
  chain: () => new THREE.MeshStandardMaterial({ color: 0x8d939c, metalness: 0.52, roughness: 0.62 }),
  cloth: () => new THREE.MeshStandardMaterial({ color: 0x2c4f96, metalness: 0.04, roughness: 0.85 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xc9a23f, metalness: 0.62, roughness: 0.4 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x6b4a2f, metalness: 0.05, roughness: 0.8 }),
  plume: () => new THREE.MeshStandardMaterial({ color: 0x2f5fd0, metalness: 0.05, roughness: 0.7 }),
};

const _gearV = new THREE.Vector3();
const _gearQ = new THREE.Quaternion();

/**
 * Parent `node` to `bone` so it sits at the model-space point (x, y, z) in
 * the bind pose and keeps the bone's own orientation from there on (a helm
 * turns with the head, a skirt swings with the hip).
 */
function seat(node, bone, model, x, y, z) {
  bone.updateWorldMatrix(true, false);
  node.quaternion.copy(bone.getWorldQuaternion(_gearQ).invert());
  node.position.copy(bone.worldToLocal(model.localToWorld(_gearV.set(x, y, z))));
  bone.add(node);
  node.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return node;
}

/**
 * BUILD 23: dress a cloned captain rig as the concept's guard (02-guard.png).
 * The body underneath stays the captain's rig — one character file, one
 * animation set — but everything the eye reads first is the garrison's own:
 * helm, collar, pauldrons, long gambeson skirt, belt kit and back shield.
 */
export function dressGarrison(model) {
  // the captain's short cape hangs exactly where the concept puts the
  // garrison's shield: fold its vertices into the back so the guard reads
  // cape-less, like the sheet. cloneRig shares vertex buffers, so the fold
  // lives in a troop-only geometry copy (built once, shared by every guard;
  // the captain keeps the untouched original)
  model.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (!troopBodyGeometry) {
      troopBodyGeometry = o.geometry.clone();
      const pos = troopBodyGeometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), z = pos.getZ(i), x = pos.getX(i);
        if (y > 0.5 && y < 0.84 && z < -0.095 && Math.abs(x) < 0.1) pos.setZ(i, -0.06);
      }
      pos.needsUpdate = true;
      troopBodyGeometry.computeBoundingSphere();
      troopBodyGeometry.computeBoundingBox();
    }
    o.geometry = troopBodyGeometry;
  });
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const head = bones.Head, hip = bones.Hip, spine = bones.Spine02;
  const shoulderL = bones.L_Upperarm, shoulderR = bones.R_Upperarm;
  if (!head || !hip || !spine || !shoulderL || !shoulderR) return false;

  // kettle helm: a bell over the skull with the face left open, a flared
  // brim, and the concept's small blue plume on the left
  const helm = new THREE.Group(); helm.name = 'guard-helm';
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), GEAR_MAT.steel());
  dome.position.y = 0.012;
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.086, 0.055, 20, 1, true, Math.PI * 0.14, Math.PI * 1.72), GEAR_MAT.steel());
  bell.material.side = THREE.DoubleSide;
  bell.position.y = -0.018;
  helm.add(dome, bell);
  seat(helm, head, model, 0, 0.955, -0.004);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.102, 0.016, 22, 1, true, Math.PI * 0.14, Math.PI * 1.72), GEAR_MAT.steel());
  brim.material.side = THREE.DoubleSide;
  brim.name = 'guard-helm-brim';
  seat(brim, head, model, 0, 0.928, -0.004);
  const plumeHolder = new THREE.Group(); plumeHolder.name = 'guard-plume';
  const plume = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), GEAR_MAT.plume());
  plume.scale.set(0.55, 2.6, 1.1);
  plume.rotation.set(0.3, 0, -0.5);
  plumeHolder.add(plume);
  seat(plumeHolder, head, model, 0.052, 0.985, -0.02);

  // chain collar: the concept's mail gorget under the helm
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.072, 0.05, 16, 1, true), GEAR_MAT.chain());
  collar.material.side = THREE.DoubleSide;
  collar.name = 'guard-collar';
  seat(collar, bones.NeckTwist01 || head, model, 0, 0.868, 0);

  // rounded shoulder plates over the gambeson's sleeves
  for (const [bone, name, sx] of [[shoulderL, 'guard-pauldron-l', 1], [shoulderR, 'guard-pauldron-r', -1]]) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), GEAR_MAT.steel());
    cap.scale.set(1, 0.82, 1.12);
    cap.name = name;
    seat(cap, bone, model, sx * 0.108, 0.812, 0);
  }

  // the long padded gambeson skirt with its gold stripe and tower emblem
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.132, 0.24, 20, 1, true), GEAR_MAT.cloth());
  skirt.material.side = THREE.DoubleSide;
  skirt.name = 'guard-skirt';
  seat(skirt, hip, model, 0, 0.415, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.235, 0.006), GEAR_MAT.gold());
  stripe.name = 'guard-stripe';
  seat(stripe, hip, model, 0, 0.415, 0.119);
  const emblem = new THREE.Group(); emblem.name = 'guard-emblem';
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.026, 0.005), GEAR_MAT.gold());
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.008, 0.005), GEAR_MAT.gold());
  crown.position.y = 0.017;
  emblem.add(tower, crown);
  seat(emblem, spine, model, 0.032, 0.72, 0.078);

  // belt kit: a leather belt, a bolt pouch on the right hip, a quiver behind
  const beltHolder = new THREE.Group(); beltHolder.name = 'guard-belt';
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.011, 8, 22), GEAR_MAT.leather());
  belt.rotation.x = Math.PI / 2;
  beltHolder.add(belt);
  seat(beltHolder, hip, model, 0, 0.535, 0);
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.062, 0.032), GEAR_MAT.leather());
  pouch.name = 'guard-pouch';
  seat(pouch, hip, model, 0.098, 0.492, 0.028);
  const quiverHolder = new THREE.Group(); quiverHolder.name = 'guard-quiver';
  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.1, 10), GEAR_MAT.leather());
  quiver.rotation.z = 0.32;
  quiverHolder.add(quiver);
  seat(quiverHolder, hip, model, -0.096, 0.55, -0.045);

  // the garrison's round shield on the back, where the captain's cape hangs
  const shieldHolder = new THREE.Group(); shieldHolder.name = 'guard-shield';
  // steel board, blue field, gold boss: the concept's colours, but with
  // enough contrast to read at phone zoom
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.014, 22), GEAR_MAT.steel());
  shield.rotation.x = Math.PI / 2;
  const field = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.016, 20), GEAR_MAT.cloth());
  field.rotation.x = Math.PI / 2;
  field.position.z = -0.004;
  shieldHolder.add(shield, field);
  seat(shieldHolder, spine, model, 0, 0.66, -0.116);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), GEAR_MAT.gold());
  boss.scale.z = 0.6;
  boss.name = 'guard-shield-boss';
  seat(boss, spine, model, 0, 0.66, -0.132);
  return true;
}

/** The grade is always on for troops; the rim and lift stay under the captain's. */
export const TROOP_LOOK = Object.freeze({ look: 1, rim: 0.16, lift: 0.04 });

/**
 * Runtime clip map. `null` = the rig has no such clip and TroopRig answers
 * procedurally (bind pose for idle/aim, stagger for hit, topple for
 * down/lie/up, hop for cheer); 'shot' is the authored firing clip the
 * crossbow rides.
 */
export const TROOP_CLIPS = Object.freeze({
  idle: null,
  walk: 'walk',
  run: 'run',
  aim: null,
  shoot: 'shot',
  hit: null,
  down: null,
  lie: null,
  up: null,
  cheer: null,
});

/** The Lv3 arbalest: the same authored shot clip (the rig has no 2H set). */
export const TROOP_CLIPS_2H = Object.freeze({ aim: null, shoot: 'shot' });

/** Durations of the procedural one-shots, in seconds. */
const PROC_DUR = Object.freeze({ hit: 0.22, down: 0.42, lie: 0.01, up: 0.34, cheer: 0.55 });

/**
 * BUILD 14: the garrison's crossbow per arms level. `paint` repaints the
 * crossbow atlas (rogue_texture.png, a palette of gradient swatches) on a
 * canvas copy: the stock's two wood swatches and the steel swatch get the
 * level's colours; `glow` is how much the bow lights itself at night (its
 * own colours as emissive) so the upgrade reads across the bailey.
 */
export const TROOP_BOWS = Object.freeze({
  1: Object.freeze({ model: 'crossbow', paint: null, scale: 1, glow: 0, twoHanded: false }),
  2: Object.freeze({ model: 'crossbow', paint: 'blue', scale: 1.16, glow: 0.22, twoHanded: false }),
  3: Object.freeze({ model: 'arbalest', paint: 'gold', scale: 1.1, glow: 0.38, twoHanded: true }),
});

/**
 * Where the crossbows' swatches sit in the atlas (u, v from the top left, in
 * eighths across and quarters down; both glTFs sample only these four).
 */
const BOW_SWATCHES = Object.freeze({
  wood: Object.freeze([[5, 1], [6, 1]]),
  steel: Object.freeze([[3, 1]]),
  string: Object.freeze([[0, 2]]),
});
const BOW_PAINTS = Object.freeze({
  // Lv2: royal-blue lacquered stock, bright cool steel
  blue: Object.freeze({ wood: [0.2, 0.38, 0.92], steel: [0.86, 0.9, 0.98], string: null }),
  // Lv3: deep royal blue with gold fittings and an ivory string
  gold: Object.freeze({ wood: [0.16, 0.3, 0.86], steel: [1.0, 0.78, 0.22], string: [1.0, 0.96, 0.86] }),
});

/**
 * A canvas copy of the crossbow atlas with the level's colours. Each swatch
 * keeps its own light-to-dark gradient (and the lit stripe on its edge): a
 * pixel's brightness relative to its swatch's mean scales the new colour.
 * The vendored PNG is untouched.
 */
export function paintBowAtlas(texture, paint) {
  const image = texture && texture.image;
  const scheme = BOW_PAINTS[paint];
  if (!image || !scheme || typeof document === 'undefined' || !(image.width > 0)) return null;
  const w = image.width, h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const sw = w / 8, sh = h / 4;
  let changed = 0;
  for (const [part, cells] of Object.entries(BOW_SWATCHES)) {
    const colour = scheme[part];
    if (!colour) continue;
    for (const [cx, cy] of cells) {
      const x0 = Math.round(cx * sw), y0 = Math.round(cy * sh);
      const data = ctx.getImageData(x0, y0, Math.round(sw), Math.round(sh));
      const d = data.data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const mean = Math.max(1, sum / (d.length / 4));
      for (let i = 0; i < d.length; i += 4) {
        const k = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / mean;
        d[i] = Math.min(255, Math.round(colour[0] * 255 * k));
        d[i + 1] = Math.min(255, Math.round(colour[1] * 255 * k));
        d[i + 2] = Math.min(255, Math.round(colour[2] * 255 * k));
      }
      ctx.putImageData(data, x0, y0);
      changed++;
    }
  }
  if (!changed) return null;
  const out = new THREE.CanvasTexture(canvas);
  for (const key of ['flipY', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'generateMipmaps', 'anisotropy', 'colorSpace', 'channel']) {
    if (texture[key] !== undefined) out[key] = texture[key];
  }
  out.name = `${texture.name || 'rogue_texture'}-${paint}`;
  out.needsUpdate = true;
  return out;
}

/** Every loadout carries the garrison crossbow; the roles stay named for world3d. */
export const TROOP_LOADOUTS = Object.freeze({
  guard: Object.freeze({ bow: true }),
  soldier: Object.freeze({ bow: true }),
  bearer: Object.freeze({ bow: true }),
});

/** The bone the crossbow mounts on (the rig's full-finger right hand). */
const HAND_BONE_R = 'R_Hand';

/**
 * The crossbow's seat in the hand, in the template's own units (the GLB
 * stands ~1 unit tall) and radians, plus how long the bow reads against the
 * body. Tuned on the fx-gate/fx-barracks shots: the stock sits in the palm,
 * the barrel level along the aim direction.
 */
const BOW_MOUNT = Object.freeze({
  length: 0.52,          // share of the troop's height the bow spans
  pos: Object.freeze([0.035, 0.055, 0.1]),
  // tuned on the frozen shot-clip probe (2026-10-19): the stock's +Z rides
  // the hand's finger axis, so the authored shot pose aims the bow level
  rot: Object.freeze([-Math.PI / 2, 0, 0]),
});

/** One troop's skinned body, its mixer, procedural states and a tiny clip machine. */
export class TroopRig {
  constructor(model, clips, kind) {
    this.model = model;
    this.kind = kind;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    this.base = null;        // the looping clip name (null clip = bind pose)
    this.once = null;        // a one-shot playing over it: { name, action, then }
    this.proc = null;        // a procedural one-shot: { name, t, dur, then }
    this.state = 'none';     // what QA and the sync read: the state in front
    this.materials = [];
    this._hopPx = 12;
    model.traverse((object) => {
      if (!object.isMesh) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material && !this.materials.includes(material)) this.materials.push(material);
    });
    this._flash = 0;
  }

  action(name) {
    let action = this.actions.get(name);
    if (action) return action;
    const clipName = (this.clipMap && name in this.clipMap) ? this.clipMap[name] : (TROOP_CLIPS[name] !== undefined ? TROOP_CLIPS[name] : name);
    if (!clipName) return null;
    const clip = this.clips.get(clipName);
    if (!clip) return null;
    action = this.mixer.clipAction(clip);
    this.actions.set(name, action);
    return action;
  }

  /** Switch the looping state (cross-faded). A null clip stands on the bind pose. */
  loop(name, fade = 0.2, timeScale = 1) {
    const next = this.action(name);
    if (!next) {
      if (this.base === name && !this.once) return;
      const prev = this.base ? this.action(this.base) : null;
      this.base = name;
      this.once = null;
      if (prev) prev.fadeOut(fade);
      this.state = name;
      return;
    }
    next.timeScale = timeScale;
    if (this.base === name) return;
    const prev = this.base ? this.action(this.base) : null;
    this.base = name;
    if (this.once) return; // the one-shot hands over to it when it ends
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.state = name;
  }

  /**
   * Play a state once over the loop, then hand back (or go on to `then`).
   * A state the rig has no clip for is answered by the body: a stagger
   * (hit), a topple (down→lie), a rise (up) or a hop (cheer).
   */
  play(name, { fade = 0.08, then = null, timeScale = 1 } = {}) {
    const action = this.action(name);
    if (!action) {
      this.proc = { name, t: 0, dur: (PROC_DUR[name] || 0.3) / Math.max(0.1, timeScale), then };
      this.once = null;
      this.state = name;
      if (name === 'down' || name === 'up') this._silenceBase(fade);
      return;
    }
    const front = this.once ? this.once.action : (this.base ? this.action(this.base) : null);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    action.setEffectiveWeight(1).fadeIn(fade).play();
    if (front && front !== action) front.fadeOut(fade);
    this.once = { name, action, then };
    this.state = name;
  }

  /** Feet stop while the body topples or rises. */
  _silenceBase(fade = 0.1) {
    const base = this.base ? this.action(this.base) : null;
    if (base) base.fadeOut(fade);
  }

  playing(name) { return this.state === name; }

  /**
   * Swap the clips behind some names (BUILD 14 kept: a Lv3 guard aims and
   * shoots the arbalest; on this rig both map to the same authored shot).
   */
  setClipMap(map) {
    const before = this.clipMap || {};
    const after = map || {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if ((before[name] || null) === (after[name] || null)) continue;
      const action = this.actions.get(name);
      if (!action) continue;
      action.stop();
      this.actions.delete(name);
    }
    this.clipMap = map ? { ...map } : null;
    const base = this.base;
    if (base && !this.once && (before[base] || null) !== (after[base] || null)) {
      this.base = null;
      this.loop(base, 0.1);
    }
  }

  update(dt) {
    const proc = this.proc;
    if (proc) {
      proc.t += dt;
      const k = Math.max(0, Math.min(1, proc.t / proc.dur));
      if (proc.name === 'down' || proc.name === 'lie') {
        this.model.rotation.x = -k * Math.PI / 2;
      } else if (proc.name === 'up') {
        this.model.rotation.x = -(1 - k) * Math.PI / 2;
      } else if (proc.name === 'hit') {
        this.model.rotation.z = Math.sin(k * Math.PI) * 0.2;
      } else if (proc.name === 'cheer') {
        this.model.position.y = (this._baseY || 0) + Math.sin(k * Math.PI) * this._hopPx;
      }
      if (k >= 1) {
        this.proc = null;
        if (proc.name === 'hit') this.model.rotation.z = 0;
        if (proc.name === 'cheer') this.model.position.y = this._baseY || 0;
        if (proc.name === 'down') {
          // toppled: stay down (the world holds 'lie' until the guard rises)
          this.model.rotation.x = -Math.PI / 2;
          const then = proc.then || 'lie';
          this.base = null;
          this.loop(then, 0.12);
        } else if (proc.name === 'up') {
          this.model.rotation.x = 0;
          const back = this.base || 'idle';
          this.base = null;
          this.loop(back, 0.15);
        }
      }
    }
    const once = this.once;
    if (once) {
      const duration = once.action.getClip().duration;
      if (once.action.time >= duration - 0.12 || !once.action.isRunning()) {
        this.once = null;
        if (once.then) {
          const then = once.then;
          this.base = null;
          this.loop(then, 0.12);
        } else if (this.base) {
          const base = this.action(this.base);
          if (base) {
            base.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.15).play();
          }
          once.action.fadeOut(0.15);
          this.state = this.base;
        }
      }
    }
    this.mixer.update(dt);
  }

  /**
   * A red flash on the body while `amount` (0..1) is up. A material's own
   * glow (a painted Lv2/Lv3 bow lights itself) is what it fades back to.
   */
  flash(amount) {
    const k = Math.max(0, Math.min(1, amount || 0));
    if (Math.abs(k - this._flash) < 0.02) return;
    this._flash = k;
    for (const material of this.materials) {
      if (!material.emissive) continue;
      const ud = material.userData || (material.userData = {});
      if (!ud.troopGlow) {
        const i = material.emissiveIntensity == null ? 1 : material.emissiveIntensity;
        ud.troopGlow = { r: material.emissive.r * i, g: material.emissive.g * i, b: material.emissive.b * i };
      }
      const base = ud.troopGlow;
      material.emissive.setRGB(base.r * (1 - k) + 0.95 * k, base.g * (1 - k) + 0.16 * k, base.b * (1 - k) + 0.12 * k);
      material.emissiveIntensity = 1;
    }
  }
}

class TroopStage {
  constructor() {
    this.started = false;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.template = null;
    this.crossbow = null;
    this.arbalest = null;
    this.bows = new Map();   // arms level -> { model, material } (BUILD 14)
    this.twoHanded = false;  // the rig has no 2H clips; the arbalest is a look
    this.clips = new Map();
    this.height = 1;       // the template's standing height, model units
    this.minY = 0;         // the bind pose's foot offset (feet land on y = 0)
    this.made = 0;
    this.livery = 0;
  }

  /** Start all fetches (idempotent). Safe without a DOM (node QA): no-op. */
  init() {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    const loader = new GLTFLoader();
    let soldier = null, bow = null, bowSettled = false, big = null, bigSettled = false;
    const settle = () => {
      if (!soldier || !bowSettled || !bigSettled) return;
      try { this._accept(soldier, bow, big); } catch (error) { this._fail(error); }
    };
    loader.load(TROOP_ASSETS.soldier, (gltf) => { soldier = gltf; settle(); }, undefined, (error) => this._fail(error));
    // the crossbows are a dressing: without them a guard still stands
    // (and without the arbalest a Lv3 guard keeps the painted 1H bow)
    loader.load(TROOP_ASSETS.crossbow, (gltf) => { bow = gltf; bowSettled = true; settle(); }, undefined, () => { bowSettled = true; settle(); });
    loader.load(TROOP_ASSETS.arbalest, (gltf) => { big = gltf; bigSettled = true; settle(); }, undefined, () => { bigSettled = true; settle(); });
  }

  _fail(error) {
    this.failed = true;
    this.ready = false;
    this.error = String(error && error.message || error);
  }

  _accept(soldier, bow, big = null) {
    for (const clip of soldier.animations || []) this.clips.set(clip.name, clip);
    const missing = ['walk', 'run', 'shot'].filter((name) => !this.clips.has(name));
    if (missing.length) throw new Error(`troop clips missing: ${missing.join(', ')}`);
    this.template = soldier.scene;
    this.template.traverse((object) => {
      if (object.isSkinnedMesh) object.frustumCulled = false;
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = false; }
    });
    if (bow && bow.scene) {
      this.crossbow = bow.scene;
      this.crossbow.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    }
    if (big && big.scene) {
      this.arbalest = big.scene;
      this.arbalest.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    }
    // standing height in the bind pose, so a troop is scaled to world px
    const probe = cloneRig(this.template);
    probe.visible = true;
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(probe);
    const size = new THREE.Vector3();
    box.getSize(size);
    this.height = size.y > 0.01 ? size.y : 1;
    this.minY = box.min.y;
    this.livery = 1;   // the garrison palette grade ships with every clone
    this.ready = true;
  }

  /**
   * A new troop: `kind` is a TROOP_LOADOUTS key. Returns a TroopRig whose
   * `model` stands on y = 0 and is `heightPx` world px tall, graded into the
   * garrison's cut of the captain's palette.
   */
  make(kind, heightPx, { arms = 1 } = {}) {
    if (!this.ready) return null;
    const model = cloneRig(this.template);
    model.visible = true;
    model.name = `troop-3d-${kind}`;
    model.rotation.order = 'YXZ';
    model.traverse((object) => { if (object.isSkinnedMesh) object.frustumCulled = false; });
    // the same shader family the captain wears, in the garrison's palette
    const grade = buildUniformGrade(model, TROOP_PALETTE, 'duskhold-troop-look-v1');
    // BUILD 23: then the garrison's own kit, so a guard is not a recoloured
    // captain (user: "kapten dan pasukan sama, harusnya beda")
    dressGarrison(model);
    grade.uCapLook.value = TROOP_LOOK.look;
    grade.uCapRim.value = TROOP_LOOK.rim;
    grade.uCapLift.value = TROOP_LOOK.lift;
    const scale = heightPx / Math.max(0.01, this.height);
    model.scale.setScalar(scale);
    model.position.y = -this.minY * scale;
    this.made++;
    const rig = new TroopRig(model, this.clips, kind);
    rig.loadout = TROOP_LOADOUTS[kind] || TROOP_LOADOUTS.soldier;
    rig._baseY = model.position.y;
    rig._hopPx = heightPx * 0.09;
    if (rig.loadout.bow) this.arm(rig, arms);
    rig.loop('idle', 0);
    rig.update(0);
    return rig;
  }

  /** The span of a bow's source scene, in its own units (for the hand mount). */
  _bowSpan(source) {
    if (source.userData.bowSpan) return source.userData.bowSpan;
    source.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(source);
    const size = new THREE.Vector3();
    box.getSize(size);
    const span = Math.max(size.x, size.y, size.z) || 1;
    source.userData.bowSpan = span;
    return span;
  }

  /**
   * The crossbow for an arms level (BUILD 14): the model and its painted
   * material, made once per level. Null before the files arrive.
   */
  bow(level = 1) {
    const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
    if (this.bows.has(lv)) return this.bows.get(lv);
    const spec = TROOP_BOWS[lv];
    const source = (spec.model === 'arbalest' && this.arbalest) || this.crossbow;
    if (!source) return null;
    const model = source.clone(true);
    let material = null;
    model.traverse((object) => {
      if (!object.isMesh) return;
      const base = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!material) {
        material = base && base.clone ? base.clone() : new THREE.MeshStandardMaterial({ color: 0x8a6a48 });
        const painted = spec.paint && base && base.map ? paintBowAtlas(base.map, spec.paint) : null;
        if (painted) {
          material.map = painted;
          if (spec.glow > 0 && material.emissive) {
            material.emissiveMap = painted;
            material.emissive = new THREE.Color(1, 1, 1);
            material.emissiveIntensity = spec.glow;
          }
        }
        material.name = `troop-crossbow-lv${lv}`;
        material.needsUpdate = true;
      }
      object.material = material;
    });
    const rec = { level: lv, model, material, spec, twoHanded: spec.twoHanded && source === this.arbalest };
    this.bows.set(lv, rec);
    return rec;
  }

  /**
   * Put the arms level's crossbow in a guard's right hand (BUILD 14, BUILD
   * 21: on the character rig's R_Hand bone). Its own material copy, so a
   * hurt flash reddens this guard's bow only. Returns true when the bow
   * changed.
   */
  arm(rig, level = 1) {
    if (!rig || !this.ready) return false;
    const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
    if (rig.armsLevel === lv) return false;
    const rec = this.bow(lv);
    const slot = rig.model.getObjectByName(HAND_BONE_R);
    if (!rec || !slot) return false;
    const old = slot.getObjectByName('troop-crossbow');
    if (old) {
      slot.remove(old);
      old.traverse((object) => {
        if (!object.isMesh) return;
        rig.materials = rig.materials.filter((m) => m !== object.material);
        if (object.material && object.material.dispose) object.material.dispose();
      });
    }
    const bow = rec.model.clone(true);
    bow.name = 'troop-crossbow';
    // seat it in the hand: normalised to read BOW_MOUNT.length of the body
    const span = this._bowSpan(rec.model);
    const local = (BOW_MOUNT.length * this.height) / span;
    bow.scale.setScalar(local * (rec.spec.scale || 1));
    bow.position.set(BOW_MOUNT.pos[0] * this.height, BOW_MOUNT.pos[1] * this.height, BOW_MOUNT.pos[2] * this.height);
    bow.rotation.set(BOW_MOUNT.rot[0], BOW_MOUNT.rot[1], BOW_MOUNT.rot[2]);
    const own = rec.material.clone();
    bow.traverse((object) => { if (object.isMesh) { object.material = own; object.castShadow = true; } });
    rig.materials.push(own);
    slot.add(bow);
    rig.setClipMap(rec.twoHanded ? TROOP_CLIPS_2H : null);
    rig.armsLevel = lv;
    rig.twoHanded = !!rec.twoHanded;
    rig._flash = -1;   // re-apply the flash state to the new material
    return true;
  }
}

export const Troop3D = new TroopStage();
