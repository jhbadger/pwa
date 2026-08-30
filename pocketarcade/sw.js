const CACHE = 'pocket-arcade-v9';
const CACHE_PREFIX = 'pocket-arcade-';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/roms.js',
  './js/i8080.js',
  './js/machine.js',
  './js/audio.js',
  './js/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Cache Storage is shared across the whole origin, and this origin hosts
  // several unrelated apps — only ever touch caches with our own prefix.
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
