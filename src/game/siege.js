/* DUSKHOLD — the siege ladder and the perks (BUILD 17).
 *
 * Playtest 2026-10-18: "game belum punya hook yg kuat di awal ... harus terus
 * menang karna ini roguelike harus di buat mudah di awal baru terasa sulit
 * sampai level level tinggi dan resource mulai sulit di dapatkan ... musuh
 * terlihat kuat ... susah survive dan bertahan seharusnya di buat lebih
 * mudah".
 *
 * A run is still K1's three nights. What changes is WHICH siege it is: ten
 * levels, opened one at a time by holding the one before it
 * (docs/UX-REPLAY-RESEARCH.md R7). Siege 1 is a small horde of small
 * monsters that a first-time captain holds; every level after it keeps the
 * rules before it and adds one you can see — demons in the ranks, Breakers,
 * sprinting skulls, two gates at once, thin purses, the blood moon, ... —
 * while gold and wood come in thinner. Siege 3 plays BUILD 16's numbers
 * (every multiplier 1, the same Breakers and Individuals), so the night the
 * playtest found hard is now the third rung, not the first.
 *
 * The stars a siege was won with (its best) add up, and the total opens
 * PERKS for every run after (R9's unlock path: earned, fixed, the same for
 * everybody — never a random card). This module is data and pure helpers:
 * src/game/survival.js applies it, src/ui/survival.js draws it.
 */

export const SIEGE_MAX = 10;

const F = Object.freeze;

/**
 * One row per siege. The multipliers are on BUILD 16's numbers:
 *   count    swarm bodies per wave           hp      every body's HP
 *   bite     their claws on the captain and the guards
 *   claw     their claws on the keep          speed   how fast they walk
 *   gates    the gates' HP                    keep    the keep's HP
 *   income   night pay, the mines, the sawmills, the dawn's wood for kills
 *   loot     [coins, per kills]: gold paid at the kill itself, live
 *   start    the purse a run starts with
 *   breakers / individuals   how many come, Night 1..3
 *   pace     the night's spawn marks squeezed toward its start (Siege 1's
 *            small horde would otherwise leave long empty stretches)
 *   kinds    what the horde is made of, % (crowd3d's demon / blob / skull)
 *   size     how big the horde stands (a visual multiplier)
 *   rule     what is NEW at this siege: icon + the line the UI shows
 * Flags (from their siege on): runners (the skulls sprint), split (waves 2
 * and 3 come at two gates at once), bloodMoon (red night), bitter (the
 * townsfolk patch nothing at dawn).
 */
