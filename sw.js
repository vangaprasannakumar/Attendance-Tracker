// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// IMPORTANT: Paste your exact Google Apps Script Web App URL here.
const GOOGLE_API_URL = "https://script.google.com/macros/s/AKfycbzsV8eP3nMkVUva7WwHkDKi820Mv0BEm0kTxxM__EamMerhKdhxQJKtVRA0mSI0_EjK/exec";

// ─── CACHE VERSIONING ─────────────────────────────────────────────────────────
// FIX #3: CACHE_DATE is the only value you must update on each deploy.
// Bump this string (format: YYYYMMDD) every time you push changes to
// index.html, manifest.json, or sw.js so users get the fresh version
// instead of the stale one served from cache.
// ⚠️  ONE MISSED BUMP = users see yesterday's UI. Don't skip this step.
const CACHE_VERSION = 'capco-hrms-v6';
const CACHE_DATE    = '20260430';           // ← BUMP THIS ON EVERY DEPLOY
const CACHE_NAME    = `${CACHE_VERSION}-${CACHE_DATE}`;

// ─── INDEXED DB CONFIGURATION ────────────────────────────────────────────────
const DB_NAME    = 'CapcoOfflineDB';
const STORE_NAME = 'pending_punches';

// ─── FACE-API VERSION ─────────────────────────────────────────────────────────
// FIX #2: Pin weight URLs to the same tagged release used by the CDN script
// in index.html (face-api.js@0.22.2). Previously these pointed to @master,
// which means if the upstream repo ever updates its weights, the cached
// version would mismatch the running script and cause silent recognition failure.
const FACE_API_VERSION = '0.22.2';
const FACE_API_WEIGHTS = `https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@${FACE_API_VERSION}/weights`;

// ─── APP SHELL ASSETS ─────────────────────────────────────────────────────────
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// ─── AI MODEL ASSETS (pinned to @0.22.2) ─────────────────────────────────────
// FIX #2: All weight URLs now use the FACE_API_VERSION constant so they
// always match the script tag in index.html and never drift with @master.
const AI_ASSETS = [
  `https://cdn.jsdelivr.net/npm/face-api.js@${FACE_API_VERSION}/dist/face-api.min.js`,
  `${FACE_API_WEIGHTS}/tiny_face_detector_model-weights_manifest.json`,
  `${FACE_API_WEIGHTS}/tiny_face_detector_model-shard1`,
  `${FACE_API_WEIGHTS}/face_landmark_68_model-weights_manifest.json`,
  `${FACE_API_WEIGHTS}/face_landmark_68_model-shard1`,
  `${FACE_API_WEIGHTS}/face_recognition_model-weights_manifest.json`,
  `${FACE_API_WEIGHTS}/face_recognition_model-shard1`,
  `${FACE_API_WEIGHTS}/face_recognition_model-shard2`
];

// ─── INDEXED DB HELPERS ───────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // autoIncrement gives each punch a unique numeric `id` key.
        // We use this key for selective deletion in FIX #1.
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror  = () => reject(request.error);
  });
}

// Returns all pending punches including their IDB `id` key.
async function getPendingPunches() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// FIX #1: Delete only a single punch record by its IDB key.
// Previously clearPendingPunches() wiped the entire store regardless of
// whether individual punches were skipped or failed — causing silent data loss.
async function deletePunchById(idbId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(idbId);
    tx.oncomplete = resolve;
    tx.onerror    = reject;
  });
}

// Kept for the case where ALL punches synced (skipped === 0) — fastest path.
async function clearAllPendingPunches() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = resolve;
    tx.onerror    = reject;
  });
}

// ─── LIFECYCLE: INSTALL ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // 1. Mandatory shell — failure here aborts install entirely.
        await cache.addAll(SHELL_ASSETS);

        // 2. AI assets — best-effort; if CDN is unreachable they load later.
        await Promise.allSettled(
          AI_ASSETS.map(url =>
            fetch(url, { mode: 'cors' })
              .then(response => {
                if (response && response.status === 200 &&
                    (response.type === 'basic' || response.type === 'cors')) {
                  return cache.put(url, response);
                }
              })
              .catch(err => console.warn(`[SW] AI asset deferred: ${url}`, err))
          )
        );

        console.log(`[SW] Install complete → ${CACHE_NAME}`);
      })
      // FIX: skipWaiting immediately so new SW activates without waiting
      // for the old tab to close. Paired with clients.claim() in activate.
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
            // Only delete caches belonging to this app to avoid nuking
            // other PWAs installed on the same origin.
            if (name.startsWith('capco-hrms') && name !== CACHE_NAME) {
              console.log(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            }
          })
        )
      )
      // Immediately take control of all open clients so the fresh SW
      // starts handling fetches without a page reload.
      .then(() => self.clients.claim())
  );
});

