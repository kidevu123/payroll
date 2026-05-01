// Edge-safe redirect-only middleware (§13: middleware redirects, actions enforce).
//
// We intentionally don't verify the JWT here — that needs Node APIs (argon2,
// postgres) which aren't available in Edge runtime. The full authn check happens
// in server components / actions via `auth()` and `requireSession()` /
// `requireAdmin()`. Middleware just keeps unauthenticated users from seeing
// app shells before the action layer kicks in.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/login/change-password"];

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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
