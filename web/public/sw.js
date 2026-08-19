/* TarangOS service worker.
 *
 * Deliberately conservative: the app shell is cached so it opens instantly and
 * survives a dropped Wi-Fi connection, but API responses are NEVER cached —
 * your task data should not sit in a cache the browser might hand to someone
 * else, and stale productivity numbers are worse than none.
 */

const VERSION = 'tarangos-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = [
  '/',
  '/theme-init.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'clear-caches') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API — always go to the network.
  if (url.pathname.startsWith('/api/')) return;

  // Hashed build assets are immutable: cache-first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: network-first so a deploy is picked up, cache as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || offlineResponse())),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

function offlineResponse() {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>TarangOS — offline</title>
     <style>
       body{font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;
            justify-content:center;margin:0;background:#0a0b0f;color:#e8ecf5;text-align:center;padding:2rem}
       h1{font-size:1.125rem;margin:0 0 .5rem}
       p{color:#919cb0;font-size:.875rem;margin:0 0 1.5rem;line-height:1.6}
       button{background:#818cf8;color:#0c0d14;border:0;border-radius:.75rem;padding:.65rem 1.25rem;
              font-size:.875rem;font-weight:600;cursor:pointer}
     </style></head>
     <body><div>
       <h1>TarangOS is offline</h1>
       <p>Your laptop or server isn't reachable right now.<br>Your data is safe — it lives on that machine.</p>
       <button onclick="location.reload()">Try again</button>
     </div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 },
  );
}

// Notification clicks focus the app rather than opening a duplicate tab, and
// jump straight to the relevant screen (the morning agenda opens Today).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && target !== '/') {
            return client.navigate(target).then((c) => (c ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
