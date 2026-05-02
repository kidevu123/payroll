// GET /api/google/calendar/connect — kicks off OAuth dance.
// Generates a one-time CSRF state cookie, redirects to Google's consent.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "@/lib/auth-guards";
import { buildAuthUrl, isOAuthConfigured } from "@/lib/google/oauth";

export async function GET(req: NextRequest): Promise<Response> {
  await requireAdmin();
  if (!isOAuthConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/google-calendar?error=oauth_not_configured", req.url),
    );
  }
  const state = randomBytes(24).toString("hex");
  const authUrl = buildAuthUrl(state);
  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
