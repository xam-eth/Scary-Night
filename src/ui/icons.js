/* Shared vector iconography for the HUD and screen buttons.
 * Drawn directly into the game's canvas so icons stay crisp at every DPR and
 * need no separately loaded image assets. Coordinates use a 24px design grid.
 */

const GAME_ICONS = new Set([
  'claw', 'sword', 'shot', 'move', 'dash', 'interact', 'doorOpen', 'doorClosed',
  'blood', 'repair', 'barricade', 'lamp', 'play', 'restart', 'upgrade', 'book',
  'shield', 'settings', 'back', 'exit', 'confirm', 'next', 'bag', 'mission',
  'profile', 'arrow', 'knife', 'bandage', 'plank', 'shard', 'relic', 'run',
  'close', 'more', 'plus', 'shop', 'help', 'pause',
]);

export function buttonIconForLabel(label) {
  const value = String(label || '').trim().toUpperCase();
  if (!value) return null;
  // Numeric prices and currency choices are data, not action labels; keep
  // their visible amount even when a later word happens to match an icon.
  if (/^(?:[◆✦]\s*)?\d/.test(value) || /^(?:[◆✦]\s*)(?:SHARDS|RELIC)$/.test(value)) return null;
  if (/^(PLAY|CONTINUE|RESUME|ANOTHER NIGHT|WALK INTO THE DAWN|THE OPENING|THE REFUGE)$/.test(value)) return 'play';
  if (/TRY AGAIN|RESTART/.test(value)) return 'restart';
  if (/UPGRADE/.test(value)) return 'upgrade';
  if (/BLOOD|DRINK|SHARD|MARKET/.test(value)) return 'blood';
  if (/COLLECTION|CODEX|HOW TO SURVIVE|FULL POLICY/.test(value)) return 'book';
  if (/PRIVACY|POLICY|DELETE/.test(value)) return 'shield';
  if (/SETTING/.test(value)) return 'settings';
  if (/BACK|TURN BACK/.test(value)) return 'back';
  if (/LEAVE|MAIN MENU/.test(value)) return 'exit';
  if (/STAY|I UNDERSTAND|CONFIRM/.test(value)) return 'confirm';
  if (/SKIP|NEXT/.test(value)) return 'next';
  return null;
}

