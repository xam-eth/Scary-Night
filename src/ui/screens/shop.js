/* DUSKHOLD — The shard shop screen — UI only; purchase logic stays in src/shop/iap.js (Phase 3 split of ui/screens.js). */

import { clamp } from '../../core/util.js';
import { unlocked } from '../../game/sim/economy.js';
import { IAP, CATALOG } from '../../shop/iap.js';
import { Ads } from '../../shop/ads.js';
import { SERIF, SANS, MONO, isPhone, fitType, uiButton, buttonVisual, drawBrandPlate } from './shared.js';

/* ================= the Blood Market (IAP) — src/shop/iap.js =================
 * Catalog policy lives in iap.js; this screen is only its face. Every card
 * states plainly what it is, every item is also shard-buyable, the sandbox
 * mark (⌁) tells beta testers no real money moves. Ads are off until a
 * provider is configured; money never buys a claw.
 */
export function drawShop(game, ctx, w, h) {
  const back = game.settingsReturn || 'menu';
  const B = game.save;
  ctx.save();
  drawBrandPlate(ctx, w, h, { dim: 0.84 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const phone = isPhone(w, h);
  fitType(ctx, 'BLOOD MARKET', w - 32, phone ? 22 : clamp(w * 0.03, 22, 32), SERIF, 400);
  ctx.fillStyle = '#e8e0cc';
  ctx.fillText('BLOOD MARKET', w / 2, phone ? 28 : h * 0.075);
  fitType(ctx, `◆ ${B.shards}`, w - 32, phone ? 12 : 13, MONO, 400);
  ctx.fillStyle = 'rgba(200,160,74,0.95)';
  const relicBit = unlocked(B, 'relics') ? `   ·   ✦ ${B.relics || 0}` : '';
  const purse = phone
    ? `◆ ${B.shards}${relicBit}`
    : `◆ ${B.shards} EARNED${relicBit}   ·   MERCY ${(B.iap && B.iap.revives) | 0}   ·   NOTHING HERE CHANGES THE CLAW`;
  ctx.fillText(purse, w / 2, phone ? 48 : h * 0.125);
  // v1.0 — the daily rewarded crate (opt-in, capped, invisible when no ad
  // network is configured). AdMob SSV is required before real keys: docs/IAP.md.
  if (Ads.isAvailable('crate')) {
    const aw = Math.min(260, w * 0.42), ah = 30;
    const ar = uiButton(game, { x: w / 2 - aw / 2, y: h * 0.155, w: aw, h: ah, label: Ads.label('crate'), onClick: () => game.requestAdCrate(), small: true, accent: '#6a2230' });
    buttonVisual(ctx, ar.b, { active: ar.hover, label: Ads.label('crate'), small: true, accent: '#6a2230' });
  }
  ctx.restore();

  const wide = !phone && w >= 980 && h >= 640;
  const cols = wide ? 2 : 1;
  const gap = phone ? 8 : 12;
  const padX = phone ? 12 : (wide ? 60 : 24);
  const cardW = (w - padX * 2 - gap * (cols - 1)) / cols;
  const shown = CATALOG.filter((sku) => sku.kind !== 'remove_ads' || unlocked(B, 'ads'));
  const rows = Math.ceil(shown.length / cols);
  const gridTop = phone ? 62 : h * 0.175;
  const footY = h - (phone ? 58 : (wide ? 76 : 62));
  const cardH = clamp((footY - gridTop - gap * (rows - 1)) / rows, phone ? 64 : 72, phone ? 128 : 108);
  let cy = gridTop;
  let cx = padX;
  const iapBag = (B.iap && B.iap.owned) || {};

  shown.forEach((sku) => {
    if (wide && cx > padX) { /* keep */ }
    const ownId = Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned;
    const isOwned = !!(ownId && iapBag[ownId]);
    const open = IAP.offered(B, sku);
    const wearing = IAP.equippedCoat(B) === sku.id;
    // card body
    ctx.save();
    ctx.fillStyle = isOwned ? 'rgba(20,22,30,0.5)' : 'rgba(14,14,20,0.72)';
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeStyle = wearing ? 'rgba(200,160,74,0.7)' : 'rgba(90,88,110,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cardW - 1, cardH - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `500 15px ${SERIF}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = '#e6dcc4';
    const tight = cardH < 84;
    ctx.fillText(sku.name, cx + 14, cy + (tight ? 20 : 24));
    ctx.font = `400 11px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.4px';
    ctx.fillStyle = 'rgba(178,172,160,0.75)';
    const showBuy = open && !(isOwned && sku.play !== 'consumable');
    const stackBtns = cardH >= 96;
    const blurbMax = stackBtns ? cardW - 28 : cardW - 168;
    let blurb = open ? sku.blurb : sku.locked;
    while (ctx.measureText(blurb).width > blurbMax && blurb.length > 8) blurb = blurb.slice(0, -2);
    if (blurb !== sku.blurb) blurb = blurb.replace(/[,.;]$/, '') + '…';
    if (!tight) ctx.fillText(blurb, cx + 14, cy + 44);
    ctx.font = `400 11px ${MONO}`;
    ctx.fillStyle = 'rgba(150,146,136,0.6)';
    const foot = !open ? 'NOT YET — PLAY THE NIGHT'
      : isOwned && sku.kind === 'title' ? 'THE HOUSE ALREADY KNOWS THE NAME'
      : isOwned ? (wearing ? 'WORN' : 'YOURS — NOT WORN')
      : `${IAP.priceLabel(sku)}   or   ◆${sku.shardPrice}`;
    if (!tight) ctx.fillText(foot, cx + 14, cy + 62);
    ctx.restore();
    // actions
    if (showBuy) {
      const bh2 = tight ? 28 : 36;
      const bw2 = stackBtns ? (cardW - 28) / 2 : Math.min(108, (cardW - 36) / 2);
      const by2 = cy + cardH - bh2 - (tight ? 4 : 8);
      const x1 = stackBtns ? cx + 10 : cx + cardW - bw2 * 2 - 16;
      const x2 = stackBtns ? cx + 14 + bw2 : cx + cardW - bw2 - 8;
      const busy = IAP.busy === sku.id;
      const pay = IAP.mode === 'native' ? 'PLAY' : IAP.mode === 'midtrans' ? 'PAY' : 'STORE';
      const r1 = uiButton(game, {
        x: x1, y: by2, w: bw2, h: bh2,
        label: busy ? '…' : pay, small: true, disabled: busy || IAP.mode === 'disabled',
        onClick: () => game.purchaseSku(sku.id),
      });
      buttonVisual(ctx, r1.b, { active: r1.hover || r1.selected, label: busy ? '…' : pay, small: true, accent: '#6a6a80' });
      const useRelic = !sku.shardPrice && sku.relicPrice;
      const canShard = sku.shardPrice && B.shards >= sku.shardPrice;
      const canRelic = sku.relicPrice && (B.relics || 0) >= sku.relicPrice;
      const r2 = uiButton(game, {
        x: x2, y: by2, w: bw2, h: bh2,
        label: useRelic ? '✦ RELIC' : '◆ SHARDS', small: true, disabled: useRelic ? !canRelic : !canShard,
        onClick: () => (useRelic ? game.buySkuWithRelics(sku.id) : game.buySkuWithShards(sku.id)),
      });
      buttonVisual(ctx, r2.b, { active: r2.hover || r2.selected, label: useRelic ? '✦ RELIC' : '◆ SHARDS', small: true, accent: '#6a6a80', disabled: useRelic ? !canRelic : !canShard });
    } else if (open && sku.kind === 'cosmetic' && isOwned) {
      const bw2 = cardW - 20, bh2 = tight ? 28 : 36;
      const label = wearing ? 'TAKE OFF' : 'WEAR';
      const r = uiButton(game, {
        x: cx + 10,
        y: cy + cardH - bh2 - (tight ? 4 : 8),
        w: bw2, h: bh2,
        label, small: true, onClick: () => game.wearCoat(sku.id),
      });
      buttonVisual(ctx, r.b, { active: r.hover, label, small: true, accent: wearing ? '#6a6a80' : '#a8833c' });
    }
    cx += cardW + gap;
    if (cx + cardW > w - padX / 2) { cx = padX; cy += cardH + gap; }
  });

  // policy line + actions — pinned above the buttons, never on top of cards
  const rowsEnd = cx === padX ? cy : cy + cardH;
  const policyY = Math.min(rowsEnd + 26, h - (wide ? 96 : 88));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `400 10px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
  ctx.fillStyle = 'rgba(140,134,124,0.55)';
  const adsLine = Ads.provider() === 'none'
    ? 'ADS ARE OFF HERE · IF THEY RETURN THEY ARE OPT-IN, NEVER FORCED'
    : 'REWARDED ADS ARE OPT-IN AND HARD-CAPPED · NEVER FORCED';
  const policy = ['SHARDS ARE EARNED BY THE NIGHT · MONEY BUYS RELIEF AND IDENTITY · NEVER POWER',
    adsLine,
    IAP.mode === 'native' ? 'GOOGLE PLAY BILLING · THE GAME GRANTS ONLY AFTER CONSUME OR ACKNOWLEDGE'
      : IAP.mode === 'midtrans' ? 'WEB RAIL · RELIEF AND IDENTITY ONLY · THE SERVER CONFIRMS SETTLEMENT'
      : IAP.mode === 'sandbox' ? 'SANDBOX — NO REAL MONEY MOVES'
      : 'STORE OFFLINE'];
  const pLines = wide ? policy : [policy[0].split(' · ').slice(0, 3).join(' · '), policy[1]];
  pLines.forEach((line, i) => ctx.fillText(line, w / 2, policyY + i * 16));
  ctx.restore();

  const restoreLabel = wide ? 'RESTORE PURCHASES' : 'RESTORE';
  const backLabel = wide ? 'BACK TO THE HOUSE' : 'BACK';
  const bw = phone ? (w - 36) / 2 : (wide ? 224 : Math.min(160, w * 0.4));
  const bh = phone ? 42 : (wide ? 42 : 34);
  const r3 = uiButton(game, { x: phone ? 12 : w / 2 - bw - 8, y: h - (phone ? 50 : (wide ? 66 : 52)), w: bw, h: bh, label: restoreLabel, onClick: () => game.restorePurchases(), small: true, accent: '#6a6a80' });
  buttonVisual(ctx, r3.b, { active: r3.hover || r3.selected, label: restoreLabel, small: true, accent: '#6a6a80' });
  const r4 = uiButton(game, { x: phone ? 20 + bw : w / 2 + 8, y: h - (phone ? 50 : (wide ? 66 : 52)), w: bw, h: bh, label: backLabel, onClick: () => game.setScreen(back, 'shop'), small: true, accent: '#a8833c' });
  buttonVisual(ctx, r4.b, { active: r4.hover || r4.selected, label: backLabel, small: true, accent: '#a8833c' });
}

/* ============================================================
 * THE PEAKS (src/game/climax.js)
 *
 * Drawn over the world, never as a menu: the crescendo, the frenzy, the duel
 * and the dawnbreak are part of the night. Everything here has to read in a
 * 2–3 second 9:16 clip with the sound off, at phone width and in short
 * landscape, which is why it is one word, one bar, one silhouette — never a
 * paragraph. No debug text, ever: these frames are the ad.
 * ============================================================ */

