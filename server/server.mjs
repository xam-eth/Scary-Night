/* LAST NIGHT — IAP server (v1.0) · zero dependencies
 *
 * The four routes docs/IAP.md promises, plus the AdMob SSV verifier. Built on
 * node:http only — same no-toolchain philosophy as the game itself. Any stack
 * may replace it as long as the contract holds; THIS one is deployable today
 * on any VPS/containers that run Node 18+.
 *
 * Secrets model (see docs/IAP.md §3):
 *   MIDTRANS_SERVER_KEY   — ONLY ever lives here, never in the bundle.
 *   The client receives only { transactionId, token } from /order.
 *
 * Routes:
 *   POST /api/iap/order    { sku, playerId }        → { transactionId, token }
 *   POST /api/iap/verify   { transactionId }        → { settled, status, receipt? }
 *   POST /api/iap/callback  (Midtrans async, x-signature) — THE source of truth
 *   POST /api/iap/ledger   { playerId }             → { ledger:[{transactionId,sku,at}] }
 *   POST /api/ads/verify    (AdMob SSV, RSA-SHA1)   → { ok, transaction_id }
 *
 * Store: a single JSON file, atomic writes. For production scale-out swap
 * `readStore/writeStore` for Postgres — the shape is one object.
 *
 * Run:  MIDTRANS_SERVER_KEY=SB-MID-SERVER-KEY... node server/server.mjs
 * Test: node server/test.mjs   (spins stubs; touches no real network)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- catalog (server-side truth) ---------------- */
const CATALOG = JSON.parse(fs.readFileSync(path.join(HERE, 'catalog.json'), 'utf8'));

