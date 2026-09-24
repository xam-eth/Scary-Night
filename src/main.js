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
import { Ads } from './shop/ads.js';
import { IAP } from './shop/iap.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
const input = game.input;
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
  skipIntro: () => { if (game.screen === 'intro') game.introT = (game.introLen || 3) + 1; },
  goals: () => (game.objectives && game.objectives.hudState()) || null,
  shop: () => (window.__LN_IAP ? window.__LN_IAP.diagnostics() : null),
  setTime: (t) => { game.time = t; game.phase = phaseAt(t); game.danger = game.phase.danger; },
  state: () => ({
    screen: game.screen, time: game.time, blood: game.player.blood, bloodPct: game.player.bloodPct,
    enemies: game.enemies.length, alive: game.enemies.filter((e) => !e.dead).length,
    mood: game.director.mood, danger: game.danger, doors: game.mansion.doors.map((d) => d.hp),
    kills: game.stats.kills, planks: game.player.planks, hud: game.hudSnapshot ? game.hudSnapshot() : null,
  }),
  press: (action, ms = 120) => {
    input.keys[action] = true;
    setTimeout(() => { input.keys[action] = false; }, ms);
  },
  hold: (action, on) => { input.keys[action] = !!on; },
  valen: () => Valen3D.diagnostics(),
  retryValen: () => Valen3D.retry(),
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

/* ---------- loading veil → the animated GLB character ----------
 * The uploaded GLB is the player, so the boot veil waits for the exact bytes
 * of the model to hand themselves to GLTFLoader — no preprocessing, no bake
 * step, nothing to finish first. The bar tracks the real network progress of
 * the original file. A timeout cap keeps the game reachable if the asset is
 * slow or unreachable: Valen can always finish in the background and replace
 * the fallback silhouette the moment it is ready.
 */
const veil = document.getElementById('veil');
const veilBar = veil ? veil.querySelector('.veil-bar span') : null;
const veilSub = veil ? veil.querySelector('.veil-sub') : null;
const VEIL_CAP_MS = 20000;
let veilCleared = false;
function clearVeil() {
  if (!veil || veilCleared) return;
  veilCleared = true;
  veil.classList.add('gone');
  setTimeout(() => veil.remove(), 900);
}
if (veil) {
  const started = performance.now();
  if (veilBar) { veilBar.style.animation = 'none'; veilBar.style.width = '4%'; }
  const tick = () => {
    if (veilCleared) return;
    if (Valen3D.ready || Valen3D.failed || performance.now() - started > VEIL_CAP_MS) { clearVeil(); return; }
    const p = Valen3D.progress;
    if (veilBar) veilBar.style.width = `${(4 + p * 96).toFixed(1)}%`;
    if (veilSub && p > 0) veilSub.textContent = `waking the body — ${(p * 100 | 0)}%`;
    requestAnimationFrame(tick);
  };
  Valen3D.init();
  requestAnimationFrame(tick);
} else {
  Valen3D.init();
}
