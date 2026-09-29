/* LAST NIGHT — real-browser visual QA.
 *
 * Unlike tools/harness.mjs (2D canvas only), this drives a real headless
 * Chromium with software WebGL (SwiftShader via @sparticuz/chromium, shipped
 * inside the npm tarball — no CDN download), so the GLB character actually
 * renders and screenshots show what a player sees.
 *
 *   node tools/shotbrowser.mjs            # serve repo on :8080 + shoot
 *   node tools/shotbrowser.mjs --url=...  # shoot an already-running server
 *
 * Shots land in tools/shots-browser/ (gitignored).
 */

import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const URL_BASE = args.url || 'http://127.0.0.1:8080';
const OUT = path.resolve(args.out || path.join(ROOT, 'tools/shots-browser'));
fs.mkdirSync(OUT, { recursive: true });

let server = null;
if (!args.url) {
  server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '0.0.0.0'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
}

/* ---------- portable system-lib shim ----------
 * The bundled Chromium is built for Amazon Linux; on slim Debian containers
 * libnss3/libnspr4 are missing. The npm package ships them in al2023.tar.br —
 * inflate locally and hand it over via LD_LIBRARY_PATH. Silently skipped when
 * the host already provides the libraries.
 */
const LIB_DIR = path.join(ROOT, 'tools', '.cache', 'al2023-lib');
const ensureAlLibs = async () => {
  try {
    fs.mkdirSync(LIB_DIR, { recursive: true });
    if (!fs.existsSync(path.join(LIB_DIR, 'libnss3.so'))) {
      const brPath = path.join(path.dirname(new URL(import.meta.resolve('@sparticuz/chromium')).pathname), '..', 'bin', 'al2023.tar.br');
      if (!fs.existsSync(brPath)) return;
      const tar = path.join(LIB_DIR, 'al2023.tar');
      fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(brPath)));
      execFileSync('tar', ['-xf', tar, '-C', LIB_DIR]);
      fs.rmSync(tar);
    }
  } catch { /* host already fine, or extraction unavailable — chromium will say so itself */ }
};
await ensureAlLibs();

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox'],
  headless: true,
  protocolTimeout: 180000,
  env: { ...process.env, LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
});

const waitValen = async (page, ms = 60000) => {
  const started = Date.now();
  for (;;) {
    const d = await page.evaluate(() => (window.__LN_API ? window.__LN_API.valen() : null));
    if (d && (d.ready || d.failed)) return d;
    if (Date.now() - started > ms) return d || { timeout: true };
    await new Promise((r) => setTimeout(r, 500));
  }
};

const shoot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot:', name + '.png');
};

