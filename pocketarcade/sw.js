const CACHE = 'pocket-arcade-v17';
const CACHE_PREFIX = 'pocket-arcade-';

// The root is now just the game-select menu — Space Invaders itself lives
// at invaders/ (its own scoped app/cache, like partii/ and galaxian/).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Cache Storage is shared across the whole origin, and this origin hosts
  // several unrelated apps — only ever touch caches with our own prefix.
  // (This also cleans up the old pocket-arcade-v* caches from before Space
  // Invaders moved out to invaders/.)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request, { cacheName: CACHE }).then(r => r || fetch(e.request))
  );
});
