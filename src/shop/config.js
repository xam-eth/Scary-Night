/* LAST NIGHT — store configuration (v1.0)
 *
 * Everything about HOW money and ads connect lives in this single file so the
 * launch checklist is one edit, not a hunt. Defaults are safe: sandbox money,
 * no ads, no network calls.
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
 *   Midtrans → POST {serverBase}/callback  (async notification, x-signature
 *              verified with the SERVER key — the source of truth for grants)
 *
 * Fill `midtrans.clientKey` from YOUR server at boot if you want it dynamic
 * (`window.LN_STORE = { midtrans: { clientKey, serverBase, sandbox } }`), or
 * bake it here for a demo build. The public "SBPT…" client key below is
 * Midtrans' own documentation sample for sandbox mode; it can only move fake
 * money inside a sandbox account you have not connected.
 */

export const SHOP_CONFIG = {
  // 'sandbox' = simulated purchases, no network. 'midtrans' = Snap web flow.
  // 'native' = platform bridge (window.LNBridge), see iap.js.
  provider: 'sandbox',
  currency: 'USD',            // midtrans mode renders priceIdr

  midtrans: {
    // Flip on when you have a Snap client key + the two server endpoints.
    enabled: false,
    clientKey: '',            // 'SBPT-CLIENT-KEY-...' (sandbox) / 'VT-CLIENT-...' (prod)
    serverBase: '/api/iap',   // your backend: POST /order, POST /verify, POST /callback
    snapScript: 'https://app.sandbox.midtrans.com/snap/snap.js',
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
