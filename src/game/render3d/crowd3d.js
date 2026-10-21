/**
 * THE HORDE IN 3D — every swarm body is an animated GLB monster.
 *
 * Until 2026-10-17 only the 14 bodies nearest the captain wore a skinned
 * GLB rig (Enemy3D's budget); the rest of a 20–30 body wave was drawn as
 * primitive figures — a cylinder, a sphere, two sticks and two yellow
 * eyes. On the screen that read as placeholders next to GLB monsters
 * (playtest: "pasukan nya masih place holder juga bukan glb visual yg
 * benar", repeated 2026-10-17).
 *
 * Skinning 90 bodies on a cheap phone is out of budget, so the horde is
 * drawn the way crowd games draw crowds: VERTEX ANIMATION TEXTURES. At
 * load, each monster's source clips (walk, attack, death, hit) are
 * played on a private clone of its rig and every vertex is written, frame
 * by frame, into a half-float texture — positions in one, normals in
 * another. One InstancedMesh per monster then draws every body of that
 * kind in a single call: the vertex shader reads its pose from the texture
 * by (frame, vertex), blending two frames, and a per-body attribute picks
 * the frame and drives a white hit flash. The source GLB bytes are not
 * touched; the textures are made in memory from the same files the rigs
 * use (assets/monsters/ultimate, CC0, CREDITS.txt).
 *
 * Kinds: the demon (Enemy3D's 'zombie' role) carries most of the horde,
 * with the green spiky blob ('crawler') and the ghost skull ('ghoul') in
 * its ranks, picked per body by id so a body keeps its kind. A body that
 * dies plays the source Death clip, then sinks into the ground.
 */
import * as THREE from '../../vendor/three/three.module.min.js';
import { Enemy3D, ENEMY_MODELS, cloneRig, HORDE_EYE, hordeGradeMaterial, hordeGlowFor } from './enemy3d.js';

/** Which rigs the horde is made of, and how much of it each one is (%). */
export const CROWD_KINDS = Object.freeze([
  Object.freeze({ key: 'zombie', share: 58, height: 76, hover: 0 }),
  Object.freeze({ key: 'crawler', share: 26, height: 58, hover: 0 }),
  Object.freeze({ key: 'ghoul', share: 16, height: 72, hover: 10 }),
]);
/** Clips baked per kind (names resolve through ENEMY_MODELS[key].map). */
const BAKE = Object.freeze([
  Object.freeze({ name: 'walk', loop: true }),
  Object.freeze({ name: 'attack', loop: true }),
  Object.freeze({ name: 'hurt', loop: false }),
  Object.freeze({ name: 'die', loop: false }),
]);
/* 20 frames a second, blended two at a time in the shader: smooth enough
 * for a crowd, and ~9 MB of half-float textures for all three kinds. A body
 * standing still plays its walk slowly (bodies seldom stand: they march or
 * claw). */
const FPS = 20;
const TEX_W = 2048;
const CAP = 128;           // bodies per kind
/** Seconds a dead body is still drawn (the sim keeps it for 1.45 s). */
const DEATH_SINK_AT = 0.86;
const DEATH_SINK_PX = 120;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function hash(n) {
  let x = (Number(n) || 0) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) % 100;
}

/** Inject the VAT read into a standard (or depth) material. */
function vatShader(material, uniforms, { normals }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2D vatPos;
uniform highp sampler2D vatNrm;
uniform int vatVerts;
attribute float vatIndex;
attribute vec4 vatAnim;
attribute float vatGlow;
varying float vFlash;
varying float vGlowM;
ivec2 vatAt(float frame) {
  int i = int(frame + 0.5) * vatVerts + int(vatIndex + 0.5);
  return ivec2(i % ${TEX_W}, i / ${TEX_W});
}`)
      .replace('#include <begin_vertex>', `vec3 transformed = mix(texelFetch(vatPos, vatAt(vatAnim.x), 0).xyz, texelFetch(vatPos, vatAt(vatAnim.y), 0).xyz, vatAnim.z);
vFlash = vatAnim.w;
vGlowM = vatGlow;`);
    if (normals) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        `vec3 objectNormal = normalize(mix(texelFetch(vatNrm, vatAt(vatAnim.x), 0).xyz, texelFetch(vatNrm, vatAt(vatAnim.y), 0).xyz, vatAnim.z));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`);
      // A rim of hot light round every body and a lift on its own colour:
      // the source monsters are dark (the ghost is near-black purple, the
      // demon a deep red) and at night a crowd of them read as one black
      // mass. The rim keeps every silhouette apart; the flash is the hit.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vFlash;
varying float vGlowM;
uniform vec3 vatRimColor;
uniform float vatRim;
uniform float vatGlow;
uniform vec3 uHordeEye;
uniform float uHordeEyeMul;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.96, 0.9), clamp(vFlash, 0.0, 1.0) * 0.55);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float vatFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
totalEmissiveRadiance += vatRimColor * pow(1.0 - vatFacing, 2.4) * vatRim;
totalEmissiveRadiance += diffuseColor.rgb * vatGlow;
totalEmissiveRadiance += vec3(1.0, 0.86, 0.72) * clamp(vFlash, 0.0, 1.0) * 1.35;
totalEmissiveRadiance += uHordeEye * clamp(vGlowM, 0.0, 4.0) * uHordeEyeMul;`);
    }
  };
  material.customProgramCacheKey = () => `duskhold-vat2-${normals ? 'lit' : 'depth'}`;
}

