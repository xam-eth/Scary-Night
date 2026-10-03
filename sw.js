/* LAST NIGHT — the service worker.
 *
 * Two jobs, in this order:
 *
 *  1. Make the game installable. Chrome will not offer "Install" — and
 *     Bubblewrap will not call the site a PWA — without a fetch handler.
 *
 *  2. Make a second night load like a second night. Everything the game is
 *     (the vendored three.js, the three character GLBs, the photographed
 *     rooms, the kit) is static and same-origin, so after one full play the
 *     whole house is already on the phone. A TWA that has to fetch the
 *     hunter GLB before it can draw her is a TWA that shows a black screen.
 *
 * What it must never do: cache a payment call. The web rail talks to
 * /api/order, /api/verify and /api/privacy/delete. Those are POSTs with
 * money in them, and a cached answer to any of them is worse than no answer.
 * Nothing but a plain same-origin GET is ever stored, and /api/ is not even
 * looked at.
 *
 * Bump VERSION when the deployed site changes in a way players must see
 * (see docs/PLAY-BUNDLE.md) — the old cache is dropped on activate.
 */

const VERSION = 'lastnight-v1';
const CACHE = VERSION;

/* The shell: what has to be there for the first paint on a cold start.
 * index.html is listed rather than precached-and-forgotten because the game
 * boots through it; the rest of the app is cached as it is fetched. */
const SHELL = [
  './index.html',
  './styles.css',
  './offline.html',
  './manifest.webmanifest',
  './assets/brand/icon-192.png',
  './assets/brand/icon-512.png',
  './assets/brand/icon-maskable-512.png',
  './assets/brand/loading-9x16.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not fail the install — a partial shell still
    // beats no service worker, and the runtime fill picks the rest up.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim().catch(() => {});
  })());
});

const sameOrigin = (url) => url.origin === self.location.origin;
const isAsset = (url) => /\.(js|mjs|css|png|jpe?g|svg|webp|glb|gltf|bin|woff2?|json|mp3|ogg|wav)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // payments live here
  const url = new URL(req.url);
  if (!sameOrigin(url)) return;                           // never cache a third party
  if (url.pathname.startsWith('/api/')) return;           // never cache money

  /* Navigations: the network wins, because a stale index.html can point at
   * module files that no longer exist. Offline, the last good one is served,
   * and failing that, the offline page. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        const cached = (await cache.match('./index.html')) || (await cache.match('./offline.html'));
        return cached || new Response('<h1>offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  if (!isAsset(url)) return;

  /* Assets are immutable by name in this project: cache first, refresh in the
   * background so the next boot has it. */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (cached) return cached;
    const res = await network;
    return res || new Response('', { status: 504 });
  })());
});
