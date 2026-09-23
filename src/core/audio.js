/* LAST NIGHT — procedural audio engine
 * Every sound in the game is synthesized at runtime with the WebAudio API.
 * No sample files, no external dependencies.
 *
 * Design notes:
 *  - three buses (sfx / ambience / music) under a limiter
 *  - a generated convolution reverb used as a send (the mansion is big and empty)
 *  - positional playback helpers (pan + distance attenuation + occlusion)
 *  - persistent loops (wind, fire, drone, tension, panic) cross-faded by the director
 *  - heartbeat owns its own scheduler and reports beats back to the renderer so the
 *    screen pulse stays frame-accurate with the audio
 */

import { clamp, lerp, rand, chance, TAU } from './util.js';

const A = {};
export default A;

let ctx = null;
let ready = false;
let master, limiter, sfxBus, ambBus, musicBus, reverb, revSend, revReturn;
let noiseBuf = null, noiseBuf2 = null;

/* ================= graph ================= */

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 12; limiter.ratio.value = 6;
  limiter.attack.value = 0.004; limiter.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0.85;

  sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0;
  ambBus = ctx.createGain(); ambBus.gain.value = 1.0;
  musicBus = ctx.createGain(); musicBus.gain.value = 0.75;

  reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(2.6, 2.2);
  revSend = ctx.createGain(); revSend.gain.value = 1.0;
  revReturn = ctx.createGain(); revReturn.gain.value = 0.9;

  sfxBus.connect(master); ambBus.connect(master); musicBus.connect(master);
  revSend.connect(reverb); reverb.connect(revReturn); revReturn.connect(master);
  master.connect(limiter); limiter.connect(ctx.destination);

  noiseBuf = makeNoise(3.0);
  noiseBuf2 = makeNoise(1.2);
  buildLoops();
  buildMusic();
  return ctx;
}

export function isReady() { return ready; }

export function unlock() {
  if (!ctx) initAudio();
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === 'suspended') return ctx.resume().then(() => { ready = true; return true; });
  ready = true;
  return Promise.resolve(true);
}

export function setVolumes({ master: m, music, sfx }) {
  if (!ctx) return;
  if (m !== undefined) master.gain.setTargetAtTime(clamp(m, 0, 1.4), ctx.currentTime, 0.05);
  if (music !== undefined) musicBus.gain.setTargetAtTime(clamp(music, 0, 1.4) * 0.75, ctx.currentTime, 0.05);
  if (sfx !== undefined) sfxBus.gain.setTargetAtTime(clamp(sfx, 0, 1.4), ctx.currentTime, 0.05);
}
export function setAmbienceVolume(v) {
  if (!ctx) return;
  ambBus.gain.setTargetAtTime(clamp(v, 0, 1.5), ctx.currentTime, 0.08);
}

function makeNoise(seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;   // brown-ish noise, warmer than white
      d[i] = w * 0.6 + last * 3.2;
    }
  }
  return buf;
}
function makeImpulse(seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.15);
    }
  }
  return buf;
}

/* ================= tiny synth toolkit ================= */

function env(param, t, a, d, s, r, peak = 1, sustain = 0) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  if (s > 0) param.exponentialRampToValueAtTime(Math.max(sustain, 0.0002), t + a + d);
  param.exponentialRampToValueAtTime(0.0001, t + a + d + s + r);
}

function noise(t, dur, { out, gain = 0.3, type = 'bandpass', freq = 800, q = 1, attack = 0.005, pan = 0, rev = 0.2, rate = 1, sweep = 0, clip = false } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.playbackRate.value = rate;
  src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  const g = ctx.createGain();
  const p = panNode(pan);
  src.connect(f); f.connect(g); g.connect(p); p.connect(out);
  if (rev > 0) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg); rg.connect(revSend); }
  env(g.gain, t, attack, dur * 0.35, 0, dur * 0.65, gain, gain * 0.4);
  src.start(t, rand(0, 2));
  src.stop(t + dur + 0.05);
  return { src, f, g };
}

function osc(t, dur, { out, gain = 0.2, type = 'sine', freq = 220, to = null, attack = 0.005, pan = 0, rev = 0.15, detune = 0, q = 0, filt = null, filtQ = 1, sweep = null } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
  if (to) { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur); }
  let node = o;
  if (filt) { const f = ctx.createBiquadFilter(); f.type = filt; f.frequency.value = freq * 4; f.Q.value = filtQ; node.connect(f); node = f; }
  const g = ctx.createGain();
  const p = panNode(pan);
  node.connect(g); g.connect(p); p.connect(out);
  if (rev > 0) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg); rg.connect(revSend); }
  env(g.gain, t, attack, dur * 0.3, 0, dur * 0.7, gain, gain * 0.3);
  o.start(t); o.stop(t + dur + 0.05);
  return { o, g };
}

function panNode(pan) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = clamp(pan, -1, 1); return p; }
  const g = ctx.createGain(); return g;
}

const now = () => ctx.currentTime;