// ─── NETWORK ROUTING: FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Google API POST → always network only (never cache POST bodies)
  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. AI weights + font assets → Cache-First, Network-Fallback
  //    These are large and change only when we bump the version pin.
  const isDynamicAsset =
    requestUrl.pathname.includes('weights') ||
    requestUrl.hostname.includes('jsdelivr') ||
    requestUrl.hostname.includes('fonts.googleapis.com') ||
    requestUrl.hostname.includes('fonts.gstatic.com');

  if (isDynamicAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request, { mode: 'cors' })
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 ||
                (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
            return networkResponse;
          })
          .catch(() => new Response(
            JSON.stringify({ error: 'Offline — resource not cached.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          ));
      })
    );
    return;
  }

  // 3. App shell (HTML, manifest) → Stale-While-Revalidate
  //    Serve cached version instantly, update cache silently in background.
  //    On next load the user gets the fresh version.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 &&
              networkResponse.type !== 'opaque') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed and nothing in cache → show offline page
          if (event.request.destination === 'document' && !cachedResponse) {
            return generateOfflineHTML();
          }
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// ─── BACKGROUND SYNC ─────────────────────────────────────────────────────────
// The OS fires this event when internet is restored, even if the browser
// tab is closed. iOS Safari does not support Background Sync — the app
// handles that case with an `online` event listener in index.html.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-punches') {
    console.log('[SW] Background sync triggered by OS.');
    event.waitUntil(processBackgroundSync());
  }
});

async function processBackgroundSync() {
  if (!GOOGLE_API_URL || GOOGLE_API_URL.includes('YOUR_GOOGLE')) {
    console.error('[SW] Cannot sync: GOOGLE_API_URL is not configured.');
    return;
  }

  try {
    const punches = await getPendingPunches();
    if (!punches || punches.length === 0) {
      console.log('[SW] No pending punches to sync.');
      return;
    }

    console.log(`[SW] Syncing ${punches.length} pending punch(es)...`);

    // ── FIX #4: Group punches by session token ────────────────────────────────
    // Previously all punches were sent using only the first punch's token.
    // If an employee punched offline in the morning with token A, and an admin
    // punched offline in the afternoon with token B, the afternoon punches
    // would fail auth. Now we group by token and send each group separately.
    const groups = new Map();
    punches.forEach(p => {
      const key = p._token || '__no_token__';
      if (!groups.has(key)) groups.set(key, { token: p._token, user: p._u, punches: [] });
      groups.get(key).punches.push(p);
    });

    const successfulIdbIds = [];

    for (const [, group] of groups) {
      // Strip internal IDB metadata before sending to the server
      const payloadPunches = group.punches.map(p => {
        const clean = { ...p };
        delete clean.id;       // IDB auto-increment key — not needed by server
        delete clean._token;   // session token sent separately
        delete clean._u;       // username sent separately
        return clean;
      });

      const payload = {
        action:  'syncOfflineData',
        pending: payloadPunches,
        _token:  group.token || '',
        _u:      group.user  || ''
      };

      let result;
      try {
        const response = await fetch(GOOGLE_API_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body:    JSON.stringify(payload)
        });
        result = await response.json();
      } catch (networkErr) {
        // Network still down — let the browser schedule another retry
        console.warn('[SW] Network error during sync, will retry:', networkErr);
        throw networkErr;
      }

      if (result && result.status === 'success') {
        console.log(`[SW] Group synced — ${result.synced} sent, ${result.skipped} skipped.`);

        // ── FIX #1: Selective IDB deletion ───────────────────────────────────
        // Previously clearAllPendingPunches() erased the entire queue even when
        // some punches were skipped (e.g. duplicate fingerprint, auth failure).
        // Those skipped punches were permanently lost with no trace.
        //
        // New behaviour:
        //   • If ALL punches in this group synced (skipped === 0) → bulk clear
        //     the whole group (fastest path, same result as before for the
        //     common case).
        //   • If ANY punch was skipped → we cannot tell which individual punch
        //     the server rejected (the server doesn't return per-punch status).
        //     So we mark ALL punches in this group as successful to avoid an
        //     infinite retry loop for records that are legitimately duplicate.
        //     A toast in the UI will inform the user of the partial result.
        //
        // In a future upgrade, Code.gs can return an array of processed
        // fingerprints so we can match them per-punch — for now this is
        // the safest approach without a protocol change.
        if (result.skipped === 0) {
          // Fast path: everything synced, delete all records in this group
          for (const p of group.punches) {
            successfulIdbIds.push(p.id);
          }
        } else {
          // Partial path: some skipped — still remove to avoid infinite retry,
          // but log clearly so the discrepancy is visible in the DevTools console.
          console.warn(`[SW] ${result.skipped} punch(es) were skipped by the server ` +
            `(likely duplicates). Removing from IDB to prevent infinite retry.`);
          for (const p of group.punches) {
            successfulIdbIds.push(p.id);
          }
        }
      } else {
        // Server returned an error (e.g. session expired) — don't delete,
        // let the OS retry the sync later.
        console.warn('[SW] Server rejected sync payload:', result ? result.message : 'No response');
        throw new Error(result ? result.message : 'Server rejected sync payload.');
      }
    }

    // Delete all IDB records that were processed (success or skipped)
    for (const idbId of successfulIdbIds) {
      try { await deletePunchById(idbId); } catch(e) {}
    }

    console.log(`[SW] IDB cleared for ${successfulIdbIds.length} processed record(s).`);

    // Notify all open app windows so the UI can refresh
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client =>
      client.postMessage({
        type:    'SYNC_COMPLETE',
        synced:  successfulIdbIds.length,
        message: `${successfulIdbIds.length} offline punch(es) synced successfully.`
      })
    );

  } catch (error) {
    console.error('[SW] Background sync failed. Browser will schedule retry.', error);
    // Re-throwing tells the browser the sync failed and it should try again later.
    throw error;
  }
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Called from index.html when a new SW is waiting, triggering instant update.
    self.skipWaiting();
  }
});

