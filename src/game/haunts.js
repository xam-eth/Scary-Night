/* LAST NIGHT — haunts: the psychology layer (v1.0)
 *
 * house.js makes the mansion *inhabited*; this module makes it feel
 * *inhabited-by-you*. Everything here is pure information warfare: whispers
 * that may or may not describe reality, watchers that vanish under direct
 * attention, and answered footsteps that are not your own. Nothing in this
 * file damages the player. Nothing here spawns a threat. But several of the
 * tells it invents are real by morning, because the director can read
 * `game.feelWatched` and a haunted door flashes the same channel a real
 * attack would.
 *
 * The one hard rule: never lie about *damage*. A fake knock that hurts
 * nothing is horror; a fake low-blood warning is a broken game.
 */

import { clamp, lerp, rand, chance, dist, TAU } from '../core/util.js';

const WHISPERS = [
  'SOMETHING AGREES WITH YOUR CHOICE OF DOOR.',
  'YOU REPAIRED THE WRONG ONE. IT WAS SOFTER.',
  'THE HOUSE COUNTS YOUR STEPS. IT IS AHEAD.',
  'DO NOT LOOK AT THE PORTRAIT BY THE DINER. DO.',
  'THREE KNOCKS ARE POLITE. FOUR ARE A MEAL.',
  'SHE LEFT THE BASIN RUNNING FOR YOU. SHE ALWAYS DID.',
  'THE GLASS ROOM REMEMBERS RAIN. IT REMEMBERS OTHER THINGS.',
  'KNEEL ONCE. THE ALTAR DOES NOT CHARGE RENT.',
  'YOUR BLOOD HAS A RHYTHM. SOMETHING IS LEARNING IT.',
  'THE QUIET IS NOT EMPTY. IT IS LISTENING.',
];

const WATCH_LINES = [
  'YOU ARE BEING WATCHED FROM THE NORTH.',
  'WATCHED. WEST. TOO LATE TO BE POLITE.',
  'WATCHED. IT HAS BEEN WATCHED BACK.',
  'WATCHED, UNDER THE GLASS. THE MOON IS ON ITS SIDE.',
  'WATCHED. FROM THE CHAPEL. THAT IS NEW.',
];

export class Haunts {
  constructor() {
    this.nextWhisper = 40;
    this.nextFake = 30;
    this.nextWatch = 55;
    this.watchers = [];        // { x, y, room, t, seen }
    this.mimicT = 0;           // answered-footsteps timer
    this.lastWhisperAt = -999;
  }

  beginNight(game) {
    this.nextWhisper = rand(34, 60);
    this.nextFake = rand(48, 88);
    this.nextWatch = rand(55, 95);
    this.watchers.length = 0;
    this.mimicT = 0;
  }

