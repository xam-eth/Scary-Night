/**
 * THE GARRISON IN 3D — Survival's door guards and the relief column.
 *
 * Until 2026-10-16 the guards were primitive figures (a cylinder, a sphere,
 * two boxes and a stick for a bow) and the relief was instanced spearmen of
 * the same kind: placeholders next to a GLB captain and GLB monsters
 * (playtest: "pasukan nya masih place holder juga bukan glb visual yg
 * benar"). They are now KayKit's Knight (Adventurers Character Pack 1.0,
 * CC0, assets/troops/kaykit/CREDITS.txt), the same author as the fortress'
 * environment kit:
 *   - a door guard keeps the round shield and gets the pack's one-handed
 *     crossbow on the right hand slot (1H_Ranged_Aiming / _Shoot); the
 *     garrison's arms level (BUILD 14, survival.js SURVIVAL_ARMS) changes
 *     the bow: Lv2 the same crossbow lacquered royal blue with bright steel,
 *     Lv3 the pack's two-handed crossbow as a blue-and-gold arbalest held in
 *     both hands (2H_Ranged_Aiming / _Shoot; the shield is put away);
 *   - a relief soldier keeps the one-handed sword and the badge shield;
 *   - the banner-bearer keeps the shield and carries the keep's swallowtail.
 * Source bytes are kept unchanged; weapons the loadout does not use are
 * hidden on the clone and only this runtime map picks the actions.
 *
 * One fetch and one parse per file; every troop is a cloneRig() of the
 * template (shared geometry, own skeleton, own materials so a hurt flash
 * stays on one body) with its own AnimationMixer. Until the files arrive —
 * or if they fail — world3d keeps the primitive figure, so the guards never
 * vanish.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { cloneRig } from './enemy3d.js';

export const TROOP_ASSETS = Object.freeze({
  knight: 'assets/troops/kaykit/Knight.glb',
  crossbow: 'assets/troops/kaykit/crossbow_1handed.gltf',
  arbalest: 'assets/troops/kaykit/crossbow_2handed.gltf',
});

/** Runtime clip map (the GLB carries 76 clips; these are the ones used). */
export const TROOP_CLIPS = Object.freeze({
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  aim: '1H_Ranged_Aiming',
  shoot: '1H_Ranged_Shoot',
  hit: 'Hit_A',
  down: 'Lie_Down',
  lie: 'Lie_Idle',
  up: 'Lie_StandUp',
  cheer: 'Cheer',
});

/** The two-handed clips a Lv3 guard aims and shoots the arbalest with. */
export const TROOP_CLIPS_2H = Object.freeze({ aim: '2H_Ranged_Aiming', shoot: '2H_Ranged_Shoot' });

/**
 * BUILD 14: the garrison's crossbow per arms level. `paint` repaints the
 * crossbow atlas (rogue_texture.png, a palette of gradient swatches) on a
 * canvas copy: the stock's two wood swatches and the steel swatch get the
 * level's colours; `glow` is how much the bow lights itself at night (its
 * own colours as emissive) so the upgrade reads across the bailey.
 */
export const TROOP_BOWS = Object.freeze({
  1: Object.freeze({ model: 'crossbow', paint: null, scale: 1, glow: 0, twoHanded: false }),
  2: Object.freeze({ model: 'crossbow', paint: 'blue', scale: 1.3, glow: 0.22, twoHanded: false }),
  3: Object.freeze({ model: 'arbalest', paint: 'gold', scale: 1.24, glow: 0.38, twoHanded: true }),
});

/**
 * Where the crossbows' swatches sit in the atlas (u, v from the top left, in
 * eighths across and quarters down; both glTFs sample only these four).
 */
const BOW_SWATCHES = Object.freeze({
  wood: Object.freeze([[5, 1], [6, 1]]),
  steel: Object.freeze([[3, 1]]),
  string: Object.freeze([[0, 2]]),
});
const BOW_PAINTS = Object.freeze({
  // Lv2: royal-blue lacquered stock, bright cool steel
  blue: Object.freeze({ wood: [0.2, 0.38, 0.92], steel: [0.86, 0.9, 0.98], string: null }),
  // Lv3: deep royal blue with gold fittings and an ivory string
  gold: Object.freeze({ wood: [0.16, 0.3, 0.86], steel: [1.0, 0.78, 0.22], string: [1.0, 0.96, 0.86] }),
});

