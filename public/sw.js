// Wyrfl service worker – installable app + offline play. Written to be safe, because a broken service worker stays
// on the players' devices (nobody clears caches by hand):
//
// - BUILD and PRECACHE are filled in after every build (astro.config.mjs, integration "wyrfl-service-worker"):
//   BUILD = hash of all files → a new version only when something really changed.
// - install: the whole build goes into its own cache (fetched past the HTTP cache). If anything fails, the install
//   fails and the previous version simply keeps working – there is never a half-updated app.
// - activate: the previous build's cache is kept (pages that are still open can load their chunks), older ones and
//   unknown wyrfl-* caches are deleted – the cache never grows.
// - pages: always from the network first (fresh after every deploy); offline: the cached copy, else a small offline page.
// - files: current build's cache → any older wyrfl cache → network. Never anything from other origins.
// - unconfigured (BUILD still the placeholder, e.g. served from public/ unbuilt): does nothing at all.
// Emergency: scripts/sw-kill-switch.js (see CLAUDE.md) removes the service worker and all caches from every device.

const BUILD = '__WYRFL_BUILD__';
const PRECACHE = [] /*__WYRFL_PRECACHE__*/;
const PREFIX = 'wyrfl-';
const CACHE = `${PREFIX}${BUILD}`;
const META = '__wyrfl-installed';   // timestamp entry in every cache (which build is newer)
const ACTIVE = !BUILD.startsWith('__');

self.addEventListener('install', event => {
  if (!ACTIVE) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })));   // all or nothing
      await cache.put(META, new Response(String(Date.now())));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // keep the current cache and the newest other build, delete everything else of ours
      const others = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith(PREFIX) || name === CACHE) continue;
        const stamp = await (await caches.open(name)).match(META);
        others.push({ name, time: stamp ? Number(await stamp.text()) || 0 : 0 });
      }
      others.sort((a, b) => b.time - a.time);
      const keep = ACTIVE ? others.filter(c => c.time > 0).slice(0, 1).map(c => c.name) : [];
      await Promise.all(others.filter(c => !keep.includes(c.name)).map(c => caches.delete(c.name)));
      await self.clients.claim();
    })(),
  );
});

function offlinePage() {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wyrfl</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#12151c;color:#eef1f7;font-family:system-ui,sans-serif;text-align:center">
<div><p style="font-size:1.4rem;font-weight:700">Offline</p><p>Keine Verbindung – bitte gleich noch einmal versuchen.<br>No connection – please try again in a moment.</p></div>`;
  return new Response(body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function store(event, request, response) {
  if (!response.ok || response.type !== 'basic' || response.redirected) return;
  const copy = response.clone();   // right away – once the page has read the body it can't be cloned
  event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
}

self.addEventListener('fetch', event => {
  if (!ACTIVE) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          store(event, request, response);
          return response;
        } catch {
          return (await caches.match(request, { ignoreSearch: true }))
            || (await caches.match(new URL('./', self.registration.scope).href))
            || offlinePage();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const current = await caches.open(CACHE);
      const hit = (await current.match(request)) || (await caches.match(request));
      if (hit) return hit;
      try {
        const response = await fetch(request);
        store(event, request, response);
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
