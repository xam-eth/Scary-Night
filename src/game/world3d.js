/* Full 3D gameplay world.
 *
 * Mansion coordinates remain owned by the gameplay sim as (x, y). This
 * adapter maps them to Three.js (x, height, z=y), renders the room kit and
 * actors through EnvKit's single world camera, and leaves Canvas for HUD/UI.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { ISO_CAMERA, clamp, visualAngle } from '../core/util.js';
import { EnvKit, PIECE_METRES, PX_PER_METRE, VALEN_METRES } from './envkit.js';
import { Valen3D } from './valen3d.js';
import { Enemy3D, ENEMY_HEIGHT } from './enemy3d.js';
import { ROOM_MARKS } from './narrative.js';
import { ROOM } from './mansion.js';
import { weaponById } from './weapons.js';

const VERTICAL_PROJECTION = Math.sqrt(1 - ISO_CAMERA.tilt * ISO_CAMERA.tilt);
const PARTICLE_VERTEX_SHADER = `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aWorldSize;
  attribute float aSoft;
  attribute float aShape;
  attribute float aRotation;
  uniform float uPixelHeight;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  varying float vShape;
  varying float vRotation;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = max(1.0, aWorldSize * projectionMatrix[1][1] * uPixelHeight * 0.5);
    vColor = aColor;
    vAlpha = aAlpha;
    vSoft = aSoft;
    vShape = aShape;
    vRotation = aRotation;
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;
  varying float vShape;
  varying float vRotation;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float c = cos(vRotation), s = sin(vRotation);
    p = mat2(c, -s, s, c) * p;
    float mask = 1.0;
    if (vShape > 0.5) {
      float edge = 0.5 - p.x;
      if (p.x < -0.5 || p.x > 0.5 || abs(p.y) > max(0.015, edge * 0.72)) discard;
    }
    float radius = length(p) * 2.0;
    float falloff = vSoft > 0.5
      ? 1.0 - smoothstep(0.1, 1.0, radius)
      : 1.0 - smoothstep(0.82, 1.0, radius);
    gl_FragColor = vec4(vColor, vAlpha * falloff * mask);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Static procedural pieces become one mesh per material: each mesh's
 * transform (relative to `group`) is baked into a non-indexed copy of its
 * geometry and the copies are concatenated. Instanced meshes are left alone.
 * `flat(material)` marks ground planes: merged without casting shadows and
 * drawn first, as the planes were.
 */
function mergeStaticByMaterial(group, flat = () => false) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const doomed = [];
  group.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld));
    if (!buckets.has(obj.material)) buckets.set(obj.material, []);
    buckets.get(obj.material).push(geo);
    doomed.push(obj);
  });
  for (const obj of doomed) {
    obj.parent.remove(obj);
    obj.geometry.dispose();
  }
  for (const [material, geos] of buckets) {
    let count = 0;
    for (const geo of geos) count += geo.attributes.position.count;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    let at = 0;
    for (const geo of geos) {
      position.set(geo.attributes.position.array, at * 3);
      if (geo.attributes.normal) normal.set(geo.attributes.normal.array, at * 3);
      at += geo.attributes.position.count;
      geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    const ground = flat(material);
    mesh.castShadow = !ground;
    mesh.receiveShadow = true;
    if (ground) mesh.renderOrder = -1;
    group.add(mesh);
  }
}

/**
 * Merge primitive parts into one vertex-coloured geometry (a figure drawn by
 * one InstancedMesh): rows are [geometry, hex colour, x, y, z, rx, ry, rz].
 */
function mergeColoredParts(rows) {
  const geos = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (const [source, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0] of rows) {
    const geo = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    geo.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), one));
    const color = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(geo);
  }
  let count = 0;
  for (const geo of geos) count += geo.attributes.position.count;
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const out = new Float32Array(count * 3);
    let at = 0;
    for (const geo of geos) { out.set(geo.attributes[name].array, at); at += geo.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  for (const geo of geos) geo.dispose();
  merged.computeBoundingSphere();
  return merged;
}

