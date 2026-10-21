/**
 * BUILD 24 — the user's own character pack (2026-10-21).
 *
 * The user rejected the cloned-captain garrison ("pasukan masih sama, hanya
 * baju dan topi yang berbeda — ini clone GLB, bukan versi baru") and committed
 * two packs to the branch: `egyptian_people.glb` (five textured, UNRIGGED
 * characters: Commander, Slave, Warrior, Resident, King) and
 * `polyart_zombies_with_animations_free_pack.glb` (ten rigged zombies).
 *
 * This module builds the new people from the first pack: each static mesh is
 * given a generated skeleton (auto-skinned by bone-segment distance in the
 * bind pose) and a full procedural clip set baked into real
 * THREE.AnimationClips — walk, run, shot, idle, hit, down, lie, up, cheer,
 * plus the captain's claw/sword swings. So the garrison and the captain are
 * genuinely new characters from the user's pack, animated by us, sharing one
 * art style — not repaints of one GLB.
 *
 * Bone names mirror the captain's old rig where the game needs them
 * (`R_Hand` for the crossbow mount, `Head`, `Hip`, `Spine02`), so every
 * weapon layer, muzzle and QA contract keeps working unchanged.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';

export const PEOPLE_MODEL_URL = './egyptian_people.glb';

/** Which pack character each role wears. */
export const PEOPLE_ROLES = Object.freeze({
  captain: 'Commander',
  soldier: 'King',        // neutral arms, clean hands — carries the crossbow
  bearer: 'Resident',
  melee: 'Warrior',       // sculpted khopesh + shield, bow in the left hand
  king: 'King',
  slave: 'Slave',
});

/**
 * Measured hand positions (bind sheet 2026-10-21, normalised units, +X = the
 * character's left). The sculpts are posed — the Warrior is modelled mid-
 * swing with his khopesh up — so the arm chains must follow what each sculpt
 * actually holds, or the poses fight the geometry.
 */
const HANDS = Object.freeze({
  Commander: Object.freeze({ L: [0.17, 0.44, 0.03], R: [-0.17, 0.44, 0.03] }),
  Warrior: Object.freeze({ L: [0.3, 0.44, 0.16], R: [-0.3, 0.76, 0.06] }),
  Resident: Object.freeze({ L: [0.35, 0.4, 0.04], R: [-0.35, 0.4, 0.04] }),
  King: Object.freeze({ L: [0.18, 0.43, 0.02], R: [-0.18, 0.43, 0.02] }),
  Slave: Object.freeze({ L: [0.44, 0.52, 0.0], R: [-0.44, 0.52, 0.0] }),
});

/** Bind-pose skeleton in normalised units (feet 0, crown 1), Valen-like names. */
/** Bind-pose skeleton in normalised units (feet 0, crown 1), Valen-like names. */
export const BONES = Object.freeze([
  // name, parent, [x, y, z]
  ['Hip', null, [0, 0.475, 0]],
  ['Spine01', 'Hip', [0, 0.56, 0]],
  ['Spine02', 'Spine01', [0, 0.66, 0]],
  ['NeckTwist01', 'Spine02', [0, 0.8, 0]],
  ['Head', 'NeckTwist01', [0, 0.86, 0]],
  ['L_Upperarm', 'Spine02', [0.115, 0.775, 0]],
  ['L_Forearm', 'L_Upperarm', [0.115, 0.5, 0]],   // replaced per pose below
  ['L_Hand', 'L_Forearm', [0.115, 0.24, 0]],
  ['R_Upperarm', 'Spine02', [-0.115, 0.775, 0]],
  ['R_Forearm', 'R_Upperarm', [-0.115, 0.5, 0]],
  ['R_Hand', 'R_Forearm', [-0.115, 0.24, 0]],
  ['L_Thigh', 'Hip', [0.085, 0.47, 0]],
  ['L_Shin', 'L_Thigh', [0.095, 0.26, 0]],
  ['L_Foot', 'L_Shin', [0.1, 0.05, 0]],
  ['R_Thigh', 'Hip', [-0.085, 0.47, 0]],
  ['R_Shin', 'R_Thigh', [-0.095, 0.26, 0]],
  ['R_Foot', 'R_Shin', [-0.1, 0.05, 0]],
]);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();

