/* Weapon tools for the hunter. A row, not a power.
 * Damage stays the claw's number. Sword reaches farther. Shot travels.
 * Nothing here is sold, and nothing here raises a stat.
 */

import { PLAYER } from '../core/config.js';

export const WEAPONS = Object.freeze({
  claw: Object.freeze({
    id: 'claw',
    clip: 'claw',
    kind: 'melee',
    range: PLAYER.attackRange,
    arc: PLAYER.attackArc,
    damage: PLAYER.attackDamage,
    fireAt: 0.35,
    sound: 'slash',
    hitSound: 'hitFlesh',
    hitWeight: 0.7,
    fx: 'claw',
    label: 'CLAW',
  }),
  sword: Object.freeze({
    id: 'sword',
    clip: 'sword',
    kind: 'melee',
    range: 98,
    arc: 2.15,
    damage: PLAYER.attackDamage,
    fireAt: 0.42,
    sound: 'steel',
    hitSound: 'hitFlesh',
    hitWeight: 1.35,
    fx: 'arc',
    label: 'SWORD',
  }),
  shot: Object.freeze({
    id: 'shot',
    clip: 'shot',
    kind: 'ranged',
    range: 460,
    arc: 0.4,
    damage: PLAYER.attackDamage,
    boltSpeed: 540,
    offset: 28,
    fireAt: 0.48,
    sound: 'shot',
    hitSound: 'boltImpact',
    hitWeight: 0.85,
    fx: 'muzzle',
    label: 'SHOT',
  }),
});

export const WEAPON_ORDER = Object.freeze(['claw', 'sword', 'shot']);

/* ---------------------------------------------------------------------------
 * Where a swing lands, measured the way the player sees it.
 *
 * The room is drawn obliquely: a metre of floor running away from the camera
 * covers far less screen than a metre running across it (the renderer's
 * `tilt`). A reach that is a circle on the floor is therefore an ELLIPSE on
 * screen — 88px across but only 50px up and down for the same 80px of floor —
 * while the swing itself is drawn upright, as a circle. So the claw used to
 * connect with things visibly outside the arc and miss things visibly inside
 * it, depending on which way you were facing.
 *
 * Squashing the floor delta by the same tilt turns the reach into a circle on
 * screen, which is the shape the swing is drawn in and the shape the eye
 * judges distance by. Only this question uses it. Movement, pathing, aggro
 * and every enemy decision stay in floor space, untouched.
 * ------------------------------------------------------------------------- */
export function swingTilt(game) {
  const r = game && game.renderer;
  return r && r.tilt ? r.tilt : 1;
}

/** The delta to a point, squashed the way the camera squashes the floor. */
export function swingDelta(game, from, to) {
  const t = swingTilt(game);
  return { dx: to.x - from.x, dy: (to.y - from.y) * t };
}

/** How far away a body is *as drawn*. This is the number the reach uses. */
export function swingDist(game, from, to) {
  const d = swingDelta(game, from, to);
  return Math.hypot(d.dx, d.dy);
}

/** The bearing to a body, in screen terms — the direction the eye reads. */
export function swingBearing(game, from, to) {
  const d = swingDelta(game, from, to);
  return Math.atan2(d.dy, d.dx);
}

/** True when `to` is inside the swing: close enough, inside the arc, or touching. */
export function inSwing(game, from, to, tool, facing) {
  const d = swingDist(game, from, to);
  const reach = tool.range + (to.radius || 12);
  if (d > reach) return false;
  const touching = d < (from.radius || 13) + (to.radius || 12) + 14;
  if (touching) return true;
  const off = Math.abs(angDiff(swingBearing(game, from, to), facing));
  return off <= tool.arc / 2;
}

/** A screen bearing back to a floor bearing, for writing a facing. */
export function swingBearingToWorld(game, bearing) {
  const t = swingTilt(game);
  return Math.atan2(Math.sin(bearing) / t, Math.cos(bearing));
}

function angDiff(a, b) {
  return ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

export function weaponById(id) {
  return WEAPONS[id] || WEAPONS.claw;
}

export function nextWeapon(id) {
  const i = WEAPON_ORDER.indexOf(id);
  return WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length];
}