/* ---------------- app factory (testable) ---------------- */
export function createIapServer(config = {}) {
  const cfg = {
    serverKey: config.serverKey ?? process.env.MIDTRANS_SERVER_KEY ?? '',
    isProduction: (config.isProduction ?? process.env.MIDTRANS_IS_PRODUCTION) === 'true',
    snapUrl: config.snapUrl || process.env.MIDTRANS_SNAP_URL
      || 'https://app.midtrans.com/snap/v1/transactions',
    statusUrl: config.statusUrl || process.env.MIDTRANS_STATUS_URL
      || 'https://app.midtrans.com/v2/transactions',
    dataFile: config.dataFile || path.join(HERE, 'data.json'),
    pendingTtlMs: config.pendingTtlMs ?? 30 * 60 * 1000,
    // AdMob SSV fetches the verifier's RSA key from a URL in the request —
    // never follow arbitrary URLs; allow-list hosts (test stubs add their own).
    adsKeyHosts: new Set((config.adsKeyHosts ?? process.env.ADS_KEY_ALLOWLIST ?? 'developers.google.com')
      .split(',').map((s) => s.trim()).filter(Boolean)),
  };
  if (cfg.isProduction && !config.snapUrl && !process.env.MIDTRANS_SNAP_URL) {
    cfg.snapUrl = 'https://app.midtrans.com/snap/v1/transactions';
  } else if (!cfg.isProduction && !config.snapUrl && !process.env.MIDTRANS_SNAP_URL) {
    cfg.snapUrl = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  }

  /* ---- storage: one JSON doc, atomic ---- */
  let store = loadStore();
  function loadStore() {
    try { return JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')); }
    catch (e) { return { transactions: {} }; }
  }
  function saveStore() {
    const tmp = cfg.dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
    fs.renameSync(tmp, cfg.dataFile);
  }

  /* ---- utils ---- */
  const midtransSign = (orderId, statusCode, gross) =>
    crypto.createHash('sha512').update(`${orderId}${statusCode}${gross}${cfg.serverKey}`).digest('hex');
  const sigEqual = (a, b) => {
    const ba = Buffer.from(String(a || ''), 'utf8'), bb = Buffer.from(String(b || ''), 'utf8');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  const send = (res, code, obj) => {
    const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
    res.writeHead(code, { 'content-type': typeof obj === 'string' ? 'text/plain' : 'application/json' });
    res.end(body);
  };
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too-large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const parseBody = async (req) => {
    const raw = await readBody(req);
    if (!raw) return {};
    try { return JSON.parse(raw); }
    catch (e) { return Object.fromEntries(new URLSearchParams(raw)); }   // Midtrans may send form-encoded
  };
  const basic = () => 'Basic ' + Buffer.from(cfg.serverKey + ':').toString('base64');

  /* ---- tiny rate limit: 30 order req/min per IP ---- */
  const buckets = new Map();
  function allowed(ip) {
    const now = Date.now();
    const b = buckets.get(ip) || { n: 0, t: now };
    if (now - b.t > 60000) { b.n = 0; b.t = now; }
    b.n++; buckets.set(ip, b);
    return b.n <= 30;
  }

  /* ---- handlers ---- */
  async function handleOrder(req, res) {
    if (!cfg.serverKey) return send(res, 503, { error: 'midtrans-unconfigured' });
    if (!allowed(req.socket.remoteAddress)) return send(res, 429, { error: 'slow-down' });
    const { sku, playerId } = await parseBody(req);
    const item = CATALOG[sku];
    if (!item) return send(res, 400, { error: 'unknown-sku' });
    if (!playerId || typeof playerId !== 'string' || playerId.length > 64) return send(res, 400, { error: 'bad-player' });
    // idempotent: reuse a recent pending order for the same lane
    const now = Date.now();
    for (const t of Object.values(store.transactions)) {
      if (t.playerId === playerId && t.sku === sku && t.status === 'pending' && now - t.at < cfg.pendingTtlMs) {
        return send(res, 200, { transactionId: t.orderId, token: t.token });
      }
    }
    const orderId = `LN-${now.toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const snap = {
      transaction_details: { order_id: orderId, gross_amount: item.priceIdr },
      item_details: [{ id: sku, price: item.priceIdr, quantity: 1, name: item.label }],
      enabled_payments: ['qris', 'gopay', 'shopeepay', 'bca_va', 'bni_va', 'bri_va', 'permata_va', 'echannel'],
      custom_field1: process.env.MIDTRANS_MERCHANT_ID || '',
      metadata: { order_id: orderId },
    };
    try {
      const r = await fetch(cfg.snapUrl, {
        method: 'POST',
        headers: { authorization: basic(), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(snap),
      });
      if (!r.ok) return send(res, 502, { error: 'snap-' + r.status });
      const data = await r.json();
      store.transactions[orderId] = {
        orderId, sku, playerId, amount: item.priceIdr, token: data.token,
        status: 'pending', at: now, updatedAt: now,
      };
      saveStore();
      return send(res, 200, { transactionId: orderId, token: data.token });
    } catch (e) {
      return send(res, 502, { error: 'snap-unreachable' });
    }
  }

  async function handleVerify(req, res) {
    const { transactionId } = await parseBody(req);
    const t = store.transactions[transactionId];
    if (!t) return send(res, 404, { error: 'unknown-transaction' });
    if (t.status === 'settlement' || t.status === 'capture') {
      return send(res, 200, { settled: true, status: t.status, receipt: t.orderId });
    }
    if (t.status === 'refund' || t.status === 'void' || t.status === 'expire') {
      return send(res, 200, { settled: false, status: t.status });
    }
    // UX poll: ask Midtrans directly, but the async callback remains the ledger
    try {
      const r = await fetch(`${cfg.statusUrl}/${encodeURIComponent(t.orderId)}/status`, {
        headers: { authorization: basic(), accept: 'application/json' },
      });
      if (!r.ok) return send(res, 200, { settled: false, status: 'pending' });
      const data = await r.json();
      const status = data.transaction_status || data.status_code || 'pending';
      t.status = status; t.updatedAt = Date.now();
      saveStore();
      const settled = status === 'settlement' || status === 'capture';
      return send(res, 200, { settled, status, receipt: settled ? t.orderId : undefined });
    } catch (e) {
      return send(res, 200, { settled: false, status: 'pending' });
    }
  }

  async function handleCallback(req, res) {
    if (!cfg.serverKey) return send(res, 503, { error: 'midtrans-unconfigured' });
    const body = await parseBody(req);
    const orderId = body.order_id || body.transaction_id;
    const statusCode = String(body.status_code ?? '');
    const gross = String(body.gross_amount ?? '');
    // Midtrans sends signature_key in the JSON body. The older header form is
    // still accepted so the local test stub keeps working.
    const signature = body.signature_key || req.headers['x-signature'] || body.signature || '';
    if (!orderId || !sigEqual(midtransSign(orderId, statusCode, gross), signature)) {
      return send(res, 401, 'NOT OK');   // never grant on a forged callback
    }
    const t = store.transactions[orderId];
    if (!t) return send(res, 200, 'OK');          // unknown but signed: idempotent accept
    const status = mapStatus(body.transaction_status || body.status || statusCode);
    if (t.status !== status) {
      t.status = status; t.updatedAt = Date.now();
      if (status === 'settlement' || status === 'capture') t.settledAt = Date.now();
      if (status === 'refund' || status === 'void') t.revokedAt = Date.now();
      saveStore();
    }
    return send(res, 200, 'OK');
  }
  const mapStatus = (s) => ({
    'settlement': 'settlement', 'capture': 'capture', 'authorize': 'authorize',
    'pending': 'pending', 'expire': 'expire', 'cancel': 'cancel', 'refund': 'refund', 'void': 'void',
  }[String(s).toLowerCase()] || 'pending');

  async function handleLedger(req, res) {
    const { playerId } = await parseBody(req);
    if (!playerId) return send(res, 400, { error: 'bad-player' });
    const ledger = [];
    for (const t of Object.values(store.transactions)) {
      if (t.playerId !== playerId) continue;
      if (t.status === 'settlement' || t.status === 'capture') {
        ledger.push({ transactionId: t.orderId, sku: t.sku, at: t.settledAt || t.at, receipt: t.orderId });
      }
    }
    ledger.sort((a, b) => a.at - b.at);
    return send(res, 200, { ledger });
  }

  /* On-device id is the deletion token. No account exists to freeze. */
  async function handleDelete(req, res) {
    if (!allowed(req.socket.remoteAddress || 'local')) return send(res, 429, { error: 'slow-down' });
    const { playerId } = await parseBody(req);
    if (!playerId || typeof playerId !== 'string' || playerId.length > 64) return send(res, 400, { error: 'bad-player' });
    let n = 0;
    for (const [id, t] of Object.entries(store.transactions)) {
      if (t.playerId === playerId) { delete store.transactions[id]; n++; }
    }
    if (n) saveStore();
    return send(res, 200, { deleted: n });
  }

  /* ---- AdMob rewarded-ad SSV (server-side verification) ----
   * signature = RSA-SHA1 over "data\ntransaction_id\ncustom_data\nreward_item_type\nreward_amount"
   * with the verifier key fetched from `key` — but only from allow-listed hosts.
   * Grants must ride on the SSV hit, never on the client's onUserEarnedReward.
   */
  const keyCache = new Map();   // hostUrl -> { pem, at }
  async function handleAdsVerify(req, res) {
    const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const p = { ...q, ...await parseBody(req) };
    const { data = '', transaction_id = '', custom_data = '', reward_item_type = '', reward_amount = '', signature = '', key = '' } = p;
    if (!transaction_id || !signature || !key) return send(res, 400, { error: 'bad-request' });
    let host;
    try { host = new URL(key).hostname; } catch (e) { return send(res, 400, { error: 'bad-key-url' }); }
    if (!cfg.adsKeyHosts.has(host)) return send(res, 403, { error: 'key-host-not-allowed' });
    let pem = null;
    const hit = keyCache.get(key);
    if (hit && Date.now() - hit.at < 24 * 3600 * 1000) pem = hit.pem;
    else {
      try {
        const r = await fetch(key, { headers: { accept: 'text/plain' } });
        if (!r.ok) return send(res, 502, { error: 'key-unreachable' });
        pem = await r.text();
        keyCache.set(key, { pem, at: Date.now() });
      } catch (e) { return send(res, 502, { error: 'key-unreachable' }); }
    }
    const signed = [data, transaction_id, custom_data, reward_item_type, reward_amount].join('\n');
    let ok = false;
    try {
      ok = crypto.verify('sha1', Buffer.from(signed, 'utf8'), { key: pem, format: 'pem' }, Buffer.from(signature, 'base64'));
    } catch (e) { ok = false; }
    if (!ok) return send(res, 401, { error: 'bad-signature' });
    // record it so reward delivery can be audited (idempotent on transaction_id)
    store.ads = store.ads || {};
    const fresh = !store.ads[transaction_id];
    if (fresh) { store.ads[transaction_id] = { custom_data, at: Date.now() }; saveStore(); }
    return send(res, 200, { ok: true, verified: true, replay: !fresh, transaction_id });
  }

  /* ---- router ---- */
  const routes = {
    'POST /api/iap/order': handleOrder,
    'POST /api/iap/verify': handleVerify,
    'POST /api/iap/callback': handleCallback,
    'POST /api/iap/ledger': handleLedger,
    'POST /api/privacy/delete': handleDelete,
    'POST /api/ads/verify': handleAdsVerify,
    'GET /healthz': (req, res) => send(res, 200, { ok: true, transactions: Object.keys(store.transactions).length }),
  };

  const httpServer = http.createServer((req, res) => {
    const key = req.method + ' ' + req.url.split('?')[0];
    const h = routes[key];
    if (!h) return send(res, 404, { error: 'not-found' });
    h(req, res).catch((e) => { try { send(res, 500, { error: 'internal' }); } catch (_) { /* dead sock */ } });
  });

  return { httpServer, cfg, store, _test: { midtransSign } };
}

function loadDotEnv() {
  try {
    const raw = fs.readFileSync(path.join(HERE, '.env'), 'utf8');
    for (const line of raw.split(/\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].trim();
    }
  } catch (e) { /* optional */ }
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadDotEnv();
  const app = createIapServer();
  const port = +process.env.PORT || 8787;
  app.httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[last-night iap] listening :${port}`);
    console.log(`  midtrans: ${app.cfg.serverKey ? 'key loaded (' + (app.cfg.isProduction ? 'PROD' : 'sandbox') + ')' : 'MIDTRANS_SERVER_KEY missing — /order returns 503'}`);
    console.log(`  ads SSV hosts: ${[...app.cfg.adsKeyHosts].join(', ') || 'none'}`);
  });
}
