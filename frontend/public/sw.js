// Offline shell: pages load from cache when there is no signal. API calls and map tiles are not cached.
// shortcut: old hashed assets stay in the cache until CACHE is renamed; bump the version if storage ever matters.
const CACHE = 'digiroad-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Pages: network first so a new deploy shows at once; cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then(cache => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Built files and images: cache first (Vite file names change on every build).
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(cache => cache.put(req, copy));
      return res;
    }))
  );
});