/** Draw one clean, high-contrast icon centred at (x,y). */
export function drawGameIcon(ctx, name, x, y, size = 24, color = '#eee6d6') {
  if (!ctx || !name) return false;
  if (!GAME_ICONS.has(name)) return false;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (name) {
    case 'claw':
      for (let i = 0; i < 3; i++) {
        const shift = (i - 1) * 5;
        ctx.beginPath();
        ctx.moveTo(-5 + shift, 8);
        ctx.bezierCurveTo(-4 + shift, 3, -2 + shift, -3, 2 + shift, -9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(2 + shift, -9);
        ctx.lineTo(1 + shift, -5);
        ctx.stroke();
      }
      break;
    case 'sword':
      ctx.beginPath();
      ctx.moveTo(-5, 8); ctx.lineTo(6, -4); ctx.lineTo(10, -10); ctx.lineTo(8, -2); ctx.lineTo(-4, 10);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-2, 10); ctx.moveTo(-9, 9); ctx.lineTo(-5, 13);
      ctx.stroke();
      break;
    case 'shot':
      ctx.beginPath(); ctx.moveTo(-7, -10); ctx.quadraticCurveTo(3, 0, -7, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(-6, 9); ctx.moveTo(-8, 0); ctx.lineTo(9, 0);
      ctx.lineTo(5, -3); ctx.moveTo(9, 0); ctx.lineTo(5, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-3, -3); ctx.moveTo(-7, 5); ctx.lineTo(-3, 3); ctx.stroke();
      break;
    case 'move':
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        ctx.beginPath();
        ctx.moveTo(dx * 7, dy * 7); ctx.lineTo(dx * 10, dy * 10);
        ctx.moveTo(dx * 10, dy * 10);
        ctx.lineTo(dx * 10 - dy * 2, dy * 10 + dx * 2);
        ctx.moveTo(dx * 10, dy * 10);
        ctx.lineTo(dx * 10 + dy * 2, dy * 10 - dx * 2);
        ctx.stroke();
      }
      break;
    case 'dash':
      ctx.beginPath();
      ctx.moveTo(2, -11); ctx.lineTo(-7, 1); ctx.lineTo(-1, 1); ctx.lineTo(-4, 11);
      ctx.lineTo(8, -3); ctx.lineTo(2, -3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11, -6); ctx.lineTo(-8, -6); ctx.moveTo(-12, 0); ctx.lineTo(-9, 0); ctx.moveTo(-10, 6); ctx.lineTo(-7, 6); ctx.stroke();
      break;
    case 'interact':
      ctx.beginPath(); ctx.arc(0, 0, 7.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -8); ctx.lineTo(10, -11); ctx.moveTo(8, -3); ctx.lineTo(12, -3); ctx.moveTo(5, -11); ctx.lineTo(5, -14); ctx.stroke();
      break;
    case 'doorOpen':
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-8, -10); ctx.lineTo(4, -10); ctx.lineTo(4, 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(6, 5); ctx.lineTo(6, -9); ctx.lineTo(-3, -7); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(2.5, -1, 0.8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'doorClosed':
      ctx.beginPath(); ctx.rect(-8, -10, 16, 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -7); ctx.lineTo(-4, 7); ctx.moveTo(1, -7); ctx.lineTo(1, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(5, 0, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    case 'blood':
      ctx.beginPath();
      ctx.moveTo(0, -11); ctx.bezierCurveTo(-2, -7, -8, -1, -8, 3);
      ctx.bezierCurveTo(-8, 8, -4.5, 11, 0, 11);
      ctx.bezierCurveTo(4.5, 11, 8, 8, 8, 3);
      ctx.bezierCurveTo(8, -1, 2, -7, 0, -11); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 5); ctx.quadraticCurveTo(-2, 8, 1, 8); ctx.stroke();
      break;
    case 'repair':
      ctx.beginPath(); ctx.moveTo(-7, 10); ctx.lineTo(3, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-6, -10); ctx.lineTo(-1, -7); ctx.lineTo(2, -4); ctx.lineTo(-3, 1); ctx.lineTo(-6, -2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(6, 4); ctx.moveTo(4, -2); ctx.lineTo(8, 2); ctx.stroke();
      break;
    case 'barricade':
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(9, -6); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.moveTo(-9, 6); ctx.lineTo(9, 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-5, -4); ctx.moveTo(5, -2); ctx.lineTo(5, 2); ctx.moveTo(-2, 4); ctx.lineTo(-2, 8); ctx.stroke();
      break;
    case 'lamp':
      ctx.beginPath(); ctx.moveTo(-4, -9); ctx.quadraticCurveTo(-8, -2, -5, 2); ctx.lineTo(5, 2); ctx.quadraticCurveTo(8, -2, 4, -9); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(4, 5); ctx.moveTo(-3, 8); ctx.lineTo(3, 8); ctx.moveTo(0, -13); ctx.lineTo(0, -11); ctx.moveTo(-10, -5); ctx.lineTo(-8, -4); ctx.moveTo(10, -5); ctx.lineTo(8, -4); ctx.stroke();
      break;
    case 'play':
      ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(9, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.stroke();
      break;
    case 'restart':
      ctx.beginPath(); ctx.arc(0, 0, 7, -Math.PI * 0.22, Math.PI * 1.48); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(-8, -1); ctx.lineTo(-2, -2); ctx.stroke();
      break;
    case 'upgrade':
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(2.6, -3.8); ctx.lineTo(10, -3.2); ctx.lineTo(4.4, 1.5); ctx.lineTo(6.2, 9); ctx.lineTo(0, 5); ctx.lineTo(-6.2, 9); ctx.lineTo(-4.4, 1.5); ctx.lineTo(-10, -3.2); ctx.lineTo(-2.6, -3.8); ctx.closePath(); ctx.stroke();
      break;
    case 'book':
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(-7, -11, -10, -8); ctx.lineTo(-10, 8); ctx.quadraticCurveTo(-5, 6, 0, 10); ctx.quadraticCurveTo(5, 6, 10, 8); ctx.lineTo(10, -8); ctx.quadraticCurveTo(5, -11, 0, -8); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 10); ctx.moveTo(-7, -4); ctx.lineTo(-3, -3); ctx.moveTo(3, -3); ctx.lineTo(7, -4); ctx.stroke();
      break;
    case 'shield':
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, -7); ctx.lineTo(7, 2); ctx.quadraticCurveTo(5, 7, 0, 11); ctx.quadraticCurveTo(-5, 7, -7, 2); ctx.lineTo(-8, -7); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-1, 3); ctx.lineTo(4, -3); ctx.stroke();
      break;
    case 'settings':
      ctx.beginPath(); ctx.arc(0, 0, 5.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5); ctx.lineTo(Math.cos(a) * 10.5, Math.sin(a) * 10.5); ctx.stroke();
      }
      break;
    case 'back':
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-8, 0); ctx.lineTo(-2, -6); ctx.moveTo(-8, 0); ctx.lineTo(-2, 6); ctx.stroke();
      break;
    case 'exit':
      ctx.beginPath(); ctx.rect(-9, -10, 12, 20); ctx.moveTo(-2, 0); ctx.lineTo(10, 0); ctx.lineTo(5, -5); ctx.moveTo(10, 0); ctx.lineTo(5, 5); ctx.stroke();
      break;
    case 'confirm':
      ctx.beginPath(); ctx.moveTo(-9, 1); ctx.lineTo(-3, 7); ctx.lineTo(10, -7); ctx.stroke();
      break;
    case 'next':
      ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(4, 0); ctx.lineTo(-7, 8); ctx.moveTo(7, -8); ctx.lineTo(7, 8); ctx.stroke();
      break;
    case 'bag':
      ctx.beginPath(); ctx.roundRect(-9, -5, 18, 15, 2.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-5, -8); ctx.quadraticCurveTo(-5, -12, 0, -12); ctx.quadraticCurveTo(5, -12, 5, -8); ctx.lineTo(5, -5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 1); ctx.lineTo(3, 1); ctx.stroke();
      break;
    case 'mission':
      ctx.beginPath(); ctx.roundRect(-8, -10, 16, 20, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-2, -2); ctx.lineTo(1, -6); ctx.moveTo(3, -4); ctx.lineTo(5, -4); ctx.moveTo(-4, 3); ctx.lineTo(5, 3); ctx.moveTo(-4, 7); ctx.lineTo(5, 7); ctx.stroke();
      break;
    case 'profile':
      ctx.beginPath(); ctx.arc(0, -4.5, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, 10); ctx.quadraticCurveTo(-8, 2, 0, 2); ctx.quadraticCurveTo(8, 2, 9, 10); ctx.stroke();
      break;
    case 'arrow':
      ctx.beginPath(); ctx.moveTo(-10, 9); ctx.lineTo(7, -8); ctx.moveTo(2, -8); ctx.lineTo(7, -8); ctx.lineTo(7, -3); ctx.moveTo(-6, 5); ctx.lineTo(-3, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, 1); ctx.lineTo(1, 4); ctx.moveTo(1, -2); ctx.lineTo(4, 1); ctx.stroke();
      break;
    case 'knife':
      ctx.beginPath(); ctx.moveTo(-9, 8); ctx.lineTo(5, -8); ctx.lineTo(10, -11); ctx.lineTo(8, -5); ctx.lineTo(-5, 9); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-9, 8); ctx.lineTo(-4, 12); ctx.lineTo(0, 8); ctx.moveTo(-6, 7); ctx.lineTo(-3, 10); ctx.stroke();
      break;
    case 'bandage':
      ctx.save(); ctx.rotate(-Math.PI / 4);
      ctx.beginPath(); ctx.roundRect(-10, -5, 20, 10, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2.5, -2.5); ctx.lineTo(2.5, -2.5); ctx.moveTo(-2.5, 2.5); ctx.lineTo(2.5, 2.5); ctx.stroke();
      ctx.restore();
      break;
    case 'plank':
      ctx.beginPath(); ctx.roundRect(-11, -7, 22, 6, 1); ctx.roundRect(-9, 2, 20, 6, 1); ctx.stroke();
      ctx.beginPath(); ctx.arc(-7, -4, 0.8, 0, Math.PI * 2); ctx.arc(8, 5, 0.8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'shard':
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, -3); ctx.lineTo(5, 9); ctx.lineTo(-2, 11); ctx.lineTo(-9, 2); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(-2, 11); ctx.moveTo(0, -11); ctx.lineTo(3, 0); ctx.lineTo(8, -3); ctx.stroke();
      break;
    case 'relic':
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(2, 0); ctx.lineTo(-1, 2); ctx.lineTo(1, 4); ctx.stroke();
      break;
    case 'run':
      ctx.beginPath(); ctx.arc(3, -8, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, -5); ctx.lineTo(-1, 0); ctx.lineTo(5, 2); ctx.lineTo(9, 7); ctx.moveTo(-1, 0); ctx.lineTo(-7, 5); ctx.moveTo(2, -4); ctx.lineTo(8, -2); ctx.moveTo(-6, 9); ctx.lineTo(0, 9); ctx.moveTo(7, 9); ctx.lineTo(12, 9); ctx.stroke();
      break;
    case 'pause':
      ctx.beginPath();
      ctx.roundRect(-6, -8, 4, 16, 1.5);
      ctx.roundRect(2, -8, 4, 16, 1.5);
      ctx.fill();
      break;
    case 'close':
      ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
      break;
    case 'more':
      for (const px of [-7, 0, 7]) { ctx.beginPath(); ctx.arc(px, 0, 1.7, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'plus':
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
      break;
    case 'shop':
      ctx.beginPath(); ctx.moveTo(-10, -7); ctx.lineTo(10, -7); ctx.lineTo(8, 9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -2); ctx.quadraticCurveTo(0, 3, 7, -2); ctx.stroke();
      break;
    case 'help':
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -3); ctx.quadraticCurveTo(-1, -7, 3, -5); ctx.quadraticCurveTo(7, -3, 2, 0); ctx.lineTo(1, 3); ctx.stroke();
      ctx.beginPath(); ctx.arc(1, 7, 0.8, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      ctx.restore();
      return false;
  }
  ctx.restore();
  return true;
}
