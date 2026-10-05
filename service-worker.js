const CACHE_NAME = 'vumc-worship-hub-v12';

const APP_FILES = [
  './',
  './index.html',
  './styles.css?v=11',
  './config.js?v=11',
  './app.js?v=12',
  './manifest.webmanifest?v=11',
  './icons/icon.svg',
  './icons/icon.svg?v=11',
  './icons/icon-192.png?v=11',
  './icons/icon-512.png',
  './assets/worship-header-v2.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) =>
            key.startsWith('vumc-worship-hub-') &&
            key !== CACHE_NAME
          )
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Spreadsheet requests always go directly to the data service.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const response = await fetch(request);

        if (response.ok) {
          event.waitUntil(
            cache.put(request, response.clone())
          );
        }

        return response;
      } catch (error) {
        const cached = await cache.match(request, {
          ignoreSearch: true
        });

        if (cached) {
          return cached;
        }

        if (request.mode === 'navigate') {
          const page = await cache.match('./index.html');

          if (page) {
            return page;
          }
        }

        return Response.error();
      }
    })()
  );
});
