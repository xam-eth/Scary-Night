/* DUSKHOLD — the Play bundle driver.
 *
 *   node tools/bundle.mjs check      everything that can be checked without
 *                                    a JDK (manifest, icons, service worker,
 *                                    asset links, the billing rail, secrets)
 *   node tools/bundle.mjs prepare    write manifest.webmanifest,
 *                                    .well-known/assetlinks.json and
 *                                    android/twa-manifest.json from
 *                                    bundle.config.json
 *   node tools/bundle.mjs key        make the upload keystore (once, ever)
 *   node tools/bundle.mjs build      check -> prepare -> key -> bubblewrap
 *                                    update -> bubblewrap build
 *
 * The Android SDK, Gradle and a JDK 17 are not optional for `build`; Bubblewrap
 * will offer to install them on a machine that can reach dl.google.com. This
 * script never guesses at a build: if a tool is missing it says which one and
 * stops. (Nothing here touches the game code — the TWA loads the site you
 * already host.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG_PATH = path.join(ROOT, 'bundle.config.json');
const ANDROID = path.join(ROOT, 'android');
const CMD = (process.argv[2] || 'help').toLowerCase();

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\n  FAIL  ${msg}`); process.exit(1); };
const pathIn = (p) => path.join(ROOT, p.replace(/^\.?\//, ''));

function cfg() {
  if (!fs.existsSync(CFG_PATH)) fail(`no ${path.relative(ROOT, CFG_PATH)} — copy the template and configure the HTTPS origin`);
  return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
}

/* ------------------------------------------------------------------ prepare */

function writeManifest(c) {
  const base = c.basePath.endsWith('/') ? c.basePath : c.basePath + '/';
  const rel = (p) => base + p;
  const manifest = {
    id: rel('index.html'),
    name: c.appName,
    short_name: c.shortName,
    description: c.description,
    lang: 'en',
    dir: 'ltr',
    start_url: rel('index.html'),
    scope: base,
    display: c.display,
    orientation: c.orientation,
    background_color: c.backgroundColor,
    theme_color: c.themeColor,
    categories: ['games', 'entertainment'],
    prefer_related_applications: false,
    icons: [
      { src: rel('assets/brand/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: rel('assets/brand/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: rel('assets/brand/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const file = path.join(ROOT, 'manifest.webmanifest');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  log(`  wrote ${path.relative(ROOT, file)}`);
  return { manifest, base };
}

function writeAssetLinks(c, fingerprints) {
  const dir = path.join(ROOT, '.well-known');
  fs.mkdirSync(dir, { recursive: true });
  const sha = fingerprints && fingerprints.length
    ? fingerprints
    : ['REPLACE_WITH_THE_SHA256_FROM_bubblewrap_fingerprint_OR_PLAY_CONSOLE'];
  const file = path.join(dir, 'assetlinks.json');
  fs.writeFileSync(file, JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: c.packageId,
      sha256_certificates: sha,
    },
  }], null, 2) + '\n');
  log(`  wrote ${path.relative(ROOT, file)} (${sha.length} fingerprint${sha.length === 1 ? '' : 's'})`);
  return file;
}

function writeTwaManifest(c, base) {
  fs.mkdirSync(ANDROID, { recursive: true });
  const twa = {
    packageId: c.packageId,
    host: new URL(c.host).host,
    name: c.appName,
    launcherName: c.launcherName,
    display: c.display,
    orientation: c.orientation,
    themeColor: c.themeColor,
    themeColorDark: c.themeColor,
    navigationColor: c.navigationColor,
    navigationColorDark: c.navigationColor,
    navigationDividerColor: c.navigationColor,
    navigationDividerColorDark: c.navigationColor,
    backgroundColor: c.backgroundColor,
    enableNotifications: false,
    startUrl: base + 'index.html',
    iconUrl: c.host.replace(/\/$/, '') + base + 'assets/brand/icon-512.png',
    maskableIconUrl: c.host.replace(/\/$/, '') + base + 'assets/brand/icon-maskable-512.png',
    splashScreenFadeOutDuration: c.splashScreenFadeOutDuration,
    signingKey: c.signingKey,
    appVersionCode: c.versionCode,
    /* `appVersion`, not `appVersionName`: the JSON schema has always spelled
     * it that way (the class field is the one with the longer name), and
     * getting it wrong ships an app with no version string at all. */
    appVersion: c.versionName,
    shortcuts: [],
    generatorApp: 'Bubblewrap',
    webManifestUrl: c.host.replace(/\/$/, '') + base + 'manifest.webmanifest',
    fallbackType: 'customtabs',
    features: {
      /* This one flag is the whole Play Billing story: Bubblewrap adds
       * androidbrowserhelper:billing, a PaymentActivity that answers
       * org.chromium.intent.action.PAY, and a DigitalGoodsRequestHandler in
       * the delegation service — which is what makes
       * window.getDigitalGoodsService('https://play.google.com/billing')
       * resolve inside the TWA. Without it the Digital Goods API is absent
       * and the shop has no rail but Midtrans, which Play does not allow. */
      playBilling: { enabled: true },
    },
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: false,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: c.host.replace(/\/$/, '') + base,
    minSdkVersion: c.minSdkVersion,
    orientationLock: false,
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
  };
  const file = path.join(ANDROID, 'twa-manifest.json');
  fs.writeFileSync(file, JSON.stringify(twa, null, 2) + '\n');
  log(`  wrote ${path.relative(ROOT, file)}`);
  return file;
}

function prepare() {
  const c = cfg();
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    if (!fs.existsSync(path.join(ROOT, 'assets/brand', icon))) {
      fail(`missing assets/brand/${icon} — run: node tools/makeicons.mjs`);
    }
  }
  const { base } = writeManifest(c);
  writeAssetLinks(c, readFingerprints());
  writeTwaManifest(c, base);
  log('  prepare done');
}

