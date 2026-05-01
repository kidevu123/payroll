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
