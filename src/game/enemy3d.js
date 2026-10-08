/* Shared enemy GLB stage.
 *
 * Valen already owns the WebGL canvas, the camera, and the light rig. Enemy
 * bodies are attached to that same scene, so a lamp and a dark corner grade
 * them the way they grade her. Only ENEMY_GLB_CAP skinned meshes are live;
 * overflow, loading, and failed assets use low-poly 3D proxies in the active
 * game scene. Cached canvas previews remain for portrait/non-gameplay tools.
 *
 * A night never waits on a file. The player hunter is not an enemy.
 *
 * Enemy roles each resolve to a locally vendored, rigged GLB. Five distinct
 * CC0 Quaternius monsters are sourced from the owner-supplied Ultimate
 * Monsters bundle; the existing Werewolf remains its own rig. Each role maps
 * behaviour to the original clip name (including namespaced Quaternius clips).
 * Source GLB bytes are kept unchanged; only this runtime map selects actions.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { dist } from '../core/util.js';
import { Valen3D } from './valen3d.js';

export const ENEMY_GLB_CAP = 8;
const HURT_FLASH_COLOR = new THREE.Color(0xffe0d8);

/** Required actions per role; idle is optional, and the local Werewolf has no hurt clip. */
export const ENEMY_CLIP_CONTRACT = Object.freeze({
  crawler: ['walk', 'attack', 'die', 'hurt'],
  zombie: ['walk', 'attack', 'die', 'hurt'],
  hunter: ['walk', 'attack', 'die', 'hurt'],
  ghoul: ['walk', 'attack', 'die', 'hurt'],
  werewolf: ['run', 'attack', 'die'],
  // The late-game Stalker is the feral rig: its charge clip is the locomotion.
  stalker: ['run', 'attack', 'die', 'hurt'],
});

/**
 * Vendored files only. Each enemy role gets a distinct silhouette where the
 * source pack supports it; `map` points gameplay states at the source file's
 * named animation rather than rewriting or relabelling the GLB.
 */
const MONSTERS = './assets/monsters/ultimate/';
const WOLF_BODY = './werewolf-3d-model.glb';

const BIPED_MAP = Object.freeze({
  walk: 'CharacterArmature|Walk',
  run: 'CharacterArmature|Run',
  attack: 'CharacterArmature|Punch',
  die: 'CharacterArmature|Death',
  hurt: 'CharacterArmature|HitReact',
  idle: 'CharacterArmature|Idle',
});
const CRAWLER_MAP = Object.freeze({
  walk: 'CharacterArmature|Walk',
  attack: 'CharacterArmature|Bite_Front',
  die: 'CharacterArmature|Death',
  hurt: 'CharacterArmature|HitRecieve',
  idle: 'CharacterArmature|Idle',
});
const FLYER_MAP = Object.freeze({
  walk: 'CharacterArmature|Fast_Flying',
  run: 'CharacterArmature|Fast_Flying',
  attack: 'CharacterArmature|Headbutt',
  die: 'CharacterArmature|Death',
  hurt: 'CharacterArmature|HitReact',
  idle: 'CharacterArmature|Flying_Idle',
});
const YETI_MAP = Object.freeze({
  run: 'CharacterArmature|Run',
  attack: 'CharacterArmature|Punch',
  die: 'CharacterArmature|Death',
  hurt: 'CharacterArmature|HitReact',
  idle: 'CharacterArmature|Idle',
});
const WOLF_MAP = Object.freeze({
  run: 'angry_02.001',
  attack: 'front_kick_02.001',
  die: 'fall.001',
  idle: 'box_02.001',
});

export const ENEMY_MODELS = Object.freeze({
  zombie: Object.freeze({ url: `${MONSTERS}demon.glb`, map: BIPED_MAP }),
  crawler: Object.freeze({ url: `${MONSTERS}green-spiky-blob.glb`, map: CRAWLER_MAP }),
  hunter: Object.freeze({ url: `${MONSTERS}blue-demon.glb`, map: BIPED_MAP }),
  ghoul: Object.freeze({ url: `${MONSTERS}ghost-skull.glb`, map: FLYER_MAP }),
  werewolf: Object.freeze({ url: WOLF_BODY, map: WOLF_MAP }),
  stalker: Object.freeze({ url: `${MONSTERS}yeti.glb`, map: YETI_MAP }),
});

/** No action aliases are used as stand-ins: every role has its own source clip. */
export const FORBIDDEN_STANDINS = Object.freeze({
  zombie: Object.freeze([]),
  crawler: Object.freeze([]),
  hunter: Object.freeze([]),
  ghoul: Object.freeze([]),
  werewolf: Object.freeze([]),
  stalker: Object.freeze([]),
});

/**
 * Portrait-preview exposure only — the shared world still lights each rig
 * through the mansion. Source GLB bytes and their authored materials stay intact.
 */
