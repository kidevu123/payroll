// Offline shell + static-asset cache. Caches the app chrome and Next's
// content-hashed build assets only — no employee data is cached for privacy.

const CACHE = "payroll-shell-v3";
const STATIC_CACHE = "payroll-static-v1";
const OFFLINE_PAGE = "/offline";
const SHELL = [OFFLINE_PAGE, "/manifest.webmanifest"];

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
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== STATIC_CACHE)
            .map((k) => caches.delete(k)),
        )
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "SW_ACTIVATED" });
        }
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/", tag: "default" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload wasn't JSON; keep defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if (w.url.endsWith(url) && "focus" in w) return w.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Next's build assets are content-hashed (immutable) — cache-first makes
  // cold app opens skip the network for every JS/CSS chunk and font file.
  // A new deploy emits new hashes so stale entries are never referenced.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((resp) => {
              if (resp.ok) cache.put(req, resp.clone());
              return resp;
            }),
        ),
      ),
    );
    return;
  }

  // Everything else dynamic (API, RSC payloads, sw.js itself) passes
  // through untouched. Navigations keep the offline fallback.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname === "/sw.js"
  ) {
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_PAGE).then((r) => r || new Response("offline", { status: 503 })))
    );
  }
});
