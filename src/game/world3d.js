/* Full 3D gameplay world.
 *
 * Mansion coordinates remain owned by the gameplay sim as (x, y). This
 * adapter maps them to Three.js (x, height, z=y), renders the room kit and
 * actors through EnvKit's single world camera, and leaves Canvas for HUD/UI.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { ISO_CAMERA, clamp, visualAngle } from '../core/util.js';
import { EnvKit, PX_PER_METRE, VALEN_METRES } from './envkit.js';
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

class World3DRuntime {
  constructor() {
    this.host = null;
    this.canvas = null;
    this.scene = null;
    this.root = null;
    this.ground = null;
    this.playerProxy = null;
    this.proxies = new Map();
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
      const extra = 1100;
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
    const ambientFactor = Math.max(0.12, (1 - blackout - duel) * flicker);
    const lift = 720;
    lamp.target.position.set(p.x, 0, p.y);
    lamp.target.updateMatrixWorld(true);
    lamp.position.set(p.x + dx * 520, lift, p.y + dy * 520);
    lamp.intensity = (0.76 + light.level * 1.05) * ambientFactor + lightning * 2.1;
    lamp.color.setRGB(light.color[0] / 255, light.color[1] / 255, light.color[2] / 255);
    if (Valen3D.hemi) Valen3D.hemi.intensity = 0.38 * ambientFactor + lightning * 1.25;
    if (Valen3D.rim) Valen3D.rim.intensity = 0.3 * ambientFactor + lightning * 0.65;
    const bloodMoon = clamp(game.bloodMoon || 0, 0, 1);
    if (bloodMoon > 0.05) lamp.color.lerp(new THREE.Color(0x9a3442), bloodMoon * 0.36);
    this.exposure = clamp(1.22 * ambientFactor + lightning * 0.32, 0.42, 1.48);

    if (this.playerPointLight) {
      this.playerPointLight.position.set(p.x, 44, p.y);
      this.playerPointLight.distance = Math.max(100, (p.lightR || 150) * 1.35);
      this.playerPointLight.intensity = clamp((p.lightI == null ? 0.45 : p.lightI) * ambientFactor * 1.35, 0, 1.25);
      this.playerPointLight.color.set(p.kit && p.kit.blessed ? 0xffdda0 : (p.bloodPct < 0.24 ? 0x9aa9e8 : 0x9aa7c7));
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
      local.distance = Math.max(90, (source.r || 150) * 1.7);
      local.intensity = clamp((source.curI == null ? source.i || 0 : source.curI) * 2.2 * ambientFactor, 0, 2.4);
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

    // Only real combatants enter the skinned-GLB stage. The siege crowd still
    // affects doors and pressure in simulation, but has no rendered proxies.
    Enemy3D.assign(game.enemies || [], player, {
      full3D: true,
      verticalProjection: VERTICAL_PROJECTION,
      host: { stage: this.root, scene: this.scene, renderer: EnvKit.renderer, camera: EnvKit.camera, canvas: EnvKit.canvas },
    });
    // No generic enemy proxies: a behavior-ready role GLB is the only gameplay
    // representation. Readiness gating and the 14-live-combatant cap keep an
    // active enemy from being displaced by decorative siege bodies.
    for (const [id, object] of this.proxies) if (!active.has(id)) object.visible = false;
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

  _syncBolts(game) {
    if (!this.boltGeometry) this.boltGeometry = new THREE.CylinderGeometry(1.2, 1.2, 26, 6, 1);
    const active = new Set();
    const up = new THREE.Vector3(0, 1, 0);
    for (const bolt of game.bolts || []) {
      if (bolt.dead) continue;
      const id = bolt.id || this._idFor(bolt, 'bolt');
      active.add(id);
      let mesh = this.bolts.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.boltGeometry, new THREE.MeshStandardMaterial({
          color: bolt.kit && bolt.kit.blessed ? 0xffedb0 : 0xa88a5d,
          emissive: bolt.kit && bolt.kit.blessed ? 0xd29a38 : 0x19130d,
          emissiveIntensity: bolt.kit && bolt.kit.blessed ? 0.8 : 0.08,
          roughness: 0.55,
        }));
        mesh.name = 'crossbow-bolt-3d';
        this.bolts.set(id, mesh);
        this.root.add(mesh);
      }
      const direction = new THREE.Vector3(Math.cos(bolt.angle || 0), 0, Math.sin(bolt.angle || 0)).normalize();
      mesh.position.set(bolt.x, 18, bolt.y);
      mesh.quaternion.setFromUnitVectors(up, direction);
      mesh.visible = true;
      let trail = this.boltTrails.get(id);
      if (!trail) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const material = new THREE.LineBasicMaterial({ color: bolt.kit && bolt.kit.blessed ? 0xffe2a2 : 0x9b9aa9, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
        const line = new THREE.Line(geometry, material);
        line.name = 'crossbow-bolt-trail-3d';
        line.frustumCulled = false;
        this.boltTrails.set(id, line);
        this.root.add(line);
        trail = line;
      }
      const points = bolt.trail || [];
      const attribute = trail.geometry.getAttribute('position');
      const pointCount = Math.min(points.length, 6);
      for (let i = 0; i < pointCount; i++) attribute.setXYZ(i, points[i].x, 18, points[i].y);
      if (pointCount < 7) attribute.setXYZ(pointCount, bolt.x, 18, bolt.y);
      attribute.needsUpdate = true;
      trail.geometry.setDrawRange(0, pointCount + 1);
      trail.visible = pointCount > 0;
    }
    for (const [id, mesh] of this.bolts) if (!active.has(id)) mesh.visible = false;
    for (const [id, trail] of this.boltTrails) if (!active.has(id)) trail.visible = false;
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
    this._syncRoomMarks(game);
    this._syncHouseAtmosphere(game);
    this._syncInteractionCue(game);
    this.lastRoomCount = game.mansion.roomList.length;
    this.lastEntranceCount = game.mansion.entrances.length;
    this.lastPortalCount = game.mansion.portals.length;
    EnvKit.sync(game.mansion.entrances, game.mansion, game.save.fortressLevel, game);
    if (EnvKit.quality !== game.quality) EnvKit.setQuality(game.quality);
    this._syncLighting(game);
    this._syncActors(game);
    this._syncVariants(game);
    this._syncFoodCues(game);
    this._syncDrinkTrails(game);
    this._syncDirectorShadow(game);
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
