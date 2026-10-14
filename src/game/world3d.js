/* Full 3D gameplay world.
 *
 * Mansion coordinates remain owned by the gameplay sim as (x, y). This
 * adapter maps them to Three.js (x, height, z=y), renders the room kit and
 * actors through EnvKit's single world camera, and leaves Canvas for HUD/UI.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { ISO_CAMERA, clamp, visualAngle } from '../core/util.js';
import { EnvKit, PX_PER_METRE, VALEN_METRES, HUNTER_SCALE } from './envkit.js';
import { Valen3D } from './valen3d.js';
import { Enemy3D, enemyWorldHeight } from './enemy3d.js';
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
    this.survivalSlotRings = new Map();
    this.survivalRadiusRing = null;
    this.survivalTargetRing = null;
    this.survivalFlare = null;
    this.survivalFlareLight = null;
    this.survivalTelegraph = null;
    this.survivalHearthFire = null;
    this.survivalScaffold = null;
    this.survivalWorker = null;
    this.survivalReadyPips = new Map();
    this.survivalGateMesh = null;
    this.survivalHearthKeep = null;
    this.playFenceGroup = null;
    this.playFenceSerial = -1;
    this.survivalDayCamps = new Map();
    this.survivalZombieBodyGeometry = null;
    this.survivalZombieHeadGeometry = null;
    this.survivalZombieEyeGeometry = null;
    this.survivalZombieBodyMaterial = null;
    this.survivalZombieSkinMaterial = null;
    this.survivalZombieEyeMaterial = null;
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
    this.hunterLantern = null;
    this.hearthLight = null;
    this.muzzleLight = null;
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
      this.playerPointLight = new THREE.PointLight(0xffc090, 0, 360, 1.6);
      this.playerPointLight.name = 'hunter-blood-glow-3d';
      scene.add(this.playerPointLight);
    }
    if (!this.hearthLight) {
      this.hearthLight = new THREE.PointLight(0xff9a52, 0, 680, 1.45);
      this.hearthLight.name = 'hearth-fire-3d';
      scene.add(this.hearthLight);
    }
    if (!this.muzzleLight) {
      this.muzzleLight = new THREE.PointLight(0xffc070, 0, 90, 1.8);
      this.muzzleLight.name = 'player-muzzle-light-3d';
      scene.add(this.muzzleLight);
    }
    if (Valen3D.ground) Valen3D.ground.visible = false;
    if (!this.ground) {
      const b = game.mansion.bounds;
      const extra = 2250;
      const geometry = new THREE.PlaneGeometry(b.w + extra * 2, b.h + extra * 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 1, metalness: 0 });
      this.ground = new THREE.Mesh(geometry, material);
      this.ground.name = 'mansion-ground-3d';
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.set(b.x + b.w / 2, -8, b.y + b.h / 2);
      this.ground.receiveShadow = true;
      this.ground.frustumCulled = false;
      scene.add(this.ground);
      scene.background = new THREE.Color(0x0b0e16);
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
    const day = survival && game.survival && (game.survival.phase === 'day' || game.survival.phase === 'complete');
    // Survival night is still night, but rooms, doors and the Hunter have to
    // read. Fill + bake used to crush the mansion into a black void.
    const ambientFactor = survival
      ? (day ? 1.02 : 0.94)
      : Math.max(0.12, (1 - blackout - duel) * flicker);
    const lift = 720;
    lamp.target.position.set(p.x, 0, p.y);
    lamp.target.updateMatrixWorld(true);
    lamp.position.set(p.x + dx * 520, lift, p.y + dy * 520);
    lamp.intensity = (survival ? (day ? 1.28 : 1.12) + light.level * 0.72 : 0.76 + light.level * 1.05) * ambientFactor + lightning * (survival ? 0.7 : 2.1);
    lamp.color.setRGB(light.color[0] / 255, light.color[1] / 255, light.color[2] / 255);
    if (Valen3D.hemi) {
      Valen3D.hemi.intensity = (survival ? (day ? 0.88 : 0.66) : 0.38) * ambientFactor + lightning * (survival ? 0.5 : 1.25);
      if (survival) {
        Valen3D.hemi.color.set(day ? 0xd6cbb3 : 0xb7c4de);
        Valen3D.hemi.groundColor.set(day ? 0x3a3228 : 0x241c18);
      }
    }
    if (Valen3D.key) Valen3D.key.intensity = survival ? (day ? 0.78 : 0.52) : 1.05;
    if (Valen3D.rim) Valen3D.rim.intensity = (survival ? (day ? 0.46 : 0.40) : 0.3) * ambientFactor + lightning * (survival ? 0.28 : 0.65);
    const bloodMoon = clamp(game.bloodMoon || 0, 0, 1);
    if (bloodMoon > 0.05) lamp.color.lerp(new THREE.Color(0x9a3442), bloodMoon * 0.36);
    this.exposure = clamp((survival ? (day ? 1.36 : 1.24) : 1.22) * ambientFactor + lightning * 0.32, 0.7, 1.58);

    if (!this.hunterLantern) this.hunterLantern = this._makeHunterLantern();
    const nightLamp = !(survival && day);
    const scale = HUNTER_SCALE;
    const side = 14 * scale;
    const along = 5 * scale;
    const facing = p.angle || 0;
    const lx = p.x + Math.cos(facing + Math.PI / 2) * side + Math.cos(facing) * along;
    const lz = p.y + Math.sin(facing + Math.PI / 2) * side + Math.sin(facing) * along;
    const ly = 38 * scale;
    this.hunterLantern.visible = true;
    this.hunterLantern.position.set(lx, ly, lz);
    const bulb = this.hunterLantern.userData.bulb;
    if (bulb) {
      bulb.material.color.setHex(nightLamp ? 0xffe2a8 : 0x6a6258);
      bulb.material.opacity = nightLamp ? 0.95 : 0.12;
    }
    if (this.playerPointLight) {
      this.playerPointLight.position.set(lx, ly + 6, lz);
      this.playerPointLight.distance = nightLamp ? Math.max(220, (p.lightR || 150) * 1.15) : 80;
      this.playerPointLight.intensity = nightLamp
        ? clamp((p.lightI == null ? 0.55 : p.lightI) * (survival ? 2.4 : 1.6), 0.9, 2.2)
        : 0;
      this.playerPointLight.color.set(nightLamp ? 0xffc070 : 0x8890a0);
      this.playerPointLight.visible = nightLamp;
    }

    const fire = game.mansion.fireplaceLight;
    if (this.hearthLight) {
      const lit = !!(survival && fire && (fire.curI == null ? fire.i : fire.curI) > 0.02);
      this.hearthLight.visible = lit;
      if (lit) {
        this.hearthLight.position.set(fire.x, 78, fire.y);
        this.hearthLight.distance = day ? 560 : 720;
        this.hearthLight.intensity = (fire.curI == null ? fire.i : fire.curI) * (day ? 4.4 : 7.6);
        this.hearthLight.color.set(0xff9a52);
      } else {
        this.hearthLight.intensity = 0;
      }
    }

    const sources = (game.mansion.lights || []).map((source) => {
      const d = Math.hypot(source.x - p.x, source.y - p.y);
      const intensity = Math.max(0, source.curI == null ? source.i || 0 : source.curI);
      return { source, d, weight: intensity * Math.min(source.r || 1, 280) / (120 + d) };
    }).filter((row) => !(survival && fire && row.source === fire) && row.d < (survival ? 1400 : 700) && row.weight > 0.01)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, survival || game.quality >= 3 ? 6 : 3);
    while (this.localLights.length < 6) {
      const local = new THREE.PointLight(0xffd59a, 0, 360, 1.55);
      local.name = `house-lamp-3d-${this.localLights.length}`;
      this.scene.add(local);
      this.localLights.push(local);
    }
    for (let i = 0; i < this.localLights.length; i++) {
      const local = this.localLights[i];
      const row = sources[i];
      if (!row) { local.intensity = 0; local.visible = false; continue; }
      const source = row.source;
      const power = source.curI == null ? source.i || 0 : source.curI;
      const visualR = Math.max(220, Math.min(source.r || 150, source.type === 'moon' ? 420 : 320));
      local.visible = true;
      local.position.set(source.x, source.type === 'moon' ? 96 : 52, source.y);
      local.distance = visualR * (survival ? 1.55 : 1.7);
      local.decay = 1.55;
      local.intensity = clamp(power * (survival ? 6.4 : 2.2) * ambientFactor, 0, survival ? 4.8 : 2.4);
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

  _makeHunterLantern() {
    const group = new THREE.Group();
    group.name = 'hunter-lantern-3d';
    const cage = new THREE.Mesh(
      new THREE.BoxGeometry(7, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0x3a332c, metalness: 0.42, roughness: 0.58, flatShading: true }),
    );
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.72, metalness: 0.28, flatShading: true }),
    );
    cap.position.y = 6.2;
    group.add(cage, bulb, cap);
    group.userData.bulb = bulb;
    group.traverse((item) => { if (item.isMesh) item.castShadow = true; });
    if (this.root) this.root.add(group);
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
      const height = VALEN_METRES * PX_PER_METRE * HUNTER_SCALE;
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
    if (game.mode === 'survival') this._syncSurvivalCrowdProxies(enemies, game);
    else for (const proxy of this.survivalCrowdProxies.values()) proxy.visible = false;
    // The legacy route remains GLB-only. Survival crowd units beyond the 14
    // authored rigs use a lightweight 3D silhouette so all 20–30 bodies read.
    for (const [id, object] of this.proxies) if (!active.has(id)) object.visible = false;
  }

  _makeSurvivalZombieProxy() {
    if (!this.survivalZombieMats) {
      this.survivalZombieMats = {
        cloth: new THREE.MeshStandardMaterial({ color: 0x2a2e24, roughness: 1, flatShading: true }),
        skin: new THREE.MeshStandardMaterial({ color: 0x6e7258, roughness: 1, flatShading: true }),
        dark: new THREE.MeshStandardMaterial({ color: 0x1c1e18, roughness: 1, flatShading: true }),
        eye: new THREE.MeshBasicMaterial({ color: 0xe08a3a, toneMapped: false }),
      };
      this.survivalZombieGeo = {
        hip: new THREE.SphereGeometry(6.4, 7, 6),
        torso: new THREE.CylinderGeometry(7.2, 8.4, 24, 7),
        shoulder: new THREE.SphereGeometry(4.1, 6, 5),
        head: new THREE.SphereGeometry(7.8, 8, 7),
        jaw: new THREE.SphereGeometry(4.2, 6, 5),
        eye: new THREE.SphereGeometry(1.15, 6, 5),
        thigh: new THREE.CylinderGeometry(3.3, 3.7, 16, 6),
        calf: new THREE.CylinderGeometry(2.5, 3.0, 14, 6),
        foot: new THREE.BoxGeometry(4.0, 2.3, 8.2),
        upper: new THREE.CylinderGeometry(2.2, 2.7, 15, 5),
        lower: new THREE.CylinderGeometry(1.8, 2.1, 13, 5),
      };
    }
    const m = this.survivalZombieMats;
    const g = this.survivalZombieGeo;
    const group = new THREE.Group();
    group.name = 'survival-swarm-zombie-3d-silhouette';
    const mesh = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const item = new THREE.Mesh(geometry, material);
      item.position.set(x, y, z);
      item.rotation.set(rx, ry, rz);
      item.castShadow = true;
      item.receiveShadow = false;
      group.add(item);
      return item;
    };
    // Authored so the crown sits at 70 world units and the soles on y=0.
    // Sync scales this to the same zombie height the GLB roster uses.
    mesh(g.hip, m.cloth, 0, 26, 0).scale.set(1, 0.72, 0.88);
    mesh(g.torso, m.cloth, 0, 40, 0.5);
    mesh(g.shoulder, m.cloth, -9.2, 50, 0.6);
    mesh(g.shoulder, m.cloth, 9.2, 50, 0.6);
    mesh(g.head, m.skin, 0, 61, 1.8, 0.12, 0, 0);
    mesh(g.jaw, m.skin, 0, 55.4, 3.6, 0.25, 0, 0).scale.set(1, 0.55, 0.82);
    mesh(g.eye, m.eye, -2.5, 62.2, 8.2);
    mesh(g.eye, m.eye, 2.5, 62.2, 8.2);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      const thigh = new THREE.Mesh(g.thigh, m.dark);
      thigh.position.set(0, -8, 0);
      const calf = new THREE.Mesh(g.calf, m.dark);
      calf.position.set(0, -20, 0.5);
      const foot = new THREE.Mesh(g.foot, m.dark);
      foot.position.set(0, -27.4, 2.1);
      thigh.castShadow = calf.castShadow = foot.castShadow = true;
      leg.add(thigh, calf, foot);
      leg.position.set(side * 4.5, 27.4, 0);
      group.add(leg);
      legs.push(leg);
    }
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(g.upper, m.cloth);
      upper.position.set(0, -7, 0);
      const lower = new THREE.Mesh(g.lower, m.skin);
      lower.position.set(0, -17.5, 3.2);
      lower.rotation.x = 0.55;
      upper.castShadow = lower.castShadow = true;
      arm.add(upper, lower);
      arm.position.set(side * 10.2, 50, 1.1);
      arm.rotation.z = side * -0.16;
      arm.rotation.x = -0.85;
      group.add(arm);
      arms.push(arm);
    }
    group.userData.arms = arms;
    group.userData.legs = legs;
    group.userData.authorHeight = 70;
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _syncSurvivalCrowdProxies(enemies, game) {
    const active = new Set();
    const player = game && game.player;
    const cap = !game || game.quality >= 3 ? 28 : game.quality >= 2 ? 16 : 10;
    const crowd = [];
    for (const enemy of enemies) {
      if (!enemy || !enemy._crowd || !enemy._survivalType || enemy.dead || enemy.removeMe || enemy._glb) continue;
      crowd.push(enemy);
    }
    if (player) {
      crowd.sort((a, b) => (Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)));
    }
    for (const enemy of crowd.slice(0, cap)) {
      const id = enemy.id;
      active.add(id);
      let proxy = this.survivalCrowdProxies.get(id);
      if (!proxy) {
        proxy = this._makeSurvivalZombieProxy();
        this.survivalCrowdProxies.set(id, proxy);
      }
      proxy.visible = enemy.alpha == null || enemy.alpha > 0.02;
      proxy.position.set(enemy.x, 0, enemy.y);
      proxy.rotation.y = Math.PI / 2 - (enemy.angle || 0);
      const author = proxy.userData.authorHeight || 70;
      const target = enemyWorldHeight(enemy.key || 'zombie', enemy.sizeMul || 1, VERTICAL_PROJECTION);
      const hurt = enemy.hurtFlash > 0 ? 1.04 : 1;
      proxy.scale.setScalar((target / author) * hurt);
      const moving = Math.hypot(enemy.vx || 0, enemy.vy || 0) > 8;
      const gait = (enemy.t || 0) * (moving ? 7.2 : 2.2) + (enemy.id || 0);
      const swing = Math.sin(gait) * (moving ? 0.55 : 0.08);
      const legs = proxy.userData.legs || [];
      if (legs[0]) legs[0].rotation.x = swing;
      if (legs[1]) legs[1].rotation.x = -swing;
      const arms = proxy.userData.arms || [];
      if (arms[0]) { arms[0].rotation.x = -0.85 - swing * 0.4; arms[0].rotation.z = 0.16; }
      if (arms[1]) { arms[1].rotation.x = -0.85 + swing * 0.4; arms[1].rotation.z = -0.16; }
    }
    for (const [id, proxy] of this.survivalCrowdProxies) if (!active.has(id)) proxy.visible = false;
  }

  _makeSurvivalBuilding(type) {
    const group = new THREE.Group();
    group.name = `survival-building-3d-${type}`;
    const timber = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.96, flatShading: true });
    const plank = new THREE.MeshStandardMaterial({ color: 0x8d6840, roughness: 0.9, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: 0x6d675c, roughness: 1, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.95, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x4e463a, metalness: 0.55, roughness: 0.5, flatShading: true });
    const oil = new THREE.MeshStandardMaterial({ color: 0x5c3a16, roughness: 0.55, metalness: 0.2 });
    const warm = new THREE.MeshBasicMaterial({ color: 0xffc078, toneMapped: false });
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const linen = new THREE.MeshStandardMaterial({ color: 0x7a3a38, roughness: 1, flatShading: true });
    if (type === 'extractor') {
      add(new THREE.BoxGeometry(58, 14, 58), stone, 0, 7, 0);
      add(new THREE.BoxGeometry(48, 44, 48), stone, 0, 36, 0);
      add(new THREE.CylinderGeometry(16, 18, 28, 10), oil, 0, 70, 0);
      add(new THREE.TorusGeometry(16, 3.2, 6, 14), iron, 26, 62, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(5, 7, 64, 6), iron, 0, 108, 0);
      add(new THREE.CylinderGeometry(11, 13, 20, 10), oil, -38, 12, 18);
      add(new THREE.CylinderGeometry(11, 13, 20, 10), oil, -38, 12, -16);
      add(new THREE.CylinderGeometry(11, 13, 20, 10), oil, 38, 12, 14);
      add(new THREE.BoxGeometry(22, 10, 14), stone, 0, 16, 32);
      add(new THREE.BoxGeometry(10, 14, 6), warm, 0, 42, 26);
    } else if (type === 'sawmill') {
      add(new THREE.BoxGeometry(96, 10, 44), plank, 0, 8, 0);
      add(new THREE.BoxGeometry(14, 42, 14), timber, -42, 26, -14);
      add(new THREE.BoxGeometry(14, 42, 14), timber, 42, 26, -14);
      add(new THREE.BoxGeometry(98, 8, 12), timber, 0, 50, -14);
      add(new THREE.CylinderGeometry(24, 24, 7, 16), iron, 34, 26, 16, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(26, 3, 6, 16), iron, 34, 26, 16, 0, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(7, 7, 52, 8), plank, -30 + i * 14, 10, 32, 0, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(46, 18, 16), timber, -18, 16, -4);
    } else if (type === 'watch') {
      add(new THREE.BoxGeometry(36, 12, 36), stone, 0, 6, 0);
      add(new THREE.BoxGeometry(28, 110, 28), timber, 0, 67, 0);
      add(new THREE.BoxGeometry(48, 14, 48), stone, 0, 128, 0);
      add(new THREE.BoxGeometry(10, 22, 10), iron, -16, 148, -16);
      add(new THREE.BoxGeometry(10, 22, 10), iron, 16, 148, -16);
      add(new THREE.BoxGeometry(10, 22, 10), iron, -16, 148, 16);
      add(new THREE.BoxGeometry(10, 22, 10), iron, 16, 148, 16);
      add(new THREE.BoxGeometry(12, 18, 6), warm, 0, 92, 15);
      add(new THREE.SphereGeometry(6.5, 8, 6), warm, 0, 158, 0);
    } else {
      add(new THREE.BoxGeometry(148, 8, 72), stone, 0, 4, 0);
      add(new THREE.BoxGeometry(136, 36, 58), timber, 0, 26, 0);
      add(new THREE.BoxGeometry(148, 8, 72), roof, 0, 48, 0);
      for (let i = -1; i <= 1; i++) {
        add(new THREE.BoxGeometry(30, 7, 16), plank, i * 40, 10, 10);
        add(new THREE.BoxGeometry(24, 4, 12), linen, i * 40, 15, 10);
      }
      add(new THREE.BoxGeometry(10, 14, 4), warm, 0, 28, 30);
      add(new THREE.BoxGeometry(12, 26, 12), stone, 52, 38, -16);
    }
    group.traverse((item) => { if (item.isMesh) item.userData.survivalBuilding = type; });
    return group;
  }

  _makeSurvivalHearthKeep() {
    const group = new THREE.Group();
    group.name = 'survival-hearth-keep-3d';
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a6458, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3f3a32, roughness: 0.95, flatShading: true });
    const add = (geometry, material, x, y, z, minLevel = 1) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.minLevel = minLevel;
      group.add(mesh);
      return mesh;
    };
    const ember = new THREE.MeshBasicMaterial({ color: 0xffc078, toneMapped: false });
    add(new THREE.BoxGeometry(70, 18, 48), stone, 0, 9, -8, 1);
    add(new THREE.BoxGeometry(18, 52, 18), stone, -28, 34, -14, 1);
    add(new THREE.BoxGeometry(18, 52, 18), stone, 28, 34, -14, 1);
    add(new THREE.BoxGeometry(28, 22, 16), ember, 0, 22, 8, 1);
    add(new THREE.BoxGeometry(86, 36, 16), stone, 0, 26, -28, 2);
    add(new THREE.BoxGeometry(22, 90, 22), dark, 0, 64, -18, 3);
    add(new THREE.BoxGeometry(32, 10, 32), stone, 0, 112, -18, 3);
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeDaySiegeCamp() {
    const group = new THREE.Group();
    group.name = 'survival-day-siege-camp-3d';
    const shade = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 1, flatShading: true, transparent: true, opacity: 0.82 });
    const ember = new THREE.MeshBasicMaterial({ color: 0xc45a28, transparent: true, opacity: 0.7, toneMapped: false });
    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(7, 10, 34, 6), shade, -18, 18, 6);
    add(new THREE.SphereGeometry(8, 6, 5), shade, -18, 40, 7);
    add(new THREE.CylinderGeometry(7, 10, 34, 6), shade, 16, 18, -4);
    add(new THREE.SphereGeometry(8, 6, 5), shade, 16, 40, -3);
    add(new THREE.ConeGeometry(16, 28, 4), shade, 0, 18, 22);
    add(new THREE.SphereGeometry(6, 6, 5), ember, 0, 8, 4);
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _syncDaySiegeCamps(game, mode) {
    if (!this.survivalDayCamps) this.survivalDayCamps = new Map();
    const active = new Set();
    const show = game.screen === 'playing' && mode.phase === 'day';
    const doors = show ? (game.mansion.entrances || []).filter((e) => e.kind === 'door' && e.exterior && e.outside) : [];
    for (const door of doors.slice(0, 5)) {
      const id = door.id;
      active.add(id);
      let camp = this.survivalDayCamps.get(id);
      if (!camp) {
        camp = this._makeDaySiegeCamp();
        this.survivalDayCamps.set(id, camp);
      }
      camp.visible = true;
      camp.position.set(door.outside.x, 0, door.outside.y);
      camp.rotation.y = Math.atan2(door.x - door.outside.x, door.y - door.outside.y);
    }
    for (const [id, camp] of this.survivalDayCamps) if (!active.has(id)) camp.visible = false;
  }

  _makeSurvivalRadiusRing() {
    const geometry = new THREE.RingGeometry(0.982, 1, 128);
    const material = new THREE.MeshBasicMaterial({
      color: 0xf0c56a, transparent: true, opacity: 0.52,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.name = 'survival-perapian-radius-3d';
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    ring.frustumCulled = false;
    this.root.add(ring);
    return ring;
  }

  _makeSurvivalTargetRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(24, 34, 32),
      new THREE.MeshBasicMaterial({ color: 0xe88962, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.name = 'survival-lock-target-3d';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 6;
    ring.renderOrder = 5;
    ring.visible = false;
    this.root.add(ring);
    return ring;
  }

  _makeSurvivalFlare() {
    const group = new THREE.Group();
    group.name = 'survival-flare-3d';
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffe09a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffc56a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 4;
    group.add(dome, ring);
    group.userData = { dome, ring };
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeSurvivalTelegraph() {
    const group = new THREE.Group();
    group.name = 'survival-wave-telegraph-3d';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(28, 42, 40),
      new THREE.MeshBasicMaterial({
        color: 0xe88962, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 4;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 90, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb070, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    pillar.position.y = 45;
    group.add(ring, pillar);
    group.userData = { ring, pillar };
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeSurvivalHearthFire() {
    const group = new THREE.Group();
    group.name = 'survival-hearth-fire-3d';
    const addFlame = (x, h, color, opacity) => {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(10, h, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        }),
      );
      flame.position.set(x, h * 0.5, 8);
      group.add(flame);
      return flame;
    };
    group.userData = {
      inner: addFlame(0, 54, 0xfff0c0, 0.9),
      mid: addFlame(-9, 40, 0xff9a3a, 0.72),
      outer: addFlame(10, 36, 0xff6a22, 0.6),
    };
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeSurvivalSlotRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(78, 88, 40),
      new THREE.MeshBasicMaterial({ color: 0xe6c77e, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.name = 'survival-lit-build-slot-3d';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 3;
    ring.renderOrder = 4;
    this.root.add(ring);
    return ring;
  }

  _makeSurvivalGate() {
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
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _syncPlayFence(game) {
    const fence = game.mansion && game.mansion.playFence;
    const serial = game.mansion ? game.mansion.layoutSerial : 0;
    if (!fence || game.mode !== 'survival') {
      if (this.playFenceGroup) this.playFenceGroup.visible = false;
      return;
    }
    if (this.playFenceGroup && this.playFenceSerial === serial) {
      this.playFenceGroup.visible = true;
      return;
    }
    if (this.playFenceGroup) {
      this.root.remove(this.playFenceGroup);
      this.playFenceGroup.traverse((item) => {
        if (item.geometry) item.geometry.dispose();
      });
    }
    this.playFenceGroup = this._makePlayFence(fence);
    this.playFenceSerial = serial;
  }

  _makePlayFence(fence) {
    const group = new THREE.Group();
    group.name = 'keep-palisade-3d';
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.96, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c1c12, roughness: 1, flatShading: true });
    const H = 78;
    const step = 54;
    const addPost = (x, z) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(8, H, 8), wood);
      post.position.set(x, H / 2, z);
      post.castShadow = true;
      group.add(post);
    };
    const addRail = (x, z, w, d) => {
      if (w < 8 && d < 8) return;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.max(6, w), 7, Math.max(6, d)), dark);
      rail.position.set(x, 38, z);
      group.add(rail);
    };
    const b = fence;
    const south = b.y + b.h;
    const east = b.x + b.w;
    for (let x = b.x; x <= east; x += step) addPost(x, b.y);
    addRail(b.x + b.w / 2, b.y, b.w, 6);
    for (let z = b.y; z <= south; z += step) {
      addPost(b.x, z);
      addPost(east, z);
    }
    addRail(b.x, b.y + b.h / 2, 6, b.h);
    addRail(east, b.y + b.h / 2, 6, b.h);
    for (let x = b.x; x < b.gap0; x += step) addPost(x, south);
    for (let x = b.gap1; x <= east; x += step) addPost(x, south);
    addPost(b.gap0, south);
    addPost(b.gap1, south);
    const leftW = Math.max(0, b.gap0 - b.x);
    const rightW = Math.max(0, east - b.gap1);
    addRail(b.x + leftW / 2, south, leftW, 6);
    addRail(b.gap1 + rightW / 2, south, rightW, 6);
    this.root.add(group);
    return group;
  }

  _syncSurvivalObjects(game) {
    const mode = game.survival;
    if (!mode) return;
    const fire = game.mansion.fireplaceLight;
    if (!this.survivalRadiusRing) this.survivalRadiusRing = this._makeSurvivalRadiusRing();
    const radius = mode.getFireRadius();
    this.survivalRadiusRing.visible = radius > 0;
    if (fire) {
      this.survivalRadiusRing.position.set(fire.x, 3.4, fire.y);
      this.survivalRadiusRing.scale.set(radius, radius, radius);
      this.survivalRadiusRing.material.opacity = 0.5;
    }

    if (!this.survivalTargetRing) this.survivalTargetRing = this._makeSurvivalTargetRing();
    const lock = mode.phase === 'night' && mode.currentTarget && !mode.currentTarget.dead ? mode.currentTarget : null;
    this.survivalTargetRing.visible = !!lock;
    if (lock) {
      const reach = Math.max(1.1, (lock.radius || 14) / 14);
      this.survivalTargetRing.position.set(lock.x, 6, lock.y);
      this.survivalTargetRing.scale.setScalar(reach);
      this.survivalTargetRing.material.color.setHex(lock._survivalType === 'breaker' ? 0xe07a3a : 0xe4bd73);
      this.survivalTargetRing.material.opacity = 0.72 + 0.22 * Math.abs(Math.sin((game.now || 0) * 6));
    }

    if (!this.survivalHearthFire) this.survivalHearthFire = this._makeSurvivalHearthFire();
    const hearthOn = !!(fire && radius > 0 && mode.phase !== 'failed');
    this.survivalHearthFire.visible = hearthOn;
    if (hearthOn) {
      const now = game.now || mode.elapsed || 0;
      this.survivalHearthFire.position.set(fire.x, 0, fire.y);
      const lift = 0.94 + 0.06 * Math.sin(now * 2.1);
      this.survivalHearthFire.scale.set(1, lift, 1);
      const heat = mode.oil > 0 ? 1 : 0.62;
      this.survivalHearthFire.userData.inner.material.opacity = 0.88 * heat;
      this.survivalHearthFire.userData.mid.material.opacity = 0.7 * heat;
      this.survivalHearthFire.userData.outer.material.opacity = 0.55 * heat;
    }

    if (!this.survivalFlare) this.survivalFlare = this._makeSurvivalFlare();
    if (!this.survivalFlareLight && this.scene) {
      this.survivalFlareLight = new THREE.PointLight(0xffd078, 0, 420, 1.5);
      this.survivalFlareLight.name = 'survival-flare-light-3d';
      this.scene.add(this.survivalFlareLight);
    }
    const flareLife = Math.max(0, mode.skillFlash || 0);
    const flareOn = mode.phase === 'night' && flareLife > 0.02;
    this.survivalFlare.visible = flareOn;
    if (this.survivalFlareLight) {
      this.survivalFlareLight.visible = flareOn;
      this.survivalFlareLight.intensity = flareOn ? 8.2 * Math.min(1, flareLife / 0.65) : 0;
    }
    if (flareOn) {
      const t = 1 - clamp(flareLife / 0.65, 0, 1);
      const reach = (mode.tuning.skillRadius || 235) * (0.28 + 0.82 * (1 - (1 - t) * (1 - t)));
      const player = game.player;
      this.survivalFlare.position.set(player.x, 18, player.y);
      this.survivalFlare.userData.dome.scale.setScalar(reach);
      this.survivalFlare.userData.dome.material.opacity = 0.55 * (flareLife / 0.65);
      this.survivalFlare.userData.ring.scale.setScalar(reach);
      this.survivalFlare.userData.ring.material.opacity = 0.8 * (flareLife / 0.65);
      this.survivalFlareLight.position.set(player.x, 46, player.y);
    }

    if (!this.survivalTelegraph) this.survivalTelegraph = this._makeSurvivalTelegraph();
    const incoming = mode.phase === 'night' ? mode.incoming : null;
    this.survivalTelegraph.visible = !!(incoming && incoming.x);
    if (incoming && incoming.x) {
      const now = game.now || mode.elapsed || 0;
      const pulse = 0.78 + 0.22 * Math.abs(Math.sin(now * 5.5));
      const swell = 1 + (1 - clamp((incoming.in || 0) / Math.max(0.01, mode.tuning.waveTelegraph || 3), 0, 1)) * 0.55;
      this.survivalTelegraph.position.set(incoming.x, 0, incoming.y);
      this.survivalTelegraph.scale.setScalar(swell);
      const breaker = incoming.kind === 'breaker';
      this.survivalTelegraph.userData.ring.material.color.setHex(breaker ? 0xe07a3a : 0xf0c56a);
      this.survivalTelegraph.userData.ring.material.opacity = 0.55 * pulse;
      this.survivalTelegraph.userData.pillar.material.color.setHex(breaker ? 0xff8a4a : 0xffd078);
      this.survivalTelegraph.userData.pillar.material.opacity = 0.38 * pulse;
    }

    this._syncPlayFence(game);
    this._syncDaySiegeCamps(game, mode);

    const visibleSlots = game.screen === 'playing' && mode.phase === 'day' ? new Set(mode.buildableRooms().map((room) => room.id)) : new Set();
    for (const roomId of visibleSlots) {
      let ring = this.survivalSlotRings.get(roomId);
      if (!ring) { ring = this._makeSurvivalSlotRing(); this.survivalSlotRings.set(roomId, ring); }
      const room = mode.plotById(roomId);
      if (!room) continue;
      ring.visible = true;
      ring.position.set(room.x + room.w / 2, 3, room.y + room.h / 2);
      const span = Math.max(70, Math.min(room.w || 160, room.h || 160) * 0.42);
      ring.scale.setScalar(span / 83);
      const selected = mode.selectedRoom === roomId;
      ring.material.color.setHex(room.kind === 'yard' ? (selected ? 0x9ec4e6 : 0x6e8aa8) : (selected ? 0xffdf89 : 0xb99759));
      ring.material.opacity = selected ? 0.94 : 0.56;
    }
    for (const [roomId, ring] of this.survivalSlotRings) if (!visibleSlots.has(roomId)) ring.visible = false;

    const activeBuildings = new Set();
    for (const [roomId, type] of Object.entries(mode.buildings)) {
      const room = mode.plotById(roomId);
      if (!room) continue;
      activeBuildings.add(roomId);
      let mesh = this.survivalBuildingMeshes.get(roomId);
      if (!mesh || mesh.userData.type !== type) {
        if (mesh) { this.root.remove(mesh); this.survivalBuildingMeshes.delete(roomId); }
        mesh = this._makeSurvivalBuilding(type);
        mesh.userData.type = type;
        this.survivalBuildingMeshes.set(roomId, mesh);
        this.root.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(room.x + room.w / 2, 0, room.y + room.h / 2);
    }

    if (!this.survivalHearthKeep) this.survivalHearthKeep = this._makeSurvivalHearthKeep();
    const keepLv = Math.max(1, mode.perapianLevel || 1);
    this.survivalHearthKeep.visible = !!fire;
    if (fire) {
      this.survivalHearthKeep.position.set(fire.x, 0, fire.y);
      this.survivalHearthKeep.scale.setScalar(0.72 + keepLv * 0.28);
      for (const child of this.survivalHearthKeep.children) {
        if (child.userData.minLevel) child.visible = keepLv >= child.userData.minLevel;
      }
    }
    for (const [roomId, mesh] of this.survivalBuildingMeshes) if (!activeBuildings.has(roomId)) mesh.visible = false;

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

    const site = mode.phase === 'day' ? mode.jobSite() : null;
    if (!this.survivalScaffold) this.survivalScaffold = this._makeSurvivalScaffold();
    if (!this.survivalWorker) this.survivalWorker = this._makeSurvivalWorker();
    this.survivalScaffold.visible = !!site;
    this.survivalWorker.visible = !!site;
    if (site) {
      this.survivalScaffold.position.set(site.x, 0, site.y);
      const bob = 0.5 + Math.sin((game.now || 0) * 3) * 0.08;
      this.survivalWorker.position.set(site.x + 22, bob, site.y + 18);
    }

    const ready = new Set();
    if (mode.phase === 'day') {
      for (const roomId of Object.keys(mode.buildings)) {
        if (mode.productionReady(roomId)) ready.add(roomId);
      }
    }
    for (const roomId of ready) {
      let pip = this.survivalReadyPips.get(roomId);
      if (!pip) { pip = this._makeSurvivalReadyPip(); this.survivalReadyPips.set(roomId, pip); }
      const room = mode.plotById(roomId);
      if (!room) continue;
      pip.visible = true;
      const pulse = 0.72 + 0.28 * Math.abs(Math.sin((game.now || 0) * 4));
      pip.position.set(room.x + room.w / 2, 118, room.y + room.h / 2);
      pip.material.opacity = pulse;
    }
    for (const [roomId, pip] of this.survivalReadyPips) if (!ready.has(roomId)) pip.visible = false;
  }

  _makeSurvivalScaffold() {
    const group = new THREE.Group();
    group.name = 'survival-scaffold-3d';
    const plank = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.95, flatShading: true });
    for (const x of [-22, 22]) {
      for (const z of [-18, 18]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(4, 46, 4), plank);
        post.position.set(x, 23, z);
        post.castShadow = true;
        group.add(post);
      }
    }
    for (const y of [14, 32]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(48, 3, 3), plank);
      beam.position.set(0, y, 18);
      group.add(beam);
    }
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeSurvivalWorker() {
    const group = new THREE.Group();
    group.name = 'survival-builder-3d';
    const coat = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 1, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc4a07a, roughness: 1, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 22, 6), coat);
    body.position.y = 14;
    const head = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), skin);
    head.position.y = 28;
    group.add(body, head);
    group.traverse((item) => { if (item.isMesh) { item.castShadow = true; } });
    group.visible = false;
    this.root.add(group);
    return group;
  }

  _makeSurvivalReadyPip() {
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(7, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xf0c56a, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    pip.name = 'survival-collect-pip-3d';
    pip.visible = false;
    this.root.add(pip);
    return pip;
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
      const height = enemyWorldHeight(enemy.key, enemy.sizeMul || 1, VERTICAL_PROJECTION);
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

  _makeShotBolt(kind, blessed) {
    const group = new THREE.Group();
    const knife = kind === 'knife';
    group.name = knife ? 'throwing-knife-3d' : 'crossbow-bolt-3d';
    const coreColor = knife ? 0xe8f2fa : blessed ? 0xfff0c0 : 0xffe2a0;
    const glowColor = knife ? 0x9ec4e6 : blessed ? 0xffc45a : 0xff9a3a;
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(knife ? 3.6 : 5.4, knife ? 2.2 : 2.8, 86, 7, 1),
      new THREE.MeshBasicMaterial({ color: coreColor, toneMapped: false }),
    );
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(knife ? 6 : 8, knife ? 3 : 4.2, 78, 8, 1),
      new THREE.MeshBasicMaterial({
        color: glowColor, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(knife ? 5.4 : 8.4, 26, 7),
      new THREE.MeshBasicMaterial({ color: 0xfff8e4, toneMapped: false }),
    );
    tip.position.y = 54;
    group.add(glow, core, tip);
    return group;
  }

  _makeBoltTracer(kind, blessed) {
    const knife = kind === 'knife';
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(knife ? 9 : 14, 2.2, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: knife ? 0xb7d4ee : blessed ? 0xffd078 : 0xffb45c,
        transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    mesh.name = knife ? 'throwing-knife-tracer-3d' : 'crossbow-bolt-tracer-3d';
    mesh.frustumCulled = false;
    return mesh;
  }

  _syncBolts(game) {
    const active = new Set();
    const up = this._boltUp || (this._boltUp = new THREE.Vector3(0, 1, 0));
    const direction = this._boltDir || (this._boltDir = new THREE.Vector3());
    for (const bolt of game.bolts || []) {
      if (bolt.dead) continue;
      const id = bolt.id || this._idFor(bolt, 'bolt');
      active.add(id);
      let mesh = this.bolts.get(id);
      if (!mesh) {
        mesh = this._makeShotBolt(bolt.kind, !!(bolt.kit && bolt.kit.blessed));
        this.bolts.set(id, mesh);
        this.root.add(mesh);
      }
      direction.set(Math.cos(bolt.angle || 0), 0, Math.sin(bolt.angle || 0)).normalize();
      mesh.position.set(bolt.x, 28, bolt.y);
      mesh.quaternion.setFromUnitVectors(up, direction);
      mesh.visible = true;
      let trail = this.boltTrails.get(id);
      if (!trail) {
        trail = this._makeBoltTracer(bolt.kind, !!(bolt.kit && bolt.kit.blessed));
        this.boltTrails.set(id, trail);
        this.root.add(trail);
      }
      const points = bolt.trail || [];
      const tail = points[0] || { x: bolt.x - direction.x * 34, y: bolt.y - direction.z * 34 };
      const dx = bolt.x - tail.x;
      const dz = bolt.y - tail.y;
      const length = Math.max(28, Math.min(90, Math.hypot(dx, dz)));
      trail.position.set((bolt.x + tail.x) * 0.5, 28, (bolt.y + tail.y) * 0.5);
      trail.quaternion.setFromUnitVectors(up, direction);
      trail.scale.set(0.7, length, 0.7);
      trail.material.opacity = 0.7;
      trail.visible = true;
    }
    for (const [id, mesh] of this.bolts) if (!active.has(id)) mesh.visible = false;
    for (const [id, trail] of this.boltTrails) if (!active.has(id)) trail.visible = false;
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
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
      return;
    }
    const weapon = weaponById(player.weapon);
    if (weapon.kind === 'ranged') {
      if (this.playerFlash && !this.playerFlash.userData.compact) {
        this.root.remove(this.playerFlash);
        this.playerFlash = null;
        this.playerFlashCore = null;
        this.playerFlashCone = null;
      }
      if (!this.playerFlash) {
        const group = new THREE.Group();
        group.name = 'player-muzzle-flash-3d';
        group.userData.compact = true;
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(4.2, 8, 6),
          new THREE.MeshBasicMaterial({
            color: 0xfff1c2, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          }),
        );
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(5.5, 22, 8, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0xffb45c, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide, toneMapped: false,
          }),
        );
        cone.position.y = 12;
        group.add(core, cone);
        this.playerFlash = group;
        this.playerFlashCore = core;
        this.playerFlashCone = cone;
        this.root.add(group);
      }
      const fade = age > 0.12 ? 0 : clamp(1 - age / 0.12, 0, 1);
      const angle = player.swingAngle == null ? player.angle : player.swingAngle;
      const dir = this._muzzleDir || (this._muzzleDir = new THREE.Vector3());
      const up = this._muzzleUp || (this._muzzleUp = new THREE.Vector3(0, 1, 0));
      dir.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
      this.playerFlash.position.set(player.x + dir.x * 48, 36, player.y + dir.z * 48);
      this.playerFlash.quaternion.setFromUnitVectors(up, dir);
      this.playerFlash.scale.setScalar(0.85 + fade * 0.4);
      const coreMat = this.playerFlashCore ? this.playerFlashCore.material : this.playerFlash.material;
      const coneMat = this.playerFlashCone && this.playerFlashCone.material;
      if (coreMat) coreMat.opacity = 0.9 * fade;
      if (coneMat) coneMat.opacity = 0.65 * fade;
      this.playerFlash.visible = fade > 0.02;
      if (this.muzzleLight) {
        this.muzzleLight.position.copy(this.playerFlash.position);
        this.muzzleLight.intensity = 1.8 * fade;
        this.muzzleLight.visible = fade > 0.04;
      }
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
    if (this.muzzleLight) this.muzzleLight.intensity = 0;
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
      if (p.type === 'glow' || p.glow) radius = p.size * (3.8 - t);
      else if (p.type === 'mist') radius = p.size * (2.2 - t * 0.9);
      else radius = p.size * (p.type === 'blood' ? 1 : t * 0.6 + 0.4);
      const parsed = this._particleColor(p.color);
      position.setXYZ(i, p.x, 9 + (p.z || 0), p.y);
      color.setXYZ(i, parsed[0], parsed[1], parsed[2]);
      alpha.setX(i, clamp((p.alpha == null ? 1 : p.alpha) * (p.type === 'dust' ? t * 0.6 : t) * parsed[3], 0, 1));
      size.setX(i, Math.max(0.5, radius * ((p.type === 'glow' || p.glow) ? 3.4 : 2)));
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
    try {
      this._syncLighting(game);
      this._syncActors(game);
      if (game.mode === 'survival') this._syncSurvivalObjects(game);
    else if (this.playFenceGroup) this.playFenceGroup.visible = false;
      this._syncVariants(game);
    } catch (error) {
      this.lastError = String(error && error.message || error);
      console.error('3D world sync failed:', error);
    }
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
      survivalRadiusVisible: !!(this.survivalRadiusRing && this.survivalRadiusRing.visible),
      survivalRadiusPixels: this.survivalRadiusRing ? this.survivalRadiusRing.scale.x : 0,
      visibleSurvivalBuildSlots: [...this.survivalSlotRings.values()].filter((object) => object.visible).length,
      visibleSurvivalBuildings: [...this.survivalBuildingMeshes.values()].filter((object) => object.visible).length,
      survivalGateVisible: !!(this.survivalGateMesh && this.survivalGateMesh.visible),
      survivalFlareVisible: !!(this.survivalFlare && this.survivalFlare.visible),
      survivalTelegraphVisible: !!(this.survivalTelegraph && this.survivalTelegraph.visible),
      survivalHearthFireVisible: !!(this.survivalHearthFire && this.survivalHearthFire.visible),
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
