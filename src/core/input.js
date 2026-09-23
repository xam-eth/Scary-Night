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
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false, moved: false, right: false, rightClick: false };
    this.move = { x: 0, y: 0 };
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, r: 54, dx: 0, dy: 0, mag: 0, pointer: false, homeX: 96, homeY: 0 };
    this.buttons = {
      attack: { x: 0, y: 0, r: 32, down: false, pulse: 0, hidden: false },
      dash: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false },
      interact: { x: 0, y: 0, r: 24, down: false, pulse: 0, hidden: false, hot: false },
      repair: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },
      barricade: { x: 0, y: 0, r: 20, down: false, pulse: 0, hidden: true },
    };
    this.touchSeen = false;
    this.gameplay = false;   // set by Game — stick must not swallow menu clicks
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

  _hitButton(p) {
    for (const k of ['attack', 'dash', 'interact', 'repair', 'barricade']) {
      if (this.buttons[k].hidden) continue;
      const b = this.buttons[k];
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.35) return k;
    }
    return null;
  }

  _releasePointerStick() {
    if (this.stick.active && this.stick.pointer) {
      this.stick.active = false;
      this.stick.pointer = false;
      this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0;
    }
    for (const k of Object.keys(this.buttons)) {
      const b = this.buttons[k];
      if (b.pointer) { b.down = false; b.pointer = false; }
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
    addEventListener('blur', () => { this.keys = Object.create(null); this._releasePointerStick(); });

    c.addEventListener('mousemove', (e) => {
      const p = this._local(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
      this.mouse.moved = true;
      if (this.stick.active && this.stick.pointer) {
        this.stick.x = p.x; this.stick.y = p.y;
      }
    });
    // A fast drag that leaves the canvas used to freeze the stick, so the
    // last vector pointed the wrong way. Follow the pointer anywhere.
    addEventListener('mousemove', (e) => {
      if (!this.stick.active || !this.stick.pointer) return;
      const p = this._local(e);
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
      const moveZone = p.x < c.clientWidth * 0.46 && p.y > c.clientHeight * 0.2;
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
        this._releasePointerStick();
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
        const b = this._hitButton(p);
        if (b) { this.buttons[b].down = true; this.buttons[b].pulse = 1; this.buttons[b].id = t.identifier; continue; }
        if (!this.stick.active && p.x < c.clientWidth * 0.5 && p.y > c.clientHeight * 0.18) {
          this.stick.active = true; this.stick.pointer = false; this.stick.id = t.identifier;
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
            if (!inside && b.down) b.down = false;
          }
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick.active && t.identifier === this.stick.id) {
          this.stick.active = false; this.stick.pointer = false;
          this.stick.dx = 0; this.stick.dy = 0; this.stick.mag = 0;
        }
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
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const m = Math.hypot(dx, dy);
      const dead = 8;
      if (m > dead) {
        const mag = clamp((m - dead) / (this.stick.r - dead), 0, 1);
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
    this.dashDown = !!k.dash || this.buttons.dash.down;
    this.dashPressed = (!!k.dash && !this.prevKeys.dash) || this.buttons.dash.pulse > 0.82;
    this.interactDown = !!k.interact || this.buttons.interact.down;
    this.interactPressed = (!!k.interact && !this.prevKeys.interact) || this.buttons.interact.pulse > 0.82;
    this.repairDown = !!k.repair || this.buttons.repair.down;
    this.barricadePressed = (!!k.barricade && !this.prevKeys.barricade) || this.buttons.barricade.pulse > 0.82;
    this.mouse.clicked = false;
    this.mouse.rightClick = false;
    Object.assign(this.prevKeys, k);
  }

  layout(w, h) {
    const pad = Math.max(14, Math.min(26, Math.round(Math.min(w, h) * 0.03)));
    const s = clamp(Math.min(w, h) / 780, 0.78, 1.08);
    const b = this.buttons;
    const right = w - pad;
    const bottom = h - pad;
    b.attack.x = right - 36 * s; b.attack.y = bottom - 44 * s; b.attack.r = 32 * s;
    b.dash.x = right - 108 * s; b.dash.y = bottom - 26 * s; b.dash.r = 26 * s;
    b.interact.x = right - 68 * s; b.interact.y = bottom - 118 * s; b.interact.r = 25 * s;
    b.repair.x = right - 156 * s; b.repair.y = bottom - 108 * s; b.repair.r = 22 * s;
    b.barricade.x = right - 156 * s; b.barricade.y = bottom - 48 * s; b.barricade.r = 22 * s;
    this.stick.r = 52 * s;
    this.stick.homeX = pad + 72 * s;
    this.stick.homeY = bottom - 64 * s;
  }
}
