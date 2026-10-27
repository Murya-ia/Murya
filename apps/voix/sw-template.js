// Service worker de l'app des voix. Modèle : au build, vite.config.ts remplace la version et la liste des fichiers.
// Rôle : garder l'interface en cache pour que l'app s'ouvre même sans réseau (spec §3.8).
// Les appels à l'API et les envois vers R2 (autres domaines) ne passent JAMAIS par ce cache.

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `murya-${VERSION}`;
/** Au-delà de ce délai, on sert la page en cache plutôt que d'attendre un réseau lent. */
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Supprime les caches des versions précédentes.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('murya-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Page : le réseau d'abord (pour recevoir les mises à jour), la copie en cache si le
    // réseau est absent ou trop lent. Toutes les adresses (/i/…, /) renvoient la même page.
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS)),
      ]).catch(() => caches.match('/index.html').then((hit) => hit || fetch(request))),
    );
    return;
  }
  // Fichiers de l'app (noms uniques à chaque version) : le cache d'abord.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
