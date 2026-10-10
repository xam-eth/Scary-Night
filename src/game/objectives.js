/* LAST NIGHT — objectives: the night needs a *purpose* beyond the clock.
 *
 * Design rule: goals must never fight the core horror loop. Surviving to
 * 05:00 remains the win condition; objectives are the reason to *move* and
 * *listen* during it, and they pay out in the same shard currency the meta
 * already uses. Three goals per night are drawn from the pool with the run
 * seed, so every night has a different shape but a fair shape — and every
 * goal is completable by a player who is playing well, not a player who is
 * paying. Money buys a memory of a night already lived, never the night.
 *
 * Goals are checked by polling cheap game state each tick plus a handful of
 * explicit notify() events, so no gameplay system had to be rewired.
 */

import { clamp } from '../core/util.js';
import { dealHuntObjective, HUNT_OBJECTIVES, huntNightSeed } from './hunt.js';

function applyMissionReward(game, reward) {
  if (!reward) return;
  if (reward.blood && game.player) game.player.heal(reward.blood, game);
  if (reward.planks && game.player) game.player.planks += reward.planks;
  if (game.grantMissionResources) game.grantMissionResources(reward);
}

export const GOALS = [
  {
    id: 'feed', label: 'FEED PROPERLY', hint: 'kill 3 intruders',
    par: (g) => g.stats.kills >= 3,
    progress: (g) => clamp(g.stats.kills / 3, 0, 1),
    reward: { shards: 25, blood: 18, arrows: 2 },
  },
  {
    id: 'walls', label: 'HOLD THE WALLS', hint: 'every door at least half-intact',
    par: (g) => g.mansion.doors.every((d) => d.hp / d.hpMax >= 0.5),
    progress: (g) => {
      const lows = g.mansion.doors.map((d) => clamp(d.hp / d.hpMax / 0.5, 0, 1));
      return lows.reduce((a, b) => a + b, 0) / lows.length;
    },
    reward: { shards: 30, planks: 2, bandages: 1 },
  },
  {
    id: 'knocks', label: 'ANSWER AND LIVE', hint: 'answer a knock, survive it',
    event: 'knockAnswered',
    par: (g, st) => st.flags.knockSurvived,
    progress: (g, st) => (st.flags.knockSurvived ? 1 : st.flags.knockAnswered ? 0.6 : 0),
    reward: { shards: 20, blood: 12, knives: 1 },
  },
  {
    id: 'basin', label: 'DRINK FROM THE BASIN', hint: 'the cellar door must still hold',
    event: 'drank',
    par: (g, st) => g.basinUsed && g.mansion.cellarDoor && g.mansion.cellarDoor.hp / g.mansion.cellarDoor.hpMax >= 0.4,
    progress: (g, st) => (g.basinUsed ? 0.5 : 0) + (g.mansion.cellarDoor && g.mansion.cellarDoor.hp / g.mansion.cellarDoor.hpMax >= 0.4 ? 0.5 : 0),
    reward: { shards: 15, blood: 10, bandages: 1 },
  },
  {
    id: 'untouched', label: 'UNTOUCHED AFTER 3:00', hint: 'sixty seconds without a hit',
    par: (g, st) => g.time >= 240 && st.cleanStreak >= 60,
    progress: (g, st) => (g.time < 240 ? 0.15 : clamp(st.cleanStreak / 60, 0.15, 1)),
    reward: { shards: 25, blood: 15, arrows: 2 },
  },
  {
    id: 'sated', label: 'END THE NIGHT SATIATED', hint: 'blood above half at dawn',
    par: (g, st) => g.time >= 296 && g.player.bloodPct >= 0.5,
    progress: (g) => (g.time < 240 ? 0 : clamp(g.player.bloodPct / 0.5, 0, 1)),
    endOfNight: true,
    reward: { shards: 20, knives: 1 },
  },
  {
    id: 'quiet', label: 'KEEP ONE DOOR FORGOTTEN', hint: 'a door untouched by dawn',
    par: (g, st) => g.time >= 296 && g.mansion.doors.some((d) => !(d.hits > 0)),
    progress: (g) => (g.time < 120 ? 0 : clamp(g.mansion.doors.filter((d) => !(d.hits > 0)).length / 2, 0, 1)),
    endOfNight: true,
    reward: { shards: 18, planks: 1, arrows: 1 },
  },
  /* ---- v1.0: goals that teach the new rooms and the new predators ---- */
  {
    id: 'chapel', label: 'KNEEL AT THE ALTAR', hint: 'ten seconds inside the altar light',
    par: (g) => (g.stats.altarSeconds || 0) >= 10,
    progress: (g) => clamp((g.stats.altarSeconds || 0) / 10, 0, 1),
    reward: { shards: 16, blood: 12, bandages: 1 },
  },
  {
    id: 'glass', label: 'MIND THE GLASS', hint: 'the east-wing windows unbroken at dawn',
    par: (g) => g.time >= 296 && !eastGlass(g).some((e) => e.broken),
    progress: (g) => {
      const gl = eastGlass(g);
      if (!gl.length) return 0;
      return g.time < 120 ? 0.2 : clamp(gl.filter((e) => !e.broken).length / gl.length, 0.2, 1);
    },
    endOfNight: true,
    reward: { shards: 22, planks: 1, arrows: 2 },
  },
  {
    id: 'unseen', label: 'DENY THE STALKER', hint: 'make the quiet thing bleed',
    event: 'stalkerKilled',
    par: (g, st) => !!st.flags.stalkerKilled,
    progress: (g, st) => (st.flags.stalkerKilled ? 1 : 0),
    reward: { shards: 30, blood: 14, knives: 2 },
  },
  {
    id: 'firstMinute', label: 'THE FIRST MINUTE', hint: 'hold the servant door, or feed',
    par: (g) => {
      const door = g.mansion.entranceById('diningDoor');
      const held = door && !door.broken && door.hp / door.hpMax >= 0.5;
      return g.time >= 50 && (held || g.stats.kills >= 1);
    },
    progress: (g) => {
      const door = g.mansion.entranceById('diningDoor');
      const held = door ? clamp((door.hp / door.hpMax) / 0.5, 0, 1) : 0;
      const fed = clamp(g.stats.kills, 0, 1);
      return clamp(Math.max(held, fed) * 0.75 + clamp(g.time / 50, 0, 1) * 0.25, 0, 1);
    },
    reward: { shards: 18, blood: 10, arrows: 2 },
    pinned: true,
  },
  {
    id: 'wings', label: 'LEARN THE HOUSE', hint: 'set foot in four rooms',
    par: (g) => (g.stats.roomsVisited || 0) >= 4,
    progress: (g) => clamp((g.stats.roomsVisited || 0) / 4, 0, 1),
    reward: { shards: 16, planks: 1, knives: 1 },
  },
  {
    id: 'scullery', label: 'THE WEAK DOOR', hint: 'kitchen door still shut at 2:00',
    par: (g) => {
      const door = g.mansion.entranceById('kitchenDoor');
      return g.time >= 120 && door && !door.broken;
    },
    progress: (g) => {
      const door = g.mansion.entranceById('kitchenDoor');
      if (!door) return 0;
      return clamp((door.broken ? 0 : door.hp / door.hpMax) * clamp(g.time / 120, 0.2, 1), 0, 1);
    },
    reward: { shards: 22, planks: 1, bandages: 1 },
  },
  {
    id: 'fort', label: 'RAISE THE STAKES', hint: 'three planks, in the gatehouse',
    event: 'stakesRaised',
    par: (g, st) => !!st.flags.stakesRaised,
    progress: (g, st) => (st.flags.stakesRaised ? 1 : 0),
    reward: { shards: 16, planks: 1, knives: 1 },
  },
  {
    id: 'palisade', label: 'HOLD THE PALISADE', hint: 'the west gate still shut at 2:00',
    par: (g) => {
      const door = g.mansion.entranceById('palisade');
      return g.time >= 120 && door && !door.broken;
    },
    progress: (g) => {
      const door = g.mansion.entranceById('palisade');
      if (!door) return 0;
      return clamp((door.broken ? 0 : door.hp / door.hpMax) * clamp(g.time / 120, 0.2, 1), 0, 1);
    },
    reward: { shards: 22, planks: 2, arrows: 2 },
  },
  {
    id: 'ward', label: 'LIGHT THE STUDY', hint: 'the lamp holds them, briefly',
    event: 'wardLit',
    par: (g, st) => !!st.flags.wardLit,
    progress: (g, st) => (st.flags.wardLit ? 1 : 0),
    reward: { shards: 14, blood: 8, bandages: 1 },
  },
];