export const SIEGES = F([
  null,
  F({
    level: 1, name: 'FIRST WATCH', rule: F({ icon: 'swarm', text: 'A SMALL HORDE OF BLOBS' }),
    count: 0.5, hp: 0.58, bite: 0.55, claw: 0.3, speed: 0.92, gates: 1.3, keep: 1.4,
    income: 1.3, loot: F([1, 2]), start: F({ gold: 52, wood: 38 }),
    breakers: F([0, 0, 1]), individuals: F([1, 1, 2]), pace: 0.72,
    kinds: F({ zombie: 5, crawler: 75, ghoul: 20 }), size: 0.86,
  }),
  F({
    level: 2, name: 'THE DEAD WALK', rule: F({ icon: 'zombie', text: 'DEMONS JOIN THE HORDE' }),
    count: 0.7, hp: 0.78, bite: 0.78, claw: 0.72, speed: 0.96, gates: 1.15, keep: 1.1,
    income: 1.15, loot: F([1, 3]), start: F({ gold: 44, wood: 31 }),
    breakers: F([0, 1, 1]), individuals: F([2, 2, 2]), pace: 1,
    kinds: F({ zombie: 30, crawler: 50, ghoul: 20 }), size: 0.94,
  }),
  F({
    level: 3, name: 'BREAKERS', rule: F({ icon: 'breaker', text: 'TWO BREAKERS ON NIGHT 3' }),
    count: 1, hp: 1, bite: 1, claw: 1, speed: 1, gates: 1, keep: 1,
    income: 1, loot: F([1, 6]), start: F({ gold: 38, wood: 26 }),
    breakers: F([0, 1, 2]), individuals: F([2, 2, 2]), pace: 1,
    kinds: F({ zombie: 58, crawler: 26, ghoul: 16 }), size: 1,
  }),
  F({
    level: 4, name: 'RUNNERS', rule: F({ icon: 'runner', text: 'FLYING SKULLS SPRINT' }),
    count: 1, hp: 1.05, bite: 1.05, claw: 1, speed: 1, gates: 1, keep: 1,
    income: 0.95, loot: F([1, 6]), start: F({ gold: 36, wood: 25 }),
    breakers: F([0, 1, 2]), individuals: F([2, 2, 2]), pace: 1,
    kinds: F({ zombie: 52, crawler: 24, ghoul: 24 }), size: 1, runners: true,
  }),
  F({
    level: 5, name: 'TWO GATES', rule: F({ icon: 'split', text: 'FROM NIGHT 2: TWO GATES AT ONCE' }),
    count: 1, hp: 1.06, bite: 1.05, claw: 1, speed: 1.02, gates: 1, keep: 1,
    income: 0.9, loot: F([1, 7]), start: F({ gold: 34, wood: 24 }),
    breakers: F([0, 1, 2]), individuals: F([2, 2, 3]), pace: 1,
    kinds: F({ zombie: 55, crawler: 21, ghoul: 24 }), size: 1, runners: true, split: true,
  }),
  F({
    level: 6, name: 'LEAN TIMES', rule: F({ icon: 'lean', text: 'GOLD AND WOOD -25%' }),
    count: 1.1, hp: 1.15, bite: 1.15, claw: 1.1, speed: 1.04, gates: 1, keep: 1,
    income: 0.75, loot: F([1, 8]), start: F({ gold: 30, wood: 21 }),
    breakers: F([0, 1, 2]), individuals: F([2, 3, 3]), pace: 1,
    kinds: F({ zombie: 58, crawler: 18, ghoul: 24 }), size: 1, runners: true, split: true,
  }),
  F({
    level: 7, name: 'BLOOD MOON', rule: F({ icon: 'bloodMoon', text: 'THE HORDE HAS +35% HP' }),
    count: 1.15, hp: 1.35, bite: 1.2, claw: 1.15, speed: 1.06, gates: 1, keep: 1,
    income: 0.72, loot: F([1, 8]), start: F({ gold: 30, wood: 20 }),
    breakers: F([0, 2, 2]), individuals: F([2, 3, 3]), pace: 1,
    kinds: F({ zombie: 66, crawler: 12, ghoul: 22 }), size: 1.04, runners: true, split: true, bloodMoon: true,
  }),
  F({
    level: 8, name: 'IRON HORDE', rule: F({ icon: 'breaker', text: 'THREE BREAKERS ON NIGHT 3' }),
    count: 1.2, hp: 1.45, bite: 1.25, claw: 1.2, speed: 1.08, gates: 1, keep: 1,
    income: 0.7, loot: F([1, 9]), start: F({ gold: 28, wood: 19 }),
    breakers: F([0, 2, 3]), individuals: F([2, 3, 3]), pace: 1,
    kinds: F({ zombie: 70, crawler: 10, ghoul: 20 }), size: 1.06, runners: true, split: true, bloodMoon: true,
  }),
  F({
    level: 9, name: 'BITTER DAWN', rule: F({ icon: 'sun', text: 'NO FREE KEEP REPAIRS AT DAWN' }),
    count: 1.25, hp: 1.55, bite: 1.3, claw: 1.25, speed: 1.1, gates: 1, keep: 1,
    income: 0.65, loot: F([1, 10]), start: F({ gold: 26, wood: 18 }),
    breakers: F([0, 2, 3]), individuals: F([2, 3, 4]), pace: 1,
    kinds: F({ zombie: 72, crawler: 8, ghoul: 20 }), size: 1.08, runners: true, split: true, bloodMoon: true, bitter: true,
  }),
  F({
    level: 10, name: 'LAST STAND', rule: F({ icon: 'skull', text: 'WEAKER WALLS, THE BIGGEST HORDE' }),
    count: 1.3, hp: 1.7, bite: 1.35, claw: 1.3, speed: 1.12, gates: 0.9, keep: 0.9,
    income: 0.6, loot: F([1, 10]), start: F({ gold: 24, wood: 17 }),
    breakers: F([0, 3, 3]), individuals: F([2, 4, 4]), pace: 1,
    kinds: F({ zombie: 75, crawler: 5, ghoul: 20 }), size: 1.1, runners: true, split: true, bloodMoon: true, bitter: true,
  }),
]);

/** A sprinting skull (the RUNNERS rule): faster, frailer. */
export const RUNNER = F({ speed: 1.5, hp: 0.7 });
/** The most bodies one wave may send to one gate (BUILD 16's 30, a little more at the top). */
export const SIEGE_SWARM_CAP = 36;

/**
 * Perks, opened by the stars of every siege's best run added up (30 at most).
 * Each one is plain and always on once earned; each shows where it acts.
 */
export const PERKS = F([
  F({ id: 'chest', stars: 2, icon: 'gold', name: 'WAR CHEST', text: '+15 GOLD AT THE START' }),
  F({ id: 'veterans', stars: 5, icon: 'guard', name: 'VETERANS', text: '+1 GUARD AT THE START' }),
  F({ id: 'oak', stars: 8, icon: 'gate', name: 'OAK GATES', text: 'GATES +25% HP' }),
  F({ id: 'bolts', stars: 12, icon: 'crossbow', name: 'SHARP BOLTS', text: 'CAPTAIN +15% DAMAGE' }),
  F({ id: 'stone', stars: 16, icon: 'keep', name: 'STONE KEEP', text: 'KEEP +20% HP' }),
  F({ id: 'mines', stars: 21, icon: 'mine', name: 'RICH MINES', text: 'MINES DIG +30% GOLD' }),
]);
export const PERK_EFFECT = F({ chest: 15, veterans: 1, oak: 0.25, bolts: 0.15, stone: 0.2, mines: 0.3 });

