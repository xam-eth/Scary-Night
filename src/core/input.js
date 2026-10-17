/* LAST NIGHT — input
 * Unified keyboard / mouse / touch input with an on-screen virtual stick,
 * dash and action buttons. The stick is screen-space: up on the stick is up
 * on the screen. Gameplay converts that into world movement so the oblique
 * camera does not skew the heading.
 */

import { clamp } from './util.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  ControlLeft: 'dash', ControlRight: 'dash', KeyX: 'dash',
  KeyE: 'interact', Space: 'interact',
  KeyR: 'repair', KeyB: 'barricade',
  KeyF: 'attack', KeyQ: 'weapon',
  Escape: 'pause', Enter: 'confirm', KeyP: 'pause',
  KeyM: 'map',
  F1: 'debug',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.prevKeys = Object.create(null);
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false, moved: false, right: false, rightClick: false };
    this.move = { x: 0, y: 0 };
    this.runToggled = false;
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, r: 54, dx: 0, dy: 0, mag: 0, pointer: false, homeX: 96, homeY: 0 };
    this.buttons = {
      attack: { x: 0, y: 0, r: 32, down: false, pulse: 0, hidden: false },
      run: { x: 0, y: 0, r: 22, hitR: 22, down: false, toggled: false, id: -1, pulse: 0, hidden: false },
      dash: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false },
      interact: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false, hot: false },
      repair: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },
      barricade: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },
    };
    this.touchSeen = false;
    this.gameplay = false;   // set by Game — stick must not swallow menu clicks
    this.stickBlock = null;  // (p) => true over a HUD button: a tap there never grabs the stick
    // Survival: a floating stick that starts wherever the thumb lands (except
    // the top HUD band and the buttons). Legacy keeps its left-half zone.
    this.stickAnywhere = false;
    this.stickTopBand = 128;
    // Survival's camera (2026-10-17: "camera ... bisa di geser"): the stick
    // takes the left half of the screen, a drag on the free right half slides
    // the view, two fingers there pinch it, the mouse wheel zooms it.
    this.panEnabled = false;
    this.panSplit = 0.5;
    this.pan = { active: false, id: -1, pointer: false, x: 0, y: 0, ox: 0, oy: 0, dx: 0, dy: 0, travel: 0, t0: 0 };
    this.pinch = { active: false, a: -1, b: -1, d: 0, k: 1 };
    this.touchPoints = new Map();
    this.wheelZoom = 1;
    this.panDelta = { x: 0, y: 0 };
    this.zoomDelta = 1;
    this.panTap = null;
    this.panBlock = null;    // (p) => true over any HUD item, a world chip included
    this.firstGesture = [];
    this.anyInput = false;
    this.debug = false;
    this.uiTap = null;
    this._bind();
  }

  onFirstGesture(fn) { this.firstGesture.push(fn); }

  _fireGesture() {
    if (!this.firstGesture.length) return;
    const fns = this.firstGesture; this.firstGesture = [];
    fns.forEach((f) => { try { f(); } catch (e) { } });
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _buttonHitRadius(b) { return b.hitR || b.r * 1.35; }

  _insideButton(b, p) {
    return Math.hypot(p.x - b.x, p.y - b.y) < this._buttonHitRadius(b);
  }

  /** Where a drag may start the stick. */
  _stickZone(p, c, xFrac, yFrac) {
    if (this.stickAnywhere) {
      const below = p.y > Math.min(this.stickTopBand, c.clientHeight * 0.3);
      // with the camera drag on, the stick keeps the left half to itself
      return below && (!this.panEnabled || p.x < c.clientWidth * this.panSplit);
    }
    return p.x < c.clientWidth * xFrac && p.y > c.clientHeight * yFrac;
  }

  /** Where a drag may slide the camera (Survival): the right half, below the HUD band. */
  _panZone(p, c) {
    return this.panEnabled && p.x >= c.clientWidth * this.panSplit && p.y > Math.min(this.stickTopBand, c.clientHeight * 0.3) * 0.6;
  }

  _startPan(p, id, pointer) {
    const pan = this.pan;
    pan.active = true; pan.id = id; pan.pointer = pointer;
    pan.x = pan.ox = p.x; pan.y = pan.oy = p.y;
    pan.travel = 0;
    pan.t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  _movePan(p) {
    const pan = this.pan;
    pan.dx += p.x - pan.x; pan.dy += p.y - pan.y;
    pan.travel += Math.hypot(p.x - pan.x, p.y - pan.y);
    pan.x = p.x; pan.y = p.y;
  }

  /** A pan that ends without travelling is a tap on the free ground. */
  _endPan(p) {
    const pan = this.pan;
    if (!pan.active) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (pan.travel < 10 && now - pan.t0 < 320) this.panTap = { x: p ? p.x : pan.x, y: p ? p.y : pan.y };
    pan.active = false; pan.id = -1; pan.pointer = false;
  }

  _hitButton(p) {
    for (const k of ['attack', 'run', 'dash', 'interact', 'repair', 'barricade']) {
      if (this.buttons[k].hidden) continue;
      if (this._insideButton(this.buttons[k], p)) return k;
    }
    return null;
  }

  toggleRun() {
    this.runToggled = !this.runToggled;
    this.buttons.run.toggled = this.runToggled;
    this.buttons.run.pulse = 1;
    return this.runToggled;
  }

  _releasePointerStick(p = null, commit = false) {
    if (this.stick.active && this.stick.pointer) {
      this.stick.active = false;
      this.stick.pointer = false;
      this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0;
    }
    for (const k of Object.keys(this.buttons)) {
      const b = this.buttons[k];
      if (b.pointer) {
        if (commit && k === 'run' && b.down && p && this._insideButton(b, p)) this.toggleRun();
        b.down = false; b.pointer = false;
      }
    }
  }

  _bind() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (KEYMAP[e.code]) {
        if (!this.keys[KEYMAP[e.code]]) this._fireGesture();
        this.keys[KEYMAP[e.code]] = true;
        if (['up', 'down', 'left', 'right', 'interact', 'dash', 'attack'].includes(KEYMAP[e.code])) e.preventDefault();
      }
      if (e.code === 'F1') e.preventDefault();
      this.anyInput = true;
    }, { passive: false });
    addEventListener('keyup', (e) => { if (KEYMAP[e.code]) this.keys[KEYMAP[e.code]] = false; });
    addEventListener('blur', () => {
      this.keys = Object.create(null); this._releasePointerStick();
      this.pan.active = false; this.pinch.active = false; this.touchPoints.clear();
    });

    c.addEventListener('mousemove', (e) => {
      const p = this._local(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
      this.mouse.moved = true;
      // the button came up outside the frame (an embedded preview): the
      // mouseup never reached us, so the stick would steer on by itself
      if (this.stick.active && this.stick.pointer && e.buttons === 0) this._releasePointerStick(p, false);
      if (this.pan.active && this.pan.pointer && e.buttons === 0) this.pan.active = false;
      if (this.stick.active && this.stick.pointer) {
        this.stick.x = p.x; this.stick.y = p.y;
      }
    });
    addEventListener('mousemove', (e) => {
      if (!this.pan.active || !this.pan.pointer) return;
      this._movePan(this._local(e));
    });
    c.addEventListener('wheel', (e) => {
      if (!this.panEnabled || !this.gameplay) return;
      // one notch (~100) zooms ~10%; trackpads send many small deltas
      this.wheelZoom *= Math.exp(-clamp(e.deltaY, -240, 240) * 0.001);
      e.preventDefault();
    }, { passive: false });
    // A fast drag that leaves the canvas used to freeze the stick, so the
    // last vector pointed the wrong way. Follow the pointer anywhere.
    addEventListener('mousemove', (e) => {
      if (!this.stick.active || !this.stick.pointer) return;
      const p = this._local(e);
      if (e.buttons === 0) { this._releasePointerStick(p, false); return; }
      this.stick.x = p.x; this.stick.y = p.y;
      this.mouse.x = p.x; this.mouse.y = p.y;
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this._fireGesture();
      // Position FIRST. Arming the stick from the previous mousemove made the
      // first drag point at wherever the cursor had been, not the click.
      const p = this._local(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
      this.uiTap = { x: p.x, y: p.y };
      if (e.button === 2) {
        this.mouse.right = true;
        this.mouse.rightClick = true;
        return;
      }
      const btn = this._hitButton(p);
      if (btn && this.gameplay) {
        this.buttons[btn].down = true;
        this.buttons[btn].pulse = 1;
        this.buttons[btn].pointer = true;
        this.mouse.down = false;
        this.mouse.clicked = false;
        return;
      }
      // Left thumb zone moves. The right half aims and claws, so a drag never
      // swings and a keyboard player can still point with the mouse.
      const blocked = !!(this.stickBlock && this.stickBlock(p));
      const panBlocked = blocked || !!(this.panBlock && this.panBlock(p));
      if (this.gameplay && !panBlocked && this._panZone(p, c) && !this.pan.active) {
        // the right half drags the camera (a short click still taps the ground)
        this._startPan(p, -1, true);
        this.mouse.down = false;
        this.mouse.clicked = false;
        return;
      }
      const moveZone = this._stickZone(p, c, 0.46, 0.2) && !blocked;
      if (this.gameplay && moveZone && !this.stick.active) {
        this.stick.active = true;
        this.stick.pointer = true;
        this.stick.id = -1;
        this.stick.ox = p.x; this.stick.oy = p.y;
        this.stick.x = p.x; this.stick.y = p.y;
        this.mouse.down = false;
        this.mouse.clicked = false;
        return;
      }
      this.mouse.down = true;
      this.mouse.clicked = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        this._releasePointerStick(this._local(e), true);
        if (this.pan.active && this.pan.pointer) this._endPan(this._local(e));
      }
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch ----
    const area = (t) => ({ x: t.clientX - c.getBoundingClientRect().left, y: t.clientY - c.getBoundingClientRect().top });
    const onStart = (e) => {
      this._fireGesture(); this.touchSeen = true;
      for (const t of e.changedTouches) {
        const p = area(t);
        this.uiTap = { x: p.x, y: p.y };
        if (!this.gameplay) continue;
        const b = this._hitButton(p);
        if (b) { this.buttons[b].down = true; this.buttons[b].pulse = 1; this.buttons[b].id = t.identifier; continue; }
        const blocked = !!(this.stickBlock && this.stickBlock(p));
        if (!this.stick.active && this._stickZone(p, c, 0.5, 0.18) && !blocked) {
          this.stick.active = true; this.stick.pointer = false; this.stick.id = t.identifier;
          this.stick.ox = p.x; this.stick.oy = p.y;
          this.stick.x = p.x; this.stick.y = p.y;
          continue;
        }
        if (blocked || (this.panBlock && this.panBlock(p)) || !this._panZone(p, c)) continue;
        this.touchPoints.set(t.identifier, { x: p.x, y: p.y });
        if (!this.pan.active && !this.pinch.active) this._startPan(p, t.identifier, false);
        else if (this.pan.active && !this.pinch.active && this.touchPoints.has(this.pan.id)) {
          // a second finger on the free half: pinch to zoom
          const a = this.touchPoints.get(this.pan.id);
          this.pinch.active = true; this.pinch.a = this.pan.id; this.pinch.b = t.identifier;
          this.pinch.d = Math.max(12, Math.hypot(p.x - a.x, p.y - a.y));
          this.pan.travel = 99;   // a pinch is never a tap
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        const p = area(t);
        if (this.stick.active && t.identifier === this.stick.id) { this.stick.x = p.x; this.stick.y = p.y; }
        if (this.touchPoints.has(t.identifier)) {
          this.touchPoints.set(t.identifier, { x: p.x, y: p.y });
          if (this.pinch.active && (t.identifier === this.pinch.a || t.identifier === this.pinch.b)) {
            const a = this.touchPoints.get(this.pinch.a), b2 = this.touchPoints.get(this.pinch.b);
            if (a && b2) {
              const d = Math.max(12, Math.hypot(a.x - b2.x, a.y - b2.y));
              this.pinch.k *= d / this.pinch.d;
              this.pinch.d = d;
            }
          } else if (this.pan.active && t.identifier === this.pan.id) this._movePan(p);
        }
        for (const k of ['attack', 'run', 'dash', 'interact', 'repair', 'barricade']) {
          const b = this.buttons[k];
          if (b.id === t.identifier) {
            const inside = this._insideButton(b, p);
            if (!inside && b.down) b.down = false;
          }
        }
      }
      e.preventDefault();
    };
    const onEnd = (e, commit = true) => {
      for (const t of e.changedTouches) {
        const p = area(t);
        if (this.stick.active && t.identifier === this.stick.id) {
          this.stick.active = false; this.stick.pointer = false;
          this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0;
        }
        if (this.touchPoints.has(t.identifier)) {
          this.touchPoints.delete(t.identifier);
          if (this.pinch.active && (t.identifier === this.pinch.a || t.identifier === this.pinch.b)) {
            // the finger left on the glass goes on panning from where it is
            this.pinch.active = false;
            const rest = t.identifier === this.pinch.a ? this.pinch.b : this.pinch.a;
            const q = this.touchPoints.get(rest);
            if (q) { this._startPan(q, rest, false); this.pan.travel = 99; } else this.pan.active = false;
          } else if (this.pan.active && t.identifier === this.pan.id) this._endPan(commit ? p : null);
        }
        for (const k of ['attack', 'run', 'dash', 'interact', 'repair', 'barricade']) {
          const b = this.buttons[k];
          if (b.id === t.identifier) {
            if (k === 'run' && commit && b.down && this._insideButton(b, p)) this.toggleRun();
            b.down = false; b.id = -1;
          }
        }
      }
      e.preventDefault();
    };
    c.addEventListener('touchstart', onStart, { passive: false });
    c.addEventListener('touchmove', onMove, { passive: false });
    c.addEventListener('touchend', (e) => onEnd(e, true), { passive: false });
    c.addEventListener('touchcancel', (e) => onEnd(e, false), { passive: false });
  }

  /** Call once per frame before gameplay reads input. */
  update(dt) {
    const k = this.keys;
    let mx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const m = Math.hypot(dx, dy);
      // Small hardware/touch jitter is ignored; the softer response curve
      // keeps a short thumb drag useful instead of reserving most travel for
      // the outer edge of the virtual stick.
      const dead = Math.min(5, this.stick.r * 0.1);
      if (m > dead) {
        const raw = clamp((m - dead) / Math.max(1, this.stick.r - dead), 0, 1);
        const mag = Math.pow(raw, 0.88);
        this.stick.dx = dx / m; this.stick.dy = dy / m; this.stick.mag = mag;
        mx = this.stick.dx * mag; my = this.stick.dy * mag;
      } else { mx = 0; my = 0; this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0; }
    } else this.stick.mag = 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    this.moving = len > 0.05;
    for (const key in this.buttons) {
      const b = this.buttons[key];
      b.pulse = Math.max(0, b.pulse - dt * 3.2);
    }
    // Left-zone drags are movement. Claw is F, the CLAW button, a right-half
    // click, or right-click — never the finger that is steering.
    this.attackDown = !!k.attack || this.buttons.attack.down || !!this.mouse.right || (this.mouse.down && !this.stick.active);
    this.attackPressed = (!!k.attack && !this.prevKeys.attack) || this.buttons.attack.pulse > 0.82 || this.mouse.clicked || !!this.mouse.rightClick;
    this.runDown = !!k.run || this.runToggled;
    this.dashDown = !!k.dash || this.buttons.dash.down;
    this.dashPressed = (!!k.dash && !this.prevKeys.dash) || this.buttons.dash.pulse > 0.82;
    this.interactDown = !!k.interact || this.buttons.interact.down;
    this.interactPressed = (!!k.interact && !this.prevKeys.interact) || this.buttons.interact.pulse > 0.82;
    this.repairDown = !!k.repair || this.buttons.repair.down;
    this.barricadePressed = (!!k.barricade && !this.prevKeys.barricade) || this.buttons.barricade.pulse > 0.82;
    this.mouse.clicked = false;
    this.mouse.rightClick = false;
    // the camera's share of this frame: a drag in screen px, a zoom factor
    this.panDelta.x = this.pan.dx; this.panDelta.y = this.pan.dy;
    this.pan.dx = 0; this.pan.dy = 0;
    this.zoomDelta = this.pinch.k * this.wheelZoom;
    this.pinch.k = 1; this.wheelZoom = 1;
    if (!this.gameplay) { this.pan.active = false; this.pinch.active = false; this.touchPoints.clear(); }
    Object.assign(this.prevKeys, k);
  }

  /** The tap on free ground since the last call (null if none). */
  takePanTap() {
    const tap = this.panTap;
    this.panTap = null;
    return tap;
  }

  /**
   * Survival controls: one floating stick and one big Flare button in the
   * thumb corner. The hit circle IS the drawn circle (+4px of forgiveness),
   * so a tap on the visible edge always fires.
   */
  layoutSurvival(w, h) {
    const phone = w < 840 || h < 500;
    const short = h < 500;
    const b = this.buttons;
    const pad = phone ? 14 : Math.max(16, Math.min(28, Math.round(Math.min(w, h) * 0.03)));
    const fr = phone ? (short ? 36 : 40) : 44;
    const bottomGap = phone && !short ? 22 : 10;
    b.interact.r = fr;
    b.interact.x = w - pad - fr;
    b.interact.y = h - pad - bottomGap - fr;
    b.interact.hitR = fr + 4;
    b.attack.r = 0; b.attack.hitR = 0;
    b.attack.x = -999; b.attack.y = -999;
    for (const key of ['run', 'dash', 'repair', 'barricade']) {
      b[key].x = -999; b[key].y = -999; b[key].hitR = 0;
    }
    const stickR = short ? 46 : 56;
    this.stick.r = stickR;
    this.stick.homeX = pad + stickR + 8;
    this.stick.homeY = h - pad - bottomGap - stickR;
    this.clusterLeft = b.interact.x - fr - 8;
  }

  layout(w, h) {
    const phone = w < 840 || h < 500;
    const b = this.buttons;
    if (phone) {
      // Thumb zone, two columns. CLAW stays in the corner the thumb already rests on.
      // BOARD steps left only when it will not land on the stick.
      const short = h < 500;
      const pad = 12;
      const gap = short ? 10 : 8;
      const ar = short ? 26 : 30;
      const sr = 22;
      const runR = short ? 16 : 18;
      const right = w - pad;
      const bottom = h - pad;
      b.attack.r = ar;
      b.attack.x = right - ar;
      b.attack.y = bottom - ar;
      b.dash.r = sr;
      b.dash.x = b.attack.x - ar - sr - gap;
      b.dash.y = bottom - sr;
      b.interact.r = sr;
      b.interact.x = b.attack.x;
      b.interact.y = b.attack.y - ar - sr - gap;
      b.repair.r = sr;
      b.repair.x = b.dash.x;
      b.repair.y = b.interact.y;
      b.barricade.r = sr;
      b.run.r = runR;
      b.run.hitR = 22;
      const boardX = b.dash.x - sr - sr - gap;
      const stickR = short ? 42 : 54;
      const stickRight = pad + stickR * 2 + 16;
      if (boardX - sr > stickRight) {
        b.barricade.x = boardX;
        b.barricade.y = bottom - sr;
        b.run.x = boardX;
        b.run.y = b.repair.y + 8;
      } else {
        b.barricade.x = b.dash.x;
        b.barricade.y = b.repair.y - sr - sr - gap;
        b.run.x = b.dash.x;
        b.run.y = b.barricade.y - sr - sr - gap;
      }
      this.stick.r = stickR;
      this.stick.homeX = pad + stickR + 6;
      this.stick.homeY = bottom - stickR;
    } else {
      const pad = Math.max(14, Math.min(26, Math.round(Math.min(w, h) * 0.03)));
      const s = clamp(Math.min(w, h) / 780, 0.78, 1.08);
      const right = w - pad;
      const bottom = h - pad;
      b.attack.x = right - 36 * s; b.attack.y = bottom - 44 * s; b.attack.r = 32 * s;
      b.dash.x = right - 108 * s; b.dash.y = bottom - 26 * s; b.dash.r = 26 * s;
      b.interact.x = right - 68 * s; b.interact.y = bottom - 118 * s; b.interact.r = 25 * s;
      b.repair.x = right - 156 * s; b.repair.y = bottom - 108 * s; b.repair.r = 22 * s;
      b.barricade.x = right - 156 * s; b.barricade.y = bottom - 48 * s; b.barricade.r = 22 * s;
      b.run.x = right - 204 * s; b.run.y = bottom - 26 * s; b.run.r = 18 * s; b.run.hitR = 22;
      this.stick.r = 52 * s;
      this.stick.homeX = pad + 72 * s;
      this.stick.homeY = bottom - 64 * s;
    }
    // Hit areas are explicit and non-overlapping. Phone controls keep at
    // least 44px touch targets without extending every small action into its
    // neighbours; desktop/mouse hit areas follow the visible circles.
    b.attack.hitR = phone ? Math.max(34, b.attack.r) : b.attack.r;
    for (const key of ['dash', 'interact', 'repair', 'barricade']) {
      b[key].hitR = phone ? 22 : b[key].r;
    }
    b.run.hitR = Math.max(22, b.run.r);

    this.clusterLeft = Math.min(
      b.attack.x - b.attack.r,
      b.run.x - b.run.r,
      b.dash.x - b.dash.r,
      b.interact.x - b.interact.r,
      b.repair.x - b.repair.r,
      b.barricade.x - b.barricade.r,
    ) - 8;
  }
}
