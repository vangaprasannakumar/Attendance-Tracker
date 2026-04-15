const CACHE_NAME = 'capco-hrms-v4-20250408';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return;
  }

  const isDynamicAsset =
    requestUrl.pathname.includes('weights') ||
    requestUrl.hostname.includes('jsdelivr') ||
    requestUrl.hostname.includes('fonts.googleapis.com') ||
    requestUrl.hostname.includes('fonts.gstatic.com');

  if (isDynamicAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(event.request)
          .then((networkResponse) => {
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')
            ) {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          })
          .catch(() => {
            return new Response(
              JSON.stringify({ error: 'Offline — resource not cached yet.' }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type === 'opaque'
          ) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          if (event.request.destination === 'document') {
            return new Response(
              `<!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Capco HRMS — Offline</title>
                <style>
                  body { font-family: sans-serif; background: #09090b; color: #f4f4f5;
                         display: flex; flex-direction: column; align-items: center;
                         justify-content: center; height: 100vh; margin: 0; text-align: center; }
                  h2 { color: #ef4444; } p { color: #a1a1aa; font-size: 15px; }
                  button { margin-top: 20px; padding: 14px 28px; background: #3b82f6;
                           color: white; border: none; border-radius: 12px; font-size: 16px;
                           cursor: pointer; }
                </style>
              </head>
              <body>
                <h2>🔴 You are offline</h2>
                <p>The app could not be loaded from cache.<br>Please connect to the internet and reload.</p>
                <button onclick="location.reload()">Retry</button>
              </body>
              </html>`,
              {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
              }
            );
          }
          return new Response(
            JSON.stringify({ error: 'Offline — resource not cached.' }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        });
    })
  );
});


self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-punches') {
    event.waitUntil(syncPendingPunches());
  }
});

async function syncPendingPunches() {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (allClients.length > 0) {
    allClients.forEach(client => {
      client.postMessage({ type: 'TRIGGER_SYNC' });
    });
  }
}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
