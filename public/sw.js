// Wyrfl service worker – makes the app installable and keeps visited pages playable offline.
// - pages (navigations): network first, the cached copy when offline
// - built assets (/_astro/…, hashed names): cache first – a new build has new names
// - everything else of this site (icons, avatars …): cached copy right away, refreshed in the background
// Nothing from other origins is touched (Wyrfl makes no external requests anyway).
const CACHE = 'wyrfl-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('wyrfl-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// the copy for the cache has to be made right away – once the page has read the response, it can't be cloned anymore
const put = (request, response) => {
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => put(request, response))
        .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match(new URL('./', self.registration.scope)))),
    );
    return;
  }
  if (url.pathname.includes('/_astro/')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => put(request, response))));
    return;
  }
  event.respondWith(
    caches.match(request).then(hit => {
      const fresh = fetch(request).then(response => put(request, response)).catch(() => hit);
      return hit || fresh;
    }),
  );
});
