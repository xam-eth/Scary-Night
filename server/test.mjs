/* LAST NIGHT — IAP server integration test (no real network)
 *
 *   node server/test.mjs
 *
 * Stubs Midtrans (Snap create + status) and the AdMob SSV key host locally,
 * drives the real server through: order → idempotency → forged callback
 * rejection → signed settlement → replay safety → verify → ledger → refund
 * revocation → SSV verify/tamper/replay/host-deny → unconfigured 503.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIapServer } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data.test.json');
try { fs.unlinkSync(DATA); } catch (e) { /* fresh */ }

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

/* ---------------- stub hosts ---------------- */
const SERVER_KEY = 'SB-MID-SERVERKEY-TEST';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const txStatus = new Map();     // order_id -> transaction_status
let created = 0;

const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/snap/v1/transactions') {
      created++;
      const body = JSON.parse(raw);
      const id = body.transaction_details.order_id;
      txStatus.set(id, 'pending');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ transaction_id: id, token: 'TOK-' + id }));
    }
    const m = url.pathname.match(/^\/v2\/transactions\/([^/]+)\/status$/);
    if (m) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ transaction_status: txStatus.get(m[1]) || 'pending' }));
    }
    if (url.pathname === '/pubkey.pem') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(pubPem);
    }
    res.writeHead(404); res.end('no');
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubBase = `http://127.0.0.1:${stub.address().port}`;

