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
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMineCartModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Mine cart";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "fovDegrees": 14.0, "aspect": 1.8333333333333333, "orientation": {"yaw": 27.0, "pitch": -7.0, "roll": 0.0}, "azimuthDeg": 27.0, "elevationDeg": 7.0, "positionHint": [2.6, 0.6, 5.1], "solveMethod": "silhouette camera fit (renders/camera-fit/camera-fit.json): clay renders of the macro build vs the reference foreground mask on the Tier-1 224 grid, 326 candidates; best IoU 0.861 at az 27, el 7, fov 14 (a long lens: the reference reads as a product shot)", "note": "Estimated from the image: three-quarter from the front-RIGHT (the long side faces the viewer, the handle end face shows on the right, the rim's top edge falls toward the right), ~27 degrees above; the review harness frames the model to the reference's foreground box. Not solved for projection (no projection used)."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "plank-near-1", "regionId": "plank-wood", "specMaterialId": "wood", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "sleeper-1", "regionId": "sleeper-wood", "specMaterialId": "wood-dark", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "specMaterialId": "iron", "profileId": "metal.steel-brushed", "status": "proceed"}, {"componentId": "ore-heap", "regionId": "gold-ore", "specMaterialId": "ore", "profileId": "metal.gold", "status": "proceed"}, {"componentId": "root", "regionId": "gravel", "specMaterialId": "gravel", "profileId": "stone.natural", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wood"] = createSculptMaterial(
    "wood",
    {"id": "wood", "name": "Cart wood planks", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#9a5a2c", "color": "#9a5a2c", "albedo": {"dominant": "#9a5a2c", "secondary": ["#7a4321", "#b9773f"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#9a5a2c", "#7a4321", "#b9773f"], "pattern": "mottled", "amplitude": 0.12, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.3, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.168, "role": "grain, facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.06, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.72, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.2, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "wood-grain-streaks", "kind": "groove", "region": "all plank faces, along the plank length", "evidenceRefs": ["full-object"], "confidence": 0.7, "roughnessDelta": 0.05, "albedoShift": "#6d3b1c", "pattern": "streaked along local X", "amplitude": 0.12}, {"id": "plank-edge-wear", "kind": "chip", "region": "plank and post edges", "evidenceRefs": ["full-object"], "confidence": 0.65, "albedoShift": "#c08450", "roughnessDelta": -0.08, "edgeWear": 0.25}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Warm mid-brown planks; the reference's painted grain gouges become a low-amplitude streak override and light edge wear.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.779, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.779, "estimatedFidelity": 0.779, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_albedo.png", "url": "wood_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_roughness.png", "url": "wood_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_height.png", "url": "wood_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_normal.png", "url": "wood_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-00-plank-wood/wood_ao.png", "url": "wood_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 220, "sourceHeight": 105, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 220, "height": 105}, "mask": {"backgroundColor": "#58311A", "backgroundNoise": 49.437, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.2801, "heightP90Gradient": 0.06858, "roughnessBase": 0.708, "roughnessVariation": 0.111, "normalStrength": 0.237, "blurRadius": 10}, "palette": ["#804826", "#8E532C", "#65381F", "#36190B", "#A66A3B"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#66381D", "#874D29", "#7E4927", "#814827", "#724123"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 84.7, "meanSaturation": 0.7, "gradientStrength": 0.124, "mottle": 0.013, "streakRatio": 0.43, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "plank-near-1", "regionId": "plank-wood", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/00-plank-wood.png", "bbox": {"x": 480, "y": 285, "width": 220, "height": 105}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0214}, "observations": ["chromatic base-colour response", "directional surface frequency", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "plank-near-1", "regionId": "plank-wood", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.779, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["wood-dark"] = createSculptMaterial(
    "wood-dark",
    {"id": "wood-dark", "name": "Sleeper wood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#704324", "color": "#704324", "albedo": {"dominant": "#704324", "secondary": ["#58341c", "#8a5630"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#704324", "#58341c", "#8a5630"], "pattern": "mottled", "amplitude": 0.14, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.35, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.196, "role": "grain, facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.07, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.72, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.3, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.25, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "sleeper-dirt", "kind": "stain", "region": "sleeper ends and sides", "evidenceRefs": ["full-object"], "confidence": 0.6, "dirtAmount": 0.3, "cavityBias": 0.6}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Darker, dirtier wood of the rail sleepers.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.8, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_albedo.png", "url": "wood-dark_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_roughness.png", "url": "wood-dark_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_height.png", "url": "wood-dark_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_normal.png", "url": "wood-dark_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-01-sleeper-wood/wood-dark_ao.png", "url": "wood-dark_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 110, "sourceHeight": 30, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 110, "height": 30}, "mask": {"backgroundColor": "#7A604D", "backgroundNoise": 99.985, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9203}, "mapStats": {"valueRange": 0.3636, "heightP90Gradient": 0.04136, "roughnessBase": 0.7, "roughnessVariation": 0.071, "normalStrength": 0.205, "blurRadius": 10}, "palette": ["#6B4C36", "#543C2E", "#3F291D", "#866344", "#B4936D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#88613D", "#6C4A32", "#644937", "#655042", "#887D73"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 89.6, "meanSaturation": 0.448, "gradientStrength": 0.217, "mottle": 0.025, "streakRatio": 1.96, "hueSpread": 0.003, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "sleeper-1", "regionId": "sleeper-wood", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}, "observations": ["chromatic base-colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "sleeper-1", "regionId": "sleeper-wood", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.8, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "Forged iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#4b4d53", "color": "#4b4d53", "albedo": {"dominant": "#4b4d53", "secondary": ["#38393e", "#676a72"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#4b4d53", "#38393e", "#676a72"], "pattern": "mottled", "amplitude": 0.08, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.112, "role": "grain, facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.04, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.5, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.45, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.15, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.15, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "iron-edge-highlight", "kind": "bevel", "region": "bracket and rim edges", "evidenceRefs": ["full-object"], "confidence": 0.6, "roughnessDelta": -0.15}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Dark neutral grey, satin; brackets, rims, rails, rivets, handle straps. Real-time override of the registry prior (metalness 1.0): metalness 0.45, roughness 0.5, because the game renderer has no environment map.", "evidenceRefs": ["full-object"], "referenceMaterialId": "metal.steel-brushed", "materialFamily": "metal", "materialSubtype": "steel", "materialFinish": "brushed", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.steel-brushed", "method": "family-subtype-finish", "confidence": 0.768, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap", "normalMap", "anisotropyMap"], "optionalMaps": ["metalnessMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "anisotropy": {"base": 0.85, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.768, "estimatedFidelity": 0.768, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-02-bracket-iron/iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 80, "sourceHeight": 50, "mapSize": 512, "cropBBoxPixels": {"x": 7, "y": 17, "width": 73, "height": 33}, "mask": {"backgroundColor": "#67666B", "backgroundNoise": 83.247, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.044}, "mapStats": {"valueRange": 0.1683, "heightP90Gradient": 0.02549, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.186, "blurRadius": 10}, "palette": ["#362D2D", "#2A2324", "#1D1819", "#110E0E", "#403636"]}, "warnings": ["foreground mask is very small", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#544D4F", "#3C373A", "#4B4649", "#353031", "#48444B"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 65.2, "meanSaturation": 0.09, "gradientStrength": 0.209, "mottle": 0.021, "streakRatio": 2.55, "hueSpread": 0.125, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}, "observations": ["near-neutral colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "bracket-top-nr", "regionId": "bracket-iron", "materialId": null, "family": "metal", "subtype": "steel", "finish": "brushed", "aliases": [], "confidence": 0.768, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["ore"] = createSculptMaterial(
    "ore",
    {"id": "ore", "name": "Gold ore", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#f0bf2e", "color": "#f0bf2e", "albedo": {"dominant": "#f0bf2e", "secondary": ["#d49a17", "#ffe168"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#f0bf2e", "#d49a17", "#ffe168"], "pattern": "mottled", "amplitude": 0.1, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.14, "role": "grain, facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.05, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.3, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.45, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.2, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "ore-facet-gloss", "kind": "gloss", "region": "upward-facing nugget facets", "evidenceRefs": ["full-object"], "confidence": 0.7, "roughness": 0.18, "note": "hotspots toward the upper-left key light"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Saturated yellow gold, lighter on the upward facets. Real-time override of the registry prior (metalness 1.0): metalness 0.45, roughness 0.3, because the game renderer has no environment map.", "evidenceRefs": ["full-object"], "clearcoat": 0.3, "clearcoatRoughness": 0.25, "referenceMaterialId": "metal.gold", "materialFamily": "metal", "materialSubtype": "gold", "materialFinish": "polished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.gold", "method": "family-subtype-finish", "confidence": 0.829, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "metalnessMap"], "validationViews": ["albedo-unlit", "environment-reflection", "grazing", "reference-beauty"]}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_albedo.png", "url": "ore_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_roughness.png", "url": "ore_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_height.png", "url": "ore_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_normal.png", "url": "ore_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-03-gold-ore/ore_ao.png", "url": "ore_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 180, "sourceHeight": 80, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 180, "height": 80}, "mask": {"backgroundColor": "#BF8D38", "backgroundNoise": 37.108, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.6068, "heightP90Gradient": 0.06753, "roughnessBase": 0.705, "roughnessVariation": 0.122, "normalStrength": 0.235, "blurRadius": 10}, "palette": ["#FADB6E", "#F1C356", "#DEA440", "#B3782C", "#5C300C"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "gemstone", "recipe": {"metalness": 0.0, "roughness": 0.05, "clearcoat": 1.0, "clearcoatRoughness": 0.0, "transmission": 0.9, "ior": 1.54, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "gradient-smoke"}, "palette": ["#D8B667", "#E2B650", "#CA9741", "#E2AD46", "#CD993D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 173.7, "meanSaturation": 0.672, "gradientStrength": 0.309, "mottle": 0.052, "streakRatio": 1.5, "hueSpread": 0.007, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "ore-heap", "regionId": "gold-ore", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}, "observations": ["chromatic base-colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "ore-heap", "regionId": "gold-ore", "materialId": null, "family": "metal", "subtype": "gold", "finish": "polished", "aliases": [], "confidence": 0.829, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["gravel"] = createSculptMaterial(
    "gravel",
    {"id": "gravel", "name": "Gravel bed", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#6b6358", "color": "#6b6358", "albedo": {"dominant": "#6b6358", "secondary": ["#4f483f", "#8f8678"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#6b6358", "#4f483f", "#8f8678"], "pattern": "mottled", "amplitude": 0.25, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.625, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.35, "role": "grain, facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.125, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.78, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.4, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.2, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "pebble-mottle", "kind": "stain", "region": "whole bed top", "evidenceRefs": ["full-object"], "confidence": 0.6, "dirtAmount": 0.2, "pattern": "speckled pebbles"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Irregular grey-brown gravel patch the track lies on.", "evidenceRefs": ["full-object"], "referenceMaterialId": "stone.natural", "materialFamily": "stone", "materialSubtype": "natural", "materialFinish": "rough-or-polished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "stone.natural", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-standard", "three.mesh-physical", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "displacementMap", "clearcoatMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "clearcoat": {"base": 0.0, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_albedo.png", "url": "gravel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_roughness.png", "url": "gravel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_height.png", "url": "gravel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_normal.png", "url": "gravel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/pbr-04-gravel/gravel_ao.png", "url": "gravel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 150, "sourceHeight": 40, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 150, "height": 40}, "mask": {"backgroundColor": "#37241D", "backgroundNoise": 42.0, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.8198}, "mapStats": {"valueRange": 0.3647, "heightP90Gradient": 0.0823, "roughnessBase": 0.721, "roughnessVariation": 0.138, "normalStrength": 0.253, "blurRadius": 10}, "palette": ["#6A4D39", "#573E2E", "#17120F", "#392C21", "#8B725E"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#2C2928", "#211D1A", "#3D2F25", "#654A37", "#664834"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 57.6, "meanSaturation": 0.376, "gradientStrength": 0.213, "mottle": 0.026, "streakRatio": 1.21, "hueSpread": 0.026, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "root", "regionId": "gravel", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "root", "regionId": "gravel", "materialId": null, "family": "stone", "subtype": "natural", "finish": "rough-or-polished", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}},
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
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Gravel bed", "level": "macro", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gravel bed: a flat slab-like patch with countable faces; the reference shows it as an irregular base, kept as a thin box so the prop sits on the bailey ground.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.42, "height": 0.04, "depth": 1.08, "units": "object", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.42, 0.04, 1.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}}, "material": "gravel", "materialLayers": ["gravel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 99, 88, 1.0)", "secondaryAlbedo": "rgba(79, 72, 63, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.7999999999999999, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(79, 72, 63, 1.0)"}, {"position": 1.0, "color": "rgba(107, 99, 88, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gravel-pebbles", "kind": "stain", "description": "speckled pebbles on the bed top", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.98, "microRoughness": 0.196, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["gravel-pebbles"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gravel"}, "materialRegions": [{"regionId": "gravel", "materialId": "gravel", "profileId": "stone.natural", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}}]};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.42, 0.04, 1.08);
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
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Gravel bed", "level": "macro", "role": "body", "importance": 0.6, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gravel bed: a flat slab-like patch with countable faces; the reference shows it as an irregular base, kept as a thin box so the prop sits on the bailey ground.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.42, "height": 0.04, "depth": 1.08, "units": "object", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.42, 0.04, 1.08]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gravel"}}, "material": "gravel", "materialLayers": ["gravel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(107, 99, 88, 1.0)", "secondaryAlbedo": "rgba(79, 72, 63, 1.0)", "materialClass": "stone", "materialClassConfidence": 0.7999999999999999, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(79, 72, 63, 1.0)"}, {"position": 1.0, "color": "rgba(107, 99, 88, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gravel-pebbles", "kind": "stain", "description": "speckled pebbles on the bed top", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.98, "microRoughness": 0.196, "bumpAmplitude": 0.02, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["gravel-pebbles"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gravel"}, "materialRegions": [{"regionId": "gravel", "materialId": "gravel", "profileId": "stone.natural", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/04-gravel.png", "bbox": {"x": 880, "y": 600, "width": 150, "height": 40}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0055}}]};
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
    node_sleeper_0_1.position.set(-0.5, 0.055, 0.0);
    node_sleeper_0_1.rotation.set(-0.0, 0.0, -0.0);
  }
  node_sleeper_0_1.userData.sculptComponent = {"id": "sleeper-0", "name": "Sleeper 1", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.5, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-0-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-0-ends"]};
  node_sleeper_0_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_0_1);
  nodes["sleeper-0"] = node_sleeper_0_1;
  const mesh_sleeper_0_1Geometry = endpoint_sleeper_0_1
    ? new THREE.CylinderGeometry(endpoint_sleeper_0_1.endRadius, endpoint_sleeper_0_1.baseRadius, endpoint_sleeper_0_1.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_0_1) {
    mesh_sleeper_0_1Geometry.scale(0.18, 0.07, 1.0);
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
  mesh_sleeper_0_1.userData.sculptComponent = {"id": "sleeper-0", "name": "Sleeper 1", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.5, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-0-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-0-ends"]};
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
  node_sleeper_1_2.userData.sculptComponent = {"id": "sleeper-1", "name": "Sleeper 2", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-1-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-1-ends"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood-dark"}, "materialRegions": [{"regionId": "sleeper-wood", "materialId": "wood-dark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}}]};
  node_sleeper_1_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_1_2);
  nodes["sleeper-1"] = node_sleeper_1_2;
  const mesh_sleeper_1_2Geometry = endpoint_sleeper_1_2
    ? new THREE.CylinderGeometry(endpoint_sleeper_1_2.endRadius, endpoint_sleeper_1_2.baseRadius, endpoint_sleeper_1_2.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_1_2) {
    mesh_sleeper_1_2Geometry.scale(0.18, 0.07, 1.0);
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
  mesh_sleeper_1_2.userData.sculptComponent = {"id": "sleeper-1", "name": "Sleeper 2", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-1-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-1-ends"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood-dark"}, "materialRegions": [{"regionId": "sleeper-wood", "materialId": "wood-dark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/01-sleeper-wood.png", "bbox": {"x": 505, "y": 660, "width": 110, "height": 30}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0031}}]};
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
    node_sleeper_2_3.position.set(0.5, 0.055, 0.0);
    node_sleeper_2_3.rotation.set(-0.0, 0.0, -0.0);
  }
  node_sleeper_2_3.userData.sculptComponent = {"id": "sleeper-2", "name": "Sleeper 3", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-2-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-2-ends"]};
  node_sleeper_2_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_sleeper_2_3);
  nodes["sleeper-2"] = node_sleeper_2_3;
  const mesh_sleeper_2_3Geometry = endpoint_sleeper_2_3
    ? new THREE.CylinderGeometry(endpoint_sleeper_2_3.endRadius, endpoint_sleeper_2_3.baseRadius, endpoint_sleeper_2_3.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_sleeper_2_3) {
    mesh_sleeper_2_3Geometry.scale(0.18, 0.07, 1.0);
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
  mesh_sleeper_2_3.userData.sculptComponent = {"id": "sleeper-2", "name": "Sleeper 3", "level": "macro", "role": "panel", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sleeper 3: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.18, "height": 0.07, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.5, 0.055, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.18, 0.07, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sleeper-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sleeper-2-ends", "kind": "chip", "description": "rounded worn sleeper ends", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["sleeper-2-ends"]};
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
  node_rail_near_4.userData.sculptComponent = {"id": "rail-near", "name": "Rail (near)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (near): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.36, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.36, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-near-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-near-head"]};
  node_rail_near_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rail_near_4);
  nodes["rail-near"] = node_rail_near_4;
  const mesh_rail_near_4Geometry = endpoint_rail_near_4
    ? new THREE.CylinderGeometry(endpoint_rail_near_4.endRadius, endpoint_rail_near_4.baseRadius, endpoint_rail_near_4.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_rail_near_4) {
    mesh_rail_near_4Geometry.scale(1.36, 0.07, 0.06);
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
  mesh_rail_near_4.userData.sculptComponent = {"id": "rail-near", "name": "Rail (near)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (near): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.36, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, 0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.36, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-near-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-near-head"]};
  node_rail_near_4.add(mesh_rail_near_4);
  meshes["rail-near"] = mesh_rail_near_4;
  colliders["rail-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["rail-near"] ??= [];
  destructionGroups["rail-near"].push(node_rail_near_4);

  const endpoint_rail_far_5 = makeAttachmentEndpoint(null);
  const node_rail_far_5 = new THREE.Group();
  node_rail_far_5.name = "Rail (far)__pivot";
  node_rail_far_5.scale.set(1, 1, 1);
  if (endpoint_rail_far_5) {
    node_rail_far_5.position.copy(endpoint_rail_far_5.start);
    node_rail_far_5.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_rail_far_5.position.set(0.0, 0.125, -0.335);
    node_rail_far_5.rotation.set(-0.0, 0.0, -0.0);
  }
  node_rail_far_5.userData.sculptComponent = {"id": "rail-far", "name": "Rail (far)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (far): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.36, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.36, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-far-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-far-head"]};
  node_rail_far_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rail_far_5);
  nodes["rail-far"] = node_rail_far_5;
  const mesh_rail_far_5Geometry = endpoint_rail_far_5
    ? new THREE.CylinderGeometry(endpoint_rail_far_5.endRadius, endpoint_rail_far_5.baseRadius, endpoint_rail_far_5.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_rail_far_5) {
    mesh_rail_far_5Geometry.scale(1.36, 0.07, 0.06);
  }
  const mesh_rail_far_5 = new THREE.Mesh(
    mesh_rail_far_5Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rail_far_5.name = "Rail (far)";
  if (endpoint_rail_far_5) {
    mesh_rail_far_5.position.copy(endpoint_rail_far_5.midpoint);
    mesh_rail_far_5.quaternion.copy(endpoint_rail_far_5.quaternion);
  }
  mesh_rail_far_5.castShadow = options.castShadow ?? true;
  mesh_rail_far_5.receiveShadow = options.receiveShadow ?? true;
  mesh_rail_far_5.userData.sculptComponent = {"id": "rail-far", "name": "Rail (far)", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rail (far): discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.36, "height": 0.07, "depth": 0.06, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.125, -0.335], "rotation": [-0.0, 0.0, -0.0], "scale": [1.36, 0.07, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-far-head", "kind": "ridge", "description": "rail head catches a highlight along its top edge", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["rail-far-head"]};
  node_rail_far_5.add(mesh_rail_far_5);
  meshes["rail-far"] = mesh_rail_far_5;
  colliders["rail-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["rail-far"] ??= [];
  destructionGroups["rail-far"].push(node_rail_far_5);

  const endpoint_chassis_frame_6 = makeAttachmentEndpoint(null);
  const node_chassis_frame_6 = new THREE.Group();
  node_chassis_frame_6.name = "Chassis frame__pivot";
  node_chassis_frame_6.scale.set(1, 1, 1);
  if (endpoint_chassis_frame_6) {
    node_chassis_frame_6.position.copy(endpoint_chassis_frame_6.start);
    node_chassis_frame_6.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_chassis_frame_6.position.set(0.0, 0.41, 0.0);
    node_chassis_frame_6.rotation.set(-0.0, 0.0, -0.0);
  }
  node_chassis_frame_6.userData.sculptComponent = {"id": "chassis-frame", "name": "Chassis frame", "level": "macro", "role": "frame", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chassis frame: a flat rigid beam frame under the tub, box-shaped; the axles run through it.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.84, "height": 0.12, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.41, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.84, 0.12, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_chassis_frame_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}};
  (nodes["root"] ?? root).add(node_chassis_frame_6);
  nodes["chassis-frame"] = node_chassis_frame_6;
  const mesh_chassis_frame_6Geometry = endpoint_chassis_frame_6
    ? new THREE.CylinderGeometry(endpoint_chassis_frame_6.endRadius, endpoint_chassis_frame_6.baseRadius, endpoint_chassis_frame_6.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_chassis_frame_6) {
    mesh_chassis_frame_6Geometry.scale(0.84, 0.12, 0.5);
  }
  const mesh_chassis_frame_6 = new THREE.Mesh(
    mesh_chassis_frame_6Geometry,
    materialMap["wood-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chassis_frame_6.name = "Chassis frame";
  if (endpoint_chassis_frame_6) {
    mesh_chassis_frame_6.position.copy(endpoint_chassis_frame_6.midpoint);
    mesh_chassis_frame_6.quaternion.copy(endpoint_chassis_frame_6.quaternion);
  }
  mesh_chassis_frame_6.castShadow = options.castShadow ?? true;
  mesh_chassis_frame_6.receiveShadow = options.receiveShadow ?? true;
  mesh_chassis_frame_6.userData.sculptComponent = {"id": "chassis-frame", "name": "Chassis frame", "level": "macro", "role": "frame", "importance": 0.5, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chassis frame: a flat rigid beam frame under the tub, box-shaped; the axles run through it.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.84, "height": 0.12, "depth": 0.5, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.41, 0.0], "rotation": [-0.0, 0.0, -0.0], "scale": [0.84, 0.12, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis-frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-dark"}}, "material": "wood-dark", "materialLayers": ["wood-dark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(112, 67, 36, 1.0)", "secondaryAlbedo": "rgba(88, 52, 28, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(88, 52, 28, 1.0)"}, {"position": 1.0, "color": "rgba(112, 67, 36, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.176, "bumpAmplitude": 0.015, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_chassis_frame_6.add(mesh_chassis_frame_6);
  meshes["chassis-frame"] = mesh_chassis_frame_6;
  colliders["chassis-frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["chassis-frame"] ??= [];
  destructionGroups["chassis-frame"].push(node_chassis_frame_6);

  const endpoint_wheel_fn_7 = makeAttachmentEndpoint(null);
  const node_wheel_fn_7 = new THREE.Group();
  node_wheel_fn_7.name = "Wheel fn__pivot";
  node_wheel_fn_7.scale.set(1, 1, 1);
  if (endpoint_wheel_fn_7) {
    node_wheel_fn_7.position.copy(endpoint_wheel_fn_7.start);
    node_wheel_fn_7.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_fn_7.position.set(-0.3, -0.085, 0.335);
    node_wheel_fn_7.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_fn_7.userData.sculptComponent = {"id": "wheel-fn", "name": "Wheel fn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, 0.3], "localEnd": [-0.3, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-fn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-fn-planks"]};
  node_wheel_fn_7.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_fn_7);
  nodes["wheel-fn"] = node_wheel_fn_7;
  const mesh_wheel_fn_7Geometry = endpoint_wheel_fn_7
    ? new THREE.CylinderGeometry(endpoint_wheel_fn_7.endRadius, endpoint_wheel_fn_7.baseRadius, endpoint_wheel_fn_7.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_fn_7) {
    mesh_wheel_fn_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_fn_7 = new THREE.Mesh(
    mesh_wheel_fn_7Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_fn_7.name = "Wheel fn";
  if (endpoint_wheel_fn_7) {
    mesh_wheel_fn_7.position.copy(endpoint_wheel_fn_7.midpoint);
    mesh_wheel_fn_7.quaternion.copy(endpoint_wheel_fn_7.quaternion);
  }
  mesh_wheel_fn_7.castShadow = options.castShadow ?? true;
  mesh_wheel_fn_7.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_fn_7.userData.sculptComponent = {"id": "wheel-fn", "name": "Wheel fn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, 0.3], "localEnd": [-0.3, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-fn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-fn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-fn-planks"]};
  node_wheel_fn_7.add(mesh_wheel_fn_7);
  meshes["wheel-fn"] = mesh_wheel_fn_7;
  colliders["wheel-fn"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-fn"] ??= [];
  destructionGroups["wheel-fn"].push(node_wheel_fn_7);

  const endpoint_wheel_rn_8 = makeAttachmentEndpoint(null);
  const node_wheel_rn_8 = new THREE.Group();
  node_wheel_rn_8.name = "Wheel rn__pivot";
  node_wheel_rn_8.scale.set(1, 1, 1);
  if (endpoint_wheel_rn_8) {
    node_wheel_rn_8.position.copy(endpoint_wheel_rn_8.start);
    node_wheel_rn_8.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_rn_8.position.set(0.22, -0.085, 0.335);
    node_wheel_rn_8.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_rn_8.userData.sculptComponent = {"id": "wheel-rn", "name": "Wheel rn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, 0.3], "localEnd": [0.22, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rn-planks"]};
  node_wheel_rn_8.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_rn_8);
  nodes["wheel-rn"] = node_wheel_rn_8;
  const mesh_wheel_rn_8Geometry = endpoint_wheel_rn_8
    ? new THREE.CylinderGeometry(endpoint_wheel_rn_8.endRadius, endpoint_wheel_rn_8.baseRadius, endpoint_wheel_rn_8.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_rn_8) {
    mesh_wheel_rn_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_rn_8 = new THREE.Mesh(
    mesh_wheel_rn_8Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rn_8.name = "Wheel rn";
  if (endpoint_wheel_rn_8) {
    mesh_wheel_rn_8.position.copy(endpoint_wheel_rn_8.midpoint);
    mesh_wheel_rn_8.quaternion.copy(endpoint_wheel_rn_8.quaternion);
  }
  mesh_wheel_rn_8.castShadow = options.castShadow ?? true;
  mesh_wheel_rn_8.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rn_8.userData.sculptComponent = {"id": "wheel-rn", "name": "Wheel rn", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, 0.3], "localEnd": [0.22, -0.085, 0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, 0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rn", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rn-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rn-planks"]};
  node_wheel_rn_8.add(mesh_wheel_rn_8);
  meshes["wheel-rn"] = mesh_wheel_rn_8;
  colliders["wheel-rn"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rn"] ??= [];
  destructionGroups["wheel-rn"].push(node_wheel_rn_8);

  const endpoint_wheel_ff_9 = makeAttachmentEndpoint(null);
  const node_wheel_ff_9 = new THREE.Group();
  node_wheel_ff_9.name = "Wheel ff__pivot";
  node_wheel_ff_9.scale.set(1, 1, 1);
  if (endpoint_wheel_ff_9) {
    node_wheel_ff_9.position.copy(endpoint_wheel_ff_9.start);
    node_wheel_ff_9.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_ff_9.position.set(-0.3, -0.085, -0.335);
    node_wheel_ff_9.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_ff_9.userData.sculptComponent = {"id": "wheel-ff", "name": "Wheel ff", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, -0.3], "localEnd": [-0.3, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ff-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-ff-planks"]};
  node_wheel_ff_9.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_ff_9);
  nodes["wheel-ff"] = node_wheel_ff_9;
  const mesh_wheel_ff_9Geometry = endpoint_wheel_ff_9
    ? new THREE.CylinderGeometry(endpoint_wheel_ff_9.endRadius, endpoint_wheel_ff_9.baseRadius, endpoint_wheel_ff_9.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_ff_9) {
    mesh_wheel_ff_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_ff_9 = new THREE.Mesh(
    mesh_wheel_ff_9Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_ff_9.name = "Wheel ff";
  if (endpoint_wheel_ff_9) {
    mesh_wheel_ff_9.position.copy(endpoint_wheel_ff_9.midpoint);
    mesh_wheel_ff_9.quaternion.copy(endpoint_wheel_ff_9.quaternion);
  }
  mesh_wheel_ff_9.castShadow = options.castShadow ?? true;
  mesh_wheel_ff_9.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_ff_9.userData.sculptComponent = {"id": "wheel-ff", "name": "Wheel ff", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-front:end", "localStart": [-0.3, -0.085, -0.3], "localEnd": [-0.3, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.3, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-ff", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-ff-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-ff-planks"]};
  node_wheel_ff_9.add(mesh_wheel_ff_9);
  meshes["wheel-ff"] = mesh_wheel_ff_9;
  colliders["wheel-ff"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-ff"] ??= [];
  destructionGroups["wheel-ff"].push(node_wheel_ff_9);

  const endpoint_wheel_rf_10 = makeAttachmentEndpoint(null);
  const node_wheel_rf_10 = new THREE.Group();
  node_wheel_rf_10.name = "Wheel rf__pivot";
  node_wheel_rf_10.scale.set(1, 1, 1);
  if (endpoint_wheel_rf_10) {
    node_wheel_rf_10.position.copy(endpoint_wheel_rf_10.start);
    node_wheel_rf_10.rotation.set(1.5708, 0.0, -0.0);
  } else {
    node_wheel_rf_10.position.set(0.22, -0.085, -0.335);
    node_wheel_rf_10.rotation.set(1.5708, 0.0, -0.0);
  }
  node_wheel_rf_10.userData.sculptComponent = {"id": "wheel-rf", "name": "Wheel rf", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, -0.3], "localEnd": [0.22, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rf-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rf-planks"]};
  node_wheel_rf_10.userData.actionProfile = {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_wheel_rf_10);
  nodes["wheel-rf"] = node_wheel_rf_10;
  const mesh_wheel_rf_10Geometry = endpoint_wheel_rf_10
    ? new THREE.CylinderGeometry(endpoint_wheel_rf_10.endRadius, endpoint_wheel_rf_10.baseRadius, endpoint_wheel_rf_10.length, 8, 4)
    : buildLatheGeometry({"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20});
  if (!endpoint_wheel_rf_10) {
    mesh_wheel_rf_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_rf_10 = new THREE.Mesh(
    mesh_wheel_rf_10Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rf_10.name = "Wheel rf";
  if (endpoint_wheel_rf_10) {
    mesh_wheel_rf_10.position.copy(endpoint_wheel_rf_10.midpoint);
    mesh_wheel_rf_10.quaternion.copy(endpoint_wheel_rf_10.quaternion);
  }
  mesh_wheel_rf_10.castShadow = options.castShadow ?? true;
  mesh_wheel_rf_10.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rf_10.userData.sculptComponent = {"id": "wheel-rf", "name": "Wheel rf", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation tier; spun about the axle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0, -0.035], [0.165, -0.035], [0.165, 0.035], [0.0, 0.035]], "segments": 20}}, "parent": "chassis-frame", "attachment": {"parentId": "chassis-frame", "parentSocket": "axle-rear:end", "localStart": [0.22, -0.085, -0.3], "localEnd": [0.22, -0.085, -0.37], "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.22, -0.085, -0.335], "rotation": [1.5708, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-rf", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wheel-rf-planks", "kind": "seam", "description": "the disc reads as vertical planks", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["wheel-rf-planks"]};
  node_wheel_rf_10.add(mesh_wheel_rf_10);
  meshes["wheel-rf"] = mesh_wheel_rf_10;
  colliders["wheel-rf"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["wheel-rf"] ??= [];
  destructionGroups["wheel-rf"].push(node_wheel_rf_10);

  const endpoint_tub_core_11 = makeAttachmentEndpoint(null);
  const node_tub_core_11 = new THREE.Group();
  node_tub_core_11.name = "Tub body__pivot";
  node_tub_core_11.scale.set(1, 1, 1);
  if (endpoint_tub_core_11) {
    node_tub_core_11.position.copy(endpoint_tub_core_11.start);
    node_tub_core_11.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tub_core_11.position.set(0.0, 0.06, -0.26);
    node_tub_core_11.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tub_core_11.userData.sculptComponent = {"id": "tub-core", "name": "Tub body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Tub body: one continuous tapered volume (an inverted frustum); extruded from its measured side profile so the end walls lean out as in the reference, never a plain box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.43, 0.0], [0.43, 0.0], [0.48, 0.55], [-0.48, 0.55]], "depth": 0.52}}, "parent": "chassis-frame", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.06, -0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tub-taper", "kind": "contour", "description": "end walls lean outward ~5 degrees, long walls ~7 degrees", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tub-taper"]};
  node_tub_core_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["chassis-frame"] ?? root).add(node_tub_core_11);
  nodes["tub-core"] = node_tub_core_11;
  const mesh_tub_core_11Geometry = endpoint_tub_core_11
    ? new THREE.CylinderGeometry(endpoint_tub_core_11.endRadius, endpoint_tub_core_11.baseRadius, endpoint_tub_core_11.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.43, 0.0], [0.43, 0.0], [0.48, 0.55], [-0.48, 0.55]], "depth": 0.52});
  if (!endpoint_tub_core_11) {
    mesh_tub_core_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tub_core_11 = new THREE.Mesh(
    mesh_tub_core_11Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tub_core_11.name = "Tub body";
  if (endpoint_tub_core_11) {
    mesh_tub_core_11.position.copy(endpoint_tub_core_11.midpoint);
    mesh_tub_core_11.quaternion.copy(endpoint_tub_core_11.quaternion);
  }
  mesh_tub_core_11.castShadow = options.castShadow ?? true;
  mesh_tub_core_11.receiveShadow = options.receiveShadow ?? true;
  mesh_tub_core_11.userData.sculptComponent = {"id": "tub-core", "name": "Tub body", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Tub body: one continuous tapered volume (an inverted frustum); extruded from its measured side profile so the end walls lean out as in the reference, never a plain box.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.43, 0.0], [0.43, 0.0], [0.48, 0.55], [-0.48, 0.55]], "depth": 0.52}}, "parent": "chassis-frame", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.06, -0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tub-core", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tub-taper", "kind": "contour", "description": "end walls lean outward ~5 degrees, long walls ~7 degrees", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["tub-taper"]};
  node_tub_core_11.add(mesh_tub_core_11);
  meshes["tub-core"] = mesh_tub_core_11;
  colliders["tub-core"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["tub-core"] ??= [];
  destructionGroups["tub-core"].push(node_tub_core_11);

  const endpoint_post_nl_12 = makeAttachmentEndpoint(null);
  const node_post_nl_12 = new THREE.Group();
  node_post_nl_12.name = "Corner post nl__pivot";
  node_post_nl_12.scale.set(1, 1, 1);
  if (endpoint_post_nl_12) {
    node_post_nl_12.position.copy(endpoint_post_nl_12.start);
    node_post_nl_12.rotation.set(0.12659, 0.0, 0.09066);
  } else {
    node_post_nl_12.position.set(-0.435, 0.275, 0.535);
    node_post_nl_12.rotation.set(0.12659, 0.0, 0.09066);
  }
  node_post_nl_12.userData.sculptComponent = {"id": "post-nl", "name": "Corner post nl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.435, 0.275, 0.535], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nl_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_nl_12);
  nodes["post-nl"] = node_post_nl_12;
  const mesh_post_nl_12Geometry = endpoint_post_nl_12
    ? new THREE.CylinderGeometry(endpoint_post_nl_12.endRadius, endpoint_post_nl_12.baseRadius, endpoint_post_nl_12.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_nl_12) {
    mesh_post_nl_12Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_nl_12 = new THREE.Mesh(
    mesh_post_nl_12Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_nl_12.name = "Corner post nl";
  if (endpoint_post_nl_12) {
    mesh_post_nl_12.position.copy(endpoint_post_nl_12.midpoint);
    mesh_post_nl_12.quaternion.copy(endpoint_post_nl_12.quaternion);
  }
  mesh_post_nl_12.castShadow = options.castShadow ?? true;
  mesh_post_nl_12.receiveShadow = options.receiveShadow ?? true;
  mesh_post_nl_12.userData.sculptComponent = {"id": "post-nl", "name": "Corner post nl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.435, 0.275, 0.535], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nl_12.add(mesh_post_nl_12);
  meshes["post-nl"] = mesh_post_nl_12;
  colliders["post-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-nl"] ??= [];
  destructionGroups["post-nl"].push(node_post_nl_12);

  const endpoint_bracket_top_nl_13 = makeAttachmentEndpoint(null);
  const node_bracket_top_nl_13 = new THREE.Group();
  node_bracket_top_nl_13.name = "Bracket top nl__pivot";
  node_bracket_top_nl_13.scale.set(1, 1, 1);
  if (endpoint_bracket_top_nl_13) {
    node_bracket_top_nl_13.position.copy(endpoint_bracket_top_nl_13.start);
    node_bracket_top_nl_13.rotation.set(0.12659, 0.0, 0.09066);
  } else {
    node_bracket_top_nl_13.position.set(-0.4325, 0.495, 0.5405);
    node_bracket_top_nl_13.rotation.set(0.12659, 0.0, 0.09066);
  }
  node_bracket_top_nl_13.userData.sculptComponent = {"id": "bracket-top-nl", "name": "Bracket top nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4325, 0.495, 0.5405], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nl-chamfer", "bracket-top-nl-rivets"]};
  node_bracket_top_nl_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_nl_13);
  nodes["bracket-top-nl"] = node_bracket_top_nl_13;
  const mesh_bracket_top_nl_13Geometry = endpoint_bracket_top_nl_13
    ? new THREE.CylinderGeometry(endpoint_bracket_top_nl_13.endRadius, endpoint_bracket_top_nl_13.baseRadius, endpoint_bracket_top_nl_13.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_nl_13) {
    mesh_bracket_top_nl_13Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_nl_13 = new THREE.Mesh(
    mesh_bracket_top_nl_13Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_nl_13.name = "Bracket top nl";
  if (endpoint_bracket_top_nl_13) {
    mesh_bracket_top_nl_13.position.copy(endpoint_bracket_top_nl_13.midpoint);
    mesh_bracket_top_nl_13.quaternion.copy(endpoint_bracket_top_nl_13.quaternion);
  }
  mesh_bracket_top_nl_13.castShadow = options.castShadow ?? true;
  mesh_bracket_top_nl_13.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_nl_13.userData.sculptComponent = {"id": "bracket-top-nl", "name": "Bracket top nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4325, 0.495, 0.5405], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nl-chamfer", "bracket-top-nl-rivets"]};
  node_bracket_top_nl_13.add(mesh_bracket_top_nl_13);
  meshes["bracket-top-nl"] = mesh_bracket_top_nl_13;
  colliders["bracket-top-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-nl"] ??= [];
  destructionGroups["bracket-top-nl"].push(node_bracket_top_nl_13);

  const endpoint_bracket_bot_nl_14 = makeAttachmentEndpoint(null);
  const node_bracket_bot_nl_14 = new THREE.Group();
  node_bracket_bot_nl_14.name = "Bracket bot nl__pivot";
  node_bracket_bot_nl_14.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_nl_14) {
    node_bracket_bot_nl_14.position.copy(endpoint_bracket_bot_nl_14.start);
    node_bracket_bot_nl_14.rotation.set(0.12659, 0.0, 0.09066);
  } else {
    node_bracket_bot_nl_14.position.set(-0.4005, 0.06, 0.4926);
    node_bracket_bot_nl_14.rotation.set(0.12659, 0.0, 0.09066);
  }
  node_bracket_bot_nl_14.userData.sculptComponent = {"id": "bracket-bot-nl", "name": "Bracket bot nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4005, 0.06, 0.4926], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nl-chamfer", "bracket-bot-nl-rivets"]};
  node_bracket_bot_nl_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_nl_14);
  nodes["bracket-bot-nl"] = node_bracket_bot_nl_14;
  const mesh_bracket_bot_nl_14Geometry = endpoint_bracket_bot_nl_14
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_nl_14.endRadius, endpoint_bracket_bot_nl_14.baseRadius, endpoint_bracket_bot_nl_14.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_nl_14) {
    mesh_bracket_bot_nl_14Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_nl_14 = new THREE.Mesh(
    mesh_bracket_bot_nl_14Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_nl_14.name = "Bracket bot nl";
  if (endpoint_bracket_bot_nl_14) {
    mesh_bracket_bot_nl_14.position.copy(endpoint_bracket_bot_nl_14.midpoint);
    mesh_bracket_bot_nl_14.quaternion.copy(endpoint_bracket_bot_nl_14.quaternion);
  }
  mesh_bracket_bot_nl_14.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_nl_14.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_nl_14.userData.sculptComponent = {"id": "bracket-bot-nl", "name": "Bracket bot nl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4005, 0.06, 0.4926], "rotation": [0.12659, 0.0, 0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nl-chamfer", "bracket-bot-nl-rivets"]};
  node_bracket_bot_nl_14.add(mesh_bracket_bot_nl_14);
  meshes["bracket-bot-nl"] = mesh_bracket_bot_nl_14;
  colliders["bracket-bot-nl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-nl"] ??= [];
  destructionGroups["bracket-bot-nl"].push(node_bracket_bot_nl_14);

  const endpoint_post_nr_15 = makeAttachmentEndpoint(null);
  const node_post_nr_15 = new THREE.Group();
  node_post_nr_15.name = "Corner post nr__pivot";
  node_post_nr_15.scale.set(1, 1, 1);
  if (endpoint_post_nr_15) {
    node_post_nr_15.position.copy(endpoint_post_nr_15.start);
    node_post_nr_15.rotation.set(0.12659, 0.0, -0.09066);
  } else {
    node_post_nr_15.position.set(0.435, 0.275, 0.535);
    node_post_nr_15.rotation.set(0.12659, 0.0, -0.09066);
  }
  node_post_nr_15.userData.sculptComponent = {"id": "post-nr", "name": "Corner post nr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.435, 0.275, 0.535], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nr_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_nr_15);
  nodes["post-nr"] = node_post_nr_15;
  const mesh_post_nr_15Geometry = endpoint_post_nr_15
    ? new THREE.CylinderGeometry(endpoint_post_nr_15.endRadius, endpoint_post_nr_15.baseRadius, endpoint_post_nr_15.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_nr_15) {
    mesh_post_nr_15Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_nr_15 = new THREE.Mesh(
    mesh_post_nr_15Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_nr_15.name = "Corner post nr";
  if (endpoint_post_nr_15) {
    mesh_post_nr_15.position.copy(endpoint_post_nr_15.midpoint);
    mesh_post_nr_15.quaternion.copy(endpoint_post_nr_15.quaternion);
  }
  mesh_post_nr_15.castShadow = options.castShadow ?? true;
  mesh_post_nr_15.receiveShadow = options.receiveShadow ?? true;
  mesh_post_nr_15.userData.sculptComponent = {"id": "post-nr", "name": "Corner post nr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.435, 0.275, 0.535], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_nr_15.add(mesh_post_nr_15);
  meshes["post-nr"] = mesh_post_nr_15;
  colliders["post-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-nr"] ??= [];
  destructionGroups["post-nr"].push(node_post_nr_15);

  const endpoint_bracket_top_nr_16 = makeAttachmentEndpoint(null);
  const node_bracket_top_nr_16 = new THREE.Group();
  node_bracket_top_nr_16.name = "Bracket top nr__pivot";
  node_bracket_top_nr_16.scale.set(1, 1, 1);
  if (endpoint_bracket_top_nr_16) {
    node_bracket_top_nr_16.position.copy(endpoint_bracket_top_nr_16.start);
    node_bracket_top_nr_16.rotation.set(0.12659, 0.0, -0.09066);
  } else {
    node_bracket_top_nr_16.position.set(0.4325, 0.495, 0.5405);
    node_bracket_top_nr_16.rotation.set(0.12659, 0.0, -0.09066);
  }
  node_bracket_top_nr_16.userData.sculptComponent = {"id": "bracket-top-nr", "name": "Bracket top nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4325, 0.495, 0.5405], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nr-chamfer", "bracket-top-nr-rivets"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "iron"}, "materialRegions": [{"regionId": "bracket-iron", "materialId": "iron", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}}]};
  node_bracket_top_nr_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_nr_16);
  nodes["bracket-top-nr"] = node_bracket_top_nr_16;
  const mesh_bracket_top_nr_16Geometry = endpoint_bracket_top_nr_16
    ? new THREE.CylinderGeometry(endpoint_bracket_top_nr_16.endRadius, endpoint_bracket_top_nr_16.baseRadius, endpoint_bracket_top_nr_16.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_nr_16) {
    mesh_bracket_top_nr_16Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_nr_16 = new THREE.Mesh(
    mesh_bracket_top_nr_16Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_nr_16.name = "Bracket top nr";
  if (endpoint_bracket_top_nr_16) {
    mesh_bracket_top_nr_16.position.copy(endpoint_bracket_top_nr_16.midpoint);
    mesh_bracket_top_nr_16.quaternion.copy(endpoint_bracket_top_nr_16.quaternion);
  }
  mesh_bracket_top_nr_16.castShadow = options.castShadow ?? true;
  mesh_bracket_top_nr_16.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_nr_16.userData.sculptComponent = {"id": "bracket-top-nr", "name": "Bracket top nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4325, 0.495, 0.5405], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-nr-chamfer", "bracket-top-nr-rivets"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "iron"}, "materialRegions": [{"regionId": "bracket-iron", "materialId": "iron", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/02-bracket-iron.png", "bbox": {"x": 740, "y": 232, "width": 80, "height": 50}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0037}}]};
  node_bracket_top_nr_16.add(mesh_bracket_top_nr_16);
  meshes["bracket-top-nr"] = mesh_bracket_top_nr_16;
  colliders["bracket-top-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-nr"] ??= [];
  destructionGroups["bracket-top-nr"].push(node_bracket_top_nr_16);

  const endpoint_bracket_bot_nr_17 = makeAttachmentEndpoint(null);
  const node_bracket_bot_nr_17 = new THREE.Group();
  node_bracket_bot_nr_17.name = "Bracket bot nr__pivot";
  node_bracket_bot_nr_17.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_nr_17) {
    node_bracket_bot_nr_17.position.copy(endpoint_bracket_bot_nr_17.start);
    node_bracket_bot_nr_17.rotation.set(0.12659, 0.0, -0.09066);
  } else {
    node_bracket_bot_nr_17.position.set(0.4005, 0.06, 0.4926);
    node_bracket_bot_nr_17.rotation.set(0.12659, 0.0, -0.09066);
  }
  node_bracket_bot_nr_17.userData.sculptComponent = {"id": "bracket-bot-nr", "name": "Bracket bot nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4005, 0.06, 0.4926], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nr-chamfer", "bracket-bot-nr-rivets"]};
  node_bracket_bot_nr_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_nr_17);
  nodes["bracket-bot-nr"] = node_bracket_bot_nr_17;
  const mesh_bracket_bot_nr_17Geometry = endpoint_bracket_bot_nr_17
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_nr_17.endRadius, endpoint_bracket_bot_nr_17.baseRadius, endpoint_bracket_bot_nr_17.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_nr_17) {
    mesh_bracket_bot_nr_17Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_nr_17 = new THREE.Mesh(
    mesh_bracket_bot_nr_17Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_nr_17.name = "Bracket bot nr";
  if (endpoint_bracket_bot_nr_17) {
    mesh_bracket_bot_nr_17.position.copy(endpoint_bracket_bot_nr_17.midpoint);
    mesh_bracket_bot_nr_17.quaternion.copy(endpoint_bracket_bot_nr_17.quaternion);
  }
  mesh_bracket_bot_nr_17.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_nr_17.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_nr_17.userData.sculptComponent = {"id": "bracket-bot-nr", "name": "Bracket bot nr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot nr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4005, 0.06, 0.4926], "rotation": [0.12659, 0.0, -0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-nr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-nr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-nr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-nr-chamfer", "bracket-bot-nr-rivets"]};
  node_bracket_bot_nr_17.add(mesh_bracket_bot_nr_17);
  meshes["bracket-bot-nr"] = mesh_bracket_bot_nr_17;
  colliders["bracket-bot-nr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-nr"] ??= [];
  destructionGroups["bracket-bot-nr"].push(node_bracket_bot_nr_17);

  const endpoint_post_fl_18 = makeAttachmentEndpoint(null);
  const node_post_fl_18 = new THREE.Group();
  node_post_fl_18.name = "Corner post fl__pivot";
  node_post_fl_18.scale.set(1, 1, 1);
  if (endpoint_post_fl_18) {
    node_post_fl_18.position.copy(endpoint_post_fl_18.start);
    node_post_fl_18.rotation.set(-0.12659, 0.0, 0.09066);
  } else {
    node_post_fl_18.position.set(-0.435, 0.275, -0.015);
    node_post_fl_18.rotation.set(-0.12659, 0.0, 0.09066);
  }
  node_post_fl_18.userData.sculptComponent = {"id": "post-fl", "name": "Corner post fl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.435, 0.275, -0.015], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fl_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_fl_18);
  nodes["post-fl"] = node_post_fl_18;
  const mesh_post_fl_18Geometry = endpoint_post_fl_18
    ? new THREE.CylinderGeometry(endpoint_post_fl_18.endRadius, endpoint_post_fl_18.baseRadius, endpoint_post_fl_18.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_fl_18) {
    mesh_post_fl_18Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_fl_18 = new THREE.Mesh(
    mesh_post_fl_18Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_fl_18.name = "Corner post fl";
  if (endpoint_post_fl_18) {
    mesh_post_fl_18.position.copy(endpoint_post_fl_18.midpoint);
    mesh_post_fl_18.quaternion.copy(endpoint_post_fl_18.quaternion);
  }
  mesh_post_fl_18.castShadow = options.castShadow ?? true;
  mesh_post_fl_18.receiveShadow = options.receiveShadow ?? true;
  mesh_post_fl_18.userData.sculptComponent = {"id": "post-fl", "name": "Corner post fl", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.435, 0.275, -0.015], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fl_18.add(mesh_post_fl_18);
  meshes["post-fl"] = mesh_post_fl_18;
  colliders["post-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-fl"] ??= [];
  destructionGroups["post-fl"].push(node_post_fl_18);

  const endpoint_bracket_top_fl_19 = makeAttachmentEndpoint(null);
  const node_bracket_top_fl_19 = new THREE.Group();
  node_bracket_top_fl_19.name = "Bracket top fl__pivot";
  node_bracket_top_fl_19.scale.set(1, 1, 1);
  if (endpoint_bracket_top_fl_19) {
    node_bracket_top_fl_19.position.copy(endpoint_bracket_top_fl_19.start);
    node_bracket_top_fl_19.rotation.set(-0.12659, 0.0, 0.09066);
  } else {
    node_bracket_top_fl_19.position.set(-0.4325, 0.495, -0.0205);
    node_bracket_top_fl_19.rotation.set(-0.12659, 0.0, 0.09066);
  }
  node_bracket_top_fl_19.userData.sculptComponent = {"id": "bracket-top-fl", "name": "Bracket top fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4325, 0.495, -0.0205], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fl-chamfer", "bracket-top-fl-rivets"]};
  node_bracket_top_fl_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_fl_19);
  nodes["bracket-top-fl"] = node_bracket_top_fl_19;
  const mesh_bracket_top_fl_19Geometry = endpoint_bracket_top_fl_19
    ? new THREE.CylinderGeometry(endpoint_bracket_top_fl_19.endRadius, endpoint_bracket_top_fl_19.baseRadius, endpoint_bracket_top_fl_19.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_fl_19) {
    mesh_bracket_top_fl_19Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_fl_19 = new THREE.Mesh(
    mesh_bracket_top_fl_19Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_fl_19.name = "Bracket top fl";
  if (endpoint_bracket_top_fl_19) {
    mesh_bracket_top_fl_19.position.copy(endpoint_bracket_top_fl_19.midpoint);
    mesh_bracket_top_fl_19.quaternion.copy(endpoint_bracket_top_fl_19.quaternion);
  }
  mesh_bracket_top_fl_19.castShadow = options.castShadow ?? true;
  mesh_bracket_top_fl_19.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_fl_19.userData.sculptComponent = {"id": "bracket-top-fl", "name": "Bracket top fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4325, 0.495, -0.0205], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fl-chamfer", "bracket-top-fl-rivets"]};
  node_bracket_top_fl_19.add(mesh_bracket_top_fl_19);
  meshes["bracket-top-fl"] = mesh_bracket_top_fl_19;
  colliders["bracket-top-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-fl"] ??= [];
  destructionGroups["bracket-top-fl"].push(node_bracket_top_fl_19);

  const endpoint_bracket_bot_fl_20 = makeAttachmentEndpoint(null);
  const node_bracket_bot_fl_20 = new THREE.Group();
  node_bracket_bot_fl_20.name = "Bracket bot fl__pivot";
  node_bracket_bot_fl_20.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_fl_20) {
    node_bracket_bot_fl_20.position.copy(endpoint_bracket_bot_fl_20.start);
    node_bracket_bot_fl_20.rotation.set(-0.12659, 0.0, 0.09066);
  } else {
    node_bracket_bot_fl_20.position.set(-0.4005, 0.06, 0.0274);
    node_bracket_bot_fl_20.rotation.set(-0.12659, 0.0, 0.09066);
  }
  node_bracket_bot_fl_20.userData.sculptComponent = {"id": "bracket-bot-fl", "name": "Bracket bot fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4005, 0.06, 0.0274], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fl-chamfer", "bracket-bot-fl-rivets"]};
  node_bracket_bot_fl_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_fl_20);
  nodes["bracket-bot-fl"] = node_bracket_bot_fl_20;
  const mesh_bracket_bot_fl_20Geometry = endpoint_bracket_bot_fl_20
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_fl_20.endRadius, endpoint_bracket_bot_fl_20.baseRadius, endpoint_bracket_bot_fl_20.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_fl_20) {
    mesh_bracket_bot_fl_20Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_fl_20 = new THREE.Mesh(
    mesh_bracket_bot_fl_20Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_fl_20.name = "Bracket bot fl";
  if (endpoint_bracket_bot_fl_20) {
    mesh_bracket_bot_fl_20.position.copy(endpoint_bracket_bot_fl_20.midpoint);
    mesh_bracket_bot_fl_20.quaternion.copy(endpoint_bracket_bot_fl_20.quaternion);
  }
  mesh_bracket_bot_fl_20.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_fl_20.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_fl_20.userData.sculptComponent = {"id": "bracket-bot-fl", "name": "Bracket bot fl", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fl: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.4005, 0.06, 0.0274], "rotation": [-0.12659, 0.0, 0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fl-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fl-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fl-chamfer", "bracket-bot-fl-rivets"]};
  node_bracket_bot_fl_20.add(mesh_bracket_bot_fl_20);
  meshes["bracket-bot-fl"] = mesh_bracket_bot_fl_20;
  colliders["bracket-bot-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-fl"] ??= [];
  destructionGroups["bracket-bot-fl"].push(node_bracket_bot_fl_20);

  const endpoint_post_fr_21 = makeAttachmentEndpoint(null);
  const node_post_fr_21 = new THREE.Group();
  node_post_fr_21.name = "Corner post fr__pivot";
  node_post_fr_21.scale.set(1, 1, 1);
  if (endpoint_post_fr_21) {
    node_post_fr_21.position.copy(endpoint_post_fr_21.start);
    node_post_fr_21.rotation.set(-0.12659, 0.0, -0.09066);
  } else {
    node_post_fr_21.position.set(0.435, 0.275, -0.015);
    node_post_fr_21.rotation.set(-0.12659, 0.0, -0.09066);
  }
  node_post_fr_21.userData.sculptComponent = {"id": "post-fr", "name": "Corner post fr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.435, 0.275, -0.015], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fr_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_post_fr_21);
  nodes["post-fr"] = node_post_fr_21;
  const mesh_post_fr_21Geometry = endpoint_post_fr_21
    ? new THREE.CylinderGeometry(endpoint_post_fr_21.endRadius, endpoint_post_fr_21.baseRadius, endpoint_post_fr_21.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_post_fr_21) {
    mesh_post_fr_21Geometry.scale(0.1, 0.57, 0.1);
  }
  const mesh_post_fr_21 = new THREE.Mesh(
    mesh_post_fr_21Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_post_fr_21.name = "Corner post fr";
  if (endpoint_post_fr_21) {
    mesh_post_fr_21.position.copy(endpoint_post_fr_21.midpoint);
    mesh_post_fr_21.quaternion.copy(endpoint_post_fr_21.quaternion);
  }
  mesh_post_fr_21.castShadow = options.castShadow ?? true;
  mesh_post_fr_21.receiveShadow = options.receiveShadow ?? true;
  mesh_post_fr_21.userData.sculptComponent = {"id": "post-fr", "name": "Corner post fr", "level": "macro", "role": "post", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Corner post: a square timber, box-shaped, leaning with both wall tapers.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.1, "height": 0.57, "depth": 0.1, "units": "object", "confidence": 0.75}, "transform": {"position": [0.435, 0.275, -0.015], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.1, 0.57, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "post-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_post_fr_21.add(mesh_post_fr_21);
  meshes["post-fr"] = mesh_post_fr_21;
  colliders["post-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["post-fr"] ??= [];
  destructionGroups["post-fr"].push(node_post_fr_21);

  const endpoint_bracket_top_fr_22 = makeAttachmentEndpoint(null);
  const node_bracket_top_fr_22 = new THREE.Group();
  node_bracket_top_fr_22.name = "Bracket top fr__pivot";
  node_bracket_top_fr_22.scale.set(1, 1, 1);
  if (endpoint_bracket_top_fr_22) {
    node_bracket_top_fr_22.position.copy(endpoint_bracket_top_fr_22.start);
    node_bracket_top_fr_22.rotation.set(-0.12659, 0.0, -0.09066);
  } else {
    node_bracket_top_fr_22.position.set(0.4325, 0.495, -0.0205);
    node_bracket_top_fr_22.rotation.set(-0.12659, 0.0, -0.09066);
  }
  node_bracket_top_fr_22.userData.sculptComponent = {"id": "bracket-top-fr", "name": "Bracket top fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4325, 0.495, -0.0205], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fr-chamfer", "bracket-top-fr-rivets"]};
  node_bracket_top_fr_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_top_fr_22);
  nodes["bracket-top-fr"] = node_bracket_top_fr_22;
  const mesh_bracket_top_fr_22Geometry = endpoint_bracket_top_fr_22
    ? new THREE.CylinderGeometry(endpoint_bracket_top_fr_22.endRadius, endpoint_bracket_top_fr_22.baseRadius, endpoint_bracket_top_fr_22.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_top_fr_22) {
    mesh_bracket_top_fr_22Geometry.scale(0.165, 0.13, 0.165);
  }
  const mesh_bracket_top_fr_22 = new THREE.Mesh(
    mesh_bracket_top_fr_22Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_top_fr_22.name = "Bracket top fr";
  if (endpoint_bracket_top_fr_22) {
    mesh_bracket_top_fr_22.position.copy(endpoint_bracket_top_fr_22.midpoint);
    mesh_bracket_top_fr_22.quaternion.copy(endpoint_bracket_top_fr_22.quaternion);
  }
  mesh_bracket_top_fr_22.castShadow = options.castShadow ?? true;
  mesh_bracket_top_fr_22.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_top_fr_22.userData.sculptComponent = {"id": "bracket-top-fr", "name": "Bracket top fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket top fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.165, "height": 0.13, "depth": 0.165, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4325, 0.495, -0.0205], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.165, 0.13, 0.165]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-top-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-top-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-top-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-top-fr-chamfer", "bracket-top-fr-rivets"]};
  node_bracket_top_fr_22.add(mesh_bracket_top_fr_22);
  meshes["bracket-top-fr"] = mesh_bracket_top_fr_22;
  colliders["bracket-top-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-top-fr"] ??= [];
  destructionGroups["bracket-top-fr"].push(node_bracket_top_fr_22);

  const endpoint_bracket_bot_fr_23 = makeAttachmentEndpoint(null);
  const node_bracket_bot_fr_23 = new THREE.Group();
  node_bracket_bot_fr_23.name = "Bracket bot fr__pivot";
  node_bracket_bot_fr_23.scale.set(1, 1, 1);
  if (endpoint_bracket_bot_fr_23) {
    node_bracket_bot_fr_23.position.copy(endpoint_bracket_bot_fr_23.start);
    node_bracket_bot_fr_23.rotation.set(-0.12659, 0.0, -0.09066);
  } else {
    node_bracket_bot_fr_23.position.set(0.4005, 0.06, 0.0274);
    node_bracket_bot_fr_23.rotation.set(-0.12659, 0.0, -0.09066);
  }
  node_bracket_bot_fr_23.userData.sculptComponent = {"id": "bracket-bot-fr", "name": "Bracket bot fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4005, 0.06, 0.0274], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fr-chamfer", "bracket-bot-fr-rivets"]};
  node_bracket_bot_fr_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_bracket_bot_fr_23);
  nodes["bracket-bot-fr"] = node_bracket_bot_fr_23;
  const mesh_bracket_bot_fr_23Geometry = endpoint_bracket_bot_fr_23
    ? new THREE.CylinderGeometry(endpoint_bracket_bot_fr_23.endRadius, endpoint_bracket_bot_fr_23.baseRadius, endpoint_bracket_bot_fr_23.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_bracket_bot_fr_23) {
    mesh_bracket_bot_fr_23Geometry.scale(0.15, 0.12, 0.15);
  }
  const mesh_bracket_bot_fr_23 = new THREE.Mesh(
    mesh_bracket_bot_fr_23Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bot_fr_23.name = "Bracket bot fr";
  if (endpoint_bracket_bot_fr_23) {
    mesh_bracket_bot_fr_23.position.copy(endpoint_bracket_bot_fr_23.midpoint);
    mesh_bracket_bot_fr_23.quaternion.copy(endpoint_bracket_bot_fr_23.quaternion);
  }
  mesh_bracket_bot_fr_23.castShadow = options.castShadow ?? true;
  mesh_bracket_bot_fr_23.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bot_fr_23.userData.sculptComponent = {"id": "bracket-bot-fr", "name": "Bracket bot fr", "level": "macro", "role": "bracket", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Bracket bot fr: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.15, "height": 0.12, "depth": 0.15, "units": "object", "confidence": 0.75}, "transform": {"position": [0.4005, 0.06, 0.0274], "rotation": [-0.12659, 0.0, -0.09066], "scale": [0.15, 0.12, 0.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket-bot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bracket-bot-fr-chamfer", "kind": "bevel", "description": "chamfered iron corner-cap edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}, {"id": "bracket-bot-fr-rivets", "kind": "fastener", "description": "round rivet heads, one per face centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["bracket-bot-fr-chamfer", "bracket-bot-fr-rivets"]};
  node_bracket_bot_fr_23.add(mesh_bracket_bot_fr_23);
  meshes["bracket-bot-fr"] = mesh_bracket_bot_fr_23;
  colliders["bracket-bot-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["bracket-bot-fr"] ??= [];
  destructionGroups["bracket-bot-fr"].push(node_bracket_bot_fr_23);

  const endpoint_handle_strap_near_24 = makeAttachmentEndpoint(null);
  const node_handle_strap_near_24 = new THREE.Group();
  node_handle_strap_near_24.name = "Handle strap (near)__pivot";
  node_handle_strap_near_24.scale.set(1, 1, 1);
  if (endpoint_handle_strap_near_24) {
    node_handle_strap_near_24.position.copy(endpoint_handle_strap_near_24.start);
    node_handle_strap_near_24.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_strap_near_24.position.set(0.0, -0.47, 0.43);
    node_handle_strap_near_24.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_strap_near_24.userData.sculptComponent = {"id": "handle-strap-near", "name": "Handle strap (near)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a flat bent iron bar; its side profile (up the end wall, then out to the grip) is extruded by the strap thickness so the bend reads from every angle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04}}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.51, 0.04, 0.45], "localEnd": [0.68, 0.38, 0.45], "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.47, 0.43], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-near-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-near-bolt"]};
  node_handle_strap_near_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_strap_near_24);
  nodes["handle-strap-near"] = node_handle_strap_near_24;
  const mesh_handle_strap_near_24Geometry = endpoint_handle_strap_near_24
    ? new THREE.CylinderGeometry(endpoint_handle_strap_near_24.endRadius, endpoint_handle_strap_near_24.baseRadius, endpoint_handle_strap_near_24.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04});
  if (!endpoint_handle_strap_near_24) {
    mesh_handle_strap_near_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_strap_near_24 = new THREE.Mesh(
    mesh_handle_strap_near_24Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_strap_near_24.name = "Handle strap (near)";
  if (endpoint_handle_strap_near_24) {
    mesh_handle_strap_near_24.position.copy(endpoint_handle_strap_near_24.midpoint);
    mesh_handle_strap_near_24.quaternion.copy(endpoint_handle_strap_near_24.quaternion);
  }
  mesh_handle_strap_near_24.castShadow = options.castShadow ?? true;
  mesh_handle_strap_near_24.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_strap_near_24.userData.sculptComponent = {"id": "handle-strap-near", "name": "Handle strap (near)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a flat bent iron bar; its side profile (up the end wall, then out to the grip) is extruded by the strap thickness so the bend reads from every angle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04}}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.51, 0.04, 0.45], "localEnd": [0.68, 0.38, 0.45], "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.47, 0.43], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-near", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-near-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-near-bolt"]};
  node_handle_strap_near_24.add(mesh_handle_strap_near_24);
  meshes["handle-strap-near"] = mesh_handle_strap_near_24;
  colliders["handle-strap-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-strap-near"] ??= [];
  destructionGroups["handle-strap-near"].push(node_handle_strap_near_24);

  const endpoint_handle_strap_far_25 = makeAttachmentEndpoint(null);
  const node_handle_strap_far_25 = new THREE.Group();
  node_handle_strap_far_25.name = "Handle strap (far)__pivot";
  node_handle_strap_far_25.scale.set(1, 1, 1);
  if (endpoint_handle_strap_far_25) {
    node_handle_strap_far_25.position.copy(endpoint_handle_strap_far_25.start);
    node_handle_strap_far_25.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handle_strap_far_25.position.set(0.0, -0.47, 0.05);
    node_handle_strap_far_25.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handle_strap_far_25.userData.sculptComponent = {"id": "handle-strap-far", "name": "Handle strap (far)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a flat bent iron bar; its side profile (up the end wall, then out to the grip) is extruded by the strap thickness so the bend reads from every angle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04}}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.51, 0.04, 0.07], "localEnd": [0.68, 0.38, 0.07], "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.47, 0.05], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-far-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-far-bolt"]};
  node_handle_strap_far_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}};
  (nodes["tub-core"] ?? root).add(node_handle_strap_far_25);
  nodes["handle-strap-far"] = node_handle_strap_far_25;
  const mesh_handle_strap_far_25Geometry = endpoint_handle_strap_far_25
    ? new THREE.CylinderGeometry(endpoint_handle_strap_far_25.endRadius, endpoint_handle_strap_far_25.baseRadius, endpoint_handle_strap_far_25.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04});
  if (!endpoint_handle_strap_far_25) {
    mesh_handle_strap_far_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handle_strap_far_25 = new THREE.Mesh(
    mesh_handle_strap_far_25Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_strap_far_25.name = "Handle strap (far)";
  if (endpoint_handle_strap_far_25) {
    mesh_handle_strap_far_25.position.copy(endpoint_handle_strap_far_25.midpoint);
    mesh_handle_strap_far_25.quaternion.copy(endpoint_handle_strap_far_25.quaternion);
  }
  mesh_handle_strap_far_25.castShadow = options.castShadow ?? true;
  mesh_handle_strap_far_25.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_strap_far_25.userData.sculptComponent = {"id": "handle-strap-far", "name": "Handle strap (far)", "level": "macro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Handle strap: a flat bent iron bar; its side profile (up the end wall, then out to the grip) is extruded by the strap thickness so the bend reads from every angle.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.49, 0.51], [0.535, 0.51], [0.535, 0.7999999999999999], [0.67, 0.82], [0.67, 0.87], [0.49, 0.85]], "depth": 0.04}}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "tub-core:rear-wall", "localStart": [0.51, 0.04, 0.07], "localEnd": [0.68, 0.38, 0.07], "contactType": "bolted", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.47, 0.05], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle-strap-far", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(75, 77, 83, 1.0)", "secondaryAlbedo": "rgba(56, 57, 62, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(56, 57, 62, 1.0)"}, {"position": 1.0, "color": "rgba(75, 77, 83, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handle-strap-far-bolt", "kind": "fastener", "description": "strap bolted to the end wall", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.11, "bumpAmplitude": 0.0075, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["handle-strap-far-bolt"]};
  node_handle_strap_far_25.add(mesh_handle_strap_far_25);
  meshes["handle-strap-far"] = mesh_handle_strap_far_25;
  colliders["handle-strap-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["handle-strap-far"] ??= [];
  destructionGroups["handle-strap-far"].push(node_handle_strap_far_25);

  const attachment_grip_26 = {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.68, 0.38, 0.0], "localEnd": [0.68, 0.38, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_grip_26 = makeAttachmentEndpoint(attachment_grip_26);
  const node_grip_26 = new THREE.Group();
  node_grip_26.name = "Push grip__pivot";
  node_grip_26.scale.set(1, 1, 1);
  if (endpoint_grip_26) {
    node_grip_26.position.copy(endpoint_grip_26.start);
    node_grip_26.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_grip_26.position.set(0.68, 0.38, 0.0);
    node_grip_26.rotation.set(-0.0, 0.0, -0.0);
  }
  node_grip_26.userData.sculptComponent = {"id": "grip", "name": "Push grip", "level": "macro", "role": "grip", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Push grip: a round wooden bar, a cylinder held by both straps.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.68, 0.38, 0.0], "localEnd": [0.68, 0.38, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.68, 0.38, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["tub-core"] ?? root).add(node_grip_26);
  nodes["grip"] = node_grip_26;
  const mesh_grip_26Geometry = endpoint_grip_26
    ? new THREE.CylinderGeometry(endpoint_grip_26.endRadius, endpoint_grip_26.baseRadius, endpoint_grip_26.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_grip_26) {
    mesh_grip_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_26 = new THREE.Mesh(
    mesh_grip_26Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_26.name = "Push grip";
  if (endpoint_grip_26) {
    mesh_grip_26.position.copy(endpoint_grip_26.midpoint);
    mesh_grip_26.quaternion.copy(endpoint_grip_26.quaternion);
  }
  mesh_grip_26.castShadow = options.castShadow ?? true;
  mesh_grip_26.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_26.userData.sculptComponent = {"id": "grip", "name": "Push grip", "level": "macro", "role": "grip", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Push grip: a round wooden bar, a cylinder held by both straps.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": {"parentId": "tub-core", "parentSocket": "handle-strap-near:hook", "localStart": [0.68, 0.38, 0.0], "localEnd": [0.68, 0.38, 0.52], "baseRadius": 0.035, "endRadius": 0.035, "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.68, 0.38, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(154, 90, 44, 1.0)", "secondaryAlbedo": "rgba(122, 67, 33, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(122, 67, 33, 1.0)"}, {"position": 1.0, "color": "rgba(154, 90, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.164, "bumpAmplitude": 0.0125, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_grip_26.add(mesh_grip_26);
  meshes["grip"] = mesh_grip_26;
  colliders["grip"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["grip"] ??= [];
  destructionGroups["grip"].push(node_grip_26);

  const endpoint_ore_heap_27 = makeAttachmentEndpoint(null);
  const node_ore_heap_27 = new THREE.Group();
  node_ore_heap_27.name = "Ore heap__pivot";
  node_ore_heap_27.scale.set(1, 1, 1);
  if (endpoint_ore_heap_27) {
    node_ore_heap_27.position.copy(endpoint_ore_heap_27.start);
    node_ore_heap_27.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_ore_heap_27.position.set(0.0, 0.53, 0.26);
    node_ore_heap_27.rotation.set(-0.0, 0.0, -0.0);
  }
  node_ore_heap_27.userData.sculptComponent = {"id": "ore-heap", "name": "Ore heap", "level": "macro", "role": "fill", "importance": 0.9, "confidence": 0.75, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "Ore heap: one smooth domed mass of ore filling the tub, an ellipsoid; the nuggets on it carry the faceted read.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.94, "height": 0.4, "depth": 0.66, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.53, 0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [0.94, 0.4, 0.66]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 191, 46, 1.0)", "secondaryAlbedo": "rgba(212, 154, 23, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(212, 154, 23, 1.0)"}, {"position": 1.0, "color": "rgba(240, 191, 46, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ore-dome", "kind": "contour", "description": "heap rises ~0.25 above the rim, highest near the centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["ore-dome"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "ore"}, "materialRegions": [{"regionId": "gold-ore", "materialId": "ore", "profileId": "metal.gold", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}}]};
  node_ore_heap_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}};
  (nodes["tub-core"] ?? root).add(node_ore_heap_27);
  nodes["ore-heap"] = node_ore_heap_27;
  const mesh_ore_heap_27Geometry = endpoint_ore_heap_27
    ? new THREE.CylinderGeometry(endpoint_ore_heap_27.endRadius, endpoint_ore_heap_27.baseRadius, endpoint_ore_heap_27.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 16, 10);
  if (!endpoint_ore_heap_27) {
    mesh_ore_heap_27Geometry.scale(0.94, 0.4, 0.66);
  }
  const mesh_ore_heap_27 = new THREE.Mesh(
    mesh_ore_heap_27Geometry,
    materialMap["ore"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ore_heap_27.name = "Ore heap";
  if (endpoint_ore_heap_27) {
    mesh_ore_heap_27.position.copy(endpoint_ore_heap_27.midpoint);
    mesh_ore_heap_27.quaternion.copy(endpoint_ore_heap_27.quaternion);
  }
  mesh_ore_heap_27.castShadow = options.castShadow ?? true;
  mesh_ore_heap_27.receiveShadow = options.receiveShadow ?? true;
  mesh_ore_heap_27.userData.sculptComponent = {"id": "ore-heap", "name": "Ore heap", "level": "macro", "role": "fill", "importance": 0.9, "confidence": 0.75, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "Ore heap: one smooth domed mass of ore filling the tub, an ellipsoid; the nuggets on it carry the faceted read.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "tub-core", "attachment": null, "dimensions": {"width": 0.94, "height": 0.4, "depth": 0.66, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.53, 0.26], "rotation": [-0.0, 0.0, -0.0], "scale": [0.94, 0.4, 0.66]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ore-heap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "ore"}}, "material": "ore", "materialLayers": ["ore"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 191, 46, 1.0)", "secondaryAlbedo": "rgba(212, 154, 23, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(212, 154, 23, 1.0)"}, {"position": 1.0, "color": "rgba(240, 191, 46, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ore-dome", "kind": "contour", "description": "heap rises ~0.25 above the rim, highest near the centre", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.01, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["ore-dome"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "ore"}, "materialRegions": [{"regionId": "gold-ore", "materialId": "ore", "profileId": "metal.gold", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/mine-cart/material-evidence/03-gold-ore.png", "bbox": {"x": 600, "y": 110, "width": 180, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0133}}]};
  node_ore_heap_27.add(mesh_ore_heap_27);
  meshes["ore-heap"] = mesh_ore_heap_27;
  colliders["ore-heap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["ore-heap"] ??= [];
  destructionGroups["ore-heap"].push(node_ore_heap_27);

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
  lights.userData.lightingFromPhoto = [{"role": "key light", "direction": "upper left, slightly in front", "color": "#fff4e6", "softness": "soft studio"}, {"role": "fill light", "direction": "right", "color": "#dfe6ff", "intensity": "low"}, {"role": "background", "color": "#c9c9c9", "notes": "flat light grey, faint contact shadow"}, {"role": "exposure and tone mapping", "exposure": 1.0, "toneMapping": "ACES Filmic, sRGB output", "notes": "review renders and the game both use ACES-style tone mapping at exposure ~1"}];
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
