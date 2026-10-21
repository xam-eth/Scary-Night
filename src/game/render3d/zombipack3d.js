/**
 * BUILD 25 — the horde wears the user's zombie pack (2026-10-21).
 *
 * The user's pack commit (`154d27f`) ships `polyart_zombies_with_animations_
 * free_pack.glb`: ten skinned biped zombies that SHARE one 7.37 s take
 * (their walk) and carry no attack/die clips. The crowd baker demands
 * walk + die (attack falls back to walk), so this module:
 *
 *   1. loads the pack once and splits it into ten variant rigs (each skin's
 *      mesh + its own suffixed bip skeleton);
 *   2. synthesises the missing clips as real THREE.AnimationClips on each
 *      variant's bones — `pack-attack` (a lunging bite) and `pack-die`
 *      (collapse backwards) — so bakeKind() finds walk/attack/die;
 *   3. hands survival's horde three of those variants as its faction,
 *      keeping the ultimate-monster roster for the legacy mansion.
 *
 * Bone names are per-variant (`bip Spine_04`, `bip Spine002_043`, …): every
 * generated track is addressed through the variant's own joint list, never
 * a hard-coded name.
 */
import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

export const ZOMBI_PACK_URL = './polyart_zombies_with_animations_free_pack.glb';

/** The three horde slots the survival night fields from the pack. Variants
 *  are picked for distinct silhouettes: 0 = female A (bare), 5 = male A
 *  (bare), 9 = male E wearing the beanie (the pack's one hat). */
export const ZOMBI_KINDS = Object.freeze([
  { key: 'shambler', variant: 0 },
  { key: 'lurcher', variant: 5 },
  { key: 'wretch', variant: 9 },
]);

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Joint roles of one variant: 'bip_Spine002_043' -> 'Spine', 'bip_L_UpperArm_012'
 *  -> 'L_UpperArm'. Digits are stripped entirely because each variant
 *  renumbers its chain (Spine/Spine002/Spine004 …); every spine joint then
 *  shares the bend, which reads as a fold instead of a hinge. */
function jointRole(name) {
  return name.replace(/^bip_?/, '').replace(/\d+/g, '');
}

/**
 * One synthetic clip: `pose(t)` returns role -> euler; every joint of the
 * variant whose role appears gets a quaternion track, the rest stay rest.
 */
function bakeVariantClip(name, duration, variant, pose) {
  const fps = 24;
  const frames = Math.max(2, Math.round(duration * fps));
  const roles = new Map();
  for (const joint of variant.joints) roles.set(jointRole(joint.name), joint);
  const tracks = [];
  const times = new Float32Array(frames);
  const per = new Map([...roles.keys()].map((r) => [r, new Float32Array(frames * 4)]));
  for (let f = 0; f < frames; f++) {
    const t = duration * (f / frames);
    times[f] = t;
    const p = pose(t);
    for (const [role, joint] of roles) {
      const e = p[role] || [0, 0, 0];
      _q.setFromEuler(_e.set(e[0], e[1], e[2]));
      per.get(role).set([_q.x, _q.y, _q.z, _q.w], f * 4);
    }
  }
  for (const [role, joint] of roles) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${joint.node.name}.quaternion`, times, per.get(role)));
  }
  // root sink: the pelvis drops so the die clip reads as a collapse
  const pelvis = roles.get('Pelvis') || roles.get('Pelvis001') || [...roles.entries()].find(([r]) => /Pelvis/.test(r))?.[1];
  if (pelvis && pose.__root) {
    const rt = new Float32Array(frames);
    const rv = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = duration * (f / frames);
      rt[f] = t;
      const r = pose.__root(t);
      rv.set(r, f * 3);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${pelvis.node.name}.position`, rt, rv));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Lunge: spine folds forward, arms reach, head juts — a bite, not a wave. */
function attackPose(t) {
  const l = Math.min(1, t / 0.18);
  const back = t > 0.3 ? Math.min(1, (t - 0.3) / 0.2) : 0;
  const f = l - back * 0.8;
  return {
    Spine: [0.5 * f, 0, 0], Spine1: [0.3 * f, 0, 0], Neck: [0.2 * f, 0, 0], Head: [0.25 * f, 0, 0],
    'L_UpperArm': [-1.1 * f, 0, 0.3 * f], 'R_UpperArm': [-1.1 * f, 0, -0.3 * f],
    'L_Forearm': [-0.5 * f, 0, 0], 'R_Forearm': [-0.5 * f, 0, 0],
    'L_Thigh': [0.25 * f, 0, 0], 'R_Thigh': [-0.2 * f, 0, 0],
    'L_Calf': [-0.3 * f, 0, 0], 'R_Calf': [-0.15 * f, 0, 0],
  };
}

