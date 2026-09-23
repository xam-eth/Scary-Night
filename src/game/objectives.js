/* LAST NIGHT — objectives: the night needs a *purpose* beyond the clock.
 *
 * Design rule: goals must never fight the core horror loop. Surviving to
 * 05:00 remains the win condition; objectives are the reason to *move* and
 * *listen* during it, and they pay out in the same shard currency the meta
 * already uses. Three goals per night are drawn from the pool with the run
 * seed, so every night has a different shape but a fair shape — and every
 * goal is completable by a player who is playing well, not a player who is
 * paying. (Paying speeds the meta, never the night — see src/shop/iap.js.)
 *
 * Goals are checked by polling cheap game state each tick plus a handful of
 * explicit notify() events, so no gameplay system had to be rewired.
 */

import { clamp } from '../core/util.js';

export const GOALS = [
  {
    id: 'feed', label: 'FEED PROPERLY', hint: 'kill 3 intruders',
    par: (g) => g.stats.kills >= 3,
    progress: (g) => clamp(g.stats.kills / 3, 0, 1),
    reward: { shards: 25, blood: 18 },
  },
  {
    id: 'walls', label: 'HOLD THE WALLS', hint: 'every door at least half-intact',
    par: (g) => g.mansion.doors.every((d) => d.hp / d.hpMax >= 0.5),
    progress: (g) => {
      const lows = g.mansion.doors.map((d) => clamp(d.hp / d.hpMax / 0.5, 0, 1));
      return lows.reduce((a, b) => a + b, 0) / lows.length;
    },
    reward: { shards: 30, planks: 2 },
  },
  {
    id: 'knocks', label: 'ANSWER AND LIVE', hint: 'answer a knock, survive it',
    event: 'knockAnswered',
    par: (g, st) => st.flags.knockSurvived,
    progress: (g, st) => (st.flags.knockSurvived ? 1 : st.flags.knockAnswered ? 0.6 : 0),
    reward: { shards: 20, blood: 12 },
  },
  {
    id: 'basin', label: 'DRINK FROM THE BASIN', hint: 'the cellar door must still hold',
    event: 'drank',
    par: (g, st) => g.basinUsed && g.mansion.cellarDoor && g.mansion.cellarDoor.hp / g.mansion.cellarDoor.hpMax >= 0.4,
    progress: (g, st) => (g.basinUsed ? 0.5 : 0) + (g.mansion.cellarDoor && g.mansion.cellarDoor.hp / g.mansion.cellarDoor.hpMax >= 0.4 ? 0.5 : 0),
    reward: { shards: 15, blood: 10 },
  },
  {
    id: 'untouched', label: 'UNTOUCHED AFTER 3:00', hint: 'sixty seconds without a hit',
    par: (g, st) => g.time >= 240 && st.cleanStreak >= 60,
    progress: (g, st) => (g.time < 240 ? 0.15 : clamp(st.cleanStreak / 60, 0.15, 1)),
    reward: { shards: 25, blood: 15 },
  },
  {
    id: 'sated', label: 'END THE NIGHT SATIATED', hint: 'blood above half at dawn',
    par: (g, st) => g.time >= 296 && g.player.bloodPct >= 0.5,
    progress: (g) => (g.time < 240 ? 0 : clamp(g.player.bloodPct / 0.5, 0, 1)),
    endOfNight: true,
    reward: { shards: 20 },
  },
  {
    id: 'quiet', label: 'KEEP ONE DOOR FORGOTTEN', hint: 'a door untouched by dawn',
    par: (g, st) => g.time >= 296 && g.mansion.doors.some((d) => !(d.hits > 0)),
    progress: (g) => (g.time < 120 ? 0 : clamp(g.mansion.doors.filter((d) => !(d.hits > 0)).length / 2, 0, 1)),
    endOfNight: true,
    reward: { shards: 18, planks: 1 },
  },
  /* ---- v1.0: goals that teach the new rooms and the new predators ---- */
  {
    id: 'chapel', label: 'KNEEL AT THE ALTAR', hint: 'ten seconds inside the altar light',
    par: (g) => (g.stats.altarSeconds || 0) >= 10,
    progress: (g) => clamp((g.stats.altarSeconds || 0) / 10, 0, 1),
    reward: { shards: 16, blood: 12 },
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
    reward: { shards: 22, planks: 1 },
  },
  {
    id: 'unseen', label: 'DENY THE STALKER', hint: 'make the quiet thing bleed',
    event: 'stalkerKilled',
    par: (g, st) => !!st.flags.stalkerKilled,
    progress: (g, st) => (st.flags.stalkerKilled ? 1 : 0),
    reward: { shards: 30, blood: 14 },
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
    reward: { shards: 18, blood: 10 },
    pinned: true,
  },
  {
    id: 'wings', label: 'LEARN THE HOUSE', hint: 'set foot in four rooms',
    par: (g) => (g.stats.roomsVisited || 0) >= 4,
    progress: (g) => clamp((g.stats.roomsVisited || 0) / 4, 0, 1),
    reward: { shards: 16, planks: 1 },
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
    reward: { shards: 22, planks: 1 },
  },
  {
    id: 'ward', label: 'LIGHT THE STUDY', hint: 'the lamp holds them, briefly',
    event: 'wardLit',
    par: (g, st) => !!st.flags.wardLit,
    progress: (g, st) => (st.flags.wardLit ? 1 : 0),
    reward: { shards: 14, blood: 8 },
  },
];

