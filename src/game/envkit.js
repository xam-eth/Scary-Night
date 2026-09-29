/* LAST NIGHT — the modular 3D room (issue #55, phase C1)
 *
 * The CC0 kit at assets/env-kit (KayKit Dungeon Remastered) is the mansion's
 * architecture in three dimensions. It is rendered into the SAME scene phase B
 * built (#54): same rig, same floor, same shadow. One lamp lights the door and
 * the woman standing in it, because there is only one lamp.
 *
 * Doors first. They are the thing the player touches all night and the one
 * whose state — shut, ajar, barricaded, broken — has to read at a glance. The
 * 2D door keeps its logic, its hp, its knock and its repair; the mesh is only
 * how it looks. Nothing here is allowed to change a number in the sim.
 *
 * The pieces are byte-exact vendored files, cloned at runtime. If the kit
 * fails to load, nothing is drawn and the painted room carries the night: a
 * night never blocks on an asset.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { Valen3D } from './valen3d.js';

export const KIT_DIR = './assets/env-kit/';

/**
 * World units per kit unit. The pieces are authored on a 4-unit grid, so a
 * wall and a doorway are both 4 units tall: at 33 that stands ~132px on the
 * camera as tuned — twice Valen, which is what a door in a house this size
 * should be.
 */
export const KIT_SCALE = 33;

