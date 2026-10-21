/**
 * Gelombang & jadwal malam Survival (seam F2-(a), docs/ARCHITECTURE.md §4).
 *
 * Fase 3 memecah `sim/survival.js` (4.9 rb baris) mulai dari jadwal: KAPAN
 * gelombang/Breaker/runner berangkat, BERAPA tubuh per gelombang, dan GERBANG
 * mana yang didatangi per run adalah data murni + aritmetika murni (seed run,
 * tanpa `Math.random`). Kelas `Survival` di `sim/survival.js` memegang bagian
 * yang bertindak (spawn tubuh, event, horn, save/reload state) dan membacakan
 * jadwalnya lewat helper di sini — satu sumber untuk kelas, HUD (chip
 * TONIGHT) dan tools (harness R8, survival-balance).
 *
 * Aturan authored yang dijaga tabel-tabel ini (riset BUILD 16/17,
 * docs/UX-REPLAY-RESEARCH.md §5 R5/R6/R8) pindah bersama komentarnya di
 * bawah; invariantnya dipin oleh check F2 seam di tools/harness.mjs.
 */
import { clamp } from '../../core/util.js';

// Night pacing: the first rank hits a door within seconds, so Night 1 has
// action near the Hunter before the halfway mark. Night 1 opens on the
// opening's last shot at its first wave mark (_startIntro). BUILD 16 (R6,
// same §5): Nights 2 and 3 have no opening, so their first wave sets out
// with the night (1.5 % in; it was 4 %) and its front rank is at its gate
// inside 5 s; every wave is called with its gate and a horn (updateWaves).
export const WAVE_TIMES = Object.freeze([0.04, 0.3, 0.56]);
export const WAVE_TIMES_LATER = Object.freeze([0.015, 0.3, 0.56]);
export const BREAKER_TIMES = Object.freeze([0.2, 0.5]);
export const INDIVIDUAL_TIMES = Object.freeze([0.42, 0.7]);
// Night 1–3 swarm sizes (×3 of the first M1 pass, capped per wave).
export const WAVE_COUNTS = Object.freeze([
  Object.freeze([21, 21, 24]),
  Object.freeze([24, 27, 27]),
  Object.freeze([30, 30, 30]),
]);
export const SWARM_CAP = 30;

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

/** Ukuran swarm malam `day` (1–3), per gelombang. */
export function waveCountsFor(day) {
  return WAVE_COUNTS[clamp(Math.round(Number(day) || 1), 1, 3) - 1].slice();
}

/** Waktu berangkat gelombang (fraksi durasi malam) untuk `day`. */
export function waveTimesFor(day) {
  return (Math.round(Number(day) || 1) >= 2) ? WAVE_TIMES_LATER : WAVE_TIMES;
}

/** Berapa Breaker yang dikirim malam `day` (0/1/2). */
export function breakersFor(day) {
  const d = Math.round(Number(day) || 1);
  return d >= 3 ? BREAKER_TIMES.length : d >= 2 ? 1 : 0;
}

/**
 * Gerbang-gerbang yang didatangi malam `day` pada run ber-seed `runSeed`,
 * berurutan (gelombang 1–3 lalu gerbang Individual kedua; Individual pertama
 * berbagi gerbang gelombang 3, Breaker selalu di gerbang utama). Murni:
 * seed yang sama selalu memberi putaran yang sama (kontrak R8 harness).
 */
export function nightDoorsFor(runSeed, day = 1) {
  const d = clamp(Math.round(Number(day) || 1), 1, NIGHT_ROTATIONS.length);
  const sets = NIGHT_ROTATIONS[d - 1];
  if (sets.length === 1) return sets[0];
  let i = mixSeed((runSeed || 0) ^ Math.imul(d, 0x9e3779b9)) % sets.length;
  if (d === 3 && sets[i][0] === nightDoorsFor(runSeed, 2)[0]) i = (i + 1) % sets.length;
  return sets[i];
}
