/* DUSKHOLD — Survival icon set and casual-UI primitives.
 *
 * Every icon is drawn with canvas paths (no new image assets, so licensed
 * asset bytes stay untouched). The style follows the "build by day, defend
 * by night" mobile genre: chunky filled shapes, a dark outline, one bright
 * highlight, and numbers in a heavy rounded face with an outline.
 *
 * drawSurvivalIcon(ctx, name, x, y, size) draws centered at (x, y) inside a
 * size×size box. Unknown names fall back to a neutral dot so the HUD never
 * throws on a typo.
 */

export const UI_FONT = '"Trebuchet MS", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';
export const INK = '#1c1424';

export const COLORS = Object.freeze({
  keep: '#3e6bff',
  oil: '#ffb22e',
  oilDeep: '#f07a12',
  wood: '#c07a3c',
  woodEnd: '#f4c98a',
  survivor: '#4aa8ff',
  fire: '#ff7a1a',
  fireCore: '#ffd94a',
  danger: '#ff4d4d',
  good: '#45d06a',
  gold: '#ffd24a',
  night: '#3a3f8f',
  nightDeep: '#232659',
  day: '#ffb84a',
  white: '#ffffff',
  paper: '#fff6e6',
  panel: '#2a2f52',
  panelDeep: '#1b1f3a',
  muted: '#9aa2c8',
});

