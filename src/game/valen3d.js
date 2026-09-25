/* Direct runtime for the uploaded Valen GLB.
 *
 * The source asset is loaded as-is. Nothing here optimises, rewrites, bakes or
 * exports the GLB. Three.js evaluates its original skin and animation tracks on
 * a small transparent WebGL canvas, which the existing Canvas 2D renderer then
 * composites as the upright player layer.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';

export const VALEN_MODEL_URL = './new_character_glb_box_01_run_walk_c0d0d3.glb';
export const VALEN_CLIPS = Object.freeze({
  idle: null,       // user-approved bind/rest pose
  walk: 'walk',
  run: 'run',
  attack: 'box_01',
});

export function valenClipForState(state) {
  if (state === 'walk') return VALEN_CLIPS.walk;
  if (state === 'run') return VALEN_CLIPS.run;
  if (state === 'attack') return VALEN_CLIPS.attack;
  return VALEN_CLIPS.idle;
}

const PITCH_DY = 1.18;   // tan(24°) * PITCH_DZ — matches the lower floor tilt
const PITCH_DZ = 2.65;

const wrap01 = (value) => ((value % 1) + 1) % 1;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(0.00001, b - a));
  return t * t * (3 - 2 * t);
};

class ValenRuntime {
  constructor() {
    this.ready = false;
    this.loading = false;
    this.failed = false;
    this.error = null;
    this.progress = 0;
    this.canvas = null;
    this.renderer = null;
    this.stage = null;
    this.model = null;
    this.camera = null;
    this.mixer = null;
    this.actions = Object.create(null);
    this.clips = Object.create(null);
    this.hips = null;
    this.restHips = null;
    this.bounds = null;
    this._promise = null;
  }

  /** Reset a failed load and go again (exposed via __LN_API.retryValen). */
  retry(onProgress) {
    if (this.ready || this.loading) return Promise.resolve(this);
    this.failed = false;
    this.error = null;
    this.progress = 0;
    this._promise = null;
    return this.init(onProgress);
  }

  init(onProgress) {
    if (this.ready) return Promise.resolve(this);
    if (this._promise) return this._promise;
    if (typeof document === 'undefined') return Promise.resolve(this);

    this.loading = true;
    this._promise = new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        // Extra transparent width keeps the authored lunges and running poses
        // inside the frame without changing the character's vertical scale.
        canvas.width = 288;
        canvas.height = 320;
        canvas.setAttribute('aria-hidden', 'true');
        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(1);
        renderer.setSize(canvas.width, canvas.height, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;
        this.canvas = canvas;
        this.renderer = renderer;

        const scene = new THREE.Scene();
        const stage = new THREE.Group();
        scene.add(stage);
        scene.add(new THREE.HemisphereLight(0x9aaed4, 0x160b12, 1.7));
        const key = new THREE.DirectionalLight(0xffdfc2, 2.65);
        key.position.set(-2.2, 3.4, 4.2);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x718fd2, 1.85);
        rim.position.set(2.8, 2.1, -3.5);
        scene.add(rim);
        this.scene = scene;
        this.stage = stage;

        const halfHeight = 0.57;
        const halfWidth = halfHeight * (canvas.width / canvas.height);
        const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 10);
        // v1.1 — 3/4 pitch: the 2D world is drawn on an oblique plane, so the
        // billboard camera looks DOWN ~30° at the model instead of straight at
        // its face. Reads as the same camera height everywhere; the face turns
        // to the player while the top of the head and shoulders catch light.
        camera.position.set(0, 0.5 + PITCH_DY, PITCH_DZ);
        camera.lookAt(0, 0.5, 0);
        this.camera = camera;

        const loader = new GLTFLoader();
        // The character IS this asset (bought, original bytes). A 27 MB fetch
        // is the one thing in the boot path that can blink on a weak link — so
        // it gets three attempts with backoff before the failure state, and a
        // public retry() after that. Never silently settle for the fallback.
        const ATTEMPTS = 3;
        const attempt = (n) => loader.load(
          VALEN_MODEL_URL,
          (gltf) => {
            try {
              this._acceptModel(gltf);
              this.progress = 1;
              if (onProgress) onProgress(1);
              resolve(this);
            } catch (error) {
              this._fail(error);
              resolve(this);
            }
          },
          (event) => {
            const total = event.total || 0;
            this.progress = total > 0 ? clamp01(event.loaded / total) : this.progress;
            if (onProgress) onProgress(this.progress);
          },
          (error) => {
            if (n < ATTEMPTS) {
              this.progress = 0;
              if (onProgress) onProgress(0.02);
              setTimeout(() => attempt(n + 1), 600 * n);
              return;
            }
            this._fail(error);
            resolve(this);
          },
        );
        attempt(1);
      } catch (error) {
        this._fail(error);
        resolve(this);
      }
    });
    return this._promise;
  }

  _acceptModel(gltf) {
    const names = new Set(gltf.animations.map((clip) => clip.name));
    for (const required of [VALEN_CLIPS.attack, VALEN_CLIPS.run, VALEN_CLIPS.walk]) {
      if (!names.has(required)) throw new Error(`Valen GLB is missing animation clip "${required}"`);
    }

    this.model = gltf.scene;
    this.model.rotation.order = 'YXZ';
    // Root-motion cancellation moves the model container opposite its bones.
    // Three's static skinned-mesh bounds do not account for that cancellation
    // and can otherwise cull valid later frames of the run clip.
    this.model.traverse((object) => {
      if (object.isSkinnedMesh) object.frustumCulled = false;
    });
    this.stage.add(this.model);
    this.model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.bounds = { min: box.min.clone(), max: box.max.clone(), size, center };

    // Keep the original model scale and textures. Only the orthographic camera
    // is fitted around it, preserving the authored geometry and material data.
    this._applyCamera('portrait');

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) this.clips[clip.name] = clip;
    for (const name of [VALEN_CLIPS.walk, VALEN_CLIPS.run, VALEN_CLIPS.attack]) {
      const action = this.mixer.clipAction(this.clips[name]);
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0);
      action.play();
      action.paused = true;
      this.actions[name] = action;
    }

    this.hips = this._rigObject('mixamorig:Hips');
    this.restHips = this.hips ? this.hips.position.clone() : null;
    this.loading = false;
    this.ready = true;
    this.failed = false;
    this.render({ state: 'idle', angle: Math.PI / 2, speed: 0, stepPhase: 0, attackProgress: 0 });
  }

  _fail(error) {
    this.loading = false;
    this.failed = true;
    this.ready = false;
    this.error = error instanceof Error ? error : new Error(String(error));
    console.error('Valen GLB failed to load; using the Canvas fallback.', this.error);
  }

  /**
   * Portrait is the menu hero: a 3/4 full body. Overhead is the play camera.
   * The world is top-down, so the token is the head and a little of the body —
   * a full standing portrait on that floor reads as someone lying asleep.
   */
  _applyCamera(view) {
    const b = this.bounds;
    if (!b || !this.camera) return;
    const aspect = this.canvas.width / this.canvas.height;
    if (view === 'overhead') {
      this._frameHead();
    } else {
      const verticalSpan = Math.max(1.12, b.size.y * 1.14);
      const halfHeight = verticalSpan / 2;
      const halfWidth = halfHeight * aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.position.set(b.center.x, b.center.y + PITCH_DY, PITCH_DZ);
      this.camera.lookAt(b.center.x, b.center.y, 0);
    }
    this.camera.near = 0.05;
    this.camera.far = 12;
    this.camera.updateProjectionMatrix();
  }

  /** Top-down token: crown, face, and the shoulders. Not the coat, not the boots. */
  _frameHead() {
    const head = this._rigObject('mixamorig:Head');
    const neck = this._rigObject('mixamorig:Neck');
    const top = this._rigObject('mixamorig:HeadTop_End');
    if (!head || !this.bounds) return;
    const hp = this._hp || (this._hp = new THREE.Vector3());
    const np = this._np || (this._np = new THREE.Vector3());
    const tp = this._tp || (this._tp = new THREE.Vector3());
    head.getWorldPosition(hp);
    if (neck) neck.getWorldPosition(np); else np.copy(hp);
    if (top) top.getWorldPosition(tp); else tp.copy(hp).setY(hp.y + 0.11);
    const span = Math.max(0.1, tp.distanceTo(np));
    const look = hp.clone().lerp(np, 0.28);
    const aspect = this.canvas.width / this.canvas.height;
    const halfH = span * 0.72;
    const halfW = Math.max(halfH * aspect, span * 0.95);
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.position.set(look.x, look.y + span * 5.2, look.z + span * 0.42);
    this.camera.lookAt(look);
    this.camera.near = 0.02;
    this.camera.far = 12;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Evaluate the authored clips at gameplay-controlled times and render one
   * transparent frame. Walk/run use collision-resolved stride phase, while the
   * attack clip is compressed to the gameplay attack window.
   */
  render({ state = 'idle', angle = Math.PI / 2, speed = 0, stepPhase = 0, attackProgress = 0, view = 'portrait' } = {}) {
    if (!this.ready || !this.renderer || !this.model || !this.mixer) return null;
    this._applyCamera(view);

    const attacking = state === 'attack';
    const locomotion = attacking ? 0 : smoothstep(4, 24, speed);
    const runBlend = smoothstep(140, 180, speed);  // v1.2: match state threshold (160) + walk/run speeds (122/196)
    const walkWeight = locomotion * (1 - runBlend);
    const runWeight = locomotion * runBlend;
    const attackWeight = state === 'attack' ? 1 : 0;
    const phase = wrap01(stepPhase / (Math.PI * 2));

    const walkAction = this.actions[VALEN_CLIPS.walk];
    const runAction = this.actions[VALEN_CLIPS.run];
    const attackAction = this.actions[VALEN_CLIPS.attack];
    walkAction.setEffectiveWeight(walkWeight);
    runAction.setEffectiveWeight(runWeight);
    attackAction.setEffectiveWeight(attackWeight);
    walkAction.time = phase * this.clips[VALEN_CLIPS.walk].duration;
    runAction.time = phase * this.clips[VALEN_CLIPS.run].duration;
    attackAction.time = clamp01(attackProgress) * this.clips[VALEN_CLIPS.attack].duration;
    this.mixer.update(0);

    // Walk and run contain authored forward root translation. World movement
    // belongs to Player.update(), so counter-translate the model container in
    // memory while retaining every bone keyframe (including vertical motion).
    // The GLB and its animation data remain untouched.
    const yaw = Math.PI / 2 - angle;
    let rootX = 0, rootZ = 0;
    if (this.hips && this.restHips) {
      const dx = this.hips.position.x - this.restHips.x;
      const dz = this.hips.position.z - this.restHips.z;
      rootX = Math.cos(yaw) * dx + Math.sin(yaw) * dz;
      rootZ = -Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    }

    // Natural front in this asset is shown at yaw 0 when moving south. This
    // formula maps the continuous Canvas heading to a continuous 3D turn.
    this.model.rotation.order = 'YXZ';
    this.model.rotation.y = yaw;
    this.model.position.x = -rootX;
    this.model.position.z = -rootZ;
    this.model.updateMatrixWorld(true);
    if (view === 'overhead') this._frameHead();
    this.renderer.toneMappingExposure = view === 'overhead' ? 1.65 : 1.18;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  renderMenu() {
    return this.render({ state: 'idle', angle: 0, speed: 0, stepPhase: 0, attackProgress: 0 });
  }

  _rigObject(name) {
    if (!this.model) return null;
    // GLTFLoader sanitizes node names for AnimationMixer property paths (for
    // example, `mixamorig:Hips` becomes `mixamorigHips`). Accept source names
    // at this API boundary so gameplay code can keep referring to GLB joints.
    return this.model.getObjectByName(name)
      || this.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  }

  screenPoint(name) {
    if (!this.ready || !this.model || !this.camera || !this.canvas) return null;
    const object = this._rigObject(name);
    if (!object) return null;
    const point = new THREE.Vector3();
    object.getWorldPosition(point);
    point.project(this.camera);
    return {
      x: (point.x * 0.5 + 0.5) * this.canvas.width,
      y: (-point.y * 0.5 + 0.5) * this.canvas.height,
    };
  }

  draw(ctx, canvas, height, { alpha = 1, footInset = 7, anchor = 'feet', head = null, drop = 0 } = {}) {
    if (!canvas) return false;
    const width = height * (canvas.width / canvas.height);
    let x = -width / 2;
    let y = -height + footInset;
    if (anchor === 'head' && head) {
      // Only the skull and the shoulders. A full coat on this floor reads as
      // a body lying down.
      const cropW = canvas.width * 0.58;
      const cropH = canvas.height * 0.48;
      const sx = Math.max(0, Math.min(canvas.width - cropW, head.x - cropW * 0.5));
      const sy = Math.max(0, Math.min(canvas.height - cropH, head.y - cropH * 0.62));
      const dw = height * (cropW / cropH);
      const hx = ((head.x - sx) / cropW) * dw;
      const hy = ((head.y - sy) / cropH) * height;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(canvas, sx, sy, cropW, cropH, -hx, drop - hy, dw, height);
      ctx.restore();
      return true;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(canvas, x, y, width, height);
    ctx.restore();
    return true;
  }

  diagnostics() {
    return {
      ready: this.ready,
      loading: this.loading,
      failed: this.failed,
      progress: this.progress,
      clips: Object.keys(this.clips),
      modelUrl: VALEN_MODEL_URL,
      sourceUnmodified: true,
    };
  }
}

export const Valen3D = new ValenRuntime();
