#!/usr/bin/env node
/* DUSKHOLD — ship an img2threejs factory into the game.
 *
 * The factory img2threejs generates (assets-src/img2threejs/<asset>/src/create<Name>Model.ts) is a
 * review artifact: every node and mesh carries its full spec JSON, every material its evidence
 * (with this machine's absolute paths), plus look-dev helpers that import three/examples. This tool
 * makes the runtime copy the game loads:
 *   - drops the review metadata (userData.sculptComponent / actionProfile / reconstructionEvidence /
 *     materialPipeline / materialReferenceRegistry / lookDevTargets / actionReadiness), keeps the
 *     runtime hierarchy (root.userData.sculptRuntime: nodes, meshes, sockets, colliders);
 *   - trims each material's spec to what createSculptMaterial reads (no referencePbr — the reference
 *     is an AI concept image and its pixels never ship — no evidence, notes or overrides);
 *   - bundles with esbuild, tree-shaken to create<Name>Model, three -> the vendored three;
 *   - writes src/game/props/<camelName>.js with a provenance banner.
 *
 *   node tools/img2threejs-build.mjs mine-cart [saw-bench ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'game', 'props');
const DROP_USERDATA = /^\s*[\w$.]+\.userData\.(sculptComponent|actionProfile|reconstructionEvidence|materialPipeline|materialReferenceRegistry|lookDevTargets|actionReadiness)\s*=/;
const DROP_MATERIAL_KEYS = new Set(['referencePbr', 'materialEvidence', 'materialReference', 'textureAnalysis', 'shaderNotes',
  'notes', 'localOverrides', 'wear', 'dirt', 'evidenceRefs', 'shaderModel', 'materialFamily', 'materialSubtype', 'materialFinish']);

function strip(src) {
  const lines = src.split('\n');
  const out = [];
  let skipping = false;
  let dropped = 0, trimmed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipping) { if (/^\s*\};\s*$/.test(line)) skipping = false; dropped++; continue; }
    if (DROP_USERDATA.test(line)) {
      dropped++;
      if (!/;\s*$/.test(line)) skipping = true;
      continue;
    }
    // a material's spec literal: the line after `createSculptMaterial(` + its id line
    if (/^\s*\{"id": /.test(line) && i >= 2 && /createSculptMaterial\(\s*$/.test(lines[i - 2])) {
      const indent = line.match(/^\s*/)[0];
      const body = line.trim().replace(/,\s*$/, '');
      const spec = JSON.parse(body);
      for (const key of Object.keys(spec)) if (DROP_MATERIAL_KEYS.has(key)) delete spec[key];
      if (spec.albedo && typeof spec.albedo === 'object') delete spec.albedo.samplingNotes;
      out.push(`${indent}${JSON.stringify(spec)},`);
      trimmed++;
      continue;
    }
    out.push(line);
  }
  return { code: out.join('\n'), dropped, trimmed };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
fs.mkdirSync(OUT_DIR, { recursive: true });
const assets = process.argv.slice(2);
if (!assets.length) { console.error('usage: node tools/img2threejs-build.mjs <asset> [...]'); process.exit(2); }
for (const asset of assets) {
  const dir = path.join(ROOT, 'assets-src', 'img2threejs', asset);
  const srcDir = path.join(dir, 'src');
  const tsFile = fs.readdirSync(srcDir).find((f) => /^create\w+Model\.ts$/.test(f));
  const ts = fs.readFileSync(path.join(srcDir, tsFile), 'utf8');
  const exportName = ts.match(/export function (create\w+Model)\(/)[1];
  const pass = (ts.match(/\/\/ Sculpt build pass: ([\w-]+)/) || [])[1] || 'unknown';
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'object-sculpt-spec.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.img2threejs', 'state.json'), 'utf8'));
  const { code, dropped, trimmed } = strip(ts);
  const outFile = path.join(OUT_DIR, `${camel(asset)}.js`);
  const vendor = path.relative(OUT_DIR, path.join(ROOT, 'src', 'vendor', 'three', 'three.module.min.js')).split(path.sep).join('/');
  const banner = [
    `/* DUSKHOLD prop "${spec.targetName}" — GENERATED, do not edit.`,
    ` * Source: assets-src/img2threejs/${asset}/ (reference concept image -> object-sculpt-spec.json via author.py ->`,
    ` * img2threejs generate_threejs_factory.py, pass "${pass}", checklist status "${state.status}").`,
    ` * Rebuild: node tools/img2threejs-build.mjs ${asset}. Review metadata stripped (${dropped} lines), ${trimmed} material`,
    ' * specs trimmed to what the factory reads; no reference pixels ship (procedural canvas maps only).',
    ' * Generator: img2threejs (Apache-2.0), .agents/skills/img2threejs. */',
  ].join('\n');
  // the stripped module goes to the cache; the entry re-exports only the model factory so the look-dev
  // helpers (and their three/examples imports) are tree-shaken away
  const cacheDir = path.join(ROOT, 'tools', '.cache', 'img2threejs');
  fs.mkdirSync(cacheDir, { recursive: true });
  const stripped = path.join(cacheDir, `${asset}-runtime.ts`);
  fs.writeFileSync(stripped, code);
  await esbuild.build({
    stdin: { contents: `export { ${exportName} } from ${JSON.stringify(stripped)};`, resolveDir: cacheDir, loader: 'ts' },
    bundle: true, format: 'esm', target: 'es2020', minify: true, legalComments: 'none',
    banner: { js: banner }, outfile: outFile, logLevel: 'warning',
    plugins: [{
      name: 'duskhold-three',
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({ path: vendor.startsWith('.') ? vendor : `./${vendor}`, external: true }));
        build.onResolve({ filter: /^three\/examples\// }, (a) => ({ path: a.path, namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: ['RoomEnvironment', 'EffectComposer', 'RenderPass', 'BokehPass', 'UnrealBloomPass', 'OrbitControls', 'OutputPass', 'ShaderPass']
            .map((n) => `export const ${n} = null;`).join('\n'), loader: 'js' }));
      },
    }],
  });
  // only the model factory is exported (tree-shaken); re-export check
  const built = fs.readFileSync(outFile, 'utf8');
  if (!new RegExp(`export\\s*\\{[^}]*\\bas ${exportName}\\b|export\\s*\\{[^}]*\\b${exportName}\\b`).test(built)) {
    // esbuild exports every top-level export of the stdin module; that is fine, just report
  }
  console.log(JSON.stringify({ asset, out: path.relative(ROOT, outFile), exportName, pass, bytes: built.length, droppedLines: dropped, trimmedMaterials: trimmed }));
}
