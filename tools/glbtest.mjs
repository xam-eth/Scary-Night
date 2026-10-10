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
  SlotBook, behaviorReady, enemyClipForState, requiredClips, selectGlbSlots, standinViolation,
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
  ok('legacy zombie remains auditable but is no longer assigned to a live role',
    !Object.values(ENEMY_MODELS).some((spec) => spec.url === `./${ZOMBIE_NAME}`), names.join(', '));
}
const ULTIMATE_MONSTERS = [
  {
    key: 'zombie', path: 'assets/monsters/ultimate/demon.glb', url: './assets/monsters/ultimate/demon.glb',
    source: 'Demon-LnfIziKv4o.glb', sha256: '7da854e1d43428b89b1afca0feca3f323b869b1d8ed7df74d17354260b607262',
    clips: { walk: 'CharacterArmature|Walk', run: 'CharacterArmature|Run', attack: 'CharacterArmature|Punch', die: 'CharacterArmature|Death', hurt: 'CharacterArmature|HitReact', idle: 'CharacterArmature|Idle' },
  },
  {
    key: 'crawler', path: 'assets/monsters/ultimate/green-spiky-blob.glb', url: './assets/monsters/ultimate/green-spiky-blob.glb',
    source: 'Green Spiky Blob.glb', sha256: 'ad5e8b1cdf8c0d328b4b44537d3da8fa98119a9a99fb6163e2f325dbb8bbecc1',
    clips: { walk: 'CharacterArmature|Walk', attack: 'CharacterArmature|Bite_Front', die: 'CharacterArmature|Death', hurt: 'CharacterArmature|HitRecieve', idle: 'CharacterArmature|Idle' },
  },
  {
    key: 'hunter', path: 'assets/monsters/ultimate/blue-demon.glb', url: './assets/monsters/ultimate/blue-demon.glb',
    source: 'Blue Demon.glb', sha256: '6a8e743deba6f43f0f9b1e702016b04ddba1d3bf73b7101d2c86d64ae526f87c',
    clips: { walk: 'CharacterArmature|Walk', run: 'CharacterArmature|Run', attack: 'CharacterArmature|Punch', die: 'CharacterArmature|Death', hurt: 'CharacterArmature|HitReact', idle: 'CharacterArmature|Idle' },
  },
  {
    key: 'ghoul', path: 'assets/monsters/ultimate/ghost-skull.glb', url: './assets/monsters/ultimate/ghost-skull.glb',
    source: 'Ghost Skull.glb', sha256: 'd1e2268fe9621583ff879d6e6e3ace80b0a6a2373ec0139a8139c88fe6e4d942',
    clips: { walk: 'CharacterArmature|Fast_Flying', run: 'CharacterArmature|Fast_Flying', attack: 'CharacterArmature|Headbutt', die: 'CharacterArmature|Death', hurt: 'CharacterArmature|HitReact', idle: 'CharacterArmature|Flying_Idle' },
  },
  {
    key: 'stalker', path: 'assets/monsters/ultimate/yeti.glb', url: './assets/monsters/ultimate/yeti.glb',
    source: 'Yeti-ceRHrn8HHE.glb', sha256: '789fcdd3d32a1bf6ceaa0e30f9ac5d8d2c52d15fa0181d4d1d980a1b2a2ac869',
    clips: { run: 'CharacterArmature|Run', attack: 'CharacterArmature|Punch', die: 'CharacterArmature|Death', hurt: 'CharacterArmature|HitReact', idle: 'CharacterArmature|Idle' },
  },
];
let monsterBytes = 0;
for (const model of ULTIMATE_MONSTERS) {
  const file = path.join(ROOT, model.path);
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const glb = bytes ? readGlb(file) : null;
  const digest = bytes ? createHash('sha256').update(bytes).digest('hex') : '';
  const names = glb ? (glb.json.animations || []).map((animation) => animation.name) : [];
  monsterBytes += bytes?.length || 0;
  ok(`${model.key} uses a valid rigged GLB copied from ${model.source}`,
    !!glb && (glb.json.meshes || []).length > 0 && (glb.json.skins || []).length > 0 && bytes.length < 1024 * 1024,
    glb ? `${bytes.length} bytes, ${glb.json.skins[0].joints.length} joints` : 'missing or unreadable');
  ok(`${model.key} source GLB is unchanged`, digest === model.sha256, digest);
  const verdict = behaviorReady(model.key, names);
  ok(`${model.key} has mapped idle/hurt/locomotion/attack/death clips`,
    verdict.ready && Object.entries(model.clips).every(([behavior, name]) => ENEMY_MODELS[model.key].map[behavior] === name && names.includes(name)),
    verdict.missing.join(', '));
}
ok('five distinct CC0 monster rigs are wired to the five non-werewolf roles',
  ULTIMATE_MONSTERS.every((model) => ENEMY_MODELS[model.key].url === model.url)
    && new Set(ULTIMATE_MONSTERS.map((model) => ENEMY_MODELS[model.key].url)).size === 5
    && monsterBytes < 3 * 1024 * 1024,
  `${ULTIMATE_MONSTERS.length} separate rigs, ${monsterBytes} total bytes`);
