/* LAST NIGHT — input
 * Unified keyboard / mouse / touch input with an on-screen virtual stick,
 * dash and action buttons for mobile. Exposes a small polled state object so the
 * gameplay code never has to care which device is in use.
 */

import { clamp } from './util.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'dash', ShiftRight: 'dash',
  KeyE: 'interact', Space: 'interact',
  KeyR: 'repair', KeyB: 'barricade',
  KeyF: 'attack',
  Escape: 'pause', Enter: 'confirm', KeyP: 'pause',
  KeyM: 'map',
  F1: 'debug',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.prevKeys = Object.create(null);
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false, moved: false };
    this.move = { x: 0, y: 0 };
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, r: 48, dx: 0, dy: 0, mag: 0 };  // v1.2: smaller joystick (was 62)
    this.buttons = {
      attack: { x: 0, y: 0, r: 32, down: false, pulse: 0, hidden: false },  // v1.2: smaller (was 42)
      dash: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false },  // v1.2: smaller (was 32)
      interact: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false },  // v1.2: smaller (was 32)
      repair: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },  // v1.2: smaller (was 28)
      barricade: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },  // v1.2: smaller (was 28)
    };
    this.touchSeen = false;
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
    addEventListener('blur', () => { this.keys = Object.create(null); });

    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
      // v1.2: mobile-first desktop — update joystick if active
      if (this.stick.active && this.mouse.down) {
        this.stick.x = this.mouse.x;
        this.stick.y = this.mouse.y;
      }
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this._fireGesture();
      this.mouse.down = true; this.mouse.clicked = true;
      if (e.button === 2) { this.mouse.right = true; return; }
      // v1.2: mobile-first desktop — activate joystick if clicking in left 62% of screen
      if (!this.stick.active && this.mouse.x < c.clientWidth * 0.62 && this.mouse.y > c.clientHeight * 0.3) {
        this.stick.active = true;
        this.stick.ox = this.mouse.x;
        this.stick.oy = this.mouse.y;
        this.stick.x = this.mouse.x;
        this.stick.y = this.mouse.y;
      }
      // v1.0 FIX (live click test): menus consumed `mouse.clicked`, but
      // input.update() clears it before handleUIInput ever runs — every real
      // mouse click on a button was silently eaten. Left-press now posts the
      // same uiTap the touch path posts, so mouse and touch share one
      // consume-once channel. Coordinates are refreshed here too, so a click
      // never reads stale mousemove values.
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      this.uiTap = { x: this.mouse.x, y: this.mouse.y };
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        // v1.2: mobile-first desktop — deactivate joystick
        if (this.stick.active) {
          this.stick.active = false;
          this.stick.dx = 0;
          this.stick.dy = 0;
          this.stick.mag = 0;
        }
      }
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- touch ----
    const area = (t) => ({ x: t.clientX - c.getBoundingClientRect().left, y: t.clientY - c.getBoundingClientRect().top });
    const hitButton = (p) => {
      for (const k of ['attack', 'dash', 'interact', 'repair', 'barricade']) {
        if (this.buttons[k].hidden) continue;
        const b = this.buttons[k];
        if (Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.35) return k;
      }
      return null;
    };
    const onStart = (e) => {
      this._fireGesture(); this.touchSeen = true;
      for (const t of e.changedTouches) {
        const p = area(t);
        this.uiTap = { x: p.x, y: p.y };
        const b = hitButton(p);
        if (b) { this.buttons[b].down = true; this.buttons[b].pulse = 1; this.buttons[b].id = t.identifier; continue; }
        if (!this.stick.active && p.x < c.clientWidth * 0.62) {
          this.stick.active = true; this.stick.id = t.identifier;
          this.stick.ox = p.x; this.stick.oy = p.y;
          this.stick.x = p.x; this.stick.y = p.y;
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        const p = area(t);
        if (this.stick.active && t.identifier === this.stick.id) { this.stick.x = p.x; this.stick.y = p.y; }
        for (const k of ['attack', 'dash', 'interact', 'repair', 'barricade']) {
          const b = this.buttons[k];
          if (b.id === t.identifier) {
            const inside = Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.35;
            if (!inside && b.down) { b.down = false; }
          }
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick.active && t.identifier === this.stick.id) { this.stick.active = false; this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0; }
        for (const k of ['attack', 'dash', 'interact', 'repair', 'barricade']) {
          const b = this.buttons[k];
          if (b.id === t.identifier) { b.down = false; b.id = -1; }
        }
      }
      e.preventDefault();
    };
    c.addEventListener('touchstart', onStart, { passive: false });
    c.addEventListener('touchmove', onMove, { passive: false });
    c.addEventListener('touchend', onEnd, { passive: false });
    c.addEventListener('touchcancel', onEnd, { passive: false });
  }

  /** Call once per frame before gameplay reads input. */
  update(dt) {
    const k = this.keys;
    let mx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (this.stick.active) {
      let dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const m = Math.hypot(dx, dy);
      const dead = 8;
      if (m > dead) {
        const mag = clamp((m - dead) / (this.stick.r - dead), 0, 1);
        this.stick.dx = dx / m; this.stick.dy = dy / m; this.stick.mag = mag;
        mx = this.stick.dx * mag; my = this.stick.dy * mag;
      } else { mx = 0; my = 0; this.stick.mag = 0; }
    } else this.stick.mag = 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    this.moving = len > 0.05;
    for (const key in this.buttons) {
      const b = this.buttons[key];
      b.pulse = Math.max(0, b.pulse - dt * 3.2);
    }
    this.attackDown = !!k.attack || this.mouse.down || this.buttons.attack.down;
    this.attackPressed = (!!k.attack && !this.prevKeys.attack) || this.mouse.clicked || this.buttons.attack.pulse > 0.82;
    this.dashDown = !!k.dash || this.buttons.dash.down;
    this.dashPressed = (!!k.dash && !this.prevKeys.dash) || this.buttons.dash.pulse > 0.82;
    this.interactDown = !!k.interact || this.buttons.interact.down;
    this.interactPressed = (!!k.interact && !this.prevKeys.interact) || this.buttons.interact.pulse > 0.82;
    this.repairDown = !!k.repair || this.buttons.repair.down;
    this.barricadePressed = (!!k.barricade && !this.prevKeys.barricade) || this.buttons.barricade.pulse > 0.82;
    this.mouse.clicked = false;
    Object.assign(this.prevKeys, k);
  }

  layout(w, h) {
    const pad = 26;
    const b = this.buttons;
    b.attack.x = w - pad - 58; b.attack.y = h - pad - 58; b.attack.r = this.touchSeen ? 56 : 44;
    b.dash.x = w - pad - 148; b.dash.y = h - pad - 44; b.dash.r = 40;
    b.interact.x = w - pad - 62; b.interact.y = h - pad - 176; b.interact.r = 40;
    b.repair.x = w - pad - 116; b.repair.y = h - pad - 160; b.repair.r = 34;
    b.barricade.x = w - pad - 180; b.barricade.y = h - pad - 128; b.barricade.r = 34;
    this.stick.r = 62;
  }
}