class World3DRuntime {
  constructor() {
    this.host = null;
    this.canvas = null;
    this.scene = null;
    this.root = null;
    this.ground = null;
    this.exteriorRoot = null;
    this.exteriorMeshes = [];
    this.playerProxy = null;
    this.proxies = new Map();
    this.survivalCrowdProxies = new Map();
    this.survivalBuildingMeshes = new Map();
    this.survivalCircles = new Map();      // K1 build circles: id -> { ring, ghost }
    this.survivalTerritory = new Map();    // room id -> banner floor tint
    this.survivalKeep = null;
    this.survivalGateMesh = null;
    this.survivalCrowdInstances = null;
    this.survivalYard = null;
    this.variantRings = new Map();
    this.foodCues = new Map();
    this.drinkTrails = new Map();
    this.pickups = new Map();
    this.bolts = new Map();
    this.boltTrails = new Map();
    this.objectIds = new WeakMap();
    this.nextObjectId = 1;
    this.proxyGeometry = null;
    this.proxyHeadGeometry = null;
    this.proxyArmGeometry = null;
    this.pickupGeometry = null;
    this.plankGeometry = null;
    this.boltGeometry = null;
    this.knifeGeometry = null;
    this.playerSwing = null;
    this.playerFlash = null;
    this.duelLights = null;
    this.playerPointLight = null;
    this.localLights = [];
    this.directorShadow = null;
    this.directorShadowLight = null;
    this.drinkGeometry = null;
    this.particleCloud = null;
    this.particleCapacity = 0;
    this.particleColorCache = new Map();
    this.decalMesh = null;
    this.decalTexture = null;
    this.decalSource = null;
    this.decalUploadCanvas = null;
    this.decalNeedsUpload = false;
    this.roomMarks = [];
    this.roomMarksBuilt = false;
    this.houseCat = null;
    this.interactionCue = null;
    this.hauntWatchers = [];
    this.houseDrafts = new Map();
    this.doorCues = new Map();
    this.started = false;
    this.contextLost = false;
    this._contextCanvas = null;
    this._handleContextLost = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      this.contextLost = true;
      this.lastError = 'WebGL context lost; waiting for browser restoration.';
    };
    this._handleContextRestored = () => {
      this.contextLost = false;
      this.lastError = null;
      this.lastShadowUpdate = Number.NEGATIVE_INFINITY;
      if (EnvKit.renderer && EnvKit.renderer.resetState) EnvKit.renderer.resetState();
      if (EnvKit.renderer && EnvKit.renderer.shadowMap) EnvKit.renderer.shadowMap.needsUpdate = true;
    };
    this.exposure = 1.22;
    this.lastShadowUpdate = Number.NEGATIVE_INFINITY;
    this.lastParticleCount = 0;
    this.lastDecalUploads = 0;
    this.lastError = null;
    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.floorNdc = new THREE.Vector2();
    this.floorHit = new THREE.Vector3();
    this.lastRoomCount = 0;
    this.lastEntranceCount = 0;
    this.lastPortalCount = 0;
  }

  bindStage(host) {
    this.host = host || this.host;
    this._attachCanvas();
  }

  _attachCanvas() {
    if (!this.host || !EnvKit.canvas) return;
    const canvas = EnvKit.canvas;
    if (this.canvas === canvas && canvas.parentElement === this.host) return;
    if (this._contextCanvas !== canvas) {
      if (this._contextCanvas) {
        this._contextCanvas.removeEventListener('webglcontextlost', this._handleContextLost);
        this._contextCanvas.removeEventListener('webglcontextrestored', this._handleContextRestored);
      }
      canvas.addEventListener('webglcontextlost', this._handleContextLost);
      canvas.addEventListener('webglcontextrestored', this._handleContextRestored);
      this._contextCanvas = canvas;
    }
    this.canvas = canvas;
    canvas.classList.add('world3d');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'none';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0';
    const overlay = this.host.querySelector('#game');
    this.host.insertBefore(canvas, overlay || this.host.firstChild);
  }

  setVisible(visible) {
    this._attachCanvas();
    if (this.canvas) this.canvas.style.display = visible ? 'block' : 'none';
    if (this.host) this.host.dataset.renderMode = visible ? 'webgl-3d' : 'ui';
  }

  /** Cast an overlay pointer through the active orthographic WebGL camera onto the floor. */
  screenToFloor(sx, sy, game) {
    const camera = EnvKit.camera;
    const view = game && game.renderer && game.renderer.view;
    if (!camera || !view || !view.w || !view.h) return null;
    this.floorNdc.set(
      ((sx - view.left) / view.w) * 2 - 1,
      1 - ((sy - view.top) / view.h) * 2,
    );
    camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.floorNdc, camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  _idFor(object, prefix) {
    if (object && typeof object === 'object') {
      let id = this.objectIds.get(object);
      if (!id) { id = `${prefix}:${this.nextObjectId++}`; this.objectIds.set(object, id); }
      return id;
    }
    return `${prefix}:${String(object)}`;
  }

  _ensureWorld(game) {
    const scene = Valen3D.scene;
    if (!scene || !EnvKit.group) return false;
    this.scene = scene;
    if (!this.root) {
      this.root = new THREE.Group();
      this.root.name = 'last-night-world-actors';
      scene.add(this.root);
    }
    if (!this.duelLights) {
      const key = new THREE.PointLight(0xff6247, 0, 360, 1.8);
      const rim = new THREE.PointLight(0xffad73, 0, 210, 2);
      key.name = 'duel-boss-red-key-3d';
      rim.name = 'duel-boss-red-rim-3d';
      scene.add(key, rim);
      this.duelLights = { key, rim };
    }
    if (!this.playerPointLight) {
      this.playerPointLight = new THREE.PointLight(0x8494bd, 0, 250, 2);
      this.playerPointLight.name = 'hunter-blood-glow-3d';
      scene.add(this.playerPointLight);
    }
    if (Valen3D.ground) Valen3D.ground.visible = false;
    if (!this.ground) {
      const b = game.mansion.bounds;
      const extra = 2250;
      const geometry = new THREE.PlaneGeometry(b.w + extra * 2, b.h + extra * 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 1, metalness: 0 });
      this.ground = new THREE.Mesh(geometry, material);
      this.ground.name = 'mansion-ground-3d';
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.set(b.x + b.w / 2, -8, b.y + b.h / 2);
      this.ground.receiveShadow = true;
      this.ground.frustumCulled = false;
      scene.add(this.ground);
      scene.background = new THREE.Color(0x05070d);
    }
    this._ensureExterior(game, scene);
    if (!this.started) {
      const hemi = Valen3D.hemi;
      const key = Valen3D.key;
      const rim = Valen3D.rim;
      if (hemi) hemi.intensity = 0.85;
      if (key) {
        key.intensity = 1.05;
        key.position.set(-900, 1450, 1000);
      }
      if (rim) {
        rim.intensity = 0.48;
        rim.position.set(800, 850, -1100);
      }
      const lamp = Valen3D.lamp;
      if (lamp) {
        lamp.intensity = 1.1;
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(512, 512);
        const cam = lamp.shadow.camera;
        cam.left = -1050; cam.right = 1050;
        cam.top = 1050; cam.bottom = -1050;
        cam.near = 5; cam.far = 3200;
        cam.updateProjectionMatrix();
      }
      this.started = true;
    }
    return true;
  }

  _ensureExterior(game, scene) {
    if (this.exteriorRoot) return;
    const field = game.mansion && game.mansion.exterior;
    if (!field) return;
    const root = new THREE.Group();
    root.name = 'duskhold-3d-forest-and-rocks';
    root.userData.environmentOnly = true;
    scene.add(root);
    this.exteriorRoot = root;

    const matrix = new THREE.Object3D();
    const addInstances = (name, geometry, material, rows, transform, tint) => {
      if (!rows || !rows.length) return null;
      const mesh = new THREE.InstancedMesh(geometry, material, rows.length);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        transform(matrix, row, i);
        matrix.updateMatrix();
        mesh.setMatrixAt(i, matrix.matrix);
        if (tint) mesh.setColorAt(i, tint(row, i));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      root.add(mesh);
      this.exteriorMeshes.push(mesh);
      return mesh;
    };

    const trunkGeometry = new THREE.CylinderGeometry(0.58, 1, 1, 6, 1);
    const crownGeometry = new THREE.ConeGeometry(1, 1, 6, 1);
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x574638, roughness: 1, metalness: 0, flatShading: true });
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x314139, roughness: 1, metalness: 0, flatShading: true });
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x66666a, roughness: 1, metalness: 0, flatShading: true });
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x59634d, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide });

    const trees = field.trees || [];
    addInstances('forest-tree-trunks-3d', trunkGeometry, trunkMaterial, trees,
      (d, tree) => {
        const trunkHeight = tree.height * 0.38;
        d.position.set(tree.x, trunkHeight * 0.5, tree.y);
        d.rotation.set(0, tree.phase, 0);
        d.scale.set(tree.trunk, trunkHeight, tree.trunk);
      },
      (tree) => new THREE.Color(0x765b3c).multiplyScalar(0.7 + tree.shade * 0.52));

    const crownLayers = [
      { height: 0.62, y: 0.31, radius: 1.02 },
      { height: 0.6, y: 0.59, radius: 0.79 },
      { height: 0.48, y: 0.84, radius: 0.57 },
    ];
    crownLayers.forEach((layer, layerIndex) => {
      addInstances(`forest-conifer-crown-${layerIndex + 1}-3d`, crownGeometry, crownMaterial, trees,
        (d, tree) => {
          const trunkHeight = tree.height * 0.38;
          const crownHeight = tree.height - trunkHeight;
          const coneHeight = crownHeight * layer.height;
          d.position.set(tree.x, trunkHeight + crownHeight * layer.y, tree.y);
          d.rotation.set(0, tree.phase + layerIndex * 0.32, 0);
          d.scale.set(tree.crown * layer.radius, coneHeight, tree.crown * layer.radius);
        },
        (tree) => {
          const color = new THREE.Color().setHSL(0.31 + tree.shade * 0.025, 0.24 + tree.shade * 0.08, 0.12 + tree.shade * 0.075);
          return color.multiplyScalar(layerIndex === 0 ? 0.84 : 1);
        });
    });

    const rocks = field.rocks || [];
    addInstances('forest-boulders-3d', rockGeometry, rockMaterial, rocks,
      (d, rock) => {
        d.position.set(rock.x, rock.height * 0.72, rock.y);
        d.rotation.set(rock.turn * 0.12, rock.turn, rock.turn * 0.07);
        d.scale.set(rock.radius * 1.2, rock.height, rock.radius * 0.88);
      },
      (rock) => new THREE.Color(0x74747b).multiplyScalar(0.66 + rock.shade * 0.48));

    // Three crossed low-poly blades per tuft. This is actual standing mesh
    // geometry, not a canvas stamp or an alpha billboard.
    const grassVertices = [];
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      const ux = Math.cos(angle) * 0.19;
      const uz = Math.sin(angle) * 0.19;
      grassVertices.push(-ux, 0, -uz, ux, 0, uz, 0, 1, 0);
    }
    const grassGeometry = new THREE.BufferGeometry();
    grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute(grassVertices, 3));
    grassGeometry.computeVertexNormals();
    const brush = field.brush || [];
    addInstances('forest-grass-tufts-3d', grassGeometry, grassMaterial, brush,
      (d, tuft) => {
        d.position.set(tuft.x, 0.4, tuft.y);
        d.rotation.set(0, tuft.turn, 0);
        d.scale.set(36 * tuft.scale, 33 * tuft.scale, 36 * tuft.scale);
      },
      (tuft) => new THREE.Color(0x75825f).multiplyScalar(0.58 + tuft.shade * 0.5));
  }

  _sampleLight(game, x, z) {
    const sources = [
      ...(game.mansion.lights || []).map((light) => ({
        x: light.x, y: light.y, radius: light.r,
        intensity: light.curI == null ? light.i : light.curI,
        color: light.color,
      })),
      {
        x: game.player.x, y: game.player.y,
        radius: game.player.lightR || 150,
        intensity: game.player.lightI == null ? 0.55 : game.player.lightI,
        color: [190, 205, 235],
      },
    ];
    let best = null;
    let bestWeight = 0;
    let level = 0;
    for (const source of sources) {
      const d = Math.hypot(x - source.x, z - source.y);
      const weight = Math.max(0, source.intensity || 0) / (1 + d / Math.max(1, (source.radius || 1) * 0.8));
      level += weight;
      if (weight > bestWeight) { bestWeight = weight; best = source; }
    }
    if (!best) return { dx: -0.45, dy: -0.9, level: 0, color: [150, 172, 214] };
    const d = Math.hypot(x - best.x, z - best.y) || 1;
    return {
      dx: d < 8 ? -0.32 : (x - best.x) / d,
      dy: d < 8 ? 0.72 : (z - best.y) / d,
      level: Math.min(1, level),
      color: best.color || [150, 172, 214],
    };
  }

  /** Survival light rig: bright, readable, phase-tinted. */
  _survivalRig(game) {
    const day = !!(game.survival && game.survival.daylight());
    if (day) {
      return {
        exposure: 1.18, lamp: 1.05, lampColor: 0xfff1da, hemi: 1.25, sky: 0xfff4e0, ground: 0x8c7a5e,
        key: 1.1, keyColor: 0xffe7c4, rim: 0.45, rimColor: 0xbfd4ff,
      };
    }
    return {
      exposure: 1.08, lamp: 0.9, lampColor: 0xc9d8ff, hemi: 1.05, sky: 0xaec4ff, ground: 0x56483e,
      key: 0.8, keyColor: 0xd6e2ff, rim: 0.55, rimColor: 0x8fb0ff,
    };
  }

  _syncLighting(game) {
    const lamp = Valen3D.lamp;
    if (!lamp) return;
    const p = game.player;
    const light = this._sampleLight(game, p.x, p.y);
    const dx = Number.isFinite(light.dx) ? light.dx : -0.45;
    const dy = Number.isFinite(light.dy) ? light.dy : -0.9;
    const blackout = game.blackoutT > 0 ? 0.58 : 0;
    const duel = clamp(game.duelDark || 0, 0, 1) * 0.62;
    const flicker = clamp(game.lightMul == null ? 1 : game.lightMul, 0.35, 1.2);
    const lightning = clamp(game.lightningFlash || 0, 0, 1.5);
    const survival = game.mode === 'survival';
    const ambientFactor = survival ? 1 : Math.max(0.12, (1 - blackout - duel) * flicker);
    const lift = 720;
    lamp.target.position.set(p.x, 0, p.y);
    lamp.target.updateMatrixWorld(true);
    lamp.position.set(p.x + dx * 520, lift, p.y + dy * 520);
    if (survival) {
      // Survival is a readable top-down build/defend game: the fixed iso
      // camera needs the whole room legible. Night = cool moonlight plus the
      // warm Perapian pool; day = warm sun. Neither phase is ever black.
      const rig = this._survivalRig(game);
      lamp.intensity = rig.lamp + light.level * 0.25 + lightning * 0.4;
      lamp.color.setHex(rig.lampColor);
      if (Valen3D.hemi) {
        Valen3D.hemi.intensity = rig.hemi;
        Valen3D.hemi.color.setHex(rig.sky);
        Valen3D.hemi.groundColor.setHex(rig.ground);
      }
      if (Valen3D.key) { Valen3D.key.intensity = rig.key; Valen3D.key.color.setHex(rig.keyColor); }
      if (Valen3D.rim) { Valen3D.rim.intensity = rig.rim; Valen3D.rim.color.setHex(rig.rimColor); }
      this.exposure = rig.exposure;
    } else {
      lamp.intensity = (0.76 + light.level * 1.05) * ambientFactor + lightning * 2.1;
      lamp.color.setRGB(light.color[0] / 255, light.color[1] / 255, light.color[2] / 255);
      if (Valen3D.hemi) {
        Valen3D.hemi.intensity = 0.38 * ambientFactor + lightning * 1.25;
        Valen3D.hemi.color.setHex(0x9aaed4);
        Valen3D.hemi.groundColor.setHex(0x160b12);
      }
      if (Valen3D.key) { Valen3D.key.intensity = 1.05; Valen3D.key.color.setHex(0xffdfc2); }
      if (Valen3D.rim) { Valen3D.rim.intensity = 0.3 * ambientFactor + lightning * 0.65; Valen3D.rim.color.setHex(0x718fd2); }
      this.exposure = clamp(1.22 * ambientFactor + lightning * 0.32, 0.42, 1.48);
    }
    const bloodMoon = clamp(game.bloodMoon || 0, 0, 1);
    if (bloodMoon > 0.05) lamp.color.lerp(new THREE.Color(0x9a3442), bloodMoon * 0.36);

    if (this.playerPointLight) {
      this.playerPointLight.position.set(p.x, 44, p.y);
      this.playerPointLight.distance = survival ? 280 : Math.max(100, (p.lightR || 150) * 1.35);
      this.playerPointLight.intensity = survival
        ? (game.survival && game.survival.daylight() ? 0.35 : 1.05)
        : clamp((p.lightI == null ? 0.45 : p.lightI) * ambientFactor * 1.35, 0, 1.25);
      this.playerPointLight.color.set(survival ? 0xfff0d2
        : p.kit && p.kit.blessed ? 0xffdda0 : (p.bloodPct < 0.24 ? 0x9aa9e8 : 0x9aa7c7));
    }

    const sources = (game.mansion.lights || []).map((source) => {
      const d = Math.hypot(source.x - p.x, source.y - p.y);
      const intensity = Math.max(0, source.curI == null ? source.i || 0 : source.curI);
      return { source, d, weight: intensity * (source.r || 1) / (120 + d) };
    }).filter((row) => row.d < 700 && row.weight > 0.015).sort((a, b) => b.weight - a.weight).slice(0, game.quality >= 3 ? 6 : 3);
    while (this.localLights.length < 6) {
      const local = new THREE.PointLight(0xffd59a, 0, 300, 2);
      local.name = `house-lamp-3d-${this.localLights.length}`;
      this.scene.add(local);
      this.localLights.push(local);
    }
    for (let i = 0; i < this.localLights.length; i++) {
      const local = this.localLights[i];
      const row = sources[i];
      if (!row) { local.intensity = 0; local.visible = false; continue; }
      const source = row.source;
      local.visible = true;
      local.position.set(source.x, 44, source.y);
      local.distance = Math.max(90, (source.r || 150) * (survival ? 0.75 : 1.7));
      local.intensity = clamp((source.curI == null ? source.i || 0 : source.curI) * (survival ? 3.6 : 2.2) * ambientFactor, 0, survival ? 3.2 : 2.4);
      const c = source.color || [255, 206, 144];
      local.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
      if (bloodMoon > 0.3) local.color.lerp(new THREE.Color(0xff574c), bloodMoon * 0.26);
    }

    const boss = game.climax && game.climax.boss;
    const duelActive = !!(boss && game.climax.duel && (game.duelDark || 0) > 0.02);
    const duelStage = game.climax && game.climax.duel && game.climax.duel.stage;
    const duelPower = duelActive ? clamp(game.duelDark, 0, 1) * (duelStage === 'cut' ? 1 : 0.62) : 0;
    if (this.duelLights) {
      this.duelLights.key.visible = duelPower > 0.01;
      this.duelLights.rim.visible = duelPower > 0.01;
      this.duelLights.key.position.set(boss ? boss.x : p.x, 62, boss ? boss.y : p.y);
      this.duelLights.rim.position.set(boss ? boss.x - 26 : p.x, 44, boss ? boss.y + 18 : p.y);
      this.duelLights.key.intensity = 2.4 * duelPower;
      this.duelLights.rim.intensity = 1.1 * duelPower;
    }

    // The house shadow pass is expensive on mobile. Keep it live while still
    // limiting map refreshes to a cadence that avoids a full extra pass every
    // rendered frame; lightning and the first frame always refresh immediately.
    const shadowCadence = game.quality >= 3 ? 0.08 : 0.14;
    // `game.time` restarts with every night and day (Survival: and stands at
    // 0 on the end panels). A clock that ran backwards refreshes at once —
    // the map used to stay frozen until the new phase caught up with the old
    // one's time (a whole night's worth of seconds into the day).
    if (game.time < this.lastShadowUpdate) this.lastShadowUpdate = Number.NEGATIVE_INFINITY;
    if (EnvKit.renderer && EnvKit.renderer.shadowMap &&
        (game.time - this.lastShadowUpdate >= shadowCadence || lightning > 0.02)) {
      EnvKit.renderer.shadowMap.needsUpdate = true;
      if (lamp.shadow) lamp.shadow.needsUpdate = true;
      this.lastShadowUpdate = game.time;
    }
  }

  _makePlayerProxy() {
    if (!this.proxyGeometry) this.proxyGeometry = new THREE.CylinderGeometry(0.25, 0.34, 0.62, 8, 1);
    if (!this.proxyHeadGeometry) this.proxyHeadGeometry = new THREE.SphereGeometry(0.18, 9, 7);
    if (!this.proxyArmGeometry) this.proxyArmGeometry = new THREE.CylinderGeometry(0.07, 0.1, 0.48, 6, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x292832, roughness: 0.94, metalness: 0.02 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8f8176, roughness: 1 });
    const group = new THREE.Group();
    group.name = 'hunter-3d-proxy';
    const body = new THREE.Mesh(this.proxyGeometry, material);
    body.position.y = 0.43;
    const head = new THREE.Mesh(this.proxyHeadGeometry, skin);
    head.position.y = 0.83;
    head.scale.set(0.88, 1, 0.86);
    group.add(body, head);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(this.proxyArmGeometry, material);
      arm.position.set(side * 0.27, 0.47, 0);
      arm.rotation.z = side * -0.24;
      group.add(arm);
    }
    for (const child of group.children) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
    return group;
  }

  _playerProxyFor(id) {
    let object = this.proxies.get(id);
    if (!object) {
      object = this._makePlayerProxy();
      this.proxies.set(id, object);
      this.root.add(object);
    }
    return object;
  }

  _syncActors(game) {
    const active = new Set();
    const player = game.player;
    if (Valen3D.ready && Valen3D.model) {
      player.sync3D(game);
      if (this.playerProxy) this.playerProxy.visible = false;
    } else {
      this.playerProxy = this._playerProxyFor('player');
      this.playerProxy.visible = true;
      this.playerProxy.position.set(player.x, 0, player.y);
      this.playerProxy.rotation.y = Math.PI / 2 - player.angle;
      const height = VALEN_METRES * PX_PER_METRE;
      this.playerProxy.scale.set(height, height, height);
      active.add('player');
    }

    const enemies = game.enemies || [];
    Enemy3D.assign(enemies, player, {
      full3D: true,
      includeCrowd: game.mode === 'survival',
      verticalProjection: VERTICAL_PROJECTION,
      host: { stage: this.root, scene: this.scene, renderer: EnvKit.renderer, camera: EnvKit.camera, canvas: EnvKit.canvas },
    });
    if (game.mode === 'survival') this._syncSurvivalCrowdProxies(enemies);
    else this._hideSurvivalCrowd();
    // The legacy route remains GLB-only. Survival crowd units beyond the 14
    // authored rigs use a lightweight 3D silhouette so all 20–30 bodies read.
    for (const [id, object] of this.proxies) if (!active.has(id)) object.visible = false;
  }

  /**
   * Survival crowd silhouettes are INSTANCED: four draw calls (torso, head,
   * arms, eyes) carry every swarm body beyond the authored GLB rigs, so a
   * 30-body wave costs a phone the same as a single body. The Map of light
   * records keeps the long-standing QA contract (`.visible` per enemy id).
   */
  _ensureSurvivalCrowdInstances() {
    if (this.survivalCrowdInstances) return this.survivalCrowdInstances;
    const cap = 160;
    const skin = new THREE.MeshStandardMaterial({ color: 0x8fbf6a, roughness: 0.92, flatShading: true });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x56664a, roughness: 0.95, flatShading: true });
    const eyes = new THREE.MeshBasicMaterial({ color: 0xffd04a, toneMapped: false });
    const make = (geometry, material, count, name) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      return mesh;
    };
    const torsoGeo = new THREE.CylinderGeometry(7.5, 11, 34, 7, 1);
    torsoGeo.translate(0, 24, 0);
    const headGeo = new THREE.SphereGeometry(8.5, 8, 6);
    headGeo.scale(0.82, 0.9, 0.9);
    headGeo.translate(0, 44, 1);
    const armGeo = new THREE.CylinderGeometry(2.4, 3.1, 21, 5);
    armGeo.translate(0, -9, 0);
    const eyeGeo = new THREE.SphereGeometry(1.6, 6, 5);
    this.survivalCrowdInstances = {
      cap,
      torso: make(torsoGeo, cloth, cap, 'survival-swarm-instanced-torso'),
      head: make(headGeo, skin, cap, 'survival-swarm-instanced-head'),
      arms: make(armGeo, skin, cap * 2, 'survival-swarm-instanced-arms'),
      eyes: make(eyeGeo, eyes, cap * 2, 'survival-swarm-instanced-eyes'),
      base: new THREE.Object3D(),
      part: new THREE.Object3D(),
      matrix: new THREE.Matrix4(),
    };
    this.survivalCrowdInstances.eyes.castShadow = false;
    return this.survivalCrowdInstances;
  }

  _syncSurvivalCrowdProxies(enemies) {
    const inst = this._ensureSurvivalCrowdInstances();
    const { base, part, matrix } = inst;
    const active = new Set();
    let n = 0;
    for (const enemy of enemies) {
      if (!enemy || !enemy._crowd || !enemy._survivalType || enemy.dead || enemy.removeMe || enemy._glb) continue;
      const id = enemy.id;
      active.add(id);
      let record = this.survivalCrowdProxies.get(id);
      if (!record) { record = { visible: false, index: -1 }; this.survivalCrowdProxies.set(id, record); }
      const shown = (enemy.alpha == null || enemy.alpha > 0.02) && n < inst.cap;
      record.visible = shown;
      record.index = shown ? n : -1;
      if (!shown) continue;
      const scale = (enemy.sizeMul || 1) * (enemy.hurtFlash > 0 ? 1.08 : 1);
      base.position.set(enemy.x, 0, enemy.y);
      base.rotation.set(0, Math.PI / 2 - (enemy.angle || 0), 0);
      base.scale.setScalar(scale);
      base.updateMatrix();
      inst.torso.setMatrixAt(n, base.matrix);
      inst.head.setMatrixAt(n, base.matrix);
      const swing = Math.sin((enemy.t || 0) * 6 + (id || 0)) * 0.16;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        part.position.set(sign * 10, 38, 3);
        part.rotation.set(-1.1, 0, sign * -(0.42 + swing));
        part.scale.setScalar(1);
        part.updateMatrix();
        matrix.multiplyMatrices(base.matrix, part.matrix);
        inst.arms.setMatrixAt(n * 2 + side, matrix);
        part.position.set(sign * 3, 45, 8.1);
        part.rotation.set(0, 0, 0);
        part.updateMatrix();
        matrix.multiplyMatrices(base.matrix, part.matrix);
        inst.eyes.setMatrixAt(n * 2 + side, matrix);
      }
      n++;
    }
    inst.torso.count = n; inst.head.count = n;
    inst.arms.count = n * 2; inst.eyes.count = n * 2;
    for (const mesh of [inst.torso, inst.head, inst.arms, inst.eyes]) {
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [id, record] of this.survivalCrowdProxies) {
      if (!active.has(id)) this.survivalCrowdProxies.delete(id);
      else if (record.index < 0) record.visible = false;
    }
  }

  _hideSurvivalCrowd() {
    for (const record of this.survivalCrowdProxies.values()) record.visible = false;
    const inst = this.survivalCrowdInstances;
    if (!inst) return;
    for (const mesh of [inst.torso, inst.head, inst.arms, inst.eyes]) { mesh.count = 0; mesh.visible = false; }
  }

  _makeSurvivalBuilding(type) {
    const group = new THREE.Group();
    group.name = `survival-building-3d-${type}`;
    const wood = new THREE.MeshStandardMaterial({ color: 0x60452a, roughness: 0.96, flatShading: true });
    const woodLight = new THREE.MeshStandardMaterial({ color: 0x917044, roughness: 0.9, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x554a3b, metalness: 0.58, roughness: 0.56, flatShading: true });
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    if (type === 'mine') {
      // a gold mine: a timber headframe over the shaft, a pulley wheel and a
      // cart heaped with gold
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcc3a, emissive: 0x6a4a00, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4, flatShading: true });
      add(new THREE.BoxGeometry(46, 6, 46), wood, 0, 3, 0);
      add(new THREE.BoxGeometry(30, 3, 30), new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 1 }), 0, 6.5, 0);
      for (const x of [-18, 18]) {
        add(new THREE.BoxGeometry(5, 58, 5), woodLight, x, 32, -8, 0, 0, x < 0 ? -0.12 : 0.12);
      }
      add(new THREE.BoxGeometry(44, 5, 6), woodLight, 0, 60, -8);
      add(new THREE.TorusGeometry(9, 2, 5, 14), iron, 0, 60, -2);
      add(new THREE.BoxGeometry(26, 14, 18), iron, 26, 10, 18);
      for (let i = 0; i < 5; i++) add(new THREE.DodecahedronGeometry(5.5, 0), goldMat, 20 + (i % 3) * 6, 19 + Math.floor(i / 3) * 4, 14 + (i % 2) * 7);
      for (const x of [18, 34]) add(new THREE.CylinderGeometry(4, 4, 3, 8), iron, x, 4, 28, Math.PI / 2, 0, 0);
    } else if (type === 'sawmill') {
      for (let i = 0; i < 3; i++) {
        add(new THREE.CylinderGeometry(8, 8, 56, 8), i === 1 ? woodLight : wood, -20 + i * 20, 8 + i * 1.5, 0, 0, 0, Math.PI / 2);
      }
      add(new THREE.BoxGeometry(65, 5, 9), iron, 0, 23, 0);
      add(new THREE.TorusGeometry(14, 2, 5, 16), iron, 0, 27, 8, Math.PI / 2, 0, 0);
      add(new THREE.BoxGeometry(8, 26, 8), woodLight, -25, 13, -10);
      add(new THREE.BoxGeometry(8, 26, 8), woodLight, 25, 13, -10);
    } else if (type === 'tower') {
      // An open watchtower: legs, a railed deck and a ballista on a swivel
      // that turns to what it shoots (no roof, so the camera sees it aim).
      const stone = new THREE.MeshStandardMaterial({ color: 0x8d867b, roughness: 0.95, flatShading: true });
      add(new THREE.CylinderGeometry(33, 37, 10, 8), stone, 0, 5, 0);
      for (const x of [-21, 21]) for (const z of [-21, 21]) add(new THREE.BoxGeometry(7, 72, 7), woodLight, x, 44, z);
      for (const face of [-1, 1]) {
        // X-braces on all four faces
        add(new THREE.BoxGeometry(4, 56, 3), wood, 0, 44, face * 21, 0, 0, 0.62);
        add(new THREE.BoxGeometry(4, 56, 3), wood, 0, 44, face * 21, 0, 0, -0.62);
        add(new THREE.BoxGeometry(3, 56, 4), wood, face * 21, 44, 0, 0.62, 0, 0);
        add(new THREE.BoxGeometry(3, 56, 4), wood, face * 21, 44, 0, -0.62, 0, 0);
      }
      add(new THREE.BoxGeometry(64, 6, 64), wood, 0, 82, 0);
      for (const face of [-1, 1]) {
        add(new THREE.BoxGeometry(64, 10, 4), woodLight, 0, 90, face * 30);
        add(new THREE.BoxGeometry(4, 10, 64), woodLight, face * 30, 90, 0);
      }
      const yaw = new THREE.Group();
      yaw.name = 'survival-tower-yaw';
      yaw.position.set(0, 86, 0);
      group.add(yaw);
      const part = (geometry, material, parent, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, rz);
        mesh.castShadow = true;
        parent.add(mesh);
        return mesh;
      };
      part(new THREE.CylinderGeometry(6, 8, 10, 8), iron, yaw, 0, 5, 0);
      const stock = new THREE.Group();   // slides back on a shot (recoil)
      stock.name = 'survival-tower-stock';
      stock.position.set(0, 12, 0);
      yaw.add(stock);
      part(new THREE.BoxGeometry(9, 7, 46), wood, stock, 0, 0, 4);
      part(new THREE.BoxGeometry(28, 4, 5), iron, stock, -12, 1, 22, 0, 0.42, 0);
      part(new THREE.BoxGeometry(28, 4, 5), iron, stock, 12, 1, 22, 0, -0.42, 0);
      part(new THREE.BoxGeometry(46, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 }), stock, 0, 1, 15);
      const loaded = new THREE.Group();  // hidden for a moment after each shot
      loaded.name = 'survival-tower-bolt';
      part(new THREE.CylinderGeometry(1.8, 1.8, 40, 6), woodLight, loaded, 0, 0, 0, Math.PI / 2, 0, 0);
      part(new THREE.ConeGeometry(3.6, 9, 6), new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff5a1a, emissiveIntensity: 0.6, roughness: 0.5 }), loaded, 0, 0, 24, Math.PI / 2, 0, 0);
      loaded.position.set(0, 5, 8);
      stock.add(loaded);
      group.userData.yaw = yaw;
      group.userData.stock = stock;
      group.userData.loaded = loaded;
    } else {
      // barracks: a canvas tent in the garrison's blue, a weapon rack and a
      // pennant pole (soldiers live here)
      const canvasMat = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.95, flatShading: true });
      const blueMat = new THREE.MeshStandardMaterial({ color: 0x3e6bff, emissive: 0x1a3aa8, emissiveIntensity: 0.3, roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
      add(new THREE.BoxGeometry(72, 4, 56), wood, 0, 2, 0);
      add(new THREE.ConeGeometry(44, 52, 4), canvasMat, 0, 30, 0, 0, Math.PI / 4, 0);
      add(new THREE.BoxGeometry(18, 30, 2), blueMat, 0, 16, 30);
      add(new THREE.CylinderGeometry(1.8, 1.8, 76, 6), iron, 0, 56, 0);
      add(new THREE.BoxGeometry(26, 14, 1.5), blueMat, 13, 86, 0);
      add(new THREE.BoxGeometry(40, 4, 4), woodLight, -36, 22, 0, 0, Math.PI / 2, 0);
      for (const z of [-12, 0, 12]) add(new THREE.BoxGeometry(3, 30, 3), iron, -36, 18, z);
    }
    group.traverse((item) => { if (item.isMesh) item.userData.survivalBuilding = type; });
    return group;
  }

  /** A see-through blue copy of a building: what a circle will build. */
  _makeSurvivalGhost(type) {
    const group = type === 'gate' ? this._makeSurvivalGateModel() : this._makeSurvivalBuilding(type);
    group.name = `survival-ghost-3d-${type}`;
    const material = new THREE.MeshBasicMaterial({ color: 0x8cc0ff, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
    group.traverse((item) => { if (item.isMesh) { item.material = material; item.castShadow = false; item.receiveShadow = false; item.renderOrder = 6; } });
    group.userData.ghostMaterial = material;
    group.scale.setScalar(type === 'gate' ? 1 : 1.3);
    group.visible = false;
    this.root.add(group);
    return group;
  }

  /** One shared dashed-ring texture for every build circle (white, tinted per state). */
  _circleTexture() {
    if (this._circleTex !== undefined) return this._circleTex;
    this._circleTex = null;
    if (typeof document === 'undefined') return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = size * 0.06;
    ctx.setLineDash([size * 0.11, size * 0.075]);
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2); ctx.stroke();
    this._circleTex = new THREE.CanvasTexture(canvas);
    this._circleTex.colorSpace = THREE.SRGBColorSpace;
    return this._circleTex;
  }

  _makeSurvivalCircle(radius) {
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, map: this._circleTexture(), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    ring.name = 'survival-build-circle-3d';
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    ring.visible = false;
    this.root.add(ring);
    return ring;
  }

  /**
   * A levelled building reads from the camera: it grows per level and
   * flies a pennant (Lv2 blue, Lv3 gold with a second flag).
   */
  _setSurvivalBuildingLevel(group, level) {
    group.userData.level = level;
    // ×1.3 at Lv1 so a building reads at the day camera's zoom; +0.18 a level
    group.scale.setScalar(1.3 + 0.18 * (level - 1));
    const old = group.getObjectByName('survival-building-pennant');
    if (old) {
      group.remove(old);
      old.traverse((item) => { if (item.isMesh) { item.geometry.dispose(); item.material.dispose(); } });
    }
    if (level < 2) return;
    const pennant = new THREE.Group();
    pennant.name = 'survival-building-pennant';
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 64, 6),
      new THREE.MeshStandardMaterial({ color: 0x4b3424, roughness: 0.9 }));
    pole.position.set(0, 32, 0);
    pole.castShadow = true;
    pennant.add(pole);
    const color = level >= 3 ? 0xffc93a : 0x4aa8ff;
    const flags = level >= 3 ? 2 : 1;
    for (let i = 0; i < flags; i++) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(34, -9); shape.lineTo(0, -18); shape.closePath();
      const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }));
      flag.position.set(1.5, 63 - i * 21, 0);
      flag.castShadow = true;
      pennant.add(flag);
    }
    // screen-right of the model (+x −z is sideways in the iso view), so the
    // day bubble above the building never hides it; a tower flies it from
    // the screen-right corner of its deck
    if (group.userData.type === 'tower') pennant.position.set(28, 86, -28);
    else pennant.position.set(50, 0, -50);
    pennant.rotation.y = Math.PI / 4;
    pennant.traverse((item) => { if (item.isMesh) item.userData.survivalBuilding = group.userData.type; });
    group.add(pennant);
  }

  /** Height of the ballista that shot this bolt (a tower's deck or the keep's roof). */
  _towerMuzzle(bolt) {
    const owner = bolt.owner || {};
    if (bolt.keepBolt || owner.key === 'keep') {
      const keep = this.survivalKeep;
      return keep ? keep.userData.roofY * keep.scale.y - 10 : 220;
    }
    const mesh = owner.slotId ? this.survivalBuildingMeshes.get(owner.slotId) : null;
    // deck swivel (86) + stock (12) + the loaded bolt (5), in model units
    return mesh ? 103 * mesh.scale.y - 18 : 0;
  }

  /** The ballista swings to its tower's bearing and kicks back on a shot. */
  _syncSurvivalTower(mesh, mode, slotId) {
    const tower = (mode.towers || []).find((item) => item.slotId === slotId);
    const { yaw, stock, loaded } = mesh.userData;
    if (!yaw) return;
    const aim = tower ? tower.aim : Math.PI / 2;
    yaw.rotation.y = Math.PI / 2 - aim;
    const kick = tower ? tower.shotT : 0;
    if (stock) stock.position.z = -kick * 34;
    if (loaded) loaded.visible = kick < 0.12;
  }

  /**
   * By day a ballista circle the Hunter stands at shows how far it reaches
   * (built: its level; empty: what Lv1 would): a red ring on the floor, the
   * genre's AoE circle, so where it stands reads as a choice.
   */
  _syncSurvivalTowerRing(game, mode) {
    const here = mode.phase === 'day' && game.screen === 'playing' && mode.dayContext ? mode.dayContext() : null;
    const show = !!(here && here.kind === 'slot' && here.type === 'tower' && !here.locked);
    if (!show && !this.survivalTowerRing) return;
    if (!this.survivalTowerRing) {
      const group = new THREE.Group();
      group.name = 'survival-tower-range-3d';
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({
        color: 0xff4a3a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }));
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.952, 1, 96), new THREE.MeshBasicMaterial({
        color: 0xff4433, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }));
      for (const item of [fill, edge]) { item.rotation.x = -Math.PI / 2; item.renderOrder = 3; item.frustumCulled = false; group.add(item); }
      group.userData.edge = edge;
      this.root.add(group);
      this.survivalTowerRing = group;
    }
    const ring = this.survivalTowerRing;
    ring.visible = show;
    if (!show) return;
    const level = Math.max(1, here.level || 0);
    const range = mode.buildingStats('tower', level).range || 0;
    ring.position.set(here.x, 3.8, here.y);
    ring.scale.set(range, 1, range);
    ring.userData.edge.material.opacity = 0.78 + 0.2 * (0.5 + 0.5 * Math.sin(game.time * 3));
  }

  /**
   * The keep (K1): a round dark-stone tower in the middle of the Main Hall
   * with the townsfolk on its battlements and the garrison's banner on top.
   * Its level shows from across the house: timber hoardings (Lv1), a big
   * banner and a bell (Lv2), a second banner and a roof ballista (Lv3).
   */
  _makeSurvivalKeep(r) {
    const group = new THREE.Group();
    group.name = 'survival-keep-3d';
    const mats = [];
    const mat = (o) => { const m = new THREE.MeshStandardMaterial({ transparent: true, ...o }); mats.push(m); return m; };
    const stone = mat({ color: 0x6f6a66, roughness: 0.96, flatShading: true });
    const stoneDark = mat({ color: 0x4d4947, roughness: 0.98, flatShading: true });
    const stoneLight = mat({ color: 0x8c867e, roughness: 0.94, flatShading: true });
    const wood = mat({ color: 0x5e4128, roughness: 0.92, flatShading: true });
    const iron = mat({ color: 0x4a4540, metalness: 0.55, roughness: 0.5, flatShading: true });
    const glow = mat({ color: 0xffd38a, emissive: 0xffa640, emissiveIntensity: 1.3, roughness: 0.6 });
    const blue = mat({ color: 0x3e6bff, emissive: 0x1a3aa8, emissiveIntensity: 0.4, roughness: 0.65, side: THREE.DoubleSide });
    const gold = mat({ color: 0xffd24a, emissive: 0x8a6000, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide });
    const crack = mat({ color: 0x17120f, roughness: 1 });
    const H = 186;
    const topY = 18 + H;
    const add = (geo, m, x, y, z, ry = 0, parent = group) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // positions around the tower use (sin a, cos a) so a box turned by `a`
    // faces outward: a = 0 is the south face, toward the camera
    const around = (a, rad) => [Math.sin(a) * rad, Math.cos(a) * rad];
    add(new THREE.CylinderGeometry(r + 12, r + 16, 18, 14), stoneDark, 0, 9, 0);
    add(new THREE.CylinderGeometry(r - 6, r, H, 14), stone, 0, 18 + H / 2, 0);
    for (const y of [18 + H * 0.36, 18 + H * 0.7]) add(new THREE.CylinderGeometry(r + 1, r + 1, 7, 14), stoneLight, 0, y, 0);
    add(new THREE.CylinderGeometry(r + 6, r - 3, 14, 14), stoneLight, 0, topY + 4, 0);
    add(new THREE.CylinderGeometry(r - 10, r - 10, 6, 14), stoneDark, 0, topY + 10, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const [x, z] = around(a, r - 1);
      add(new THREE.BoxGeometry(28, 24, 14), stone, x, topY + 23, z, a);
    }
    add(new THREE.BoxGeometry(56, 88, 10), wood, 0, 18 + 44, r - 3);
    add(new THREE.BoxGeometry(66, 9, 12), iron, 0, 18 + 92, r - 2);
    add(new THREE.BoxGeometry(22, 32, 6), glow, 0, 18 + H * 0.6, r - 4);
    for (const a of [Math.PI * 0.32, -Math.PI * 0.36, Math.PI * 0.8]) {
      const [x, z] = around(a, r - 4);
      add(new THREE.BoxGeometry(14, 24, 6), glow, x, 18 + H * 0.48, z, a);
    }
    // Lv1: timber hoardings round the top
    const hoarding = new THREE.Group();
    hoarding.name = 'survival-keep-hoarding';
    group.add(hoarding);
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      const [x, z] = around(a, r + 7);
      add(new THREE.BoxGeometry(32, 18, 9), wood, x, topY - 10, z, a, hoarding);
    }
    // cracks on the camera-facing half (shown as the keep is hurt)
    const cracks = [];
    for (const [a, y, h, tilt] of [[-0.5, 0.42, 46, 0.4], [0.42, 0.62, 52, -0.35], [0.15, 0.3, 38, 0.2], [-0.2, 0.78, 34, -0.5]]) {
      const [x, z] = around(a, r - 2);
      const c = add(new THREE.BoxGeometry(5, h, 3), crack, x, 18 + H * y, z, a);
      c.rotation.z = tilt;
      c.visible = false;
      cracks.push(c);
    }
    // the banner: a pole and a swallowtail flag that waves
    add(new THREE.CylinderGeometry(2.6, 2.6, 100, 7), iron, 0, topY + 10 + 50, 0);
    const flagShape = () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(74, 0); shape.lineTo(62, -21); shape.lineTo(74, -42); shape.lineTo(0, -42); shape.closePath();
      return new THREE.ShapeGeometry(shape);
    };
    const makeFlag = (y) => {
      const pivot = new THREE.Group();
      pivot.position.set(0, y, 0);
      const cloth = new THREE.Mesh(flagShape(), blue);
      cloth.castShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(74, 4, 1.2), gold);
      trim.position.set(37, -21, 0.4);
      pivot.add(cloth, trim);
      group.add(pivot);
      return pivot;
    };
    const flag = makeFlag(topY + 106);
    const flag2 = makeFlag(topY + 62);
    flag2.visible = false;
    // Lv2: a bell under a little arch
    const bell = new THREE.Group();
    bell.position.set(0, topY + 14, -r * 0.45);
    for (const x of [-12, 12]) add(new THREE.BoxGeometry(4, 34, 4), wood, x, 17, 0, 0, bell);
    add(new THREE.BoxGeometry(30, 4, 6), wood, 0, 34, 0, 0, bell);
    add(new THREE.ConeGeometry(8, 14, 10, 1, true), gold, 0, 24, 0, 0, bell);
    bell.visible = false;
    group.add(bell);
    // Lv3: a ballista on the roof that swings to what it shoots
    const yaw = new THREE.Group();
    yaw.name = 'survival-keep-ballista';
    yaw.position.set(0, topY + 13, r * 0.25);
    const part = (geo, m, parent, x, y, z, ry = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = true; parent.add(mesh); return mesh; };
    part(new THREE.CylinderGeometry(7, 9, 10, 8), iron, yaw, 0, 5, 0);
    const stock = new THREE.Group();
    stock.position.set(0, 13, 0);
    yaw.add(stock);
    part(new THREE.BoxGeometry(10, 8, 50), wood, stock, 0, 0, 4);
    part(new THREE.BoxGeometry(30, 4, 5), iron, stock, -13, 1, 24, 0.42);
    part(new THREE.BoxGeometry(30, 4, 5), iron, stock, 13, 1, 24, -0.42);
    yaw.visible = false;
    group.add(yaw);
    // the townsfolk on the battlements
    const skin = mat({ color: 0xf2c9a0, roughness: 0.8 });
    const tunics = [0xd9c7a0, 0x8a5a3a, 0x5a7a4a].map((color) => mat({ color, roughness: 0.85, flatShading: true }));
    const villagers = [];
    [-0.55, 0, 0.55].forEach((a, i) => {
      const person = new THREE.Group();
      const [x, z] = around(a, r - 30);
      person.position.set(x, topY + 13, z);
      person.rotation.y = a;
      add(new THREE.CylinderGeometry(6, 8, 20, 8), tunics[i], 0, 10, 0, 0, person);
      add(new THREE.SphereGeometry(6.5, 10, 8), skin, 0, 26, 0, 0, person);
      const arms = [];
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * 8, 18, 0);
        add(new THREE.BoxGeometry(3.5, 13, 3.5), tunics[i], 0, 6, 0, 0, shoulder);
        person.add(shoulder);
        arms.push(shoulder);
      }
      group.add(person);
      villagers.push({ person, arms, seed: i * 1.7 });
    });
    group.userData = { mats, hoarding, cracks, flag, flag2, bell, yaw, stock, villagers, roofY: topY + 24, height: topY + 34, level: 0, fade: 1 };
    this.root.add(group);
    return group;
  }

  _syncSurvivalKeep(game, mode) {
    const keep = mode.keep();
    if (!this.survivalKeep) this.survivalKeep = this._makeSurvivalKeep(keep.r);
    const group = this.survivalKeep;
    const ud = group.userData;
    const t = game.now || 0;
    const state = mode.keepState();
    group.visible = true;
    if (ud.level !== mode.keepLevel) {
      ud.level = mode.keepLevel;
      group.scale.setScalar(1 + (mode.keepLevel - 1) * 0.06);
      ud.hoarding.visible = mode.keepLevel === 1;
      ud.bell.visible = mode.keepLevel >= 2;
      ud.flag2.visible = mode.keepLevel >= 3;
      ud.yaw.visible = mode.keepLevel >= 2;
      ud.flag.scale.setScalar(mode.keepLevel === 1 ? 0.75 : 1.1);
    }
    // a claw on the wall shakes the tower for a moment; a fallen keep sinks
    const hitAge = mode.uiClock - (mode._keepHitAt == null ? -99 : mode._keepHitAt);
    const shake = hitAge < 0.25 ? (1 - hitAge / 0.25) * 3.2 : 0;
    const fallen = state === 'fallen';
    group.position.set(keep.x + Math.sin(t * 61) * shake, fallen ? -46 : 0, keep.y + Math.cos(t * 53) * shake);
    group.rotation.z = fallen ? 0.12 : 0;
    const pct = mode.keepHp / Math.max(1, mode.keepHpMax());
    ud.cracks.forEach((c, i) => { c.visible = pct < (i < 2 ? 0.6 : 0.3); });
    const critical = state === 'critical' || fallen;
    ud.flag.rotation.y = Math.sin(t * 2.1) * 0.28 + (critical ? 0.5 : 0);
    ud.flag.rotation.z = critical ? -0.35 : 0;
    ud.flag.scale.x = (mode.keepLevel === 1 ? 0.75 : 1.1) * (critical ? 0.6 : 1);
    ud.flag2.rotation.y = Math.sin(t * 2.3 + 1) * 0.3;
    // the roof ballista swings and kicks like a tower's
    const b = mode.keepBallista;
    if (b && ud.yaw.visible) {
      ud.yaw.rotation.y = Math.PI / 2 - b.aim;
      ud.stock.position.z = -b.shotT * 34;
    }
    // the townsfolk: wave (safe), point (threat), jump (attacked), huddle
    // (critical) — and cheer, both arms up, the morning help arrives
    const cheering = mode.phase === 'complete' && !fallen;
    for (const v of ud.villagers) {
      v.person.visible = !fallen;
      const k = t * 6 + v.seed;
      let lift = 0, armA = 0.2, armB = 0.2, squash = 1;
      if (cheering) { lift = Math.abs(Math.sin(k * 1.3)) * 7; armA = 2.7 + Math.sin(k * 2) * 0.35; armB = 2.7 - Math.sin(k * 2) * 0.35; }
      else if (state === 'safe') { armA = 2.6 + Math.sin(k) * 0.5; armB = 0.25; }
      else if (state === 'threat') { armA = 1.6; armB = 1.6; }
      else if (state === 'attacked') { lift = Math.abs(Math.sin(k * 1.6)) * 6; armA = 2.9; armB = 2.9; }
      else if (state === 'critical') { squash = 0.82; armA = 0.9; armB = 0.9; }
      v.person.position.y = ud.roofY - 11 + lift;
      v.person.scale.set(1, squash, 1);
      v.arms[0].rotation.x = -armA; v.arms[1].rotation.x = -armB;
    }
    // the Hunter walking behind the tower: it fades so he stays visible
    const p = game.player;
    const behind = p && p.y < keep.y - 20 && Math.abs(p.x - keep.x) < keep.r + 70 && keep.y - p.y < 360;
    ud.fade += ((behind ? 0.3 : 1) - ud.fade) * 0.18;
    for (const m of ud.mats) { m.opacity = ud.fade; m.depthWrite = ud.fade > 0.95; }
  }

  /** The banner's rooms: a faint garrison-blue wash on their floors. */
  _syncSurvivalTerritory(game, mode) {
    const night = mode.phase === 'night';
    const want = new Set(mode.territoryRooms().map((room) => room.id));
    if (!this._territoryMat) {
      this._territoryMat = new THREE.MeshBasicMaterial({ color: 0x3e6bff, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
    }
    this._territoryMat.opacity = night ? 0.15 : 0.1;
    for (const room of game.mansion.roomList) {
      let plane = this.survivalTerritory.get(room.id);
      if (!want.has(room.id)) { if (plane) plane.visible = false; continue; }
      if (!plane) {
        plane = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.h), this._territoryMat);
        plane.name = 'survival-banner-territory-3d';
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(room.x + room.w / 2, 1.6, room.y + room.h / 2);
        plane.renderOrder = 1;
        this.root.add(plane);
        this.survivalTerritory.set(room.id, plane);
      }
      plane.visible = true;
    }
  }

  /** The armory rack beside the keep (the Hunter's own upgrades). */
  _makeSurvivalArmory() {
    const group = new THREE.Group();
    group.name = 'survival-armory-3d';
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.9, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.6, roughness: 0.45, flatShading: true });
    const add = (geo, m, x, y, z, rz = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.z = rz; mesh.castShadow = true; group.add(mesh); return mesh; };
    add(new THREE.BoxGeometry(70, 5, 26), wood, 0, 2.5, 0);
    for (const x of [-30, 30]) add(new THREE.BoxGeometry(5, 54, 5), wood, x, 29, 0);
    add(new THREE.BoxGeometry(66, 5, 6), wood, 0, 50, 0);
    add(new THREE.BoxGeometry(66, 4, 6), wood, 0, 24, 0);
    for (const x of [-18, 0, 18]) {
      add(new THREE.BoxGeometry(4, 36, 4), wood, x, 34, 4, 0.08);
      add(new THREE.BoxGeometry(22, 3, 3), iron, x, 46, 6);
    }
    this.root.add(group);
    return group;
  }

  /** Scaffold + a builder with a hammer where a job is under way. */
  _makeSurvivalScaffold() {
    const group = new THREE.Group();
    group.name = 'survival-scaffold-3d';
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.9, flatShading: true });
    for (const x of [-34, 34]) for (const z of [-34, 34]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(4, 86, 4), wood);
      pole.position.set(x, 43, z); pole.castShadow = true; group.add(pole);
    }
    for (const y of [30, 66]) for (const z of [-34, 34]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(76, 4, 8), wood);
      plank.position.set(0, y, z); plank.castShadow = true; group.add(plank);
    }
    const builder = new THREE.Group();
    const tunic = new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.85, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 22, 8), tunic); body.position.y = 22;
    const head = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), skin); head.position.y = 40;
    const arm = new THREE.Group(); arm.position.set(9, 30, 0);
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(3, 18, 3), wood); hammer.position.y = 8;
    const headH = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 5), new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.6, roughness: 0.4 }));
    headH.position.y = 17;
    arm.add(hammer, headH);
    builder.add(body, head, arm);
    for (const m of [body, head]) m.castShadow = true;
    builder.position.set(46, 0, 46);
    group.add(builder);
    group.userData = { builder, arm };
    group.visible = false;
    this.root.add(group);
    return group;
  }

  /**
   * Every build circle on the floor, with the ghost of what it builds; the
   * keep, the armory and the barricade get a ring while the Hunter is at
   * them. Circles show by day only; beyond the banner they are grey.
   */
  _syncSurvivalCircles(game, mode) {
    const day = mode.phase === 'day' && game.screen === 'playing' && !mode.rewardPending();
    const here = day ? mode.dayContext() : null;
    const t = game.now || 0;
    const points = mode.dayPoints();
    const seen = new Set();
    for (const point of points) {
      if (point.kind === 'keep') continue;
      seen.add(point.id);
      let rec = this.survivalCircles.get(point.id);
      if (!rec) {
        rec = { ring: this._makeSurvivalCircle(point.kind === 'slot' ? 58 : 50), ghost: null };
        this.survivalCircles.set(point.id, rec);
      }
      const near = here && here.id === point.id;
      const built = point.kind === 'slot' ? !!point.built : point.kind === 'gate' ? mode.gateBuilt : point.kind === 'armory';
      const working = mode.builderJob && ((mode.builderJob.slotId && mode.builderJob.slotId === point.id)
        || (point.kind === 'gate' && mode.builderJob.kind === 'gate') || (point.kind === 'armory' && mode.builderJob.kind === 'hunter'));
      const ring = rec.ring;
      ring.visible = day && (!built || near) && !working;
      if (ring.visible) {
        ring.position.set(point.x, 2.4, point.y);
        const pulse = near ? 1 + 0.06 * Math.sin(t * 6) : 1;
        ring.scale.set(pulse, pulse, 1);
        ring.material.color.setHex(point.locked ? 0x9097a6 : built ? 0xffd24a : near ? 0xfff2b0 : 0xffffff);
        ring.material.opacity = point.locked ? 0.42 : near ? 1 : 0.78;
      }
      if (point.kind === 'armory') continue;
      const ghostType = point.kind === 'gate' ? 'gate' : point.type;
      if (!rec.ghost && ghostType) rec.ghost = this._makeSurvivalGhost(ghostType);
      if (!rec.ghost) continue;
      const showGhost = day && !built && !working;
      rec.ghost.visible = showGhost;
      if (showGhost) {
        if (point.kind === 'gate') {
          const gate = mode.mainGate();
          rec.ghost.position.set(gate.x, 0, gate.y);
          rec.ghost.rotation.y = gate.axis === 'v' ? Math.PI / 2 : 0;
        } else {
          rec.ghost.position.set(point.x, 0, point.y);
        }
        const m = rec.ghost.userData.ghostMaterial;
        m.color.setHex(point.locked ? 0x8a8f9c : 0x8cc0ff);
        m.opacity = point.locked ? 0.16 : near ? 0.62 + 0.08 * Math.sin(t * 5) : 0.36;
      }
    }
    for (const [id, rec] of this.survivalCircles) {
      if (seen.has(id)) continue;
      rec.ring.visible = false;
      if (rec.ghost) rec.ghost.visible = false;
    }
    // the keep's own ring while the Hunter stands at it
    if (!this.survivalKeepRing) {
      this.survivalKeepRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 72), new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }));
      this.survivalKeepRing.rotation.x = -Math.PI / 2;
      this.survivalKeepRing.renderOrder = 4;
      this.root.add(this.survivalKeepRing);
    }
    const atKeep = here && here.kind === 'keep';
    this.survivalKeepRing.visible = !!atKeep;
    if (atKeep) {
      const keep = mode.keep();
      const r = keep.r + 34;
      this.survivalKeepRing.position.set(keep.x, 2.6, keep.y);
      this.survivalKeepRing.scale.set(r, r, 1);
      this.survivalKeepRing.material.opacity = 0.7 + 0.25 * Math.sin(t * 5);
    }
    // the armory rack always stands (it is furniture of the hall)
    if (!this.survivalArmory) this.survivalArmory = this._makeSurvivalArmory();
    const armory = mode.armorySpot();
    this.survivalArmory.visible = true;
    this.survivalArmory.position.set(armory.x, 0, armory.y);
    // scaffold + builder at a job
    if (!this.survivalScaffold) this.survivalScaffold = this._makeSurvivalScaffold();
    const job = mode.builderJob;
    const spot = job ? mode.jobSpot(job) : null;
    this.survivalScaffold.visible = !!spot && mode.phase === 'day';
    if (spot && this.survivalScaffold.visible) {
      const keepJob = job.kind === 'keep' || job.kind === 'repair';
      this.survivalScaffold.position.set(spot.x, 0, spot.y + (keepJob ? 30 : 0));
      this.survivalScaffold.userData.arm.rotation.x = -1.2 + Math.sin(t * 12) * 0.9;
    }
  }

  /** Yard ground: the house sits on readable terrain instead of a void. */
  /**
   * THE BAILEY'S MASONRY (survival only; src/game/fortress.js).
   *
   * The curtain wall itself is the EnvKit wall kit, built from the fortress
   * solids like any room wall. On top of it go the parts that make it a
   * fortress: a parapet cap and merlons along every run, round towers on the
   * corners, square gatehouse towers either side of each big gate with a
   * crenellated bridge over the gate, the keep's blue banners, and trodden
   * earth in the grass yards so the inside of the wall reads apart from the
   * forest floor. All procedural meshes; every tower is also a solid in the
   * sim (fortress.towers), so what you see is what blocks.
   */
  _makeFortressDressing(m) {
    const group = new THREE.Group();
    group.name = 'survival-fortress-3d';
    const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true, ...o });
    const stone = mat({ color: 0x77716b });
    const stoneDark = mat({ color: 0x4f4a47 });
    const stoneLight = mat({ color: 0x938c83 });
    const slit = mat({ color: 0x15110e, roughness: 1 });
    const wood = mat({ color: 0x4a3423, roughness: 0.92 });
    const blue = mat({ color: 0x3e6bff, emissive: 0x1a3aa8, emissiveIntensity: 0.35, roughness: 0.65, side: THREE.DoubleSide, flatShading: false });
    const gold = mat({ color: 0xffd24a, emissive: 0x8a6000, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.45 });
    const yardMat = new THREE.MeshStandardMaterial({ color: 0x86a35a, roughness: 1, metalness: 0 });
    const wallTop = PIECE_METRES.wall * PX_PER_METRE;
    const WALL_T = 26;
    const add = (geo, material, x, y, z, ry = 0, parent = group) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const towers = m.towers || [];
    const inTower = (x, z, pad = 0) => towers.some((t) => Math.abs(x - t.x) < t.size / 2 + pad && Math.abs(z - t.y) < t.size / 2 + pad);

    // grass yards inside the wall: trodden earth, a shade off the forest floor
    for (const room of m.roomList) {
      if (room.floor !== 'grass') continue;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.h), yardMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(room.x + room.w / 2, -1, room.y + room.h / 2);
      plane.receiveShadow = true;
      plane.renderOrder = -1;
      group.add(plane);
    }

    // parapet cap and merlons along every run of the curtain wall
    const spots = [];
    for (const s of m.solids) {
      if (s.type !== 'wall') continue;
      const horiz = s.w >= s.h;
      const len = horiz ? s.w : s.h;
      const cx = s.x + s.w / 2, cz = s.y + s.h / 2;
      add(new THREE.BoxGeometry(horiz ? len : WALL_T + 12, 8, horiz ? WALL_T + 12 : len), stoneLight, cx, wallTop + 4, cz);
      const n = Math.max(1, Math.floor(len / 46));
      for (let i = 0; i < n; i++) {
        const a = (horiz ? s.x : s.y) + (i + 0.5) * (len / n);
        const x = horiz ? a : cx, z = horiz ? cz : a;
        if (inTower(x, z, 6)) continue;
        spots.push({ x, z, ry: horiz ? 0 : Math.PI / 2 });
      }
    }
    const merlons = new THREE.InstancedMesh(new THREE.BoxGeometry(24, 20, WALL_T + 8), stone, Math.max(1, spots.length));
    const dummy = new THREE.Object3D();
    spots.forEach((p, i) => {
      dummy.position.set(p.x, wallTop + 18, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.updateMatrix();
      merlons.setMatrixAt(i, dummy.matrix);
    });
    merlons.count = spots.length;
    merlons.castShadow = true;
    merlons.receiveShadow = true;
    group.add(merlons);

    // the towers
    const flags = [];
    const flagSpots = [];
    for (const t of towers) {
      if (t.kind === 'corner') {
        const r = t.size / 2;
        const h = wallTop + 70;
        add(new THREE.CylinderGeometry(r + 8, r + 12, 16, 16), stoneDark, t.x, 8, t.y);
        add(new THREE.CylinderGeometry(r - 4, r, h, 16), stone, t.x, h / 2, t.y);
        add(new THREE.CylinderGeometry(r + 1, r + 1, 7, 16), stoneLight, t.x, h * 0.55, t.y);
        add(new THREE.CylinderGeometry(r + 8, r - 2, 14, 16), stoneLight, t.x, h + 5, t.y);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          add(new THREE.BoxGeometry(26, 22, 14), stone, t.x + Math.sin(a) * (r + 1), h + 22, t.y + Math.cos(a) * (r + 1), a);
        }
        for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
          add(new THREE.BoxGeometry(8, 30, 4), slit, t.x + Math.sin(a) * (r - 2), h * 0.72, t.y + Math.cos(a) * (r - 2), a);
        }
        // a pole and the keep's blue banner over every corner (the cloth
        // waves, so it is made after the static masonry is merged)
        add(new THREE.CylinderGeometry(2.5, 2.5, 80, 6), wood, t.x, h + 52, t.y);
        flagSpots.push({ x: t.x, y: h + 86, z: t.y });
      } else {
        const sz = t.size;
        const h = wallTop + 52;
        add(new THREE.BoxGeometry(sz + 10, 14, sz + 10), stoneDark, t.x, 7, t.y);
        add(new THREE.BoxGeometry(sz, h, sz), stone, t.x, h / 2, t.y);
        add(new THREE.BoxGeometry(sz + 10, 10, sz + 10), stoneLight, t.x, h + 3, t.y);
        for (const [ox, oz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          add(new THREE.BoxGeometry(18, 20, 18), stone, t.x + ox * (sz / 2 - 4), h + 18, t.y + oz * (sz / 2 - 4));
        }
        // a slit and a blue banner on the forest face and the yard face
        const horiz = t.side === 'north' || t.side === 'south';
        for (const dir of [-1, 1]) {
          const fx = horiz ? 0 : dir, fz = horiz ? dir : 0;
          add(new THREE.BoxGeometry(horiz ? 8 : 4, 30, horiz ? 4 : 8), slit, t.x + fx * (sz / 2 + 1), h * 0.8, t.y + fz * (sz / 2 + 1));
          const banner = add(new THREE.PlaneGeometry(34, 64), blue, t.x + fx * (sz / 2 + 2), h * 0.44, t.y + fz * (sz / 2 + 2), Math.atan2(fx, fz));
          banner.castShadow = false;
          add(new THREE.BoxGeometry(horiz ? 40 : 4, 4, horiz ? 4 : 40), gold, t.x + fx * (sz / 2 + 3), h * 0.44 + 33, t.y + fz * (sz / 2 + 3));
        }
      }
    }

    // a crenellated bridge over every big gate, tower to tower
    for (const e of m.entrances) {
      if (!e.gate || !e.big) continue;
      const horiz = e.axis === 'h';
      const span = (horiz ? e.w : e.h) + 20;
      add(new THREE.BoxGeometry(horiz ? span : WALL_T + 16, 24, horiz ? WALL_T + 16 : span), stoneLight, e.x, wallTop + 8, e.y);
      for (let i = 0; i < 3; i++) {
        const a = -span / 2 + (i + 0.5) * (span / 3);
        add(new THREE.BoxGeometry(horiz ? 24 : WALL_T + 8, 20, horiz ? WALL_T + 8 : 24), stone,
          e.x + (horiz ? a : 0), wallTop + 30, e.y + (horiz ? 0 : a));
      }
    }

    // ~250 static pieces become one mesh per material (a handful of draw
    // calls on a phone); the merlons are already one instanced mesh
    mergeStaticByMaterial(group, (material) => material === yardMat);
    for (const spot of flagSpots) {
      const flag = new THREE.Group();
      flag.position.set(spot.x, spot.y, spot.z);
      group.add(flag);
      const cloth = add(new THREE.PlaneGeometry(54, 32), blue, 27, -14, 0, 0, flag);
      cloth.castShadow = false;
      flags.push({ flag, seed: spot.x * 0.01 + spot.z * 0.013 });
    }
    let meshes = 0;
    group.traverse((obj) => { if (obj.isMesh) meshes++; });
    group.userData = { flags, yardMat, towers: towers.length, merlons: spots.length, meshes };
    this.root.add(group);
    return group;
  }

  _syncFortressDressing(game, mode) {
    const m = game.mansion;
    if (!m || !m.isFortress) return;
    if (!this.fortressDressing) this.fortressDressing = this._makeFortressDressing(m);
    const ud = this.fortressDressing.userData;
    const t = game.now || 0;
    ud.yardMat.color.setHex(mode.daylight() ? 0x86a35a : 0x4b6448);
    for (const f of ud.flags) f.flag.rotation.y = Math.sin(t * 1.7 + f.seed) * 0.35;
  }

  _makeSurvivalYard() {
    const yard = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.MeshStandardMaterial({ color: 0x47603f, roughness: 1, metalness: 0 }),
    );
    yard.name = 'survival-yard-ground-3d';
    yard.rotation.x = -Math.PI / 2;
    yard.position.y = -2;
    yard.receiveShadow = true;
    yard.renderOrder = -2;
    this.root.add(yard);
    return yard;
  }

  /** A bright ground ring that keeps the Hunter readable in a crowd. */
  _makeSurvivalPlayerRing() {
    const group = new THREE.Group();
    group.name = 'survival-hunter-ring-3d';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(25, 34, 40),
      new THREE.MeshBasicMaterial({ color: 0x5cf08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(25, 32),
      new THREE.MeshBasicMaterial({ color: 0x5cf08a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    fill.rotation.x = -Math.PI / 2;
    // Behind a south wall the Hunter is hidden from this camera; a faint copy
    // of his ring is drawn through the walls so you never lose him at a door.
    const xray = new THREE.Mesh(
      ring.geometry,
      new THREE.MeshBasicMaterial({ color: 0x5cf08a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false }),
    );
    xray.rotation.x = -Math.PI / 2;
    xray.renderOrder = 20;
    group.add(ring, fill, xray);
    group.renderOrder = 5;
    ring.renderOrder = 5; fill.renderOrder = 5;
    this.root.add(group);
    return group;
  }

  /**
   * The forest was authored for the legacy horror palette (near-black crowns).
   * Survival is a bright, readable genre view: lift the exterior albedo while
   * keeping the same instanced meshes; legacy restores the original colors.
   */
  _syncExteriorPalette(survival) {
    for (const mesh of this.exteriorMeshes || []) {
      const ud = mesh.userData;
      if (ud.survivalPalette === survival) continue;
      const mat = mesh.material;
      if (!mat || !mat.color) { ud.survivalPalette = survival; continue; }
      if (!mat.userData.baseColor) mat.userData.baseColor = mat.color.clone();
      if (mesh.instanceColor && !ud.baseInstanceColors) ud.baseInstanceColors = mesh.instanceColor.array.slice();
      const name = mesh.name || '';
      const crown = /crown/.test(name), trunk = /trunk/.test(name), rock = /boulder/.test(name), grass = /grass/.test(name);
      if (survival && (crown || trunk || rock)) mat.color.setRGB(1, 1, 1);
      else if (survival && grass) mat.color.copy(mat.userData.baseColor).multiplyScalar(2.4);
      else mat.color.copy(mat.userData.baseColor);
      if (mesh.instanceColor && ud.baseInstanceColors) {
        const gain = survival ? (crown ? 2.5 : trunk ? 1.3 : 1) : 1;
        const src = ud.baseInstanceColors, dst = mesh.instanceColor.array;
        for (let i = 0; i < dst.length; i++) dst[i] = src[i] * gain;
        mesh.instanceColor.needsUpdate = true;
      }
      ud.survivalPalette = survival;
    }
  }

  _makeSurvivalGate() {
    const group = this._makeSurvivalGateModel();
    group.visible = false;
    this.root.add(group);
    return group;
  }

  /** The front door's barricade: posts and beams with sharpened stakes. */
  _makeSurvivalGateModel() {
    const group = new THREE.Group();
    group.name = 'survival-reinforced-gate-3d';
    const timber = new THREE.MeshStandardMaterial({ color: 0x64482c, roughness: 0.9, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x52493a, metalness: 0.62, roughness: 0.55, flatShading: true });
    // Orientation is corrected at sync time; the default spans a horizontal jamb.
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(9, 88, 12), timber);
      post.position.set(side * 81, 44, 0);
      post.castShadow = true;
      group.add(post);
    }
    for (const y of [22, 47, 72]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(170, 7, 10), y === 47 ? iron : timber);
      beam.position.y = y;
      beam.castShadow = true;
      group.add(beam);
    }
    // sharpened stakes leaning out, like the barricades in the key art
    for (let i = 0; i < 6; i++) {
      const stake = new THREE.Mesh(new THREE.ConeGeometry(4, 64, 5), timber);
      stake.position.set(-70 + i * 28, 30, 16);
      stake.rotation.x = 0.9;
      stake.castShadow = true;
      group.add(stake);
    }
    return group;
  }

  /** Survivors as small readable pawns: blue tunic, crossbow, ally ring. */
  _makeSurvivalGuard() {
    const mats = this._guardMats || (this._guardMats = {
      tunic: new THREE.MeshStandardMaterial({ color: 0x3f8fe8, roughness: 0.7, flatShading: true }),
      skin: new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.8 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.9, flatShading: true }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.85, flatShading: true }),
      ring: new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      // seen through walls: a guard at a south door stays findable
      xray: new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false }),
      // a fallen guard: the same rings in alarm red
      ringDown: new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      xrayDown: new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false }),
    });
    const geo = this._guardGeo || (this._guardGeo = {
      leg: new THREE.BoxGeometry(6, 16, 6).translate(0, -8, 0),
      body: new THREE.CylinderGeometry(9, 11.5, 25, 8),
      head: new THREE.SphereGeometry(8.5, 12, 8),
      hair: new THREE.SphereGeometry(9.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      stock: new THREE.BoxGeometry(4, 4, 24),
      bow: new THREE.BoxGeometry(24, 2.5, 3),
      ring: new THREE.RingGeometry(15, 20.5, 28),
    });
    const group = new THREE.Group();
    group.name = 'survival-guard-3d';
    const legL = new THREE.Mesh(geo.leg, mats.dark); legL.position.set(-4.5, 16, 0);
    const legR = new THREE.Mesh(geo.leg, mats.dark); legR.position.set(4.5, 16, 0);
    const body = new THREE.Mesh(geo.body, mats.tunic); body.position.y = 28;
    const head = new THREE.Mesh(geo.head, mats.skin); head.position.y = 48;
    const hair = new THREE.Mesh(geo.hair, mats.hair); hair.position.y = 49;
    const bow = new THREE.Group(); bow.position.set(5, 31, 8);
    const stock = new THREE.Mesh(geo.stock, mats.wood); stock.position.z = 6;
    const arms = new THREE.Mesh(geo.bow, mats.dark); arms.position.z = 16;
    bow.add(stock, arms);
    const ring = new THREE.Mesh(geo.ring, mats.ring);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 2.2; ring.renderOrder = 4;
    const xray = new THREE.Mesh(geo.ring, mats.xray);
    xray.rotation.x = -Math.PI / 2; xray.position.y = 2.2; xray.renderOrder = 19;
    for (const m of [legL, legR, body, head, hair, stock, arms]) m.castShadow = true;
    // the body is its own group so a fallen guard can lie down on its ring
    const figure = new THREE.Group();
    figure.name = 'survival-guard-figure';
    figure.add(legL, legR, body, head, hair, bow);
    group.add(figure, ring, xray);
    group.userData = { legL, legR, bow, figure, ring, xray, down: false };
    this.root.add(group);
    return group;
  }

  _syncSurvivalGuards(game, mode) {
    const list = (mode && mode.guards) || [];
    if (!this.survivalGuardMeshes) this.survivalGuardMeshes = [];
    const show = (game.screen === 'playing' || game.screen === 'paused') && (mode.phase === 'night' || mode.phase === 'day');
    for (let i = 0; i < list.length; i++) {
      let mesh = this.survivalGuardMeshes[i];
      if (!mesh) { mesh = this._makeSurvivalGuard(); this.survivalGuardMeshes[i] = mesh; }
      const guard = list[i];
      mesh.visible = show;
      if (!show) continue;
      const ud = mesh.userData;
      const down = !!guard.down;
      if (ud.down !== down) {
        // fallen: flat on its back across the ring, which turns red
        ud.down = down;
        ud.figure.rotation.x = down ? -Math.PI / 2 : 0;
        ud.figure.position.set(0, down ? 9 : 0, down ? 24 : 0);
        ud.ring.material = down ? this._guardMats.ringDown : this._guardMats.ring;
        ud.xray.material = down ? this._guardMats.xrayDown : this._guardMats.xray;
      }
      if (down) {
        // a slow pulse on the ring while it waits for the Hunter
        const k = 1 + 0.12 * Math.sin(game.time * 6 + i);
        ud.ring.scale.set(k, k, k);
        mesh.position.set(guard.x, 0, guard.y);
        mesh.rotation.y = Math.PI / 2 - guard.angle;
        continue;
      }
      if (ud.ring.scale.x !== 1) ud.ring.scale.set(1, 1, 1);
      const stride = guard.moving ? Math.sin(guard.walkT * 11) : 0;
      mesh.position.set(guard.x, guard.moving ? Math.abs(stride) * 2.4 : 0, guard.y);
      mesh.rotation.y = Math.PI / 2 - guard.angle;
      mesh.userData.legL.rotation.x = stride * 0.6;
      mesh.userData.legR.rotation.x = -stride * 0.6;
      mesh.userData.bow.position.z = 8 - guard.shotT * 22;
    }
    for (let i = list.length; i < this.survivalGuardMeshes.length; i++) this.survivalGuardMeshes[i].visible = false;
  }

  /**
   * The relief column (K1's third dawn): spearmen in royal blue with round
   * shields and kettle helms, and one banner-bearer carrying the keep's own
   * swallowtail. Spearmen share two InstancedMeshes (body, legs); the bearer
   * is one figure and the banner. Soft blob shadows ground them.
   */
  _makeRelief() {
    const cap = 16;
    const C = { tabard: 0x2f5fd8, trim: 0xf2efe6, belt: 0x4a3420, skin: 0xf2c9a0, steel: 0xb9c2cf, wood: 0x8a5a30, shield: 0x2448b0, gold: 0xffd24a, legs: 0x2c3140 };
    const torso = (rows) => {
      rows.push(
        [new THREE.CylinderGeometry(9.5, 12, 26, 8), C.tabard, 0, 28, 0],
        [new THREE.BoxGeometry(6, 21, 1.6), C.trim, 0, 27, 10.6],
        [new THREE.CylinderGeometry(12.1, 12.1, 3, 8), C.belt, 0, 21, 0],
        [new THREE.SphereGeometry(8.5, 12, 8), C.skin, 0, 49, 0],
        [new THREE.CylinderGeometry(9.6, 10, 6, 10), C.steel, 0, 53, 0],
        [new THREE.ConeGeometry(9.8, 9, 10), C.steel, 0, 60.5, 0],
        [new THREE.CylinderGeometry(13.5, 13.5, 1.6, 12), C.steel, 0, 50.2, 0],
        [new THREE.BoxGeometry(3.6, 14, 3.6), C.tabard, 11.5, 31, 2, -0.35, 0, 0],
      );
      return rows;
    };
    const spearRows = torso([]);
    spearRows.push(
      [new THREE.CylinderGeometry(11, 11, 2.4, 14), C.shield, -12.5, 30, 5, Math.PI / 2, 0, 0],
      [new THREE.CylinderGeometry(11.8, 11.8, 1.2, 14), C.gold, -12.5, 30, 4.2, Math.PI / 2, 0, 0],
      [new THREE.SphereGeometry(3.2, 8, 6), C.gold, -12.5, 30, 6.8],
      [new THREE.CylinderGeometry(1.3, 1.3, 88, 6), C.wood, 13, 46, 6],
      [new THREE.ConeGeometry(3, 11, 6), C.steel, 13, 95, 6],
    );
    const bearerRows = torso([]);
    bearerRows.push([new THREE.CylinderGeometry(1.8, 1.8, 132, 6), C.wood, 12, 62, 4]);
    bearerRows.push([new THREE.SphereGeometry(3.4, 8, 6), C.gold, 12, 129, 4]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, flatShading: true });
    const legGeo = mergeColoredParts([[new THREE.BoxGeometry(6.5, 17, 6.5).translate(0, -8.5, 0), C.legs]]);
    const inst = (geo, count, name) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      return mesh;
    };
    const blobGeo = new THREE.CircleGeometry(15, 16).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
    const blobs = new THREE.InstancedMesh(blobGeo, blobMat, cap);
    blobs.name = 'survival-relief-shadows';
    blobs.count = 0;
    blobs.frustumCulled = false;
    blobs.renderOrder = 2;
    blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(blobs);
    const bearer = new THREE.Mesh(mergeColoredParts(bearerRows), mat);
    bearer.name = 'survival-relief-bearer';
    bearer.visible = false;
    this.root.add(bearer);
    // the keep's banner on the pole: blue swallowtail with a gold trim
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(58, 0); shape.lineTo(48, -17); shape.lineTo(58, -34); shape.lineTo(0, -34); shape.closePath();
    const flag = new THREE.Group();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x3e6bff, emissive: 0x1a3aa8, emissiveIntensity: 0.4, roughness: 0.65, side: THREE.DoubleSide }));
    const trim = new THREE.Mesh(new THREE.BoxGeometry(58, 3.5, 1.2), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x8a6000, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.45 }));
    trim.position.set(29, -17, 0.5);
    flag.add(cloth, trim);
    flag.position.set(12, 124, 4);
    bearer.add(flag);
    return {
      cap, bodies: inst(mergeColoredParts(spearRows), cap, 'survival-relief-spearmen'),
      legs: inst(legGeo, cap * 2, 'survival-relief-legs'), blobs, bearer, flag,
      base: new THREE.Object3D(), part: new THREE.Object3D(), matrix: new THREE.Matrix4(),
    };
  }

  _syncRelief(game, mode) {
    const list = mode && mode.reinforcements;
    const show = !!(list && list.length) && mode.phase === 'complete' && (game.screen === 'playing' || game.screen === 'paused');
    if (!show) {
      const r = this.relief;
      if (r) { r.bodies.count = 0; r.legs.count = 0; r.blobs.count = 0; r.bodies.visible = r.legs.visible = r.blobs.visible = false; r.bearer.visible = false; }
      return;
    }
    if (!this.relief) this.relief = this._makeRelief();
    const r = this.relief;
    const { base, part, matrix } = r;
    const t = game.now || 0;
    let n = 0, legs = 0, blobs = 0;
    r.bearer.visible = false;
    for (const s of list) {
      if (blobs >= r.cap) break;
      const stride = s.moving ? Math.sin(s.walkT * 11) : 0;
      base.position.set(s.x, s.moving ? Math.abs(stride) * 2.6 : 0, s.y);
      base.rotation.set(0, Math.PI / 2 - s.angle, 0);
      base.scale.setScalar(1.12);
      base.updateMatrix();
      part.position.set(s.x, 0.6, s.y); part.rotation.set(0, 0, 0); part.scale.setScalar(1); part.updateMatrix();
      r.blobs.setMatrixAt(blobs++, part.matrix);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        part.position.set(sign * 4.6, 17, 0);
        part.rotation.set(stride * 0.62 * sign, 0, 0);
        part.updateMatrix();
        matrix.multiplyMatrices(base.matrix, part.matrix);
        r.legs.setMatrixAt(legs++, matrix);
      }
      if (s.role === 'banner') {
        r.bearer.visible = true;
        r.bearer.position.copy(base.position);
        r.bearer.rotation.copy(base.rotation);
        r.bearer.scale.copy(base.scale);
        r.flag.rotation.y = Math.sin(t * 2.4 + 0.6) * 0.32 - (s.moving ? 0.25 : 0);
        continue;
      }
      r.bodies.setMatrixAt(n++, base.matrix);
    }
    r.bodies.count = n; r.legs.count = legs; r.blobs.count = blobs;
    for (const mesh of [r.bodies, r.legs, r.blobs]) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; }
  }

  _syncSurvivalObjects(game) {
    const mode = game.survival;
    if (!mode) return;
    if (!this.survivalYard) this.survivalYard = this._makeSurvivalYard();
    this.survivalYard.visible = true;
    this.survivalYard.material.color.setHex(mode.daylight() ? 0x7c9a55 : 0x3f5a46);

    this._syncFortressDressing(game, mode);
    this._syncSurvivalKeep(game, mode);
    this._syncSurvivalTerritory(game, mode);
    this._syncSurvivalCircles(game, mode);

    // buildings stand on their circles (keyed by circle id)
    const activeBuildings = new Set();
    const pop = mode.lastBuilt && mode.uiClock - mode.lastBuilt.t < 0.35 ? mode.lastBuilt : null;
    for (const [slotId, type] of Object.entries(mode.buildings)) {
      const spot = mode.buildingSpot ? mode.buildingSpot(slotId) : null;
      if (!spot) continue;
      activeBuildings.add(slotId);
      let mesh = this.survivalBuildingMeshes.get(slotId);
      if (!mesh || mesh.userData.type !== type) {
        if (mesh) { this.root.remove(mesh); this.survivalBuildingMeshes.delete(slotId); }
        mesh = this._makeSurvivalBuilding(type);
        mesh.userData.type = type;
        this.survivalBuildingMeshes.set(slotId, mesh);
        this.root.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(spot.x, 0, spot.y);
      const level = mode.buildingLevel ? mode.buildingLevel(slotId) : 1;
      if (mesh.userData.level !== level) this._setSurvivalBuildingLevel(mesh, level);
      // a finished build pops: 0.85 → 1.08 → 1.0 over a quarter second
      const base = 1.3 + 0.18 * (level - 1);
      if (pop && pop.slotId === slotId) {
        const k = (mode.uiClock - pop.t) / 0.35;
        const s = k < 0.5 ? 0.85 + (1.08 - 0.85) * (k / 0.5) : 1.08 - 0.08 * ((k - 0.5) / 0.5);
        mesh.scale.setScalar(base * s);
      } else if (Math.abs(mesh.scale.x - base) > 1e-3) mesh.scale.setScalar(base);
      if (type === 'tower') this._syncSurvivalTower(mesh, mode, slotId);
    }
    for (const [slotId, mesh] of this.survivalBuildingMeshes) if (!activeBuildings.has(slotId)) mesh.visible = false;
    this._syncSurvivalTowerRing(game, mode);

    if (!this.survivalGateMesh) this.survivalGateMesh = this._makeSurvivalGate();
    const gate = mode.mainGate();
    this.survivalGateMesh.visible = !!(mode.gateBuilt && gate);
    if (gate && this.survivalGateMesh.visible) {
      this.survivalGateMesh.position.set(gate.x, 0, gate.y);
      if (gate.axis === 'v') this.survivalGateMesh.rotation.y = Math.PI / 2;
      else this.survivalGateMesh.rotation.y = 0;
      const scale = gate.w ? Math.max(0.7, Math.min(1.3, gate.w / 160)) : 1;
      this.survivalGateMesh.scale.set(scale, 1, 1);
    }

    this._syncSurvivalGuards(game, mode);
    this._syncRelief(game, mode);

    this._syncExteriorPalette(true);
    if (!this.survivalPlayerRing) this.survivalPlayerRing = this._makeSurvivalPlayerRing();
    const p = game.player;
    const showRing = (mode.phase === 'night' || mode.phase === 'day') && game.screen === 'playing' && !!p;
    this.survivalPlayerRing.visible = showRing;
    if (showRing) {
      this.survivalPlayerRing.position.set(p.x, 2.2, p.y);
      const pulse = 1 + 0.06 * Math.sin(game.time * 5);
      this.survivalPlayerRing.scale.set(pulse, 1, pulse);
    }
  }

  _syncVariants(game) {
    const active = new Set();
    for (const enemy of game.enemies || []) {
      if (!enemy.variant || enemy.dead) continue;
      const id = `variant:${enemy.id}`;
      active.add(id);
      let ring = this.variantRings.get(id);
      if (!ring) {
        const geometry = new THREE.RingGeometry(12, 16, 28);
        const material = new THREE.MeshBasicMaterial({ color: 0x9b3037, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        ring = new THREE.Mesh(geometry, material);
        ring.name = `enemy-variant-mark-3d-${enemy.variant}`;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 2.2;
        ring.renderOrder = 2;
        this.variantRings.set(id, ring);
        this.root.add(ring);
      }
      const base = enemy.tint || (enemy.variant === 'marksman' ? '#b8a252' : '#a52d38');
      ring.material.color.set(base);
      ring.material.opacity = (enemy.variant === 'master' ? 0.38 : 0.25) * (0.82 + Math.sin(game.time * 4 + enemy.id) * 0.18);
      ring.position.set(enemy.x, 2.2, enemy.y);
      const scale = Math.max(0.7, (enemy.radius || 12) / 12) * (enemy.sizeMul || 1);
      ring.scale.setScalar(scale);
      ring.visible = true;
    }
    for (const [id, ring] of this.variantRings) if (!active.has(id)) ring.visible = false;
  }

  _syncFoodCues(game) {
    const active = new Set();
    const player = game.player;
    const reach = weaponById(player.weapon).range;
    for (const enemy of game.enemies || []) {
      if (enemy.dead || enemy.alpha != null && enemy.alpha < 0.08) continue;
      const near = Math.hypot(enemy.x - player.x, enemy.y - player.y) < reach + (enemy.radius || 12) + 24;
      const hurt = enemy.hpMax > 0 && enemy.hp / enemy.hpMax < 0.72;
      if (!near && !hurt) continue;
      const id = `food:${enemy.id}`;
      active.add(id);
      let cue = this.foodCues.get(id);
      if (!cue) {
        const group = new THREE.Group();
        group.name = 'enemy-feed-cue-3d';
        const material = new THREE.MeshBasicMaterial({ color: 0xc01828, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(4, 9, 7), material);
        sphere.position.y = 3;
        sphere.scale.set(1, 1.12, 0.9);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(2.9, 6, 9), material);
        tip.position.y = 7.4;
        group.add(sphere, tip);
        this.root.add(group);
        cue = { group, material };
        this.foodCues.set(id, cue);
      }
      const height = (ENEMY_HEIGHT[enemy.key] || 74) * (enemy.sizeMul || 1) / VERTICAL_PROJECTION;
      const pulse = 0.55 + 0.35 * Math.abs(Math.sin(game.time * 4 + enemy.x * 0.01));
      cue.group.visible = true;
      cue.group.position.set(enemy.x, height + 15, enemy.y);
      cue.group.scale.setScalar(enemy.type && enemy.type.bloodValue > 24 ? 1.7 : 1);
      cue.material.opacity = pulse;
    }
    for (const [id, cue] of this.foodCues) if (!active.has(id)) cue.group.visible = false;
  }

  _syncDrinkTrails(game) {
    const active = new Set();
    if (!this.drinkGeometry) this.drinkGeometry = new THREE.SphereGeometry(2.4, 8, 6);
    for (const drink of game.drinks || []) {
      const id = this._idFor(drink, 'drink');
      active.add(id);
      let trail = this.drinkTrails.get(id);
      if (!trail) {
        const group = new THREE.Group();
        group.name = 'blood-feed-trail-3d';
        const material = new THREE.MeshBasicMaterial({ color: drink.color || '#b61b2c', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
        const drops = [];
        for (let i = 0; i < 8; i++) {
          const drop = new THREE.Mesh(this.drinkGeometry, material);
          group.add(drop);
          drops.push(drop);
        }
        this.root.add(group);
        trail = { group, material, drops };
        this.drinkTrails.set(id, trail);
      }
      const progress = clamp(drink.t / Math.max(0.001, drink.life), 0, 1);
      const height = 18 + (drink.amount || 0) * 0.15;
      trail.material.color.set(drink.color || '#b61b2c');
      trail.material.opacity = 0.78 * (1 - progress);
      trail.group.visible = progress < 1;
      for (let i = 0; i < trail.drops.length; i++) {
        const u = clamp(progress * 1.2 - i * 0.07, 0, 1);
        const x = drink.ox + (game.player.x - drink.ox) * u;
        const z = drink.oy + (game.player.y - drink.oy) * u;
        const arc = Math.sin(u * Math.PI) * height;
        const drop = trail.drops[i];
        drop.position.set(x, 12 + arc, z);
        drop.scale.setScalar(0.62 + (1 - i / 8) * 0.58);
      }
    }
    for (const [id, trail] of this.drinkTrails) {
      if (active.has(id)) continue;
      this.root.remove(trail.group);
      trail.material.dispose();
      this.drinkTrails.delete(id);
    }
  }

  _syncDirectorShadow(game) {
    const shadow = game.director && game.director.shadow;
    if (!this.directorShadow) {
      const group = new THREE.Group();
      group.name = 'director-shadow-3d';
      const material = new THREE.MeshBasicMaterial({ color: 0x080910, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
      body.scale.set(27, 2.6, 11);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), material);
      head.position.set(19, 1, 0);
      head.scale.set(9, 2.5, 8);
      group.add(body, head);
      this.root.add(group);
      this.directorShadow = { group, material };
      this.directorShadowLight = new THREE.PointLight(0x66597c, 0, 100, 2);
      this.directorShadowLight.name = 'director-shadow-haze-3d';
      this.scene.add(this.directorShadowLight);
    }
    const fx = this.directorShadow;
    if (!shadow) {
      fx.group.visible = false;
      this.directorShadowLight.intensity = 0;
      return;
    }
    const alpha = clamp(shadow.a || 0, 0, 1);
    fx.group.visible = alpha > 0.01;
    fx.group.position.set(shadow.x, 3, shadow.y);
    fx.group.rotation.y = -Math.atan2(shadow.vy || 0, shadow.vx || 1);
    fx.material.opacity = alpha * 0.52;
    this.directorShadowLight.position.set(shadow.x, 18, shadow.y);
    this.directorShadowLight.intensity = alpha * 0.3;
  }

  _makePickup(pickup) {
    const group = new THREE.Group();
    group.name = `pickup-3d-${pickup.kind || 'item'}`;
    if (pickup.kind === 'planks') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x63421f, roughness: 0.88 });
      const edge = new THREE.MeshStandardMaterial({ color: 0x98724a, roughness: 0.8 });
      const geometry = this.plankGeometry || (this.plankGeometry = new THREE.BoxGeometry(24, 3.4, 6));
      for (let i = 0; i < Math.min(3, Math.max(1, pickup.amount || 1)); i++) {
        const plank = new THREE.Mesh(geometry, i === 0 ? wood : edge);
        plank.position.set((i - 1) * 2.5, i * 3.2, (i % 2) * 1.7);
        plank.rotation.y = i * 0.08 - 0.08;
        plank.castShadow = true;
        group.add(plank);
      }
    } else if (pickup.kind === 'blood') {
      const glass = new THREE.MeshStandardMaterial({ color: 0x7b4850, roughness: 0.2, metalness: 0.12, transparent: true, opacity: 0.72 });
      const blood = new THREE.MeshStandardMaterial({ color: 0xb21a30, emissive: 0x5c0712, emissiveIntensity: 0.7, roughness: 0.3 });
      const cap = new THREE.MeshStandardMaterial({ color: 0x9d8a63, metalness: 0.6, roughness: 0.35 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 17, 12), glass);
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 10, 10), blood);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 4, 10), cap);
      liquid.position.y = -2;
      top.position.y = 10.3;
      group.add(body, liquid, top);
    } else {
      if (!this.pickupGeometry) this.pickupGeometry = new THREE.OctahedronGeometry(9, 0);
      const color = pickup.color || 0xc8a96c;
      group.add(new THREE.Mesh(this.pickupGeometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.36 })));
    }
    group.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    return group;
  }

  _syncPickups(game) {
    const active = new Set();
    for (const pickup of game.pickups || []) {
      if (pickup.taken) continue;
      const id = pickup.id || this._idFor(pickup, 'pickup');
      active.add(id);
      let mesh = this.pickups.get(id);
      if (!mesh) {
        mesh = this._makePickup(pickup);
        this.pickups.set(id, mesh);
        this.root.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(pickup.x, 16 + Math.sin(game.now * 3 + pickup.x) * 3, pickup.y);
      mesh.rotation.set(game.now * 0.4, game.now * 1.2, 0);
    }
    for (const [id, mesh] of this.pickups) if (!active.has(id)) mesh.visible = false;
  }

  /** Which mesh/trail recipe a bolt uses (pooled per look). */
  _boltLook(bolt) {
    if (bolt.kind === 'knife') return 'knife';
    if (bolt.tower) return 'tower';
    if (bolt.guard) return 'guard';
    if (bolt.friendly) return 'tracer';
    return bolt.kit && bolt.kit.blessed ? 'blessed' : 'plain';
  }

  _makeBoltMesh(look) {
    if (look === 'knife') {
      const mesh = new THREE.Group();
      const blade = new THREE.Mesh(this.knifeGeometry, new THREE.MeshStandardMaterial({
        color: 0xb6c3cd, metalness: 0.72, roughness: 0.24, emissive: 0x111820, emissiveIntensity: 0.12,
      }));
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.65, 8, 5), new THREE.MeshStandardMaterial({
        color: 0x423329, roughness: 0.88, metalness: 0.02,
      }));
      handle.position.y = -12;
      mesh.add(blade, handle);
      mesh.name = 'throwing-knife-3d';
      return mesh;
    }
    if (look === 'tracer' || look === 'guard' || look === 'tower') {
      // Survival reads at phone zoom: a thick, unlit tracer instead of a
      // 1px wooden shaft. Warm for the Hunter, cool blue for the guards, a
      // fat red-orange ballista bolt for a tower.
      const mesh = new THREE.Mesh(this.boltGeometry, new THREE.MeshBasicMaterial({
        color: look === 'guard' ? 0xa8ecff : look === 'tower' ? 0xff7a3a : 0xffe08a, toneMapped: false,
      }));
      if (look === 'tower') mesh.scale.set(4, 2.1, 4);
      else mesh.scale.set(2.6, 1.5, 2.6);
      mesh.name = look === 'guard' ? 'guard-bolt-3d' : look === 'tower' ? 'tower-bolt-3d' : 'crossbow-bolt-3d';
      return mesh;
    }
    const blessed = look === 'blessed';
    const mesh = new THREE.Mesh(this.boltGeometry, new THREE.MeshStandardMaterial({
      color: blessed ? 0xffedb0 : 0xa88a5d,
      emissive: blessed ? 0xd29a38 : 0x19130d,
      emissiveIntensity: blessed ? 0.8 : 0.08,
      roughness: 0.55,
    }));
    mesh.name = 'crossbow-bolt-3d';
    return mesh;
  }

  _makeBoltTrail(look) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const bright = look === 'tracer' || look === 'guard' || look === 'tower';
    const material = new THREE.LineBasicMaterial({
      color: look === 'knife' ? 0xc4d4e0 : look === 'guard' ? 0x7fd8ff : look === 'tower' ? 0xff6a2a : look === 'tracer' ? 0xffc04a : look === 'blessed' ? 0xffe2a2 : 0x9b9aa9,
      transparent: true, opacity: bright ? 0.8 : 0.42, depthWrite: false, toneMapped: false,
    });
    const line = new THREE.Line(geometry, material);
    line.name = look === 'knife' ? 'throwing-knife-trail-3d' : 'crossbow-bolt-trail-3d';
    line.frustumCulled = false;
    return line;
  }

  /**
   * Bolt meshes are pooled per look. Survival fires thousands of bolts over a
   * run (Hunter + guards); one fresh mesh + material + trail per bolt that was
   * only ever hidden made the scene graph grow for the whole session.
   */
  _syncBolts(game) {
    if (!this.boltGeometry) this.boltGeometry = new THREE.CylinderGeometry(1.2, 1.2, 26, 6, 1);
    if (!this.knifeGeometry) this.knifeGeometry = new THREE.ConeGeometry(1.8, 20, 5, 1);
    if (!this.boltPool) this.boltPool = new Map();
    const active = new Set();
    const up = this._boltUp || (this._boltUp = new THREE.Vector3(0, 1, 0));
    const direction = this._boltDir || (this._boltDir = new THREE.Vector3());
    for (const bolt of game.bolts || []) {
      if (bolt.dead) continue;
      const id = bolt.id || this._idFor(bolt, 'bolt');
      active.add(id);
      let mesh = this.bolts.get(id);
      let trail = this.boltTrails.get(id);
      if (!mesh) {
        const look = this._boltLook(bolt);
        const pool = this.boltPool.get(look);
        const spare = pool && pool.pop();
        if (spare) { mesh = spare.mesh; trail = spare.trail; }
        else {
          mesh = this._makeBoltMesh(look);
          trail = this._makeBoltTrail(look);
          mesh.userData.boltLook = look;
          this.root.add(mesh);
          this.root.add(trail);
        }
        this.bolts.set(id, mesh);
        this.boltTrails.set(id, trail);
      }
      // a tower's bolt leaves the ballista on the deck and drops to body
      // height where it was aimed; everything else flies at 18
      const muzzle = bolt.tower ? this._towerMuzzle(bolt) : 0;
      const heightAt = (x, y) => (muzzle > 0
        ? 18 + muzzle * Math.max(0, 1 - Math.hypot(x - bolt.ox, y - bolt.oy) / Math.max(1, bolt.aimDist || 1))
        : 18);
      const bh = heightAt(bolt.x, bolt.y);
      direction.set(Math.cos(bolt.angle || 0), 0, Math.sin(bolt.angle || 0));
      if (muzzle > 0 && bh > 18.5) direction.y = -muzzle / Math.max(1, bolt.aimDist || 1);
      direction.normalize();
      mesh.position.set(bolt.x, bh, bolt.y);
      mesh.quaternion.setFromUnitVectors(up, direction);
      mesh.visible = true;
      const points = bolt.trail || [];
      const attribute = trail.geometry.getAttribute('position');
      const pointCount = Math.min(points.length, 6);
      for (let i = 0; i < pointCount; i++) attribute.setXYZ(i, points[i].x, heightAt(points[i].x, points[i].y), points[i].y);
      if (pointCount < 7) attribute.setXYZ(pointCount, bolt.x, bh, bolt.y);
      attribute.needsUpdate = true;
      trail.geometry.setDrawRange(0, pointCount + 1);
      trail.visible = pointCount > 0;
    }
    for (const [id, mesh] of this.bolts) {
      if (active.has(id)) continue;
      const trail = this.boltTrails.get(id);
      mesh.visible = false;
      if (trail) trail.visible = false;
      this.bolts.delete(id);
      this.boltTrails.delete(id);
      const look = mesh.userData.boltLook || 'plain';
      let pool = this.boltPool.get(look);
      if (!pool) this.boltPool.set(look, (pool = []));
      if (pool.length < 64 && trail) pool.push({ mesh, trail });
      else {
        this.root.remove(mesh);
        if (trail) { this.root.remove(trail); trail.geometry.dispose(); trail.material.dispose(); }
        if (mesh.material && mesh.material.dispose) mesh.material.dispose();
      }
    }
  }

  _hideLegacyWorldCues() {
    for (const group of this.roomMarks) group.visible = false;
    if (this.houseCat) this.houseCat.visible = false;
    for (const rig of this.hauntWatchers) rig.group.visible = false;
    for (const mesh of this.houseDrafts.values()) mesh.group.visible = false;
    for (const cue of this.doorCues.values()) cue.group.visible = false;
    if (this.interactionCue) this.interactionCue.visible = false;
    if (this.directorShadow) this.directorShadow.visible = false;
    if (this.directorShadowLight) this.directorShadowLight.intensity = 0;
  }

  _syncRoomMarks(game) {
    if (this.roomMarksBuilt) return;
    const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...options });
    const wood = mat(0x3c291a);
    const gold = mat(0xb08a48, { metalness: 0.5, roughness: 0.4 });
    const dark = mat(0x17151a);
    const red = mat(0x751923, { emissive: 0x25030a });
    const glass = mat(0xd6e4ef, { metalness: 0.18, roughness: 0.16, transparent: true, opacity: 0.84 });
    const ward = mat(0xc5a354, { emissive: 0x31220b, metalness: 0.45, roughness: 0.44, side: THREE.DoubleSide });
    for (const mark of ROOM_MARKS) {
      const room = game.mansion.room(mark.room);
      if (!room) continue;
      const x = room.x + room.w * mark.ox;
      const z = room.y + room.h * mark.oy;
      const group = new THREE.Group();
      group.name = `room-mark-3d-${mark.room}-${mark.kind}`;
      group.position.set(x, 0, z);
      const add = (geometry, material, px, py, pz, sx = 1, sy = 1, sz = 1) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(px, py, pz);
        mesh.scale.set(sx, sy, sz);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      if (mark.kind === 'latch') {
        add(new THREE.BoxGeometry(32, 2, 8), wood, 0, 2, 0);
        add(new THREE.SphereGeometry(3.5, 10, 8), gold, 11, 4, 0);
      } else if (mark.kind === 'threshold') {
        add(new THREE.BoxGeometry(48, 2, 10), wood, 0, 2, 0);
        add(new THREE.BoxGeometry(50, 0.6, 1), gold, 0, 3, 5);
      } else if (mark.kind === 'cloth') {
        const patch = add(new THREE.PlaneGeometry(34, 20), red, 0, 2, 0);
        patch.rotation.x = -Math.PI / 2;
        add(new THREE.BoxGeometry(30, 0.7, 1), gold, 0, 2.7, 9);
      } else if (mark.kind === 'glass') {
        const shard = add(new THREE.OctahedronGeometry(12, 0), glass, 0, 4, 0, 1, 0.22, 0.76);
        shard.rotation.y = 0.4;
        add(new THREE.BoxGeometry(12, 0.5, 1), mat(0xf3f5f8, { emissive: 0x69717a }), 0, 5, 0);
      } else if (mark.kind === 'ward') {
        const circle = add(new THREE.TorusGeometry(16, 1.2, 7, 32), ward, 0, 2, 0);
        circle.rotation.x = Math.PI / 2;
        add(new THREE.BoxGeometry(26, 0.8, 0.9), ward, 0, 2.4, 0).rotation.y = Math.PI / 4;
        add(new THREE.BoxGeometry(26, 0.8, 0.9), ward, 0, 2.4, 0).rotation.y = -Math.PI / 4;
      } else if (mark.kind === 'basin') {
        add(new THREE.CylinderGeometry(18, 15, 7, 18), dark, 0, 4, 0);
        add(new THREE.CylinderGeometry(13, 13, 1, 18), red, 0, 8, 0);
      } else if (mark.kind === 'dish') {
        add(new THREE.CylinderGeometry(11, 10, 2, 16), dark, 0, 1.5, 0);
        const rim = add(new THREE.TorusGeometry(9, 1, 6, 20), gold.clone(), 0, 3, 0);
        rim.material.side = THREE.DoubleSide;
        rim.rotation.x = Math.PI / 2;
      } else if (mark.kind === 'stake') {
        add(new THREE.BoxGeometry(3, 40, 3), wood, 0, 21, 0);
        add(new THREE.BoxGeometry(18, 3, 3), wood, 0, 28, 0);
        add(new THREE.SphereGeometry(3.2, 10, 8), red, 0, 2, 0);
      }
      this.root.add(group);
      this.roomMarks.push(group);
    }
    this.roomMarksBuilt = true;
  }

  _makeCat() {
    const group = new THREE.Group();
    group.name = 'house-cat-3d';
    const coat = new THREE.MeshStandardMaterial({ color: 0x08090d, roughness: 0.96 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xb8d68c, emissive: 0x496b2e, transparent: true, opacity: 0, toneMapped: false });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), coat);
    body.position.set(0, 5.5, 0);
    body.scale.set(14, 4.8, 5.6);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), coat);
    head.position.set(10.5, 8.5, 0);
    head.scale.set(5.2, 4.4, 4.3);
    group.add(body, head);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 5), coat);
      ear.position.set(11.2, 13, side * 2.3);
      group.add(ear);
      const eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 5), eye);
      eyeMesh.position.set(14, 9.2, side * 1.75);
      eyeMesh.userData.catEye = true;
      group.add(eyeMesh);
    }
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-11, 6, 0), new THREE.Vector3(-17, 9, 0),
      new THREE.Vector3(-20, 3, 0), new THREE.Vector3(-25, 5, 0),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 1.1, 5, false), coat));
    this.root.add(group);
    this.houseCat = group;
    return group;
  }

  _makeWatcher() {
    const group = new THREE.Group();
    group.name = 'haunt-watcher-3d';
    const shade = new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 1, transparent: true, opacity: 0, depthWrite: false });
    const eyes = new THREE.MeshBasicMaterial({ color: 0xb83e35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 28, 8), shade);
    torso.position.y = 17;
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.3, 8, 7), shade);
    head.position.y = 36;
    group.add(torso, head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 5), eyes);
      eye.position.set(side * 1.7, 37, 4.6);
      eye.userData.watcherEye = true;
      group.add(eye);
    }
    this.root.add(group);
    return { group, shade, eyes };
  }

  _syncHouseAtmosphere(game) {
    const cat = game.house && game.house.cat;
    if (cat) {
      if (!this.houseCat) this._makeCat();
      const bob = Math.sin(cat.t * 16) * 1.2;
      this.houseCat.visible = true;
      this.houseCat.position.set(cat.x, 0, cat.y);
      this.houseCat.rotation.y = cat.tx >= cat.x ? 0 : Math.PI;
      this.houseCat.children[0].position.y = 5.5 + bob;
      this.houseCat.children[1].position.y = 8.5 + bob;
      const look = Math.abs(Math.atan2(cat.y - game.player.y, cat.x - game.player.x) - game.player.angle) < 0.6
        && Math.hypot(game.player.x - cat.x, game.player.y - cat.y) < 330;
      for (const child of this.houseCat.children) if (child.userData.catEye) child.material.opacity = look ? 0.9 : 0;
    } else if (this.houseCat) this.houseCat.visible = false;

    const watchers = (game.haunts && game.haunts.watchers) || [];
    while (this.hauntWatchers.length < watchers.length) this.hauntWatchers.push(this._makeWatcher());
    for (let i = 0; i < this.hauntWatchers.length; i++) {
      const rig = this.hauntWatchers[i];
      const watcher = watchers[i];
      if (!watcher) { rig.group.visible = false; continue; }
      const k = Math.sin(clamp(watcher.t / Math.max(0.01, watcher.life), 0, 1) * Math.PI);
      const alpha = 0.34 * clamp(k * 1.6, 0, 1);
      rig.group.visible = alpha > 0.01;
      rig.group.position.set(watcher.x, 0, watcher.y);
      rig.group.rotation.y = Math.atan2(game.player.x - watcher.x, game.player.y - watcher.y);
      rig.shade.opacity = alpha;
      rig.eyes.opacity = alpha * (0.5 + Math.sin(watcher.t * 11) * 0.5) * 1.4;
    }

    const drafts = (game.house && game.house.drafts) || [];
    const activeDrafts = new Set();
    for (const draft of drafts) {
      const entrance = draft.e;
      if (!entrance) continue;
      const id = entrance.id;
      activeDrafts.add(id);
      let mesh = this.houseDrafts.get(id);
      if (!mesh) {
        const group = new THREE.Group();
        group.name = `door-draft-3d-${id}`;
        const material = new THREE.MeshStandardMaterial({ color: 0x8da9cd, emissive: 0x324c72, transparent: true, opacity: 0, depthWrite: false });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(32, 4, 3), material);
        bar.position.y = 76;
        group.add(bar);
        group.rotation.y = entrance.axis === 'h' ? 0 : Math.PI / 2;
        this.root.add(group);
        mesh = { group, material };
        this.houseDrafts.set(id, mesh);
      }
      const pulse = Math.sin(clamp(draft.t / 1.6, 0, 1) * Math.PI);
      mesh.group.position.set(entrance.x, 0, entrance.y);
      mesh.material.opacity = 0.5 * pulse;
      mesh.group.visible = pulse > 0.01;
    }
    for (const [id, mesh] of this.houseDrafts) if (!activeDrafts.has(id)) mesh.group.visible = false;

    const activeCues = new Set();
    for (const entrance of game.mansion.entrances || []) {
      if (entrance.kind !== 'door') continue;
      const id = entrance.id;
      const urgent = entrance.attackers > 0 || entrance.hint > 0 || entrance.flash > 0 || (entrance.knock && !entrance.broken);
      if (!urgent) continue;
      activeCues.add(id);
      let cue = this.doorCues.get(id);
      if (!cue) {
        const length = entrance.axis === 'h' ? entrance.w : entrance.h;
        const height = 2.35 * PX_PER_METRE;
        const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(length + 14, height + 12, 8));
        const material = new THREE.LineBasicMaterial({ color: 0x8fb0d8, transparent: true, opacity: 0, depthWrite: false });
        const lines = new THREE.LineSegments(geometry, material);
        const group = new THREE.Group();
        group.name = `door-cue-3d-${id}`;
        group.position.set(entrance.x, height / 2, entrance.y);
        group.rotation.y = entrance.axis === 'h' ? 0 : Math.PI / 2;
        group.add(lines);
        this.root.add(group);
        cue = { group, material };
        this.doorCues.set(id, cue);
      }
      const pulse = 0.34 + 0.22 * Math.sin(game.time * 5);
      const strength = entrance.attackers > 0 ? 1 : Math.max(entrance.flash || 0, entrance.hint || 0, pulse);
      cue.material.opacity = clamp(pulse * strength, 0.08, 0.75);
      cue.group.visible = !entrance.broken;
    }
    for (const [id, cue] of this.doorCues) if (!activeCues.has(id)) cue.group.visible = false;
  }

  _syncInteractionCue(game) {
    const target = game.interactTarget;
    if (!target || !target.ent || !target.actions || !target.actions.length) {
      if (this.interactionCue) this.interactionCue.visible = false;
      return;
    }
    if (!this.interactionCue) {
      const group = new THREE.Group();
      group.name = 'active-interaction-cue-3d';
      const material = new THREE.MeshStandardMaterial({ color: 0xd7ba75, emissive: 0x78602d, emissiveIntensity: 0.8, roughness: 0.4 });
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(5.5, 0), material);
      diamond.position.y = 72;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(15, 18, 24),
        new THREE.MeshBasicMaterial({ color: 0xd2b56d, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.8;
      group.add(diamond, ring);
      this.root.add(group);
      this.interactionCue = group;
    }
    const entity = target.ent;
    this.interactionCue.visible = true;
    this.interactionCue.position.set(entity.x, 0, entity.y);
    this.interactionCue.children[0].rotation.y = game.time * 1.7;
    this.interactionCue.children[0].position.y = 72 + Math.sin(game.time * 3.5) * 3.2;
    this.interactionCue.children[1].material.opacity = 0.4 + Math.abs(Math.sin(game.time * 3)) * 0.36;
  }

  _syncPlayerSwing(game) {
    const player = game.player;
    const age = player && player.slashAge;
    const hideMelee = () => {
      if (this.playerSwing) this.playerSwing.visible = false;
      if (this.playerSwingRibbon) this.playerSwingRibbon.visible = false;
    };
    if (age == null || age > 0.5 || player.state === 'death') {
      hideMelee();
      if (this.playerFlash) this.playerFlash.visible = false;
      return;
    }
    const weapon = weaponById(player.weapon);
    if (weapon.kind === 'ranged') {
      if (!this.playerFlash) {
        const material = new THREE.MeshBasicMaterial({
          color: 0xffcc86, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        });
        this.playerFlash = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 8), material);
        this.playerFlash.name = 'player-muzzle-flash-3d';
        this.root.add(this.playerFlash);
      }
      const fade = age > 0.22 ? 0 : clamp(1 - age / 0.22, 0, 1);
      const angle = player.swingAngle == null ? player.angle : player.swingAngle;
      this.playerFlash.position.set(player.x + Math.cos(angle) * 18, 34, player.y + Math.sin(angle) * 18);
      this.playerFlash.scale.setScalar(0.8 + fade * 1.5);
      this.playerFlash.material.opacity = 0.82 * fade;
      this.playerFlash.visible = fade > 0.01;
      hideMelee();
      return;
    }

    if (!this.playerSwing) {
      const segments = 28;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * segments * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.LineBasicMaterial({ color: 0xfff0e8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      this.playerSwing = new THREE.LineSegments(geometry, material);
      this.playerSwing.name = 'player-claw-edge-3d';
      this.playerSwing.frustumCulled = false;
      this.playerSwing.renderOrder = 5;
      this.root.add(this.playerSwing);
    }
    if (!this.playerSwingRibbon) {
      const segments = 28;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.MeshBasicMaterial({
        color: 0xff4652, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      });
      this.playerSwingRibbon = new THREE.Mesh(geometry, material);
      this.playerSwingRibbon.name = 'player-claw-ribbon-3d';
      this.playerSwingRibbon.frustumCulled = false;
      this.playerSwingRibbon.renderOrder = 4;
      this.root.add(this.playerSwingRibbon);
    }

    const sweep = clamp(age / 0.16, 0, 1);
    const fade = sweep * (age < 0.2 ? 1 : clamp(1 - (age - 0.2) / 0.3, 0, 1));
    if (fade < 0.04) { hideMelee(); return; }
    const start = -weapon.arc / 2 + (1 - sweep) * weapon.arc * 0.35;
    const end = -weapon.arc / 2 + sweep * weapon.arc;
    const angle = visualAngle(player.swingAngle == null ? player.angle : player.swingAngle, game.renderer);
    const camera = EnvKit.camera;
    camera.updateMatrixWorld(true);
    const right = this._swingRight || (this._swingRight = new THREE.Vector3());
    const up = this._swingUp || (this._swingUp = new THREE.Vector3());
    const origin = this._swingOrigin || (this._swingOrigin = new THREE.Vector3());
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    origin.set(player.x, 26, player.y);

    const writePoint = (attribute, vertex, a, radius) => {
      const c = Math.cos(a) * radius;
      const s = -Math.sin(a) * radius;
      attribute.setXYZ(vertex,
        origin.x + right.x * c + up.x * s,
        origin.y + right.y * c + up.y * s,
        origin.z + right.z * c + up.z * s);
    };

    // A filled, tapered crescent carries the slash; the bright segmented edge
    // keeps it crisp against the 3D floor without resorting to screen flash.
    const positions = this.playerSwing.geometry.getAttribute('position');
    const ribbonPositions = this.playerSwingRibbon.geometry.getAttribute('position');
    let lineVertex = 0;
    let ribbonVertex = 0;
    const segments = 28;
    for (let i = 0; i < segments; i++) {
      const a0 = start + (end - start) * i / segments + angle;
      const a1 = start + (end - start) * (i + 1) / segments + angle;
      for (let ring = 0; ring < 3; ring++) {
        const radius = weapon.range * (0.62 + ring * 0.19);
        writePoint(positions, lineVertex++, a0, radius);
        writePoint(positions, lineVertex++, a1, radius);
      }
      const inner = weapon.range * 0.42;
      const outer = weapon.range * 1.13;
      // Two triangles: inner0 → outer0 → outer1 and inner0 → outer1 → inner1.
      writePoint(ribbonPositions, ribbonVertex++, a0, inner);
      writePoint(ribbonPositions, ribbonVertex++, a0, outer);
      writePoint(ribbonPositions, ribbonVertex++, a1, outer);
      writePoint(ribbonPositions, ribbonVertex++, a0, inner);
      writePoint(ribbonPositions, ribbonVertex++, a1, outer);
      writePoint(ribbonPositions, ribbonVertex++, a1, inner);
    }
    positions.needsUpdate = true;
    ribbonPositions.needsUpdate = true;
    this.playerSwing.geometry.setDrawRange(0, lineVertex);
    this.playerSwingRibbon.geometry.setDrawRange(0, ribbonVertex);

    const silver = !!(player.kit && player.kit.silver);
    const blessed = !!(player.kit && player.kit.blessed);
    const tint = silver ? 0x9fd7ff : blessed ? 0xffc85d : 0xe6283f;
    const edge = silver ? 0xe7f6ff : blessed ? 0xfff0c2 : 0xffd6d8;
    this.playerSwingRibbon.material.color.setHex(tint);
    this.playerSwingRibbon.material.opacity = (player.frenzy ? 0.38 : 0.3) * fade;
    this.playerSwingRibbon.visible = true;
    this.playerSwing.material.color.setHex(edge);
    this.playerSwing.material.opacity = (player.frenzy ? 1 : 0.88) * fade;
    this.playerSwing.visible = true;
    if (this.playerFlash) this.playerFlash.visible = false;
  }

  _particleColor(value) {
    const key = String(value || '#ffffff');
    if (this.particleColorCache.has(key)) return this.particleColorCache.get(key);
    const color = new THREE.Color();
    let alpha = 1;
    const rgba = key.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    try {
      if (rgba) {
        color.setStyle(`rgb(${rgba[1]},${rgba[2]},${rgba[3]})`);
        alpha = rgba[4] == null ? 1 : Number(rgba[4]);
      } else color.setStyle(key);
    } catch (_) {
      color.set('#ffffff');
    }
    const parsed = [color.r, color.g, color.b, Number.isFinite(alpha) ? alpha : 1];
    this.particleColorCache.set(key, parsed);
    return parsed;
  }

  _syncParticles(game) {
    const list = (game.particles && game.particles.list) || [];
    const simCapacity = Math.max(16, game.particles && game.particles.max || list.length || 16);
    const capacity = simCapacity + 26;
    if (!this.particleCloud || capacity !== this.particleCapacity) {
      if (this.particleCloud) {
        this.root.remove(this.particleCloud);
        this.particleCloud.geometry.dispose();
        this.particleCloud.material.dispose();
      }
      this.particleCapacity = capacity;
      const geometry = new THREE.BufferGeometry();
      const attribute = (name, size) => {
        const data = new Float32Array(capacity * size);
        geometry.setAttribute(name, new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage));
      };
      attribute('position', 3);
      attribute('aColor', 3);
      attribute('aAlpha', 1);
      attribute('aWorldSize', 1);
      attribute('aSoft', 1);
      attribute('aShape', 1);
      attribute('aRotation', 1);
      const material = new THREE.ShaderMaterial({
        uniforms: { uPixelHeight: { value: 1 } },
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      this.particleCloud = new THREE.Points(geometry, material);
      this.particleCloud.name = 'world-particles-3d';
      this.particleCloud.frustumCulled = false;
      this.particleCloud.renderOrder = 3;
      this.root.add(this.particleCloud);
    }

    const object = this.particleCloud;
    object.material.uniforms.uPixelHeight.value = Math.max(1, Math.round(game.renderer.view.h * game.renderer.dpr));
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const color = geometry.getAttribute('aColor');
    const alpha = geometry.getAttribute('aAlpha');
    const size = geometry.getAttribute('aWorldSize');
    const soft = geometry.getAttribute('aSoft');
    const shape = geometry.getAttribute('aShape');
    const rotation = geometry.getAttribute('aRotation');
    const simCount = Math.min(list.length, simCapacity);
    const roomId = game.mansion.findRoom(game.player.x, game.player.y);
    const room = roomId !== ROOM.OUTSIDE ? game.mansion.room(roomId) : null;
    const moteCount = room ? 26 : 0;
    const now = game.now || game.time || 0;
    for (let i = 0; i < simCount; i++) {
      const p = list[i];
      const t = clamp(p.life / Math.max(0.001, p.maxLife || 1), 0, 1);
      let radius;
      if (p.type === 'glow' || p.glow) radius = p.size * (2.4 - t);
      else if (p.type === 'mist') radius = p.size * (2.2 - t * 0.9);
      else radius = p.size * (p.type === 'blood' ? 1 : t * 0.6 + 0.4);
      const parsed = this._particleColor(p.color);
      position.setXYZ(i, p.x, 9 + (p.z || 0), p.y);
      color.setXYZ(i, parsed[0], parsed[1], parsed[2]);
      alpha.setX(i, clamp((p.alpha == null ? 1 : p.alpha) * (p.type === 'dust' ? t * 0.6 : t) * parsed[3], 0, 1));
      size.setX(i, Math.max(0.5, radius * 2));
      soft.setX(i, p.type === 'mist' || p.type === 'glow' || p.glow ? 1 : 0);
      shape.setX(i, p.type === 'shard' ? 1 : 0);
      rotation.setX(i, p.rot || 0);
    }
    for (let i = 0; i < moteCount; i++) {
      const index = simCount + i;
      const seed = i * 37.1;
      const x = room.x + ((seed * 7.3 + now * (6 + i % 5)) % room.w);
      const z = room.y + ((seed * 3.7 + Math.sin(now * 0.4 + i) * 40 + room.h * 0.5) % room.h);
      position.setXYZ(index, x, 52 + Math.sin(now * 0.7 + i) * 7, z);
      color.setXYZ(index, 0.52, 0.58, 0.72);
      alpha.setX(index, 0.05 + 0.09 * Math.abs(Math.sin(now * 1.4 + i)));
      size.setX(index, 4 + (i % 3) * 1.7);
      soft.setX(index, 1);
      shape.setX(index, 0);
      rotation.setX(index, 0);
    }
    const count = Math.min(simCount + moteCount, this.particleCapacity);
    for (const attribute of [position, color, alpha, size, soft, shape, rotation]) attribute.needsUpdate = true;
    geometry.setDrawRange(0, count);
    object.visible = count > 0;
    this.lastParticleCount = count;
  }

  _syncDecals(game) {
    const decals = game.decals;
    if (!decals || !decals.canvas) return;
    if (!this.decalMesh || this.decalSource !== decals.canvas) {
      if (this.decalMesh) {
        this.root.remove(this.decalMesh);
        this.decalMesh.geometry.dispose();
        this.decalMesh.material.dispose();
        this.decalTexture.dispose();
      }
      this.decalSource = decals.canvas;
      const scale = Math.min(1, 2048 / Math.max(decals.canvas.width, decals.canvas.height));
      this.decalUploadCanvas = document.createElement('canvas');
      this.decalUploadCanvas.width = Math.max(1, Math.round(decals.canvas.width * scale));
      this.decalUploadCanvas.height = Math.max(1, Math.round(decals.canvas.height * scale));
      this.decalUploadCanvas.getContext('2d').drawImage(decals.canvas, 0, 0, this.decalUploadCanvas.width, this.decalUploadCanvas.height);
      this.decalTexture = new THREE.CanvasTexture(this.decalUploadCanvas);
      this.decalNeedsUpload = true;
      this.decalTexture.colorSpace = THREE.SRGBColorSpace;
      this.decalTexture.magFilter = THREE.LinearFilter;
      this.decalTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.decalTexture.generateMipmaps = true;
      const bounds = game.mansion.bounds;
      const geometry = new THREE.PlaneGeometry(decals.canvas.width, decals.canvas.height);
      const material = new THREE.MeshBasicMaterial({
        map: this.decalTexture,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        toneMapped: false,
      });
      this.decalMesh = new THREE.Mesh(geometry, material);
      this.decalMesh.name = 'blood-and-footprint-decals-3d';
      this.decalMesh.rotation.x = -Math.PI / 2;
      this.decalMesh.position.set(bounds.x + bounds.w / 2, 1.5, bounds.y + bounds.h / 2);
      this.decalMesh.frustumCulled = false;
      this.decalMesh.renderOrder = 1;
      this.root.add(this.decalMesh);
    }
    if (decals.dirty || this.decalNeedsUpload) {
      const context = this.decalUploadCanvas.getContext('2d');
      context.clearRect(0, 0, this.decalUploadCanvas.width, this.decalUploadCanvas.height);
      context.drawImage(decals.canvas, 0, 0, this.decalUploadCanvas.width, this.decalUploadCanvas.height);
      this.decalTexture.needsUpdate = true;
      this.decalNeedsUpload = false;
      decals.dirty = false;
      this.lastDecalUploads++;
    }
  }

  render(game) {
    EnvKit.init();
    this._attachCanvas();
    if (this.contextLost) {
      this.setVisible(false);
      this.lastError = 'WebGL context lost; waiting for browser restoration.';
      return false;
    }
    if (!EnvKit.ready || EnvKit.failed || !Valen3D.scene) {
      this.setVisible(false);
      this.lastError = EnvKit.error || (EnvKit.failed ? 'Environment kit failed to load.' : null);
      return false;
    }
    if (!this._ensureWorld(game)) return false;
    this.setVisible(true);
    if (game.mode === 'survival') this._hideLegacyWorldCues();
    else {
      this._syncRoomMarks(game);
      this._syncHouseAtmosphere(game);
      this._syncInteractionCue(game);
    }
    this.lastRoomCount = game.mansion.roomList.length;
    this.lastEntranceCount = game.mansion.entrances.length;
    this.lastPortalCount = game.mansion.portals.length;
    if (game.mode === 'survival' && game.survivalBakeDirty) {
      EnvKit.bakeKey = '';
      game.survivalBakeDirty = false;
    }
    const fortressLevel = game.mode === 'survival' ? 0 : game.save.fortressLevel;
    EnvKit.sync(game.mansion.entrances, game.mansion, fortressLevel, game);
    if (EnvKit.quality !== game.quality) EnvKit.setQuality(game.quality);
    this._syncLighting(game);
    this._syncActors(game);
    if (game.mode === 'survival') this._syncSurvivalObjects(game);
    else this._syncExteriorPalette(false);
    this._syncVariants(game);
    if (game.mode === 'survival') {
      for (const ring of this.variantRings.values()) ring.visible = false;
      for (const cue of this.foodCues.values()) cue.group.visible = false;
      for (const trail of this.drinkTrails.values()) trail.group.visible = false;
      if (this.directorShadow) this.directorShadow.group.visible = false;
      if (this.directorShadowLight) this.directorShadowLight.intensity = 0;
    } else {
      this._syncFoodCues(game);
      this._syncDrinkTrails(game);
      this._syncDirectorShadow(game);
    }
    this._syncPlayerSwing(game);
    this._syncPickups(game);
    this._syncBolts(game);
    this._syncParticles(game);
    this._syncDecals(game);

    const renderer = game.renderer;
    const point = renderer.cam;
    const env = EnvKit.render({
      camX: point.x,
      camY: point.y,
      zoom: point.zoom,
      tilt: renderer.tilt,
      w: renderer.view.w,
      h: renderer.view.h,
      dpr: renderer.dpr,
      shakeX: point.sx,
      shakeY: point.sy,
      light: renderer.keyLightAt(game.player.x, game.player.y),
      fullScene: true,
      exposure: this.exposure,
    });
    return !!env;
  }

  diagnostics() {
    return {
      mode: this.canvas && this.canvas.style.display !== 'none' ? 'webgl-3d' : 'ui',
      ready: !!(EnvKit.ready && this.scene),
      fullScene: !!(EnvKit.renderer && EnvKit.camera && EnvKit.camera.isOrthographicCamera),
      contextLost: this.contextLost,
      rooms: this.lastRoomCount,
      entrances: this.lastEntranceCount,
      portals: this.lastPortalCount,
      roomInstances: EnvKit.roomCounts || null,
      propCounts: EnvKit.propCounts || null,
      detailPropCounts3D: EnvKit.detailCounts || null,
      unmappedDetailTypes: EnvKit.unmappedDetailTypes || [],
      riggedPlayer: !!(Valen3D.model && Valen3D.model.visible && Valen3D.model.parent),
      visibleRiggedEnemies: Enemy3D.slots.filter((slot) => slot.model.visible).length,
      proxyActors: [...this.proxies.values()].filter((object) => object.visible).length,
      visibleSurvivalCrowdProxies: [...this.survivalCrowdProxies.values()].filter((object) => object.visible).length,
      survivalCrowdProxyPool: this.survivalCrowdProxies.size,
      survivalKeepVisible: !!(this.survivalKeep && this.survivalKeep.visible),
      fortressTowers: this.fortressDressing ? this.fortressDressing.userData.towers : 0,
      fortressMerlons: this.fortressDressing ? this.fortressDressing.userData.merlons : 0,
      fortressMeshes: this.fortressDressing ? this.fortressDressing.userData.meshes : 0,
      survivalKeepLevel: this.survivalKeep ? this.survivalKeep.userData.level : 0,
      survivalTerritoryRooms: [...this.survivalTerritory.values()].filter((object) => object.visible).length,
      visibleSurvivalBuildSlots: [...this.survivalCircles.values()].filter((rec) => rec.ring.visible).length,
      visibleSurvivalGhosts: [...this.survivalCircles.values()].filter((rec) => rec.ghost && rec.ghost.visible).length,
      visibleSurvivalBuildings: [...this.survivalBuildingMeshes.values()].filter((object) => object.visible).length,
      survivalGateVisible: !!(this.survivalGateMesh && this.survivalGateMesh.visible),
      visibleReliefTroops: this.relief ? (this.relief.bodies.visible ? this.relief.bodies.count : 0) + (this.relief.bearer.visible ? 1 : 0) : 0,
      visibleVariants3D: [...this.variantRings.values()].filter((object) => object.visible).length,
      visibleFoodCues3D: [...this.foodCues.values()].filter((cue) => cue.group.visible).length,
      visibleDrinkTrails3D: [...this.drinkTrails.values()].filter((trail) => trail.group.visible).length,
      visibleDirectorShadow3D: !!(this.directorShadow && this.directorShadow.group.visible),
      activeLocalLights3D: this.localLights.filter((light) => light.visible && light.intensity > 0.01).length,
      visiblePickups: [...this.pickups.values()].filter((object) => object.visible).length,
      visibleBolts: [...this.bolts.values()].filter((object) => object.visible).length,
      visibleBoltTrails3D: [...this.boltTrails.values()].filter((object) => object.visible).length,
      visiblePlayerSwing3D: !!((this.playerSwing && this.playerSwing.visible) || (this.playerFlash && this.playerFlash.visible)),
      visibleParticles: this.lastParticleCount,
      decalsMapped: !!(this.decalMesh && this.decalMesh.visible),
      decalTextureSize: this.decalUploadCanvas ? [this.decalUploadCanvas.width, this.decalUploadCanvas.height] : null,
      roomMarks3D: this.roomMarks.length,
      visibleWatchers3D: this.hauntWatchers.filter((watcher) => watcher.group.visible).length,
      visibleDoorCues3D: [...this.doorCues.values()].filter((cue) => cue.group.visible).length,
      visibleDrafts3D: [...this.houseDrafts.values()].filter((draft) => draft.group.visible).length,
      visibleHouseCat3D: !!(this.houseCat && this.houseCat.visible),
      visibleInteractionCue3D: !!(this.interactionCue && this.interactionCue.visible),
      enemyRigsInWorld: Enemy3D.slots.filter((slot) => slot.model.visible && slot.model.parent === this.root).length,
      worldCanvas: this.canvas ? { width: this.canvas.width, height: this.canvas.height } : null,
      error: this.lastError,
    };
  }
}

export const World3D = new World3DRuntime();