/* ================= sound library =================
 * every entry: (t, o) where o = {out, pan, vol, rev, rnd}
 * o.out is the destination bus node.
 */

const S = {};
export const SFX = S;

S.knock = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 2; i++) {
    const dt = i * 0.09;
    noise(t + dt, 0.09, { out: o.out, gain: 0.32 * v, type: 'lowpass', freq: 1400, q: 1.2, pan: o.pan, rev: 0.5, attack: 0.001, rate: 0.9 + i * 0.05 });
    osc(t + dt, 0.16, { out: o.out, gain: 0.22 * v, type: 'triangle', freq: 132 + rand(-14, 14), to: 62, pan: o.pan, rev: 0.4, attack: 0.001 });
  }
};
S.knockHard = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 3; i++) {
    noise(t + i * 0.075, 0.12, { out: o.out, gain: 0.4 * v, type: 'lowpass', freq: 900, q: 2, pan: o.pan, rev: 0.6, attack: 0.001 });
    osc(t + i * 0.075, 0.22, { out: o.out, gain: 0.3 * v, type: 'sine', freq: 96, to: 44, pan: o.pan, rev: 0.5, attack: 0.001 });
  }
};
S.doorHit = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.13, { out: o.out, gain: 0.3 * v, type: 'lowpass', freq: 1100, q: 1.4, pan: o.pan, rev: 0.35, attack: 0.001 });
  osc(t, 0.2, { out: o.out, gain: 0.26 * v, type: 'triangle', freq: 118, to: 52, pan: o.pan, rev: 0.3, attack: 0.001 });
  // splinter detail
  if (chance(0.5)) noise(t + 0.01, 0.07, { out: o.out, gain: 0.12 * v, type: 'bandpass', freq: 2600, q: 2, pan: o.pan, rev: 0.2 });
};
S.doorBreak = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.5, { out: o.out, gain: 0.5 * v, type: 'lowpass', freq: 2600, q: 0.8, pan: o.pan, rev: 0.55, attack: 0.001, sweep: 0.2 });
  osc(t, 0.4, { out: o.out, gain: 0.35 * v, type: 'sawtooth', freq: 150, to: 40, pan: o.pan, rev: 0.4, attack: 0.001, filt: 'lowpass', filtQ: 4 });
  for (let i = 0; i < 6; i++) {
    noise(t + 0.02 + rand(0, 0.38), 0.05 + rand(0, 0.05), { out: o.out, gain: 0.14 * v, type: 'bandpass', freq: rand(1400, 4200), q: 4, pan: o.pan + rand(-0.2, 0.2), rev: 0.25, attack: 0.001 });
  }
};
S.glassBreak = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.22, { out: o.out, gain: 0.36 * v, type: 'highpass', freq: 1800, q: 0.7, pan: o.pan, rev: 0.45, attack: 0.001, sweep: 0.4 });
  for (let i = 0; i < 9; i++) {
    noise(t + rand(0, 0.5), 0.05 + rand(0, 0.07), { out: o.out, gain: 0.1 * v, type: 'bandpass', freq: rand(2800, 7200), q: 6, pan: o.pan + rand(-0.4, 0.4), rev: 0.4, attack: 0.001 });
  }
};
S.woodPickup = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 3; i++) noise(t + i * 0.05, 0.07, { out: o.out, gain: 0.16 * v, type: 'bandpass', freq: rand(500, 1500), q: 3, pan: o.pan, rev: 0.3, attack: 0.001 });
};
S.repair = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 5; i++) {
    const dt = i * 0.16;
    noise(t + dt, 0.1, { out: o.out, gain: 0.14 * v, type: 'bandpass', freq: rand(700, 1900), q: 3, pan: o.pan, rev: 0.35, attack: 0.002, rate: 1.2 });
    osc(t + dt, 0.1, { out: o.out, gain: 0.06 * v, type: 'square', freq: rand(180, 300), to: 90, pan: o.pan, rev: 0.2, attack: 0.001, filt: 'lowpass' });
  }
};
S.build = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 4; i++) {
    const dt = i * 0.22;
    noise(t + dt, 0.13, { out: o.out, gain: 0.18 * v, type: 'bandpass', freq: rand(400, 1200), q: 2.5, pan: o.pan, rev: 0.4, attack: 0.001 });
  }
};
S.crossbow = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.09, { out: o.out, gain: 0.3 * v, type: 'bandpass', freq: 2400, q: 3, pan: o.pan, rev: 0.25, attack: 0.001, sweep: 0.35 });
  osc(t, 0.14, { out: o.out, gain: 0.18 * v, type: 'sawtooth', freq: 900, to: 130, pan: o.pan, rev: 0.2, attack: 0.001, filt: 'lowpass', filtQ: 6 });
};
S.boltImpact = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.09, { out: o.out, gain: 0.3 * v, type: 'lowpass', freq: 2200, q: 2, pan: o.pan, rev: 0.3, attack: 0.001 });
  osc(t, 0.12, { out: o.out, gain: 0.18 * v, type: 'triangle', freq: 300, to: 90, pan: o.pan, rev: 0.25, attack: 0.001 });
};
S.whoosh = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.22, { out: o.out, gain: 0.26 * v, type: 'bandpass', freq: 400, q: 1.1, pan: o.pan, rev: 0.25, attack: 0.03, sweep: 4 });
};
S.slash = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.13, { out: o.out, gain: 0.34 * v, type: 'highpass', freq: 1100, q: 0.8, pan: o.pan, rev: 0.2, attack: 0.004, sweep: 0.5 });
  osc(t, 0.16, { out: o.out, gain: 0.14 * v, type: 'sawtooth', freq: 620, to: 120, pan: o.pan, rev: 0.2, attack: 0.002, filt: 'bandpass', filtQ: 3 });
};
S.hitFlesh = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.14, { out: o.out, gain: 0.3 * v, type: 'lowpass', freq: 900, q: 1.5, pan: o.pan, rev: 0.3, attack: 0.001 });
  osc(t, 0.18, { out: o.out, gain: 0.2 * v, type: 'sine', freq: 180, to: 60, pan: o.pan, rev: 0.25, attack: 0.001 });
};
S.playerHurt = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.5, { out: o.out, gain: 0.3 * v, type: 'sawtooth', freq: 320, to: 90, pan: o.pan, rev: 0.5, attack: 0.01, filt: 'lowpass', filtQ: 2 });
  noise(t, 0.35, { out: o.out, gain: 0.24 * v, type: 'bandpass', freq: 700, q: 1.2, pan: o.pan, rev: 0.4, attack: 0.005 });
};
S.growl = (t, o) => {
  const v = o.vol ?? 1;
  const g = ctx.createGain(); const p = panNode(o.pan ?? 0);
  g.connect(p); p.connect(o.out);
  const rg = ctx.createGain(); rg.gain.value = 0.5; p.connect(rg); rg.connect(revSend);
  const shaper = ctx.createWaveShaper();
  shaper.curve = distCurve(6); shaper.oversample = '2x';
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 3;
  shaper.connect(f); f.connect(g);
  for (let i = 0; i < 3; i++) {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    o1.frequency.value = 62 + i * 3 + rand(-3, 3);
    o1.frequency.setValueAtTime(o1.frequency.value, t);
    o1.frequency.linearRampToValueAtTime(48 + i * 2, t + 1.5);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 16 + i * 3;
    const la = ctx.createGain(); la.gain.value = 14;
    lfo.connect(la); la.connect(o1.frequency); lfo.start(t); lfo.stop(t + 1.8);
    o1.connect(shaper); o1.start(t); o1.stop(t + 1.7);
  }
  noise(t, 1.5, { out: o.out, gain: 0.16 * v, type: 'bandpass', freq: 380, q: 0.8, pan: o.pan, rev: 0.4, attack: 0.08 });
  env(g.gain, t, 0.08, 0.5, 0.5, 0.9, 0.34 * v, 0.16 * v);
};
S.snarl = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.5, { out: o.out, gain: 0.3 * v, type: 'bandpass', freq: 900, q: 1.6, pan: o.pan, rev: 0.35, attack: 0.01, sweep: 0.4 });
  osc(t, 0.55, { out: o.out, gain: 0.22 * v, type: 'sawtooth', freq: 210, to: 60, pan: o.pan, rev: 0.3, attack: 0.01, filt: 'bandpass', filtQ: 4 });
};
S.crawlerChatter = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 5; i++) {
    const dt = i * rand(0.05, 0.12);
    noise(t + dt, 0.05, { out: o.out, gain: 0.2 * v, type: 'bandpass', freq: rand(1800, 4200), q: 8, pan: o.pan + rand(-0.3, 0.3), rev: 0.3, attack: 0.001, rate: rand(0.8, 1.4) });
  }
};
S.breath = (t, o) => {
  const v = o.vol ?? 1;
  const d = 0.9;
  const n = noise(t, d, { out: o.out, gain: 0.14 * v, type: 'bandpass', freq: 480, q: 0.9, pan: o.pan, rev: 0.25, attack: 0.25, rate: 0.7 });
  if (n && n.f) n.f.frequency.linearRampToValueAtTime(300, t + d);
};
S.footstep = (t, o) => {
  const v = o.vol ?? 1;
  const soft = o.soft ? 0.5 : 1;
  noise(t, 0.09, { out: o.out, gain: 0.16 * v * soft, type: 'lowpass', freq: rand(700, 1300), q: 1.5, pan: o.pan, rev: 0.3, attack: 0.001, rate: rand(0.9, 1.1) });
  if (chance(0.35)) osc(t, 0.1, { out: o.out, gain: 0.05 * v, type: 'sine', freq: rand(80, 130), to: 50, pan: o.pan, rev: 0.2, attack: 0.001 });
};
S.stepCreak = (t, o) => {
  const v = o.vol ?? 1;
  const n = noise(t, 0.55, { out: o.out, gain: 0.12 * v, type: 'bandpass', freq: rand(260, 520), q: 9, pan: o.pan, rev: 0.45, attack: 0.06, rate: rand(0.5, 0.8) });
  if (n && n.f) n.f.frequency.linearRampToValueAtTime(rand(120, 260), t + 0.5);
  osc(t, 0.5, { out: o.out, gain: 0.05 * v, type: 'sawtooth', freq: rand(90, 160), to: 60, pan: o.pan, rev: 0.3, attack: 0.1, filt: 'lowpass' });
};
S.creak = (t, o) => {
  const v = o.vol ?? 1;
  const f0 = rand(180, 420);
  const n = noise(t, 1.4, { out: o.out, gain: 0.14 * v, type: 'bandpass', freq: f0, q: 12, pan: o.pan, rev: 0.6, attack: 0.3, rate: rand(0.4, 0.7) });
  if (n && n.f) {
    n.f.frequency.linearRampToValueAtTime(f0 * rand(1.2, 2.4), t + 0.7);
    n.f.frequency.linearRampToValueAtTime(f0 * 0.7, t + 1.3);
  }
};
S.drip = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.16, { out: o.out, gain: 0.14 * v, type: 'sine', freq: rand(900, 1600), to: rand(200, 400), pan: o.pan, rev: 0.7, attack: 0.001 });
};
/* One distant, badly-played piano note: a plucked sine stack with a hammer
 * click and a long hall tail. Scheduling (which note, when) lives in the
 * house module — this is just the wood and wire. */
