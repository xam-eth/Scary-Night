/* LAST NIGHT — Milestone 1 survival-building loop
 *
 * This mode is deliberately isolated from the original hunt/night systems.
 * It keeps the existing Mansion, Player, CrowdBody, enemy damage hooks, Hunter
 * shot, GLB rigs, and 3D room/light pipeline, but owns its own day/phase save,
 * resources, builder queue, night waves, and rewards.
 */

import { ISO_CAMERA, approachAngle, clamp, damp, dist, lerp, rand, screenDirToWorld, writeSave } from '../core/util.js';
import { SURVIVAL_TUNING, SURVIVAL_ACTOR_SCALE } from '../core/config.js';
import { CrowdBody, Zombie, outwardOf, CROWD, ESTATE } from './enemies.js';
import { ROOM } from './mansion.js';
import { FORT } from './fortress.js';

const RESOURCE_CAP = 999;
/**
 * The camera's extra closeness over the 0.7 bailey's framing (frameMul).
 * 1.3 (2026-10-17 visual pass) read as too close on a phone: "camera terlalu
 * dekat harus jauhkan sedikit jarak nya" — 1.1 shows ~18% more bailey each
 * way, and the player can drag the view and pinch it (SURVIVAL_CAMERA).
 */
const FRAME_CLOSER = 1.1;
/**
 * The player's own hand on the camera — a dynamic camera like Rise of
 * Kingdoms' city view (BUILD 12, playtest 2026-10-17: "jarak kamera nya bisa
 * di pebesar perkecil geser jadi camera dinamis"):
 *   - a drag on the free half of the screen slides the view 1:1 and a flick
 *     glides on and slows (`glide`);
 *   - two fingers anywhere pinch it, about the point between them, and pan
 *     with it; the mouse wheel zooms about the cursor; the + / - buttons on
 *     the right edge (and the + / - keys) zoom a `step`, eased;
 *   - `zoom` is the range on top of the play framing: 0.42 shows the whole
 *     bailey on a sideways phone, 1.6 a close-up of a building or a fight;
 *   - walking eases the view back onto the captain (`recenter`), so the
 *     camera never costs him the fight; a tap on free ground or the CAPTAIN
 *     chip brings it back at once.
 * `reach`: how far past the bailey's edge the view centre may go.
 */
export const SURVIVAL_CAMERA = Object.freeze({
  zoom: Object.freeze([0.42, 1.6]),
  step: 1.35,         // one tap on + / - (or a key press)
  ease: 10,           // 1/s a step's zoom eases in
  reach: 160,
  recenter: 3.2,      // 1/s the pan eases out while the captain walks
  glide: 4.5,         // 1/s a flicked view slows down
  flick: 120,         // world px/s: a released drag slower than this just stops
});
/**
 * BUILD 15 (V7, docs/VISUAL-LAYOUT-RESEARCH.md §7): at night the frame leans
 * onto the fight. In BUILD 14 it sat on the captain and leaned a little
 * north, so a crowd at the main gate (south: the bottom of the frame) was
 * pressed against the stick and FLARE, and one at the north gate under the
 * top HUD band. `reach`: how far from the captain the horde counts (px);
 * `share`: how far toward its weighted middle the view centre goes (0.7: the
 * knot near the middle of the playfield, the captain beside it); `max`: the
 * longest lean (px); `full`: the weight of horde (threatFocus) that leans the
 * whole way — one straggler at the edge of reach barely moves the view;
 * `ease`: 1/s the lean eases in and out, so a knot dying or a new one
 * arriving glides instead of jerking the view.
 */
export const THREAT_FRAME = Object.freeze({ reach: 600, share: 0.7, max: 300, full: 3, ease: 2.4 });
/**
 * BUILD 16 (R5, docs/UX-REPLAY-RESEARCH.md §5 "NIGHT CLEARED"): a night with
 * nothing left to fight ends early. Once every spawn of the night is out and
 * none of it stands, NIGHT CLEARED! — dawn comes `delay` s later (the light
 * warms meanwhile: dawnBlend), and each whole second it saved pays
 * `goldPerSecond` gold. The mines are paid the shift they did not get to dig,
 * so an early dawn never costs income. In BUILD 15 a third night won with
 * 8–14 s still on the clock was spent waiting on it (survival-uxprobe).
 * What kept those nights from ending was not an empty board but the last
 * one to three slow walkers (a Breaker, an Individual) shambling round the
 * walls toward a far gate, 1000 px and more from any fight. So once every
 * spawn is out and `stragglers` or fewer still stand, the horde breaks: each
 * one that is not in the fight (inside the walls, at a gate or the keep,
 * within the captain's shot) turns and runs for the trees — `fleeSpeed`
 * px/s, gone after `flee` s, not a kill — and the ones still fighting are
 * marked on the HUD (LAST N!) until they fall.
 */
export const NIGHT_CLEAR = Object.freeze({ delay: 2, goldPerSecond: 1, stragglers: 3, flee: 1.5, fleeSpeed: 120 });
const SAVE_EVERY = 2.5;
// Night pacing: the first rank hits a door within seconds, so Night 1 has
// action near the Hunter before the halfway mark. Night 1 opens on the
// opening's last shot at its first wave mark (_startIntro). BUILD 16 (R6,
// same §5): Nights 2 and 3 have no opening, so their first wave sets out
// with the night (1.5 % in; it was 4 %) and its front rank is at its gate
// inside 5 s; every wave is called with its gate and a horn (updateWaves).
const WAVE_TIMES = Object.freeze([0.04, 0.3, 0.56]);
const WAVE_TIMES_LATER = Object.freeze([0.015, 0.3, 0.56]);
const BREAKER_TIMES = Object.freeze([0.2, 0.5]);
const INDIVIDUAL_TIMES = Object.freeze([0.42, 0.7]);
// Night 1–3 swarm sizes (×3 of the first M1 pass, capped per wave).
const WAVE_COUNTS = Object.freeze([
  Object.freeze([21, 21, 24]),
  Object.freeze([24, 27, 27]),
  Object.freeze([30, 30, 30]),
]);
const SWARM_CAP = 30;
/**
 * The gates a night comes at, in the order it comes at them (doors of
 * src/game/fortress.js): wave 1, wave 2, wave 3, then the second
 * Individual's gate (the first one shares wave 3's). The Breakers always
 * come at the main gate.
 *
 * BUILD 17 (R8, docs/UX-REPLAY-RESEARCH.md §5): one table per night meant
 * every run was the same round — the complaint research found most often in
 * the games measured against it ("same round… rotate the direction"). Nights
 * 2 and 3 now carry several authored rotations and a run picks one of each
 * from its `runSeed` (`nightDoors`), so the direction changes from run to
 * run while the night's shape stays authored:
 *   - wave 3, the biggest, still ends at the main gate, where the Breakers
 *     come and where the barricade the captain pays for stands;
 *   - the posterns only open from Night 2;
 *   - no gate takes two waves in the same night, and the two runners come at
 *     two different gates;
 *   - Night 3 never opens on the gate Night 2 opened on;
 *   - the first two waves are never both at a postern (a postern is 110 HP
 *     and stands further from the keep than a gate);
 *   - Night 3 also obeys two limits measured with the fragile archetype
 *     (arms-builder: barracks + arms, no ballistas — 3 seeds a plan,
 *     `tools/survival-balance.mjs --plan3=<gates>`):
 *       * a postern never takes wave 2. northGate→posternNW and
 *         westGate→posternSE lost 0/3: 30 bodies break a 110-HP postern
 *         while the garrison is committed to wave 1's gate on the far side.
 *         The same postern as wave 1 holds 3/3 — it arrives while the
 *         defence is still whole;
 *       * wave 2 sits within a quarter of the wall circuit of wave 1.
 *         posternNW→eastGate and posternSE→westGate (both 135°) lost 0/3 and
 *         1/3; every 45°/90° step measured held 3/3.
 *     Night 2 keeps the wider shapes: 24/27/27 bodies at a postern as wave 2
 *     measured 3/3 there;
 *   - Night 3 offers three rounds, not four. A first table carried a fourth,
 *     postern-less order (northGate→westGate→southGate→eastGate): four 30-body
 *     waves at four big gates is a round the fragile archetype only survives
 *     when Night 2 happened to prep it — arms-builder held it 3/3 behind
 *     Night 2's variants 0/1 but lost 1/5 behind variant 2 and 3/5 behind
 *     variant 3 (--rot=2,3 / 3,3, 5 seeds). It is not in the table; the three
 *     that are each hold 3/3 behind every Night 2 variant measured.
 * Night 1 keeps the one rotation it has always had: the opening hands the
 * player over at its first wave and the FTUE walks that gate
 * (tools/survival-intro.mjs), so the first night of a first run is identical
 * to BUILD 16.
 *
 * What does NOT vary yet: the night's make-up (swarm sizes, two runners,
 * one Breaker on Night 2 and two on Night 3) is still authored per night.
 * Announcing "RUNNERS TONIGHT" the way R8 sketches it needs a new body type
 * and a retune, so the call names the direction and the Breakers instead.
 */
export const NIGHT_ROTATIONS = Object.freeze([
  Object.freeze([Object.freeze(['northGate', 'eastGate', 'southGate', 'westGate'])]),
  Object.freeze([
    Object.freeze(['westGate', 'posternNW', 'southGate', 'northGate']),
    Object.freeze(['eastGate', 'posternSE', 'southGate', 'northGate']),
    Object.freeze(['northGate', 'westGate', 'southGate', 'eastGate']),
    Object.freeze(['posternSE', 'eastGate', 'southGate', 'westGate']),
  ]),
  Object.freeze([
    Object.freeze(['posternSE', 'northGate', 'southGate', 'westGate']),
    Object.freeze(['posternNW', 'northGate', 'southGate', 'eastGate']),
    Object.freeze(['posternSE', 'eastGate', 'southGate', 'westGate']),
  ]),
]);
/**
 * K1's two bookends (DESIGN-SYSTEM-PLAN §4): the opening shot — the keep and
 * its people, the horde at a gate, then the captain and the three nights —
 * and the reinforcements marching in through the main gate at the third dawn.
 * Both play inside the run (the world keeps drawing, the clock waits), a tap
 * anywhere skips, and the opening is told once per save. Times in seconds;
 * camera zooms are multiples of the play framing (`frameMul`).
 */
export const CINE = Object.freeze({
  armAfter: 0.35,        // s before a tap may skip (the tap that started the run must not)
  march: 210,            // px/s, the relief column's pace
  intro: Object.freeze({
    dur: 7.2,
    horn: 5.2,           // the captain's horn, as the camera finds him
    captions: Object.freeze([
      Object.freeze({ from: 0.3, to: 2.5, icon: 'keep', title: 'PROTECT THE KEEP', sub: 'ITS PEOPLE SHELTER INSIDE' }),
      Object.freeze({ from: 2.9, to: 4.9, icon: 'swarm', title: 'THE HORDE COMES AT NIGHT', sub: 'THEY BREAK IN THROUGH THE GATES' }),
      Object.freeze({ from: 5.3, to: 7.2, icon: 'hunter', title: 'YOU ARE THE CAPTAIN', sub: 'HOLD 3 NIGHTS. REINFORCEMENTS ARE COMING', track: true }),
    ]),
  }),
  arrival: Object.freeze({
    dur: 7.0,
    fanfare: 0.7,
    captions: Object.freeze([
      Object.freeze({ from: 0.8, to: 7.0, icon: 'banner', title: 'REINFORCEMENTS ARRIVED!', sub: 'THE KEEP HELD FOR 3 NIGHTS', tone: 'dawn' }),
    ]),
  }),
});

/**
 * The keep (K1 "Benteng Terakhir"): the stone tower in the middle of the
 * bailey's inner ward, with the townsfolk on its battlements. Bodies that reach its wall claw
 * it; at 0 HP the run is lost. From Lv2 a ballista on its roof shoots back.
 */
export const KEEP = Object.freeze({
  reach: 40,             // px past the keep's wall (and the body's radius) a claw lands from
  hitEvery: 1.5,         // s between one body's claws
  // tuned on the balance bots: idle still loses Night 1; a keep-only or
  // ballista-only plan can hold Night 3 when it also shoots back
  damage: Object.freeze({ swarm: 12, individual: 36, breaker: 72 }),
  alarmRange: 460,       // a body this close (and inside) threatens the keep
  attackedFor: 1.6,      // s the keep reads "under attack" after a claw
  // the roof ballista reaches out along the gate roads (at 360 it only ever
  // covered the inner ward and seldom fired). BUILD 12's bailey is 1.6x the
  // size (the north and south gates stand 773 px from the keep, not 488):
  // Lv2 covers the districts round the plaza, Lv3 most of the way to the
  // north and south gates, never past the wall
  ballista: Object.freeze({
    2: Object.freeze({ damage: 18, every: 1.1, range: 600 }),
    3: Object.freeze({ damage: 26, every: 0.9, range: 700 }),
  }),
});

/**
 * The keep's banner (BUILD 12): a circle round the keep that grows with its
 * level, clipped to the bailey's wall — Lv1 (900 px, three quarters of the
 * bailey) reaches every Lv1 plot including the side gates' ballistas, Lv2
 * (1100) all but the far corners, Lv3 all of it. Inside it the garrison hits
 * harder (SURVIVAL_TUNING.territoryDamageTakenMul); it never slows a body.
 * Which plot may be built is no longer the banner's yard but each plot's own
 * keep level (SURVIVAL_SLOTS `level`): layout B gives every district plots
 * of more than one level, so a later plot can stand on blue ground already.
 */
export const BANNER = Object.freeze({ 1: 900, 2: 1100, 3: 1400 });

/**
 * Typed build circles (P1, "walk into a circle, tap BUILD"). Every circle is
 * one building type, drawn on the ground as that building's ghost, so what
 * and where read without text. Every yard of the bailey has one economy
 * circle and, when a gate opens into it, a ballista circle inside that gate.
 * Ids: the yard id for the economy circle, `<yard>:tower` for the ballista.
 * Where each one stands is PLOT below (the old `at` yard fractions are gone).
 */
export const SURVIVAL_SLOTS = Object.freeze([
  Object.freeze({ id: 'south:tower', room: FORT.SOUTH, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.WARD, room: FORT.WARD, type: 'barracks', level: 1 }),
  Object.freeze({ id: FORT.SOUTH, room: FORT.SOUTH, type: 'sawmill', level: 1 }),
  Object.freeze({ id: FORT.NORTH, room: FORT.NORTH, type: 'mine', level: 1 }),
  Object.freeze({ id: 'north:tower', room: FORT.NORTH, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.WEST, room: FORT.WEST, type: 'sawmill', level: 1 }),
  Object.freeze({ id: 'west:tower', room: FORT.WEST, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.EAST, room: FORT.EAST, type: 'mine', level: 1 }),
  Object.freeze({ id: 'east:tower', room: FORT.EAST, type: 'tower', level: 1 }),
  Object.freeze({ id: FORT.NW, room: FORT.NW, type: 'barracks', level: 2 }),
  Object.freeze({ id: 'northwest:tower', room: FORT.NW, type: 'tower', level: 2 }),
  Object.freeze({ id: FORT.SE, room: FORT.SE, type: 'mine', level: 2 }),
  Object.freeze({ id: 'southeast:tower', room: FORT.SE, type: 'tower', level: 2 }),
  Object.freeze({ id: FORT.NE, room: FORT.NE, type: 'sawmill', level: 3 }),
  Object.freeze({ id: FORT.SW, room: FORT.SW, type: 'barracks', level: 3 }),
]);
/**
 * WHERE EVERY PLOT STANDS — layout B (BUILD 12, docs/VISUAL-LAYOUT-RESEARCH.md
 * §6; chosen 2026-10-17: "untuk opsi nya B tapi cek dulu peta ROK").
 *
 * The plots are a fixed plan, offsets from the keep in world px, drawn and
 * checked by tools/survival-map.mjs. Like a Rise of Kingdoms city, the bailey
 * is zoned: the keep on its plaza in the middle, roads to the four gates, and
 * each grass quarter one district of one trade, so a player reads "the blue
 * quarter is the barracks" instead of hunting a mix of fifteen pads:
 *   - north-west BARRACKS, north-east GOLD MINES, south-west SAWMILLS, each
 *     three plots in a triangle (inner pair 270 px apart beside the plaza,
 *     the third further out); south-east the ARMORY, the well and the stores;
 *   - the ballistas stand where they always did relative to their gates
 *     (BUILD 11: 170-183 px inside the wall, 115-130 px off the gate's axis,
 *     85 px off a postern's), so each one sees out of its gate through the
 *     opening exactly as before (boltPath; at 150 px off the road the view
 *     narrowed and the ballista-only bot lost a win in five); the north and
 *     south ones 120 px off, inside their road (ROAD_HALF 130);
 *   - the economy plots keep 130+ px of grass between pads (BUILD 11: 36-62),
 *     190+ px from the wall, and stay off the roads and the plaza;
 *   - the ballistas are point-symmetric through the keep (each gate's twin),
 *     the districts mirror across the north-south road.
 * The keep levels (SURVIVAL_SLOTS `level`) are BUILD 11's per plot id: 9
 * plots at Lv1, 4 more at Lv2, the last 2 at Lv3; in each district the Lv1
 * plots stand nearest the plaza. Every building faces south (the main gate,
 * the camera).
 */
export const PLOT = Object.freeze({
  radius: 68,
  at: Object.freeze({
    // the ballistas, by their gates
    'south:tower': Object.freeze([120, 600]),
    'north:tower': Object.freeze([-120, -600]),
    'west:tower': Object.freeze([-870, 115]),
    'east:tower': Object.freeze([870, -115]),
    'northwest:tower': Object.freeze([-870, -427]),
    'southeast:tower': Object.freeze([870, 427]),
    // north-west: the barracks
    ward: Object.freeze([-330, -260]),
    northwest: Object.freeze([-600, -260]),
    southwest: Object.freeze([-465, -500]),
    // north-east: the gold mines
    north: Object.freeze([330, -260]),
    east: Object.freeze([600, -260]),
    southeast: Object.freeze([465, -500]),
    // south-west: the sawmills
    south: Object.freeze([-330, 260]),
    west: Object.freeze([-600, 260]),
    northeast: Object.freeze([-465, 500]),
  }),
  /** The armory (the captain's upgrades): the south-east district, the barracks' mirror image. */
  armory: Object.freeze([330, 260]),
  /**
   * The arms rack (BUILD 14: the garrison's crossbows), the armory's
   * neighbour on the same row, where the north-west barracks' outer plot is
   * mirrored (270 px apart, like every district's inner pair).
   */
  arms: Object.freeze([600, 260]),
  /**
   * Where the captain starts a run and every dawn: where the east road leaves
   * the keep's plaza, inside the keep's reach (keep.r + CIRCLE.keepReach =
   * 250, the plaza and its kerb), so the keep's card is the first thing a day
   * shows. (South of the keep, before its door, the engaged bot's night
   * anchor ended Night 1 with the keep at 43% in BUILD 9 — one star; on the
   * east road it held. At 190 px in layout B one seed in five fell to one
   * star on Night 1; at 240 all five held.)
   */
  home: Object.freeze([240, 0]),
  /**
   * Twins the plan keeps (p: through the keep; x: across the north-south
   * road; y: across the east-west road).
   */
  mirrors: Object.freeze([
    ['south:tower', 'north:tower', 'p'], ['west:tower', 'east:tower', 'p'],
    ['northwest:tower', 'southeast:tower', 'p'],
    ['ward', 'north', 'x'], ['northwest', 'east', 'x'], ['southwest', 'southeast', 'x'],
    ['ward', 'south', 'y'], ['northwest', 'west', 'y'], ['southwest', 'northeast', 'y'],
  ].map((row) => Object.freeze(row))),
});
const SLOT_BY_ID = new Map(SURVIVAL_SLOTS.map((slot) => [slot.id, slot]));
export function survivalSlot(id) { return SLOT_BY_ID.get(id) || null; }
/** Pre-K1 saves: the old building ids. */
const TYPE_MIGRATE = Object.freeze({ extractor: 'mine', shelter: 'barracks' });
/** How close the Hunter stands to a circle (or the keep) to act on it. */
// keepReach: BUILD 12's keep stands on a plaza (fortress.js PLAZA_R 235), and
// anywhere on it (with its kerb) is "at the keep" — 150 past its wall
export const CIRCLE = Object.freeze({ radius: 68, reach: 80, keepReach: 150 });
const NIGHT_PHASE = { id: 'survival-night', label: 'NIGHT', danger: 0.24, ambient: [108, 114, 132] };
const DAY_PHASE = { id: 'survival-day', label: 'DAY', danger: 0.02, ambient: [186, 174, 150] };

// Lv1 build cost/label. The level table below drives the economy.
export const SURVIVAL_BUILDINGS = Object.freeze({
  mine: Object.freeze({ id: 'mine', label: 'GOLD MINE', gold: 2, wood: 10, seconds: 7 }),
  sawmill: Object.freeze({ id: 'sawmill', label: 'SAWMILL', gold: 2, wood: 10, seconds: 7 }),
  barracks: Object.freeze({ id: 'barracks', label: 'BARRACKS', gold: 4, wood: 14, seconds: 9 }),
  tower: Object.freeze({ id: 'tower', label: 'BALLISTA', gold: 4, wood: 16, seconds: 8 }),
});

/**
 * Building levels (Lv1 is the build itself). Every level pays off in the
 * coming night, so an upgrade bought on the last day still counts:
 *   mine      digs gold into the purse DURING the night (`yield` per night)
 *   sawmill   wood every dawn, and planks: every outer door gets +% max HP
 *   barracks  houses soldiers; a build or level moves one in at once
 *             (one more door guard tonight)
 *   tower     a ballista by the room's outer door: harder bolts, further
 *             reach (see TOWER)
 */
export const BUILDING_MAX_LEVEL = 3;
export const SURVIVAL_BUILDING_LEVELS = Object.freeze({
  mine: Object.freeze({
    1: Object.freeze({ gold: 2, wood: 10, seconds: 7, yield: 6 }),
    2: Object.freeze({ gold: 4, wood: 12, seconds: 6, yield: 10 }),
    3: Object.freeze({ gold: 6, wood: 16, seconds: 7, yield: 14 }),
  }),
  sawmill: Object.freeze({
    1: Object.freeze({ gold: 2, wood: 10, seconds: 7, dawnWood: 7, doorBonus: 0.1 }),
    2: Object.freeze({ gold: 4, wood: 12, seconds: 6, dawnWood: 11, doorBonus: 0.2 }),
    3: Object.freeze({ gold: 6, wood: 16, seconds: 7, dawnWood: 15, doorBonus: 0.3 }),
  }),
  barracks: Object.freeze({
    1: Object.freeze({ gold: 4, wood: 14, seconds: 9, houses: 1 }),
    2: Object.freeze({ gold: 6, wood: 16, seconds: 8, houses: 2 }),
    3: Object.freeze({ gold: 8, wood: 20, seconds: 9, houses: 3 }),
  }),
  // A bolt that kills: 24 at Lv1 drops a Night 1 body (48 HP) in two, and
  // runs on through a second one (TOWER.pierce). At 16 a ballista fired 110
  // bolts a run and landed 30 kills, so it read as decoration (2026-10-17).
  tower: Object.freeze({
    1: Object.freeze({ gold: 4, wood: 16, seconds: 8, damage: 24, range: 520 }),
    2: Object.freeze({ gold: 6, wood: 18, seconds: 7, damage: 32, range: 580 }),
    3: Object.freeze({ gold: 8, wood: 22, seconds: 8, damage: 42, range: 640 }),
  }),
});
const DOOR_BONUS_CAP = 0.6;

/**
 * A ballista is the house fighting back on its own. It is built on its own
 * circle just inside a room's outer door and, by night, shoots a heavy bolt
 * through the door slit that runs on through a second body. It never walks
 * to the pressed door like a guard does: where it stands is the choice.
 */
export const TOWER = Object.freeze({
  every: 1.1,          // s between shots
  pierce: 1,           // extra bodies one bolt runs through
  boltSpeed: 900,
  reach: 120,          // px a bolt flies past the tower's range before it drops
  setback: 150,        // px inside the door it guards
  side: 64,            // px off the doorway line, toward the room's middle
  turn: 12,            // rad/s the ballista swings
  // a yard with two gates guards the busier one
  doors: Object.freeze(['southGate', 'northGate', 'eastGate', 'westGate', 'posternNW', 'posternSE']),
});

/**
 * The Hunter's own track, bought by day at the armory rack (no skill cards).
 * Shots are meant to feel heavy: a swarm body (48/54/60 HP) drops in two
 * bolts at Lv1 and one inside the banner's yards. Every level adds something
 * you can SEE: Lv2 bolts run on through a body, Lv3 fires a fan of three.
 */
export const HUNTER_MAX_LEVEL = 3;
export const SURVIVAL_HUNTER = Object.freeze({
  1: Object.freeze({ damage: 32, hp: 100, pierce: 0, fan: 1 }),
  2: Object.freeze({ gold: 14, wood: 8, seconds: 5, damage: 40, hp: 120, pierce: 1, fan: 1 }),
  3: Object.freeze({ gold: 20, wood: 12, seconds: 6, damage: 48, hp: 140, pierce: 1, fan: 3 }),
});

/**
 * BUILD 14 (2026-10-17: "senjata terpisah ... senjata pasukan bisa di-
 * upgrade"): the garrison's crossbows, bought by day at the arms rack beside
 * the armory (one level for every guard on the walls). Each level shows on
 * every guard (game/troop3d.js: Lv1 the pack's plain crossbow, Lv2 the same
 * bow lacquered royal blue, Lv3 the two-handed arbalest in blue and gold)
 * and in its bolts (white-blue, then gold). Lv1 is GUARD's base; a guard
 * inside the banner's yards still hits x1.5.
 */
export const ARMS_MAX_LEVEL = 3;
export const SURVIVAL_ARMS = Object.freeze({
  1: Object.freeze({ damage: 10, every: 1.6, pierce: 0 }),
  2: Object.freeze({ gold: 12, wood: 10, seconds: 5, damage: 14, every: 1.4, pierce: 0 }),
  3: Object.freeze({ gold: 18, wood: 14, seconds: 6, damage: 18, every: 1.25, pierce: 1 }),
});

function freshProgress(duration = SURVIVAL_TUNING.nightSeconds) {
  return {
    initialized: true,
    day: 1,
    phase: 'night',
    elapsed: 0,
    nightDuration: duration,
    gold: SURVIVAL_TUNING.startGold,
    wood: SURVIVAL_TUNING.startWood,
    survivors: SURVIVAL_TUNING.startSurvivors,
    keepLevel: 1,
    keepHp: SURVIVAL_TUNING.keepHp[1],
    buildings: {},
    buildingLevels: {},
    hunterLevel: 1,
    armsLevel: 1,
    gateBuilt: false,
    gateHp: 0,
    builderJob: null,
    selectedRoom: null,
    nightsCompleted: 0,
    waveIndex: 0,
    breakerIndex: 0,
    individualIndex: 0,
    runSeed: 0,          // BUILD 17 (R8): the run's gate rotation
    runCount: 0,
    siegeTimers: {},
    nightStats: freshNightStats(), runStats: freshRunStats(),
    lastRewards: null,
    rewardAck: 0,
    hints: {},
    player: null,
    entrances: null,
    enemies: [],
  };
}

function clampDuration(value) {
  const n = Number(value);
  return clamp(Number.isFinite(n) ? Math.round(n) : SURVIVAL_TUNING.nightSeconds,
    SURVIVAL_TUNING.minNightSeconds, SURVIVAL_TUNING.maxNightSeconds);
}

/* ------------------------------------------------------------------ */
/* shared survival locomotion                                          */
/* ------------------------------------------------------------------ */

const SIEGE_REACH = 250;       // px from a door the pressing ranks still claw it

function stepToward(enemy, dt, game, tx, ty, speed, accel) {
  const a = Math.atan2(ty - enemy.y, tx - enemy.x);
  enemy.vx = damp(enemy.vx, Math.cos(a) * speed, accel, dt);
  enemy.vy = damp(enemy.vy, Math.sin(a) * speed, accel, dt);
  enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
  enemy.angle = a;
}

function stepDir(enemy, dt, game, dir, speed, accel) {
  enemy.vx = damp(enemy.vx, dir.x * speed, accel, dt);
  enemy.vy = damp(enemy.vy, dir.y * speed, accel, dt);
  enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
  enemy.angle = Math.atan2(dir.y, dir.x);
}

function settle(enemy, dt, k = 8) {
  enemy.vx = damp(enemy.vx, 0, k, dt);
  enemy.vy = damp(enemy.vy, 0, k, dt);
}

/**
 * Interior doorways sit between room rectangles, so findRoom() reports them
 * as OUTSIDE. Once a body has been inside a room it stays "inside" — otherwise
 * it flips back toward its entry door every time it crosses a doorway.
 */
function trackInside(enemy, game) {
  enemy.roomId = game.mansion.findRoom(enemy.x, enemy.y);
  if (enemy.roomId !== ROOM.OUTSIDE) enemy._inHouse = true;
  return !!enemy._inHouse;
}

/**
 * Outside the walls: walk the lane to a door. The door's flow field routes
 * around the house while the body is still far away; inside the last stretch
 * it walks straight to its own spot. (Following the field all the way made
 * every body whose rank stands further out than the field's goal orbit that
 * goal forever — whole waves never reached the wood.)
 */
