// ─── CACHE VERSION ────────────────────────────────────────────────────────────
// [E12] Cache name is now split into a stable prefix + a date stamp.
// On every deploy: update CACHE_DATE only. Grep for it, change one line, done.
// The SW's activate handler deletes every cache whose name != CACHE_NAME,
// so bumping this date guarantees all clients pick up the new build on next visit..
const CACHE_VERSION = 'capco-hrms-v5';
const CACHE_DATE    = '20250421';           // ← bump this on every deploy
const CACHE_NAME    = `${CACHE_VERSION}-${CACHE_DATE}`;

// ─── APP SHELL ────────────────────────────────────────────────────────────────
// These are the files the app absolutely cannot run without.
// cache.addAll() is all-or-nothing — if any URL here fails to fetch, the SW
// install fails and the browser retries on the next page load.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// ─── AI ASSETS ────────────────────────────────────────────────────────────────
// [U4] Model weight files are now pre-cached at install time.
//
// Previously only face-api.js was cached. The weight files (the actual neural
// network data) were fetched on demand and only cached after first use.
// This meant:
//   - The kiosk could not recognise faces on first offline visit.
//   - Each fresh kiosk session fetched ~6 MB of model data from the CDN.
//
// Now all seven weight files are fetched and stored during SW install alongside
// the library itself. After the first online visit, the kiosk is fully airgapped.
//
// These are pre-cached BEST-EFFORT (separate try/catch from the shell) — if
// the CDN is unreachable at install time, the SW still installs successfully
// and the weights will be cached dynamically on first use instead.
const AI_ASSETS = [
  // Library
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',

  // TinyFaceDetector — bounding box detection
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-shard1',

  // FaceLandmark68Net — 68-point landmark localisation
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-shard1',

  // FaceRecognitionNet — 128-dimension descriptor (split across two shards)
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard1',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard2'
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
// Shell assets are cached with addAll() — failure here aborts the install.
// AI assets are cached individually and best-effort — any single CDN failure
// is caught and logged, the install continues, and that file will be fetched
// and cached dynamically on first use instead.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // Step 1: Cache the app shell — must succeed
        await cache.addAll(SHELL_ASSETS);

        // Step 2: Cache AI assets — best effort, non-blocking
        const aiResults = await Promise.allSettled(
          AI_ASSETS.map(url =>
            fetch(url)
              .then(response => {
                if (
                  response &&
                  response.status === 200 &&
                  (response.type === 'basic' || response.type === 'cors')
                ) {
                  return cache.put(url, response);
                }
              })
              .catch(err => {
                console.warn(`[SW] Could not pre-cache AI asset: ${url}`, err);
              })
          )
        );

        const cached  = aiResults.filter(r => r.status === 'fulfilled').length;
        const skipped = aiResults.filter(r => r.status === 'rejected').length;
        console.log(`[SW] AI assets: ${cached} cached, ${skipped} deferred to runtime.`);
      })
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
// Delete every cache that is not the current CACHE_NAME.
// This automatically cleans up all previous versions (v1, v2, v3, v4, etc.)
// so stale assets are never served after a deploy.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Always pass POST requests through to the network — Google Apps Script API calls.
  // Never try to cache or intercept them.
  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Dynamic assets: CDN resources (face-api.js, weight files, Google Fonts).
  // Strategy: Cache-first with network fallback and runtime caching.
  // [U4] Weight files now hit the cache immediately on first request (pre-cached
  // at install). Font files still fall through to network on first visit and
  // get cached for subsequent offline use.
  const isDynamicAsset =
    requestUrl.pathname.includes('weights') ||
    requestUrl.hostname.includes('jsdelivr')   ||
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
          .catch(() =>
            new Response(
              JSON.stringify({ error: 'Offline — resource not cached yet.' }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
              }
            )
          );
      })
    );
    return;
  }

  // All other requests: Cache-first with network fallback.
  // Covers the app shell (index.html, manifest.json) and anything else
  // the browser requests. Unknown resources are cached on first fetch.
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
          // Document requests get a full offline HTML page.
          // All other requests (scripts, images, etc.) get a JSON error body.
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
    h2 { color: #ef4444; }
    p  { color: #a1a1aa; font-size: 15px; }
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

// ─── BACKGROUND SYNC ──────────────────────────────────────────────────────────
// Fires the 'sync-punches' tag when the browser regains connectivity,
// even if the app tab is closed (Chrome/Android only).
// The SW cannot call the Google API directly — it posts a message to all open
// clients and lets index.html run the syncOfflineData() call with the full
// pending queue from localStorage.
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

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
// Allows the app to trigger an immediate SW update without a page reload.
// index.html can call:
//   navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