S.piano = (t, o) => {
  const v = (o.vol ?? 1) * (o.rate ?? 1);
  const f = (o.rate ?? 1) * 220;
  osc(t, 1.8, { out: o.out, gain: 0.08 * (o.vol ?? 1), type: 'triangle', freq: f, to: f * 0.995, pan: o.pan, rev: 1, attack: 0.004, filt: 'lowpass' });
  osc(t, 1.2, { out: o.out, gain: 0.045 * (o.vol ?? 1), type: 'sine', freq: f * 2, pan: o.pan, rev: 0.9, attack: 0.003 });
  noise(t, 0.06, { out: o.out, gain: 0.03 * (o.vol ?? 1), type: 'bandpass', freq: f * 3, q: 2, pan: o.pan, rev: 0.6, attack: 0.001 });
};
/* A draft testing a door handle: rising air under a soft metallic turn. */
S.draft = (t, o) => {
  const v = o.vol ?? 1;
  const n = noise(t, 1.5, { out: o.out, gain: 0.09 * v, type: 'bandpass', freq: 340, q: 1.4, pan: o.pan, rev: 0.8, attack: 0.5, rate: 1 });
  if (n && n.f) { n.f.frequency.linearRampToValueAtTime(520, t + 0.8); n.f.frequency.linearRampToValueAtTime(280, t + 1.4); }
  osc(t, 0.5, { out: o.out, gain: 0.05 * v, type: 'square', freq: rand(70, 110), to: rand(40, 60), pan: o.pan, rev: 0.7, attack: 0.08, filt: 'lowpass' });
};
S.whisper = (t, o) => {
  const v = o.vol ?? 1;
  const words = 2 + Math.floor(rand(0, 3));
  for (let i = 0; i < words; i++) {
    noise(t + i * rand(0.18, 0.34), rand(0.1, 0.22), { out: o.out, gain: 0.1 * v, type: 'bandpass', freq: rand(900, 2600), q: 6, pan: (o.pan ?? 0) + rand(-0.5, 0.5), rev: 0.6, attack: 0.02, rate: rand(0.7, 1.2) });
  }
};
S.scream = (t, o) => {
  const v = o.vol ?? 1;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  o1.frequency.setValueAtTime(rand(380, 520), t);
  o1.frequency.linearRampToValueAtTime(rand(600, 900), t + 0.35);
  o1.frequency.linearRampToValueAtTime(rand(200, 320), t + 1.5);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 4;
  const g = ctx.createGain(); const p = panNode(o.pan ?? 0);
  o1.connect(f); f.connect(g); g.connect(p); p.connect(o.out);
  const rg = ctx.createGain(); rg.gain.value = 1.4; p.connect(rg); rg.connect(revSend);
  env(g.gain, t, 0.12, 0.5, 0.4, 0.9, 0.16 * v, 0.08 * v);
  o1.start(t); o1.stop(t + 1.8);
  noise(t, 1.4, { out: o.out, gain: 0.07 * v, type: 'bandpass', freq: 1800, q: 2, pan: o.pan, rev: 1.0, attack: 0.1 });
};
S.heartbeat = (t, o) => {
  const v = o.vol ?? 1;
  const thump = (dt, amp, f0) => {
    osc(t + dt, 0.26, { out: o.out, gain: 0.55 * amp * v, type: 'sine', freq: f0, to: f0 * 0.42, pan: 0, rev: 0.12, attack: 0.006 });
    noise(t + dt, 0.1, { out: o.out, gain: 0.14 * amp * v, type: 'lowpass', freq: 260, q: 1, pan: 0, rev: 0.1, attack: 0.002 });
  };
  thump(0, 1, o.f ?? 52);
  thump(0.19, 0.62, o.f ? o.f * 0.9 : 46);
};
S.bloodPickup = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 3; i++) {
    const dt = i * 0.11;
    noise(t + dt, 0.13, { out: o.out, gain: 0.16 * v, type: 'bandpass', freq: rand(400, 900), q: 2.5, pan: o.pan, rev: 0.3, attack: 0.01, rate: rand(0.5, 0.8) });
    osc(t + dt, 0.16, { out: o.out, gain: 0.12 * v, type: 'sine', freq: rand(140, 220), to: rand(70, 110), pan: o.pan, rev: 0.25, attack: 0.01 });
  }
};
S.drink = (t, o) => {
  const v = o.vol ?? 1;
  for (let i = 0; i < 4; i++) {
    const dt = i * 0.19;
    noise(t + dt, 0.16, { out: o.out, gain: 0.14 * v, type: 'lowpass', freq: rand(500, 900), q: 2, pan: 0, rev: 0.25, attack: 0.02, rate: rand(0.4, 0.7) });
    osc(t + dt, 0.14, { out: o.out, gain: 0.1 * v, type: 'sine', freq: rand(110, 170), to: 70, pan: 0, rev: 0.2, attack: 0.01 });
  }
};
S.thunder = (t, o) => {
  const v = o.vol ?? 1;
  const n = noise(t, 3.2, { out: o.out, gain: 0.42 * v, type: 'lowpass', freq: 420, q: 0.7, pan: o.pan, rev: 0.9, attack: 0.02, rate: 0.6, sweep: 0.15 });
  if (n && n.f) n.f.frequency.setValueAtTime(600, t);
  osc(t + 0.05, 2.6, { out: o.out, gain: 0.2 * v, type: 'sine', freq: 44, to: 26, pan: o.pan, rev: 0.7, attack: 0.05 });
  if (chance(0.6)) noise(t, 0.25, { out: o.out, gain: 0.3 * v, type: 'highpass', freq: 1600, q: 0.6, pan: o.pan, rev: 0.6, attack: 0.001, sweep: 0.3 });
};
S.crack = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.35, { out: o.out, gain: 0.5 * v, type: 'highpass', freq: 900, q: 0.6, pan: o.pan, rev: 0.7, attack: 0.001, sweep: 0.2 });
};
S.clockTick = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 0.05, { out: o.out, gain: 0.1 * v, type: 'bandpass', freq: 2200, q: 6, pan: o.pan, rev: 0.5, attack: 0.001 });
  osc(t, 0.06, { out: o.out, gain: 0.05 * v, type: 'square', freq: 1500, to: 700, pan: o.pan, rev: 0.4, attack: 0.001 });
};
S.bell = (t, o) => {
  const v = o.vol ?? 1;
  const base = o.base ?? 220;
  const partials = [1, 2, 2.76, 5.4, 8.1];
  partials.forEach((p, i) => {
    osc(t, 5 - i * 0.6, { out: o.out, gain: (0.16 * v) / (1 + i * 0.7), type: 'sine', freq: base * p, pan: o.pan, rev: 1.0, attack: 0.004 });
  });
  noise(t, 0.25, { out: o.out, gain: 0.1 * v, type: 'bandpass', freq: base * 6, q: 3, pan: o.pan, rev: 0.9, attack: 0.002 });
};
S.dawnChime = (t, o) => {
  const v = o.vol ?? 1;
  const notes = [392, 523.25, 659.25, 784];
  notes.forEach((f, i) => {
    osc(t + i * 0.45, 4.5 - i * 0.4, { out: o.out, gain: 0.1 * v, type: 'sine', freq: f, pan: (i - 1.5) * 0.25, rev: 1.0, attack: 0.03 });
    osc(t + i * 0.45, 3.4, { out: o.out, gain: 0.05 * v, type: 'triangle', freq: f * 2, pan: (i - 1.5) * 0.25, rev: 0.8, attack: 0.05 });
  });
};
S.death = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 4.5, { out: o.out, gain: 0.28 * v, type: 'sawtooth', freq: 130, to: 32, pan: 0, rev: 0.9, attack: 0.02, filt: 'lowpass', filtQ: 3 });
  osc(t + 0.1, 4.2, { out: o.out, gain: 0.16 * v, type: 'sine', freq: 65, to: 22, pan: 0, rev: 0.8, attack: 0.05 });
  noise(t, 3.4, { out: o.out, gain: 0.12 * v, type: 'lowpass', freq: 500, q: 1, pan: 0, rev: 0.7, attack: 0.4, rate: 0.4 });
};
S.stinger = (t, o) => {
  const v = o.vol ?? 1;
  const det = o.det ?? 0;
  [1, 1.06, 1.5].forEach((m, i) => {
    osc(t, 2.2, { out: o.out, gain: 0.12 * v, type: 'sawtooth', freq: 110 * m * (1 + det), pan: (i - 1) * 0.5, rev: 0.8, attack: 0.05, filt: 'lowpass', filtQ: 4 });
  });
  noise(t, 1.6, { out: o.out, gain: 0.1 * v, type: 'bandpass', freq: 900, q: 1, pan: 0, rev: 0.8, attack: 0.3, sweep: 2 });
};
S.werewolfReveal = (t, o) => {
  const v = o.vol ?? 1;
  S.growl(t, { ...o, vol: v * 1.3 });
  S.thunder(t + 0.1, { ...o, vol: v * 0.6 });
  osc(t, 3, { out: o.out, gain: 0.2 * v, type: 'sawtooth', freq: 45, to: 30, pan: 0, rev: 0.7, attack: 0.2, filt: 'lowpass' });
};
S.wind_gust = (t, o) => {
  const v = o.vol ?? 1;
  const n = noise(t, 3.4, { out: o.out, gain: 0.2 * v, type: 'bandpass', freq: 500, q: 0.7, pan: o.pan, rev: 0.5, attack: 1.0, rate: 0.6, sweep: 1.6 });
  if (n && n.f) n.f.frequency.linearRampToValueAtTime(300, t + 2.6);
};
S.uiClick = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.09, { out: o.out, gain: 0.1 * v, type: 'triangle', freq: 660, to: 330, pan: 0, rev: 0.25, attack: 0.002 });
  noise(t, 0.05, { out: o.out, gain: 0.06 * v, type: 'highpass', freq: 2000, q: 1, pan: 0, rev: 0.2, attack: 0.001 });
};
S.uiHover = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.07, { out: o.out, gain: 0.045 * v, type: 'sine', freq: 880, to: 1040, pan: 0, rev: 0.3, attack: 0.002 });
};
S.uiConfirm = (t, o) => {
  const v = o.vol ?? 1;
  [523.25, 784].forEach((f, i) => osc(t + i * 0.08, 0.9, { out: o.out, gain: 0.09 * v, type: 'sine', freq: f, pan: 0, rev: 0.7, attack: 0.005 }));
};
S.uiBack = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.22, { out: o.out, gain: 0.07 * v, type: 'sine', freq: 420, to: 260, pan: 0, rev: 0.4, attack: 0.003 });
};
S.shard = (t, o) => {
  const v = o.vol ?? 1;
  [1200, 1800, 2400].forEach((f, i) => osc(t + i * 0.06, 0.7, { out: o.out, gain: 0.07 * v, type: 'sine', freq: f, pan: (i - 1) * 0.4, rev: 0.8, attack: 0.002 }));
};
S.lowBloodWarn = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 1.4, { out: o.out, gain: 0.1 * v, type: 'sine', freq: 58, to: 44, pan: 0, rev: 0.3, attack: 0.3 });
  osc(t, 1.2, { out: o.out, gain: 0.05 * v, type: 'triangle', freq: 233, to: 180, pan: 0, rev: 0.5, attack: 0.4 });
};
S.blackout = (t, o) => {
  const v = o.vol ?? 1;
  noise(t, 1.2, { out: o.out, gain: 0.22 * v, type: 'lowpass', freq: 900, q: 1, pan: 0, rev: 0.6, attack: 0.01, sweep: 0.15 });
  osc(t, 1.6, { out: o.out, gain: 0.14 * v, type: 'sine', freq: 160, to: 40, pan: 0, rev: 0.5, attack: 0.01 });
};
S.impact = (t, o) => {
  const v = o.vol ?? 1;
  osc(t, 0.4, { out: o.out, gain: 0.3 * v, type: 'sine', freq: 70, to: 28, pan: 0, rev: 0.4, attack: 0.001 });
  noise(t, 0.3, { out: o.out, gain: 0.3 * v, type: 'lowpass', freq: 600, q: 1, pan: 0, rev: 0.35, attack: 0.001 });
};
S.chandelier = (t, o) => {
  const v = o.vol ?? 1;
  S.impact(t, { ...o, vol: v * 1.2 });
  S.glassBreak(t + 0.05, { ...o, vol: v * 0.7 });
  for (let i = 0; i < 10; i++) noise(t + rand(0.1, 1.4), 0.06, { out: o.out, gain: 0.09 * v, type: 'bandpass', freq: rand(900, 3000), q: 5, pan: rand(-0.6, 0.6), rev: 0.6, attack: 0.001 });
};

function distCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** Play a sound by name. */
export function play(name, { x, y, cam, vol = 1, pan = null, rate = null, bus = 'sfx', f = null, base = null, det = null, soft = false } = {}) {
  if (!ready || !ctx) return;
  const fn = S[name];
  if (!fn) return;
  // positional
  let p = pan;
  if (p === null) {
    if (cam && x !== undefined) p = clamp((x - cam.x) / (cam.viewW * 0.5 || 600), -1, 1);
    else p = 0;
  }
  const dest = bus === 'amb' ? ambBus : bus === 'music' ? musicBus : sfxBus;
  try { fn(now() + 0.001, { out: dest, pan: p, vol, rev: 1, soft, rate, f }); }
  catch (e) { /* the show must go on */ }
}

export function playAt(name, worldX, worldY, cam, extra = {}) {
  if (!ready || !ctx) return;
  const dx = worldX - cam.x, dy = worldY - cam.y;
  const d = Math.hypot(dx, dy);
  const maxD = extra.maxDist ?? 1100;
  const atten = clamp(1 - (d - 120) / maxD, 0, 1);
  if (atten <= 0.001) return;
  const vol = (extra.vol ?? 1) * atten * atten;
  const pan = clamp(dx / (cam.viewW * 0.45 || 520), -1, 1);
  play(name, { vol, pan, ...extra });
}