const DOOR_LANE_NEAR = 200;
function approachDoor(enemy, dt, game, mode, door, point, speed, accel) {
  const out = door.outside || door;
  const far = dist(enemy.x, enemy.y, out.x, out.y) > DOOR_LANE_NEAR;
  const dir = far ? mode.flowDir(`door:${door.id}`, enemy.x, enemy.y) : null;
  if (dir && dist(enemy.x, enemy.y, point.x, point.y) > 60) stepDir(enemy, dt, game, dir, speed, accel);
  else stepToward(enemy, dt, game, point.x, point.y, speed, accel);
}

/**
 * Where a swarm body stands in its door's crowd. Unlike the legacy rank
 * layout (left-to-right, as wide as the frame + 220 px), Survival fills the
 * front rank centre-out and keeps it about one door wide, so the bodies that
 * are clawing are the ones the Hunter and the guards can see through the
 * door's slit; alternate ranks are staggered half a gap.
 */
// spaced for bodies x1.6 (SURVIVAL_ACTOR_SCALE): a demon is ~60 px across
const RANK_GAP = 54;
const RANK_ROW = 44;
export function survivalSpot(e, index, ring = 72) {
  const out = outwardOf(e);
  const along = { x: -out.y, y: out.x };
  const span = e.axis === 'v' ? e.h : e.w;
  const perRow = clamp(Math.round((span + 120) / RANK_GAP), 3, 7);
  const rank = Math.floor(index / perRow);
  const k = index % perRow;
  const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
  const lateral = step * RANK_GAP + (rank % 2 ? RANK_GAP / 2 : 0);
  const depth = ring + rank * RANK_ROW;
  return { x: e.x + out.x * depth + along.x * lateral, y: e.y + out.y * depth + along.y * lateral };
}

/**
 * Inside the walls: follow the flow field to the keep (or the Hunter when he
 * stands outside the banner's yards) and claw the keep's wall once in reach.
 * The banner never slows or blunts a body; it only makes the garrison's shots
 * hit harder (SurvivalMode.enemyDamageTaken).
 */
function invade(enemy, dt, game, mode, speed, accel, preferHunter, fallback = null) {
  const keep = mode.keep();
  const p = game.player;
  const held = mode.inTerritory(enemy.x, enemy.y);
  const pd = dist(enemy.x, enemy.y, p.x, p.y);
  enemy.attackingKeep = false;
  // One standing in its way still gets clawed, inside the banner or not.
  if (pd < enemy.radius + p.radius + 12 && p.state !== 'death' && p.state !== 'dead') {
    settle(enemy, dt);
    enemy.state = 'strike';
    enemy.angle = Math.atan2(p.y - enemy.y, p.x - enemy.x);
    enemy.attackCd -= dt;
    if (enemy.attackCd <= 0) {
      enemy.attackCd = enemy.hitEvery || 1.6;
      game.enemyHitPlayer(enemy, enemy.hitDamage || 10, enemy.hitKind || 'bite');
    }
    return 'press';
  }
  // A guard standing in its way gets clawed the same way (never hunted).
  const guard = mode.guardInReach(enemy);
  if (guard) {
    settle(enemy, dt);
    enemy.state = 'strike';
    enemy.angle = Math.atan2(guard.y - enemy.y, guard.x - enemy.x);
    enemy.attackCd -= dt;
    if (enemy.attackCd <= 0) {
      enemy.attackCd = enemy.hitEvery || 1.6;
      mode.hurtGuard(guard, (enemy.hitDamage || 10) * mode.enemyAttackMul(enemy), enemy);
    }
    return 'press';
  }
  // Outside the banner it also goes for a guard close by, as it would for the Hunter.
  const prey = held ? null : mode.guardToHunt(enemy);
  if (prey) {
    stepToward(enemy, dt, game, prey.x, prey.y, speed, accel);
    enemy.state = 'march';
    return 'march';
  }
  if (enemy._prey) enemy._prey = null;
  if (keep && mode.keepHp > 0 && dist(enemy.x, enemy.y, keep.x, keep.y) <= keep.r + (enemy.radius || 13) + KEEP.reach) {
    settle(enemy, dt);
    enemy.attackingKeep = true;
    enemy.state = 'strike';
    enemy.angle = Math.atan2(keep.y - enemy.y, keep.x - enemy.x);
    enemy.keepCd = (enemy.keepCd == null ? KEEP.hitEvery * 0.5 : enemy.keepCd) - dt;
    if (enemy.keepCd <= 0) { enemy.keepCd = KEEP.hitEvery; mode.hitKeep(enemy); }
    return 'keep';
  }
  const hunterOut = !mode.inTerritory(p.x, p.y);
  const chase = (preferHunter && hunterOut) || (!held && pd < 170);
  let dir = mode.flowDir(chase ? 'hunter' : 'keep', enemy.x, enemy.y);
  if (!dir && chase) dir = mode.flowDir('keep', enemy.x, enemy.y);
  if (dir) stepDir(enemy, dt, game, dir, speed, accel);
  else if (!enemy._inHouse && fallback) stepToward(enemy, dt, game, fallback.x, fallback.y, speed, accel);
  else if (chase) stepToward(enemy, dt, game, p.x, p.y, speed, accel);
  else if (keep) stepToward(enemy, dt, game, keep.x, keep.y, speed, accel);
  enemy.state = 'march';
  return 'march';
}

/**
 * Outside the walls (BUILD 10): while the captain is out — or stands in an
 * open gate — a body near him leaves its gate and goes for him, at most
 * SORTIE.maxOnCaptain at once. A gate's barrier still holds a body, so with
 * the captain in a gate's mouth its claw reaches through the opening.
 * Returns true when it took the frame. Breakers never come: the gate is
 * their whole errand.
 */
function goForCaptain(enemy, dt, game, mode, speed, accel) {
  const p = game.player;
  if (!mode.captainExposed || !p.alive || p.state === 'death' || p.state === 'dead') {
    enemy._onCaptain = false;
    return false;
  }
  const pd = dist(enemy.x, enemy.y, p.x, p.y);
  const range = SORTIE.aggro + (enemy._onCaptain ? SORTIE.leash : 0);
  if (pd > range || (!enemy._onCaptain && !mode.claimCaptain())) {
    enemy._onCaptain = false;
    return false;
  }
  enemy._onCaptain = true;
  const reach = (enemy.radius || 13) + p.radius + 12 + (mode.captainInGate ? SORTIE.gateReach : 0);
  enemy.clawCd = (enemy.clawCd == null ? 0.35 : enemy.clawCd) - dt;
  if (pd < reach) {
    settle(enemy, dt);
    enemy.state = 'strike';
    enemy.angle = Math.atan2(p.y - enemy.y, p.x - enemy.x);
    if (enemy.clawCd <= 0) {
      enemy.clawCd = enemy.hitEvery || 1.6;
      game.enemyHitPlayer(enemy, enemy.hitDamage || 10, enemy.hitKind || 'bite');
    }
    return true;
  }
  stepToward(enemy, dt, game, p.x, p.y, speed, accel);
  enemy.state = 'march';
  return true;
}

/** Death/hit-stun handling shared by all three survival enemy types. */
function commonPreamble(enemy, dt, game) {
  if (enemy.dead) {
    enemy.attackingKeep = false;
    enemy.deathT += dt;
    settle(enemy, dt, 7);
    if (enemy.deathT > 1.45) enemy.removeMe = true;
    return true;
  }
  enemy.staggerT = Math.max(0, (enemy.staggerT || 0) - dt);
  if (enemy.staggerT > 0) {
    // Flare knock-back / hit flinch: short and never caused by the banner.
    enemy.attackingKeep = false;
    enemy.state = 'stagger';
    settle(enemy, dt, 5.5);
    enemy.moveColliding(game, enemy.vx * dt, enemy.vy * dt);
    return true;
  }
  return false;
}

/**
 * BUILD 16 (R5): the horde breaks. A routed straggler turns its back on the
 * walls and runs for the trees (NIGHT_CLEAR.fleeSpeed), and is gone after
 * NIGHT_CLEAR.flee s — taken off the board, not killed. Returns true while
 * it runs (the update stops there).
 */
function fleeing(enemy, dt, game, marchState) {
  if (!enemy.fleeing) return false;
  const B = game.mansion.bailey;
  const cx = B ? B.x + B.w / 2 : 0, cy = B ? B.y + B.h / 2 : 0;
  const dx = enemy.x - cx, dy = enemy.y - cy;
  const l = Math.hypot(dx, dy) || 1;
  enemy.attackingKeep = false;
  enemy.fleeT = (enemy.fleeT || 0) + dt;
  stepDir(enemy, dt, game, { x: dx / l, y: dy / l }, NIGHT_CLEAR.fleeSpeed, 6);
  enemy.state = marchState;
  if (enemy.fleeT >= NIGHT_CLEAR.flee) enemy.removeMe = true;
  return true;
}

/** A reduced-AI siege zombie that retains CrowdBody's rank/entrance identity. */
class SurvivalCrowdZombie extends CrowdBody {
  constructor(x, y, entrance, index, day) {
    super('zombie', x, y, entrance);
    this._survivalType = 'swarm';
    this._crowd = true;
    this.index = index;
    this.hpMax = Math.round(48 * (1 + Math.max(0, day - 1) * 0.12));
    this.hp = this.hpMax;
    this.radius = 13;
    this.hurtFlash = 0;
    this.deathT = 0;
    this.removeMe = false;
    this.attackCd = 0;
    this.alpha = 0.9;
    this.entranceId = entrance ? entrance.id : null;
    this.hitEvery = 1.6;
    this.hitDamage = 9 + day * 2;
    this.hitKind = 'swarm';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  hurt(amount, game, fromX, fromY) {
    if (this.dead || this.removeMe) return;
    const incoming = game.survival ? game.survival.enemyDamageTaken(this, amount) : amount;
    this.hp -= incoming;
    this.hurtFlash = 1;
    if (fromX != null && fromY != null) {
      // a heavy bolt shoves the body back: the hit reads as weight
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      const shove = this.hp <= 0 ? 260 : 120;
      this.vx += Math.cos(a) * shove; this.vy += Math.sin(a) * shove;
    }
    if (this.hp <= 0) this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.t += dt;
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 3.8);
    if (commonPreamble(this, dt, game)) return;
    if (fleeing(this, dt, game, CROWD.MARCH)) return;
    const mode = game.survival;
    const entrance = mode.entranceById(this.entranceId) || this.entrance;
    this.entrance = entrance;
    const inside = trackInside(this, game);
    const broken = !!(entrance && entrance.broken);
    this.alpha = Math.min(1, this.alpha + dt * 0.8);

    if (broken || inside) {
      // The keep's field routes through whichever gap is open.
      this.press = damp(this.press || 0, 0, 5, dt);
      invade(this, dt, game, mode, mode.swarmSpeed(true), 5.2, false, entrance && (entrance.outside || entrance));
      return;
    }

    if (!entrance) { this.state = CROWD.LEAVE; return; }
    if (goForCaptain(this, dt, game, mode, mode.swarmSpeed(false) * this.gait * SORTIE.chaseMul, 5.2)) {
      this.press = damp(this.press, 0, 5, dt);
      return;
    }
    const spot = survivalSpot(entrance, this.index, 72);
    const targetX = spot.x + this.jx * 0.25;
    const targetY = spot.y + this.jy * 0.25;
    const d = dist(this.x, this.y, targetX, targetY);
    const speed = mode.swarmSpeed(false) * this.gait;
    if (d > 10) {
      this.state = CROWD.MARCH;
      if (d > 120) approachDoor(this, dt, game, mode, entrance, { x: targetX, y: targetY }, speed, 4.8);
      else stepToward(this, dt, game, targetX, targetY, speed, 4.8);
      this.press = damp(this.press, 0, 5, dt);
    } else {
      settle(this, dt, 7);
      this.state = CROWD.PRESS;
      this.press = damp(this.press, 1, 5, dt);
      this.angle = Math.atan2(entrance.y - this.y, entrance.x - this.x);
    }
  }

  _stepToward(dt, game, tx, ty, speed, accel) {
    stepToward(this, dt, game, tx, ty, speed, accel);
    return true;
  }
}

/** Individual, durable zombie: hunts the Hunter outside the banner, else the keep. */
class SurvivalIndividualZombie extends Zombie {
  constructor(x, y, entrance, day, index = 0) {
    super(x, y, { entranceId: entrance && entrance.id });
    this._survivalType = 'individual';
    this._crowd = false;
    this.type = { ...this.type, name: 'ZOMBIE', hp: 118 + day * 14, speed: 58, huntSpeed: 72, contactDamage: 12 + day * 2, doorDamage: 8 };
    this.hp = this.hpMax = this.type.hp;
    this.radius = 15;
    this.entranceId = entrance && entrance.id;
    this.waveIndex = index;
    this.attackCd = 1.2;
    this.alpha = 0.95;
    this.survival = true;
    this.hitEvery = 1.55;
    this.hitDamage = this.type.contactDamage;
    this.hitKind = 'bite';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (commonPreamble(this, dt, game)) return;
    if (fleeing(this, dt, game, 'march')) return;
    const mode = game.survival;
    let entrance = mode.entranceById(this.entranceId);
    const inside = trackInside(this, game);
    const slow = 1;
    this.attackCd -= dt;
    // Outside: the assigned door; if it is intact, batter it; once any door
    // is open, the flow field routes through the nearest gap.
    const open = mode.nearestBrokenDoor(this.x, this.y);
    if (open) { entrance = open; this.entranceId = open.id; }
    if (!entrance) entrance = mode.chooseTargetEntrance(this.x, this.y);
    if (inside || (entrance && entrance.broken)) {
      invade(this, dt, game, mode, this.type.huntSpeed * slow, 5.2, true, entrance && (entrance.outside || entrance));
      return;
    }
    if (goForCaptain(this, dt, game, mode, this.type.huntSpeed * slow, 5.2)) return;
    if (!entrance) return;
    this.entranceId = entrance.id;
    const out = entrance.outside || entrance;
    const d = dist(this.x, this.y, out.x, out.y);
    if (d > 54) {
      approachDoor(this, dt, game, mode, entrance, out, this.type.speed * slow, 5.2);
      this.state = 'march';
      return;
    }
    settle(this, dt);
    this.state = this.attackCd < 0.4 ? 'strike' : 'press';
    this.angle = Math.atan2(entrance.y - this.y, entrance.x - this.x);
    if (this.attackCd <= 0) {
      this.attackCd = 2.1;
      mode.damageEntrance(entrance, this.type.doorDamage || 8, this);
    }
  }

  _survivalMove(dt, game, tx, ty, speed) {
    stepToward(this, dt, game, tx, ty, speed, 5.2);
    this.state = 'march';
  }
}

/** Day-2 wall specialist: doors first (next intact one after a breach), then the keep. */
class SurvivalBreaker extends Zombie {
  constructor(x, y, entrance, day, index = 0) {
    super(x, y, { entranceId: entrance && entrance.id });
    this._survivalType = 'breaker';
    this._crowd = false;
    this.key = 'zombie'; // uses the authored demon.glb zombie role
    this.type = { ...this.type, name: 'BREAKER', hp: 250 + Math.max(0, day - 2) * 55, speed: 48, doorDamage: 31 + day * 3 };
    this.hp = this.hpMax = this.type.hp;
    this.radius = 19;
    this.entranceId = entrance && entrance.id;
    this.targetKind = 'wall';
    this.targetEntranceId = entrance && entrance.id;
    this.breakerIndex = index;
    this.attackCd = 1.5 + index * 0.3;
    this.alpha = 1;
    this.tint = '#a66b38';
    this.variant = 'survival-breaker';
    this.hitEvery = 1.9;
    this.hitDamage = 18 + day * 2;
    this.hitKind = 'slam';
    this.keepCd = null;
    this.attackingKeep = false;
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.attackingKeep = false;
    this.state = ESTATE.DYING;
    this.deathT = 0;
    if (game && game.onEnemyKilled) game.onEnemyKilled(this);
  }

  update(dt, game) {
    this.stateT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (commonPreamble(this, dt, game)) return;
    if (fleeing(this, dt, game, 'march')) return;
    const mode = game.survival;
    const inside = trackInside(this, game);
    const speed = this.type.speed;
    // Deliberately do not inspect player LOS/visibility: the objective is a
    // structure. A broken target hands over to the next intact door; with no
    // door left standing it walks in and goes for the keep.
    let target = mode.entranceById(this.targetEntranceId);
    if (!target || target.broken) {
      const next = mode.nextIntactDoor(this.x, this.y);
      if (next) { target = next; this.targetKind = 'wall'; }
      else { target = null; this.targetKind = 'keep'; }
      this.targetEntranceId = target && target.id;
      this.entranceId = this.targetEntranceId || this.entranceId;
    }
    if (inside || !target) {
      const gap = inside ? null : mode.nearestBrokenDoor(this.x, this.y);
      this.attackCd -= dt;
      invade(this, dt, game, mode, speed, 4.2, false, gap && (gap.outside || gap));
      return;
    }
    const out = target.outside || target;
    const d = dist(this.x, this.y, out.x, out.y);
    if (d > 62) {
      approachDoor(this, dt, game, mode, target, out, speed, 4.2);
      this.state = 'march';
      return;
    }
    settle(this, dt);
    this.attackCd -= dt;
    this.state = this.attackCd < 0.5 ? 'strike' : 'press';
    this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.attackCd <= 0 && !target.broken) {
      this.attackCd = Math.max(2.2, 3.4 - mode.day * 0.25);
      mode.damageEntrance(target, this.type.doorDamage, this);
    }
  }
}

/**
 * BFS distance field on the Mansion nav grid. One field per goal (the keep,
 * the Hunter, each door lane); enemies read a direction in O(1) instead of
 * each running its own path search, which keeps a 30-body wave cheap on
 * phones. The keep's field has many goals (a ring around its wall), so every
 * body walks to the nearest side of the tower instead of queueing at one.
 */
class FlowField {
  constructor(mansion) {
    this.m = mansion;
    this.size = 0;
    this.dist = null;
    this.queue = null;
    this.version = -1;
    this.goalCell = -1;
    this.builtAt = -1;
    this.out = { x: 0, y: 0 };
  }

  build(x, y, version) { return this.buildMulti([{ x, y }], version); }

  buildMulti(points, version) {
    const m = this.m;
    const size = m.navW * m.navH;
    if (size !== this.size) {
      this.size = size;
      this.dist = new Int32Array(size);
      this.queue = new Int32Array(size);
    }
    this.version = version;
    const d = this.dist;
    d.fill(-1);
    const w = m.navW, h = m.navH, nav = m.nav, q = this.queue;
    let head = 0, tail = 0;
    this.goalCell = -1;
    for (const point of points) {
      const goal = m.navNearest(point.x, point.y, 6);
      if (!goal) continue;
      const cell = goal.gy * w + goal.gx;
      if (d[cell] === 0) continue;
      d[cell] = 0;
      q[tail++] = cell;
      if (this.goalCell < 0) this.goalCell = cell;
    }
    if (this.goalCell < 0) return false;
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % w, cy = (cur - cx) / w;
      const nd = d[cur] + 1;
      if (cx + 1 < w && d[cur + 1] < 0 && nav[cur + 1] === 0) { d[cur + 1] = nd; q[tail++] = cur + 1; }
      if (cx > 0 && d[cur - 1] < 0 && nav[cur - 1] === 0) { d[cur - 1] = nd; q[tail++] = cur - 1; }
      if (cy + 1 < h && d[cur + w] < 0 && nav[cur + w] === 0) { d[cur + w] = nd; q[tail++] = cur + w; }
      if (cy > 0 && d[cur - w] < 0 && nav[cur - w] === 0) { d[cur - w] = nd; q[tail++] = cur - w; }
    }
    return true;
  }

  _best(gx, gy, here) {
    const m = this.m, w = m.navW, h = m.navH, d = this.dist;
    let best = -1, bestD = here >= 0 ? here : 1e9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = gx + ox, ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        const nd = d[ni];
        if (nd < 0 || nd >= bestD) continue;
        if (ox && oy && (d[gy * w + nx] < 0 || d[ny * w + gx] < 0)) continue; // no corner cutting
        best = ni; bestD = nd;
      }
    }
    return best;
  }

  /** Unit vector toward the goal, or null outside the grid / at the goal. */
  dirAt(x, y) {
    const m = this.m;
    if (this.goalCell < 0 || !this.dist) return null;
    const gx = Math.floor((x - m.navX0) / m.navCell);
    const gy = Math.floor((y - m.navY0) / m.navCell);
    const w = m.navW;
    if (gx < 0 || gy < 0 || gx >= w || gy >= m.navH) return null;
    const idx = gy * w + gx;
    const here = this.dist[idx];
    if (here === 0) return null;
    const first = this._best(gx, gy, here);
    if (first < 0) return null;
    let aim = first;
    const fx = first % w, fy = (first - fx) / w;
    const second = this._best(fx, fy, this.dist[first]);
    if (second >= 0 && here >= 0) aim = second;
    const ax = m.navX0 + ((aim % w) + 0.5) * m.navCell;
    const ay = m.navY0 + (Math.floor(aim / w) + 0.5) * m.navCell;
    const dx = ax - x, dy = ay - y;
    const len = Math.hypot(dx, dy) || 1;
    this.out.x = dx / len; this.out.y = dy / len;
    return this.out;
  }
}

/**
 * Soldiers (survivors) are the keep's garrison. By day they stand around the
 * keep (the count the HUD shows is people you can see); by night each one
 * walks to the door under the most pressure and shoots through its slit.
 *
 * They can be hurt, by the same rules as the Hunter: a body that gets inside
 * (a breach) claws a guard standing in its way, and outside the banner's
 * rooms it also goes for a guard close by — a few per guard, the rest keep
 * walking to the keep. So a guard holding a door inside the banner is fairly
 * safe and one holding a door beyond it is not. A badly hurt guard falls back
 * to the keep; one that drops stays down where it fell and stops shooting.
 * The Hunter helps a fallen guard up by standing beside it; one left alone
 * for `bleedOut` seconds is lost (one soldier fewer, for good). Dawn gets
 * everyone still down back up. Losing the run is only the keep or the Hunter.
 */
/** Who landed the killing blow (R19 "the building MVP", R1 run summary). */
export const KILL_SOURCES = Object.freeze(['captain', 'guard', 'tower', 'keep', 'flare']);
const freshKillsBy = () => ({ captain: 0, guard: 0, tower: 0, keep: 0, flare: 0 });
function freshNightStats() {
  // breached: gate ids in the order they gave way tonight (R4's tip);
  // spawned: bodies tonight's spawners sent (BUILD 16: a night is cleared
  // only once something came and none of it stands)
  return { kills: 0, hits: 0, damageToWalls: 0, keepDamage: 0, mined: 0, by: freshKillsBy(), breached: [], flares: 0, keepMin: 1, spawned: 0 };
}
/**
 * The whole run (three nights): the end panel's numbers. keepMin is the
 * lowest share of HP the keep fell to (R2's stars), lost the guards nobody
 * helped up, towers the kills per ballista circle (R19's MVP), time the
 * seconds played (nights and days, pause excluded).
 */
function freshRunStats() {
  return { kills: 0, by: freshKillsBy(), mined: 0, sawn: 0, recruited: 0, nights: 0, keepMin: 1, lost: 0, towers: {}, time: 0, cleared: 0, saved: 0 };
}
/** A save-safe copy of a stats object (its nested tallies copied too). */
function cloneStats(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats || {})) out[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v);
  return out;
}
/** A kill's source from the bolt owner (or 'flare') that hit the body last. */
function killSource(game, by) {
  if (by === 'flare') return 'flare';
  if (!by || by === game.player) return 'captain';
  if (by.key === 'guard') return 'guard';
  if (by.key === 'tower') return 'tower';
  if (by.key === 'keep') return 'keep';
  return 'captain';
}
/** The colour of a hit by source: warm for the captain, cool for guards, hot for ballistas. */
/**
 * BUILD 13 (V9, docs/VISUAL-LAYOUT-RESEARCH.md §7: "angka damage lebih
 * kecil, naik di atas kepala, angka berurutan digabung"): about two thirds of
 * BUILD 12's sizes, starting over the head instead of at the chest, and the
 * hits one body takes within `merge` seconds add up in one number that pops
 * again. The hit itself (flash, ring, sparks, knockback) carries the impact.
 */
export const DMG_NUMBER = Object.freeze({
  size: Object.freeze({ kill: 26, heavy: 22, held: 18, hit: 16 }),
  pop: Object.freeze({ kill: 1.45, heavy: 1.35, hit: 1.25 }),
  head: 1.55,   // × the chest height
  merge: 0.38,  // s since the number's last hit
  life: 0.9,
  linger: 0.7,  // s a merged number stays after its last hit
});
const DMG_RANK = Object.freeze({ hit: 0, held: 1, heavy: 2, kill: 3 });

function styleDamageNumber(f) {
  f.kind = f.grade === 'kill' ? 'kill' : f.grade === 'heavy' ? 'heavy' : 'hit';
  f.color = f.grade === 'kill' ? '#ff9a3c' : f.held ? '#ffd24a' : '#ffffff';
  f.size = DMG_NUMBER.size[f.grade];
  f.pop = DMG_NUMBER.pop[f.kind];
  f.text = `${Math.round(f.sum)}`;
}

const HIT_COLOR = Object.freeze({ captain: '#ffd36a', guard: '#8fe3ff', tower: '#ff8a3a', keep: '#ff8a3a', flare: '#fff2b0' });

/**
 * THE END OF A RUN (UX-REPLAY-RESEARCH §5 P0: R1 summary, R2 stars, R3
 * records, R4 the near miss and its tip, R19 the MVP).
 *
 * Stars rate a won run by how the keep held, the way Kingdom Rush rates a
 * level by the lives left: one for holding three nights, two when the keep
 * never fell below half, three when no guard was lost as well. A lost run
 * has none; it shows how close dawn was and one tip read off what really
 * happened.
 */
export const RUN_STARS = Object.freeze({ keepMin: 0.5 });
export function survivalStars(won, stats) {
  if (!won) return 0;
  const keepMin = stats && Number.isFinite(stats.keepMin) ? stats.keepMin : 1;
  if (keepMin < RUN_STARS.keepMin) return 1;
  return stats && stats.lost > 0 ? 2 : 3;
}
/** BUILD 19 (R9): the watch ladder — earned star totals colour the captain.
 * Cumulative on purpose: every closed run banks its stars (win or lose), so
 * the end panel always names a next thing to work toward. A fixed ladder,
 * never a draw of cards: the panel says the colour and the stars to it. */
export const UNLOCK_TIERS = [
  { stars: 0, id: 'azure', name: 'AZURE WATCH', royal: 0x216aad },
  { stars: 3, id: 'iron', name: 'IRON WATCH', royal: 0x9aa7b4 },
  { stars: 6, id: 'crimson', name: 'CRIMSON WATCH', royal: 0xc03444 },
  { stars: 9, id: 'gold', name: 'GOLD WATCH', royal: 0xe0b04f },
];
/** The tier a cumulative star total has reached (never null). */
export const unlockTierFor = (total) => {
  let tier = UNLOCK_TIERS[0];
  for (const t of UNLOCK_TIERS) if ((total || 0) >= t.stars) tier = t;
  return tier;
};

/** Best results across runs (save.survival.records); PLAY AGAIN keeps them. */
function freshRecords() {
  return { runs: 0, wins: 0, bestStars: 0, bestNights: 0, bestKills: 0, totalKills: 0, totalStars: 0 };
}
const SIDE_NAMES = Object.freeze({ north: 'NORTH', south: 'SOUTH', east: 'EAST', west: 'WEST', northwest: 'NW', southeast: 'SE' });
const GATE_NAMES = Object.freeze({ northGate: 'NORTH', southGate: 'SOUTH', eastGate: 'EAST', westGate: 'WEST', posternNW: 'NW', posternSE: 'SE' });
/** A door as the wave call-out names it: "NORTH GATE", "SE POSTERN" (BUILD 16, R6). */
export function gateLabel(entrance) {
  if (!entrance) return '';
  const short = GATE_NAMES[entrance.id];
  if (!short) return String(entrance.name || '').toUpperCase();
  return /^postern/i.test(entrance.id) ? `${short} POSTERN` : `${short} GATE`;
}
/**
 * The same door in as few words as the space allows (BUILD 17, R8's dusk
 * call): `wide` keeps the wave call's wording ("NW POSTERN"), `short` drops
 * "GATE" ("NW POSTERN" stays, a postern needs the word), `tiny` is the side
 * alone ("NW"). The chip in the day HUD picks the first that fits.
 */
export function gateShort(entrance, tier = 'wide') {
  if (!entrance) return '';
  const side = GATE_NAMES[entrance.id];
  if (!side) return String(entrance.name || '').toUpperCase();
  if (/^postern/i.test(entrance.id)) return tier === 'tiny' ? side : `${side} POSTERN`;
  if (tier === 'wide') return `${side} GATE`;
  return side;
}
/**
 * A run's rotation is chosen from a seed, never from `Math.random`
 * (BUILD 17, R8): drawing from the game's random stream would shift every
 * roll after it, so a seeded balance run would no longer be the same run.
 * The seed is stored in the save, so a reload mid-run keeps the rotation the
 * day HUD promised, and the tools pass their own (`?seed=`, or
 * `window.DUSKHOLD_SEED` in node) to measure a run again.
 */