/* ---------------- app under test ---------------- */
const app = createIapServer({
  serverKey: SERVER_KEY,
  snapUrl: stubBase + '/snap/v1/transactions',
  statusUrl: stubBase + '/v2/transactions',
  dataFile: DATA,
  adsKeyHosts: '127.0.0.1,developers.google.com',
});
await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.httpServer.address().port}`;

const post = async (route, obj, headers = {}) => {
  const r = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* text */ }
  return { code: r.status, json, text };
};
const signCb = (orderId, statusCode, gross) => ({
  'x-signature': crypto.createHash('sha512').update(`${orderId}${statusCode}${gross}${SERVER_KEY}`).digest('hex'),
});

console.log('\n=== ORDER FLOW ===');
const o1 = await post('/api/iap/order', { sku: 'revive1', playerId: 'LN-TESTER' });
ok('order returns transactionId + token', o1.code === 200 && o1.json?.transactionId && /^TOK-LN-/.test(o1.json?.token || ''), o1.json?.transactionId);
const o2 = await post('/api/iap/order', { sku: 'revive1', playerId: 'LN-TESTER' });
ok('idempotent: same lane reuses the pending order', o2.json?.transactionId === o1.json?.transactionId && created === 1);
const o3 = await post('/api/iap/order', { sku: 'no-such-sku', playerId: 'LN-TESTER' });
ok('unknown sku rejected', o3.code === 400);
const v0 = await post('/api/iap/verify', { transactionId: o1.json.transactionId });
ok('verify before payment → pending, unsettled', v0.code === 200 && v0.json.settled === false && v0.json.status === 'pending');

console.log('\n=== CALLBACK LEDGER ===');
const orderId = o1.json.transactionId;
const bad = await post('/api/iap/callback', { order_id: orderId, status_code: '200', gross_amount: '19000', transaction_status: 'settlement', signature: 'deadbeef' });
ok('forged callback rejected (401, nothing granted)', bad.code === 401);
const vAfterForgery = await post('/api/iap/verify', { transactionId: orderId });
ok('store untouched by the forgery', vAfterForgery.json.settled === false);

const good = await post('/api/iap/callback',
  { order_id: orderId, status_code: '200', gross_amount: '19000', transaction_status: 'settlement' },
  signCb(orderId, '200', '19000'));
ok('signed settlement callback accepted', good.code === 200 && good.text.trim() === 'OK');
const v1 = await post('/api/iap/verify', { transactionId: orderId });
ok('verify now settles (callback is truth, no re-poll needed)', v1.json.settled === true && v1.json.receipt === orderId);
const replay = await post('/api/iap/callback',
  { order_id: orderId, status_code: '200', gross_amount: '19000', transaction_status: 'settlement' },
  signCb(orderId, '200', '19000'));
const l1 = await post('/api/iap/ledger', { playerId: 'LN-TESTER' });
ok('replay-safe: duplicate callback does not duplicate the ledger', replay.code === 200 && l1.json.ledger.length === 1);
const l2 = await post('/api/iap/ledger', { playerId: 'LN-SOMEONE-ELSE' });
ok('ledger is per-player', l2.json.ledger.length === 0);

const refund = await post('/api/iap/callback',
  { order_id: orderId, status_code: '204', gross_amount: '19000', transaction_status: 'refund' },
  signCb(orderId, '204', '19000'));
const l3 = await post('/api/iap/ledger', { playerId: 'LN-TESTER' });
ok('refund revokes the grant (ledger drops it, replay-safe)', refund.code === 200 && l3.json.ledger.length === 0);

const oDel = await post('/api/iap/order', { sku: 'pouch', playerId: 'LN-DELETE' });
const delId = oDel.json.transactionId;
const sigKey = crypto.createHash('sha512').update(`${delId}20019000${SERVER_KEY}`).digest('hex');
const bodySigned = await post('/api/iap/callback', {
  order_id: delId, status_code: '200', gross_amount: '19000', transaction_status: 'settlement', signature_key: sigKey,
});
const lDel = await post('/api/iap/ledger', { playerId: 'LN-DELETE' });
ok('signature_key in the body settles, without x-signature', bodySigned.code === 200 && lDel.json.ledger.length === 1);
const wiped = await post('/api/privacy/delete', { playerId: 'LN-DELETE' });
const lGone = await post('/api/iap/ledger', { playerId: 'LN-DELETE' });
ok('delete drops that device id and leaves other players', wiped.code === 200 && wiped.json.deleted === 1 && lGone.json.ledger.length === 0);

console.log('\n=== ADMOB SSV ===');
const ssvPayload = {
  custom_data: 'player:LN-TESTER;placement:revive',
  transaction_id: 'ad-tx-777',
  data: 'some-opaque-admob-data',
  reward_item_type: 'second_blood',
  reward_amount: '1',
};
const signed = [ssvPayload.data, ssvPayload.transaction_id, ssvPayload.custom_data, ssvPayload.reward_item_type, ssvPayload.reward_amount].join('\n');
const signature = crypto.sign('sha1', Buffer.from(signed, 'utf8'), privateKey).toString('base64');
const a1 = await post('/api/ads/verify?' + new URLSearchParams({ ...ssvPayload, key: stubBase + '/pubkey.pem', signature }).toString(), '');
ok('valid SSV grant verified', a1.code === 200 && a1.json?.ok === true && a1.json?.verified === true);
const a2 = await post('/api/ads/verify?' + new URLSearchParams({ ...ssvPayload, key: stubBase + '/pubkey.pem', signature }).toString(), '');
ok('SSV replay flagged, not re-granted', a2.code === 200 && a2.json?.replay === true);
const a3 = await post('/api/ads/verify?' + new URLSearchParams({ ...ssvPayload, transaction_id: 'other', key: stubBase + '/pubkey.pem', signature }).toString(), '');
ok('tampered payload fails the signature (401)', a3.code === 401);
const a4 = await post('/api/ads/verify?' + new URLSearchParams({ ...ssvPayload, key: 'http://evil.example.com/pubkey.pem', signature }).toString(), '');
ok('key URL outside the allow-list is refused (403)', a4.code === 403);

console.log('\n=== MISCONFIG ===');
const bare = createIapServer({ serverKey: '', dataFile: DATA + '.bare', snapUrl: stubBase + '/snap/v1/transactions' });
await new Promise((r) => bare.httpServer.listen(0, '127.0.0.1', r));
const r503 = await fetch(`http://127.0.0.1:${bare.httpServer.address().port}/api/iap/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok('no server key → order answers 503, never half-configured', r503.status === 503);
bare.httpServer.close();

app.httpServer.close();
stub.close();
try { fs.unlinkSync(DATA); fs.unlinkSync(DATA + '.bare'); } catch (e) { /* ok */ }

console.log(fails === 0 ? '\nIAP server: all PASS' : `\nIAP server: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
