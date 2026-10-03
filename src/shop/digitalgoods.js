/* LAST NIGHT — Play Billing, from inside a Trusted Web Activity.
 *
 * A TWA is Chrome: no native code of ours runs in it, and nothing can be
 * injected into the page. So the `window.LNBridge` contract the WebView
 * wrapper uses is unreachable here, and Play's Payments policy still applies —
 * digital goods sold in an app distributed by Play go through Play Billing.
 * The web way to reach it is the Digital Goods API plus the Payment Request
 * API, which Chrome answers by handing the call to the app's
 * DigitalGoodsRequestHandler (Bubblewrap installs that when
 * `features.playBilling.enabled` is true in android/twa-manifest.json).
 *
 * Two rules this file exists to keep:
 *
 *  1. The game grants nothing on a bare {ok:true}. A consumable is consumed
 *     and a non-consumable acknowledged BEFORE this returns ok — Google
 *     refunds an unacknowledged purchase after 72 hours and an unconsumed
 *     consumable cannot be bought again.
 *  2. Midtrans is a web-browser rail. It must never run inside the TWA
 *     (see inTwa() below, and IAP.init()).
 *
 * The Digital Goods API ships as an origin trial: without a token in the page
 * it is simply absent, and the shop falls back to the shard lane rather than
 * to a rail Play would reject. docs/PLAY-BUNDLE.md has the token step.
 */

const BILLING = 'https://play.google.com/billing';

/**
 * Is the page running inside the Android app?
 *
 * A TWA is launched by an app, and an app-launched page carries the app in
 * its referrer (android-app://<package>). Nothing else does. The second
 * test covers a TWA whose referrer was stripped: only Chrome sitting in a
 * TWA exposes the Digital Goods service at all.
 */
export function inTwa() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (String(document.referrer || '').startsWith('android-app://')) return true;
  return typeof window.getDigitalGoodsService === 'function' && typeof window.PaymentRequest === 'function';
}

export class DigitalGoodsProvider {
  /** `lookup(skuId)` returns the catalog entry, so this file never imports it. */
  constructor(lookup = () => null) {
    this.lookup = lookup;
    this.service = null;
    this.connecting = null;
    this.prices = new Map();
  }

  static get supported() {
    return typeof window !== 'undefined'
      && typeof window.getDigitalGoodsService === 'function'
      && typeof window.PaymentRequest === 'function';
  }

  get available() { return DigitalGoodsProvider.supported; }

  /** Connect once. A rejection here means "not a Play device" — that is normal. */
  connect() {
    if (this.service) return Promise.resolve(this.service);
    if (!this.connecting) {
      this.connecting = window.getDigitalGoodsService(BILLING)
        .then((s) => { this.service = s; return s; })
        .catch((err) => { this.connecting = null; throw err; });
    }
    return this.connecting;
  }

  /** Prices as Play lists them, in the player's own locale and currency. */
  async details(ids) {
    try {
      const service = await this.connect();
      const list = await service.getDetails(ids);
      for (const item of list || []) {
        let text = '';
        try {
          text = new Intl.NumberFormat(navigator.language, {
            style: 'currency', currency: item.price.currency,
          }).format(item.price.value);
        } catch (e) { text = `${item.price.currency} ${item.price.value}`; }
        this.prices.set(item.itemId, text);
      }
      return this.prices;
    } catch (e) { return this.prices; }
  }

  price(id) { return this.prices.get(id) || null; }

  /**
   * Buy one SKU. Resolves { ok:true, consumed|acknowledged } only after Play
   * has been told the purchase is handled; anything else is a failure the
   * shop shows as such, with no grant.
   */
  async purchase(skuId, sku) {
    if (!this.available) return { ok: false, error: 'bridge-unavailable' };
    let service;
    try {
      service = await this.connect();
    } catch (e) {
      return { ok: false, error: 'play-unavailable' };
    }
    const item = sku || this.lookup(skuId);
    const consumable = !!item && item.play === 'consumable';

    const request = new PaymentRequest([{ supportedMethods: BILLING, data: { sku: skuId } }]);
    let response;
    try {
      response = await request.show();
    } catch (err) {
      /* A cancelled sheet rejects, and so does a Play stack that will not
       * open one — the latter is a known device-specific AbortError. Neither
       * is a purchase. */
      const name = String((err && err.name) || '');
      if (/abort/i.test(name)) return { ok: false, error: 'user-cancelled' };
      return { ok: false, error: String((err && err.message) || err || 'play-declined') };
    }

    const d = (response && response.details) || {};
    const token = d.purchaseToken || d.token || null;   // `token` is the deprecated name
    if (!token) {
      await response.complete('fail').catch(() => {});
      return { ok: false, error: 'no-token' };
    }

    try {
      if (consumable) {
        // Consume, so mercy can be bought again; repeat is the v2 spelling.
        if (typeof service.consume === 'function') await service.consume(token);
        else await service.acknowledge(token, 'repeat');
        await response.complete('success').catch(() => {});
        return { ok: true, receipt: token, purchaseToken: token, consumed: true };
      }
      await service.acknowledge(token, 'onetime');
      await response.complete('success').catch(() => {});
      return { ok: true, receipt: token, purchaseToken: token, acknowledged: true };
    } catch (err) {
      /* Money has moved but Play has not been told we handled it. Say so out
       * loud instead of granting: it will be refunded in three days. */
      await response.complete('fail').catch(() => {});
      return { ok: false, error: 'play-not-finished' };
    }
  }

  /**
   * What this account already owns. Also the safety net: anything Play still
   * lists as unacknowledged gets acknowledged here, because a purchase nobody
   * acknowledged is refunded whether or not the player got the coat.
   */
  async restore() {
    if (!this.available) return { ok: false, error: 'bridge-unavailable' };
    let service;
    try {
      service = await this.connect();
    } catch (e) {
      return { ok: false, error: 'play-unavailable' };
    }
    let list = [];
    try {
      list = (await service.listPurchases()) || [];
    } catch (e) {
      return { ok: false, error: 'play-unavailable' };
    }
    const ledger = list.map((p) => ({
      sku: p.itemId, purchaseToken: p.purchaseToken, receipt: p.purchaseToken,
    }));
    for (const p of list) {
      const item = this.lookup(p.itemId);
      try {
        if (item && item.play === 'consumable') {
          if (typeof service.consume === 'function') await service.consume(p.purchaseToken);
        } else if (p.purchaseToken) {
          await service.acknowledge(p.purchaseToken, 'onetime').catch(() => {});
        }
      } catch (e) { /* the ledger still restores what it can */ }
    }
    return { ok: true, ledger };
  }

  install() {
    if (typeof window === 'undefined') return;
    // Nothing to install: the rail is the platform. Exposed for QA.
    window.__LN_IAP_PLAY = this;
  }
}
