const CACHE_NAME = 'capco-hrms-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);
    
    // OFFLINE UPGRADE: Dynamically cache AI Models & Fonts so Kiosk survives internet drops
    if (requestUrl.pathname.includes('weights') || requestUrl.hostname.includes('jsdelivr') || requestUrl.hostname.includes('fonts')) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                return fetch(event.request).then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
                        return networkResponse;
                    }
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                    return networkResponse;
                }).catch(() => { /* Fallback for completely offline un-cached */ });
            })
        );
    } else {
        // Core App Routing: Network First for API calls, Cache First for local assets
        if (event.request.method === 'POST') {
            event.respondWith(fetch(event.request)); // Never cache Google API hits
        } else {
            event.respondWith(
                caches.match(event.request).then((response) => response || fetch(event.request))
            );
        }
    }
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
                })
            );
        })
    );
});