function readFingerprints() {
  const twa = path.join(ANDROID, 'twa-manifest.json');
  if (!fs.existsSync(twa)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(twa, 'utf8'));
    return (j.fingerprints || []).map((f) => (typeof f === 'string' ? f : f.value));
  } catch (e) { return null; }
}

/* ---------------------------------------------------------------------- key */

function keytool() {
  const home = process.env.JAVA_HOME;
  const candidates = [home && path.join(home, 'bin', 'keytool'), 'keytool'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-help'], { encoding: 'utf8' });
    if (!r.error) return c;
  }
  return null;
}

function makeKey() {
  const c = cfg();
  const kt = keytool();
  if (!kt) {
    fail([
      'no keytool — the upload keystore needs a JDK 17.',
      '  Bubblewrap installs one for you:  npx @bubblewrap/cli init  (answer yes to the JDK)',
      '  or point JAVA_HOME at a JDK 17 and run this again.',
      '  (JDK 18+ is refused by the Android command line tools — it has to be 17.)',
    ].join('\n     '));
  }
  const keyPath = pathIn(c.signingKey.path);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (fs.existsSync(keyPath)) { log(`  keystore already exists: ${path.relative(ROOT, keyPath)}`); return keyPath; }
  const secret = path.join(ANDROID, 'signing.local.json');
  const pass = Array.from({ length: 24 }, () => 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 54)]).join('');
  const dname = `CN=DUSKHOLD, OU=Game, O=${new URL(c.host).host}, L=., S=., C=ID`;
  execFileSync(kt, [
    '-genkeypair', '-v', '-keystore', keyPath, '-alias', c.signingKey.alias,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', pass, '-keypass', pass, '-dname', dname,
  ], { stdio: 'inherit' });
  fs.writeFileSync(secret, JSON.stringify({
    _warning: 'NEVER commit this file. It is the upload key password. Back it up somewhere that is not git.',
    keystore: path.relative(ROOT, keyPath),
    alias: c.signingKey.alias,
    storePassword: pass,
    keyPassword: pass,
  }, null, 2) + '\n');
  log(`  keystore: ${path.relative(ROOT, keyPath)}`);
  log(`  password: ${path.relative(ROOT, secret)}  (gitignored — back it up, losing it locks you out of updates)`);
  return keyPath;
}