export function clampSiege(level) {
  const n = Math.round(Number(level));
  return Number.isFinite(n) ? Math.min(SIEGE_MAX, Math.max(1, n)) : 1;
}

export function siegeSpec(level) { return SIEGES[clampSiege(level)]; }

/** Roman numerals would be thematic; a phone in a hand reads digits. */
export function siegeName(level) { return `SIEGE ${clampSiege(level)}`; }

/** The ladder's record (save.survival.records.ladder), cleaned. */
export function freshLadder() {
  return { unlocked: 1, best: {}, wins: {}, plays: {} };
}

export function cleanLadder(raw) {
  const out = freshLadder();
  if (!raw || typeof raw !== 'object') return out;
  out.unlocked = clampSiege(raw.unlocked || 1);
  for (const key of ['best', 'wins', 'plays']) {
    const src = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
    for (const [lv, v] of Object.entries(src)) {
      const level = clampSiege(lv);
      const n = Math.max(0, Math.floor(Number(v) || 0));
      if (n > 0) out[key][level] = key === 'best' ? Math.min(3, n) : n;
    }
  }
  // a siege with stars was won, so the one after it is open
  for (const lv of Object.keys(out.best)) out.unlocked = Math.max(out.unlocked, clampSiege(Number(lv) + 1));
  return out;
}

/** Every siege's best stars, added up. */
export function totalStars(ladder) {
  let n = 0;
  for (const v of Object.values((ladder && ladder.best) || {})) n += Math.min(3, Math.max(0, Math.floor(Number(v) || 0)));
  return n;
}

export function perksFor(stars) {
  return PERKS.filter((p) => stars >= p.stars).map((p) => p.id);
}

/** The next perk still to earn (or null when all are open). */
export function nextPerk(stars) {
  return PERKS.find((p) => stars < p.stars) || null;
}

/**
 * Record a finished run on the ladder. Returns what it opened:
 * { unlocked: level | null, perks: [ids newly earned], stars: total }.
 */
export function recordRun(ladder, level, won, stars) {
  const lv = clampSiege(level);
  const before = totalStars(ladder);
  const had = new Set(perksFor(before));
  ladder.plays[lv] = (ladder.plays[lv] || 0) + 1;
  let unlocked = null;
  if (won) {
    ladder.wins[lv] = (ladder.wins[lv] || 0) + 1;
    ladder.best[lv] = Math.max(ladder.best[lv] || 0, Math.min(3, Math.max(1, stars || 1)));
    if (lv < SIEGE_MAX && ladder.unlocked < lv + 1) { ladder.unlocked = lv + 1; unlocked = lv + 1; }
  }
  const after = totalStars(ladder);
  const perks = perksFor(after).filter((id) => !had.has(id));
  return { unlocked, perks, stars: after, gained: after - before };
}

/**
 * Gate plans (R8: a run is not the same run every time). Waves 1-3, then the
 * Individuals, per night, as survival.js's NIGHT_DOORS did. A run takes one
 * plan by its number in the save (the first run of a save is plan 0, BUILD
 * 16's), so two runs in a row never open the same way. Night 1's first wave
 * is always the north gate: the opening frames it, and it is the gate the
 * captain starts the run beside.
 */
export const GATE_PLANS = F([
  F([
    F(['northGate', 'eastGate', 'southGate', 'westGate', 'eastGate']),
    F(['westGate', 'posternNW', 'southGate', 'northGate', 'posternNW']),
    F(['posternSE', 'northGate', 'southGate', 'westGate', 'posternSE']),
  ]),
  F([
    F(['northGate', 'westGate', 'southGate', 'eastGate', 'westGate']),
    F(['eastGate', 'posternSE', 'southGate', 'northGate', 'posternSE']),
    F(['posternNW', 'northGate', 'southGate', 'eastGate', 'posternNW']),
  ]),
  F([
    F(['northGate', 'eastGate', 'westGate', 'southGate', 'eastGate']),
    F(['northGate', 'posternSE', 'westGate', 'southGate', 'posternSE']),
    F(['westGate', 'posternNW', 'southGate', 'eastGate', 'posternNW']),
  ]),
  F([
    F(['northGate', 'westGate', 'eastGate', 'southGate', 'westGate']),
    F(['posternNW', 'eastGate', 'southGate', 'westGate', 'posternNW']),
    F(['eastGate', 'posternSE', 'northGate', 'southGate', 'posternSE']),
  ]),
]);

export function gatePlanFor(runs) {
  const n = Math.max(0, Math.floor(Number(runs) || 0));
  return n % GATE_PLANS.length;
}

/** A small, stable hash (0..99) — crowd3d's — so a body's kind needs no random draw. */
export function hash100(n) {
  let x = (Number(n) || 0) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) % 100;
}

/** The horde kind a swarm body of this id wears at this siege. */
export function crowdKindFor(spec, id) {
  const roll = hash100(id);
  let acc = 0;
  for (const key of ['zombie', 'crawler', 'ghoul']) {
    acc += (spec.kinds && spec.kinds[key]) || 0;
    if (roll < acc) return key;
  }
  return 'zombie';
}
