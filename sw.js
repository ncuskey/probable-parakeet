// Minimal service worker for offline functionality
const CACHE_NAME = 'mapgen-v3';
const urlsToCache = [
  '/',            // optional; you can also drop this in dev
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('/');
        return cached || Response.error();
      }
    })());
    return;
  }
  // For other assets: cache-first fallback is fine
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
