/* LAST NIGHT — the house is a character too.
 *
 * The tension director already schedules *threat*. This module schedules
 * everything else that makes a place feel inhabited while you are in it:
 * candlelight that dies and catches, a cat that crosses an empty room, piano
 * notes from a floor that doesn't exist anymore, a draft that tries a handle
 * nobody touched. None of it damages you. All of it keeps the ears honest —
 * a house that is alive makes every silence meaningful, and every real
 * threat arrives inside a world that was already breathing.
 *
 * The module deliberately speaks through cheap, reversible state:
 * renderer.lightMul for flicker, particles/decals for evidence, existing
 * synthesised SFX. If it is removed, nothing else breaks.
 */

import { clamp, lerp, damp, dist, rand, chance, TAU } from '../core/util.js';

export class House {
  constructor() {
    this.nextFlicker = 8;
    this.nextCat = 18;
    this.nextPiano = 34;
    this.nextDraft = 26;
    this.flicker = 0;         // 0..1 current light depression
    this.flickerTgt = 0;
    this.cat = null;          // { x, y, tx, ty, v, t, tail }
    this.drafts = [];         // visual-only handle nudges
    this.spooked = 0;         // small shared dread nudge the director may read
  }

  beginNight(game) {
    this.nextFlicker = game.time + rand(6, 14);
    this.nextCat = game.time + rand(14, 26);
    this.nextPiano = game.time + rand(30, 60);
    this.nextDraft = game.time + rand(20, 40);
    this.flicker = this.flickerTgt = 0;
    this.cat = null;
    this.drafts.length = 0;
    this.spooked = 0;
  }

  update(dt, game) {
    const t = game.time;

    // ---- candlelight flicker: the firelight guttering, not a blackout ----
    if (t > this.nextFlicker) {
      this.nextFlicker = t + rand(9, 22) / (1 + game.danger * 0.6);
      // longer, darker dips when danger is high: the house senses it too
      const depth = lerp(0.22, 0.5, game.danger);
      this.flickerTgt = rand(0.5, 1) * depth;
      game.after(rand(0.35, 1.1), () => { this.flickerTgt = 0; });
      game.audio.play('drip', { vol: 0.06, pan: rand(-0.6, 0.6) });
    }
    this.flicker = damp(this.flicker, this.flickerTgt, 7, dt);
    game.lightMul = lerp(game.lightMul ?? 1, 1 - this.flicker * 0.55, Math.min(1, dt * 10));

    // ---- the cat: crosses a room, vanishes, leaves a soft paw trail ----
    if (!this.cat && t > this.nextCat) {
      this.nextCat = t + rand(26, 64);
      const rooms = Object.values(game.mansion.rooms);
      const r = rooms[(rand(0, rooms.length)) | 0];
      const y = r.y + rand(0.2, 0.8) * r.h;
      this.cat = { x: r.x - 30, y, tx: r.x + r.w + 30, v: rand(150, 210), t: 0, flip: 1, phase: rand(0, TAU) };
      game.audio.play('stepCreak', { vol: 0.10, pan: clamp((this.cat.x - game.player.x) / 600, -1, 1) });
    }
    if (this.cat) {
      const c = this.cat;
      c.t += dt;
      c.x += Math.sign(c.tx - c.x) * c.v * dt;
      if ((rand(0, 1)) < dt * 9) {
        game.decals.splat(c.x, c.y + 5, 3, 'rgba(20,18,26,0.5)', 5);
      }
      if (chance(dt * 0.7)) game.audio.play('footstep', { vol: 0.05, x: c.x, y: c.y, cam: game.renderer.cam });
      if (Math.abs(c.x - c.tx) < 12 || c.t > 6) this.cat = null;
    }

    // ---- distant piano: three notes, wrong key, from the cellar side ----
    if (t > this.nextPiano) {
      this.nextPiano = t + rand(48, 110);
      const base = rand(0, 1) > 0.5 ? 220 : 175;   // A3 or F3, both wrong tonight
      const semis = [0, 3, 7];                     // a minor triad, fumbled
      for (let i = 0; i < 3; i++) {
        const rate = Math.pow(2, semis[i] / 12) * (base / 220);
        game.after(i * rand(0.55, 1.5), () => {
          game.audio.play('piano', { vol: 0.05 + rand(0, 0.04), rate });
        });
      }
      if (chance(0.5)) game.showMessage('SOMETHING IS PRACTISING. IT IS NOT PRACTISING WELL.', { tone: 'cold', whisper: true, life: 3.4 });
    }

    // ---- the draft: a handle turns on its own ----
    if (t > this.nextDraft) {
      this.nextDraft = t + rand(30, 70);
      const ents = game.mansion.entrances.filter((e) => !e.broken && dist(game.player.x, game.player.y, e.x, e.y) < 520);
      if (ents.length) {
        const e = ents[(rand(0, ents.length)) | 0];
        this.drafts.push({ e, t: 0 });
        game.audio.play('draft', { vol: 0.12, x: e.x, y: e.y, cam: game.renderer.cam });
        this.spooked = Math.min(1, this.spooked + 0.25);
      }
    }
    for (let i = this.drafts.length - 1; i >= 0; i--) {
      this.drafts[i].t += dt;
      if (this.drafts[i].t > 1.6) this.drafts.splice(i, 1);
    }
    this.spooked = Math.max(0, this.spooked - dt * 0.08);
  }

  /** World-space VFX pass (drawn by game.renderWorld, under the lights). */
  draw(ctx, game) {
    for (const d of this.drafts) {
      const k = Math.sin(clamp(d.t / 1.6, 0, 1) * Math.PI);
      ctx.save();
      ctx.globalAlpha = 0.5 * k;
      ctx.translate(d.e.x, d.e.y);
      ctx.rotate(Math.sin(d.t * 22) * 0.02 * k);
      ctx.strokeStyle = 'rgba(150,170,210,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-16, -3, 32, 6);
      ctx.restore();
    }
    if (this.cat) {
      const c = this.cat;
      const bob = Math.sin(c.t * 16) * 1.2;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#07070c';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + bob, 11, 4.6, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x + 10, c.y - 3 + bob, 4.4, 3.4, 0, 0, TAU);
      ctx.fill();
      // ears + tail
      ctx.beginPath();
      ctx.moveTo(c.x + 12, c.y - 5 + bob); ctx.lineTo(c.x + 14.5, c.y - 8.5 + bob); ctx.lineTo(c.x + 15.5, c.y - 4.5 + bob);
      ctx.moveTo(c.x - 10, c.y - 1 + bob);
      ctx.quadraticCurveTo(c.x - 17, c.y - 9 + Math.sin(c.t * 9) * 3, c.x - 20, c.y - 4 + bob);
      ctx.lineWidth = 2; ctx.strokeStyle = '#07070c'; ctx.stroke();
      // the one honest thing about it: eyes, only while you watch
      if (Math.abs(Math.atan2(c.y - game.player.y, c.x - game.player.x) - game.player.angle) < 0.6 && dist(game.player.x, game.player.y, c.x, c.y) < 330) {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(190,220,160,0.9)';
        ctx.fillRect(c.x + 11, c.y - 4 + bob, 1.4, 1.4);
        ctx.fillRect(c.x + 9, c.y - 4 + bob, 1.4, 1.4);
      }
      ctx.restore();
    }
  }
}
