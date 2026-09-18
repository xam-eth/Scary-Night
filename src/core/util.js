/* LAST NIGHT — core utilities
 * Math, easing, deterministic RNG, small helpers, save storage.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const invLerp = (a, b, v) => clamp((v - a) / (b - a || 1), 0, 1);
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const sign = Math.sign;
export const deg = (r) => (r * 180) / Math.PI;

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function approachAngle(a, b, step) {
  const d = angDiff(a, b);
  return a + clamp(d, -step, step);
}
export function approach(a, b, step) {
  if (a < b) return Math.min(a + step, b);
  return Math.max(a - step, b);
}

/* ---------------- RNG ---------------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Rng {
  constructor(seed = 1) { this.next = mulberry32(seed); }
  float(a = 1, b) { return b === undefined ? this.next() * a : a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.float(a, b + (b === undefined ? 0 : 1))); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  angle() { return this.next() * TAU; }
}

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
/** Deterministic 2D hash in [0,1) — used for stable tile variation. */
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const hashRange = (x, y, s, a, b) => a + hash2(x, y, s) * (b - a);

/* ---------------- formatting ---------------- */
export function fmtClock(seconds) {
  seconds = Math.max(0, seconds);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtBar(pct, cells = 10) {
  const filled = clamp(Math.round((pct / 100) * cells), 0, cells);
  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

/* ---------------- save storage ---------------- */
const SAVE_KEY = 'lastnight.save.v1';

export const defaultSave = () => ({
  shards: 0,
  totalShards: 0,
  nightsSurvived: 0,
  nightsAttempted: 0,
  bestTime: 0,
  bestDefeated: 0,
  upgrades: { blood: 0, speed: 0, repair: 0, damage: 0, recovery: 0 },
  seen: {},                 // collection unlocks
  settings: {
    master: 0.85, music: 0.7, sfx: 0.9,
    shake: 1, flashes: 1, captions: 1, difficulty: 'standard',
    invertPanic: 0,
  },
  tutorialSeen: false,
});

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else if (over[k] !== undefined) base[k] = over[k];
  }
  return base;
}

export function loadSave() {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return base;
    return deepMerge(base, JSON.parse(raw));
  } catch (e) { return base; }
}
export function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode */ }
}
