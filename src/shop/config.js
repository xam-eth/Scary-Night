/* LAST NIGHT — store configuration (v1.0)
 *
 * Everything about HOW money and ads connect lives in this single file so the
 * launch checklist is one edit, not a hunt. Ads stay off. Web money is
 * Midtrans; Play money is Google Play Billing. See docs/PLAY-STORE.md.
 *
 * ⚠ SECURITY RULE — the Midtrans SERVER key never ships in a web bundle.
 * The client only ever holds a *client/key* (Snap) token; order creation and
 * transaction verification happen on your own backend (see docs/IAP.md):
 *
 *   game → POST {serverBase}/order  { sku, playerId }
 *        ← { transactionId, token }        (server calls Midtrans v2 /v2b Snap API)
 *   game → snap.pay(token)                 (Midtrans hosts the payment sheet)
 *   game → POST {serverBase}/verify  { transactionId }
 *        ← { status: 'settlement' | 'capture', ... }
 *   Midtrans → POST {serverBase}/callback  (async notification, signature_key
 *              verified with the SERVER key — the source of truth for grants)
 *
 * The client key in this file is public (it rides in the Snap.js URL) and it
 * is a live key, not Midtrans' sandbox sample. The server key is not here.
 */

export const SHOP_CONFIG = {
  // Web checkout is Midtrans Snap. A Play Store wrapper that sets window.LNBridge
  // is forced onto Google Play Billing in iap.js — digital goods on Play cannot
  // be sold through Midtrans. See docs/PLAY-STORE.md.
  provider: 'midtrans',
  currency: 'IDR',

  midtrans: {
    enabled: true,
    // Client key is public by design (it is in the Snap.js URL). The server key
    // is not in this file and must never be added here.
    clientKey: 'Mid-client-SZuukvoxN7N2-cZo',
    merchantId: 'M769336744',
    serverBase: '/api/iap',
    snapScript: 'https://app.midtrans.com/snap/snap.js',
    production: true,
  },

  ads: {
    // 'none' keeps every ad affordance invisible; 'mock' simulates a rewarded
    // view for QA; 'bridge' forwards to window.LNBridge.showRewarded (native).
    provider: 'none',
    // Google's public sample unit — always returns test ads, never revenue.
    testAdUnitId: 'ca-app-pub-3940256099942544/6300974183',
    units: { revive: '', crate: '' },   // your real placements when launched
  },
};

// An explicit host override wins over the baked config, so a wrapper app can
// inject keys without rebuilding the game bundle.
if (typeof window !== 'undefined' && window.LN_STORE) {
  Object.assign(SHOP_CONFIG, window.LN_STORE.midtrans ? { provider: 'midtrans' } : {});
  if (window.LN_STORE.midtrans) Object.assign(SHOP_CONFIG.midtrans, window.LN_STORE.midtrans, { enabled: true });
  if (window.LN_STORE.ads) Object.assign(SHOP_CONFIG.ads, window.LN_STORE.ads);
  if (window.LN_STORE.currency) SHOP_CONFIG.currency = window.LN_STORE.currency;
}

export const IDR = (v) => 'Rp' + v.toLocaleString('id-ID');
