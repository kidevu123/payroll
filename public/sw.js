// Offline shell. Caches the static app chrome only — no employee data
// is cached for privacy reasons.

const CACHE = "payroll-shell-v1";
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
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
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
  // Only intercept navigation requests. Auth, API, and asset requests
  // pass through untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
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