const eastGlass = (game) => game.mansion.entrances.filter((e) => e.id === 'glassNorth' || e.id === 'glassEast' || e.id === 'chapelWindow');

const GOALS_PER_NIGHT = 3;

export class Objectives {
  constructor() {
    this.list = [];
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
    const seed = game.runSeed ?? game.time ?? 1;
    const pick = [];
    const pool = GOALS.filter((g) => !g.pinned);
    const pinned = GOALS.find((g) => g.pinned);
    if (pinned) pick.push(pinned);
    let r = (seed * 2654435761) % 4294967296;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    while (pick.length < GOALS_PER_NIGHT && pool.length) {
      pick.push(pool.splice((rnd() * pool.length) | 0, 1)[0]);
    }
    this.list = pick.map((g) => ({
      goal: g, state: g.par(game, this) ? 'done' : 'open', t: 0,
    }));
    game.showMessage('THE NIGHT HAS A SHAPE: ' + pick.map((p) => p.hint.toUpperCase()).slice(0, 2).join(' · '), { tone: 'gold', life: 5.2 });
  }

  /** Explicit events the poller cannot see. */
  notify(game, evt) {
    if (evt === 'knockAnswered') this.flags.knockAnswered = game.time;
    if (evt === 'drank') this.flags.drank = true;
    if (evt === 'stalkerKilled') this.flags.stalkerKilled = true;
    if (evt === 'wardLit') this.flags.wardLit = true;
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
        if (rw.blood) game.player.heal(rw.blood, game);
        if (rw.planks) game.player.planks += rw.planks;
        game.audio.play('chandelier', { vol: 0.5 });
        game.showMessage(slot.goal.label + ' — DONE', { tone: 'gold', life: 4 });
        this.banner = { text: slot.goal.label, t: 0 };
      }
    }
  }

  onHurt() { this.cleanStreak = 0; }

  /** End of night: partial credit so a hard loss still advances the meta. */
  settle(game, won) {
    // last-second par checks that only make sense at dawn
    for (const slot of this.list) {
      if (slot.goal.endOfNight && slot.state === 'open' && slot.goal.par(game, this)) {
        slot.state = 'done';
        this.doneCount++;
        this.shardBank += slot.goal.reward.shards || 0;
      }
    }
    let shards = this.shardBank;
    if (won) shards += 10 * this.doneCount;      // finish them AND survive
    else shards = Math.round(shards * 0.6);      // dead in the dark: still paid honestly
    return { done: this.doneCount, shards, list: this.list.map((s) => ({ id: s.goal.id, label: s.goal.label, hint: s.goal.hint, state: s.state })) };
  }

  hudState() {
    if (!this.list.length) return null;
    const open = this.list.filter((s) => s.state === 'open').slice(0, 2);
    return {
      open: open.map((s) => ({ label: s.goal.label, hint: s.goal.hint, progress: s.p ?? 0 })),
      done: this.list.filter((s) => s.state === 'done').length,
      total: this.list.length,
      bank: this.shardBank,
    };
  }
}