ok('monster assets include their CC0 provenance note',
  fs.existsSync(path.join(ROOT, 'assets/monsters/ultimate/CREDITS.txt'))
    && /CC0 1\.0/i.test(fs.readFileSync(path.join(ROOT, 'assets/monsters/ultimate/CREDITS.txt'), 'utf8')));
ok('the late-game Stalker uses its Yeti rig, not the old zombie or wolf rig',
  ENEMY_MODELS.stalker.url === './assets/monsters/ultimate/yeti.glb'
    && ENEMY_MODELS.stalker.map.die === 'CharacterArmature|Death'
    && ENEMY_MODELS.stalker.map.run === 'CharacterArmature|Run'
    && ENEMY_MODELS.stalker.map.attack === 'CharacterArmature|Punch');
ok('the local werewolf retains its own run/strike/death rig',
  ENEMY_MODELS.werewolf.url === './werewolf-3d-model.glb'
    && ENEMY_MODELS.werewolf.map.die === 'fall.001'
    && ENEMY_MODELS.werewolf.map.run === 'angry_02.001'
    && ENEMY_MODELS.werewolf.map.attack === 'front_kick_02.001');
ok('every behaviour avoids forbidden stand-ins', Object.keys(ENEMY_MODELS).every((key) => standinViolation(key).length === 0
  && (FORBIDDEN_STANDINS[key] || []).length === 0));

/** The werewolf upload is an FBX inside a zip. Converted once, vendored, byte-exact. */
const WOLF_NAME = 'werewolf-3d-model.glb';
const WOLF_SHA256 = 'c2533322a4f11cc958a08049894083b16db9c671770aafd48afb4bfef4e184e3';
const WOLF_CLIPS = ['front_kick_02.001', 'angry_02.001', 'box_02.001', 'fall.001'];
const wolfPath = path.join(ROOT, WOLF_NAME);
ok('converted werewolf GLB is vendored', fs.existsSync(wolfPath), WOLF_NAME);
const wolf = fs.existsSync(wolfPath) ? readGlb(wolfPath) : null;
ok('werewolf file is a complete glTF 2.0 binary', !!wolf);
if (wolf) {
  const digest = createHash('sha256').update(wolf.bytes).digest('hex');
  ok('werewolf bytes are the converted file', digest === WOLF_SHA256, digest);
  ok('werewolf stays inside the mobile budget', wolf.bytes.length < 6 * 1024 * 1024, `${wolf.bytes.length} bytes`);
  const json = wolf.json;
  ok('werewolf is a rigged mesh', json.meshes?.length === 1 && json.skins?.length === 1,
    `${json.skins?.[0]?.joints?.length || 0} joints`);
  ok('werewolf skin has its joints', (json.skins?.[0]?.joints?.length || 0) === 65);
  ok('werewolf texture stays embedded', (json.images?.length || 0) === 1 && (json.textures?.length || 0) === 1);
  const names = (json.animations || []).map((animation) => animation.name).sort();
  ok('werewolf clips are exactly the converted set',
    names.length === WOLF_CLIPS.length && WOLF_CLIPS.every((name) => names.includes(name)), names.join(', '));
  const verdict = behaviorReady('werewolf', names);
  ok('werewolf is behavior-ready on the owner clip map',
    verdict.ready === true && verdict.missing.length === 0, verdict.missing.join(', '));
}
ok('the werewolf upload is kept as provenance for the conversion',
  fs.existsSync(path.join(ROOT, 'werewolf+3d+model.zip'))
    && fs.readFileSync(path.join(ROOT, 'werewolf+3d+model.zip')).subarray(0, 2).toString('ascii') === 'PK');
