/* LAST NIGHT — game configuration & tuning
 *
 * Everything a designer would want to twist lives here. `TUNING` is a mutable
 * object on purpose: the dev overlay (F1) and the automated playtest harness
 * both write into it at runtime.
 *
 * Time mapping: 1 in-game hour == 60 real seconds, so a night is 300s of play
 * and the clock reads 00:00 -> 05:00. Dawn is at 300.
 */

export const GAME_VERSION = '1.0.0';   // v1.0: expanded mansion, 5 predators, haunts, proper IAP (Midtrans) + rewarded ads
export const NIGHT_DURATION = 300;      // seconds of a full night
export const SPAWN_WARMUP = 55;         // "the first hour is quiet"
export const PANIC_AT = 270;            // 04:30
export const SILENCE_AT = 290;          // 04:50 — music almost gone
export const COUNTDOWN_AT = 295;        // 04:55 — 5..1, then dawn
export const DAWN_AT = 300;

/** Difficulty presets. */
export const DIFFICULTY = {
  dread: { spawn: 0.72, damage: 0.75, bloodDrain: 0.85, doorHp: 1.25, label: 'DREAD' },
  standard: { spawn: 1.0, damage: 1.0, bloodDrain: 1.0, doorHp: 1.0, label: 'STANDARD' },
  nightmare: { spawn: 1.3, damage: 1.25, bloodDrain: 1.2, doorHp: 0.85, label: 'NIGHTMARE' },
};

/* ---------------- timeline ----------------
 * Each phase controls the tension director and the global light grade.
 * `danger` drives music, vignette, heartbeat floor and colour grading.
 */
export const PHASES = [
  { t: 0, id: 'calm', label: 'THE HOUSE IS QUIET', danger: 0.06, spawn: 0.0, ambient: [10, 13, 25], red: 0 },
  { t: 55, id: 'warning', label: 'SOMETHING IS OUT THERE', danger: 0.22, spawn: 0.55, ambient: [10, 13, 25], red: 0 },
  { t: 120, id: 'pressure', label: 'THEY KNOW YOU ARE HERE', danger: 0.44, spawn: 1.0, ambient: [9, 12, 24], red: 0.06 },
  { t: 180, id: 'heavy', label: 'THE HOUSE IS WAKING UP', danger: 0.62, spawn: 1.3, ambient: [8, 11, 22], red: 0.12 },
  { t: 240, id: 'final', label: 'DAWN IN 60 SECONDS', danger: 0.78, spawn: 1.7, ambient: [10, 10, 19], red: 0.22 },
  { t: 270, id: 'panic', label: 'PANIC', danger: 1.0, spawn: 2.15, ambient: [15, 8, 14], red: 0.42 },
  { t: 290, id: 'silence', label: 'DAWN IN 10', danger: 1.0, spawn: 1.7, ambient: [15, 8, 14], red: 0.42 },
  { t: 300, id: 'dawn', label: 'DAWN', danger: 0, spawn: 0, ambient: [10, 13, 25], red: 0 },
];

export function phaseAt(t) {
  let p = PHASES[0];
  for (const ph of PHASES) if (t >= ph.t) p = ph;
  return p;
}
export function nextPhase(t) {
  for (const ph of PHASES) if (ph.t > t) return ph;
  return null;
}

/* ---------------- player ---------------- */
export const PLAYER = {
  radius: 13,
  walkSpeed: 122,
  runSpeed: 196,
  accel: 16,           // how fast velocity chases the target (higher = snappier)
  dashSpeed: 330,
  dashTime: 0.19,
  dashCooldown: 1.15,
  dashBlood: 1.5,
  attackRange: 66,
  attackArc: 1.75,     // radians, total
  attackDamage: 26,
  attackCost: 0.8,
  attackCooldown: 0.46,
  attackWindup: 0.09,
  attackActive: 0.12,
  bloodMax: 100,
  bloodDrain: 0.34,        // per second at rest-ish
  bloodDrainRun: 0.22,     // extra while running
  bloodRegenRate: 0,       // none: blood only comes from blood
  lowBlood: 30,
  critBlood: 12,
  interactRange: 46,
  carryMax: 6,             // planks
  iframes: 0.75,
};

