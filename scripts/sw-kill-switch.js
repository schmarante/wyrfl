// EMERGENCY ONLY – replaces the Wyrfl service worker on every device and removes it again.
// Use: copy this file over public/sw.js, build and deploy. On their next visit, every player's browser installs this
// worker, which deletes all wyrfl-* caches, unregisters itself and reloads the open pages from the network.
// Afterwards restore the real public/sw.js (git) – the page registers it again on the following visit.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith('wyrfl-')) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
