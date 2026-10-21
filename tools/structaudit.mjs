/**
 * structaudit — bukti data untuk pass perapian struktur (2026-10-21).
 *
 * User: "kamu harus audit dulu semuanya debug dan pastikan tidak menghapus
 * file yg masih terpakai ... kebenaran harus dibuktikan dengan data".
 * Skrip ini TIDAK menghapus apa pun; ia mengukur:
 *   1. graph import src/**.js  → siapa mengimpor siapa, modul yatim (orphan),
 *      dan pelanggaran lapis (core→game, game→ui, dst);
 *   2. matriks pemakaian tools/*  → direferensi package.json / docs / chain /
 *      workflow / tool lain, atau benar-benar scratch;
 *   3. referensi aset & file root → aset yang tidak disebut siapa pun;
 *   4. LOC per file src → kandidat pecah modul (file raksasa).
 * Output: docs/audit/struct-audit.json + tabel markdown di stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '';
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};

/* ---------- 1. import graph of src ---------- */
const srcFiles = walk('src').filter((f) => f.endsWith('.js'));
const importers = new Map(srcFiles.map((f) => [f, []]));
const edges = [];
const layerOf = (f) => { const parts = f.split('/'); return parts[0] === 'src' ? (parts[2] ? parts[1] : 'root') : parts[0]; };
for (const file of srcFiles) {
  const code = read(file);
  for (const m of code.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    if (!importers.has(target)) importers.set(target, []);   // vendor or outside
    importers.get(target)?.push(file);
    edges.push({ from: file, to: target });
  }
}
const entries = new Set(['src/main.js']);
const html = read('index.html');
for (const m of html.matchAll(/src="([^"]+\.js)"/g)) entries.add(path.posix.normalize(m[1].replace(/^\.\//, '')));
const orphans = srcFiles.filter((f) => !entries.has(f) && (importers.get(f) || []).length === 0);
const LAYERS = ['core', 'game', 'ui', 'shop', 'vendor', 'root'];
const layerViolations = edges.filter(({ from, to }) => {
  const a = layerOf(from), b = layerOf(to);
  if (a === b || b === 'vendor') return false;
  // allowed: ui→core, ui→game (read-only contracts), game→core, shop→core
  const allowed = new Set(['ui>core', 'ui>game', 'game>core', 'shop>core', 'root>core', 'root>game', 'root>ui', 'root>shop', 'root>vendor', 'game>game', 'ui>ui', 'game>shop', 'ui>shop']);
  return !allowed.has(`${a}>${b}`);
});
const loc = srcFiles.map((f) => [f, read(f).split('\n').length]).sort((a, b) => b[1] - a[1]);

/* ---------- 2. tools usage matrix ---------- */
const toolFiles = walk('tools').filter((f) => /\.(mjs|sh|js)$/.test(f) && !f.includes('node_modules'));
const corpus = [
  'tools/package.json', 'README.md', ...walk('docs').filter((f) => f.endsWith('.md')),
  ...walk('.github').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')),
  ...toolFiles.filter((f) => f.endsWith('.sh')),
].filter(exists).map(read).join('\n');
const toolsMatrix = toolFiles.map((f) => {
  const base = path.posix.basename(f);
  const stem = base.replace(/\.(mjs|sh|js)$/, '');
  const refs = (corpus.match(new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    - (corpus.includes(base) ? 0 : 0);
  const inPkg = read('tools/package.json').includes(stem);
  const inDocs = walk('docs').filter((d) => d.endsWith('.md')).some((d) => read(d).includes(stem));
  const inChain = toolFiles.some((s) => s.endsWith('.sh') && read(s).includes(base));
  const inCi = exists('.github') && walk('.github').some((d) => d.endsWith('.yml') && read(d).includes(stem));
  return { file: f, refs, inPkg, inDocs, inChain, inCi, used: refs > 1 || inPkg || inDocs || inChain || inCi };
});

/* ---------- 3. asset & root reference audit ---------- */
const codeCorpus = srcFiles.map(read).join('\n') + html + read('sw.js');
const assetDirs = fs.readdirSync(path.join(ROOT, 'assets'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const assetRefs = assetDirs.map((dir) => {
  const files = walk(`assets/${dir}`);
  const referenced = files.filter((f) => codeCorpus.includes(dir) || codeCorpus.includes(path.posix.basename(f)));
  return { dir, files: files.length, referenced: referenced.length };
});
const rootFiles = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
const rootRefs = rootFiles.map((f) => ({
  file: f,
  referenced: f === 'index.html' || f === 'package.json' || f === 'README.md' || codeCorpus.includes(f)
    || walk('docs').some((d) => d.endsWith('.md') && read(d).includes(f))
    || toolFiles.some((t) => read(t).includes(f)),
}));

/* ---------- output ---------- */
const report = {
  generated: new Date().toISOString(),
  src: {
    files: srcFiles.length,
    locTotal: loc.reduce((s, [, n]) => s + n, 0),
    biggest: loc.slice(0, 12),
    orphans,
    layerViolations: layerViolations.map((e) => `${e.from} -> ${e.to}`),
    fanIn: [...importers.entries()].map(([f, list]) => [f, list.length]).sort((a, b) => b[1] - a[1]).slice(0, 12),
  },
  tools: toolsMatrix,
  assets: assetRefs,
  root: rootRefs,
};
fs.mkdirSync(path.join(ROOT, 'docs/audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/audit/struct-audit.json'), JSON.stringify(report, null, 2));

console.log('== SRC: file', srcFiles.length, '| LOC', report.src.locTotal);
console.log('== SRC biggest:');
for (const [f, n] of report.src.biggest) console.log(`   ${n.toString().padStart(6)}  ${f}`);
console.log('== SRC orphans:', orphans.join(', ') || 'none');
console.log('== SRC layer violations:', report.src.layerViolations.join(', ') || 'none');
console.log('== SRC fan-in top:');
for (const [f, n] of report.src.fanIn) console.log(`   ${String(n).padStart(3)}  ${f}`);
console.log('== TOOLS unused (no pkg/docs/chain/CI ref, <=1 mention):');
for (const t of toolsMatrix.filter((t) => !t.used)) console.log(`   ${t.file} (refs ${t.refs})`);
console.log('== ASSETS dirs:');
for (const a of assetRefs) console.log(`   ${a.dir}: ${a.referenced}/${a.files} referenced`);
console.log('== ROOT unreferenced:');
for (const r of rootRefs.filter((r) => !r.referenced)) console.log(`   ${r.file}`);
