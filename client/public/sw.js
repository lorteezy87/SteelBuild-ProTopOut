/* TopOut service worker: keeps the app itself on the tablet so it opens with no signal.
 * App files (/assets/*) are cached from the build's file list at install; pages fall back to the cached app
 * when the network is gone or too slow. API calls are never cached here — saved data lives in IndexedDB. */
const PREFIX = "topout-app-";

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/sw-manifest.json", { cache: "no-store" });
      const { version, files } = await res.json();
      const cache = await caches.open(PREFIX + version);
      await cache.addAll(["/", ...files]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/sw-manifest.json", { cache: "no-store" }).catch(() => null);
      const current = res && res.ok ? PREFIX + (await res.json()).version : null;
      if (current) for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== current) await caches.delete(k);
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
    event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      timeout(6000, fetch(req)).catch(async () => (await caches.match("/")) || Response.error())
    );
  }
});