/* ---------------- doors ---------------- */
export const DOOR = {
  hp: 130,
  hpMax: 190,
  barricadeHp: 60,
  barricadePlanks: 3,
  repairRate: 9,           // hp per second, hand repair
  handRepairCap: 0.5,      // can only hand-repair up to 50% of max
  plankRepair: 26,
  plankRepairCost: 1,
  breakShake: 1.5,
};

/* ---------------- resources ---------------- */
export const RES = {
  plankPickup: 2,
  plankCount: 7,           // total planks in the world (each gives 2)
  bloodPackValue: 20,
  bloodPackCount: 8,
  bloodWellValue: 34,      // basement basin, high risk
  bonfireHeal: 12,
};

/* ---------------- enemies ---------------- */
export const ENEMY_TYPES = {
  crawler: {
    key: 'crawler',
    name: 'CRAWLER',
    hp: 42, speed: 92, huntSpeed: 141, radius: 12, contactDamage: 8, attackInterval: 1.1,
    attackRange: 26, doorDamage: 6.5, doorAttackInterval: 1.15, bloodValue: 22,
    visionRange: 620, loseSight: 2.4, alertRange: 300, steer: 5.2,
    silhouettes: 'lean', shardChance: 0.35, leaveAfter: 42,
    spawnCost: 1, canClimb: false, speak: 'crawlerChatter',
  },
  hunter: {
    key: 'hunter',
    name: 'HUNTER',
    hp: 70, speed: 76, huntSpeed: 108, radius: 13, contactDamage: 6, attackInterval: 1.6,
    attackRange: 360, keepDistance: 260, retreatRange: 130,
    boltDamage: 13, boltSpeed: 460, boltCooldown: 2.3, doorDamage: 6,
    doorAttackInterval: 1.7, bloodValue: 22, visionRange: 660, loseSight: 3.2,
    alertRange: 380, steer: 4.4, shardChance: 0.6, spawnCost: 2.2,
    speak: 'breath', meleeRange: 46, meleeDamage: 14, meleeCooldown: 1.5, leaveAfter: 52,
  },
  werewolf: {
    key: 'werewolf',
    name: 'WEREWOLF',
    hp: 260, speed: 64, huntSpeed: 92, chargeSpeed: 172, radius: 22, contactDamage: 26,
    attackInterval: 1.5, attackRange: 42, doorDamage: 26, doorAttackInterval: 1.35,
    bloodValue: 55, visionRange: 800, loseSight: 4.5, alertRange: 520, steer: 2.6,
    chargeRange: 330, chargeCooldown: 7.5, splinterDamage: 2.2,
    shardChance: 1.0, spawnCost: 5, roarEvery: 14, speak: 'growl', leaveAfter: 78,
    noWindows: true,
  },
  /* v1.0 additions — one psychological predator, one door-breaker. */
  stalker: {
    key: 'stalker',
    name: 'STALKER',
    // Only moves while outside the player's attention. Looking at it freezes
    // it; so does candlelight at close range. It never damages a door — it
    // waits for one to open. The horror is the corridor behind you.
    hp: 60, speed: 60, huntSpeed: 235, radius: 13, contactDamage: 16,
    attackInterval: 1.9, attackRange: 34, doorDamage: 0, doorAttackInterval: 99,
    bloodValue: 30, visionRange: 520, loseSight: 5, alertRange: 420, steer: 6.2,
    shardChance: 0.7, spawnCost: 2.6, speak: 'breath', leaveAfter: 96,
    noWindows: false, slipsOpenDoors: true, blinkCd: 7,
  },
  ghoul: {
    key: 'ghoul',
    name: 'GHOUL',
    // A gaunt, lighter cousin of the werewolf: less health, but it eats
    // barricades for breakfast and arrives when doors matter most.
    hp: 150, speed: 84, huntSpeed: 118, chargeSpeed: 0, radius: 18, contactDamage: 18,
    attackInterval: 1.3, attackRange: 38, doorDamage: 34, doorAttackInterval: 1.15,
    bloodValue: 38, visionRange: 700, loseSight: 3.6, alertRange: 480, steer: 3.0,
    splinterDamage: 3.0, shardChance: 0.85, spawnCost: 3.6, roarEvery: 18,
    speak: 'growl', leaveAfter: 70, noWindows: true,
    tint: '#2c2434', tintEdge: '#4a3b57',
  },
};

