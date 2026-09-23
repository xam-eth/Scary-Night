/* LAST NIGHT — in-app purchases, designed the horror way.
 *
 * ─── THE PLAN (why this catalog and not another one) ────────────────────────
 * The game's contract with the player is "survive the night, nothing you do
 * is safe, your choices are the game". Monetisation may not break that
 * contract. Rules that shaped this catalog:
 *
 *  1. NO PAY-TO-WIN. Stats (blood, speed, damage, repair) are never sold.
 *     The upgrade tree stays shard-only, and every shard bundle has a F2P
 *     equivalent: shards can still be earned by playing well (nights +
 *     objectives), IAP only *accelerates* the meta, never the night.
 *  2. CONVENIENCE AND KINDNESS, NOT POWER. The only power-adjacent item is
 *     SECOND BLOOD (a once-per-night revive), capped, mirrorable with
 *     150 earned shards, and it returns you mid-night into the same danger.
 *  3. COSMETICS CELEBRATE THE FANS (coat tints over the GLB — the asset
 *     itself is never modified, the tint is a compositing filter).
 *  4. EVERY SKU HAS A SHARD PRICE. Store money and earned currency buy the
 *     same things. Bundle prices are strictly better value to signal intent.
 *  5. SUPPORTER TIER ("DAWNBREAKER EDITION") is the honest whale path:
 *     money for love of the game, nothing exclusive to gameplay.
 *  6. FULL REFUND-SAFE: restore purchases re-derives everything from the
 *     platform ledger; owned flags and balances are applied, never guessed.
 *  7. ADS ARE REWARDED-ONLY, OPT-IN AND HARD-CAPPED (src/shop/ads.js). An
 *     interrupted horror game is a ruined horror game: nothing here ever
 *     plays over gameplay. The menu and the death screen are the only stages,
 *     and every ad reward also has a shard or grind path.
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

import { defaultSave } from '../core/util.js';
import { SHOP_CONFIG, IDR } from './config.js';

export const IAP_ENABLED = true;          // beta: on, sandboxed on web
export const SANDBOX_LATENCY_MS = 900;

/* ---------------- catalog ---------------- */
export const CATALOG = [
  {
    id: 'shards_s', name: 'PUDDLE', kind: 'shards', priceUsd: 2.99, priceIdr: 49000,
    gives: { shards: 200 }, blurb: '200 blood shards', tag: null,
  },
  {
    id: 'shards_m', name: 'POOL', kind: 'shards', priceUsd: 6.99, priceIdr: 99000,
    gives: { shards: 605 }, blurb: '550 + 55 bonus shards', tag: 'BEST VALUE',
  },
  {
    id: 'shards_l', name: 'TIDE', kind: 'shards', priceUsd: 13.99, priceIdr: 199000,
    gives: { shards: 1500 }, blurb: '1200 + 300 bonus shards', tag: null,
  },
  {
    id: 'revive1', name: 'SECOND BLOOD', kind: 'consumable', priceUsd: 1.99, priceIdr: 19000, shardPrice: 150,
    gives: { revives: 1 }, blurb: 'One dawn given back. Once per night.', tag: null,
  },
  {
    id: 'revive5', name: 'FIVE SECOND BLOODS', kind: 'consumable', priceUsd: 7.99, priceIdr: 69000, shardPrice: 650,
    gives: { revives: 5 }, blurb: 'A pack for a long week.', tag: null,
  },
  {
    id: 'pouch', name: 'CARPENTER’S POUCH', kind: 'consumable', priceUsd: 1.99, priceIdr: 19000, shardPrice: 120,
    gives: { pouches: 3 }, blurb: '+3 planks at the start of every night, until used.', tag: null,
  },
  {
    id: 'coat_bloodmoon', name: 'BLOODMOON COAT', kind: 'cosmetic', priceUsd: 1.99, priceIdr: 29000, shardPrice: 180,
    gives: { owned: 'coat_bloodmoon' }, blurb: 'A tint over the GLB. The model file itself stays untouched.', tag: null,
  },
  {
    id: 'coat_moonsilver', name: 'MOONSILVER COAT', kind: 'cosmetic', priceUsd: 1.99, priceIdr: 29000, shardPrice: 180,
    gives: { owned: 'coat_moonsilver' }, blurb: 'Cold light on dark wool.', tag: null,
  },
  {
    id: 'dawnbreaker', name: 'DAWNBREAKER EDITION', kind: 'bundle', priceUsd: 9.99, priceIdr: 149000, shardPrice: null,
    gives: { shards: 800, owned: ['coat_bloodmoon', 'coat_moonsilver', 'title_dawnbreaker'] },
    blurb: 'Both coats + 800 shards + a title. For people who like us.', tag: 'SUPPORTER',
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
      window.LNBridge.postMessage(JSON.stringify({ type: 'purchase', sku, requestId }));
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
    this.playerId = this._playerId();
  }
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

  grant(save, sku) {
    const bag = this._bag(save);
    const g = sku.gives;
    if (g.shards) { save.shards += g.shards; save.totalShards = (save.totalShards || 0) + g.shards; }
    if (g.revives) bag.revives = Math.min(9, bag.revives + g.revives);
    if (g.pouches) bag.pouches = Math.min(9, bag.pouches + g.pouches);
    const owns = Array.isArray(g.owned) ? g.owned : [g.owned].filter(Boolean);
    for (const o of owns) bag.owned[o] = true;
  },

  /** Spend shards instead of money (the F2P lane). */
  buyWithShards(save, id) {
    const sku = findSku(id);
    if (!sku || !sku.shardPrice) return { ok: false, error: 'no-shard-price' };
    if (save.shards < sku.shardPrice) return { ok: false, error: 'need-' + (sku.shardPrice - save.shards) + '-shards' };
    save.shards -= sku.shardPrice;
    this.grant(save, sku);
    return { ok: true, lane: 'shards' };
  },

  async buy(save, id, onSaved) {
    const sku = findSku(id);
    if (!sku) return { ok: false, error: 'unknown-sku' };
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
    this.grant(save, sku);
    if (onSaved) onSaved();
    return { ok: true, lane: 'store', receipt: res.receipt || null };
  },

  /** Full entitlement recompute from the platform ledger. */
  async restore(save, onSaved) {
    if (!this.provider || this.mode === 'disabled') return { ok: false, error: 'store-unavailable' };
    const res = await this.provider.restore();
    if (!res.ok) { this.lastError = res.error; return res; }
    const fresh = defaultSave().iap;
    save.iap = { owned: {}, revives: 0, pouches: 0 };
    for (const rec of res.ledger || []) {
      const sku = findSku(rec.sku);
      if (sku) this.grant(save, sku);   // re-grant: consumables re-count, no math
    }
    if (onSaved) onSaved();
    this.lastError = null;
    return { ok: true, restored: (res.ledger || []).length };
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
    if (this.mode === 'sandbox') return '$' + sku.priceUsd.toFixed(2) + ' · SANDBOX';
    return '$' + sku.priceUsd.toFixed(2);
  },

  diagnostics() {
    return { enabled: IAP_ENABLED, mode: this.mode, busy: this.busy, lastError: this.lastError, skus: CATALOG.length, currency: this.mode === 'midtrans' ? 'IDR' : 'USD', midtransReady: !!(SHOP_CONFIG.midtrans.enabled && SHOP_CONFIG.midtrans.clientKey) };
  },
};

IAP.init();
