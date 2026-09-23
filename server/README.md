# LAST NIGHT — IAP server

The payment/verification backend for the Blood Market. Node 18+, **zero
dependencies**, one file. The game talks to it through the `serverBase`
configured in `src/shop/config.js` (default `/api/iap`, so same-origin
hosting + a reverse proxy needs no client changes).

## Run

```bash
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxx PORT=8787 node server/server.mjs
# production later: MIDTRANS_IS_PRODUCTION=true with the live server key
```

The **client key** is a different key — it goes to the game (via
`window.LN_STORE` injection or `src/shop/config.js`), never here. The server
key never leaves this process.

## Contract

| route | in | out | notes |
|---|---|---|---|
| `POST /api/iap/order` | `{sku, playerId}` | `{transactionId, token}` | idempotent per (player, sku) for 30 min of pending; catalog truth in `catalog.json`; 503 without a server key |
| `POST /api/iap/verify` | `{transactionId}` | `{settled, status, receipt?}` | UX fast-path; polls Midtrans only while unsettled |
| `POST /api/iap/callback` | Midtrans async body | `OK` | **the source of truth**; x-signature = SHA512(order_id+status_code+gross_amount+server key), timing-safe; replay-safe |
| `POST /api/iap/ledger` | `{playerId}` | `{ledger:[{transactionId, sku, at}]}` | settled-only → `IAP.restore()` re-derives entitlements |
| `POST /api/ads/verify` | AdMob SSV params | `{ok, verified, replay}` | RSA-SHA1 over the 5-field SSV string; key URL restricted to `ADS_KEY_ALLOWLIST` (default `developers.google.com`); replayed transactions flagged, not re-granted |
| `GET /healthz` | — | `{ok, transactions}` | for uptime probes |

Data lands in `server/data.json` (atomic write, gitignored). To scale,
replace `loadStore/saveStore` with Postgres — every table is one object.

## Deploy notes

1. Put it behind TLS on the game's origin (the client uses relative
   `/api/iap/*`) — any reverse proxy works; example:
   `location /api/iap/ { proxy_pass http://127.0.0.1:8787; }`.
2. Point Midtrans **Notification URL** at `https://your.host/api/iap/callback`.
3. Set AdMob's SSV callback URL to `https://your.host/api/ads/verify`
   (with your `custom_data` template, e.g. `player:%player_id%;placement:revive`).
4. Flip `src/shop/config.js` → `provider: 'midtrans'` + inject the Snap
   client key at boot. Nothing else changes in the game.
5. Prices: `server/catalog.json` is what gets charged — keep it in sync with
   `CATALOG` in `src/shop/iap.js` (the client only displays).

## Test

```bash
node server/test.mjs
```
Runs the full money loop against a local Midtrans stub (no network):
order/idempotency, forged-callback rejection, settlement, replay safety,
refund revocation, per-player ledger, and the SSV flow with a real RSA
keypair (valid / tampered / replay / host-deny).
