/* LAST NIGHT — the service worker, off the page and into a sandbox.
 *
 * sw.js is the one file in the Play bundle that sits between the player and
 * money: it is handed every request the game makes, including /api/order and
 * /api/privacy/delete. A cache that answers one of those is worse than a
 * service worker that does nothing at all. So it is tested here, in Node,
 * against a fake cache and a fake network — no browser, no device.
 *
 *   node tools/swtest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let bad = 0;
const ok = (b, msg, note) => {
  if (!b) bad++;
  console.log(`  ${b ? 'PASS' : 'FAIL'}  ${msg}${note ? ` — ${note}` : ''}`);
};

/* ---------- a fake Cache Storage, a fake network ---------- */
const stores = new Map();                       // name -> Map(url -> Response)
const net = { calls: [], handler: null };

function makeCache(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async add(url) { m.set(url, await fakeFetch(url)); },
    async put(req, res) { m.set(typeof req === 'string' ? req : req.url, res.clone()); },
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      return m.get(key) || null;
    },
  };
}

async function fakeFetch(url) {
  net.calls.push(url);
  if (net.handler) return net.handler(url);
  // Serve the real files, so the assertions are about the game and not a stub.
  const rel = decodeURIComponent(new URL(url, 'https://lastnight.example').pathname).replace(/^\//, '');
  const file = path.join(ROOT, rel);
  if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  return new Response('body-of-' + url, { status: 200 });
}

const handlers = {};
const sandbox = {
  console,
  Response, Request, URL, TextEncoder, TextDecoder,
  caches: {
    async open(name) { return makeCache(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { stores.delete(name); },
    async match(req) {
      for (const m of stores.values()) {
        const hit = m.get(typeof req === 'string' ? req : req.url);
        if (hit) return hit;
      }
      return null;
    },
  },
  fetch: (req) => fakeFetch(typeof req === 'string' ? req : req.url),
  navigator: { language: 'en-US' },
  location: { origin: 'https://lastnight.example', protocol: 'https:' },
  setTimeout, clearTimeout,
  self: {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: { origin: 'https://lastnight.example' },
  },
};
sandbox.self.location = sandbox.location;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: 'sw.js' });

const fire = (type, req) => new Promise((resolve) => {
  const event = {
    request: req,
    respondWith: (p) => resolve(p),
    waitUntil: (p) => { p.then(resolve).catch(resolve); },
  };
  handlers[type](event);
});

const req = (url, opts = {}) => ({
  url, method: opts.method || 'GET', mode: opts.mode || 'no-cors',
  clone() { return req(url, opts); },
});

console.log('LAST NIGHT — service worker\n');

/* ---------- install ---------- */
await fire('install', null);
const cacheNames = [...stores.keys()];
ok(cacheNames.length === 1, `install opens one cache (${cacheNames[0] || 'none'})`);
const shell = stores.get(cacheNames[0]);
ok(shell && shell.size >= 8, `the shell is precached (${shell ? shell.size : 0} entries)`);
ok(!!(shell && shell.get('./offline.html')), 'offline.html is in it');

/* ---------- activate ---------- */
stores.set('lastnight-old', new Map([['./junk', new Response('junk')]]));
await fire('activate', null);
ok(!stores.has('lastnight-old'), 'activate drops a cache from an older version');

/* ---------- what must never be touched ---------- */
net.calls.length = 0;
let responded = false;
const postEvent = { request: req('https://lastnight.example/api/order', { method: 'POST' }), respondWith: () => { responded = true; } };
handlers.fetch(postEvent);
ok(!responded, 'a POST is not answered at all (no payment call is ever cached)');

responded = false;
handlers.fetch({ request: req('https://lastnight.example/api/privacy/delete'), respondWith: () => { responded = true; } });
ok(!responded, 'GET /api/privacy/delete is not answered either');

responded = false;
handlers.fetch({ request: req('https://midtrans.example/snap'), respondWith: () => { responded = true; } });
ok(!responded, 'a cross-origin request is left to the browser');

/* ---------- assets: cache first, refresh behind ---------- */
const glb = 'https://lastnight.example/hunter_run_walk_claw_sword_shot.glb';
net.handler = async () => new Response('glb-bytes', { status: 200 });
let res = await fire('fetch', req(glb));
ok(!!res, 'a same-origin asset is answered');
ok(res && (await res.text()) === 'glb-bytes', 'and the first answer is the network one');
await new Promise((r) => setTimeout(r, 20));   // let the background put land
ok(!!shell.get(glb), 'then it is written to the cache');

net.calls.length = 0;
net.handler = async () => new Response('glb-bytes-v2', { status: 200 });
res = await fire('fetch', req(glb));
ok(!!res, 'a second visit is answered');
ok(res && (await res.text()) === 'glb-bytes', 'and the cached copy comes back first');
await new Promise((r) => setTimeout(r, 20));
ok(!!shell.get(glb), 'while the network copy refreshes in the background');

/* ---------- navigation, with the network gone ---------- */
net.handler = async () => { throw new Error('offline'); };
res = await fire('fetch', req('https://lastnight.example/index.html', { mode: 'navigate' }));
const offlineHtml = res ? await res.text() : '';
ok(!!res, 'a navigation offline is still answered');
ok(/<canvas id="game"|Last Night/.test(offlineHtml),
  'and what comes back is the game itself — the house plays with no network');

// Now with nothing behind it: a first-ever launch, offline. That is the one
// case the offline page exists for.
shell.delete('./index.html');
res = await fire('fetch', req('https://lastnight.example/index.html', { mode: 'navigate' }));
const fallback = res ? await res.text() : '';
ok(!!res, 'a first launch offline is answered too');
ok(/Last Night/.test(fallback) && !/<canvas id="game"/.test(fallback),
  'with the offline page, because there is no game on the phone yet');

net.handler = null;
console.log(`\n${bad === 0 ? 'service worker: all PASS' : `service worker: ${bad} FAILED`}\n`);
process.exit(bad === 0 ? 0 : 1);