/**
 * A canvas copy of the crossbow atlas with the level's colours. Each swatch
 * keeps its own light-to-dark gradient (and the lit stripe on its edge): a
 * pixel's brightness relative to its swatch's mean scales the new colour.
 * The vendored PNG is untouched.
 */
export function paintBowAtlas(texture, paint) {
  const image = texture && texture.image;
  const scheme = BOW_PAINTS[paint];
  if (!image || !scheme || typeof document === 'undefined' || !(image.width > 0)) return null;
  const w = image.width, h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const sw = w / 8, sh = h / 4;
  let changed = 0;
  for (const [part, cells] of Object.entries(BOW_SWATCHES)) {
    const colour = scheme[part];
    if (!colour) continue;
    for (const [cx, cy] of cells) {
      const x0 = Math.round(cx * sw), y0 = Math.round(cy * sh);
      const data = ctx.getImageData(x0, y0, Math.round(sw), Math.round(sh));
      const d = data.data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const mean = Math.max(1, sum / (d.length / 4));
      for (let i = 0; i < d.length; i += 4) {
        const k = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / mean;
        d[i] = Math.min(255, Math.round(colour[0] * 255 * k));
        d[i + 1] = Math.min(255, Math.round(colour[1] * 255 * k));
        d[i + 2] = Math.min(255, Math.round(colour[2] * 255 * k));
      }
      ctx.putImageData(data, x0, y0);
      changed++;
    }
  }
  if (!changed) return null;
  const out = new THREE.CanvasTexture(canvas);
  for (const key of ['flipY', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'generateMipmaps', 'anisotropy', 'colorSpace', 'channel']) {
    if (texture[key] !== undefined) out[key] = texture[key];
  }
  out.name = `${texture.name || 'rogue_texture'}-${paint}`;
  out.needsUpdate = true;
  return out;
}

/**
 * The right hand slot the crossbow mounts on. GLTFLoader sanitises node
 * names for animation bindings (PropertyBinding drops the '.'), so the GLB's
 * "handslot.r" is "handslotr" on the loaded scene: looked up under that name
 * the bow was never found and the guards shot from an empty hand until
 * BUILD 14.
 */
const HAND_SLOT_R = THREE.PropertyBinding.sanitizeNodeName('handslot.r');

/** Every weapon mesh in Knight.glb; a loadout shows a subset. */
const WEAPON_NODES = Object.freeze(['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword']);
export const TROOP_LOADOUTS = Object.freeze({
  guard: Object.freeze({ show: Object.freeze(['Round_Shield']), right: 'crossbow' }),
  soldier: Object.freeze({ show: Object.freeze(['1H_Sword', 'Badge_Shield']), right: null }),
  bearer: Object.freeze({ show: Object.freeze(['Badge_Shield']), right: null }),
});

/**
 * The Knight's cape and tabard are red in the pack's atlas, which on a dark
 * field reads as the horde's colour. The garrison wears the keep's royal blue
 * (the HUD's guard icon, the guard rings, the banner): a runtime copy of the
 * atlas turns only the saturated reds (hue >= 340 or <= 6, saturation >= 0.5;
 * skin and leather sit at 10-30) to hue 222. The GLB's own bytes and texture
 * are untouched.
 */
export function blueLivery(texture) {
  const image = texture && texture.image;
  if (!image || typeof document === 'undefined' || !(image.width > 0)) return null;
  const w = image.width, h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const span = max - min;
    if (span < 0.2 || max !== r) continue;
    const l = (max + min) / 2;
    const s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
    const hue = ((g - b) / span + (g < b ? 6 : 0)) * 60;
    if (s < 0.5 || !(hue >= 340 || hue <= 6)) continue;
    const L = Math.min(0.9, l * 1.04), S = Math.min(1, s * 0.95), H = 222 / 360;
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const p = 2 * L - q;
    d[i] = Math.round(hue2rgb(p, q, H + 1 / 3) * 255);
    d[i + 1] = Math.round(hue2rgb(p, q, H) * 255);
    d[i + 2] = Math.round(hue2rgb(p, q, H - 1 / 3) * 255);
    changed++;
  }
  if (!changed) return null;
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  for (const key of ['flipY', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'generateMipmaps', 'anisotropy', 'colorSpace', 'channel']) {
    if (texture[key] !== undefined) out[key] = texture[key];
  }
  out.name = `${texture.name || 'knight_texture'}-royal-blue`;
  out.needsUpdate = true;
  return out;
}

