/* Direct runtime for the uploaded Valen GLB.
 *
 * The source asset is loaded as-is. Nothing here optimises, rewrites, bakes or
 * exports the GLB. Three.js evaluates its original skin and animation tracks on
 * a small transparent WebGL canvas, which the existing Canvas 2D renderer then
 * composites as the upright player layer.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';

export const VALEN_MODEL_URL = './hunter_run_walk_claw_sword_shot.glb';
export const VALEN_CLIPS = Object.freeze({
  idle: null,       // bind/rest pose — this rig has no idle clip
  walk: 'walk',
  run: 'run',
  attack: 'claw',   // unarmed default; sword and shot are weapon clips (#46)
  claw: 'claw',
  shot: 'shot',
  sword: 'sword',
});

export function valenClipForState(state, weapon = 'claw') {
  if (state === 'walk') return VALEN_CLIPS.walk;
  if (state === 'run') return VALEN_CLIPS.run;
  if (state === 'attack') return VALEN_CLIPS[weapon] || VALEN_CLIPS.attack;
  return VALEN_CLIPS.idle;
}

const PITCH_DY = 1.18;   // tan(24°) * PITCH_DZ — menu hero, a little more headroom
const PITCH_DZ = 2.65;
const PLAY_DZ = 2.35;
const PLAY_DY = Math.tan(38 * Math.PI / 180) * PLAY_DZ; // ~38° — coat and skull, not a map token

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
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // One shadow pass per FRAME, not one per body: the house's light moves
        // slowly and a phone cannot afford eight depth maps to prove it. The
        // stage asks for a fresh map at the top of each frame (beginFrame).
        renderer.shadowMap.autoUpdate = false;
        this.canvas = canvas;
        this.renderer = renderer;

        const scene = new THREE.Scene();
        const stage = new THREE.Group();
        scene.add(stage);
        const hemi = new THREE.HemisphereLight(0x9aaed4, 0x160b12, 1.7);
        scene.add(hemi);
        this.hemi = hemi;
        const key = new THREE.DirectionalLight(0xffdfc2, 2.65);
        key.position.set(-2.2, 3.4, 4.2);
        scene.add(key);
        this.key = key;
        const rim = new THREE.DirectionalLight(0x718fd2, 1.85);
        rim.position.set(2.8, 2.1, -3.5);
        scene.add(rim);

        // ---- the shared space (issue #54 Phase B) ----
        // This scene used to hold nothing but the body: the world was a 2D
        // canvas underneath and the body was stamped onto it, which is why it
        // read as pasted on. The floor and the lamp live in here now, so the
        // body stands ON the floor and drops a real shadow-mapped shadow of
        // its own geometry, from the same light that lights the room.
        //
        // The floor is a shadow catcher and not a textured copy of the 2D
        // world: that world is already painted with its own lamps and its own
        // shadows, and lighting it twice makes both of them wrong. What the
        // scene supplies is the thing the painting cannot — depth, contact,
        // and one light rig shared by the floor and everything standing on it.
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(40, 40),
          new THREE.ShadowMaterial({ color: 0x05070c, opacity: 0.62, transparent: true, depthWrite: false }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        ground.receiveShadow = true;
        ground.renderOrder = -1;
        scene.add(ground);
        this.ground = ground;

        const lamp = new THREE.DirectionalLight(0xffd7a8, 1.35);
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(512, 512);
        const shadowCam = lamp.shadow.camera;
        shadowCam.left = -2.4; shadowCam.right = 2.4;
        shadowCam.top = 2.4; shadowCam.bottom = -2.4;
        shadowCam.near = 0.05; shadowCam.far = 14;
        lamp.shadow.bias = -0.0016;
        lamp.shadow.normalBias = 0.02;
        lamp.shadow.radius = 3;
        lamp.position.set(-1.6, 2.6, 2.2);
        scene.add(lamp);
        scene.add(lamp.target);
        this.lamp = lamp;
        this.rim = rim;
        this._studio = { hemi: 1.7, key: 2.65, rim: 1.85, lamp: 1.35 };

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
        // The character IS this asset. A weak link gets three attempts with
        // backoff before the failure state, and a public retry() after that.
        // A night never blocks on the model — the canvas silhouette stands in.
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
    for (const required of [VALEN_CLIPS.claw, VALEN_CLIPS.run, VALEN_CLIPS.walk, VALEN_CLIPS.shot, VALEN_CLIPS.sword]) {
      if (!names.has(required)) throw new Error(`Valen GLB is missing animation clip "${required}"`);
    }

    this.model = gltf.scene;
    this.model.rotation.order = 'YXZ';
    // Root-motion cancellation moves the model container opposite its bones.
    // Three's static skinned-mesh bounds do not account for that cancellation
    // and can otherwise cull valid later frames of the run clip.
    this.model.traverse((object) => {
      if (object.isSkinnedMesh) object.frustumCulled = false;
      // She is in the room now, so she casts onto it.
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = false; }
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
    for (const name of [VALEN_CLIPS.walk, VALEN_CLIPS.run, VALEN_CLIPS.claw, VALEN_CLIPS.shot, VALEN_CLIPS.sword]) {
      const action = this.mixer.clipAction(this.clips[name]);
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0);
      action.play();
      action.paused = true;
      this.actions[name] = action;
    }

    this.hips = this._rigObject('mixamorig:Hips') || this._rigObject('Hip') || this._rigObject('Pelvis');
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
   * Portrait is the menu hero. Play is the same standing 3/4, pitched nearer
   * 38° so the coat reads in a night. Overhead remains only as the old token
   * path. The world plane is oblique; the sprite is stood up by upright().
   */
  _applyCamera(view) {
    const b = this.bounds;
    if (!b || !this.camera) return;
    const aspect = this.canvas.width / this.canvas.height;
    let verticalSpan = 1;
    if (view === 'overhead') {
      this._frameHead();
    } else if (view === 'play') {
      // Room under the feet: the body drops a real shadow on the shared floor
      // now, and a frame that ends at the ankle cuts it off with a straight
      // edge. The span is wider and the eye sits lower to make space; draw()
      // puts the size back, so she is still the height she is tuned to be.
      verticalSpan = Math.max(1.35, b.size.y * 1.55);
      const halfHeight = verticalSpan / 2;
      const halfWidth = halfHeight * aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      const lookY = b.min.y + b.size.y * 0.4;
      this.camera.position.set(b.center.x, lookY + PLAY_DY, PLAY_DZ);
      this.camera.lookAt(b.center.x, lookY, 0);
    } else {
      verticalSpan = Math.max(1.12, b.size.y * 1.14);
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
    // How much of the frame the body fills, so draw() can size the BODY to the
    // height the game asks for instead of sizing the frame (which now holds a
    // floor and a shadow as well as her).
    this._fill = view === 'overhead' ? 1 : Math.min(1, b.size.y / verticalSpan);
  }

  /** Top-down token: crown, face, and the shoulders. Not the coat, not the boots. */
  _frameHead() {
    const head = this._rigObject('mixamorig:Head') || this._rigObject('Head');
    const neck = this._rigObject('mixamorig:Neck') || this._rigObject('NeckTwist01');
    const top = this._rigObject('mixamorig:HeadTop_End') || head;
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
  /**
   * Point the shared rig at the house's own light for one body standing at a
   * world point. `world` is { x, y, light } where light comes from
   * renderer.keyLightAt(x, y) — the lamp that lights this patch of floor is
   * the lamp that lights the body standing on it. No world means the menu /
   * shop / intro, which keep the studio rig they always had.
   */
  /** Top of frame: the next body to be placed may refresh the shadow map. */
  beginFrame() {
    this._shadowSpent = false;
  }

  /**
   * The room shares this scene (#54) so a body stands on the real floor and
   * throws a real shadow across it. It must NOT share the PORTRAIT.
   *
   * A frame that also carries the house arrives on the 2D canvas inside a
   * solid rectangle — the same disease the old floor plate had, and the same
   * reason it was taken out: under a lamp she was a lit card, in the dark she
   * was a hole. The room keeps its own pass, its own camera and its own
   * shadows; the sitter is photographed alone, on transparency.
   */
  soloPass(fn) {
    const hidden = [];
    for (const child of this.scene.children) {
      if (child === this.stage || child.isLight) continue;
      if (child.visible) { child.visible = false; hidden.push(child); }
    }
    try {
      return fn();
    } finally {
      for (const c of hidden) c.visible = true;
    }
  }

  /** The plate, the intro and the shop: the studio rig, and no floor. */
  _applyStudioRig() {
    const lamp = this.lamp;
    if (!lamp) return;
    const s0 = this._studio || { hemi: 1.7, key: 2.65, rim: 1.85, lamp: 1.35 };
    lamp.position.set(-1.6, 2.6, 2.2);
    lamp.target.position.set(0, 0, 0);
    lamp.target.updateMatrixWorld();
    lamp.intensity = s0.lamp;
    lamp.color.setRGB(1, 0.843, 0.658);
    if (this.hemi) this.hemi.intensity = s0.hemi;
    if (this.key) this.key.intensity = s0.key;
    if (this.rim) this.rim.intensity = s0.rim;
    if (this.ground) this.ground.visible = false;
  }

  _applyRig(world) {
    const lamp = this.lamp;
    if (!lamp) return;
    if (!world) { this._applyStudioRig(); return; }
    const l = world.light || { dx: -0.45, dy: -0.9, level: 0.3, color: [150, 172, 214] };
    // A lamp close by sits low and throws a long shadow; moonlight from a
    // window is high and cold, and barely casts at all.
    // Ceiling height, not table height: a mansion hangs its light from above,
    // and a high lamp throws the short compact shadow that reads as CONTACT.
    // A low lamp throws a three-metre shadow straight off the edge of the
    // sprite, which is the opposite of grounded.
    const height = 4.4 + 1.8 * (1 - clamp01(l.level));
    const reach = 2.8;
    lamp.position.set(l.dx * reach, height, -l.dy * reach);
    lamp.target.position.set(0, 0, 0);
    lamp.target.updateMatrixWorld();
    // The light's DIRECTION is the house's for this frame — one body sets it
    // and the rest of the room agrees, which is also what makes the floor and
    // everything standing on it look lit by the same lamp. How much of it
    // reaches each body is still that body's own business.
    if (!this._shadowSpent) {
      this._shadowSpent = true;
      lamp.shadow.needsUpdate = true;
    }
    const level = clamp01(l.level);
    lamp.intensity = 0.34 + level * 1.6;
    const c = l.color || [255, 186, 120];
    lamp.color.setRGB(clamp01(c[0] / 255 * 1.15), clamp01(c[1] / 255 * 1.05), clamp01(c[2] / 255 * 1.05));
    // A dark corner dims the body the same way the painted floor dims: the
    // rig is the house's, so the two can never disagree about the light.
    if (this.hemi) this.hemi.intensity = 0.55 + level * 1.15;
    if (this.key) this.key.intensity = 0.75 + level * 1.95;
    if (this.rim) this.rim.intensity = 0.5 + level * 1.4;
    // No floor plate in the character pass. The plane was a shadow catcher
    // filling the whole billboard, and ShadowMaterial painted every pixel it
    // covered — including the ones no shadow reached — so each body arrived
    // on the 2D canvas inside a black RECTANGLE rather than a silhouette.
    // Under a lamp it was a dark box round her; in the dark it was a hole.
    // The body still takes the house's light and rim from the rig above; what
    // it no longer carries is its own floor. Weight under the feet is the
    // painted smudge in player.js, and the floor she stands on is drawn by
    // the room (envkit), which is where a floor belongs.
    if (this.ground) this.ground.visible = false;
  }

  render({ state = 'idle', angle = Math.PI / 2, speed = 0, stepPhase = 0, attackProgress = 0, view = 'portrait', weapon = 'claw', world = null } = {}) {
    if (!this.ready || !this.renderer || !this.model || !this.mixer) return null;
    this._applyCamera(view);
    const full3D = !!(world && world.full3D);
    if (!full3D) this._applyRig(world);
    else this.model.scale.set(1, 1, 1);

    const attacking = state === 'attack';
    const locomotion = attacking ? 0 : smoothstep(4, 24, speed);
    const runBlend = smoothstep(140, 180, speed);  // v1.2: match state threshold (160) + walk/run speeds (122/196)
    const walkWeight = locomotion * (1 - runBlend);
    const runWeight = locomotion * runBlend;
    const phase = wrap01(stepPhase / (Math.PI * 2));

    const walkAction = this.actions[VALEN_CLIPS.walk];
    const runAction = this.actions[VALEN_CLIPS.run];
    const attackName = VALEN_CLIPS[weapon] || VALEN_CLIPS.attack;
    walkAction.setEffectiveWeight(walkWeight);
    runAction.setEffectiveWeight(runWeight);
    walkAction.time = phase * this.clips[VALEN_CLIPS.walk].duration;
    runAction.time = phase * this.clips[VALEN_CLIPS.run].duration;
    for (const name of [VALEN_CLIPS.claw, VALEN_CLIPS.shot, VALEN_CLIPS.sword]) {
      const action = this.actions[name];
      const on = attacking && name === attackName;
      action.setEffectiveWeight(on ? 1 : 0);
      if (on) action.time = clamp01(attackProgress) * this.clips[name].duration;
    }
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
    // Overhead tips the rig so only the skull shows. Play and the menu stay
    // standing — yaw only — or a 3/4 body lies down on the floor plane.
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
    if (full3D) {
      // Place the animated GLB directly in the mansion's world scene. The
      // previous path rendered it to a tiny transparent canvas and stamped
      // that image onto a 2D floor; full3D keeps the skinned mesh, depth and
      // shadows in the shared WebGL scene instead.
      const sourceHeight = this.bounds && this.bounds.size ? this.bounds.size.y : 1;
      const scale = (world.heightPx || sourceHeight) / Math.max(0.001, sourceHeight);
      this.model.scale.setScalar(scale);
      this.model.position.set(
        world.x - rootX * scale,
        (world.floorY || 0) - ((this.bounds && this.bounds.min.y) || 0) * scale,
        world.y - rootZ * scale,
      );
      this.model.visible = world.visible !== false;
      this.model.updateMatrixWorld(true);
      return null;
    }
    if (view === 'overhead') this._frameHead();
    this.renderer.toneMappingExposure = view === 'overhead' ? 1.9 : view === 'play' ? 1.55 : 1.18;
    this.renderer.clear();
    // The house stood in this frame and filled it: every billboard cut from
    // it — hers and every enemy's — landed on the world as an opaque card.
    this.soloPass(() => this.renderer.render(this.scene, this.camera));
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
   * The sitter's own bounds inside the frame, in canvas pixels — the pixels
   * that are HER, not the photograph around her.
   *
   * The alpha scan is what the eye measures. The model's projected box is the
   * fallback and it runs a fifth too big, because a skinned mesh's bounds are
   * its bind pose: sizing her by it drew a 72-unit body at 60.
   */
  _bodyBox(canvas) {
    // Her body and each dash ghost ask for this in the same frame, off the
    // same frame: measure every fourth ask and hand the rest the answer.
    const ask = (this._boxAsk = (this._boxAsk || 0) + 1);
    if (this._boxCache && ask % 4 !== 0) return this._boxCache;
    const scan = this._opaqueBox(canvas);
    if (scan && scan.h > 8 && scan.w > 4) { this._boxCache = scan; return scan; }
    if (!this.model || !this.camera || !canvas) return null;
    if (!this._box3) this._box3 = new THREE.Box3();
    const box = this._box3.setFromObject(this.model);
    if (!box || box.isEmpty() || !isFinite(box.min.y)) return null;
    const v = this._vec3 || (this._vec3 = new THREE.Vector3());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(this.camera);
      const px = (v.x * 0.5 + 0.5) * canvas.width;
      const py = (1 - (v.y * 0.5 + 0.5)) * canvas.height;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (maxX - minX < 2 || maxY - minY < 2) return null;
    const pad = 2;
    const found = {
      x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
      w: Math.min(canvas.width, maxX + pad) - Math.max(0, minX - pad),
      h: Math.min(canvas.height, maxY + pad) - Math.max(0, minY - pad),
    };
    this._boxCache = found;
    return found;
  }

  /**
   * The body's own pixels in a rendered frame: every opaque pixel, bounded.
   * Sampled every other pixel — a full read of a 288x320 frame each time she
   * is drawn is a scan, not a measurement.
   */
  _opaqueBox(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const w = canvas.width, h = canvas.height;
    if (!this._scan || this._scan.width !== w || this._scan.height !== h) {
      this._scan = document.createElement('canvas');
      this._scan.width = w;
      this._scan.height = h;
      this._scanCtx = this._scan.getContext('2d', { willReadFrequently: true });
    }
    if (!this._scanCtx) return null;
    this._scanCtx.clearRect(0, 0, w, h);
    this._scanCtx.drawImage(canvas, 0, 0);
    let data;
    try {
      data = this._scanCtx.getImageData(0, 0, w, h).data;
    } catch (error) {
      return null;
    }
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (data[(y * w + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null;
    const pad = 2;
    return {
      x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
      w: Math.min(w, maxX + pad) - Math.max(0, minX - pad),
      h: Math.min(h, maxY + pad) - Math.max(0, minY - pad),
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

  draw(ctx, canvas, height, { alpha = 1, footInset = 7, anchor = 'feet', head = null, drop = 0, stand = false } = {}) {
    if (!canvas) return false;
    // `stand`: `height` is the BODY's height on screen, not the frame's. The
    // play frame is a photograph with air around the sitter — headroom above
    // her and floor in front of her — so sizing the FRAME to 72 drew a body
    // of 46. Measure the body instead, and put its feet on the tile.
    if (stand) {
      const box = this._bodyBox(canvas);
      if (box) {
        const scale = height / Math.max(1, box.h);
        const dw = canvas.width * scale;
        const dh = canvas.height * scale;
        ctx.save();
        ctx.globalAlpha *= alpha;
        // her feet, not the frame's bottom edge, sit on the anchor
        ctx.drawImage(canvas,
          -(box.x + box.w / 2) * scale,
          -(box.y + box.h) * scale + drop,
          dw, dh);
        ctx.restore();
        return true;
      }
    }
    const frameHeight = stand ? height / Math.max(0.25, this._fill || 1) : height;
    const width = frameHeight * (canvas.width / canvas.height);
    let x = -width / 2;
    let y = -frameHeight + footInset;
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