/* ================= tonight's hunt errand (docs/PURPOSE.md §2 P5) ==========
 * Surviving to 05:00 is the clock; this is the reason to go out. One errand a
 * night, chosen by the hunt itself (what the board is still missing), and it
 * is dealt as a real goal so the HUD, the banner, the settle and the shard
 * payout all work without a second system. The hunt's own reward — track and
 * materials — is banked with the night in src/game/hunt.js.
 */
const houndKills = (g) => {
  const by = (g.stats && g.stats.killsBy) || {};
  return (by.werewolf || 0) + (by.ghoul || 0) + (by.hunter || 0);
};

export function huntGoal(game, seed) {
  const pick = dealHuntObjective(game.save, seed);
  const target = pick.target;
  const roomName = () => {
    const r = game.mansion && game.mansion.room && game.mansion.room(target);
    return String((r && r.name) || target || '').toUpperCase();
  };
  const defs = {
    /* nothing left to learn, nothing left to mark: only the kill */
    endit: {
      id: 'hunt:endit', label: HUNT_OBJECTIVES.endit.label,
      hint: 'THE MASTER COMES TONIGHT',
      par: (g) => !!(g.save && g.save.hunt && g.save.hunt.masterDown),
      progress: (g) => ((g.save && g.save.hunt && g.save.hunt.masterDown) ? 1 : 0),
      reward: { shards: 40, blood: 20, arrows: 4, knives: 2 },
    },
    /* the map, while the house is still unmapped */
    nests: {
      id: 'hunt:nests', label: HUNT_OBJECTIVES.nests.label,
      hint: () => `${roomName()} — UNMARKED ON THE BOARD`,
      par: (g) => !!(g.stats.roomsSeen || {})[target],
      progress: (g) => ((g.stats.roomsSeen || {})[target] ? 1 : 0),
      reward: { shards: 22, blood: 8, arrows: 2, bandages: 1 },
    },
    /* the pack, while its hounds are still unmarked */
    mark: {
      id: 'hunt:mark', label: HUNT_OBJECTIVES.mark.label,
      hint: 'BLEED ONE OF ITS HOUNDS',
      par: (g) => houndKills(g) >= 1,
      progress: (g) => clamp(houndKills(g), 0, 1),
      reward: { shards: 26, blood: 10, knives: 2 },
    },
    /* its stalker, once it starts sending one */
    stalk: {
      id: 'hunt:stalk', label: HUNT_OBJECTIVES.stalk.label,
      hint: 'LIVE SIXTY SECONDS AFTER IT COMES',
      par: (g, st) => st.flags.stalkerAt != null && g.time - st.flags.stalkerAt >= 60,
      progress: (g, st) => (st.flags.stalkerAt == null ? 0 : clamp((g.time - st.flags.stalkerAt) / 60, 0.2, 1)),
      reward: { shards: 30, blood: 8, bandages: 2 },
    },
    /* and on the long nights, what the house hoards */
    hoard: {
      id: 'hunt:hoard', label: HUNT_OBJECTIVES.hoard.label,
      hint: 'COLLECT FOUR DROPS TONIGHT',
      par: (g) => ((g.stats && g.stats.pickupsTaken) || 0) >= 4,
      progress: (g) => clamp(((g.stats && g.stats.pickupsTaken) || 0) / 4, 0, 1),
      reward: { shards: 20, planks: 1, arrows: 1, knives: 1 },
    },
  };
  const def = defs[pick.id] || defs.hoard;
  const goal = { ...def, hunt: true, huntId: pick.id, target: target || null };
  if (typeof goal.hint === 'function') goal.hint = goal.hint();
  return goal;
}