/** One troop's skinned body, its mixer and a tiny clip state machine. */
export class TroopRig {
  constructor(model, clips, kind) {
    this.model = model;
    this.kind = kind;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    this.base = null;        // the looping clip name
    this.once = null;        // a one-shot playing over it: { name, action, then }
    this.state = 'none';     // what QA and the sync read: the clip in front
    this.materials = [];
    model.traverse((object) => {
      if (!object.isMesh) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material && !this.materials.includes(material)) this.materials.push(material);
    });
    this._flash = 0;
  }

  action(name) {
    let action = this.actions.get(name);
    if (action) return action;
    const clip = this.clips.get((this.clipMap && this.clipMap[name]) || TROOP_CLIPS[name] || name);
    if (!clip) return null;
    action = this.mixer.clipAction(clip);
    this.actions.set(name, action);
    return action;
  }

  /** Switch the looping clip (cross-faded). */
  loop(name, fade = 0.2, timeScale = 1) {
    const next = this.action(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.base === name) return;
    const prev = this.base ? this.action(this.base) : null;
    this.base = name;
    if (this.once) return; // the one-shot hands over to it when it ends
    next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.state = name;
  }

  /** Play a clip once over the loop, then hand back (or go on to `then`). */
  play(name, { fade = 0.08, then = null, timeScale = 1 } = {}) {
    const action = this.action(name);
    if (!action) return;
    const front = this.once ? this.once.action : (this.base ? this.action(this.base) : null);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    action.setEffectiveWeight(1).fadeIn(fade).play();
    if (front && front !== action) front.fadeOut(fade);
    this.once = { name, action, then };
    this.state = name;
  }

  playing(name) { return this.state === name; }

  /**
   * Swap the clips behind some names (BUILD 14: a Lv3 guard aims and shoots
   * two-handed). A name whose clip changes is stopped and rebuilt; if it is
   * the loop in front, the new clip takes over at once.
   */
  setClipMap(map) {
    const before = this.clipMap || {};
    const after = map || {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if ((before[name] || null) === (after[name] || null)) continue;
      const action = this.actions.get(name);
      if (!action) continue;
      action.stop();
      this.actions.delete(name);
    }
    this.clipMap = map ? { ...map } : null;
    const base = this.base;
    if (base && !this.once && (before[base] || null) !== (after[base] || null)) {
      this.base = null;
      this.loop(base, 0.1);
    }
  }

  update(dt) {
    const once = this.once;
    if (once) {
      const duration = once.action.getClip().duration;
      if (once.action.time >= duration - 0.12 || !once.action.isRunning()) {
        this.once = null;
        if (once.then) {
          const then = once.then;
          this.base = null;
          this.loop(then, 0.12);
        } else if (this.base) {
          const base = this.action(this.base);
          base.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.15).play();
          once.action.fadeOut(0.15);
          this.state = this.base;
        }
      }
    }
    this.mixer.update(dt);
  }

  /**
   * A red flash on the body while `amount` (0..1) is up. A material's own
   * glow (a painted Lv2/Lv3 bow lights itself) is what it fades back to.
   */
  flash(amount) {
    const k = Math.max(0, Math.min(1, amount || 0));
    if (Math.abs(k - this._flash) < 0.02) return;
    this._flash = k;
    for (const material of this.materials) {
      if (!material.emissive) continue;
      const ud = material.userData || (material.userData = {});
      if (!ud.troopGlow) {
        const i = material.emissiveIntensity == null ? 1 : material.emissiveIntensity;
        ud.troopGlow = { r: material.emissive.r * i, g: material.emissive.g * i, b: material.emissive.b * i };
      }
      const base = ud.troopGlow;
      material.emissive.setRGB(base.r * (1 - k) + 0.95 * k, base.g * (1 - k) + 0.16 * k, base.b * (1 - k) + 0.12 * k);
      material.emissiveIntensity = 1;
    }
  }
}

class TroopStage {
  constructor() {
    this.started = false;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.template = null;
    this.crossbow = null;
    this.arbalest = null;
    this.bows = new Map();   // arms level -> { model, material } (BUILD 14)
    this.twoHanded = false;  // the Knight carries the 2H ranged clips
    this.clips = new Map();
    this.height = 1;       // the template's standing height, model units
    this.made = 0;
    this.livery = 0;
  }

