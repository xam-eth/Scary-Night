/* LAST NIGHT — rewarded ads (v1.0)
 *
 * The horror contract in this file, non-negotiable:
 *
 *   1. REWARDED ONLY. No interstitials, no banners, nothing that interrupts
 *      a night. An ad is something the player asks for, at a menu or at the
 *      death screen — the two moments where a horror game has already paused
 *      the fiction on its own.
 *   2. EVERY PLACEMENT IS ALSO FREE WITH SHARDS OR TIME. Ads never unlock a
 *      door that grinding cannot.
 *   3. HARD CAPS. revive: 1 per night. crate: 1 per day. A player who
 *      watches everything still has less than a player who paid everything —
 *      that is what keeps the economy honest.
 *   4. Server-side reward verification (AdMob SSV) is required before any
 *      production key ships — see docs/IAP.md. Until it exists, the game
 *      accepts mock grants, and the UI says so.
 *
 * Providers:
 *   'none'   — everything invisible, zero UI footprint (default).
 *   'mock'   — QA/dev: 3s timer, always succeeds. The "ritual" reads as
 *              flavour text on purpose so testers know it is simulated.
 *   'bridge' — native wrapper: window.LNBridge.postMessage({type:'ad',...}).
 */

import { SHOP_CONFIG } from './config.js';

export const AdPlacements = Object.freeze({
  revive: { name: 'SECOND BLOOD (watch)', perNight: 1, reward: 'grantRevive' },
  crate: { name: "CARPENTER'S CRATE (watch)", perDay: 1, reward: 'planks2' },
});

class AdBridge {
  constructor() { this.seq = 0; this.pending = new Map(); }
  get available() { return typeof window !== 'undefined' && !!(window.LNBridge && window.LNBridge.postMessage); }
  watch(unitId, placement) {
    if (!this.available) return Promise.resolve({ ok: false, error: 'bridge-unavailable' });
    const requestId = 'ad-' + (++this.seq);
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      window.LNBridge.postMessage(JSON.stringify({ type: 'ad', requestId, unitId, placement }));
      window.__LN_AD_result = window.__LN_AD_result || ((id, res) => {
        const cb = this.pending.get(id);
        if (cb) { this.pending.delete(id); cb(res || { ok: false, error: 'malformed' }); }
      });
      setTimeout(() => {
        if (this.pending.has(requestId)) { this.pending.delete(requestId); resolve({ ok: false, error: 'timeout' }); }
      }, 90000);
    });
  }
}

const bridge = new AdBridge();

export const Ads = {
  counts: {},        // placement -> { night, day }
  nightKey: 0,
  dayKey: '',

  init(game) {
    this._saveDay();
    return this;
  },

  provider() {
    const p = SHOP_CONFIG.ads.provider;
    if (p === 'bridge' && !bridge.available) return 'none';
    return p;
  },

  isAvailable(placement) {
    const cfg = AdPlacements[placement];
    if (!cfg || this.provider() === 'none') return false;
    const use = this.counts[placement] || { night: 0, day: 0 };
    if (cfg.perNight && use.night >= cfg.perNight) return false;
    if (cfg.perDay && use.day >= cfg.perDay) return false;
    return true;
  },

  /** Called by the game loop each beginNight to reset per-night caps. */
  beginNight(nightNo) {
    if (nightNo === this.nightKey) return;
    this.nightKey = nightNo;
    for (const k of Object.keys(this.counts)) this.counts[k].night = 0;
    this._saveDay();
  },

  _saveDay() {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.dayKey) {
      this.dayKey = d;
      for (const k of Object.keys(this.counts)) this.counts[k].day = 0;
    }
  },

  _bump(placement) {
    const c = this.counts[placement] || (this.counts[placement] = { night: 0, day: 0 });
    c.night++; c.day++;
  },

  /** Show (or simulate) a rewarded video. Resolves {ok, skipped}. */
  async watch(placement) {
    const cfg = AdPlacements[placement];
    if (!cfg || !this.isAvailable(placement)) return { ok: false, error: 'unavailable' };
    const p = this.provider();
    let res;
    if (p === 'mock') {
      await new Promise((r) => setTimeout(r, 2600));
      res = { ok: true, mock: true };
    } else {
      const unitId = (SHOP_CONFIG.ads.units || {})[placement] || SHOP_CONFIG.ads.testAdUnitId;
      res = await bridge.watch(unitId, placement);
    }
    if (res.ok) this._bump(placement);
    return res;
  },

  label(placement) {
    const p = this.provider();
    const base = (AdPlacements[placement] && AdPlacements[placement].name) || '';
    return p === 'mock' ? base + ' · SIMULATED' : base;
  },

  diagnostics() {
    return { provider: this.provider(), counts: { ...this.counts }, caps: AdPlacements };
  },
};
