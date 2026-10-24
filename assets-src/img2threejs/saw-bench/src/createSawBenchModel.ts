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

// Generated from ObjectSculptSpec target: Saw bench
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createSawBenchModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Saw bench";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "fovDegrees": 24.0, "aspect": 1.8333333333333333, "orientation": {"yaw": 31.0, "pitch": -6.0, "roll": 0.0}, "azimuthDeg": 31.0, "elevationDeg": 6.0, "positionHint": [2.5, 0.55, 4.1], "solveMethod": "silhouette camera fit (renders/camera-fit/camera-fit.json): clay renders of the blockout, with the reference's floor shadow reproduced by a contact shadow (render-options.json, settings from renders/camera-fit/shadow-sweep.json), vs the reference foreground mask on the Tier-1 224 grid; 667 candidates over four lenses; best IoU 0.901 at az 31, el 6, fov 24", "note": "Estimated from the image: three-quarter from the front-right (the long face toward the viewer, the right end face showing), ~14 degrees above; refined by the silhouette camera fit."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "top-board-5", "regionId": "bench-wood", "specMaterialId": "wood", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "saw-blade", "regionId": "blade-steel", "specMaterialId": "steel", "profileId": "metal.steel-brushed", "status": "proceed"}, {"componentId": "hub", "regionId": "hub-iron", "specMaterialId": "iron", "profileId": "metal.steel-brushed", "status": "proceed"}, {"componentId": "log", "regionId": "log-side", "specMaterialId": "bark", "profileId": "wood.unfinished", "status": "proceed"}, {"componentId": "log-end", "regionId": "log-end-grain", "specMaterialId": "end-grain", "profileId": "wood.unfinished", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wood"] = createSculptMaterial(
    "wood",
    {"id": "wood", "name": "Bench wood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#ad6a35", "color": "#ad6a35", "albedo": {"dominant": "#ad6a35", "secondary": ["#8a5027", "#c88a52"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#ad6a35", "#8a5027", "#c88a52"], "pattern": "mottled", "amplitude": 0.2, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"}, {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain", "role": "long grain streaks along the board"}, {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.88, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.2, "scratches": [], "chips": []}, "dirt": {"amount": 0.1, "cavityBias": 0.6, "color": "#3a2c1e"}, "localOverrides": [{"id": "bench-grain", "kind": "groove", "region": "all bench boards, along their length", "evidenceRefs": ["full-object"], "confidence": 0.7, "albedoShift": "#7a441f", "pattern": "streaked along the board", "amplitude": 0.15}, {"id": "bench-edge-wear", "kind": "chip", "region": "top and leg edges", "evidenceRefs": ["full-object"], "confidence": 0.6, "albedoShift": "#d29a62", "roughnessDelta": -0.06, "edgeWear": 0.25}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Warm orange-brown boards, lighter than the mine cart's wood.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.766, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/00-bench-wood.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.766, "estimatedFidelity": 0.766, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-00-bench-wood/wood_albedo.png", "url": "wood_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-00-bench-wood/wood_roughness.png", "url": "wood_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-00-bench-wood/wood_height.png", "url": "wood_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-00-bench-wood/wood_normal.png", "url": "wood_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-00-bench-wood/wood_ao.png", "url": "wood_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 280, "sourceHeight": 60, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 280, "height": 60}, "mask": {"backgroundColor": "#B58765", "backgroundNoise": 81.664, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9973}, "mapStats": {"valueRange": 0.2288, "heightP90Gradient": 0.02073, "roughnessBase": 0.698, "roughnessVariation": 0.05, "normalStrength": 0.181, "blurRadius": 10}, "palette": ["#8A5632", "#A06A3C", "#945F36", "#BF8E5E", "#5B3620"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#B18056", "#9D693E", "#915D35", "#8F5A34", "#815534"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 109.6, "meanSaturation": 0.615, "gradientStrength": 0.171, "mottle": 0.007, "streakRatio": 0.85, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "top-board-5", "regionId": "bench-wood", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/00-bench-wood.png", "bbox": {"x": 200, "y": 325, "width": 280, "height": 60}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0155}, "observations": ["chromatic base-colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "top-board-5", "regionId": "bench-wood", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.766, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["bark"] = createSculptMaterial(
    "bark",
    {"id": "bark", "name": "Log wood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#9b5c2c", "color": "#9b5c2c", "albedo": {"dominant": "#9b5c2c", "secondary": ["#7d4722", "#b4733c"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#9b5c2c", "#7d4722", "#b4733c"], "pattern": "mottled", "amplitude": 0.22, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"}, {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain", "role": "long grain streaks along the board"}, {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.92, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.45, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "log-bark-streaks", "kind": "scratch", "region": "log side", "evidenceRefs": ["full-object"], "confidence": 0.6, "albedoShift": "#6f3d1b", "pattern": "long streaks"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "The log's side: the same wood family, a little darker and rougher.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.776, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/03-log-side.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.776, "estimatedFidelity": 0.776, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-03-log-side/bark_albedo.png", "url": "bark_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-03-log-side/bark_roughness.png", "url": "bark_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-03-log-side/bark_height.png", "url": "bark_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-03-log-side/bark_normal.png", "url": "bark_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-03-log-side/bark_ao.png", "url": "bark_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 120, "sourceHeight": 45, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 120, "height": 45}, "mask": {"backgroundColor": "#8F6343", "backgroundNoise": 69.34, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.2686, "heightP90Gradient": 0.02072, "roughnessBase": 0.703, "roughnessVariation": 0.05, "normalStrength": 0.181, "blurRadius": 10}, "palette": ["#956946", "#9F7450", "#815534", "#6C4025", "#AC815D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#A97E5A", "#9D714F", "#966A47", "#815535", "#6F4325"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 111.1, "meanSaturation": 0.543, "gradientStrength": 0.228, "mottle": 0.006, "streakRatio": 0.78, "hueSpread": 0.001, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "log", "regionId": "log-side", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/03-log-side.png", "bbox": {"x": 850, "y": 225, "width": 120, "height": 45}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.005}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "log", "regionId": "log-side", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.776, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["end-grain"] = createSculptMaterial(
    "end-grain",
    {"id": "end-grain", "name": "Log end grain", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#efc49a", "color": "#efc49a", "albedo": {"dominant": "#efc49a", "secondary": ["#dba97a", "#f8dcbc"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#efc49a", "#dba97a", "#f8dcbc"], "pattern": "mottled", "amplitude": 0.18, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.3, "role": "heartwood to sapwood tone"}, {"id": "meso", "frequency": 9.0, "amplitude": 0.4, "pattern": "ridge", "role": "growth rings on the cut face"}, {"id": "micro", "frequency": 36.0, "amplitude": 0.08, "role": "saw marks under grazing light"}], "roughness": {"base": 0.93, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "log-end-rings", "kind": "decal", "region": "the log's cut face", "evidenceRefs": ["full-object"], "confidence": 0.7, "pattern": "growth rings"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Pale peach cut face with faint rings.", "evidenceRefs": ["full-object"], "referenceMaterialId": "wood.unfinished", "materialFamily": "wood", "materialSubtype": "generic", "materialFinish": "unfinished", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "wood.unfinished", "method": "family-subtype-finish", "confidence": 0.751, "sourceRefs": ["three.mesh-standard", "three.texture", "adobe.pbr-guide-1", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "anisotropyMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "anisotropy": {"base": 0.12, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/04-log-end-grain.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.751, "estimatedFidelity": 0.751, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-04-log-end-grain/end-grain_albedo.png", "url": "end-grain_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-04-log-end-grain/end-grain_roughness.png", "url": "end-grain_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-04-log-end-grain/end-grain_height.png", "url": "end-grain_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-04-log-end-grain/end-grain_normal.png", "url": "end-grain_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-04-log-end-grain/end-grain_ao.png", "url": "end-grain_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 40, "sourceHeight": 60, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 40, "height": 60}, "mask": {"backgroundColor": "#E5C8A8", "backgroundNoise": 6.0, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.03253, "roughnessBase": 0.711, "roughnessVariation": 0.06, "normalStrength": 0.194, "blurRadius": 10}, "palette": ["#E7C6A4", "#E6C5A2", "#E5C29E", "#E7C8A7", "#E2BE98"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#E4C4A2", "#E6C3A0", "#E6C6A4", "#E6C5A2", "#E4C29E"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 202.6, "meanSaturation": 0.297, "gradientStrength": 0.02, "mottle": 0.002, "streakRatio": 0.64, "hueSpread": 0.0, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "log-end", "regionId": "log-end-grain", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/04-log-end-grain.png", "bbox": {"x": 995, "y": 240, "width": 40, "height": 60}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0022}, "observations": ["chromatic base-colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "log-end", "regionId": "log-end-grain", "materialId": null, "family": "wood", "subtype": "generic", "finish": "unfinished", "aliases": [], "confidence": 0.751, "source": "vision"}, "alternatives": []}},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "Saw steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#b6bac0", "color": "#b6bac0", "albedo": {"dominant": "#b6bac0", "secondary": ["#9a9fa6", "#d3d7db"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#b6bac0", "#9a9fa6", "#d3d7db"], "pattern": "mottled", "amplitude": 0.08, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "broad tone breakup across the disc"}, {"id": "meso", "frequency": 8.0, "amplitude": 0.3, "stretch": [4.0, 0.3], "pattern": "striated", "role": "brushing streaks on the steel"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.06, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.38, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.3, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.12, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "blade-sheen", "kind": "gloss", "region": "blade faces", "evidenceRefs": ["full-object"], "confidence": 0.7, "roughness": 0.25, "note": "brushed sheen catching the key light"}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Light silver-grey brushed blade. Real-time override of the registry prior: metalness 0.3, roughness 0.38 (the game renderer has no environment map).", "evidenceRefs": ["full-object"], "referenceMaterialId": "metal.steel-brushed", "materialFamily": "metal", "materialSubtype": "steel", "materialFinish": "brushed", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.steel-brushed", "method": "family-subtype-finish", "confidence": 0.716, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap", "normalMap", "anisotropyMap"], "optionalMaps": ["metalnessMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "anisotropy": {"base": 0.85, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/01-blade-steel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.716, "estimatedFidelity": 0.716, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-01-blade-steel/steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-01-blade-steel/steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-01-blade-steel/steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-01-blade-steel/steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-01-blade-steel/steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 80, "sourceHeight": 80, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 80, "height": 80}, "mask": {"backgroundColor": "#767078", "backgroundNoise": 18.493, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.0441, "roughnessBase": 0.729, "roughnessVariation": 0.077, "normalStrength": 0.208, "blurRadius": 10}, "palette": ["#747275", "#6F6D72", "#746C6C", "#C9C9CA", "#8F949D"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#827E80", "#747072", "#726E71", "#716D71", "#6E6B70"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 114.3, "meanSaturation": 0.053, "gradientStrength": 0.091, "mottle": 0.006, "streakRatio": 1.28, "hueSpread": 0.0, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "saw-blade", "regionId": "blade-steel", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/01-blade-steel.png", "bbox": {"x": 525, "y": 190, "width": 80, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0059}, "observations": ["near-neutral colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "saw-blade", "regionId": "blade-steel", "materialId": null, "family": "metal", "subtype": "steel", "finish": "brushed", "aliases": [], "confidence": 0.716, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "Arbor iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#3e4046", "color": "#3e4046", "albedo": {"dominant": "#3e4046", "secondary": ["#2d2e33", "#585a61"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#3e4046", "#2d2e33", "#585a61"], "pattern": "mottled", "amplitude": 0.08, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.112, "role": "facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.04, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.5, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.45, "variation": 0.05}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.12, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "arbor-edge", "kind": "bevel", "region": "hub rim", "evidenceRefs": ["full-object"], "confidence": 0.6, "roughnessDelta": -0.15}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "Dark iron hub and nut. Real-time override of the registry prior: metalness 0.45, roughness 0.5 (the game renderer has no environment map).", "evidenceRefs": ["full-object"], "referenceMaterialId": "metal.steel-brushed", "materialFamily": "metal", "materialSubtype": "steel", "materialFinish": "brushed", "materialReference": {"registry": "/home/user/Scary-Night/.agents/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.steel-brushed", "method": "family-subtype-finish", "confidence": 0.86, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap", "normalMap", "anisotropyMap"], "optionalMaps": ["metalnessMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "anisotropy": {"base": 0.85, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/02-hub-iron.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-02-hub-iron/iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-02-hub-iron/iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-02-hub-iron/iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-02-hub-iron/iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/pbr-02-hub-iron/iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 55, "sourceHeight": 35, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 55, "height": 35}, "mask": {"backgroundColor": "#3F3F46", "backgroundNoise": 35.861, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.2348}, "mapStats": {"valueRange": 0.4092, "heightP90Gradient": 0.02608, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.187, "blurRadius": 10}, "palette": ["#413635", "#867D7C", "#3D3332", "#A19794", "#555762"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "shippingNote": "Extracted from an AI concept image: kept as palette/roughness evidence only, never loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory falls back to its procedural canvas maps."}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#443F42", "#454044", "#5F5959", "#494747", "#5F5857"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 75.8, "meanSaturation": 0.09, "gradientStrength": 0.15, "mottle": 0.012, "streakRatio": 1.47, "hueSpread": 0.014, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "hub", "regionId": "hub-iron", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/02-hub-iron.png", "bbox": {"x": 628, "y": 268, "width": 55, "height": 35}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0018}, "observations": ["near-neutral colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "hub", "regionId": "hub-iron", "materialId": null, "family": "metal", "subtype": "steel", "finish": "brushed", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["slot"] = createSculptMaterial(
    "slot",
    {"id": "slot", "name": "Blade slot shadow", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)", "baseColor": "#2c2622", "color": "#2c2622", "albedo": {"dominant": "#2c2622", "secondary": ["#1e1a17", "#3a332d"], "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows of the illustration are lighting, not albedo."}, "colorVariation": {"palette": ["#2c2622", "#1e1a17", "#3a332d"], "pattern": "mottled", "amplitude": 0.05, "heightCorrelation": 0.3}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 4, "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.125, "role": "broad tone breakup across a part"}, {"id": "meso", "frequency": 10.0, "amplitude": 0.07, "role": "facets, hammer marks"}, {"id": "micro", "frequency": 40.0, "amplitude": 0.025, "role": "highlight breakup under grazing light"}], "roughness": {"base": 0.96, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "slightly rougher in cavities, smoother on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3, "notes": "Darken plank seams, bracket edges and the contact with the parts below."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#3a2c1e"}, "localOverrides": [{"id": "slot-ao", "kind": "stain", "region": "the slot in the top", "evidenceRefs": ["full-object"], "confidence": 0.6, "dirtAmount": 0.6, "cavityBias": 1.0}], "shaderNotes": ["Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.", "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel."], "notes": "The dark gap the blade runs through.", "evidenceRefs": ["full-object"]},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Top board 3__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.48, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Top board 3", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board: a thick rectangular board, box-shaped; the middle one is the bench's root.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.48, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-3", "kind": "seam", "description": "dark gaps between the five top boards", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-3"]};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(2.0, 0.18, 0.118);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Top board 3";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Top board 3", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board: a thick rectangular board, box-shaped; the middle one is the bench's root.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.48, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-3", "kind": "seam", "description": "dark gaps between the five top boards", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-3"]};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_top_board_1_1 = makeAttachmentEndpoint(null);
  const node_top_board_1_1 = new THREE.Group();
  node_top_board_1_1.name = "Top board 1__pivot";
  node_top_board_1_1.scale.set(1, 1, 1);
  if (endpoint_top_board_1_1) {
    node_top_board_1_1.position.copy(endpoint_top_board_1_1.start);
    node_top_board_1_1.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_top_board_1_1.position.set(0.0, 0.0, -0.248);
    node_top_board_1_1.rotation.set(-0.0, 0.0, -0.0);
  }
  node_top_board_1_1.userData.sculptComponent = {"id": "top-board-1", "name": "Top board 1", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, -0.248], "rotation": [-0.0, 0.0, -0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-1", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-1"]};
  node_top_board_1_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_top_board_1_1);
  nodes["top-board-1"] = node_top_board_1_1;
  const mesh_top_board_1_1Geometry = endpoint_top_board_1_1
    ? new THREE.CylinderGeometry(endpoint_top_board_1_1.endRadius, endpoint_top_board_1_1.baseRadius, endpoint_top_board_1_1.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_top_board_1_1) {
    mesh_top_board_1_1Geometry.scale(2.0, 0.18, 0.118);
  }
  const mesh_top_board_1_1 = new THREE.Mesh(
    mesh_top_board_1_1Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_board_1_1.name = "Top board 1";
  if (endpoint_top_board_1_1) {
    mesh_top_board_1_1.position.copy(endpoint_top_board_1_1.midpoint);
    mesh_top_board_1_1.quaternion.copy(endpoint_top_board_1_1.quaternion);
  }
  mesh_top_board_1_1.castShadow = options.castShadow ?? true;
  mesh_top_board_1_1.receiveShadow = options.receiveShadow ?? true;
  mesh_top_board_1_1.userData.sculptComponent = {"id": "top-board-1", "name": "Top board 1", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 1: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, -0.248], "rotation": [-0.0, 0.0, -0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-1", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-1"]};
  node_top_board_1_1.add(mesh_top_board_1_1);
  meshes["top-board-1"] = mesh_top_board_1_1;
  colliders["top-board-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["top-board-1"] ??= [];
  destructionGroups["top-board-1"].push(node_top_board_1_1);

  const endpoint_top_board_2_2 = makeAttachmentEndpoint(null);
  const node_top_board_2_2 = new THREE.Group();
  node_top_board_2_2.name = "Top board 2__pivot";
  node_top_board_2_2.scale.set(1, 1, 1);
  if (endpoint_top_board_2_2) {
    node_top_board_2_2.position.copy(endpoint_top_board_2_2.start);
    node_top_board_2_2.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_top_board_2_2.position.set(0.01, 0.0, -0.124);
    node_top_board_2_2.rotation.set(-0.0, 0.0, -0.0);
  }
  node_top_board_2_2.userData.sculptComponent = {"id": "top-board-2", "name": "Top board 2", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.98, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.01, 0.0, -0.124], "rotation": [-0.0, 0.0, -0.0], "scale": [1.98, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-2", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-2"]};
  node_top_board_2_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_top_board_2_2);
  nodes["top-board-2"] = node_top_board_2_2;
  const mesh_top_board_2_2Geometry = endpoint_top_board_2_2
    ? new THREE.CylinderGeometry(endpoint_top_board_2_2.endRadius, endpoint_top_board_2_2.baseRadius, endpoint_top_board_2_2.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_top_board_2_2) {
    mesh_top_board_2_2Geometry.scale(1.98, 0.18, 0.118);
  }
  const mesh_top_board_2_2 = new THREE.Mesh(
    mesh_top_board_2_2Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_board_2_2.name = "Top board 2";
  if (endpoint_top_board_2_2) {
    mesh_top_board_2_2.position.copy(endpoint_top_board_2_2.midpoint);
    mesh_top_board_2_2.quaternion.copy(endpoint_top_board_2_2.quaternion);
  }
  mesh_top_board_2_2.castShadow = options.castShadow ?? true;
  mesh_top_board_2_2.receiveShadow = options.receiveShadow ?? true;
  mesh_top_board_2_2.userData.sculptComponent = {"id": "top-board-2", "name": "Top board 2", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 2: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.98, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.01, 0.0, -0.124], "rotation": [-0.0, 0.0, -0.0], "scale": [1.98, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-2", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-2"]};
  node_top_board_2_2.add(mesh_top_board_2_2);
  meshes["top-board-2"] = mesh_top_board_2_2;
  colliders["top-board-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["top-board-2"] ??= [];
  destructionGroups["top-board-2"].push(node_top_board_2_2);

  const endpoint_top_board_4_3 = makeAttachmentEndpoint(null);
  const node_top_board_4_3 = new THREE.Group();
  node_top_board_4_3.name = "Top board 4__pivot";
  node_top_board_4_3.scale.set(1, 1, 1);
  if (endpoint_top_board_4_3) {
    node_top_board_4_3.position.copy(endpoint_top_board_4_3.start);
    node_top_board_4_3.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_top_board_4_3.position.set(0.01, 0.0, 0.124);
    node_top_board_4_3.rotation.set(-0.0, 0.0, -0.0);
  }
  node_top_board_4_3.userData.sculptComponent = {"id": "top-board-4", "name": "Top board 4", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 4: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.98, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.01, 0.0, 0.124], "rotation": [-0.0, 0.0, -0.0], "scale": [1.98, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-4", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-4"]};
  node_top_board_4_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_top_board_4_3);
  nodes["top-board-4"] = node_top_board_4_3;
  const mesh_top_board_4_3Geometry = endpoint_top_board_4_3
    ? new THREE.CylinderGeometry(endpoint_top_board_4_3.endRadius, endpoint_top_board_4_3.baseRadius, endpoint_top_board_4_3.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_top_board_4_3) {
    mesh_top_board_4_3Geometry.scale(1.98, 0.18, 0.118);
  }
  const mesh_top_board_4_3 = new THREE.Mesh(
    mesh_top_board_4_3Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_board_4_3.name = "Top board 4";
  if (endpoint_top_board_4_3) {
    mesh_top_board_4_3.position.copy(endpoint_top_board_4_3.midpoint);
    mesh_top_board_4_3.quaternion.copy(endpoint_top_board_4_3.quaternion);
  }
  mesh_top_board_4_3.castShadow = options.castShadow ?? true;
  mesh_top_board_4_3.receiveShadow = options.receiveShadow ?? true;
  mesh_top_board_4_3.userData.sculptComponent = {"id": "top-board-4", "name": "Top board 4", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 4: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 1.98, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.01, 0.0, 0.124], "rotation": [-0.0, 0.0, -0.0], "scale": [1.98, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-4", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-4"]};
  node_top_board_4_3.add(mesh_top_board_4_3);
  meshes["top-board-4"] = mesh_top_board_4_3;
  colliders["top-board-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["top-board-4"] ??= [];
  destructionGroups["top-board-4"].push(node_top_board_4_3);

  const endpoint_top_board_5_4 = makeAttachmentEndpoint(null);
  const node_top_board_5_4 = new THREE.Group();
  node_top_board_5_4.name = "Top board 5__pivot";
  node_top_board_5_4.scale.set(1, 1, 1);
  if (endpoint_top_board_5_4) {
    node_top_board_5_4.position.copy(endpoint_top_board_5_4.start);
    node_top_board_5_4.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_top_board_5_4.position.set(0.0, 0.0, 0.248);
    node_top_board_5_4.rotation.set(-0.0, 0.0, -0.0);
  }
  node_top_board_5_4.userData.sculptComponent = {"id": "top-board-5", "name": "Top board 5", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 5: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.248], "rotation": [-0.0, 0.0, -0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-5", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-5"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood"}, "materialRegions": [{"regionId": "bench-wood", "materialId": "wood", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/00-bench-wood.png", "bbox": {"x": 200, "y": 325, "width": 280, "height": 60}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0155}}]};
  node_top_board_5_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_top_board_5_4);
  nodes["top-board-5"] = node_top_board_5_4;
  const mesh_top_board_5_4Geometry = endpoint_top_board_5_4
    ? new THREE.CylinderGeometry(endpoint_top_board_5_4.endRadius, endpoint_top_board_5_4.baseRadius, endpoint_top_board_5_4.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_top_board_5_4) {
    mesh_top_board_5_4Geometry.scale(2.0, 0.18, 0.118);
  }
  const mesh_top_board_5_4 = new THREE.Mesh(
    mesh_top_board_5_4Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_board_5_4.name = "Top board 5";
  if (endpoint_top_board_5_4) {
    mesh_top_board_5_4.position.copy(endpoint_top_board_5_4.midpoint);
    mesh_top_board_5_4.quaternion.copy(endpoint_top_board_5_4.quaternion);
  }
  mesh_top_board_5_4.castShadow = options.castShadow ?? true;
  mesh_top_board_5_4.receiveShadow = options.receiveShadow ?? true;
  mesh_top_board_5_4.userData.sculptComponent = {"id": "top-board-5", "name": "Top board 5", "level": "macro", "role": "panel", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top board 5: discrete rigid part with countable flat or simply curved faces.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 2.0, "height": 0.18, "depth": 0.118, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.248], "rotation": [-0.0, 0.0, -0.0], "scale": [2.0, 0.18, 0.118]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-board-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "top-seam-5", "kind": "seam", "description": "6 mm dark gap to the next board", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["top-seam-5"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "wood"}, "materialRegions": [{"regionId": "bench-wood", "materialId": "wood", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/00-bench-wood.png", "bbox": {"x": 200, "y": 325, "width": 280, "height": 60}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0155}}]};
  node_top_board_5_4.add(mesh_top_board_5_4);
  meshes["top-board-5"] = mesh_top_board_5_4;
  colliders["top-board-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["top-board-5"] ??= [];
  destructionGroups["top-board-5"].push(node_top_board_5_4);

  const endpoint_leg_1_5 = makeAttachmentEndpoint(null);
  const node_leg_1_5 = new THREE.Group();
  node_leg_1_5.name = "Leg 1__pivot";
  node_leg_1_5.scale.set(1, 1, 1);
  if (endpoint_leg_1_5) {
    node_leg_1_5.position.copy(endpoint_leg_1_5.start);
    node_leg_1_5.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_1_5.position.set(-0.85, -0.285, 0.23);
    node_leg_1_5.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_1_5.userData.sculptComponent = {"id": "leg-1", "name": "Leg 1", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [-0.85, -0.48, 0.23], "localEnd": [-0.85, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.85, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-1", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-1"]};
  node_leg_1_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_1_5);
  nodes["leg-1"] = node_leg_1_5;
  const mesh_leg_1_5Geometry = endpoint_leg_1_5
    ? new THREE.CylinderGeometry(endpoint_leg_1_5.endRadius, endpoint_leg_1_5.baseRadius, endpoint_leg_1_5.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_1_5) {
    mesh_leg_1_5Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_1_5 = new THREE.Mesh(
    mesh_leg_1_5Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_1_5.name = "Leg 1";
  if (endpoint_leg_1_5) {
    mesh_leg_1_5.position.copy(endpoint_leg_1_5.midpoint);
    mesh_leg_1_5.quaternion.copy(endpoint_leg_1_5.quaternion);
  }
  mesh_leg_1_5.castShadow = options.castShadow ?? true;
  mesh_leg_1_5.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_1_5.userData.sculptComponent = {"id": "leg-1", "name": "Leg 1", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [-0.85, -0.48, 0.23], "localEnd": [-0.85, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.85, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-1", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-1"]};
  node_leg_1_5.add(mesh_leg_1_5);
  meshes["leg-1"] = mesh_leg_1_5;
  colliders["leg-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-1"] ??= [];
  destructionGroups["leg-1"].push(node_leg_1_5);

  const endpoint_leg_2_6 = makeAttachmentEndpoint(null);
  const node_leg_2_6 = new THREE.Group();
  node_leg_2_6.name = "Leg 2__pivot";
  node_leg_2_6.scale.set(1, 1, 1);
  if (endpoint_leg_2_6) {
    node_leg_2_6.position.copy(endpoint_leg_2_6.start);
    node_leg_2_6.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_2_6.position.set(-0.85, -0.285, -0.23);
    node_leg_2_6.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_2_6.userData.sculptComponent = {"id": "leg-2", "name": "Leg 2", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [-0.85, -0.48, -0.23], "localEnd": [-0.85, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.85, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-2", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-2"]};
  node_leg_2_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_2_6);
  nodes["leg-2"] = node_leg_2_6;
  const mesh_leg_2_6Geometry = endpoint_leg_2_6
    ? new THREE.CylinderGeometry(endpoint_leg_2_6.endRadius, endpoint_leg_2_6.baseRadius, endpoint_leg_2_6.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_2_6) {
    mesh_leg_2_6Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_2_6 = new THREE.Mesh(
    mesh_leg_2_6Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_2_6.name = "Leg 2";
  if (endpoint_leg_2_6) {
    mesh_leg_2_6.position.copy(endpoint_leg_2_6.midpoint);
    mesh_leg_2_6.quaternion.copy(endpoint_leg_2_6.quaternion);
  }
  mesh_leg_2_6.castShadow = options.castShadow ?? true;
  mesh_leg_2_6.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_2_6.userData.sculptComponent = {"id": "leg-2", "name": "Leg 2", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [-0.85, -0.48, -0.23], "localEnd": [-0.85, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.85, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-2", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-2"]};
  node_leg_2_6.add(mesh_leg_2_6);
  meshes["leg-2"] = mesh_leg_2_6;
  colliders["leg-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-2"] ??= [];
  destructionGroups["leg-2"].push(node_leg_2_6);

  const endpoint_leg_3_7 = makeAttachmentEndpoint(null);
  const node_leg_3_7 = new THREE.Group();
  node_leg_3_7.name = "Leg 3__pivot";
  node_leg_3_7.scale.set(1, 1, 1);
  if (endpoint_leg_3_7) {
    node_leg_3_7.position.copy(endpoint_leg_3_7.start);
    node_leg_3_7.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_3_7.position.set(0.0, -0.285, 0.23);
    node_leg_3_7.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_3_7.userData.sculptComponent = {"id": "leg-3", "name": "Leg 3", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.0, -0.48, 0.23], "localEnd": [0.0, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-3", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-3"]};
  node_leg_3_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_3_7);
  nodes["leg-3"] = node_leg_3_7;
  const mesh_leg_3_7Geometry = endpoint_leg_3_7
    ? new THREE.CylinderGeometry(endpoint_leg_3_7.endRadius, endpoint_leg_3_7.baseRadius, endpoint_leg_3_7.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_3_7) {
    mesh_leg_3_7Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_3_7 = new THREE.Mesh(
    mesh_leg_3_7Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_3_7.name = "Leg 3";
  if (endpoint_leg_3_7) {
    mesh_leg_3_7.position.copy(endpoint_leg_3_7.midpoint);
    mesh_leg_3_7.quaternion.copy(endpoint_leg_3_7.quaternion);
  }
  mesh_leg_3_7.castShadow = options.castShadow ?? true;
  mesh_leg_3_7.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_3_7.userData.sculptComponent = {"id": "leg-3", "name": "Leg 3", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.0, -0.48, 0.23], "localEnd": [0.0, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-3", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-3"]};
  node_leg_3_7.add(mesh_leg_3_7);
  meshes["leg-3"] = mesh_leg_3_7;
  colliders["leg-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-3"] ??= [];
  destructionGroups["leg-3"].push(node_leg_3_7);

  const endpoint_leg_4_8 = makeAttachmentEndpoint(null);
  const node_leg_4_8 = new THREE.Group();
  node_leg_4_8.name = "Leg 4__pivot";
  node_leg_4_8.scale.set(1, 1, 1);
  if (endpoint_leg_4_8) {
    node_leg_4_8.position.copy(endpoint_leg_4_8.start);
    node_leg_4_8.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_4_8.position.set(0.0, -0.285, -0.23);
    node_leg_4_8.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_4_8.userData.sculptComponent = {"id": "leg-4", "name": "Leg 4", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.0, -0.48, -0.23], "localEnd": [0.0, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-4", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-4"]};
  node_leg_4_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_4_8);
  nodes["leg-4"] = node_leg_4_8;
  const mesh_leg_4_8Geometry = endpoint_leg_4_8
    ? new THREE.CylinderGeometry(endpoint_leg_4_8.endRadius, endpoint_leg_4_8.baseRadius, endpoint_leg_4_8.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_4_8) {
    mesh_leg_4_8Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_4_8 = new THREE.Mesh(
    mesh_leg_4_8Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_4_8.name = "Leg 4";
  if (endpoint_leg_4_8) {
    mesh_leg_4_8.position.copy(endpoint_leg_4_8.midpoint);
    mesh_leg_4_8.quaternion.copy(endpoint_leg_4_8.quaternion);
  }
  mesh_leg_4_8.castShadow = options.castShadow ?? true;
  mesh_leg_4_8.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_4_8.userData.sculptComponent = {"id": "leg-4", "name": "Leg 4", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.0, -0.48, -0.23], "localEnd": [0.0, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.0, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-4", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-4"]};
  node_leg_4_8.add(mesh_leg_4_8);
  meshes["leg-4"] = mesh_leg_4_8;
  colliders["leg-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-4"] ??= [];
  destructionGroups["leg-4"].push(node_leg_4_8);

  const endpoint_leg_5_9 = makeAttachmentEndpoint(null);
  const node_leg_5_9 = new THREE.Group();
  node_leg_5_9.name = "Leg 5__pivot";
  node_leg_5_9.scale.set(1, 1, 1);
  if (endpoint_leg_5_9) {
    node_leg_5_9.position.copy(endpoint_leg_5_9.start);
    node_leg_5_9.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_5_9.position.set(0.85, -0.285, 0.23);
    node_leg_5_9.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_5_9.userData.sculptComponent = {"id": "leg-5", "name": "Leg 5", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.85, -0.48, 0.23], "localEnd": [0.85, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.85, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-5", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-5"]};
  node_leg_5_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_5_9);
  nodes["leg-5"] = node_leg_5_9;
  const mesh_leg_5_9Geometry = endpoint_leg_5_9
    ? new THREE.CylinderGeometry(endpoint_leg_5_9.endRadius, endpoint_leg_5_9.baseRadius, endpoint_leg_5_9.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_5_9) {
    mesh_leg_5_9Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_5_9 = new THREE.Mesh(
    mesh_leg_5_9Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_5_9.name = "Leg 5";
  if (endpoint_leg_5_9) {
    mesh_leg_5_9.position.copy(endpoint_leg_5_9.midpoint);
    mesh_leg_5_9.quaternion.copy(endpoint_leg_5_9.quaternion);
  }
  mesh_leg_5_9.castShadow = options.castShadow ?? true;
  mesh_leg_5_9.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_5_9.userData.sculptComponent = {"id": "leg-5", "name": "Leg 5", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.85, -0.48, 0.23], "localEnd": [0.85, -0.08, 0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.85, -0.285, 0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-5", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-5"]};
  node_leg_5_9.add(mesh_leg_5_9);
  meshes["leg-5"] = mesh_leg_5_9;
  colliders["leg-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-5"] ??= [];
  destructionGroups["leg-5"].push(node_leg_5_9);

  const endpoint_leg_6_10 = makeAttachmentEndpoint(null);
  const node_leg_6_10 = new THREE.Group();
  node_leg_6_10.name = "Leg 6__pivot";
  node_leg_6_10.scale.set(1, 1, 1);
  if (endpoint_leg_6_10) {
    node_leg_6_10.position.copy(endpoint_leg_6_10.start);
    node_leg_6_10.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_leg_6_10.position.set(0.85, -0.285, -0.23);
    node_leg_6_10.rotation.set(-0.0, 0.0, -0.0);
  }
  node_leg_6_10.userData.sculptComponent = {"id": "leg-6", "name": "Leg 6", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.85, -0.48, -0.23], "localEnd": [0.85, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.85, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-6", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-6"]};
  node_leg_6_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_leg_6_10);
  nodes["leg-6"] = node_leg_6_10;
  const mesh_leg_6_10Geometry = endpoint_leg_6_10
    ? new THREE.CylinderGeometry(endpoint_leg_6_10.endRadius, endpoint_leg_6_10.baseRadius, endpoint_leg_6_10.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_leg_6_10) {
    mesh_leg_6_10Geometry.scale(0.13, 0.4, 0.13);
  }
  const mesh_leg_6_10 = new THREE.Mesh(
    mesh_leg_6_10Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_6_10.name = "Leg 6";
  if (endpoint_leg_6_10) {
    mesh_leg_6_10.position.copy(endpoint_leg_6_10.midpoint);
    mesh_leg_6_10.quaternion.copy(endpoint_leg_6_10.quaternion);
  }
  mesh_leg_6_10.castShadow = options.castShadow ?? true;
  mesh_leg_6_10.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_6_10.userData.sculptComponent = {"id": "leg-6", "name": "Leg 6", "level": "macro", "role": "post", "importance": 0.7, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Leg: a square timber post, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:underside", "localStart": [0.85, -0.48, -0.23], "localEnd": [0.85, -0.08, -0.23], "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.4, "depth": 0.13, "units": "object", "confidence": 0.75}, "transform": {"position": [0.85, -0.285, -0.23], "rotation": [-0.0, 0.0, -0.0], "scale": [0.13, 0.4, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leg-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leg-bevel-6", "kind": "bevel", "description": "softened leg edges catch the key light", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["leg-bevel-6"]};
  node_leg_6_10.add(mesh_leg_6_10);
  meshes["leg-6"] = mesh_leg_6_10;
  colliders["leg-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["leg-6"] ??= [];
  destructionGroups["leg-6"].push(node_leg_6_10);

  const endpoint_stretcher_1_11 = makeAttachmentEndpoint(null);
  const node_stretcher_1_11 = new THREE.Group();
  node_stretcher_1_11.name = "Stretcher front 1__pivot";
  node_stretcher_1_11.scale.set(1, 1, 1);
  if (endpoint_stretcher_1_11) {
    node_stretcher_1_11.position.copy(endpoint_stretcher_1_11.start);
    node_stretcher_1_11.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_stretcher_1_11.position.set(-0.425, -0.29, 0.315);
    node_stretcher_1_11.rotation.set(-0.0, 0.0, -0.0);
  }
  node_stretcher_1_11.userData.sculptComponent = {"id": "stretcher-1", "name": "Stretcher front 1", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.425, -0.29, 0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_1_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_stretcher_1_11);
  nodes["stretcher-1"] = node_stretcher_1_11;
  const mesh_stretcher_1_11Geometry = endpoint_stretcher_1_11
    ? new THREE.CylinderGeometry(endpoint_stretcher_1_11.endRadius, endpoint_stretcher_1_11.baseRadius, endpoint_stretcher_1_11.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_stretcher_1_11) {
    mesh_stretcher_1_11Geometry.scale(0.98, 0.075, 0.045);
  }
  const mesh_stretcher_1_11 = new THREE.Mesh(
    mesh_stretcher_1_11Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stretcher_1_11.name = "Stretcher front 1";
  if (endpoint_stretcher_1_11) {
    mesh_stretcher_1_11.position.copy(endpoint_stretcher_1_11.midpoint);
    mesh_stretcher_1_11.quaternion.copy(endpoint_stretcher_1_11.quaternion);
  }
  mesh_stretcher_1_11.castShadow = options.castShadow ?? true;
  mesh_stretcher_1_11.receiveShadow = options.receiveShadow ?? true;
  mesh_stretcher_1_11.userData.sculptComponent = {"id": "stretcher-1", "name": "Stretcher front 1", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.425, -0.29, 0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_1_11.add(mesh_stretcher_1_11);
  meshes["stretcher-1"] = mesh_stretcher_1_11;
  colliders["stretcher-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["stretcher-1"] ??= [];
  destructionGroups["stretcher-1"].push(node_stretcher_1_11);

  const endpoint_stretcher_2_12 = makeAttachmentEndpoint(null);
  const node_stretcher_2_12 = new THREE.Group();
  node_stretcher_2_12.name = "Stretcher front 2__pivot";
  node_stretcher_2_12.scale.set(1, 1, 1);
  if (endpoint_stretcher_2_12) {
    node_stretcher_2_12.position.copy(endpoint_stretcher_2_12.start);
    node_stretcher_2_12.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_stretcher_2_12.position.set(0.425, -0.29, 0.315);
    node_stretcher_2_12.rotation.set(-0.0, 0.0, -0.0);
  }
  node_stretcher_2_12.userData.sculptComponent = {"id": "stretcher-2", "name": "Stretcher front 2", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [0.425, -0.29, 0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_2_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_stretcher_2_12);
  nodes["stretcher-2"] = node_stretcher_2_12;
  const mesh_stretcher_2_12Geometry = endpoint_stretcher_2_12
    ? new THREE.CylinderGeometry(endpoint_stretcher_2_12.endRadius, endpoint_stretcher_2_12.baseRadius, endpoint_stretcher_2_12.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_stretcher_2_12) {
    mesh_stretcher_2_12Geometry.scale(0.98, 0.075, 0.045);
  }
  const mesh_stretcher_2_12 = new THREE.Mesh(
    mesh_stretcher_2_12Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stretcher_2_12.name = "Stretcher front 2";
  if (endpoint_stretcher_2_12) {
    mesh_stretcher_2_12.position.copy(endpoint_stretcher_2_12.midpoint);
    mesh_stretcher_2_12.quaternion.copy(endpoint_stretcher_2_12.quaternion);
  }
  mesh_stretcher_2_12.castShadow = options.castShadow ?? true;
  mesh_stretcher_2_12.receiveShadow = options.receiveShadow ?? true;
  mesh_stretcher_2_12.userData.sculptComponent = {"id": "stretcher-2", "name": "Stretcher front 2", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [0.425, -0.29, 0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_2_12.add(mesh_stretcher_2_12);
  meshes["stretcher-2"] = mesh_stretcher_2_12;
  colliders["stretcher-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["stretcher-2"] ??= [];
  destructionGroups["stretcher-2"].push(node_stretcher_2_12);

  const endpoint_stretcher_3_13 = makeAttachmentEndpoint(null);
  const node_stretcher_3_13 = new THREE.Group();
  node_stretcher_3_13.name = "Stretcher back 3__pivot";
  node_stretcher_3_13.scale.set(1, 1, 1);
  if (endpoint_stretcher_3_13) {
    node_stretcher_3_13.position.copy(endpoint_stretcher_3_13.start);
    node_stretcher_3_13.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_stretcher_3_13.position.set(-0.425, -0.29, -0.315);
    node_stretcher_3_13.rotation.set(-0.0, 0.0, -0.0);
  }
  node_stretcher_3_13.userData.sculptComponent = {"id": "stretcher-3", "name": "Stretcher back 3", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.425, -0.29, -0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_3_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_stretcher_3_13);
  nodes["stretcher-3"] = node_stretcher_3_13;
  const mesh_stretcher_3_13Geometry = endpoint_stretcher_3_13
    ? new THREE.CylinderGeometry(endpoint_stretcher_3_13.endRadius, endpoint_stretcher_3_13.baseRadius, endpoint_stretcher_3_13.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_stretcher_3_13) {
    mesh_stretcher_3_13Geometry.scale(0.98, 0.075, 0.045);
  }
  const mesh_stretcher_3_13 = new THREE.Mesh(
    mesh_stretcher_3_13Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stretcher_3_13.name = "Stretcher back 3";
  if (endpoint_stretcher_3_13) {
    mesh_stretcher_3_13.position.copy(endpoint_stretcher_3_13.midpoint);
    mesh_stretcher_3_13.quaternion.copy(endpoint_stretcher_3_13.quaternion);
  }
  mesh_stretcher_3_13.castShadow = options.castShadow ?? true;
  mesh_stretcher_3_13.receiveShadow = options.receiveShadow ?? true;
  mesh_stretcher_3_13.userData.sculptComponent = {"id": "stretcher-3", "name": "Stretcher back 3", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.425, -0.29, -0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_3_13.add(mesh_stretcher_3_13);
  meshes["stretcher-3"] = mesh_stretcher_3_13;
  colliders["stretcher-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["stretcher-3"] ??= [];
  destructionGroups["stretcher-3"].push(node_stretcher_3_13);

  const endpoint_stretcher_4_14 = makeAttachmentEndpoint(null);
  const node_stretcher_4_14 = new THREE.Group();
  node_stretcher_4_14.name = "Stretcher back 4__pivot";
  node_stretcher_4_14.scale.set(1, 1, 1);
  if (endpoint_stretcher_4_14) {
    node_stretcher_4_14.position.copy(endpoint_stretcher_4_14.start);
    node_stretcher_4_14.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_stretcher_4_14.position.set(0.425, -0.29, -0.315);
    node_stretcher_4_14.rotation.set(-0.0, 0.0, -0.0);
  }
  node_stretcher_4_14.userData.sculptComponent = {"id": "stretcher-4", "name": "Stretcher back 4", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [0.425, -0.29, -0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_4_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_stretcher_4_14);
  nodes["stretcher-4"] = node_stretcher_4_14;
  const mesh_stretcher_4_14Geometry = endpoint_stretcher_4_14
    ? new THREE.CylinderGeometry(endpoint_stretcher_4_14.endRadius, endpoint_stretcher_4_14.baseRadius, endpoint_stretcher_4_14.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_stretcher_4_14) {
    mesh_stretcher_4_14Geometry.scale(0.98, 0.075, 0.045);
  }
  const mesh_stretcher_4_14 = new THREE.Mesh(
    mesh_stretcher_4_14Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stretcher_4_14.name = "Stretcher back 4";
  if (endpoint_stretcher_4_14) {
    mesh_stretcher_4_14.position.copy(endpoint_stretcher_4_14.midpoint);
    mesh_stretcher_4_14.quaternion.copy(endpoint_stretcher_4_14.quaternion);
  }
  mesh_stretcher_4_14.castShadow = options.castShadow ?? true;
  mesh_stretcher_4_14.receiveShadow = options.receiveShadow ?? true;
  mesh_stretcher_4_14.userData.sculptComponent = {"id": "stretcher-4", "name": "Stretcher back 4", "level": "meso", "role": "beam", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Stretcher: a straight board bracing two legs, box-shaped.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.98, "height": 0.075, "depth": 0.045, "units": "object", "confidence": 0.75}, "transform": {"position": [0.425, -0.29, -0.315], "rotation": [-0.0, 0.0, -0.0], "scale": [0.98, 0.075, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stretcher-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_stretcher_4_14.add(mesh_stretcher_4_14);
  meshes["stretcher-4"] = mesh_stretcher_4_14;
  colliders["stretcher-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["stretcher-4"] ??= [];
  destructionGroups["stretcher-4"].push(node_stretcher_4_14);

  const endpoint_brace_1_15 = makeAttachmentEndpoint(null);
  const node_brace_1_15 = new THREE.Group();
  node_brace_1_15.name = "Cross brace 1__pivot";
  node_brace_1_15.scale.set(1, 1, 1);
  if (endpoint_brace_1_15) {
    node_brace_1_15.position.copy(endpoint_brace_1_15.start);
    node_brace_1_15.rotation.set(0.593, 0.0, -0.0);
  } else {
    node_brace_1_15.position.set(-0.775, -0.26, 0.0);
    node_brace_1_15.rotation.set(0.593, 0.0, -0.0);
  }
  node_brace_1_15.userData.sculptComponent = {"id": "brace-1", "name": "Cross brace 1", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.775, -0.26, 0.0], "rotation": [0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_1_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_brace_1_15);
  nodes["brace-1"] = node_brace_1_15;
  const mesh_brace_1_15Geometry = endpoint_brace_1_15
    ? new THREE.CylinderGeometry(endpoint_brace_1_15.endRadius, endpoint_brace_1_15.baseRadius, endpoint_brace_1_15.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_brace_1_15) {
    mesh_brace_1_15Geometry.scale(0.035, 0.065, 0.6047);
  }
  const mesh_brace_1_15 = new THREE.Mesh(
    mesh_brace_1_15Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brace_1_15.name = "Cross brace 1";
  if (endpoint_brace_1_15) {
    mesh_brace_1_15.position.copy(endpoint_brace_1_15.midpoint);
    mesh_brace_1_15.quaternion.copy(endpoint_brace_1_15.quaternion);
  }
  mesh_brace_1_15.castShadow = options.castShadow ?? true;
  mesh_brace_1_15.receiveShadow = options.receiveShadow ?? true;
  mesh_brace_1_15.userData.sculptComponent = {"id": "brace-1", "name": "Cross brace 1", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.775, -0.26, 0.0], "rotation": [0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_1_15.add(mesh_brace_1_15);
  meshes["brace-1"] = mesh_brace_1_15;
  colliders["brace-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["brace-1"] ??= [];
  destructionGroups["brace-1"].push(node_brace_1_15);

  const endpoint_brace_2_16 = makeAttachmentEndpoint(null);
  const node_brace_2_16 = new THREE.Group();
  node_brace_2_16.name = "Cross brace 2__pivot";
  node_brace_2_16.scale.set(1, 1, 1);
  if (endpoint_brace_2_16) {
    node_brace_2_16.position.copy(endpoint_brace_2_16.start);
    node_brace_2_16.rotation.set(-0.593, 0.0, -0.0);
  } else {
    node_brace_2_16.position.set(-0.775, -0.26, 0.0);
    node_brace_2_16.rotation.set(-0.593, 0.0, -0.0);
  }
  node_brace_2_16.userData.sculptComponent = {"id": "brace-2", "name": "Cross brace 2", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.775, -0.26, 0.0], "rotation": [-0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_2_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_brace_2_16);
  nodes["brace-2"] = node_brace_2_16;
  const mesh_brace_2_16Geometry = endpoint_brace_2_16
    ? new THREE.CylinderGeometry(endpoint_brace_2_16.endRadius, endpoint_brace_2_16.baseRadius, endpoint_brace_2_16.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_brace_2_16) {
    mesh_brace_2_16Geometry.scale(0.035, 0.065, 0.6047);
  }
  const mesh_brace_2_16 = new THREE.Mesh(
    mesh_brace_2_16Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brace_2_16.name = "Cross brace 2";
  if (endpoint_brace_2_16) {
    mesh_brace_2_16.position.copy(endpoint_brace_2_16.midpoint);
    mesh_brace_2_16.quaternion.copy(endpoint_brace_2_16.quaternion);
  }
  mesh_brace_2_16.castShadow = options.castShadow ?? true;
  mesh_brace_2_16.receiveShadow = options.receiveShadow ?? true;
  mesh_brace_2_16.userData.sculptComponent = {"id": "brace-2", "name": "Cross brace 2", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [-0.775, -0.26, 0.0], "rotation": [-0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_2_16.add(mesh_brace_2_16);
  meshes["brace-2"] = mesh_brace_2_16;
  colliders["brace-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["brace-2"] ??= [];
  destructionGroups["brace-2"].push(node_brace_2_16);

  const endpoint_brace_3_17 = makeAttachmentEndpoint(null);
  const node_brace_3_17 = new THREE.Group();
  node_brace_3_17.name = "Cross brace 3__pivot";
  node_brace_3_17.scale.set(1, 1, 1);
  if (endpoint_brace_3_17) {
    node_brace_3_17.position.copy(endpoint_brace_3_17.start);
    node_brace_3_17.rotation.set(0.593, 0.0, -0.0);
  } else {
    node_brace_3_17.position.set(0.775, -0.26, 0.0);
    node_brace_3_17.rotation.set(0.593, 0.0, -0.0);
  }
  node_brace_3_17.userData.sculptComponent = {"id": "brace-3", "name": "Cross brace 3", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [0.775, -0.26, 0.0], "rotation": [0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_3_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_brace_3_17);
  nodes["brace-3"] = node_brace_3_17;
  const mesh_brace_3_17Geometry = endpoint_brace_3_17
    ? new THREE.CylinderGeometry(endpoint_brace_3_17.endRadius, endpoint_brace_3_17.baseRadius, endpoint_brace_3_17.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_brace_3_17) {
    mesh_brace_3_17Geometry.scale(0.035, 0.065, 0.6047);
  }
  const mesh_brace_3_17 = new THREE.Mesh(
    mesh_brace_3_17Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brace_3_17.name = "Cross brace 3";
  if (endpoint_brace_3_17) {
    mesh_brace_3_17.position.copy(endpoint_brace_3_17.midpoint);
    mesh_brace_3_17.quaternion.copy(endpoint_brace_3_17.quaternion);
  }
  mesh_brace_3_17.castShadow = options.castShadow ?? true;
  mesh_brace_3_17.receiveShadow = options.receiveShadow ?? true;
  mesh_brace_3_17.userData.sculptComponent = {"id": "brace-3", "name": "Cross brace 3", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [0.775, -0.26, 0.0], "rotation": [0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_3_17.add(mesh_brace_3_17);
  meshes["brace-3"] = mesh_brace_3_17;
  colliders["brace-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["brace-3"] ??= [];
  destructionGroups["brace-3"].push(node_brace_3_17);

  const endpoint_brace_4_18 = makeAttachmentEndpoint(null);
  const node_brace_4_18 = new THREE.Group();
  node_brace_4_18.name = "Cross brace 4__pivot";
  node_brace_4_18.scale.set(1, 1, 1);
  if (endpoint_brace_4_18) {
    node_brace_4_18.position.copy(endpoint_brace_4_18.start);
    node_brace_4_18.rotation.set(-0.593, 0.0, -0.0);
  } else {
    node_brace_4_18.position.set(0.775, -0.26, 0.0);
    node_brace_4_18.rotation.set(-0.593, 0.0, -0.0);
  }
  node_brace_4_18.userData.sculptComponent = {"id": "brace-4", "name": "Cross brace 4", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [0.775, -0.26, 0.0], "rotation": [-0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_4_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_brace_4_18);
  nodes["brace-4"] = node_brace_4_18;
  const mesh_brace_4_18Geometry = endpoint_brace_4_18
    ? new THREE.CylinderGeometry(endpoint_brace_4_18.endRadius, endpoint_brace_4_18.baseRadius, endpoint_brace_4_18.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_brace_4_18) {
    mesh_brace_4_18Geometry.scale(0.035, 0.065, 0.6047);
  }
  const mesh_brace_4_18 = new THREE.Mesh(
    mesh_brace_4_18Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brace_4_18.name = "Cross brace 4";
  if (endpoint_brace_4_18) {
    mesh_brace_4_18.position.copy(endpoint_brace_4_18.midpoint);
    mesh_brace_4_18.quaternion.copy(endpoint_brace_4_18.quaternion);
  }
  mesh_brace_4_18.castShadow = options.castShadow ?? true;
  mesh_brace_4_18.receiveShadow = options.receiveShadow ?? true;
  mesh_brace_4_18.userData.sculptComponent = {"id": "brace-4", "name": "Cross brace 4", "level": "meso", "role": "beam", "importance": 0.55, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.6047, "units": "object", "confidence": 0.75}, "transform": {"position": [0.775, -0.26, 0.0], "rotation": [-0.593, 0.0, -0.0], "scale": [0.035, 0.065, 0.6047]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "brace-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 106, 53, 1.0)", "secondaryAlbedo": "rgba(138, 80, 39, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(138, 80, 39, 1.0)"}, {"position": 1.0, "color": "rgba(173, 106, 53, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.172, "bumpAmplitude": 0.0175, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "lighter worn edges", "notes": ""}, "evidenceRefs": ["full-object"], "details": []};
  node_brace_4_18.add(mesh_brace_4_18);
  meshes["brace-4"] = mesh_brace_4_18;
  colliders["brace-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["brace-4"] ??= [];
  destructionGroups["brace-4"].push(node_brace_4_18);

  const endpoint_saw_blade_19 = makeAttachmentEndpoint(null);
  const node_saw_blade_19 = new THREE.Group();
  node_saw_blade_19.name = "Saw blade__pivot";
  node_saw_blade_19.scale.set(1, 1, 1);
  if (endpoint_saw_blade_19) {
    node_saw_blade_19.position.copy(endpoint_saw_blade_19.start);
    node_saw_blade_19.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_saw_blade_19.position.set(0.0, 0.1, -0.011);
    node_saw_blade_19.rotation.set(-0.0, 0.0, -0.0);
  }
  node_saw_blade_19.userData.sculptComponent = {"id": "saw-blade", "name": "Saw blade", "level": "macro", "role": "blade", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Saw blade: a genuinely flat rigid steel plate (2.2 cm thick) whose rim is 20 hooked teeth; extruded from its measured toothed outline, so it is a flat part by design, not a curved form.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.31, 0.0], [0.363, 0.0716], [0.3119, 0.0801], [0.2948, 0.0958], [0.3231, 0.1803], [0.2719, 0.1725], [0.2508, 0.1822], [0.2516, 0.2713], [0.2053, 0.2481], [0.1822, 0.2508], [0.1554, 0.3358], [0.1185, 0.2994], [0.0958, 0.2948], [0.0441, 0.3674], [0.0202, 0.3214], [0.0, 0.31], [-0.0716, 0.363], [-0.0801, 0.3119], [-0.0958, 0.2948], [-0.1803, 0.3231], [-0.1725, 0.2719], [-0.1822, 0.2508], [-0.2713, 0.2516], [-0.2481, 0.2053], [-0.2508, 0.1822], [-0.3358, 0.1554], [-0.2994, 0.1185], [-0.2948, 0.0958], [-0.3674, 0.0441], [-0.3214, 0.0202], [-0.31, 0.0], [-0.363, -0.0716], [-0.3119, -0.0801], [-0.2948, -0.0958], [-0.3231, -0.1803], [-0.2719, -0.1725], [-0.2508, -0.1822], [-0.2516, -0.2713], [-0.2053, -0.2481], [-0.1822, -0.2508], [-0.1554, -0.3358], [-0.1185, -0.2994], [-0.0958, -0.2948], [-0.0441, -0.3674], [-0.0202, -0.3214], [-0.0, -0.31], [0.0716, -0.363], [0.0801, -0.3119], [0.0958, -0.2948], [0.1803, -0.3231], [0.1725, -0.2719], [0.1822, -0.2508], [0.2713, -0.2516], [0.2481, -0.2053], [0.2508, -0.1822], [0.3358, -0.1554], [0.2994, -0.1185], [0.2948, -0.0958], [0.3674, -0.0441], [0.3214, -0.0202]], "depth": 0.022}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.1, -0.011], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "saw-blade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(182, 186, 192, 1.0)", "secondaryAlbedo": "rgba(154, 159, 166, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(154, 159, 166, 1.0)"}, {"position": 1.0, "color": "rgba(182, 186, 192, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "saw-teeth", "kind": "ridge", "description": "20 hooked triangular teeth around the rim", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.006, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["saw-teeth"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "steel"}, "materialRegions": [{"regionId": "blade-steel", "materialId": "steel", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/01-blade-steel.png", "bbox": {"x": 525, "y": 190, "width": 80, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0059}}]};
  node_saw_blade_19.userData.actionProfile = {"animationRole": "spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "saw-blade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "steel"}};
  (nodes["root"] ?? root).add(node_saw_blade_19);
  nodes["saw-blade"] = node_saw_blade_19;
  const mesh_saw_blade_19Geometry = endpoint_saw_blade_19
    ? new THREE.CylinderGeometry(endpoint_saw_blade_19.endRadius, endpoint_saw_blade_19.baseRadius, endpoint_saw_blade_19.length, 8, 4)
    : buildExtrudeGeometry({"points": [[0.31, 0.0], [0.363, 0.0716], [0.3119, 0.0801], [0.2948, 0.0958], [0.3231, 0.1803], [0.2719, 0.1725], [0.2508, 0.1822], [0.2516, 0.2713], [0.2053, 0.2481], [0.1822, 0.2508], [0.1554, 0.3358], [0.1185, 0.2994], [0.0958, 0.2948], [0.0441, 0.3674], [0.0202, 0.3214], [0.0, 0.31], [-0.0716, 0.363], [-0.0801, 0.3119], [-0.0958, 0.2948], [-0.1803, 0.3231], [-0.1725, 0.2719], [-0.1822, 0.2508], [-0.2713, 0.2516], [-0.2481, 0.2053], [-0.2508, 0.1822], [-0.3358, 0.1554], [-0.2994, 0.1185], [-0.2948, 0.0958], [-0.3674, 0.0441], [-0.3214, 0.0202], [-0.31, 0.0], [-0.363, -0.0716], [-0.3119, -0.0801], [-0.2948, -0.0958], [-0.3231, -0.1803], [-0.2719, -0.1725], [-0.2508, -0.1822], [-0.2516, -0.2713], [-0.2053, -0.2481], [-0.1822, -0.2508], [-0.1554, -0.3358], [-0.1185, -0.2994], [-0.0958, -0.2948], [-0.0441, -0.3674], [-0.0202, -0.3214], [-0.0, -0.31], [0.0716, -0.363], [0.0801, -0.3119], [0.0958, -0.2948], [0.1803, -0.3231], [0.1725, -0.2719], [0.1822, -0.2508], [0.2713, -0.2516], [0.2481, -0.2053], [0.2508, -0.1822], [0.3358, -0.1554], [0.2994, -0.1185], [0.2948, -0.0958], [0.3674, -0.0441], [0.3214, -0.0202]], "depth": 0.022});
  if (!endpoint_saw_blade_19) {
    mesh_saw_blade_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_saw_blade_19 = new THREE.Mesh(
    mesh_saw_blade_19Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_saw_blade_19.name = "Saw blade";
  if (endpoint_saw_blade_19) {
    mesh_saw_blade_19.position.copy(endpoint_saw_blade_19.midpoint);
    mesh_saw_blade_19.quaternion.copy(endpoint_saw_blade_19.quaternion);
  }
  mesh_saw_blade_19.castShadow = options.castShadow ?? true;
  mesh_saw_blade_19.receiveShadow = options.receiveShadow ?? true;
  mesh_saw_blade_19.userData.sculptComponent = {"id": "saw-blade", "name": "Saw blade", "level": "macro", "role": "blade", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Saw blade: a genuinely flat rigid steel plate (2.2 cm thick) whose rim is 20 hooked teeth; extruded from its measured toothed outline, so it is a flat part by design, not a curved form.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.31, 0.0], [0.363, 0.0716], [0.3119, 0.0801], [0.2948, 0.0958], [0.3231, 0.1803], [0.2719, 0.1725], [0.2508, 0.1822], [0.2516, 0.2713], [0.2053, 0.2481], [0.1822, 0.2508], [0.1554, 0.3358], [0.1185, 0.2994], [0.0958, 0.2948], [0.0441, 0.3674], [0.0202, 0.3214], [0.0, 0.31], [-0.0716, 0.363], [-0.0801, 0.3119], [-0.0958, 0.2948], [-0.1803, 0.3231], [-0.1725, 0.2719], [-0.1822, 0.2508], [-0.2713, 0.2516], [-0.2481, 0.2053], [-0.2508, 0.1822], [-0.3358, 0.1554], [-0.2994, 0.1185], [-0.2948, 0.0958], [-0.3674, 0.0441], [-0.3214, 0.0202], [-0.31, 0.0], [-0.363, -0.0716], [-0.3119, -0.0801], [-0.2948, -0.0958], [-0.3231, -0.1803], [-0.2719, -0.1725], [-0.2508, -0.1822], [-0.2516, -0.2713], [-0.2053, -0.2481], [-0.1822, -0.2508], [-0.1554, -0.3358], [-0.1185, -0.2994], [-0.0958, -0.2948], [-0.0441, -0.3674], [-0.0202, -0.3214], [-0.0, -0.31], [0.0716, -0.363], [0.0801, -0.3119], [0.0958, -0.2948], [0.1803, -0.3231], [0.1725, -0.2719], [0.1822, -0.2508], [0.2713, -0.2516], [0.2481, -0.2053], [0.2508, -0.1822], [0.3358, -0.1554], [0.2994, -0.1185], [0.2948, -0.0958], [0.3674, -0.0441], [0.3214, -0.0202]], "depth": 0.022}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.8}, "transform": {"position": [0.0, 0.1, -0.011], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "saw-blade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(182, 186, 192, 1.0)", "secondaryAlbedo": "rgba(154, 159, 166, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.9, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(154, 159, 166, 1.0)"}, {"position": 1.0, "color": "rgba(182, 186, 192, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "saw-teeth", "kind": "ridge", "description": "20 hooked triangular teeth around the rim", "effect": "geometry", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.076, "bumpAmplitude": 0.006, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["saw-teeth"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "steel"}, "materialRegions": [{"regionId": "blade-steel", "materialId": "steel", "profileId": "metal.steel-brushed", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/01-blade-steel.png", "bbox": {"x": 525, "y": 190, "width": 80, "height": 80}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.0059}}]};
  node_saw_blade_19.add(mesh_saw_blade_19);
  meshes["saw-blade"] = mesh_saw_blade_19;
  colliders["saw-blade"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["saw-blade"] ??= [];
  destructionGroups["saw-blade"].push(node_saw_blade_19);

  const attachment_log_20 = {"parentId": "root", "parentSocket": "root:top", "localStart": [0.2, 0.19, 0.12], "localEnd": [0.7, 0.19, 0.12], "baseRadius": 0.1, "endRadius": 0.1, "contactType": "rests-on", "embedDepth": 0.008, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_log_20 = makeAttachmentEndpoint(attachment_log_20);
  const node_log_20 = new THREE.Group();
  node_log_20.name = "Log__pivot";
  node_log_20.scale.set(1, 1, 1);
  if (endpoint_log_20) {
    node_log_20.position.copy(endpoint_log_20.start);
    node_log_20.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_log_20.position.set(0.2, 0.19, 0.12);
    node_log_20.rotation.set(-0.0, 0.0, -0.0);
  }
  node_log_20.userData.sculptComponent = {"id": "log", "name": "Log", "level": "macro", "role": "log", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Log: a round length of trunk, a cylinder lying on the top.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:top", "localStart": [0.2, 0.19, 0.12], "localEnd": [0.7, 0.19, 0.12], "baseRadius": 0.1, "endRadius": 0.1, "contactType": "rests-on", "embedDepth": 0.008, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.2, 0.19, 0.12], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "feed", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "log", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bark"}}, "material": "bark", "materialLayers": ["bark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 92, 44, 1.0)", "secondaryAlbedo": "rgba(125, 71, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(125, 71, 34, 1.0)"}, {"position": 1.0, "color": "rgba(155, 92, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "log-streaks", "kind": "scratch", "description": "long grain streaks along the log", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.18, "bumpAmplitude": 0.0225, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["log-streaks"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "bark"}, "materialRegions": [{"regionId": "log-side", "materialId": "bark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/03-log-side.png", "bbox": {"x": 850, "y": 225, "width": 120, "height": 45}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.005}}]};
  node_log_20.userData.actionProfile = {"animationRole": "feed", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "log", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bark"}};
  (nodes["root"] ?? root).add(node_log_20);
  nodes["log"] = node_log_20;
  const mesh_log_20Geometry = endpoint_log_20
    ? new THREE.CylinderGeometry(endpoint_log_20.endRadius, endpoint_log_20.baseRadius, endpoint_log_20.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_log_20) {
    mesh_log_20Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_log_20 = new THREE.Mesh(
    mesh_log_20Geometry,
    materialMap["bark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_log_20.name = "Log";
  if (endpoint_log_20) {
    mesh_log_20.position.copy(endpoint_log_20.midpoint);
    mesh_log_20.quaternion.copy(endpoint_log_20.quaternion);
  }
  mesh_log_20.castShadow = options.castShadow ?? true;
  mesh_log_20.receiveShadow = options.receiveShadow ?? true;
  mesh_log_20.userData.sculptComponent = {"id": "log", "name": "Log", "level": "macro", "role": "log", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Log: a round length of trunk, a cylinder lying on the top.", "geometryDescriptor": {"topologyIntent": "low-poly stylized game prop, bevel-ready edges", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.01, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root:top", "localStart": [0.2, 0.19, 0.12], "localEnd": [0.7, 0.19, 0.12], "baseRadius": 0.1, "endRadius": 0.1, "contactType": "rests-on", "embedDepth": 0.008, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "object", "confidence": 0.75}, "transform": {"position": [0.2, 0.19, 0.12], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "feed", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "log", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bark"}}, "material": "bark", "materialLayers": ["bark"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(155, 92, 44, 1.0)", "secondaryAlbedo": "rgba(125, 71, 34, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "colorGradient": {"type": "linear", "axis": "y", "stops": [{"position": 0.0, "color": "rgba(125, 71, 34, 1.0)"}, {"position": 1.0, "color": "rgba(155, 92, 44, 1.0)"}]}, "evidenceRefs": ["full-object"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "log-streaks", "kind": "scratch", "description": "long grain streaks along the log", "effect": "material", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.18, "bumpAmplitude": 0.0225, "normalPattern": "mottled", "displacementPattern": "", "occlusionPattern": "cavity darkening at seams and contacts", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": ["log-streaks"], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "bark"}, "materialRegions": [{"regionId": "log-side", "materialId": "bark", "profileId": "wood.unfinished", "crop": {"path": "/home/user/Scary-Night/assets-src/img2threejs/saw-bench/material-evidence/03-log-side.png", "bbox": {"x": 850, "y": 225, "width": 120, "height": 45}, "sourceWidth": 1408, "sourceHeight": 768, "loaderWarnings": [], "coverage": 0.005}}]};
  node_log_20.add(mesh_log_20);
  meshes["log"] = mesh_log_20;
  colliders["log"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Proxy sized to the part's own bounds."};
  destructionGroups["log"] ??= [];
  destructionGroups["log"].push(node_log_20);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "real-time-stylized", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "note": "Stylized KayKit-like game prop seen at ~100 px: flat readable albedo with subtle procedural breakup; the 1024 px quality-first texture bar does not apply (textures are 256 px)."};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createSawBenchLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Saw bench look-dev lights";
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
export function createSawBenchEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameSawBenchCamera(
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
export function createSawBenchPresentationComposer(
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

export function configureSawBenchRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createSawBenchInspectControls(
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
