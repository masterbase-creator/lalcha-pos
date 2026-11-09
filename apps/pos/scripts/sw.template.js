const SHELL = "lalcha-shell-__VERSION__";
const IMAGES = "lalcha-images-v1";
const URLS = "__URLS__";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lalcha-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/v1/")) return;

  if (url.pathname.startsWith("/products/")) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(event.request, { ignoreVary: true });
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) await cache.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  // App files come from the device first, so the till opens instantly with or without internet.
  const key = event.request.mode === "navigate" ? "/" : event.request;
  event.respondWith(caches.match(key, { cacheName: SHELL, ignoreVary: true }).then((hit) => hit ?? fetch(event.request)));
});