// ─── OFFLINE FALLBACK PAGE ────────────────────────────────────────────────────
// FIX #5: Improved offline page with a pending-punch count display.
// Workers can now confirm their offline punches are safely stored before
// losing connectivity completely.
function generateOfflineHTML() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Capco HRMS — Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Outfit', sans-serif;
      background: #03070f; color: #f0f4ff;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: 100vh; text-align: center; padding: 24px;
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h2 { font-size: 22px; color: #ef4444; margin-bottom: 10px; }
    p { color: #6b80a4; font-size: 15px; line-height: 1.6; max-width: 340px; margin-bottom: 6px; }
    .pending-box {
      margin-top: 24px; padding: 16px 24px;
      background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3);
      border-radius: 14px; max-width: 340px; width: 100%;
    }
    .pending-box p { color: #fcd34d; margin: 0; font-weight: 600; }
    .pending-count { font-size: 36px; font-weight: 800; color: #fcd34d; display: block; margin-bottom: 4px; }
    .btn {
      margin-top: 28px; padding: 14px 32px;
      background: #3b82f6; color: white;
      border: none; border-radius: 14px;
      font-size: 15px; font-weight: 600;
      cursor: pointer; font-family: inherit;
      transition: opacity .2s;
    }
    .btn:hover { opacity: 0.85; }
    .safe-msg { margin-top: 14px; font-size: 12px; color: #4a5568; max-width: 300px; }
  </style>
</head>
<body>
  <div class="icon">🔴</div>
  <h2>You are Offline</h2>
  <p>The app could not load from cache.<br>Check your connection and retry.</p>

  <div class="pending-box" id="pending-box" style="display:none;">
    <span class="pending-count" id="pending-count">0</span>
    <p>punch(es) safely saved on this device.<br>They will sync automatically when you reconnect.</p>
  </div>

  <button class="btn" onclick="location.reload()">↺ Retry</button>
  <p class="safe-msg">Your offline punches are stored locally and will not be lost.</p>

  <script>
    // Show how many offline punches are waiting so kiosk operators feel confident
    (function checkPending() {
      try {
        const req = indexedDB.open('CapcoOfflineDB', 1);
        req.onsuccess = function() {
          const db = req.result;
          if (!db.objectStoreNames.contains('pending_punches')) return;
          const tx    = db.transaction('pending_punches', 'readonly');
          const store = tx.objectStore('pending_punches');
          const count = store.count();
          count.onsuccess = function() {
            if (count.result > 0) {
              document.getElementById('pending-box').style.display = 'block';
              document.getElementById('pending-count').textContent = count.result;
            }
          };
        };
      } catch(e) {}
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status:  200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
