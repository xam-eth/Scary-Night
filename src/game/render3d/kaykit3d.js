/**
 * kaykit3d.js — BUILD 28 cast: the KayKit CC0 family replaces both off-theme
 * packs (egyptian_people.glb heroes, polyart modern zombies horde) after the
 * visual-sync audit + prototype lineup (qa-evidence/cast-research/).
 *
 * Why this pack (research, user-approved 2026-10-23):
 *  - CC0 1.0 Universal (Kay Lousberg, kaylousberg.com) — commercial-safe, the
 *    LICENSE.txt files ship beside the .glb files in this folder.
 *  - One art family with the world: chunky stylised proportions, saturated
 *    flat-ish shading; under the bailey's daylight they read like the props.
 *  - Skeletons match the concept sheet's undead (peasant rag tunic, horned
 *    helm undead soldier) and glow-eyed night readability.
 *  - 76–95 authored clips per character (idle/walk/run/attack families,
 *    deaths, spawns) — the old packs needed synthesised attack/die clips.
 *
 * Public surface mirrors pack3d.js (heroes) and zombipack3d.js (horde) so the
 * consumers (valen3d captain, troop3d garrison, enemy3d horde) keep their
 * call shapes: People3D.{stage,people,make,error}, PEOPLE_ROLES,
 * KayKitHorde.{stage,forKind}. Clips are RENAMED to the game's short names
 * ('walk','run','shot','idle','attack','die') because troop3d keys its clip
 * table by clip.name and enemy3d's maps are identity for this pack.
 */
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const HERO_BASE = 'assets/troops/kaykit/';
export const KAYKIT_HERO_URLS = Object.freeze({
  Knight: `${HERO_BASE}Knight.glb`,
  Rogue: `${HERO_BASE}Rogue.glb`,
  Barbarian: `${HERO_BASE}Barbarian.glb`,
  Rogue_Hooded: `${HERO_BASE}Rogue_Hooded.glb`,
});
export const KAYKIT_HORDE_URLS = Object.freeze({
  Skeleton_Minion: `${HERO_BASE}Skeleton_Minion.glb`,
  Skeleton_Rogue: `${HERO_BASE}Skeleton_Rogue.glb`,
  Skeleton_Mage: `${HERO_BASE}Skeleton_Mage.glb`,
});
/** valen3d imports this for its fetch bookkeeping. */
export const PEOPLE_MODEL_URL = KAYKIT_HERO_URLS.Knight;

/** Same role keys as pack3d.PEOPLE_ROLES so troop3d/valen3d stay unchanged. */
export const PEOPLE_ROLES = Object.freeze({
  captain: 'Knight',
  soldier: 'Rogue',        // clean-handed scout — carries the garrison crossbow
  bearer: 'Rogue_Hooded',  // hooded standard-bearer
  melee: 'Barbarian',      // the muscle; bow rides his left hand slot
  king: 'Knight',
  slave: 'Rogue',
});

/** authored KayKit clip name → the game's short name (heroes).
 *  'claw' and 'sword' complete valen3d's captain contract (VALEN_CLIPS):
 *  the unarmed swing and the sword swing both ride authored melee clips. */
const HERO_CLIP_SRC = Object.freeze({
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  shot: '1H_Ranged_Shoot',
  aim: '1H_Ranged_Aiming',
  attack: '1H_Melee_Attack_Chop',
  claw: '1H_Melee_Attack_Chop',
  sword: '1H_Melee_Attack_Slice_Diagonal',
  die: 'Death_A',
});
/** horde states; enemy3d's KAYKIT_HORDE_MAP is identity over these names. */
const HORDE_CLIP_SRC = Object.freeze({
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  attack: '1H_Melee_Attack_Chop',
  die: 'Death_A',
  spawn: 'Spawn_Ground',
});

/** Weapon-slot bones: KayKit rigs ship dedicated hand sockets. */
const BOW_BONE = Object.freeze({
  Knight: 'handslot.r',
  Rogue: 'handslot.r',
  Rogue_Hooded: 'handslot.r',
  Barbarian: 'handslot.l', // his authored stance favours the left socket
});

/** Bone tint per horde kind — the concept sheet's undead palette: pale-green
 *  peasant bone for the ghoul line, ash for the runner, cold bog for the
 *  caster. The authored 'Glow' eye material stays untouched (night read). */
const HORDE_BONE_TINT = Object.freeze({
  shambler: 0xd9e6c3,
  lurcher: 0xd9d6c9,
  wretch: 0xcfe0da,
});

let _loader = null;
const load = (url) => new Promise((res, rej) => {
  if (!_loader) _loader = new GLTFLoader();
  _loader.load(url, res, undefined, rej);
});

