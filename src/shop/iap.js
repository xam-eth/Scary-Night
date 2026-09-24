/* LAST NIGHT — what money may buy.
 *
 * The night is the product. Dopamine belongs to the knock, the barricade,
 * the feed, and the dawn — not to a shop button. Money is optional, never
 * required, and never sold before the player has done the thing the item
 * remembers.
 *
 * Sold, and only these:
 *  - SECOND BLOOD: one mercy the player chooses to spend after dying.
 *    Same night, same danger, once. Not auto-used. Not a pack.
 *  - BLOODMOON COAT: visible hem, after the player has bled. No stats.
 *  - MOONSILVER COAT: visible hem, after the player has seen dawn. No stats.
 *  - DAWNBREAKER: the house says the name at dawn. No shards, no power.
 *
 * Not sold: shard packs, stat upgrades, plank pouches, revive bundles,
 * loot boxes, timers, "best value" pressure. Shards stay earned.
 *
 * Google Play Billing (window.LNBridge) is the only rail for a Play build.
 * Consumables must be consumeAsync'd, non-consumables acknowledgePurchase'd,
 * and the game grants only after that flag comes back. A bare {ok:true}
 * is not a purchase. Web uses Midtrans for the same four goods.
 *
 * ─── THE IMPLEMENTATION ────────────────────────────────────────────────────
 * Provider abstraction so the web build ships today and native stores bolt
 * on later without touching gameplay:
 *   - SandboxProvider: local ledger, simulated latency, deterministic
 *     success; failure modes toggleable for QA (IAP.debug.failMode).
 *   - NativeProvider: postMessage bridge contract documented below; if no
 *     native host exists, it reports 'bridge-unavailable' and the UI shows
 *     store links instead of buy buttons.
 *
 * Native bridge contract (host app implements):
 *   window.LNBridge.postMessage(JSON.stringify({type:'purchase'|'restore',
 *     sku, requestId}))  →  host calls window.__LN_IAP_result(requestId,
 *     {ok, receipt, error}) after the store sheet resolves.
 */

import { SHOP_CONFIG, IDR } from './config.js';

export const IAP_ENABLED = true;          // web: Midtrans. Play: LNBridge wins in init()
export const SANDBOX_LATENCY_MS = 900;

/* ---------------- catalog ---------------- */
export const CATALOG = [
  {
    id: 'revive1', name: 'SECOND BLOOD', kind: 'consumable', play: 'consumable',
    priceUsd: 1.99, priceIdr: 19000, shardPrice: 150,
    gives: { revives: 1 }, needs: 'died',
    blurb: 'One mercy you choose to spend. Same night. Same danger. Once.',
    locked: 'Die once. Mercy means nothing before that.',
  },
  {
    id: 'coat_bloodmoon', name: 'BLOODMOON COAT', kind: 'cosmetic', play: 'nonconsumable',
    priceUsd: 1.99, priceIdr: 29000, shardPrice: 180,
    gives: { owned: 'coat_bloodmoon' }, needs: 'bled',
    blurb: 'The red hem of a wound you already took. No stronger claw.',
    locked: 'Bleed once. Then the coat is a memory, not a costume.',
  },
  {
    id: 'coat_moonsilver', name: 'MOONSILVER COAT', kind: 'cosmetic', play: 'nonconsumable',
    priceUsd: 1.99, priceIdr: 29000, shardPrice: 180,
    gives: { owned: 'coat_moonsilver' }, needs: 'dawned',
    blurb: 'Pale wool for a morning you already reached. No stats.',
    locked: 'See dawn. Then the wool is yours to wear.',
  },
  {
    id: 'dawnbreaker', name: 'DAWNBREAKER', kind: 'title', play: 'nonconsumable',
    priceUsd: 4.99, priceIdr: 79000, shardPrice: 400,
    gives: { owned: 'title_dawnbreaker' }, needs: 'dawned',
    blurb: 'The house says your name at dawn. Nothing else.',
    locked: 'Stay until morning. A name you have not earned is only a label.',
  },
];

const findSku = (id) => CATALOG.find((c) => c.id === id) || null;

/* ---------------- providers ---------------- */

