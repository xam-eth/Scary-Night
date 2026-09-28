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

export function weaponById(id) {
  return WEAPONS[id] || WEAPONS.claw;
}

export function nextWeapon(id) {
  const i = WEAPON_ORDER.indexOf(id);
  return WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length];
}