/* Difficulty-agnostic night variants — the director rolls these on established
 * enemies so a long night never repeats a shape. Multipliers stack on top of
 * the type stats; tint is a draw-time palette hint only (never gameplay). */
export const VARIANTS = {
  frenzy:   { speedMul: 1.32, damageMul: 0.8, hpMul: 0.85, tint: '#5a1420', label: 'FRENZIED' },
  marksman: { keepAdd: 60, boltDamageMul: 1.35, boltCdMul: 1.25, tint: '#3d3a1c', label: 'MARKSMAN' },
  alpha:    { hpMul: 1.4, damageMul: 1.25, sizeMul: 1.08, tint: '#611b1b', label: 'ALPHA' },
};

/* ---------------- tension director ----------------
 * beats are scripted once per night (in seconds), plus a live "budget"
 * system that decides how much pressure to apply between scripted beats.
 */
export const DIRECTOR = {
  budgetMax: 5.2,
  budgetRegen: [0.05, 0.19],         // per second, at danger 0 .. 1
  regroupAfterWave: [10, 16],
  quietPeriod: [9, 15],              // seconds of guaranteed relief after a wave
  waveGap: [17, 28],                 // time between waves at danger 1
  breath: [12, 4.5],                 // lull after the house empties, by danger
  spawnPointCooldown: 4.5,           // don't reuse the same door twice in a row
  maxAlive: [2, 7],                  // by danger
  knockChanceWave: 0.6,
  behindYou: { minGap: 105, maxPerNight: 3 },
  blackout: { minGap: 75, duration: [5, 9] },
};

/** Scripted beats. Gives every night a recognisable dramatic spine. */
export const BEATS = [
  { t: 26, id: 'creak', text: null, fn: 'creakNear' },
  { t: 44, id: 'firstKnock', text: null, fn: 'knock' },
  { t: 70, id: 'firstCrawler', text: 'SOMETHING IS TRYING THE FRONT DOOR.', fn: 'spawnWave', args: { type: 'crawler', count: 1, door: true } },
  { t: 96, id: 'window', text: null, fn: 'windowBreak' },
  { t: 118, id: 'secondWave', text: 'THEY HAVE SURROUNDED THE HOUSE.', fn: 'spawnWave', args: { type: 'crawler', count: 2, door: true } },
  { t: 140, id: 'firstHunter', text: 'A CROSSBOW BOLT CLATTERS AGAINST THE GLASS.', fn: 'spawnWave', args: { type: 'hunter', count: 1, snipe: true } },
  { t: 148, id: 'lull', text: null, fn: 'lull' },
  { t: 168, id: 'behindYou', text: 'SOMETHING MOVED BEHIND YOU.', fn: 'behindYou' },
  { t: 186, id: 'blackout', text: 'THE LIGHTS GO OUT.', fn: 'blackout' },
  { t: 198, id: 'werewolf', text: null, fn: 'spawnWave', args: { type: 'werewolf', count: 1, door: true, reveal: true } },
  { t: 224, id: 'knock3', text: null, fn: 'knockHard' },
  { t: 236, id: 'behindYou2', text: 'SOMETHING MOVED BEHIND YOU.', fn: 'behindYou' },
  { t: 246, id: 'dawnSoon', text: 'DAWN IN 60 SECONDS.', fn: 'flourish' },
  { t: 262, id: 'swarm', text: null, fn: 'spawnWave', args: { type: 'crawler', count: 3, door: true } },
  { t: 274, id: 'panicWave', text: 'THEY ARE COMING FROM EVERYWHERE.', fn: 'spawnWave', args: { type: 'mixed', count: 4, door: true } },
  { t: 284, id: 'panicWerewolf', text: null, fn: 'spawnWave', args: { type: 'werewolf', count: 1, breakIn: true, reveal: true } },
  { t: 292, id: 'lastPush', text: null, fn: 'spawnWave', args: { type: 'crawler', count: 2, breakIn: true } },
];

