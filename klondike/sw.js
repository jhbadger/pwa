// Service worker for Klondike Solitaire. Cache-first for everything, including navigations —
// a slow network hangs a fetch, it doesn't reject it, so falling back to cache only
// on failure is not enough. VERSION is a hash of the precached files' contents; run
// `node scripts/build.mjs` after editing any of them so the browser detects a real update.

const VERSION = '4c8a1bc9fec8';
const CACHE_NAME = `klondike-${VERSION}`;

// Everything the app needs to launch, cold, with no network at all.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/klondike.js',
  'js/sound.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // Cache-first, no network race: the app shell is always precached.
    event.respondWith(
      caches.match('./').then((cached) => cached || fetch(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          // Clone before the response body is consumed by the page — once handed
          // back it's locked and a later clone() throws.
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
