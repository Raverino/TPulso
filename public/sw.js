// TPulso service worker: keeps the app and the offline timetable on the device (docs/OFFLINE.md).
// - /data/current.json: network first (to see new timetable versions), saved copy when offline
// - /data/<version>/...: cache first; these files never change, a new timetable gets a new version folder
// - app files (/assets, fonts, icons): cache first; page navigations: network first, saved page offline
// Map tiles are not cached here.
const SHELL = 'tpulso-shell-v1';
const DATA_PREFIX = 'tpulso-data-';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname === '/data/current.json') return e.respondWith(networkFirst(e.request, SHELL));
    const m = url.pathname.match(/^\/data\/([^/]+)\//);
    if (m) return e.respondWith(cacheFirst(e.request, DATA_PREFIX + m[1]));
    if (url.pathname.startsWith('/api/')) return; // live API (switched off) is never cached
    if (e.request.mode === 'navigate') return e.respondWith(networkFirst(new Request('/'), SHELL));
    return e.respondWith(cacheFirst(e.request, SHELL));
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return e.respondWith(cacheFirst(e.request, SHELL));
  }
});

// The app tells us the current timetable version: delete saved data of older versions.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'timetable-version') {
    const keep = DATA_PREFIX + e.data.version;
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(DATA_PREFIX) && k !== keep).map((k) => caches.delete(k)))));
  }
});
