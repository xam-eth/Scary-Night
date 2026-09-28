/* Regression checks for the direct animated Valen GLB runtime.
 *
 *   node tools/glbtest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VALEN_CLIPS, VALEN_MODEL_URL, valenClipForState } from '../src/game/valen3d.js';
import {
  ENEMY_GLB_CAP, ENEMY_MODELS, ENEMY_CLIP_CONTRACT, FORBIDDEN_STANDINS,
  SlotBook, behaviorReady, requiredClips, selectGlbSlots, standinViolation,
} from '../src/game/enemy3d.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_NAME = 'hunter_run_walk_claw_sword_shot.glb';
const SOURCE_SHA256 = 'a86d3c27533db4363aacc214df7e3aff0136ff2f6b1f418d101fdbca0b82974f';
const BIN_SHA256 = '7f87da42950fead15d4920af63026ffe81fc8a392eca288f15333502fc5508c5';
const CLIP_NAMES = ['run', 'walk', 'claw', 'shot', 'sword'];
let failures = 0;

function ok(name, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
}

function readGlb(filename) {
  const bytes = fs.readFileSync(filename);
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) return null;
  const declaredLength = bytes.readUInt32LE(8);
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (declaredLength !== bytes.length || jsonType !== 0x4e4f534a) return null;
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/[\0 ]+$/, ''));
  const binaryOffset = 20 + jsonLength + 8;
  return { bytes, json, binaryOffset };
}

function skinStats(glb) {
  const { bytes, json, binaryOffset } = glb;
  const primitive = json.meshes[0].primitives[0];
  const joints = json.accessors[primitive.attributes.JOINTS_0];
  const weights = json.accessors[primitive.attributes.WEIGHTS_0];
  const jointView = json.bufferViews[joints.bufferView];
  const weightView = json.bufferViews[weights.bufferView];
  const jointBytes = joints.componentType === 5121 ? 1 : 2;
  const jointStride = jointView.byteStride || jointBytes * 4;
  const weightStride = weightView.byteStride || 16;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const influenced = new Set();
  let multiInfluence = 0;
  let normalised = 0;

  for (let vertex = 0; vertex < joints.count; vertex++) {
    let active = 0;
    let sum = 0;
    for (let slot = 0; slot < 4; slot++) {
      const jointOffset = binaryOffset + (jointView.byteOffset || 0) + (joints.byteOffset || 0)
        + vertex * jointStride + slot * jointBytes;
      const joint = jointBytes === 1 ? dv.getUint8(jointOffset) : dv.getUint16(jointOffset, true);
      const weightOffset = binaryOffset + (weightView.byteOffset || 0) + (weights.byteOffset || 0)
        + vertex * weightStride + slot * 4;
      const weight = dv.getFloat32(weightOffset, true);
      sum += weight;
      if (weight > 0.00001) {
        active++;
        influenced.add(joint);
      }
    }
    if (active > 1) multiInfluence++;
    if (Math.abs(sum - 1) < 0.001) normalised++;
  }
  return { vertices: joints.count, influenced: influenced.size, multiInfluence, normalised };
}

console.log('\n=== DIRECT ANIMATED VALEN GLB ===');

const sourcePath = path.join(ROOT, SOURCE_NAME);
ok('latest uploaded GLB exists', fs.existsSync(sourcePath), SOURCE_NAME);
const glb = fs.existsSync(sourcePath) ? readGlb(sourcePath) : null;
ok('uploaded file is a complete glTF 2.0 binary', !!glb);

if (glb) {
  const { bytes, json } = glb;
  const digest = createHash('sha256').update(bytes).digest('hex');
  ok('vendored GLB bytes remain the renamed hunter file', digest === SOURCE_SHA256, digest);
  const binStart = glb.binaryOffset;
  const binLen = bytes.readUInt32LE(binStart - 8);
  const binDigest = createHash('sha256').update(bytes.subarray(binStart, binStart + binLen)).digest('hex');
  ok('mesh and animation samples are the original Tripo bytes', binDigest === BIN_SHA256, binDigest);
  ok('authored textures remain embedded', (json.images?.length || 0) === 2 && (json.textures?.length || 0) === 2,
    `${json.images?.length || 0} images`);
  ok('the hunter skin is present', json.skins?.length === 1 && json.skins[0].joints?.length === 78,
    `${json.skins?.[0]?.joints?.length || 0} joints`);

  const animations = json.animations || [];
  const names = animations.map((animation) => animation.name).sort();
  ok('five authored clips are present', animations.length === 5, names.join(', '));
  ok('clips are exactly run, walk, claw, shot, sword',
    CLIP_NAMES.every((name) => names.includes(name)) && names.length === CLIP_NAMES.length, names.join(', '));
  ok('every authored clip has bone channels and samplers',
    animations.every((animation) => animation.channels?.length === 234 && animation.samplers?.length === 234),
    animations.map((animation) => `${animation.name}:${animation.channels?.length || 0}`).join(', '));

  const skin = skinStats(glb);
  ok('skin weights are distributed across the rig', skin.influenced >= 50, `${skin.influenced} influenced joints`);
  ok('most vertices use blended bone influences', skin.multiInfluence > skin.vertices * 0.75,
    `${skin.multiInfluence}/${skin.vertices}`);
  ok('all vertex weights are normalised', skin.normalised === skin.vertices,
    `${skin.normalised}/${skin.vertices}`);
}

ok('runtime loads the vendored hunter filename', VALEN_MODEL_URL === `./${SOURCE_NAME}`, VALEN_MODEL_URL);
ok('clip mapping uses claw for the unarmed attack',
  VALEN_CLIPS.idle === null
    && valenClipForState('idle') === null
    && valenClipForState('walk') === 'walk'
    && valenClipForState('run') === 'run'
    && valenClipForState('attack') === 'claw'
    && valenClipForState('attack', 'sword') === 'sword'
    && valenClipForState('attack', 'shot') === 'shot'
    && VALEN_CLIPS.shot === 'shot'
    && VALEN_CLIPS.sword === 'sword');

const retired = [
  'vampire character 3d model.glb',
  'character_vampir.glb',
  'scene_conf100_0_blackFalse_whiteFalse_camTrue_skyFalse_max9000k.glb',
  'assets/models/vampire_runtime.glb',
  'assets/models/vampire_valen_runtime.glb',
  'tools/bakeglb.mjs',
  'new_character_glb_box_01_run_walk_c0d0d3.glb',
  'western+gunslinger+3d+model (1).glb',
];
ok('obsolete sources and rebuild pipeline are absent', retired.every((name) => !fs.existsSync(path.join(ROOT, name))));

const bakedValen = fs.readdirSync(path.join(ROOT, 'assets')).filter((name) => /^vamp_valen_.*\.webp$/.test(name));
ok('no rebuilt Valen sprite derivatives remain', bakedValen.length === 0, bakedValen.join(', '));

const valenRuntimeCode = fs.readFileSync(path.join(ROOT, 'src/game/valen3d.js'), 'utf8');
const runtimeCode = [
  'src/core/assets.js',
  'src/game/player.js',
  'src/game/valen3d.js',
  'src/main.js',
  'src/ui/screens.js',
].map((filename) => fs.readFileSync(path.join(ROOT, filename), 'utf8')).join('\n');
ok('runtime has no reference to the rejected baked setup',
  !runtimeCode.includes('vamp_valen_')
    && !runtimeCode.includes('vampire_valen_runtime')
    && !runtimeCode.includes('bakeglb'));
ok('root motion stays centred and source-named rig effects stay attached',
  valenRuntimeCode.includes('this.model.position.x = -rootX')
    && valenRuntimeCode.includes('this.model.position.z = -rootZ')
    && valenRuntimeCode.includes('PropertyBinding.sanitizeNodeName(name)')
    && valenRuntimeCode.includes('object.frustumCulled = false'));
ok('vendored GLB runtime and license are present', [
  'src/vendor/three/three.module.min.js',
  'src/vendor/three/three.core.min.js',
  'src/vendor/three/GLTFLoader.js',
  'src/vendor/three/BufferGeometryUtils.js',
  'src/vendor/three/LICENSE',
].every((name) => fs.existsSync(path.join(ROOT, name))));

console.log(failures === 0 ? '\nanimated Valen GLB: all PASS' : `\nanimated Valen GLB: ${failures} FAILURE(S)`);

console.log('\n=== ENEMY GLB REGISTRY ===');

const ZOMBIE_NAME = 'zombie+3d+model.glb';
const ZOMBIE_SHA256 = '3d2fcff9c2107f442000a3b0867966bca2f72983d86874268b3186d8ac0152ad';
const ZOMBIE_CLIPS = ['defeat_03', 'cast_a_spell', 'depressed', 'flee_02'];
const zombiePath = path.join(ROOT, ZOMBIE_NAME);
ok('vendored zombie GLB exists', fs.existsSync(zombiePath), ZOMBIE_NAME);
const zombie = fs.existsSync(zombiePath) ? readGlb(zombiePath) : null;
ok('zombie file is a complete glTF 2.0 binary', !!zombie);
if (zombie) {
  const digest = createHash('sha256').update(zombie.bytes).digest('hex');
  ok('zombie bytes are the uploaded file', digest === ZOMBIE_SHA256, digest);
  ok('zombie stays under the mobile budget', zombie.bytes.length < 4 * 1024 * 1024, `${zombie.bytes.length} bytes`);
  const json = zombie.json;
  ok('zombie is a rigged Tripo mesh', json.asset?.generator === 'Tripo' && json.meshes?.length === 1 && json.skins?.length === 1,
    `${json.skins?.[0]?.joints?.length || 0} joints`);
  ok('zombie skin has its joints', (json.skins?.[0]?.joints?.length || 0) === 65);
  ok('zombie texture stays embedded', (json.images?.length || 0) === 1 && (json.textures?.length || 0) === 1);
  const names = (json.animations || []).map((animation) => animation.name).sort();
  ok('zombie clips are exactly the uploaded set',
    names.length === ZOMBIE_CLIPS.length && ZOMBIE_CLIPS.every((name) => names.includes(name)), names.join(', '));
  const verdict = behaviorReady('zombie', names);
  ok('zombie is not behavior-ready — walk and attack are missing',
    verdict.ready === false && verdict.missing.includes('walk') && verdict.missing.includes('attack'),
    verdict.missing.join(', '));
}
ok('registry points at the vendored zombie and maps die only',
  ENEMY_MODELS.zombie.url === `./${ZOMBIE_NAME}` && ENEMY_MODELS.zombie.map.die === 'defeat_03'
    && !ENEMY_MODELS.zombie.map.walk && !ENEMY_MODELS.zombie.map.attack);
ok('flee, cast, and depressed are not stand-ins', standinViolation('zombie').length === 0
  && FORBIDDEN_STANDINS.zombie.includes('flee_02') && FORBIDDEN_STANDINS.zombie.includes('cast_a_spell'));
ok('werewolf zip is not wired as a GLB', !ENEMY_MODELS.werewolf && !ENEMY_MODELS.alpha);
const wolfZip = path.join(ROOT, 'werewolf+3d+model.zip');
ok('werewolf upload is still a zip, not a converted GLB',
  fs.existsSync(wolfZip) && fs.readFileSync(wolfZip).subarray(0, 2).toString('ascii') === 'PK');
ok('clip contract matches the roster',
  requiredClips('zombie').join(',') === 'walk,attack,die'
    && requiredClips('werewolf').join(',') === 'run,attack,die'
    && ENEMY_CLIP_CONTRACT.crawler.includes('walk')
    && ENEMY_CLIP_CONTRACT.stalker.includes('attack'));

const swarm = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, key: 'zombie', dead: false, x: i * 40, y: 0 }));
const nearest = selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('nearest cap keeps eight skinned slots', nearest.length === ENEMY_GLB_CAP && nearest[0].id === 1 && nearest[7].id === 8,
  nearest.map((e) => e.id).join(','));
ok('a model that is not ready stays on the 2D path', selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => false).length === 0);
const dead = selectGlbSlots([{ id: 1, key: 'zombie', dead: true, x: 0, y: 0 }], { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('a corpse does not take a skinned slot', dead.length === 0);

const book = new SlotBook(ENEMY_GLB_CAP);
book.sync(nearest);
ok('pool builds one instance per live slot', book.made === ENEMY_GLB_CAP && book.live.length === ENEMY_GLB_CAP);
book.sync([]);
const again = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, key: 'zombie', dead: false, x: i, y: 0 }));
const reused = book.sync(again);
ok('death returns the instance; the next spawn does not allocate', reused.made === ENEMY_GLB_CAP && reused.live === 8 && reused.free === 0);
const crush = book.sync(Array.from({ length: 20 }, (_, i) => ({ id: 200 + i, key: 'zombie', dead: false, x: i * 10, y: 9 })));
ok('a full swarm cannot grow the pool past the cap', crush.live === ENEMY_GLB_CAP && crush.made === ENEMY_GLB_CAP && crush.starved === 12);

const enemyCode = fs.readFileSync(path.join(ROOT, 'src/game/enemy3d.js'), 'utf8');
ok('runtime does not alias flee or cast onto the state machine',
  !/walk:\s*['"]flee_02['"]/.test(enemyCode) && !/attack:\s*['"]cast_a_spell['"]/.test(enemyCode)
    && !/attack:\s*['"]depressed['"]/.test(enemyCode));

console.log(failures === 0 ? '\nenemy GLB registry: all PASS' : `\nenemy GLB registry: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
