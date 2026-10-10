/* LAST NIGHT — renderer
 * Camera, layered compositing, dynamic 2D lighting (multiply lightmap + additive glow),
 * particles, decals, fog and post-processing.
 *
 * The look: rooms are painted as faded dusk, then a multiply lightmap shapes
 * the pools. A screen wash lifts the black point so the house stays "terang
 * pudar" — dim and washed, never a solid black void. Candles still glow warmer.
 */

import { clamp, lerp, damp, TAU, rand, randInt, hash2, ISO_CAMERA } from './util.js';

export const PAL = {
  ink: '#05060b',
  void: '#04050a',
  night: '#0a1024',
  deepBlue: '#131f3d',
  blue: '#22345c',
  moon: '#8fb6e8',
  moonDim: '#4a6a9c',
  purple: '#2a1d3d',
  crimson: '#57121f',
  blood: '#7d1220',
  bloodBright: '#b8202e',
  bone: '#cfc9b8',
  pale: '#e6e1d2',
  candle: '#ffb257',
  candleDim: '#c07a2c',
  wood: '#2e1d13',
  woodMid: '#452b1a',
  woodLight: '#633d24',
  stone: '#23242c',
  stoneLight: '#34363f',
  gold: '#a8833c',
  teal: '#20403f',
  gray: '#4a4e58',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.light = document.createElement('canvas');
    this.lightCtx = this.light.getContext('2d');
    this.lightScale = 0.5;
    this.w = 1280; this.h = 720;
    this.dpr = 1;
    // True orthographic isometric camera shared with the Three.js room pass.
    // World x/z both project diagonally; bodies are billboarded upright at
    // their projected floor anchor so the rooms have depth without flattening
    // the characters or changing collision-space coordinates.
    this.isometric = true;
    this.baseTilt = ISO_CAMERA.tilt;
    this.tilt = this.baseTilt;
    this.view = { left: 0, top: 0, w: 1280, h: 720, cx: 640, cy: 360 };
    this.cam = { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, viewW: 1280, viewH: 720, shake: 0, sx: 0, sy: 0, rot: 0 };
    this.grain = this._makeGrain();
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.time = 0;
    this._fogBlobs = [];
    for (let i = 0; i < 14; i++) {
      this._fogBlobs.push({
        x: rand(-1500, 2580), y: rand(-700, 1800), r: rand(220, 520),
        vx: rand(-8, 8), vy: rand(-4, 4), a: rand(0.015, 0.05), p: rand(0, TAU),
      });
    }
  }

  _makeGrain() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 46;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  resize(cssW, cssH, dpr) {
    this.w = Math.max(320, Math.floor(cssW));
    this.h = Math.max(240, Math.floor(cssH));
    this.dpr = clamp(dpr || 1, 1, 1.75);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.light.width = Math.max(2, Math.floor(this.w * this.lightScale));
    this.light.height = Math.max(2, Math.floor(this.h * this.lightScale));
    // A consistent 35.264° elevation is important: both the 2D gameplay
    // plane and the real 3D room meshes use the same orthographic projection.
    // Portrait is framed a little wider for touch play; landscape lets the
    // architecture breathe without making the hunter feel tiny.
    const tall = this.h > this.w * 1.2 && this.h >= 620;
    this.tilt = this.baseTilt;
    this.view = { left: 0, top: 0, w: this.w, h: this.h, cx: this.w / 2, cy: this.h / 2 };
    this.cam.zoom = tall
      ? clamp(this.w / 720, 0.48, 0.68)
      : clamp(Math.min(this.w / 1100, this.h / 620), 0.72, 1.35);
    // The inverse of an isometric viewport is a diamond. These are its
    // conservative world-space half-extents, used for camera/bounds culling.
    const a = this.cam.zoom * ISO_CAMERA.horizontal;
    const b = this.cam.zoom * ISO_CAMERA.vertical;
    const worldSpan = this.view.w / (2 * a) + this.view.h / (2 * b);
    this.cam.viewW = worldSpan;
    this.cam.viewH = worldSpan;
  }

  /* ---------------- camera ---------------- */
  snapCamera(x, y) {
    this.cam.x = x; this.cam.y = y;
  }

  /**
   * Follow with a little look-ahead in the direction of travel and hard-ish clamp
   * to the mansion bounds so the frame never shows the void.
   */
  followCamera(tx, ty, dt, lookX = 0, lookY = 0, bounds = null) {
    const c = this.cam;
    let gx = tx + lookX, gy = ty + lookY;
    if (bounds) {
      const hw = c.viewW / 2, hh = c.viewH / 2;
      const minX = bounds.x + Math.min(hw, (bounds.w) / 2);
      const maxX = bounds.x + bounds.w - Math.min(hw, (bounds.w) / 2);
      const minY = bounds.y + Math.min(hh, (bounds.h) / 2);
      const maxY = bounds.y + bounds.h - Math.min(hh, (bounds.h) / 2);
      gx = clamp(gx, minX, maxX); gy = clamp(gy, minY, maxY);
    }
    c.x = damp(c.x, gx, 6.2, dt);
    c.y = damp(c.y, gy, 6.2, dt);
    // impact shake
    c.shake = Math.max(0, c.shake - dt * (1.6 + c.shake * 2.2));
    const amp = c.shake * c.shake * 22;
    c.sx = (Math.random() * 2 - 1) * amp;
    c.sy = (Math.random() * 2 - 1) * amp;
  }

  shake(amount) { this.cam.shake = Math.min(2.6, this.cam.shake + amount); }
  get shakeEnabled() { return this._shake !== false; }
  set shakeEnabled(v) { this._shake = v; }
  addFlash(v, color = '#ffffff') { this.flash = Math.min(1.4, this.flash + v); this.flashColor = color; }

  /**
   * The impact flash is a FLASH, and it has to decay on the simulation clock.
   * Decaying it per rendered frame meant a slow frame (or a long frame gap)
   * left it stuck on screen; before this existed at all, it accumulated over a
   * whole night and washed the screen out permanently.
   */
  decayFlash(dt) { this.flash = Math.max(0, this.flash - dt * 3.4); }

  screenToWorld(sx, sy) {
    const c = this.cam;
    const v = this.view;
    const { horizontal: h, vertical: k } = ISO_CAMERA;
    const u = (sx - v.cx) / (c.zoom * h);
    const q = (sy - v.cy) / (c.zoom * k);
    return { x: c.x + (u + q) * 0.5, y: c.y + (q - u) * 0.5 };
  }

  /** Inverse of the world camera (shake ignored — HUD cues must not jitter). */
  worldToScreen(x, y) {
    const c = this.cam;
    const v = this.view;
    const { horizontal: h, vertical: k } = ISO_CAMERA;
    const dx = x - c.x, dy = y - c.y;
    return {
      x: v.cx + c.zoom * h * (dx - dy),
      y: v.cy + c.zoom * k * (dx + dy),
    };
  }

  /** Project a floor-space vector into unzoomed isometric screen space. */
  projectDelta(dx, dy) {
    const { horizontal: h, vertical: k } = ISO_CAMERA;
    return { x: h * (dx - dy), y: k * (dx + dy) };
  }

  /* ---------------- world drawing ---------------- */
  beginWorld() {
    const ctx = this.ctx, c = this.cam;
    const v = this.view;
    ctx.save();
    this._worldState = true;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (v.top > 0 || v.h < this.h - 1) {
      ctx.beginPath();
      ctx.rect(v.left, v.top, v.w, v.h);
      ctx.clip();
    }
    const sh = this._shake === false ? 0 : 1;
    ctx.translate(v.cx + c.sx * sh, v.cy + c.sy * sh);
    ctx.transform(
      c.zoom * ISO_CAMERA.horizontal,
      c.zoom * ISO_CAMERA.vertical,
      -c.zoom * ISO_CAMERA.horizontal,
      c.zoom * ISO_CAMERA.vertical,
      0, 0,
    );
    ctx.translate(-c.x, -c.y);
  }

  /**
   * Switch a world draw into an upright screen-facing billboard while keeping
   * its feet pinned to the isometric floor point. `x,y` remain world coords,
   * so existing entity draw code needs no coordinate rewrite.
   */
  upright(ctx, x, y) {
    const p = this.worldToScreen(x, y);
    const sh = this._shake === false ? 0 : 1;
    const dpr = this.dpr, scale = this.cam.zoom;
    ctx.setTransform(
      dpr * scale, 0, 0, dpr * scale,
      dpr * (p.x + this.cam.sx * sh - x * scale),
      dpr * (p.y + this.cam.sy * sh - y * scale),
    );
  }

  isVisible(x, y, pad = 80) {
    const c = this.cam;
    return Math.abs(x - c.x) < c.viewW / 2 + pad && Math.abs(y - c.y) < c.viewH / 2 + pad;
  }

  /**
   * Same lamps the world uses, sampled at a floor point. Multiply cannot
   * light a near-black body, so enemy draw reads this and grades itself.
   */
  shadeAt(x, y, game) {
    const lights = (game && game.mansion && game.mansion.lights) || [];
    let r = 22, g = 26, b = 38;
    let keyX = -0.4, keyY = -0.8, keyW = 0.15;
    let lit = 0.12;
    for (const l of lights) {
      if (l.on === false) continue;
      const dx = x - l.x;
      const dy = y - l.y;
      const d = Math.hypot(dx, dy);
      const rad = l.r || 160;
      const fall = Math.max(0, 1 - d / rad);
      const i = (l.curI ?? l.i ?? 0) * fall * fall;
      if (i < 0.02) continue;
      const c = l.color || [255, 186, 120];
      r += c[0] * i * 0.45;
      g += c[1] * i * 0.45;
      b += c[2] * i * 0.45;
      lit += i;
      if (i > keyW) { keyW = i; keyX = dx; keyY = dy; }
    }
    const p = game && game.player;
    if (p && p.lightR) {
      const d = Math.hypot(x - p.x, y - p.y);
      const fall = Math.max(0, 1 - d / p.lightR);
      const i = (p.lightI || 0) * fall;
      r += 176 * i;
      g += 194 * i;
      b += 224 * i;
      lit += i;
    }
    return {
      r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b),
      lit: Math.min(1, lit), keyX, keyY, keyW,
    };
  }

  /* ---------------- lighting ---------------- */
  lightBegin(ambient) {
    const lc = this.lightCtx;
    // Faded dusk, not a black multiply. Callers should pass mansion.ambientFor.
    const ambientRgb = ambient ?? [164, 170, 184];
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = `rgb(${ambientRgb[0]},${ambientRgb[1]},${ambientRgb[2]})`;
    lc.fillRect(0, 0, this.light.width, this.light.height);
    const c = this.cam;
    const v = this.view;
    const sx = this.lightScale * c.zoom * ISO_CAMERA.horizontal;
    const sy = this.lightScale * c.zoom * ISO_CAMERA.vertical;
    const sh = this._shake === false ? 0 : 1;
    lc.globalCompositeOperation = 'lighter';
    lc.setTransform(
      sx, sy, -sx, sy,
      this.lightScale * (v.cx + c.sx * sh) - sx * c.x + sx * c.y,
      this.lightScale * (v.cy + c.sy * sh) - sy * (c.x + c.y),
    );
    this._lights = [];
  }

  /**
   * The frame's lights, remembered for the 3D rig (issue #54 Phase B). The
   * bodies are lit by the same lamps that light the floor, so a lamp warms
   * both and a dark corner dims both — the two can never disagree about where
   * the light in this house is coming from.
   */
  keyLightAt(x, y) {
    const list = this._lights || [];
    let best = null;
    let bestWeight = 0;
    let level = 0;
    for (const entry of list) {
      const d = Math.hypot(x - entry.x, y - entry.y);
      const weight = entry.intensity / (1 + d / Math.max(1, entry.radius * 0.8));
      level += weight;
      if (weight > bestWeight) { bestWeight = weight; best = entry; }
    }
    // Nothing near: moonlight from the windows, high and cold.
    if (!best) return { dx: -0.45, dy: -0.9, level: 0, color: [150, 172, 214] };
    const d = Math.hypot(x - best.x, y - best.y) || 1;
    // Standing inside the lamp itself has no direction. Nudge it, or the
    // shadow collapses to a dot directly under the feet.
    if (d < 8) return { dx: -0.32, dy: 0.72, level: Math.min(1, level), color: best.color };
    return { dx: (x - best.x) / d, dy: (y - best.y) / d, level: Math.min(1, level), color: best.color };
  }

  /** Radial light. color/intensity are multiplied into the lightmap. */
  addLight(x, y, radius, intensity, color = [255, 186, 120]) {
    if (!this.isVisible(x, y, radius)) return;
    if (this._lights) this._lights.push({ x, y, radius, intensity: clamp(intensity, 0, 2.4), color });
    const lc = this.lightCtx;
    const g = lc.createRadialGradient(x, y, 0, x, y, radius);
    const c = color;
    const i = clamp(intensity, 0, 2.4);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, 1.0 * i)})`);
    g.addColorStop(0.35, `rgba(${c[0] * 0.72 | 0},${c[1] * 0.72 | 0},${c[2] * 0.72 | 0},${0.55 * i})`);
    g.addColorStop(0.72, `rgba(${c[0] * 0.3 | 0},${c[1] * 0.32 | 0},${c[2] * 0.38 | 0},${0.2 * i})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.arc(x, y, radius, 0, TAU);
    lc.fill();
  }

  /** Cone / window shaft: a soft quad of light. */
  addLightShaft(x, y, w, h, angle, intensity, color = [150, 190, 235]) {
    const lc = this.lightCtx;
    lc.save();
    lc.translate(x, y);
    lc.rotate(angle);
    const g = lc.createLinearGradient(0, 0, 0, h);
    const i = clamp(intensity, 0, 2);
    g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${0.85 * i})`);
    g.addColorStop(0.45, `rgba(${color[0] * 0.6 | 0},${color[1] * 0.65 | 0},${color[2] * 0.8 | 0},${0.4 * i})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(-w / 2, 0);
    lc.lineTo(w / 2, 0);
    lc.lineTo(w / 2 + w * 0.55, h);
    lc.lineTo(-w / 2 - w * 0.55, h);
    lc.closePath();
    lc.fill();
    lc.restore();
  }

  /** Vision polygon (already computed in world space) filled with a soft falloff. */
  addVisionPolygon(points, cx, cy, radius, color = [235, 240, 255], intensity = 1) {
    const lc = this.lightCtx;
    if (points.length < 3) return;
    const g = lc.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius);
    const i = clamp(intensity, 0, 2);
    g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${0.95 * i})`);
    g.addColorStop(0.5, `rgba(${color[0] * 0.8 | 0},${color[1] * 0.85 | 0},${color[2] * 0.9 | 0},${0.5 * i})`);
    g.addColorStop(0.85, `rgba(${color[0] * 0.4 | 0},${color[1] * 0.45 | 0},${color[2] * 0.55 | 0},${0.16 * i})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(points[0].x, points[0].y);
    for (let i2 = 1; i2 < points.length; i2++) lc.lineTo(points[i2].x, points[i2].y);
    lc.closePath();
    lc.fill();
  }

  lightEnd() {
    const lc = this.lightCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, this.w, this.h);
    // Multiply can only darken. Props painted near-black would still read
    // as a void, so screen a cool dusk and lift the black point to "pudar".
    const lift = this.fadeLift ?? 1;
    if (lift > 0.02) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.34 * lift;
      ctx.fillStyle = this.fadeColor || '#8490a4';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Warm additive pass: makes flames glow and pool light on surfaces. */
  glowBegin() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
  }
  glowEnd() { this.ctx.restore(); }

  /* ---------------- atmosphere ---------------- */
  drawFog(dt, alphaMul = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const halfX = this.cam.viewW / 2, halfY = this.cam.viewH / 2;
    for (const b of this._fogBlobs) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.p += dt * 0.4;
      if (b.x < this.cam.x - halfX - b.r) b.x = this.cam.x + halfX + b.r;
      if (b.x > this.cam.x + halfX + b.r) b.x = this.cam.x - halfX - b.r;
      if (b.y < this.cam.y - halfY - b.r) b.y = this.cam.y + halfY + b.r;
      if (b.y > this.cam.y + halfY + b.r) b.y = this.cam.y - halfY - b.r;
      if (!this.isVisible(b.x, b.y, b.r)) continue;
      const r = b.r * (1 + Math.sin(b.p) * 0.08);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      const a = b.a * alphaMul;
      g.addColorStop(0, `rgba(78,92,124,${a})`);
      g.addColorStop(0.6, `rgba(58,68,96,${a * 0.5})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- post ---------------- */
  post(opts = {}) {
    const ctx = this.ctx;
    const {
      vignette = 0.5, danger = 0, lowBlood = 0, heartbeat = 0, heal = 0,
      blackout = 0, time = 0,
      // peaks: the frame edges breathing red (crescendo / frenzy) and the
      // full-frame blood grade (frenzy). Both are grades, not new systems.
      edge = 0, red = 0,
    } = opts;
    this.time = time;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // colour grade: cold pressure (multiply) + blood pulsing
    if (danger > 0.02 || lowBlood > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${255 - danger * 36 | 0},${255 - danger * 64 | 0},${255 - danger * 24 | 0},1)`;
      ctx.globalAlpha = clamp(danger * 0.26 + lowBlood * 0.16, 0, 0.34);
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    if (lowBlood > 0.01) {
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.1, this.w / 2, this.h / 2, this.h * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(120,6,16,${0.28 * lowBlood})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
    }

    // the crescendo and the frenzy: the edges of the frame breathe red with
    // the heartbeat, so the peak reads even with the sound off
    if (edge > 0.01) {
      const e = clamp(edge * (0.72 + heartbeat * 0.55), 0, 1);
      ctx.globalCompositeOperation = 'screen';
      const ge = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * (0.30 - heartbeat * 0.03), this.w / 2, this.h / 2, this.h * 0.98);
      ge.addColorStop(0, 'rgba(0,0,0,0)');
      ge.addColorStop(0.55, `rgba(120,8,18,${0.20 * e})`);
      ge.addColorStop(1, `rgba(168,12,26,${0.62 * e})`);
      ctx.fillStyle = ge;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (red > 0.01) {
      const r2 = clamp(red, 0, 1);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp(0.28 * r2, 0, 0.4);
      ctx.fillStyle = `rgb(255,${255 - 90 * r2 | 0},${255 - 96 * r2 | 0})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'screen';
      const gr = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.05, this.w / 2, this.h / 2, this.h * 0.85);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, `rgba(150,10,24,${0.3 * r2})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
    }

    // heartbeat pulse ring + vignette breath
    const pulse = heartbeat;
    // vignette
    const v = clamp(vignette + danger * 0.1 + lowBlood * 0.14 + pulse * 0.04, 0, 0.8);
    const g2 = ctx.createRadialGradient(this.w / 2, this.h * 0.5, this.h * (0.42 - pulse * 0.02), this.w / 2, this.h * 0.5, this.h * 1.05);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(0.7, `rgba(10,14,24,${0.06 * v})`);
    g2.addColorStop(1, `rgba(8,10,18,${clamp(0.14 * v, 0, 0.24)})`);
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, this.w, this.h);

    if (blackout > 0) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(blackout, 0, 0.85)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.flash > 0.001) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(this.flash, 0, 1);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    // film grain
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.035 + lowBlood * 0.05;
    const ox = -Math.floor(rand(0, 128)), oy = -Math.floor(rand(0, 128));
    for (let x = ox; x < this.w; x += 128) for (let y = oy; y < this.h; y += 128) ctx.drawImage(this.grain, x, y);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear(color = PAL.void) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (color == null) {
      // The canvas is the screen-space HUD layer in full-3D gameplay.
      ctx.clearRect(0, 0, this.w, this.h);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Soften the letterbox so the room does not look sliced off. */
  drawFrameFade() {
    const v = this.view;
    if (!v || v.top < 4) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ink = '#04050a';
    const top = ctx.createLinearGradient(0, v.top - 6, 0, v.top + 28);
    top.addColorStop(0, ink);
    top.addColorStop(1, 'rgba(4,5,10,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, v.top - 6, this.w, 34);
    const bottomY = v.top + v.h;
    const bot = ctx.createLinearGradient(0, bottomY - 26, 0, bottomY + 8);
    bot.addColorStop(0, 'rgba(4,5,10,0)');
    bot.addColorStop(1, ink);
    ctx.fillStyle = bot;
    ctx.fillRect(0, bottomY - 26, this.w, 34);
    ctx.restore();
  }

  resetForUI() {
    const ctx = this.ctx;
    if (this._worldState) {
      ctx.restore();
      this._worldState = false;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

/* ================= particles ================= */

export class Particles {
  constructor(max = 700) {
    this.list = [];
    this.max = max;
  }
  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: 0, y: 0, vx: 0, vy: 0, life: 1, maxLife: 1, size: 3, color: '#fff',
      type: 'dot', drag: 0.9, grav: 0, spin: 0, rot: 0, alpha: 1, glow: false, z: 0,
      ...p,
      maxLife: p.life ?? 1,
    });
  }
  burst(type, x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = opts.angle !== undefined ? opts.angle + rand(-opts.spread ?? -0.5, opts.spread ?? 0.5) : rand(0, TAU);
      const sp = rand(opts.speedMin ?? 20, opts.speedMax ?? 90);
      this.spawn({
        x: x + rand(-(opts.jitter ?? 2), opts.jitter ?? 2),
        y: y + rand(-(opts.jitter ?? 2), opts.jitter ?? 2),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (opts.flat ? 0.45 : 1),
        life: rand(opts.lifeMin ?? 0.3, opts.lifeMax ?? 0.9),
        size: rand(opts.sizeMin ?? 1.5, opts.sizeMax ?? 4),
        color: opts.color ?? '#b8202e',
        type, drag: opts.drag ?? 0.86, grav: opts.grav ?? 0, glow: opts.glow ?? false,
        z: opts.z ?? 0,
      });
    }
  }
  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) { l.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.vy += p.grav * dt;
      p.rot += p.spin * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      const a = p.alpha * (p.type === 'dust' ? t * 0.6 : t);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      if (p.type === 'glow' || p.glow) {
        ctx.globalCompositeOperation = 'screen';
        const r = p.size * (2.4 - t);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.type === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.moveTo(-p.size, -p.size * 0.4); ctx.lineTo(p.size, 0); ctx.lineTo(-p.size, p.size * 0.4); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (p.type === 'mist') {
        const r = p.size * (2.2 - t * 0.9);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        const s = p.size * (p.type === 'blood' ? 1 : t * 0.6 + 0.4);
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* ================= floor decals (blood, footprints, cracks) ================= */

export class Decals {
  constructor(max = 260, bounds = null) {
    this.list = [];
    this.max = max;
    this.originX = bounds ? Math.floor(bounds.x) : 0;
    this.originY = bounds ? Math.floor(bounds.y) : 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = bounds ? Math.ceil(bounds.w) : 2560;
    this.canvas.height = bounds ? Math.ceil(bounds.h) : 2304;
    this.ctx = this.canvas.getContext('2d');
    this.dirty = false;
  }
  splat(x, y, size, color = 'rgba(120,14,24,0.5)', n = 5) {
    const c = this.ctx;
    c.save();
    c.translate(-this.originX, -this.originY);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = rand(0, size);
      const r = rand(size * 0.18, size * 0.5);
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, r, r * rand(0.6, 1), rand(0, TAU), 0, TAU);
      c.fill();
    }
    c.restore();
    this.dirty = true;
  }
  print(x, y, angle, color = 'rgba(90,10,18,0.28)', size = 6) {
    const c = this.ctx;
    c.save();
    c.translate(-this.originX, -this.originY);
    c.translate(x, y); c.rotate(angle);
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(0, 0, size, size * 0.55, 0, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(60,6,12,0.2)';
    c.beginPath(); c.ellipse(-size * 0.6, -size * 0.7, size * 0.28, size * 0.2, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(-size * 0.6, size * 0.7, size * 0.28, size * 0.2, 0, 0, TAU); c.fill();
    c.restore();
    this.dirty = true;
  }
  draw(ctx) {
    if (!this.dirty) return;
    ctx.drawImage(this.canvas, this.originX, this.originY);
    this.dirty = false;
  }
}