/**
 * Where this mesh holds its hands: the mean of the outermost chest-height
 * vertices on each side. A pose with the arms out (Slave, Resident) gets a
 * different arm chain than one with them down (King, Commander).
 */
function handPose(position, role) {
  const table = HANDS[role];
  if (table) {
    return { L: new THREE.Vector3(...table.L), R: new THREE.Vector3(...table.R) };
  }
  const acc = { L: new THREE.Vector3(), R: new THREE.Vector3(), nL: 0, nR: 0 };
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    if (y < 0.15 || y > 0.72 || Math.abs(x) < 0.2) continue;
    if (x > 0) { acc.L.add(_v1.set(x, y, position.getZ(i))); acc.nL++; }
    else { acc.R.add(_v1.set(x, y, position.getZ(i))); acc.nR++; }
  }
  const out = {};
  for (const side of ['L', 'R']) {
    const n = acc[`n${side}`];
    const mean = n ? acc[side].clone().multiplyScalar(1 / n) : new THREE.Vector3(side === 'L' ? 0.3 : -0.3, 0.45, 0);
    // the hand sits a little beyond the mass centroid of the arm region
    out[side] = new THREE.Vector3(mean.x * 1.25, Math.max(0.16, mean.y * 0.72), mean.z * 1.2);
  }
  return out;
}

/**
 * Auto-skin: every vertex weighs to its two nearest bone segments, head and
 * feet regions locked to a single bone so the silhouette stays crisp.
 */
function skinGeometry(geometry, worldPos) {
  const position = geometry.attributes.position;
  const segments = [];
  for (const [name, parent] of BONES) {
    if (!parent) continue;
    segments.push([name, worldPos[parent].clone(), worldPos[name].clone()]);
  }
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const distSeg = (p, a, b) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
    return p.distanceTo(ab.multiplyScalar(t).add(a));
  };
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    let best = null, second = null;
    if (p.y > 0.76) {
      best = ['Head', 0.01]; second = ['NeckTwist01', 1];
    } else if (p.y < 0.09) {
      const side = p.x >= 0 ? 'L' : 'R';
      best = [`${side}_Foot`, 0.01]; second = [`${side}_Shin`, 1];
    } else {
      for (const [name, a, b] of segments) {
        const d = distSeg(p, a, b);
        if (!best || d < best[1]) { second = best; best = [name, d]; }
        else if (!second || d < second[1]) second = [name, d];
      }
    }
    if (!second) second = best;
    let w0 = 1 / Math.max(0.02, best[1] * best[1]);
    let w1 = 1 / Math.max(0.02, second[1] * second[1]);
    let third = null;
    // shoulder cloth (capes, collars, ceremonial panels) sits in the arms'
    // reach but must not fly with them: vertices near the torso that landed
    // on an arm bone get a Spine02 anchor, so the cloth rides the body and
    // only flares with the arm instead of turning into wings
    const armBone = /^(L|R)_(Upperarm|Forearm|Hand)$/.test(best[0]);
    if (armBone && p.y > 0.35 && distSeg(p, worldPos.Spine01, worldPos.NeckTwist01) < 0.42) {
      third = ['Spine02', 0.6];
      w0 *= 0.3; w1 *= 0.1;
    }
    const w2 = third ? third[1] : 0;
    const sum = w0 + w1 + w2;
    skinIndices.set([BONE_INDEX[best[0]], BONE_INDEX[second[0]], third ? BONE_INDEX[third[0]] : 0, 0], i * 4);
    skinWeights.set([w0 / sum, w1 / sum, w2 / sum, 0], i * 4);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
}

const BONE_INDEX = {};
BONES.forEach(([name], i) => { BONE_INDEX[name] = i; });

/* ---------------- procedural clip baking ---------------- */

const LIMBS = ['L_Upperarm', 'L_Forearm', 'L_Hand', 'R_Upperarm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot',
  'Hip', 'Spine01', 'Spine02', 'NeckTwist01', 'Head'];

/**
 * One pose of the gait: `k` is the cycle phase 0..1, `amp` the amplitude,
 * `lean` the forward pitch. Returns bone-name → euler angles.
 */
