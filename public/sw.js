/**
 * Service worker (phase 11 - PWA).
 *
 * Strategy:
 *   - app pages (/...)          network-first, offline.html as fallback
 *   - static assets (/static)   cache-first with background refill
 *
 * Data is never cached: list contents, search results and chart data must
 * never be served stale from a phone on the road.
 */
const STATIC_CACHE = 'erwin-static-v9';
const PAGE_CACHE = 'erwin-pages-v9';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.add('/offline.html')).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Static assets: serve cached content immediately, but refresh it on every
  // request so UI deployments do not remain stuck behind an old PWA cache.
  if (url.pathname.startsWith('/static/') || /\.(png|css|js|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req).then((response) => {
          if (response.ok) cache.put(req, response.clone());
          return response;
        });
        return hit || fresh;
      })
    );
    return;
  }

  // Pages: network-first, offline page as the honest fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.open(PAGE_CACHE).then((cache) => cache.match('/offline.html')))
    );
  }
});