try {
  /* ---------- desktop 16:9 ---------- */
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });

  // the boot veil is tied to the 27 MB GLB — wait for the real thing
  const diag = await waitValen(page);
  console.log('valen:', JSON.stringify(diag));
  const glInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    return g ? g.getParameter(g.RENDERER) : 'NO WEBGL';
  });
  console.log('renderer:', glInfo);

  await page.waitForFunction(() => !document.getElementById('veil'), { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1100)));
  await shoot(page, '01-menu');

  // ---- the attract loop: the house is awake, and she is in it ----
  // Three beats of the same 15s loop: she stands, she walks, something knocks.
  // The loop is PINNED for each shot: the knock window is two seconds wide and
  // a software-WebGL frame takes longer than that to arrive, so a screenshot
  // taken by luck lands somewhere else entirely.
  await page.evaluate(() => {
    window.__LN.save.privacyAck = true;
    window.__LN.setScreen('menu');
    window.__pin = null;
    const pin = () => { if (window.__pin != null) window.__LN.menuIdle = window.__pin; requestAnimationFrame(pin); };
    pin();
  });
  for (const [name, idle] of [['01-attract-stand', 5.4], ['01-attract-walk', 9.4], ['01-attract-knock', 13.0]]) {
    await page.evaluate((v) => { window.__pin = v; }, idle);
    await new Promise((r) => setTimeout(r, 500));
    await shoot(page, name);
  }
  await page.evaluate(() => { window.__pin = null; });

  await page.evaluate(() => {
    window.__LN_API.beginNight();
  });
  await page.waitForFunction(() => window.__LN && window.__LN.screen === 'intro', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { window.__LN_API.skipIntro(); window.__LN_API.skipIntro(); });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, '01b-intro.png') });
  await shoot(page, '02-night-start');

  // walk (clip-driven stride), with a camera nudge for a lived-in frame
  await page.evaluate(() => {
    window.__LN_API.hold('down', true);
    window.__LN_API.hold('right', true);
  });
  await new Promise((r) => setTimeout(r, 1400));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await shoot(page, '03-walk');

  // attack: claw clip mid-swing — freeze on the active window
  await page.evaluate(() => {
    const p = window.__LN.player;
    window.__LN_API.hold('attack', false);
    p.startAttack(window.__LN);
  });
  await new Promise((r) => setTimeout(r, 220));
  await shoot(page, '04-attack');

  await page.evaluate(() => {
    window.__LN_API.setWeapon('sword');
    window.__LN.player.startAttack(window.__LN);
  });
  await new Promise((r) => setTimeout(r, 240));
  await shoot(page, '04b-sword');

  await page.evaluate(() => {
    window.__LN_API.setWeapon('shot');
    window.__LN.player.angle = -Math.PI / 2;
    window.__LN.player.startAttack(window.__LN);
  });
  await new Promise((r) => setTimeout(r, 280));
  await shoot(page, '04c-shot');

  const enemyDiag = await page.evaluate(async () => {
    const started = performance.now();
    let diag = window.__LN_API.enemy3d();
    while (diag?.types?.zombie?.loading && performance.now() - started < 20000) {
      await new Promise((r) => setTimeout(r, 250));
      diag = window.__LN_API.enemy3d();
    }
    return diag;
  });
  console.log('enemy3d:', JSON.stringify(enemyDiag));
  const spots = await page.evaluate(() => {
    const g = window.__LN;
    const lamp = g.mansion.lights.find((l) => l.id === 'chandelier') || g.mansion.lights[0];
    let dark = { x: 1700, y: 980, lit: 1 };
    const room = g.mansion.rooms.basement;
    const blocked = (x, y) => g.mansion.furniture.some((f) => x > f.x - 18 && x < f.x + f.w + 18 && y > f.y - 10 && y < f.y + f.h + 16);
    for (let y = room.y + 70; y < room.y + room.h - 70; y += 28) {
      for (let x = room.x + 70; x < room.x + room.w - 70; x += 28) {
        if (blocked(x, y)) continue;
        const shade = g.renderer.shadeAt(x, y, g);
        if (shade.lit < dark.lit) dark = { x, y, lit: shade.lit };
      }
    }
    return { lamp: { x: lamp.x, y: lamp.y }, dark };
  });
  console.log('enemy spots', JSON.stringify(spots));
  await page.evaluate((spots) => {
    const g = window.__LN;
    if (!g._followHeld) g._followHeld = g.renderer.followCamera.bind(g.renderer);
    g.renderer.followCamera = () => {};
    g.player.x = spots.lamp.x - 8;
    g.player.y = spots.lamp.y + 78;
    g.renderer.snapCamera(spots.lamp.x, spots.lamp.y + 36);
    window.__LN_API.enemyProof('zombie', spots.lamp.x + 34, spots.lamp.y + 16);
    g.render();
  }, spots);
  await shoot(page, '12-enemy-lit');
  await page.evaluate((spots) => {
    const g = window.__LN;
    if (!g._followHeld) g._followHeld = g.renderer.followCamera.bind(g.renderer);
    g.renderer.followCamera = () => {};
    g._updateHeld = g.update.bind(g);
    g.update = () => {};
    g.player.lightR = 0;
    g.player.lightI = 0;
    g.player.x = spots.dark.x - 36;
    g.player.y = spots.dark.y + 36;
    g.renderer.snapCamera(spots.dark.x, spots.dark.y + 10);
    window.__LN_API.enemyProof('zombie', spots.dark.x + 8, spots.dark.y);
    g.render();
  }, spots);
  await shoot(page, '13-enemy-dark');
  await page.evaluate(() => {
    const g = window.__LN;
    if (g._updateHeld) g.update = g._updateHeld;
    if (g._followHeld) g.renderer.followCamera = g._followHeld;
    window.__LN_API.clearEnemyProof();
  });

  // low blood: eye-glow tell + panic tint territory
  await page.evaluate(() => {
    window.__LN_API.setTime(262);
    window.__LN.player.blood = 8;
    window.__LN_API.hold('up', true);
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await shoot(page, '05-lowblood-panic');

  // pause overlay
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  await shoot(page, '06-pause');

  // close-up of the GLB body (vision QA: fabric, pose, foot anchor)
  await page.evaluate(() => {
    gameEscape();
    const p = window.__LN.player;
    window.__LN_API.setTime(10);
    p.blood = 80;
  }).catch(() => {});
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => { window.__LN_API.hold('down', true); });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => { window.__LN_API.stopMove(); });
  await new Promise((r) => setTimeout(r, 300));
  const pp = await page.evaluate(() => { const r = window.__LN.renderer; const s = r.cam.zoom; return { x: window.__LN.player.x, y: window.__LN.player.y, sx: r.w / 2, sy: r.h / 2, zoom: s }; });
  await page.screenshot({ path: path.join(OUT, '08-closeup.png'), clip: { x: Math.max(0, pp.sx - 130), y: Math.max(0, pp.sy - 200), width: 260, height: 260 } });
  console.log('shot: 08-closeup.png');

  // shop screen (Blood Market) — exercise the real sandbox flow first:
  // buy a shard bundle with store money, then a coat with the earned shards.
  await page.evaluate(() => { window.__LN.setScreen('shop'); });
  await new Promise((r) => setTimeout(r, 400));
  await shoot(page, '09-shop');
  await page.evaluate(() => { window.__LN.purchaseSku('shards_s'); });
  await new Promise((r) => setTimeout(r, 2400)); // sandbox latency + toast
  await page.evaluate(() => { window.__LN.buySkuWithShards('coat_bloodmoon'); });
  await new Promise((r) => setTimeout(r, 900));
  await shoot(page, '10-shop-after');
  // the cosmetic actually on the body, back in the world
  await page.evaluate(() => { window.__LN.setScreen('playing'); window.__LN_api_nope; });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => { window.__LN_API.setTime(20); });
  await shoot(page, '11-coat-ingame');

  /* ---------- mobile portrait (touch) ---------- */
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitValen(m, 60000);
  await m.evaluate(() => {
    window.__LN_API.beginNight();
    window.__LN.input.touchSeen = true;
    setTimeout(() => window.__LN_API.skipIntro(), 200);
  });
  await new Promise((r) => setTimeout(r, 900));
  await m.screenshot({ path: path.join(OUT, '07-mobile-play.png') });
  console.log('shot: 07-mobile-play.png');

  /* ---------- the four peaks (#52 A) ----------
   * The market hook: each peak has to read as a 2–3s, high-contrast, sound-off
   * frame at phone width and on desktop. Forced through the real trigger path
   * (__LN_API.peak -> climax.force), so these are the frames a player gets.
   *
   * Waits are on SIM time, not wall clock: headless software WebGL runs rAF
   * slower than 60Hz, so a setTimeout would land on a different frame every
   * run. Every shot below waits for the peak's own clock instead.
   */
  const shootPeaks = async (pg, tag) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = (fn, timeout = 30000) => pg.waitForFunction(fn, { timeout, polling: 40 }).catch(() => {});
    const reset = (t) => pg.evaluate((tt) => {
      const g = window.__LN;
      window.__LN_API.stopMove();
      g.screen = 'playing';
      g.save.nightsSurvived = 4;
      g.save.ending = null;
      g.player.frenzy = null;
      g.player.blood = g.player.bloodMax * 0.82;   // the peak is the frame, not a dying state
      g.player.state = 'idle';
      g.player.starveT = 0;
      g.player.iframes = 3;
      g.blackoutT = 0;
      g.hungerFailing = false;
      g.hungerWarned = true;
      g.time = tt;
      g.enemies.length = 0;
      g.messages.length = 0;
      g.climax.reset();
    }, t);

    // 1 — siege crescendo: every door at once, the swarm coming in
    await reset(284);
    await pg.evaluate(() => window.__LN_API.peak('crescendo'));
    await until(() => window.__LN.climax.crescendo && window.__LN.climax.crescendo.t > 2.2);
    await wait(120);
    await shoot(pg, `${tag}-peak1-crescendo`);

    // 2 — blood moon frenzy: surrounded, then the moon comes up
    await reset(150);
    await pg.evaluate(() => {
      const g = window.__LN;
      const list = g.director.spawnWave(g, ['zombie', 'zombie', 'zombie', 'crawler'], {}) || [];
      // bring the crowd to her instead of sending her outside: the frenzy
      // frame is the room she is already standing in, full of them
      const pl = g.player;
      list.forEach((e, i) => {
        const a = (i / Math.max(1, list.length)) * Math.PI * 2 + 0.7;
        const spot = g.mansion.freeSpot(pl.x + Math.cos(a) * 118, pl.y + Math.sin(a) * 118, 18, 12);
        e.x = spot.x; e.y = spot.y;
        e.state = 'hunt';
        e.seenPlayer = e.type.loseSight;
        e.lastKnown = { x: pl.x, y: pl.y };
      });
    });
    await until(() => window.__LN.enemies.filter((e) => !e.dead && Math.hypot(e.x - window.__LN.player.x, e.y - window.__LN.player.y) < 200).length >= 3);
    await pg.evaluate(() => window.__LN_API.peak('frenzy'));
    await until(() => window.__LN.climax.frenzy && window.__LN.climax.frenzy.t > 0.7);
    await pg.evaluate(() => window.__LN_API.press('attack', 600));
    await until(() => window.__LN.climax.frenzy && window.__LN.climax.frenzy.t > 1.15);
    await wait(120);
    await shoot(pg, `${tag}-peak2-frenzy`);

    // 3 — boss duel: the lights cut, the alpha fills the frame
    await reset(200);
    await pg.evaluate(() => window.__LN_API.peak('duel'));
    await until(() => window.__LN.climax.duel && window.__LN.climax.duel.t > 0.85);
    await wait(120);
    await shoot(pg, `${tag}-peak3-duel`);

    // 4 — dawnbreak: the real dawn, the sun crossing the house
    await reset(299.4);
    await pg.evaluate(() => {
      const g = window.__LN;
      g.climax.crescendoUsed = true;      // let the sunrise own this frame
      g.save.pendingDawn = [];
      g.save.beats = {};
    });
    await pg.waitForFunction(() => window.__LN.screen === 'dawn', { timeout: 20000, polling: 40 }).catch(() => {});
    await until(() => window.__LN.climax.dawnWave && window.__LN.climax.dawnWave.t > 1.15);
    await wait(120);
    await shoot(pg, `${tag}-peak4-dawnbreak`);
    await pg.evaluate(() => { window.__LN.screen = 'playing'; });
  };

  /* ---------- the narrator's plate (#52 B) ----------
   * The story has to read on the phone and in the short landscape most people
   * actually hold. Waits are on SIM time again.
   */
  const shootNarration = async (pg, tag) => {
    const until = (fn, timeout = 25000) => pg.waitForFunction(fn, { timeout, polling: 40 }).catch(() => {});
    // A still, not a race: hold the line open, shoot it, then step on. The
    // plate is meant to move on its own — this only stops it long enough to
    // be photographed.
    const freeze = () => pg.evaluate(() => {
      const n = window.__LN.narration;
      // the run-start fade is a transition, not a grade: clear it or the still
      // is photographed through it
      window.__LN.fadeFromBlack = 0;
      if (n) { n.t = 0.9; n.lineDur = 3600; }
    });
    const nextLine = () => pg.evaluate(() => { if (window.__LN.narration) window.__LN.advanceNarration(); });

    await pg.evaluate(() => {
      const g = window.__LN;
      window.__LN_API.stopMove();
      // a save that has never heard her: night one opens with the narration
      g.save.beats = {};
      g.save.pendingDawn = [];
      g.save.nightsSurvived = 0;
      g.seenIntroThisSession = false;
      g._skipNarration = false;
      g.narration = null;
      g.beginNight();
      // end the intro card on the clock (not with skipIntro, which would also
      // shut the narrator) so the capture lands on the narration, not on it
      g.introT = (g.introLen || 3) + 1;
    });
    await until(() => window.__LN.screen === 'narration' && window.__LN.narration && window.__LN.narration.i === 0, 40000);
    await freeze();
    await shoot(pg, `${tag}-narration1-opening`);
    // the house answers in the second person
    await nextLine();
    await freeze();
    await shoot(pg, `${tag}-narration2-house`);
    // and the act card rides the same plate
    await nextLine();
    await nextLine();
    await until(() => window.__LN.narration && window.__LN.narration.kind === 'act');
    await freeze();
    await shoot(pg, `${tag}-narration3-act`);
    await pg.evaluate(() => window.__LN.skipNarration());
  };

  await shootPeaks(m, '14-phone');
  await shootPeaks(page, '15-desktop');

  await shootNarration(m, '16-phone');
  const ls = await browser.newPage();
  await ls.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // The swarm now ships two bodies (7.5 MB) beside Valen's own, so a cold
  // software-WebGL page needs longer than the old 90s to be ready to shoot.
  await ls.goto(URL_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitValen(ls, 60000);
  await shootNarration(ls, '17-short');
  await ls.close();

  console.log('DONE');
} finally {
  await browser.close();
  if (server) server.kill();
}