/** Collapse: pelvis drops and pitches back, knees give, arms flail down. */
function diePose(t) {
  const f = Math.min(1, t / 0.4);
  const e = f * f;
  return {
    __root: (tt) => {
      const k = Math.min(1, tt / 0.4);
      return [0, -0.28 * k * k, 0];
    },
    Spine: [-0.9 * e, 0, 0.15 * e], Spine1: [-0.5 * e, 0, 0], Neck: [-0.3 * e, 0, 0], Head: [-0.4 * e, 0, 0],
    'L_UpperArm': [0.7 * e, 0, 0.5 * e], 'R_UpperArm': [0.6 * e, 0, -0.5 * e],
    'L_Forearm': [0.4 * e, 0, 0], 'R_Forearm': [0.4 * e, 0, 0],
    'L_Thigh': [0.8 * e, 0, 0], 'R_Thigh': [0.6 * e, 0, 0],
    'L_Calf': [-1.1 * e, 0, 0], 'R_Calf': [-0.9 * e, 0, 0],
    'L_Foot': [0.4 * e, 0, 0], 'R_Foot': [0.3 * e, 0, 0],
  };
}

export const ZombiPack3D = {
  ready: false,
  error: null,
  variants: [],
  _promise: null,

  stage() {
    if (!this._promise) {
      this._promise = new Promise((resolve) => {
        new GLTFLoader().load(ZOMBI_PACK_URL, (gltf) => {
          try {
            this._split(gltf);
            this.ready = this.variants.length > 0;
          } catch (error) {
            this.error = String(error && error.message || error);
          }
          resolve(this);
        }, undefined, (error) => {
          this.error = String(error && error.message || error);
          resolve(this);
        });
      });
    }
    return this._promise;
  },

  _split(gltf) {
    const scene = gltf.scene;
    const walk = (gltf.animations || [])[0];
    scene.updateMatrixWorld(true);
    // a variant = every skinned mesh sharing one skeleton: the pack ships 14
    // skinned nodes for 10 skins because four hair/hat accessories ride their
    // body's skeleton (skins 1, 2, 6, 9) and must stay attached
    const skinned = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    const bySkeleton = new Map();
    for (const mesh of skinned) {
      const skel = mesh.skeleton;
      if (!skel) continue;
      if (!bySkeleton.has(skel)) bySkeleton.set(skel, []);
      bySkeleton.get(skel).push(mesh);
    }
    let vi = -1;
    for (const [skeleton, meshes] of bySkeleton) {
      vi++;
      const joints = skeleton.bones.map((bone) => ({ name: bone.name, node: bone }));
      const variant = { index: vi, meshes, joints, clips: {} };
      // BUILD 26 fix (user report 2026-10-21: "rig jalan nya posisi salah …
      // terlihat jalan baring"): every variant's rig hangs under a
      // `rig_CharRoot*` node that carries the pack's FBX->glTF axis
      // conversion (a -90 deg X quaternion) plus the lineup offset. The
      // reparent below moves meshes and joint roots out from under it, so
      // without keeping that orientation the horde rendered lying on its
      // back (and the bbox-height normaliser then blew the scale up). Keep
      // the rotation, drop the offset: the game places each body itself.
      const lostQ = new THREE.Quaternion();
      if (meshes[0] && meshes[0].parent) meshes[0].parent.getWorldQuaternion(lostQ);
      variant.lostOrientation = lostQ.clone();
      // the shared take animates every variant's own bones by name
      if (walk) variant.clips.walk = walk;
      variant.clips['pack-attack'] = bakeVariantClip('pack-attack', 0.5, variant, attackPose);
      const die = bakeVariantClip('pack-die', 0.55, variant, diePose);
      variant.clips['pack-die'] = die;
      // template root: the variant's meshes plus the roots of its joint tree,
      // so cloneRig/bakeKind see a self-contained rig (both clone it)
      const root = new THREE.Group();
      root.name = `zombi-variant-${vi}`;
      root.quaternion.copy(lostQ);   // stand the rig up the way the pack authored it
      const jointSet = new Set(skeleton.bones);
      for (const mesh of meshes) {
        if (mesh.parent) mesh.parent.remove(mesh);
        root.add(mesh);
      }
      for (const bone of skeleton.bones) {
        if (!bone.parent || !jointSet.has(bone.parent)) root.add(bone);
      }
      root.updateMatrixWorld(true);
      variant.template = root;
      variant.animations = [walk, variant.clips['pack-attack'], die].filter(Boolean);
      variant.height = 1;
      this.variants.push(variant);
    }
  },

  /** The variant rig behind a horde key, or null before stage() settles. */
  forKind(key) {
    const spec = ZOMBI_KINDS.find((k) => k.key === key);
    if (!spec) return null;
    return this.variants[spec.variant] || null;
  },

  diagnostics() {
    return {
      ready: this.ready, error: this.error, variants: this.variants.length,
      kinds: ZOMBI_KINDS.map((k) => k.key),
    };
  },
};