/* ---------------- knocking system ----------------
 * A knock is a promise the game makes and only sometimes keeps.
 */
export const KNOCKS = {
  outcomes: [
    { id: 'nothing', weight: 24, label: 'NOTHING' },
    { id: 'crawler', weight: 26, label: 'A CRAWLER' },
    { id: 'hunter', weight: 16, label: 'A HUNTER' },
    { id: 'werewolf', weight: 7, label: 'A WEREWOLF' },
    { id: 'fake', weight: 15, label: 'A TRICK' },
    { id: 'gift', weight: 12, label: 'A GIFT' },
  ],
  minGap: 25,
  timeToAnswer: [55, 90],     // how long a knock waits before it resolves itself
};

/* ---------------- meta progression ---------------- */
export const UPGRADES = [
  { id: 'blood', name: 'DEEP VEINS', desc: '+6% max blood per rank', max: 3, costs: [3, 5, 8], icon: 'blood' },
  { id: 'speed', name: 'PREDATOR STEP', desc: '+5% movement speed per rank', max: 3, costs: [3, 5, 8], icon: 'boot' },
  { id: 'repair', name: 'CARPENTER', desc: '+15% door repair & barricade value', max: 3, costs: [3, 5, 8], icon: 'plank' },
  { id: 'damage', name: 'OLD HUNGER', desc: '+8% claw damage per rank', max: 3, costs: [3, 5, 8], icon: 'claw' },
  { id: 'recovery', name: 'BLOOD THIEF', desc: '+12% blood gained from kills', max: 3, costs: [3, 5, 8], icon: 'fangs' },
];

export function upgradeLevel(save, id) { return (save.upgrades && save.upgrades[id]) || 0; }
export function upgradeMul(save, id, per) {
  return 1 + upgradeLevel(save, id) * per;
}

/* ---------------- collection (codex of what the player has faced) ---------------- */
export const CODEX = [
  { id: 'crawler', name: 'CRAWLER', text: 'Fast. Weak. Never alone.\nIt throws itself at doors until the wood gives.' },
  { id: 'hunter', name: 'HUNTER', text: 'Patient. Keeps its distance.\nCrossbow bolts will find you through a broken door.' },
  { id: 'werewolf', name: 'WEREWOLF', text: 'Slow, and it does not care about your barricade.\nDo not be in the room when it arrives.' },
  { id: 'ghoul', name: 'GHOUL', text: 'Thinner than the wolf, hungrier for wood.\nA barricade buys you minutes with most things.\nWith this one, it buys you seconds.' },
  { id: 'stalker', name: 'STALKER', text: 'It moves when your back is turned and freezes in the light.\nIt will never break your door down.\nIt will simply be inside when you open it.\nDo not run. Running is consent.' },
  { id: 'dawn', name: 'DAWN', text: 'The sun does not care who wins.\nIt only arrives. Survive long enough to see it.' },
  { id: 'knock', name: 'THE KNOCK', text: 'Three knocks on the north door.\nThere is nothing outside. There was never anything outside.\n\nProbably.' },
];

/* ---------------- blood shard economy ---------------- */
export const SHARDS = {
  perMinute: 1.1,
  surviveBonus: 4,
  defeatBonusPer10: 0.35,
};

export const TUNING = {
  godMode: false,
  infiniteBlood: false,
  infinitePlanks: false,
  noSpawns: false,
  showDebug: false,
  timeScale: 1,
  startAt: 0,        // jump straight into a phase for testing
  forcePhase: null,
};
