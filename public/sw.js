// MIRVA's service worker. Two jobs, both small:
// 1. When a push wakes it, ask MIRVA what is new and show it (pushes carry nothing themselves; see lib/push.mjs).
// 2. Keep the fonts and the brand marks for offline starts. Pages, scripts and anything from /api always come from
//    the network, so a new version of MIRVA is never hidden behind an old copy, and nothing private is stored.
const SHELL = "mirva-shell-v1";
const KEEP = [/^\/fonts\//, /^\/brand\//, /^\/favicon\.svg$/, /^\/icons\//];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || !KEEP.some((re) => re.test(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  })());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let notes = [];
    try {
      const res = await fetch("/api/notes?fresh=1", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (res.ok) notes = (await res.json()).notes || [];
    } catch {}
    // A phone must show something for every push. With nothing new (already seen on the page), one quiet line.
    if (!notes.length) return self.registration.showNotification("MIRVA", { body: "Something new is waiting in your wardrobe.", icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "mirva", data: { url: "/account?tab=opinions" } });
    if (notes.length === 1) {
      const n = notes[0];
      return self.registration.showNotification(n.title, { body: n.body, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: n.kind, renotify: true, data: { url: n.url } });
    }
    return self.registration.showNotification(`${notes.length} new for you`, {
      body: notes.map((n) => n.title).join("\n"),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: "mirva",
      renotify: true,
      data: { url: notes[0].url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/account", location.origin);
  if (target.origin !== location.origin) return;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).pathname === target.pathname && "focus" in client) {
        client.navigate?.(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
