// Service worker for Internet Radio. Cache-first for the app shell; network-only
// for API calls and audio streams (they must always be live). Run `node scripts/build.mjs`
// after editing precached files to bump VERSION and force a cache update.

const VERSION = '8cd9c31e1856';
const CACHE = `radio-${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Let API calls and audio streams go straight to the network.
  if (url.hostname.includes('radio-browser.info') || e.request.destination === 'audio') return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request)),
  );
});