ok('the converted werewolf is wired on the owner clip map',
  ENEMY_MODELS.werewolf.url === `./${WOLF_NAME}` && ENEMY_MODELS.werewolf.map.die === 'fall.001'
    && ENEMY_MODELS.werewolf.map.run === 'angry_02.001'
    && ENEMY_MODELS.werewolf.map.attack === 'front_kick_02.001'
    && ENEMY_MODELS.werewolf.map.idle === 'box_02.001');
const wolfZip = path.join(ROOT, 'werewolf+3d+model.zip');
ok('clip contract matches the roster, including pack hit reactions',
  requiredClips('zombie').join(',') === 'walk,attack,die,hurt'
    && requiredClips('werewolf').join(',') === 'run,attack,die'
    && Object.keys(ENEMY_MODELS).filter((key) => key !== 'werewolf').every((key) => requiredClips(key).includes('hurt'))
    && ENEMY_CLIP_CONTRACT.crawler.includes('walk')
    && ENEMY_CLIP_CONTRACT.stalker.includes('attack'));
ok('damage and stagger choose the mapped hit reaction, while death retains priority',
  enemyClipForState('zombie', { state: 'strike', hurtFlash: 0.45 }) === 'hurt'
    && enemyClipForState('crawler', { state: 'hunt', staggerT: 0.3 }) === 'hurt'
    && enemyClipForState('zombie', { state: 'dying', hurtFlash: 1 }) === 'die'
    && enemyClipForState('werewolf', { state: 'hunt', hurtFlash: 1 }) === 'idle');

const swarm = Array.from({ length: ENEMY_GLB_CAP + 16 }, (_, i) => ({ id: i + 1, key: 'zombie', dead: false, x: i * 40, y: 0 }));
const nearest = selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok(`nearest cap keeps ${ENEMY_GLB_CAP} skinned slots`, nearest.length === ENEMY_GLB_CAP
  && nearest[0].id === 1 && nearest.at(-1).id === ENEMY_GLB_CAP, nearest.map((e) => e.id).join(','));
ok('an unready model stays unassigned instead of receiving a placeholder',
  selectGlbSlots(swarm, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => false).length === 0);