class SandboxProvider {
  constructor() { this.key = 'lastnight.iap.sandbox.v1'; this.failMode = null; }
  async purchase(sku) {
    const ledger = this._load();
    await new Promise((r) => setTimeout(r, SANDBOX_LATENCY_MS));
    if (this.failMode === 'deny') return { ok: false, error: 'user-cancelled' };
    if (this.failMode === 'network') return { ok: false, error: 'network' };
    const rec = { sku, at: Date.now(), receipt: 'SBX-' + Math.random().toString(36).slice(2, 10) };
    ledger.push(rec);
    this._save(ledger);
    return { ok: true, receipt: rec.receipt };
  }
  async restore() { return { ok: true, ledger: this._load() }; }
  _load() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; } }
  _save(l) { try { localStorage.setItem(this.key, JSON.stringify(l)); } catch (e) { /* quota */ } }
}

class NativeProvider {
  constructor() { this.pending = new Map(); this.seq = 0; }
  get available() { return typeof window !== 'undefined' && !!(window.LNBridge && window.LNBridge.postMessage); }
  async purchase(sku) {
    if (!this.available) return { ok: false, error: 'bridge-unavailable' };
    const requestId = 'req-' + (++this.seq);
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      const item = findSku(sku);
      window.LNBridge.postMessage(JSON.stringify({
        type: 'purchase',
        sku,
        productType: item && item.play === 'consumable' ? 'consumable' : 'nonconsumable',
        requestId,
      }));
      setTimeout(() => {
        if (this.pending.has(requestId)) { this.pending.delete(requestId); resolve({ ok: false, error: 'timeout' }); }
      }, 120000);
    });
  }
  async restore() {
    if (!this.available) return { ok: false, error: 'bridge-unavailable' };
    const requestId = 'req-' + (++this.seq);
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      window.LNBridge.postMessage(JSON.stringify({ type: 'restore', requestId }));
      setTimeout(() => {
        if (this.pending.has(requestId)) { this.pending.delete(requestId); resolve({ ok: false, error: 'timeout' }); }
      }, 30000);
    });
  }
  install() {
    if (typeof window === 'undefined') return;
    window.__LN_IAP_result = (requestId, result) => {
      const cb = this.pending.get(requestId);
      if (cb) { this.pending.delete(requestId); cb(result || { ok: false, error: 'malformed' }); }
    };
  }
}

/* Midtrans (Indonesian gateway) — Snap web payments.
 * The client NEVER holds the server key. Flow (docs/IAP.md):
 *   1. POST {serverBase}/order   { sku, playerId } → { transactionId, token }
 *      (your server creates the Snap transaction with the SERVER key)
 *   2. load snapScript?clientKey=… once, then window.snap.pay(token)
 *      (Midtrans renders the payment sheet: VA / QRIS / GOPAY /…)
 *   3. POST {serverBase}/verify  { transactionId } → settlement status
 *   4. async: Midtrans → {serverBase}/callback (x-signature, SERVER key) —
 *      the ledger of record. If the client verify races ahead of the callback,
 *      the game shows "PENDING" and grants on the next poll/restore.
 * If any step is unreachable, purchase() fails clean and the UI falls back to
 * the shard lane — the night never waits on a payment rail.
 */
