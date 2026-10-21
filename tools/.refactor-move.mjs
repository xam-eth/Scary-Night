/**
 * Fase 2 perapian: pemindahan folder modul + rewrite semua import yang
 * menunjuk path lama (src/, tools/, termasuk dynamic import in-page di
 * string page.evaluate). Menjalankan git mv terpisah; skrip ini hanya
 * menulis ulang specifier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MOVES = {
  'src/game/world3d.js': 'src/game/render3d/world3d.js',
  'src/game/buildings3d.js': 'src/game/render3d/buildings3d.js',
  'src/game/enemy3d.js': 'src/game/render3d/enemy3d.js',
  'src/game/troop3d.js': 'src/game/render3d/troop3d.js',
  'src/game/valen3d.js': 'src/game/render3d/valen3d.js',
  'src/game/pack3d.js': 'src/game/render3d/pack3d.js',
  'src/game/crowd3d.js': 'src/game/render3d/crowd3d.js',
  'src/game/envkit.js': 'src/game/render3d/envkit.js',
  'src/game/lightbake.js': 'src/game/render3d/lightbake.js',
  'src/game/survival.js': 'src/game/sim/survival.js',
  'src/game/economy.js': 'src/game/sim/economy.js',
  'src/game/enemies.js': 'src/game/sim/enemies.js',
  'src/game/fortress.js': 'src/game/sim/fortress.js',
  'src/game/objectives.js': 'src/game/sim/objectives.js',
  'src/game/weapons.js': 'src/game/sim/weapons.js',
  'src/game/hunt.js': 'src/game/sim/hunt.js',
  'src/game/house.js': 'src/game/sim/house.js',
  'src/game/mansion.js': 'src/game/sim/mansion.js',
  'src/game/exterior.js': 'src/game/sim/exterior.js',
  'src/game/haunts.js': 'src/game/sim/haunts.js',
  'src/game/director.js': 'src/game/meta/director.js',
  'src/game/coach.js': 'src/game/meta/coach.js',
  'src/game/narrative.js': 'src/game/meta/narrative.js',
  'src/game/climax.js': 'src/game/meta/climax.js',
  'src/game/informant.js': 'src/game/meta/informant.js',
  'src/game/hud.js': 'src/ui/hud.js',
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};

const targets = [
  ...walk('src'), ...walk('tools'),
].filter((f) => /\.(mjs|js)$/.test(f) && !f.includes('node_modules') && !f.includes('tools/archive'));

let changed = 0, movedCount = 0;
for (const file of targets) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const newFile = MOVES[file] || file;
  const newDir = path.posix.dirname(newFile);
  let out = code;
  // relative import specifiers: resolve against the OLD dir, emit relative
  // to the NEW dir of this file
  out = out.replace(/(['"])(\.{1,2}\/[^'"]+\.js)\1/g, (m, q, spec) => {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const target = MOVES[abs] || abs;
    if (!MOVES[abs] && !abs.startsWith('src/')) return m;
    const rel = path.posix.relative(newDir, target);
    return `${q}${rel.startsWith('.') ? rel : `./${rel}`}${q}`;
  });
  // root-relative in-page imports ('./src/game/x.js' from page context)
  out = out.replace(/(['"])\.\/(src\/game\/[^'"]+\.js)\1/g, (m, q, abs) => {
    const moved = MOVES[abs];
    return moved ? `${q}./${moved}${q}` : m;
  });
  if (newFile !== file) {
    fs.mkdirSync(path.join(ROOT, path.posix.dirname(newFile)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, newFile), out);
    fs.rmSync(path.join(ROOT, file));
    movedCount++;
  } else if (out !== code) {
    fs.writeFileSync(path.join(ROOT, file), out);
  }
  if (out !== code || newFile !== file) changed++;
}
console.log(`touched ${changed} files, moved ${movedCount}`);