/** Lower music briefly so a stinger or a scream cuts through. */
export function duck(amount = 0.45, seconds = 1.2) {
  if (!ready || !ctx || !musicBus) return;
  const t = now();
  const target = musicBaseGain;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setTargetAtTime(target * amount, t, 0.06);
  musicBus.gain.setTargetAtTime(target, t + seconds, 0.5);
}

/* ================= persistent loops ================= */

let wind, windGain, windFilter, gust, gustGain, fireGain, fireFilter;
let droneG, tensionG, panicG, shimmerG;
let lowBloodG;
let clockNext = 0, creakNext = 0, dripNext = 0, fireNext = 0, whisperNext = 0, gustNext = 0;
let musicBaseGain = 0.75;

function loopNoise(buf, { freq, q, type = 'bandpass' }) {
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g);
  src.start(0);
  return { g, f, src };
}

function buildLoops() {
  // ---- wind: two layers, low rumble + whistling gust
  const w = loopNoise(noiseBuf, { freq: 380, q: 0.8, type: 'lowpass' });
  windGain = w.g; windFilter = w.f; wind = w;
  w.g.connect(ambBus);
  const wp = ctx.createStereoPanner(); // wide
  // (keep simple: mono into ambience)

  const gu = loopNoise(noiseBuf, { freq: 900, q: 3.5, type: 'bandpass' });
  gustGain = gu.g; gust = gu;
  gu.g.connect(ambBus);
  // slow LFO on the gust filter
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
  const lg = ctx.createGain(); lg.gain.value = 520;
  lfo.connect(lg); lg.connect(gu.f.frequency); lfo.start(0);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.043;
  const lg2 = ctx.createGain(); lg2.gain.value = 0.5;
  const lfo2g = ctx.createGain(); lfo2g.gain.value = 0.5;
  lfo2.connect(lfo2g); lfo2.start(0);

  // ---- fireplace
  const fi = loopNoise(noiseBuf, { freq: 600, q: 1.1, type: 'lowpass' });
  fireGain = fi.g; fireFilter = fi.f;
  fi.g.connect(ambBus);

  // ---- low blood drone (always running, gain 0)
  lowBloodG = ctx.createGain(); lowBloodG.gain.value = 0;
  const lb1 = ctx.createOscillator(); lb1.type = 'sine'; lb1.frequency.value = 55;
  const lb2 = ctx.createOscillator(); lb2.type = 'triangle'; lb2.frequency.value = 82.5;
  const lbF = ctx.createBiquadFilter(); lbF.type = 'lowpass'; lbF.frequency.value = 300;
  const tremor = ctx.createOscillator(); tremor.frequency.value = 5.4;
  const tremorG = ctx.createGain(); tremorG.gain.value = 0.35;
  tremor.connect(tremorG); tremorG.connect(lowBloodG.gain);
  lb1.connect(lbF); lb2.connect(lbF); lbF.connect(lowBloodG); lowBloodG.connect(musicBus ?? master);
  lb1.start(0); lb2.start(0); tremor.start(0);
}

