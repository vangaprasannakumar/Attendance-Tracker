// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// IMPORTANT: Paste your exact Google Apps Script Web App URL here.
// The Service Worker needs this to sync offline punches in the background.
const GOOGLE_API_URL = "https://script.google.com/macros/s/AKfycbzsV8eP3nMkVUva7WwHkDKi820Mv0BEm0kTxxM__EamMerhKdhxQJKtVRA0mSI0_EjK/exec";

// Cache naming and versioning
const CACHE_VERSION = 'capco-hrms-v6';
const CACHE_DATE    = '20260422';           // ← bump this on every deploy
const CACHE_NAME    = `${CACHE_VERSION}-${CACHE_DATE}`;

// IndexedDB Configuration for true Background Sync
const DB_NAME = 'CapcoOfflineDB';
const STORE_NAME = 'pending_punches';

// ─── APP SHELL & AI ASSETS ────────────────────────────────────────────────────
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

const AI_ASSETS = [
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/tiny_face_detector_model-shard1',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_landmark_68_model-shard1',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard1',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/face_recognition_model-shard2'
];

// ─── INDEXED DB HELPER (For Service Worker) ──────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPendingPunches() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearPendingPunches() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ─── LIFECYCLE: INSTALL ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // 1. Mandatory Shell Assets
        await cache.addAll(SHELL_ASSETS);

        // 2. Best-Effort AI Assets
        const aiResults = await Promise.allSettled(
          AI_ASSETS.map(url =>
            fetch(url).then(response => {
              if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
                return cache.put(url, response);
              }
            }).catch(err => console.warn(`[SW] AI cache deferred: ${url}`))
          )
        );
        console.log(`[SW] Install complete. Ready to serve.`);
      })
      .then(() => self.skipWaiting())
  );
});

// ─── LIFECYCLE: ACTIVATE ──────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            // [FIX] Only delete caches that belong to this specific app to prevent nuking other apps
            if (name.startsWith('capco-hrms') && name !== CACHE_NAME) {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── NETWORK ROUTING: FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Pass Google API POST requests directly to network
  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Dynamic CDN Assets (AI weights, Fonts) -> Cache First, Network Fallback
  const isDynamicAsset =
    requestUrl.pathname.includes('weights') ||
    requestUrl.hostname.includes('jsdelivr')   ||
    requestUrl.hostname.includes('fonts.googleapis.com') ||
    requestUrl.hostname.includes('fonts.gstatic.com');

  if (isDynamicAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return networkResponse;
        }).catch(() => new Response(JSON.stringify({ error: 'Offline - resource not cached.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      })
    );
    return;
  }

  // 3. App Shell (HTML, Manifest) -> Stale-While-Revalidate
  // [UPGRADE] This ensures the UI loads instantly from cache, but updates silently in the background for the next visit.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        if (event.request.destination === 'document' && !cachedResponse) {
          return generateOfflineHTML();
        }
      });

      // Return cached immediately if available, while fetchPromise runs in the background
      return cachedResponse || fetchPromise;
    })
  );
});

// ─── TRUE BACKGROUND SYNC ─────────────────────────────────────────────────────
// [UPGRADE] This event fires when the OS detects an internet connection, even if the tab is closed.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-punches') {
    console.log('[SW] Background sync triggered by OS.');
    event.waitUntil(processBackgroundSync());
  }
});

async function processBackgroundSync() {
  if (GOOGLE_API_URL === "YOUR_GOOGLE_SCRIPT_WEB_APP_URL_HERE") {
    console.error("[SW] Cannot sync: GOOGLE_API_URL is missing.");
    return;
  }

  try {
    const punches = await getPendingPunches();
    if (!punches || punches.length === 0) return;

    console.log(`[SW] Attempting to sync ${punches.length} punches...`);

    // We extract the token from the first punch (assuming they share the same session)
    const tokenContext = punches[0]._token ? { _token: punches[0]._token, _u: punches[0]._u } : {};
    
    // Strip the internal IndexedDB ID and token metadata before sending
    const payloadPunches = punches.map(p => {
      const clean = { ...p };
      delete clean.id; delete clean._token; delete clean._u;
      return clean;
    });

    const payload = {
      action: 'syncOfflineData',
      pending: payloadPunches,
      ...tokenContext
    };

    const response = await fetch(GOOGLE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result && result.status === 'success') {
      console.log(`[SW] Sync successful. Clearing IndexedDB.`);
      await clearPendingPunches();
      
      // Notify any open clients that sync is complete so UI updates
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE', details: result }));
    } else {
      throw new Error(result.message || 'Server rejected sync payload.');
    }
  } catch (error) {
    console.error('[SW] Background sync failed. Will retry later.', error);
    throw error; // Throwing tells the browser to schedule another sync attempt later
  }
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function generateOfflineHTML() {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Capco HRMS — Offline</title><style>body { font-family: sans-serif; background: #09090b; color: #f4f4f5; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; } h2 { color: #ef4444; } p { color: #a1a1aa; font-size: 15px; } button { margin-top: 20px; padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 12px; font-size: 16px; cursor: pointer; }</style></head><body><h2>🔴 You are offline</h2><p>The app could not be loaded from cache.<br>Please connect to the internet and reload.</p><button onclick="location.reload()">Retry</button></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
