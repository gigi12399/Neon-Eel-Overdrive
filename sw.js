/* ============================================================================
   NEON EEL: OVERDRIVE — Service Worker
   ----------------------------------------------------------------------------
   Caches the app shell so the game installs as a PWA and keeps working
   offline. Bump CACHE_VERSION whenever any cached file changes — that's what
   forces clients to fetch the new versions instead of serving stale ones.

   Note: service workers only register on HTTPS or http://localhost, never on
   a plain file:// page — that's a browser security restriction, not a bug
   here. Serve this folder over http(s) (a dev server, GitHub Pages, a mobile
   app wrapper like Median.co/Appilix/Swing2App, etc.) to see it activate.
   ============================================================================ */
const CACHE_VERSION = "v1";
const CACHE_NAME = "neon-eel-" + CACHE_VERSION;

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-512-maskable.png",
    "./icons/apple-touch-icon.png",
    "./icons/favicon-32.png",
    "./icons/favicon-16.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()) // activate this version immediately, don't wait for old tabs to close
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim()) // take control of any already-open tabs right away
    );
});

// Cache-first for the app shell (instant loads + offline play), falling back
// to the network for anything not precached, and caching what it fetches
// along the way so a second visit works offline too.
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    // Page navigations (opening/reloading the app, launching it from the
    // home screen) always resolve to the cached app shell when offline,
    // even if the exact URL wasn't precached verbatim — this is what makes
    // "launch the installed app with no network" work reliably.
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).catch(() => caches.match("./index.html"))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => cached); // offline and not precached: nothing we can do for this request
        })
    );
});
