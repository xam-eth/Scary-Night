# LAST NIGHT — IAP & Ads plan (v1.0)

Owner-facing design + integration contract for the Blood Market.
Code: `src/shop/iap.js` (catalog, providers), `src/shop/config.js`
(knobs), `src/shop/ads.js` (rewarded placements).

---

## 1. The strategy that fits this game

LAST NIGHT is a five-minute single-player horror night. The player is not a
soldier. The value is the knock, the choice to bar or feed, and whether dawn
comes. A shop that sells power, planks, or a pile of shards makes those
choices into a receipt. That is the wrong strategy, even if it converts.

What is sold, after the player has already done the thing:

| SKU | Play type | Appears after | What it actually does |
|---|---|---|---|
| `revive1` | consumable | a death | One mercy, spent by the player on the death screen. Same night, 45% blood, once. Not automatic. |
| `coat_bloodmoon` | non-consumable | a wound | A red hem and a colder filter on the body. Wear or take off. No stats. |
| `coat_moonsilver` | non-consumable | a dawn | A pale hem. At dawn the wool is named. No stats. |
| `dawnbreaker` | non-consumable | a dawn | The house says the name on the menu and at dawn. No shards attached. |

Each also has a shard price, so money is never required. Shards are only
earned. The market button is hidden until a night has ended. There is no
buy button on the death screen, no "best value" tag, no timer, no loot box.

Not sold: shard packs, plank pouches, revive bundles, stat upgrades.

## 2. Price ladder (same four goods on Play and on the web)

| SKU | USD | IDR | shard price |
|---|---|---|---|
| SECOND BLOOD | 1.99 | Rp19.000 | 150 |
| BLOODMOON COAT | 1.99 | Rp29.000 | 180 |
| MOONSILVER COAT | 1.99 | Rp29.000 | 180 |
| DAWNBREAKER | 4.99 | Rp79.000 | 400 |

Play prices are whatever Play Console sets. The game shows "GOOGLE PLAY"
on that rail and does not invent a local price. A Play grant happens only
after `consumed` or `acknowledged` comes back from `LNBridge`.

## 3. Midtrans integration (web)

```
game ──POST /api/iap/order──▶ your server ──Snap API /v2b/transactions──▶ Midtrans
     ◀──{ transactionId, token }──
game ──snap.pay(token)──▶ Midtrans hosts payment sheet (VA / QRIS / GOPAY /
                          BCA VA / Alfamart / …)
onSuccess/onPending/onError/onClose
game ──POST /api/iap/verify──▶ server checks transaction status
Midtrans ──POST /api/iap/callback (async)──▶ server verifies x-signature
        (HMAC-SHA512, SERVER key) → marks ledger → grants become durable
```

Client rules (already implemented in `MidtransProvider`):

* the bundle only ever holds the **client/key** (or nothing: `window.LN_STORE`
  injection at boot). **The server key never ships.**
* grants are applied only after `/verify` says settled; pending shows
  "PENDING — restore will settle it"; the async callback is the source of
  truth (client verify is UX, not entitlement).
* every failure path degrades to the shard lane; a night never waits on a
  payment rail. `restore()` re-derives entitlements from the server ledger.

Server obligations (out of repo by design — any stack that answers 4 routes):

1. `POST /order` → idempotent: same playerId+sku+unpaid → same transaction.
2. `POST /verify` → `{ status in ('settlement','capture') → { settled: true, receipt } }`.
3. `POST /callback` → verify `signature_key` (SHA512 of order_id + status_code +
   gross_amount + server key) with the SERVER key; store ledger row; **this
   is what grants**; duplicate-safe on transaction_id. The older `x-signature`
   header is still accepted.
4. `POST /ledger` → list of settled transactions for restore.
5. Refunds: Midtrans dashboard → callback `status: settle→refund/void` → revoke
   unconsumed entitlements only (spent revives are honoured — retro-punishing a
   player mid-night erodes trust harder than the money earned).

Sandbox first: `app.sandbox.midtrans.com` + `SBPT-` client key + server
`is_production=false`. The dev placeholder in `src/shop/config.js` ships
empty — `provider:'sandbox'` keeps zero network calls until you flip it.

## 4. Ads policy (rewarded-only, opt-in, capped)

| placement | when | reward | cap |
|---|---|---|---|
| `revive` | death screen, none held | SECOND BLOOD grant | 1 / night |
| `crate` | shop | +2 planks next night | 1 / day |

This build ships `provider: 'none'`. The Play listing must say **Contains ads: No**
until that changes. Rules if it is ever turned on: never mid-night, never
interstitial, never on the victory screen, and the buttons stay **invisible**
unless a provider is configured.
`'mock'` exists so QA can exercise the full loop (2.6 s simulated watch).
Before production keys: enable AdMob **server-side verification** and reward
on SSV callback, not on the client `onUserEarnedReward` alone.

## 5. Parental / fairness guardrails

* no SKU is a loot box; contents are deterministic and stated per card;
* children's accounts: purchase flow relies on store-level auth (Android
  Family Link / iOS screen time) — the game adds its own "are you sure"
  hold-to-confirm on the pay action;
* the shop copy always shows the shard lane next to the money lane.

## 6. Launch checklist (v1.0 → paid)

- [x] the 4 server routes **exist in-repo**: `server/server.mjs`
      (zero-dependency Node; contract + run/deploy notes in `server/README.md`;
      integration suite `node server/test.mjs` → 16/16 PASS against a local
      Midtrans stub, incl. forged-callback rejection and refund revocation)
- [x] AdMob **SSV verifier endpoint**: `POST /api/ads/verify` — RSA-SHA1 over
      the 5-field payload, key fetch restricted to `ADS_KEY_ALLOWLIST`,
      replayed transactions flagged not re-granted (covered by the test)
- [ ] deploy it (VPS/container) behind TLS on the game origin; point the
      Midtrans **Notification URL** and the AdMob SSV callback URL at it
- [ ] Midtrans sandbox keys → live test matrix: success / pending / fail /
      duplicate callback / refund-revoke — set `IAP.debug.failMode` for the
      client failure states
- [x] web provider is `midtrans`; the public client key is in `src/shop/config.js`
      (a client key is meant to be public). The server key is not in the bundle.
      Play digital goods stay on `LNBridge` / Play Billing.
- [ ] keep `server/catalog.json` and `CATALOG` in sync at price-change time
- [ ] receipt ledger export + a manual "grant fix" runbook for support
- [ ] store-page price sync pass at launch (docs/LAUNCH.md when it exists)
