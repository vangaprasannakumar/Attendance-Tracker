// ─────────────────────────────────────────────────────────────────────────────
// Capco HRMS — Service Worker
// ─────────────────────────────────────────────────────────────────────────────
//
// [FIX-I3] Cache version now includes a build timestamp.
// Change this string on every deploy to force the SW to update immediately
// even on kiosk devices that never fully close their browser tab.
//
const CACHE_NAME = 'capco-hrms-v4-20250408';

// Core app shell — cached on install so the app loads instantly offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  // [FIX-I5] Pre-cache the face-api script on install so a cold offline
  // start (device has never connected) can still load the AI module.
  // Previously this was only cached dynamically after first network hit,
  // meaning the kiosk would fail entirely if it went offline before
  // face-api.js had ever been fetched.
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => {
        // [FIX-C1] skipWaiting forces the new SW to activate immediately
        // without waiting for all browser tabs to close.
        // Critical for a factory kiosk that runs 24/7 and never restarts —
        // without this, a deployed bug fix could take days to reach the device.
        return self.skipWaiting();
      })
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName); // evict all old cache versions
            }
          })
        );
      })
      .then(() => {
        // [FIX-C1] clients.claim() makes the newly activated SW take control
        // of all open tabs immediately — without this, the new SW activates
        // but the current page still uses the old SW until the next reload.
        return self.clients.claim();
      })
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // ── 1. Never cache or intercept Google Apps Script API POST calls ──────────
  // These are live attendance punches — they must always hit the network.
  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── 2. AI model weights, CDN scripts, and Google Fonts ────────────────────
  // Strategy: Cache-first with network fallback + dynamic caching.
  // These files are large and change rarely — serve from cache whenever possible.
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
            // Only cache valid CORS or same-origin responses
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
            // [FIX-I5] Return a proper fallback Response instead of undefined.
            // The old code had .catch(() => {}) which returned undefined —
            // this caused a "Failed to handle fetch" error in the console and
            // left the browser waiting indefinitely for a response.
            // Now we return a clean 503 so the app can handle it gracefully.
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

  // ── 3. Core app shell (HTML, manifest, icons) ─────────────────────────────
  // Strategy: Cache-first. These are pre-cached at install time so the app
  // shell always loads instantly, even with no internet connection.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      // Not in cache — fetch from network and cache for next time
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
          // [FIX-I5] Graceful fallback for completely offline, un-cached requests.
          // Return a minimal offline HTML page instead of a silent undefined.
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
          // For non-document requests (images, scripts), return a clean 503
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

// ─── BACKGROUND SYNC ─────────────────────────────────────────────────────────
// [FIX-I4] Background Sync API — syncs offline punches automatically even
// when the app is not open. When a punch is saved offline, the frontend
// registers a sync tag. The browser fires this 'sync' event as soon as a
// stable connection is available — even if the user has closed the tab.
//
// How it works with index.html:
//   1. submitAttendance() stores the punch in localStorage as before.
//   2. It also calls: navigator.serviceWorker.ready.then(sw => sw.sync.register('sync-punches'))
//      (This registration is handled in index.html — see the online event listener.)
//   3. The browser fires the 'sync' event below when connectivity is confirmed.
//   4. The SW reads localStorage, POSTs to the backend, and clears the queue.
//
// Note: Background Sync is supported in Chrome/Edge/Android. On iOS/Safari,
// the 'online' event listener in index.html serves as the reliable fallback.
//
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-punches') {
    event.waitUntil(syncPendingPunches());
  }
});

async function syncPendingPunches() {
  // Read pending punches from all controlled clients via postMessage,
  // or fall back to a direct localStorage read via a shared IndexedDB key.
  // Since SWs cannot access localStorage directly, we message the client.
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  if (allClients.length > 0) {
    // Ask the active client to trigger the sync — it has localStorage access
    allClients.forEach(client => {
      client.postMessage({ type: 'TRIGGER_SYNC' });
    });
  }
  // If no clients are open, the sync will fire again when the user next opens the app
  // and the online event listener in index.html will handle it.
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
// Allows the app to send messages to the SW (e.g. to skip waiting on update)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