  update(dt, game) {
    if (game.screen !== 'playing') return;
    const t = game.time;

    // ---- whispers: caption-only dread, more frequent with danger, never
    // during the silence (the last hour belongs to the real thing) ----
    if (t > this.nextWhisper && t < 285) {
      this.nextWhisper = t + rand(26, 64) / (1 + game.danger * 0.9);
      if (t - this.lastWhisperAt > 20) {
        this.lastWhisperAt = t;
        // 55% whispers are vague; 45% point at a real door — the point is that
        // the player can never tell which kind she just read.
        const doors = game.mansion.doors;
        let line = WHISPERS[(rand(0, WHISPERS.length)) | 0];
        if (doors.length && chance(0.45)) {
          const d = doors[(rand(0, doors.length)) | 0];
          line = `THE ${d.name} DOES NOT TRUST ${['ITSELF', 'YOU', 'THE HOUR'].find((_, i) => chance(1 / (i + 1))) || 'THE HOUR'}.`;
        }
        game.showMessage(line, { tone: 'cold', whisper: true, life: 4.2 });
        if (chance(0.5)) game.audio.play('whisper', { vol: 0.14, pan: rand(-0.7, 0.7) });
      }
    }

    // ---- the fake knock: a door flashes as if attacked. harmless, but the
    // ears do not know that yet. Suppressed right before a real pressure beat
    // so the director's timing beats stay honest. ----
    if (t > this.nextFake && t < 270) {
      this.nextFake = t + rand(42, 96);
      const ent = game.mansion.entrances[(rand(0, game.mansion.entrances.length)) | 0];
      const d = ent ? dist(game.player.x, game.player.y, ent.x, ent.y) : 1e9;
      if (ent && d > 260 && d < 900 && !ent.broken) {
        ent.flash = Math.max(ent.flash, 0.6);
        ent.hint = Math.max(ent.hint, 0.9);
        game.audio.play('knock', { x: ent.x, y: ent.y, cam: game.renderer.cam, vol: 0.22 });
        game.feelWatched = Math.max(game.feelWatched ?? 0, 0.9);
      }
    }

    // ---- watchers: a silhouette at the far edge of a lit room. It only
    // exists in peripheral vision; a direct look removes it, without drama. ----
    if (t > this.nextWatch && t < 265) {
      this.nextWatch = t + rand(50, 95) / (1 + game.danger * 0.5);
      const rooms = Object.values(game.mansion.rooms);
      const r = rooms[(rand(0, rooms.length)) | 0];
      if (r) {
        const wx = r.x + rand(0.15, 0.85) * r.w, wy = r.y + rand(0.15, 0.85) * r.h;
        const dp = dist(wx, wy, game.player.x, game.player.y);
        if (dp > 300 && dp < 1100) {
          this.watchers.push({ x: wx, y: wy, t: 0, life: rand(1.1, 2.2) });
          game.feelWatched = 1;
          if (chance(0.55)) {
            const line = WATCH_LINES[(rand(0, WATCH_LINES.length)) | 0];
            game.showMessage(line, { tone: 'cold', whisper: true, life: 3.6 });
          }
          game.audio.play('heartbeat', { vol: 0.3, soft: true });
        }
      }
    }
    for (let i = this.watchers.length - 1; i >= 0; i--) {
      const w = this.watchers[i];
      w.t += dt;
      // looked at directly? gone. No sound, no message — the doubt is the point.
      const toIt = Math.atan2(w.y - game.player.y, w.x - game.player.x);
      const off = Math.abs(((toIt - game.player.angle + Math.PI * 3) % TAU) - Math.PI);
      const seenDirect = off < 0.5 && game.mansion.hasLOS(game.player.x, game.player.y, w.x, w.y);
      if (w.t > w.life || seenDirect) this.watchers.splice(i, 1);
    }

    // ---- answered footsteps: walk and something walks back, one room away ----
    const sp = game.player.speed;
    if (sp > 30) {
      this.mimicT -= dt;
      if (this.mimicT <= 0 && game.danger > 0.2) {
        this.mimicT = rand(1.4, 2.6);
        if (chance(0.3)) {
          const a = game.player.angle + Math.PI + rand(-0.8, 0.8);
          const mx = game.player.x + Math.cos(a) * rand(220, 360);
          const my = game.player.y + Math.sin(a) * rand(220, 360);
          game.audio.play('footstep', { x: mx, y: my, cam: game.renderer.cam, vol: 0.12, rate: 0.8 });
        }
      }
    }
  }

  /** Watchers draw as an entity would but read as a memory: no shadow, low alpha. */
  drawWatchers(ctx, game) {
    for (const w of this.watchers) {
      const k = Math.sin(clamp(w.t / w.life, 0, 1) * Math.PI);   // fade in AND out
      const a = 0.34 * clamp(k * 1.6, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      if (game.renderer && game.renderer.upright) game.renderer.upright(ctx, w.x, w.y);  // they stand in the dark, not on the floor
      ctx.translate(w.x, w.y);
      ctx.fillStyle = '#05060a';
      ctx.beginPath(); ctx.ellipse(0, 4, 8, 12, 0, 0, TAU); ctx.fill();          // tall, thin body
      ctx.beginPath(); ctx.ellipse(0, -12, 4.2, 5.4, 0, 0, TAU); ctx.fill();     // head
      // the lie detector: it tilts toward the player like it is studying them
      const lean = Math.sin(w.t * 2.2) * 0.05;
      ctx.rotate(lean);
      ctx.restore();
      // faint retinal flicker so the eye catches it before the mind does
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = a * (0.5 + Math.sin(w.t * 11) * 0.5) * 1.4;
      ctx.fillStyle = 'rgba(190,60,52,0.5)';
      ctx.fillRect(w.x - 2.2, w.y - 13, 1.6, 1.4);
      ctx.fillRect(w.x + 0.8, w.y - 13, 1.6, 1.4);
      ctx.restore();
    }
  }
}
