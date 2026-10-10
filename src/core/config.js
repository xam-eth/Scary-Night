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
 * `ambient` is the multiply lightmap base (0–255). It stays in a faded
 * dusk range: night, not noon, and never a near-zero crush that turns
 * the rooms solid black. `danger` drives music, vignette and heartbeat.
 */
export const PHASES = [
  { t: 0, id: 'calm', label: 'THE HOUSE IS QUIET', danger: 0.06, spawn: 0.0, ambient: [164, 170, 184], red: 0 },
  { t: 55, id: 'warning', label: 'SOMETHING IS OUT THERE', danger: 0.22, spawn: 0.55, ambient: [158, 164, 178], red: 0 },
  { t: 120, id: 'pressure', label: 'THEY KNOW YOU ARE HERE', danger: 0.44, spawn: 1.0, ambient: [152, 158, 172], red: 0.06 },
  { t: 180, id: 'heavy', label: 'THE HOUSE IS WAKING UP', danger: 0.62, spawn: 1.3, ambient: [148, 152, 166], red: 0.12 },
  { t: 240, id: 'final', label: 'DAWN IN 60 SECONDS', danger: 0.78, spawn: 1.7, ambient: [156, 144, 152], red: 0.22 },
  { t: 270, id: 'panic', label: 'PANIC', danger: 1.0, spawn: 2.15, ambient: [174, 132, 136], red: 0.42 },
  { t: 290, id: 'silence', label: 'DAWN IN 10', danger: 1.0, spawn: 1.7, ambient: [174, 132, 136], red: 0.42 },
  { t: 300, id: 'dawn', label: 'DAWN', danger: 0, spawn: 0, ambient: [198, 186, 164], red: 0 },
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

/**
 * Count pressure, shared by the purse and the pack size.
 * A maxed lane is four ranks: about +10% damage, +14% recovery, +8% speed,
 * +5% blood — a ~1.3× answer. Heat is 1.28 on the night after four dawns
 * (nightsSurvived 4). After that the count curve flattens at 1.56 and
 * threatMix changes what comes, so the top of the game is mastery.
 * Night 1 still multiplies the director budget by 0.45 and skips the spine.
 */
export function nightHeat(nightsSurvived) {
  const n = Math.max(0, nightsSurvived | 0);
  return 1 + Math.min(n, 8) * 0.07;
}

/** Kind pressure. The count curve flattens; the house does not. */
export function threatMix(nightsSurvived) {
  const n = Math.max(0, nightsSurvived | 0);
  return {
    hunterAt: n >= 3 ? 70 : 110,
    ghoulAt: n >= 5 ? 110 : 150,
    wolfAt: n >= 6 ? 130 : 170,
    doorMul: 1 + Math.min(n, 8) * 0.045,
    stalker: n >= 8,
  };
}

/* ---------------- player ---------------- */
export const PLAYER = {
  radius: 13,
  walkSpeed: 122,
  runSpeed: 196,
  accel: 22,           // tighter stop/start so touch steering follows the thumb
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
  bloodDrain: 0.42,        // per second at rest. Night 1 multiplies by NIGHT1_DRAIN.
  bloodDrainRun: 0.22,     // extra while running — a visible tick, not the meal
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
  bloodPackValue: 4,       // a mouthful. Six of them do not make a night.
  bloodPackCount: 6,
  bloodWellValue: 8,       // basement basin, high risk, still not a meal
  bonfireHeal: 12,
};

/* ---------------- enemies ---------------- */
export const ENEMY_TYPES = {
  crawler: {
    key: 'crawler',
    name: 'CRAWLER',
    hp: 42, speed: 92, huntSpeed: 141, radius: 12, contactDamage: 8, attackInterval: 1.1,
    attackRange: 26, doorDamage: 6.5, doorAttackInterval: 1.15, bloodValue: 20,
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
  zombie: {
    key: 'zombie',
    name: 'ZOMBIE',
    // The dead do not hurry. They arrive in a pack and they keep arriving.
    hp: 68, speed: 54, huntSpeed: 72, radius: 14, contactDamage: 11, attackInterval: 1.45,
    attackRange: 30, doorDamage: 9, doorAttackInterval: 1.25, bloodValue: 16,
    visionRange: 460, loseSight: 3.4, alertRange: 240, steer: 3.1,
    shardChance: 0.22, spawnCost: 0.65, speak: 'crawlerChatter', leaveAfter: 80,
    noWindows: true,
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
  // the Master: the same rig the alpha wears, and nothing about it is fair
  master:   { hpMul: 3.4, damageMul: 1.45, sizeMul: 1.42, tint: '#3d0a16', label: 'THE MASTER' },
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
  { t: 82, id: 'firstDead', text: 'THE DEAD ARE AT THE PALISADE.', fn: 'spawnWave', args: { type: 'zombie', count: 3, door: true } },
  { t: 96, id: 'window', text: null, fn: 'windowBreak' },
  { t: 118, id: 'secondWave', text: 'THEY HAVE SURROUNDED THE HOUSE.', fn: 'spawnWave', args: { type: 'crawler', count: 2, door: true } },
  { t: 140, id: 'firstHunter', text: 'A CROSSBOW BOLT CLATTERS AGAINST THE GLASS.', fn: 'spawnWave', args: { type: 'hunter', count: 1, snipe: true } },
  { t: 148, id: 'lull', text: null, fn: 'lull' },
  { t: 168, id: 'behindYou', text: 'SOMETHING MOVED BEHIND YOU.', fn: 'behindYou' },
  { t: 186, id: 'blackout', text: 'THE LIGHTS GO OUT.', fn: 'blackout' },
  { t: 198, id: 'werewolf', text: null, fn: 'spawnWave', args: { type: 'werewolf', count: 1, door: true, reveal: true } },
  { t: 210, id: 'deadAgain', text: 'THEY BROUGHT MORE OF THE DEAD.', fn: 'spawnWave', args: { type: 'zombie', count: 4, door: true, entranceId: 'postern' } },
  { t: 224, id: 'knock3', text: null, fn: 'knockHard' },
  { t: 236, id: 'behindYou2', text: 'SOMETHING MOVED BEHIND YOU.', fn: 'behindYou' },
  { t: 246, id: 'dawnSoon', text: 'DAWN IN 60 SECONDS.', fn: 'flourish' },
  { t: 262, id: 'swarm', text: null, fn: 'spawnWave', args: { type: 'crawler', count: 3, door: true } },
  { t: 274, id: 'panicWave', text: 'THEY ARE COMING FROM EVERYWHERE.', fn: 'spawnWave', args: { type: 'mixed', count: 4, door: true } },
  { t: 284, id: 'panicWerewolf', text: null, fn: 'spawnWave', args: { type: 'werewolf', count: 1, breakIn: true, reveal: true } },
  { t: 292, id: 'lastPush', text: null, fn: 'spawnWave', args: { type: 'crawler', count: 2, breakIn: true } },
];

/* ---------------- the climax ----------------
 * Four engineered peaks. Each one is a real gameplay beat AND a 2–3s, 9:16,
 * sound-off spectacle — the clip that stops a scroll. Tuned here, not in the
 * systems, so the whole shape of a night's peaks can be read in one place.
 *
 *   crescendo  the last ~20s before dawn: every door at once, the swarm floods
 *   frenzy     a feed-chain flips the blood moon: slow-mo, then overdrive
 *   duel       the alpha werewolf: the lights cut, the swarm leaves, 1v1
 *   dawnbreak  surviving to dawn: a golden wave that immolates what is left
 */
export const CLIMAX = {
  crescendoAt: 280,          // 20s of siege left in a 300s night
  crescendoDur: 22,
  crescendoDoorEvery: 1.5,   // one more door leans in every beat
  crescendoDoorBite: 0.045,  // ...and each one costs this share of its max hp

  frenzyChain: 3,            // feeds inside the window
  frenzyWindow: 9,
  frenzyDur: 7,
  frenzyCooldown: 42,
  frenzySlowT: 0.5,          // half a second of slow motion on the turn
  frenzySlowScale: 0.3,
  frenzyDamage: 2.2,
  frenzySpeed: 1.22,
  frenzyRate: 1.85,

  duelAfter: 150,            // never in the first quiet half...
  duelBefore: 266,           // ...and never inside the crescendo
  duelMinNights: 1,          // night 1 is the guided win: the duel waits
  duelCut: 1.6,              // lights out, monster fills the frame
  duelFight: 20,             // then it is a 1v1, whether or not you want one

  dawnWaveDur: 2.3,          // the sun crosses the house
};

/* ==========================================================================
 * THE SIEGE (#60) — the crowd at the walls, and how hard it leans.
 *
 * The curve is the owner's escalation: an almost empty first minute is what
 * makes the flood land. These are cheap simulation actors — no full AI,
 * pathfinding or line of sight. The 3D stage gives only a small near-camera
 * sample real shared GLB rigs; the rest remain simulation-only, never proxies.
 * ========================================================================== */
export const SIEGE = {
  cap: 54,                      // most bodies the night ever puts outside
  curve: [[0, 1], [60, 3], [120, 8], [180, 15], [240, 28]],
  heat: [0.95, 1.5],            // the curve at night one, and at a late night
  fronts: [2, 3],               // how many walls the crowd really masses at
  token: 2,                     // ...while every other wall keeps a couple
  ring8: 8,                     // one body at a far wall per eight in the yard
  arrive: [1.5, 0.4],           // seconds between arrivals, calm -> hot
  speed: [40, 76],              // px/s they walk in at
  ring: 38,                     // px out from the wall the front rank stands
  gap: 46,                      // px between bodies in a rank
  row: 34,                      // px between ranks as the crowd gets thick
  perRowMax: 9,                 // never a wider line than the frame can hold
  claw: 0.0009,                 // share of an entrance's max hp, per body, per second
  clawWindow: 0.0024,           // ...windows give way sooner
  mercy: 0.35,                  // the crowd never opens the whole house alone:
                                // as the walls fall, what is left is clawed
                                // less hard. The besiegers finish the job.
  clawEvery: 0.32,              // seconds between bites: one hit, one sound, not fifty
  promoteGap: 1.2,              // seconds a combat slot must stand free first
  fade: 1.6,                    // seconds to walk back into the fog
  floodCap: 60,                 // THE FINAL PUSH: the yard is full
  floodEach: 2,                 // ...every standing entrance has someone at it
  floodFront: 30,               // ...the wall she is standing at is a wall of bodies
  floodOther: 8,                // ...and the far fronts are thick too
  nearShare: 0.45,              // of the night's crowd, the share at the wall she is nearest
  types: ['crawler', 'zombie', 'zombie', 'ghoul', 'crawler', 'stalker'],
};

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
  { id: 'zombie', name: 'ZOMBIE', text: 'Slow, and never the only one.\nA pack at a door is the night learning your habits.\nEvery dawn you live, the next pack is larger.' },
  { id: 'hunter', name: 'HUNTER', text: 'Patient. Keeps its distance.\nCrossbow bolts will find you through a broken door.' },
  { id: 'werewolf', name: 'WEREWOLF', text: 'Slow, and it does not care about your barricade.\nDo not be in the room when it arrives.' },
  { id: 'ghoul', name: 'GHOUL', text: 'Thinner than the wolf, hungrier for wood.\nA barricade buys you minutes with most things.\nWith this one, it buys you seconds.' },
  { id: 'stalker', name: 'STALKER', text: 'It moves when your back is turned and freezes in the light.\nIt will never break your door down.\nIt will simply be inside when you open it.\nDo not run. Running is consent.' },
  { id: 'dawn', name: 'DAWN', text: 'The sun does not care who wins.\nIt only arrives. Survive long enough to see it.' },
  { id: 'knock', name: 'THE KNOCK', text: 'Three knocks on the north door.\nThere is nothing outside. There was never anything outside.\n\nProbably.' },
];

/* ---------------- blood shard economy ---------------- */
export const SHARDS = {
  perMinute: 0.4,          // idle time is a trickle, not the purse
  surviveBonus: 6,
  knockSurvived: 3,
  defeatBonusPer10: 0,     // kills pay through killShards, not this floor-to-zero bonus
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