function buildMusic() {
  const mk = (gain) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(musicBus); return g; };

  // ---- night drone (always present)
  droneG = mk(0);
  const per = [55, 82.4, 110, 164.8];  // A1 E2 A2 E3 — open fifth, mournful
  per.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f * (1 + (i - 1.5) * 0.0016);
    const g = ctx.createGain(); g.gain.value = [0.5, 0.32, 0.22, 0.1][i];
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 420;
    o.connect(fl); fl.connect(g); g.connect(droneG);
    o.start(0);
    // slow beating
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.021;
    const lg = ctx.createGain(); lg.gain.value = f * 0.004;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(0);
  });
  // airy shimmer
  const sh = loopNoise(noiseBuf, { freq: 2600, q: 1.4, type: 'bandpass' });
  const shg = ctx.createGain(); shg.gain.value = 0.02;
  sh.g.connect(shg); shg.connect(droneG);

  // ---- tension layer (dissonant cluster, fades in with danger)
  tensionG = mk(0);
  const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 900; tf.Q.value = 2;
  tf.connect(tensionG);
  [110, 116.5, 233.1, 246.9].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.06 / (1 + i * 0.25);
    o.connect(g); g.connect(tf); o.start(0);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13 + i * 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(0);
  });

  // ---- panic pulse (rhythmic low pulse, scheduled in update)
  panicG = mk(0);
}

