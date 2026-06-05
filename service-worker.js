// Service worker: precache the app shell so the reader works fully offline.
// Stored books live in IndexedDB (handled by the page, not the SW).

const CACHE = "strobe-reader-v1";

const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/main.js",
  "./js/db.js",
  "./js/epub.js",
  "./js/library.js",
  "./js/reader.js",
  "./js/themes.js",
  "./js/sanitize.js",
  "./vendor/fflate.module.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GET requests; fall back to the network and
// cache new shell resources opportunistically.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
