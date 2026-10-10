/* LAST NIGHT — bootstrap
 * Creates the canvas plumbing, the fixed-timestep-ish game loop and the
 * handful of browser niceties (resize, visibility pause, fullscreen, gesture
 * unlock for audio).
 */

import { Input } from './core/input.js';
import * as Audio from './core/audio.js';
import { Game } from './game/game.js';
import { phaseAt } from './core/config.js';
import { drawTouchControls } from './game/hud.js';
import { drawCoach } from './game/coach.js';
import { Valen3D } from './game/valen3d.js';
import { Enemy3D } from './game/enemy3d.js';
import { EnvKit } from './game/envkit.js';
import { World3D } from './game/world3d.js';
import { Ads } from './shop/ads.js';
import { IAP } from './shop/iap.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
const input = game.input;
World3D.bindStage(canvas.parentElement);
Ads.init(game);

/* ---------- sizing ---------- */
function resize() {
  const stage = canvas.parentElement;
  const w = stage ? stage.clientWidth : window.innerWidth;
  const h = stage ? stage.clientHeight : window.innerHeight;
  game.renderer.resize(w, h, window.devicePixelRatio || 1);
  input.layout(w, h);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();

/* ---------- audio unlock on first gesture ---------- */
input.onFirstGesture(() => {
  Audio.unlock().then(() => {
    game.applySettings();
  }).catch(() => { /* audio optional; the game must survive without it */ });
});
addEventListener('pointerdown', () => Audio.unlock(), { once: true });
addEventListener('keydown', () => Audio.unlock(), { once: true });

/* ---------- the room, before she needs it (issue #53 C2) ----------
 * The kit is twenty-one files and the night used to begin without them: the
 * first three seconds of every night were a painted floor, and the walls and
 * the furniture arrived under her feet. Nothing about the night is cheaper
 * if it loads later, so it loads while she is still in the menu. The kit
 * waits on Valen's renderer, which is the same thing it waited on before —
 * only now it waits in the background.
 */
(function preloadRoom() {
  const kick = () => {
    if (!Valen3D.renderer || !Valen3D.scene) return false;
    EnvKit.init();
    return true;
  };
  if (!kick()) {
    const t = setInterval(() => {
      if (kick() || Valen3D.failed) clearInterval(t);
    }, 200);
    setTimeout(() => clearInterval(t), 40000);
  }
})();

/* ---------- pause when the tab is hidden ---------- */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game.screen === 'playing') game.togglePause(true);
  }
});

/* ---------- fullscreen ---------- */
const fsBtn = document.getElementById('fullscreen');
if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => { })).call(el);
    else document.exitFullscreen();
  });
}

/* ---------- dev hooks for the automated playtest harness ---------- */
window.__LN = game;
window.__LN_API = {
  beginNight: () => game.beginNight(),
  skipIntro: () => {
    if (game.screen === 'intro') game.introT = (game.introLen || 3) + 1;
    // Capture asks for the night, so anything the narrator would have queued
    // behind the intro stays shut too.
    game.skipNarration();
  },
  replayOpening: () => game.replayOpening(),
  narration: () => (game.narration
    ? { kind: game.narration.kind, act: game.narration.act, i: game.narration.i, of: game.narration.list.length, t: +game.narration.t.toFixed(2) }
    : null),
  goals: () => (game.objectives && game.objectives.hudState()) || null,
  shop: () => (window.__LN_IAP ? window.__LN_IAP.diagnostics() : null),
  setTime: (t) => { game.time = t; game.phase = phaseAt(t); game.danger = game.phase.danger; },
  peak: (name) => game.climax.force(game, name),
  peaks: () => Object.values(game.peaks || {}),
  climax: () => game.climax.diagnostics(),
  state: () => ({
    screen: game.screen, time: game.time, blood: game.player.blood, bloodPct: game.player.bloodPct,
    enemies: game.enemies.length, alive: game.enemies.filter((e) => !e.dead).length,
    mood: game.director.mood, danger: game.danger, doors: game.mansion.doors.map((d) => d.hp),
    kills: game.stats.kills, planks: game.player.planks, hud: game.hudSnapshot ? game.hudSnapshot() : null,
    peak: game.climax ? game.climax.active : null,
  }),
  press: (action, ms = 120) => {
    input.keys[action] = true;
    setTimeout(() => { input.keys[action] = false; }, ms);
  },
  hold: (action, on) => { input.keys[action] = !!on; },
  valen: () => Valen3D.diagnostics(),
  env: () => EnvKit.diagnostics(),
  world3d: () => World3D.diagnostics(),
  envFlat: (on) => EnvKit.flatTint(!!on),
  retryValen: () => Valen3D.retry(),
  enemy3d: () => Enemy3D.diagnostics(),
  enemyProof: (key, x, y) => Enemy3D.setProofs([{ key, x, y }]),
  enemyFrame: (key) => {
    const rec = Enemy3D.types[key];
    const frame = rec && rec.preview;
    return frame ? frame.toDataURL('image/png') : null;
  },
  clearEnemyProof: () => Enemy3D.setProofs(null),
  forceEnemyFail: (key) => Enemy3D.forceFail(key),
  setWeapon: (id) => game.setWeapon(id),
  moveTo: (x, y) => {
    const p = game.player;
    const dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    input.keys.left = dx / d < -0.2; input.keys.right = dx / d > 0.2;
    input.keys.up = dy / d < -0.2; input.keys.down = dy / d > 0.2;
  },
  stopMove: () => { input.keys.left = input.keys.right = input.keys.up = input.keys.down = false; },
  shopDiag: () => IAP.diagnostics(),
  shopBuy: (id) => game.buySkuWithShards(id),
  adsDiag: () => Ads.diagnostics(),
};