class MidtransProvider {
  constructor(cfg) {
    this.cfg = cfg;
    this.snapPromise = null;
    this._id = null;   // created on the first payment, never at boot
  }
  get playerId() { return this._id || (this._id = this._playerId()); }
  get available() { return !!(this.cfg.enabled && this.cfg.clientKey); }
  _playerId() {
    try {
      let id = localStorage.getItem('lastnight.playerId');
      if (!id) { id = 'LN-' + Math.random().toString(36).slice(2, 10).toUpperCase(); localStorage.setItem('lastnight.playerId', id); }
      return id;
    } catch (e) { return 'LN-WEB'; }
  }
  _loadSnap() {
    if (this.snapPromise) return this.snapPromise;
    this.snapPromise = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(new Error('no-dom'));
      if (window.snap) return resolve();
      const s = document.createElement('script');
      s.src = `${this.cfg.snapScript}?clientKey=${encodeURIComponent(this.cfg.clientKey)}`;
      s.onload = () => resolve();
      s.onerror = () => { this.snapPromise = null; reject(new Error('snap-unreachable')); };
      document.head.appendChild(s);
    });
    return this.snapPromise;
  }
  async _json(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('server-' + res.status);
    return res.json();
  }
  async purchase(sku) {
    if (!this.available) return { ok: false, error: 'midtrans-unconfigured' };
    try {
      const order = await this._json(this.cfg.serverBase + '/order', { sku, playerId: this.playerId, amount: sku.priceIdr, currency: 'IDR' });
      await this._loadSnap();
      const outcome = await new Promise((resolve) => {
        window.snap.pay(order.token, {
          onSuccess: () => resolve('settlement'),
          onPending: () => resolve('pending'),
          onError: () => resolve('error'),
          onClose: () => resolve('cancel'),
        });
      });
      if (outcome === 'cancel') return { ok: false, error: 'user-cancelled' };
      if (outcome === 'error') return { ok: false, error: 'payment-failed' };
      const v = await this._json(this.cfg.serverBase + '/verify', { transactionId: order.transactionId });
      if (v.status === 'pending') return { ok: false, error: 'pending — the market remembers; restore will settle it', pending: true };
      if (!v.settled) return { ok: false, error: 'unverified' };
      return { ok: true, receipt: v.receipt || order.transactionId };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }
  async restore() {
    if (!this.available) return { ok: false, error: 'midtrans-unconfigured' };
    try {
      const l = await this._json(this.cfg.serverBase + '/ledger', { playerId: this.playerId });
      return { ok: true, ledger: l.ledger || [] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }
}

/* ---------------- core module ---------------- */

export const IAP = {
  mode: 'sandbox',        // 'sandbox' | 'native' | 'disabled'
  provider: null,
  busy: null,             // sku currently being purchased (UI spinner)
  lastError: null,
  debug: { failMode: null },

  init() {
    if (!IAP_ENABLED) { this.mode = 'disabled'; return this; }
    const native = new NativeProvider();
    if (native.available) { this.mode = 'native'; this.provider = native; native.install(); return this; }
    const mid = new MidtransProvider(SHOP_CONFIG.midtrans);
    if (SHOP_CONFIG.provider === 'midtrans' && mid.available) { this.mode = 'midtrans'; this.provider = mid; return this; }
    this.mode = 'sandbox'; this.provider = new SandboxProvider();
    return this;
  },

  sku(id) { return findSku(id); },

  /** The parts of save that IAP owns; created on demand for old saves. */
  _bag(save) {
    if (!save.iap) save.iap = { owned: {}, revives: 0, pouches: 0 };
    const i = save.iap;
    i.owned = i.owned || {};
    i.revives = Math.max(0, i.revives | 0);
    i.pouches = Math.max(0, i.pouches | 0);
    return i;
  },

  offered(save, id) {
    const sku = typeof id === 'string' ? findSku(id) : id;
    if (!sku || !sku.needs) return !!sku;
    return !!(save && save.deeds && save.deeds[sku.needs]);
  },

  grant(save, sku) {
    const bag = this._bag(save);
    const g = sku.gives || {};
    if (g.shards) { save.shards += g.shards; save.totalShards = (save.totalShards || 0) + g.shards; }
    if (g.revives) bag.revives = Math.min(2, bag.revives + g.revives);
    if (g.pouches) bag.pouches = Math.min(9, bag.pouches + g.pouches);
    const owns = Array.isArray(g.owned) ? g.owned : [g.owned].filter(Boolean);
    for (const o of owns) bag.owned[o] = true;
    const coat = owns.find((o) => o === 'coat_bloodmoon' || o === 'coat_moonsilver');
    if (coat && !bag.equipped) bag.equipped = coat;
  },

  rememberReceipt(save, receipt) {
    if (!receipt) return;
    const bag = this._bag(save);
    bag.receipts = bag.receipts || [];
    if (!bag.receipts.includes(receipt)) bag.receipts.push(receipt);
  },

  /** Spend shards instead of money (the F2P lane). */
  buyWithShards(save, id) {
    const sku = findSku(id);
    if (!sku || !sku.shardPrice) return { ok: false, error: 'no-shard-price' };
    if (!this.offered(save, sku)) return { ok: false, error: 'not-yet' };
    const ownId = Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned;
    if (sku.play !== 'consumable' && ownId && this.owns(save, ownId)) {
      return { ok: false, error: 'already-yours' };
    }
    if (sku.gives.revives && this._bag(save).revives >= 2) return { ok: false, error: 'already-holding-mercy' };
    if (save.shards < sku.shardPrice) return { ok: false, error: 'need-' + (sku.shardPrice - save.shards) + '-shards' };
    save.shards -= sku.shardPrice;
    this.grant(save, sku);
    return { ok: true, lane: 'shards' };
  },

  async buy(save, id, onSaved) {
    const sku = findSku(id);
    if (!sku) return { ok: false, error: 'unknown-sku' };
    if (!this.offered(save, sku)) return { ok: false, error: 'not-yet' };
    if (sku.play !== 'consumable' && this.owns(save, Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned)) {
      return { ok: false, error: 'already-yours' };
    }
    if (sku.gives.revives && this._bag(save).revives >= 2) return { ok: false, error: 'already-holding-mercy' };
    if (!this.provider || this.mode === 'disabled') return { ok: false, error: 'store-unavailable' };
    this.busy = id; this.lastError = null;
    let res;
    try {
      res = await this.provider.purchase(sku.id);
    } catch (err) {
      res = { ok: false, error: String(err && err.message || err) };
    }
    this.busy = null;
    if (!res.ok) { this.lastError = res.error; return res; }
    if (this.mode === 'native') {
      const finished = sku.play === 'consumable' ? res.consumed : res.acknowledged;
      if (!finished) { this.lastError = 'play-not-finished'; return { ok: false, error: 'play-not-finished' }; }
    }
    this.grant(save, sku);
    this.rememberReceipt(save, res.receipt || res.purchaseToken || null);
    if (onSaved) onSaved();
    return { ok: true, lane: 'store', receipt: res.receipt || null };
  },

  /** Full entitlement recompute from the platform ledger. */
  async restore(save, onSaved) {
    if (!this.provider || this.mode === 'disabled') return { ok: false, error: 'store-unavailable' };
    const res = await this.provider.restore();
    if (!res.ok) { this.lastError = res.error; return res; }
    const bag = this._bag(save);
    bag.receipts = bag.receipts || [];
    let restored = 0;
    for (const rec of res.ledger || []) {
      const sku = findSku(rec.sku);
      if (!sku) continue;
      const id = rec.receipt || rec.transactionId || rec.purchaseToken;
      if (sku.play === 'consumable') {
        if (!id || bag.receipts.includes(id)) continue;
        bag.receipts.push(id);
        this.grant(save, sku);
        restored++;
      } else {
        const before = this.owns(save, Array.isArray(sku.gives.owned) ? sku.gives.owned[0] : sku.gives.owned);
        this.grant(save, sku);
        if (!before) restored++;
      }
    }
    if (onSaved) onSaved();
    this.lastError = null;
    return { ok: true, restored };
  },

  equippedCoat(save) {
    const id = save && save.iap && save.iap.equipped;
    return id && this.owns(save, id) ? id : null;
  },

  wear(save, id) {
    if (id !== 'coat_bloodmoon' && id !== 'coat_moonsilver') return null;
    if (!this.owns(save, id)) return null;
    const bag = this._bag(save);
    bag.equipped = bag.equipped === id ? null : id;
    return bag.equipped;
  },

  /* ---- gameplay consumption (kept here so rules live in one place) ---- */

  takeRevive(save) {
    const bag = this._bag(save);
    if (bag.revives <= 0) return false;
    bag.revives--;
    return true;
  },
  takePouch(save) {
    const bag = this._bag(save);
    if (bag.pouches <= 0) return 0;
    bag.pouches--;
    return 3;
  },
  owns(save, thing) { return !!(save.iap && save.iap.owned && save.iap.owned[thing]); },

  priceLabel(sku) {
    if (this.mode === 'midtrans') return IDR(sku.priceIdr || Math.round(sku.priceUsd * 16000));
    if (this.mode === 'native') return 'GOOGLE PLAY';
    if (this.mode === 'sandbox') return '$' + sku.priceUsd.toFixed(2) + ' · SANDBOX';
    return '$' + sku.priceUsd.toFixed(2);
  },

  diagnostics() {
    return { enabled: IAP_ENABLED, mode: this.mode, busy: this.busy, lastError: this.lastError, skus: CATALOG.length, currency: this.mode === 'midtrans' ? 'IDR' : 'USD', midtransReady: !!(SHOP_CONFIG.midtrans.enabled && SHOP_CONFIG.midtrans.clientKey) };
  },
};

IAP.init();