export function mixSeed(n) {
  let x = Math.round(Number(n)) || 1;
  x = Math.imul(x ^ (x >>> 15), 0x2545f491) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0x9e3779b1) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
/**
 * The run's MVP (R19): the part of the garrison the player raised that
 * brought down the most — one ballista by its circle, the keep's roof
 * ballista, or the guards. The captain is the player, never the MVP (his
 * share is on the crew row): the line exists to make the build felt, and in
 * every balance bot that defends, the captain takes most of the kills. A tie
 * goes to the ballista listed first. Null when the garrison killed nothing.
 */
export function survivalMvp(stats) {
  const by = (stats && stats.by) || {};
  const rows = [];
  for (const [slotId, kills] of Object.entries((stats && stats.towers) || {})) {
    rows.push({ id: slotId, icon: 'tower', name: `${SIDE_NAMES[String(slotId).split(':')[0]] || 'GATE'} BALLISTA`, kills: kills || 0 });
  }
  rows.push({ id: 'keep', icon: 'keep', name: 'KEEP BALLISTA', kills: by.keep || 0 });
  rows.push({ id: 'guard', icon: 'guard', name: 'GUARDS', kills: by.guard || 0 });
  let best = null;
  for (const row of rows) if (row.kills > 0 && (!best || row.kills > best.kills)) best = row;
  return best;
}

export const GUARD = Object.freeze({
  speed: 210,          // px/s walking between posts
  range: 420,          // px a guard will shoot at
  every: 1.6,          // s between shots
  damage: 10,          // per bolt (x1.5 inside the banner's yards, like the Hunter's)
  boltSpeed: 640,
  perDoor: 2,          // most guards one door takes before the next door gets one
  cap: 8,              // most guards on the map (== maxSurvivors)
  hp: 40,              // a survivor is no Hunter (100+): 3-4 claws in the dark
  reach: 12,           // px past both bodies' radii a claw lands from
  woundedAt: 0.35,     // at or below this share of HP a guard falls back to the keep
  rescueRange: 70,     // px from a fallen guard the Hunter stands to help him up
  rescueTime: 1.5,     // s he stays there
  rescueHp: 0.5,       // share of HP a guard gets up with
  bleedOut: 20,        // s a fallen guard holds on alone (the clock stops while helped)
  iframes: 0.5,        // s after a claw before the next one lands (the Hunter has 0.75)
  huntRange: 110,      // px: beyond the banner a body this close goes for a guard (Hunter: 170)
  maxHunters: 3,       // bodies going for one guard at once
  climb: 0.7,          // s up (or down) the ladder to a post on the wall (BUILD 10)
  climbShare: 0.75,    // of that, going up the ladder; the rest is the step onto the post (world3d.js)
  upRange: 460,        // px a guard up on the wall shoots at (the height buys reach)
});

/**
 * BUILD 10 (playtest 2026-10-17: "gerbang selalu tertutup tapi tembakan
 * tetap kena ... untuk menghadapi musuh harus di luar benteng"): a shut gate
 * stops every shot, so the captain fights by going out. A gate swings open
 * for him as he walks into its mouth and shuts once he is through; it never
 * opens for the horde (mansion.resolve holds a body until the gate breaks).
 * Out there, or standing in an open gate, he is fair game: the nearest
 * bodies leave the gate and go for him. Only what stands high — a ballista,
 * the keep's roof, a guard up on the wall — shoots over the wall.
 */
export const SORTIE = Object.freeze({
  // px either side of the wall line that counts as "in the gate": less than
  // where a shut gate stops him (its half thickness 13 + his radius 13), so
  // only walking through an opening gate gets him there (BUILD 11)
  band: 24,
  near: 84,            // px from the wall line a walk toward the gate starts the swing
  toward: 0.35,        // share of the stick's heading toward the wall that counts as walking at it
  openTime: 0.35,      // s for the leaf to swing open
  holdTime: 0.4,       // s it stays open once he is clear
  closeTime: 0.5,      // s for it to swing shut
  aggro: 155,          // px: a body outside this close to an exposed captain goes for him
  leash: 70,           // px more before one already on him gives up
  maxOnCaptain: 6,     // bodies going for him at once
  gateReach: 28,       // px a claw reaches through the open gate (the barrier holds the body)
  chaseMul: 1.3,       // a swarm body's chase vs. its march outside (his run is 196 px/s)
  restDelay: 1.5,      // s behind the wall without a claw before he gets his breath back
  rest: 12,            // HP/s he gets back behind the wall (a sortie, then a breather)
});

class SurvivalGuard {
  constructor(index, x, y) {
    this.id = 5000000 + index;
    this.index = index;
    this.key = 'guard';
    this.x = x; this.y = y;
    this.angle = -Math.PI / 2;
    this.radius = 12;
    this.type = { boltSpeed: GUARD.boltSpeed, boltDamage: GUARD.damage };
    this.cd = 0.5 + index * 0.23;  // staggered so a pair never fires in lockstep
    this.post = null;              // { key, x, y, doorId }
    this.path = null;
    this.pathI = 0;
    this.moving = false;
    this.shotT = 0;                // recoil, for the 3D pawn
    this.walkT = 0;
    this.target = null;
    this.hpMax = GUARD.hp;
    this.hp = GUARD.hp;
    this.down = false;             // dropped: lies where it fell, no shots
    this.downT = 0;
    this.rescueT = 0;              // how long the Hunter has stood beside it
    this.hurtFlash = 0;
    this.iframes = 0;
    this.lift = 0;                 // 0 on the ground .. 1 up on a wall post (BUILD 10)
    this.liftPost = null;          // the wall post it is on / climbing (fortress.wallPosts)
  }

  /** Up on the wall (or most of the way up the ladder): out of every claw's reach. */
  get up() { return this.lift > 0.3; }
}

export class SurvivalMode {
  constructor(game, options = {}) {
    this.game = game;
    this.tuning = SURVIVAL_TUNING;
    this.phase = 'night';
    this.day = 1;
    this.elapsed = 0;
    this.nightDuration = clampDuration(options.nightDuration || (game.save.survival && game.save.survival.nightDuration));
    this.gold = this.tuning.startGold;
    this.wood = this.tuning.startWood;
    this.survivors = this.tuning.startSurvivors;
    this.keepLevel = 1;
    this.keepHp = this.tuning.keepHp[1];
    this.buildings = {};
    this.buildingLevels = {};
    this.hunterLevel = 1;
    this.armsLevel = 1;
    this.gateBuilt = false;
    this.gateHp = 0;
    this.builderJob = null;
    this.selectedRoom = null;
    this.nightsCompleted = 0;
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = freshNightStats();
    // BUILD 17 (R8): the run's own rotation seed. Set here from the caller
    // (?seed=, or window.DUSKHOLD_SEED in node), then overwritten by the save
    // in _restore so a reload keeps the rotation the day HUD promised.
    this.seedBase = Number.isFinite(Number(options.seed)) && options.seed != null
      ? Math.round(Number(options.seed))
      : (typeof window !== 'undefined' && Number.isFinite(Number(window.DUSKHOLD_SEED)) && window.DUSKHOLD_SEED != null
        ? Math.round(Number(window.DUSKHOLD_SEED)) : null);
    this.runSeed = 0;
    this.runCount = 0;             // how many runs this mode has opened (a restart rotates)
    this.cleared = null;           // BUILD 16 (R5): { at, dawnAt, saved, bonus } once tonight is cleared
    this.stragglers = null;        // BUILD 16 (R5): { at, count } once tonight is down to its last few
    this.lastRewards = null;
    this.skillCooldown = 0;
    this.skillCooldownMax = this.tuning.skillCooldown;
    this.skillFlash = 0;
    this._saveT = 0;
    this._lastGateOpen = null;
    this._savedDurationOverride = options.nightDuration || null;
    this.uiClock = 0;
    // the player's drag on the camera (world px off the captain) — _steerCamera
    this.camPan = { x: 0, y: 0 };
    this._recenter = false;
    this._userZoom = null;
    this.guards = [];
    this.towers = [];
    this.floaters = [];
    this.fx = [];                  // one-shot 3D effects for world3d (pushFx)
    this.hudPops = [];             // income beside the HUD counters (pushHudPop)
    this.runStats = freshRunStats();
    this._mineBank = Object.create(null);
    this.bannerQueue = [];
    this.banner = null;
    this.keepAttackers = 0;
    this.keepBallista = { cd: 0.6, aim: Math.PI / 2, angle: Math.PI / 2, shotT: 0, target: null, shots: 0 };
    this.rewardAck = 0;
    this.dayFocus = null;
    this.walkPath = null;          // day: tap a far circle and the Hunter walks there
    this.hitStop = 0;              // s the night holds still on a heavy kill
    this._doorPressure = new Map();
    this._breachAt = Object.create(null);
    this._fields = new Map();
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._keepHitAt = -99;
    this._keepWarnAt = -99;
    this._keepLowWarned = false;
    // the K1 bookends (CINE): only a real run asks for them (main.js; QA
    // passes ?cine=0); a node harness that never opts in plays straight
    this.cinematics = options.cinematics === true;
    this.cine = null;              // { kind: 'intro' | 'arrival', t, dur, keys, night }
    this.reinforcements = null;    // the relief column (victory)
    this.records = freshRecords();  // best results across runs (R3)
    this._newBanner = null;         // R9: the tier this run just crossed
    this.runResult = null;          // how the last run ended (stars, MVP, tip)
    this._restore(game.save.survival || freshProgress(this.nightDuration));
    this.applyHunterStats(false);
    this._configureMansion();
    this._applyEntranceState();
    this.applyBuildingEffects(false);
    this.game.mansion.buildNav();
    this.game.survivalBakeDirty = true;
    this._syncGuardRoster(true);
    this._applyGuardState();
    this._syncTowers();
    if (this.phase === 'night' && this.elapsed < 1) this._nightIntro();
    // a run that was won stays won on reload: the column stands at the keep
    if (this.phase === 'complete') this.reinforcements = this._reliefColumn(true);
  }

  _restore(saved) {
    const base = freshProgress(this.nightDuration);
    const s = { ...base, ...(saved || {}) };
    if (this._savedDurationOverride) s.nightDuration = this._savedDurationOverride;
    this.day = clamp(Math.round(Number(s.day) || 1), 1, 3);
    this.phase = ['night', 'day', 'complete', 'failed'].includes(s.phase) ? s.phase : 'night';
    this.elapsed = clamp(Number(s.elapsed) || 0, 0, this.nightDuration);
    this.nightDuration = clampDuration(s.nightDuration || this.nightDuration);
    // pre-K1 saves: Oil was the purse, the Perapian the heart
    const gold = saved && saved.gold == null && saved.oil != null ? saved.oil : s.gold;
    this.gold = clamp(Math.floor(Number(gold) || 0), 0, RESOURCE_CAP);
    this.wood = clamp(Math.floor(Number(s.wood) || 0), 0, RESOURCE_CAP);
    this.survivors = clamp(Math.floor(Number(s.survivors) || 0), 0, 99);
    const level = saved && saved.keepLevel == null && saved.perapianLevel != null ? saved.perapianLevel : s.keepLevel;
    this.keepLevel = clamp(Math.round(Number(level) || 1), 1, 3);
    const hp = saved && saved.keepHp != null ? Number(saved.keepHp) : NaN;
    this.keepHp = Number.isFinite(hp) ? clamp(hp, 0, this.keepHpMax()) : this.keepHpMax();
    this.buildings = {};
    this.buildingLevels = {};
    // Typed circles: a building lives on the circle of its own type. Saves
    // from the house (room-keyed circles) move each building onto a free
    // circle of the same type in the bailey, keeping its level — inside the
    // banner first, in circle order.
    const levels = s.buildingLevels && typeof s.buildingLevels === 'object' ? s.buildingLevels : {};
    if (s.buildings && typeof s.buildings === 'object') {
      const homeless = [];
      for (const [key, raw] of Object.entries(s.buildings)) {
        const type = TYPE_MIGRATE[raw] || raw;
        if (!SURVIVAL_BUILDINGS[type]) continue;
        const level = clamp(Math.round(Number(levels[key]) || 1), 1, BUILDING_MAX_LEVEL);
        const id = type === 'tower' && !String(key).endsWith(':tower') ? `${key}:tower` : key;
        const slot = SLOT_BY_ID.get(id);
        if (!slot || slot.type !== type || this.buildings[id]) { homeless.push({ type, level }); continue; }
        this.buildings[id] = type;
        this.buildingLevels[id] = level;
      }
      const open = (slot) => (slot.level <= this.keepLevel ? 1 : 0);
      const order = [...SURVIVAL_SLOTS].sort((a, b) => open(b) - open(a));
      for (const old of homeless) {
        const slot = order.find((c) => c.type === old.type && !this.buildings[c.id]);
        if (!slot) continue;
        this.buildings[slot.id] = old.type;
        this.buildingLevels[slot.id] = old.level;
      }
    }
    this.hunterLevel = clamp(Math.round(Number(s.hunterLevel) || 1), 1, HUNTER_MAX_LEVEL);
    this.armsLevel = clamp(Math.round(Number(s.armsLevel) || 1), 1, ARMS_MAX_LEVEL);
    this.gateBuilt = !!s.gateBuilt;
    this.gateHp = Math.max(0, Number(s.gateHp) || 0);
    let job = s.builderJob && typeof s.builderJob === 'object' ? { ...s.builderJob } : null;
    if (job) {
      if (job.kind === 'perapian') { job.kind = 'keep'; job.type = 'keep'; }
      if (TYPE_MIGRATE[job.type]) job.type = TYPE_MIGRATE[job.type];
      if ((job.kind === 'building' || job.kind === 'upgrade') && !job.slotId) {
        job.slotId = job.type === 'tower' && job.roomId ? `${job.roomId}:tower` : job.roomId;
      }
      if ((job.kind === 'building' || job.kind === 'upgrade') && !SLOT_BY_ID.has(job.slotId)) job = null;
    }
    this.builderJob = job;
    this.selectedRoom = s.selectedRoom || null;
    this.nightsCompleted = clamp(Math.floor(Number(s.nightsCompleted) || 0), 0, 3);
    this.waveIndex = Math.max(0, Math.floor(Number(s.waveIndex) || 0));
    this.breakerIndex = Math.max(0, Math.floor(Number(s.breakerIndex) || 0));
    this.individualIndex = Math.max(0, Math.floor(Number(s.individualIndex) || 0));
    this.nightKeepStart = Number.isFinite(Number(s.nightKeepStart)) && s.nightKeepStart != null ? Number(s.nightKeepStart) : null;
    this.siegeTimers = s.siegeTimers && typeof s.siegeTimers === 'object' ? { ...s.siegeTimers } : {};
    this.nightStats = { ...freshNightStats(), ...(s.nightStats || {}) };
    const cl = s.cleared;
    this.cleared = this.phase === 'night' && cl && Number.isFinite(Number(cl.at)) && Number.isFinite(Number(cl.dawnAt))
      ? { at: Number(cl.at), dawnAt: Number(cl.dawnAt), saved: Math.max(0, Math.floor(Number(cl.saved) || 0)), bonus: Math.max(0, Math.floor(Number(cl.bonus) || 0)), fled: Math.max(0, Math.floor(Number(cl.fled) || 0)) }
      : null;
    this.nightStats.by = { ...freshKillsBy(), ...((s.nightStats && s.nightStats.by) || {}) };
    this.nightStats.breached = Array.isArray(this.nightStats.breached) ? this.nightStats.breached.slice() : [];
    this.runStats = { ...freshRunStats(), ...(s.runStats || {}) };
    this.runStats.by = { ...freshKillsBy(), ...((s.runStats && s.runStats.by) || {}) };
    this.runStats.towers = { ...((s.runStats && s.runStats.towers) || {}) };
    this.records = { ...freshRecords(), ...(s.records && typeof s.records === 'object' ? s.records : {}) };
    // BUILD 17 (R8): the run's gate rotation. A save that has one keeps it —
    // a reload mid-run must come back to the night the day HUD announced; a
    // save from before the rotation (or a fresh one) opens a run of its own.
    this.runCount = Math.max(0, Math.floor(Number(s.runCount) || 0));
    const savedSeed = Math.round(Number(s.runSeed));
    this.runSeed = Number.isFinite(savedSeed) && savedSeed > 0 ? savedSeed : this.newRunSeed();
    this.runResult = (this.phase === 'complete' || this.phase === 'failed') && s.runResult && typeof s.runResult === 'object'
      ? cloneStats(s.runResult) : null;
    this.lastRewards = s.lastRewards || null;
    this.rewardAck = Math.max(0, Math.floor(Number(s.rewardAck) || 0));

    const g = this.game;
    // the Hunter's health track first: a saved 130 HP must not be clamped
    // to a Lv1 bar before the level is known
    g.player.bloodMax = this.hunterStats().hp;
    const pos = s.player;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      g.player.x = pos.x; g.player.y = pos.y;
      if (Number.isFinite(pos.blood)) g.player.blood = clamp(pos.blood, 1, g.player.bloodMax);
      if (Number.isFinite(pos.angle)) g.player.angle = pos.angle;
    } else {
      const home = this.hunterHome();
      g.player.x = home.x; g.player.y = home.y;
      g.player.angle = -Math.PI / 2;
    }
    g.player.weapon = 'shot';
    g.player.blood = Math.max(1, g.player.blood || g.player.bloodMax);
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.time = this.elapsed;
    g.timeLeft = this.nightDuration - this.elapsed;
    g.phase = this.daylight() ? DAY_PHASE : NIGHT_PHASE;
    g.nightDuration = this.nightDuration;
    g.survival = this;

