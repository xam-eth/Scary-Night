/* Regression checks for the direct animated Valen GLB runtime.
 *
 *   node tools/glbtest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VALEN_CLIPS, VALEN_MODEL_URL, valenClipForState } from '../src/game/valen3d.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_NAME = 'new_character_glb_box_01_run_walk_c0d0d3.glb';
const SOURCE_SHA256 = 'd56e7adb6c986125a2ca01ecf1676f42f3a8f85c29efe1d864a0b8afae981abe';
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
  ok('source GLB bytes remain untouched', digest === SOURCE_SHA256, digest);
  ok('all three authored textures remain embedded', (json.images?.length || 0) === 3 && (json.textures?.length || 0) === 3,
    `${json.images?.length || 0} images`);
  ok('the complete 65-joint skin is present', json.skins?.length === 1 && json.skins[0].joints?.length === 65,
    `${json.skins?.[0]?.joints?.length || 0} joints`);

  const animations = json.animations || [];
  const names = animations.map((animation) => animation.name);
  ok('three authored clips are present', animations.length === 3, names.join(', '));
  ok('uploaded clips are box_01, run and walk',
    ['box_01', 'run', 'walk'].every((name) => names.includes(name)), names.join(', '));
  ok('every authored clip has bone channels and samplers',
    animations.every((animation) => animation.channels?.length === 195 && animation.samplers?.length === 195),
    animations.map((animation) => `${animation.name}:${animation.channels?.length || 0}`).join(', '));

  const skin = skinStats(glb);
  ok('skin weights are distributed across the rig', skin.influenced >= 50, `${skin.influenced} influenced joints`);
  ok('most vertices use blended bone influences', skin.multiInfluence > skin.vertices * 0.75,
    `${skin.multiInfluence}/${skin.vertices}`);
  ok('all vertex weights are normalised', skin.normalised === skin.vertices,
    `${skin.normalised}/${skin.vertices}`);
}

ok('runtime loads the exact uploaded filename', VALEN_MODEL_URL === `./${SOURCE_NAME}`, VALEN_MODEL_URL);
ok('clip mapping uses the user-approved semantics',
  VALEN_CLIPS.idle === null
    && valenClipForState('idle') === null
    && valenClipForState('walk') === 'walk'
    && valenClipForState('run') === 'run'
    && valenClipForState('attack') === 'box_01');

const retired = [
  'vampire character 3d model.glb',
  'character_vampir.glb',
  'scene_conf100_0_blackFalse_whiteFalse_camTrue_skyFalse_max9000k.glb',
  'assets/models/vampire_runtime.glb',
  'assets/models/vampire_valen_runtime.glb',
  'tools/bakeglb.mjs',
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
process.exit(failures === 0 ? 0 : 1);