/** Self-contained skinned clone (same contract as enemy3d.cloneRig): own
 *  materials per rig, re-bound skeleton, invisible until the caller poses. */
function cloneRig(root) {
  const clone = root.clone(true);
  const materials = new Map();
  clone.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const one = (material) => {
      if (!material) return material;
      let copy = materials.get(material);
      if (!copy) { copy = material.clone(); materials.set(material, copy); }
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(one) : one(object.material);
  });
  const sourceMeshes = [];
  root.traverse((object) => { if (object.isSkinnedMesh) sourceMeshes.push(object); });
  const clonedMeshes = [];
  clone.traverse((object) => { if (object.isSkinnedMesh) clonedMeshes.push(object); });
  clonedMeshes.forEach((mesh, index) => {
    const src = sourceMeshes[index];
    if (!src || !src.skeleton) return;
    const bones = src.skeleton.bones.map((bone) => clone.getObjectByName(bone.name));
    if (bones.some((bone) => !bone)) return;
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
    mesh.frustumCulled = false;
  });
  clone.traverse((object) => { if (object.isSkinnedMesh) object.frustumCulled = false; });
  clone.visible = false;
  return clone;
}

function renamedClips(animations, table) {
  const clips = {};
  for (const [short, src] of Object.entries(table)) {
    const clip = (animations || []).find((c) => c.name === src);
    if (!clip) continue;
    const copy = clip.clone();
    copy.name = short;
    clips[short] = copy;
  }
  return clips;
}

export const People3D = {
  ready: false,
  error: null,
  /** role → { root, clips } staged templates (make() clones them). */
  people: new Map(),

  stage() {
    if (this._promise) return this._promise;
    this._promise = Promise.all(Object.entries(KAYKIT_HERO_URLS).map(async ([name, url]) => {
      const gltf = await load(url);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const height = Math.max(0.001, box.max.y - box.min.y);
      // pack3d contract: people stand 1 unit tall with feet on y = 0
      root.scale.setScalar(1 / height);
      root.position.y = -box.min.y / height;
      root.name = `kaykit-hero-${name}`;
      this.people.set(name, { root, clips: renamedClips(gltf.animations, HERO_CLIP_SRC) });
    })).then(() => {
      this.ready = true;
      return this;
    }).catch((error) => {
      this.error = String((error && error.message) || error);
      throw error;
    });
    return this._promise;
  },

  /** A fresh rigged copy of one hero, clips included (pack3d.make shape). */
  make(role) {
    const person = this.people.get(role);
    if (!person) return null;
    const model = cloneRig(person.root);
    model.visible = true;
    return {
      model,
      clips: person.clips,
      height: 1,
      bowBone: BOW_BONE[role] || 'handslot.r',
      gradeSafe: true, // uniform-grade shader is texture-agnostic (look stays 0)
    };
  },
};

const HORDE_KINDS = Object.freeze([
  { key: 'shambler', file: 'Skeleton_Minion' },
  { key: 'lurcher', file: 'Skeleton_Rogue' },
  { key: 'wretch', file: 'Skeleton_Mage' },
]);
/** for the QA gates: the three horde keys this pack fields. */
export const KAYKIT_HORDE_KINDS = HORDE_KINDS;

export const KayKitHorde = {
  ready: false,
  error: null,
  variants: [],

  stage() {
    if (this._promise) return this._promise;
    this._promise = Promise.all(HORDE_KINDS.map(async (kind) => {
      const gltf = await load(KAYKIT_HORDE_URLS[kind.file]);
      const root = gltf.scene;
      root.name = `kaykit-horde-${kind.key}`;
      const tint = HORDE_BONE_TINT[kind.key];
      root.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of mats) {
          if (material.name === 'skeleton' && tint != null) material.color.setHex(tint);
        }
      });
      const clips = renamedClips(gltf.animations, HORDE_CLIP_SRC);
      this.variants[kind.key] = {
        template: root,
        clips,
        animations: Object.values(clips),
        height: 1,
      };
    })).then(() => {
      this.ready = true;
      return this;
    }).catch((error) => {
      this.error = String((error && error.message) || error);
      throw error;
    });
    return this._promise;
  },

  /** The variant rig behind a horde key (zombipack3d.forKind shape). */
  forKind(key) {
    return this.variants[key] || null;
  },

  diagnostics() {
    return {
      ready: this.ready, error: this.error,
      kinds: HORDE_KINDS.map((k) => k.key),
    };
  },
};

/** enemy3d map for the pack-backed kinds: identity over the short names. */
export const KAYKIT_HORDE_MAP = Object.freeze({
  walk: 'walk',
  run: 'run',
  attack: 'attack',
  die: 'die',
  idle: 'idle',
});