function begin(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  const s = Math.max(1, size / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  // Outline weight grows with the icon but is capped, so big icons keep
  // their fills instead of turning into black silhouettes.
  ctx.lineWidth = Math.min(3, Math.max(1.3, size * 0.065)) / s;
  return s;
}

function rr(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function starPath(ctx) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.95 : 0.42;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function fillStroke(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

function circle(ctx, x, y, r, fill, stroke = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

function shine(ctx, x, y, rx, ry, alpha = 0.55) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function flamePath(ctx, k = 1, oy = 0) {
  ctx.beginPath();
  ctx.moveTo(0, -0.95 * k + oy);
  ctx.bezierCurveTo(0.35 * k, -0.55 * k + oy, 0.8 * k, -0.2 * k + oy, 0.72 * k, 0.3 * k + oy);
  ctx.bezierCurveTo(0.66 * k, 0.74 * k + oy, 0.33 * k, 0.95 * k + oy, 0, 0.95 * k + oy);
  ctx.bezierCurveTo(-0.33 * k, 0.95 * k + oy, -0.68 * k, 0.74 * k + oy, -0.72 * k, 0.3 * k + oy);
  ctx.bezierCurveTo(-0.76 * k, -0.06 * k + oy, -0.52 * k, -0.32 * k + oy, -0.4 * k, -0.58 * k + oy);
  ctx.bezierCurveTo(-0.3 * k, -0.32 * k + oy, -0.2 * k, -0.22 * k + oy, -0.1 * k, -0.22 * k + oy);
  ctx.bezierCurveTo(-0.16 * k, -0.52 * k + oy, -0.1 * k, -0.76 * k + oy, 0, -0.95 * k + oy);
  ctx.closePath();
}

function zombieHead(ctx, x, y, r, skin = '#8fd16a', eye = '#1c1424') {
  circle(ctx, x, y, r, skin);
  ctx.fillStyle = eye;
  ctx.beginPath(); ctx.arc(x - r * 0.36, y - r * 0.08, r * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.36, y - r * 0.08, r * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.35, y + r * 0.45);
  ctx.lineTo(x + r * 0.35, y + r * 0.4);
  ctx.stroke();
}

const ICONS = {
  fire(ctx) {
    const g = ctx.createLinearGradient(0, -1, 0, 1);
    g.addColorStop(0, '#ffcf3d');
    g.addColorStop(0.55, '#ff8a1e');
    g.addColorStop(1, '#ec4a17');
    flamePath(ctx);
    fillStroke(ctx, g);
    ctx.save();
    ctx.lineWidth *= 0.0001;
    flamePath(ctx, 0.52, 0.36);
    ctx.fillStyle = '#ffe98a';
    ctx.fill();
    ctx.restore();
  },
  oil(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.95);
    ctx.bezierCurveTo(0.25, -0.55, 0.72, -0.12, 0.72, 0.32);
    ctx.bezierCurveTo(0.72, 0.72, 0.4, 0.95, 0, 0.95);
    ctx.bezierCurveTo(-0.4, 0.95, -0.72, 0.72, -0.72, 0.32);
    ctx.bezierCurveTo(-0.72, -0.12, -0.25, -0.55, 0, -0.95);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -1, 0, 1);
    g.addColorStop(0, '#ffd45a');
    g.addColorStop(1, '#f07a12');
    fillStroke(ctx, g);
    shine(ctx, -0.28, 0.22, 0.13, 0.28, 0.7);
  },
  wood(ctx) {
    const log = (y, x0, x1) => {
      rr(ctx, x0, y - 0.3, x1 - x0, 0.6, 0.3);
      fillStroke(ctx, '#b86f34');
      ctx.beginPath();
      ctx.ellipse(x1 - 0.12, y, 0.24, 0.3, 0, 0, Math.PI * 2);
      fillStroke(ctx, '#f4c98a');
      ctx.save();
      ctx.lineWidth *= 0.6;
      ctx.beginPath();
      ctx.ellipse(x1 - 0.12, y, 0.1, 0.13, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    log(0.42, -0.9, 0.62);
    log(-0.3, -0.62, 0.9);
  },
  survivor(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.78, 0.95);
    ctx.bezierCurveTo(-0.78, 0.25, -0.42, 0.08, 0, 0.08);
    ctx.bezierCurveTo(0.42, 0.08, 0.78, 0.25, 0.78, 0.95);
    ctx.closePath();
    fillStroke(ctx, '#4aa8ff');
    circle(ctx, 0, -0.42, 0.38, '#ffd2a6');
    ctx.beginPath();
    ctx.moveTo(-0.38, -0.5);
    ctx.bezierCurveTo(-0.34, -0.92, 0.34, -0.92, 0.38, -0.5);
    ctx.closePath();
    fillStroke(ctx, '#6b4428');
  },
  guard(ctx) {
    ICONS.survivor(ctx);
    // a crossbow across the chest: this survivor holds a door tonight
    ctx.save();
    ctx.translate(0.22, 0.5);
    ctx.rotate(-0.55);
    rr(ctx, -0.62, -0.1, 1.24, 0.2, 0.1);
    fillStroke(ctx, '#9a6232');
    ctx.beginPath();
    ctx.moveTo(0.36, -0.46);
    ctx.quadraticCurveTo(0.66, 0, 0.36, 0.46);
    ctx.stroke();
    ctx.restore();
  },
  /** The Hunter: wide-brim hat + leather coat, never confused with the blue survivors. */
  hunter(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.82, 0.95);
    ctx.bezierCurveTo(-0.82, 0.22, -0.44, 0.04, 0, 0.04);
    ctx.bezierCurveTo(0.44, 0.04, 0.82, 0.22, 0.82, 0.95);
    ctx.closePath();
    fillStroke(ctx, '#a0602f');
    // scarf
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.1); ctx.lineTo(0.42, 0.1); ctx.lineTo(0.26, 0.36); ctx.lineTo(-0.26, 0.36);
    ctx.closePath();
    fillStroke(ctx, '#ff8a2a');
    circle(ctx, 0, -0.34, 0.34, '#ffd2a6');
    // hat: brim + crown + band
    ctx.beginPath();
    ctx.ellipse(0, -0.56, 0.72, 0.17, 0, 0, Math.PI * 2);
    fillStroke(ctx, '#4a3427');
    rr(ctx, -0.38, -0.98, 0.76, 0.46, 0.14);
    fillStroke(ctx, '#5d4232');
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(-0.36, -0.66, 0.72, 0.1);
    shine(ctx, -0.18, -0.86, 0.12, 0.05, 0.5);
  },
  /** Crossbow (bolt damage). */
  /**
   * A crossbow seen from above, pointing up: the bow's arc across the top,
   * the stock down the middle (BUILD 14: tilted 35° it read as a pickaxe
   * next to the mine's).
   */
  crossbow(ctx) {
    ctx.save();
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-0.06, 0);
    rr(ctx, -0.95, -0.16, 1.66, 0.32, 0.12);
    fillStroke(ctx, '#b4733a');
    ctx.beginPath();
    ctx.moveTo(0.42, -0.86);
    ctx.quadraticCurveTo(0.92, 0, 0.42, 0.86);
    ctx.save();
    ctx.lineWidth *= 3.4;
    ctx.stroke();
    ctx.lineWidth /= 2;
    ctx.strokeStyle = '#d6dde8';
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.lineWidth *= 0.7;
    ctx.beginPath();
    ctx.moveTo(0.42, -0.86); ctx.lineTo(-0.2, 0); ctx.lineTo(0.42, 0.86);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(1.02, 0); ctx.lineTo(0.74, -0.16); ctx.lineTo(0.74, 0.16);
    ctx.closePath();
    fillStroke(ctx, '#ffd24a');
    ctx.restore();
  },
  /** Planks nailed across a door (sawmill door bonus). */
  planks(ctx) {
    rr(ctx, -0.62, -0.92, 1.24, 1.84, 0.2);
    fillStroke(ctx, '#8a5a34');
    for (const [y, a] of [[-0.36, -0.16], [0.36, 0.16]]) {
      ctx.save();
      ctx.translate(0, y);
      ctx.rotate(a);
      rr(ctx, -0.9, -0.17, 1.8, 0.34, 0.08);
      fillStroke(ctx, '#e0a05a');
      ctx.fillStyle = INK;
      for (const x of [-0.66, 0.66]) { ctx.beginPath(); ctx.arc(x, 0, 0.06, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  },
  moon(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1.2, -1.2, 2.4, 2.4);
    ctx.arc(0.42, -0.3, 0.66, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    circle(ctx, 0, 0, 0.82, '#ffe58a');
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0.42, -0.3, 0.66, Math.PI * 0.62, Math.PI * 1.47);
    ctx.stroke();
    circle(ctx, -0.32, 0.18, 0.1, '#f2c75a', false);
  },
  sun(ctx) {
    ctx.beginPath();
    const rays = 10;
    for (let i = 0; i < rays * 2; i++) {
      const a = (i / (rays * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.98 : 0.62;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(ctx, '#ffad2a');
    circle(ctx, 0, 0, 0.56, '#ffd84a');
    shine(ctx, -0.2, -0.2, 0.14, 0.2, 0.6);
  },
  skull(ctx) {
    ctx.beginPath();
    ctx.arc(0, -0.16, 0.74, Math.PI * 0.82, Math.PI * 2.18);
    ctx.lineTo(0.44, 0.78);
    ctx.lineTo(-0.44, 0.78);
    ctx.closePath();
    fillStroke(ctx, '#f6f1e6');
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(-0.3, -0.12, 0.2, 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.3, -0.12, 0.2, 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0.14); ctx.lineTo(0.1, 0.32); ctx.lineTo(-0.1, 0.32); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    for (const x of [-0.2, 0, 0.2]) { ctx.moveTo(x, 0.5); ctx.lineTo(x, 0.76); }
    ctx.stroke();
  },
  /** A fallen guard: red first-aid badge with a white cross. */
  medic(ctx) {
    circle(ctx, 0, 0, 0.86, '#ff4d4d');
    ctx.fillStyle = '#ffffff';
    rr(ctx, -0.17, -0.56, 0.34, 1.12, 0.08); ctx.fill(); ctx.stroke();
    rr(ctx, -0.56, -0.17, 1.12, 0.34, 0.08); ctx.fill(); ctx.stroke();
    // redraw the vertical bar over the stroke where the bars cross
    rr(ctx, -0.17, -0.56, 0.34, 1.12, 0.08); ctx.fill();
    shine(ctx, -0.36, -0.42, 0.16, 0.1, 0.55);
  },
  heart(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 0.88);
    ctx.bezierCurveTo(-1.25, 0.05, -0.62, -1.05, 0, -0.38);
    ctx.bezierCurveTo(0.62, -1.05, 1.25, 0.05, 0, 0.88);
    ctx.closePath();
    fillStroke(ctx, '#ff4d5e');
    shine(ctx, -0.4, -0.28, 0.14, 0.2, 0.7);
  },
  hammer(ctx) {
    ctx.save();
    ctx.rotate(-0.72);
    rr(ctx, -0.12, -0.3, 0.24, 1.25, 0.1);
    fillStroke(ctx, '#c58546');
    rr(ctx, -0.62, -0.74, 1.24, 0.46, 0.1);
    fillStroke(ctx, '#aab6c8');
    shine(ctx, -0.32, -0.6, 0.18, 0.06, 0.6);
    ctx.restore();
  },
  gate(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.78, -0.82); ctx.lineTo(0.78, -0.82); ctx.lineTo(0.78, 0);
    ctx.bezierCurveTo(0.78, 0.5, 0.32, 0.8, 0, 0.96);
    ctx.bezierCurveTo(-0.32, 0.8, -0.78, 0.5, -0.78, 0);
    ctx.closePath();
    fillStroke(ctx, '#c4823f');
    ctx.save();
    ctx.lineWidth *= 0.65;
    ctx.beginPath();
    for (const x of [-0.27, 0.27]) { ctx.moveTo(x, -0.82); ctx.lineTo(x, 0.8); }
    ctx.stroke();
    ctx.restore();
    rr(ctx, -0.82, -0.3, 1.64, 0.26, 0.06);
    fillStroke(ctx, '#9aa6ba');
  },
  extractor(ctx) {
    ctx.save();
    ctx.lineWidth *= 1.6;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(-0.55, 0.62); ctx.lineTo(0, -0.9); ctx.lineTo(0.55, 0.62);
    ctx.moveTo(-0.36, 0.08); ctx.lineTo(0.36, 0.08);
    ctx.moveTo(-0.2, -0.38); ctx.lineTo(0.2, -0.38);
    ctx.stroke();
    ctx.lineWidth /= 2.2;
    ctx.strokeStyle = '#aab6c8';
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(0.42, 0.42);
    ctx.scale(0.5, 0.5);
    ICONS.oil(ctx);
    ctx.restore();
    rr(ctx, -0.8, 0.6, 1.0, 0.24, 0.08);
    fillStroke(ctx, '#7a8396');
  },
  sawmill(ctx) {
    const teeth = 12;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.92 : 0.7;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(ctx, '#d6dde8');
    circle(ctx, 0, 0, 0.36, '#c07a3c');
    circle(ctx, 0, 0, 0.12, INK, false);
    shine(ctx, -0.36, -0.36, 0.16, 0.08, 0.7);
  },
  shelter(ctx) {
    rr(ctx, -0.62, -0.12, 1.24, 1.0, 0.08);
    fillStroke(ctx, '#ffe6bf');
    ctx.beginPath();
    ctx.moveTo(-0.92, 0); ctx.lineTo(0, -0.88); ctx.lineTo(0.92, 0);
    ctx.closePath();
    fillStroke(ctx, '#e9563c');
    rr(ctx, -0.2, 0.32, 0.4, 0.56, 0.08);
    fillStroke(ctx, '#7a4a2a');
  },
  /** Crossbow tower: a building that fights back. */
  tower(ctx) {
    ctx.save();
    ctx.lineWidth *= 2.8;
    ctx.beginPath();
    ctx.moveTo(-0.56, 0.92); ctx.lineTo(-0.42, -0.16);
    ctx.moveTo(0.56, 0.92); ctx.lineTo(0.42, -0.16);
    ctx.stroke();
    ctx.lineWidth /= 2.4;
    ctx.strokeStyle = '#c58546';
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.lineWidth *= 0.9;
    ctx.beginPath();
    ctx.moveTo(-0.5, 0.64); ctx.lineTo(0.45, 0.06);
    ctx.moveTo(0.5, 0.64); ctx.lineTo(-0.45, 0.06);
    ctx.stroke();
    ctx.restore();
    rr(ctx, -0.74, -0.3, 1.48, 0.26, 0.06);
    fillStroke(ctx, '#8a5a34');
    rr(ctx, -0.62, -0.6, 1.24, 0.32, 0.06);
    fillStroke(ctx, '#e0a05a');
    shine(ctx, -0.36, -0.5, 0.16, 0.05, 0.6);
    // the ballista on the deck, aimed up and out
    ctx.save();
    ctx.translate(0.02, -0.72);
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.moveTo(-0.1, -0.36); ctx.quadraticCurveTo(0.24, 0, -0.1, 0.36);
    ctx.save();
    ctx.lineWidth *= 2.4;
    ctx.stroke();
    ctx.lineWidth /= 2;
    ctx.strokeStyle = '#d6dde8';
    ctx.stroke();
    ctx.restore();
    rr(ctx, -0.48, -0.08, 0.98, 0.16, 0.05);
    fillStroke(ctx, '#c58546');
    ctx.beginPath();
    ctx.moveTo(0.8, 0); ctx.lineTo(0.5, -0.17); ctx.lineTo(0.5, 0.17);
    ctx.closePath();
    fillStroke(ctx, '#ff7a3a');
    ctx.restore();
  },
  up(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.92); ctx.lineTo(0.78, 0.0); ctx.lineTo(0.32, 0.0);
    ctx.lineTo(0.32, 0.86); ctx.lineTo(-0.32, 0.86); ctx.lineTo(-0.32, 0.0);
    ctx.lineTo(-0.78, 0.0);
    ctx.closePath();
    fillStroke(ctx, '#45d06a');
    shine(ctx, -0.12, -0.3, 0.08, 0.2, 0.6);
  },
  lock(ctx) {
    ctx.beginPath();
    ctx.arc(0, -0.2, 0.42, Math.PI, 0);
    ctx.lineWidth *= 2.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth /= 2.2;
    ctx.strokeStyle = '#aab6c8';
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth /= 1.1;
    rr(ctx, -0.62, -0.2, 1.24, 1.05, 0.16);
    fillStroke(ctx, '#ffc23d');
    circle(ctx, 0, 0.25, 0.13, INK, false);
  },
  check(ctx) {
    circle(ctx, 0, 0, 0.9, '#45d06a');
    ctx.save();
    ctx.lineWidth *= 2.2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.02); ctx.lineTo(-0.1, 0.34); ctx.lineTo(0.46, -0.3);
    ctx.stroke();
    ctx.restore();
  },
  clock(ctx) {
    rr(ctx, -0.18, -0.98, 0.36, 0.24, 0.06);
    fillStroke(ctx, '#aab6c8');
    circle(ctx, 0, 0.1, 0.8, '#ffffff');
    ctx.beginPath();
    ctx.moveTo(0, 0.1); ctx.lineTo(0, -0.42);
    ctx.moveTo(0, 0.1); ctx.lineTo(0.32, 0.26);
    ctx.stroke();
  },
  flare(ctx) {
    ctx.beginPath();
    const spikes = 8;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.96 : 0.42;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.5, '#ffc23d');
    g.addColorStop(1, '#ff7a1a');
    fillStroke(ctx, g);
    circle(ctx, 0, 0, 0.2, '#ffffff', false);
  },
  swarm(ctx) {
    zombieHead(ctx, -0.46, 0.22, 0.44, '#79b85a');
    zombieHead(ctx, 0.46, 0.22, 0.44, '#79b85a');
    zombieHead(ctx, 0, -0.26, 0.52, '#8fd16a');
  },
  zombie(ctx) {
    zombieHead(ctx, 0, 0, 0.82, '#8fd16a');
  },
  breaker(ctx) {
    circle(ctx, 0, 0.08, 0.86, '#6aa04f');
    ctx.beginPath();
    ctx.moveTo(-0.78, -0.2); ctx.bezierCurveTo(-0.7, -1.0, 0.7, -1.0, 0.78, -0.2);
    ctx.closePath();
    fillStroke(ctx, '#8b94a6');
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(-0.32, 0.12, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0.32, 0.12, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.12); ctx.lineTo(-0.12, 0.0);
    ctx.moveTo(0.5, -0.12); ctx.lineTo(0.12, 0.0);
    ctx.moveTo(-0.32, 0.55); ctx.lineTo(0.32, 0.55);
    ctx.stroke();
  },
  door(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.62, 0.92); ctx.lineTo(-0.62, -0.38);
    ctx.bezierCurveTo(-0.62, -1.02, 0.62, -1.02, 0.62, -0.38);
    ctx.lineTo(0.62, 0.92);
    ctx.closePath();
    fillStroke(ctx, '#c4823f');
    ctx.save();
    ctx.lineWidth *= 0.6;
    ctx.beginPath(); ctx.moveTo(0, -0.84); ctx.lineTo(0, 0.92); ctx.stroke();
    ctx.restore();
    circle(ctx, 0.36, 0.18, 0.09, '#ffd24a');
  },
  doorBroken(ctx) {
    ICONS.door(ctx);
    ctx.save();
    ctx.lineWidth *= 1.6;
    ctx.strokeStyle = '#ff3b30';
    ctx.beginPath();
    ctx.moveTo(-0.15, -0.8); ctx.lineTo(0.12, -0.25); ctx.lineTo(-0.1, 0.2); ctx.lineTo(0.18, 0.85);
    ctx.stroke();
    ctx.restore();
  },
  /** Gold coin: the purse (K1). */
  gold(ctx) {
    ctx.beginPath(); ctx.ellipse(0, 0.08, 0.82, 0.82, 0, 0, Math.PI * 2);
    fillStroke(ctx, '#e0a21a');
    ctx.beginPath(); ctx.ellipse(0, -0.04, 0.82, 0.8, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(0, -0.9, 0, 0.8);
    g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#f2b21e');
    fillStroke(ctx, g);
    ctx.save();
    ctx.lineWidth *= 0.8;
    ctx.beginPath(); ctx.ellipse(0, -0.04, 0.52, 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    rr(ctx, -0.12, -0.36, 0.24, 0.64, 0.08);
    fillStroke(ctx, '#ffd24a');
    shine(ctx, -0.36, -0.4, 0.16, 0.08, 0.8);
  },
  /** The keep: a round stone tower with its blue banner (K1's heart). */
  keep(ctx) {
    ctx.beginPath(); ctx.moveTo(0.02, -0.64); ctx.lineTo(0.02, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.02, -1); ctx.lineTo(0.62, -0.88); ctx.lineTo(0.02, -0.72); ctx.closePath();
    fillStroke(ctx, '#3e6bff');
    rr(ctx, -0.56, -0.5, 1.12, 1.42, 0.06);
    fillStroke(ctx, '#8c867e');
    for (const x of [-0.56, -0.18, 0.2]) { rr(ctx, x, -0.72, 0.3, 0.26, 0.04); fillStroke(ctx, '#8c867e'); }
    rr(ctx, -0.2, 0.42, 0.4, 0.5, 0.18);
    fillStroke(ctx, '#5e4128');
    rr(ctx, -0.12, -0.18, 0.24, 0.32, 0.06);
    fillStroke(ctx, '#ffc24a');
    shine(ctx, -0.36, -0.22, 0.08, 0.28, 0.45);
  },
  /** Gold mine: a pick over a coin. */
  mine(ctx) {
    ctx.save();
    ctx.translate(0.3, 0.34);
    ctx.scale(0.62, 0.62);
    ICONS.gold(ctx);
    ctx.restore();
    ctx.save();
    ctx.lineWidth *= 2.4;
    ctx.beginPath(); ctx.moveTo(-0.7, 0.62); ctx.lineTo(0.18, -0.36); ctx.stroke();
    ctx.lineWidth /= 2;
    ctx.strokeStyle = '#b07a3a';
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-0.46, -0.66); ctx.quadraticCurveTo(0.12, -0.92, 0.64, -0.28);
    ctx.quadraticCurveTo(0.12, -0.62, -0.38, -0.5); ctx.closePath();
    fillStroke(ctx, '#aab6c8');
  },
  /** Barracks: a garrison tent with its pennant. */
  barracks(ctx) {
    ctx.beginPath(); ctx.moveTo(0, -0.78); ctx.lineTo(0, -1.0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -1.0); ctx.lineTo(0.5, -0.9); ctx.lineTo(0, -0.8); ctx.closePath();
    fillStroke(ctx, '#3e6bff');
    ctx.beginPath(); ctx.moveTo(-0.92, 0.82); ctx.lineTo(0, -0.78); ctx.lineTo(0.92, 0.82); ctx.closePath();
    fillStroke(ctx, '#e8dcc0');
    ctx.beginPath(); ctx.moveTo(-0.26, 0.82); ctx.lineTo(0, 0.1); ctx.lineTo(0.26, 0.82); ctx.closePath();
    fillStroke(ctx, '#3e6bff');
  },
  /** The reinforcements' banner (the goal track). */
  banner(ctx) {
    ctx.save();
    ctx.lineWidth *= 1.8;
    ctx.beginPath(); ctx.moveTo(-0.62, 0.95); ctx.lineTo(-0.62, -0.95); ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-0.58, -0.86); ctx.lineTo(0.86, -0.86); ctx.lineTo(0.6, -0.36); ctx.lineTo(0.86, 0.14); ctx.lineTo(-0.58, 0.14); ctx.closePath();
    fillStroke(ctx, '#3e6bff');
    rr(ctx, -0.58, -0.42, 1.3, 0.14, 0.04);
    fillStroke(ctx, '#ffd24a');
    circle(ctx, -0.62, -0.95, 0.12, '#ffd24a');
  },
  /** "Right away" (a lightning bolt) — the third time-unit icon beside moon/sun. */
  instant(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.18, -0.95); ctx.lineTo(-0.52, 0.12); ctx.lineTo(-0.04, 0.12); ctx.lineTo(-0.2, 0.95); ctx.lineTo(0.56, -0.18); ctx.lineTo(0.06, -0.18); ctx.closePath();
    fillStroke(ctx, '#ffd24a');
  },
  perapian(ctx) {
    rr(ctx, -0.9, -0.2, 1.8, 1.1, 0.14);
    fillStroke(ctx, '#9aa0ae');
    rr(ctx, -0.55, 0.12, 1.1, 0.78, 0.4);
    fillStroke(ctx, '#2a2233');
    ctx.save();
    ctx.translate(0, 0.42);
    ctx.scale(0.5, 0.5);
    ICONS.fire(ctx);
    ctx.restore();
    rr(ctx, -1, -0.42, 2, 0.26, 0.08);
    fillStroke(ctx, '#c4823f');
  },
  radius(ctx) {
    ctx.save();
    ctx.setLineDash([0.28, 0.2]);
    ctx.beginPath(); ctx.arc(0, 0, 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    circle(ctx, 0, 0, 0.3, '#ffc23d');
    ctx.save();
    ctx.lineWidth *= 1.4;
    ctx.beginPath();
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x = Math.cos(a), y = Math.sin(a);
      ctx.moveTo(x * 0.45, y * 0.45); ctx.lineTo(x * 0.98, y * 0.98);
    }
    ctx.stroke();
    ctx.restore();
  },
  play(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.8); ctx.lineTo(0.82, 0); ctx.lineTo(-0.5, 0.8);
    ctx.closePath();
    fillStroke(ctx, '#ffffff');
  },
  restart(ctx) {
    ctx.save();
    ctx.lineWidth *= 2.6;
    ctx.beginPath(); ctx.arc(0, 0.05, 0.62, -Math.PI * 0.35, Math.PI * 1.25); ctx.stroke();
    ctx.lineWidth /= 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(0.2, -0.92); ctx.lineTo(0.86, -0.56); ctx.lineTo(0.2, -0.2);
    ctx.closePath();
    fillStroke(ctx, '#ffffff');
  },
  trophy(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.8); ctx.lineTo(0.6, -0.8); ctx.lineTo(0.5, -0.05);
    ctx.bezierCurveTo(0.42, 0.32, -0.42, 0.32, -0.5, -0.05);
    ctx.closePath();
    fillStroke(ctx, '#ffd24a');
    rr(ctx, -0.14, 0.24, 0.28, 0.38, 0.05);
    fillStroke(ctx, '#f0b62e');
    rr(ctx, -0.5, 0.6, 1.0, 0.3, 0.08);
    fillStroke(ctx, '#c4823f');
    ctx.beginPath();
    ctx.arc(-0.66, -0.42, 0.24, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(0.66, -0.42, 0.24, Math.PI * 1.5, Math.PI * 0.5);
    ctx.stroke();
    shine(ctx, -0.28, -0.5, 0.08, 0.2, 0.7);
  },
  target(ctx) {
    circle(ctx, 0, 0, 0.82, '#ff5a4d');
    circle(ctx, 0, 0, 0.5, '#ffffff');
    circle(ctx, 0, 0, 0.2, '#ff5a4d');
  },
  pause(ctx) {
    rr(ctx, -0.5, -0.66, 0.34, 1.32, 0.08);
    fillStroke(ctx, '#ffffff');
    rr(ctx, 0.16, -0.66, 0.34, 1.32, 0.08);
    fillStroke(ctx, '#ffffff');
  },
  joystick(ctx) {
    circle(ctx, 0, 0, 0.92, 'rgba(255,255,255,0.25)');
    circle(ctx, 0.22, -0.18, 0.42, '#ffffff');
    ctx.fillStyle = INK;
    for (const [x, y, a] of [[0, -0.78, 0], [0.78, 0, Math.PI / 2], [0, 0.78, Math.PI], [-0.78, 0, -Math.PI / 2]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, -0.1); ctx.lineTo(0.1, 0.06); ctx.lineTo(-0.1, 0.06); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },
  star(ctx) {
    starPath(ctx);
    fillStroke(ctx, '#ffd24a');
    // a glint on the upper arm, so a won star reads as gold, not yellow
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.moveTo(-0.08, -0.62); ctx.lineTo(0.05, -0.62); ctx.lineTo(-0.12, -0.18); ctx.lineTo(-0.24, -0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  /** A star not earned (the end panel's stars): the slot, hollow. */
  starEmpty(ctx) {
    starPath(ctx);
    fillStroke(ctx, '#d8c8a8');
  },
  plus(ctx) {
    circle(ctx, 0, 0, 0.9, '#45d06a');
    ctx.save();
    ctx.lineWidth *= 2.4;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-0.42, 0); ctx.lineTo(0.42, 0);
    ctx.moveTo(0, -0.42); ctx.lineTo(0, 0.42);
    ctx.stroke();
    ctx.restore();
  },
  warning(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.92); ctx.lineTo(0.95, 0.8); ctx.lineTo(-0.95, 0.8);
    ctx.closePath();
    fillStroke(ctx, '#ffcc33');
    ctx.fillStyle = INK;
    rr(ctx, -0.09, -0.4, 0.18, 0.7, 0.06); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0.56, 0.1, 0, Math.PI * 2); ctx.fill();
  },
  /** Drag the view: a fingertip with arrows either way. */
  pan(ctx) {
    circle(ctx, 0, 0, 0.92, 'rgba(90,120,255,0.22)');
    ctx.fillStyle = '#ffffff';
    for (const [x, a] of [[-0.62, Math.PI], [0.62, 0]]) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0.26, 0); ctx.lineTo(-0.1, -0.26); ctx.lineTo(-0.1, 0.26); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    circle(ctx, 0, 0.04, 0.32, '#ffd9b0');
  },
  arrow(ctx) {
    ctx.beginPath();
    ctx.moveTo(0.95, 0); ctx.lineTo(-0.3, -0.72); ctx.lineTo(-0.1, 0); ctx.lineTo(-0.3, 0.72);
    ctx.closePath();
    fillStroke(ctx, '#ffffff');
  },
  /** BUILD 17: back / down a rung (the end panel's easier siege): a left arrow. */
  back(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.95, 0); ctx.lineTo(0.3, -0.72); ctx.lineTo(0.1, 0); ctx.lineTo(0.3, 0.72);
    ctx.closePath();
    fillStroke(ctx, '#ffffff');
  },
  /** BUILD 17, Siege 4 RUNNERS: a flying skull with speed lines behind it. */
  runner(ctx) {
    ctx.save();
    ctx.lineWidth *= 1.6;
    ctx.strokeStyle = '#7fd0ff';
    ctx.beginPath();
    for (const [y, l] of [[-0.42, 0.5], [0, 0.7], [0.42, 0.5]]) { ctx.moveTo(-0.95, y); ctx.lineTo(-0.95 + l, y); }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(0.22, 0);
    ctx.scale(0.78, 0.78);
    ctx.beginPath();
    ctx.arc(0, -0.16, 0.74, Math.PI * 0.82, Math.PI * 2.18);
    ctx.lineTo(0.44, 0.78);
    ctx.lineTo(-0.44, 0.78);
    ctx.closePath();
    fillStroke(ctx, '#e9f6ff');
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(-0.3, -0.12, 0.2, 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.3, -0.12, 0.2, 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  /** BUILD 17, Siege 5 TWO GATES: two small gates side by side. */
  split(ctx) {
    for (const ox of [-0.45, 0.45]) {
      ctx.save();
      ctx.translate(ox, 0.06);
      ctx.scale(0.5, 0.82);
      ctx.beginPath();
      ctx.moveTo(-0.78, -0.82); ctx.lineTo(0.78, -0.82); ctx.lineTo(0.78, 0);
      ctx.bezierCurveTo(0.78, 0.5, 0.32, 0.8, 0, 0.96);
      ctx.bezierCurveTo(-0.32, 0.8, -0.78, 0.5, -0.78, 0);
      ctx.closePath();
      ctx.restore();
      fillStroke(ctx, '#c4823f');
    }
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath(); ctx.arc(0, -0.72, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },
  /** BUILD 17, Siege 6 LEAN TIMES: a coin with a red arrow down. */
  lean(ctx) {
    ctx.save();
    ctx.translate(-0.18, 0);
    ctx.scale(0.8, 0.8);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.82, 0.82, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(0, -0.9, 0, 0.8);
    g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#f2b21e');
    fillStroke(ctx, g);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(0.5, -0.2); ctx.lineTo(0.9, -0.2); ctx.lineTo(0.9, 0.3); ctx.lineTo(1.05, 0.3);
    ctx.lineTo(0.7, 0.85); ctx.lineTo(0.35, 0.3); ctx.lineTo(0.5, 0.3);
    ctx.closePath();
    fillStroke(ctx, '#ff4d4d');
  },
  /** BUILD 17, Siege 7 BLOOD MOON: the moon, red. */
  bloodMoon(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1.2, -1.2, 2.4, 2.4);
    ctx.arc(0.42, -0.3, 0.66, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
    circle(ctx, 0, 0, 0.82, '#ff5a4a');
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0.42, -0.3, 0.66, Math.PI * 0.62, Math.PI * 1.47);
    ctx.stroke();
    circle(ctx, -0.32, 0.18, 0.1, '#c22a1e', false);
  },
  /** Zoom (BUILD 12's dynamic camera): a magnifying glass with a plus. */
  zoom(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth *= 3.2;
    ctx.beginPath(); ctx.moveTo(0.3, 0.3); ctx.lineTo(0.84, 0.84); ctx.stroke();
    ctx.restore();
    circle(ctx, -0.14, -0.14, 0.62, '#d6e4ff');
    ctx.save();
    ctx.lineWidth *= 2.2;
    ctx.strokeStyle = '#2f5bff';
    ctx.beginPath();
    ctx.moveTo(-0.44, -0.14); ctx.lineTo(0.16, -0.14);
    ctx.moveTo(-0.14, -0.44); ctx.lineTo(-0.14, 0.16);
    ctx.stroke();
    ctx.restore();
  },
};

export function hasSurvivalIcon(name) { return Object.prototype.hasOwnProperty.call(ICONS, name); }

/** Draw one icon centered at (x, y) inside a size×size box. */
export function drawSurvivalIcon(ctx, name, x, y, size = 24, opts = {}) {
  const draw = ICONS[name];
  begin(ctx, x, y, size);
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  if (opts.rotate) ctx.rotate(opts.rotate);
  if (opts.gray) ctx.filter = 'grayscale(1) brightness(0.8)';
  if (draw) draw(ctx);
  else circle(ctx, 0, 0, 0.6, '#cccccc');
  ctx.restore();
}

/** Heavy outlined label, the genre's number/text style. */
export function drawLabel(ctx, value, x, y, size, color = '#ffffff', opts = {}) {
  ctx.save();
  ctx.font = `${opts.weight || 800} ${size}px ${UI_FONT}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  const outline = opts.outline == null ? Math.max(2, size * 0.2) : opts.outline;
  if (outline > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = opts.stroke || INK;
    ctx.strokeText(String(value), x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(String(value), x, y);
  ctx.restore();
}

export function measureLabel(ctx, value, size, weight = 800) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${UI_FONT}`;
  const width = ctx.measureText(String(value)).width;
  ctx.restore();
  return width;
}

export function roundRectPath(ctx, x, y, w, h, r) { rr(ctx, x, y, w, h, r); }

/** A chunky casual panel: gradient body, dark outline, top highlight. */
export function drawPanel(ctx, x, y, w, h, opts = {}) {
  const r = opts.radius == null ? 16 : opts.radius;
  const top = opts.top || COLORS.panel;
  const bottom = opts.bottom || COLORS.panelDeep;
  ctx.save();
  if (opts.shadow !== false) {
    rr(ctx, x, y + 4, w, h, r);
    ctx.fillStyle = 'rgba(10,8,20,0.45)';
    ctx.fill();
  }
  rr(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.globalAlpha *= opts.alpha == null ? 1 : opts.alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = opts.lineWidth || 2.5;
  ctx.strokeStyle = opts.stroke || INK;
  ctx.stroke();
  if (opts.highlight !== false && h > 18) {
    rr(ctx, x + 3, y + 3, w - 6, Math.min(h * 0.42, 22), Math.max(2, r - 3));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
  }
  ctx.restore();
}

/** Pill-shaped resource counter: icon disc on the left, number on the right. */
export function drawCounter(ctx, x, y, w, h, icon, value, opts = {}) {
  ctx.save();
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = opts.fill || 'rgba(20,18,40,0.78)';
  ctx.fill();
  ctx.lineWidth = opts.glow ? 3 : 2;
  ctx.strokeStyle = opts.flash ? '#ff4d4d' : opts.glow ? '#ffd24a' : INK;
  if (opts.glow) { ctx.shadowColor = 'rgba(255,210,74,0.9)'; ctx.shadowBlur = 10; }
  ctx.stroke();
  ctx.restore();
  drawSurvivalIcon(ctx, icon, x + h * 0.5, y + h / 2, h * 1.05 * (opts.glow ? 1.12 : 1));
  drawLabel(ctx, value, x + h + (w - h) / 2 - 2, y + h / 2 + 1, Math.round(h * 0.56), opts.color || '#ffffff');
}

/** Horizontal fill bar with an outline. */
export function drawBar(ctx, x, y, w, h, pct, color, opts = {}) {
  const p = Math.max(0, Math.min(1, pct));
  ctx.save();
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = opts.back || 'rgba(16,12,28,0.82)';
  ctx.fill();
  if (p > 0) {
    rr(ctx, x + 1.5, y + 1.5, Math.max(h - 3, (w - 3) * p), h - 3, (h - 3) / 2);
    ctx.fillStyle = color;
    ctx.fill();
    rr(ctx, x + 2.5, y + 2, Math.max(0, (w - 5) * p), Math.max(1, (h - 4) * 0.4), (h - 4) / 4);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
  }
  rr(ctx, x, y, w, h, h / 2);
  ctx.lineWidth = opts.lineWidth || 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}