export const ENEMY_EXPOSURE = Object.freeze({
  zombie: 0.55,
  crawler: 0.55,
  ghoul: 0.55,
  hunter: 0.55,
  stalker: 1.3,
  werewolf: 1.3,
});

/**
 * Grade a rendered body with the light of the floor it is standing on, and
 * return it. The rule this function exists to keep: a body is a SILHOUETTE.
 * The frame it is cut from is transparent everywhere the body is not, and
 * nothing here may fill that air in — a lamp that brightens the empty pixels
 * hands the world a lit rectangle with a monster printed on it. Dark shades
 * use 'source-atop', which can only paint where paint already is; the lit
 * branch uses 'screen', which cannot, so it puts the alpha back afterwards.
 *
 * Pure apart from the canvas it writes into: the harness holds it to this.
 */
export function gradeFrame(frame, shade, out) {
  if (!frame || !out) return frame;
  if (out.width !== frame.width || out.height !== frame.height) {
    out.width = frame.width;
    out.height = frame.height;
  }
  const g = out.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, out.width, out.height);
  g.drawImage(frame, 0, 0);
  if (shade.lit < 0.55) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(7,9,14,${Math.min(0.72, 0.58 + (0.4 - shade.lit) * 0.2).toFixed(3)})`;
    g.fillRect(0, 0, out.width, out.height);
  } else {
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = Math.min(0.42, (shade.lit - 0.35) * 0.45);
    g.fillStyle = `rgb(${shade.r | 0},${shade.g | 0},${shade.b | 0})`;
    g.fillRect(0, 0, out.width, out.height);
    g.globalCompositeOperation = 'destination-in';
    g.globalAlpha = 1;
    g.drawImage(frame, 0, 0);
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  return out;
}

export const ENEMY_HEIGHT = Object.freeze({
  crawler: 46,
  zombie: 74,
  hunter: 78,
  ghoul: 68,
  werewolf: 90,
  stalker: 90,
});

export function requiredClips(key) {
  return ENEMY_CLIP_CONTRACT[key] || ['walk', 'attack', 'die'];
}

export function standinViolation(key) {
  const map = (ENEMY_MODELS[key] && ENEMY_MODELS[key].map) || {};
  const banned = FORBIDDEN_STANDINS[key] || [];
  const bad = [];
  for (const [behavior, file] of Object.entries(map)) {
    if (behavior === 'die') continue;
    if (banned.includes(file)) bad.push(`${behavior}=${file}`);
  }
  return bad;
}

export function behaviorReady(key, clipNames, map = null) {
  const names = new Set(clipNames || []);
  const spec = map || (ENEMY_MODELS[key] && ENEMY_MODELS[key].map) || {};
  const missing = [];
  for (const need of requiredClips(key)) {
    const fileName = spec[need] || need;
    if (!names.has(fileName)) missing.push(need);
  }
  return { ready: missing.length === 0 && standinViolation(key).length === 0, missing };
}

/** Nearest-first. Dead bodies and types that cannot fight are not skinned. */
export function selectGlbSlots(enemies, player, cap, isReady) {
  if (!player || cap <= 0) return [];
  const living = [];
  const dying = [];
  for (const e of enemies) {
    if (!e || !isReady(e.key)) continue;
    if (e.dead || e.state === 'dying') {
      // Keep a short death clip in the skinned-model budget when there is a
      // spare slot; living threats retain priority under the mobile cap.
      if ((e.deathT || 0) < 1.45) dying.push(e);
    } else living.push(e);
  }
  const nearest = (a, b) => dist(a.x, a.y, player.x, player.y) - dist(b.x, b.y, player.x, player.y);
  living.sort(nearest);
  dying.sort(nearest);
  return [...living, ...dying].slice(0, cap);
}

/**
 * Id book for the pool. Models are attached beside these records; the book
 * itself never parses a file and never grows past `cap`.
 */
export class SlotBook {
  constructor(cap = ENEMY_GLB_CAP) {
    this.cap = cap;
    this.live = [];
    this.free = [];
    this.made = 0;
  }

  sync(picked) {
    const want = new Set(picked.map((e) => e.id));
    for (const slot of this.live) {
      if (!want.has(slot.id)) {
        slot.id = 0;
        this.free.push(slot);
      }
    }
    this.live = this.live.filter((slot) => slot.id);
    let starved = 0;
    for (const enemy of picked) {
      if (this.live.some((slot) => slot.id === enemy.id)) continue;
      let slot = this.free.find((free) => free.type === enemy.key);
      if (slot) this.free.splice(this.free.indexOf(slot), 1);
      if (!slot) {
        if (this.live.length + this.free.length >= this.cap) {
          starved++;
          continue;
        }
        slot = { id: 0, type: enemy.key, n: ++this.made };
      }
      slot.id = enemy.id;
      slot.type = enemy.key;
      this.live.push(slot);
    }
    return { live: this.live.length, made: this.made, starved, free: this.free.length };
  }
}

export function enemyClipForState(key, enemy) {
  if (enemy.dead || enemy.state === 'dying') return 'die';
  const map = ENEMY_MODELS[key]?.map || {};
  if (map.hurt && ((enemy.hurtFlash || 0) > 0 || (enemy.staggerT || 0) > 0)) return 'hurt';
  if (enemy.state === 'strike' || enemy.state === 'windup' || enemy.state === 'charge') return 'attack';
  const moving = Math.hypot(enemy.vx || 0, enemy.vy || 0) > 12;
  if ((key === 'werewolf' || key === 'stalker') && moving) return 'run';
  if (moving) return 'walk';
  return 'idle';
}

function cloneRig(root) {
  const clone = root.clone(true);
  // Skeleton instances share vertex buffers, but variant tint/material changes
  // must remain per enemy. Clone each source material once for this rig.
  const materials = new Map();
  clone.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const cloneMaterial = (material) => {
      if (!material) return material;
      let copy = materials.get(material);
      if (!copy) { copy = material.clone(); materials.set(material, copy); }
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
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

class EnemyStage {
  constructor() {
    this.cap = ENEMY_GLB_CAP;
    this.book = new SlotBook(this.cap);
    this.types = Object.create(null);
    this.slots = [];
    this.free = [];
    this.billboards = Object.create(null);
    this.proofs = null;
    this._started = false;
    this._box = null;
    this._size = null;
    this._center = null;
    this.shared = false;
  }

  init() {
    if (this._started || typeof document === 'undefined') return;
    this._started = true;
    this._files = Object.create(null);
    for (const key of Object.keys(ENEMY_MODELS)) this._load(key);
  }

  /**
   * One file, one fetch, one parse. Roles that share a body are attached to
   * the same in-flight GLTF; distinct monster silhouettes load in parallel.
   */
  _load(key) {
    const spec = ENEMY_MODELS[key];
    const rec = {
      url: spec.url,
      loading: true,
      loaded: false,
      failed: false,
      behaviorReady: false,
      missing: requiredClips(key).slice(),
      clips: [],
      error: null,
      template: null,
      animations: null,
      preview: null,
    };
    this.types[key] = rec;
    let file = this._files[spec.url];
    if (!file) {
      file = this._files[spec.url] = { url: spec.url, gltf: null, failed: false, error: null, waiting: [key] };
      const loader = new GLTFLoader();
      const settle = (fn) => {
        const waiting = file.waiting.slice();
        file.waiting = [];
        for (const other of waiting) fn(other);
      };
      loader.load(spec.url, (gltf) => {
        file.gltf = gltf;
        settle((other) => {
          try {
            this._accept(other, gltf);
          } catch (error) {
            this._fail(other, String(error && error.message || error));
          }
        });
      }, undefined, (error) => {
        file.failed = true;
        file.error = String(error && error.message || error);
        settle((other) => this._fail(other, file.error));
      });
      return;
    }
    if (file.gltf) this._accept(key, file.gltf);
    else if (file.failed) this._fail(key, file.error);
    else file.waiting.push(key);
  }

  _fail(key, error) {
    const rec = this.types[key];
    if (!rec) return;
    rec.loading = false;
    rec.failed = true;
    rec.behaviorReady = false;
    rec.error = error;
  }

  _accept(key, gltf) {
    const rec = this.types[key];
    const names = (gltf.animations || []).map((clip) => clip.name);
    const verdict = behaviorReady(key, names);
    rec.clips = names;
    rec.missing = verdict.missing;
    rec.behaviorReady = verdict.ready;
    // A clone, so a type may retarget, pose and grade its own body. Geometry,
    // materials and textures stay shared with the one parsed file.
    rec.template = cloneRig(gltf.scene);
    // They are standing in the room too, not stamped on it (#54 Phase B).
    rec.template.traverse((object) => {
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = false; }
    });
    rec.template.visible = false;
    rec.animations = gltf.animations || [];
    rec.loaded = true;
    rec.loading = false;
    rec.failed = false;
    this._bakePreview(key);
  }

  forceFail(key) {
    const rec = this.types[key] || (this.types[key] = { url: null, clips: [], missing: requiredClips(key) });
    rec.failed = true;
    rec.behaviorReady = false;
    rec.loaded = false;
    rec.preview = null;
    for (const slot of this.slots) {
      if (slot.type === key) slot.enemyId = 0;
    }
  }

  /** Valen's canvas, camera, and lights. A second WebGL context is the fallback only. */
  _host() {
    if (Valen3D.renderer && Valen3D.scene && Valen3D.stage && Valen3D.camera && Valen3D.canvas) {
      this.shared = true;
      return {
        renderer: Valen3D.renderer,
        scene: Valen3D.scene,
        stage: Valen3D.stage,
        camera: Valen3D.camera,
        canvas: Valen3D.canvas,
        // The room shares this scene so a body throws a real shadow on the
        // shared floor. It does not share the portrait: a frame carrying the
        // house is a rectangle on the 2D canvas, not a silhouette.
        solo: (fn) => Valen3D.soloPass(fn),
      };
    }
    if (Valen3D.loading || Valen3D.ready === false && !Valen3D.failed) return null;
    if (!Valen3D.failed) return null;
    return this._ownHost();
  }

  _ownHost() {
    if (this._own) return this._own;
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 288;
      canvas.height = 320;
      const renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(canvas.width, canvas.height, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.45;
      const scene = new THREE.Scene();
      const stage = new THREE.Group();
      scene.add(stage);
      scene.add(new THREE.HemisphereLight(0x9aaed4, 0x160b12, 1.7));
      const key = new THREE.DirectionalLight(0xffdfc2, 2.65);
      key.position.set(-2.2, 3.4, 4.2);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x718fd2, 1.85);
      rim.position.set(2.4, 2.6, -3.6);
      scene.add(rim);
      const camera = new THREE.OrthographicCamera(-0.7, 0.7, 0.78, -0.78, 0.05, 12);
      this._own = { renderer, scene, stage, camera, canvas };
      this.shared = false;
      return this._own;
    } catch (error) {
      this._ownError = String(error && error.message || error);
      return null;
    }
  }

  _withCamera(host, fn) {
    const cam = host.camera;
    const saved = {
      left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom,
      near: cam.near, far: cam.far,
      px: cam.position.x, py: cam.position.y, pz: cam.position.z,
      qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w,
      exposure: host.renderer.toneMappingExposure,
      valen: Valen3D.model ? Valen3D.model.visible : null,
    };
    if (Valen3D.model) Valen3D.model.visible = false;
    try {
      return fn();
    } finally {
      cam.left = saved.left;
      cam.right = saved.right;
      cam.top = saved.top;
      cam.bottom = saved.bottom;
      cam.near = saved.near;
      cam.far = saved.far;
      cam.position.set(saved.px, saved.py, saved.pz);
      cam.quaternion.set(saved.qx, saved.qy, saved.qz, saved.qw);
      cam.updateProjectionMatrix();
      host.renderer.toneMappingExposure = saved.exposure;
      if (Valen3D.model && saved.valen != null) Valen3D.model.visible = saved.valen;
      for (const slot of this.slots) slot.model.visible = false;
      for (const slot of this.free) slot.model.visible = false;
    }
  }

  _fit(host, model, key = 'zombie') {
    if (!this._box) {
      this._box = new THREE.Box3();
      this._size = new THREE.Vector3();
      this._center = new THREE.Vector3();
    }
    const box = this._box.setFromObject(model);
    const size = box.getSize(this._size);
    const center = box.getCenter(this._center);
    const aspect = host.canvas.width / host.canvas.height;
    // Same 3/4 pitch Valen uses in a night. The ortho is fitted to this body
    // so a taller rig does not inherit her scale — and to its WIDTH too, or a
    // body that is wider than it is tall (the werewolf, on all fours, with a
    // tail) gets its elbows cropped off the sides of its own frame.
    // Room under the feet as well as around the elbows: each body drops a real
    // shadow on the shared floor now, and the crop that sizes it is the body's
    // own projected box, so widening the frame costs nothing but shadow.
    const verticalSpan = Math.max(1.05, size.y * 1.45);
    const horizontalSpan = Math.max(size.x, size.z) * 1.14;
    const halfH = Math.max(verticalSpan, horizontalSpan / aspect) / 2;
    const halfW = halfH * aspect;
    const lookY = box.min.y + size.y * 0.4;
    const playDz = 2.35;
    const playDy = Math.tan(38 * Math.PI / 180) * playDz;
    host.camera.left = -halfW;
    host.camera.right = halfW;
    host.camera.top = halfH;
    host.camera.bottom = -halfH;
    host.camera.near = 0.05;
    host.camera.far = 14;
    host.camera.position.set(center.x, lookY + playDy, playDz);
    host.camera.lookAt(center.x, lookY, 0);
    host.camera.updateProjectionMatrix();
    // Fit this source rig's small preview independently; gameplay uses the
    // shared mansion lighting, not this temporary portrait exposure.
    host.renderer.toneMappingExposure = ENEMY_EXPOSURE[key] || 0.55;
  }

  _copyFrame(host, target) {
    if (!target || target.width !== host.canvas.width || target.height !== host.canvas.height) {
      return host.canvas;
    }
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(host.canvas, 0, 0);
    return target;
  }

  _bakePreview(key) {
    const rec = this.types[key];
    if (!rec || !rec.template || rec.failed) return;
    const host = this._host();
    if (!host) return;
    this._withCamera(host, () => {
      host.stage.add(rec.template);
      rec.template.visible = true;
      rec.template.position.set(0, 0, 0);
      rec.template.rotation.set(0, 0, 0);
      /* Stand it up before measuring it. A rig's rest pose is the pose it was
       * authored in, which is nobody's idea of the body: the werewolf rests
       * in a crouch that measures 253 wide by 119 tall, and a preview baked
       * from that sized every distant wolf at a hundred and forty per cent.
       * Play its idle and measure the silhouette the player will see. */
      const mixer = new THREE.AnimationMixer(rec.template);
      const map = ENEMY_MODELS[key] && ENEMY_MODELS[key].map;
      const idle = map && map.idle
        ? (rec.animations || []).find((clip) => clip.name === map.idle) : null;
      if (idle) {
        mixer.clipAction(idle).play();
        mixer.update(0.12);
      }
      rec.template.updateMatrixWorld(true);
      this._fit(host, rec.template, key);
      (host.solo || ((fn) => fn()))(() => {
        host.renderer.clear();
        host.renderer.render(host.scene, host.camera);
      });
      if (!rec.preview) {
        rec.preview = document.createElement('canvas');
        rec.preview.width = host.canvas.width;
        rec.preview.height = host.canvas.height;
      }
      this._copyFrame(host, rec.preview);
      rec.crop = this._opaqueBox(rec.preview);
      mixer.stopAllAction();
      mixer.uncacheRoot(rec.template);
      rec.template.visible = false;
      host.stage.remove(rec.template);
    });
  }

  _takeModel(key, options = {}) {
    const rec = this.types[key];
    if (!rec || !rec.behaviorReady || !rec.template || rec.failed) return null;
    let slot = this.free.find((item) => item.type === key);
    if (slot) this.free.splice(this.free.indexOf(slot), 1);
    const host = options.host || this._host();
    if (!host) return null;
    if (slot) {
      if (host.stage && slot.model.parent !== host.stage) host.stage.add(slot.model);
      return slot;
    }

    // Eight live rigs are the mobile budget, not eight lifetime model types.
    // A freed slot for another skeleton can be rebuilt from the already-loaded
    // template; otherwise the ninth type would remain a proxy for the rest of
    // the run even after its GLB and clips had finished loading.
    if (this.free.length) {
      slot = this.free.shift();
      if (slot.model && slot.model.parent) slot.model.parent.remove(slot.model);
    } else if (this.slots.length + this.free.length >= this.cap) return null;

    const model = cloneRig(rec.template);
    host.stage.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = Object.create(null);
    const map = ENEMY_MODELS[key].map || {};
    for (const need of ['idle', ...requiredClips(key)]) {
      const fileName = map[need] || need;
      const clip = rec.animations.find((item) => item.name === fileName);
      if (!clip) continue;
      if (need !== 'die' && (FORBIDDEN_STANDINS[key] || []).includes(clip.name)) continue;
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.setEffectiveWeight(0);
      actions[need] = action;
    }
    let frame = null;
    if (!options.full3D) {
      frame = slot ? slot.frame : document.createElement('canvas');
      if (!slot) { frame.width = host.canvas.width; frame.height = host.canvas.height; }
    }
    return { type: key, model, mixer, actions, enemyId: 0, frame };
  }

  assign(enemies, player, options = {}) {
    // Gameplay uses the live skinned model in the shared WebGL scene. Do not
    // spend frame time baking billboards unless a non-3D caller requested it.
    if (!options.full3D) for (const key of Object.keys(this.types)) {
      const rec = this.types[key];
      if (rec && rec.loaded && !rec.failed && !rec.preview) this._bakePreview(key);
    }
    const ready = (key) => !!(this.types[key] && this.types[key].behaviorReady && !this.types[key].failed);
    const picked = selectGlbSlots(enemies, player, this.cap, ready);
    this.book.sync(picked);
    if (!options.host && !this._host()) {
      for (const enemy of enemies) enemy._glb = null;
      return picked;
    }
    const liveIds = new Set(this.book.live.map((slot) => slot.id));
    for (const slot of this.slots) {
      if (!liveIds.has(slot.enemyId)) {
        slot.enemyId = 0;
        slot.model.visible = false;
        this.free.push(slot);
      }
    }
    this.slots = this.slots.filter((slot) => slot.enemyId);
    for (const enemy of enemies) enemy._glb = null;
    for (const rec of this.book.live) {
      const enemy = picked.find((item) => item.id === rec.id);
      if (!enemy) continue;
      let slot = this.slots.find((item) => item.enemyId === rec.id);
      if (!slot) {
        slot = this._takeModel(rec.type, options);
        if (!slot) continue;
        slot.enemyId = rec.id;
        this.slots.push(slot);
      }
      enemy._glb = slot;
      this._pose(slot, enemy);
      if (options.full3D) {
        this._placeWorld(slot, enemy, options);
      } else {
        this._renderSlot(slot, enemy);
        const bill = this.billboards[enemy.key] || (this.billboards[enemy.key] = document.createElement('canvas'));
        if (bill.width !== slot.frame.width) {
          bill.width = slot.frame.width;
          bill.height = slot.frame.height;
        }
        bill.getContext('2d').drawImage(slot.frame, 0, 0);
      }
    }
    return picked;
  }

  _pose(slot, enemy) {
    const want = enemyClipForState(slot.type, enemy);
    const action = slot.actions[want] || null;
    if (slot._hurtEnemyId !== enemy.id) {
      slot._hurtEnemyId = enemy.id;
      slot._hurtStaggerMax = 0;
      slot._hurtStaggerLast = 0;
    }
    if (want !== 'hurt') {
      slot._hurtStaggerMax = 0;
      slot._hurtStaggerLast = 0;
    }
    for (const name of Object.keys(slot.actions)) {
      const item = slot.actions[name];
      item.setEffectiveWeight(item === action ? 1 : 0);
      item.paused = true;
    }
    if (action) {
      const dur = action.getClip().duration || 1;
      if (want === 'die') action.time = Math.min(dur, enemy.deathT || 0);
      else if (want === 'attack') action.time = (enemy.stateT || 0) % dur;
      else if (want === 'hurt') {
        const flash = Math.max(0, Math.min(1, enemy.hurtFlash || 0));
        const stagger = Math.max(0, enemy.staggerT || 0);
        if (stagger > (slot._hurtStaggerLast || 0) + 0.02 || !(slot._hurtStaggerMax > 0)) {
          slot._hurtStaggerMax = stagger;
        }
        slot._hurtStaggerLast = stagger;
        const progress = flash > 0
          ? 1 - flash
          : stagger > 0 ? 1 - stagger / Math.max(0.001, slot._hurtStaggerMax) : 1;
        action.time = dur * Math.max(0, Math.min(1, progress));
      } else action.time = ((enemy._stepT || 0) + enemy.id * 0.17) % dur;
      slot.mixer.update(0);
    }
    slot.model.rotation.order = 'YXZ';
    slot.model.rotation.x = 0;
    slot.model.rotation.y = Math.PI / 2 - (enemy.angle || 0);
    slot.model.position.set(0, 0, 0);
    slot.model.updateMatrixWorld(true);
  }

  /** Keep the skinned GLB in the shared mansion scene instead of baking it to a sprite. */
  _placeWorld(slot, enemy, options = {}) {
    slot.model.scale.set(1, 1, 1);
    slot.model.position.set(0, 0, 0);
    slot.model.updateMatrixWorld(true);
    const box = this._box || (this._box = new THREE.Box3());
    const size = this._size || (this._size = new THREE.Vector3());
    box.setFromObject(slot.model);
    box.getSize(size);
    const projected = (ENEMY_HEIGHT[enemy.key] || 74) * (enemy.sizeMul || 1);
    const verticalProjection = options.verticalProjection || Math.sqrt(2 / 3);
    const targetWorldHeight = projected / verticalProjection;
    const scale = targetWorldHeight / Math.max(0.001, size.y);
    slot.model.scale.setScalar(scale);
    slot.model.position.set(enemy.x, -box.min.y * scale, enemy.y);
    const variant = enemy.variant || '';
    if (!slot._baseMaterials) {
      slot._baseMaterials = new Map();
      slot.model.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material || slot._baseMaterials.has(material)) continue;
          slot._baseMaterials.set(material, {
            color: material.color && material.color.clone(),
            emissive: material.emissive && material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity || 0,
          });
        }
      });
    }
    if (slot._visualVariant !== variant) {
      slot._variantTint = enemy.tint ? new THREE.Color(enemy.tint) : null;
      slot._visualVariant = variant;
    }
    const tint = slot._variantTint;
    const hurt = Math.max(0, Math.min(1, enemy.hurtFlash || 0));
    for (const [material, base] of slot._baseMaterials) {
      if (base.color) {
        material.color.copy(base.color);
        if (tint) material.color.lerp(tint, variant === 'master' ? 0.38 : 0.24);
      }
      if (base.emissive) {
        material.emissive.copy(base.emissive);
        if (tint) material.emissive.lerp(tint, variant === 'master' ? 0.28 : 0.12);
        if (hurt > 0) material.emissive.lerp(HURT_FLASH_COLOR, hurt * 0.72);
        material.emissiveIntensity = base.emissiveIntensity + hurt * 1.8;
      }
    }
    slot.model.visible = true;
    slot.model.userData.full3D = true;
    slot.model.updateMatrixWorld(true);
  }

  _renderSlot(slot, enemy = null) {
    const host = this._host();
    if (!host) return;
    this._withCamera(host, () => {
      slot.model.visible = true;
      // The lamp that lights this patch of floor lights the thing standing on
      // it: each body takes the shadow of its own position in the house.
      if (enemy && host._applyRig) {
        host._applyRig({ x: enemy.x, y: enemy.y, light: this._lightAt ? this._lightAt(enemy.x, enemy.y) : null });
      }
      this._fit(host, slot.model, slot.type);
      (host.solo || ((fn) => fn()))(() => {
        host.renderer.clear();
        host.renderer.render(host.scene, host.camera);
        this._copyFrame(host, slot.frame);
      });
      /* The crop is the TYPE's own measurement — the preview every body of it
       * was baked from, standing in its idle — not the box the body happens
       * to fill this frame.
       *
       * Two ways to get this wrong, and the house has been wrong both ways.
       * The bind-pose box runs a third taller than any pose a rig is animated
       * into, which drew a 74px zombie at 43 and a 90px werewolf at 71: the
       * house was full of monsters at two thirds of their size. Measuring the
       * live silhouette instead is worse in the other direction — a walk cycle
       * swings that box by a quarter of the body's height, so the creature
       * breathes as it walks and shrinks as it dies. One pose, measured once. */
      const rec = this.types[slot.type];
      const box = this._box && this._size ? this._box.setFromObject(slot.model) : null;
      slot.crop = (rec && rec.crop) || (box ? this._bodyBox(host, box) : null);
      slot.model.visible = false;
    });
  }

  frameFor(enemy) {
    if (!enemy) return null;
    const rec = this.types[enemy.key];
    if (rec && rec.failed) return null;
    if (enemy._glb && enemy._glb.frame) return { frame: enemy._glb.frame, crop: enemy._glb.crop };
    if (enemy._proof && rec && rec.preview && rec.loaded) return { frame: rec.preview, crop: rec.crop };
    if (rec && rec.behaviorReady && this.billboards[enemy.key]) return { frame: this.billboards[enemy.key], crop: rec.crop };
    return null;
  }

  /**
   * The body's box in the render, projected through the shared camera.
   *
   * The fallback, not the measurement: a bind-pose box is bigger than the
   * pose standing in the frame, so anything sized by it comes out small. It
   * is here for the frame that cannot be read back.
   */
  _bodyBox(host, box) {
    const cam = host.camera;
    if (!cam || !box || !host.canvas) return null;
    const v = this._vec || (this._vec = new THREE.Vector3());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(cam);
      const px = (v.x * 0.5 + 0.5) * host.canvas.width;
      const py = (1 - (v.y * 0.5 + 0.5)) * host.canvas.height;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (!isFinite(minX) || maxX - minX < 2 || maxY - minY < 2) return null;
    const pad = 3;
    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(host.canvas.width, Math.ceil(maxX + pad));
    const y1 = Math.min(host.canvas.height, Math.ceil(maxY + pad));
    return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
  }

  /** The house's light field, handed over by the renderer each frame (#54). */
  setLightSampler(fn) { this._lightAt = fn; }

  _opaqueBox(canvas) {
    let ctx;
    try { ctx = canvas.getContext('2d'); } catch (error) { return null; }
    if (!ctx || !ctx.getImageData) return null;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0, hit = false;
    const step = 2;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        if (data[(y * canvas.width + x) * 4 + 3] < 16) continue;
        hit = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (!hit) return null;
    return {
      x: Math.max(0, minX - 2),
      y: Math.max(0, minY - 2),
      w: Math.min(canvas.width, maxX - minX + 6),
      h: Math.min(canvas.height, maxY - minY + 6),
    };
  }

  /** Pre-light draw. The world multiply then seats the body in the room. */
  draw(ctx, enemy, game) {
    const packed = this.frameFor(enemy);
    if (!packed) return false;
    this._paint(ctx, enemy, packed.frame, game, 1, { crop: packed.crop });
    return true;
  }

  /**
   * After the lightmap. A lamp restores the mesh; the dark keeps a silhouette.
   * 2D bodies only get the rim — their fill was already multiplied.
   */
  paintLit(ctx, game) {
    if (!game || !game.renderer) return;
    const list = game.enemies || [];
    for (const enemy of list) {
      if (!enemy || enemy.dead) continue;
      if (!game.renderer.isVisible(enemy.x, enemy.y, 140)) continue;
      const packed = enemy._glb ? this.frameFor(enemy) : null;
      ctx.save();
      game.renderer.upright(ctx, enemy.x, enemy.y);
      if (packed) this._paint(ctx, enemy, packed.frame, game, this._restoreAlpha(enemy, game), { shadow: false, crop: packed.crop });
      this._rim(ctx, enemy, game);
      ctx.restore();
    }
    for (const proof of this.proofs || []) {
      const rec = this.types[proof.key];
      if (!rec || rec.failed || !rec.preview) continue;
      if (!game.renderer.isVisible(proof.x, proof.y, 160)) continue;
      ctx.save();
      game.renderer.upright(ctx, proof.x, proof.y);
      this._paint(ctx, proof, rec.preview, game, this._restoreAlpha(proof, game), { shadow: false, crop: rec.crop });
      this._rim(ctx, proof, game);
      ctx.restore();
    }
  }

  _restoreAlpha(enemy, game) {
    const shade = game.renderer.shadeAt(enemy.x, enemy.y, game);
    // The pre-light draw already took the multiply. Dark stays a silhouette.
    // A lamp restores the mesh the multiply crushed.
    if (shade.lit < 0.42) return 0.72;
    return Math.min(1, 0.62 + shade.lit * 0.38);
  }

  _graded(frame, shade) {
    if (!this._grade) this._grade = document.createElement('canvas');
    return gradeFrame(frame, shade, this._grade);
  }

  _paint(ctx, enemy, frame, game, alpha, opts = {}) {
    const shade = game.renderer.shadeAt ? game.renderer.shadeAt(enemy.x, enemy.y, game) : { keyX: -0.4, keyY: -0.8, keyW: 0.2, lit: 0.4, r: 180, g: 160, b: 120 };
    const shown = opts.grade === false ? frame : this._graded(frame, shade);
    const crop = opts.crop;
    const ang = Math.atan2(shade.keyY, shade.keyX);
    const h = (ENEMY_HEIGHT[enemy.key] || 74) * (enemy.sizeMul || 1);
    const aspect = crop ? crop.w / Math.max(1, crop.h) : shown.width / Math.max(1, shown.height);
    const w = h * aspect;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalAlpha = (enemy.alpha == null ? 1 : enemy.alpha) * alpha;
    // No painted puddle: the contact shadow under this body is the real one it
    // casts on the shared floor, and it is already inside the frame. Drawing
    // both would read as two shadows.
    if (crop) {
      const scale = h / crop.h;
      const dw = shown.width * scale;
      const dh = shown.height * scale;
      ctx.drawImage(shown, -w / 2 - crop.x * scale, -h + 6 - crop.y * scale, dw, dh);
    } else {
      ctx.drawImage(shown, -w / 2, -h + 8, w, h);
    }
    ctx.restore();
  }

  _rim(ctx, enemy, game) {
    const shade = game.renderer.shadeAt(enemy.x, enemy.y, game);
    const ang = Math.atan2(shade.keyY, -shade.keyX);
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = shade.lit > 0.55 ? 0.2 : 0.78;
    ctx.strokeStyle = shade.lit > 0.55
      ? `rgb(${shade.r | 0},${shade.g | 0},${shade.b | 0})`
      : 'rgba(186,206,236,0.95)';
    ctx.lineWidth = shade.lit > 0.55 ? 1.3 : 2.2;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * 3, -16, (enemy.radius || 12) + 3, ang + 2.2, ang + 4.1);
    ctx.stroke();
    ctx.restore();
  }

  setProofs(points) {
    this.proofs = points && points.length ? points.map((p) => ({ ...p, _proof: true, radius: 12, alpha: 1 })) : null;
    for (const proof of this.proofs || []) this._bakePreview(proof.key);
  }

  diagnostics() {
    const types = {};
    for (const key of Object.keys(ENEMY_MODELS)) {
      const rec = this.types[key] || {};
      types[key] = {
        url: ENEMY_MODELS[key].url,
        loaded: !!rec.loaded,
        loading: !!rec.loading,
        failed: !!rec.failed,
        behaviorReady: !!rec.behaviorReady,
        missing: rec.missing || requiredClips(key),
        clips: rec.clips || [],
        error: rec.error || null,
        sourceUnmodified: true,
        preview: !!rec.preview,
      };
    }
    return {
      cap: this.cap,
      skinned: this.slots.length,
      pooled: this.slots.length + this.free.length,
      made: this.book.made,
      shared: this.shared,
      types,
    };
  }
}

export const Enemy3D = new EnemyStage();

/** Light-relative contact shadow for the 2D fallback. Call after translate-to-feet. */
export function paintContactShadow(ctx, enemy, game, rx = 12, ry = 5) {
  const shade = game.renderer && game.renderer.shadeAt
    ? game.renderer.shadeAt(enemy.x, enemy.y, game)
    : { keyX: -0.3, keyY: 0.8, keyW: 0.2 };
  const ang = Math.atan2(shade.keyY, shade.keyX);
  const ox = Math.cos(ang) * (3 + shade.keyW * 8);
  const oy = 6 + Math.sin(ang) * (1.5 + shade.keyW * 3);
  ctx.fillStyle = `rgba(0,0,0,${(0.26 + shade.keyW * 0.3).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(ox, oy, rx + shade.keyW * 4, ry, ang * 0.12, 0, Math.PI * 2);
  ctx.fill();
}
