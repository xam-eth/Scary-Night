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

const canvas = document.getElementById('game');
const game = new Game(canvas);
const input = game.input;

/* ---------- sizing ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
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
  });
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
  skipIntro: () => { if (game.screen === 'intro') game.screen = 'playing'; },
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
  moveTo: (x, y) => {
    const p = game.player;
    const dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    input.keys.left = dx / d < -0.2; input.keys.right = dx / d > 0.2;
    input.keys.up = dy / d < -0.2; input.keys.down = dy / d > 0.2;
  },
  stopMove: () => { input.keys.left = input.keys.right = input.keys.up = input.keys.down = false; },
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
  game.render();
  if (input.touchSeen) {
    game.renderer.resetForUI();
    drawTouchControls(game, game.renderer.ctx, game.renderer.w, game.renderer.h);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- hide the loading veil ---------- */
const veil = document.getElementById('veil');
if (veil) {
  setTimeout(() => { veil.classList.add('gone'); setTimeout(() => veil.remove(), 900); }, 260);
}