/**
 * Bake one rig. Returns { geometry, posTex, nrmTex, clips, height, minY,
 * verts, frames } or throws. CPU only: positions and normals are skinned
 * here with the rig's own bone matrices (the same sum the GPU skins with).
 */
export function bakeKind(key, template, animations) {
  const spec = ENEMY_MODELS[key];
  if (!spec) throw new Error(`no model for ${key}`);
  const rig = cloneRig(template);
  rig.visible = true;
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  rig.scale.set(1, 1, 1);
  rig.updateMatrixWorld(true);
  const meshes = [];
  rig.traverse((o) => { if (o.isSkinnedMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  if (!meshes.length) throw new Error(`${key}: no skinned mesh`);

  // the merged body: one vertex list, one index, colour per vertex from the
  // source material (linear, as GLTFLoader stores it)
  let verts = 0;
  for (const mesh of meshes) verts += mesh.geometry.attributes.position.count;
  const index = [];
  const colors = new Float32Array(verts * 3);
  const vatIndex = new Float32Array(verts);
  // BUILD 21: how hard each vertex's material glows (the horde's crimson
  // eyes, the ghost's bone fire) — baked once, emitted by the VAT shader.
  const glows = new Float32Array(verts);
  let base = 0;
  let rough = 0.7, metal = 0;
  meshes.forEach((mesh, mi) => {
    const g = mesh.geometry;
    const n = g.attributes.position.count;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    // the rig is a private clone (cloneRig copies materials), so the horde's
    // faction grade repaints this bake only — the shared template keeps its
    // authored colours for the legacy mansion
    if (mat) hordeGradeMaterial(key, mat);
    const glow = mat ? hordeGlowFor(key, mat.name) : 0;
    const color = (mat && mat.color) ? mat.color : _c.setRGB(0.5, 0.5, 0.5);
    if (mi === 0 && mat) { rough = mat.roughness != null ? mat.roughness : rough; metal = mat.metalness || 0; }
    for (let i = 0; i < n; i++) {
      colors[(base + i) * 3] = color.r;
      colors[(base + i) * 3 + 1] = color.g;
      colors[(base + i) * 3 + 2] = color.b;
      vatIndex[base + i] = base + i;
      glows[base + i] = glow;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(base + g.index.getX(i));
    else for (let i = 0; i < n; i++) index.push(base + i);
    base += n;
  });

  // clips → frame ranges
  const map = spec.map || {};
  const clips = {};
  let frames = 0;
  for (const want of BAKE) {
    const clip = (animations || []).find((c) => c.name === map[want.name]);
    if (!clip) continue;
    const dur = Math.max(0.05, clip.duration);
    const n = Math.max(2, Math.round(dur * FPS) + (want.loop ? 0 : 1));
    clips[want.name] = { clip, start: frames, n, dur, loop: want.loop };
    frames += n;
  }
  if (!clips.walk || !clips.die) throw new Error(`${key}: walk/die clips missing`);
  if (!clips.attack) clips.attack = clips.walk;
  if (!clips.hurt) clips.hurt = null;

  const rows = Math.ceil((frames * verts) / TEX_W);
  const pos = new Float32Array(TEX_W * rows * 4);
  const nrm = new Float32Array(TEX_W * rows * 4);
  const mixer = new THREE.AnimationMixer(rig);
  const boneM = [];
  const tmp = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (const name of Object.keys(clips)) {
    const c = clips[name];
    if (!c || c.done) continue;
    c.done = true;
    mixer.stopAllAction();
    const action = mixer.clipAction(c.clip);
    action.reset().play();
    action.setEffectiveWeight(1);
    for (let f = 0; f < c.n; f++) {
      const t = c.loop ? (f / c.n) * c.dur : Math.min(c.dur, (f / (c.n - 1)) * c.dur);
      action.time = t;
      mixer.update(0);
      rig.updateMatrixWorld(true);
      let vb = 0;
      for (const mesh of meshes) {
        const g = mesh.geometry;
        const P = g.attributes.position, N = g.attributes.normal;
        const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
        const skel = mesh.skeleton;
        skel.update();
        const bm = skel.boneMatrices;
        // M_k = matrixWorld · bindMatrixInverse · boneMatrix_k · bindMatrix
        const pre = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
        for (let k = 0; k < skel.bones.length; k++) {
          const M = boneM[k] || (boneM[k] = new THREE.Matrix4());
          tmp.fromArray(bm, k * 16);
          M.multiplyMatrices(pre, tmp).multiply(mesh.bindMatrix);
        }
        const e = new Float32Array(16);
        for (let i = 0; i < P.count; i++) {
          e.fill(0);
          for (let j = 0; j < 4; j++) {
            const w = SW ? SW.getComponent(i, j) : (j === 0 ? 1 : 0);
            if (!w) continue;
            const me = boneM[SI ? SI.getComponent(i, j) : 0].elements;
            for (let q = 0; q < 16; q++) e[q] += me[q] * w;
          }
          v.fromBufferAttribute(P, i);
          const x = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
          const y = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
          const z = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
          const o = ((c.start + f) * verts + vb + i) * 4;
          pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = 1;
          if (name === 'walk') { if (y < minY) minY = y; if (y > maxY) maxY = y; }
          if (N) {
            nv.fromBufferAttribute(N, i);
            const nx = e[0] * nv.x + e[4] * nv.y + e[8] * nv.z;
            const ny = e[1] * nv.x + e[5] * nv.y + e[9] * nv.z;
            const nz = e[2] * nv.x + e[6] * nv.y + e[10] * nv.z;
            const l = Math.hypot(nx, ny, nz) || 1;
            nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l; nrm[o + 3] = 0;
          } else { nrm[o + 1] = 1; }
        }
        vb += P.count;
      }
    }
    action.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);

  const half = (src) => {
    const out = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = THREE.DataUtils.toHalfFloat(src[i]);
    return out;
  };
  const tex = (data) => {
    const t = new THREE.DataTexture(half(data), TEX_W, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  const geometry = new THREE.BufferGeometry();
  // the bind position is only there for three's bookkeeping (the shader
  // reads the texture): frame 0 of the walk, so bounds are about right
  const p0 = new Float32Array(verts * 3);
  const n0 = new Float32Array(verts * 3);
  const w0 = clips.walk.start * verts * 4;
  for (let i = 0; i < verts; i++) {
    p0[i * 3] = pos[w0 + i * 4]; p0[i * 3 + 1] = pos[w0 + i * 4 + 1]; p0[i * 3 + 2] = pos[w0 + i * 4 + 2];
    n0[i * 3] = nrm[w0 + i * 4]; n0[i * 3 + 1] = nrm[w0 + i * 4 + 1]; n0[i * 3 + 2] = nrm[w0 + i * 4 + 2];
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(p0, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(n0, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('vatGlow', new THREE.BufferAttribute(glows, 1));
  geometry.setAttribute('vatIndex', new THREE.BufferAttribute(vatIndex, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  if (!(maxY > minY)) { minY = 0; maxY = 1; }
  return {
    geometry, posTex: tex(pos), nrmTex: tex(nrm), clips, verts, frames, rows,
    height: maxY - minY, minY, rough, metal, bytes: TEX_W * rows * 8 * 2,
  };
}

class CrowdStage {
  constructor() {
    this.kinds = new Map();     // key -> { bake, mesh, anim, count, spec }
    this.root = null;
    this.failed = [];
    this.bakeMs = 0;
    this.drawn = 0;
    this.byKind = {};
    // shared by every kind's material (uniform objects, so one write lands)
    // BUILD 21: the rim is the horde's faction edge — deep crimson, not the
    // old orange that turned the new ash bodies into sienna mud
    this.look = { rimColor: { value: new THREE.Color(0.78, 0.2, 0.16) }, rim: { value: 0.75 }, glow: { value: 0.28 } };
    this._eyeMuls = [];   // every kind's uHordeEyeMul (setLook dims them by day)
  }

  /** Night: a strong rim and a lift; day: a light touch (world3d, per frame). */
  setLook(night) {
    this.look.rim.value = night ? 0.6 : 0.28;
    this.look.glow.value = night ? 0.3 : 0.12;
    for (const mul of this._eyeMuls) mul.value = night ? 1.15 : 0.6;
  }

  /** True once at least the demon has its texture: the horde can be drawn. */
  get ready() { return this.kinds.has('zombie'); }

  /** Keys the boot waits for (all of them load with the enemy roster). */
  keys() { return CROWD_KINDS.map((k) => k.key); }

  /**
   * Bake every kind whose rig has loaded (idempotent, cheap once done).
   * Called by the boot before the first night, and again by the renderer
   * in case a rig arrived late.
   */
  prepare() {
    for (const spec of CROWD_KINDS) {
      if (this.kinds.has(spec.key) || this.failed.includes(spec.key)) continue;
      const rec = Enemy3D.types && Enemy3D.types[spec.key];
      if (!rec || !rec.loaded || rec.failed || !rec.template) continue;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      try {
        const bake = bakeKind(spec.key, rec.template, rec.animations);
        this.kinds.set(spec.key, { spec, bake, mesh: null, anim: null, count: 0 });
      } catch (error) {
        this.failed.push(spec.key);
        this.lastError = String(error && error.message || error);
      }
      this.bakeMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    }
    return this.ready;
  }

  _mesh(kind, root) {
    if (kind.mesh) {
      if (kind.mesh.parent !== root) root.add(kind.mesh);
      return kind.mesh;
    }
    const b = kind.bake;
    const uniforms = {
      vatPos: { value: b.posTex },
      vatNrm: { value: b.nrmTex },
      vatVerts: { value: b.verts },
      vatRimColor: this.look.rimColor,
      vatRim: this.look.rim,
      vatGlow: this.look.glow,
      // BUILD 21: the kind's eye/ghostfire colour; the strength lives in the
      // baked vatGlow attribute, this only dims it by day
      uHordeEye: { value: new THREE.Color(HORDE_EYE[kind.spec.key] != null ? HORDE_EYE[kind.spec.key] : 0xff3b28) },
      uHordeEyeMul: { value: 1 },
    };
    this._eyeMuls.push(uniforms.uHordeEyeMul);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: Math.max(0.45, b.rough), metalness: Math.min(0.2, b.metal),
    });
    vatShader(material, uniforms, { normals: true });
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    vatShader(depth, uniforms, { normals: false });
    const geometry = b.geometry.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('vatAnim', anim);
    const mesh = new THREE.InstancedMesh(geometry, material, CAP);
    mesh.name = `survival-horde-glb-${kind.spec.key}`;
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < CAP; i++) mesh.setColorAt(i, white);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    kind.mesh = mesh;
    kind.anim = anim;
    return mesh;
  }

  /** The kind a body is drawn as: fixed by its id, falling back to the demon. */
  kindFor(enemy) {
    const roll = hash(enemy.id);
    let acc = 0;
    for (const spec of CROWD_KINDS) {
      acc += spec.share;
      if (roll < acc) return this.kinds.get(spec.key) || this.kinds.get('zombie') || null;
    }
    return this.kinds.get('zombie') || null;
  }

  static clipFrame(clip, time) {
    if (!clip) return [0, 0, 0];
    const n = clip.n;
    let u = (time / clip.dur) * (clip.loop ? n : n - 1);
    let a, b;
    if (clip.loop) {
      u = ((u % n) + n) % n;
      a = Math.floor(u); b = (a + 1) % n;
    } else {
      u = Math.max(0, Math.min(n - 1, u));
      a = Math.floor(u); b = Math.min(n - 1, a + 1);
    }
    return [clip.start + a, clip.start + b, u - Math.floor(u)];
  }

  /**
   * Draw every swarm body (alive or still falling) this frame. `opts`:
   * root (the world group), actorScale, verticalProjection, records (the
   * QA map of id -> { visible, index }). Returns the number drawn, or -1
   * when no kind is ready (the caller keeps its fallback).
   */
  sync(enemies, opts) {
    if (!this.ready) return -1;
    const root = opts.root;
    for (const kind of this.kinds.values()) { this._mesh(kind, root); kind.count = 0; }
    const actor = opts.actorScale || 1;
    const vproj = opts.verticalProjection || Math.sqrt(2 / 3);
    const records = opts.records;
    let drawn = 0;
    for (const e of enemies) {
      if (!e || !e._crowd || !e._survivalType || e.removeMe) continue;
      const dying = !!e.dead;
      if (dying && (e.deathT || 0) > 1.45) continue;
      if (!dying && e.alpha != null && e.alpha <= 0.02) continue;
      const kind = this.kindFor(e);
      if (!kind || kind.count >= CAP) continue;
      const b = kind.bake;
      const i = kind.count++;
      // pose: which clip, how far into it
      let clip, time;
      const speed = Math.hypot(e.vx || 0, e.vy || 0);
      const phase = (hash((e.id || 0) * 7 + 3) / 100) * 4;
      let flash = Math.max(0, Math.min(1, e.hurtFlash || 0)) * 0.85;
      let sink = 0;
      if (dying) {
        clip = b.clips.die;
        time = Math.min(clip.dur, (e.deathT || 0) * 1.1);
        if ((e.deathT || 0) < 0.1) flash = 1;
        sink = Math.max(0, (e.deathT || 0) - DEATH_SINK_AT) / (1.45 - DEATH_SINK_AT) * DEATH_SINK_PX;
      } else if (b.clips.hurt && (e.hurtFlash || 0) > 0.45) {
        clip = b.clips.hurt;
        time = (1 - (e.hurtFlash || 0)) * 1.6 * clip.dur;
      } else if (e.state === 'press' || e.state === 'strike' || e.attackingKeep) {
        clip = b.clips.attack;
        time = (e.t || 0) * 1.05 + phase;
      } else if (speed > 12) {
        clip = b.clips.walk;
        time = (e.t || 0) * Math.max(0.7, Math.min(1.9, speed / 62)) + phase;
      } else {
        clip = b.clips.walk;
        time = (e.t || 0) * 0.35 + phase;
      }
      const [fa, fb, blend] = CrowdStage.clipFrame(clip, time);
      kind.anim.setXYZW(i, fa, fb, blend, flash);
      // place: feet on the floor, facing its heading, as tall as its role
      const projected = kind.spec.height * (e.sizeMul || 1) * actor;
      const s = (projected / vproj) / Math.max(0.001, b.height) * (1 + flash * 0.06);
      _p.set(e.x, -b.minY * s + kind.spec.hover - sink, e.y);
      _q.setFromAxisAngle(_up, Math.PI / 2 - (e.angle || 0));
      _s.setScalar(s);
      _m.compose(_p, _q, _s);
      kind.mesh.setMatrixAt(i, _m);
      const shade = 0.86 + (hash((e.id || 0) * 13 + 5) / 100) * 0.28;
      kind.mesh.setColorAt(i, _c.setRGB(shade, shade, shade));
      if (records) {
        let rec = records.get(e.id);
        if (!rec) { rec = { visible: false, index: -1 }; records.set(e.id, rec); }
        rec.visible = !dying;
        rec.index = i;
        rec.kind = kind.spec.key;
        rec._seen = true;
      }
      drawn++;
    }
    this.byKind = {};
    for (const kind of this.kinds.values()) {
      const mesh = kind.mesh;
      mesh.count = kind.count;
      mesh.visible = kind.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      kind.anim.needsUpdate = true;
      this.byKind[kind.spec.key] = kind.count;
    }
    this.drawn = drawn;
    return drawn;
  }

  hide() {
    for (const kind of this.kinds.values()) if (kind.mesh) { kind.mesh.count = 0; kind.mesh.visible = false; }
    this.drawn = 0;
  }

  diagnostics() {
    const kinds = {};
    for (const [key, kind] of this.kinds) {
      kinds[key] = { verts: kind.bake.verts, frames: kind.bake.frames, rows: kind.bake.rows, clips: Object.keys(kind.bake.clips).filter((k) => kind.bake.clips[k]), drawn: kind.count };
    }
    return { ready: this.ready, kinds, failed: this.failed.slice(), error: this.lastError || null, bakeMs: Math.round(this.bakeMs), drawn: this.drawn, byKind: { ...this.byKind } };
  }
}

export const Crowd3D = new CrowdStage();
