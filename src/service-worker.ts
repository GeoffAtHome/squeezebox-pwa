/// <reference lib="webworker" />

/**
 * Service Worker for Squeezebox PWA
 * Handles caching and offline support
 */

export {};

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `squeezebox-${__BUILD_STAMP__}`;
const ASSETS_TO_CACHE = ["/", "/index.html", "/manifest.webmanifest"];

// Install event - cache essential assets
sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        console.warn("Failed to cache some assets during install");
      });
    }),
  );
  sw.skipWaiting();
});

// Activate event - clean up old caches
sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        }),
      );
    }),
  );
  sw.clients.claim();
});

// Fetch event - serve from cache, fallback to network
sw.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Ignore cross-origin requests (bridge SSE/API/stream traffic)
  // so browser networking handles CORS and streaming natively.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== sw.location.origin) {
    return;
  }

  // Always prefer a fresh app shell for navigations so new deployments
  // become visible immediately instead of waiting behind cached index.html.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) {
            return cached;
          }

          return caches.match("/index.html") as Promise<Response>;
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type === "error") {
          return response;
        }

        // Cache successful responses
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }),
  );
});

// Handle messages from clients
sw.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    sw.skipWaiting();
  }
});
