/* DUSKHOLD Survival — the K1 opening, frame by frame (evidence + checks).
 *
 * Boots a fresh save at sideways-phone size WITH cinematics (the default),
 * holds the game clock and steps the opening by hand, writing a frame at each
 * caption, then checks that the opening comes back at the start of every run
 * (RESTART and PLAY AGAIN) and that a reload mid-night does not replay it.
 *
 *   node tools/survival-intro.mjs [--out=qa-evidence/survival-plots] [--dpr=1] [--port=8124]
 *
 * Exit code 1 when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const OUT = path.resolve(ROOT, args.out || '/tmp/intro');
const PORT = Number(args.port || 8124);
// BUILD 17 (R8): a run's gate rotation comes from a seed. Fixed here so a
// check measures the same run every time and an evidence shot replays.
const SEED = Number(args.seed || 20261007);   // the base whose rotation is BUILD 16's
const DPR = Number(args.dpr || 1);
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'lib');
fs.mkdirSync(path.join(ROOT, 'tools', '.cache', 'al2023-lib'), { recursive: true });
if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
  const br = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
  const tar = path.join(ROOT, 'tools', '.cache', 'al2023-lib', 'al2023.tar');
  fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', tar, '-C', path.join(ROOT, 'tools', '.cache', 'al2023-lib')]);
  fs.rmSync(tar);
}
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true, protocolTimeout: 300000,
  env: { ...process.env, LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e.message).slice(0, 300)); console.log('PAGEERROR', String(e.message).slice(0, 300)); });
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
// a returning player: this save has seen the opening before (introSeen)
await page.evaluateOnNewDocument(() => {
  try {
    if (!sessionStorage.getItem('introQaBooted')) {
      localStorage.clear();
      sessionStorage.setItem('introQaBooted', '1');
    }
  } catch (_) { /* ignore */ }
});
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!ok) failures++;
};
const boot = async () => {
  await page.waitForFunction(() => {
    const g = window.__LN;
    return !!(g && g.mode === 'survival' && g.screen === 'playing' && g.survival);
  }, { timeout: 180000, polling: 50 });
  await page.evaluate(() => {
    const g = window.__LN;
    window.__inOrig = g.update;
    g.update = () => {};
    window.__inStep = (n = 1) => { for (let i = 0; i < n; i++) window.__inOrig.call(g, 1 / 60); g.render(); };
  });
  // the night (and its intro) holds until the 3D world has drawn once
  // (game.js survivalWorldReady; the page's own frames keep rendering, the
  // clock is ours): stepping before that measures a frozen t = 0.08 (BUILD 15
  // chain: the first frame came in before the GLBs did)
  await page.waitForFunction(() => window.__LN && window.__LN.survivalWorldReady === true, { timeout: 120000, polling: 100 });
};
await page.goto(`http://127.0.0.1:${PORT}/?seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await boot();
const first = await page.evaluate(() => {
  const m = window.__LN.survival;
  return { cine: m.cine && m.cine.kind, t: m.cine ? +m.cine.t.toFixed(2) : null };
});
check('a fresh save opens on the intro', first.cine === 'intro', first);
const frames = [
  ['intro-1-keep', 0.7], ['intro-2-keep-wide', 2.3], ['intro-3-horde', 4.0], ['intro-4-captain', 6.0], ['intro-5-handover', 7.15],
];
const shots = [];
for (const [name, at] of frames) {
  const state = await page.evaluate((target) => {
    const g = window.__LN; const m = g.survival;
    let n = 0;
    while (m.cine && m.cine.t < target && n++ < 2000) window.__inStep(1);
    const cap = m.cineCaption();
    return { t: m.cine ? +m.cine.t.toFixed(2) : null, caption: cap ? cap.title : null, zoom: +g.renderer.cam.zoom.toFixed(3), play: +(m.frameMul(true) * g.renderer.baseZoom).toFixed(3) };
  }, at);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png' });
  shots.push({ name, ...state });
  console.log(`SHOT ${name} ${JSON.stringify(state)}`);
}
check('the opening frames the keep wider than play but not cut by the bars (zoom 1.2–1.7 x play at the first caption)',
  shots[0].caption === 'PROTECT THE KEEP' && shots[0].zoom / shots[0].play > 1.2 && shots[0].zoom / shots[0].play < 1.7, shots[0]);
// RESTART (PAUSE panel) and PLAY AGAIN both open on it again
const restart = await page.evaluate(() => {
  const g = window.__LN; const m = g.survival;
  m.endCine(); window.__inStep(30);
  const seen = !!(g.save.survival && g.save.survival.introSeen);
  m.restart(); window.__inStep(2);
  const a = m.cine && m.cine.kind;
  m.endCine(); window.__inStep(10);
  m.fail('THE KEEP FELL'); window.__inStep(130);
  const ended = g.uiPanel;
  const again = g.ui.find((item) => item.label === 'survival:PLAY AGAIN');
  if (again && again.onClick) again.onClick();
  window.__inStep(2);
  return { seen, restart: a, ended, playAgain: !!again, again: m.cine && m.cine.kind };
});
check('RESTART and PLAY AGAIN open on the intro again (a save that has seen it included)',
  restart.seen && restart.restart === 'intro' && restart.ended === 'survival-failed' && restart.playAgain && restart.again === 'intro', restart);
// a reload part-way into the night plays straight on
await page.evaluate(() => { const m = window.__LN.survival; m.endCine(); window.__inStep(60); m._persist(true); });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await boot();
const reload = await page.evaluate(() => { const m = window.__LN.survival; window.__inStep(5); return { cine: !!m.cine, phase: m.phase, elapsed: +m.elapsed.toFixed(1) }; });
check('a reload mid-night plays straight on (no replay)', !reload.cine && reload.phase === 'night' && reload.elapsed > 0.5, reload);
fs.writeFileSync(path.join(OUT, 'intro.json'), JSON.stringify({ first, shots, restart, reload, errors }, null, 2));
console.log(`errors ${errors.length}`);
console.log(`SUMMARY ${failures ? 'FAIL' : 'PASS'} (${failures} failed)`);
await browser.close();
server.kill('SIGTERM');
process.exit(failures || errors.length ? 1 : 0);
