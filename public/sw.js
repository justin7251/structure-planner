/*
 * Structure Planner service worker (production only).
 *
 * Update-safety rules (the "stuck PWA after an update" bug):
 *   1. The cache name is bumped with every release — activate() purges
 *      anything older, so stale chunks can never outlive a deploy.
 *   2. Navigations bypass the HTTP cache (`cache: 'no-cache'`) so a new
 *      deploy's index.html — and therefore its new hashed chunks — is
 *      always picked up on the next launch, even on hosts that send
 *      aggressive Cache-Control headers.
 *   3. `/_next/static/*` is content-hashed and immutable → cache-first
 *      (fast cold boots; purge on version bump keeps it honest).
 *   4. skipWaiting() + clients.claim() let a freshly downloaded update
 *      take over immediately; the app reloads once on controllerchange
 *      (see app-shell registration) so old HTML never runs new chunks.
 */
const CACHE = 'structure-planner-v27';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger the takeover explicitly (update toast flow).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  // Immutable, content-hashed build assets → cache-first.
  const url = new URL(request.url);
  const isStaticAsset = url.pathname.startsWith('/_next/static/');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      )
    );
    return;
  }

  // Everything else (navigations, manifest, sw.js-adjacent files) →
  // network-first with a fresh read that skips the HTTP cache for
  // navigations, falling back to the cached shell when offline.
  const cacheMode = request.mode === 'navigate' ? 'no-cache' : undefined;
  event.respondWith(
    fetch(request, { cache: cacheMode })
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request, { ignoreSearch: request.mode === 'navigate' })
          .then((cached) => cached ?? caches.match('/'))
      )
  );
});
