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
    const span = Math.max(0.12, tp.distanceTo(np));
    const look = hp.clone().lerp(np, 0.32);
    const aspect = this.canvas.width / this.canvas.height;
    // Wide enough that the skull and collar sit inside the frame. A tight
    // ortho clips the coat into a hard rectangle on the map.
    const halfH = span * 1.7;
    const halfW = Math.max(halfH * aspect, span * 2.2);
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.position.set(look.x, look.y + span * 6.2, look.z + span * 0.26);
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
    // X first, then yaw, so standing her up does not flip when she turns.
    // The rest pose bows at the floor; overhead then reads as someone asleep.
    // -1.0 rad is the view correction that shows the skull and the collar.
    if (view === 'overhead') {
      this.model.rotation.order = 'XYZ';
      this.model.rotation.x = -1.0;
      this.model.rotation.y = yaw;
    } else {
      this.model.rotation.order = 'YXZ';
      this.model.rotation.x = 0;
      this.model.rotation.y = yaw;
    }
    this.model.position.x = -rootX;
    this.model.position.z = -rootZ;
    this.model.updateMatrixWorld(true);
    if (view === 'overhead') this._frameHead();
    this.renderer.toneMappingExposure = view === 'overhead' ? 1.9 : 1.18;
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

  /**
   * Opaque pixels around the skull. The search window is inset from the
   * canvas edge so a clipped coat cannot become the token's border.
   */
  _headBox(canvas, head) {
    const w = canvas.width;
    const h = canvas.height;
    const winW = Math.round(w * 0.62);
    const winH = Math.round(h * 0.5);
    const x0 = Math.max(0, Math.min(w - winW, Math.round(head.x - winW * 0.5)));
    const y0 = Math.max(0, Math.min(h - winH, Math.round(head.y - winH * 0.62)));
    if (!this._scan || this._scan.width !== w || this._scan.height !== h) {
      this._scan = document.createElement('canvas');
      this._scan.width = w;
      this._scan.height = h;
      this._scanCtx = this._scan.getContext('2d', { willReadFrequently: true });
    }
    this._scanCtx.clearRect(0, 0, w, h);
    this._scanCtx.drawImage(canvas, 0, 0);
    const data = this._scanCtx.getImageData(x0, y0, winW, winH).data;
    let minX = winW, minY = winH, maxX = 0, maxY = 0, hit = false;
    for (let y = 0; y < winH; y += 2) {
      for (let x = 0; x < winW; x += 2) {
        if (data[(y * winW + x) * 4 + 3] > 16) {
          hit = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!hit) return { x: x0, y: y0, w: winW, h: winH };
    const pad = 2;
    return {
      x: x0 + Math.max(0, minX - pad),
      y: y0 + Math.max(0, minY - pad),
      w: Math.min(winW - Math.max(0, minX - pad), maxX - minX + pad * 2 + 2),
      h: Math.min(winH - Math.max(0, minY - pad), maxY - minY + pad * 2 + 2),
    };
  }

  /**
   * The coat is wider than the skull, so a crop cuts it on a straight line.
   * Fade that cut. The hair keeps its own outline.
   */
  _softToken(canvas, box, dw, height) {
    const tw = Math.max(2, Math.ceil(dw));
    const th = Math.max(2, Math.ceil(height));
    if (!this._token || this._token.width !== tw || this._token.height !== th) {
      this._token = document.createElement('canvas');
      this._token.width = tw;
      this._token.height = th;
    }
    const t = this._token.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, tw, th);
    t.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, tw, th);
    t.globalCompositeOperation = 'destination-in';
    const down = t.createLinearGradient(0, th * 0.38, 0, th);
    down.addColorStop(0, 'rgba(0,0,0,1)');
    down.addColorStop(0.46, 'rgba(0,0,0,1)');
    down.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = down;
    t.fillRect(0, 0, tw, th);
    const side = t.createLinearGradient(0, 0, tw, 0);
    side.addColorStop(0, 'rgba(0,0,0,0)');
    side.addColorStop(0.1, 'rgba(0,0,0,1)');
    side.addColorStop(0.9, 'rgba(0,0,0,1)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = side;
    t.fillRect(0, 0, tw, th);
    t.globalCompositeOperation = 'source-over';
    return this._token;
  }

  draw(ctx, canvas, height, { alpha = 1, footInset = 7, anchor = 'feet', head = null, drop = 0 } = {}) {
    if (!canvas) return false;
    const width = height * (canvas.width / canvas.height);
    let x = -width / 2;
    let y = -height + footInset;
    if (anchor === 'head' && head) {
      // Draw the skull's own silhouette, not a rectangle of the render.
      // A fixed crop cuts the coat on a straight edge and looks pasted on.
      const box = this._headBox(canvas, head);
      const dw = height * (box.w / box.h);
      const hx = ((head.x - box.x) / box.w) * dw;
      const hy = ((head.y - box.y) / box.h) * height;
      const token = this._softToken(canvas, box, dw, height);
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(token, -hx, drop - hy);
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