let lastPanic = 0;

/* ================= heartbeat scheduler ================= */

let hbRate = 0, hbEnabled = false, hbNext = 0, hbStrength = 0;
export let onHeartbeat = null;
export function setHeartbeatCallback(fn) { onHeartbeat = fn; }

export function setHeartbeat(rate, strength) {
  hbRate = rate; hbStrength = strength;
  hbEnabled = rate > 0.05;
  if (!hbEnabled) hbNext = 0;
}
export function currentHeartbeat() { return { hbRate, hbStrength, enabled: hbEnabled }; }

/* ================= per-frame update ================= */

export function updateAudio(dt, st = {}) {
  if (!ready || !ctx) return;
  const t = now();
  const {
    intensity = 0, danger = 0, panic = 0, wind = 0.35, muffle = 0,
    nearFire = 0, lowBlood = 0, silenceMusic = 0, indoors = 1, heartbeat = 0,
  } = st;
  musicBaseGain = 0.75;

  // ---- ambience mixing
  if (windGain) windGain.gain.setTargetAtTime(0.055 + wind * 0.1, t, 0.6);
  if (gustGain) gustGain.gain.setTargetAtTime(0.012 + wind * 0.05, t, 1.2);
  if (fireGain) fireGain.gain.setTargetAtTime(nearFire > 0 ? 0.05 + nearFire * 0.12 : 0, t, 0.5);
  if (lowBloodG) lowBloodG.gain.setTargetAtTime(lowBlood * 0.1, t, 0.8);

  // ---- music layers
  const duckAmt = 1 - silenceMusic;
  droneG.gain.setTargetAtTime((0.5 + intensity * 0.25) * duckAmt, t, 1.4);
  tensionG.gain.setTargetAtTime(clamp(danger * 0.85, 0, 0.9) * duckAmt, t, 1.8);
  panicG.gain.setTargetAtTime(clamp(panic * 0.9, 0, 0.95) * duckAmt, t, 1.0);

  // ---- panic pulse scheduling (heart of the panic phase)
  if (panic > 0.02) {
    const interval = lerp(0.62, 0.42, clamp(panic, 0, 1));
    if (t > lastPanic + interval) {
      lastPanic = t;
      osc(t, 0.5, { out: panicG, gain: 0.3, type: 'sine', freq: 55, to: 34, attack: 0.01, rev: 0.15, pan: 0 });
      noise(t, 0.2, { out: panicG, gain: 0.1, type: 'lowpass', freq: 200, q: 2, attack: 0.005, rev: 0.1, pan: 0 });
    }
  }

  // ---- heartbeat
  if (hbEnabled) {
    const beat = 1 / clamp(hbRate, 0.2, 4);
    if (hbNext === 0) hbNext = t + 0.05;
    while (hbNext < t + 0.12) {
      S.heartbeat(hbNext, { out: sfxBus, vol: 0.5 + hbStrength * 0.55, pan: 0, f: 50 + hbStrength * 8, rev: 1 });
      if (onHeartbeat) onHeartbeat(hbStrength);
      hbNext += beat;
    }
    if (hbNext < t - 1) hbNext = t;
  }

  // ---- ambience events (the mansion talks to you)
  if (t > clockNext) { clockNext = t + rand(0.95, 1.05); S.clockTick(t, { out: ambBus, vol: 0.5, pan: rand(-0.5, 0.5), rev: 1 }); }
  if (t > creakNext) { creakNext = t + rand(7, 22); S.creak(t, { out: ambBus, vol: rand(0.5, 1), pan: rand(-0.8, 0.8), rev: 1 }); }
  if (t > dripNext) { dripNext = t + rand(4, 14); S.drip(t, { out: ambBus, vol: rand(0.4, 0.9), pan: rand(-0.8, 0.8), rev: 1 }); }
  if (t > gustNext) { gustNext = t + rand(14, 40); S.wind_gust(t, { out: ambBus, vol: rand(0.5, 0.95), pan: rand(-0.6, 0.6), rev: 1 }); }
  if (nearFire > 0 && t > fireNext) { fireNext = t + rand(0.05, 0.28); noise(t, rand(0.03, 0.1), { out: ambBus, gain: rand(0.02, 0.08) * nearFire, type: 'bandpass', freq: rand(1200, 3600), q: 4, pan: rand(-0.4, 0.4), attack: 0.001 }); }
  if (danger > 0.45 && t > whisperNext) {
    whisperNext = t + rand(12, 34) / (1 + danger);
    S.whisper(t, { out: ambBus, vol: rand(0.4, 0.8) * danger, pan: rand(-0.9, 0.9), rev: 1 });
  }
}

export function now_() { return ctx ? ctx.currentTime : 0; }
export function stopAll() {
  if (!ctx) return;
  [sfxBus, ambBus, musicBus].forEach((b) => b && b.gain.setTargetAtTime(0, ctx.currentTime, 0.05));
}
export function resumeAll() {
  if (!ctx) return;
  ambBus.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
  sfxBus.gain.setTargetAtTime(1, ctx.currentTime, 0.1);
  musicBus.gain.setTargetAtTime(musicBaseGain, ctx.currentTime, 0.3);
}
export { TAU };
