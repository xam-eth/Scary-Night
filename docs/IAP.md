# LAST NIGHT — IAP & Ads plan (v1.0)

Owner-facing design + integration contract for the Blood Market.
Code: `src/shop/iap.js` (catalog, providers), `src/shop/config.js`
(knobs), `src/shop/ads.js` (rewarded placements).

---

## 1. Economy model

Two currencies, deliberately:

| | Shards ◆ | Money |
|---|---|---|
| earned by | playing (nights, objectives, kills) | IAP only |
| buys | the whole upgrade tree, every consumable, coats | everything, faster |

Every SKU has a shard price (the F2P lane) and no SKU gates core survival.
IAP **accelerates the meta, never the night** — stat upgrades stay shard-only
inside `UPGRADES`, and `SECOND BLOOD` (the only power-adjacent item) is capped
at one per night whether bought or earned.

Balance intent (v1.0 targets, seed-verified by the harness):

* a focused F2P player earns one consumable (~150 ◆) in 4–6 good nights;
* `PUDDLE` ≈ what a strong single night pays, `TIDE` ≈ a patient week;
* Dawnbreaker Edition = supporter tier: value is generosity, not advantage.

## 2. Price ladder (Midtrans, IDR)

| SKU | USD | IDR | note |
|---|---|---|---|
| SECOND BLOOD | 1.99 | Rp19.000 | consumable, cap 1/night |
| CARPENTER'S POUCH | 1.99 | Rp19.000 | +3 planks/night, stackable 3 |
| COAT (cosmetic) | 1.99 | Rp29.000 | tint over GLB; the .glb file never changes |
| PUDDLE · 200◆ | 2.99 | Rp49.000 | entry |
| POOL · 605◆ | 6.99 | Rp99.000 | BEST VALUE (+10%) |
| TIDE · 1500◆ | 13.99 | Rp199.000 | +18% |
| FIVE SECOND BLOODS | 7.99 | Rp69.000 | bundle discount |
| DAWNBREAKER EDITION | 9.99 | Rp149.000 | both coats + 800◆ + title |

Indonesian price points sit on the familiar Rp-x9.000 ladder; web channels
(VA/QRIS) dominate, so QRIS is always enabled server-side.

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
3. `POST /callback` → verify `x-signature` with SERVER key; store ledger row; **this
   is what grants**; duplicate-safe on transaction_id.
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

Rules: never mid-night, never interstitial, never on victory screen, and the
buttons are **invisible** unless a provider is configured (`'none'` default).
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
- [ ] flip `src/shop/config.js` → `provider: 'midtrans'`; client key via
      server-injected `window.LN_STORE` (never baked into the bundle);
      keep `server/catalog.json` and `CATALOG` in sync at price-change time
- [ ] receipt ledger export + a manual "grant fix" runbook for support
- [ ] store-page price sync pass at launch (docs/LAUNCH.md when it exists)