/** Only what the doors need today. The room kit lands with the floor. */
const FILES = Object.freeze({
  doorway: 'doorway.glb',
  gate: 'door_gate.glb',
  broken: 'wall_broken.glb',
  crate: 'crate.glb',
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class EnvKitRuntime {
  constructor() {
    this.ready = false;
    this.loading = false;
    this.failed = false;
    this.error = null;
    this.pieces = Object.create(null);
    this.group = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this.doors = new Map();
    this.diagnostics = () => ({
      ready: this.ready, loading: this.loading, failed: this.failed, error: this.error,
      pieces: Object.keys(this.pieces), doors: this.doors.size,
    });
  }

  /** Idempotent: the shared scene belongs to Valen, so wait for her. */
  init() {
    if (this.ready || this.loading || this.failed) return this;
    if (typeof document === 'undefined') return this;
    if (!Valen3D.renderer || !Valen3D.scene) return this;
    this.loading = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, premultipliedAlpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.canvas = canvas;
      this.renderer = renderer;
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 8000);
      this.group = new THREE.Group();
      this.group.name = 'envkit';
      Valen3D.scene.add(this.group);

      const loader = new GLTFLoader();
      const names = Object.keys(FILES);
      let left = names.length;
      for (const name of names) {
        loader.load(
          KIT_DIR + FILES[name],
          (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene);
            this.pieces[name] = {
              scene: gltf.scene,
              size: box.getSize(new THREE.Vector3()),
              min: box.min.clone(),
            };
            if (--left <= 0) { this.ready = true; this.loading = false; }
          },
          undefined,
          (error) => {
            this.error = String((error && error.message) || error);
            this.failed = true;
            this.loading = false;
          },
        );
      }
    } catch (error) {
      this.error = String(error);
      this.failed = true;
      this.loading = false;
    }
    return this;
  }

  /** One usable copy of a piece, standing on the floor at unit scale. */
  piece(name) {
    const src = this.pieces[name];
    if (!src) return null;
    const obj = src.scene.clone(true);
    obj.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        node.frustumCulled = false;
      }
    });
    return obj;
  }

  _doorView(door) {
    const known = this.doors.get(door.id);
    if (known) return known;
    const horiz = door.axis === 'h';
    const len = horiz ? door.w : door.h;
    const s = KIT_SCALE;
    const stretch = len / (4 * s);          // the opening, not the grid
    const group = new THREE.Group();
    group.position.set(door.x, 0, door.y);
    group.rotation.y = horiz ? 0 : Math.PI / 2;
    const view = { group, frame: null, pivot: null, gate: null, broken: null, crate: null, len };

    const frame = this.piece('doorway');
    if (frame) {
      frame.scale.set(s * stretch, s, s);
      frame.position.y = -this.pieces.doorway.min.y * s;
      group.add(frame);
      view.frame = frame;
    }
    const gate = this.piece('gate');
    if (gate) {
      const pivot = new THREE.Group();
      pivot.position.set(-len / 2, 0, 0);
      gate.scale.set(s * stretch, s, s);
      gate.position.set(len / 2, -this.pieces.gate.min.y * s, 0);
      pivot.add(gate);
      group.add(pivot);
      view.pivot = pivot;
      view.gate = gate;
    }
    const broken = this.piece('broken');
    if (broken) {
      broken.scale.set(s * stretch, s, s);
      broken.position.y = -this.pieces.broken.min.y * s;
      broken.visible = false;
      group.add(broken);
      view.broken = broken;
    }
    const crate = this.piece('crate');
    if (crate) {
      crate.scale.setScalar(s * 0.62);
      crate.position.y = -this.pieces.crate.min.y * s * 0.62;
      crate.visible = false;
      group.add(crate);
      view.crate = crate;
    }
    this.group.add(group);
    this.doors.set(door.id, view);
    return view;
  }

  /**
   * Point every mesh at the door state. Read-only on the sim: hp, open,
   * broken and barricade all stay exactly where the 2D game put them.
   */
  sync(entrances) {
    if (!this.ready || !this.group) return;
    for (const e of entrances) {
      if (e.kind !== 'door') continue;
      const v = this._doorView(e);
      if (!v) continue;
      // The painted plate bows out; the mesh is the door now. The painted
      // knock flash and the urgent rim still draw — they are cues, not oak.
      e.env3d = true;
      const hurt = 1 - clamp(e.hp / Math.max(1, e.hpMax), 0, 1);
      if (v.frame) {
        v.frame.visible = !e.broken;
        // a door under siege sits crooked in its frame
        v.frame.rotation.z = hurt * 0.035 + (e.buckling || 0) * 0.02;
      }
      if (v.gate && v.pivot) {
        v.gate.visible = !e.broken;
        v.pivot.rotation.y = e.open ? -1.25 : 0;
        v.pivot.rotation.z = hurt * 0.05;
      }
      if (v.broken) v.broken.visible = !!e.broken;
      if (v.crate) {
        const bar = clamp((e.barricade || 0) / 2, 0, 1);   // two planks is a full barricade
        v.crate.visible = (e.barricade || 0) > 0;
        if (v.crate.visible && e.inside) {
          // the barricade goes up on the inside, where she would stack it
          v.crate.position.set((e.inside.x - e.x) * (e.axis === 'h' ? 1 : 0), v.crate.position.y,
            e.axis === 'h' ? (e.inside.y - e.y) : (e.inside.y - e.y));
          v.crate.scale.setScalar(KIT_SCALE * (0.42 + bar * 0.3));
        }
      }
    }
  }

  /**
   * The room pass. Same pitch and the same world→screen mapping the 2D
   * renderer uses, so a mesh lands exactly where the painted room says the
   * door is — and the bodies are hidden, because they have their own passes
   * and this one belongs to the house.
   */
  render(view) {
    if (!this.ready || !this.renderer || !Valen3D.scene) return null;
    const { camX, camY, zoom, tilt, w, h, dpr = 1, shakeX = 0, shakeY = 0, light = null } = view;
    const cw = Math.max(2, Math.floor(w * dpr));
    const ch = Math.max(2, Math.floor(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.renderer.setSize(cw, ch, false);
    }
    const t = clamp(tilt, 0.2, 1);
    const theta = Math.asin(t);
    const dist = 2400;
    const cam = this.camera;
    cam.left = -(w / 2) / zoom;
    cam.right = (w / 2) / zoom;
    cam.top = (h / 2) / zoom;
    cam.bottom = -(h / 2) / zoom;
    cam.near = 0.1;
    cam.far = dist * 3;
    const tx = camX - shakeX / zoom;
    const ty = camY - shakeY / (zoom * t);
    cam.position.set(tx, Math.tan(theta) * dist, ty + dist);
    cam.lookAt(tx, 0, ty);
    cam.updateProjectionMatrix();

    if (Valen3D._applyRig) Valen3D._applyRig({ x: camX, y: camY, light });
    if (Valen3D.renderer) this.renderer.toneMappingExposure = Valen3D.renderer.toneMappingExposure * 1.1;

    const stage = Valen3D.stage;
    const wasVisible = stage ? stage.visible : true;
    if (stage) stage.visible = false;
    this.renderer.clear();
    this.renderer.render(Valen3D.scene, cam);
    if (stage) stage.visible = wasVisible;
    return this.canvas;
  }
}

export const EnvKit = new EnvKitRuntime();
