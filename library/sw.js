// Service worker for Library. Cache-first for everything, including
// navigations — a slow network hangs a fetch, it doesn't reject it, so
// falling back to cache only on failure is not enough. VERSION is a hash of
// the precached files' contents; run `node scripts/build.mjs` after editing
// any of them (including content/*.json) so the browser detects a real update.

const VERSION = '0a30df34e1d7';
const CACHE_NAME = `library-${VERSION}`;

// Everything the app needs to launch and read every bundled book, cold, with
// no network at all.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/books.js',
  'js/reader.js',
  'js/paginate-text.js',
  'content/treasure-island.json',
  'content/call-of-the-wild.json',
  'content/alice.json',
  'content/dracula.json',
  'content/frankenstein.json',
  'content/black-beauty.json',
  'content/das-kapital.json',
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
