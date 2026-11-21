/* TopOut service worker: keeps the app itself on the tablet so it opens with no signal.
 * Registered as /sw.js?v=<build id>, so every deploy installs a new worker that caches that build's files
 * (from /sw-manifest.json) and drops older caches. Pages fall back to the cached app when the network is gone
 * or too slow; a page that loads online refreshes that copy. API calls are never cached here — saved data
 * lives in IndexedDB. */
const PREFIX = "topout-app-";
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = PREFIX + VERSION;

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/sw-manifest.json", { cache: "no-store" });
      const { files } = await res.json();
      const cache = await caches.open(CACHE);
      await cache.addAll([new Request("/", { cache: "reload" }), ...files]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw-manifest.json") return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
            }
            return res;
          })
      )
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      timeout(6000, fetch(req))
        .then(res => {
          // Keep the app page current, so an offline start loads the same build as the cached files.
          if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then(c => c.put("/", copy)));
          }
          return res;
        })
        .catch(async () => (await caches.match("/")) || Response.error())
    );
  }
});