  /** Start both fetches (idempotent). Safe without a DOM (node QA): no-op. */
  init() {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    const loader = new GLTFLoader();
    let knight = null, bow = null, bowSettled = false, big = null, bigSettled = false;
    const settle = () => {
      if (!knight || !bowSettled || !bigSettled) return;
      try { this._accept(knight, bow, big); } catch (error) { this._fail(error); }
    };
    loader.load(TROOP_ASSETS.knight, (gltf) => { knight = gltf; settle(); }, undefined, (error) => this._fail(error));
    // the crossbows are a dressing: without them a guard still stands, shield
    // up (and without the arbalest a Lv3 guard keeps the painted 1H bow)
    loader.load(TROOP_ASSETS.crossbow, (gltf) => { bow = gltf; bowSettled = true; settle(); }, undefined, () => { bowSettled = true; settle(); });
    loader.load(TROOP_ASSETS.arbalest, (gltf) => { big = gltf; bigSettled = true; settle(); }, undefined, () => { bigSettled = true; settle(); });
  }

  _fail(error) {
    this.failed = true;
    this.ready = false;
    this.error = String(error && error.message || error);
  }

  _accept(knight, bow, big = null) {
    for (const clip of knight.animations || []) this.clips.set(clip.name, clip);
    const missing = Object.values(TROOP_CLIPS).filter((name) => !this.clips.has(name));
    if (missing.length) throw new Error(`troop clips missing: ${missing.join(', ')}`);
    this.twoHanded = Object.values(TROOP_CLIPS_2H).every((name) => this.clips.has(name));
    this.template = knight.scene;
    const livery = new Map();
    this.template.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = false;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material || !material.map) continue;
        if (!livery.has(material.map)) livery.set(material.map, blueLivery(material.map));
        const blue = livery.get(material.map);
        if (blue) { material.map = blue; material.needsUpdate = true; }
      }
    });
    this.livery = [...livery.values()].filter(Boolean).length;
    if (bow && bow.scene) {
      this.crossbow = bow.scene;
      this.crossbow.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    }
    if (big && big.scene) {
      this.arbalest = big.scene;
      this.arbalest.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    }
    // standing height in the Idle pose, so a troop is scaled to world px
    const probe = cloneRig(this.template);
    probe.visible = true;
    const mixer = new THREE.AnimationMixer(probe);
    mixer.clipAction(this.clips.get(TROOP_CLIPS.idle)).play();
    mixer.update(0);
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(probe, true);
    const size = new THREE.Vector3();
    box.getSize(size);
    this.height = size.y > 0.01 ? size.y : 2.4;
    this.ready = true;
  }

  /**
   * The Knight's bucket helmet is the biggest thing on him from this camera
   * (it looks down at 35°): plain steel, the garrison read as grey eggs from
   * across the bailey (2026-10-17). Each troop's helmet is tinted the keep's
   * royal blue and gets a gold crest, so a guard reads as OUR soldier at a
   * glance and never as a placeholder. A runtime material on the clone; the
   * GLB's bytes are untouched.
   */
  _dressHelmet(model) {
    const helmet = model.getObjectByName('Knight_Helmet');
    if (!helmet || !helmet.isMesh) return;
    const base = Array.isArray(helmet.material) ? helmet.material[0] : helmet.material;
    if (base && base.clone) {
      const steel = base.clone();
      steel.color = new THREE.Color(0.42, 0.6, 1.0);
      steel.name = 'knight-helmet-royal-blue';
      helmet.material = steel;
    }
    const geo = helmet.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    const size = new THREE.Vector3();
    const mid = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(mid);
    if (!this._crestMat) {
      this._crestMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x8a5a00, emissiveIntensity: 0.45, roughness: 0.55, metalness: 0.2, flatShading: true });
    }
    // a half-disc fin from brow to nape (the helmet's +y is up, +z its
    // front); its own material, so a hurt flash reddens this troop's crest
    // and not every crest
    const R = size.z * 0.34, T = size.x * 0.12;
    const fin = new THREE.CylinderGeometry(R, R, T, 14, 1, false, 0, Math.PI);
    fin.rotateZ(Math.PI / 2);
    const crest = new THREE.Mesh(fin, this._crestMat.clone());
    crest.name = 'knight-crest';
    crest.position.set(mid.x, box.max.y - R * 0.3, mid.z - size.z * 0.05);
    crest.castShadow = true;
    helmet.add(crest);
  }

  /**
   * A new troop: `kind` is a TROOP_LOADOUTS key. Returns a TroopRig whose
   * `model` stands on y = 0 and is `heightPx` world px tall.
   */
  make(kind, heightPx, { arms = 1 } = {}) {
    if (!this.ready) return null;
    const loadout = TROOP_LOADOUTS[kind] || TROOP_LOADOUTS.soldier;
    const model = cloneRig(this.template);
    model.visible = true;
    model.name = `troop-3d-${kind}`;
    model.traverse((object) => {
      if (WEAPON_NODES.includes(object.name)) object.visible = loadout.show.includes(object.name);
    });
    this._dressHelmet(model);
    const scale = heightPx / Math.max(0.01, this.height);
    model.scale.setScalar(scale);
    this.made++;
    const rig = new TroopRig(model, this.clips, kind);
    rig.loadout = loadout;
    if (loadout.right === 'crossbow') this.arm(rig, arms);
    rig.loop('idle', 0);
    rig.update(0);
    return rig;
  }

  /**
   * The crossbow for an arms level (BUILD 14): the model and its painted
   * material, made once per level. Null before the files arrive.
   */
  bow(level = 1) {
    const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
    if (this.bows.has(lv)) return this.bows.get(lv);
    const spec = TROOP_BOWS[lv];
    const source = (spec.model === 'arbalest' && this.arbalest) || this.crossbow;
    if (!source) return null;
    const model = source.clone(true);
    let material = null;
    model.traverse((object) => {
      if (!object.isMesh) return;
      const base = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!material) {
        material = base && base.clone ? base.clone() : new THREE.MeshStandardMaterial({ color: 0x8a6a48 });
        const painted = spec.paint && base && base.map ? paintBowAtlas(base.map, spec.paint) : null;
        if (painted) {
          material.map = painted;
          if (spec.glow > 0 && material.emissive) {
            material.emissiveMap = painted;
            material.emissive = new THREE.Color(1, 1, 1);
            material.emissiveIntensity = spec.glow;
          }
        }
        material.name = `troop-crossbow-lv${lv}`;
        material.needsUpdate = true;
      }
      object.material = material;
    });
    const rec = { level: lv, model, material, spec, twoHanded: spec.twoHanded && source === this.arbalest && this.twoHanded };
    this.bows.set(lv, rec);
    return rec;
  }

  /**
   * Put the arms level's crossbow in a guard's right hand (BUILD 14). Its
   * own material copy, so a hurt flash reddens this guard's bow only. A Lv3
   * arbalest is held two-handed (the round shield is put away). Returns
   * true when the bow changed.
   */
  arm(rig, level = 1) {
    if (!rig || !this.ready) return false;
    const lv = Math.max(1, Math.min(3, Math.round(level) || 1));
    if (rig.armsLevel === lv) return false;
    const rec = this.bow(lv);
    const slot = rig.model.getObjectByName(HAND_SLOT_R) || rig.model.getObjectByName('handslot.r');
    if (!rec || !slot) return false;
    const old = slot.getObjectByName('troop-crossbow');
    if (old) {
      slot.remove(old);
      old.traverse((object) => {
        if (!object.isMesh) return;
        rig.materials = rig.materials.filter((m) => m !== object.material);
        if (object.material && object.material.dispose) object.material.dispose();
      });
    }
    const bow = rec.model.clone(true);
    bow.name = 'troop-crossbow';
    bow.scale.multiplyScalar(rec.spec.scale || 1);
    const own = rec.material.clone();
    bow.traverse((object) => { if (object.isMesh) { object.material = own; object.castShadow = true; } });
    rig.materials.push(own);
    slot.add(bow);
    const shield = rig.model.getObjectByName('Round_Shield');
    const shows = rig.loadout ? rig.loadout.show.includes('Round_Shield') : true;
    if (shield) shield.visible = shows && !rec.twoHanded;
    rig.setClipMap(rec.twoHanded ? TROOP_CLIPS_2H : null);
    rig.armsLevel = lv;
    rig.twoHanded = !!rec.twoHanded;
    rig._flash = -1;   // re-apply the flash state to the new material
    return true;
  }
}

export const Troop3D = new TroopStage();
