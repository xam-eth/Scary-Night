/* LAST NIGHT — the player
 *
 * Design decision that shapes the whole game: BLOOD IS HEALTH.
 * There is no separate HP bar. Damage drains blood, hunger drains blood,
 * running and attacking drain blood. Blood only comes from being a predator
 * or from what you find in the dark. That keeps the HUD minimal and makes
 * every decision cost something.
 *
 * The vampire is drawn procedurally: dark coat, pale skin, glowing eyes,
 * one long shadow. Deliberately slight — never a superhero.
 */

import { clamp, lerp, damp, dist, TAU, rand, randInt, angDiff, approachAngle, chance, visualAngle, screenDirToWorld } from '../core/util.js';
import { PLAYER, TUNING } from '../core/config.js';
import { PAL } from '../core/render.js';
import { Valen3D } from './valen3d.js';
import { IAP } from '../shop/iap.js';

export const PSTATE = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run', ATTACK: 'attack', HURT: 'hurt',
  DEAD: 'death', DRINK: 'drink', PANIC: 'panic', CRAWL: 'crawl',
};

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2;
    this.radius = PLAYER.radius;
    this.blood = PLAYER.bloodMax;
    this.bloodMax = PLAYER.bloodMax;
    this.planks = 2;
    this.state = PSTATE.IDLE;
    this.stateT = 0;
    this.attackT = 0;
    this.attackCd = 0;
    this.attackHit = false;
    this.dashT = 0;
    this.dashCd = 0;
    this.iframes = 0;
    this.hurtT = 0;
    this.deathT = 0;
    this.stepPhase = 0;
    this.stepTimer = 0;
    this.breathe = 0;
    this.shakeT = 0;
    this.starveT = 0;
    this.drinking = 0;
    this.drinkSource = null;
    this.trail = [];
    this.lastHitBy = null;
    this.kills = 0;
    this.bloodSpent = 0;
    this.stairOffset = 0;
    this.speedMul = 1;
    this.damageMul = 1;
    this.repairMul = 1;
    this.recoveryMul = 1;
    this.blink = 0;
    this.scarAlpha = 0;
  }

  get alive() { return this.state !== PSTATE.DEAD; }
  get bloodPct() { return clamp(this.blood / this.bloodMax, 0, 1); }
  get lowBlood() { return this.blood < PLAYER.lowBlood; }
  get critBlood() { return this.blood < PLAYER.critBlood; }
  get moving() { return Math.hypot(this.vx, this.vy) > 12; }
  get speed() { return Math.hypot(this.vx, this.vy); }

  applyUpgrades(save) {
    const u = save.upgrades || {};
    this.bloodMax = PLAYER.bloodMax * (1 + (u.blood || 0) * 0.06);
    this.blood = Math.min(this.blood, this.bloodMax);
    this.speedMul = 1 + (u.speed || 0) * 0.05;
    this.repairMul = 1 + (u.repair || 0) * 0.15;
    this.damageMul = 1 + (u.damage || 0) * 0.08;
    this.recoveryMul = 1 + (u.recovery || 0) * 0.12;
  }

  /* ================= update ================= */

  update(dt, game) {
    this.stateT += dt;
    this.breathe += dt;
    if (this.blink > 0) this.blink -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;

    if (this.state === PSTATE.DEAD) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 8, dt); this.vy = damp(this.vy, 0, 8, dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      return;
    }

    const input = game.input;
    const starving = this.blood <= 0;

    // ---------- hunger ----------
    if (!TUNING.infiniteBlood) {
      const runExtra = this.state === PSTATE.RUN ? PLAYER.bloodDrainRun : 0;
      const drain = (PLAYER.bloodDrain + runExtra) * game.difficulty.bloodDrain * (starving ? 0 : 1);
      this.blood = Math.max(0, this.blood - drain * dt);
    } else this.blood = this.bloodMax;

    if (this.blood <= 0) {
      // not an instant death: a few seconds of crawling collapse, unless you
      // find blood. Blood is health, and this is what running dry means.
      this.starveT += dt;
      this.state = PSTATE.CRAWL;
      if (this.starveT > 3.2) { game.killPlayer('the hunger took you'); return; }
    } else if (this.starveT > 0) {
      this.starveT = Math.max(0, this.starveT - dt * 3);
    }

    // ---------- movement intent ----------
    // Stick and keys are screen-space. The oblique camera squashes world Y,
    // so a raw stick vector walks a different direction than the thumb pushed.
    // Convert once, here, and use that world heading for velocity, dash and aim.
    const tilt = game.renderer.tilt || 1;
    const intent = screenDirToWorld(input.move.x, input.move.y, tilt);
    let mx = intent.x * intent.mag, my = intent.y * intent.mag;
    const mag = intent.mag;
    const wantRun = input.dashDown && mag > 0.3;

    // blood-instability: the weaker you are, the more you drift
    if (this.lowBlood) {
      const wob = (1 - this.bloodPct) * (starving ? 26 : 12);
      mx += Math.sin(this.breathe * 3.1) * 0.06 * wob / 12;
      my += Math.cos(this.breathe * 2.7) * 0.06 * wob / 12;
    }

    let speed = (wantRun ? PLAYER.runSpeed : PLAYER.walkSpeed) * this.speedMul;
    if (this.state === PSTATE.DRINK) speed *= 0;
    if (this.hurtT > 0) speed *= 0.55;
    if (starving) speed *= 0.6;
    if (this.attackT > 0) speed *= 0.45;
    if (this.state === PSTATE.CRAWL) speed *= 0.5;

    // drunk/hungry instability also slows you
    if (this.lowBlood) speed *= lerp(1, 0.86, 1 - this.bloodPct);

    // ---------- dash ----------
    if (input.dashPressed && this.dashCd <= 0 && mag > 0.2 && !starving && this.blood > PLAYER.dashBlood) {
      this.dashT = PLAYER.dashTime;
      this.dashCd = PLAYER.dashCooldown;
      this.blood -= PLAYER.dashBlood;
      game.audio.play('whoosh', { vol: 0.5 });
      game.particles.burst('mist', this.x, this.y, 8, { color: 'rgba(120,90,150,0.16)', sizeMin: 8, sizeMax: 18, speedMin: 10, speedMax: 60, lifeMin: 0.3, lifeMax: 0.7 });
      this.dashDir = Math.atan2(my, mx);
    }

    let tvx, tvy;
    if (this.dashT > 0) {
      this.dashT -= dt;
      const a = this.dashDir ?? this.angle;
      tvx = Math.cos(a) * PLAYER.dashSpeed * this.speedMul;
      tvy = Math.sin(a) * PLAYER.dashSpeed * this.speedMul;
      if (chance(0.6)) {
        this.trail.push({ x: this.x, y: this.y, a: this.angle, t: 0.28 });
      }
    } else {
      tvx = mx * speed; tvy = my * speed;
    }

    const accel = this.dashT > 0 ? 30 : PLAYER.accel;
    this.vx = damp(this.vx, tvx, accel, dt);
    this.vy = damp(this.vy, tvy, accel, dt);

    // ---------- position + collision ----------
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const res = game.mansion.resolve(nx, ny, this.radius, true);
    // threshold feedback
    if (res.hit && game.mansion.threshold.some((s) =>
      nx > s.x - 20 && nx < s.x + s.w + 20 && ny > s.y - 20 && ny < s.y + s.h + 20)) {
      game.mansion.thresholdBlocked = 1;
    }
    if (res.x === nx && res.y === ny || true) { /* keep */ }
    this.x = res.x; this.y = res.y;
    // soft separation from furniture (handled in resolve)
    this.clampToBounds(game);

    // ---------- facing ----------
    // Joystick / touch owns the heading: the cursor sits on the stick, so
    // mouse-aim would glue her face to the left thumb instead of the way she
    // walks. Keyboard + mouse keeps classic aim (the cursor is a real aim).
    const stickDrive = input.stick.active || input.touchSeen;
    if (!stickDrive && input.mouse.moved && !input.touchSeen) {
      const w = game.renderer.screenToWorld(input.mouse.x, input.mouse.y);
      this.angle = Math.atan2(w.y - this.y, w.x - this.x);
    } else if (mag > 0.15) {
      const target = Math.atan2(my, mx);
      this.angle = approachAngle(this.angle, target, dt * 14);
    }
    if (this.attackT > 0) {
      // during the swing, lock facing to the swing direction
      this.angle = this.swingAngle ?? this.angle;
    }

    // ---------- footsteps ----------
    this.stepTimer -= dt;
    const sp = this.speed;
    if (sp > 20 && this.stepTimer <= 0) {
      const hz = this.locomotionHz();
      this.stepTimer = hz > 0 ? 0.5 / hz : 0.46;
      game.onPlayerStep(sp > 160 || this.dashT > 0);
    }

    // ---------- attack ----------
    // holding the button keeps the claw going: this is a light attack, and the
    // cooldown is the rate limit, so repeated input is never punished
    if ((input.attackPressed || input.attackDown) && this.attackCd <= 0 && this.state !== PSTATE.DRINK && !starving) {
      this.startAttack(game);
    }
    if (this.attackT > 0) {
      this.attackT -= dt;
      const prog = 1 - this.attackT / (PLAYER.attackWindup + PLAYER.attackActive);
      if (!this.attackHit && prog > 0.35) {
        this.attackHit = true;
        game.playerAttackHit(this);
      }
      if (this.attackT <= 0) this.state = PSTATE.IDLE;
    }
    if (this.attackCd <= 0) this.attackCd = 0;

    // ---------- drink ----------
    if (this.state === PSTATE.DRINK) {
      this.drinking += dt;
      if (this.drinking > 1.6 || !input.interactDown) {
        this.state = PSTATE.IDLE;
        if (this.drinking > 1.6) game.finishDrink(this);
        this.drinking = 0;
      }
    }

    // ---------- anim state ----------
    if (this.attackT <= 0 && this.state !== PSTATE.DRINK) {
      if (sp < 14) this.state = this.lowBlood && game.danger > 0.6 ? PSTATE.PANIC : PSTATE.IDLE;
      else if (sp > 160) this.state = PSTATE.RUN;  // v1.1: clearer threshold (walk=122, run=196, midpoint=159)
      else this.state = PSTATE.WALK;
      if (this.hurtT > 0.2) this.state = PSTATE.HURT;
    }

    // trail decay
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t -= dt;
      if (this.trail[i].t <= 0) this.trail.splice(i, 1);
    }

    // self light flickers with hunger. Readability budget: the world may be
    // dark, but the player's immediate floor must always read (industry rule:
    // atmosphere is allowed, disorientation is not). Blackout still wins, but
    // less brutally than before.
    const mul = (game.blackoutT > 0 ? 0.85 : 1) * (game.lightMul ?? 1);
    this.lightR = 172 * lerp(0.62, 1, this.bloodPct) * mul;
    this.lightI = lerp(0.40, 0.58, this.bloodPct) * mul;
  }

  clampToBounds(game) {
    const b = game.mansion.bounds;
    this.x = clamp(this.x, b.x + 20, b.x + b.w - 20);
    this.y = clamp(this.y, b.y + 20, b.y + b.h - 20);
  }

  startAttack(game) {
    this.attackT = PLAYER.attackWindup + PLAYER.attackActive;
    this.attackCd = PLAYER.attackCooldown;
    this.attackHit = false;
    this.swingAngle = this.angle;
    // Aim assist. The vampire always claws at what is in front of her; without
    // this, keyboard and touch players swing wherever they last walked, which
    // reads as the attack simply not working. Only bends toward a target that is
    // already inside the cone, so aiming still matters.
    let bestA = null, bestScore = -1;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d > PLAYER.attackRange * 1.2) continue;
      const a = Math.atan2(e.y - this.y, e.x - this.x);
      const off = Math.abs(angDiff(a, this.angle));
      if (off > PLAYER.attackArc * 0.8) continue;
      const score = (1 - off / (PLAYER.attackArc * 0.8)) + (1 - d / PLAYER.attackRange) * 0.7;
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    if (bestA !== null) { this.swingAngle = bestA; this.angle = bestA; }
    this.state = PSTATE.ATTACK;
    this.blood = Math.max(0, this.blood - PLAYER.attackCost * (this.bloodPct < 0.15 ? 0 : 1));
    this.bloodSpent += PLAYER.attackCost;
    game.audio.play('slash', { pan: 0, vol: 0.55 });
  }

  takeDamage(amount, game, fromX, fromY, kind = 'hit') {
    if (this.iframes > 0 || this.state === PSTATE.DEAD) return false;
    let dmg = amount * game.difficulty.damage;
    if (TUNING.godMode) dmg = 0;
    this.blood = Math.max(0, this.blood - dmg);
    this.iframes = PLAYER.iframes;
    this.hurtT = 0.42;
    this.state = PSTATE.HURT;
    if (fromX !== undefined) {
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      this.vx += Math.cos(a) * 150; this.vy += Math.sin(a) * 150;
    }
    game.onPlayerHurt(dmg, fromX, fromY, kind);
    return true;
  }

  heal(amount, game) {
    const before = this.blood;
    this.blood = clamp(this.blood + amount, 0, this.bloodMax);
    if (this.blood > 0 && this.starveT > 0) { this.starveT = 0; this.state = PSTATE.IDLE; }
    const gained = this.blood - before;
    if (gained > 1) game.onBloodGained(gained);
    return gained;
  }

  die(game) {
    if (this.state === PSTATE.DEAD) return;
    this.state = PSTATE.DEAD;
    this.deathT = 0;
    this.vx *= 0.3; this.vy *= 0.3;
  }

  /* ================= drawing =================
   *
   * The character IS the uploaded GLB. valen3d.js hands GLTFLoader the exact
   * bytes of new_character_glb_box_01_run_walk_c0d0d3.glb — no decoding, no
   * unpacking, no baked sprite sheet, no mesh rewrite — and Three evaluates the
   * authored skin and clips (walk / run / box_01) on a transparent WebGL stage.
   * That single frame is composited here as the upright sprite; Canvas adds
   * only world anchoring (shadow, halo, VFX), never body geometry.
   *
   * The procedural drawBody() below survives solely as the failure path: if
   * the GLB cannot load (no WebGL, dead asset server, headless harness), the
   * player is still visible. It is not the character.
   */

  draw(ctx, game) {
    const t = game.time;
    const sp = this.speed;
    const dead = this.state === PSTATE.DEAD;

    // One WebGL evaluation per frame drives the body and every afterimage.
    const attackDuration = PLAYER.attackWindup + PLAYER.attackActive;
    const attackProgress = this.attackT > 0 ? clamp(1 - this.attackT / attackDuration, 0, 1) : 0;
    this._valenFrame = Valen3D.render({
      state: dead ? PSTATE.IDLE : this.state,
      // Billboards are counter-scaled upright, so feed the projected heading
      // or she looks 15° off every diagonal she walks.
      angle: visualAngle(this.angle, game.renderer.tilt || 1),
      speed: dead ? 0 : sp,
      stepPhase: this.stepPhase,
      attackProgress,
    });

    // shadow
    ctx.save();
    ctx.globalAlpha = dead ? 0.5 : 0.42;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 8, 14 * (dead ? 1.3 : 1), 7, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // always visible: a cold rim of moonlight lifts the vampire off the floor.
    // Design rule — the player must never lose herself in the dark.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    // the weaker the vampire, the harder the rim works: panic makes the world
    // darker, but losing sight of yourself is never the intended feeling
    const need = this.lowBlood ? 1 + (1 - this.bloodPct) * 1.5 : 1;
    const halo = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, 44);
    halo.addColorStop(0, dead ? 'rgba(70,80,105,0.10)' : `rgba(150,172,215,${(0.24 * need).toFixed(3)})`);
    halo.addColorStop(0.5, `rgba(110,132,180,${(0.13 * need).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(this.x, this.y, 44, 0, TAU); ctx.fill();
    ctx.restore();

    // v1.0 (QA P1-4) — during blackouts a faint ground ring marks the feet,
    // so the upright sprite never floats without an anchor at 0% light.
    if (game.blackoutT > 0 && !dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = 'rgba(150,172,215,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(this.x, this.y + 9, 26, 10, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // dash afterimages
    for (const tr of this.trail) {
      ctx.save();
      ctx.globalAlpha = (tr.t / 0.28) * 0.28;
      ctx.translate(tr.x, tr.y);
      if (this._valenFrame) {
        this._drawValen(ctx, game, true, tr);
      } else {
        ctx.rotate(tr.a);
        ctx.fillStyle = '#3a1f3f';
        this.drawBody(ctx, game, 0, true);
      }
      ctx.restore();
    }

    if (this._valenFrame) {
      this._drawValen(ctx, game, false, null);
    } else {
      ctx.save();
      ctx.translate(this.x, this.y);
      if (dead) {
        const k = clamp(this.deathT / 1.1, 0, 1);
        ctx.rotate(visualAngle(this.angle, game.renderer.tilt || 1) + Math.PI / 2);
        ctx.rotate(k * 0.35);
        ctx.translate(0, k * 8);
        ctx.globalAlpha = clamp(1 - (this.deathT - 2.6) / 1.6, 0, 1);
      } else {
        ctx.rotate(this.angle);
      }
      if (this.iframes > 0 && !dead && Math.floor(t * 24) % 2 === 0) ctx.globalAlpha *= 0.55;
      this.drawBody(ctx, game, sp, false);
      // v1.1 — honesty rule: the procedural body is a FAILURE STATE, not the
      // character (the character is the purchased GLB, imported as-is). While
      // that asset is missing or loading, say so loudly so nobody mistakes
      // the placeholder for the real thing.
      if (!dead && Valen3D.failed || !dead && !Valen3D.ready) {
        ctx.save();
        const pulse = 0.65 + Math.sin(t * 5) * 0.3;
        ctx.globalAlpha = pulse;
        ctx.font = '700 9px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff5a4a';
        ctx.fillText(Valen3D.failed ? 'GLB FAILED TO LOAD — PLACEHOLDER' : 'LOADING GLB CHARACTER…', 0, -this.height - 16);
        ctx.restore();
      }
      ctx.restore();
    }

  }

  /**
   * Claw arc on the FLOOR, in world space (call before upright()).
   * Drawn in the same projection as movement and hit tests, so the red
   * sweep covers exactly the cone that connects — not a screen-space circle
   * that misses the thing she is facing.
   */
  drawSwing(ctx) {
    if (this.attackT <= 0) return;
    const total = PLAYER.attackWindup + PLAYER.attackActive;
    const p = 1 - this.attackT / total;
    const a = this.swingAngle;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = 'screen';
    const arcA = PLAYER.attackArc;
    const sweep = lerp(-arcA / 2, arcA / 2, p);
    const alpha = Math.sin(p * Math.PI) * 0.75;
    const g = ctx.createRadialGradient(0, 0, 18, 0, 0, PLAYER.attackRange);
    g.addColorStop(0, `rgba(255,60,80,${0.0 * alpha})`);
    g.addColorStop(0.55, `rgba(190,30,50,${0.30 * alpha})`);
    g.addColorStop(1, `rgba(255,120,140,${0.55 * alpha})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, PLAYER.attackRange, a + sweep - 0.35, a + sweep + 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,200,210,${0.5 * alpha})`;
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER.attackRange * (0.7 + i * 0.14), a + sweep - 0.3, a + sweep + 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Composite one authored GLB frame (from Valen3D.render) as the character.
   * The rig's own clips supply every pose and turn — the sprite is upright and
   * its yaw was baked in WebGL this frame; Canvas never rotates or shears the
   * body itself. `ghost` is an optional dash afterimage record.
   */
  _drawValen(ctx, game, isGhost, ghost) {
    const frame = this._valenFrame;
    if (!frame) return;
    const dead = this.state === PSTATE.DEAD;
    const crawling = this.state === PSTATE.CRAWL;
    const height = 84;   // QA P1-4: +13% — readable at 0.72× camera zoom on phones
    const footInset = 9;
    const width = height * (frame.width / frame.height);

    const x = ghost ? ghost.x : this.x;
    const y = ghost ? ghost.y : this.y;

    ctx.save();
    ctx.translate(x, y + footInset * 0.2);
    if (dead && !isGhost) {
      const k = clamp(this.deathT / 1.1, 0, 1);
      ctx.translate(0, k * 10);
      ctx.rotate(k * 0.4);
      ctx.globalAlpha = clamp(1 - (this.deathT - 2.6) / 1.6, 0, 1);
    } else if (crawling && !isGhost) {
      ctx.scale(1, 0.55);
    } else if (!isGhost) {
      // restrained condition feedback only: the breathing of a starving predator
      const panic = this.state === PSTATE.PANIC || (this.lowBlood && game.danger > 0.5);
      const breathe = 1 + Math.sin(this.breathe * (panic ? 6.2 : 1.8)) * (panic ? 0.014 : 0.006);
      ctx.scale(1, breathe);
      if (panic) ctx.translate(Math.sin(this.breathe * 43.7) * 0.5, 0);
    }
    if (this.iframes > 0 && !dead && !isGhost && Math.floor(game.time * 24) % 2 === 0) ctx.globalAlpha *= 0.55;
    // Cosmetic coat tints (Blood Market) are COMPOSITING only — a filter over
    // the rendered frame. The GLB asset, its textures and its clips stay
    // byte-identical forever; the model is never re-shaded or re-exported.
    const coatId = IAP.equippedCoat(game.save);
    const filter = coatId === 'coat_bloodmoon' ? 'hue-rotate(-22deg) saturate(1.7) brightness(0.96)'
      : coatId === 'coat_moonsilver' ? 'saturate(0.35) brightness(1.28) hue-rotate(18deg)' : null;
    if (filter) { ctx.save(); ctx.filter = filter; }
    Valen3D.draw(ctx, frame, height, { alpha: isGhost ? 0.5 : 1, footInset });
    if (filter) ctx.restore();
    if (coatId && !isGhost) {
      const blood = coatId === 'coat_bloodmoon';
      ctx.save();
      ctx.globalAlpha = dead ? 0.45 : 0.9;
      ctx.fillStyle = blood ? 'rgba(122, 12, 22, 0.82)' : 'rgba(214, 224, 236, 0.78)';
      ctx.beginPath();
      ctx.moveTo(-18, -6);
      ctx.lineTo(18, -6);
      ctx.lineTo(26, 8);
      ctx.lineTo(-26, 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = blood ? 'rgba(255, 64, 48, 0.85)' : 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = blood ? 'rgba(160, 20, 28, 0.7)' : 'rgba(230, 236, 246, 0.7)';
      ctx.fillRect(-12, -height * 0.58, 24, 7);
      ctx.restore();
    }
    
    // v1.1 debug: small indicator that GLB is active (only in dev/debug builds)
    if (!isGhost && !dead && typeof window !== 'undefined' && window.__LN_DEBUG) {
      ctx.save();
      ctx.font = '8px monospace';
      ctx.fillStyle = '#0f0';
      ctx.globalAlpha = 0.6;
      ctx.fillText('GLB', -width/2 + 2, -height + 10);
      ctx.restore();
    }

    // The burning eyes — the design tell from the 2D pass, preserved on top of
    // the GLB: they are Canvas light, not a repaint of the model. Head bone
    // projection keeps them welded to the animated skull at any yaw.
    // (Local space here: the context is already translated to the feet.)
    if (!isGhost && !dead && !crawling && this.lowBlood) {
      const head = Valen3D.screenPoint('mixamorig:Head');
      let hx = 0, hy = -height * 0.74 + footInset;
      if (head) {
        hx = (head.x / frame.width - 0.5) * width;
        hy = -height + footInset + (head.y / frame.height) * height;
      }
      const glow = 0.5 + (1 - this.bloodPct) * 0.7;
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
      g.addColorStop(0, `rgba(255,80,64,${(0.34 * glow).toFixed(3)})`);
      g.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy, 16, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // hurt flash: a screen-blended wash over the body, drawn in world space
    if (!isGhost && this.hurtT > 0.02) {
      const hurt = clamp(this.hurtT / 0.42, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = hurt * 0.55;
      ctx.fillStyle = '#ff3040';
      ctx.beginPath();
      ctx.ellipse(x, y - height * 0.38, width * 0.34, height * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Fallback body — only reached when the GLB failed to load. */
  drawBody(ctx, game, sp, isGhost) {
    const t = game.time;
    const st = this.state;
    const running = st === PSTATE.RUN;
    const walking = st === PSTATE.WALK || sp > 14;
    const cycle = this.stepPhase;
    const bob = walking ? Math.sin(cycle) * 1.6 : Math.sin(this.breathe * 1.6) * 0.9;
    const lean = running ? 3.2 : 1.4;
    const attackP = st === PSTATE.ATTACK ? clamp(1 - this.attackT / (PLAYER.attackWindup + PLAYER.attackActive), 0, 1) : 0;
    const hurt = clamp(this.hurtT / 0.42, 0, 1);
    const panic = st === PSTATE.PANIC || (this.lowBlood && game.danger > 0.5);
    const dying = st === PSTATE.DEAD;

    // scale up a little: the vampire must always be readable at a glance
    ctx.scale(1.3, 1.3);

    const coat = '#0f1017';
    const coatEdge = '#1d1f2b';
    const lining = '#4d0f1c';
    const skin = '#ded4c6';

    ctx.save();
    ctx.translate(lean * 0.5, bob);

    // ---- coat tails (behind) ----
    const sway = walking ? Math.sin(cycle * 0.5) * 3 : Math.sin(t * 1.1) * 1.6;
    ctx.fillStyle = coat;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      const spread = running ? 7 : 4.6;
      ctx.moveTo(-3, side * 4.5);
      ctx.quadraticCurveTo(-15 - spread, side * (7 + spread * 0.7) + sway * side, -26 - spread * 1.4, side * (9 + spread) + sway * side * 1.4);
      ctx.quadraticCurveTo(-14, side * 6, -2, side * 1.5);
      ctx.closePath();
      ctx.fill();
    }
    // lining flash
    ctx.strokeStyle = lining;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-4, -5.4); ctx.quadraticCurveTo(-18, -9 + sway, -28, -13 + sway);
    ctx.moveTo(-4, 5.4); ctx.quadraticCurveTo(-18, 9 - sway, -28, 13 - sway);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ---- legs ----
    const legSwing = walking || running ? Math.sin(cycle) * (running ? 7 : 4.5) : 0;
    ctx.strokeStyle = '#0b0c12'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-1, -3.4); ctx.lineTo(-1 + legSwing, -5.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1, 3.4); ctx.lineTo(-1 - legSwing, 5.2); ctx.stroke();

    // ---- torso ----
    const torso = ctx.createLinearGradient(-8, 0, 6, 0);
    torso.addColorStop(0, '#0a0b11'); torso.addColorStop(0.6, coatEdge); torso.addColorStop(1, coat);
    ctx.fillStyle = torso;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 9.5, 7 + (panic ? 0.6 : 0), 0, 0, TAU);
    ctx.fill();
    // shoulders / collar catch the light
    ctx.strokeStyle = 'rgba(150,160,190,0.16)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(-1, 0, 9.2, -1.9, -0.5); ctx.stroke();
    // blood-red sash
    ctx.strokeStyle = lining; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -6.2); ctx.lineTo(-5, 6.2); ctx.stroke();

    // ---- arms ----
    const armP = attackP;
    ctx.strokeStyle = coatEdge; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    const armSwing = walking ? Math.sin(cycle + Math.PI) * (running ? 5 : 3) : 0;
    // back arm
    ctx.beginPath();
    ctx.moveTo(-1, 5);
    ctx.lineTo(2 + armSwing * 0.6, 8.5);
    ctx.stroke();
    // front arm (reaches on attack)
    const reach = 12 + armP * 20;
    const arA = -0.5 + armP * 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(Math.cos(arA) * reach * 0.55, -4.5 + Math.sin(arA) * reach * 0.5);
    ctx.lineTo(Math.cos(arA * 0.85) * reach, -4.5 + Math.sin(arA * 0.85) * reach * 0.8);
    ctx.stroke();
    // pale hand
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(Math.cos(arA * 0.85) * reach, -4.5 + Math.sin(arA * 0.85) * reach * 0.8, 2.1, 0, TAU);
    ctx.fill();
    // claws glint mid-swing
    if (armP > 0.3 && armP < 0.8) {
      ctx.strokeStyle = 'rgba(255,235,235,0.85)'; ctx.lineWidth = 1;
      const hx = Math.cos(arA * 0.85) * reach, hy = -4.5 + Math.sin(arA * 0.85) * reach * 0.8;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + Math.cos(arA + i * 0.5) * 6, hy + Math.sin(arA + i * 0.5) * 6);
        ctx.stroke();
      }
    }

    // ---- head ----
    ctx.save();
    ctx.translate(4.2, 0);
    // hair (long, dark, moving)
    ctx.fillStyle = '#08080c';
    ctx.beginPath();
    ctx.moveTo(-5, -4.6);
    ctx.quadraticCurveTo(-12, -1 + sway * 0.5, -13, 2.5 + sway * 0.7);
    ctx.quadraticCurveTo(-7, 1.5, -5.5, 4.4);
    ctx.quadraticCurveTo(-9, 0, -5, -4.6);
    ctx.fill();
    // face
    const faceG = ctx.createLinearGradient(-4, 0, 5, 0);
    faceG.addColorStop(0, '#b9b0a4'); faceG.addColorStop(1, skin);
    ctx.fillStyle = faceG;
    ctx.beginPath(); ctx.ellipse(0, 0, 4.6, 4.2, 0, 0, TAU); ctx.fill();
    // hair over the forehead
    ctx.fillStyle = '#0a0a0f';
    ctx.beginPath();
    ctx.moveTo(-4.6, -1.5);
    ctx.quadraticCurveTo(-1, -6.4, 4.2, -2.6);
    ctx.quadraticCurveTo(0, -3.6, -4.6, -1.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4.4, 1.6);
    ctx.quadraticCurveTo(-2, 5.4, 2.6, 3.4);
    ctx.quadraticCurveTo(-1, 3.6, -4.4, 1.6);
    ctx.fill();
    // eyes: the tell. They burn brighter when hungry.
    if (!dying) {
      const glow = 0.5 + (1 - this.bloodPct) * 0.7 + (panic ? 0.3 : 0);
      const blink = this.blink > 0 ? 0.15 : 1;
      ctx.globalCompositeOperation = 'screen';
      for (const side of [-1, 1]) {
        const ex = 1.6, ey = side * 1.4;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 5.5 * glow);
        g.addColorStop(0, `rgba(255,${70 + (1 - this.bloodPct) * 30 | 0},60,${0.95 * glow})`);
        g.addColorStop(1, 'rgba(120,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ex, ey, 5.5 * glow, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffdede';
      for (const side of [-1, 1]) ctx.fillRect(1.2, side * 1.4 - 0.6 * blink, 1.5, 1.2 * blink);
    }
    // fangs on attack / drink
    if (armP > 0.1 || st === PSTATE.DRINK) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(3.4, -0.9); ctx.lineTo(4.9, -0.4); ctx.lineTo(3.6, 0.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(3.4, 0.9); ctx.lineTo(4.9, 0.4); ctx.lineTo(3.6, -0.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // hurt flash
    if (hurt > 0.02 && !isGhost) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = hurt * 0.7;
      ctx.fillStyle = '#ff3040';
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 12, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /**
   * Second composite pass for the GLB frame, AFTER the world lightmap:
   * 'screen'-blended moonlight that rides the character itself, so she is
   * never a hole in the dark even in the worst blackout. This reads the
   * rendered frame — the model asset remains byte-identical.
   */
  drawAfterDark(ctx, game) {
    const frame = this._valenFrame;
    if (!frame || this.state === PSTATE.DEAD) return;
    ctx.save();
    // The body was drawn upright, then the night multiply darkened it. This
    // pass has to use the same counter-scale or the moonlight misses her and
    // paints a squashed smear at her feet.
    if (game.renderer.upright) game.renderer.upright(ctx, this.x, this.y);
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = 'screen';
    const need = (this.lowBlood ? 0.46 : 0.32) * (game.blackoutT > 0 ? 0.72 : 1);
    ctx.globalAlpha = need;
    Valen3D.draw(ctx, frame, 84, { alpha: 1, footInset: 9 });
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(186, 206, 235, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 11, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Full clip cycles per second. One turn of stepPhase is one GLB loop.
   * The walk clip is a slow 2.33s cycle; the old rate (6 + speed*0.045)
   * played it at about 4×, so walking looked like running in place.
   */
  locomotionHz() {
    const sp = this.speed;
    if (sp <= 14) return 0;
    const running = sp > 160 || this.dashT > 0;
    // Root travel of one cycle, in screen pixels at the billboard scale.
    const stride = running ? 200 : 112;
    return clamp(sp / stride, 0.32, running ? 1.35 : 1.15);
  }

  /** Advance the walk cycle. Called from the game loop with the frame dt. */
  anim(dt) {
    const hz = this.locomotionHz();
    if (hz > 0) this.stepPhase += dt * hz * TAU;
    else this.stepPhase += dt * 0.35;
    if (this.blink <= 0 && chance(0.004)) this.blink = 0.12;
  }

  /** The light the player carries (vampire senses). */
  submitLight(renderer, game) {
    const r = this.lightR ?? 150;
    // cold inner light so the player is never lost in the dark
    renderer.addLight(this.x, this.y, r, this.lightI ?? 0.4, [190, 205, 235]);
    // faint warm pool right under the vampire (reads as "presence")
    renderer.addLight(this.x, this.y, r * 0.42, 0.22, [255, 170, 140]);
    // wide soft ring: keeps the room readable at the edge of her world.
    // Horror lives in the periphery beyond THIS ring, not in total black.
    renderer.addLight(this.x, this.y, r * 2.1, 0.10, [150, 165, 205]);
  }
}