const eastGlass = (game) => game.mansion.entrances.filter((e) => e.id === 'glassNorth' || e.id === 'glassEast' || e.id === 'chapelWindow');

const GOALS_PER_NIGHT = 3;

/* Hard contradictions. Tension pairs are allowed; impossible triples are not. */
export const GOAL_EXCLUDE = [
  ['walls', 'quiet'],
  ['feed', 'untouched'],
];

export const CORE_GOALS = new Set(['feed', 'firstMinute', 'wings', 'fort', 'knocks', 'chapel', 'scullery']);

export function forbiddenPair(ids) {
  return GOAL_EXCLUDE.some((pair) => pair.every((id) => ids.includes(id)));
}

export function dealNightGoals(seed) {
  const pick = [];
  const pool = GOALS.filter((g) => !g.pinned);
  const pinned = GOALS.find((g) => g.pinned);
  if (pinned) pick.push(pinned);
  let r = (Math.abs(seed || 1) * 2654435761) % 4294967296;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ids = () => pick.map((g) => g.id);
  let guard = 0;
  while (pick.length < GOALS_PER_NIGHT && pool.length && guard++ < 40) {
    const i = (rnd() * pool.length) | 0;
    const g = pool[i];
    if (forbiddenPair(ids().concat(g.id))) { pool.splice(i, 1); continue; }
    const needCore = !ids().some((id) => CORE_GOALS.has(id));
    const lastSlot = pick.length === GOALS_PER_NIGHT - 1;
    if (lastSlot && needCore && !CORE_GOALS.has(g.id) && pool.some((x) => CORE_GOALS.has(x.id))) {
      pool.splice(i, 1);
      pool.push(g);
      continue;
    }
    pick.push(pool.splice(i, 1)[0]);
  }
  return pick;
}