/* -------------------------------------------------------------------- build */

function bubblewrap() {
  const r = spawnSync('npx', ['--no-install', '@bubblewrap/cli', 'version'], { encoding: 'utf8', cwd: ROOT });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim();
}

function build() {
  const c = cfg();
  if (/your\.host|example\.com|localhost/.test(c.host)) {
    fail(`bundle.config.json still says "${c.host}". Set the real HTTPS origin of the game first —
     a TWA is verified against that origin, and changing it later means a new package.`);
  }
  const check = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'bundlecheck.mjs')], { encoding: 'utf8', cwd: ROOT });
  process.stdout.write(check.stdout || '');
  if (check.status !== 0) fail('bundlecheck failed — fix the above before building');

  prepare();
  makeKey();

  const ver = bubblewrap();
  if (!ver) {
    fail([
      'Bubblewrap is not installed. On a machine with network access:',
      '  npm install -g @bubblewrap/cli',
      'then, in android/ (JDK 17 + the Android SDK are installed by bubblewrap init):',
      '  npx @bubblewrap/cli init --manifest ' + c.host.replace(/\/$/, '') + (c.basePath === '/' ? '/manifest.webmanifest' : c.basePath + 'manifest.webmanifest'),
      '  npx @bubblewrap/cli fingerprint --help      # write the SHA-256 into .well-known/assetlinks.json',
      '  npx @bubblewrap/cli build                   # -> app-release-bundle.aab',
    ].join('\n     '));
  }
  log(`  bubblewrap ${ver}`);
  const run = (args) => {
    const r = spawnSync('npx', ['--no-install', '@bubblewrap/cli', ...args], { stdio: 'inherit', cwd: ANDROID });
    if (r.status !== 0) fail(`bubblewrap ${args.join(' ')} exited ${r.status}`);
  };
  if (!fs.existsSync(path.join(ANDROID, 'app', 'build.gradle'))) {
    fail(`android/ has no project yet. Run first (one time):
     npx @bubblewrap/cli init --manifest ${c.host.replace(/\/$/, '')}${c.basePath}manifest.webmanifest`);
  }
  run(['update']);
  run(['build']);
  const aab = path.join(ANDROID, 'app-release-bundle.aab');
  const apk = path.join(ANDROID, 'app-release-signed.apk');
  log('');
  for (const f of [aab, apk]) log(`  ${fs.existsSync(f) ? 'OK  ' : '??  '} ${path.relative(ROOT, f)}${fs.existsSync(f) ? `  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB` : ''}`);
  log([
    '',
    '  next:',
    '   1. Upload the AAB to Play Console (internal testing first).',
    '   2. Play Console -> Setup -> App signing: copy the SHA-256 of the APP SIGNING',
    '      certificate (not the upload certificate) into .well-known/assetlinks.json,',
    '      then re-publish that file at the origin root. Until it matches, the TWA',
    '      shows a URL bar and reviewers will read it as a website in a box.',
    '   3. Verify: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site='
      + encodeURIComponent(c.host.replace(/\/$/, '')) + '&relation=delegate_permission/common.handle_all_urls',
    '   4. Closed testing: 12 testers, 14 continuous days, for personal accounts',
    '      created after 13 Nov 2023 — before production access is offered.',
  ].join('\n'));
}

/* --------------------------------------------------------------------- main */

if (CMD === 'prepare') prepare();
else if (CMD === 'key') makeKey();
else if (CMD === 'build') build();
else if (CMD === 'check') {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'bundlecheck.mjs')], { stdio: 'inherit', cwd: ROOT });
  process.exit(r.status ?? 0);
} else {
  log([
    'DUSKHOLD — Play bundle',
    '',
    '  node tools/bundle.mjs check      validate everything that needs no JDK',
    '  node tools/bundle.mjs prepare    write the web manifest, asset links and twa-manifest',
    '  node tools/bundle.mjs key        create the upload keystore (once)',
    '  node tools/bundle.mjs build      the whole run, up to the AAB',
    '',
    '  Config: bundle.config.json (host, packageId, version). See docs/PLAY-BUNDLE.md.',
  ].join('\n'));
}
