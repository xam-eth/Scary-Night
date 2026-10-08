/* LAST NIGHT — the Play bundle, checked without a JDK or an SDK.
 *
 * Everything Play and Bubblewrap will judge that can be judged from the repo:
 * the web manifest and its icons, the service worker, the asset links, the
 * billing rail (a TWA cannot sell through Midtrans), and that no server key
 * or keystore is sitting in the files that get deployed.
 *
 *   node tools/bundlecheck.mjs
 *
 * Exit code 1 if anything is wrong, so `tools/bundle.mjs build` runs it first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (p) => path.join(ROOT, p.replace(/^\.?\//, ''));
const read = (p) => (fs.existsSync(P(p)) ? fs.readFileSync(P(p), 'utf8') : null);
const rel = (p) => path.relative(ROOT, P(p));

let bad = 0;
const ok = (b, msg, note) => {
  if (!b) bad++;
  console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}${note ? ` — ${note}` : ''}`);
};
const info = (msg) => console.log(`  ....  ${msg}`);
/* A config gate is not a code defect: it is the one value only the person
 * publishing knows. Loud, and not a failure. */
const warns = [];
const warn = (b, msg, note) => {
  if (b) return true;
  warns.push(msg);
  console.log(`  WARN  ${msg}${note ? ` — ${note}` : ''}`);
  return false;
};

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function json(p) {
  try { return JSON.parse(fs.readFileSync(P(p), 'utf8')); } catch (e) { return null; }
}

console.log('LAST NIGHT — Play bundle check\n');

/* ------------------------------------------------------------------ config */
console.log('-- config --');
const cfg = json('bundle.config.json');
ok(!!cfg, 'bundle.config.json reads as JSON');
if (!cfg) process.exit(1);
const hostOk = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(cfg.host.replace(/\/$/, ''));
ok(hostOk, `host is an https origin`, cfg.host);
warn(!/your\.host|example\.com|localhost|127\.0\.0\.1/.test(cfg.host),
  'host is the real origin, not the placeholder', 'set bundle.config.json -> host, then: node tools/bundle.mjs prepare');
ok(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(cfg.packageId),
  `packageId looks like a reverse domain (${cfg.packageId})`);
ok(Number.isInteger(cfg.versionCode) && cfg.versionCode > 0, `versionCode is a positive integer (${cfg.versionCode})`);
ok(/^\d+\.\d+\.\d+/.test(cfg.versionName), `versionName is semver-ish (${cfg.versionName})`);
info(`packageId is permanent on Play: ${cfg.packageId}`);

