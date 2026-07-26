/* Prismatix service worker — conservative, offline-friendly, auth-safe.
 *
 * Rules:
 *  - NEVER touch /api/* — authenticated data & auth flows must always be live.
 *  - App shell (navigations) → network-first, fall back to cached index.html
 *    when offline so the SPA still boots.
 *  - Content-hashed static assets (/assets/*, icons, fonts) → cache-first;
 *    new deploys ship new hashes, so this is always fresh yet instant.
 *
 * Bump CACHE when the caching strategy itself changes; old caches are pruned
 * on activate.
 */
const CACHE = 'prima-v3';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([SHELL, '/'])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin only; never intercept the API or cross-origin calls.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // App shell / SPA routes → network-first with cached-shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets → cache-first, then populate.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit),
    ),
  );
});

/* --- Web-push (chat notifications) ------------------------------------------------------------ */

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Prismatix';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.conversationId ? 'prima-chat-' + data.conversationId : 'prima-chat',
      renotify: true,
      data: { url: data.url || '/messages' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/messages';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          try { await client.navigate(url); } catch (e) { /* not allowed — just focus */ }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