/* ---------- loop ---------- */
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // fixed-ish stepping keeps physics/feel identical on 60/120/144Hz displays
  acc += dt * (window.__LN_TIME_SCALE ?? 1);
  const STEP = 1 / 60;
  let guard = 0;
  while (acc >= STEP && guard++ < 5) {
    game.update(STEP);
    acc -= STEP;
  }
  if (guard === 0) game.update(0);
  if (document.body.dataset.screen !== game.screen) document.body.dataset.screen = game.screen;
  game.render();
  // Controls are part of the night HUD on every device — an invisible stick
  // is how "the direction feels wrong" starts.
  game.renderer.resetForUI();
  drawTouchControls(game, game.renderer.ctx, game.renderer.w, game.renderer.h);
  drawCoach(game, game.renderer.ctx, game.renderer.w, game.renderer.h);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- loading veil → gameplay, not a dashboard ----------
 * Begin only when the authored player body has settled (or explicitly failed)
 * and every gameplay enemy role has its validated local GLB/clip roster. The
 * run starts without treating privacy acknowledgement as consent; paid
 * purchases still pass through Game.purchaseSku's existing privacy gate.
 */
const veil = document.getElementById('veil');
const veilBar = veil ? veil.querySelector('.veil-bar span') : null;
const veilSub = veil ? veil.querySelector('.veil-sub') : null;
let veilCleared = false;
let autoStarted = false;
function clearVeil() {
  if (!veil || veilCleared) return;
  veilCleared = true;
  veil.classList.add('gone');
  setTimeout(() => veil.remove(), 900);
}

Valen3D.init();
Enemy3D.init();

function bootTick() {
  if (autoStarted) return;
  const roster = Enemy3D.readiness();
  const bodySettled = Valen3D.ready || Valen3D.failed;
  if (bodySettled && roster.ready) {
    clearVeil();
    // beginNight is also guarded, so a stale/incomplete roster cannot slip
    // through via the boot path or a programmatic call.
    game.beginNight();
    autoStarted = game.screen !== 'menu';
    if (autoStarted) return;
  }
  if (veilBar) {
    const playerProgress = clampBootProgress(Valen3D.progress || 0);
    const rosterProgress = roster.total ? roster.loaded / roster.total : 0;
    const shown = Math.min(playerProgress, rosterProgress);
    veilBar.style.width = `${(4 + shown * 96).toFixed(1)}%`;
  }
  if (veilSub) {
    const playerStatus = Valen3D.failed ? 'body fallback ready' : Valen3D.ready ? 'body ready' : `body ${Math.round((Valen3D.progress || 0) * 100)}%`;
    const enemyStatus = roster.failed.length ? 'gameplay roster unavailable' : `3D roles ${roster.loaded}/${roster.total}`;
    veilSub.textContent = `${playerStatus} · ${enemyStatus}`;
  }
  requestAnimationFrame(bootTick);
}
function clampBootProgress(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
requestAnimationFrame(bootTick);
