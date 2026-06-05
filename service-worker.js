// Service worker: precache the app shell so the reader works fully offline.
// Stored books live in IndexedDB (handled by the page, not the SW).

// Bump this whenever you publish a new version. The byte change makes the
// browser fetch this file, install a fresh worker, and re-precache the shell;
// the page then offers the user a "new version available" refresh prompt.
const CACHE = "strobe-reader-v4";

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
  "./fonts/atkinson-hyperlegible-400.woff2",
  "./fonts/atkinson-hyperlegible-700.woff2",
  "./fonts/literata-400.woff2",
  "./fonts/literata-700.woff2",
  "./fonts/jetbrains-mono-400.woff2",
  "./fonts/jetbrains-mono-700.woff2",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // Precache the shell, but don't call skipWaiting() here: when an older
  // worker is already controlling the app, the new one stays in "waiting"
  // so the page can ask the user before swapping versions mid-session. On a
  // first install (no existing controller) the browser activates immediately.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

// The page posts this once the user accepts the update; activating the waiting
// worker fires "controllerchange" on the client, which then reloads.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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
