// TPulso service worker: keeps the app and the offline timetable on the device (docs/OFFLINE.md).
// - /data/current.json and page navigations: saved copy at once, refreshed in the background (stale-while-
//   revalidate), so the app opens with the map and saved stations before any network request finishes;
//   a newer timetable or app version is used from the next start
// - /data/<version>/...: cache first; these files never change, a new timetable gets a new version folder
// - app files (/assets, fonts, icons): cache first
// Map tiles are not cached here.
// Bump when cache-first app files keep their names but change (v4: TPulso icons under new names, so phones and
// browsers drop the old OV Pulse icons they kept).
const SHELL = 'tpulso-shell-v4';
const DATA_PREFIX = 'tpulso-data-';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/tpulso-favicon.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tpulso-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

// Saved copy at once (if any); the network refresh runs in the background and updates the copy.
async function staleWhileRevalidate(e, req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) {
    e.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
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
    if (url.pathname === '/data/current.json') return e.respondWith(staleWhileRevalidate(e, new Request('/data/current.json'), SHELL));
    const m = url.pathname.match(/^\/data\/([^/]+)\//);
    if (m) return e.respondWith(cacheFirst(e.request, DATA_PREFIX + m[1]));
    if (url.pathname.startsWith('/api/')) return; // API (service alerts; live API, switched off) is never cached: always fresh or honestly missing
    if (e.request.mode === 'navigate') return e.respondWith(staleWhileRevalidate(e, new Request('/'), SHELL));
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
