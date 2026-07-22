// Edge-safe redirect-only middleware (§13: middleware redirects, actions enforce).
//
// We intentionally don't verify the JWT here — that needs Node APIs (argon2,
// postgres) which aren't available in Edge runtime. The full authn check happens
// in server components / actions via `auth()` and `requireSession()` /
// `requireAdmin()`. Middleware just keeps unauthenticated users from seeing
// app shells before the action layer kicks in.

import { NextResponse, type NextRequest } from "next/server";

// /kiosk runs its own short-lived PIN session (lib/kiosk/session.ts) —
// its pages and actions self-guard; Auth.js cookies are not involved.
const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/api/health",
  "/login/change-password",
  "/kiosk",
];

// Auth.js v5 default cookie names. Suffix differs in production (Secure cookies
// get the `__Secure-` prefix). Check both.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    pathname === "/favicon.ico" ||
    // Icon routes must be reachable without auth — the login page itself
    // and the iOS bookmark fetcher both pull these. Same for the manifest
    // and the public branding endpoints.
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/api/branding/favicon" ||
    pathname === "/api/branding/logo" ||
    pathname.startsWith("/api/branding/icon/") ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIE_NAMES.some((name) =>
    req.cookies.has(name),
  );
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  // Forward the pathname so server layouts can role-gate by URL.
  // Edge can't decode the JWT to check role itself, so the layout
  // does that part using the path we set here.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
