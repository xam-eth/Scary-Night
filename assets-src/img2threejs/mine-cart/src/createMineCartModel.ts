import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Mine cart
// Sculpt build pass: lighting-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMineCartModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Mine cart";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "fovDegrees": 18.0, "aspect": 1.8333333333333333, "orientation": {"yaw": 37.0, "pitch": -6.0, "roll": 0.0}, "azimuthDeg": 37.0, "elevationDeg": 6.0, "positionHint": [2.9, 0.5, 3.8], "solveMethod": "silhouette camera fit (renders/camera-fit/camera-fit.json): clay renders vs the reference foreground mask on the Tier-1 224 grid, 326 candidates; refit after the form review: best IoU 0.877 at az 37, el 6, fov 18 (a long lens: the reference reads as a product shot). The first fit (macro build) gave az 27, el 7, fov 14.", "note": "Estimated from the image: three-quarter from the front-RIGHT (the long side faces the viewer, the handle end face shows on the right, the rim's top edge falls toward the right), ~27 degrees above; the review harness frames the model to the reference's foreground box. Not solved for projection (no projection used)."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "plank-near-1", "regionId": "plank-wood", "specMaterialId": "wood", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "sleeper-1", "regionId": "sleeper-wood", "specMaterialId": "wood-dark", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "specMaterialId": "iron", "profileId": "metal.steel-brushed", "status": "proceed"}, {"componentId": "ore-heap", "regionId": "gold-ore", "specMaterialId": "ore", "profileId": "metal.gold", "status": "proceed"}, {"componentId": "root", "regionId": "gravel", "specMaterialId": "gravel", "profileId": "stone.natural", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wood"] = createSculptMaterial(
    "wood",
    {"id": "wood", "name": "Cart wood planks", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#a0632f", "color": "#a0632f", "albedo": {"dominant": "#a0632f", "secondary": ["#7f4a22", "#c07f45"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#a0632f", "#7f4a22", "#c07f45"], "pattern": "mottled", "amplitude": 0.2, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"}, {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain", "role": "long grain streaks along the plank"}, {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.88, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.2, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "wood-grain-streaks", "kind": "groove", "region": "all plank faces, along the plank length", "evidenceRefs": ["full-object"], "confidence": 0.7, "roughnessDelta": 0.05, "albedoShift": "#6d3b1c", "pattern": "streaked along local X", "amplitude": 0.12}, {"id": "plank-edge-wear", "kind": "chip", "region": "plank and post edges", "evidenceRefs": ["full-object"], "confidence": 0.65, "albedoShift": "#c08450", "roughnessDelta": -0.08, "edgeWear": 0.25}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Warm mid-brown planks; the reference's painted grain gouges become a low-amplitude streak override and light edge wear.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.779, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.779, "estimatedFidelity": 0.779, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_albedo.png", "url": "wood_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_roughness.png", "url": "wood_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_height.png", "url": "wood_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_normal.png", "url": "wood_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_ao.png", "url": "wood_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 220, "sourceHeight": 105, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 220, "height": 105}, "mask": {"backgroundColor": "#58311A", "backgroundNoise": 49.437, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.2801, "heightP90Gradient": 0.06858, "roughnessBase": 0.708, "roughnessVariation": 0.111, "normalStrength": 0.237, "blurRadius": 10}, "palette": ["#804826", "#8E532C", "#65381F", "#36190B", "#A66A3B"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#66381D", "#874D29", "#7E4927", "#814827", "#724123"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 84.7, "meanSaturation": 0.7, "gradientStrength": 0.124, "mottle": 0.013, "streakRatio": 0.43, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "plank-near-1", "regionId": "plank-wood", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "bbox": {"x": 480, "y": 285, "width": 220, "height": 105}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0214}, "observations": ["chromatic base-colour response", "directional surface frequency", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "plank-near-1", "regionId": "plank-wood", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.779, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["wood-dark"] = createSculptMaterial(
    "wood-dark",
    {"id": "wood-dark", "name": "Sleeper wood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#6e4628", "color": "#6e4628", "albedo": {"dominant": "#6e4628", "secondary": ["#57371f", "#8c5a33"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#6e4628", "#57371f", "#8c5a33"], "pattern": "mottled", "amplitude": 0.2, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"}, {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain", "role": "long grain streaks along the plank"}, {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.92, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.4, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.25, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "sleeper-dirt", "kind": "stain", "region": "sleeper ends and sides", "evidenceRefs": ["full-object"], "confidence": 0.6, "dirtAmount": 0.3, "cavityBias": 0.6}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Darker, dirtier wood of the rail sleepers.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.8, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_albedo.png", "url": "wood-dark_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_roughness.png", "url": "wood-dark_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_height.png", "url": "wood-dark_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_normal.png", "url": "wood-dark_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_ao.png", "url": "wood-dark_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 110, "sourceHeight": 30, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 110, "height": 30}, "mask": {"backgroundColor": "#7A604D", "backgroundNoise": 99.985, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9203}, "mapStats": {"valueRange": 0.3636, "heightP90Gradient": 0.04136, "roughnessBase": 0.7, "roughnessVariation": 0.071, "normalStrength": 0.205, "blurRadius": 10}, "palette": ["#6B4C36", "#543C2E", "#3F291D", "#866344", "#B4936D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#88613D", "#6C4A32", "#644937", "#655042", "#887D73"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 89.6, "meanSaturation": 0.448, "gradientStrength": 0.217, "mottle": 0.025, "streakRatio": 1.96, "hueSpread": 0.003, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "sleeper-1", "regionId": "sleeper-wood", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}, "observations": ["chromatic base-colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sleeper-1", "regionId": "sleeper-wood", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.8, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "Forged iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#50525a", "color": "#50525a", "albedo": {"dominant": "#50525a", "secondary": ["#3b3c42", "#6b6e76"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#50525a", "#3b3c42", "#6b6e76"], "pattern": "mottled", "amplitude": 0.08, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.112, "role": "facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.04, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.5, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.45, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.15, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.15, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "iron-edge-highlight", "kind": "bevel", "region": "bracket and rim edges", "evidenceRefs": ["full-object"], "confidence": 0.6, "roughnessDelta": -0.15}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Dark neutral grey, satin; brackets, rims, rails, rivets, handle straps. Real-time override of the registry prior (metalness 1.0): metalness 0.45, roughness 0.5, because the game renderer has no environment map.", "evidenceRefs": ["full-object"], "referenceMaterialId": "metal.steel-brushed", "materialFamily": "metal", "materialSubtype": "steel", "materialFinish": "brushed", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.steel-brushed", "method": "family-subtype-finish", "confidence": 0.768, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap", "normalMap", "anisotropyMap"], "optionalMaps": ["metalnessMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "anisotropy": {"base": 0.85, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.768, "estimatedFidelity": 0.768, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 80, "sourceHeight": 50, "mapSize": 512, "cropBBoxPixels": {"x": 7, "y": 17, "width": 73, "height": 33}, "mask": {"backgroundColor": "#67666B", "backgroundNoise": 83.247, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.044}, "mapStats": {"valueRange": 0.1683, "heightP90Gradient": 0.02549, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.186, "blurRadius": 10}, "palette": ["#362D2D", "#2A2324", "#1D1819", "#110E0E", "#403636"]}, "warnings": ["foreground mask is very small", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#544D4F", "#3C373A", "#4B4649", "#353031", "#48444B"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 65.2, "meanSaturation": 0.09, "gradientStrength": 0.209, "mottle": 0.021, "streakRatio": 2.55, "hueSpread": 0.125, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}, "observations": ["near-neutral colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "materialId": null, "family": "metal", "subtype": "steel", "finish": "brushed", "aliases": [], "confidence": 0.768, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["ore"] = createSculptMaterial(
    "ore",
    {"id": "ore", "name": "Gold ore", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#f4c63a", "color": "#f4c63a", "albedo": {"dominant": "#f4c63a", "secondary": ["#e0a42c", "#ffe57a"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#f4c63a", "#e0a42c", "#ffe57a"], "pattern": "mottled", "amplitude": 0.1, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.14, "role": "facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.05, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.34, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.25, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.2, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "ore-facet-gloss", "kind": "gloss", "region": "upward-facing nugget facets", "evidenceRefs": ["full-object"], "confidence": 0.7, "roughness": 0.18, "note": "hotspots toward the upper-left key light"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Saturated yellow gold, lighter on the upward facets. Real-time override of the registry prior (metalness 1.0): metalness 0.25, roughness 0.34, because the game renderer has no environment map.", "evidenceRefs": ["full-object"], "clearcoat": 0.3, "clearcoatRoughness": 0.25, "referenceMaterialId": "metal.gold", "materialFamily": "metal", "materialSubtype": "gold", "materialFinish": "polished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.gold", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "metalnessMap"], "validationViews": ["albedo-unlit", "environment-reflection", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_albedo.png", "url": "ore_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_roughness.png", "url": "ore_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_height.png", "url": "ore_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_normal.png", "url": "ore_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_ao.png", "url": "ore_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 180, "sourceHeight": 80, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 180, "height": 80}, "mask": {"backgroundColor": "#BF8D38", "backgroundNoise": 37.108, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.6068, "heightP90Gradient": 0.06753, "roughnessBase": 0.705, "roughnessVariation": 0.122, "normalStrength": 0.235, "blurRadius": 10}, "palette": ["#FADB6E", "#F1C356", "#DEA440", "#B3782C", "#5C300C"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "gemstone", "recipe": {"metalness": 0.0, "roughness": 0.05, "clearcoat": 1.0, "clearcoatRoughness": 0.0, "transmission": 0.9, "ior": 1.54, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#D8B667", "#E2B650", "#CA9741", "#E2AD46", "#CD993D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 173.7, "meanSaturation": 0.672, "gradientStrength": 0.309, "mottle": 0.052, "streakRatio": 1.5, "hueSpread": 0.007, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "ore-heap", "regionId": "gold-ore", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "ore-heap", "regionId": "gold-ore", "materialId": null, "family": "metal", "subtype": "gold", "finish": "polished", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["gravel"] = createSculptMaterial(
    "gravel",
    {"id": "gravel", "name": "Gravel bed", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#5f5244", "color": "#5f5244", "albedo": {"dominant": "#5f5244", "secondary": ["#3f352b", "#9a8f7d"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#5f5244", "#3f352b", "#9a8f7d"], "pattern": "mottled", "amplitude": 0.4, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "damp and dry patches of the bed"}, {"id": "meso", "frequency": 22.0, "amplitude": 0.55, "role": "pebbles and grit"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.12, "role": "grain of the grit under grazing light"}], "roughness": {"base": 0.96, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.55, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.2, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "pebble-mottle", "kind": "stain", "region": "whole bed top", "evidenceRefs": ["full-object"], "confidence": 0.6, "dirtAmount": 0.2, "pattern": "speckled pebbles"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Irregular grey-brown gravel patch the track lies on.", "evidenceRefs": ["full-object"], "referenceMaterialId": "stone.natural", "materialFamily": "stone", "materialSubtype": "natural", "materialFinish": "rough-or-polished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "stone.natural", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-standard", "three.mesh-physical", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "displacementMap", "clearcoatMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "clearcoat": {"base": 0.0, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_albedo.png", "url": "gravel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_roughness.png", "url": "gravel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_height.png", "url": "gravel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_normal.png", "url": "gravel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_ao.png", "url": "gravel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 150, "sourceHeight": 40, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 150, "height": 40}, "mask": {"backgroundColor": "#37241D", "backgroundNoise": 42.0, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.8198}, "mapStats": {"valueRange": 0.3647, "heightP90Gradient": 0.0823, "roughnessBase": 0.721, "roughnessVariation": 0.138, "normalStrength": 0.253, "blurRadius": 10}, "palette": ["#6A4D39", "#573E2E", "#17120F", "#392C21", "#8B725E"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#2C2928", "#211D1A", "#3D2F25", "#654A37", "#664834"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 57.6, "meanSaturation": 0.376, "gradientStrength": 0.213, "mottle": 0.026, "streakRatio": 1.21, "hueSpread": 0.026, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "root", "regionId": "gravel", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "root", "regionId": "gravel", "materialId": null, "family": "stone", "subtype": "natural", "finish": "rough-or-polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Gravel bed__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Gravel bed", "level": "macro", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gravel bed: a flat slab-like patch with countable faces; the reference shows it as an irregular base, kept as a thin box so the prop sits on the bailey ground.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.46, "height": 0.04, "depth": 0.98, "units": "object", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.46, 0.04, 0.98]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}}, "material": "gravel", "materialLayers": ["gravel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(95, 82, 68, 1.0)", "secondaryAlbedo": "rgba(63, 53, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.7999999999999999, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(63, 53, 43, 1.0)"}, {"position": 1.0, "color": "rgba(95, 82, 68, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gravel-pebbles", "kind": "stain", "description": "speckled pebbles on the bed top", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.98, "microRoughness": 0.196, "bumpAmplitude": 0.0275, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["gravel-pebbles"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gravel"}, "materialRegions": [{"regionId": "gravel", "materialId": "gravel", "profileId": "stone.natural", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}}]};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.46, 0.04, 0.98);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["gravel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Gravel bed";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Gravel bed", "level": "macro", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gravel bed: a flat slab-like patch with countable faces; the reference shows it as an irregular base, kept as a thin box so the prop sits on the bailey ground.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.46, "height": 0.04, "depth": 0.98, "units": "object", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.46, 0.04, 0.98]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}}, "material": "gravel", "materialLayers": ["gravel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(95, 82, 68, 1.0)", "secondaryAlbedo": "rgba(63, 53, 43, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.7999999999999999, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(63, 53, 43, 1.0)"}, {"position": 1.0, "color": "rgba(95, 82, 68, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gravel-pebbles", "kind": "stain", "description": "speckled pebbles on the bed top", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.98, "microRoughness": 0.196, "bumpAmplitude": 0.0275, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["gravel-pebbles"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gravel"}, "materialRegions": [{"regionId": "gravel", "materialId": "gravel", "profileId": "stone.natural", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}}]};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_sleeper_0_1 = makeAttachmentEndpoint(null);
  const node_sleeper_0_1 = new THREE.Group();
  node_sleeper_0_1.name = "Sleeper 1__pivot";
  node_sleeper_0_1.scale.set(1, 1, 1);
  if (endpoint_sleeper_0_1) {
    node_sleeper_0_1.position.copy(endpoint_sleeper_0_1.start);
    node_sleeper_0_1.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_sleeper_0_1.position.set(-0.54, 0.055, 0.0);
    node_sleeper_0_1.rotation.set(-0.0, 0.0, -0.0);
  }
  node_sleeper_0_1.userData.sculptComponent = {"id": "sleeper-0", "name": "Sleeper 1", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-0-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-0-ends"]};
  node_sleeper_0_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_0_1);
  nodes["sleeper-0"] = node_sleeper_0_1;
  const mesh_sleeper_0_1Geometry = endpoint_sleeper_0_1
    ? new THREE.CylinderGeometry(endpoint_sleeper_0_1.endRadius, endpoint_sleeper_0_1.baseRadius, endpoint_sleeper_0_1.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_0_1) {
    mesh_sleeper_0_1Geometry.scale(0.18, 0.07, 1.16);
  }
  const mesh_sleeper_0_1 = new THREE.Mesh(
    mesh_sleeper_0_1Geometry,
    materialMap["wood-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeper_0_1.name = "Sleeper 1";
  if (endpoint_sleeper_0_1) {
    mesh_sleeper_0_1.position.copy(endpoint_sleeper_0_1.midpoint);
    mesh_sleeper_0_1.quaternion.copy(endpoint_sleeper_0_1.quaternion);
  }
  mesh_sleeper_0_1.castShadow = options.castShadow ?? true;
  mesh_sleeper_0_1.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeper_0_1.userData.sculptComponent = {"id": "sleeper-0", "name": "Sleeper 1", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-0-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-0-ends"]};
  node_sleeper_0_1.add(mesh_sleeper_0_1);
  meshes["sleeper-0"] = mesh_sleeper_0_1;
  colliders["sleeper-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["sleeper-0"] ??= [];
  destructionGroups["sleeper-0"].push(node_sleeper_0_1);

  const endpoint_sleeper_1_2 = makeAttachmentEndpoint(null);
  const node_sleeper_1_2 = new THREE.Group();
  node_sleeper_1_2.name = "Sleeper 2__pivot";
  node_sleeper_1_2.scale.set(1, 1, 1);
  if (endpoint_sleeper_1_2) {
    node_sleeper_1_2.position.copy(endpoint_sleeper_1_2.start);
    node_sleeper_1_2.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_sleeper_1_2.position.set(0.0, 0.055, 0.0);
    node_sleeper_1_2.rotation.set(-0.0, 0.0, -0.0);
  }
  node_sleeper_1_2.userData.sculptComponent = {"id": "sleeper-1", "name": "Sleeper 2", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-1-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-1-ends"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood-dark"}, "materialRegions": [{"regionId": "sleeper-wood", "materialId": "wood-dark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}}]};
  node_sleeper_1_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_1_2);
  nodes["sleeper-1"] = node_sleeper_1_2;
  const mesh_sleeper_1_2Geometry = endpoint_sleeper_1_2
    ? new THREE.CylinderGeometry(endpoint_sleeper_1_2.endRadius, endpoint_sleeper_1_2.baseRadius, endpoint_sleeper_1_2.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_1_2) {
    mesh_sleeper_1_2Geometry.scale(0.18, 0.07, 1.16);
  }
  const mesh_sleeper_1_2 = new THREE.Mesh(
    mesh_sleeper_1_2Geometry,
    materialMap["wood-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeper_1_2.name = "Sleeper 2";
  if (endpoint_sleeper_1_2) {
    mesh_sleeper_1_2.position.copy(endpoint_sleeper_1_2.midpoint);
    mesh_sleeper_1_2.quaternion.copy(endpoint_sleeper_1_2.quaternion);
  }
  mesh_sleeper_1_2.castShadow = options.castShadow ?? true;
  mesh_sleeper_1_2.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeper_1_2.userData.sculptComponent = {"id": "sleeper-1", "name": "Sleeper 2", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-1-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-1-ends"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood-dark"}, "materialRegions": [{"regionId": "sleeper-wood", "materialId": "wood-dark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}}]};
  node_sleeper_1_2.add(mesh_sleeper_1_2);
  meshes["sleeper-1"] = mesh_sleeper_1_2;
  colliders["sleeper-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["sleeper-1"] ??= [];
  destructionGroups["sleeper-1"].push(node_sleeper_1_2);

  const endpoint_sleeper_2_3 = makeAttachmentEndpoint(null);
  const node_sleeper_2_3 = new THREE.Group();
  node_sleeper_2_3.name = "Sleeper 3__pivot";
  node_sleeper_2_3.scale.set(1, 1, 1);
  if (endpoint_sleeper_2_3) {
    node_sleeper_2_3.position.copy(endpoint_sleeper_2_3.start);
    node_sleeper_2_3.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_sleeper_2_3.position.set(0.54, 0.055, 0.0);
    node_sleeper_2_3.rotation.set(-0.0, 0.0, -0.0);
  }
  node_sleeper_2_3.userData.sculptComponent = {"id": "sleeper-2", "name": "Sleeper 3", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-2-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-2-ends"]};
  node_sleeper_2_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_2_3);
  nodes["sleeper-2"] = node_sleeper_2_3;
  const mesh_sleeper_2_3Geometry = endpoint_sleeper_2_3
    ? new THREE.CylinderGeometry(endpoint_sleeper_2_3.endRadius, endpoint_sleeper_2_3.baseRadius, endpoint_sleeper_2_3.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_2_3) {
    mesh_sleeper_2_3Geometry.scale(0.18, 0.07, 1.16);
  }
  const mesh_sleeper_2_3 = new THREE.Mesh(
    mesh_sleeper_2_3Geometry,
    materialMap["wood-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sleeper_2_3.name = "Sleeper 3";
  if (endpoint_sleeper_2_3) {
    mesh_sleeper_2_3.position.copy(endpoint_sleeper_2_3.midpoint);
    mesh_sleeper_2_3.quaternion.copy(endpoint_sleeper_2_3.quaternion);
  }
  mesh_sleeper_2_3.castShadow = options.castShadow ?? true;
  mesh_sleeper_2_3.receiveShadow = options.receiveShadow ?? true;
  mesh_sleeper_2_3.userData.sculptComponent = {"id": "sleeper-2", "name": "Sleeper 3", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.16, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.16]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-2-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-2-ends"]};
  node_sleeper_2_3.add(mesh_sleeper_2_3);
  meshes["sleeper-2"] = mesh_sleeper_2_3;
  colliders["sleeper-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["sleeper-2"] ??= [];
  destructionGroups["sleeper-2"].push(node_sleeper_2_3);

  const endpoint_rail_near_4 = makeAttachmentEndpoint(null);
  const node_rail_near_4 = new THREE.Group();
  node_rail_near_4.name = "Rail (near)__pivot";
  node_rail_near_4.scale.set(1, 1, 1);
  if (endpoint_rail_near_4) {
    node_rail_near_4.position.copy(endpoint_rail_near_4.start);
    node_rail_near_4.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_rail_near_4.position.set(0.0, 0.125, 0.335);
    node_rail_near_4.rotation.set(-0.0, 0.0, -0.0);
  }
  node_rail_near_4.userData.sculptComponent = {"id": "rail-near", "name": "Rail (near)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (near): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.44, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.44, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-near-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-near-head"]};
  node_rail_near_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rail_near_4);
  nodes["rail-near"] = node_rail_near_4;
  const mesh_rail_near_4Geometry = endpoint_rail_near_4
    ? new THREE.CylinderGeometry(endpoint_rail_near_4.endRadius, endpoint_rail_near_4.baseRadius, endpoint_rail_near_4.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_rail_near_4) {
    mesh_rail_near_4Geometry.scale(1.44, 0.07, 0.06);
  }
  const mesh_rail_near_4 = new THREE.Mesh(
    mesh_rail_near_4Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rail_near_4.name = "Rail (near)";
  if (endpoint_rail_near_4) {
    mesh_rail_near_4.position.copy(endpoint_rail_near_4.midpoint);
    mesh_rail_near_4.quaternion.copy(endpoint_rail_near_4.quaternion);
  }
  mesh_rail_near_4.castShadow = options.castShadow ?? true;
  mesh_rail_near_4.receiveShadow = options.receiveShadow ?? true;
  mesh_rail_near_4.userData.sculptComponent = {"id": "rail-near", "name": "Rail (near)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (near): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.44, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.44, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-near-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-near-head"]};
  node_rail_near_4.add(mesh_rail_near_4);
  meshes["rail-near"] = mesh_rail_near_4;
  colliders["rail-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["rail-near"] ??= [];
  destructionGroups["rail-near"].push(node_rail_near_4);

  const endpoint_tie_plate_near_0_5 = makeAttachmentEndpoint(null);
  const node_tie_plate_near_0_5 = new THREE.Group();
  node_tie_plate_near_0_5.name = "Tie plate near 1__pivot";
  node_tie_plate_near_0_5.scale.set(1, 1, 1);
  if (endpoint_tie_plate_near_0_5) {
    node_tie_plate_near_0_5.position.copy(endpoint_tie_plate_near_0_5.start);
    node_tie_plate_near_0_5.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_near_0_5.position.set(-0.54, 0.094, 0.335);
    node_tie_plate_near_0_5.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_near_0_5.userData.sculptComponent = {"id": "tie-plate-near-0", "name": "Tie plate near 1", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-0-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-0-spikes"]};
  node_tie_plate_near_0_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_near_0_5);
  nodes["tie-plate-near-0"] = node_tie_plate_near_0_5;
  const mesh_tie_plate_near_0_5Geometry = endpoint_tie_plate_near_0_5
    ? new THREE.CylinderGeometry(endpoint_tie_plate_near_0_5.endRadius, endpoint_tie_plate_near_0_5.baseRadius, endpoint_tie_plate_near_0_5.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_near_0_5) {
    mesh_tie_plate_near_0_5Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_near_0_5 = new THREE.Mesh(
    mesh_tie_plate_near_0_5Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_near_0_5.name = "Tie plate near 1";
  if (endpoint_tie_plate_near_0_5) {
    mesh_tie_plate_near_0_5.position.copy(endpoint_tie_plate_near_0_5.midpoint);
    mesh_tie_plate_near_0_5.quaternion.copy(endpoint_tie_plate_near_0_5.quaternion);
  }
  mesh_tie_plate_near_0_5.castShadow = options.castShadow ?? true;
  mesh_tie_plate_near_0_5.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_near_0_5.userData.sculptComponent = {"id": "tie-plate-near-0", "name": "Tie plate near 1", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-0-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-0-spikes"]};
  node_tie_plate_near_0_5.add(mesh_tie_plate_near_0_5);
  meshes["tie-plate-near-0"] = mesh_tie_plate_near_0_5;
  colliders["tie-plate-near-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-near-0"] ??= [];
  destructionGroups["tie-plate-near-0"].push(node_tie_plate_near_0_5);

  const endpoint_tie_plate_near_1_6 = makeAttachmentEndpoint(null);
  const node_tie_plate_near_1_6 = new THREE.Group();
  node_tie_plate_near_1_6.name = "Tie plate near 2__pivot";
  node_tie_plate_near_1_6.scale.set(1, 1, 1);
  if (endpoint_tie_plate_near_1_6) {
    node_tie_plate_near_1_6.position.copy(endpoint_tie_plate_near_1_6.start);
    node_tie_plate_near_1_6.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_near_1_6.position.set(0.0, 0.094, 0.335);
    node_tie_plate_near_1_6.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_near_1_6.userData.sculptComponent = {"id": "tie-plate-near-1", "name": "Tie plate near 2", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-1-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-1-spikes"]};
  node_tie_plate_near_1_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_near_1_6);
  nodes["tie-plate-near-1"] = node_tie_plate_near_1_6;
  const mesh_tie_plate_near_1_6Geometry = endpoint_tie_plate_near_1_6
    ? new THREE.CylinderGeometry(endpoint_tie_plate_near_1_6.endRadius, endpoint_tie_plate_near_1_6.baseRadius, endpoint_tie_plate_near_1_6.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_near_1_6) {
    mesh_tie_plate_near_1_6Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_near_1_6 = new THREE.Mesh(
    mesh_tie_plate_near_1_6Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_near_1_6.name = "Tie plate near 2";
  if (endpoint_tie_plate_near_1_6) {
    mesh_tie_plate_near_1_6.position.copy(endpoint_tie_plate_near_1_6.midpoint);
    mesh_tie_plate_near_1_6.quaternion.copy(endpoint_tie_plate_near_1_6.quaternion);
  }
  mesh_tie_plate_near_1_6.castShadow = options.castShadow ?? true;
  mesh_tie_plate_near_1_6.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_near_1_6.userData.sculptComponent = {"id": "tie-plate-near-1", "name": "Tie plate near 2", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-1-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-1-spikes"]};
  node_tie_plate_near_1_6.add(mesh_tie_plate_near_1_6);
  meshes["tie-plate-near-1"] = mesh_tie_plate_near_1_6;
  colliders["tie-plate-near-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-near-1"] ??= [];
  destructionGroups["tie-plate-near-1"].push(node_tie_plate_near_1_6);

  const endpoint_tie_plate_near_2_7 = makeAttachmentEndpoint(null);
  const node_tie_plate_near_2_7 = new THREE.Group();
  node_tie_plate_near_2_7.name = "Tie plate near 3__pivot";
  node_tie_plate_near_2_7.scale.set(1, 1, 1);
  if (endpoint_tie_plate_near_2_7) {
    node_tie_plate_near_2_7.position.copy(endpoint_tie_plate_near_2_7.start);
    node_tie_plate_near_2_7.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_near_2_7.position.set(0.54, 0.094, 0.335);
    node_tie_plate_near_2_7.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_near_2_7.userData.sculptComponent = {"id": "tie-plate-near-2", "name": "Tie plate near 3", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-2-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-2-spikes"]};
  node_tie_plate_near_2_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_near_2_7);
  nodes["tie-plate-near-2"] = node_tie_plate_near_2_7;
  const mesh_tie_plate_near_2_7Geometry = endpoint_tie_plate_near_2_7
    ? new THREE.CylinderGeometry(endpoint_tie_plate_near_2_7.endRadius, endpoint_tie_plate_near_2_7.baseRadius, endpoint_tie_plate_near_2_7.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_near_2_7) {
    mesh_tie_plate_near_2_7Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_near_2_7 = new THREE.Mesh(
    mesh_tie_plate_near_2_7Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_near_2_7.name = "Tie plate near 3";
  if (endpoint_tie_plate_near_2_7) {
    mesh_tie_plate_near_2_7.position.copy(endpoint_tie_plate_near_2_7.midpoint);
    mesh_tie_plate_near_2_7.quaternion.copy(endpoint_tie_plate_near_2_7.quaternion);
  }
  mesh_tie_plate_near_2_7.castShadow = options.castShadow ?? true;
  mesh_tie_plate_near_2_7.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_near_2_7.userData.sculptComponent = {"id": "tie-plate-near-2", "name": "Tie plate near 3", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate near 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.094, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-near-2-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-near-2-spikes"]};
  node_tie_plate_near_2_7.add(mesh_tie_plate_near_2_7);
  meshes["tie-plate-near-2"] = mesh_tie_plate_near_2_7;
  colliders["tie-plate-near-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-near-2"] ??= [];
  destructionGroups["tie-plate-near-2"].push(node_tie_plate_near_2_7);

  const endpoint_rail_far_8 = makeAttachmentEndpoint(null);
  const node_rail_far_8 = new THREE.Group();
  node_rail_far_8.name = "Rail (far)__pivot";
  node_rail_far_8.scale.set(1, 1, 1);
  if (endpoint_rail_far_8) {
    node_rail_far_8.position.copy(endpoint_rail_far_8.start);
    node_rail_far_8.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_rail_far_8.position.set(0.0, 0.125, -0.335);
    node_rail_far_8.rotation.set(-0.0, 0.0, -0.0);
  }
  node_rail_far_8.userData.sculptComponent = {"id": "rail-far", "name": "Rail (far)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (far): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.44, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.44, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-far-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-far-head"]};
  node_rail_far_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rail_far_8);
  nodes["rail-far"] = node_rail_far_8;
  const mesh_rail_far_8Geometry = endpoint_rail_far_8
    ? new THREE.CylinderGeometry(endpoint_rail_far_8.endRadius, endpoint_rail_far_8.baseRadius, endpoint_rail_far_8.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_rail_far_8) {
    mesh_rail_far_8Geometry.scale(1.44, 0.07, 0.06);
  }
  const mesh_rail_far_8 = new THREE.Mesh(
    mesh_rail_far_8Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rail_far_8.name = "Rail (far)";
  if (endpoint_rail_far_8) {
    mesh_rail_far_8.position.copy(endpoint_rail_far_8.midpoint);
    mesh_rail_far_8.quaternion.copy(endpoint_rail_far_8.quaternion);
  }
  mesh_rail_far_8.castShadow = options.castShadow ?? true;
  mesh_rail_far_8.receiveShadow = options.receiveShadow ?? true;
  mesh_rail_far_8.userData.sculptComponent = {"id": "rail-far", "name": "Rail (far)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (far): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.44, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.44, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-far-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-far-head"]};
  node_rail_far_8.add(mesh_rail_far_8);
  meshes["rail-far"] = mesh_rail_far_8;
  colliders["rail-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["rail-far"] ??= [];
  destructionGroups["rail-far"].push(node_rail_far_8);

  const endpoint_tie_plate_far_0_9 = makeAttachmentEndpoint(null);
  const node_tie_plate_far_0_9 = new THREE.Group();
  node_tie_plate_far_0_9.name = "Tie plate far 1__pivot";
  node_tie_plate_far_0_9.scale.set(1, 1, 1);
  if (endpoint_tie_plate_far_0_9) {
    node_tie_plate_far_0_9.position.copy(endpoint_tie_plate_far_0_9.start);
    node_tie_plate_far_0_9.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_far_0_9.position.set(-0.54, 0.094, -0.335);
    node_tie_plate_far_0_9.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_far_0_9.userData.sculptComponent = {"id": "tie-plate-far-0", "name": "Tie plate far 1", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-0-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-0-spikes"]};
  node_tie_plate_far_0_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_far_0_9);
  nodes["tie-plate-far-0"] = node_tie_plate_far_0_9;
  const mesh_tie_plate_far_0_9Geometry = endpoint_tie_plate_far_0_9
    ? new THREE.CylinderGeometry(endpoint_tie_plate_far_0_9.endRadius, endpoint_tie_plate_far_0_9.baseRadius, endpoint_tie_plate_far_0_9.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_far_0_9) {
    mesh_tie_plate_far_0_9Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_far_0_9 = new THREE.Mesh(
    mesh_tie_plate_far_0_9Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_far_0_9.name = "Tie plate far 1";
  if (endpoint_tie_plate_far_0_9) {
    mesh_tie_plate_far_0_9.position.copy(endpoint_tie_plate_far_0_9.midpoint);
    mesh_tie_plate_far_0_9.quaternion.copy(endpoint_tie_plate_far_0_9.quaternion);
  }
  mesh_tie_plate_far_0_9.castShadow = options.castShadow ?? true;
  mesh_tie_plate_far_0_9.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_far_0_9.userData.sculptComponent = {"id": "tie-plate-far-0", "name": "Tie plate far 1", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.54, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-0-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-0-spikes"]};
  node_tie_plate_far_0_9.add(mesh_tie_plate_far_0_9);
  meshes["tie-plate-far-0"] = mesh_tie_plate_far_0_9;
  colliders["tie-plate-far-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-far-0"] ??= [];
  destructionGroups["tie-plate-far-0"].push(node_tie_plate_far_0_9);

  const endpoint_tie_plate_far_1_10 = makeAttachmentEndpoint(null);
  const node_tie_plate_far_1_10 = new THREE.Group();
  node_tie_plate_far_1_10.name = "Tie plate far 2__pivot";
  node_tie_plate_far_1_10.scale.set(1, 1, 1);
  if (endpoint_tie_plate_far_1_10) {
    node_tie_plate_far_1_10.position.copy(endpoint_tie_plate_far_1_10.start);
    node_tie_plate_far_1_10.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_far_1_10.position.set(0.0, 0.094, -0.335);
    node_tie_plate_far_1_10.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_far_1_10.userData.sculptComponent = {"id": "tie-plate-far-1", "name": "Tie plate far 2", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-1-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-1-spikes"]};
  node_tie_plate_far_1_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_far_1_10);
  nodes["tie-plate-far-1"] = node_tie_plate_far_1_10;
  const mesh_tie_plate_far_1_10Geometry = endpoint_tie_plate_far_1_10
    ? new THREE.CylinderGeometry(endpoint_tie_plate_far_1_10.endRadius, endpoint_tie_plate_far_1_10.baseRadius, endpoint_tie_plate_far_1_10.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_far_1_10) {
    mesh_tie_plate_far_1_10Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_far_1_10 = new THREE.Mesh(
    mesh_tie_plate_far_1_10Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_far_1_10.name = "Tie plate far 2";
  if (endpoint_tie_plate_far_1_10) {
    mesh_tie_plate_far_1_10.position.copy(endpoint_tie_plate_far_1_10.midpoint);
    mesh_tie_plate_far_1_10.quaternion.copy(endpoint_tie_plate_far_1_10.quaternion);
  }
  mesh_tie_plate_far_1_10.castShadow = options.castShadow ?? true;
  mesh_tie_plate_far_1_10.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_far_1_10.userData.sculptComponent = {"id": "tie-plate-far-1", "name": "Tie plate far 2", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-1-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-1-spikes"]};
  node_tie_plate_far_1_10.add(mesh_tie_plate_far_1_10);
  meshes["tie-plate-far-1"] = mesh_tie_plate_far_1_10;
  colliders["tie-plate-far-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-far-1"] ??= [];
  destructionGroups["tie-plate-far-1"].push(node_tie_plate_far_1_10);

  const endpoint_tie_plate_far_2_11 = makeAttachmentEndpoint(null);
  const node_tie_plate_far_2_11 = new THREE.Group();
  node_tie_plate_far_2_11.name = "Tie plate far 3__pivot";
  node_tie_plate_far_2_11.scale.set(1, 1, 1);
  if (endpoint_tie_plate_far_2_11) {
    node_tie_plate_far_2_11.position.copy(endpoint_tie_plate_far_2_11.start);
    node_tie_plate_far_2_11.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tie_plate_far_2_11.position.set(0.54, 0.094, -0.335);
    node_tie_plate_far_2_11.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tie_plate_far_2_11.userData.sculptComponent = {"id": "tie-plate-far-2", "name": "Tie plate far 3", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-2-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-2-spikes"]};
  node_tie_plate_far_2_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_tie_plate_far_2_11);
  nodes["tie-plate-far-2"] = node_tie_plate_far_2_11;
  const mesh_tie_plate_far_2_11Geometry = endpoint_tie_plate_far_2_11
    ? new THREE.CylinderGeometry(endpoint_tie_plate_far_2_11.endRadius, endpoint_tie_plate_far_2_11.baseRadius, endpoint_tie_plate_far_2_11.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_tie_plate_far_2_11) {
    mesh_tie_plate_far_2_11Geometry.scale(0.13, 0.012, 0.14);
  }
  const mesh_tie_plate_far_2_11 = new THREE.Mesh(
    mesh_tie_plate_far_2_11Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tie_plate_far_2_11.name = "Tie plate far 3";
  if (endpoint_tie_plate_far_2_11) {
    mesh_tie_plate_far_2_11.position.copy(endpoint_tie_plate_far_2_11.midpoint);
    mesh_tie_plate_far_2_11.quaternion.copy(endpoint_tie_plate_far_2_11.quaternion);
  }
  mesh_tie_plate_far_2_11.castShadow = options.castShadow ?? true;
  mesh_tie_plate_far_2_11.receiveShadow = options.receiveShadow ?? true;
  mesh_tie_plate_far_2_11.userData.sculptComponent = {"id": "tie-plate-far-2", "name": "Tie plate far 3", "level": "micro", "role": "plate", "importance": 0.25, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Tie plate far 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.13, "height": 0.012, "depth": 0.14, "units": "object", "confidence": 0.75}, "transform": {"position": [0.54, 0.094, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.012, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tie-plate-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tie-plate-far-2-spikes", "kind": "fastener", "description": "plate pinned to the sleeper", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tie-plate-far-2-spikes"]};
  node_tie_plate_far_2_11.add(mesh_tie_plate_far_2_11);
  meshes["tie-plate-far-2"] = mesh_tie_plate_far_2_11;
  colliders["tie-plate-far-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tie-plate-far-2"] ??= [];
  destructionGroups["tie-plate-far-2"].push(node_tie_plate_far_2_11);

  const endpoint_chassis_frame_12 = makeAttachmentEndpoint(null);
  const node_chassis_frame_12 = new THREE.Group();
  node_chassis_frame_12.name = "Chassis frame__pivot";
  node_chassis_frame_12.scale.set(1, 1, 1);
  if (endpoint_chassis_frame_12) {
    node_chassis_frame_12.position.copy(endpoint_chassis_frame_12.start);
    node_chassis_frame_12.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_chassis_frame_12.position.set(0.0, 0.41, 0.0);
    node_chassis_frame_12.rotation.set(-0.0, 0.0, -0.0);
  }
  node_chassis_frame_12.userData.sculptComponent = {"id": "chassis-frame", "name": "Chassis frame", "level": "macro", "role": "frame", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chassis frame: a flat rigid beam frame under the tub, box-shaped; the axles run through it.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.84, "height": 0.12, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.41, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.84, 0.12, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_chassis_frame_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_chassis_frame_12);
  nodes["chassis-frame"] = node_chassis_frame_12;
  const mesh_chassis_frame_12Geometry = endpoint_chassis_frame_12
    ? new THREE.CylinderGeometry(endpoint_chassis_frame_12.endRadius, endpoint_chassis_frame_12.baseRadius, endpoint_chassis_frame_12.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_chassis_frame_12) {
    mesh_chassis_frame_12Geometry.scale(0.84, 0.12, 0.5);
  }
  const mesh_chassis_frame_12 = new THREE.Mesh(
    mesh_chassis_frame_12Geometry,
    materialMap["wood-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chassis_frame_12.name = "Chassis frame";
  if (endpoint_chassis_frame_12) {
    mesh_chassis_frame_12.position.copy(endpoint_chassis_frame_12.midpoint);
    mesh_chassis_frame_12.quaternion.copy(endpoint_chassis_frame_12.quaternion);
  }
  mesh_chassis_frame_12.castShadow = options.castShadow ?? true;
  mesh_chassis_frame_12.receiveShadow = options.receiveShadow ?? true;
  mesh_chassis_frame_12.userData.sculptComponent = {"id": "chassis-frame", "name": "Chassis frame", "level": "macro", "role": "frame", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chassis frame: a flat rigid beam frame under the tub, box-shaped; the axles run through it.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.84, "height": 0.12, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.41, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.84, 0.12, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 70, 40, 1.0)", "secondaryAlbedo": "rgba(87, 55, 31, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(87, 55, 31, 1.0)"}, {"position": 1.0, "color": "rgba(110, 70, 40, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_chassis_frame_12.add(mesh_chassis_frame_12);
  meshes["chassis-frame"] = mesh_chassis_frame_12;
  colliders["chassis-frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["chassis-frame"] ??= [];
  destructionGroups["chassis-frame"].push(node_chassis_frame_12);

  const attachment_axle_front_13 = {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [-0.3, -0.085, -0.39], "localEnd": [-0.3, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_front_13 = makeAttachmentEndpoint(attachment_axle_front_13);
  const node_axle_front_13 = new THREE.Group();
  node_axle_front_13.name = "Axle (front)__pivot";
  node_axle_front_13.scale.set(1, 1, 1);
  if (endpoint_axle_front_13) {
    node_axle_front_13.position.copy(endpoint_axle_front_13.start);
    node_axle_front_13.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_front_13.position.set(-0.3, -0.085, -0.39);
    node_axle_front_13.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_front_13.userData.sculptComponent = {"id": "axle-front", "name": "Axle (front)", "level": "meso", "role": "connector", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle: a straight round bar, a genuine cylinder between its two bearing points.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [-0.3, -0.085, -0.39], "localEnd": [-0.3, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.39], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_axle_front_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["chassis-frame"] ?? root).add(node_axle_front_13);
  nodes["axle-front"] = node_axle_front_13;
  const mesh_axle_front_13Geometry = endpoint_axle_front_13
    ? new THREE.CylinderGeometry(endpoint_axle_front_13.endRadius, endpoint_axle_front_13.baseRadius, endpoint_axle_front_13.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_front_13) {
    mesh_axle_front_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_front_13 = new THREE.Mesh(
    mesh_axle_front_13Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_front_13.name = "Axle (front)";
  if (endpoint_axle_front_13) {
    mesh_axle_front_13.position.copy(endpoint_axle_front_13.midpoint);
    mesh_axle_front_13.quaternion.copy(endpoint_axle_front_13.quaternion);
  }
  mesh_axle_front_13.castShadow = options.castShadow ?? true;
  mesh_axle_front_13.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_front_13.userData.sculptComponent = {"id": "axle-front", "name": "Axle (front)", "level": "meso", "role": "connector", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle: a straight round bar, a genuine cylinder between its two bearing points.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [-0.3, -0.085, -0.39], "localEnd": [-0.3, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.39], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_axle_front_13.add(mesh_axle_front_13);
  meshes["axle-front"] = mesh_axle_front_13;
  colliders["axle-front"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-front"] ??= [];
  destructionGroups["axle-front"].push(node_axle_front_13);

  const attachment_axle_rear_14 = {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [0.22, -0.085, -0.39], "localEnd": [0.22, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_rear_14 = makeAttachmentEndpoint(attachment_axle_rear_14);
  const node_axle_rear_14 = new THREE.Group();
  node_axle_rear_14.name = "Axle (rear)__pivot";
  node_axle_rear_14.scale.set(1, 1, 1);
  if (endpoint_axle_rear_14) {
    node_axle_rear_14.position.copy(endpoint_axle_rear_14.start);
    node_axle_rear_14.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_rear_14.position.set(0.22, -0.085, -0.39);
    node_axle_rear_14.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_rear_14.userData.sculptComponent = {"id": "axle-rear", "name": "Axle (rear)", "level": "meso", "role": "connector", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle: a straight round bar, a genuine cylinder between its two bearing points.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [0.22, -0.085, -0.39], "localEnd": [0.22, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.39], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_axle_rear_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["chassis-frame"] ?? root).add(node_axle_rear_14);
  nodes["axle-rear"] = node_axle_rear_14;
  const mesh_axle_rear_14Geometry = endpoint_axle_rear_14
    ? new THREE.CylinderGeometry(endpoint_axle_rear_14.endRadius, endpoint_axle_rear_14.baseRadius, endpoint_axle_rear_14.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_rear_14) {
    mesh_axle_rear_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_rear_14 = new THREE.Mesh(
    mesh_axle_rear_14Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_rear_14.name = "Axle (rear)";
  if (endpoint_axle_rear_14) {
    mesh_axle_rear_14.position.copy(endpoint_axle_rear_14.midpoint);
    mesh_axle_rear_14.quaternion.copy(endpoint_axle_rear_14.quaternion);
  }
  mesh_axle_rear_14.castShadow = options.castShadow ?? true;
  mesh_axle_rear_14.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_rear_14.userData.sculptComponent = {"id": "axle-rear", "name": "Axle (rear)", "level": "meso", "role": "connector", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle: a straight round bar, a genuine cylinder between its two bearing points.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "chassis-frame:axle-boxes", "localStart": [0.22, -0.085, -0.39], "localEnd": [0.22, -0.085, 0.39], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "socket", "embedDepth": 0.014, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.39], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_axle_rear_14.add(mesh_axle_rear_14);
  meshes["axle-rear"] = mesh_axle_rear_14;
  colliders["axle-rear"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-rear"] ??= [];
  destructionGroups["axle-rear"].push(node_axle_rear_14);

  const endpoint_wheel_fn_15 = makeAttachmentEndpoint(null);
  const node_wheel_fn_15 = new THREE.Group();
  node_wheel_fn_15.name = "Wheel fn__pivot";
  node_wheel_fn_15.scale.set(1, 1, 1);
  if (endpoint_wheel_fn_15) {
    node_wheel_fn_15.position.copy(endpoint_wheel_fn_15.start);
    node_wheel_fn_15.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_fn_15.position.set(-0.3, -0.085, 0.335);
    node_wheel_fn_15.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_fn_15.userData.sculptComponent = {"id": "wheel-fn", "name": "Wheel fn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, 0.3], "localEnd": [-0.3, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-fn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-fn-planks"]};
  node_wheel_fn_15.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_fn_15);
  nodes["wheel-fn"] = node_wheel_fn_15;
  const mesh_wheel_fn_15Geometry = endpoint_wheel_fn_15
    ? new THREE.CylinderGeometry(endpoint_wheel_fn_15.endRadius, endpoint_wheel_fn_15.baseRadius, endpoint_wheel_fn_15.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_fn_15) {
    mesh_wheel_fn_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_fn_15 = new THREE.Mesh(
    mesh_wheel_fn_15Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_fn_15.name = "Wheel fn";
  if (endpoint_wheel_fn_15) {
    mesh_wheel_fn_15.position.copy(endpoint_wheel_fn_15.midpoint);
    mesh_wheel_fn_15.quaternion.copy(endpoint_wheel_fn_15.quaternion);
  }
  mesh_wheel_fn_15.castShadow = options.castShadow ?? true;
  mesh_wheel_fn_15.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_fn_15.userData.sculptComponent = {"id": "wheel-fn", "name": "Wheel fn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, 0.3], "localEnd": [-0.3, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-fn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-fn-planks"]};
  node_wheel_fn_15.add(mesh_wheel_fn_15);
  meshes["wheel-fn"] = mesh_wheel_fn_15;
  colliders["wheel-fn"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-fn"] ??= [];
  destructionGroups["wheel-fn"].push(node_wheel_fn_15);

  const endpoint_wheel_rim_fn_16 = makeAttachmentEndpoint(null);
  const node_wheel_rim_fn_16 = new THREE.Group();
  node_wheel_rim_fn_16.name = "Wheel rim fn__pivot";
  node_wheel_rim_fn_16.scale.set(1, 1, 1);
  if (endpoint_wheel_rim_fn_16) {
    node_wheel_rim_fn_16.position.copy(endpoint_wheel_rim_fn_16.start);
    node_wheel_rim_fn_16.rotation.set(-1.5708, 0.0, -0.0);
  } else {
    node_wheel_rim_fn_16.position.set(0.0, 0.0, 0.0);
    node_wheel_rim_fn_16.rotation.set(-1.5708, 0.0, -0.0);
  }
  node_wheel_rim_fn_16.userData.sculptComponent = {"id": "wheel-rim-fn", "name": "Wheel rim fn", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-fn", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-fn", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-fn"]};
  node_wheel_rim_fn_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-fn"] ?? root).add(node_wheel_rim_fn_16);
  nodes["wheel-rim-fn"] = node_wheel_rim_fn_16;
  const mesh_wheel_rim_fn_16Geometry = endpoint_wheel_rim_fn_16
    ? new THREE.CylinderGeometry(endpoint_wheel_rim_fn_16.endRadius, endpoint_wheel_rim_fn_16.baseRadius, endpoint_wheel_rim_fn_16.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.072, 8, 16);
  if (!endpoint_wheel_rim_fn_16) {
    mesh_wheel_rim_fn_16Geometry.scale(0.37, 0.37, 0.5);
  }
  const mesh_wheel_rim_fn_16 = new THREE.Mesh(
    mesh_wheel_rim_fn_16Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rim_fn_16.name = "Wheel rim fn";
  if (endpoint_wheel_rim_fn_16) {
    mesh_wheel_rim_fn_16.position.copy(endpoint_wheel_rim_fn_16.midpoint);
    mesh_wheel_rim_fn_16.quaternion.copy(endpoint_wheel_rim_fn_16.quaternion);
  }
  mesh_wheel_rim_fn_16.castShadow = options.castShadow ?? true;
  mesh_wheel_rim_fn_16.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rim_fn_16.userData.sculptComponent = {"id": "wheel-rim-fn", "name": "Wheel rim fn", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-fn", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-fn", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-fn"]};
  node_wheel_rim_fn_16.add(mesh_wheel_rim_fn_16);
  meshes["wheel-rim-fn"] = mesh_wheel_rim_fn_16;
  colliders["wheel-rim-fn"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rim-fn"] ??= [];
  destructionGroups["wheel-rim-fn"].push(node_wheel_rim_fn_16);

  const attachment_hub_cap_fn_17 = {"parentId": "wheel-fn", "parentSocket": "wheel-fn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_hub_cap_fn_17 = makeAttachmentEndpoint(attachment_hub_cap_fn_17);
  const node_hub_cap_fn_17 = new THREE.Group();
  node_hub_cap_fn_17.name = "Hub cap fn__pivot";
  node_hub_cap_fn_17.scale.set(1, 1, 1);
  if (endpoint_hub_cap_fn_17) {
    node_hub_cap_fn_17.position.copy(endpoint_hub_cap_fn_17.start);
    node_hub_cap_fn_17.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_hub_cap_fn_17.position.set(0.0, 0.035, 0.0);
    node_hub_cap_fn_17.rotation.set(-0.0, 0.0, -0.0);
  }
  node_hub_cap_fn_17.userData.sculptComponent = {"id": "hub-cap-fn", "name": "Hub cap fn", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-fn", "attachment": {"parentId": "wheel-fn", "parentSocket": "wheel-fn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.035, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_fn_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-fn"] ?? root).add(node_hub_cap_fn_17);
  nodes["hub-cap-fn"] = node_hub_cap_fn_17;
  const mesh_hub_cap_fn_17Geometry = endpoint_hub_cap_fn_17
    ? new THREE.CylinderGeometry(endpoint_hub_cap_fn_17.endRadius, endpoint_hub_cap_fn_17.baseRadius, endpoint_hub_cap_fn_17.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_hub_cap_fn_17) {
    mesh_hub_cap_fn_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hub_cap_fn_17 = new THREE.Mesh(
    mesh_hub_cap_fn_17Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_cap_fn_17.name = "Hub cap fn";
  if (endpoint_hub_cap_fn_17) {
    mesh_hub_cap_fn_17.position.copy(endpoint_hub_cap_fn_17.midpoint);
    mesh_hub_cap_fn_17.quaternion.copy(endpoint_hub_cap_fn_17.quaternion);
  }
  mesh_hub_cap_fn_17.castShadow = options.castShadow ?? true;
  mesh_hub_cap_fn_17.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_cap_fn_17.userData.sculptComponent = {"id": "hub-cap-fn", "name": "Hub cap fn", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-fn", "attachment": {"parentId": "wheel-fn", "parentSocket": "wheel-fn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.035, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_fn_17.add(mesh_hub_cap_fn_17);
  meshes["hub-cap-fn"] = mesh_hub_cap_fn_17;
  colliders["hub-cap-fn"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["hub-cap-fn"] ??= [];
  destructionGroups["hub-cap-fn"].push(node_hub_cap_fn_17);

  const attachment_axle_nut_fn_18 = {"parentId": "wheel-fn", "parentSocket": "hub-cap-fn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_nut_fn_18 = makeAttachmentEndpoint(attachment_axle_nut_fn_18);
  const node_axle_nut_fn_18 = new THREE.Group();
  node_axle_nut_fn_18.name = "Axle nut fn__pivot";
  node_axle_nut_fn_18.scale.set(1, 1, 1);
  if (endpoint_axle_nut_fn_18) {
    node_axle_nut_fn_18.position.copy(endpoint_axle_nut_fn_18.start);
    node_axle_nut_fn_18.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_nut_fn_18.position.set(0.0, 0.065, 0.0);
    node_axle_nut_fn_18.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_nut_fn_18.userData.sculptComponent = {"id": "axle-nut-fn", "name": "Axle nut fn", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-fn", "attachment": {"parentId": "wheel-fn", "parentSocket": "hub-cap-fn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.065, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-fn", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-fn"]};
  node_axle_nut_fn_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-fn"] ?? root).add(node_axle_nut_fn_18);
  nodes["axle-nut-fn"] = node_axle_nut_fn_18;
  const mesh_axle_nut_fn_18Geometry = endpoint_axle_nut_fn_18
    ? new THREE.CylinderGeometry(endpoint_axle_nut_fn_18.endRadius, endpoint_axle_nut_fn_18.baseRadius, endpoint_axle_nut_fn_18.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_nut_fn_18) {
    mesh_axle_nut_fn_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_nut_fn_18 = new THREE.Mesh(
    mesh_axle_nut_fn_18Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_nut_fn_18.name = "Axle nut fn";
  if (endpoint_axle_nut_fn_18) {
    mesh_axle_nut_fn_18.position.copy(endpoint_axle_nut_fn_18.midpoint);
    mesh_axle_nut_fn_18.quaternion.copy(endpoint_axle_nut_fn_18.quaternion);
  }
  mesh_axle_nut_fn_18.castShadow = options.castShadow ?? true;
  mesh_axle_nut_fn_18.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_nut_fn_18.userData.sculptComponent = {"id": "axle-nut-fn", "name": "Axle nut fn", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-fn", "attachment": {"parentId": "wheel-fn", "parentSocket": "hub-cap-fn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.065, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-fn", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-fn"]};
  node_axle_nut_fn_18.add(mesh_axle_nut_fn_18);
  meshes["axle-nut-fn"] = mesh_axle_nut_fn_18;
  colliders["axle-nut-fn"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-nut-fn"] ??= [];
  destructionGroups["axle-nut-fn"].push(node_axle_nut_fn_18);

  const endpoint_wheel_rn_19 = makeAttachmentEndpoint(null);
  const node_wheel_rn_19 = new THREE.Group();
  node_wheel_rn_19.name = "Wheel rn__pivot";
  node_wheel_rn_19.scale.set(1, 1, 1);
  if (endpoint_wheel_rn_19) {
    node_wheel_rn_19.position.copy(endpoint_wheel_rn_19.start);
    node_wheel_rn_19.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_rn_19.position.set(0.22, -0.085, 0.335);
    node_wheel_rn_19.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_rn_19.userData.sculptComponent = {"id": "wheel-rn", "name": "Wheel rn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, 0.3], "localEnd": [0.22, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rn-planks"]};
  node_wheel_rn_19.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_rn_19);
  nodes["wheel-rn"] = node_wheel_rn_19;
  const mesh_wheel_rn_19Geometry = endpoint_wheel_rn_19
    ? new THREE.CylinderGeometry(endpoint_wheel_rn_19.endRadius, endpoint_wheel_rn_19.baseRadius, endpoint_wheel_rn_19.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_rn_19) {
    mesh_wheel_rn_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_rn_19 = new THREE.Mesh(
    mesh_wheel_rn_19Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rn_19.name = "Wheel rn";
  if (endpoint_wheel_rn_19) {
    mesh_wheel_rn_19.position.copy(endpoint_wheel_rn_19.midpoint);
    mesh_wheel_rn_19.quaternion.copy(endpoint_wheel_rn_19.quaternion);
  }
  mesh_wheel_rn_19.castShadow = options.castShadow ?? true;
  mesh_wheel_rn_19.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rn_19.userData.sculptComponent = {"id": "wheel-rn", "name": "Wheel rn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, 0.3], "localEnd": [0.22, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rn-planks"]};
  node_wheel_rn_19.add(mesh_wheel_rn_19);
  meshes["wheel-rn"] = mesh_wheel_rn_19;
  colliders["wheel-rn"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rn"] ??= [];
  destructionGroups["wheel-rn"].push(node_wheel_rn_19);

  const endpoint_wheel_rim_rn_20 = makeAttachmentEndpoint(null);
  const node_wheel_rim_rn_20 = new THREE.Group();
  node_wheel_rim_rn_20.name = "Wheel rim rn__pivot";
  node_wheel_rim_rn_20.scale.set(1, 1, 1);
  if (endpoint_wheel_rim_rn_20) {
    node_wheel_rim_rn_20.position.copy(endpoint_wheel_rim_rn_20.start);
    node_wheel_rim_rn_20.rotation.set(-1.5708, 0.0, -0.0);
  } else {
    node_wheel_rim_rn_20.position.set(0.0, 0.0, 0.0);
    node_wheel_rim_rn_20.rotation.set(-1.5708, 0.0, -0.0);
  }
  node_wheel_rim_rn_20.userData.sculptComponent = {"id": "wheel-rim-rn", "name": "Wheel rim rn", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-rn", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-rn", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-rn"]};
  node_wheel_rim_rn_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rn"] ?? root).add(node_wheel_rim_rn_20);
  nodes["wheel-rim-rn"] = node_wheel_rim_rn_20;
  const mesh_wheel_rim_rn_20Geometry = endpoint_wheel_rim_rn_20
    ? new THREE.CylinderGeometry(endpoint_wheel_rim_rn_20.endRadius, endpoint_wheel_rim_rn_20.baseRadius, endpoint_wheel_rim_rn_20.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.072, 8, 16);
  if (!endpoint_wheel_rim_rn_20) {
    mesh_wheel_rim_rn_20Geometry.scale(0.37, 0.37, 0.5);
  }
  const mesh_wheel_rim_rn_20 = new THREE.Mesh(
    mesh_wheel_rim_rn_20Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rim_rn_20.name = "Wheel rim rn";
  if (endpoint_wheel_rim_rn_20) {
    mesh_wheel_rim_rn_20.position.copy(endpoint_wheel_rim_rn_20.midpoint);
    mesh_wheel_rim_rn_20.quaternion.copy(endpoint_wheel_rim_rn_20.quaternion);
  }
  mesh_wheel_rim_rn_20.castShadow = options.castShadow ?? true;
  mesh_wheel_rim_rn_20.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rim_rn_20.userData.sculptComponent = {"id": "wheel-rim-rn", "name": "Wheel rim rn", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-rn", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-rn", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-rn"]};
  node_wheel_rim_rn_20.add(mesh_wheel_rim_rn_20);
  meshes["wheel-rim-rn"] = mesh_wheel_rim_rn_20;
  colliders["wheel-rim-rn"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rim-rn"] ??= [];
  destructionGroups["wheel-rim-rn"].push(node_wheel_rim_rn_20);

  const attachment_hub_cap_rn_21 = {"parentId": "wheel-rn", "parentSocket": "wheel-rn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_hub_cap_rn_21 = makeAttachmentEndpoint(attachment_hub_cap_rn_21);
  const node_hub_cap_rn_21 = new THREE.Group();
  node_hub_cap_rn_21.name = "Hub cap rn__pivot";
  node_hub_cap_rn_21.scale.set(1, 1, 1);
  if (endpoint_hub_cap_rn_21) {
    node_hub_cap_rn_21.position.copy(endpoint_hub_cap_rn_21.start);
    node_hub_cap_rn_21.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_hub_cap_rn_21.position.set(0.0, 0.035, 0.0);
    node_hub_cap_rn_21.rotation.set(-0.0, 0.0, -0.0);
  }
  node_hub_cap_rn_21.userData.sculptComponent = {"id": "hub-cap-rn", "name": "Hub cap rn", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rn", "attachment": {"parentId": "wheel-rn", "parentSocket": "wheel-rn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.035, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_rn_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rn"] ?? root).add(node_hub_cap_rn_21);
  nodes["hub-cap-rn"] = node_hub_cap_rn_21;
  const mesh_hub_cap_rn_21Geometry = endpoint_hub_cap_rn_21
    ? new THREE.CylinderGeometry(endpoint_hub_cap_rn_21.endRadius, endpoint_hub_cap_rn_21.baseRadius, endpoint_hub_cap_rn_21.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_hub_cap_rn_21) {
    mesh_hub_cap_rn_21Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hub_cap_rn_21 = new THREE.Mesh(
    mesh_hub_cap_rn_21Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_cap_rn_21.name = "Hub cap rn";
  if (endpoint_hub_cap_rn_21) {
    mesh_hub_cap_rn_21.position.copy(endpoint_hub_cap_rn_21.midpoint);
    mesh_hub_cap_rn_21.quaternion.copy(endpoint_hub_cap_rn_21.quaternion);
  }
  mesh_hub_cap_rn_21.castShadow = options.castShadow ?? true;
  mesh_hub_cap_rn_21.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_cap_rn_21.userData.sculptComponent = {"id": "hub-cap-rn", "name": "Hub cap rn", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rn", "attachment": {"parentId": "wheel-rn", "parentSocket": "wheel-rn:face", "localStart": [0.0, 0.035, 0.0], "localEnd": [0.0, 0.065, 0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.035, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_rn_21.add(mesh_hub_cap_rn_21);
  meshes["hub-cap-rn"] = mesh_hub_cap_rn_21;
  colliders["hub-cap-rn"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["hub-cap-rn"] ??= [];
  destructionGroups["hub-cap-rn"].push(node_hub_cap_rn_21);

  const attachment_axle_nut_rn_22 = {"parentId": "wheel-rn", "parentSocket": "hub-cap-rn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_nut_rn_22 = makeAttachmentEndpoint(attachment_axle_nut_rn_22);
  const node_axle_nut_rn_22 = new THREE.Group();
  node_axle_nut_rn_22.name = "Axle nut rn__pivot";
  node_axle_nut_rn_22.scale.set(1, 1, 1);
  if (endpoint_axle_nut_rn_22) {
    node_axle_nut_rn_22.position.copy(endpoint_axle_nut_rn_22.start);
    node_axle_nut_rn_22.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_nut_rn_22.position.set(0.0, 0.065, 0.0);
    node_axle_nut_rn_22.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_nut_rn_22.userData.sculptComponent = {"id": "axle-nut-rn", "name": "Axle nut rn", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rn", "attachment": {"parentId": "wheel-rn", "parentSocket": "hub-cap-rn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.065, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-rn", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-rn"]};
  node_axle_nut_rn_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rn"] ?? root).add(node_axle_nut_rn_22);
  nodes["axle-nut-rn"] = node_axle_nut_rn_22;
  const mesh_axle_nut_rn_22Geometry = endpoint_axle_nut_rn_22
    ? new THREE.CylinderGeometry(endpoint_axle_nut_rn_22.endRadius, endpoint_axle_nut_rn_22.baseRadius, endpoint_axle_nut_rn_22.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_nut_rn_22) {
    mesh_axle_nut_rn_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_nut_rn_22 = new THREE.Mesh(
    mesh_axle_nut_rn_22Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_nut_rn_22.name = "Axle nut rn";
  if (endpoint_axle_nut_rn_22) {
    mesh_axle_nut_rn_22.position.copy(endpoint_axle_nut_rn_22.midpoint);
    mesh_axle_nut_rn_22.quaternion.copy(endpoint_axle_nut_rn_22.quaternion);
  }
  mesh_axle_nut_rn_22.castShadow = options.castShadow ?? true;
  mesh_axle_nut_rn_22.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_nut_rn_22.userData.sculptComponent = {"id": "axle-nut-rn", "name": "Axle nut rn", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rn", "attachment": {"parentId": "wheel-rn", "parentSocket": "hub-cap-rn:center", "localStart": [0.0, 0.065, 0.0], "localEnd": [0.0, 0.09, 0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.065, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-rn", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-rn"]};
  node_axle_nut_rn_22.add(mesh_axle_nut_rn_22);
  meshes["axle-nut-rn"] = mesh_axle_nut_rn_22;
  colliders["axle-nut-rn"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-nut-rn"] ??= [];
  destructionGroups["axle-nut-rn"].push(node_axle_nut_rn_22);

  const endpoint_wheel_ff_23 = makeAttachmentEndpoint(null);
  const node_wheel_ff_23 = new THREE.Group();
  node_wheel_ff_23.name = "Wheel ff__pivot";
  node_wheel_ff_23.scale.set(1, 1, 1);
  if (endpoint_wheel_ff_23) {
    node_wheel_ff_23.position.copy(endpoint_wheel_ff_23.start);
    node_wheel_ff_23.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_ff_23.position.set(-0.3, -0.085, -0.335);
    node_wheel_ff_23.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_ff_23.userData.sculptComponent = {"id": "wheel-ff", "name": "Wheel ff", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, -0.3], "localEnd": [-0.3, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ff-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-ff-planks"]};
  node_wheel_ff_23.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_ff_23);
  nodes["wheel-ff"] = node_wheel_ff_23;
  const mesh_wheel_ff_23Geometry = endpoint_wheel_ff_23
    ? new THREE.CylinderGeometry(endpoint_wheel_ff_23.endRadius, endpoint_wheel_ff_23.baseRadius, endpoint_wheel_ff_23.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_ff_23) {
    mesh_wheel_ff_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_ff_23 = new THREE.Mesh(
    mesh_wheel_ff_23Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_ff_23.name = "Wheel ff";
  if (endpoint_wheel_ff_23) {
    mesh_wheel_ff_23.position.copy(endpoint_wheel_ff_23.midpoint);
    mesh_wheel_ff_23.quaternion.copy(endpoint_wheel_ff_23.quaternion);
  }
  mesh_wheel_ff_23.castShadow = options.castShadow ?? true;
  mesh_wheel_ff_23.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_ff_23.userData.sculptComponent = {"id": "wheel-ff", "name": "Wheel ff", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, -0.3], "localEnd": [-0.3, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ff-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-ff-planks"]};
  node_wheel_ff_23.add(mesh_wheel_ff_23);
  meshes["wheel-ff"] = mesh_wheel_ff_23;
  colliders["wheel-ff"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-ff"] ??= [];
  destructionGroups["wheel-ff"].push(node_wheel_ff_23);

  const endpoint_wheel_rim_ff_24 = makeAttachmentEndpoint(null);
  const node_wheel_rim_ff_24 = new THREE.Group();
  node_wheel_rim_ff_24.name = "Wheel rim ff__pivot";
  node_wheel_rim_ff_24.scale.set(1, 1, 1);
  if (endpoint_wheel_rim_ff_24) {
    node_wheel_rim_ff_24.position.copy(endpoint_wheel_rim_ff_24.start);
    node_wheel_rim_ff_24.rotation.set(-1.5708, 0.0, -0.0);
  } else {
    node_wheel_rim_ff_24.position.set(0.0, 0.0, 0.0);
    node_wheel_rim_ff_24.rotation.set(-1.5708, 0.0, -0.0);
  }
  node_wheel_rim_ff_24.userData.sculptComponent = {"id": "wheel-rim-ff", "name": "Wheel rim ff", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-ff", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-ff", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-ff"]};
  node_wheel_rim_ff_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-ff"] ?? root).add(node_wheel_rim_ff_24);
  nodes["wheel-rim-ff"] = node_wheel_rim_ff_24;
  const mesh_wheel_rim_ff_24Geometry = endpoint_wheel_rim_ff_24
    ? new THREE.CylinderGeometry(endpoint_wheel_rim_ff_24.endRadius, endpoint_wheel_rim_ff_24.baseRadius, endpoint_wheel_rim_ff_24.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.072, 8, 16);
  if (!endpoint_wheel_rim_ff_24) {
    mesh_wheel_rim_ff_24Geometry.scale(0.37, 0.37, 0.5);
  }
  const mesh_wheel_rim_ff_24 = new THREE.Mesh(
    mesh_wheel_rim_ff_24Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rim_ff_24.name = "Wheel rim ff";
  if (endpoint_wheel_rim_ff_24) {
    mesh_wheel_rim_ff_24.position.copy(endpoint_wheel_rim_ff_24.midpoint);
    mesh_wheel_rim_ff_24.quaternion.copy(endpoint_wheel_rim_ff_24.quaternion);
  }
  mesh_wheel_rim_ff_24.castShadow = options.castShadow ?? true;
  mesh_wheel_rim_ff_24.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rim_ff_24.userData.sculptComponent = {"id": "wheel-rim-ff", "name": "Wheel rim ff", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-ff", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-ff", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-ff"]};
  node_wheel_rim_ff_24.add(mesh_wheel_rim_ff_24);
  meshes["wheel-rim-ff"] = mesh_wheel_rim_ff_24;
  colliders["wheel-rim-ff"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rim-ff"] ??= [];
  destructionGroups["wheel-rim-ff"].push(node_wheel_rim_ff_24);

  const attachment_hub_cap_ff_25 = {"parentId": "wheel-ff", "parentSocket": "wheel-ff:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_hub_cap_ff_25 = makeAttachmentEndpoint(attachment_hub_cap_ff_25);
  const node_hub_cap_ff_25 = new THREE.Group();
  node_hub_cap_ff_25.name = "Hub cap ff__pivot";
  node_hub_cap_ff_25.scale.set(1, 1, 1);
  if (endpoint_hub_cap_ff_25) {
    node_hub_cap_ff_25.position.copy(endpoint_hub_cap_ff_25.start);
    node_hub_cap_ff_25.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_hub_cap_ff_25.position.set(0.0, -0.035, -0.0);
    node_hub_cap_ff_25.rotation.set(-0.0, 0.0, -0.0);
  }
  node_hub_cap_ff_25.userData.sculptComponent = {"id": "hub-cap-ff", "name": "Hub cap ff", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-ff", "attachment": {"parentId": "wheel-ff", "parentSocket": "wheel-ff:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.035, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_ff_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-ff"] ?? root).add(node_hub_cap_ff_25);
  nodes["hub-cap-ff"] = node_hub_cap_ff_25;
  const mesh_hub_cap_ff_25Geometry = endpoint_hub_cap_ff_25
    ? new THREE.CylinderGeometry(endpoint_hub_cap_ff_25.endRadius, endpoint_hub_cap_ff_25.baseRadius, endpoint_hub_cap_ff_25.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_hub_cap_ff_25) {
    mesh_hub_cap_ff_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hub_cap_ff_25 = new THREE.Mesh(
    mesh_hub_cap_ff_25Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_cap_ff_25.name = "Hub cap ff";
  if (endpoint_hub_cap_ff_25) {
    mesh_hub_cap_ff_25.position.copy(endpoint_hub_cap_ff_25.midpoint);
    mesh_hub_cap_ff_25.quaternion.copy(endpoint_hub_cap_ff_25.quaternion);
  }
  mesh_hub_cap_ff_25.castShadow = options.castShadow ?? true;
  mesh_hub_cap_ff_25.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_cap_ff_25.userData.sculptComponent = {"id": "hub-cap-ff", "name": "Hub cap ff", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-ff", "attachment": {"parentId": "wheel-ff", "parentSocket": "wheel-ff:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.035, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_ff_25.add(mesh_hub_cap_ff_25);
  meshes["hub-cap-ff"] = mesh_hub_cap_ff_25;
  colliders["hub-cap-ff"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["hub-cap-ff"] ??= [];
  destructionGroups["hub-cap-ff"].push(node_hub_cap_ff_25);

  const attachment_axle_nut_ff_26 = {"parentId": "wheel-ff", "parentSocket": "hub-cap-ff:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_nut_ff_26 = makeAttachmentEndpoint(attachment_axle_nut_ff_26);
  const node_axle_nut_ff_26 = new THREE.Group();
  node_axle_nut_ff_26.name = "Axle nut ff__pivot";
  node_axle_nut_ff_26.scale.set(1, 1, 1);
  if (endpoint_axle_nut_ff_26) {
    node_axle_nut_ff_26.position.copy(endpoint_axle_nut_ff_26.start);
    node_axle_nut_ff_26.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_nut_ff_26.position.set(0.0, -0.065, -0.0);
    node_axle_nut_ff_26.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_nut_ff_26.userData.sculptComponent = {"id": "axle-nut-ff", "name": "Axle nut ff", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-ff", "attachment": {"parentId": "wheel-ff", "parentSocket": "hub-cap-ff:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.065, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-ff", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-ff"]};
  node_axle_nut_ff_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-ff"] ?? root).add(node_axle_nut_ff_26);
  nodes["axle-nut-ff"] = node_axle_nut_ff_26;
  const mesh_axle_nut_ff_26Geometry = endpoint_axle_nut_ff_26
    ? new THREE.CylinderGeometry(endpoint_axle_nut_ff_26.endRadius, endpoint_axle_nut_ff_26.baseRadius, endpoint_axle_nut_ff_26.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_nut_ff_26) {
    mesh_axle_nut_ff_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_nut_ff_26 = new THREE.Mesh(
    mesh_axle_nut_ff_26Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_nut_ff_26.name = "Axle nut ff";
  if (endpoint_axle_nut_ff_26) {
    mesh_axle_nut_ff_26.position.copy(endpoint_axle_nut_ff_26.midpoint);
    mesh_axle_nut_ff_26.quaternion.copy(endpoint_axle_nut_ff_26.quaternion);
  }
  mesh_axle_nut_ff_26.castShadow = options.castShadow ?? true;
  mesh_axle_nut_ff_26.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_nut_ff_26.userData.sculptComponent = {"id": "axle-nut-ff", "name": "Axle nut ff", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-ff", "attachment": {"parentId": "wheel-ff", "parentSocket": "hub-cap-ff:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.065, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-ff", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-ff"]};
  node_axle_nut_ff_26.add(mesh_axle_nut_ff_26);
  meshes["axle-nut-ff"] = mesh_axle_nut_ff_26;
  colliders["axle-nut-ff"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-nut-ff"] ??= [];
  destructionGroups["axle-nut-ff"].push(node_axle_nut_ff_26);

  const endpoint_wheel_rf_27 = makeAttachmentEndpoint(null);
  const node_wheel_rf_27 = new THREE.Group();
  node_wheel_rf_27.name = "Wheel rf__pivot";
  node_wheel_rf_27.scale.set(1, 1, 1);
  if (endpoint_wheel_rf_27) {
    node_wheel_rf_27.position.copy(endpoint_wheel_rf_27.start);
    node_wheel_rf_27.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_rf_27.position.set(0.22, -0.085, -0.335);
    node_wheel_rf_27.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_rf_27.userData.sculptComponent = {"id": "wheel-rf", "name": "Wheel rf", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, -0.3], "localEnd": [0.22, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rf-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rf-planks"]};
  node_wheel_rf_27.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_rf_27);
  nodes["wheel-rf"] = node_wheel_rf_27;
  const mesh_wheel_rf_27Geometry = endpoint_wheel_rf_27
    ? new THREE.CylinderGeometry(endpoint_wheel_rf_27.endRadius, endpoint_wheel_rf_27.baseRadius, endpoint_wheel_rf_27.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_rf_27) {
    mesh_wheel_rf_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_rf_27 = new THREE.Mesh(
    mesh_wheel_rf_27Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rf_27.name = "Wheel rf";
  if (endpoint_wheel_rf_27) {
    mesh_wheel_rf_27.position.copy(endpoint_wheel_rf_27.midpoint);
    mesh_wheel_rf_27.quaternion.copy(endpoint_wheel_rf_27.quaternion);
  }
  mesh_wheel_rf_27.castShadow = options.castShadow ?? true;
  mesh_wheel_rf_27.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rf_27.userData.sculptComponent = {"id": "wheel-rf", "name": "Wheel rf", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, -0.3], "localEnd": [0.22, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rf-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rf-planks"]};
  node_wheel_rf_27.add(mesh_wheel_rf_27);
  meshes["wheel-rf"] = mesh_wheel_rf_27;
  colliders["wheel-rf"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rf"] ??= [];
  destructionGroups["wheel-rf"].push(node_wheel_rf_27);

  const endpoint_wheel_rim_rf_28 = makeAttachmentEndpoint(null);
  const node_wheel_rim_rf_28 = new THREE.Group();
  node_wheel_rim_rf_28.name = "Wheel rim rf__pivot";
  node_wheel_rim_rf_28.scale.set(1, 1, 1);
  if (endpoint_wheel_rim_rf_28) {
    node_wheel_rim_rf_28.position.copy(endpoint_wheel_rim_rf_28.start);
    node_wheel_rim_rf_28.rotation.set(-1.5708, 0.0, -0.0);
  } else {
    node_wheel_rim_rf_28.position.set(0.0, 0.0, 0.0);
    node_wheel_rim_rf_28.rotation.set(-1.5708, 0.0, -0.0);
  }
  node_wheel_rim_rf_28.userData.sculptComponent = {"id": "wheel-rim-rf", "name": "Wheel rim rf", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-rf", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-rf", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-rf"]};
  node_wheel_rim_rf_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rf"] ?? root).add(node_wheel_rim_rf_28);
  nodes["wheel-rim-rf"] = node_wheel_rim_rf_28;
  const mesh_wheel_rim_rf_28Geometry = endpoint_wheel_rim_rf_28
    ? new THREE.CylinderGeometry(endpoint_wheel_rim_rf_28.endRadius, endpoint_wheel_rim_rf_28.baseRadius, endpoint_wheel_rim_rf_28.length, 8, 4)
    : new THREE.TorusGeometry(0.45, 0.072, 8, 16);
  if (!endpoint_wheel_rim_rf_28) {
    mesh_wheel_rim_rf_28Geometry.scale(0.37, 0.37, 0.5);
  }
  const mesh_wheel_rim_rf_28 = new THREE.Mesh(
    mesh_wheel_rim_rf_28Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rim_rf_28.name = "Wheel rim rf";
  if (endpoint_wheel_rim_rf_28) {
    mesh_wheel_rim_rf_28.position.copy(endpoint_wheel_rim_rf_28.midpoint);
    mesh_wheel_rim_rf_28.quaternion.copy(endpoint_wheel_rim_rf_28.quaternion);
  }
  mesh_wheel_rim_rf_28.castShadow = options.castShadow ?? true;
  mesh_wheel_rim_rf_28.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rim_rf_28.userData.sculptComponent = {"id": "wheel-rim-rf", "name": "Wheel rim rf", "level": "meso", "role": "rim", "importance": 0.5, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Wheel rim: an iron tyre ring around the disc edge, a torus.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.16}, "parent": "wheel-rf", "attachment": null, "dimensions": {"width": 0.37, "height": 0.37, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-1.5708, 0.0, -0.0], "scale": [0.37, 0.37, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rim-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-ridge-rf", "kind": "ridge", "description": "iron tyre stands proud of the plank disc", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rim-ridge-rf"]};
  node_wheel_rim_rf_28.add(mesh_wheel_rim_rf_28);
  meshes["wheel-rim-rf"] = mesh_wheel_rim_rf_28;
  colliders["wheel-rim-rf"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rim-rf"] ??= [];
  destructionGroups["wheel-rim-rf"].push(node_wheel_rim_rf_28);

  const attachment_hub_cap_rf_29 = {"parentId": "wheel-rf", "parentSocket": "wheel-rf:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_hub_cap_rf_29 = makeAttachmentEndpoint(attachment_hub_cap_rf_29);
  const node_hub_cap_rf_29 = new THREE.Group();
  node_hub_cap_rf_29.name = "Hub cap rf__pivot";
  node_hub_cap_rf_29.scale.set(1, 1, 1);
  if (endpoint_hub_cap_rf_29) {
    node_hub_cap_rf_29.position.copy(endpoint_hub_cap_rf_29.start);
    node_hub_cap_rf_29.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_hub_cap_rf_29.position.set(0.0, -0.035, -0.0);
    node_hub_cap_rf_29.rotation.set(-0.0, 0.0, -0.0);
  }
  node_hub_cap_rf_29.userData.sculptComponent = {"id": "hub-cap-rf", "name": "Hub cap rf", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rf", "attachment": {"parentId": "wheel-rf", "parentSocket": "wheel-rf:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.035, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_rf_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rf"] ?? root).add(node_hub_cap_rf_29);
  nodes["hub-cap-rf"] = node_hub_cap_rf_29;
  const mesh_hub_cap_rf_29Geometry = endpoint_hub_cap_rf_29
    ? new THREE.CylinderGeometry(endpoint_hub_cap_rf_29.endRadius, endpoint_hub_cap_rf_29.baseRadius, endpoint_hub_cap_rf_29.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_hub_cap_rf_29) {
    mesh_hub_cap_rf_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hub_cap_rf_29 = new THREE.Mesh(
    mesh_hub_cap_rf_29Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hub_cap_rf_29.name = "Hub cap rf";
  if (endpoint_hub_cap_rf_29) {
    mesh_hub_cap_rf_29.position.copy(endpoint_hub_cap_rf_29.midpoint);
    mesh_hub_cap_rf_29.quaternion.copy(endpoint_hub_cap_rf_29.quaternion);
  }
  mesh_hub_cap_rf_29.castShadow = options.castShadow ?? true;
  mesh_hub_cap_rf_29.receiveShadow = options.receiveShadow ?? true;
  mesh_hub_cap_rf_29.userData.sculptComponent = {"id": "hub-cap-rf", "name": "Hub cap rf", "level": "meso", "role": "cap", "importance": 0.35, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Hub cap: a short iron disc on the wheel face.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rf", "attachment": {"parentId": "wheel-rf", "parentSocket": "wheel-rf:face", "localStart": [0.0, -0.035, -0.0], "localEnd": [0.0, -0.065, -0.0], "baseRadius": 0.055, "endRadius": 0.055, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.035, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hub-cap-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_hub_cap_rf_29.add(mesh_hub_cap_rf_29);
  meshes["hub-cap-rf"] = mesh_hub_cap_rf_29;
  colliders["hub-cap-rf"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["hub-cap-rf"] ??= [];
  destructionGroups["hub-cap-rf"].push(node_hub_cap_rf_29);

  const attachment_axle_nut_rf_30 = {"parentId": "wheel-rf", "parentSocket": "hub-cap-rf:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_axle_nut_rf_30 = makeAttachmentEndpoint(attachment_axle_nut_rf_30);
  const node_axle_nut_rf_30 = new THREE.Group();
  node_axle_nut_rf_30.name = "Axle nut rf__pivot";
  node_axle_nut_rf_30.scale.set(1, 1, 1);
  if (endpoint_axle_nut_rf_30) {
    node_axle_nut_rf_30.position.copy(endpoint_axle_nut_rf_30.start);
    node_axle_nut_rf_30.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_axle_nut_rf_30.position.set(0.0, -0.065, -0.0);
    node_axle_nut_rf_30.rotation.set(-0.0, 0.0, -0.0);
  }
  node_axle_nut_rf_30.userData.sculptComponent = {"id": "axle-nut-rf", "name": "Axle nut rf", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rf", "attachment": {"parentId": "wheel-rf", "parentSocket": "hub-cap-rf:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.065, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-rf", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-rf"]};
  node_axle_nut_rf_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["wheel-rf"] ?? root).add(node_axle_nut_rf_30);
  nodes["axle-nut-rf"] = node_axle_nut_rf_30;
  const mesh_axle_nut_rf_30Geometry = endpoint_axle_nut_rf_30
    ? new THREE.CylinderGeometry(endpoint_axle_nut_rf_30.endRadius, endpoint_axle_nut_rf_30.baseRadius, endpoint_axle_nut_rf_30.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_axle_nut_rf_30) {
    mesh_axle_nut_rf_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_axle_nut_rf_30 = new THREE.Mesh(
    mesh_axle_nut_rf_30Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_axle_nut_rf_30.name = "Axle nut rf";
  if (endpoint_axle_nut_rf_30) {
    mesh_axle_nut_rf_30.position.copy(endpoint_axle_nut_rf_30.midpoint);
    mesh_axle_nut_rf_30.quaternion.copy(endpoint_axle_nut_rf_30.quaternion);
  }
  mesh_axle_nut_rf_30.castShadow = options.castShadow ?? true;
  mesh_axle_nut_rf_30.receiveShadow = options.receiveShadow ?? true;
  mesh_axle_nut_rf_30.userData.sculptComponent = {"id": "axle-nut-rf", "name": "Axle nut rf", "level": "micro", "role": "cap", "importance": 0.25, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Axle nut: a small round nut, a short cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rf", "attachment": {"parentId": "wheel-rf", "parentSocket": "hub-cap-rf:center", "localStart": [0.0, -0.065, -0.0], "localEnd": [0.0, -0.09, -0.0], "baseRadius": 0.026, "endRadius": 0.026, "contactType": "threaded", "embedDepth": 0.003, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.065, -0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "axle-nut-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hex-nut-rf", "kind": "fastener", "description": "axle nut on the hub cap", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["hex-nut-rf"]};
  node_axle_nut_rf_30.add(mesh_axle_nut_rf_30);
  meshes["axle-nut-rf"] = mesh_axle_nut_rf_30;
  colliders["axle-nut-rf"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["axle-nut-rf"] ??= [];
  destructionGroups["axle-nut-rf"].push(node_axle_nut_rf_30);

  const endpoint_tub_core_31 = makeAttachmentEndpoint(null);
  const node_tub_core_31 = new THREE.Group();
  node_tub_core_31.name = "Tub body__pivot";
  node_tub_core_31.scale.set(1, 1, 1);
  if (endpoint_tub_core_31) {
    node_tub_core_31.position.copy(endpoint_tub_core_31.start);
    node_tub_core_31.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tub_core_31.position.set(0.0, 0.06, -0.26);
    node_tub_core_31.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tub_core_31.userData.sculptComponent = {"id": "tub-core", "name": "Tub body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Tub body: one continuous tapered volume (an inverted frustum); extruded from its measured side profile so the end walls lean out as in the reference, never a plain box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.43, 0.0], [0.43, 0.0], [0.51, 0.55], [-0.51, 0.55]], "depth": 0.52}}, "parent": "chassis-frame", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.06, -0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tub-taper", "kind": "contour", "description": "end walls lean outward ~5 degrees, long walls ~7 degrees", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tub-taper"]};
  node_tub_core_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_tub_core_31);
  nodes["tub-core"] = node_tub_core_31;
  const mesh_tub_core_31Geometry = endpoint_tub_core_31
    ? new THREE.CylinderGeometry(endpoint_tub_core_31.endRadius, endpoint_tub_core_31.baseRadius, endpoint_tub_core_31.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.43, 0.0], [0.43, 0.0], [0.51, 0.55], [-0.51, 0.55]], "depth": 0.52});
  if (!endpoint_tub_core_31) {
    mesh_tub_core_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tub_core_31 = new THREE.Mesh(
    mesh_tub_core_31Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tub_core_31.name = "Tub body";
  if (endpoint_tub_core_31) {
    mesh_tub_core_31.position.copy(endpoint_tub_core_31.midpoint);
    mesh_tub_core_31.quaternion.copy(endpoint_tub_core_31.quaternion);
  }
  mesh_tub_core_31.castShadow = options.castShadow ?? true;
  mesh_tub_core_31.receiveShadow = options.receiveShadow ?? true;
  mesh_tub_core_31.userData.sculptComponent = {"id": "tub-core", "name": "Tub body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Tub body: one continuous tapered volume (an inverted frustum); extruded from its measured side profile so the end walls lean out as in the reference, never a plain box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.43, 0.0], [0.43, 0.0], [0.51, 0.55], [-0.51, 0.55]], "depth": 0.52}}, "parent": "chassis-frame", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.06, -0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tub-taper", "kind": "contour", "description": "end walls lean outward ~5 degrees, long walls ~7 degrees", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tub-taper"]};
  node_tub_core_31.add(mesh_tub_core_31);
  meshes["tub-core"] = mesh_tub_core_31;
  colliders["tub-core"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tub-core"] ??= [];
  destructionGroups["tub-core"].push(node_tub_core_31);

  const endpoint_plank_near_0_32 = makeAttachmentEndpoint(null);
  const node_plank_near_0_32 = new THREE.Group();
  node_plank_near_0_32.name = "Plank near 1__pivot";
  node_plank_near_0_32.scale.set(1, 1, 1);
  if (endpoint_plank_near_0_32) {
    node_plank_near_0_32.position.copy(endpoint_plank_near_0_32.start);
    node_plank_near_0_32.rotation.set(0.12659, 0.0, -0.0);
  } else {
    node_plank_near_0_32.position.set(0.0, 0.0933, 0.5319);
    node_plank_near_0_32.rotation.set(0.12659, 0.0, -0.0);
  }
  node_plank_near_0_32.userData.sculptComponent = {"id": "plank-near-0", "name": "Plank near 1", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8272, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0933, 0.5319], "rotation": [0.12659, 0.0, -0.0], "scale": [0.8272, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-0"]};
  node_plank_near_0_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_near_0_32);
  nodes["plank-near-0"] = node_plank_near_0_32;
  const mesh_plank_near_0_32Geometry = endpoint_plank_near_0_32
    ? new THREE.CylinderGeometry(endpoint_plank_near_0_32.endRadius, endpoint_plank_near_0_32.baseRadius, endpoint_plank_near_0_32.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_near_0_32) {
    mesh_plank_near_0_32Geometry.scale(0.8272, 0.1667, 0.04);
  }
  const mesh_plank_near_0_32 = new THREE.Mesh(
    mesh_plank_near_0_32Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_near_0_32.name = "Plank near 1";
  if (endpoint_plank_near_0_32) {
    mesh_plank_near_0_32.position.copy(endpoint_plank_near_0_32.midpoint);
    mesh_plank_near_0_32.quaternion.copy(endpoint_plank_near_0_32.quaternion);
  }
  mesh_plank_near_0_32.castShadow = options.castShadow ?? true;
  mesh_plank_near_0_32.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_near_0_32.userData.sculptComponent = {"id": "plank-near-0", "name": "Plank near 1", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8272, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0933, 0.5319], "rotation": [0.12659, 0.0, -0.0], "scale": [0.8272, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-0"]};
  node_plank_near_0_32.add(mesh_plank_near_0_32);
  meshes["plank-near-0"] = mesh_plank_near_0_32;
  colliders["plank-near-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-near-0"] ??= [];
  destructionGroups["plank-near-0"].push(node_plank_near_0_32);

  const endpoint_plank_far_0_33 = makeAttachmentEndpoint(null);
  const node_plank_far_0_33 = new THREE.Group();
  node_plank_far_0_33.name = "Plank far 1__pivot";
  node_plank_far_0_33.scale.set(1, 1, 1);
  if (endpoint_plank_far_0_33) {
    node_plank_far_0_33.position.copy(endpoint_plank_far_0_33.start);
    node_plank_far_0_33.rotation.set(-0.12659, 0.0, -0.0);
  } else {
    node_plank_far_0_33.position.set(0.0, 0.0933, -0.0119);
    node_plank_far_0_33.rotation.set(-0.12659, 0.0, -0.0);
  }
  node_plank_far_0_33.userData.sculptComponent = {"id": "plank-far-0", "name": "Plank far 1", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8272, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0933, -0.0119], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.8272, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-0"]};
  node_plank_far_0_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_far_0_33);
  nodes["plank-far-0"] = node_plank_far_0_33;
  const mesh_plank_far_0_33Geometry = endpoint_plank_far_0_33
    ? new THREE.CylinderGeometry(endpoint_plank_far_0_33.endRadius, endpoint_plank_far_0_33.baseRadius, endpoint_plank_far_0_33.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_far_0_33) {
    mesh_plank_far_0_33Geometry.scale(0.8272, 0.1667, 0.04);
  }
  const mesh_plank_far_0_33 = new THREE.Mesh(
    mesh_plank_far_0_33Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_far_0_33.name = "Plank far 1";
  if (endpoint_plank_far_0_33) {
    mesh_plank_far_0_33.position.copy(endpoint_plank_far_0_33.midpoint);
    mesh_plank_far_0_33.quaternion.copy(endpoint_plank_far_0_33.quaternion);
  }
  mesh_plank_far_0_33.castShadow = options.castShadow ?? true;
  mesh_plank_far_0_33.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_far_0_33.userData.sculptComponent = {"id": "plank-far-0", "name": "Plank far 1", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8272, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0933, -0.0119], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.8272, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-0"]};
  node_plank_far_0_33.add(mesh_plank_far_0_33);
  meshes["plank-far-0"] = mesh_plank_far_0_33;
  colliders["plank-far-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-far-0"] ??= [];
  destructionGroups["plank-far-0"].push(node_plank_far_0_33);

  const endpoint_plank_rear_0_34 = makeAttachmentEndpoint(null);
  const node_plank_rear_0_34 = new THREE.Group();
  node_plank_rear_0_34.name = "Plank rear 1__pivot";
  node_plank_rear_0_34.scale.set(1, 1, 1);
  if (endpoint_plank_rear_0_34) {
    node_plank_rear_0_34.position.copy(endpoint_plank_rear_0_34.start);
    node_plank_rear_0_34.rotation.set(-0.0, 0.0, -0.14444);
  } else {
    node_plank_rear_0_34.position.set(0.4436, 0.0933, 0.26);
    node_plank_rear_0_34.rotation.set(-0.0, 0.0, -0.14444);
  }
  node_plank_rear_0_34.userData.sculptComponent = {"id": "plank-rear-0", "name": "Plank rear 1", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.4838, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4436, 0.0933, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.4838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-0"]};
  node_plank_rear_0_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_rear_0_34);
  nodes["plank-rear-0"] = node_plank_rear_0_34;
  const mesh_plank_rear_0_34Geometry = endpoint_plank_rear_0_34
    ? new THREE.CylinderGeometry(endpoint_plank_rear_0_34.endRadius, endpoint_plank_rear_0_34.baseRadius, endpoint_plank_rear_0_34.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_rear_0_34) {
    mesh_plank_rear_0_34Geometry.scale(0.04, 0.1667, 0.4838);
  }
  const mesh_plank_rear_0_34 = new THREE.Mesh(
    mesh_plank_rear_0_34Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_rear_0_34.name = "Plank rear 1";
  if (endpoint_plank_rear_0_34) {
    mesh_plank_rear_0_34.position.copy(endpoint_plank_rear_0_34.midpoint);
    mesh_plank_rear_0_34.quaternion.copy(endpoint_plank_rear_0_34.quaternion);
  }
  mesh_plank_rear_0_34.castShadow = options.castShadow ?? true;
  mesh_plank_rear_0_34.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_rear_0_34.userData.sculptComponent = {"id": "plank-rear-0", "name": "Plank rear 1", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.4838, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4436, 0.0933, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.4838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-0"]};
  node_plank_rear_0_34.add(mesh_plank_rear_0_34);
  meshes["plank-rear-0"] = mesh_plank_rear_0_34;
  colliders["plank-rear-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-rear-0"] ??= [];
  destructionGroups["plank-rear-0"].push(node_plank_rear_0_34);

  const endpoint_plank_front_0_35 = makeAttachmentEndpoint(null);
  const node_plank_front_0_35 = new THREE.Group();
  node_plank_front_0_35.name = "Plank front 1__pivot";
  node_plank_front_0_35.scale.set(1, 1, 1);
  if (endpoint_plank_front_0_35) {
    node_plank_front_0_35.position.copy(endpoint_plank_front_0_35.start);
    node_plank_front_0_35.rotation.set(-0.0, 0.0, 0.14444);
  } else {
    node_plank_front_0_35.position.set(-0.4436, 0.0933, 0.26);
    node_plank_front_0_35.rotation.set(-0.0, 0.0, 0.14444);
  }
  node_plank_front_0_35.userData.sculptComponent = {"id": "plank-front-0", "name": "Plank front 1", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.4838, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4436, 0.0933, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.4838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-0"]};
  node_plank_front_0_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_front_0_35);
  nodes["plank-front-0"] = node_plank_front_0_35;
  const mesh_plank_front_0_35Geometry = endpoint_plank_front_0_35
    ? new THREE.CylinderGeometry(endpoint_plank_front_0_35.endRadius, endpoint_plank_front_0_35.baseRadius, endpoint_plank_front_0_35.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_front_0_35) {
    mesh_plank_front_0_35Geometry.scale(0.04, 0.1667, 0.4838);
  }
  const mesh_plank_front_0_35 = new THREE.Mesh(
    mesh_plank_front_0_35Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_front_0_35.name = "Plank front 1";
  if (endpoint_plank_front_0_35) {
    mesh_plank_front_0_35.position.copy(endpoint_plank_front_0_35.midpoint);
    mesh_plank_front_0_35.quaternion.copy(endpoint_plank_front_0_35.quaternion);
  }
  mesh_plank_front_0_35.castShadow = options.castShadow ?? true;
  mesh_plank_front_0_35.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_front_0_35.userData.sculptComponent = {"id": "plank-front-0", "name": "Plank front 1", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.4838, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4436, 0.0933, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.4838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-0", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-0"]};
  node_plank_front_0_35.add(mesh_plank_front_0_35);
  meshes["plank-front-0"] = mesh_plank_front_0_35;
  colliders["plank-front-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-front-0"] ??= [];
  destructionGroups["plank-front-0"].push(node_plank_front_0_35);

  const endpoint_plank_near_1_36 = makeAttachmentEndpoint(null);
  const node_plank_near_1_36 = new THREE.Group();
  node_plank_near_1_36.name = "Plank near 2__pivot";
  node_plank_near_1_36.scale.set(1, 1, 1);
  if (endpoint_plank_near_1_36) {
    node_plank_near_1_36.position.copy(endpoint_plank_near_1_36.start);
    node_plank_near_1_36.rotation.set(0.12659, 0.0, -0.0);
  } else {
    node_plank_near_1_36.position.set(0.0, 0.27, 0.5544);
    node_plank_near_1_36.rotation.set(0.12659, 0.0, -0.0);
  }
  node_plank_near_1_36.userData.sculptComponent = {"id": "plank-near-1", "name": "Plank near 2", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8785, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.27, 0.5544], "rotation": [0.12659, 0.0, -0.0], "scale": [0.8785, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-1"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood"}, "materialRegions": [{"regionId": "plank-wood", "materialId": "wood", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "bbox": {"x": 480, "y": 285, "width": 220, "height": 105}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0214}}]};
  node_plank_near_1_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_near_1_36);
  nodes["plank-near-1"] = node_plank_near_1_36;
  const mesh_plank_near_1_36Geometry = endpoint_plank_near_1_36
    ? new THREE.CylinderGeometry(endpoint_plank_near_1_36.endRadius, endpoint_plank_near_1_36.baseRadius, endpoint_plank_near_1_36.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_near_1_36) {
    mesh_plank_near_1_36Geometry.scale(0.8785, 0.1667, 0.04);
  }
  const mesh_plank_near_1_36 = new THREE.Mesh(
    mesh_plank_near_1_36Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_near_1_36.name = "Plank near 2";
  if (endpoint_plank_near_1_36) {
    mesh_plank_near_1_36.position.copy(endpoint_plank_near_1_36.midpoint);
    mesh_plank_near_1_36.quaternion.copy(endpoint_plank_near_1_36.quaternion);
  }
  mesh_plank_near_1_36.castShadow = options.castShadow ?? true;
  mesh_plank_near_1_36.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_near_1_36.userData.sculptComponent = {"id": "plank-near-1", "name": "Plank near 2", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8785, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.27, 0.5544], "rotation": [0.12659, 0.0, -0.0], "scale": [0.8785, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-1"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood"}, "materialRegions": [{"regionId": "plank-wood", "materialId": "wood", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "bbox": {"x": 480, "y": 285, "width": 220, "height": 105}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0214}}]};
  node_plank_near_1_36.add(mesh_plank_near_1_36);
  meshes["plank-near-1"] = mesh_plank_near_1_36;
  colliders["plank-near-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-near-1"] ??= [];
  destructionGroups["plank-near-1"].push(node_plank_near_1_36);

  const endpoint_plank_far_1_37 = makeAttachmentEndpoint(null);
  const node_plank_far_1_37 = new THREE.Group();
  node_plank_far_1_37.name = "Plank far 2__pivot";
  node_plank_far_1_37.scale.set(1, 1, 1);
  if (endpoint_plank_far_1_37) {
    node_plank_far_1_37.position.copy(endpoint_plank_far_1_37.start);
    node_plank_far_1_37.rotation.set(-0.12659, 0.0, -0.0);
  } else {
    node_plank_far_1_37.position.set(0.0, 0.27, -0.0344);
    node_plank_far_1_37.rotation.set(-0.12659, 0.0, -0.0);
  }
  node_plank_far_1_37.userData.sculptComponent = {"id": "plank-far-1", "name": "Plank far 2", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8785, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.27, -0.0344], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.8785, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-1"]};
  node_plank_far_1_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_far_1_37);
  nodes["plank-far-1"] = node_plank_far_1_37;
  const mesh_plank_far_1_37Geometry = endpoint_plank_far_1_37
    ? new THREE.CylinderGeometry(endpoint_plank_far_1_37.endRadius, endpoint_plank_far_1_37.baseRadius, endpoint_plank_far_1_37.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_far_1_37) {
    mesh_plank_far_1_37Geometry.scale(0.8785, 0.1667, 0.04);
  }
  const mesh_plank_far_1_37 = new THREE.Mesh(
    mesh_plank_far_1_37Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_far_1_37.name = "Plank far 2";
  if (endpoint_plank_far_1_37) {
    mesh_plank_far_1_37.position.copy(endpoint_plank_far_1_37.midpoint);
    mesh_plank_far_1_37.quaternion.copy(endpoint_plank_far_1_37.quaternion);
  }
  mesh_plank_far_1_37.castShadow = options.castShadow ?? true;
  mesh_plank_far_1_37.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_far_1_37.userData.sculptComponent = {"id": "plank-far-1", "name": "Plank far 2", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.8785, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.27, -0.0344], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.8785, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-1"]};
  node_plank_far_1_37.add(mesh_plank_far_1_37);
  meshes["plank-far-1"] = mesh_plank_far_1_37;
  colliders["plank-far-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-far-1"] ??= [];
  destructionGroups["plank-far-1"].push(node_plank_far_1_37);

  const endpoint_plank_rear_1_38 = makeAttachmentEndpoint(null);
  const node_plank_rear_1_38 = new THREE.Group();
  node_plank_rear_1_38.name = "Plank rear 2__pivot";
  node_plank_rear_1_38.scale.set(1, 1, 1);
  if (endpoint_plank_rear_1_38) {
    node_plank_rear_1_38.position.copy(endpoint_plank_rear_1_38.start);
    node_plank_rear_1_38.rotation.set(-0.0, 0.0, -0.14444);
  } else {
    node_plank_rear_1_38.position.set(0.4693, 0.27, 0.26);
    node_plank_rear_1_38.rotation.set(-0.0, 0.0, -0.14444);
  }
  node_plank_rear_1_38.userData.sculptComponent = {"id": "plank-rear-1", "name": "Plank rear 2", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5287, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.27, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.5287]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-1"]};
  node_plank_rear_1_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_rear_1_38);
  nodes["plank-rear-1"] = node_plank_rear_1_38;
  const mesh_plank_rear_1_38Geometry = endpoint_plank_rear_1_38
    ? new THREE.CylinderGeometry(endpoint_plank_rear_1_38.endRadius, endpoint_plank_rear_1_38.baseRadius, endpoint_plank_rear_1_38.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_rear_1_38) {
    mesh_plank_rear_1_38Geometry.scale(0.04, 0.1667, 0.5287);
  }
  const mesh_plank_rear_1_38 = new THREE.Mesh(
    mesh_plank_rear_1_38Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_rear_1_38.name = "Plank rear 2";
  if (endpoint_plank_rear_1_38) {
    mesh_plank_rear_1_38.position.copy(endpoint_plank_rear_1_38.midpoint);
    mesh_plank_rear_1_38.quaternion.copy(endpoint_plank_rear_1_38.quaternion);
  }
  mesh_plank_rear_1_38.castShadow = options.castShadow ?? true;
  mesh_plank_rear_1_38.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_rear_1_38.userData.sculptComponent = {"id": "plank-rear-1", "name": "Plank rear 2", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5287, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.27, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.5287]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-1"]};
  node_plank_rear_1_38.add(mesh_plank_rear_1_38);
  meshes["plank-rear-1"] = mesh_plank_rear_1_38;
  colliders["plank-rear-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-rear-1"] ??= [];
  destructionGroups["plank-rear-1"].push(node_plank_rear_1_38);

  const endpoint_plank_front_1_39 = makeAttachmentEndpoint(null);
  const node_plank_front_1_39 = new THREE.Group();
  node_plank_front_1_39.name = "Plank front 2__pivot";
  node_plank_front_1_39.scale.set(1, 1, 1);
  if (endpoint_plank_front_1_39) {
    node_plank_front_1_39.position.copy(endpoint_plank_front_1_39.start);
    node_plank_front_1_39.rotation.set(-0.0, 0.0, 0.14444);
  } else {
    node_plank_front_1_39.position.set(-0.4693, 0.27, 0.26);
    node_plank_front_1_39.rotation.set(-0.0, 0.0, 0.14444);
  }
  node_plank_front_1_39.userData.sculptComponent = {"id": "plank-front-1", "name": "Plank front 2", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5287, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4693, 0.27, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.5287]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-1"]};
  node_plank_front_1_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_front_1_39);
  nodes["plank-front-1"] = node_plank_front_1_39;
  const mesh_plank_front_1_39Geometry = endpoint_plank_front_1_39
    ? new THREE.CylinderGeometry(endpoint_plank_front_1_39.endRadius, endpoint_plank_front_1_39.baseRadius, endpoint_plank_front_1_39.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_front_1_39) {
    mesh_plank_front_1_39Geometry.scale(0.04, 0.1667, 0.5287);
  }
  const mesh_plank_front_1_39 = new THREE.Mesh(
    mesh_plank_front_1_39Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_front_1_39.name = "Plank front 2";
  if (endpoint_plank_front_1_39) {
    mesh_plank_front_1_39.position.copy(endpoint_plank_front_1_39.midpoint);
    mesh_plank_front_1_39.quaternion.copy(endpoint_plank_front_1_39.quaternion);
  }
  mesh_plank_front_1_39.castShadow = options.castShadow ?? true;
  mesh_plank_front_1_39.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_front_1_39.userData.sculptComponent = {"id": "plank-front-1", "name": "Plank front 2", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5287, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4693, 0.27, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.5287]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-1", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-1"]};
  node_plank_front_1_39.add(mesh_plank_front_1_39);
  meshes["plank-front-1"] = mesh_plank_front_1_39;
  colliders["plank-front-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-front-1"] ??= [];
  destructionGroups["plank-front-1"].push(node_plank_front_1_39);

  const endpoint_plank_near_2_40 = makeAttachmentEndpoint(null);
  const node_plank_near_2_40 = new THREE.Group();
  node_plank_near_2_40.name = "Plank near 3__pivot";
  node_plank_near_2_40.scale.set(1, 1, 1);
  if (endpoint_plank_near_2_40) {
    node_plank_near_2_40.position.copy(endpoint_plank_near_2_40.start);
    node_plank_near_2_40.rotation.set(0.12659, 0.0, -0.0);
  } else {
    node_plank_near_2_40.position.set(0.0, 0.4467, 0.5768);
    node_plank_near_2_40.rotation.set(0.12659, 0.0, -0.0);
  }
  node_plank_near_2_40.userData.sculptComponent = {"id": "plank-near-2", "name": "Plank near 3", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.9299, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.4467, 0.5768], "rotation": [0.12659, 0.0, -0.0], "scale": [0.9299, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-2"]};
  node_plank_near_2_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_near_2_40);
  nodes["plank-near-2"] = node_plank_near_2_40;
  const mesh_plank_near_2_40Geometry = endpoint_plank_near_2_40
    ? new THREE.CylinderGeometry(endpoint_plank_near_2_40.endRadius, endpoint_plank_near_2_40.baseRadius, endpoint_plank_near_2_40.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_near_2_40) {
    mesh_plank_near_2_40Geometry.scale(0.9299, 0.1667, 0.04);
  }
  const mesh_plank_near_2_40 = new THREE.Mesh(
    mesh_plank_near_2_40Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_near_2_40.name = "Plank near 3";
  if (endpoint_plank_near_2_40) {
    mesh_plank_near_2_40.position.copy(endpoint_plank_near_2_40.midpoint);
    mesh_plank_near_2_40.quaternion.copy(endpoint_plank_near_2_40.quaternion);
  }
  mesh_plank_near_2_40.castShadow = options.castShadow ?? true;
  mesh_plank_near_2_40.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_near_2_40.userData.sculptComponent = {"id": "plank-near-2", "name": "Plank near 3", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank near 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.9299, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.4467, 0.5768], "rotation": [0.12659, 0.0, -0.0], "scale": [0.9299, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-near-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-near-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-near-2"]};
  node_plank_near_2_40.add(mesh_plank_near_2_40);
  meshes["plank-near-2"] = mesh_plank_near_2_40;
  colliders["plank-near-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-near-2"] ??= [];
  destructionGroups["plank-near-2"].push(node_plank_near_2_40);

  const endpoint_plank_far_2_41 = makeAttachmentEndpoint(null);
  const node_plank_far_2_41 = new THREE.Group();
  node_plank_far_2_41.name = "Plank far 3__pivot";
  node_plank_far_2_41.scale.set(1, 1, 1);
  if (endpoint_plank_far_2_41) {
    node_plank_far_2_41.position.copy(endpoint_plank_far_2_41.start);
    node_plank_far_2_41.rotation.set(-0.12659, 0.0, -0.0);
  } else {
    node_plank_far_2_41.position.set(0.0, 0.4467, -0.0568);
    node_plank_far_2_41.rotation.set(-0.12659, 0.0, -0.0);
  }
  node_plank_far_2_41.userData.sculptComponent = {"id": "plank-far-2", "name": "Plank far 3", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.9299, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.4467, -0.0568], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.9299, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-2"]};
  node_plank_far_2_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_far_2_41);
  nodes["plank-far-2"] = node_plank_far_2_41;
  const mesh_plank_far_2_41Geometry = endpoint_plank_far_2_41
    ? new THREE.CylinderGeometry(endpoint_plank_far_2_41.endRadius, endpoint_plank_far_2_41.baseRadius, endpoint_plank_far_2_41.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_far_2_41) {
    mesh_plank_far_2_41Geometry.scale(0.9299, 0.1667, 0.04);
  }
  const mesh_plank_far_2_41 = new THREE.Mesh(
    mesh_plank_far_2_41Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_far_2_41.name = "Plank far 3";
  if (endpoint_plank_far_2_41) {
    mesh_plank_far_2_41.position.copy(endpoint_plank_far_2_41.midpoint);
    mesh_plank_far_2_41.quaternion.copy(endpoint_plank_far_2_41.quaternion);
  }
  mesh_plank_far_2_41.castShadow = options.castShadow ?? true;
  mesh_plank_far_2_41.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_far_2_41.userData.sculptComponent = {"id": "plank-far-2", "name": "Plank far 3", "level": "meso", "role": "plank", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank far 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.9299, "height": 0.1667, "depth": 0.04, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.4467, -0.0568], "rotation": [-0.12659, 0.0, -0.0], "scale": [0.9299, 0.1667, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-far-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-far-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-far-2"]};
  node_plank_far_2_41.add(mesh_plank_far_2_41);
  meshes["plank-far-2"] = mesh_plank_far_2_41;
  colliders["plank-far-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-far-2"] ??= [];
  destructionGroups["plank-far-2"].push(node_plank_far_2_41);

  const endpoint_plank_rear_2_42 = makeAttachmentEndpoint(null);
  const node_plank_rear_2_42 = new THREE.Group();
  node_plank_rear_2_42.name = "Plank rear 3__pivot";
  node_plank_rear_2_42.scale.set(1, 1, 1);
  if (endpoint_plank_rear_2_42) {
    node_plank_rear_2_42.position.copy(endpoint_plank_rear_2_42.start);
    node_plank_rear_2_42.rotation.set(-0.0, 0.0, -0.14444);
  } else {
    node_plank_rear_2_42.position.set(0.495, 0.4467, 0.26);
    node_plank_rear_2_42.rotation.set(-0.0, 0.0, -0.14444);
  }
  node_plank_rear_2_42.userData.sculptComponent = {"id": "plank-rear-2", "name": "Plank rear 3", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5737, "units": "object", "confidence": 0.75}, "transform": {"position": [0.495, 0.4467, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.5737]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-2"]};
  node_plank_rear_2_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_rear_2_42);
  nodes["plank-rear-2"] = node_plank_rear_2_42;
  const mesh_plank_rear_2_42Geometry = endpoint_plank_rear_2_42
    ? new THREE.CylinderGeometry(endpoint_plank_rear_2_42.endRadius, endpoint_plank_rear_2_42.baseRadius, endpoint_plank_rear_2_42.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_rear_2_42) {
    mesh_plank_rear_2_42Geometry.scale(0.04, 0.1667, 0.5737);
  }
  const mesh_plank_rear_2_42 = new THREE.Mesh(
    mesh_plank_rear_2_42Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_rear_2_42.name = "Plank rear 3";
  if (endpoint_plank_rear_2_42) {
    mesh_plank_rear_2_42.position.copy(endpoint_plank_rear_2_42.midpoint);
    mesh_plank_rear_2_42.quaternion.copy(endpoint_plank_rear_2_42.quaternion);
  }
  mesh_plank_rear_2_42.castShadow = options.castShadow ?? true;
  mesh_plank_rear_2_42.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_rear_2_42.userData.sculptComponent = {"id": "plank-rear-2", "name": "Plank rear 3", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank rear 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5737, "units": "object", "confidence": 0.75}, "transform": {"position": [0.495, 0.4467, 0.26], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.04, 0.1667, 0.5737]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-rear-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-rear-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-rear-2"]};
  node_plank_rear_2_42.add(mesh_plank_rear_2_42);
  meshes["plank-rear-2"] = mesh_plank_rear_2_42;
  colliders["plank-rear-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-rear-2"] ??= [];
  destructionGroups["plank-rear-2"].push(node_plank_rear_2_42);

  const endpoint_plank_front_2_43 = makeAttachmentEndpoint(null);
  const node_plank_front_2_43 = new THREE.Group();
  node_plank_front_2_43.name = "Plank front 3__pivot";
  node_plank_front_2_43.scale.set(1, 1, 1);
  if (endpoint_plank_front_2_43) {
    node_plank_front_2_43.position.copy(endpoint_plank_front_2_43.start);
    node_plank_front_2_43.rotation.set(-0.0, 0.0, 0.14444);
  } else {
    node_plank_front_2_43.position.set(-0.495, 0.4467, 0.26);
    node_plank_front_2_43.rotation.set(-0.0, 0.0, 0.14444);
  }
  node_plank_front_2_43.userData.sculptComponent = {"id": "plank-front-2", "name": "Plank front 3", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5737, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.495, 0.4467, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.5737]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-2"]};
  node_plank_front_2_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_plank_front_2_43);
  nodes["plank-front-2"] = node_plank_front_2_43;
  const mesh_plank_front_2_43Geometry = endpoint_plank_front_2_43
    ? new THREE.CylinderGeometry(endpoint_plank_front_2_43.endRadius, endpoint_plank_front_2_43.baseRadius, endpoint_plank_front_2_43.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_plank_front_2_43) {
    mesh_plank_front_2_43Geometry.scale(0.04, 0.1667, 0.5737);
  }
  const mesh_plank_front_2_43 = new THREE.Mesh(
    mesh_plank_front_2_43Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_front_2_43.name = "Plank front 3";
  if (endpoint_plank_front_2_43) {
    mesh_plank_front_2_43.position.copy(endpoint_plank_front_2_43.midpoint);
    mesh_plank_front_2_43.quaternion.copy(endpoint_plank_front_2_43.quaternion);
  }
  mesh_plank_front_2_43.castShadow = options.castShadow ?? true;
  mesh_plank_front_2_43.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_front_2_43.userData.sculptComponent = {"id": "plank-front-2", "name": "Plank front 3", "level": "meso", "role": "plank", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank front 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.04, "height": 0.1667, "depth": 0.5737, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.495, 0.4467, 0.26], "rotation": [-0.0, 0.0, 0.14444], "scale": [0.04, 0.1667, 0.5737]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-front-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-seam-front-2", "kind": "seam", "description": "10 mm dark gap to the next plank", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["plank-seam-front-2"]};
  node_plank_front_2_43.add(mesh_plank_front_2_43);
  meshes["plank-front-2"] = mesh_plank_front_2_43;
  colliders["plank-front-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["plank-front-2"] ??= [];
  destructionGroups["plank-front-2"].push(node_plank_front_2_43);

  const endpoint_post_nl_44 = makeAttachmentEndpoint(null);
  const node_post_nl_44 = new THREE.Group();
  node_post_nl_44.name = "Corner post nl__pivot";
  node_post_nl_44.scale.set(1, 1, 1);
  if (endpoint_post_nl_44) {
    node_post_nl_44.position.copy(endpoint_post_nl_44.start);
    node_post_nl_44.rotation.set(0.12659, 0.0, 0.14444);
  } else {
    node_post_nl_44.position.set(-0.45, 0.275, 0.535);
    node_post_nl_44.rotation.set(0.12659, 0.0, 0.14444);
  }
  node_post_nl_44.userData.sculptComponent = {"id": "post-nl", "name": "Corner post nl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.45, 0.275, 0.535], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nl_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_nl_44);
  nodes["post-nl"] = node_post_nl_44;
  const mesh_post_nl_44Geometry = endpoint_post_nl_44
    ? new THREE.CylinderGeometry(endpoint_post_nl_44.endRadius, endpoint_post_nl_44.baseRadius, endpoint_post_nl_44.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_nl_44) {
    mesh_post_nl_44Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_nl_44 = new THREE.Mesh(
    mesh_post_nl_44Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_nl_44.name = "Corner post nl";
  if (endpoint_post_nl_44) {
    mesh_post_nl_44.position.copy(endpoint_post_nl_44.midpoint);
    mesh_post_nl_44.quaternion.copy(endpoint_post_nl_44.quaternion);
  }
  mesh_post_nl_44.castShadow = options.castShadow ?? true;
  mesh_post_nl_44.receiveShadow = options.receiveShadow ?? true;
  mesh_post_nl_44.userData.sculptComponent = {"id": "post-nl", "name": "Corner post nl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.45, 0.275, 0.535], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nl_44.add(mesh_post_nl_44);
  meshes["post-nl"] = mesh_post_nl_44;
  colliders["post-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-nl"] ??= [];
  destructionGroups["post-nl"].push(node_post_nl_44);

  const endpoint_bracket_top_nl_45 = makeAttachmentEndpoint(null);
  const node_bracket_top_nl_45 = new THREE.Group();
  node_bracket_top_nl_45.name = "Bracket top nl__pivot";
  node_bracket_top_nl_45.scale.set(1, 1, 1);
  if (endpoint_bracket_top_nl_45) {
    node_bracket_top_nl_45.position.copy(endpoint_bracket_top_nl_45.start);
    node_bracket_top_nl_45.rotation.set(0.12659, 0.0, 0.14444);
  } else {
    node_bracket_top_nl_45.position.set(-0.4595, 0.495, 0.5405);
    node_bracket_top_nl_45.rotation.set(0.12659, 0.0, 0.14444);
  }
  node_bracket_top_nl_45.userData.sculptComponent = {"id": "bracket-top-nl", "name": "Bracket top nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4595, 0.495, 0.5405], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nl-chamfer", "bracket-top-nl-rivets"]};
  node_bracket_top_nl_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_nl_45);
  nodes["bracket-top-nl"] = node_bracket_top_nl_45;
  const mesh_bracket_top_nl_45Geometry = endpoint_bracket_top_nl_45
    ? new THREE.CylinderGeometry(endpoint_bracket_top_nl_45.endRadius, endpoint_bracket_top_nl_45.baseRadius, endpoint_bracket_top_nl_45.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_nl_45) {
    mesh_bracket_top_nl_45Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_nl_45 = new THREE.Mesh(
    mesh_bracket_top_nl_45Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_nl_45.name = "Bracket top nl";
  if (endpoint_bracket_top_nl_45) {
    mesh_bracket_top_nl_45.position.copy(endpoint_bracket_top_nl_45.midpoint);
    mesh_bracket_top_nl_45.quaternion.copy(endpoint_bracket_top_nl_45.quaternion);
  }
  mesh_bracket_top_nl_45.castShadow = options.castShadow ?? true;
  mesh_bracket_top_nl_45.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_nl_45.userData.sculptComponent = {"id": "bracket-top-nl", "name": "Bracket top nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4595, 0.495, 0.5405], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nl-chamfer", "bracket-top-nl-rivets"]};
  node_bracket_top_nl_45.add(mesh_bracket_top_nl_45);
  meshes["bracket-top-nl"] = mesh_bracket_top_nl_45;
  colliders["bracket-top-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-nl"] ??= [];
  destructionGroups["bracket-top-nl"].push(node_bracket_top_nl_45);

  const endpoint_bracket_bot_nl_46 = makeAttachmentEndpoint(null);
  const node_bracket_bot_nl_46 = new THREE.Group();
  node_bracket_bot_nl_46.name = "Bracket bot nl__pivot";
  node_bracket_bot_nl_46.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_nl_46) {
    node_bracket_bot_nl_46.position.copy(endpoint_bracket_bot_nl_46.start);
    node_bracket_bot_nl_46.rotation.set(0.12659, 0.0, 0.14444);
  } else {
    node_bracket_bot_nl_46.position.set(-0.4037, 0.06, 0.4926);
    node_bracket_bot_nl_46.rotation.set(0.12659, 0.0, 0.14444);
  }
  node_bracket_bot_nl_46.userData.sculptComponent = {"id": "bracket-bot-nl", "name": "Bracket bot nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4037, 0.06, 0.4926], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nl-chamfer", "bracket-bot-nl-rivets"]};
  node_bracket_bot_nl_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_nl_46);
  nodes["bracket-bot-nl"] = node_bracket_bot_nl_46;
  const mesh_bracket_bot_nl_46Geometry = endpoint_bracket_bot_nl_46
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_nl_46.endRadius, endpoint_bracket_bot_nl_46.baseRadius, endpoint_bracket_bot_nl_46.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_nl_46) {
    mesh_bracket_bot_nl_46Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_nl_46 = new THREE.Mesh(
    mesh_bracket_bot_nl_46Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_nl_46.name = "Bracket bot nl";
  if (endpoint_bracket_bot_nl_46) {
    mesh_bracket_bot_nl_46.position.copy(endpoint_bracket_bot_nl_46.midpoint);
    mesh_bracket_bot_nl_46.quaternion.copy(endpoint_bracket_bot_nl_46.quaternion);
  }
  mesh_bracket_bot_nl_46.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_nl_46.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_nl_46.userData.sculptComponent = {"id": "bracket-bot-nl", "name": "Bracket bot nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4037, 0.06, 0.4926], "rotation": [0.12659, 0.0, 0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nl-chamfer", "bracket-bot-nl-rivets"]};
  node_bracket_bot_nl_46.add(mesh_bracket_bot_nl_46);
  meshes["bracket-bot-nl"] = mesh_bracket_bot_nl_46;
  colliders["bracket-bot-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-nl"] ??= [];
  destructionGroups["bracket-bot-nl"].push(node_bracket_bot_nl_46);

  const endpoint_post_nr_47 = makeAttachmentEndpoint(null);
  const node_post_nr_47 = new THREE.Group();
  node_post_nr_47.name = "Corner post nr__pivot";
  node_post_nr_47.scale.set(1, 1, 1);
  if (endpoint_post_nr_47) {
    node_post_nr_47.position.copy(endpoint_post_nr_47.start);
    node_post_nr_47.rotation.set(0.12659, 0.0, -0.14444);
  } else {
    node_post_nr_47.position.set(0.45, 0.275, 0.535);
    node_post_nr_47.rotation.set(0.12659, 0.0, -0.14444);
  }
  node_post_nr_47.userData.sculptComponent = {"id": "post-nr", "name": "Corner post nr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.45, 0.275, 0.535], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nr_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_nr_47);
  nodes["post-nr"] = node_post_nr_47;
  const mesh_post_nr_47Geometry = endpoint_post_nr_47
    ? new THREE.CylinderGeometry(endpoint_post_nr_47.endRadius, endpoint_post_nr_47.baseRadius, endpoint_post_nr_47.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_nr_47) {
    mesh_post_nr_47Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_nr_47 = new THREE.Mesh(
    mesh_post_nr_47Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_nr_47.name = "Corner post nr";
  if (endpoint_post_nr_47) {
    mesh_post_nr_47.position.copy(endpoint_post_nr_47.midpoint);
    mesh_post_nr_47.quaternion.copy(endpoint_post_nr_47.quaternion);
  }
  mesh_post_nr_47.castShadow = options.castShadow ?? true;
  mesh_post_nr_47.receiveShadow = options.receiveShadow ?? true;
  mesh_post_nr_47.userData.sculptComponent = {"id": "post-nr", "name": "Corner post nr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.45, 0.275, 0.535], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nr_47.add(mesh_post_nr_47);
  meshes["post-nr"] = mesh_post_nr_47;
  colliders["post-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-nr"] ??= [];
  destructionGroups["post-nr"].push(node_post_nr_47);

  const endpoint_bracket_top_nr_48 = makeAttachmentEndpoint(null);
  const node_bracket_top_nr_48 = new THREE.Group();
  node_bracket_top_nr_48.name = "Bracket top nr__pivot";
  node_bracket_top_nr_48.scale.set(1, 1, 1);
  if (endpoint_bracket_top_nr_48) {
    node_bracket_top_nr_48.position.copy(endpoint_bracket_top_nr_48.start);
    node_bracket_top_nr_48.rotation.set(0.12659, 0.0, -0.14444);
  } else {
    node_bracket_top_nr_48.position.set(0.4595, 0.495, 0.5405);
    node_bracket_top_nr_48.rotation.set(0.12659, 0.0, -0.14444);
  }
  node_bracket_top_nr_48.userData.sculptComponent = {"id": "bracket-top-nr", "name": "Bracket top nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4595, 0.495, 0.5405], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nr-chamfer", "bracket-top-nr-rivets"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "iron"}, "materialRegions": [{"regionId": "bracket-iron", "materialId": "iron", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}}]};
  node_bracket_top_nr_48.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_nr_48);
  nodes["bracket-top-nr"] = node_bracket_top_nr_48;
  const mesh_bracket_top_nr_48Geometry = endpoint_bracket_top_nr_48
    ? new THREE.CylinderGeometry(endpoint_bracket_top_nr_48.endRadius, endpoint_bracket_top_nr_48.baseRadius, endpoint_bracket_top_nr_48.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_nr_48) {
    mesh_bracket_top_nr_48Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_nr_48 = new THREE.Mesh(
    mesh_bracket_top_nr_48Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_nr_48.name = "Bracket top nr";
  if (endpoint_bracket_top_nr_48) {
    mesh_bracket_top_nr_48.position.copy(endpoint_bracket_top_nr_48.midpoint);
    mesh_bracket_top_nr_48.quaternion.copy(endpoint_bracket_top_nr_48.quaternion);
  }
  mesh_bracket_top_nr_48.castShadow = options.castShadow ?? true;
  mesh_bracket_top_nr_48.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_nr_48.userData.sculptComponent = {"id": "bracket-top-nr", "name": "Bracket top nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4595, 0.495, 0.5405], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nr-chamfer", "bracket-top-nr-rivets"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "iron"}, "materialRegions": [{"regionId": "bracket-iron", "materialId": "iron", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}}]};
  node_bracket_top_nr_48.add(mesh_bracket_top_nr_48);
  meshes["bracket-top-nr"] = mesh_bracket_top_nr_48;
  colliders["bracket-top-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-nr"] ??= [];
  destructionGroups["bracket-top-nr"].push(node_bracket_top_nr_48);

  const endpoint_bracket_bot_nr_49 = makeAttachmentEndpoint(null);
  const node_bracket_bot_nr_49 = new THREE.Group();
  node_bracket_bot_nr_49.name = "Bracket bot nr__pivot";
  node_bracket_bot_nr_49.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_nr_49) {
    node_bracket_bot_nr_49.position.copy(endpoint_bracket_bot_nr_49.start);
    node_bracket_bot_nr_49.rotation.set(0.12659, 0.0, -0.14444);
  } else {
    node_bracket_bot_nr_49.position.set(0.4037, 0.06, 0.4926);
    node_bracket_bot_nr_49.rotation.set(0.12659, 0.0, -0.14444);
  }
  node_bracket_bot_nr_49.userData.sculptComponent = {"id": "bracket-bot-nr", "name": "Bracket bot nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4037, 0.06, 0.4926], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nr-chamfer", "bracket-bot-nr-rivets"]};
  node_bracket_bot_nr_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_nr_49);
  nodes["bracket-bot-nr"] = node_bracket_bot_nr_49;
  const mesh_bracket_bot_nr_49Geometry = endpoint_bracket_bot_nr_49
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_nr_49.endRadius, endpoint_bracket_bot_nr_49.baseRadius, endpoint_bracket_bot_nr_49.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_nr_49) {
    mesh_bracket_bot_nr_49Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_nr_49 = new THREE.Mesh(
    mesh_bracket_bot_nr_49Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_nr_49.name = "Bracket bot nr";
  if (endpoint_bracket_bot_nr_49) {
    mesh_bracket_bot_nr_49.position.copy(endpoint_bracket_bot_nr_49.midpoint);
    mesh_bracket_bot_nr_49.quaternion.copy(endpoint_bracket_bot_nr_49.quaternion);
  }
  mesh_bracket_bot_nr_49.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_nr_49.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_nr_49.userData.sculptComponent = {"id": "bracket-bot-nr", "name": "Bracket bot nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4037, 0.06, 0.4926], "rotation": [0.12659, 0.0, -0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nr-chamfer", "bracket-bot-nr-rivets"]};
  node_bracket_bot_nr_49.add(mesh_bracket_bot_nr_49);
  meshes["bracket-bot-nr"] = mesh_bracket_bot_nr_49;
  colliders["bracket-bot-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-nr"] ??= [];
  destructionGroups["bracket-bot-nr"].push(node_bracket_bot_nr_49);

  const endpoint_post_fl_50 = makeAttachmentEndpoint(null);
  const node_post_fl_50 = new THREE.Group();
  node_post_fl_50.name = "Corner post fl__pivot";
  node_post_fl_50.scale.set(1, 1, 1);
  if (endpoint_post_fl_50) {
    node_post_fl_50.position.copy(endpoint_post_fl_50.start);
    node_post_fl_50.rotation.set(-0.12659, 0.0, 0.14444);
  } else {
    node_post_fl_50.position.set(-0.45, 0.275, -0.015);
    node_post_fl_50.rotation.set(-0.12659, 0.0, 0.14444);
  }
  node_post_fl_50.userData.sculptComponent = {"id": "post-fl", "name": "Corner post fl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.45, 0.275, -0.015], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fl_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_fl_50);
  nodes["post-fl"] = node_post_fl_50;
  const mesh_post_fl_50Geometry = endpoint_post_fl_50
    ? new THREE.CylinderGeometry(endpoint_post_fl_50.endRadius, endpoint_post_fl_50.baseRadius, endpoint_post_fl_50.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_fl_50) {
    mesh_post_fl_50Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_fl_50 = new THREE.Mesh(
    mesh_post_fl_50Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_fl_50.name = "Corner post fl";
  if (endpoint_post_fl_50) {
    mesh_post_fl_50.position.copy(endpoint_post_fl_50.midpoint);
    mesh_post_fl_50.quaternion.copy(endpoint_post_fl_50.quaternion);
  }
  mesh_post_fl_50.castShadow = options.castShadow ?? true;
  mesh_post_fl_50.receiveShadow = options.receiveShadow ?? true;
  mesh_post_fl_50.userData.sculptComponent = {"id": "post-fl", "name": "Corner post fl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.45, 0.275, -0.015], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fl_50.add(mesh_post_fl_50);
  meshes["post-fl"] = mesh_post_fl_50;
  colliders["post-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-fl"] ??= [];
  destructionGroups["post-fl"].push(node_post_fl_50);

  const endpoint_bracket_top_fl_51 = makeAttachmentEndpoint(null);
  const node_bracket_top_fl_51 = new THREE.Group();
  node_bracket_top_fl_51.name = "Bracket top fl__pivot";
  node_bracket_top_fl_51.scale.set(1, 1, 1);
  if (endpoint_bracket_top_fl_51) {
    node_bracket_top_fl_51.position.copy(endpoint_bracket_top_fl_51.start);
    node_bracket_top_fl_51.rotation.set(-0.12659, 0.0, 0.14444);
  } else {
    node_bracket_top_fl_51.position.set(-0.4595, 0.495, -0.0205);
    node_bracket_top_fl_51.rotation.set(-0.12659, 0.0, 0.14444);
  }
  node_bracket_top_fl_51.userData.sculptComponent = {"id": "bracket-top-fl", "name": "Bracket top fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4595, 0.495, -0.0205], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fl-chamfer", "bracket-top-fl-rivets"]};
  node_bracket_top_fl_51.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_fl_51);
  nodes["bracket-top-fl"] = node_bracket_top_fl_51;
  const mesh_bracket_top_fl_51Geometry = endpoint_bracket_top_fl_51
    ? new THREE.CylinderGeometry(endpoint_bracket_top_fl_51.endRadius, endpoint_bracket_top_fl_51.baseRadius, endpoint_bracket_top_fl_51.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_fl_51) {
    mesh_bracket_top_fl_51Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_fl_51 = new THREE.Mesh(
    mesh_bracket_top_fl_51Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_fl_51.name = "Bracket top fl";
  if (endpoint_bracket_top_fl_51) {
    mesh_bracket_top_fl_51.position.copy(endpoint_bracket_top_fl_51.midpoint);
    mesh_bracket_top_fl_51.quaternion.copy(endpoint_bracket_top_fl_51.quaternion);
  }
  mesh_bracket_top_fl_51.castShadow = options.castShadow ?? true;
  mesh_bracket_top_fl_51.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_fl_51.userData.sculptComponent = {"id": "bracket-top-fl", "name": "Bracket top fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4595, 0.495, -0.0205], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fl-chamfer", "bracket-top-fl-rivets"]};
  node_bracket_top_fl_51.add(mesh_bracket_top_fl_51);
  meshes["bracket-top-fl"] = mesh_bracket_top_fl_51;
  colliders["bracket-top-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-fl"] ??= [];
  destructionGroups["bracket-top-fl"].push(node_bracket_top_fl_51);

  const endpoint_bracket_bot_fl_52 = makeAttachmentEndpoint(null);
  const node_bracket_bot_fl_52 = new THREE.Group();
  node_bracket_bot_fl_52.name = "Bracket bot fl__pivot";
  node_bracket_bot_fl_52.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_fl_52) {
    node_bracket_bot_fl_52.position.copy(endpoint_bracket_bot_fl_52.start);
    node_bracket_bot_fl_52.rotation.set(-0.12659, 0.0, 0.14444);
  } else {
    node_bracket_bot_fl_52.position.set(-0.4037, 0.06, 0.0274);
    node_bracket_bot_fl_52.rotation.set(-0.12659, 0.0, 0.14444);
  }
  node_bracket_bot_fl_52.userData.sculptComponent = {"id": "bracket-bot-fl", "name": "Bracket bot fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4037, 0.06, 0.0274], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fl-chamfer", "bracket-bot-fl-rivets"]};
  node_bracket_bot_fl_52.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_fl_52);
  nodes["bracket-bot-fl"] = node_bracket_bot_fl_52;
  const mesh_bracket_bot_fl_52Geometry = endpoint_bracket_bot_fl_52
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_fl_52.endRadius, endpoint_bracket_bot_fl_52.baseRadius, endpoint_bracket_bot_fl_52.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_fl_52) {
    mesh_bracket_bot_fl_52Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_fl_52 = new THREE.Mesh(
    mesh_bracket_bot_fl_52Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_fl_52.name = "Bracket bot fl";
  if (endpoint_bracket_bot_fl_52) {
    mesh_bracket_bot_fl_52.position.copy(endpoint_bracket_bot_fl_52.midpoint);
    mesh_bracket_bot_fl_52.quaternion.copy(endpoint_bracket_bot_fl_52.quaternion);
  }
  mesh_bracket_bot_fl_52.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_fl_52.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_fl_52.userData.sculptComponent = {"id": "bracket-bot-fl", "name": "Bracket bot fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4037, 0.06, 0.0274], "rotation": [-0.12659, 0.0, 0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fl-chamfer", "bracket-bot-fl-rivets"]};
  node_bracket_bot_fl_52.add(mesh_bracket_bot_fl_52);
  meshes["bracket-bot-fl"] = mesh_bracket_bot_fl_52;
  colliders["bracket-bot-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-fl"] ??= [];
  destructionGroups["bracket-bot-fl"].push(node_bracket_bot_fl_52);

  const endpoint_post_fr_53 = makeAttachmentEndpoint(null);
  const node_post_fr_53 = new THREE.Group();
  node_post_fr_53.name = "Corner post fr__pivot";
  node_post_fr_53.scale.set(1, 1, 1);
  if (endpoint_post_fr_53) {
    node_post_fr_53.position.copy(endpoint_post_fr_53.start);
    node_post_fr_53.rotation.set(-0.12659, 0.0, -0.14444);
  } else {
    node_post_fr_53.position.set(0.45, 0.275, -0.015);
    node_post_fr_53.rotation.set(-0.12659, 0.0, -0.14444);
  }
  node_post_fr_53.userData.sculptComponent = {"id": "post-fr", "name": "Corner post fr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.45, 0.275, -0.015], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fr_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_fr_53);
  nodes["post-fr"] = node_post_fr_53;
  const mesh_post_fr_53Geometry = endpoint_post_fr_53
    ? new THREE.CylinderGeometry(endpoint_post_fr_53.endRadius, endpoint_post_fr_53.baseRadius, endpoint_post_fr_53.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_fr_53) {
    mesh_post_fr_53Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_fr_53 = new THREE.Mesh(
    mesh_post_fr_53Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_fr_53.name = "Corner post fr";
  if (endpoint_post_fr_53) {
    mesh_post_fr_53.position.copy(endpoint_post_fr_53.midpoint);
    mesh_post_fr_53.quaternion.copy(endpoint_post_fr_53.quaternion);
  }
  mesh_post_fr_53.castShadow = options.castShadow ?? true;
  mesh_post_fr_53.receiveShadow = options.receiveShadow ?? true;
  mesh_post_fr_53.userData.sculptComponent = {"id": "post-fr", "name": "Corner post fr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.45, 0.275, -0.015], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fr_53.add(mesh_post_fr_53);
  meshes["post-fr"] = mesh_post_fr_53;
  colliders["post-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-fr"] ??= [];
  destructionGroups["post-fr"].push(node_post_fr_53);

  const endpoint_bracket_top_fr_54 = makeAttachmentEndpoint(null);
  const node_bracket_top_fr_54 = new THREE.Group();
  node_bracket_top_fr_54.name = "Bracket top fr__pivot";
  node_bracket_top_fr_54.scale.set(1, 1, 1);
  if (endpoint_bracket_top_fr_54) {
    node_bracket_top_fr_54.position.copy(endpoint_bracket_top_fr_54.start);
    node_bracket_top_fr_54.rotation.set(-0.12659, 0.0, -0.14444);
  } else {
    node_bracket_top_fr_54.position.set(0.4595, 0.495, -0.0205);
    node_bracket_top_fr_54.rotation.set(-0.12659, 0.0, -0.14444);
  }
  node_bracket_top_fr_54.userData.sculptComponent = {"id": "bracket-top-fr", "name": "Bracket top fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4595, 0.495, -0.0205], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fr-chamfer", "bracket-top-fr-rivets"]};
  node_bracket_top_fr_54.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_fr_54);
  nodes["bracket-top-fr"] = node_bracket_top_fr_54;
  const mesh_bracket_top_fr_54Geometry = endpoint_bracket_top_fr_54
    ? new THREE.CylinderGeometry(endpoint_bracket_top_fr_54.endRadius, endpoint_bracket_top_fr_54.baseRadius, endpoint_bracket_top_fr_54.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_fr_54) {
    mesh_bracket_top_fr_54Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_fr_54 = new THREE.Mesh(
    mesh_bracket_top_fr_54Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_fr_54.name = "Bracket top fr";
  if (endpoint_bracket_top_fr_54) {
    mesh_bracket_top_fr_54.position.copy(endpoint_bracket_top_fr_54.midpoint);
    mesh_bracket_top_fr_54.quaternion.copy(endpoint_bracket_top_fr_54.quaternion);
  }
  mesh_bracket_top_fr_54.castShadow = options.castShadow ?? true;
  mesh_bracket_top_fr_54.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_fr_54.userData.sculptComponent = {"id": "bracket-top-fr", "name": "Bracket top fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4595, 0.495, -0.0205], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fr-chamfer", "bracket-top-fr-rivets"]};
  node_bracket_top_fr_54.add(mesh_bracket_top_fr_54);
  meshes["bracket-top-fr"] = mesh_bracket_top_fr_54;
  colliders["bracket-top-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-fr"] ??= [];
  destructionGroups["bracket-top-fr"].push(node_bracket_top_fr_54);

  const endpoint_bracket_bot_fr_55 = makeAttachmentEndpoint(null);
  const node_bracket_bot_fr_55 = new THREE.Group();
  node_bracket_bot_fr_55.name = "Bracket bot fr__pivot";
  node_bracket_bot_fr_55.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_fr_55) {
    node_bracket_bot_fr_55.position.copy(endpoint_bracket_bot_fr_55.start);
    node_bracket_bot_fr_55.rotation.set(-0.12659, 0.0, -0.14444);
  } else {
    node_bracket_bot_fr_55.position.set(0.4037, 0.06, 0.0274);
    node_bracket_bot_fr_55.rotation.set(-0.12659, 0.0, -0.14444);
  }
  node_bracket_bot_fr_55.userData.sculptComponent = {"id": "bracket-bot-fr", "name": "Bracket bot fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4037, 0.06, 0.0274], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fr-chamfer", "bracket-bot-fr-rivets"]};
  node_bracket_bot_fr_55.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_fr_55);
  nodes["bracket-bot-fr"] = node_bracket_bot_fr_55;
  const mesh_bracket_bot_fr_55Geometry = endpoint_bracket_bot_fr_55
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_fr_55.endRadius, endpoint_bracket_bot_fr_55.baseRadius, endpoint_bracket_bot_fr_55.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_fr_55) {
    mesh_bracket_bot_fr_55Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_fr_55 = new THREE.Mesh(
    mesh_bracket_bot_fr_55Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_fr_55.name = "Bracket bot fr";
  if (endpoint_bracket_bot_fr_55) {
    mesh_bracket_bot_fr_55.position.copy(endpoint_bracket_bot_fr_55.midpoint);
    mesh_bracket_bot_fr_55.quaternion.copy(endpoint_bracket_bot_fr_55.quaternion);
  }
  mesh_bracket_bot_fr_55.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_fr_55.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_fr_55.userData.sculptComponent = {"id": "bracket-bot-fr", "name": "Bracket bot fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4037, 0.06, 0.0274], "rotation": [-0.12659, 0.0, -0.14444], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fr-chamfer", "bracket-bot-fr-rivets"]};
  node_bracket_bot_fr_55.add(mesh_bracket_bot_fr_55);
  meshes["bracket-bot-fr"] = mesh_bracket_bot_fr_55;
  colliders["bracket-bot-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-fr"] ??= [];
  destructionGroups["bracket-bot-fr"].push(node_bracket_bot_fr_55);

  const attachment_handle_strap_near_56 = {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.45], "localEnd": [0.5451, 0.31, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_handle_strap_near_56 = makeAttachmentEndpoint(attachment_handle_strap_near_56);
  const node_handle_strap_near_56 = new THREE.Group();
  node_handle_strap_near_56.name = "Handle strap (near)__pivot";
  node_handle_strap_near_56.scale.set(1, 1, 1);
  if (endpoint_handle_strap_near_56) {
    node_handle_strap_near_56.position.copy(endpoint_handle_strap_near_56.start);
    node_handle_strap_near_56.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_strap_near_56.position.set(0.5023, 0.05, 0.45);
    node_handle_strap_near_56.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_strap_near_56.userData.sculptComponent = {"id": "handle-strap-near", "name": "Handle strap (near)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a straight round iron bar up the end wall, a cylinder between its bolted foot and its knee.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.45], "localEnd": [0.5451, 0.31, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5023, 0.05, 0.45], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-near-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-near-bolt"]};
  node_handle_strap_near_56.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_strap_near_56);
  nodes["handle-strap-near"] = node_handle_strap_near_56;
  const mesh_handle_strap_near_56Geometry = endpoint_handle_strap_near_56
    ? new THREE.CylinderGeometry(endpoint_handle_strap_near_56.endRadius, endpoint_handle_strap_near_56.baseRadius, endpoint_handle_strap_near_56.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_handle_strap_near_56) {
    mesh_handle_strap_near_56Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_strap_near_56 = new THREE.Mesh(
    mesh_handle_strap_near_56Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_strap_near_56.name = "Handle strap (near)";
  if (endpoint_handle_strap_near_56) {
    mesh_handle_strap_near_56.position.copy(endpoint_handle_strap_near_56.midpoint);
    mesh_handle_strap_near_56.quaternion.copy(endpoint_handle_strap_near_56.quaternion);
  }
  mesh_handle_strap_near_56.castShadow = options.castShadow ?? true;
  mesh_handle_strap_near_56.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_strap_near_56.userData.sculptComponent = {"id": "handle-strap-near", "name": "Handle strap (near)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a straight round iron bar up the end wall, a cylinder between its bolted foot and its knee.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.45], "localEnd": [0.5451, 0.31, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5023, 0.05, 0.45], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-near-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-near-bolt"]};
  node_handle_strap_near_56.add(mesh_handle_strap_near_56);
  meshes["handle-strap-near"] = mesh_handle_strap_near_56;
  colliders["handle-strap-near"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-strap-near"] ??= [];
  destructionGroups["handle-strap-near"].push(node_handle_strap_near_56);

  const attachment_handle_arm_near_57 = {"parentId": "tub-core", "parentSocket": "handle-strap-near:knee", "localStart": [0.5451, 0.31, 0.45], "localEnd": [0.65, 0.33, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_handle_arm_near_57 = makeAttachmentEndpoint(attachment_handle_arm_near_57);
  const node_handle_arm_near_57 = new THREE.Group();
  node_handle_arm_near_57.name = "Handle arm (near)__pivot";
  node_handle_arm_near_57.scale.set(1, 1, 1);
  if (endpoint_handle_arm_near_57) {
    node_handle_arm_near_57.position.copy(endpoint_handle_arm_near_57.start);
    node_handle_arm_near_57.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_arm_near_57.position.set(0.5451, 0.31, 0.45);
    node_handle_arm_near_57.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_arm_near_57.userData.sculptComponent = {"id": "handle-arm-near", "name": "Handle arm (near)", "level": "meso", "role": "handle", "importance": 0.45, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle arm: the strap's short outward bar from the knee to the grip, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:knee", "localStart": [0.5451, 0.31, 0.45], "localEnd": [0.65, 0.33, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.45], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_arm_near_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_arm_near_57);
  nodes["handle-arm-near"] = node_handle_arm_near_57;
  const mesh_handle_arm_near_57Geometry = endpoint_handle_arm_near_57
    ? new THREE.CylinderGeometry(endpoint_handle_arm_near_57.endRadius, endpoint_handle_arm_near_57.baseRadius, endpoint_handle_arm_near_57.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_handle_arm_near_57) {
    mesh_handle_arm_near_57Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_arm_near_57 = new THREE.Mesh(
    mesh_handle_arm_near_57Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_arm_near_57.name = "Handle arm (near)";
  if (endpoint_handle_arm_near_57) {
    mesh_handle_arm_near_57.position.copy(endpoint_handle_arm_near_57.midpoint);
    mesh_handle_arm_near_57.quaternion.copy(endpoint_handle_arm_near_57.quaternion);
  }
  mesh_handle_arm_near_57.castShadow = options.castShadow ?? true;
  mesh_handle_arm_near_57.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_arm_near_57.userData.sculptComponent = {"id": "handle-arm-near", "name": "Handle arm (near)", "level": "meso", "role": "handle", "importance": 0.45, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle arm: the strap's short outward bar from the knee to the grip, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:knee", "localStart": [0.5451, 0.31, 0.45], "localEnd": [0.65, 0.33, 0.45], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.45], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_arm_near_57.add(mesh_handle_arm_near_57);
  meshes["handle-arm-near"] = mesh_handle_arm_near_57;
  colliders["handle-arm-near"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-arm-near"] ??= [];
  destructionGroups["handle-arm-near"].push(node_handle_arm_near_57);

  const endpoint_handle_knee_near_58 = makeAttachmentEndpoint(null);
  const node_handle_knee_near_58 = new THREE.Group();
  node_handle_knee_near_58.name = "Handle knee (near)__pivot";
  node_handle_knee_near_58.scale.set(1, 1, 1);
  if (endpoint_handle_knee_near_58) {
    node_handle_knee_near_58.position.copy(endpoint_handle_knee_near_58.start);
    node_handle_knee_near_58.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_knee_near_58.position.set(0.5451, 0.31, 0.45);
    node_handle_knee_near_58.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_knee_near_58.userData.sculptComponent = {"id": "handle-knee-near", "name": "Handle knee (near)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Handle knee: the rounded bend between the two bars, a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:knee", "localStart": [0.5451, 0.3, 0.45], "localEnd": [0.5451, 0.32, 0.45], "contactType": "welded", "embedDepth": 0.02, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.054, "height": 0.054, "depth": 0.054, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.45], "rotation": [-0.0, 0.0, -0.0], "scale": [0.054, 0.054, 0.054]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_knee_near_58.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_knee_near_58);
  nodes["handle-knee-near"] = node_handle_knee_near_58;
  const mesh_handle_knee_near_58Geometry = endpoint_handle_knee_near_58
    ? new THREE.CylinderGeometry(endpoint_handle_knee_near_58.endRadius, endpoint_handle_knee_near_58.baseRadius, endpoint_handle_knee_near_58.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_handle_knee_near_58) {
    mesh_handle_knee_near_58Geometry.scale(0.054, 0.054, 0.054);
  }
  const mesh_handle_knee_near_58 = new THREE.Mesh(
    mesh_handle_knee_near_58Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_knee_near_58.name = "Handle knee (near)";
  if (endpoint_handle_knee_near_58) {
    mesh_handle_knee_near_58.position.copy(endpoint_handle_knee_near_58.midpoint);
    mesh_handle_knee_near_58.quaternion.copy(endpoint_handle_knee_near_58.quaternion);
  }
  mesh_handle_knee_near_58.castShadow = options.castShadow ?? true;
  mesh_handle_knee_near_58.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_knee_near_58.userData.sculptComponent = {"id": "handle-knee-near", "name": "Handle knee (near)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Handle knee: the rounded bend between the two bars, a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:knee", "localStart": [0.5451, 0.3, 0.45], "localEnd": [0.5451, 0.32, 0.45], "contactType": "welded", "embedDepth": 0.02, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.054, "height": 0.054, "depth": 0.054, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.45], "rotation": [-0.0, 0.0, -0.0], "scale": [0.054, 0.054, 0.054]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_knee_near_58.add(mesh_handle_knee_near_58);
  meshes["handle-knee-near"] = mesh_handle_knee_near_58;
  colliders["handle-knee-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-knee-near"] ??= [];
  destructionGroups["handle-knee-near"].push(node_handle_knee_near_58);

  const endpoint_handle_foot_near_59 = makeAttachmentEndpoint(null);
  const node_handle_foot_near_59 = new THREE.Group();
  node_handle_foot_near_59.name = "Handle foot plate (near)__pivot";
  node_handle_foot_near_59.scale.set(1, 1, 1);
  if (endpoint_handle_foot_near_59) {
    node_handle_foot_near_59.position.copy(endpoint_handle_foot_near_59.start);
    node_handle_foot_near_59.rotation.set(-0.0, 0.0, -0.14444);
  } else {
    node_handle_foot_near_59.position.set(0.4693, 0.05, 0.45);
    node_handle_foot_near_59.rotation.set(-0.0, 0.0, -0.14444);
  }
  node_handle_foot_near_59.userData.sculptComponent = {"id": "handle-foot-near", "name": "Handle foot plate (near)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Handle foot plate: a flat iron plate bolting the strap to the end wall, a box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.4573, 0.05, 0.45], "localEnd": [0.4873, 0.05, 0.45], "contactType": "bolted", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.075, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.05, 0.45], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.03, 0.1, 0.075]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_foot_near_59.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_foot_near_59);
  nodes["handle-foot-near"] = node_handle_foot_near_59;
  const mesh_handle_foot_near_59Geometry = endpoint_handle_foot_near_59
    ? new THREE.CylinderGeometry(endpoint_handle_foot_near_59.endRadius, endpoint_handle_foot_near_59.baseRadius, endpoint_handle_foot_near_59.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_handle_foot_near_59) {
    mesh_handle_foot_near_59Geometry.scale(0.03, 0.1, 0.075);
  }
  const mesh_handle_foot_near_59 = new THREE.Mesh(
    mesh_handle_foot_near_59Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_foot_near_59.name = "Handle foot plate (near)";
  if (endpoint_handle_foot_near_59) {
    mesh_handle_foot_near_59.position.copy(endpoint_handle_foot_near_59.midpoint);
    mesh_handle_foot_near_59.quaternion.copy(endpoint_handle_foot_near_59.quaternion);
  }
  mesh_handle_foot_near_59.castShadow = options.castShadow ?? true;
  mesh_handle_foot_near_59.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_foot_near_59.userData.sculptComponent = {"id": "handle-foot-near", "name": "Handle foot plate (near)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Handle foot plate: a flat iron plate bolting the strap to the end wall, a box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.4573, 0.05, 0.45], "localEnd": [0.4873, 0.05, 0.45], "contactType": "bolted", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.075, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.05, 0.45], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.03, 0.1, 0.075]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_foot_near_59.add(mesh_handle_foot_near_59);
  meshes["handle-foot-near"] = mesh_handle_foot_near_59;
  colliders["handle-foot-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-foot-near"] ??= [];
  destructionGroups["handle-foot-near"].push(node_handle_foot_near_59);

  const attachment_handle_strap_far_60 = {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.07], "localEnd": [0.5451, 0.31, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_handle_strap_far_60 = makeAttachmentEndpoint(attachment_handle_strap_far_60);
  const node_handle_strap_far_60 = new THREE.Group();
  node_handle_strap_far_60.name = "Handle strap (far)__pivot";
  node_handle_strap_far_60.scale.set(1, 1, 1);
  if (endpoint_handle_strap_far_60) {
    node_handle_strap_far_60.position.copy(endpoint_handle_strap_far_60.start);
    node_handle_strap_far_60.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_strap_far_60.position.set(0.5023, 0.05, 0.07);
    node_handle_strap_far_60.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_strap_far_60.userData.sculptComponent = {"id": "handle-strap-far", "name": "Handle strap (far)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a straight round iron bar up the end wall, a cylinder between its bolted foot and its knee.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.07], "localEnd": [0.5451, 0.31, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5023, 0.05, 0.07], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-far-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-far-bolt"]};
  node_handle_strap_far_60.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_strap_far_60);
  nodes["handle-strap-far"] = node_handle_strap_far_60;
  const mesh_handle_strap_far_60Geometry = endpoint_handle_strap_far_60
    ? new THREE.CylinderGeometry(endpoint_handle_strap_far_60.endRadius, endpoint_handle_strap_far_60.baseRadius, endpoint_handle_strap_far_60.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_handle_strap_far_60) {
    mesh_handle_strap_far_60Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_strap_far_60 = new THREE.Mesh(
    mesh_handle_strap_far_60Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_strap_far_60.name = "Handle strap (far)";
  if (endpoint_handle_strap_far_60) {
    mesh_handle_strap_far_60.position.copy(endpoint_handle_strap_far_60.midpoint);
    mesh_handle_strap_far_60.quaternion.copy(endpoint_handle_strap_far_60.quaternion);
  }
  mesh_handle_strap_far_60.castShadow = options.castShadow ?? true;
  mesh_handle_strap_far_60.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_strap_far_60.userData.sculptComponent = {"id": "handle-strap-far", "name": "Handle strap (far)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a straight round iron bar up the end wall, a cylinder between its bolted foot and its knee.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.5023, 0.05, 0.07], "localEnd": [0.5451, 0.31, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5023, 0.05, 0.07], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-far-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-far-bolt"]};
  node_handle_strap_far_60.add(mesh_handle_strap_far_60);
  meshes["handle-strap-far"] = mesh_handle_strap_far_60;
  colliders["handle-strap-far"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-strap-far"] ??= [];
  destructionGroups["handle-strap-far"].push(node_handle_strap_far_60);

  const attachment_handle_arm_far_61 = {"parentId": "tub-core", "parentSocket": "handle-strap-far:knee", "localStart": [0.5451, 0.31, 0.07], "localEnd": [0.65, 0.33, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_handle_arm_far_61 = makeAttachmentEndpoint(attachment_handle_arm_far_61);
  const node_handle_arm_far_61 = new THREE.Group();
  node_handle_arm_far_61.name = "Handle arm (far)__pivot";
  node_handle_arm_far_61.scale.set(1, 1, 1);
  if (endpoint_handle_arm_far_61) {
    node_handle_arm_far_61.position.copy(endpoint_handle_arm_far_61.start);
    node_handle_arm_far_61.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_arm_far_61.position.set(0.5451, 0.31, 0.07);
    node_handle_arm_far_61.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_arm_far_61.userData.sculptComponent = {"id": "handle-arm-far", "name": "Handle arm (far)", "level": "meso", "role": "handle", "importance": 0.45, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle arm: the strap's short outward bar from the knee to the grip, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-far:knee", "localStart": [0.5451, 0.31, 0.07], "localEnd": [0.65, 0.33, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.07], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_arm_far_61.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_arm_far_61);
  nodes["handle-arm-far"] = node_handle_arm_far_61;
  const mesh_handle_arm_far_61Geometry = endpoint_handle_arm_far_61
    ? new THREE.CylinderGeometry(endpoint_handle_arm_far_61.endRadius, endpoint_handle_arm_far_61.baseRadius, endpoint_handle_arm_far_61.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_handle_arm_far_61) {
    mesh_handle_arm_far_61Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_arm_far_61 = new THREE.Mesh(
    mesh_handle_arm_far_61Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_arm_far_61.name = "Handle arm (far)";
  if (endpoint_handle_arm_far_61) {
    mesh_handle_arm_far_61.position.copy(endpoint_handle_arm_far_61.midpoint);
    mesh_handle_arm_far_61.quaternion.copy(endpoint_handle_arm_far_61.quaternion);
  }
  mesh_handle_arm_far_61.castShadow = options.castShadow ?? true;
  mesh_handle_arm_far_61.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_arm_far_61.userData.sculptComponent = {"id": "handle-arm-far", "name": "Handle arm (far)", "level": "meso", "role": "handle", "importance": 0.45, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Handle arm: the strap's short outward bar from the knee to the grip, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-far:knee", "localStart": [0.5451, 0.31, 0.07], "localEnd": [0.65, 0.33, 0.07], "baseRadius": 0.024, "endRadius": 0.024, "contactType": "welded", "embedDepth": 0.012, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.07], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-arm-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_arm_far_61.add(mesh_handle_arm_far_61);
  meshes["handle-arm-far"] = mesh_handle_arm_far_61;
  colliders["handle-arm-far"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-arm-far"] ??= [];
  destructionGroups["handle-arm-far"].push(node_handle_arm_far_61);

  const endpoint_handle_knee_far_62 = makeAttachmentEndpoint(null);
  const node_handle_knee_far_62 = new THREE.Group();
  node_handle_knee_far_62.name = "Handle knee (far)__pivot";
  node_handle_knee_far_62.scale.set(1, 1, 1);
  if (endpoint_handle_knee_far_62) {
    node_handle_knee_far_62.position.copy(endpoint_handle_knee_far_62.start);
    node_handle_knee_far_62.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_knee_far_62.position.set(0.5451, 0.31, 0.07);
    node_handle_knee_far_62.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_knee_far_62.userData.sculptComponent = {"id": "handle-knee-far", "name": "Handle knee (far)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Handle knee: the rounded bend between the two bars, a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-far:knee", "localStart": [0.5451, 0.3, 0.07], "localEnd": [0.5451, 0.32, 0.07], "contactType": "welded", "embedDepth": 0.02, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.054, "height": 0.054, "depth": 0.054, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.07], "rotation": [-0.0, 0.0, -0.0], "scale": [0.054, 0.054, 0.054]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_knee_far_62.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_knee_far_62);
  nodes["handle-knee-far"] = node_handle_knee_far_62;
  const mesh_handle_knee_far_62Geometry = endpoint_handle_knee_far_62
    ? new THREE.CylinderGeometry(endpoint_handle_knee_far_62.endRadius, endpoint_handle_knee_far_62.baseRadius, endpoint_handle_knee_far_62.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_handle_knee_far_62) {
    mesh_handle_knee_far_62Geometry.scale(0.054, 0.054, 0.054);
  }
  const mesh_handle_knee_far_62 = new THREE.Mesh(
    mesh_handle_knee_far_62Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_knee_far_62.name = "Handle knee (far)";
  if (endpoint_handle_knee_far_62) {
    mesh_handle_knee_far_62.position.copy(endpoint_handle_knee_far_62.midpoint);
    mesh_handle_knee_far_62.quaternion.copy(endpoint_handle_knee_far_62.quaternion);
  }
  mesh_handle_knee_far_62.castShadow = options.castShadow ?? true;
  mesh_handle_knee_far_62.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_knee_far_62.userData.sculptComponent = {"id": "handle-knee-far", "name": "Handle knee (far)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Handle knee: the rounded bend between the two bars, a sphere.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-far:knee", "localStart": [0.5451, 0.3, 0.07], "localEnd": [0.5451, 0.32, 0.07], "contactType": "welded", "embedDepth": 0.02, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.054, "height": 0.054, "depth": 0.054, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5451, 0.31, 0.07], "rotation": [-0.0, 0.0, -0.0], "scale": [0.054, 0.054, 0.054]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-knee-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_knee_far_62.add(mesh_handle_knee_far_62);
  meshes["handle-knee-far"] = mesh_handle_knee_far_62;
  colliders["handle-knee-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-knee-far"] ??= [];
  destructionGroups["handle-knee-far"].push(node_handle_knee_far_62);

  const endpoint_handle_foot_far_63 = makeAttachmentEndpoint(null);
  const node_handle_foot_far_63 = new THREE.Group();
  node_handle_foot_far_63.name = "Handle foot plate (far)__pivot";
  node_handle_foot_far_63.scale.set(1, 1, 1);
  if (endpoint_handle_foot_far_63) {
    node_handle_foot_far_63.position.copy(endpoint_handle_foot_far_63.start);
    node_handle_foot_far_63.rotation.set(-0.0, 0.0, -0.14444);
  } else {
    node_handle_foot_far_63.position.set(0.4693, 0.05, 0.07);
    node_handle_foot_far_63.rotation.set(-0.0, 0.0, -0.14444);
  }
  node_handle_foot_far_63.userData.sculptComponent = {"id": "handle-foot-far", "name": "Handle foot plate (far)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Handle foot plate: a flat iron plate bolting the strap to the end wall, a box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.4573, 0.05, 0.07], "localEnd": [0.4873, 0.05, 0.07], "contactType": "bolted", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.075, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.05, 0.07], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.03, 0.1, 0.075]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_foot_far_63.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_foot_far_63);
  nodes["handle-foot-far"] = node_handle_foot_far_63;
  const mesh_handle_foot_far_63Geometry = endpoint_handle_foot_far_63
    ? new THREE.CylinderGeometry(endpoint_handle_foot_far_63.endRadius, endpoint_handle_foot_far_63.baseRadius, endpoint_handle_foot_far_63.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_handle_foot_far_63) {
    mesh_handle_foot_far_63Geometry.scale(0.03, 0.1, 0.075);
  }
  const mesh_handle_foot_far_63 = new THREE.Mesh(
    mesh_handle_foot_far_63Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_foot_far_63.name = "Handle foot plate (far)";
  if (endpoint_handle_foot_far_63) {
    mesh_handle_foot_far_63.position.copy(endpoint_handle_foot_far_63.midpoint);
    mesh_handle_foot_far_63.quaternion.copy(endpoint_handle_foot_far_63.quaternion);
  }
  mesh_handle_foot_far_63.castShadow = options.castShadow ?? true;
  mesh_handle_foot_far_63.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_foot_far_63.userData.sculptComponent = {"id": "handle-foot-far", "name": "Handle foot plate (far)", "level": "micro", "role": "handle", "importance": 0.3, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Handle foot plate: a flat iron plate bolting the strap to the end wall, a box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.4573, 0.05, 0.07], "localEnd": [0.4873, 0.05, 0.07], "contactType": "bolted", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.1, "depth": 0.075, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4693, 0.05, 0.07], "rotation": [-0.0, 0.0, -0.14444], "scale": [0.03, 0.1, 0.075]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-foot-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_handle_foot_far_63.add(mesh_handle_foot_far_63);
  meshes["handle-foot-far"] = mesh_handle_foot_far_63;
  colliders["handle-foot-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-foot-far"] ??= [];
  destructionGroups["handle-foot-far"].push(node_handle_foot_far_63);

  const attachment_grip_64 = {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.65, 0.33, 0.0], "localEnd": [0.65, 0.33, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_grip_64 = makeAttachmentEndpoint(attachment_grip_64);
  const node_grip_64 = new THREE.Group();
  node_grip_64.name = "Push grip__pivot";
  node_grip_64.scale.set(1, 1, 1);
  if (endpoint_grip_64) {
    node_grip_64.position.copy(endpoint_grip_64.start);
    node_grip_64.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_grip_64.position.set(0.65, 0.33, 0.0);
    node_grip_64.rotation.set(-0.0, 0.0, -0.0);
  }
  node_grip_64.userData.sculptComponent = {"id": "grip", "name": "Push grip", "level": "macro", "role": "grip", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Push grip: a round wooden bar, a cylinder held by both straps.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.65, 0.33, 0.0], "localEnd": [0.65, 0.33, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.65, 0.33, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_64.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_grip_64);
  nodes["grip"] = node_grip_64;
  const mesh_grip_64Geometry = endpoint_grip_64
    ? new THREE.CylinderGeometry(endpoint_grip_64.endRadius, endpoint_grip_64.baseRadius, endpoint_grip_64.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_grip_64) {
    mesh_grip_64Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_64 = new THREE.Mesh(
    mesh_grip_64Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_64.name = "Push grip";
  if (endpoint_grip_64) {
    mesh_grip_64.position.copy(endpoint_grip_64.midpoint);
    mesh_grip_64.quaternion.copy(endpoint_grip_64.quaternion);
  }
  mesh_grip_64.castShadow = options.castShadow ?? true;
  mesh_grip_64.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_64.userData.sculptComponent = {"id": "grip", "name": "Push grip", "level": "macro", "role": "grip", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Push grip: a round wooden bar, a cylinder held by both straps.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.65, 0.33, 0.0], "localEnd": [0.65, 0.33, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.65, 0.33, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(160, 99, 47, 1.0)", "secondaryAlbedo": "rgba(127, 74, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(127, 74, 34, 1.0)"}, {"position": 1.0, "color": "rgba(160, 99, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_64.add(mesh_grip_64);
  meshes["grip"] = mesh_grip_64;
  colliders["grip"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["grip"] ??= [];
  destructionGroups["grip"].push(node_grip_64);

  const attachment_grip_cap_near_65 = {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.52], "localEnd": [0.0, 0.0, 0.56], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_grip_cap_near_65 = makeAttachmentEndpoint(attachment_grip_cap_near_65);
  const node_grip_cap_near_65 = new THREE.Group();
  node_grip_cap_near_65.name = "Grip end cap (near)__pivot";
  node_grip_cap_near_65.scale.set(1, 1, 1);
  if (endpoint_grip_cap_near_65) {
    node_grip_cap_near_65.position.copy(endpoint_grip_cap_near_65.start);
    node_grip_cap_near_65.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_grip_cap_near_65.position.set(0.0, 0.0, 0.52);
    node_grip_cap_near_65.rotation.set(-0.0, 0.0, -0.0);
  }
  node_grip_cap_near_65.userData.sculptComponent = {"id": "grip-cap-near", "name": "Grip end cap (near)", "level": "micro", "role": "cap", "importance": 0.3, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Grip end cap: a short round iron cap, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "grip", "attachment": {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.52], "localEnd": [0.0, 0.0, 0.56], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.52], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_cap_near_65.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["grip"] ?? root).add(node_grip_cap_near_65);
  nodes["grip-cap-near"] = node_grip_cap_near_65;
  const mesh_grip_cap_near_65Geometry = endpoint_grip_cap_near_65
    ? new THREE.CylinderGeometry(endpoint_grip_cap_near_65.endRadius, endpoint_grip_cap_near_65.baseRadius, endpoint_grip_cap_near_65.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_grip_cap_near_65) {
    mesh_grip_cap_near_65Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_cap_near_65 = new THREE.Mesh(
    mesh_grip_cap_near_65Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_cap_near_65.name = "Grip end cap (near)";
  if (endpoint_grip_cap_near_65) {
    mesh_grip_cap_near_65.position.copy(endpoint_grip_cap_near_65.midpoint);
    mesh_grip_cap_near_65.quaternion.copy(endpoint_grip_cap_near_65.quaternion);
  }
  mesh_grip_cap_near_65.castShadow = options.castShadow ?? true;
  mesh_grip_cap_near_65.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_cap_near_65.userData.sculptComponent = {"id": "grip-cap-near", "name": "Grip end cap (near)", "level": "micro", "role": "cap", "importance": 0.3, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Grip end cap: a short round iron cap, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "grip", "attachment": {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.52], "localEnd": [0.0, 0.0, 0.56], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.52], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_cap_near_65.add(mesh_grip_cap_near_65);
  meshes["grip-cap-near"] = mesh_grip_cap_near_65;
  colliders["grip-cap-near"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["grip-cap-near"] ??= [];
  destructionGroups["grip-cap-near"].push(node_grip_cap_near_65);

  const attachment_grip_cap_far_66 = {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, -0.04], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_grip_cap_far_66 = makeAttachmentEndpoint(attachment_grip_cap_far_66);
  const node_grip_cap_far_66 = new THREE.Group();
  node_grip_cap_far_66.name = "Grip end cap (far)__pivot";
  node_grip_cap_far_66.scale.set(1, 1, 1);
  if (endpoint_grip_cap_far_66) {
    node_grip_cap_far_66.position.copy(endpoint_grip_cap_far_66.start);
    node_grip_cap_far_66.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_grip_cap_far_66.position.set(0.0, 0.0, 0.0);
    node_grip_cap_far_66.rotation.set(-0.0, 0.0, -0.0);
  }
  node_grip_cap_far_66.userData.sculptComponent = {"id": "grip-cap-far", "name": "Grip end cap (far)", "level": "micro", "role": "cap", "importance": 0.3, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Grip end cap: a short round iron cap, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "grip", "attachment": {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, -0.04], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_cap_far_66.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["grip"] ?? root).add(node_grip_cap_far_66);
  nodes["grip-cap-far"] = node_grip_cap_far_66;
  const mesh_grip_cap_far_66Geometry = endpoint_grip_cap_far_66
    ? new THREE.CylinderGeometry(endpoint_grip_cap_far_66.endRadius, endpoint_grip_cap_far_66.baseRadius, endpoint_grip_cap_far_66.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_grip_cap_far_66) {
    mesh_grip_cap_far_66Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_cap_far_66 = new THREE.Mesh(
    mesh_grip_cap_far_66Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_cap_far_66.name = "Grip end cap (far)";
  if (endpoint_grip_cap_far_66) {
    mesh_grip_cap_far_66.position.copy(endpoint_grip_cap_far_66.midpoint);
    mesh_grip_cap_far_66.quaternion.copy(endpoint_grip_cap_far_66.quaternion);
  }
  mesh_grip_cap_far_66.castShadow = options.castShadow ?? true;
  mesh_grip_cap_far_66.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_cap_far_66.userData.sculptComponent = {"id": "grip-cap-far", "name": "Grip end cap (far)", "level": "micro", "role": "cap", "importance": 0.3, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Grip end cap: a short round iron cap, a cylinder.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "grip", "attachment": {"parentId": "grip", "parentSocket": "grip:end", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, -0.04], "baseRadius": 0.05, "endRadius": 0.05, "contactType": "flush", "embedDepth": 0.004, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip-cap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(80, 82, 90, 1.0)", "secondaryAlbedo": "rgba(59, 60, 66, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(59, 60, 66, 1.0)"}, {"position": 1.0, "color": "rgba(80, 82, 90, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_cap_far_66.add(mesh_grip_cap_far_66);
  meshes["grip-cap-far"] = mesh_grip_cap_far_66;
  colliders["grip-cap-far"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["grip-cap-far"] ??= [];
  destructionGroups["grip-cap-far"].push(node_grip_cap_far_66);

  const endpoint_ore_heap_67 = makeAttachmentEndpoint(null);
  const node_ore_heap_67 = new THREE.Group();
  node_ore_heap_67.name = "Ore heap__pivot";
  node_ore_heap_67.scale.set(1, 1, 1);
  if (endpoint_ore_heap_67) {
    node_ore_heap_67.position.copy(endpoint_ore_heap_67.start);
    node_ore_heap_67.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_ore_heap_67.position.set(0.0, 0.53, 0.26);
    node_ore_heap_67.rotation.set(-0.0, 0.0, -0.0);
  }
  node_ore_heap_67.userData.sculptComponent = {"id": "ore-heap", "name": "Ore heap", "level": "macro", "role": "fill", "importance": 0.9, "confidence": 0.75, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "Ore heap: one smooth domed mass of ore filling the tub, an ellipsoid; the nuggets on it carry the faceted read.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.94, "height": 0.36, "depth": 0.66, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.53, 0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [0.94, 0.36, 0.66]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ore-dome", "kind": "contour", "description": "heap rises ~0.25 above the rim, highest near the centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["ore-dome"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "ore"}, "materialRegions": [{"regionId": "gold-ore", "materialId": "ore", "profileId": "metal.gold", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}}]};
  node_ore_heap_67.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["tub-core"] ?? root).add(node_ore_heap_67);
  nodes["ore-heap"] = node_ore_heap_67;
  const mesh_ore_heap_67Geometry = endpoint_ore_heap_67
    ? new THREE.CylinderGeometry(endpoint_ore_heap_67.endRadius, endpoint_ore_heap_67.baseRadius, endpoint_ore_heap_67.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_ore_heap_67) {
    mesh_ore_heap_67Geometry.scale(0.94, 0.36, 0.66);
  }
  const mesh_ore_heap_67 = new THREE.Mesh(
    mesh_ore_heap_67Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ore_heap_67.name = "Ore heap";
  if (endpoint_ore_heap_67) {
    mesh_ore_heap_67.position.copy(endpoint_ore_heap_67.midpoint);
    mesh_ore_heap_67.quaternion.copy(endpoint_ore_heap_67.quaternion);
  }
  mesh_ore_heap_67.castShadow = options.castShadow ?? true;
  mesh_ore_heap_67.receiveShadow = options.receiveShadow ?? true;
  mesh_ore_heap_67.userData.sculptComponent = {"id": "ore-heap", "name": "Ore heap", "level": "macro", "role": "fill", "importance": 0.9, "confidence": 0.75, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "Ore heap: one smooth domed mass of ore filling the tub, an ellipsoid; the nuggets on it carry the faceted read.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.94, "height": 0.36, "depth": 0.66, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.53, 0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [0.94, 0.36, 0.66]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ore-dome", "kind": "contour", "description": "heap rises ~0.25 above the rim, highest near the centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["ore-dome"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "ore"}, "materialRegions": [{"regionId": "gold-ore", "materialId": "ore", "profileId": "metal.gold", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}}]};
  node_ore_heap_67.add(mesh_ore_heap_67);
  meshes["ore-heap"] = mesh_ore_heap_67;
  colliders["ore-heap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["ore-heap"] ??= [];
  destructionGroups["ore-heap"].push(node_ore_heap_67);

  const endpoint_nugget_00_68 = makeAttachmentEndpoint(null);
  const node_nugget_00_68 = new THREE.Group();
  node_nugget_00_68.name = "Ore nugget 1__pivot";
  node_nugget_00_68.scale.set(1, 1, 1);
  if (endpoint_nugget_00_68) {
    node_nugget_00_68.position.copy(endpoint_nugget_00_68.start);
    node_nugget_00_68.rotation.set(-0.0, 0.0, 0.45);
  } else {
    node_nugget_00_68.position.set(0.0, 0.1842, 0.0);
    node_nugget_00_68.rotation.set(-0.0, 0.0, 0.45);
  }
  node_nugget_00_68.userData.sculptComponent = {"id": "nugget-00", "name": "Ore nugget 1", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.252, "height": 0.1995, "depth": 0.2205, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0, 0.1842, 0.0], "rotation": [-0.0, 0.0, 0.45], "scale": [0.252, 0.1995, 0.2205]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-00", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-00-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-00-facets"]};
  node_nugget_00_68.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-00", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_00_68);
  nodes["nugget-00"] = node_nugget_00_68;
  const mesh_nugget_00_68Geometry = endpoint_nugget_00_68
    ? new THREE.CylinderGeometry(endpoint_nugget_00_68.endRadius, endpoint_nugget_00_68.baseRadius, endpoint_nugget_00_68.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_00_68) {
    mesh_nugget_00_68Geometry.scale(0.252, 0.1995, 0.2205);
  }
  const mesh_nugget_00_68 = new THREE.Mesh(
    mesh_nugget_00_68Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_00_68.name = "Ore nugget 1";
  if (endpoint_nugget_00_68) {
    mesh_nugget_00_68.position.copy(endpoint_nugget_00_68.midpoint);
    mesh_nugget_00_68.quaternion.copy(endpoint_nugget_00_68.quaternion);
  }
  mesh_nugget_00_68.castShadow = options.castShadow ?? true;
  mesh_nugget_00_68.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_00_68.userData.sculptComponent = {"id": "nugget-00", "name": "Ore nugget 1", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.252, "height": 0.1995, "depth": 0.2205, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0, 0.1842, 0.0], "rotation": [-0.0, 0.0, 0.45], "scale": [0.252, 0.1995, 0.2205]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-00", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-00-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-00-facets"]};
  node_nugget_00_68.add(mesh_nugget_00_68);
  meshes["nugget-00"] = mesh_nugget_00_68;
  colliders["nugget-00"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-00"] ??= [];
  destructionGroups["nugget-00"].push(node_nugget_00_68);

  const endpoint_nugget_01_69 = makeAttachmentEndpoint(null);
  const node_nugget_01_69 = new THREE.Group();
  node_nugget_01_69.name = "Ore nugget 2__pivot";
  node_nugget_01_69.scale.set(1, 1, 1);
  if (endpoint_nugget_01_69) {
    node_nugget_01_69.position.copy(endpoint_nugget_01_69.start);
    node_nugget_01_69.rotation.set(0.45544, 0.44506, -0.04412);
  } else {
    node_nugget_01_69.position.set(0.1634, 0.1475, 0.0307);
    node_nugget_01_69.rotation.set(0.45544, 0.44506, -0.04412);
  }
  node_nugget_01_69.userData.sculptComponent = {"id": "nugget-01", "name": "Ore nugget 2", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2373, "height": 0.1879, "depth": 0.2077, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1634, 0.1475, 0.0307], "rotation": [0.45544, 0.44506, -0.04412], "scale": [0.2373, 0.1879, 0.2077]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-01", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-01-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-01-facets"]};
  node_nugget_01_69.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-01", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_01_69);
  nodes["nugget-01"] = node_nugget_01_69;
  const mesh_nugget_01_69Geometry = endpoint_nugget_01_69
    ? new THREE.CylinderGeometry(endpoint_nugget_01_69.endRadius, endpoint_nugget_01_69.baseRadius, endpoint_nugget_01_69.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_01_69) {
    mesh_nugget_01_69Geometry.scale(0.2373, 0.1879, 0.2077);
  }
  const mesh_nugget_01_69 = new THREE.Mesh(
    mesh_nugget_01_69Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_01_69.name = "Ore nugget 2";
  if (endpoint_nugget_01_69) {
    mesh_nugget_01_69.position.copy(endpoint_nugget_01_69.midpoint);
    mesh_nugget_01_69.quaternion.copy(endpoint_nugget_01_69.quaternion);
  }
  mesh_nugget_01_69.castShadow = options.castShadow ?? true;
  mesh_nugget_01_69.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_01_69.userData.sculptComponent = {"id": "nugget-01", "name": "Ore nugget 2", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2373, "height": 0.1879, "depth": 0.2077, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1634, 0.1475, 0.0307], "rotation": [0.45544, 0.44506, -0.04412], "scale": [0.2373, 0.1879, 0.2077]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-01", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-01-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-01-facets"]};
  node_nugget_01_69.add(mesh_nugget_01_69);
  meshes["nugget-01"] = mesh_nugget_01_69;
  colliders["nugget-01"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-01"] ??= [];
  destructionGroups["nugget-01"].push(node_nugget_01_69);

  const endpoint_nugget_02_70 = makeAttachmentEndpoint(null);
  const node_nugget_02_70 = new THREE.Group();
  node_nugget_02_70.name = "Ore nugget 3__pivot";
  node_nugget_02_70.scale.set(1, 1, 1);
  if (endpoint_nugget_02_70) {
    node_nugget_02_70.position.copy(endpoint_nugget_02_70.start);
    node_nugget_02_70.rotation.set(2.68616, 0.9163, -2.77582);
  } else {
    node_nugget_02_70.position.set(0.0438, 0.1647, 0.1148);
    node_nugget_02_70.rotation.set(2.68616, 0.9163, -2.77582);
  }
  node_nugget_02_70.userData.sculptComponent = {"id": "nugget-02", "name": "Ore nugget 3", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.198, "height": 0.1568, "depth": 0.1733, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0438, 0.1647, 0.1148], "rotation": [2.68616, 0.9163, -2.77582], "scale": [0.198, 0.1568, 0.1733]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-02", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-02-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-02-facets"]};
  node_nugget_02_70.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-02", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_02_70);
  nodes["nugget-02"] = node_nugget_02_70;
  const mesh_nugget_02_70Geometry = endpoint_nugget_02_70
    ? new THREE.CylinderGeometry(endpoint_nugget_02_70.endRadius, endpoint_nugget_02_70.baseRadius, endpoint_nugget_02_70.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_02_70) {
    mesh_nugget_02_70Geometry.scale(0.198, 0.1568, 0.1733);
  }
  const mesh_nugget_02_70 = new THREE.Mesh(
    mesh_nugget_02_70Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_02_70.name = "Ore nugget 3";
  if (endpoint_nugget_02_70) {
    mesh_nugget_02_70.position.copy(endpoint_nugget_02_70.midpoint);
    mesh_nugget_02_70.quaternion.copy(endpoint_nugget_02_70.quaternion);
  }
  mesh_nugget_02_70.castShadow = options.castShadow ?? true;
  mesh_nugget_02_70.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_02_70.userData.sculptComponent = {"id": "nugget-02", "name": "Ore nugget 3", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.198, "height": 0.1568, "depth": 0.1733, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0438, 0.1647, 0.1148], "rotation": [2.68616, 0.9163, -2.77582], "scale": [0.198, 0.1568, 0.1733]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-02", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-02-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-02-facets"]};
  node_nugget_02_70.add(mesh_nugget_02_70);
  meshes["nugget-02"] = mesh_nugget_02_70;
  colliders["nugget-02"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-02"] ??= [];
  destructionGroups["nugget-02"].push(node_nugget_02_70);

  const endpoint_nugget_03_71 = makeAttachmentEndpoint(null);
  const node_nugget_03_71 = new THREE.Group();
  node_nugget_03_71.name = "Ore nugget 4__pivot";
  node_nugget_03_71.scale.set(1, 1, 1);
  if (endpoint_nugget_03_71) {
    node_nugget_03_71.position.copy(endpoint_nugget_03_71.start);
    node_nugget_03_71.rotation.set(-2.68616, -0.86394, -2.7317);
  } else {
    node_nugget_03_71.position.set(-0.1196, 0.1711, 0.084);
    node_nugget_03_71.rotation.set(-2.68616, -0.86394, -2.7317);
  }
  node_nugget_03_71.userData.sculptComponent = {"id": "nugget-03", "name": "Ore nugget 4", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1887, "height": 0.1494, "depth": 0.1651, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1196, 0.1711, 0.084], "rotation": [-2.68616, -0.86394, -2.7317], "scale": [0.1887, 0.1494, 0.1651]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-03", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-03-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-03-facets"]};
  node_nugget_03_71.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-03", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_03_71);
  nodes["nugget-03"] = node_nugget_03_71;
  const mesh_nugget_03_71Geometry = endpoint_nugget_03_71
    ? new THREE.CylinderGeometry(endpoint_nugget_03_71.endRadius, endpoint_nugget_03_71.baseRadius, endpoint_nugget_03_71.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_03_71) {
    mesh_nugget_03_71Geometry.scale(0.1887, 0.1494, 0.1651);
  }
  const mesh_nugget_03_71 = new THREE.Mesh(
    mesh_nugget_03_71Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_03_71.name = "Ore nugget 4";
  if (endpoint_nugget_03_71) {
    mesh_nugget_03_71.position.copy(endpoint_nugget_03_71.midpoint);
    mesh_nugget_03_71.quaternion.copy(endpoint_nugget_03_71.quaternion);
  }
  mesh_nugget_03_71.castShadow = options.castShadow ?? true;
  mesh_nugget_03_71.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_03_71.userData.sculptComponent = {"id": "nugget-03", "name": "Ore nugget 4", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1887, "height": 0.1494, "depth": 0.1651, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1196, 0.1711, 0.084], "rotation": [-2.68616, -0.86394, -2.7317], "scale": [0.1887, 0.1494, 0.1651]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-03", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-03-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-03-facets"]};
  node_nugget_03_71.add(mesh_nugget_03_71);
  meshes["nugget-03"] = mesh_nugget_03_71;
  colliders["nugget-03"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-03"] ??= [];
  destructionGroups["nugget-03"].push(node_nugget_03_71);

  const endpoint_nugget_04_72 = makeAttachmentEndpoint(null);
  const node_nugget_04_72 = new THREE.Group();
  node_nugget_04_72.name = "Ore nugget 5__pivot";
  node_nugget_04_72.scale.set(1, 1, 1);
  if (endpoint_nugget_04_72) {
    node_nugget_04_72.position.copy(endpoint_nugget_04_72.start);
    node_nugget_04_72.rotation.set(-0.45544, -0.49742, 0.04412);
  } else {
    node_nugget_04_72.position.set(-0.1634, 0.1716, -0.0307);
    node_nugget_04_72.rotation.set(-0.45544, -0.49742, 0.04412);
  }
  node_nugget_04_72.userData.sculptComponent = {"id": "nugget-04", "name": "Ore nugget 5", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2187, "height": 0.1731, "depth": 0.1913, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1634, 0.1716, -0.0307], "rotation": [-0.45544, -0.49742, 0.04412], "scale": [0.2187, 0.1731, 0.1913]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-04", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-04-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-04-facets"]};
  node_nugget_04_72.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-04", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_04_72);
  nodes["nugget-04"] = node_nugget_04_72;
  const mesh_nugget_04_72Geometry = endpoint_nugget_04_72
    ? new THREE.CylinderGeometry(endpoint_nugget_04_72.endRadius, endpoint_nugget_04_72.baseRadius, endpoint_nugget_04_72.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_04_72) {
    mesh_nugget_04_72Geometry.scale(0.2187, 0.1731, 0.1913);
  }
  const mesh_nugget_04_72 = new THREE.Mesh(
    mesh_nugget_04_72Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_04_72.name = "Ore nugget 5";
  if (endpoint_nugget_04_72) {
    mesh_nugget_04_72.position.copy(endpoint_nugget_04_72.midpoint);
    mesh_nugget_04_72.quaternion.copy(endpoint_nugget_04_72.quaternion);
  }
  mesh_nugget_04_72.castShadow = options.castShadow ?? true;
  mesh_nugget_04_72.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_04_72.userData.sculptComponent = {"id": "nugget-04", "name": "Ore nugget 5", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2187, "height": 0.1731, "depth": 0.1913, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1634, 0.1716, -0.0307], "rotation": [-0.45544, -0.49742, 0.04412], "scale": [0.2187, 0.1731, 0.1913]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-04", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-04-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-04-facets"]};
  node_nugget_04_72.add(mesh_nugget_04_72);
  meshes["nugget-04"] = mesh_nugget_04_72;
  colliders["nugget-04"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-04"] ??= [];
  destructionGroups["nugget-04"].push(node_nugget_04_72);

  const endpoint_nugget_05_73 = makeAttachmentEndpoint(null);
  const node_nugget_05_73 = new THREE.Group();
  node_nugget_05_73.name = "Ore nugget 6__pivot";
  node_nugget_05_73.scale.set(1, 1, 1);
  if (endpoint_nugget_05_73) {
    node_nugget_05_73.position.copy(endpoint_nugget_05_73.start);
    node_nugget_05_73.rotation.set(0.45544, 1.28282, -0.36577);
  } else {
    node_nugget_05_73.position.set(-0.0438, 0.1722, -0.1148);
    node_nugget_05_73.rotation.set(0.45544, 1.28282, -0.36577);
  }
  node_nugget_05_73.userData.sculptComponent = {"id": "nugget-05", "name": "Ore nugget 6", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.258, "height": 0.2042, "depth": 0.2257, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.0438, 0.1722, -0.1148], "rotation": [0.45544, 1.28282, -0.36577], "scale": [0.258, 0.2042, 0.2257]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-05", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-05-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-05-facets"]};
  node_nugget_05_73.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-05", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_05_73);
  nodes["nugget-05"] = node_nugget_05_73;
  const mesh_nugget_05_73Geometry = endpoint_nugget_05_73
    ? new THREE.CylinderGeometry(endpoint_nugget_05_73.endRadius, endpoint_nugget_05_73.baseRadius, endpoint_nugget_05_73.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_05_73) {
    mesh_nugget_05_73Geometry.scale(0.258, 0.2042, 0.2257);
  }
  const mesh_nugget_05_73 = new THREE.Mesh(
    mesh_nugget_05_73Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_05_73.name = "Ore nugget 6";
  if (endpoint_nugget_05_73) {
    mesh_nugget_05_73.position.copy(endpoint_nugget_05_73.midpoint);
    mesh_nugget_05_73.quaternion.copy(endpoint_nugget_05_73.quaternion);
  }
  mesh_nugget_05_73.castShadow = options.castShadow ?? true;
  mesh_nugget_05_73.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_05_73.userData.sculptComponent = {"id": "nugget-05", "name": "Ore nugget 6", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.258, "height": 0.2042, "depth": 0.2257, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.0438, 0.1722, -0.1148], "rotation": [0.45544, 1.28282, -0.36577], "scale": [0.258, 0.2042, 0.2257]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-05", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-05-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-05-facets"]};
  node_nugget_05_73.add(mesh_nugget_05_73);
  meshes["nugget-05"] = mesh_nugget_05_73;
  colliders["nugget-05"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-05"] ??= [];
  destructionGroups["nugget-05"].push(node_nugget_05_73);

  const endpoint_nugget_06_74 = makeAttachmentEndpoint(null);
  const node_nugget_06_74 = new THREE.Group();
  node_nugget_06_74.name = "Ore nugget 7__pivot";
  node_nugget_06_74.scale.set(1, 1, 1);
  if (endpoint_nugget_06_74) {
    node_nugget_06_74.position.copy(endpoint_nugget_06_74.start);
    node_nugget_06_74.rotation.set(2.68616, 0.07854, 2.7317);
  } else {
    node_nugget_06_74.position.set(0.1196, 0.1546, -0.084);
    node_nugget_06_74.rotation.set(2.68616, 0.07854, 2.7317);
  }
  node_nugget_06_74.userData.sculptComponent = {"id": "nugget-06", "name": "Ore nugget 7", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2673, "height": 0.2116, "depth": 0.2339, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1196, 0.1546, -0.084], "rotation": [2.68616, 0.07854, 2.7317], "scale": [0.2673, 0.2116, 0.2339]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-06", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-06-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-06-facets"]};
  node_nugget_06_74.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-06", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_06_74);
  nodes["nugget-06"] = node_nugget_06_74;
  const mesh_nugget_06_74Geometry = endpoint_nugget_06_74
    ? new THREE.CylinderGeometry(endpoint_nugget_06_74.endRadius, endpoint_nugget_06_74.baseRadius, endpoint_nugget_06_74.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_06_74) {
    mesh_nugget_06_74Geometry.scale(0.2673, 0.2116, 0.2339);
  }
  const mesh_nugget_06_74 = new THREE.Mesh(
    mesh_nugget_06_74Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_06_74.name = "Ore nugget 7";
  if (endpoint_nugget_06_74) {
    mesh_nugget_06_74.position.copy(endpoint_nugget_06_74.midpoint);
    mesh_nugget_06_74.quaternion.copy(endpoint_nugget_06_74.quaternion);
  }
  mesh_nugget_06_74.castShadow = options.castShadow ?? true;
  mesh_nugget_06_74.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_06_74.userData.sculptComponent = {"id": "nugget-06", "name": "Ore nugget 7", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2673, "height": 0.2116, "depth": 0.2339, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1196, 0.1546, -0.084], "rotation": [2.68616, 0.07854, 2.7317], "scale": [0.2673, 0.2116, 0.2339]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-06", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-06-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-06-facets"]};
  node_nugget_06_74.add(mesh_nugget_06_74);
  meshes["nugget-06"] = mesh_nugget_06_74;
  colliders["nugget-06"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-06"] ??= [];
  destructionGroups["nugget-06"].push(node_nugget_06_74);

  const endpoint_nugget_07_75 = makeAttachmentEndpoint(null);
  const node_nugget_07_75 = new THREE.Group();
  node_nugget_07_75.name = "Ore nugget 8__pivot";
  node_nugget_07_75.scale.set(1, 1, 1);
  if (endpoint_nugget_07_75) {
    node_nugget_07_75.position.copy(endpoint_nugget_07_75.start);
    node_nugget_07_75.rotation.set(0.39835, 0.14835, 0.20559);
  } else {
    node_nugget_07_75.position.set(0.309, 0.0927, 0.019);
    node_nugget_07_75.rotation.set(0.39835, 0.14835, 0.20559);
  }
  node_nugget_07_75.userData.sculptComponent = {"id": "nugget-07", "name": "Ore nugget 8", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2101, "height": 0.1663, "depth": 0.1838, "units": "object", "confidence": 0.6}, "transform": {"position": [0.309, 0.0927, 0.019], "rotation": [0.39835, 0.14835, 0.20559], "scale": [0.2101, 0.1663, 0.1838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-07", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-07-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-07-facets"]};
  node_nugget_07_75.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-07", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_07_75);
  nodes["nugget-07"] = node_nugget_07_75;
  const mesh_nugget_07_75Geometry = endpoint_nugget_07_75
    ? new THREE.CylinderGeometry(endpoint_nugget_07_75.endRadius, endpoint_nugget_07_75.baseRadius, endpoint_nugget_07_75.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_07_75) {
    mesh_nugget_07_75Geometry.scale(0.2101, 0.1663, 0.1838);
  }
  const mesh_nugget_07_75 = new THREE.Mesh(
    mesh_nugget_07_75Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_07_75.name = "Ore nugget 8";
  if (endpoint_nugget_07_75) {
    mesh_nugget_07_75.position.copy(endpoint_nugget_07_75.midpoint);
    mesh_nugget_07_75.quaternion.copy(endpoint_nugget_07_75.quaternion);
  }
  mesh_nugget_07_75.castShadow = options.castShadow ?? true;
  mesh_nugget_07_75.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_07_75.userData.sculptComponent = {"id": "nugget-07", "name": "Ore nugget 8", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2101, "height": 0.1663, "depth": 0.1838, "units": "object", "confidence": 0.6}, "transform": {"position": [0.309, 0.0927, 0.019], "rotation": [0.39835, 0.14835, 0.20559], "scale": [0.2101, 0.1663, 0.1838]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-07", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-07-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-07-facets"]};
  node_nugget_07_75.add(mesh_nugget_07_75);
  meshes["nugget-07"] = mesh_nugget_07_75;
  colliders["nugget-07"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-07"] ??= [];
  destructionGroups["nugget-07"].push(node_nugget_07_75);

  const endpoint_nugget_08_76 = makeAttachmentEndpoint(null);
  const node_nugget_08_76 = new THREE.Group();
  node_nugget_08_76.name = "Ore nugget 9__pivot";
  node_nugget_08_76.scale.set(1, 1, 1);
  if (endpoint_nugget_08_76) {
    node_nugget_08_76.position.copy(endpoint_nugget_08_76.start);
    node_nugget_08_76.rotation.set(0.06253, 1.33518, -0.05628);
  } else {
    node_nugget_08_76.position.set(0.2193, 0.1063, 0.154);
    node_nugget_08_76.rotation.set(0.06253, 1.33518, -0.05628);
  }
  node_nugget_08_76.userData.sculptComponent = {"id": "nugget-08", "name": "Ore nugget 9", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2241, "height": 0.1774, "depth": 0.1961, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2193, 0.1063, 0.154], "rotation": [0.06253, 1.33518, -0.05628], "scale": [0.2241, 0.1774, 0.1961]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-08", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-08-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-08-facets"]};
  node_nugget_08_76.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-08", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_08_76);
  nodes["nugget-08"] = node_nugget_08_76;
  const mesh_nugget_08_76Geometry = endpoint_nugget_08_76
    ? new THREE.CylinderGeometry(endpoint_nugget_08_76.endRadius, endpoint_nugget_08_76.baseRadius, endpoint_nugget_08_76.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_08_76) {
    mesh_nugget_08_76Geometry.scale(0.2241, 0.1774, 0.1961);
  }
  const mesh_nugget_08_76 = new THREE.Mesh(
    mesh_nugget_08_76Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_08_76.name = "Ore nugget 9";
  if (endpoint_nugget_08_76) {
    mesh_nugget_08_76.position.copy(endpoint_nugget_08_76.midpoint);
    mesh_nugget_08_76.quaternion.copy(endpoint_nugget_08_76.quaternion);
  }
  mesh_nugget_08_76.castShadow = options.castShadow ?? true;
  mesh_nugget_08_76.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_08_76.userData.sculptComponent = {"id": "nugget-08", "name": "Ore nugget 9", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2241, "height": 0.1774, "depth": 0.1961, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2193, 0.1063, 0.154], "rotation": [0.06253, 1.33518, -0.05628], "scale": [0.2241, 0.1774, 0.1961]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-08", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-08-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-08-facets"]};
  node_nugget_08_76.add(mesh_nugget_08_76);
  meshes["nugget-08"] = mesh_nugget_08_76;
  colliders["nugget-08"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-08"] ??= [];
  destructionGroups["nugget-08"].push(node_nugget_08_76);

  const endpoint_nugget_09_77 = makeAttachmentEndpoint(null);
  const node_nugget_09_77 = new THREE.Group();
  node_nugget_09_77.name = "Ore nugget 10__pivot";
  node_nugget_09_77.scale.set(1, 1, 1);
  if (endpoint_nugget_09_77) {
    node_nugget_09_77.position.copy(endpoint_nugget_09_77.start);
    node_nugget_09_77.rotation.set(2.68071, 0.61959, 3.04178);
  } else {
    node_nugget_09_77.position.set(0.027, 0.1343, 0.217);
    node_nugget_09_77.rotation.set(2.68071, 0.61959, 3.04178);
  }
  node_nugget_09_77.userData.sculptComponent = {"id": "nugget-09", "name": "Ore nugget 10", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1851, "height": 0.1465, "depth": 0.1619, "units": "object", "confidence": 0.6}, "transform": {"position": [0.027, 0.1343, 0.217], "rotation": [2.68071, 0.61959, 3.04178], "scale": [0.1851, 0.1465, 0.1619]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-09", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-09-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-09-facets"]};
  node_nugget_09_77.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-09", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_09_77);
  nodes["nugget-09"] = node_nugget_09_77;
  const mesh_nugget_09_77Geometry = endpoint_nugget_09_77
    ? new THREE.CylinderGeometry(endpoint_nugget_09_77.endRadius, endpoint_nugget_09_77.baseRadius, endpoint_nugget_09_77.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_09_77) {
    mesh_nugget_09_77Geometry.scale(0.1851, 0.1465, 0.1619);
  }
  const mesh_nugget_09_77 = new THREE.Mesh(
    mesh_nugget_09_77Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_09_77.name = "Ore nugget 10";
  if (endpoint_nugget_09_77) {
    mesh_nugget_09_77.position.copy(endpoint_nugget_09_77.midpoint);
    mesh_nugget_09_77.quaternion.copy(endpoint_nugget_09_77.quaternion);
  }
  mesh_nugget_09_77.castShadow = options.castShadow ?? true;
  mesh_nugget_09_77.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_09_77.userData.sculptComponent = {"id": "nugget-09", "name": "Ore nugget 10", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1851, "height": 0.1465, "depth": 0.1619, "units": "object", "confidence": 0.6}, "transform": {"position": [0.027, 0.1343, 0.217], "rotation": [2.68071, 0.61959, 3.04178], "scale": [0.1851, 0.1465, 0.1619]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-09", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-09-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-09-facets"]};
  node_nugget_09_77.add(mesh_nugget_09_77);
  meshes["nugget-09"] = mesh_nugget_09_77;
  colliders["nugget-09"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-09"] ??= [];
  destructionGroups["nugget-09"].push(node_nugget_09_77);

  const endpoint_nugget_10_78 = makeAttachmentEndpoint(null);
  const node_nugget_10_78 = new THREE.Group();
  node_nugget_10_78.name = "Ore nugget 11__pivot";
  node_nugget_10_78.scale.set(1, 1, 1);
  if (endpoint_nugget_10_78) {
    node_nugget_10_78.position.copy(endpoint_nugget_10_78.start);
    node_nugget_10_78.rotation.set(-2.74325, -0.56723, -2.89772);
  } else {
    node_nugget_10_78.position.set(-0.1779, 0.1379, 0.1784);
    node_nugget_10_78.rotation.set(-2.74325, -0.56723, -2.89772);
  }
  node_nugget_10_78.userData.sculptComponent = {"id": "nugget-10", "name": "Ore nugget 11", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1575, "height": 0.1247, "depth": 0.1378, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1779, 0.1379, 0.1784], "rotation": [-2.74325, -0.56723, -2.89772], "scale": [0.1575, 0.1247, 0.1378]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-10-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-10-facets"]};
  node_nugget_10_78.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_10_78);
  nodes["nugget-10"] = node_nugget_10_78;
  const mesh_nugget_10_78Geometry = endpoint_nugget_10_78
    ? new THREE.CylinderGeometry(endpoint_nugget_10_78.endRadius, endpoint_nugget_10_78.baseRadius, endpoint_nugget_10_78.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_10_78) {
    mesh_nugget_10_78Geometry.scale(0.1575, 0.1247, 0.1378);
  }
  const mesh_nugget_10_78 = new THREE.Mesh(
    mesh_nugget_10_78Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_10_78.name = "Ore nugget 11";
  if (endpoint_nugget_10_78) {
    mesh_nugget_10_78.position.copy(endpoint_nugget_10_78.midpoint);
    mesh_nugget_10_78.quaternion.copy(endpoint_nugget_10_78.quaternion);
  }
  mesh_nugget_10_78.castShadow = options.castShadow ?? true;
  mesh_nugget_10_78.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_10_78.userData.sculptComponent = {"id": "nugget-10", "name": "Ore nugget 11", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1575, "height": 0.1247, "depth": 0.1378, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1779, 0.1379, 0.1784], "rotation": [-2.74325, -0.56723, -2.89772], "scale": [0.1575, 0.1247, 0.1378]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-10", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-10-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-10-facets"]};
  node_nugget_10_78.add(mesh_nugget_10_78);
  meshes["nugget-10"] = mesh_nugget_10_78;
  colliders["nugget-10"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-10"] ??= [];
  destructionGroups["nugget-10"].push(node_nugget_10_78);

  const endpoint_nugget_11_79 = makeAttachmentEndpoint(null);
  const node_nugget_11_79 = new THREE.Group();
  node_nugget_11_79.name = "Ore nugget 12__pivot";
  node_nugget_11_79.scale.set(1, 1, 1);
  if (endpoint_nugget_11_79) {
    node_nugget_11_79.position.copy(endpoint_nugget_11_79.start);
    node_nugget_11_79.rotation.set(0.06253, -1.38754, -0.35851);
  } else {
    node_nugget_11_79.position.set(-0.2996, 0.1383, 0.0564);
    node_nugget_11_79.rotation.set(0.06253, -1.38754, -0.35851);
  }
  node_nugget_11_79.userData.sculptComponent = {"id": "nugget-11", "name": "Ore nugget 12", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1869, "height": 0.148, "depth": 0.1636, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2996, 0.1383, 0.0564], "rotation": [0.06253, -1.38754, -0.35851], "scale": [0.1869, 0.148, 0.1636]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-11-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-11-facets"]};
  node_nugget_11_79.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_11_79);
  nodes["nugget-11"] = node_nugget_11_79;
  const mesh_nugget_11_79Geometry = endpoint_nugget_11_79
    ? new THREE.CylinderGeometry(endpoint_nugget_11_79.endRadius, endpoint_nugget_11_79.baseRadius, endpoint_nugget_11_79.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_11_79) {
    mesh_nugget_11_79Geometry.scale(0.1869, 0.148, 0.1636);
  }
  const mesh_nugget_11_79 = new THREE.Mesh(
    mesh_nugget_11_79Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_11_79.name = "Ore nugget 12";
  if (endpoint_nugget_11_79) {
    mesh_nugget_11_79.position.copy(endpoint_nugget_11_79.midpoint);
    mesh_nugget_11_79.quaternion.copy(endpoint_nugget_11_79.quaternion);
  }
  mesh_nugget_11_79.castShadow = options.castShadow ?? true;
  mesh_nugget_11_79.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_11_79.userData.sculptComponent = {"id": "nugget-11", "name": "Ore nugget 12", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1869, "height": 0.148, "depth": 0.1636, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2996, 0.1383, 0.0564], "rotation": [0.06253, -1.38754, -0.35851], "scale": [0.1869, 0.148, 0.1636]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-11", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-11-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-11-facets"]};
  node_nugget_11_79.add(mesh_nugget_11_79);
  meshes["nugget-11"] = mesh_nugget_11_79;
  colliders["nugget-11"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-11"] ??= [];
  destructionGroups["nugget-11"].push(node_nugget_11_79);

  const endpoint_nugget_12_80 = makeAttachmentEndpoint(null);
  const node_nugget_12_80 = new THREE.Group();
  node_nugget_12_80.name = "Ore nugget 13__pivot";
  node_nugget_12_80.scale.set(1, 1, 1);
  if (endpoint_nugget_12_80) {
    node_nugget_12_80.position.copy(endpoint_nugget_12_80.start);
    node_nugget_12_80.rotation.set(-0.46088, -0.20071, 0.42991);
  } else {
    node_nugget_12_80.position.set(-0.2811, 0.139, -0.092);
    node_nugget_12_80.rotation.set(-0.46088, -0.20071, 0.42991);
  }
  node_nugget_12_80.userData.sculptComponent = {"id": "nugget-12", "name": "Ore nugget 13", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2248, "height": 0.178, "depth": 0.1967, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2811, 0.139, -0.092], "rotation": [-0.46088, -0.20071, 0.42991], "scale": [0.2248, 0.178, 0.1967]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-12-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-12-facets"]};
  node_nugget_12_80.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_12_80);
  nodes["nugget-12"] = node_nugget_12_80;
  const mesh_nugget_12_80Geometry = endpoint_nugget_12_80
    ? new THREE.CylinderGeometry(endpoint_nugget_12_80.endRadius, endpoint_nugget_12_80.baseRadius, endpoint_nugget_12_80.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_12_80) {
    mesh_nugget_12_80Geometry.scale(0.2248, 0.178, 0.1967);
  }
  const mesh_nugget_12_80 = new THREE.Mesh(
    mesh_nugget_12_80Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_12_80.name = "Ore nugget 13";
  if (endpoint_nugget_12_80) {
    mesh_nugget_12_80.position.copy(endpoint_nugget_12_80.midpoint);
    mesh_nugget_12_80.quaternion.copy(endpoint_nugget_12_80.quaternion);
  }
  mesh_nugget_12_80.castShadow = options.castShadow ?? true;
  mesh_nugget_12_80.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_12_80.userData.sculptComponent = {"id": "nugget-12", "name": "Ore nugget 13", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2248, "height": 0.178, "depth": 0.1967, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2811, 0.139, -0.092], "rotation": [-0.46088, -0.20071, 0.42991], "scale": [0.2248, 0.178, 0.1967]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-12", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-12-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-12-facets"]};
  node_nugget_12_80.add(mesh_nugget_12_80);
  meshes["nugget-12"] = mesh_nugget_12_80;
  colliders["nugget-12"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-12"] ??= [];
  destructionGroups["nugget-12"].push(node_nugget_12_80);

  const endpoint_nugget_13_81 = makeAttachmentEndpoint(null);
  const node_nugget_13_81 = new THREE.Group();
  node_nugget_13_81.name = "Ore nugget 14__pivot";
  node_nugget_13_81.scale.set(1, 1, 1);
  if (endpoint_nugget_13_81) {
    node_nugget_13_81.position.copy(endpoint_nugget_13_81.start);
    node_nugget_13_81.rotation.set(0.39835, 0.98611, -0.44946);
  } else {
    node_nugget_13_81.position.set(-0.1311, 0.1387, -0.1974);
    node_nugget_13_81.rotation.set(0.39835, 0.98611, -0.44946);
  }
  node_nugget_13_81.userData.sculptComponent = {"id": "nugget-13", "name": "Ore nugget 14", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2085, "height": 0.165, "depth": 0.1824, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1311, 0.1387, -0.1974], "rotation": [0.39835, 0.98611, -0.44946], "scale": [0.2085, 0.165, 0.1824]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-13-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-13-facets"]};
  node_nugget_13_81.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_13_81);
  nodes["nugget-13"] = node_nugget_13_81;
  const mesh_nugget_13_81Geometry = endpoint_nugget_13_81
    ? new THREE.CylinderGeometry(endpoint_nugget_13_81.endRadius, endpoint_nugget_13_81.baseRadius, endpoint_nugget_13_81.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_13_81) {
    mesh_nugget_13_81Geometry.scale(0.2085, 0.165, 0.1824);
  }
  const mesh_nugget_13_81 = new THREE.Mesh(
    mesh_nugget_13_81Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_13_81.name = "Ore nugget 14";
  if (endpoint_nugget_13_81) {
    mesh_nugget_13_81.position.copy(endpoint_nugget_13_81.midpoint);
    mesh_nugget_13_81.quaternion.copy(endpoint_nugget_13_81.quaternion);
  }
  mesh_nugget_13_81.castShadow = options.castShadow ?? true;
  mesh_nugget_13_81.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_13_81.userData.sculptComponent = {"id": "nugget-13", "name": "Ore nugget 14", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.2085, "height": 0.165, "depth": 0.1824, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1311, 0.1387, -0.1974], "rotation": [0.39835, 0.98611, -0.44946], "scale": [0.2085, 0.165, 0.1824]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-13", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-13-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-13-facets"]};
  node_nugget_13_81.add(mesh_nugget_13_81);
  meshes["nugget-13"] = mesh_nugget_13_81;
  colliders["nugget-13"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-13"] ??= [];
  destructionGroups["nugget-13"].push(node_nugget_13_81);

  const endpoint_nugget_14_82 = makeAttachmentEndpoint(null);
  const node_nugget_14_82 = new THREE.Group();
  node_nugget_14_82.name = "Ore nugget 15__pivot";
  node_nugget_14_82.scale.set(1, 1, 1);
  if (endpoint_nugget_14_82) {
    node_nugget_14_82.position.copy(endpoint_nugget_14_82.start);
    node_nugget_14_82.rotation.set(-3.07906, 0.96866, -2.7268);
  } else {
    node_nugget_14_82.position.set(0.0803, 0.126, -0.2104);
    node_nugget_14_82.rotation.set(-3.07906, 0.96866, -2.7268);
  }
  node_nugget_14_82.userData.sculptComponent = {"id": "nugget-14", "name": "Ore nugget 15", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1649, "height": 0.1306, "depth": 0.1443, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0803, 0.126, -0.2104], "rotation": [-3.07906, 0.96866, -2.7268], "scale": [0.1649, 0.1306, 0.1443]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-14-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-14-facets"]};
  node_nugget_14_82.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_14_82);
  nodes["nugget-14"] = node_nugget_14_82;
  const mesh_nugget_14_82Geometry = endpoint_nugget_14_82
    ? new THREE.CylinderGeometry(endpoint_nugget_14_82.endRadius, endpoint_nugget_14_82.baseRadius, endpoint_nugget_14_82.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_14_82) {
    mesh_nugget_14_82Geometry.scale(0.1649, 0.1306, 0.1443);
  }
  const mesh_nugget_14_82 = new THREE.Mesh(
    mesh_nugget_14_82Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_14_82.name = "Ore nugget 15";
  if (endpoint_nugget_14_82) {
    mesh_nugget_14_82.position.copy(endpoint_nugget_14_82.midpoint);
    mesh_nugget_14_82.quaternion.copy(endpoint_nugget_14_82.quaternion);
  }
  mesh_nugget_14_82.castShadow = options.castShadow ?? true;
  mesh_nugget_14_82.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_14_82.userData.sculptComponent = {"id": "nugget-14", "name": "Ore nugget 15", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1649, "height": 0.1306, "depth": 0.1443, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0803, 0.126, -0.2104], "rotation": [-3.07906, 0.96866, -2.7268], "scale": [0.1649, 0.1306, 0.1443]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-14", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-14-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-14-facets"]};
  node_nugget_14_82.add(mesh_nugget_14_82);
  meshes["nugget-14"] = mesh_nugget_14_82;
  colliders["nugget-14"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-14"] ??= [];
  destructionGroups["nugget-14"].push(node_nugget_14_82);

  const endpoint_nugget_15_83 = makeAttachmentEndpoint(null);
  const node_nugget_15_83 = new THREE.Group();
  node_nugget_15_83.name = "Ore nugget 16__pivot";
  node_nugget_15_83.scale.set(1, 1, 1);
  if (endpoint_nugget_15_83) {
    node_nugget_15_83.position.copy(endpoint_nugget_15_83.start);
    node_nugget_15_83.rotation.set(2.68071, -0.21817, 2.8115);
  } else {
    node_nugget_15_83.position.set(0.2541, 0.1002, -0.1249);
    node_nugget_15_83.rotation.set(2.68071, -0.21817, 2.8115);
  }
  node_nugget_15_83.userData.sculptComponent = {"id": "nugget-15", "name": "Ore nugget 16", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1661, "height": 0.1315, "depth": 0.1454, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2541, 0.1002, -0.1249], "rotation": [2.68071, -0.21817, 2.8115], "scale": [0.1661, 0.1315, 0.1454]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-15-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-15-facets"]};
  node_nugget_15_83.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_15_83);
  nodes["nugget-15"] = node_nugget_15_83;
  const mesh_nugget_15_83Geometry = endpoint_nugget_15_83
    ? new THREE.CylinderGeometry(endpoint_nugget_15_83.endRadius, endpoint_nugget_15_83.baseRadius, endpoint_nugget_15_83.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_15_83) {
    mesh_nugget_15_83Geometry.scale(0.1661, 0.1315, 0.1454);
  }
  const mesh_nugget_15_83 = new THREE.Mesh(
    mesh_nugget_15_83Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_15_83.name = "Ore nugget 16";
  if (endpoint_nugget_15_83) {
    mesh_nugget_15_83.position.copy(endpoint_nugget_15_83.midpoint);
    mesh_nugget_15_83.quaternion.copy(endpoint_nugget_15_83.quaternion);
  }
  mesh_nugget_15_83.castShadow = options.castShadow ?? true;
  mesh_nugget_15_83.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_15_83.userData.sculptComponent = {"id": "nugget-15", "name": "Ore nugget 16", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1661, "height": 0.1315, "depth": 0.1454, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2541, 0.1002, -0.1249], "rotation": [2.68071, -0.21817, 2.8115], "scale": [0.1661, 0.1315, 0.1454]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-15", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-15-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-15-facets"]};
  node_nugget_15_83.add(mesh_nugget_15_83);
  meshes["nugget-15"] = mesh_nugget_15_83;
  colliders["nugget-15"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-15"] ??= [];
  destructionGroups["nugget-15"].push(node_nugget_15_83);

  const endpoint_nugget_16_84 = makeAttachmentEndpoint(null);
  const node_nugget_16_84 = new THREE.Group();
  node_nugget_16_84.name = "Ore nugget 17__pivot";
  node_nugget_16_84.scale.set(1, 1, 1);
  if (endpoint_nugget_16_84) {
    node_nugget_16_84.position.copy(endpoint_nugget_16_84.start);
    node_nugget_16_84.rotation.set(0.49987, 0.35605, -0.17375);
  } else {
    node_nugget_16_84.position.set(0.423, 0.0097, 0.0631);
    node_nugget_16_84.rotation.set(0.49987, 0.35605, -0.17375);
  }
  node_nugget_16_84.userData.sculptComponent = {"id": "nugget-16", "name": "Ore nugget 17", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1312, "height": 0.1038, "depth": 0.1148, "units": "object", "confidence": 0.6}, "transform": {"position": [0.423, 0.0097, 0.0631], "rotation": [0.49987, 0.35605, -0.17375], "scale": [0.1312, 0.1038, 0.1148]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-16-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-16-facets"]};
  node_nugget_16_84.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_16_84);
  nodes["nugget-16"] = node_nugget_16_84;
  const mesh_nugget_16_84Geometry = endpoint_nugget_16_84
    ? new THREE.CylinderGeometry(endpoint_nugget_16_84.endRadius, endpoint_nugget_16_84.baseRadius, endpoint_nugget_16_84.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_16_84) {
    mesh_nugget_16_84Geometry.scale(0.1312, 0.1038, 0.1148);
  }
  const mesh_nugget_16_84 = new THREE.Mesh(
    mesh_nugget_16_84Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_16_84.name = "Ore nugget 17";
  if (endpoint_nugget_16_84) {
    mesh_nugget_16_84.position.copy(endpoint_nugget_16_84.midpoint);
    mesh_nugget_16_84.quaternion.copy(endpoint_nugget_16_84.quaternion);
  }
  mesh_nugget_16_84.castShadow = options.castShadow ?? true;
  mesh_nugget_16_84.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_16_84.userData.sculptComponent = {"id": "nugget-16", "name": "Ore nugget 17", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1312, "height": 0.1038, "depth": 0.1148, "units": "object", "confidence": 0.6}, "transform": {"position": [0.423, 0.0097, 0.0631], "rotation": [0.49987, 0.35605, -0.17375], "scale": [0.1312, 0.1038, 0.1148]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-16", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-16-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-16-facets"]};
  node_nugget_16_84.add(mesh_nugget_16_84);
  meshes["nugget-16"] = mesh_nugget_16_84;
  colliders["nugget-16"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-16"] ??= [];
  destructionGroups["nugget-16"].push(node_nugget_16_84);

  const endpoint_nugget_17_85 = makeAttachmentEndpoint(null);
  const node_nugget_17_85 = new THREE.Group();
  node_nugget_17_85.name = "Ore nugget 18__pivot";
  node_nugget_17_85.scale.set(1, 1, 1);
  if (endpoint_nugget_17_85) {
    node_nugget_17_85.position.copy(endpoint_nugget_17_85.start);
    node_nugget_17_85.rotation.set(0.01124, 1.24617, -0.05708);
  } else {
    node_nugget_17_85.position.set(0.3213, 0.0258, 0.2031);
    node_nugget_17_85.rotation.set(0.01124, 1.24617, -0.05708);
  }
  node_nugget_17_85.userData.sculptComponent = {"id": "nugget-17", "name": "Ore nugget 18", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1841, "height": 0.1457, "depth": 0.1611, "units": "object", "confidence": 0.6}, "transform": {"position": [0.3213, 0.0258, 0.2031], "rotation": [0.01124, 1.24617, -0.05708], "scale": [0.1841, 0.1457, 0.1611]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-17-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-17-facets"]};
  node_nugget_17_85.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_17_85);
  nodes["nugget-17"] = node_nugget_17_85;
  const mesh_nugget_17_85Geometry = endpoint_nugget_17_85
    ? new THREE.CylinderGeometry(endpoint_nugget_17_85.endRadius, endpoint_nugget_17_85.baseRadius, endpoint_nugget_17_85.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_17_85) {
    mesh_nugget_17_85Geometry.scale(0.1841, 0.1457, 0.1611);
  }
  const mesh_nugget_17_85 = new THREE.Mesh(
    mesh_nugget_17_85Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_17_85.name = "Ore nugget 18";
  if (endpoint_nugget_17_85) {
    mesh_nugget_17_85.position.copy(endpoint_nugget_17_85.midpoint);
    mesh_nugget_17_85.quaternion.copy(endpoint_nugget_17_85.quaternion);
  }
  mesh_nugget_17_85.castShadow = options.castShadow ?? true;
  mesh_nugget_17_85.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_17_85.userData.sculptComponent = {"id": "nugget-17", "name": "Ore nugget 18", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1841, "height": 0.1457, "depth": 0.1611, "units": "object", "confidence": 0.6}, "transform": {"position": [0.3213, 0.0258, 0.2031], "rotation": [0.01124, 1.24617, -0.05708], "scale": [0.1841, 0.1457, 0.1611]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-17", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-17-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-17-facets"]};
  node_nugget_17_85.add(mesh_nugget_17_85);
  meshes["nugget-17"] = mesh_nugget_17_85;
  colliders["nugget-17"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-17"] ??= [];
  destructionGroups["nugget-17"].push(node_nugget_17_85);

  const endpoint_nugget_18_86 = makeAttachmentEndpoint(null);
  const node_nugget_18_86 = new THREE.Group();
  node_nugget_18_86.name = "Ore nugget 19__pivot";
  node_nugget_18_86.scale.set(1, 1, 1);
  if (endpoint_nugget_18_86) {
    node_nugget_18_86.position.copy(endpoint_nugget_18_86.start);
    node_nugget_18_86.rotation.set(2.64172, 1.00531, -2.86897);
  } else {
    node_nugget_18_86.position.set(0.1336, 0.0528, 0.2887);
    node_nugget_18_86.rotation.set(2.64172, 1.00531, -2.86897);
  }
  node_nugget_18_86.userData.sculptComponent = {"id": "nugget-18", "name": "Ore nugget 19", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1322, "height": 0.1047, "depth": 0.1157, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1336, 0.0528, 0.2887], "rotation": [2.64172, 1.00531, -2.86897], "scale": [0.1322, 0.1047, 0.1157]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-18-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-18-facets"]};
  node_nugget_18_86.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_18_86);
  nodes["nugget-18"] = node_nugget_18_86;
  const mesh_nugget_18_86Geometry = endpoint_nugget_18_86
    ? new THREE.CylinderGeometry(endpoint_nugget_18_86.endRadius, endpoint_nugget_18_86.baseRadius, endpoint_nugget_18_86.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_18_86) {
    mesh_nugget_18_86Geometry.scale(0.1322, 0.1047, 0.1157);
  }
  const mesh_nugget_18_86 = new THREE.Mesh(
    mesh_nugget_18_86Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_18_86.name = "Ore nugget 19";
  if (endpoint_nugget_18_86) {
    mesh_nugget_18_86.position.copy(endpoint_nugget_18_86.midpoint);
    mesh_nugget_18_86.quaternion.copy(endpoint_nugget_18_86.quaternion);
  }
  mesh_nugget_18_86.castShadow = options.castShadow ?? true;
  mesh_nugget_18_86.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_18_86.userData.sculptComponent = {"id": "nugget-18", "name": "Ore nugget 19", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1322, "height": 0.1047, "depth": 0.1157, "units": "object", "confidence": 0.6}, "transform": {"position": [0.1336, 0.0528, 0.2887], "rotation": [2.64172, 1.00531, -2.86897], "scale": [0.1322, 0.1047, 0.1157]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-18", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-18-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-18-facets"]};
  node_nugget_18_86.add(mesh_nugget_18_86);
  meshes["nugget-18"] = mesh_nugget_18_86;
  colliders["nugget-18"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-18"] ??= [];
  destructionGroups["nugget-18"].push(node_nugget_18_86);

  const endpoint_nugget_19_87 = makeAttachmentEndpoint(null);
  const node_nugget_19_87 = new THREE.Group();
  node_nugget_19_87.name = "Ore nugget 20__pivot";
  node_nugget_19_87.scale.set(1, 1, 1);
  if (endpoint_nugget_19_87) {
    node_nugget_19_87.position.copy(endpoint_nugget_19_87.start);
    node_nugget_19_87.rotation.set(3.13035, 0.11519, 2.72649);
  } else {
    node_nugget_19_87.position.set(-0.0899, 0.0734, 0.297);
    node_nugget_19_87.rotation.set(3.13035, 0.11519, 2.72649);
  }
  node_nugget_19_87.userData.sculptComponent = {"id": "nugget-19", "name": "Ore nugget 20", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1691, "height": 0.1339, "depth": 0.148, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.0899, 0.0734, 0.297], "rotation": [3.13035, 0.11519, 2.72649], "scale": [0.1691, 0.1339, 0.148]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-19-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-19-facets"]};
  node_nugget_19_87.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_19_87);
  nodes["nugget-19"] = node_nugget_19_87;
  const mesh_nugget_19_87Geometry = endpoint_nugget_19_87
    ? new THREE.CylinderGeometry(endpoint_nugget_19_87.endRadius, endpoint_nugget_19_87.baseRadius, endpoint_nugget_19_87.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_19_87) {
    mesh_nugget_19_87Geometry.scale(0.1691, 0.1339, 0.148);
  }
  const mesh_nugget_19_87 = new THREE.Mesh(
    mesh_nugget_19_87Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_19_87.name = "Ore nugget 20";
  if (endpoint_nugget_19_87) {
    mesh_nugget_19_87.position.copy(endpoint_nugget_19_87.midpoint);
    mesh_nugget_19_87.quaternion.copy(endpoint_nugget_19_87.quaternion);
  }
  mesh_nugget_19_87.castShadow = options.castShadow ?? true;
  mesh_nugget_19_87.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_19_87.userData.sculptComponent = {"id": "nugget-19", "name": "Ore nugget 20", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1691, "height": 0.1339, "depth": 0.148, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.0899, 0.0734, 0.297], "rotation": [3.13035, 0.11519, 2.72649], "scale": [0.1691, 0.1339, 0.148]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-19", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-19-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-19-facets"]};
  node_nugget_19_87.add(mesh_nugget_19_87);
  meshes["nugget-19"] = mesh_nugget_19_87;
  colliders["nugget-19"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-19"] ??= [];
  destructionGroups["nugget-19"].push(node_nugget_19_87);

  const endpoint_nugget_20_88 = makeAttachmentEndpoint(null);
  const node_nugget_20_88 = new THREE.Group();
  node_nugget_20_88.name = "Ore nugget 21__pivot";
  node_nugget_20_88.scale.set(1, 1, 1);
  if (endpoint_nugget_20_88) {
    node_nugget_20_88.position.copy(endpoint_nugget_20_88.start);
    node_nugget_20_88.rotation.set(-2.64172, -0.77493, -2.69523);
  } else {
    node_nugget_20_88.position.set(-0.2893, 0.0732, 0.2256);
    node_nugget_20_88.rotation.set(-2.64172, -0.77493, -2.69523);
  }
  node_nugget_20_88.userData.sculptComponent = {"id": "nugget-20", "name": "Ore nugget 21", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.157, "height": 0.1243, "depth": 0.1374, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2893, 0.0732, 0.2256], "rotation": [-2.64172, -0.77493, -2.69523], "scale": [0.157, 0.1243, 0.1374]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-20-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-20-facets"]};
  node_nugget_20_88.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_20_88);
  nodes["nugget-20"] = node_nugget_20_88;
  const mesh_nugget_20_88Geometry = endpoint_nugget_20_88
    ? new THREE.CylinderGeometry(endpoint_nugget_20_88.endRadius, endpoint_nugget_20_88.baseRadius, endpoint_nugget_20_88.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_20_88) {
    mesh_nugget_20_88Geometry.scale(0.157, 0.1243, 0.1374);
  }
  const mesh_nugget_20_88 = new THREE.Mesh(
    mesh_nugget_20_88Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_20_88.name = "Ore nugget 21";
  if (endpoint_nugget_20_88) {
    mesh_nugget_20_88.position.copy(endpoint_nugget_20_88.midpoint);
    mesh_nugget_20_88.quaternion.copy(endpoint_nugget_20_88.quaternion);
  }
  mesh_nugget_20_88.castShadow = options.castShadow ?? true;
  mesh_nugget_20_88.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_20_88.userData.sculptComponent = {"id": "nugget-20", "name": "Ore nugget 21", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.157, "height": 0.1243, "depth": 0.1374, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.2893, 0.0732, 0.2256], "rotation": [-2.64172, -0.77493, -2.69523], "scale": [0.157, 0.1243, 0.1374]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-20", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-20-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-20-facets"]};
  node_nugget_20_88.add(mesh_nugget_20_88);
  meshes["nugget-20"] = mesh_nugget_20_88;
  colliders["nugget-20"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-20"] ??= [];
  destructionGroups["nugget-20"].push(node_nugget_20_88);

  const endpoint_nugget_21_89 = makeAttachmentEndpoint(null);
  const node_nugget_21_89 = new THREE.Group();
  node_nugget_21_89.name = "Ore nugget 22__pivot";
  node_nugget_21_89.scale.set(1, 1, 1);
  if (endpoint_nugget_21_89) {
    node_nugget_21_89.position.copy(endpoint_nugget_21_89.start);
    node_nugget_21_89.rotation.set(0.01124, -1.47655, -0.35802);
  } else {
    node_nugget_21_89.position.set(-0.4112, 0.0729, 0.0938);
    node_nugget_21_89.rotation.set(0.01124, -1.47655, -0.35802);
  }
  node_nugget_21_89.userData.sculptComponent = {"id": "nugget-21", "name": "Ore nugget 22", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1411, "height": 0.1117, "depth": 0.1234, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.4112, 0.0729, 0.0938], "rotation": [0.01124, -1.47655, -0.35802], "scale": [0.1411, 0.1117, 0.1234]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-21-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-21-facets"]};
  node_nugget_21_89.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_21_89);
  nodes["nugget-21"] = node_nugget_21_89;
  const mesh_nugget_21_89Geometry = endpoint_nugget_21_89
    ? new THREE.CylinderGeometry(endpoint_nugget_21_89.endRadius, endpoint_nugget_21_89.baseRadius, endpoint_nugget_21_89.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_21_89) {
    mesh_nugget_21_89Geometry.scale(0.1411, 0.1117, 0.1234);
  }
  const mesh_nugget_21_89 = new THREE.Mesh(
    mesh_nugget_21_89Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_21_89.name = "Ore nugget 22";
  if (endpoint_nugget_21_89) {
    mesh_nugget_21_89.position.copy(endpoint_nugget_21_89.midpoint);
    mesh_nugget_21_89.quaternion.copy(endpoint_nugget_21_89.quaternion);
  }
  mesh_nugget_21_89.castShadow = options.castShadow ?? true;
  mesh_nugget_21_89.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_21_89.userData.sculptComponent = {"id": "nugget-21", "name": "Ore nugget 22", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1411, "height": 0.1117, "depth": 0.1234, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.4112, 0.0729, 0.0938], "rotation": [0.01124, -1.47655, -0.35802], "scale": [0.1411, 0.1117, 0.1234]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-21", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-21-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-21-facets"]};
  node_nugget_21_89.add(mesh_nugget_21_89);
  meshes["nugget-21"] = mesh_nugget_21_89;
  colliders["nugget-21"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-21"] ??= [];
  destructionGroups["nugget-21"].push(node_nugget_21_89);

  const endpoint_nugget_22_90 = makeAttachmentEndpoint(null);
  const node_nugget_22_90 = new THREE.Group();
  node_nugget_22_90.name = "Ore nugget 23__pivot";
  node_nugget_22_90.scale.set(1, 1, 1);
  if (endpoint_nugget_22_90) {
    node_nugget_22_90.position.copy(endpoint_nugget_22_90.start);
    node_nugget_22_90.rotation.set(-0.49987, -0.58643, 0.17375);
  } else {
    node_nugget_22_90.position.set(-0.423, 0.0736, -0.0631);
    node_nugget_22_90.rotation.set(-0.49987, -0.58643, 0.17375);
  }
  node_nugget_22_90.userData.sculptComponent = {"id": "nugget-22", "name": "Ore nugget 23", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1808, "height": 0.1432, "depth": 0.1582, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.423, 0.0736, -0.0631], "rotation": [-0.49987, -0.58643, 0.17375], "scale": [0.1808, 0.1432, 0.1582]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-22-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-22-facets"]};
  node_nugget_22_90.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_22_90);
  nodes["nugget-22"] = node_nugget_22_90;
  const mesh_nugget_22_90Geometry = endpoint_nugget_22_90
    ? new THREE.CylinderGeometry(endpoint_nugget_22_90.endRadius, endpoint_nugget_22_90.baseRadius, endpoint_nugget_22_90.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_22_90) {
    mesh_nugget_22_90Geometry.scale(0.1808, 0.1432, 0.1582);
  }
  const mesh_nugget_22_90 = new THREE.Mesh(
    mesh_nugget_22_90Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_22_90.name = "Ore nugget 23";
  if (endpoint_nugget_22_90) {
    mesh_nugget_22_90.position.copy(endpoint_nugget_22_90.midpoint);
    mesh_nugget_22_90.quaternion.copy(endpoint_nugget_22_90.quaternion);
  }
  mesh_nugget_22_90.castShadow = options.castShadow ?? true;
  mesh_nugget_22_90.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_22_90.userData.sculptComponent = {"id": "nugget-22", "name": "Ore nugget 23", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1808, "height": 0.1432, "depth": 0.1582, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.423, 0.0736, -0.0631], "rotation": [-0.49987, -0.58643, 0.17375], "scale": [0.1808, 0.1432, 0.1582]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-22", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-22-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-22-facets"]};
  node_nugget_22_90.add(mesh_nugget_22_90);
  meshes["nugget-22"] = mesh_nugget_22_90;
  colliders["nugget-22"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-22"] ??= [];
  destructionGroups["nugget-22"].push(node_nugget_22_90);

  const endpoint_nugget_23_91 = makeAttachmentEndpoint(null);
  const node_nugget_23_91 = new THREE.Group();
  node_nugget_23_91.name = "Ore nugget 24__pivot";
  node_nugget_23_91.scale.set(1, 1, 1);
  if (endpoint_nugget_23_91) {
    node_nugget_23_91.position.copy(endpoint_nugget_23_91.start);
    node_nugget_23_91.rotation.set(-0.01124, 0.30369, 0.05708);
  } else {
    node_nugget_23_91.position.set(-0.3213, 0.0727, -0.2031);
    node_nugget_23_91.rotation.set(-0.01124, 0.30369, 0.05708);
  }
  node_nugget_23_91.userData.sculptComponent = {"id": "nugget-23", "name": "Ore nugget 24", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1279, "height": 0.1013, "depth": 0.1119, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.3213, 0.0727, -0.2031], "rotation": [-0.01124, 0.30369, 0.05708], "scale": [0.1279, 0.1013, 0.1119]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-23-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-23-facets"]};
  node_nugget_23_91.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_23_91);
  nodes["nugget-23"] = node_nugget_23_91;
  const mesh_nugget_23_91Geometry = endpoint_nugget_23_91
    ? new THREE.CylinderGeometry(endpoint_nugget_23_91.endRadius, endpoint_nugget_23_91.baseRadius, endpoint_nugget_23_91.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_23_91) {
    mesh_nugget_23_91Geometry.scale(0.1279, 0.1013, 0.1119);
  }
  const mesh_nugget_23_91 = new THREE.Mesh(
    mesh_nugget_23_91Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_23_91.name = "Ore nugget 24";
  if (endpoint_nugget_23_91) {
    mesh_nugget_23_91.position.copy(endpoint_nugget_23_91.midpoint);
    mesh_nugget_23_91.quaternion.copy(endpoint_nugget_23_91.quaternion);
  }
  mesh_nugget_23_91.castShadow = options.castShadow ?? true;
  mesh_nugget_23_91.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_23_91.userData.sculptComponent = {"id": "nugget-23", "name": "Ore nugget 24", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1279, "height": 0.1013, "depth": 0.1119, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.3213, 0.0727, -0.2031], "rotation": [-0.01124, 0.30369, 0.05708], "scale": [0.1279, 0.1013, 0.1119]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-23", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-23-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-23-facets"]};
  node_nugget_23_91.add(mesh_nugget_23_91);
  meshes["nugget-23"] = mesh_nugget_23_91;
  colliders["nugget-23"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-23"] ??= [];
  destructionGroups["nugget-23"].push(node_nugget_23_91);

  const endpoint_nugget_24_92 = makeAttachmentEndpoint(null);
  const node_nugget_24_92 = new THREE.Group();
  node_nugget_24_92.name = "Ore nugget 25__pivot";
  node_nugget_24_92.scale.set(1, 1, 1);
  if (endpoint_nugget_24_92) {
    node_nugget_24_92.position.copy(endpoint_nugget_24_92.start);
    node_nugget_24_92.rotation.set(0.49987, 1.19381, -0.27262);
  } else {
    node_nugget_24_92.position.set(-0.1336, 0.0735, -0.2887);
    node_nugget_24_92.rotation.set(0.49987, 1.19381, -0.27262);
  }
  node_nugget_24_92.userData.sculptComponent = {"id": "nugget-24", "name": "Ore nugget 25", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1798, "height": 0.1423, "depth": 0.1573, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1336, 0.0735, -0.2887], "rotation": [0.49987, 1.19381, -0.27262], "scale": [0.1798, 0.1423, 0.1573]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-24", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-24-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-24-facets"]};
  node_nugget_24_92.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-24", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_24_92);
  nodes["nugget-24"] = node_nugget_24_92;
  const mesh_nugget_24_92Geometry = endpoint_nugget_24_92
    ? new THREE.CylinderGeometry(endpoint_nugget_24_92.endRadius, endpoint_nugget_24_92.baseRadius, endpoint_nugget_24_92.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_24_92) {
    mesh_nugget_24_92Geometry.scale(0.1798, 0.1423, 0.1573);
  }
  const mesh_nugget_24_92 = new THREE.Mesh(
    mesh_nugget_24_92Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_24_92.name = "Ore nugget 25";
  if (endpoint_nugget_24_92) {
    mesh_nugget_24_92.position.copy(endpoint_nugget_24_92.midpoint);
    mesh_nugget_24_92.quaternion.copy(endpoint_nugget_24_92.quaternion);
  }
  mesh_nugget_24_92.castShadow = options.castShadow ?? true;
  mesh_nugget_24_92.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_24_92.userData.sculptComponent = {"id": "nugget-24", "name": "Ore nugget 25", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1798, "height": 0.1423, "depth": 0.1573, "units": "object", "confidence": 0.6}, "transform": {"position": [-0.1336, 0.0735, -0.2887], "rotation": [0.49987, 1.19381, -0.27262], "scale": [0.1798, 0.1423, 0.1573]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-24", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-24-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-24-facets"]};
  node_nugget_24_92.add(mesh_nugget_24_92);
  meshes["nugget-24"] = mesh_nugget_24_92;
  colliders["nugget-24"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-24"] ??= [];
  destructionGroups["nugget-24"].push(node_nugget_24_92);

  const endpoint_nugget_25_93 = makeAttachmentEndpoint(null);
  const node_nugget_25_93 = new THREE.Group();
  node_nugget_25_93.name = "Ore nugget 26__pivot";
  node_nugget_25_93.scale.set(1, 1, 1);
  if (endpoint_nugget_25_93) {
    node_nugget_25_93.position.copy(endpoint_nugget_25_93.start);
    node_nugget_25_93.rotation.set(-3.13035, 1.05767, -2.72649);
  } else {
    node_nugget_25_93.position.set(0.0899, 0.0595, -0.297);
    node_nugget_25_93.rotation.set(-3.13035, 1.05767, -2.72649);
  }
  node_nugget_25_93.userData.sculptComponent = {"id": "nugget-25", "name": "Ore nugget 26", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1429, "height": 0.1131, "depth": 0.125, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0899, 0.0595, -0.297], "rotation": [-3.13035, 1.05767, -2.72649], "scale": [0.1429, 0.1131, 0.125]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-25", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-25-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-25-facets"]};
  node_nugget_25_93.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-25", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_25_93);
  nodes["nugget-25"] = node_nugget_25_93;
  const mesh_nugget_25_93Geometry = endpoint_nugget_25_93
    ? new THREE.CylinderGeometry(endpoint_nugget_25_93.endRadius, endpoint_nugget_25_93.baseRadius, endpoint_nugget_25_93.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6});
  if (!endpoint_nugget_25_93) {
    mesh_nugget_25_93Geometry.scale(0.1429, 0.1131, 0.125);
  }
  const mesh_nugget_25_93 = new THREE.Mesh(
    mesh_nugget_25_93Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_25_93.name = "Ore nugget 26";
  if (endpoint_nugget_25_93) {
    mesh_nugget_25_93.position.copy(endpoint_nugget_25_93.midpoint);
    mesh_nugget_25_93.quaternion.copy(endpoint_nugget_25_93.quaternion);
  }
  mesh_nugget_25_93.castShadow = options.castShadow ?? true;
  mesh_nugget_25_93.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_25_93.userData.sculptComponent = {"id": "nugget-25", "name": "Ore nugget 26", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 6-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 6}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1429, "height": 0.1131, "depth": 0.125, "units": "object", "confidence": 0.6}, "transform": {"position": [0.0899, 0.0595, -0.297], "rotation": [-3.13035, 1.05767, -2.72649], "scale": [0.1429, 0.1131, 0.125]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-25", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-25-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-25-facets"]};
  node_nugget_25_93.add(mesh_nugget_25_93);
  meshes["nugget-25"] = mesh_nugget_25_93;
  colliders["nugget-25"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-25"] ??= [];
  destructionGroups["nugget-25"].push(node_nugget_25_93);

  const endpoint_nugget_26_94 = makeAttachmentEndpoint(null);
  const node_nugget_26_94 = new THREE.Group();
  node_nugget_26_94.name = "Ore nugget 27__pivot";
  node_nugget_26_94.scale.set(1, 1, 1);
  if (endpoint_nugget_26_94) {
    node_nugget_26_94.position.copy(endpoint_nugget_26_94.start);
    node_nugget_26_94.rotation.set(2.64172, 0.16755, 2.69523);
  } else {
    node_nugget_26_94.position.set(0.2893, 0.03, -0.2256);
    node_nugget_26_94.rotation.set(2.64172, 0.16755, 2.69523);
  }
  node_nugget_26_94.userData.sculptComponent = {"id": "nugget-26", "name": "Ore nugget 27", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.155, "height": 0.1227, "depth": 0.1356, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2893, 0.03, -0.2256], "rotation": [2.64172, 0.16755, 2.69523], "scale": [0.155, 0.1227, 0.1356]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-26", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-26-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-26-facets"]};
  node_nugget_26_94.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-26", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_26_94);
  nodes["nugget-26"] = node_nugget_26_94;
  const mesh_nugget_26_94Geometry = endpoint_nugget_26_94
    ? new THREE.CylinderGeometry(endpoint_nugget_26_94.endRadius, endpoint_nugget_26_94.baseRadius, endpoint_nugget_26_94.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7});
  if (!endpoint_nugget_26_94) {
    mesh_nugget_26_94Geometry.scale(0.155, 0.1227, 0.1356);
  }
  const mesh_nugget_26_94 = new THREE.Mesh(
    mesh_nugget_26_94Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_26_94.name = "Ore nugget 27";
  if (endpoint_nugget_26_94) {
    mesh_nugget_26_94.position.copy(endpoint_nugget_26_94.midpoint);
    mesh_nugget_26_94.quaternion.copy(endpoint_nugget_26_94.quaternion);
  }
  mesh_nugget_26_94.castShadow = options.castShadow ?? true;
  mesh_nugget_26_94.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_26_94.userData.sculptComponent = {"id": "nugget-26", "name": "Ore nugget 27", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 7-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 7}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.155, "height": 0.1227, "depth": 0.1356, "units": "object", "confidence": 0.6}, "transform": {"position": [0.2893, 0.03, -0.2256], "rotation": [2.64172, 0.16755, 2.69523], "scale": [0.155, 0.1227, 0.1356]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-26", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-26-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-26-facets"]};
  node_nugget_26_94.add(mesh_nugget_26_94);
  meshes["nugget-26"] = mesh_nugget_26_94;
  colliders["nugget-26"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-26"] ??= [];
  destructionGroups["nugget-26"].push(node_nugget_26_94);

  const endpoint_nugget_27_95 = makeAttachmentEndpoint(null);
  const node_nugget_27_95 = new THREE.Group();
  node_nugget_27_95.name = "Ore nugget 28__pivot";
  node_nugget_27_95.scale.set(1, 1, 1);
  if (endpoint_nugget_27_95) {
    node_nugget_27_95.position.copy(endpoint_nugget_27_95.start);
    node_nugget_27_95.rotation.set(3.13035, -0.72257, -2.78357);
  } else {
    node_nugget_27_95.position.set(0.4112, 0.0121, -0.0938);
    node_nugget_27_95.rotation.set(3.13035, -0.72257, -2.78357);
  }
  node_nugget_27_95.userData.sculptComponent = {"id": "nugget-27", "name": "Ore nugget 28", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1709, "height": 0.1353, "depth": 0.1496, "units": "object", "confidence": 0.6}, "transform": {"position": [0.4112, 0.0121, -0.0938], "rotation": [3.13035, -0.72257, -2.78357], "scale": [0.1709, 0.1353, 0.1496]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-27", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-27-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-27-facets"]};
  node_nugget_27_95.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-27", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["ore-heap"] ?? root).add(node_nugget_27_95);
  nodes["nugget-27"] = node_nugget_27_95;
  const mesh_nugget_27_95Geometry = endpoint_nugget_27_95
    ? new THREE.CylinderGeometry(endpoint_nugget_27_95.endRadius, endpoint_nugget_27_95.baseRadius, endpoint_nugget_27_95.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5});
  if (!endpoint_nugget_27_95) {
    mesh_nugget_27_95Geometry.scale(0.1709, 0.1353, 0.1496);
  }
  const mesh_nugget_27_95 = new THREE.Mesh(
    mesh_nugget_27_95Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nugget_27_95.name = "Ore nugget 28";
  if (endpoint_nugget_27_95) {
    mesh_nugget_27_95.position.copy(endpoint_nugget_27_95.midpoint);
    mesh_nugget_27_95.quaternion.copy(endpoint_nugget_27_95.quaternion);
  }
  mesh_nugget_27_95.castShadow = options.castShadow ?? true;
  mesh_nugget_27_95.receiveShadow = options.receiveShadow ?? true;
  mesh_nugget_27_95.userData.sculptComponent = {"id": "nugget-27", "name": "Ore nugget 28", "level": "micro", "role": "nugget", "importance": 0.35, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Ore nugget: a chunky faceted lump: a 5-sided revolved bipyramid, turned and squashed irregularly, so each reads as an angular polyhedron like the reference's nuggets.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3], [0.12, 0.46], [0.0, 0.48]], "segments": 5}}, "parent": "ore-heap", "attachment": null, "dimensions": {"width": 0.1709, "height": 0.1353, "depth": 0.1496, "units": "object", "confidence": 0.6}, "transform": {"position": [0.4112, 0.0121, -0.0938], "rotation": [3.13035, -0.72257, -2.78357], "scale": [0.1709, 0.1353, 0.1496]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "nugget-27", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 198, 58, 1.0)", "secondaryAlbedo": "rgba(224, 164, 44, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.7, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(224, 164, 44, 1.0)"}, {"position": 1.0, "color": "rgba(244, 198, 58, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "nugget-27-facets", "kind": "gloss", "description": "lighter upward facets", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["nugget-27-facets"]};
  node_nugget_27_95.add(mesh_nugget_27_95);
  meshes["nugget-27"] = mesh_nugget_27_95;
  colliders["nugget-27"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["nugget-27"] ??= [];
  destructionGroups["nugget-27"].push(node_nugget_27_95);

  // repetition system: rivets-top-nl (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-top-nl"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.17700000000000002;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-top-nl";
    parent.add(cluster);
  }

  // repetition system: rivets-bot-nl (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-bot-nl"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.162;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-bot-nl";
    parent.add(cluster);
  }

  // repetition system: rivets-top-nr (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-top-nr"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.17700000000000002;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-top-nr";
    parent.add(cluster);
  }

  // repetition system: rivets-bot-nr (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-bot-nr"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.162;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-bot-nr";
    parent.add(cluster);
  }

  // repetition system: rivets-top-fl (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-top-fl"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.17700000000000002;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-top-fl";
    parent.add(cluster);
  }

  // repetition system: rivets-bot-fl (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-bot-fl"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.162;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-bot-fl";
    parent.add(cluster);
  }

  // repetition system: rivets-top-fr (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-top-fr"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.17700000000000002;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-top-fr";
    parent.add(cluster);
  }

  // repetition system: rivets-bot-fr (InstancedMesh, radial, count=4, level=micro)
  {
    const parent = nodes["bracket-bot-fr"] ?? root;
    const geo = new THREE.SphereGeometry(0.5, 16, 10);
    const mat = materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.034, 0.034, 0.034];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.162;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 4);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 4; i++) {
      const ang = ((0.0) + (i * 360) / 4) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "rivets-bot-fr";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "real-time-stylized", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "note": "Stylized KayKit-like game prop seen at ~100 px: flat readable albedo with subtle procedural breakup; the 1024 px quality-first texture bar does not apply (textures are 256 px)."};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMineCartLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Mine cart look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key light", "direction": "upper left, slightly in front", "color": "#fff4e6", "softness": "soft studio"}, {"role": "fill light", "direction": "right", "color": "#dfe6ff", "intensity": "low"}, {"role": "environment light", "type": "hemisphere", "sky": "#f2f4ff", "ground": "#4a4036", "notes": "soft studio ambience; the game renderer has no environment map, so neither do the review renders"}, {"role": "shadow", "softness": "soft PCF, contact shadow faint (kept off the plate in gate renders so the silhouette mask measures the object, not its shadow)"}, {"role": "background", "color": "#c9c9c9", "notes": "flat light grey, faint contact shadow"}, {"role": "exposure and tone mapping", "exposure": 1.0, "toneMapping": "ACES Filmic, sRGB output", "notes": "review renders and the game both use ACES-style tone mapping at exposure ~1"}];
  lights.userData.lookDevTargets = {"qualityPriority": "real-time-stylized", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "note": "Stylized KayKit-like game prop seen at ~100 px: flat readable albedo with subtle procedural breakup; the 1024 px quality-first texture bar does not apply (textures are 256 px)."};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMineCartEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameMineCartCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createMineCartPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureMineCartRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMineCartInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
