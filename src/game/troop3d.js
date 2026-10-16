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
 *     crossbow on the right hand slot (1H_Ranged_Aiming / _Shoot);
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
    const clip = this.clips.get(TROOP_CLIPS[name] || name);
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

  /** A red flash on the body while `amount` (0..1) is up. */
  flash(amount) {
    const k = Math.max(0, Math.min(1, amount || 0));
    if (Math.abs(k - this._flash) < 0.02) return;
    this._flash = k;
    for (const material of this.materials) {
      if (!material.emissive) continue;
      material.emissive.setRGB(0.95 * k, 0.16 * k, 0.12 * k);
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
    let knight = null, bow = null, bowSettled = false;
    const settle = () => {
      if (!knight || !bowSettled) return;
      try { this._accept(knight, bow); } catch (error) { this._fail(error); }
    };
    loader.load(TROOP_ASSETS.knight, (gltf) => { knight = gltf; settle(); }, undefined, (error) => this._fail(error));
    // the crossbow is a dressing: without it a guard still stands, shield up
    loader.load(TROOP_ASSETS.crossbow, (gltf) => { bow = gltf; bowSettled = true; settle(); }, undefined, () => { bowSettled = true; settle(); });
  }

  _fail(error) {
    this.failed = true;
    this.ready = false;
    this.error = String(error && error.message || error);
  }

  _accept(knight, bow) {
    for (const clip of knight.animations || []) this.clips.set(clip.name, clip);
    const missing = Object.values(TROOP_CLIPS).filter((name) => !this.clips.has(name));
    if (missing.length) throw new Error(`troop clips missing: ${missing.join(', ')}`);
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
  make(kind, heightPx) {
    if (!this.ready) return null;
    const loadout = TROOP_LOADOUTS[kind] || TROOP_LOADOUTS.soldier;
    const model = cloneRig(this.template);
    model.visible = true;
    model.name = `troop-3d-${kind}`;
    model.traverse((object) => {
      if (WEAPON_NODES.includes(object.name)) object.visible = loadout.show.includes(object.name);
    });
    if (loadout.right === 'crossbow' && this.crossbow) {
      const slot = model.getObjectByName('handslot.r');
      if (slot) {
        const bow = this.crossbow.clone(true);
        bow.name = 'troop-crossbow';
        slot.add(bow);
      }
    }
    this._dressHelmet(model);
    const scale = heightPx / Math.max(0.01, this.height);
    model.scale.setScalar(scale);
    this.made++;
    const rig = new TroopRig(model, this.clips, kind);
    rig.loop('idle', 0);
    rig.update(0);
    return rig;
  }
}

export const Troop3D = new TroopStage();