/* ---------------------------------------------------------------- manifest */
console.log('\n-- web manifest --');
const mf = json('manifest.webmanifest');
ok(!!mf, 'manifest.webmanifest reads as JSON');
if (mf) {
  ok(!!mf.name && !!mf.short_name, `name and short_name are set (${mf.short_name})`);
  ok((mf.short_name || '').length <= 12, `short_name fits the launcher (${(mf.short_name || '').length}/12 chars)`);
  ok(!!mf.start_url && !!mf.scope, `start_url and scope are set (${mf.start_url})`);
  ok(['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(mf.display), `display is a mode Bubblewrap accepts (${mf.display})`);
  ok(mf.orientation === 'portrait', 'orientation is portrait (the game is 9:16)');
  ok(/^#[0-9a-f]{6}$/i.test(mf.theme_color || ''), `theme_color is a hex colour (${mf.theme_color})`);
  ok(/^#[0-9a-f]{6}$/i.test(mf.background_color || ''), `background_color is a hex colour (${mf.background_color})`);

  const icons = mf.icons || [];
  const any = icons.filter((i) => (i.purpose || 'any') === 'any');
  const mask = icons.filter((i) => (i.purpose || '').includes('maskable'));
  ok(any.some((i) => i.sizes.includes('192')), 'a 192px icon is declared (Chrome installability)');
  ok(any.some((i) => i.sizes.includes('512')), 'a 512px icon is declared (Bubblewrap minimum is 512)');
  ok(mask.length > 0, 'a maskable icon is declared (Android adaptive icon)');
  let allFound = true, allSized = true, detail = [];
  for (const i of icons) {
    const f = P(i.src.replace(new URL(cfg.host).origin || '', ''));
    if (!fs.existsSync(f)) { allFound = false; detail.push(`${i.src} missing`); continue; }
    const s = pngSize(f);
    const want = parseInt(i.sizes, 10);
    if (!s || s.w !== want || s.h !== want) { allSized = false; detail.push(`${i.src} is ${s ? `${s.w}x${s.h}` : 'not a PNG'}, declared ${i.sizes}`); }
  }
  ok(allFound, 'every declared icon exists on disk', detail.join('; '));
  ok(allSized, 'and is exactly the size it declares', detail.join('; '));
}

/* ---------------------------------------------------------- service worker */
console.log('\n-- service worker --');
const sw = read('sw.js');
ok(!!sw, 'sw.js exists');
if (sw) {
  const parsed = spawnSync(process.execPath, ['--check', P('sw.js')], { encoding: 'utf8' });
  ok(parsed.status === 0, 'sw.js parses', parsed.stderr ? parsed.stderr.split('\n')[2] : '');
  ok(/addEventListener\(\s*'install'/.test(sw), 'it has an install handler');
  ok(/addEventListener\(\s*'activate'/.test(sw), 'it has an activate handler (old caches get dropped)');
  ok(/addEventListener\(\s*'fetch'/.test(sw), 'it has a fetch handler (Chrome installability)');
  ok(/offline/i.test(sw), 'it serves an offline page when the network is gone');
  const cachesPost = /(method\s*!==\s*'GET'|method\s*===\s*'POST')/.test(sw);
  ok(cachesPost, 'it refuses to cache anything but GET — payment calls must never be cached');
  const skipsApi = /\/api\/|api\//.test(sw);
  ok(skipsApi, 'it names the /api/ paths to leave alone');
  const html = read('index.html') || '';
  ok(/serviceWorker\.register/.test(html), 'index.html registers the service worker');
  ok(/location\.protocol\s*===\s*'https:'/.test(html), 'and only over https — localhost dev stays untouched');
  const off = read('offline.html');
  ok(!!off, 'offline.html exists');
  if (off) {
    const external = [...off.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)]
      .map((m) => m[1]).filter((u) => /^(https?:)?\/\//.test(u));
    ok(external.length === 0, 'offline.html pulls in nothing from the network', external.join(', '));
  }
}

/* -------------------------------------------------------------- asset links */
console.log('\n-- digital asset links --');
const al = json('.well-known/assetlinks.json');
ok(!!al, '.well-known/assetlinks.json exists (the TWA only hides its URL bar with this)');
if (al && al[0]) {
  const t = al[0].target || {};
  ok(t.namespace === 'android_app' && t.package_name === cfg.packageId,
    `it targets this app (${t.package_name})`);
  const sha = t.sha256_certificates || [];
  const hex = sha.filter((s) => /^[0-9A-F]{64}$/i.test(s));
  ok(sha.length > 0, 'at least one fingerprint is listed');
  warn(hex.length === sha.length && sha.length > 0,
    `every fingerprint is a real 64-char SHA-256 (${sha.length} of them)`,
    'bubblewrap fingerprint writes it; Play Console -> App signing has the one that matters');
}

/* -------------------------------------------------------------- the billing */
console.log('\n-- the billing rail --');
const iap = read('src/shop/iap.js') || '';
const dg = read('src/shop/digitalgoods.js') || '';
ok(!!dg, 'src/shop/digitalgoods.js exists (Play Billing through the Digital Goods API)');
ok(/getDigitalGoodsService/.test(dg), 'it connects to https://play.google.com/billing');
ok(/PaymentRequest/.test(dg), 'it buys through the Payment Request API, the way Play requires');
ok(/acknowledge|consume/.test(dg), 'it acknowledges non-consumables and consumes consumables');
ok(/listPurchases/.test(dg), 'restore reads listPurchases()');
ok(/getDigitalGoodsService|DigitalGoods/.test(iap), 'iap.js knows about the rail');
const order = ['LNBridge', 'DigitalGoods', 'Midtrans'].map((k) => iap.indexOf(k));
ok(order[0] >= 0 && order[1] > order[0], 'and prefers it after a native bridge, before Midtrans');
ok(/inTwa|android-app:|isTwa/.test(iap), 'and Midtrans is switched off inside a TWA (Play Payments policy)');
const html2 = read('index.html') || '';
const ot = /<meta\s+http-equiv=["']origin-trial["']\s+content=["']([A-Za-z0-9_\-]{40,})["']/.exec(html2);
warn(!!ot, 'the Digital Goods origin trial token is in index.html',
  'uncomment the meta tag and paste your token — without it the Play shop takes no money');
const twaMf = json('android/twa-manifest.json');
ok(!!twaMf, 'android/twa-manifest.json exists');
if (twaMf) {
  ok(twaMf.features && twaMf.features.playBilling && twaMf.features.playBilling.enabled === true,
    'features.playBilling is on — that is what installs the Digital Goods handler in the app');
  ok(twaMf.packageId === cfg.packageId, `packageId matches the config (${twaMf.packageId})`);
  ok(new URL(twaMf.webManifestUrl).host === new URL(cfg.host).host, `webManifestUrl points at the host (${twaMf.webManifestUrl})`);
  ok(twaMf.appVersion === cfg.versionName, `appVersion is spelled the way the schema reads it (${twaMf.appVersion})`);

  /* The real thing, when it is installed: Bubblewrap's own class, which is
   * the only judge of a twa-manifest that cannot be argued with. Caught a
   * version field that validated fine and shipped as undefined.
   * ESM will not look where npm -g puts things, so the global root is asked
   * for by name. BUBBLEWRAP_PATH overrides it for a local checkout. */
  let TwaManifest = null;
  const candidates = ['@bubblewrap/core'];
  if (process.env.BUBBLEWRAP_PATH) candidates.unshift(process.env.BUBBLEWRAP_PATH);
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.push(path.join(globalRoot, '@bubblewrap', 'core'));
    candidates.push(path.join(globalRoot, '@bubblewrap', 'cli', 'node_modules', '@bubblewrap', 'core'));
  } catch (e) { /* no npm here */ }
  for (const id of candidates) {
    try { ({ TwaManifest } = await import(pathToFileURL(require.resolve(id)).href)); break; } catch (e) { /* not installed */ }
  }
  if (!TwaManifest) {
    info('Bubblewrap is not installed here — skipping the schema check (npm i -g @bubblewrap/cli)');
  } else {
    try {
      const m = new TwaManifest(twaMf);
      if (typeof m.validate === 'function') m.validate();
      ok(!!m.appVersionName, `a real TwaManifest builds from it — version ${m.appVersionName} (${m.appVersionCode})`);
    } catch (e) {
      ok(false, 'a real TwaManifest builds from it', e.message);
    }
  }
}

/* ---------------------------------------------------------------- secrets */
console.log('\n-- secrets --');
const webFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(P(dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`.replace(/^\.\//, '');
    if (e.isDirectory()) { if (!/node_modules|\.git$/.test(e.name)) walk(p); continue; }
    if (/\.(js|mjs|html|json|css|webmanifest)$/.test(e.name)) webFiles.push(p);
  }
};
walk('src'); walk('assets');
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'offline.html', 'privacy.html', 'delete.html']) {
  if (fs.existsSync(P(f))) webFiles.push(f);
}
const secretHit = [];
for (const f of webFiles) {
  const t = read(f);
  if (!t) continue;
  if (/SB-Mid-server|Mid-server-|server_key\s*[:=]\s*['"][A-Za-z0-9_-]{20,}/i.test(t)) secretHit.push(`${f}: a Midtrans SERVER key`);
  if (/BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY/.test(t)) secretHit.push(`${f}: a private key`);
  if (/(storePassword|keyPassword)\s*[:=]\s*['"][^'"]{8,}/.test(t)) secretHit.push(`${f}: a keystore password`);
}
ok(secretHit.length === 0, 'no server key, private key or keystore password in anything that gets deployed', secretHit.join('; '));

const gi = read('.gitignore') || '';
ok(/\*\.jks|\*\.keystore|\*\.p12/.test(gi), '.gitignore excludes keystores');
ok(/signing\.local\.json/.test(gi), '.gitignore excludes the signing password file');
for (const f of ['android/lastnight-upload.jks', 'android/signing.local.json']) {
  if (fs.existsSync(P(f))) ok(false, `${f} must never be committed`, 'it exists — make sure git is ignoring it');
}

/* ------------------------------------------------------ assets referenced */
console.log('\n-- what the page loads --');
const html = read('index.html') || '';
const refs = [...html.matchAll(/(?:src|href)\s*=\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
const missing = refs.filter((r) => !fs.existsSync(P(r)));
ok(refs.length > 0 && missing.length === 0, `every local file index.html references exists (${refs.length} checked)`, missing.join(', '));

/* --------------------------------------------------------------- the rules */
console.log('\n-- 2026 Play rules this build has to answer --');
info('target API 36 (Android 16): the Bubblewrap template sets compileSdk/targetSdk 36 — check after init');
info(`minSdk ${cfg.minSdkVersion} — Bubblewrap default is 23`);
info('AAB, not APK: bubblewrap build produces app-release-bundle.aab');
info('Play Billing Library 8+ applies to native billing; a TWA bills through the Digital Goods API and the androidbrowserhelper:billing delegate');
info('developer verification + package registration: enforced from 30 Sep 2026 in Indonesia, where this account is');
info('closed testing: 12 testers x 14 continuous days for personal accounts created after 13 Nov 2023');

console.log(`\n${bad === 0 ? 'bundle check: all PASS' : `bundle check: ${bad} FAILED`}`);
if (warns.length) {
  console.log(`${warns.length} thing${warns.length === 1 ? '' : 's'} only you can fill in:`);
  for (const w of warns) console.log(`  - ${w}`);
}
console.log('');
process.exit(bad === 0 ? 0 : 1);