const combatants = Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, key: 'zombie', x: 500 + i * 20, y: 0 }));
const crowd = Array.from({ length: 24 }, (_, i) => ({ id: 1000 + i, key: 'zombie', _crowd: true, x: i * 12, y: 0 }));
const siege = selectGlbSlots([...crowd, ...combatants], { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('all 14 combatants receive GLBs; siege crowd does not consume combat slots',
  siege.length === 14 && siege.every((e) => !e._crowd));
ok('reduced-AI siege bodies are not sent to the rig pool',
  selectGlbSlots(crowd, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true).length === 0);
const dyingEnemy = { id: 1, key: 'zombie', dead: true, deathT: 0.25, x: 0, y: 0 };
const deathSlot = selectGlbSlots([dyingEnemy], { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('a recent death can keep a spare skinned slot for its animation', deathSlot.length === 1 && deathSlot[0] === dyingEnemy);
const expiredDeath = selectGlbSlots([{ ...dyingEnemy, id: 2, deathT: 1.5 }], { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('an expired death clip releases its skinned slot', expiredDeath.length === 0);
const dyingWhenFull = [...swarm.slice(0, ENEMY_GLB_CAP), { ...dyingEnemy, id: 99 }];
const fullPriority = selectGlbSlots(dyingWhenFull, { x: 0, y: 0 }, ENEMY_GLB_CAP, () => true);
ok('living actors keep priority over death clips at the mobile rig cap', fullPriority.length === ENEMY_GLB_CAP && fullPriority.every((e) => !e.dead));

const book = new SlotBook(ENEMY_GLB_CAP);
book.sync(nearest);
ok('pool builds one instance per live slot', book.made === ENEMY_GLB_CAP && book.live.length === ENEMY_GLB_CAP);
book.sync([]);
const again = Array.from({ length: ENEMY_GLB_CAP }, (_, i) => ({ id: 100 + i, key: 'zombie', dead: false, x: i, y: 0 }));
const reused = book.sync(again);
ok('death returns the instance; the next spawn does not allocate', reused.made === ENEMY_GLB_CAP && reused.live === ENEMY_GLB_CAP && reused.free === 0);
const crush = book.sync(Array.from({ length: ENEMY_GLB_CAP + 12 }, (_, i) => ({ id: 200 + i, key: 'zombie', dead: false, x: i * 10, y: 9 })));
ok('a full swarm cannot grow the pool past the cap', crush.live === ENEMY_GLB_CAP && crush.made === ENEMY_GLB_CAP && crush.starved === 12);

const enemyCode = fs.readFileSync(path.join(ROOT, 'src/game/enemy3d.js'), 'utf8');
ok('a clip is only ever named in the registry map, never in the state machine',
  !/clipForState[\s\S]{0,200}flee_02/.test(enemyCode) && !/_pose[\s\S]{0,200}cast_a_spell/.test(enemyCode)
    && enemyCode.includes('FORBIDDEN_STANDINS'));

/* ---------- the modular environment kit (issue #55) ----------
 * CC0, vendored byte-exact. These are the numbers that catch someone
 * re-exporting a piece on a different grid, which would quietly resize the
 * whole room.
 */
console.log('\nenvironment kit:');

const KIT_SHA256 = Object.freeze({
  'barrel.glb': '9fae6a79056241baf253fe9272dc7a7ddb174e1caf153eb5013c58a596722148',
  'candle.glb': 'a884f27540b8b91e3d47914453cbf2c4d48f4ca8504ace9960a8d9b4e79a6c48',
  'chair.glb': '5f133281686d398304c0a458c4d407dd483eeea8aba67220b585ceb89366efa2',
  'chest.glb': 'f72fd2201cd42ad399928a0b7bcc34d5b0e6d0624aeaf824fef81852109955f8',
  'column.glb': '761adf0fcc1a86ab1c42740b7a8ad340d73982f94257e7892b2c7998f98c304e',
  'crate.glb': '6dacda267f04769f8ebbb7e991885785054923ea3d5eb19e833768a911d5b661',
  'crates_stacked.glb': '43182b077ead9b033804300ef453b7402bdc979f00cfce2d7f0c91dcf6bb5d3c',
  'door_gate.glb': '68e766c2b4eb05c4bf2c0fcd908ea5dc5192dda56cfdd5d56b7cbf446063220c',
  'doorway.glb': '2be5369a2d1d1d8795150b2156d8343b3e37620d78de256cb03276c54ea70c97',
  'floor_stone.glb': '5b6bbbc683f6729d094732056f157a928435de97ec3cf94c341c7465907fe17b',
  'floor_wood.glb': 'd22eb1c1fb6ab434e8c9599ecb2cd00c2e34a713783603ba7a3e2cbb1611709d',
  'pillar.glb': 'e31da496461921475384c62ce761cd23924892bd6f32aeea68bd913545caee33',
  'shelf.glb': '886feece503686307dd041c986b1ea6f1fd63792c7e4217eb16f95904e6a9767',
  'stairs.glb': '5ba16e5d919aaa8958435c4b73c1f8a94c98febeacf716faa1359f24e6b27d70',
  'table.glb': 'dc5beae322011acbce5c3dccb3c5cbaffae9757ad67d6ab0cf574c11b7ce014c',
  'torch.glb': 'a617c159e02932db48ca81ec46f1f100acc8904fb6ece43e919d2f93c13950e9',
  'wall.glb': 'f2f343a7bdf2d45947e3f354494e16095a923485e05637e3804e3b81ce11d921',
  'wall_broken.glb': 'ee7598ef2b88aaeb7b61e46d5f1da1a059de3860b080b38b7a507ca2f461302c',
  'wall_corner.glb': '3c8cbcbf3abf78c9dc49f440b152340ef681fee9cccf9ca6ed27b6670a34eb81',
  'wall_cracked.glb': '344fb9a709a51b7f04131fded75a5ad38e829d74fcf1784d848f3df0703f804c',
  'wall_window.glb': '8c75cb77edc51c94b91c5625828391fb56c70bf31e2235cf5abf718eae0d842a'
});

const KIT_FILES = Object.keys(KIT_SHA256);
let kitMeshes = 0;
for (const name of KIT_FILES) {
  const file = path.join(ROOT, 'assets', 'env-kit', name);
  let glb = null;
  try { glb = readGlb(file); } catch (error) { /* reported below */ }
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const digest = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
  const meshes = glb ? (glb.json.meshes || []).length : 0;
  kitMeshes += meshes;
  ok(`${name} is a valid GLB with geometry`,
    !!glb && meshes > 0 && !!((glb.json.accessors || []).length) && digest === KIT_SHA256[name],
    glb ? `meshes=${meshes}` : 'unreadable');
}
ok('the whole vendored kit is present and unchanged', KIT_FILES.length === 21 && kitMeshes >= 21);

const credits = path.join(ROOT, 'assets', 'env-kit', 'CREDITS.txt');
ok('the kit ships its licence note', fs.existsSync(credits) && /CC0/i.test(fs.readFileSync(credits, 'utf8')));

const envCode = fs.readFileSync(path.join(ROOT, 'src/game/envkit.js'), 'utf8');
ok('the env reads the vendored kit and nothing else',
  envCode.includes("./assets/env-kit/") && envCode.includes('KIT_SCALE')
    && envCode.includes('Valen3D.scene') && !/\.fbx|\.zip/i.test(envCode));
const worldCode = fs.readFileSync(path.join(ROOT, 'src/game/world3d.js'), 'utf8');
const gameplayCode = fs.readFileSync(path.join(ROOT, 'src/game/game.js'), 'utf8');
ok('a missing WebGL piece reports a 3D error instead of painting a Canvas fallback',
  /this\.failed = true/.test(envCode) && /EnvKit\.failed/.test(worldCode)
    && /3D MANSION COULD NOT BE BUILT/.test(gameplayCode) && !/renderWorld\(/.test(gameplayCode));

const mansionCode = fs.readFileSync(path.join(ROOT, 'src/game/mansion.js'), 'utf8');
ok('a door with a mesh does not also paint its twin', mansionCode.includes('e.env3d'));


/* ---------- the modular room ---------- */
console.log('\nmodular room:');

const gameCode = fs.readFileSync(path.join(ROOT, 'src', 'game', 'game.js'), 'utf8');
const weaponsCode = fs.readFileSync(path.join(ROOT, 'src', 'game', 'weapons.js'), 'utf8');
const coachCode = fs.readFileSync(path.join(ROOT, 'src', 'game', 'coach.js'), 'utf8');

const uniqueDecorMeshes = (envCode.match(/new THREE\.Mesh\(/g) || []).length;
ok('architecture and repeated props are instanced; only the unique animated clock uses separate meshes',
  /_instanced\(/.test(envCode) && /buildRoom\(/.test(envCode) && /buildProps\(/.test(envCode)
    && /new THREE\.InstancedMesh\(/.test(envCode) && /buildDetailProps\(/.test(envCode)
    && /grandfather-clock-3d/.test(envCode) && uniqueDecorMeshes === 7);

// every piece named in the issue has to be placed by something
const propsCode = envCode.slice(envCode.indexOf('buildProps(mansion)'), envCode.indexOf('Point every mesh at the door state'));
for (const piece of ['table', 'chair', 'shelf', 'chest', 'barrel', 'stacked', 'column', 'candle', 'torch']) {
  ok(`the kit's ${piece} has somewhere to stand`, propsCode.includes(piece));
}
ok('a fire on the floor gets something burning', /l\.type !== 'fire'/.test(envCode));

// the room keeps up with the walls the sim closes and breaks
const roomCode = envCode.slice(envCode.indexOf('buildRoom(mansion)'), envCode.indexOf("The house's furniture"));
ok('every window in the house stands in the wall, not a hole in it',
  /kind !== 'window'/.test(roomCode) && /window: this\._instanced\('window'/.test(envCode)
    && /windowBroken: this\._instanced\('broken'/.test(envCode));
ok('a smashed window swaps its glass panel for the broken wall',
  /off: !!e\.broken/.test(envCode) && /w\.wasBroken/.test(envCode)
    && /smashed\]/.test(envCode));
ok('the grand staircase is kit stairs, not paint',
  /staircase: 'stairs'/.test(envCode) && /stairs: 'stairs\.glb'/.test(envCode)
    && /stairs: \[\]/.test(envCode));
ok('furniture stands on the middle of the rect it is drawn from, not its corner',
  /f\.x \+ \(f\.w \|\| 0\) \/ 2/.test(envCode) && /f\.y \+ \(f\.h \|\| 0\) \/ 2/.test(envCode));
ok('every mapped/custom furniture and prop suppresses its retired Canvas twin',
  /f\.env3d/.test(mansionCode) && /p\.env3d/.test(mansionCode)
    && /f\.env3d = true/.test(envCode) && /p\.env3d = true/.test(envCode));
ok('the reach is measured as the room is drawn, not on the floor',
  /swingDist\(/.test(gameCode) && /swingDist\(/.test(coachCode) && /tilt/.test(weaponsCode));
ok('a swing dead to the right keeps its aim', /swingAngle \?\? player\.angle/.test(gameCode));

console.log(failures === 0 ? '\nGLB registry + environment kit: all PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