function gaitPose(k, amp, lean, bounce, rest = ZERO_REST2) {
  const s = Math.sin(k * Math.PI * 2);
  const c = Math.sin(k * Math.PI * 2 + Math.PI);
  return {
    L_Thigh: [s * amp, 0, 0],
    R_Thigh: [c * amp, 0, 0],
    L_Shin: [Math.max(0, -s) * amp * 0.9 + 0.08, 0, 0],
    R_Shin: [Math.max(0, -c) * amp * 0.9 + 0.08, 0, 0],
    L_Foot: [-s * amp * 0.35, 0, 0],
    R_Foot: [-c * amp * 0.35, 0, 0],
    L_AIM: swingDir(rest.dL, c * amp * 0.72 - 0.1),
    R_AIM: swingDir(rest.dR, s * amp * 0.72 - 0.1),
    L_Forearm: [-0.25 - Math.max(0, c) * amp * 0.5, 0, 0],
    R_Forearm: [-0.25 - Math.max(0, s) * amp * 0.5, 0, 0],
    Hip: [lean * 0.4, s * 0.05, 0],
    Spine01: [lean, -s * 0.06, 0],
    Spine02: [lean * 0.5, s * 0.05, 0],
    Head: [-lean * 0.8, 0, 0],
    NeckTwist01: [0, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    _bounce: Math.abs(Math.cos(k * Math.PI * 2)) * bounce,
  };
}

function shootPose(t, rest = ZERO_REST2) {
  // both arms swing up to the bow line, a recoil kick at 0.18 s, settle after
  const raise = Math.min(1, t / 0.12);
  const recoil = t > 0.16 && t < 0.3 ? Math.sin((t - 0.16) / 0.14 * Math.PI) : 0;
  // absolute aim: both arms level forward whatever pose the sculpt was
  // modelled in — the quaternion is built rest-direction → aim-direction
  // the sculpt's own arms, tilted forward at the horde: big absolute aims
  // tear the painted robes, so the aim is a modest delta off each sculpt's
  // rest direction (a wall guard hip-fires down the wall anyway)
  // arms stay in the sculpt's hold (a hip-fire from the wall); only a
  // recoil nudge — rotating these posed sculpts' arms tears painted robes
  const fwd = -0.1 - recoil * 0.1;
  return {
    L_AIM: swingDir(rest.dL, fwd),
    R_AIM: swingDir(rest.dR, fwd),
    L_Forearm: [-0.35 * raise - recoil * 0.3, 0, 0],
    R_Forearm: [-0.35 * raise - recoil * 0.3, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    Spine01: [0.06 * raise, -0.12 * raise, 0],
    Spine02: [0.04 * raise, 0.1 * raise, 0],
    Head: [-0.1 * raise, 0.12 * raise, 0],
    NeckTwist01: [0, 0, 0],
    Hip: [0, 0, 0],
    L_Thigh: [0.06 * raise, 0, 0], R_Thigh: [-0.06 * raise, 0, 0],
    L_Shin: [0.05, 0, 0], R_Shin: [0.05, 0, 0],
    L_Foot: [0, 0, 0], R_Foot: [0, 0, 0],
    _bounce: 0,
  };
}

function swingPose(t, side, rest = ZERO_REST2) {
  // the captain's claw/sword swing: wind up, cut across, follow through
  const w = t < 0.3 ? t / 0.3 : 1;
  const cut = t < 0.3 ? 0 : Math.min(1, (t - 0.3) / 0.25);
  const dir = side === 'R' ? 1 : -1;
  const arm = side === 'R' ? 'R' : 'L';
  const pose = {
    Hip: [0, -dir * 0.3 * w + dir * 0.5 * cut, 0],
    Spine01: [0.05, -dir * 0.35 * w + dir * 0.6 * cut, 0],
    Spine02: [0, -dir * 0.2 * w + dir * 0.4 * cut, 0],
    Head: [0, dir * 0.2 * w - dir * 0.3 * cut, 0],
    NeckTwist01: [0, 0, 0],
    L_Thigh: [0.05, 0, 0], R_Thigh: [-0.05, 0, 0],
    L_Shin: [0.05, 0, 0], R_Shin: [0.05, 0, 0],
    L_Foot: [0, 0, 0], R_Foot: [0, 0, 0],
    L_Upperarm: [0, 0, 0.06], R_Upperarm: [0, 0, -0.06],
    L_Forearm: [-0.25, 0, 0], R_Forearm: [-0.25, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    _bounce: 0,
  };
  const d = side === 'R' ? rest.dR : rest.dL;
  pose[`${arm}_AIM`] = swingDir(d, 0.3 * w - 0.7 * cut);
  pose[`${arm}_Forearm`] = [-0.6 * w + 0.5 * cut, 0, 0];
  return pose;
}

function fallPose(t, rest = ZERO_REST2) {
  // topple backwards onto the pack: hips pitch, knees give, arms flail up
  const f = Math.min(1, t / 0.42);
  const e = f * f;
  return {
    Hip: [-1.35 * e, 0, 0.12 * e],
    Spine01: [-0.3 * e, 0, 0],
    Spine02: [-0.25 * e, 0, 0],
    Head: [0.5 * e, 0, 0],
    NeckTwist01: [0, 0, 0],
    L_Thigh: [0.5 * e, 0, 0], R_Thigh: [0.35 * e, 0, 0],
    L_Shin: [-0.9 * e, 0, 0], R_Shin: [-0.7 * e, 0, 0],
    L_Foot: [0.4 * e, 0, 0], R_Foot: [0.3 * e, 0, 0],
    L_AIM: swingDir(rest.dL, -1.5 * e), R_AIM: swingDir(rest.dR, -1.3 * e),
    L_Forearm: [-0.5 * e, 0, 0], R_Forearm: [-0.5 * e, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    _bounce: -0.42 * e,
  };
}

function cheerPose(t, rest = ZERO_REST2) {
  const hop = Math.sin(t / 0.55 * Math.PI * 2);
  const up = Math.min(1, t / 0.18);
  return {
    L_AIM: swingDir(rest.dL, -1.1 * up), R_AIM: swingDir(rest.dR, -1.1 * up),
    L_Forearm: [-0.3 * up - hop * 0.15, 0, 0], R_Forearm: [-0.3 * up + hop * 0.15, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    Hip: [0, 0, 0], Spine01: [-0.08 * up, 0, 0], Spine02: [-0.06 * up, 0, 0],
    Head: [0.1 * up, 0, 0], NeckTwist01: [0, 0, 0],
    L_Thigh: [-0.18 * Math.max(0, hop), 0, 0], R_Thigh: [-0.18 * Math.max(0, -hop), 0, 0],
    L_Shin: [0.3 * Math.max(0, hop), 0, 0], R_Shin: [0.3 * Math.max(0, -hop), 0, 0],
    L_Foot: [0, 0, 0], R_Foot: [0, 0, 0],
    _bounce: Math.max(0, hop) * 0.05,
  };
}

function hitPose(t, rest = ZERO_REST2) {
  const j = Math.sin(Math.min(1, t / 0.22) * Math.PI);
  return {
    Hip: [-0.25 * j, 0, 0], Spine01: [-0.3 * j, 0, 0.15 * j], Spine02: [-0.2 * j, 0, 0],
    Head: [0.35 * j, 0, 0], NeckTwist01: [0, 0, 0],
    L_AIM: swingDir(rest.dL, -0.6 * j), R_AIM: swingDir(rest.dR, -0.6 * j),
    L_Forearm: [-0.6 * j, 0, 0], R_Forearm: [-0.6 * j, 0, 0],
    L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
    L_Thigh: [0.1 * j, 0, 0], R_Thigh: [-0.1 * j, 0, 0],
    L_Shin: [0.15 * j, 0, 0], R_Shin: [0.15 * j, 0, 0],
    L_Foot: [0, 0, 0], R_Foot: [0, 0, 0],
    _bounce: -0.05 * j,
  };
}

/**
 * Bake a pose stream into a real AnimationClip so the existing mixer-driven
 * rigs (TroopRig, the captain's weapon layers, QA) need no changes at all.
 */
const HIP_BASE_Y = 0.475;

/** Rotate a rest arm direction about X (the gait's swing axis). */
const _swingV = new THREE.Vector3();
const _swingX = new THREE.Vector3(1, 0, 0);
const ZERO_REST2 = Object.freeze({ dL: new THREE.Vector3(0, -1, 0), dR: new THREE.Vector3(0, -1, 0) });
function swingDir(d, angle) {
  return _swingV.copy(d).applyAxisAngle(_swingX, angle).toArray();
}

function bakeClip(name, duration, loop, poseFn, bones, restDir = { L: new THREE.Vector3(0, -1, 0), R: new THREE.Vector3(0, -1, 0) }) {
  const fps = 24;
  const frames = Math.max(2, Math.round(duration * fps));
  const times = new Float32Array(frames);
  const tracks = new Map(bones.map((b) => [b.name, { times, values: new Float32Array(frames * 4) }]));
  const rootTimes = new Float32Array(frames);
  const rootValues = new Float32Array(frames * 3);
  for (let f = 0; f < frames; f++) {
    const t = duration * (f / frames);
    times[f] = t; rootTimes[f] = t;
    const pose = poseFn(t);
    rootValues.set([0, HIP_BASE_Y + (pose._bounce || 0), 0], f * 3);
    for (const bone of bones) {
      const aim = pose[`${bone.name === 'L_Upperarm' ? 'L' : bone.name === 'R_Upperarm' ? 'R' : ''}_AIM`];
      if (bone.name === 'L_Upperarm' || bone.name === 'R_Upperarm') {
        const side = bone.name[0];
        const dir = pose[`${side}_AIM`];
        if (dir) {
          _q1.setFromUnitVectors(restDir[side], _v1.set(...dir).normalize());
        } else {
          _q1.identity();
        }
      } else {
        const e = pose[bone.name] || [0, 0, 0];
        _q1.setFromEuler(_e1.set(e[0], e[1], e[2]));
      }
      tracks.get(bone.name).values.set([_q1.x, _q1.y, _q1.z, _q1.w], f * 4);
    }
  }
  const clipTracks = [new THREE.VectorKeyframeTrack('Hip.position', rootTimes, rootValues)];
  for (const bone of bones) {
    const tr = tracks.get(bone.name);
    clipTracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, tr.times, tr.values));
  }
  const clip = new THREE.AnimationClip(name, duration, clipTracks);
  if (loop) clip.userData.loop = true;
  return clip;
}

/**
 * Build one rigged person from a pack mesh: skeleton, skin weights, materials
 * kept as the pack painted them, and the whole procedural clip set.
 */
function buildPerson(src, role) {
  const geometry = src.geometry.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  // normalise: feet on 0, one unit tall, centred on x/z
  const h = box.max.y - box.min.y;
  geometry.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
  geometry.scale(1 / h, 1 / h, 1 / h);
  geometry.computeBoundingBox();

  const hands = handPose(geometry.attributes.position, role);
  // world-space bind positions, arms following the pose the sculpt holds
  const worldPos = {};
  for (const [name, , pos] of BONES) worldPos[name] = new THREE.Vector3(...pos);
  for (const side of ['L', 'R']) {
    const hand = hands[side];
    const shoulder = worldPos[`${side}_Upperarm`];
    const elbow = shoulder.clone().lerp(hand, 0.52);
    elbow.y += 0.02;
    worldPos[`${side}_Forearm`] = elbow;
    worldPos[`${side}_Hand`] = hand.clone();
  }
  const bones = [];
  const byName = {};
  for (const [name] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    byName[name] = bone;
    bones.push(bone);
  }
  bones.forEach((b, i) => { b.index = i; });
  for (const [name, parent] of BONES) {
    const bone = byName[name];
    bone.position.copy(worldPos[name]);
    if (parent) {
      bone.position.sub(worldPos[parent]);
      byName[parent].add(bone);
    }
  }
  skinGeometry(geometry, worldPos);
  const mesh = new THREE.SkinnedMesh(geometry, src.material.clone());
  mesh.name = `person-${role}`;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.add(bones[0]);
  // the bind matrices MUST come from the assembled rest pose — update the
  // world matrices before the skeleton snapshots them, or every blended
  // vertex collapses toward its bone origins
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  const root = new THREE.Group();
  root.name = `person-rig-${role}`;
  root.add(mesh);

  // how far each sculpt's arm already hangs forward of straight-down: poses
  // are authored absolute and compensated, so a Warrior modelled mid-swing
  // still aims level and a Resident with open arms still walks naturally
  const restDir = {};
  const rest = { dL: null, dR: null };
  for (const side of ['L', 'R']) {
    const v = worldPos[`${side}_Hand`].clone().sub(worldPos[`${side}_Upperarm`]).normalize();
    restDir[side] = v.clone();
    rest[side === 'L' ? 'dL' : 'dR'] = v;
  }
  const animBones = bones.filter((b) => LIMBS.includes(b.name));
  const clips = {
    walk: bakeClip('walk', 0.62, true, (t) => gaitPose(t / 0.62, 0.52, 0.05, 0.022, rest), animBones, restDir),
    run: bakeClip('run', 0.42, true, (t) => gaitPose(t / 0.42, 0.85, 0.22, 0.04, rest), animBones, restDir),
    shot: bakeClip('shot', 0.42, false, (t) => shootPose(t, rest), animBones, restDir),
    claw: bakeClip('claw', 0.55, false, (t) => swingPose(t, 'L', rest), animBones, restDir),
    sword: bakeClip('sword', 0.55, false, (t) => swingPose(t, 'R', rest), animBones, restDir),
    idle: bakeClip('idle', 1.6, true, (t) => ({
      Hip: [0, 0, 0], Spine01: [0.02 * Math.sin(t * 3.9), 0, 0], Spine02: [0.015 * Math.sin(t * 3.9 + 1), 0, 0],
      Head: [0, 0.06 * Math.sin(t * 1.7), 0], NeckTwist01: [0, 0, 0],
      L_AIM: swingDir(rest.dL, 0.04 * Math.sin(t * 3.9)), R_AIM: swingDir(rest.dR, 0.04 * Math.sin(t * 3.9)),
      L_Forearm: [-0.18, 0, 0], R_Forearm: [-0.18, 0, 0],
      L_Hand: [0, 0, 0], R_Hand: [0, 0, 0],
      L_Thigh: [0, 0, 0], R_Thigh: [0, 0, 0], L_Shin: [0.03, 0, 0], R_Shin: [0.03, 0, 0],
      L_Foot: [0, 0, 0], R_Foot: [0, 0, 0], _bounce: 0.004 * Math.sin(t * 7.8),
    }), animBones),
    hit: bakeClip('hit', 0.22, false, (t) => hitPose(t, rest), animBones, restDir),
    down: bakeClip('down', 0.42, false, (t) => fallPose(t, rest), animBones, restDir),
    lie: bakeClip('lie', 0.01, false, (t) => fallPose(0.42, rest), animBones, restDir),
    up: bakeClip('up', 0.34, false, (t) => fallPose(0.42 - Math.min(0.42, t), rest), animBones, restDir),
    cheer: bakeClip('cheer', 0.55, false, (t) => cheerPose(t, rest), animBones, restDir),
  };
  return { root, mesh, skeleton, clips, height: 1 };
}

export const People3D = {
  ready: false,
  failed: null,
  error: null,
  people: new Map(),
  _promise: null,

  /** Fetch and rig the whole pack once. */
  stage() {
    if (!this._promise) {
      this._promise = new Promise((resolve) => {
        new GLTFLoader().load(PEOPLE_MODEL_URL, (gltf) => {
          for (const role of Object.values(PEOPLE_ROLES)) {
            const node = gltf.scene.getObjectByName(role);
            let holder = null;
            if (node) node.traverse((o) => { if (!holder && o.isMesh) holder = o; });
            if (!holder) { this.failed = this.failed || []; this.failed.push(role); continue; }
            this.people.set(role, buildPerson(holder, role));
          }
          this.ready = this.people.size > 0;
          resolve(this);
        }, undefined, (err) => {
          this.error = String(err && err.message || err);
          this.ready = false;
          resolve(this);
        });
      });
    }
    return this._promise;
  },

  /** A fresh rigged copy of one pack character, clips included. */
  make(role) {
    const person = this.people.get(role);
    if (!person) return null;
    const root = person.root.clone(true);
    // rebinding: the clone needs its own skeleton bound to its own bones
    const mesh = root.children.find((o) => o.isSkinnedMesh) || root.getObjectByProperty('isSkinnedMesh', true);
    root.updateMatrixWorld(true);
    const bones = person.skeleton.bones.map((b) => root.getObjectByName(b.name));
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    const clips = {};
    for (const [name, clip] of Object.entries(person.clips)) clips[name] = clip;
    return { model: root, mesh, clips, skeleton, height: 1 };
  },

  diagnostics() {
    return {
      ready: this.ready, error: this.error, failed: this.failed,
      roles: [...this.people.keys()],
    };
  },
};
