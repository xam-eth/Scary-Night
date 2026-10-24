/**
 * PROCEDURAL PROPS — code-only 3D props reconstructed with the img2threejs skill.
 *
 * User request 2026-10-24: "gunakan repo ini (img2threejs) untuk membuat asset asset yg di perlukan
 * untuk world build ... kamu generate foto lalu rubah jadi 3d ... bisa langsung bikin animasi juga".
 * Each prop started as a generated concept image (a reference only; its pixels never ship), was
 * rebuilt as an ObjectSculptSpec and a THREE.Group factory through img2threejs' gated passes
 * (assets-src/img2threejs/<asset>/, docs/IMG2THREEJS-ASSETS.md), and is bundled into
 * src/game/props/ by tools/img2threejs-build.mjs.
 *
 * The factories build review-grade hierarchies (one mesh per part: ~100 draw calls for the mine
 * cart). Here each prop is built ONCE into a template whose static parts are merged per material
 * under its "live" pivots — the nodes the game animates (a cart body that rolls, wheels that
 * spin) — and every placed prop is a clone of it (shared geometry, materials and 256 px maps).
 * Without a DOM (node QA) nothing is built and callers keep their fallbacks.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeGeometries } from '../vendor/three/BufferGeometryUtils.js';
import { createMineCartModel } from './props/mineCart.js';

/**
 * Per prop: its factory, its live pivots (component ids, parents before children) and, for each
 * part a caller may ask for alone, where it touches the ground in model units.
 */
export const PROP_DEFS = Object.freeze({
  mineCart: {
    factory: createMineCartModel,
    live: ['root', 'chassis-frame', 'wheel-fn', 'wheel-rn', 'wheel-ff', 'wheel-rf'],
    wheels: ['wheel-fn', 'wheel-rn', 'wheel-ff', 'wheel-rf'],
    wheelRadius: 0.165,
    railTop: 0.16,
  },
});

class ProceduralProps {
  constructor() {
    this.templates = new Map();
    this.failed = new Map();
    this.stats = {};
  }

  available() { return typeof document !== 'undefined'; }

  has(key) { return this._template(key) != null; }

  _template(key) {
    if (this.templates.has(key)) return this.templates.get(key);
    if (this.failed.has(key) || !this.available()) return null;
    const def = PROP_DEFS[key];
    if (!def) return null;
    try {
      const t = this._build(key, def);
      this.templates.set(key, t);
      return t;
    } catch (error) {
      this.failed.set(key, String(error && error.message || error));
      return null;
    }
  }

  _build(key, def) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const model = def.factory({ textureSize: 256, qualityPriority: 'balanced', castShadow: true, receiveShadow: true });
    model.updateMatrixWorld(true);
    const nodes = (model.userData.sculptRuntime && model.userData.sculptRuntime.nodes) || {};
    const live = def.live.filter((id) => nodes[id]);
    const liveSet = new Set(live.map((id) => nodes[id]));
    const liveOf = (object) => {
      let o = object.parent;
      while (o && !liveSet.has(o)) o = o.parent;
      return o;
    };
    // static parts per (live pivot, material), in the pivot's own space
    const buckets = new Map();
    let sourceMeshes = 0, sourceTris = 0;
    const inv = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const im = new THREE.Matrix4();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const pivot = liveOf(o);
      if (!pivot) return;
      sourceMeshes++;
      inv.copy(pivot.matrixWorld).invert();
      const list = [];
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); list.push(new THREE.Matrix4().multiplyMatrices(inv, m.multiplyMatrices(o.matrixWorld, im))); }
      } else {
        list.push(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      }
      for (const mat of list) {
        let g = o.geometry.clone();
        g.applyMatrix4(mat);
        if (g.index) g = g.toNonIndexed();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        sourceTris += g.attributes.position.count / 3;
        const k = `${pivot.uuid}|${o.material.uuid}`;
        if (!buckets.has(k)) buckets.set(k, { pivot, material: o.material, geos: [] });
        buckets.get(k).geos.push(g);
      }
    });
    // the compact hierarchy: one group per live pivot, local to its live parent
    const top = new THREE.Group();
    top.name = `prop-${key}`;
    const groups = new Map();
    const local = new THREE.Matrix4();
    for (const id of live) {
      const pivot = nodes[id];
      const parentPivot = liveOf(pivot);
      const parentGroup = parentPivot ? groups.get(parentPivot) : top;
      local.copy(parentPivot ? parentPivot.matrixWorld : model.matrixWorld).invert().multiply(pivot.matrixWorld);
      const g = new THREE.Group();
      g.name = `prop-${key}:${id}`;
      local.decompose(g.position, g.quaternion, g.scale);
      (parentGroup || top).add(g);
      groups.set(pivot, g);
    }
    let drawCalls = 0;
    for (const { pivot, material, geos } of buckets.values()) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${groups.get(pivot).name}:${material.name || 'material'}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      groups.get(pivot).add(mesh);
      drawCalls++;
    }
    const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
    this.stats[key] = { sourceMeshes, drawCalls, triangles: Math.round(sourceTris), buildMs: Math.round(ms) };
    return { object: top, def };
  }

  /**
   * A placed copy of a prop (shared geometry and materials). `part` takes one live pivot's subtree
   * alone (e.g. the mine cart's rolling body without its track), standing on y = 0.
   * Returns { object, nodes } with the live pivots of the copy by component id, or null.
   */
  clone(key, { part = null } = {}) {
    const t = this._template(key);
    if (!t) return null;
    const copy = t.object.clone(true);
    let object = copy;
    if (part) {
      const sub = copy.getObjectByName(`prop-${key}:${part}`);
      if (!sub) return null;
      sub.removeFromParent();
      // stand the part on the ground: its rail contact (model units) goes to y = 0
      const holder = new THREE.Group();
      holder.name = `prop-${key}:${part}:holder`;
      sub.position.y -= t.def.railTop || 0;
      holder.add(sub);
      object = holder;
    }
    const nodes = {};
    for (const id of t.def.live) {
      const n = object.getObjectByName(`prop-${key}:${id}`);
      if (n) nodes[id] = n;
    }
    return { object, nodes, def: t.def };
  }
}

export const Props3D = new ProceduralProps();