    this._restoreEnemies(Array.isArray(s.enemies) ? s.enemies : []);
    this._savedEntrances = Array.isArray(s.entrances) ? s.entrances : null;
    this._savedGuards = this.phase === 'night' && Array.isArray(s.guards) ? s.guards : null;
  }

  /** After the roster is rebuilt on load: put back each guard's wounds. */
  _applyGuardState() {
    const rows = this._savedGuards;
    this._savedGuards = null;
    if (!rows) return;
    this.guards.forEach((guard, i) => {
      const row = rows[i];
      if (!row) return;
      guard.hp = clamp(Number(row.hp), 0, guard.hpMax);
      if (!Number.isFinite(guard.hp)) guard.hp = guard.hpMax;
      guard.down = !!row.down || guard.hp <= 0;
      if (guard.down) {
        guard.hp = 0;
        guard.rescueT = clamp(Number(row.rescueT) || 0, 0, GUARD.rescueTime);
        guard.downT = clamp(Number(row.downT) || 0, 0, GUARD.bleedOut - 0.5);
        if (Number.isFinite(row.x) && Number.isFinite(row.y)) { guard.x = row.x; guard.y = row.y; }
      }
    });
  }

  _restoreEnemies(rows) {
    const g = this.game;
    g.enemies.length = 0;
    for (const row of rows) {
      if (!row || !Number.isFinite(row.x) || !Number.isFinite(row.y)) continue;
      const e = this._makeEnemy(row.kind, row.x, row.y, row.entranceId, row.index || 0);
      if (!e) continue;
      for (const key of ['id', 'hp', 'hpMax', 'state', 'stateT', 'angle', 'vx', 'vy', 'alpha', 'dead', 'deathT', 'attackCd', 'press', 't']) {
        if (row[key] != null) e[key] = row[key];
      }
      if (row.targetEntranceId) e.targetEntranceId = row.targetEntranceId;
      if (row.targetKind) e.targetKind = row.targetKind === 'perapian' ? 'keep' : row.targetKind;
      // a body that already crossed a doorway keeps walking to the keep
      // instead of turning back toward its door after a reload
      if (row.inHouse) e._inHouse = true;
      const keepCd = row.keepCd != null ? row.keepCd : row.feedCd;
      if (Number.isFinite(keepCd)) e.keepCd = keepCd;
      if (Number.isFinite(row.staggerT)) e.staggerT = row.staggerT;
      if (e._crowd) e.index = Number(row.index) || 0;
      g.enemies.push(e);
    }
  }

  /** The bake is phase-tinted (cool night / warm day); rebake on change. */
  _syncBakePhase() {
    const m = this.game.mansion;
    const want = this.daylight() ? 'day' : 'night';
    if (m.survivalPhase !== want) {
      m.survivalPhase = want;
      this.game.survivalBakeDirty = true;
    }
  }

  /**
   * K1: the inner ward's middle belongs to the keep. Any house fixtures go
   * dark (the legacy house only), a warm lamp marks the keep's lit window,
   * and the tower is solid: bodies, bolts and the Hunter walk around it.
   */
  _configureMansion() {
    const m = this.game.mansion;
    m.survivalLighting = true;
    this._syncBakePhase();
    m.props = (m.props || []).filter((prop) => !(prop.room === ROOM.HALL && (prop.type === 'candelabra' || prop.type === 'carpet')));
    for (const prop of m.props || []) {
      if (prop.type === 'carpet' && (prop.color === 'dark' || prop.color === 'crimson')) prop.color = 'rose';
      else if (prop.type === 'carpet' && prop.color === 'purple') prop.color = 'violet';
    }
    for (const light of m.lights) { light.i = 0; light.curI = 0; }
    const keep = this.keep();
    let lamp = m.lights.find((light) => light.id === 'keep');
    if (!lamp) {
      lamp = { id: 'keep', on: true, flicker: 0, seed: 1, x: keep.x, y: keep.y + 30, r: 560, color: [255, 220, 170], flick: 0, room: m.findRoom(keep.x, keep.y), type: 'lamp' };
      m.lights.push(lamp);
    }
    lamp.i = 0.62; lamp.curI = 0.62; lamp.f = 1;
    if (!m.solids.some((solid) => solid.type === 'keep')) {
      // a plus and a square: the round tower's footprint within ~20 px
      const r = keep.r;
      const a = Math.round(r * 0.625), b = Math.round(r * 0.85);
      const rects = [
        { x: keep.x - r, y: keep.y - a, w: r * 2, h: a * 2 },
        { x: keep.x - a, y: keep.y - r, w: a * 2, h: r * 2 },
        { x: keep.x - b, y: keep.y - b, w: b * 2, h: b * 2 },
      ];
      for (const rect of rects) m._indexSolid({ ...rect, type: 'keep', solid: true });
    }
  }

  _applyEntranceState() {
    if (!this._savedEntrances) return;
    const byId = new Map(this.game.mansion.entrances.map((e) => [e.id, e]));
    for (const row of this._savedEntrances) {
      const e = byId.get(row.id);
      if (!e) continue;
      e.hpMax = Math.max(e.baseHpMax || 100, Number(row.hpMax) || e.baseHpMax);
      e.hp = clamp(Number(row.hp) || 0, 0, e.hpMax);
      e.broken = !!row.broken || e.hp <= 0;
      e.open = e.broken || !!row.open;
      e.barricade = Math.max(0, Number(row.barricade) || 0);
    }
  }

  enter() {
    const g = this.game;
    g.screen = 'playing';
    g.paused = false;
    g.player.state = 'idle';
    this.recenterCamera(true);
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(this.frameMul(this.phase !== 'day') * this.userZoom());
    g.renderer.snapCamera(g.player.x, g.player.y);
    if (this._wantsIntro()) this._startIntro();
    g.uiPanel = this.panelFor();
    g.input.gameplay = !this.cine && (this.phase === 'night' || this.phase === 'day');
    g.mansion.update(0, g);
    this._persist(true);
    return true;
  }

  /** The panel the run shows right now (a cinematic holds every other one). */
  panelFor() {
    if (this.cine) return 'survival-cine';
    return this.phase === 'day' ? 'survival-day' : this.phase === 'complete' ? 'survival-complete' : this.phase === 'failed' ? 'survival-failed' : null;
  }

  /** Dawn light: the day, and the morning the reinforcements arrive. */
  daylight() { return this.phase === 'day' || this.phase === 'complete'; }

  /* ---------------- K1 bookends (CINE) ---------------- */

  /**
   * The opening plays at the start of every run (Night 1, before its clock
   * has run): a fresh save, PLAY AGAIN and RESTART all open on it, a tap
   * skips it. It used to be told once per save (`introSeen`), so after the
   * first run it never came back and read as lost (playtest 2026-10-17:
   * "tralier toturial yg sebelum nya di buat di Awal itu hilang, harusnya
   * itu di pertahan kan"). `introSeen` is still written, as a record only.
   */
  _wantsIntro() {
    if (!this.cinematics || this.cine) return false;
    if (this.phase !== 'night' || this.day !== 1 || this.nightsCompleted > 0) return false;
    // a reload in the middle of a night is not an opening
    return !(this.elapsed > 0.5);
  }

  _startIntro() {
    const g = this.game;
    const s = g.save.survival || (g.save.survival = freshProgress(this.nightDuration));
    // a record that this save has seen the opening (it no longer gates it)
    s.introSeen = true;
    // The night opens on its first wave already at a gate — the state the
    // night reaches at its first wave mark, minus the empty seconds before.
    this.elapsed = Math.max(this.elapsed, this.nightDuration * this.waveTimes()[0]);
    g.time = this.elapsed;
    g.timeLeft = Math.max(0, this.nightDuration - this.elapsed);
    // the opening has its own horn (the captain's): the horde's waits
    this.updateWaves(true);
    // the banners wait for the handover (the opening says it all first)
    this.banner = null;
    this.bannerQueue.length = 0;
    g.player.slashAge = null;
    const horde = g.enemies.filter((e) => e._survivalType === 'swarm' && !e.dead);
    let hx = 0, hy = 0;
    for (const e of horde) { hx += e.x; hy += e.y; }
    const gate = horde.length ? this.entranceById(horde[0].entranceId) : this.mainGate();
    const center = horde.length ? { x: hx / horde.length, y: hy / horde.length }
      : gate ? { x: gate.x + outwardOf(gate).x * 260, y: gate.y + outwardOf(gate).y * 260 } : { x: 0, y: -1200 };
    this.cine = { kind: 'intro', t: 0, dur: CINE.intro.dur, night: true, keys: this._introKeys(center, gate), horn: false };
    g.uiPanel = 'survival-cine';
    g.input.gameplay = false;
    this._cineCamera();
  }

  /** Height (world px) of the keep's roof walk, where its people stand. */
  _keepRoof() { return 228 * (1 + (this.keepLevel - 1) * 0.06); }

  /**
   * Where the play camera sits on the Hunter (followPlayer's goal without the
   * look-ahead): the hand-over frame the opening ends on.
   */
  _playFocus(night) {
    const p = this.game.player;
    const r = this.game.renderer;
    return { x: p.x, y: p.y - ((r.h || 720) < 560 ? (night ? 90 : 70) : 0) };
  }

  /**
   * World offset (along +x and +y) that lifts a framed subject clear of the
   * caption chip: half the chip's height (drawCineCaption: 48 / 58 px) plus
   * its gap, turned into floor distance at the key's zoom.
   */
  _cineLift(z, night) {
    const r = this.game.renderer;
    const px = (((r.h || 720) < 560 ? 48 : 58) + 10) / 2;
    const zoom = this.frameMul(night) * (r.baseZoom || 1) * z;
    return px / Math.max(0.05, zoom * 0.8165);
  }

  /**
   * Camera keys. A raised point shows where the floor point (x − h, y − h)
   * would: the keep's roof walk is framed from its floor offset.
   * 1 the keep's roof walk, close; 2 the horde massed outside its gate, the
   * gate in frame, with a slow push in; 3 the Hunter; 4 the play frame.
   */
  _introKeys(horde, gate) {
    const keep = this.keep();
    const roof = this._keepRoof();
    const top = { x: keep.x - roof * 0.72, y: keep.y - roof * 0.72 };
    const door = gate || { x: horde.x, y: horde.y + 300 };
    const along = (f, z) => {
      const a = this._cineLift(z, true);
      return { x: lerp(door.x, horde.x, f) + a, y: lerp(door.y, horde.y, f) + a, z };
    };
    const p = this.game.player;
    const play = this._playFocus(true);
    // zooms are multiples of the play frame (FRAME_CLOSER 1.1): the first
    // shot holds the townsfolk on the roof walk and pulls back until the
    // whole keep and its banner stand in the letterbox (at 2.4 x the 1.3
    // frame it showed only the battlements, cut by the bars)
    return [
      { t: 0, x: top.x - 22, y: top.y - 22, z: 1.6 },
      { t: 2.2, x: top.x + 24, y: top.y + 24, z: 1.3 },
      { t: 3.3, ...along(0.45, 0.9) },
      { t: 4.7, ...along(0.52, 1.0) },
      { t: 5.7, x: p.x - 30, y: p.y - 30, z: 1.4 },
      // the hand-over lands on the player's own zoom (BUILD 12), no jump
      { t: CINE.intro.dur, x: play.x, y: play.y, z: this.userZoom() },
    ];
  }

  /** Drive the camera along the current cinematic's keys (eased per leg). */
  _cineCamera() {
    const c = this.cine;
    const r = this.game.renderer;
    if (!c || !c.keys || !c.keys.length || !r || !r.cam) return;
    const keys = c.keys;
    let i = 0;
    while (i < keys.length - 2 && c.t >= keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[Math.min(keys.length - 1, i + 1)];
    const k = clamp((c.t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
    const e = k * k * (3 - 2 * k);
    r.cam.x = lerp(a.x, b.x, e);
    r.cam.y = lerp(a.y, b.y, e);
    r.cam.shake = 0; r.cam.sx = 0; r.cam.sy = 0;
    const play = this.frameMul(c.night) * (r.baseZoom || 1);
    const zoom = play * lerp(a.z, b.z, e);
    if (r.setZoomAbsolute) r.setZoomAbsolute(zoom);
    else if (r.setZoomMul) r.setZoomMul(zoom / (r.baseZoom || 1));
  }

  /** The caption on screen now (+ its age), or null. */
  cineCaption() {
    const c = this.cine;
    if (!c) return null;
    const spec = CINE[c.kind];
    const row = spec && spec.captions.find((cap) => c.t >= cap.from && c.t < cap.to);
    return row ? { ...row, age: c.t - row.from, left: row.to - c.t } : null;
  }

  updateCine(dt) {
    const g = this.game;
    const c = this.cine;
    c.t += dt;
    g.mansion.update(dt, g);
    g.player.anim(dt);
    // a muzzle flash in flight still fades (the player's update is held)
    if (g.player.slashAge != null && g.player.slashAge < 1) g.player.slashAge += dt;
    if (c.kind === 'intro') {
      // the horde waits at its gate, restless: arms sway, nobody advances
      for (const e of g.enemies) if (e._crowd && !e.dead) e.t = (e.t || 0) + dt;
      if (!c.horn && c.t >= CINE.intro.horn) { c.horn = true; g.audio.play('horn', { vol: 0.85 }); }
    } else if (c.kind === 'arrival') {
      this.updateRelief(dt);
      if (!c.fanfare && c.t >= CINE.arrival.fanfare) { c.fanfare = true; g.audio.play('fanfare', { vol: 0.8 }); }
    }
    this._cineCamera();
    if (c.t >= c.dur) this.endCine();
  }

  /** A tap anywhere (after the arming beat) skips to the hand-over. */
  skipCine() {
    if (!this.cine || this.cine.t < CINE.armAfter) return false;
    this.endCine();
    return true;
  }

  endCine() {
    const c = this.cine;
    if (!c) return;
    const g = this.game;
    const r = g.renderer;
    // the frame the cinematic would have ended on (a skip cuts straight to it)
    c.t = c.dur;
    this._cineCamera();
    this.cine = null;
    this.recenterCamera(true);
    if (c.kind === 'intro') {
      if (r.setZoomMul) r.setZoomMul(this.frameMul(true) * this.userZoom());
      this._nightIntro();
    } else if (c.kind === 'arrival') {
      this.updateRelief(Infinity);
    }
    g.uiPanel = this.panelFor();
    g.input.gameplay = this.phase === 'night' || this.phase === 'day';
    this._persist(true);
  }

  /**
   * The relief column: a banner-bearer and four ranks of two spears. They
   * start outside the main gate and march in along the gate road to two
   * lines in front of the keep (or stand there already: `placed`).
   */
  _reliefColumn(placed = false) {
    const keep = this.keep();
    const gate = this.mainGate();
    const out = gate ? outwardOf(gate) : { x: 0, y: 1 };
    const along = { x: -out.y, y: out.x };
    const gx = gate ? gate.x : keep.x + out.x * 900;
    const gy = gate ? gate.y : keep.y + out.y * 900;
    const front = keep.r + 118;
    const at = (o, d, l) => ({ x: o.x + out.x * d + along.x * l, y: o.y + out.y * d + along.y * l });
    const face = Math.atan2(-out.y, -out.x);
    const troops = [{ role: 'banner', rank: 0, file: 0, slot: at(keep, front, 0) }];
    for (let rank = 1; rank <= 4; rank++) {
      for (const file of [-1, 1]) {
        // two lines of four behind the banner: ranks 1–2 in front, 3–4 behind
        const line = rank <= 2 ? 0 : 1;
        const col = (rank % 2 === 1 ? 0.5 : 1.5) * file;
        // spacing for the GLB knights (shoulder pads and shields, x1.6):
        // 104 apart each way, so no two bodies overlap in the lines
        troops.push({ role: 'spear', rank, file, slot: at(keep, front + 96 + line * 104, col * 104) });
      }
    }
    const gatePt = { x: gx, y: gy };
    return troops.map((tr, i) => {
      const start = at(gatePt, 130 + tr.rank * 68, tr.file * 34);
      const inside = at(gatePt, -90, tr.file * 34);
      const s = {
        id: i, role: tr.role, x: start.x, y: start.y, angle: face, face,
        path: [inside, tr.slot], i: 0, delay: tr.rank * 0.1 + 0.25, walkT: rand(0, 1), moving: false,
      };
      if (placed) Object.assign(s, { x: tr.slot.x, y: tr.slot.y, i: 2, delay: 0 });
      return s;
    });
  }

  /** March the column along its path; Infinity snaps everyone into line. */
  updateRelief(dt) {
    const list = this.reinforcements;
    if (!list) return;
    for (const s of list) {
      if (dt === Infinity) {
        const end = s.path[s.path.length - 1];
        s.x = end.x; s.y = end.y; s.i = s.path.length; s.delay = 0; s.moving = false; s.angle = s.face;
        continue;
      }
      if (s.delay > 0) { s.delay -= dt; continue; }
      if (s.i >= s.path.length) { s.moving = false; s.angle = s.face; continue; }
      const wp = s.path[s.i];
      const dx = wp.x - s.x, dy = wp.y - s.y;
      const d = Math.hypot(dx, dy);
      const step = CINE.march * dt;
      if (d <= step) { s.x = wp.x; s.y = wp.y; s.i++; }
      else { s.x += (dx / d) * step; s.y += (dy / d) * step; s.angle = Math.atan2(dy, dx); }
      s.moving = s.i < s.path.length;
      s.walkT += dt;
    }
  }

  _startArrival() {
    const g = this.game;
    const keep = this.keep();
    const gate = this.mainGate();
    const out = gate ? outwardOf(gate) : { x: 0, y: 1 };
    const roof = this._keepRoof();
    const gx = gate ? gate.x : keep.x, gy = gate ? gate.y : keep.y + 900;
    // the gate with the road outside it (the column comes up it), then in
    // through the gate and up to the keep: its roof and the two lines in one
    // frame, all of it lifted clear of the caption
    const key = (t, x, y, z) => { const a = this._cineLift(z, false); return { t, x: x + a, y: y + a, z }; };
    const lines = { x: keep.x + out.x * (keep.r + 180), y: keep.y + out.y * (keep.r + 180) };
    const finale = { x: (lines.x + keep.x - roof) / 2, y: (lines.y + keep.y - roof) / 2 };
    this.cine = {
      kind: 'arrival', t: 0, dur: CINE.arrival.dur, night: false, fanfare: false,
      keys: [
        key(0, gx - out.x * 50 - 40, gy - out.y * 50, 1.55),
        key(2.0, gx - out.x * 130 - 40, gy - out.y * 130, 1.45),
        key(3.6, gx - out.x * 420 - 70, gy - out.y * 420 - 70, 1.3),
        key(5.2, finale.x, finale.y, 1.2),
        key(CINE.arrival.dur, finale.x, finale.y, 1.14),
      ],
    };
    // the captain turns to meet them
    const p = g.player;
    p.angle = Math.atan2(lines.y - p.y, lines.x - p.x);
    this._cineCamera();
  }

  startNight() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    g._survivalHint = null;   // nor a day's into the night
    this.recenterCamera(true);
    this.phase = 'night';
    this.elapsed = 0;
    this.nightKeepStart = this.keepHp;
    this.walkPath = null;
    this.waveIndex = 0;
    this.breakerIndex = 0;
    this.individualIndex = 0;
    this.siegeTimers = Object.create(null);
    this.nightStats = freshNightStats();
    this.cleared = null;
    this.stragglers = null;
    this._resetNightFx();
    g.time = 0;
    g.timeLeft = this.nightDuration;
    g.phase = NIGHT_PHASE;
    g.screen = 'playing';
    g.paused = false;
    g.uiPanel = null;
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.player.blood = Math.max(1, g.player.blood);
    g.player.wardSpent = false;
    for (const e of g.mansion.entrances) {
      e.attackers = 0; e.flash = 0; e.lastTouched = -99;
    }
    this.applyBuildingEffects(true);
    g.mansion.buildNav();
    this._fields.clear();
    this._syncBakePhase();
    this._syncGuardRoster(true);
    this._syncTowers();
    this._guardAssignT = 0;
    if (g.renderer.setZoomMul) g.renderer.setZoomMul(this.frameMul(true));
    g.renderer.snapCamera(g.player.x, g.player.y);
    this._nightIntro();
    this._persist(true);
    return true;
  }

  _resetNightFx() {
    this.floaters.length = 0;
    this.fx.length = 0;
    this.hudPops = [];
    this._mineBank = Object.create(null);
    // tonight's tally over every ballista (the night HUD's kill pills)
    for (const t of this.towers || []) t.nightKills = 0;
    this.keepBallistaKills = 0;
    this.bannerQueue.length = 0;
    this.banner = null;
    this.keepAttackers = 0;
    this.hitStop = 0;
    this.keepBallista.target = null;
    this.keepBallista.shotT = 0;
    this._doorPressure.clear();
    this._breachAt = Object.create(null);
    this._movedSinceStart = 0;
    this._lastPlayerPos = null;
    this._keepHitAt = -99;
    this._keepWarnAt = -99;
    this._keepLowWarned = false;
  }

  _nightIntro() {
    const left = 3 - this.nightsCompleted;
    // the first night says who you are and what you hold (shown once a run)
    if (this.day === 1) this.pushEvent('night', 'keep', 'HOLD THE KEEP', { sub: 'REINFORCEMENTS IN 3 NIGHTS', life: 3.2 });
    else this.pushEvent('night', 'moon', `NIGHT ${this.day}`, { sub: left > 1 ? `REINFORCEMENTS IN ${left} NIGHTS` : 'REINFORCEMENTS AT DAWN', life: 2.6 });
  }

  update(dt) {
    const g = this.game;
    this._syncBakePhase();
    this.uiClock += dt;
    // Pause freezes the run: Flare cooldown, banners and damage numbers all
    // wait with the night instead of quietly running out behind the panel.
    if (g.screen === 'playing') {
      this._updateFx(dt);
      // the run's clock for the end panel: nights and days, never a pause
      // or a cinematic
      if (!this.cine && (this.phase === 'night' || this.phase === 'day')) this.runStats.time = (this.runStats.time || 0) + dt;
      // (the Flare's cooldown belongs to the run: it waits out a cinematic)
      if (!this.cine) {
        this.skillCooldown = Math.max(0, this.skillCooldown - dt);
        this.skillFlash = Math.max(0, this.skillFlash - dt);
      }
    }
    // a cinematic owns the frame: the world draws, the run's clock waits
    if (this.cine) {
      if (g.screen === 'playing') this.updateCine(dt);
      else g.player.anim(0);
      this._saveT += dt;
      if (this._saveT >= SAVE_EVERY) { this._saveT = 0; this._persist(false); }
      return;
    }
    // a heavy kill holds the night still for a few frames (hit-stop)
    if (this.hitStop > 0 && this.phase === 'night' && g.screen === 'playing') {
      this.hitStop = Math.max(0, this.hitStop - dt);
      g.player.anim(0);
      return;
    }
    if (this.phase === 'night' && g.screen === 'playing' && !g.uiPanel) this.updateNight(dt);
    else if (this.phase === 'day' && g.screen === 'playing') this.updateDay(dt);
    else {
      g.mansion.update(dt, g);
      g.player.anim(dt);
    }
    this._saveT += dt;
    if (this._saveT >= SAVE_EVERY) { this._saveT = 0; this._persist(false); }
  }

  updateNight(dt) {
    const g = this.game;
    this.elapsed = Math.min(this.nightDuration, this.elapsed + dt);
    g.time = this.elapsed;
    g.timeLeft = Math.max(0, this.nightDuration - this.elapsed);
    g.phase = NIGHT_PHASE;
    g.danger = clamp(0.18 + this.elapsed / this.nightDuration * 0.55 + (this.day - 1) * 0.08, 0.1, 0.92);
    g.bloodMoon = 0; g.duelDark = 0; g.blackoutT = 0; g.powerOut = false;
    g.lightningFlash = Math.max(0, g.lightningFlash - dt * 2.4);

    if (g.player.bloodMax !== this.hunterStats().hp) this.applyHunterStats(false);
    this.updateWaves();
    this.updateMines(dt);
    g.mansion.update(dt, g);
    this.updateSortieGates(dt);

    this.currentTarget = this.autoTarget();
    if (this.currentTarget) {
      const p = g.player;
      p.angle = Math.atan2(this.currentTarget.y - p.y, this.currentTarget.x - p.x);
      // Hunter's shot is an auto-attack. A manual press still works and lets
      // touch/keyboard players prioritize a target by facing toward it.
      g.input.attackDown = true;
    }
    if (g.input.interactPressed) this.useSkill();
    g.player.update(dt, g);
    g.player.anim(dt);
    this.updateRest(dt);

    let attackers = 0;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      e.update(dt, g);
      if (e.attackingKeep && !e.dead) attackers++;
      if (e.removeMe) g.enemies.splice(i, 1);
    }
    this.keepAttackers = attackers;
    this.updateKeepBallista(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    const p = g.player;
    if (this._lastPlayerPos) this._movedSinceStart += Math.hypot(p.x - this._lastPlayerPos.x, p.y - this._lastPlayerPos.y);
    this._lastPlayerPos = { x: p.x, y: p.y };
    if (!this._keepLowWarned && this.keepHp > 0 && this.keepHp < this.keepHpMax() * 0.25) {
      this._keepLowWarned = true;
      this.pushEvent('keepLow', 'keep', 'KEEP CRITICAL!');
    }
    for (let i = g.bolts.length - 1; i >= 0; i--) {
      const b = g.bolts[i];
      b.update(dt, g);
      if (b.dead || dist(b.x, b.y, g.player.x, g.player.y) > 2600) g.bolts.splice(i, 1);
    }
    this.updateCrowdSiege(dt);
    this.updateGateMeter();
    // A hit makes a door flash for a moment; Survival owns the decay (the
    // legacy loop that used to fade it never runs here), otherwise one claw
    // marked a door "under attack" for the rest of the night.
    for (const e of g.mansion.entrances) if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 1.6);
    this.followPlayer(dt);
    if (this.phase !== 'night') return;
    if (this.keepHp <= 0) this.fail('THE KEEP FELL');
    else if (g.player.blood <= 0 && g.player.state !== 'death') g.killPlayer('Hunter lost');
    else if (g.player.state === 'death' || g.player.state === 'dead') this.fail('Hunter lost');
    else if (this.elapsed >= this.nightDuration) this.completeNight();
    else if (this.cleared && this.elapsed >= this.cleared.dawnAt) this.completeNight();
    else if (!this.cleared && this.nightCleared()) this._clearNight();
    else this._updateStragglers();
  }

  /**
   * BUILD 16 (R5): tonight is over before its clock — every wave, Breaker and
   * Individual of the night is out, and not one of them still stands.
   */
  nightCleared() {
    if (this.phase !== 'night' || !(this.nightStats.spawned > 0) || !this.spawnsDone()) return false;
    return this.aliveEnemies() === 0;
  }

  /** Every wave, Breaker and Individual tonight's schedule holds is out. */
  spawnsDone() {
    if (this.waveIndex < this.waveTimes().length || this.individualIndex < INDIVIDUAL_TIMES.length) return false;
    return this.breakerIndex >= (this.day >= 3 ? 2 : this.day >= 2 ? 1 : 0);
  }

  /**
   * BUILD 16 (R5): the night's last few (NIGHT_CLEAR.stragglers or fewer,
   * every spawn out). The horde breaks: each one out of the fight runs for
   * the trees (see fleeing); the ones still fighting are marked on the HUD
   * (LAST N!, once a night) until they fall or leave the fight.
   */
  _updateStragglers() {
    if (this.cleared || !(this.nightStats.spawned > 0) || !this.spawnsDone()) return;
    const live = this.game.enemies.filter((e) => e._survivalType && !e.dead && !e.removeMe && !e.fleeing);
    if (!live.length || live.length > NIGHT_CLEAR.stragglers) return;
    if (!this.stragglers) this.stragglers = { at: +this.elapsed.toFixed(2), count: live.length, fled: 0 };
    let fighting = 0;
    for (const e of live) {
      if (this._inTheFight(e)) { fighting++; continue; }
      e.fleeing = true;
      e.fleeT = 0;
      this.stragglers.fled++;
    }
    if (fighting && !this.stragglers.called) {
      this.stragglers.called = true;
      this.pushEvent('stragglers', 'skull', `LAST ${fighting}!`, { sub: 'CLEAR THEM FOR AN EARLY DAWN', life: 2.2 });
    }
  }

  /**
   * Whether a body is in tonight's fight (BUILD 16): inside the walls, at the
   * keep, clawing or knocked back, on the last stretch to a gate (its lane's
   * DOOR_LANE_NEAR), or within the captain's shot.
   */
  _inTheFight(e) {
    if (e._inHouse || e.attackingKeep) return true;
    if (e.state === 'press' || e.state === 'strike' || e.state === 'stagger' || e.state === CROWD.PRESS) return true;
    const p = this.game.player;
    if (dist(e.x, e.y, p.x, p.y) <= this.tuning.autoAttackRange) return true;
    for (const door of this.game.mansion.entrances) {
      if (!door.exterior || door.kind !== 'door') continue;
      const out = door.outside || door;
      if (dist(e.x, e.y, out.x, out.y) <= DOOR_LANE_NEAR) return true;
    }
    return false;
  }

  /** NIGHT CLEARED!: dawn in NIGHT_CLEAR.delay s, every whole second saved paid in gold. */
  _clearNight() {
    const at = this.elapsed;
    const dawnAt = Math.min(this.nightDuration, at + NIGHT_CLEAR.delay);
    const saved = Math.max(0, Math.floor(this.nightDuration - dawnAt + 1e-6));
    const bonus = Math.floor(saved * NIGHT_CLEAR.goldPerSecond);
    this.cleared = { at, dawnAt, saved, bonus };
    // the clear owns the banner: nothing else tonight has anything to say
    this.bannerQueue.length = 0;
    this.banner = null;
    const fled = this.stragglers ? this.stragglers.fled : 0;
    this.cleared.fled = fled;
    this.pushEvent('cleared', 'sun', 'NIGHT CLEARED!', {
      sub: `${fled > 0 ? 'THE REST FLED' : saved > 0 ? 'DAWN COMES EARLY' : 'DAWN IS HERE'}${bonus > 0 ? ` · +${bonus} GOLD` : ''}`,
      life: NIGHT_CLEAR.delay + 0.6,
    });
    this.game.audio.play('dawnChime', { vol: 0.7 });
    this._persist(true);
  }

  /**
   * How far the light has come round to day: 0 by night, 1 by day. A cleared
   * night (BUILD 16) warms from the clear to its early dawn, so the dawn is
   * seen coming instead of cut to.
   */
  dawnBlend() {
    if (this.daylight()) return 1;
    if (this.phase !== 'night' || !this.cleared) return 0;
    const span = Math.max(0.01, this.cleared.dawnAt - this.cleared.at);
    return clamp((this.elapsed - this.cleared.at) / span, 0, 1);
  }

  /**
   * The day is a walk between build circles (P1): the Hunter moves with the
   * stick (a little faster than at night), or walks himself to a circle that
   * was tapped. Nothing attacks; the clock does not run.
   */
  updateDay(dt) {
    const g = this.game;
    this.elapsed += dt;
    g.time = this.elapsed;
    g.timeLeft = 0;
    g.phase = DAY_PHASE;
    g.danger = 0.02;
    g.bloodMoon = 0; g.duelDark = 0; g.blackoutT = 0; g.powerOut = false;
    g.mansion.update(dt, g);
    this.updateSortieGates(dt);
    const p = g.player;
    const input = g.input;
    this.currentTarget = null;
    input.attackDown = false;
    input.attackPressed = false;
    input.interactPressed = false;
    const steering = !this.rewardPending() && input.moving;
    if (steering) this.walkPath = null;
    if (this.walkPath && !this.rewardPending()) this._walkAlong(dt);
    else if (!this.rewardPending()) {
      const mul = p.speedMul;
      p.speedMul = (mul || 1) * this.tuning.dayWalkMul;
      p.update(dt, g);
      p.speedMul = mul;
    }
    p.anim(dt);
    this.updateGuards(dt);
    this.updateTowers(dt);
    if (this.builderJob) {
      this.builderJob.remaining = Math.max(0, this.builderJob.remaining - dt);
      if (this.builderJob.remaining <= 0) this.finishBuilderJob();
    }
    this.followPlayer(dt);
  }

  /** Walk the Hunter to a point by day (a tapped circle), around furniture. */
  walkTo(x, y) {
    if (this.phase !== 'day') return false;
    const p = this.game.player;
    const path = this.game.mansion.navPath(p.x, p.y, x, y) || [{ x, y }];
    this.walkPath = { points: path.concat([{ x, y }]), i: 0, t: 0 };
    return true;
  }

  _walkAlong(dt) {
    const g = this.game;
    const p = g.player;
    const path = this.walkPath;
    path.t += dt;
    const speed = 210 * this.tuning.dayWalkMul;
    let budget = speed * dt;
    let vx = 0, vy = 0;
    while (budget > 0 && path.i < path.points.length) {
      const wp = path.points[path.i];
      const dx = wp.x - p.x, dy = wp.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) { path.i++; continue; }
      const step = Math.min(d, budget);
      const res = g.mansion.resolve(p.x + dx / d * step, p.y + dy / d * step, p.radius, true);
      vx = dx / d * speed; vy = dy / d * speed;
      const moved = Math.hypot(res.x - p.x, res.y - p.y);
      p.x = res.x; p.y = res.y;
      budget -= step;
      if (moved < step * 0.2) { path.i++; break; }   // blocked: try the next point
    }
    p.vx = vx; p.vy = vy;
    if (vx || vy) p.angle = approachAngle(p.angle, Math.atan2(vy, vx), dt * 14);
    if (path.i >= path.points.length || path.t > 12) { this.walkPath = null; p.vx = 0; p.vy = 0; }
  }

  updateWaves(quiet = false) {
    const duration = this.nightDuration;
    const waveTimes = this.waveTimes();
    const counts = this.waveCounts();
    while (this.waveIndex < waveTimes.length && this.elapsed >= duration * waveTimes[this.waveIndex]) {
      const sent = this.spawnSwarm(counts[this.waveIndex], this.waveIndex);
      this.waveIndex++;
      // BUILD 16 (R6): the call names the gate and how many, and the horde's
      // horn sounds from that side of the screen
      this.pushEvent('wave', 'swarm', `WAVE ${this.waveIndex}/${waveTimes.length}`,
        sent && sent.entrance ? { sub: `${gateLabel(sent.entrance)} ×${sent.count}` } : {});
      if (sent && sent.entrance && !quiet) this._hornFrom(sent.entrance);
    }
    const breakerAt = this.day >= 2 ? duration * BREAKER_TIMES[0] : Infinity;
    if (this.day >= 2 && this.breakerIndex === 0 && this.elapsed >= breakerAt) {
      const gate = this.spawnBreaker(0);
      this.breakerIndex = 1;
      if (gate && !quiet) this._hornFrom(gate);
    }
    if (this.day >= 3 && this.breakerIndex === 1 && this.elapsed >= duration * BREAKER_TIMES[1]) {
      const gate = this.spawnBreaker(1);
      this.breakerIndex = 2;
      if (gate && !quiet) this._hornFrom(gate);
    }
    const individualAt = INDIVIDUAL_TIMES;
    while (this.individualIndex < individualAt.length && this.elapsed >= duration * individualAt[this.individualIndex]) {
      this.spawnIndividual(this.individualIndex);
      this.individualIndex++;
    }
  }

  spawnSwarm(count, wave, forced = null) {
    const g = this.game;
    const entrance = forced || this.chooseTargetEntrance(g.player.x, g.player.y, wave);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const total = clamp(Math.round(count), 1, SWARM_CAP);
    const queued = this.crowdAt(entrance.id).length;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const lateral = (col - 3) * 50 + rand(-8, 8);
      const depth = 150 + row * 64 + rand(-16, 16);
      const { x, y } = this._outsideSpot(entrance, out, along, lateral, depth);
      // Ranks count from the front of *this* door's crowd: a wave that joins
      // an existing crowd queues behind it, a fresh door starts at rank 0.
      const body = new SurvivalCrowdZombie(x, y, entrance, queued + i, this.day);
      body.id = 1000000 + this.day * 10000 + wave * 100 + i;
      g.enemies.push(body);
    }
    this.nightStats.spawned = (this.nightStats.spawned || 0) + total;
    return { entrance, count: total };
  }

  /** The horde's horn (BUILD 16, R6), panned to the side its gate is on. */
  _hornFrom(entrance) {
    const g = this.game;
    this.horns = (this.horns || 0) + 1;
    g.audio.play('hordeHorn', { x: entrance.x, y: entrance.y, cam: g.renderer.cam, vol: 0.75 });
  }

  /**
   * Where a body queued at a door starts: its formation slot outside the
   * walls, or — when that slot falls inside another room of the house (the
   * front door's crowd reached into the basement, the dining door's into the
   * gallery) or on a prop — the nearest clear slot further out. A body that
   * started inside skipped the door and walked straight to the fire.
   */
  _outsideSpot(entrance, out, along, lateral, depth) {
    const m = this.game.mansion;
    const b = m.bounds;
    const at = (l, d) => ({ x: entrance.outside.x + out.x * d + along.x * l, y: entrance.outside.y + out.y * d + along.y * l });
    const clear = (q) => (!b || (q.x > b.x + 24 && q.x < b.x + b.w - 24 && q.y > b.y + 24 && q.y < b.y + b.h - 24))
      && m.findRoom(q.x, q.y) === ROOM.OUTSIDE
      && !m.solidAt(q.x, q.y) && !m.solidAt(q.x + 14, q.y) && !m.solidAt(q.x - 14, q.y)
      && !m.solidAt(q.x, q.y + 14) && !m.solidAt(q.x, q.y - 14);
    const first = at(lateral, depth);
    if (clear(first)) return first;
    for (let k = 1; k <= 10; k++) {
      const d = depth + k * 26;
      for (const l of [lateral, -lateral, lateral * 0.6, -lateral * 0.6, lateral * 0.25, -lateral * 0.25]) {
        const q = at(l, d);
        if (clear(q)) return q;
      }
    }
    return first;
  }

  spawnIndividual(index) {
    const g = this.game;
    const entrance = this.chooseTargetEntrance(g.player.x, g.player.y, index + 2);
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const jx = rand(-42, 42), jy = rand(-42, 42);
    const depth = 180 + index * 54 + (out.x * jx + out.y * jy);
    const { x, y } = this._outsideSpot(entrance, out, along, along.x * jx + along.y * jy, depth);
    const enemy = new SurvivalIndividualZombie(x, y, entrance, this.day, index);
    enemy.id = 2000000 + this.day * 100 + index;
    g.enemies.push(enemy);
    this.nightStats.spawned = (this.nightStats.spawned || 0) + 1;
  }

  spawnBreaker(index = 0) {
    const g = this.game;
    const entrance = this.mainGate();
    if (!entrance) return;
    const out = outwardOf(entrance);
    const along = { x: -out.y, y: out.x };
    const jx = rand(-20, 20), jy = rand(-20, 20);
    const depth = 330 + index * 80 + (out.x * jx + out.y * jy);
    const { x, y } = this._outsideSpot(entrance, out, along, along.x * jx + along.y * jy, depth);
    const breaker = new SurvivalBreaker(x, y, entrance, this.day, index);
    breaker.id = 3000000 + this.day * 10 + index;
    // Preserve a permanent structure target even if the hero is the nearest
    // visible actor. This is also surfaced to QA diagnostics.
    breaker.targetKind = 'wall';
    breaker.targetEntranceId = entrance.id;
    g.enemies.push(breaker);
    this.nightStats.spawned = (this.nightStats.spawned || 0) + 1;
    this.pushEvent('breaker', 'breaker', 'BREAKER!', { sub: gateLabel(entrance) });
    return entrance;
  }

  chooseTargetEntrance(_x, _y, offset = 0) {
    const doors = this.game.mansion.entrances.filter((e) => e.kind === 'door' && e.exterior);
    if (!doors.length) return this.mainGate();
    // Every night tests a different side, and the nights get *closer*: the
    // old rotation sent Night 3 to the three doors furthest from the fire, so
    // its biggest waves never reached the Perapian before dawn. Since BUILD 17
    // (R8) the rotation a night plays is the run's own (`nightDoors`): Nights
    // 2–3 come from a different side every run, Night 1 keeps the opening's.
    const plan = this.nightDoors();
    const wanted = plan[offset % plan.length];
    const exact = doors.find((e) => e.id === wanted);
    if (exact) return exact;
    const priority = ['southGate', 'northGate', 'eastGate', 'westGate', 'posternNW', 'posternSE'];
    const start = (offset + (this.day - 1) * 2) % priority.length;
    for (let i = 0; i < priority.length; i++) {
      const candidate = doors.find((e) => e.id === priority[(start + i) % priority.length]);
      if (candidate) return candidate;
    }
    return doors[0];
  }

  /**
   * A run's rotation seed (BUILD 17, R8). Three cases:
   *   - `from` given: that seed (a tool measuring one rotation on purpose);
   *   - a base was fixed (`?seed=`, or `window.DUSKHOLD_SEED` under node):
   *     every run of that process plays the same rotation, so a seeded probe
   *     replays exactly and two bots started from one random stream really do
   *     face the same night;
   *   - nothing fixed (a player's browser): the clock, mixed with the runs
   *     opened and finished, so PLAY AGAIN comes at the gates from a new side.
   */
  newRunSeed(from) {
    this.runCount = (this.runCount || 0) + 1;
    const given = Number.isFinite(Number(from)) && from != null ? Math.round(Number(from)) : null;
    const base = given != null ? given
      : this.seedBase != null ? this.seedBase
        : (Date.now() >>> 0) ^ Math.imul(this.runCount, 0x6d2b79f5) ^ Math.imul((this.records.runs || 0) + 1, 7919);
    return mixSeed(base) || 1;
  }

  /**
   * The gates tonight comes at, in order (BUILD 17, R8): this run's rotation
   * for night `day`. Night 1 has one; Nights 2 and 3 pick one of four from
   * the run's seed, and Night 3 never opens on the gate Night 2 opened on —
   * the same opening two nights running is the repetition the research
   * measured against. Pure arithmetic on `runSeed`: no `Math.random`, so a
   * seeded run replays exactly.
   */
  nightDoors(day = this.day) {
    const d = clamp(Math.round(Number(day) || 1), 1, NIGHT_ROTATIONS.length);
    const sets = NIGHT_ROTATIONS[d - 1];
    if (sets.length === 1) return sets[0];
    let i = mixSeed((this.runSeed || 0) ^ Math.imul(d, 0x9e3779b9)) % sets.length;
    if (d === 3 && sets[i][0] === this.nightDoors(2)[0]) i = (i + 1) % sets.length;
    return sets[i];
  }

  /**
   * Tonight in words (R8: "sifat horde per malam diumumkan di senja"): the
   * gate the first wave comes at, the run of gates after it, and what the
   * night sends besides the swarm. The day HUD's TONIGHT chip reads this;
   * `tools/harness.mjs` asserts it against the plan the night really plays.
   */
  tonightCall() {
    const plan = this.nightDoors();
    const gate = (id) => this.entranceById(id);
    const breakers = this.day >= 3 ? BREAKER_TIMES.length : this.day >= 2 ? 1 : 0;
    const counts = this.waveCounts();
    const swarm = counts.reduce((n, c) => n + clamp(Math.round(c), 1, SWARM_CAP), 0);
    const runners = INDIVIDUAL_TIMES.length;
    const main = this.mainGate();
    const order = plan.slice(0, 3).map((id) => gateLabel(gate(id)));
    return {
      first: gateLabel(gate(plan[0])),
      order,
      breakers,
      runners,
      swarm,
      breakerGate: breakers ? gateLabel(main) : null,
      // the two lines the chip draws: who comes, and where they come first
      what: `${swarm} STRONG`,
      text: `${order.join(' → ')}`,
    };
  }

  /**
   * BUILD 13 (V10, docs/VISUAL-LAYOUT-RESEARCH.md §7: "info gelombang
   * sebelum malam"): the coming night's attack gate by gate, known by day —
   * the plan updateWaves() will play (`nightDoors` for the swarm waves and
   * the Individuals, the Breakers at the main gate from Night 2). By day
   * `this.day` is the night to come. Rows in first-contact order:
   * { id, entrance, swarm, waves: [1..3], individuals, breakers, order }
   * (`order` since BUILD 17: the wave that reaches this gate first).
   */
  tonightPlan() {
    const rows = new Map();
    const row = (entrance) => {
      if (!entrance) return null;
      let r = rows.get(entrance.id);
      if (!r) { r = { id: entrance.id, entrance, swarm: 0, waves: [], individuals: 0, breakers: 0 }; rows.set(entrance.id, r); }
      return r;
    };
    const counts = this.waveCounts();
    for (let w = 0; w < this.waveTimes().length; w++) {
      const r = row(this.chooseTargetEntrance(0, 0, w));
      if (r) { r.swarm += clamp(Math.round(counts[w]), 1, SWARM_CAP); r.waves.push(w + 1); }
    }
    for (let i = 0; i < INDIVIDUAL_TIMES.length; i++) {
      const r = row(this.chooseTargetEntrance(0, 0, i + 2));
      if (r) r.individuals += 1;
    }
    const breakers = this.day >= 3 ? BREAKER_TIMES.length : this.day >= 2 ? 1 : 0;
    if (breakers) { const r = row(this.mainGate()); if (r) r.breakers += breakers; }
    // BUILD 17 (R8): which wave reaches a gate first, so the day's badges can
    // be read as an order and not only as a set
    for (const r of rows.values()) r.order = r.waves.length ? Math.min(...r.waves) : 0;
    return [...rows.values()];
  }

  /** Dawn: survivors patch every exterior door (the gate keeps its bonus). */
  repairDoors() {
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior) continue;
      e.hpMax = Math.max(e.baseHpMax || 100, e.hpMax || 0);
      e.hp = e.hpMax; e.broken = false; e.open = false; e.flash = 0; e.attackers = 0;
    }
    this._breachAt = Object.create(null);
    this.game.mansion.buildNav();
    this._fields.clear();
  }

  entranceById(id) { return this.game.mansion.entrances.find((e) => e.id === id) || null; }
  mainGate() { return this.game.mansion.frontDoor || this.entranceById('frontDoor') || this.game.mansion.doors[0] || null; }

  /** Living swarm bodies still outside, queued at one door. */
  crowdAt(id) {
    return this.game.enemies.filter((e) => !e.dead && !e.removeMe && e._survivalType === 'swarm'
      && !e._inHouse && e.entranceId === id);
  }

  /**
   * Close the ranks: front-rank deaths are filled by the nearest body behind,
   * so a crowd keeps leaning on the wood (and stays in reach of the Hunter
   * and the guards) instead of standing on its spawn spots.
   */
  reslotCrowds() {
    const byDoor = new Map();
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || e._survivalType !== 'swarm' || e._inHouse) continue;
      const door = this.entranceById(e.entranceId);
      if (!door || door.broken) continue;
      let list = byDoor.get(door);
      if (!list) byDoor.set(door, (list = []));
      list.push(e);
    }
    for (const [door, list] of byDoor) {
      const free = list.slice();
      for (let slot = 0; slot < list.length; slot++) {
        const spot = survivalSpot(door, slot, 72);
        let best = 0, bestD = Infinity;
        for (let k = 0; k < free.length; k++) {
          const b = free[k];
          // a small bias keeps a body on its own slot when it is a tie
          const d = (b.x - spot.x) ** 2 + (b.y - spot.y) ** 2 - (b.index === slot ? 1600 : 0);
          if (d < bestD) { bestD = d; best = k; }
        }
        free[best].index = slot;
        free.splice(best, 1);
      }
    }
  }

  updateCrowdSiege(dt) {
    const g = this.game;
    this._reslotT = (this._reslotT || 0) - dt;
    if (this._reslotT <= 0) { this._reslotT = 0.6; this.reslotCrowds(); }
    const pressed = new Map();
    for (const e of g.enemies) {
      if (!e._survivalType || e.dead || e._survivalType !== 'swarm' || e.state !== CROWD.PRESS) continue;
      const id = e.entranceId || (e.entrance && e.entrance.id);
      if (!id) continue;
      // only the ranks actually leaning on the wood claw it
      const door = e.entrance;
      if (door && dist(e.x, e.y, door.x, door.y) > SIEGE_REACH) continue;
      const row = pressed.get(id) || { count: 0, sample: e };
      row.count++;
      pressed.set(id, row);
    }
    this._doorPressure.clear();
    for (const e of g.enemies) {
      if (e.dead || !e._survivalType || e._survivalType === 'swarm') continue;
      if (e.state !== 'press' && e.state !== 'strike') continue;
      if (e._inHouse || e.attackingKeep) continue;
      const id = e._survivalType === 'breaker' ? e.targetEntranceId : e.entranceId;
      if (id) this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + 1);
    }
    for (const [id, row] of pressed) {
      const entrance = this.entranceById(id);
      if (!entrance || entrance.broken) continue;
      this._doorPressure.set(id, (this._doorPressure.get(id) || 0) + row.count);
      this.siegeTimers[id] = Math.max(0, (this.siegeTimers[id] || 0) - dt);
      if (this.siegeTimers[id] <= 0) {
        const amount = Math.min(18, 2 + row.count * 1.3);
        this.damageEntrance(entrance, amount, row.sample);
        this.siegeTimers[id] = 1.6;
      }
    }
    for (const key of Object.keys(this.siegeTimers)) {
      if (!pressed.has(key)) this.siegeTimers[key] = Math.max(0, (this.siegeTimers[key] || 0) - dt);
    }
  }

  updateGateMeter() {
    const gate = this.mainGate();
    if (!gate) return;
    this.gateHp = Math.max(0, gate.hp);
    if (gate.broken) this.gateHp = 0;
  }

  damageEntrance(entrance, amount, source = null) {
    if (!entrance || entrance.broken || !(amount > 0)) return;
    const before = entrance.hp;
    this.game.mansion.damageEntrance(entrance, amount, this.game, source && source.x, source && source.y);
    this.nightStats.damageToWalls += Math.max(0, before - entrance.hp);
    this.gateHp = Math.max(0, this.mainGate() ? this.mainGate().hp : 0);
    if (entrance.broken) this.onBreach(entrance);
  }

  onBreach(entrance) {
    if (this._breachAt[entrance.id] != null) return;
    this._breachAt[entrance.id] = this.uiClock;
    if (!Array.isArray(this.nightStats.breached)) this.nightStats.breached = [];
    if (!this.nightStats.breached.includes(entrance.id)) this.nightStats.breached.push(entrance.id);
    this.game.mansion.refreshNavAround(entrance);
    this.pushEvent('breach', 'doorBroken', 'BREACH!');
    this.game.renderer.shake(0.22);
  }

  /**
   * Inside the banner's yards the garrison hits harder (gold numbers). The
   * number pops bigger on the bolt that kills, so a heavy shot reads.
   */
  enemyDamageTaken(enemy, amount) {
    const held = this.inTerritory(enemy.x, enemy.y);
    const dealt = amount * (held ? this.tuning.territoryDamageTakenMul : 1);
    if (dealt > 0.5) {
      // bodies read bigger in Survival (SURVIVAL_ACTOR_SCALE): the number
      // and the flash sit at their chest, not at their knees
      const h = (enemy._survivalType === 'breaker' ? 96 : enemy._survivalType === 'individual' ? 78 : 60) * SURVIVAL_ACTOR_SCALE;
      const kill = (enemy.hp || 0) - dealt <= 0;
      const src = killSource(this.game, enemy._lastHitBy);
      const heavy = src === 'tower' || src === 'keep' || src === 'flare' || dealt >= 28;
      this.pushDamageNumber(enemy, dealt, kill ? 'kill' : heavy ? 'heavy' : held ? 'held' : 'hit', h * DMG_NUMBER.head, held);
      // the hit lands: a flash and a ring at the body (world3d) and sparks
      // thrown back along the shot
      const color = HIT_COLOR[src] || '#ffffff';
      this.pushFx('impact', enemy.x, enemy.y, { h: h * 0.62, color, heavy, kill });
      const g = this.game;
      if (g.particles) {
        g.particles.burst('spark', enemy.x, enemy.y, heavy ? 10 : 6, {
          color: heavy ? 'rgba(255,170,90,0.95)' : src === 'guard' ? 'rgba(170,236,255,0.95)' : 'rgba(255,226,150,0.95)',
          sizeMin: heavy ? 2.4 : 1.8, sizeMax: heavy ? 5.5 : 4, speedMin: 50, speedMax: heavy ? 260 : 190,
          lifeMin: 0.12, lifeMax: heavy ? 0.42 : 0.32, glow: true,
        });
      }
    }
    return dealt;
  }

  /** Claws are never blunted or blocked: the banner only strengthens the garrison. */
  enemyCanAttack() { return true; }
  enemyAttackMul() { return 1; }

  /**
   * BUILD 10: the gates open for the captain. Walking into a gate's mouth (or
   * at it from close by) swings the leaf open; it stays open while he stands
   * in the opening, a moment longer once he is clear, then swings shut. Open
   * (e.sortie) is see-through for every shot and every line of sight; it
   * never lets a body through (mansion.resolve). Also works out whether he
   * is exposed tonight: outside the wall, or standing in a gate's mouth.
   */
  updateSortieGates(dt) {
    const g = this.game;
    const m = g.mansion;
    const p = g.player;
    const alive = p.alive !== false && p.state !== 'death' && p.state !== 'dead';
    // what the player is asking for: the stick's (or the keys') heading in
    // the world, not how the body happens to be moving (BUILD 11: a shove
    // used to count as walking at the gate)
    const move = g.input && g.input.move ? g.input.move : { x: 0, y: 0 };
    const intent = screenDirToWorld(move.x || 0, move.y || 0, g.renderer);
    const steer = intent.mag > 0.25 ? intent : null;
    this.captainInGate = null;
    if (!m.isFortress) { this.captainExposed = false; return; }
    for (const e of m.entrances) {
      if (!e.gate || !e.exterior) continue;
      const out = outwardOf(e);
      const rx = p.x - e.x, ry = p.y - e.y;
      const across = rx * out.x + ry * out.y;          // > 0: outside the wall
      const along = -rx * out.y + ry * out.x;
      const half = (e.axis === 'v' ? e.h : e.w) / 2;
      const inSpan = alive && Math.abs(along) < half + 6;
      const inBand = inSpan && Math.abs(across) < SORTIE.band;
      // steering at the wall from either side (the stick's heading, 0..1)
      const toward = steer ? steer.x * out.x + steer.y * out.y : 0;
      const atIt = inSpan && Math.abs(across) < SORTIE.near && (across < 0 ? toward > SORTIE.toward : toward < -SORTIE.toward);
      if (inBand && !this.captainInGate) this.captainInGate = e;
      const want = !e.broken && !e.open && (inBand || atIt);
      e.sortieHold = want ? SORTIE.holdTime : Math.max(0, (e.sortieHold || 0) - dt);
      const goal = want || e.sortieHold > 0 ? 1 : 0;
      const t = e.sortieT || 0;
      e.sortieT = goal ? Math.min(1, t + dt / SORTIE.openTime) : Math.max(0, t - dt / SORTIE.closeTime);
      if (e.broken) e.sortieT = 0;
      e.sortie = e.sortieT > 0.5;
    }
    this.captainExposed = this.phase === 'night' && alive
      && (!!this.captainInGate || m.findRoom(p.x, p.y) === ROOM.OUTSIDE);
    // how many bodies are already on him (goForCaptain caps new ones)
    let on = 0;
    if (this.captainExposed) for (const e of g.enemies) if (e._onCaptain && !e.dead && !e.removeMe) on++;
    this._onCaptainCount = on;
  }

  /**
   * Behind the wall the captain gets his breath back (BUILD 10): once he is
   * inside — not out there, not in a gate's mouth — and nothing has clawed
   * him for SORTIE.restDelay s, he heals SORTIE.rest HP/s, with a green
   * "+" over him each second. A sortie costs HP; the bailey gives it back.
   */
  updateRest(dt) {
    const p = this.game.player;
    const hp = Number(p.blood) || 0;
    if (this._restBlood != null && hp < this._restBlood - 0.01) this._restCalm = 0;
    else this._restCalm = (this._restCalm || 0) + dt;
    const alive = p.alive !== false && p.state !== 'death' && p.state !== 'dead' && hp > 0;
    if (alive && !this.captainExposed && this._restCalm >= SORTIE.restDelay && hp < p.bloodMax) {
      const gain = Math.min(p.bloodMax - hp, SORTIE.rest * dt);
      p.blood = hp + gain;
      this._restGain = (this._restGain || 0) + gain;
      this.nightStats.rested = (this.nightStats.rested || 0) + gain;
      if (this._restGain >= SORTIE.rest || p.blood >= p.bloodMax) {
        this.pushFloater(p.x, p.y, `+${Math.round(this._restGain)}`, '#5ee07a', { h: 96, size: 15, icon: 'heart', life: 0.9 });
        this._restGain = 0;
      }
    } else this._restGain = 0;
    this._restBlood = Number(p.blood) || 0;
  }

  /** One more body may go for the exposed captain (SORTIE.maxOnCaptain at once). */
  claimCaptain() {
    if ((this._onCaptainCount || 0) >= SORTIE.maxOnCaptain) return false;
    this._onCaptainCount = (this._onCaptainCount || 0) + 1;
    return true;
  }

  autoTarget() {
    const p = this.game.player;
    // BUILD 10: no more door slits. A shut gate blocks the shot like the wall
    // does; one swung open for him (he stands in it) does not.
    const candidates = this.game.enemies.filter((e) => !e.dead && !e.removeMe && e.hp > 0
      && dist(p.x, p.y, e.x, e.y) <= this.tuning.autoAttackRange
      && this.game.mansion.hasLOS(p.x, p.y, e.x, e.y));
    candidates.sort((a, b) => this.targetScore(p, a) - this.targetScore(p, b));
    return candidates[0] || null;
  }

  /** Lower is shot first: whatever claws the keep, then what is already inside. */
  targetScore(from, e) {
    let s = dist(from.x, from.y, e.x, e.y);
    if (e._survivalType === 'breaker') s -= 70;
    else if (e._survivalType === 'individual') s -= 20;
    if (e.attackingKeep) s -= 160;
    else if (e._inHouse) s -= 60;
    return s;
  }

  /* ---------------- guards (survivors) ---------------- */

  /** One pawn per soldier (capped). New ones step out by the keep. */
  _syncGuardRoster(snap = false, from = null) {
    const want = clamp(Math.floor(this.survivors || 0), 0, GUARD.cap);
    while (this.guards.length > want) this.guards.pop();
    let fresh = 0;
    while (this.guards.length < want) {
      const i = this.guards.length;
      const post = this._keepPost(i);
      // a soldier a barracks just housed starts at its door (fanned out so
      // two do not stand in one spot) and walks to the post
      const start = from && !snap ? { x: from.x + (fresh % 2 ? 26 : -26) * Math.ceil(fresh / 2), y: from.y + 40 } : post;
      const guard = new SurvivalGuard(i, start.x, start.y);
      guard.post = start === post ? post : null;
      this.guards.push(guard);
      fresh++;
    }
    if (fresh && from && !snap) this._guardAssignT = 0;
    if (snap) {
      // a new phase (dawn, dusk, a fresh run): everyone stands, healed, by the keep
      for (const guard of this.guards) {
        const post = this._keepPost(guard.index);
        guard.x = post.x; guard.y = post.y; guard.post = post;
        guard.path = null; guard.moving = false; guard.target = null; guard.shotT = 0;
        guard.lift = 0; guard.liftPost = null; guard.climbing = false;
        guard.hp = guard.hpMax; guard.down = false; guard.downT = 0; guard.rescueT = 0; guard.hurtFlash = 0; guard.iframes = 0;
      }
    }
  }

  /** Guards still on their feet (the HUD counts these). */
  standingGuards() { return this.guards.filter((guard) => !guard.down).length; }

  /** The nearest standing guard a body is close enough to claw. */
  guardInReach(enemy) {
    let best = null, bestD = Infinity;
    for (const guard of this.guards) {
      if (guard.down || guard.up) continue;          // up on the wall: out of reach
      const d = dist(enemy.x, enemy.y, guard.x, guard.y);
      if (d < (enemy.radius || 13) + guard.radius + GUARD.reach && d < bestD) { best = guard; bestD = d; }
    }
    return best;
  }

  /**
   * A guard a body in the dark goes for: the one it already picked while it
   * stays close and standing, else the nearest within huntRange that has
   * fewer than maxHunters on it (counted once a frame in updateGuards).
   */
  guardToHunt(enemy) {
    const prev = enemy._prey;
    if (prev && !prev.down && !prev.up && this.guards.includes(prev)
      && dist(enemy.x, enemy.y, prev.x, prev.y) < GUARD.huntRange * 1.4) return prev;
    enemy._prey = null;
    let best = null, bestD = GUARD.huntRange;
    for (const guard of this.guards) {
      if (guard.down || guard.up || (guard.hunters || 0) >= GUARD.maxHunters) continue;
      const d = dist(enemy.x, enemy.y, guard.x, guard.y);
      if (d < bestD) { best = guard; bestD = d; }
    }
    if (best) { enemy._prey = best; best.hunters = (best.hunters || 0) + 1; }
    return best;
  }

  /** A claw lands on a guard. */
  hurtGuard(guard, amount, from = null) {
    if (!guard || guard.down || this.phase !== 'night' || !(amount > 0)) return false;
    // like the Hunter, a guard is not shredded by a crowd landing every claw
    // in the same frame
    if (guard.iframes > 0) return false;
    guard.iframes = GUARD.iframes;
    guard.hp = Math.max(0, guard.hp - amount);
    guard.hurtFlash = 1;
    this.nightStats.guardDamage = (this.nightStats.guardDamage || 0) + amount;
    this.pushFloater(guard.x, guard.y, `-${Math.round(amount)}`, '#ff6b5e', { h: 64, size: 15 });
    const g = this.game;
    g.audio.play('slash', { x: guard.x, y: guard.y, cam: g.renderer.cam, vol: 0.45 });
    if (guard.hp <= 0) this._downGuard(guard, from);
    else if (guard.hp <= guard.hpMax * GUARD.woundedAt) this._guardAssignT = 0;   // fall back now
    return true;
  }

  _downGuard(guard) {
    // claws never reach one up on the wall; dropped there anyway (a script),
    // it lies at the foot of its ladder
    if (guard.liftPost) {
      guard.x = guard.liftPost.foot.x; guard.y = guard.liftPost.foot.y;
      guard.lift = 0; guard.liftPost = null; guard.climbing = false;
    }
    guard.down = true;
    guard.hp = 0;
    guard.downT = 0;
    guard.rescueT = 0;
    guard.path = null; guard.moving = false; guard.target = null; guard.shotT = 0;
    this.nightStats.guardsDown = (this.nightStats.guardsDown || 0) + 1;
    this.pushEvent('guardDown', 'medic', 'GUARD DOWN!', { life: 2.2 });
    this.game.audio.play('playerHurt', { vol: 0.5 });
    this._guardAssignT = 0;
  }

  /**
   * The Hunter stands beside a fallen guard: after a moment it gets up. Left
   * alone, its clock runs out and it is lost (the clock stops while helped).
   */
  _updateRescue(guard, dt) {
    const p = this.game.player;
    const near = this.phase === 'night' && p.state !== 'death' && p.state !== 'dead'
      && dist(p.x, p.y, guard.x, guard.y) <= GUARD.rescueRange;
    guard.rescueT = near ? guard.rescueT + dt : Math.max(0, guard.rescueT - dt * 2);
    if (!near) {
      guard.downT += dt;
      if (guard.downT >= GUARD.bleedOut) { this._loseGuard(guard); return; }
    }
    if (guard.rescueT < GUARD.rescueTime) return;
    guard.down = false;
    guard.rescueT = 0;
    guard.hp = Math.round(guard.hpMax * GUARD.rescueHp);
    guard.cd = 0.6;
    this.nightStats.rescued = (this.nightStats.rescued || 0) + 1;
    this.pushFloater(guard.x, guard.y, `+${guard.hp}`, '#5ee07a', { h: 70, size: 18, icon: 'heart', life: 1.2 });
    this.game.audio.play('uiConfirm', { vol: 0.5 });
    this._guardAssignT = 0;
  }

  /** Nobody came: one survivor fewer, for the rest of the run. */
  _loseGuard(guard) {
    const i = this.guards.indexOf(guard);
    if (i < 0) return;
    this.guards.splice(i, 1);
    this.guards.forEach((g, k) => { g.index = k; g.id = 5000000 + k; });
    this.survivors = Math.max(0, this.survivors - 1);
    this.nightStats.lost = (this.nightStats.lost || 0) + 1;
    this.runStats.lost = (this.runStats.lost || 0) + 1;
    this.pushEvent('guardLost', 'guard', 'GUARD LOST', { life: 2.2 });
    this.game.audio.play('playerHurt', { vol: 0.65 });
    this._guardAssignT = 0;
    this._persist(true);
  }

  /** A loose ring around the keep's foot (day camp / spare guards at night). */
  _keepPost(i) {
    const keep = this.keep();
    const t = (i + 0.5) / GUARD.cap;
    // south-east round to north-west: the Hunter's own spot is on the east
    const a = Math.PI * (0.35 + 0.8 * t);
    const r = keep.r + 54 + (i % 2) * 30;
    return this._freePost(keep.x + Math.cos(a) * r, keep.y + Math.sin(a) * r, 'keep', null);
  }

  /**
   * Where a guard holds a door. In the fortress (BUILD 10) that is up on the
   * wall: slot 0/1 on the tops of the gate's two towers (a postern: the
   * wooden decks either side of it), reached by the ladder at the post's
   * foot (fortress.wallPosts). Elsewhere: just inside the door, beside its
   * frame.
   */
  _doorPost(door, slot) {
    const wall = this.game.mansion.wallPosts;
    const top = wall && slot < 2 ? wall.find((w) => w.gate === door.id && w.slot === slot) : null;
    if (top) return { key: `wall:${door.id}:${slot}`, x: top.foot.x, y: top.foot.y, doorId: door.id, wall: top };
    const out = outwardOf(door);
    const inward = { x: -out.x, y: -out.y };
    const along = { x: -inward.y, y: inward.x };
    const base = door.inside || door;
    const side = slot % 2 === 0 ? -1 : 1;
    const lateral = side * (26 + Math.floor(slot / 2) * 30);
    const depth = 46 + Math.floor(slot / 2) * 26;
    return this._freePost(base.x + inward.x * depth + along.x * lateral,
      base.y + inward.y * depth + along.y * lateral, `door:${door.id}:${slot}`, door.id, inward);
  }

  /** Nudge a post off furniture so a pawn never stands inside a table. */
  _freePost(x, y, key, doorId, push = null) {
    const m = this.game.mansion;
    const free = (px, py) => !m.solidAt(px, py) && !m.solidAt(px + 10, py) && !m.solidAt(px - 10, py)
      && !m.solidAt(px, py + 10) && !m.solidAt(px, py - 10);
    if (!free(x, y)) {
      const tries = push ? [[push.x * 24, push.y * 24], [push.x * 48, push.y * 48], [-push.y * 30, push.x * 30], [push.y * 30, -push.x * 30]]
        : [[0, 30], [30, 0], [-30, 0], [0, -30], [36, 36], [-36, 36]];
      for (const [ox, oy] of tries) if (free(x + ox, y + oy)) { x += ox; y += oy; break; }
    }
    return { key, x, y, doorId };
  }

  /**
   * Who stands where tonight: doors ranked by how many bodies lean on them
   * (outside crowds + anything coming through a breach), up to GUARD.perDoor
   * each; the rest hold the keep. A guard keeps its post while that door is
   * still in the ranking, so they do not ping-pong across the house.
   */
  assignGuards() {
    const g = this.game;
    if (!this.guards.length) return;
    if (this.phase !== 'night') {
      for (const guard of this.guards) this._setGuardPost(guard, this._keepPost(guard.index));
      return;
    }
    // a fallen guard stays where it fell; a badly hurt one holds the keep
    const able = [];
    for (const guard of this.guards) {
      if (guard.down) continue;
      if (guard.hp <= guard.hpMax * GUARD.woundedAt) this._setGuardPost(guard, this._keepPost(guard.index));
      else able.push(guard);
    }
    const threat = new Map();
    for (const e of g.enemies) {
      if (e.dead || e.removeMe || !e._survivalType) continue;
      if (!e._inHouse) {
        const id = e._survivalType === 'breaker' ? e.targetEntranceId : e.entranceId;
        const door = id && this.entranceById(id);
        if (!door || dist(e.x, e.y, door.x, door.y) > 520) continue;
        threat.set(door, (threat.get(door) || 0) + (e._survivalType === 'swarm' ? 1 : 3));
      }
    }
    // a breach keeps its guards: invaders still walk past them
    for (const door of g.mansion.entrances) {
      if (door.kind === 'door' && door.exterior && door.broken) {
        const near = this.enemiesNear(door.x, door.y, 420);
        if (near > 0) threat.set(door, (threat.get(door) || 0) + near);
      }
    }
    const ranked = [...threat.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    const slots = [];
    for (let pass = 0; pass < GUARD.perDoor; pass++) {
      for (const [door] of ranked) slots.push({ door, slot: pass });
    }
    const taken = new Set();
    const pending = [];
    for (const guard of able) {
      const keep = guard.post && guard.post.doorId
        && slots.find((s) => s.door.id === guard.post.doorId && !taken.has(`${s.door.id}:${s.slot}`));
      if (keep) { taken.add(`${keep.door.id}:${keep.slot}`); this._setGuardPost(guard, this._doorPost(keep.door, keep.slot)); }
      else pending.push(guard);
    }
    for (const guard of pending) {
      const free = slots.find((s) => !taken.has(`${s.door.id}:${s.slot}`));
      if (free) { taken.add(`${free.door.id}:${free.slot}`); this._setGuardPost(guard, this._doorPost(free.door, free.slot)); }
      else this._setGuardPost(guard, this._keepPost(guard.index));
    }
  }

  _setGuardPost(guard, post) {
    if (guard.post && guard.post.key === post.key && Math.hypot(guard.post.x - post.x, guard.post.y - post.y) < 4) return;
    guard.post = post;
    // one up on the wall walks on from the foot of its ladder once it is down
    const from = guard.liftPost ? guard.liftPost.foot : guard;
    guard.path = this.game.mansion.navPath(from.x, from.y, post.x, post.y) || [{ x: post.x, y: post.y }];
    guard.pathI = 0;
  }

  /**
   * One step up (dt > 0) or down (dt < 0) the ladder of guard.liftPost: from
   * its foot in the yard to the post on top. Returns true while the guard is
   * still on the ladder (no shots, no claws once it is most of the way up).
   */
  _climb(guard, dt) {
    const w = guard.liftPost;
    if (!w) return false;
    guard.lift = clamp(guard.lift + dt / GUARD.climb, 0, 1);
    // straight up the ladder at its foot, then the step across onto the post
    const across = clamp((guard.lift - GUARD.climbShare) / (1 - GUARD.climbShare), 0, 1);
    guard.x = w.foot.x + (w.x - w.foot.x) * across;
    guard.y = w.foot.y + (w.y - w.foot.y) * across;
    guard.angle = Math.atan2(-w.inward.y, -w.inward.x);    // faces the wall, the ladder
    if (guard.lift <= 0) { guard.liftPost = null; guard.climbing = false; return false; }
    if (guard.lift >= 1) { guard.climbing = false; return false; }
    guard.climbing = true;
    guard.moving = true;
    guard.walkT += Math.abs(dt);
    return true;
  }

  /**
   * Nearest thing worth a bolt that this guard can actually hit. Up on the
   * wall it shoots over the masonry (and a little further); on the ground a
   * shut gate blocks it like the wall does (BUILD 10: no door slits).
   */
  guardTarget(guard) {
    const m = this.game.mansion;
    const up = guard.lift >= 1;
    const range = up ? GUARD.upRange : GUARD.range;
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0)) continue;
      const d = dist(guard.x, guard.y, e.x, e.y);
      if (d > range) continue;
      const s = this.targetScore(guard, e);
      if (s >= bestS) continue;
      if (!up && !m.hasLOS(guard.x, guard.y, e.x, e.y)) continue;
      best = e; bestS = s;
    }
    return best;
  }

  updateGuards(dt) {
    const g = this.game;
    this._syncGuardRoster(false);
    if (!this.guards.length) return;
    this._guardAssignT = (this._guardAssignT || 0) - dt;
    if (this._guardAssignT <= 0) { this._guardAssignT = 0.5; this.assignGuards(); }
    const night = this.phase === 'night';
    // how many bodies are going for each guard (guardToHunt caps it)
    for (const guard of this.guards) guard.hunters = 0;
    if (night) {
      for (const e of g.enemies) {
        const prey = e._prey;
        if (prey && !e.dead && !e.removeMe && !prey.down) prey.hunters = (prey.hunters || 0) + 1;
      }
    }
    for (const guard of [...this.guards]) {
      guard.shotT = Math.max(0, guard.shotT - dt);
      guard.hurtFlash = Math.max(0, (guard.hurtFlash || 0) - dt * 4);
      guard.iframes = Math.max(0, (guard.iframes || 0) - dt);
      if (guard.down) {
        guard.moving = false;
        this._updateRescue(guard, dt);
        continue;
      }
      guard.moving = false;
      guard.climbing = false;
      // BUILD 10: a post up on the wall (fortress.wallPosts) is reached by a
      // ladder. Off to anywhere else (or at dawn) a guard climbs down first.
      const wall = night && guard.post && guard.post.wall ? guard.post.wall : null;
      if (guard.liftPost && guard.liftPost !== wall && this._climb(guard, -dt)) {
        guard.target = null;
        guard.cd = Math.max(guard.cd, 0.25);
        continue;
      }
      // walk the path to the post
      if (guard.path && guard.pathI < guard.path.length) {
        const wp = guard.path[guard.pathI];
        const dx = wp.x - guard.x, dy = wp.y - guard.y;
        const d = Math.hypot(dx, dy);
        const step = GUARD.speed * dt;
        if (d <= step) { guard.x = wp.x; guard.y = wp.y; guard.pathI++; }
        else { guard.x += dx / d * step; guard.y += dy / d * step; }
        if (d > 0.5) guard.angle = Math.atan2(dy, dx);
        guard.moving = true;
        guard.walkT += dt;
      }
      // at the foot of its ladder: up it goes
      if (wall && !guard.moving && guard.lift < 1) {
        guard.liftPost = wall;
        if (this._climb(guard, dt)) { guard.target = null; guard.cd = Math.max(guard.cd, 0.25); continue; }
      }
      if (!night) { guard.target = null; continue; }
      guard.cd -= dt;
      if (guard.moving) { guard.cd = Math.max(guard.cd, 0.25); continue; }
      if (guard.cd > 0) {
        if (guard.target && !guard.target.dead) guard.angle = Math.atan2(guard.target.y - guard.y, guard.target.x - guard.x);
        continue;
      }
      const target = this.guardTarget(guard);
      guard.target = target;
      if (!target) { guard.cd = 0.3; continue; }
      const lead = dist(guard.x, guard.y, target.x, target.y) / GUARD.boltSpeed;
      const tx = target.x + (target.vx || 0) * lead, ty = target.y + (target.vy || 0) * lead;
      guard.angle = Math.atan2(ty - guard.y, tx - guard.x);
      // from up on the wall the bolt flies over the merlons and drops on them
      const up = guard.lift >= 1 && guard.liftPost;
      // the garrison's crossbows (BUILD 14): damage, rate and (Lv3) a bolt
      // that runs on through a body
      const arms = this.armsStats();
      const bolt = g.spawnBolt(guard, guard.angle, {
        offset: 16, boltSpeed: GUARD.boltSpeed, damage: arms.damage, friendly: true,
        over: !!up, dropFrom: up ? guard.liftPost.kind : null, boltPierce: arms.pierce || 0,
      });
      if (bolt) {
        bolt.guard = true;
        bolt.arms = this.armsLevel;
        // BUILD 15: the post it leaves from (a south / east bastion is low)
        if (up) bolt.dropPost = guard.liftPost;
        if (up) bolt.aimDist = Math.max(40, dist(guard.x, guard.y, target.x, target.y) - 10);
      }
      guard.cd = arms.every + rand(-0.12, 0.18);
      guard.shotT = 0.2;
      this.nightStats.guardShots = (this.nightStats.guardShots || 0) + 1;
      g.audio.play('crossbow', { x: guard.x, y: guard.y, cam: g.renderer.cam, vol: 0.3 });
    }
  }

  /** The outer door a tower in this room guards (null: the room has none). */
  towerDoor(room) {
    if (!room) return null;
    let best = null, bestRank = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior || e.kind !== 'door' || !e.inside) continue;
      const { x, y } = e.inside;
      if (!(x > room.x && x < room.x + room.w && y > room.y && y < room.y + room.h)) continue;
      const rank = TOWER.doors.includes(e.id) ? TOWER.doors.indexOf(e.id) : TOWER.doors.length;
      if (rank < bestRank) { best = e; bestRank = rank; }
    }
    return best;
  }

  /**
   * Where a circle's building stands (its model, its ghost and the circle on
   * the floor): the bailey's plan (PLOT), an offset from the keep. A ballista
   * plot also names the gate it guards (its yard's outer gate). A plot the
   * plan does not know (a house layout) falls back to the floor search.
   * Fixed per circle.
   */
  buildingSpot(slotId) {
    if (!this._spots) this._spots = new Map();
    if (this._spots.has(slotId)) return this._spots.get(slotId);
    const slot = SLOT_BY_ID.get(slotId);
    const room = slot && this.game.mansion.room(slot.room);
    if (!room) return null;
    const door = slot.type === 'tower' ? this.towerDoor(room) : null;
    const plan = this.game.mansion.isFortress ? PLOT.at[slotId] : null;
    let spot;
    if (plan) {
      const keep = this.keep();
      spot = { x: Math.round(keep.x + plan[0]), y: Math.round(keep.y + plan[1]), doorId: door ? door.id : null };
    } else {
      const avoid = [];
      for (const other of SURVIVAL_SLOTS) {
        if (other === slot || other.room !== slot.room || !this._spots.has(other.id)) continue;
        avoid.push(this._spots.get(other.id));
      }
      spot = this._findSpot(room, door, avoid, null);
    }
    this._spots.set(slotId, spot);
    return spot;
  }

  _findSpot(room, door, avoid = [], at = null) {
    const m = this.game.mansion;
    const pad = 46;
    const keep = this.keep();
    let ideal;
    if (door) {
      let nx = door.inside.x - door.x, ny = door.inside.y - door.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      let sx = -ny, sy = nx;
      if ((room.x + room.w / 2 - door.x) * sx + (room.y + room.h / 2 - door.y) * sy < 0) { sx = -sx; sy = -sy; }
      ideal = { x: door.x + nx * TOWER.setback + sx * TOWER.side, y: door.y + ny * TOWER.setback + sy * TOWER.side };
    } else if (at) {
      ideal = { x: room.x + room.w * at[0], y: room.y + room.h * at[1] };
    } else {
      ideal = { x: room.x + room.w / 2 + 48, y: room.y + room.h / 2 + 24 };
    }
    ideal.x = clamp(ideal.x, room.x + pad, room.x + room.w - pad);
    ideal.y = clamp(ideal.y, room.y + pad, room.y + room.h - pad);
    const clear = (x, y) => {
      if (x < room.x + pad || x > room.x + room.w - pad || y < room.y + pad || y > room.y + room.h - pad) return false;
      if (m.solidAt(x, y)) return false;
      if (keep && dist(x, y, keep.x, keep.y) < keep.r + CIRCLE.radius + 28) return false;
      for (const q of avoid) if (q && dist(x, y, q.x, q.y) < CIRCLE.radius * 2 + 40) return false;
      for (const r of [26, 42]) {
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          if (m.solidAt(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false;
        }
      }
      // a tower must see out through its door's slit with nothing in the way
      return !door || this.boltPath(x, y, door.outside.x, door.outside.y);
    };
    const out = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), doorId: door ? door.id : null });
    if (clear(ideal.x, ideal.y)) return out(ideal);
    for (let r = 16; r <= 192; r += 16) {
      const steps = Math.max(8, Math.round(r / 8));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = ideal.x + Math.cos(a) * r, y = ideal.y + Math.sin(a) * r;
        if (clear(x, y)) return out({ x, y });
      }
    }
    return out(ideal);
  }

  /**
   * A bolt from (x0, y0) reaches (x1, y1) at body height: sight through door
   * slits, and no masonry or furniture in its way from where it leaves the
   * string. Only the house layout's plot search still uses it (the fortress's
   * ballistas shoot over the wall since BUILD 10); tools/survival-map.mjs
   * uses it to check a ballista still faces its gate down a clear road.
   */
  boltPath(x0, y0, x1, y1, start = 20) {
    const m = this.game.mansion;
    if (!m.hasLOS(x0, y0, x1, y1, { throughDoors: true })) return false;
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    for (let s = start; s < d - 6; s += 10) if (m.solidAt(x0 + dx / d * s, y0 + dy / d * s)) return false;
    return true;
  }

  towerStats(slotId) { return this.buildingStats('tower', this.buildingLevel(slotId)); }

  /** Towers mirror `buildings`: one per ballista circle built, any level. */
  _syncTowers() {
    const ids = Object.keys(this.buildings).filter((id) => this.buildings[id] === 'tower');
    if (ids.length === this.towers.length && ids.every((id, i) => this.towers[i].slotId === id)) return;
    const old = new Map(this.towers.map((t) => [t.slotId, t]));
    this.towers = ids.map((slotId, i) => old.get(slotId) || this._makeTower(slotId, i)).filter(Boolean);
  }

  _makeTower(slotId, index) {
    const spot = this.buildingSpot(slotId);
    const slot = SLOT_BY_ID.get(slotId);
    if (!spot || !slot) return null;
    const door = spot.doorId ? this.entranceById(spot.doorId) : null;
    const angle = door ? Math.atan2(door.y - spot.y, door.x - spot.x) : Math.PI / 2;
    return {
      id: 6000000 + index, key: 'tower', slotId, roomId: slot.room, doorId: spot.doorId,
      x: spot.x, y: spot.y, radius: 18,
      angle, aim: angle,                // shot bearing / the ballista's swing
      cd: 0.4 + index * 0.27, shotT: 0, target: null, shots: 0,
      type: { boltSpeed: TOWER.boltSpeed, boltDamage: 1 },
    };
  }

  /**
   * What a ballista shoots. It stands high on its deck, so (BUILD 10) its
   * bolt flies over the wall instead of threading a shut gate: anything in
   * range will do. In the house layout it still needs a clear path.
   */
  towerTarget(tower, range) {
    const high = this.game.mansion.isFortress;
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0)) continue;
      if (dist(tower.x, tower.y, e.x, e.y) > range) continue;
      const s = this.targetScore(tower, e);
      if (s >= bestS) continue;
      if (!high && !this.boltPath(tower.x, tower.y, e.x, e.y)) continue;
      best = e; bestS = s;
    }
    return best;
  }

  updateTowers(dt) {
    this._syncTowers();
    if (!this.towers.length) return;
    const g = this.game;
    const night = this.phase === 'night';
    for (const t of this.towers) {
      t.shotT = Math.max(0, t.shotT - dt);
      t.aim = approachAngle(t.aim, t.angle, TOWER.turn * dt);
      if (!night) { t.target = null; continue; }
      t.cd -= dt;
      if (t.cd > 0) {
        if (t.target && !t.target.dead) t.angle = Math.atan2(t.target.y - t.y, t.target.x - t.x);
        continue;
      }
      const st = this.towerStats(t.slotId);
      const target = this.towerTarget(t, st.range || 0);
      t.target = target;
      if (!target) { t.cd = 0.25; continue; }
      const lead = dist(t.x, t.y, target.x, target.y) / TOWER.boltSpeed;
      t.angle = Math.atan2(target.y + (target.vy || 0) * lead - t.y, target.x + (target.vx || 0) * lead - t.x);
      const bolt = g.spawnBolt(t, t.angle, {
        offset: 20, boltSpeed: TOWER.boltSpeed, damage: st.damage, friendly: true,
        boltPierce: TOWER.pierce, boltRange: (st.range || 0) + TOWER.reach,
        over: g.mansion.isFortress,
      });
      // aimDist: where the bolt drops from the deck to body height (3D)
      if (bolt) { bolt.tower = true; bolt.aimDist = Math.max(40, dist(t.x, t.y, target.x, target.y) - 20); }
      t.cd = TOWER.every + rand(-0.06, 0.1);
      t.shotT = 0.26;
      t.shots++;
      this.nightStats.towerShots = (this.nightStats.towerShots || 0) + 1;
      g.audio.play('crossbow', { x: t.x, y: t.y, cam: g.renderer.cam, vol: 0.42 });
    }
  }

  useSkill() {
    if (this.phase !== 'night' || this.skillCooldown > 0) return false;
    const g = this.game;
    const p = g.player;
    this.skillCooldown = this.skillCooldownMax;
    this.skillFlash = 0.65;
    this.nightStats.flares = (this.nightStats.flares || 0) + 1;
    g.audio.play('chandelier', { vol: 0.72 });
    g.particles.burst('spark', p.x, p.y, 26, {
      color: 'rgba(255,214,140,0.95)', sizeMin: 2, sizeMax: 6, speedMin: 55, speedMax: 240,
      lifeMin: 0.18, lifeMax: 0.68, glow: true,
    });
    let hit = 0;
    for (const e of g.enemies) {
      if (e.dead || dist(p.x, p.y, e.x, e.y) > this.tuning.skillRadius) continue;
      e._lastHitBy = 'flare';
      e.hurt(this.tuning.skillDamage, g, p.x, p.y);
      e.staggerT = Math.max(e.staggerT || 0, 0.85);
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.vx = (e.vx || 0) + Math.cos(a) * 170; e.vy = (e.vy || 0) + Math.sin(a) * 170;
      hit++;
    }
    // the big blast lands: a short hold and a hard shake
    g.renderer.shake(0.42);
    if (hit) this.hitStop = Math.max(this.hitStop, 0.06);
    return true;
  }

  /**
   * Mines dig gold into the purse all night long (it never burns). Each mine
   * shows its work: every whole coin it digs pops out of its shaft as a 3D
   * coin with a "+1" over it, so a mine reads as working, not as a number
   * that changes somewhere in the HUD (playtest 2026-10-16: "bangunan yg di
   * build juga tidak berfungsi"). The banks are visual only — the purse
   * still grows by goldRate() * dt.
   */
  updateMines(dt) {
    const dig = this.goldRate() * dt;
    if (dig > 0) {
      this.gold = Math.min(RESOURCE_CAP, this.gold + dig);
      this.nightStats.mined = (this.nightStats.mined || 0) + dig;
      this.runStats.mined = (this.runStats.mined || 0) + dig;
    }
    if (this.phase !== 'night') return;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type !== 'mine') continue;
      const rate = (this.buildingStats(type, this.buildingLevel(slotId)).yield || 0) / Math.max(1, this.nightDuration);
      const bank = (this._mineBank[slotId] || 0) + rate * dt;
      if (bank >= 1) {
        const spot = this.buildingSpot(slotId);
        if (spot) {
          this.pushFx('coin', spot.x, spot.y, { slotId });
          this.pushFloater(spot.x, spot.y, '+1', '#ffd24a', { h: 150, size: 22, icon: 'gold', life: 1.15, pop: 1.3, kind: 'income' });
        }
        // and beside the purse in the HUD, wherever the captain stands: the
        // mine at work is seen from the gate he is holding
        this.pushHudPop('gold', '+1', 'mine');
        this._mineBank[slotId] = bank - 1;
      } else this._mineBank[slotId] = bank;
    }
  }

  /* ---------------- the keep and its banner ---------------- */

  /** The keep: a round stone tower in the middle of the bailey's inner ward. */
  keep() {
    if (!this._keep) {
      const m = this.game.mansion;
      const spot = m.keepSpot || m.roomCenter(ROOM.HALL);
      this._keep = spot
        ? { x: Math.round(spot.x), y: Math.round(spot.y), r: this.tuning.keepRadius }
        : { x: 0, y: 0, r: this.tuning.keepRadius };
    }
    return this._keep;
  }

  keepHpMax(level = this.keepLevel) { return this.tuning.keepHp[clamp(Math.round(level) || 1, 1, 3)] || 600; }

  /**
   * What the keep shows (tower, townsfolk, HUD), most urgent first:
   * fallen · critical (< 25%) · attacked (a claw in the last moment) ·
   * threat (bodies inside and close) · safe.
   */
  keepState() {
    if (this.keepHp <= 0) return 'fallen';
    if (this.phase === 'night') {
      if (this.uiClock - this._keepHitAt < KEEP.attackedFor) return this.keepHp < this.keepHpMax() * 0.25 ? 'critical' : 'attacked';
      if (this.keepHp < this.keepHpMax() * 0.25) return 'critical';
      const keep = this.keep();
      for (const e of this.game.enemies) {
        if (!e._survivalType || e.dead || e.removeMe || !e._inHouse) continue;
        if (dist(e.x, e.y, keep.x, keep.y) < KEEP.alarmRange) return 'threat';
      }
      return 'safe';
    }
    return this.keepHp < this.keepHpMax() * 0.25 ? 'critical' : 'safe';
  }

  /** A body at the keep's wall claws it. At 0 HP the run is lost. */
  hitKeep(enemy) {
    if (this.phase !== 'night' || this.keepHp <= 0) return;
    const amount = KEEP.damage[enemy._survivalType] || KEEP.damage.swarm;
    const before = this.keepHp;
    this.keepHp = Math.max(0, this.keepHp - amount);
    const lost = before - this.keepHp;
    this.nightStats.keepDamage = (this.nightStats.keepDamage || 0) + lost;
    // the lowest the keep fell (R2: two stars need it never below half)
    const share = this.keepHp / Math.max(1, this.keepHpMax());
    this.nightStats.keepMin = Math.min(this.nightStats.keepMin == null ? 1 : this.nightStats.keepMin, share);
    this.runStats.keepMin = Math.min(this.runStats.keepMin == null ? 1 : this.runStats.keepMin, share);
    this._keepHitAt = this.uiClock;
    const keep = this.keep();
    const a = Math.atan2(enemy.y - keep.y, enemy.x - keep.x);
    const wx = keep.x + Math.cos(a) * keep.r, wy = keep.y + Math.sin(a) * keep.r;
    this.pushFloater(wx, wy, `-${Math.round(lost)}`, '#ff6b5e', { h: 120, size: 20, icon: 'keep' });
    if (this.uiClock - this._keepWarnAt > 7) {
      this._keepWarnAt = this.uiClock;
      this.pushEvent('keep', 'keep', 'KEEP UNDER ATTACK!');
    }
    const g = this.game;
    g.audio.play('impact', { vol: 0.34 });
    g.renderer.shake(0.08);
    g.particles.burst('spark', wx, wy, 8, {
      color: 'rgba(196,188,176,0.95)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 150, lifeMin: 0.25, lifeMax: 0.6,
    });
    if (this.keepHp <= 0) this.fail('THE KEEP FELL');
  }

  /** From Lv2 a ballista on the keep's roof shoots what comes for the keep. */
  updateKeepBallista(dt) {
    const b = this.keepBallista;
    b.shotT = Math.max(0, b.shotT - dt);
    b.aim = approachAngle(b.aim, b.angle, TOWER.turn * dt);
    const spec = KEEP.ballista[this.keepLevel];
    if (!spec || this.phase !== 'night' || this.keepHp <= 0) { b.target = null; return; }
    b.cd -= dt;
    if (b.cd > 0) return;
    const keep = this.keep();
    let best = null, bestS = Infinity;
    for (const e of this.game.enemies) {
      if (e.dead || e.removeMe || !(e.hp > 0) || !e._survivalType) continue;
      const d = dist(keep.x, keep.y, e.x, e.y);
      if (d > spec.range) continue;
      const s = d - (e.attackingKeep ? 200 : 0);
      if (s < bestS) { best = e; bestS = s; }
    }
    b.target = best;
    if (!best) { b.cd = 0.25; return; }
    b.angle = Math.atan2(best.y - keep.y, best.x - keep.x);
    // the bolt drops from the roof: it ignores the keep's own wall
    const shooter = { x: keep.x + Math.cos(b.angle) * (keep.r + 14), y: keep.y + Math.sin(b.angle) * (keep.r + 14), type: { boltSpeed: TOWER.boltSpeed, boltDamage: 1 }, key: 'keep' };
    const bolt = this.game.spawnBolt(shooter, b.angle, {
      offset: 0, boltSpeed: TOWER.boltSpeed, damage: spec.damage, friendly: true, boltRange: spec.range + 60,
      over: this.game.mansion.isFortress,
    });
    if (bolt) { bolt.tower = true; bolt.keepBolt = true; bolt.aimDist = Math.max(30, dist(shooter.x, shooter.y, best.x, best.y)); }
    b.cd = spec.every;
    b.shotT = 0.26;
    b.shots++;
    this.game.audio.play('crossbow', { x: keep.x, y: keep.y, cam: this.game.renderer.cam, vol: 0.36 });
  }

  /** How far the keep's banner reaches (px from the keep's centre) at a keep level. */
  bannerReach(level = this.keepLevel) {
    return BANNER[clamp(Math.round(level) || 1, 1, 3)];
  }

  /** The plots a keep level opens (built or not). */
  territoryPlots(level = this.keepLevel) {
    return SURVIVAL_SLOTS.filter((slot) => slot.level <= level);
  }

  /**
   * Under the keep's banner: within its reach of the keep and inside the
   * bailey's wall (a fortress; elsewhere the reach alone).
   */
  inTerritory(x, y) {
    const keep = this.keep();
    const reach = this.bannerReach();
    if ((x - keep.x) ** 2 + (y - keep.y) ** 2 > reach * reach) return false;
    const B = this.game.mansion.bailey;
    return !B || (x >= B.x && x <= B.x + B.w && y >= B.y && y <= B.y + B.h);
  }

  /**
   * Where the Hunter stands at the start of a run and every dawn: before the
   * keep's door, between the ward's barracks plot and the armory (PLOT.home).
   */
  hunterHome() {
    const keep = this.keep();
    if (this.game.mansion.isFortress) return { x: keep.x + PLOT.home[0], y: keep.y + PLOT.home[1] };
    return { x: keep.x + keep.r + 86, y: keep.y + 34 };
  }

  /** The armory rack beside the keep: the Hunter's own upgrades. */
  armorySpot() {
    if (!this._armory && this.game.mansion.isFortress) {
      const keep = this.keep();
      this._armory = { x: Math.round(keep.x + PLOT.armory[0]), y: Math.round(keep.y + PLOT.armory[1]) };
    }
    if (!this._armory) {
      const keep = this.keep();
      const m = this.game.mansion;
      let best = { x: keep.x - keep.r - 120, y: keep.y + 20 };
      for (let r = 0; r <= 120; r += 12) {
        let found = null;
        for (let k = 0; k < 12 && !found; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = keep.x - keep.r - 120 + Math.cos(a) * r, y = keep.y + 20 + Math.sin(a) * r;
          const free = !m.solidAt(x, y) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !m.solidAt(x + Math.cos(i * Math.PI / 4) * 40, y + Math.sin(i * Math.PI / 4) * 40));
          if (free && dist(x, y, keep.x, keep.y) > keep.r + CIRCLE.radius + 30) found = { x, y };
        }
        if (found) { best = found; break; }
      }
      this._armory = { x: Math.round(best.x), y: Math.round(best.y) };
    }
    return this._armory;
  }

  /**
   * BUILD 14: the arms rack (the garrison's crossbows), the armory's
   * neighbour in the south-east district. A house layout puts it beside the
   * armory, on the first free floor.
   */
  armsSpot() {
    if (this._arms) return this._arms;
    const keep = this.keep();
    if (this.game.mansion.isFortress) {
      this._arms = { x: Math.round(keep.x + PLOT.arms[0]), y: Math.round(keep.y + PLOT.arms[1]) };
      return this._arms;
    }
    const a = this.armorySpot();
    const m = this.game.mansion;
    let best = { x: a.x, y: a.y + 120 };
    for (const [dx, dy] of [[0, 120], [0, -120], [120, 0], [-120, 0], [96, 96], [-96, 96], [96, -96], [-96, -96]]) {
      const x = a.x + dx, y = a.y + dy;
      const free = !m.solidAt(x, y) && [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !m.solidAt(x + Math.cos(i * Math.PI / 4) * 36, y + Math.sin(i * Math.PI / 4) * 36));
      if (free && dist(x, y, keep.x, keep.y) > keep.r + CIRCLE.radius + 30) { best = { x, y }; break; }
    }
    this._arms = { x: Math.round(best.x), y: Math.round(best.y) };
    return this._arms;
  }

  /** Inside the front door: where the barricade circle sits. */
  gateSpot() {
    const gate = this.mainGate();
    if (!gate) return null;
    const out = outwardOf(gate);
    const base = gate.inside || gate;
    return { x: Math.round(base.x - out.x * 24), y: Math.round(base.y - out.y * 24) };
  }

  /** Circles the keep's level opens (built or not), and the ones still locked. */
  slotsInTerritory() {
    return this.territoryPlots(this.keepLevel);
  }

  lockedSlots() {
    return SURVIVAL_SLOTS.filter((slot) => slot.level > this.keepLevel);
  }

  /** The keep level that opens this circle (1-3). */
  slotUnlockLevel(slotId) {
    const slot = SLOT_BY_ID.get(slotId);
    return slot ? slot.level : 3;
  }

  /** Empty circles the Hunter can build on now. */
  buildableSlots() {
    return this.slotsInTerritory().filter((slot) => !this.buildings[slot.id]);
  }

  /**
   * Every place the Hunter can act on by day, with where it is: the build
   * circles (built or not, locked or not), the keep, the armory and the
   * barricade. The UI and the 3D world both read this list.
   */
  dayPoints() {
    const out = [];
    const keep = this.keep();
    out.push({ id: 'keep', kind: 'keep', x: keep.x, y: keep.y, reach: keep.r + CIRCLE.keepReach });
    const armory = this.armorySpot();
    out.push({ id: 'armory', kind: 'armory', x: armory.x, y: armory.y, reach: CIRCLE.reach });
    const arms = this.armsSpot();
    out.push({ id: 'arms', kind: 'arms', x: arms.x, y: arms.y, reach: CIRCLE.reach, level: this.armsLevel });
    const gate = this.gateSpot();
    if (gate) out.push({ id: 'gate', kind: 'gate', x: gate.x, y: gate.y, reach: CIRCLE.reach });
    for (const slot of SURVIVAL_SLOTS) {
      const spot = this.buildingSpot(slot.id);
      if (!spot) continue;
      out.push({
        id: slot.id, kind: 'slot', slot, type: slot.type, x: spot.x, y: spot.y, reach: CIRCLE.reach,
        built: this.buildings[slot.id] || null, level: this.buildingLevel(slot.id), locked: slot.level > this.keepLevel,
      });
    }
    return out;
  }

  /** The day point the Hunter stands at (nearest within reach), or null. */
  dayContext() {
    if (this.phase !== 'day') return null;
    const p = this.game.player;
    let best = null, bestD = Infinity;
    for (const point of this.dayPoints()) {
      const d = dist(p.x, p.y, point.x, point.y);
      if (d <= point.reach && d < bestD) { best = point; bestD = d; }
    }
    return best;
  }

  /* ---------------- building ---------------- */

  startBuild(type, slotId = null) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const g = this.game;
    if (type === 'keep') return this.startKeepUpgrade();
    if (type === 'repair') return this.startKeepRepair();
    if (type === 'gate') return this.startGateBuild();
    if (type === 'hunter') return this.startHunterUpgrade();
    if (type === 'arms') return this.startArmsUpgrade();
    if (type === 'upgrade') return this.startUpgrade(slotId);
    const spec = SURVIVAL_BUILDINGS[type];
    const slot = SLOT_BY_ID.get(slotId);
    if (!spec || !slot || slot.type !== type) return false;
    if (!this.buildableSlots().some((item) => item.id === slotId)) return false;
    if (!this.canAfford(spec)) return false;
    this.gold -= spec.gold; this.wood -= spec.wood;
    this.selectedRoom = slotId;
    this.builderJob = { kind: 'building', type, slotId, roomId: slot.room, remaining: spec.seconds, duration: spec.seconds };
    g.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  startGateBuild() {
    if (this.gateBuilt || this.builderJob || this.phase !== 'day') return false;
    const cost = this.tuning.gateCost;
    if (!this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'gate', type: 'gate', remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  keepUpgradeCost() { return this.keepLevel >= 3 ? null : this.tuning.keepUpgrade[this.keepLevel + 1] || null; }

  /** Raise the keep a level: more HP, a wider banner (new rooms), a roof ballista. */
  startKeepUpgrade() {
    if (this.keepLevel >= 3 || this.builderJob || this.phase !== 'day') return false;
    const target = this.keepLevel + 1;
    const cost = this.tuning.keepUpgrade[target];
    if (!cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'keep', type: 'keep', targetLevel: target, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  keepRepairCost() {
    const r = this.tuning.keepRepair;
    return this.keepHp >= this.keepHpMax() - 0.5 ? null : { gold: 0, wood: r.wood, seconds: r.seconds };
  }

  /** Patch the keep by day: wood for stone (the free dawn patch is not enough). */
  startKeepRepair() {
    if (this.builderJob || this.phase !== 'day') return false;
    const cost = this.keepRepairCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.wood -= cost.wood;
    this.builderJob = { kind: 'repair', type: 'repair', remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  /* ---------------- building levels + the Hunter's track ---------------- */

  buildingLevel(slotId) {
    if (!this.buildings[slotId]) return 0;
    return clamp(Math.round(Number(this.buildingLevels[slotId]) || 1), 1, BUILDING_MAX_LEVEL);
  }

  /** Stats of one building type at one level ({} for unknown types). */
  buildingStats(type, level = 1) {
    const table = SURVIVAL_BUILDING_LEVELS[type];
    return (table && table[clamp(Math.round(level) || 1, 1, BUILDING_MAX_LEVEL)]) || {};
  }

  /** Cost of the next level of the building on a circle (null at max / empty). */
  upgradeCost(slotId) {
    const type = this.buildings[slotId];
    const level = this.buildingLevel(slotId);
    if (!type || level >= BUILDING_MAX_LEVEL) return null;
    const next = this.buildingStats(type, level + 1);
    return next.wood != null ? { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 6 } : null;
  }

  startUpgrade(slotId) {
    if (this.phase !== 'day' || this.builderJob) return false;
    const type = this.buildings[slotId];
    const cost = this.upgradeCost(slotId);
    if (!type || !cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.selectedRoom = slotId;
    const targetLevel = this.buildingLevel(slotId) + 1;
    const slot = SLOT_BY_ID.get(slotId);
    this.builderJob = { kind: 'upgrade', type, slotId, roomId: slot ? slot.room : null, targetLevel, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('woodPickup', { vol: 0.45 });
    this._persist(true);
    return true;
  }

  /** Gold every mine digs into the purse over one night. */
  goldPerNight() {
    let total = 0;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type === 'mine') total += this.buildingStats(type, this.buildingLevel(slotId)).yield || 0;
    }
    return total;
  }

  goldRate() { return this.goldPerNight() / Math.max(1, this.nightDuration); }

  /** Sawmill planks: +% max HP on every outer door (summed, capped). */
  doorHpBonus() {
    let bonus = 0;
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type === 'sawmill') bonus += this.buildingStats(type, this.buildingLevel(slotId)).doorBonus || 0;
    }
    return Math.min(DOOR_BONUS_CAP, Math.round(bonus * 100) / 100);
  }

  hunterStats(level = this.hunterLevel) {
    return SURVIVAL_HUNTER[clamp(Math.round(level) || 1, 1, HUNTER_MAX_LEVEL)];
  }

  hunterDamage() { return this.hunterStats().damage; }

  hunterUpgradeCost() {
    if (this.hunterLevel >= HUNTER_MAX_LEVEL) return null;
    const next = this.hunterStats(this.hunterLevel + 1);
    return { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
  }

  startHunterUpgrade() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const cost = this.hunterUpgradeCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'hunter', type: 'hunter', targetLevel: this.hunterLevel + 1, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  /** The garrison's crossbows at a level (BUILD 14; Lv1 = GUARD's base). */
  armsStats(level = this.armsLevel) {
    return SURVIVAL_ARMS[clamp(Math.round(level) || 1, 1, ARMS_MAX_LEVEL)];
  }

  armsUpgradeCost() {
    if (this.armsLevel >= ARMS_MAX_LEVEL) return null;
    const next = this.armsStats(this.armsLevel + 1);
    return { gold: next.gold || 0, wood: next.wood || 0, seconds: next.seconds || 5 };
  }

  startArmsUpgrade() {
    if (this.phase !== 'day' || this.builderJob) return false;
    const cost = this.armsUpgradeCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.gold -= cost.gold; this.wood -= cost.wood;
    this.builderJob = { kind: 'arms', type: 'arms', targetLevel: this.armsLevel + 1, remaining: cost.seconds, duration: cost.seconds };
    this.game.audio.play('uiConfirm', { vol: 0.55 });
    this._persist(true);
    return true;
  }

  /** Survival owns the Hunter's health bar (legacy meta upgrades stay legacy). */
  applyHunterStats(heal = false) {
    const p = this.game.player;
    if (!p) return;
    const hp = this.hunterStats().hp;
    p.bloodMax = hp;
    p.blood = heal ? hp : clamp(Number(p.blood) || hp, 1, hp);
  }

  /** Where the builder works (and the celebration pops). */
  jobSpot(job = this.builderJob) {
    if (!job) return null;
    if (job.kind === 'keep' || job.kind === 'repair') { const keep = this.keep(); return { x: keep.x, y: keep.y + keep.r }; }
    if (job.kind === 'gate') return this.gateSpot();
    if (job.kind === 'hunter') return this.armorySpot();
    if (job.kind === 'arms') return this.armsSpot();
    return job.slotId ? this.buildingSpot(job.slotId) : null;
  }

  finishBuilderJob() {
    const job = this.builderJob;
    if (!job) return;
    let text = 'BUILT!';
    let icon = SURVIVAL_BUILDINGS[job.type] ? job.type : 'hammer';
    const at = this.jobSpot(job);
    if (job.kind === 'keep') {
      this.keepLevel = clamp(job.targetLevel, 1, 3);
      // the new storey comes with its stone: the new HP share is added
      const before = this.tuning.keepHp[this.keepLevel - 1] || this.keepHpMax();
      this.keepHp = Math.min(this.keepHpMax(), this.keepHp + (this.keepHpMax() - before));
      icon = 'keep'; text = `KEEP Lv${this.keepLevel}`;
    } else if (job.kind === 'repair') {
      const heal = Math.min(this.tuning.keepRepair.hp, this.keepHpMax() - this.keepHp);
      this.keepHp = Math.min(this.keepHpMax(), this.keepHp + heal);
      icon = 'keep'; text = `+${Math.round(heal)}`;
    } else if (job.kind === 'gate') {
      this.gateBuilt = true;
      this.applyBuildingEffects(true);
      icon = 'gate';
    } else if (job.kind === 'hunter') {
      this.hunterLevel = clamp(job.targetLevel, 1, HUNTER_MAX_LEVEL);
      this.applyHunterStats(true);
      icon = 'hunter'; text = `CAPTAIN Lv${this.hunterLevel}`;
    } else if (job.kind === 'arms') {
      this.armsLevel = clamp(job.targetLevel, 1, ARMS_MAX_LEVEL);
      // every guard gets the new bow at once: a pop over each, where he
      // stands (world3d swaps the bow in his hand the same frame)
      for (const guard of this.guards || []) {
        this.pushFloater(guard.x, guard.y, `Lv${this.armsLevel}`, this.armsLevel >= 3 ? '#ffd24a' : '#9fd0ff', { h: 120, size: 18, icon: 'crossbow', life: 1.5, pop: 1.3, kind: 'income' });
      }
      icon = 'crossbow'; text = `GUARD BOWS Lv${this.armsLevel}`;
    } else if (job.kind === 'building' || job.kind === 'upgrade') {
      const before = job.kind === 'upgrade' ? this.buildingLevel(job.slotId) : 0;
      const level = job.kind === 'upgrade' ? clamp(job.targetLevel, 1, BUILDING_MAX_LEVEL) : 1;
      this.buildings[job.slotId] = job.type;
      this.buildingLevels[job.slotId] = level;
      if (job.type === 'barracks') {
        // a barracks houses its soldiers at once: tonight's door guards. They
        // step out of its door and march to their post by the keep, so the
        // building is seen to work (a "+1" soldier pops over it).
        const moved = (this.buildingStats('barracks', level).houses || 0) - (before ? this.buildingStats('barracks', before).houses || 0 : 0);
        const was = this.survivors;
        this.survivors = Math.min(this.tuning.maxSurvivors, this.survivors + Math.max(0, moved));
        const spot = this.buildingSpot(job.slotId);
        this._syncGuardRoster(false, spot);
        const added = this.survivors - was;
        if (added > 0 && spot) {
          this.runStats.recruited = (this.runStats.recruited || 0) + added;
          this.pushFx('rally', spot.x, spot.y, { n: added });
          this.pushFloater(spot.x, spot.y, `+${added}`, '#7fd0ff', { h: 150, size: 24, icon: 'guard', life: 1.6, pop: 1.4, kind: 'income' });
        }
      }
      if (job.type === 'sawmill') this.applyBuildingEffects(false);
      if (job.kind === 'upgrade') text = `Lv${level}!`;
    }
    this.builderJob = null;
    this.lastBuilt = { kind: job.kind, type: job.type, slotId: job.slotId || null, x: at ? at.x : 0, y: at ? at.y : 0, t: this.uiClock };
    if (job.kind === 'gate') this.game.mansion.buildNav();
    this._syncTowers();
    this.game.survivalBakeDirty = true;
    this.game.audio.play('uiConfirm', { vol: 0.62 });
    if (at) {
      this.game.particles.burst('spark', at.x, at.y, 18, {
        color: 'rgba(255,226,140,0.95)', sizeMin: 2, sizeMax: 5, speedMin: 40, speedMax: 170, lifeMin: 0.3, lifeMax: 0.8, glow: true,
      });
    }
    this.pushEvent('build', icon, text, { life: 1.6 });
    this._persist(true);
  }

  /**
   * Door max HP from what stands in the house: sawmill planks on every outer
   * door, the barricade on the front door. By day the doors are whole,
   * so a new bonus is filled at once; a mid-night reload never mends a door.
   */
  applyBuildingEffects(repairGate = false) {
    const gate = this.mainGate();
    const bonus = this.doorHpBonus();
    const night = this.phase === 'night';
    for (const e of this.game.mansion.entrances) {
      if (!e.exterior || e.kind !== 'door') continue;
      const base = e.baseHpMax || e.hpMax || 100;
      const extra = e === gate && this.gateBuilt ? this.tuning.gateHpBonus : 0;
      e.hpMax = Math.round(base * (1 + bonus)) + extra;
      if (!Number.isFinite(e.hp)) e.hp = e.hpMax;
      if (e === gate && repairGate) { e.hp = e.hpMax; e.broken = false; e.open = false; }
      else if (!night && !e.broken) e.hp = e.hpMax;
      else e.hp = Math.min(e.hp, e.hpMax);
    }
    if (gate) this.gateHp = Math.max(0, gate.hp);
  }

  completeNight() {
    if (this.phase !== 'night') return;
    const g = this.game;
    g._survivalHint = null;   // a night's hint chip never runs on into the day
    this.recenterCamera(true);
    const dayIndex = clamp(this.day - 1, 0, 2);
    let gold = this.tuning.nightRewards.gold[dayIndex];
    let wood = this.tuning.nightRewards.wood[dayIndex];
    // guards lost during the night are already gone from the roster; anyone
    // still down gets up at dawn (the snap below heals the garrison)
    const lost = this.nightStats.lost || 0;
    const survivorsBefore = this.survivors;
    // Dawn pays the sawmills; the mines already dug their gold in during
    // the night, and barracks house their soldiers as soon as they stand.
    let sawn = 0;
    const sawmills = [];
    for (const [slotId, type] of Object.entries(this.buildings)) {
      if (type !== 'sawmill') continue;
      const planks = this.buildingStats(type, this.buildingLevel(slotId)).dawnWood || 0;
      sawn += planks;
      sawmills.push({ slotId, wood: planks });
    }
    wood += sawn;
    this.runStats.sawn = (this.runStats.sawn || 0) + sawn;
    this.runStats.nights = Math.min(3, (this.runStats.nights || 0) + 1);
    this._sawmillPayout = sawmills;
    // BUILD 16 (R5): a cleared night's early dawn. The mines are paid the
    // shift they did not get to dig, and every whole second saved pays its
    // NIGHT_CLEAR gold (shown on its own row of the dawn card).
    const cleared = this.cleared;
    const endAt = this.elapsed;
    let clearBonus = 0;
    if (cleared) {
      const early = Math.max(0, this.nightDuration - this.elapsed);
      const rest = this.goldRate() * early;
      if (rest > 0) {
        this.gold = Math.min(RESOURCE_CAP, this.gold + rest);
        this.nightStats.mined = (this.nightStats.mined || 0) + rest;
        this.runStats.mined = (this.runStats.mined || 0) + rest;
      }
      clearBonus = cleared.bonus || 0;
      this.gold = Math.min(RESOURCE_CAP, this.gold + clearBonus);
      this.runStats.cleared = (this.runStats.cleared || 0) + 1;
      this.runStats.saved = (this.runStats.saved || 0) + (cleared.saved || 0);
    }
    this.cleared = null;
    this.stragglers = null;
    const mined = Math.round(this.nightStats.mined || 0);
    // kills pay a little (guards shoot too, so this stays a trickle)
    const killGold = Math.floor(this.nightStats.kills / 6);
    const killWood = Math.floor(this.nightStats.kills / 4);
    gold += killGold; wood += killWood;
    this.gold = clamp(this.gold + gold, 0, RESOURCE_CAP);
    this.wood = clamp(this.wood + wood, 0, RESOURCE_CAP);
    this.nightsCompleted = Math.min(3, this.nightsCompleted + 1);
    // the keep as dawn found it (the end panel's "keep left", before the patch)
    this._keepAtDawn = this.keepHp / Math.max(1, this.keepHpMax());
    // the townsfolk patch part of the keep for free; the rest is wood by day
    const missing = Math.max(0, this.keepHpMax() - this.keepHp);
    const patched = Math.round(missing * this.tuning.keepDawnHeal);
    this.keepHp = Math.min(this.keepHpMax(), this.keepHp + patched);
    this.repairDoors();
    this.lastRewards = {
      gold, wood, kills: this.nightStats.kills, walls: this.nightStats.damageToWalls,
      survivors: this.survivors - survivorsBefore, keepDamage: Math.round(this.nightStats.keepDamage || 0),
      keepPatched: patched, mined, lost, rescued: this.nightStats.rescued || 0,
      reinforcements: Math.max(0, 3 - this.nightsCompleted),
      sawn, killsBy: { ...freshKillsBy(), ...(this.nightStats.by || {}) },
      towerKills: (this.nightStats.by && this.nightStats.by.tower) || 0,
      // BUILD 16: when the night ended on its clock, and a clear's saving
      endAt: +endAt.toFixed(2),
      cleared: cleared ? { at: cleared.at, saved: cleared.saved || 0, bonus: clearBonus, fled: cleared.fled || 0 } : null,
    };
    this._resetNightFx();
    g.enemies.length = 0;
    g.bolts.length = 0;
    g.particles.list.length = 0;
    g.player.state = 'idle';
    g.player.attackT = 0;
    g.player.attackCd = 0;
    g.player.slashAge = null;   // the night's last shot does not flash on into the dawn
    this.applyHunterStats(true);
    this.elapsed = 0;
    this.walkPath = null;
    // dawn: the captain is back at the keep (the day starts on the base)
    const home = this.hunterHome();
    g.player.x = home.x; g.player.y = home.y; g.player.vx = 0; g.player.vy = 0;
    g.renderer.snapCamera(home.x, home.y);
    if (this.nightsCompleted >= 3) {
      this.day = 3;
      this.phase = 'complete';
      // K1's promise kept: the main gate swings open and the relief column
      // marches in to the keep (a cinematic when the run asked for them;
      // otherwise the column already stands in its two lines)
      const gate = this.mainGate();
      if (gate && !gate.broken) gate.open = true;
      this.reinforcements = this._reliefColumn(!this.cinematics);
      if (this.cinematics) this._startArrival();
      this._finishRun(true);
      g.uiPanel = this.panelFor();
    } else {
      this.day = Math.min(3, this.day + 1);
      this.phase = 'day';
      g.uiPanel = 'survival-day';
    }
    g.screen = 'playing';
    g.phase = DAY_PHASE;
    g.time = 0; g.timeLeft = 0;
    g.input.gameplay = this.phase === 'day';
    this.applyBuildingEffects(false);
    this._syncBakePhase();
    this._syncGuardRoster(true);
    this._syncTowers();
    this._persist(true);
  }

  fail(reason) {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.failureReason = reason || 'The Hunter fell.';
    this._finishRun(false);
    this.game.screen = 'playing';
    this.game.uiPanel = 'survival-failed';
    this.game.input.gameplay = false;
    this._persist(true);
  }

  restart() {
    const g = this.game;
    const duration = this.nightDuration;
    Object.assign(this, {
      phase: 'night', day: 1, elapsed: 0, gold: this.tuning.startGold, wood: this.tuning.startWood,
      survivors: this.tuning.startSurvivors, keepLevel: 1, keepHp: this.tuning.keepHp[1],
      buildings: {}, buildingLevels: {}, hunterLevel: 1, armsLevel: 1, gateBuilt: false,
      gateHp: 0, builderJob: null, selectedRoom: null, nightsCompleted: 0, waveIndex: 0,
      breakerIndex: 0, individualIndex: 0, siegeTimers: Object.create(null),
      nightStats: freshNightStats(), runStats: freshRunStats(), lastRewards: null, skillCooldown: 0, cleared: null, stragglers: null,
      rewardAck: 0, dayFocus: null, nightKeepStart: this.tuning.keepHp[1], walkPath: null, lastBuilt: null,
      cine: null, reinforcements: null, runResult: null,
    });
    // BUILD 17 (R8): a new run comes at the gates from a new side
    this.runSeed = this.newRunSeed();
    this._resetNightFx();
    this._fields.clear();
    for (const e of g.mansion.entrances) {
      e.hp = e.baseHpMax; e.hpMax = e.baseHpMax; e.broken = false; e.open = false; e.barricade = 0;
      e.flash = 0; e.attackers = 0;
    }
    g.enemies.length = 0; g.bolts.length = 0;
    const home = this.hunterHome();
    g.player.x = home.x; g.player.y = home.y;
    this.applyHunterStats(true);
    g.player.weapon = 'shot'; g.player.state = 'idle';
    this.nightDuration = duration;
    this.phase = 'night';
    g.mansion.buildNav();
    this.game.survivalBakeDirty = true;
    this.guards.length = 0;
    this._syncGuardRoster(true);
    this._syncTowers();
    this.enter();
    this._nightIntro();
  }

  useBuilding(slotId) { return this.buildings[slotId] || null; }

  /**
   * Close the run once, at the third dawn or the fall (R1-R4, R19): stars,
   * the MVP, how close dawn was and the tip, and the records across runs.
   * "NEW BEST" needs a run to beat, so the very first result is just that.
   */
  _finishRun(won) {
    const rs = this.runStats;
    const nights = won ? 3 : clamp(this.nightsCompleted, 0, 3);
    const stars = survivalStars(won, rs);
    const prev = { ...freshRecords(), ...(this.records || {}) };
    const kills = rs.kills || 0;
    this.records = {
      runs: prev.runs + 1,
      wins: prev.wins + (won ? 1 : 0),
      bestStars: Math.max(prev.bestStars, stars),
      bestNights: Math.max(prev.bestNights, nights),
      bestKills: Math.max(prev.bestKills, kills),
      totalKills: prev.totalKills + kills,
      totalStars: (prev.totalStars || 0) + stars,
    };
    // R9: a crossed tier is announced on exactly the run that crossed it
    this._newBanner = unlockTierFor(this.records.totalStars).stars > unlockTierFor(prev.totalStars).stars
      ? unlockTierFor(this.records.totalStars) : null;
    this.runResult = {
      won, stars, nights, kills,
      newBest: prev.runs > 0 && (stars > prev.bestStars || nights > prev.bestNights),
      night: this.day,
      toDawn: won ? 0 : Math.max(0, Math.ceil(this.nightDuration - this.elapsed)),
      progress: won ? 1 : clamp(this.elapsed / Math.max(1, this.nightDuration), 0, 1),
      keepLeft: won ? Math.round(100 * (this._keepAtDawn == null ? this.keepHp / Math.max(1, this.keepHpMax()) : this._keepAtDawn)) : 0,
      keepMin: Math.round(100 * (rs.keepMin == null ? 1 : rs.keepMin)),
      built: Object.keys(this.buildings).length,
      time: Math.round(rs.time || 0),
      mvp: survivalMvp(rs),
      tip: won ? null : this._lossTip(),
    };
    return this.runResult;
  }

  /** The end panel's numbers: the closed run, or (old saves) a fresh reading. */
  endSummary() {
    if (this.runResult) return this.runResult;
    if (this.phase !== 'complete' && this.phase !== 'failed') return null;
    const records = this.records;
    const result = this._finishRun(this.phase === 'complete');
    this.records = records;          // reading an old save is not a new run
    result.newBest = false;
    return result;
  }

  /** The ballista circle that covers a gate (its spot's door), if any. */
  _towerSlotFor(gateId) {
    for (const slot of SURVIVAL_SLOTS) {
      if (slot.type !== 'tower') continue;
      const spot = this.buildingSpot(slot.id);
      if (spot && spot.doorId === gateId) return slot;
    }
    return null;
  }

  /**
   * R4: one tip read off what really happened (8 words at most). The first
   * night has no day before it, so its tips are about defending; after that
   * the first missing piece in the build is named (nothing built, the gate
   * that gave way first without a ballista, a keep a level behind, lost
   * guards, no barracks).
   */
  _lossTip() {
    const ns = this.nightStats || {};
    if (!/KEEP/i.test(String(this.failureReason || ''))) return { icon: 'heart', text: 'FALL BACK TO THE KEEP WHEN HURT' };
    if (this.day <= 1) {
      if ((this._movedSinceStart || 0) < 400) return { icon: 'gate', text: 'WALK TO THE GATE UNDER ATTACK' };
      if (!(ns.flares > 0)) return { icon: 'flare', text: 'TAP FLARE ON BIG GROUPS' };
      return { icon: 'guard', text: 'FIGHT BESIDE YOUR GUARDS AT THE GATE' };
    }
    const built = Object.values(this.buildings);
    if (!built.length && this.keepLevel <= 1) return { icon: 'hammer', text: 'BUILD BY DAY: WALK INTO A CIRCLE' };
    for (const gateId of Array.isArray(ns.breached) ? ns.breached : []) {
      const slot = this._towerSlotFor(gateId);
      if (!slot || this.buildings[slot.id]) continue;
      const name = GATE_NAMES[gateId] || 'BROKEN';
      if (this.slotUnlockLevel(slot.id) > this.keepLevel) return { icon: 'keep', text: `RAISE THE KEEP TO GUARD THE ${name} GATE` };
      return { icon: 'tower', text: `BUILD A BALLISTA AT THE ${name} GATE` };
    }
    if (this.keepLevel < Math.min(3, this.day)) return { icon: 'keep', text: 'UPGRADE THE KEEP BY DAY' };
    if ((ns.lost || 0) > 0) return { icon: 'guard', text: 'HELP FALLEN GUARDS UP' };
    if (!built.includes('barracks')) return { icon: 'barracks', text: 'BUILD BARRACKS FOR MORE GUARDS' };
    return { icon: 'up', text: 'UPGRADE YOUR BALLISTAS BY DAY' };
  }

  buildingCost(type) {
    if (type === 'keep') return this.keepUpgradeCost();
    if (type === 'repair') return this.keepRepairCost();
    if (type === 'gate') return this.tuning.gateCost;
    if (type === 'hunter') return this.hunterUpgradeCost();
    if (type === 'arms') return this.armsUpgradeCost();
    return SURVIVAL_BUILDINGS[type] || null;
  }

  buildingName(type) {
    if (type === 'keep') return `KEEP LV${this.keepLevel}`;
    if (type === 'gate') return 'BARRICADE';
    if (type === 'hunter') return `CAPTAIN LV${this.hunterLevel}`;
    if (type === 'arms') return `GUARD BOWS LV${this.armsLevel}`;
    return SURVIVAL_BUILDINGS[type] ? SURVIVAL_BUILDINGS[type].label : 'EMPTY';
  }

  onEnemyKilled(enemy) {
    if (enemy._survivalRewarded) return;
    enemy._survivalRewarded = true;
    this.nightStats.kills++;
    this.game.stats.kills = (this.game.stats.kills || 0) + 1;
    const g = this.game;
    // who got it: per night (the dawn panel) and per run (the end panel)
    const src = killSource(g, enemy._lastHitBy);
    if (!this.nightStats.by) this.nightStats.by = freshKillsBy();
    this.nightStats.by[src] = (this.nightStats.by[src] || 0) + 1;
    this.runStats.kills++;
    this.runStats.by[src] = (this.runStats.by[src] || 0) + 1;
    if (src === 'tower' && enemy._lastHitBy) {
      const tower = enemy._lastHitBy;
      tower.kills = (tower.kills || 0) + 1;
      tower.nightKills = (tower.nightKills || 0) + 1;
      const slotId = tower.slotId;
      if (slotId) {
        if (!this.runStats.towers) this.runStats.towers = {};
        this.runStats.towers[slotId] = (this.runStats.towers[slotId] || 0) + 1;
      }
      // the building that got it says so, over its own deck: a ballista
      // reads as working (2026-10-17: "bangunan ... tidak berfungsi")
      if (Number.isFinite(tower.x)) this.pushFloater(tower.x, tower.y, '+1', '#ffb36b', { h: 236, size: 22, icon: 'skull', life: 1.2, pop: 1.35, kind: 'income' });
    } else if (src === 'keep') {
      const keep = this.keep();
      this.keepBallistaKills = (this.keepBallistaKills || 0) + 1;
      this.pushFloater(keep.x, keep.y, '+1', '#ffb36b', { h: 330, size: 22, icon: 'skull', life: 1.2, pop: 1.35, kind: 'income' });
    }
    const big = enemy._survivalType === 'breaker' || enemy._survivalType === 'individual';
    g.audio.play('hitFlesh', { vol: big ? 0.6 : 0.42, weight: big ? 1 : 0.8 });
    // the kill pops: a burst and a shock ring on the floor (world3d), then
    // dust, grit and a wisp of the thing rising off the body
    this.pushFx('kill', enemy.x, enemy.y, { h: (big ? 70 : 46) * SURVIVAL_ACTOR_SCALE, color: HIT_COLOR[src] || '#ffffff', big });
    g.particles.burst('spark', enemy.x, enemy.y, big ? 22 : 11, {
      color: big ? 'rgba(255,214,120,0.95)' : 'rgba(226,236,200,0.92)', sizeMin: 2.4, sizeMax: big ? 7 : 5,
      speedMin: 60, speedMax: big ? 300 : 210, lifeMin: 0.22, lifeMax: 0.6, glow: true,
    });
    g.particles.burst('glow', enemy.x, enemy.y, big ? 6 : 3, {
      color: 'rgba(150,90,210,0.7)', sizeMin: 5, sizeMax: big ? 12 : 8, speedMin: 10, speedMax: 50, lifeMin: 0.45, lifeMax: 0.9,
    });
    // ichor chunks thrown off the body, and a stain left on the ground: a
    // gate you held reads as a battlefield the next time you look at it
    g.particles.burst('blood', enemy.x, enemy.y, big ? 16 : 9, {
      color: 'rgba(92,40,128,0.95)', sizeMin: 2.4, sizeMax: big ? 6.5 : 4.8, speedMin: 70, speedMax: big ? 280 : 210, lifeMin: 0.25, lifeMax: 0.6,
    });
    if (g.decals && g.decals.splat) g.decals.splat(enemy.x, enemy.y + 4, big ? 26 : 17, 'rgba(46,18,64,0.42)', big ? 7 : 5);
    // a streak of kills shakes a little; a big one holds the frame
    this._streak = (this.uiClock - (this._lastKillAt || -9) < 0.6) ? (this._streak || 0) + 1 : 1;
    this._lastKillAt = this.uiClock;
    if (big) { this.hitStop = Math.max(this.hitStop, 0.05); g.renderer.shake(0.16); }
    else if (src === 'captain') {
      // the captain's own kill lands with weight: a nudge of the camera
      // (the hit-stop stays for the big ones — on every swarm kill it made
      // a busy gate stutter and stretched the night)
      g.renderer.shake(this._streak >= 3 ? 0.08 : 0.05);
    } else if (this._streak >= 3) g.renderer.shake(0.05);
  }

  onPlayerHurt(amount) {
    this.nightStats.hits++;
    this.game.audio.play('playerHurt', { vol: 0.72 });
    this.game.renderer.shake(clamp(0.18 + amount * 0.009, 0.18, 0.55));
    this.game.particles.burst('blood', this.game.player.x, this.game.player.y, 7, {
      color: '#a52635', speedMin: 20, speedMax: 92, lifeMin: 0.2, lifeMax: 0.55, sizeMin: 1.5, sizeMax: 3,
    });
  }

  /**
   * The camera follows the Hunter day and night. By day it pulls back a
   * little and leans toward the circle he stands in, so its ghost and the
   * contextual button never cover each other.
   */
  followPlayer(dt) {
    const g = this.game;
    const p = g.player;
    const r = g.renderer;
    const night = this.phase !== 'day';
    this._steerCamera(dt);
    // the player's own zoom lands at once (the ground under the fingers has
    // to stay there); the day / night framing eases in
    if (r.setZoomMul) r.setZoomMul(this.frameMul(night) * this.userZoom(), this._zoomSnap ? undefined : dt);
    this._zoomSnap = false;
    let lookX = clamp(p.vx * 0.18, -56, 56);
    // BUILD 15 (V7): at night the frame leans onto the fight (THREAT_FRAME)
    const lean = this._threatLean(dt, night);
    // a phone held sideways is short and its top band is HUD: frame a little
    // north of the Hunter so what stands above him is not under the HUD (the
    // fight frame takes over from it while there is a fight to frame)
    const north = (r.h || 720) < 560 ? (night ? 90 : 70) : 0;
    let lookY = clamp(p.vy * 0.18, -56, 56) - north * (1 - lean.w);
    lookX += lean.x;
    lookY += lean.y;
    if (!night) {
      const here = this.dayContext();
      if (here) { lookX += clamp((here.x - p.x) * 0.5, -80, 80); lookY += clamp((here.y - p.y) * 0.5, -80, 80); }
    }
    // the player's own drag rides on top of the follow
    const pan = this.camPan;
    if (pan.x || pan.y) {
      lookX = lookX * this._panLook() + pan.x;
      lookY = lookY * this._panLook() + pan.y;
    }
    r.followCamera(p.x, p.y, dt, lookX, lookY, g.mansion.camBounds);
  }

  /**
   * BUILD 15 (V7): where the fight round the captain is — the weighted middle
   * of the horde within THREAT_FRAME.reach of him. The near ones weigh most
   * (the far edge still counts 0.4), a Breaker twice, one clawing the keep
   * half again. Shut gates do not matter: a crowd at the gate he holds from
   * inside is the fight. null when nothing is in reach.
   */
  threatFocus() {
    const g = this.game;
    const p = g.player;
    const reach = THREAT_FRAME.reach;
    let sx = 0, sy = 0, sw = 0, n = 0;
    for (const e of g.enemies || []) {
      if (!e || e.dead || e.removeMe || !(e.hp > 0)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > reach) continue;
      let w = 1 - 0.6 * (d / reach);
      if (e._survivalType === 'breaker') w *= 2;
      if (e.attackingKeep) w *= 1.5;
      sx += e.x * w; sy += e.y * w; sw += w; n++;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw, n, weight: sw } : null;
  }

  /**
   * The night frame's lean onto the fight (BUILD 15, V7): THREAT_FRAME.share
   * of the way from the captain to threatFocus(), at most THREAT_FRAME.max,
   * all of it once the knot weighs THREAT_FRAME.full, eased at
   * THREAT_FRAME.ease both ways. { x, y } world px; w 0..1, how much of a
   * fight frame is on (it hands the frame back as it fades).
   */
  _threatLean(dt, night) {
    const lean = this._lean || (this._lean = { x: 0, y: 0, w: 0 });
    const focus = night ? this.threatFocus() : null;
    let gx = 0, gy = 0, gw = 0;
    if (focus) {
      const p = this.game.player;
      const strength = clamp(focus.weight / THREAT_FRAME.full, 0, 1);
      gx = (focus.x - p.x) * THREAT_FRAME.share;
      gy = (focus.y - p.y) * THREAT_FRAME.share;
      const len = Math.hypot(gx, gy);
      if (len > THREAT_FRAME.max) { gx *= THREAT_FRAME.max / len; gy *= THREAT_FRAME.max / len; }
      gx *= strength; gy *= strength;
      gw = strength;
    }
    const k = dt > 0 ? 1 - Math.exp(-THREAT_FRAME.ease * dt) : 0;
    lean.x += (gx - lean.x) * k;
    lean.y += (gy - lean.y) * k;
    lean.w += (gw - lean.w) * k;
    lean.focus = focus;
    return lean;
  }

  /** The night frame's lean in use (QA / harness). */
  threatLean() {
    const lean = this._lean || { x: 0, y: 0, w: 0 };
    return { x: +lean.x.toFixed(1), y: +lean.y.toFixed(1), w: +lean.w.toFixed(3), focus: lean.focus ? { x: Math.round(lean.focus.x), y: Math.round(lean.focus.y), n: lean.focus.n } : null };
  }

  /** The look-ahead fades while the view is dragged away (it would fight the drag). */
  _panLook() {
    const d = Math.hypot(this.camPan.x, this.camPan.y);
    return clamp(1 - d / 160, 0, 1);
  }

  /** The player's zoom on top of the framing (SURVIVAL_CAMERA.zoom), persisted. */
  userZoom() {
    if (this._userZoom == null) {
      const s = this.game.save && this.game.save.survival;
      const z = s && Number(s.camZoom);
      this._userZoom = Number.isFinite(z) && z > 0 ? clamp(z, SURVIVAL_CAMERA.zoom[0], SURVIVAL_CAMERA.zoom[1]) : 1;
    }
    return this._userZoom;
  }

  /** Where the zoom is heading (a + / - step in flight), else where it is. */
  zoomGoal() { return this._zoomGoal != null ? this._zoomGoal : this.userZoom(); }

  /** 0 (all the way out, the whole bailey) .. 1 (all the way in). */
  zoomShare() {
    const [lo, hi] = SURVIVAL_CAMERA.zoom;
    return clamp(Math.log(this.zoomGoal() / lo) / Math.log(hi / lo), 0, 1);
  }

  /** `dir` + / - steps (the buttons: one; the keys: one a press), eased in by _steerCamera. */
  zoomStep(dir) {
    const [lo, hi] = SURVIVAL_CAMERA.zoom;
    const from = this.zoomGoal();
    const to = clamp(from * Math.pow(SURVIVAL_CAMERA.step, clamp(Math.round(dir) || 0, -3, 3)), lo, hi);
    if (Math.abs(to - from) < 1e-4) return false;
    this._zoomGoal = to;
    this._panUsed = true;
    this._zoomUsed = true;
    return true;
  }

  _saveZoom() {
    const s = this.game.save && this.game.save.survival;
    if (s) s.camZoom = +this.zoomGoal().toFixed(3);
  }

  /**
   * Zoom by `k` now (a pinch, the wheel). `anchor` (screen px): the ground
   * under it stays under it, as under the fingers in a map app; without one
   * the zoom is about the middle of the screen.
   */
  _zoomBy(k, anchor = null) {
    const g = this.game;
    const r = g.renderer;
    const [lo, hi] = SURVIVAL_CAMERA.zoom;
    const before = this.userZoom();
    const after = clamp(before * k, lo, hi);
    this._zoomGoal = null;
    if (Math.abs(after - before) < 1e-5) return;
    if (anchor && r && r.cam && typeof r.screenToWorld === 'function' && r.cam.zoom > 0) {
      const at = r.screenToWorld(anchor.x, anchor.y);
      const f = 1 - before / after;
      const dx = (at.x - r.cam.x) * f, dy = (at.y - r.cam.y) * f;
      this.camPan.x += dx; this.camPan.y += dy;
      r.cam.x += dx; r.cam.y += dy;
      this._recenter = false;
    }
    this._userZoom = after;
    this._zoomSnap = true;
    this._panUsed = true;
    this._zoomUsed = true;
    this._saveZoom();
  }

  /** Drop the drag: the view goes back onto the captain (snap: at once). */
  recenterCamera(snap = false) {
    if (this._panVel) { this._panVel.x = 0; this._panVel.y = 0; }
    if (snap) { this.camPan.x = 0; this.camPan.y = 0; this._recenter = false; return; }
    this._recenter = Math.hypot(this.camPan.x, this.camPan.y) > 1;
  }

  /** How far the view has been dragged off the captain (world px). */
  cameraOffset() { return Math.hypot(this.camPan.x, this.camPan.y); }

  /**
   * The player's hand on the camera (SURVIVAL_CAMERA). A drag on the free
   * half moves the ground with the finger, 1:1 (the camera jumps with it, so
   * it never lags), and a flick glides on; a pinch or the wheel zooms about
   * the fingers / the cursor; the + / - buttons and keys zoom a step. Walking
   * eases the view back onto the captain, so the drag never costs him the
   * fight; a tap on free ground (or the CAPTAIN chip) brings it back at once.
   */
  _steerCamera(dt) {
    const g = this.game;
    const input = g.input;
    const r = g.renderer;
    const pan = this.camPan;
    if (!input || !r || !r.cam) return;
    if (!this._panVel) this._panVel = { x: 0, y: 0 };
    const vel = this._panVel;
    const walking = !!(input.moving || this.walkPath);
    const d = input.panDelta;
    let moved = false;
    if (d && (d.x || d.y) && r.cam.zoom > 0) {
      const u = d.x / (r.cam.zoom * ISO_CAMERA.horizontal);
      const q = d.y / (r.cam.zoom * ISO_CAMERA.vertical);
      // the ground follows the finger: the view moves the other way
      const wx = -(u + q) * 0.5, wy = -(q - u) * 0.5;
      pan.x += wx; pan.y += wy;
      r.cam.x += wx; r.cam.y += wy;
      this._recenter = false;
      this._panUsed = true;
      moved = true;
      if (dt > 1e-4) {
        // the flick: a running average of the drag's speed
        vel.x = lerp(vel.x, wx / dt, 0.4);
        vel.y = lerp(vel.y, wy / dt, 0.4);
      }
    }
    if (!moved) {
      if (input.panning) {
        // a finger held still on the glass: no glide when it lifts
        const k = Math.exp(-14 * dt);
        vel.x *= k; vel.y *= k;
      } else if (!walking && !this._recenter && Math.hypot(vel.x, vel.y) > SURVIVAL_CAMERA.flick) {
        pan.x += vel.x * dt; pan.y += vel.y * dt;
        r.cam.x += vel.x * dt; r.cam.y += vel.y * dt;
        const k = Math.exp(-SURVIVAL_CAMERA.glide * dt);
        vel.x *= k; vel.y *= k;
      } else { vel.x = 0; vel.y = 0; }
    }
    // pinch / wheel: about the fingers or the cursor, at once
    const z = input.zoomDelta;
    if (z && Math.abs(z - 1) > 1e-4) this._zoomBy(z, input.zoomAt);
    // + / - keys; the buttons call zoomStep themselves
    if (input.zoomStep) this.zoomStep(input.zoomStep);
    if (this._zoomGoal != null) {
      const now = this.userZoom();
      const next = lerp(now, this._zoomGoal, 1 - Math.exp(-SURVIVAL_CAMERA.ease * dt));
      this._userZoom = Math.abs(next - this._zoomGoal) < 1e-3 ? this._zoomGoal : next;
      this._zoomSnap = true;
      if (this._userZoom === this._zoomGoal) { this._zoomGoal = null; this._saveZoom(); }
    }
    if (typeof input.takePanTap === 'function' && input.takePanTap() && this.cameraOffset() > 40) this._recenter = true;
    // the view centre stays over the bailey (+ reach)
    const p = g.player;
    const B = g.mansion.bailey || g.mansion.bounds;
    if (B && p) {
      const reach = SURVIVAL_CAMERA.reach;
      const cx = clamp(p.x + pan.x, B.x - reach, B.x + B.w + reach) - p.x;
      const cy = clamp(p.y + pan.y, B.y - reach, B.y + B.h + reach) - p.y;
      if (cx !== pan.x) vel.x = 0;
      if (cy !== pan.y) vel.y = 0;
      pan.x = cx; pan.y = cy;
    }
    if (this._recenter || walking) {
      const k = Math.exp(-(this._recenter ? 7 : SURVIVAL_CAMERA.recenter) * dt);
      pan.x *= k; pan.y *= k;
      if (Math.hypot(pan.x, pan.y) < 1) { pan.x = 0; pan.y = 0; this._recenter = false; }
    }
  }

  frameMul(night) {
    const r = this.game.renderer;
    const short = Math.min(r.w || 390, r.h || 844);
    const target = clamp(short / 720, 0.5, 0.82) * (night ? 1.1 : 1.02) * FRAME_CLOSER;
    return target / (r.baseZoom || 1);
  }

  /* ---------------- threat model helpers ---------------- */

  waveCounts() { return WAVE_COUNTS[clamp(this.day, 1, 3) - 1].slice(); }

  /** Tonight's wave marks (shares of the night): Nights 2–3 set out at once (BUILD 16, R6). */
  waveTimes() { return this.day >= 2 ? WAVE_TIMES_LATER : WAVE_TIMES; }

  swarmSpeed(breached) {
    const base = 59 + Math.max(0, this.day - 1) * 5;
    // Inside the walls they rush; outside they shamble in ranks.
    return breached ? 92 * (1 + (this.day - 1) * 0.08) : base;
  }

  _field(key) {
    const m = this.game.mansion;
    let field = this._fields.get(key);
    if (!field) { field = new FlowField(m); this._fields.set(key, field); }
    const version = m.navVersion || 0;
    if (key === 'hunter') {
      const p = this.game.player;
      const cell = `${Math.floor((p.x - m.navX0) / m.navCell)},${Math.floor((p.y - m.navY0) / m.navCell)}`;
      if (field.version !== version || field.cell !== cell) {
        if (field.version === version && this.uiClock - field.builtAt < 0.25) return field;
        field.cell = cell;
        field.builtAt = this.uiClock;
        field.build(p.x, p.y, version);
      }
      return field;
    }
    if (field.version !== version) {
      if (key === 'keep') {
        // a ring of goals around the tower's wall: every side is a target
        const keep = this.keep();
        const ring = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ring.push({ x: keep.x + Math.cos(a) * (keep.r + 34), y: keep.y + Math.sin(a) * (keep.r + 34) });
        }
        field.buildMulti(ring, version);
      } else if (key.startsWith('door:')) {
        const door = this.entranceById(key.slice(5));
        const point = door && (door.outside || door);
        if (point) field.build(point.x, point.y, version);
      }
      field.builtAt = this.uiClock;
    }
    return field;
  }

  flowDir(kind, x, y) {
    const field = this._field(kind);
    return field ? field.dirAt(x, y) : null;
  }

  nearestBrokenDoor(x, y) {
    let best = null, bestD = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (e.kind !== 'door' || !e.exterior || !e.broken) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nextIntactDoor(x, y) {
    let best = null, bestD = Infinity;
    for (const e of this.game.mansion.entrances) {
      if (e.kind !== 'door' || !e.exterior || e.broken) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  doorPressure(id) { return this._doorPressure.get(id) || 0; }

  /** Intact exterior doors something is clawing right now. */
  besiegedDoors() {
    return this.game.mansion.entrances.filter((e) => e.exterior && e.kind === 'door' && !e.broken && this.doorPressure(e.id) > 0);
  }

  breachAge(id) { return this._breachAt[id] == null ? Infinity : this.uiClock - this._breachAt[id]; }

  nightSchedule() {
    const marks = this.waveTimes().map((at, i) => ({ at, kind: 'wave', done: this.waveIndex > i }));
    if (this.day >= 2) marks.push({ at: BREAKER_TIMES[0], kind: 'breaker', done: this.breakerIndex >= 1 });
    if (this.day >= 3) marks.push({ at: BREAKER_TIMES[1], kind: 'breaker', done: this.breakerIndex >= 2 });
    return marks;
  }

  aliveEnemies() {
    let n = 0;
    // a routed straggler (BUILD 16) is already gone from the night
    for (const e of this.game.enemies) if (e._survivalType && !e.dead && !e.removeMe && !e.fleeing) n++;
    return n;
  }

  enemiesNear(x, y, r) {
    let n = 0;
    for (const e of this.game.enemies) if (e._survivalType && !e.dead && dist(x, y, e.x, e.y) <= r) n++;
    return n;
  }

  /** Returns false, 'wood' or 'gold' (not enough). Gold never burns: no reserve. */
  affordReason(cost) {
    if (!cost) return 'none';
    if (this.wood < (cost.wood || 0)) return 'wood';
    if (this.gold < (cost.gold || 0)) return 'gold';
    return null;
  }

  canAfford(cost) { return this.affordReason(cost) === null; }

  rewardPending() {
    return this.phase === 'day' && !!this.lastRewards && this.rewardAck !== this.nightsCompleted;
  }

  ackRewards() {
    this.rewardAck = this.nightsCompleted;
    this.game.audio.play('uiConfirm', { vol: 0.6 });
    // the dawn's planks come off the sawmills you built, where you can see them
    for (const pay of this._sawmillPayout || []) {
      const spot = this.buildingSpot(pay.slotId);
      if (!spot || !(pay.wood > 0)) continue;
      this.pushFx('log', spot.x, spot.y, { n: pay.wood });
      this.pushFloater(spot.x, spot.y, `+${pay.wood}`, '#ffcf8a', { h: 130, size: 24, icon: 'wood', life: 1.8, pop: 1.4, kind: 'income' });
    }
    this._sawmillPayout = null;
    this._persist(true);
    return true;
  }

  /* ---------------- banners + floating numbers ---------------- */

  pushEvent(kind, icon, text, opts = {}) {
    const ev = { kind, icon, text, sub: opts.sub || null, life: opts.life || 1.9, age: 0 };
    const urgent = kind === 'breach' || kind === 'keep' || kind === 'breaker' || kind === 'keepLow';
    // a guard alarm is next in line (its clock is running), once per kind:
    // two guards falling together raise one banner, the HUD counts them
    const guardAlarm = kind === 'guardDown' || kind === 'guardLost';
    if (guardAlarm && ((this.banner && this.banner.kind === kind) || this.bannerQueue.some((q) => q.kind === kind))) return;
    if (!this.banner) this.banner = ev;
    else if (urgent && this.banner.kind !== 'breach' && this.banner.kind !== 'keep') {
      this.banner = ev;
    } else if (guardAlarm) {
      this.bannerQueue.unshift(ev);
      if (this.bannerQueue.length > 4) this.bannerQueue.pop();
    } else if (this.bannerQueue.length < 4) this.bannerQueue.push(ev);
  }

  currentBanner() { return this.banner; }

  /**
   * Income shown beside a HUD counter (`icon`: the counter it lands in;
   * `from`: the building icon it came from). Timestamped on the UI clock;
   * the HUD draws and drops them (src/ui/survival.js drawHudPops).
   */
  pushHudPop(icon, text, from) {
    if (!this.hudPops) this.hudPops = [];
    if (this.hudPops.length > 6) this.hudPops.shift();
    this.hudPops.push({ icon, text, from, t0: this.uiClock });
  }

  /**
   * A damage number over a body (V9): a hit within DMG_NUMBER.merge of the
   * last one on the same body adds into that number (it pops again and takes
   * the stronger grade); otherwise a new one. It follows the body while that
   * lives.
   */
  pushDamageNumber(enemy, dealt, grade, h, held = false) {
    // drawn on every hit, merged or not: the seeded runs (survival-balance)
    // see the same random stream as before the merge
    const ox = rand(-12, 12), drift = rand(-22, 22);
    const prev = this.floaters.find((f) => f.target === enemy && f.t - f.bump <= DMG_NUMBER.merge);
    if (prev) {
      prev.sum += dealt;
      prev.hits += 1;
      prev.bump = prev.t;
      prev.life = Math.max(prev.life, prev.t + DMG_NUMBER.linger);
      prev.held = prev.held || held;
      if (DMG_RANK[grade] > DMG_RANK[prev.grade]) prev.grade = grade;
      styleDamageNumber(prev);
      return prev;
    }
    if (this.floaters.length > 48) this.floaters.shift();
    const f = {
      x: enemy.x + ox, y: enemy.y, ox, h, icon: null, t: 0, life: DMG_NUMBER.life, drift,
      target: enemy, sum: dealt, hits: 1, bump: 0, grade, held,
    };
    styleDamageNumber(f);
    this.floaters.push(f);
    return f;
  }

  pushFloater(x, y, text, color, opts = {}) {
    if (this.floaters.length > 48) this.floaters.shift();
    this.floaters.push({
      x, y, text, color, h: opts.h || 60, size: opts.size || 16, icon: opts.icon || null, pop: opts.pop || 1.2, t: 0, life: opts.life || 0.9,
      drift: opts.drift != null ? opts.drift : 0, kind: opts.kind || null,
    });
  }

  /**
   * A one-shot 3D effect for world3d to play and forget (impact flashes and
   * rings, kill bursts, coins out of a mine, logs off a sawmill, a soldier
   * stepping out of a barracks). Drained every frame by the renderer; a
   * headless run just lets the queue roll over.
   */
  pushFx(kind, x, y, opts = {}) {
    if (this.fx.length >= 96) this.fx.shift();
    this.fx.push({ kind, x, y, t0: this.game.now || 0, ...opts });
  }

  _updateFx(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) { this.floaters.splice(i, 1); continue; }
      // a damage number rides over its body while that lives (V9)
      if (f.target && !f.target.dead && f.t < f.life - 0.25) { f.x = f.target.x + f.ox; f.y = f.target.y; }
    }
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.life) this.banner = this.bannerQueue.shift() || null;
    }
  }

  getNightSnapshot() {
    return {
      phase: this.phase, day: this.day, elapsed: +this.elapsed.toFixed(2),
      duration: this.nightDuration, gold: +this.gold.toFixed(1), wood: this.wood,
      survivors: this.survivors, keepLevel: this.keepLevel, keepHp: Math.round(this.keepHp), keepHpMax: this.keepHpMax(),
      keepState: this.keepState(), hunterLevel: this.hunterLevel, armsLevel: this.armsLevel,
      buildings: { ...this.buildings }, buildingLevels: { ...this.buildingLevels },
      territory: this.territoryPlots().map((slot) => slot.id),
      bannerReach: this.bannerReach(),
      enemies: this.game.enemies.filter((e) => !e.dead).length,
      cleared: this.cleared ? { ...this.cleared } : null,
      stragglers: this.stragglers ? { ...this.stragglers } : null,
      breakers: this.game.enemies.filter((e) => e._survivalType === 'breaker' && !e.dead).length,
      kills: this.nightStats.kills, gateHp: Math.round(this.gateHp),
      keepAttackers: this.keepAttackers, keepDamage: Math.round(this.nightStats.keepDamage || 0),
      guards: this.guards.length, guardsDown: this.guards.filter((guard) => guard.down).length,
      gateBroken: !!(this.mainGate() && this.mainGate().broken),
      job: this.builderJob ? { ...this.builderJob } : null,
      context: this.phase === 'day' && this.dayContext() ? this.dayContext().id : null,
      cine: this.cine ? { kind: this.cine.kind, t: +this.cine.t.toFixed(2), dur: this.cine.dur } : null,
      relief: this.reinforcements ? {
        troops: this.reinforcements.length,
        marching: this.reinforcements.filter((s) => s.moving || s.delay > 0).length,
        inLine: this.reinforcements.filter((s) => s.i >= s.path.length).length,
      } : null,
      introSeen: !!(this.game.save.survival && this.game.save.survival.introSeen),
    };
  }

  _makeEnemy(kind, x, y, entranceId, index) {
    const entrance = this.entranceById(entranceId) || this.mainGate();
    if (kind === 'swarm') return new SurvivalCrowdZombie(x, y, entrance, index, this.day);
    if (kind === 'individual') return new SurvivalIndividualZombie(x, y, entrance, this.day, index);
    if (kind === 'breaker') return new SurvivalBreaker(x, y, entrance, this.day, index);
    return null;
  }

  _serializeEnemies() {
    return this.game.enemies.filter((e) => e._survivalType && !e.fleeing).map((e) => ({
      kind: e._survivalType, id: e.id, x: e.x, y: e.y, hp: e.hp, hpMax: e.hpMax,
      state: e.state, stateT: e.stateT, angle: e.angle, vx: e.vx, vy: e.vy,
      alpha: e.alpha, dead: e.dead, deathT: e.deathT, attackCd: e.attackCd,
      press: e.press, t: e.t, index: e.index || e.waveIndex || e.breakerIndex || 0,
      entranceId: e.entranceId, targetEntranceId: e.targetEntranceId,
      inHouse: !!e._inHouse, keepCd: e.keepCd, staggerT: e.staggerT || 0, targetKind: e.targetKind || null,
    }));
  }

  /** BUILD 19 (R9): the watch tier the banked stars have reached. */
  unlockTier() { return unlockTierFor(this.records && this.records.totalStars); }

  /** The end panel's ladder line (R9): what is earned, what is next, how far.
   *  Reads the same on a win and on a loss — every closed run shows it. */
  unlockSummary() {
    const total = (this.records && this.records.totalStars) || 0;
    const tier = this.unlockTier();
    const next = UNLOCK_TIERS.find((t) => t.stars > total) || null;
    const unlocked = this._newBanner || null;
    let text;
    if (unlocked) text = next ? `NEW: ${unlocked.name} — ${next.stars - total}★ TO ${next.name}` : `NEW: ${unlocked.name} — ALL EARNED`;
    else if (next) text = `CAPTAIN'S WATCH ★${total} — ${next.stars - total}★ TO ${next.name}`;
    else text = `ALL WATCH COLOURS EARNED — ★${total}`;
    return { total, tier: tier.id, unlocked: unlocked ? unlocked.name : null, next: next ? next.name : null, text };
  }

  _persist(force) {
    const g = this.game;
    const s = g.save.survival || (g.save.survival = freshProgress(this.nightDuration));
    s.initialized = true;
    s.day = this.day; s.phase = this.phase; s.elapsed = +this.elapsed.toFixed(2);
    s.nightDuration = this.nightDuration;
    s.gold = Math.round(this.gold * 100) / 100; s.wood = Math.round(this.wood);
    delete s.oil; delete s.perapianLevel; delete s.oilBurned; delete s.nightOilStart;
    s.survivors = this.survivors; s.keepLevel = this.keepLevel; s.keepHp = Math.round(this.keepHp * 10) / 10;
    s.buildings = { ...this.buildings }; s.buildingLevels = { ...this.buildingLevels };
    s.hunterLevel = this.hunterLevel; s.armsLevel = this.armsLevel; s.gateBuilt = this.gateBuilt;
    s.gateHp = Math.round(this.gateHp); s.builderJob = this.builderJob ? { ...this.builderJob } : null;
    s.selectedRoom = this.selectedRoom; s.nightsCompleted = this.nightsCompleted;
    s.waveIndex = this.waveIndex; s.breakerIndex = this.breakerIndex; s.individualIndex = this.individualIndex;
    s.runSeed = this.runSeed; s.runCount = this.runCount;
    s.siegeTimers = { ...this.siegeTimers };
    s.nightKeepStart = this.nightKeepStart == null ? null : Math.round(Number(this.nightKeepStart));
    s.nightStats = cloneStats(this.nightStats); s.lastRewards = this.lastRewards ? { ...this.lastRewards } : null;
    s.cleared = this.phase === 'night' && this.cleared ? { ...this.cleared } : null;
    s.runStats = cloneStats(this.runStats);
    s.records = { ...this.records };
    s.runResult = this.runResult ? cloneStats(this.runResult) : null;
    s.rewardAck = this.rewardAck;
    s.player = { x: g.player.x, y: g.player.y, angle: g.player.angle, blood: g.player.blood };
    s.entrances = g.mansion.entrances.map((e) => ({ id: e.id, hp: e.hp, hpMax: e.hpMax, broken: e.broken, open: e.open, barricade: e.barricade }));
    s.enemies = this.phase === 'night' ? this._serializeEnemies() : [];
    // hurt / fallen guards survive a mid-night reload (a fallen one where it lies)
    s.guards = this.phase === 'night' ? this.guards.map((guard) => ({
      hp: Math.round(guard.hp * 10) / 10, down: !!guard.down, rescueT: +guard.rescueT.toFixed(2),
      downT: +guard.downT.toFixed(2), x: Math.round(guard.x), y: Math.round(guard.y),
    })) : [];
    if (force) this._saveT = 0;
    try { window.__LN_SURVIVAL = this.getNightSnapshot(); } catch (_) { /* node harness */ }
    // writeSave is intentionally batched while simulating; phase/build changes
    // force an immediate checkpoint so a reload does not lose a completed day.
    if (force || this._saveT === 0) writeSave(g.save);
  }
}

export { SurvivalCrowdZombie, SurvivalIndividualZombie, SurvivalBreaker };
