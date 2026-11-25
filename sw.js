/* Quaderno service worker: keeps the app's own files so it opens offline, and opens notes from reminders.
   Notes themselves are never cached here: they live in IndexedDB and OneDrive. */
const CACHE = "quaderno-v1";
const SHELL = ["./", "index.html", "app.css", "app.js", "cloud.js", "config.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  // Network first, so a new version arrives at once; the saved copy when offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok && !u.search) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === "navigate" ? caches.match("./") : Response.error())))
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.noteId;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs[0];
    if (c) { c.focus(); if (id) c.postMessage({ openNote: id }); return undefined; }
    return self.clients.openWindow("./" + (id ? "?nota=" + encodeURIComponent(id) : ""));
  }));
});