export class Objectives {
  constructor() {
    this.list = [];
    this.hunt = null;
    this.flags = {};
    this.cleanStreak = 0;
    this.doneCount = 0;
    this.shardBank = 0;   // paid out with the night summary, not mid-run
    this.banner = null;   // { text, t } — drawn by the HUD
  }

  /* Deterministic draw: same seed, same night, same purpose. */
  beginNight(game) {
    this.flags = {};
    this.cleanStreak = 0;
    this.doneCount = 0;
    this.shardBank = 0;
    this.banner = null;
    this.lastKills = 0;
    this.completed = new Set();
    this.hunt = null;
    const seed = game.runSeed ?? game.time ?? 1;
    const pick = dealNightGoals(seed);
    // seeded by the night, not by the run: retrying a night keeps its errand
    const hunt = huntGoal(game, huntNightSeed(game.save));
    this.hunt = { goal: hunt, state: hunt.par(game, this) ? 'done' : 'open', t: 0, p: 0 };
    // The errand leads: it is the reason tonight is not the same as last night.
    this.list = [this.hunt, ...pick.map((g) => ({
      goal: g, state: g.par(game, this) ? 'done' : 'open', t: 0,
    }))];
    game.showMessage('TONIGHT — ' + hunt.label + ' · ' + hunt.hint, { tone: 'gold', life: 5.6 });
    game.showMessage('THE NIGHT HAS A SHAPE: ' + pick.map((p) => p.hint.toUpperCase()).slice(0, 2).join(' · '), { tone: 'cold', life: 5.2 });
  }

  /** Explicit events the poller cannot see. */
  notify(game, evt) {
    if (evt === 'knockAnswered') this.flags.knockAnswered = game.time;
    if (evt === 'drank') this.flags.drank = true;
    if (evt === 'stalkerKilled') this.flags.stalkerKilled = true;
    if (evt === 'wardLit') this.flags.wardLit = true;
    if (evt === 'stakesRaised') this.flags.stakesRaised = true;
  }

  update(dt, game) {
    if (!this.list.length) return;
    // clean streak for UNTOUCHED AFTER 3:00
    if (game.time >= 240) this.cleanStreak += dt;
    // answering a knock only counts once you live through it
    if (this.flags.knockAnswered && !this.flags.knockSurvived && game.time - this.flags.knockAnswered > 45) {
      this.flags.knockSurvived = true;
    }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 4) this.banner = null; }
    // the stalker is not a notify — it is a thing in the room. Notice it there.
    if (this.flags.stalkerAt == null && game.enemies.some((e) => e.key === 'stalker' && !e.dead)) {
      this.flags.stalkerAt = game.time;
    }

    for (const slot of this.list) {
      slot.t += dt;
      slot.p = clamp(slot.goal.progress(game, this), 0, 1);
      if (slot.state !== 'open') continue;
      if (slot.goal.par(game, this)) {
        slot.state = 'done';
        slot.p = 1;
        this.doneCount++;
        const rw = slot.goal.reward;
        this.shardBank += rw.shards || 0;
        applyMissionReward(game, rw);
        game.audio.play('chandelier', { vol: 0.5 });
        game.showMessage(slot.goal.label + ' — DONE', { tone: 'gold', life: 4 });
        this.banner = { text: slot.goal.label, t: 0 };
      }
    }
  }

  onHurt() { this.cleanStreak = 0; }

  /** End of night: partial credit so a hard loss still advances the meta. */
  settle(game, won) {
    if (this._settled) {
      return { done: this.doneCount, shards: 0, list: this.list.map((s) => ({ id: s.goal.id, label: s.goal.label, hint: s.goal.hint, state: s.state })) };
    }
    this._settled = true;
    // The errand is judged on the night as it ended, not on the last tick that
    // happened to run: a player who picks the fourth drop up on her way to the
    // door did the thing, however the frame budget fell.
    if (this.hunt && this.hunt.state === 'open') {
      const g = this.hunt.goal;
      this.hunt.p = clamp(g.progress(game, this), 0, 1);
      if (g.par(game, this)) {
        this.hunt.state = 'done';
        this.hunt.p = 1;
        this.doneCount++;
        this.shardBank += g.reward.shards || 0;
        applyMissionReward(game, g.reward);
        game.audio.play('chandelier', { vol: 0.5 });
        game.showMessage(g.label + ' — DONE', { tone: 'gold', life: 4 });
        this.banner = { text: g.label, t: 0 };
      }
    }
    // last-second par checks that only make sense at dawn
    for (const slot of this.list) {
      if (slot.goal.endOfNight && slot.state === 'open' && slot.goal.par(game, this)) {
        slot.state = 'done';
        this.doneCount++;
        this.shardBank += slot.goal.reward.shards || 0;
        applyMissionReward(game, slot.goal.reward);
      }
    }
    let shards = this.shardBank;
    if (won) shards += 10 * this.doneCount;      // finish them AND survive
    else shards = Math.round(shards * 0.6);      // dead in the dark: still paid honestly
    return { done: this.doneCount, shards, list: this.list.map((s) => ({ id: s.goal.id, label: s.goal.label, hint: s.goal.hint, state: s.state })) };
  }

  /** What tonight's errand came to, for the hunt to bank (src/game/hunt.js). */
  huntReport() {
    const s = this.hunt;
    if (!s) return null;
    return {
      id: s.goal.huntId, label: s.goal.label, target: s.goal.target || null,
      done: s.state === 'done', p: clamp(s.p ?? (s.state === 'done' ? 1 : 0), 0, 1),
    };
  }

  hudState() {
    if (!this.list.length) return null;
    const open = this.list.filter((s) => s.state === 'open').slice(0, 2);
    return {
      open: open.map((s) => ({ label: s.goal.label, hint: s.goal.hint, progress: s.p ?? 0, hunt: !!s.goal.hunt })),
      hunt: this.hunt ? { label: this.hunt.goal.label, hint: this.hunt.goal.hint, progress: this.hunt.p ?? 0, done: this.hunt.state === 'done' } : null,
      done: this.list.filter((s) => s.state === 'done').length,
      total: this.list.length,
      bank: this.shardBank,
    };
  }
}
