// GET /api/google/calendar/callback — exchanges code → tokens, seals
// the refresh token via the AES-GCM vault, stores it on the
// googleCalendar setting along with the connected email + timestamp.

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { logger } from "@/lib/telemetry";
import { seal } from "@/lib/crypto/vault";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  isOAuthConfigured,
} from "@/lib/google/oauth";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireAdmin();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const back = (qs: string) =>
    NextResponse.redirect(
      new URL(`/settings/google-calendar?${qs}`, req.url),
    );

  if (errorParam) return back(`error=${encodeURIComponent(errorParam)}`);
  if (!code || !state) return back("error=missing_code");
  if (!isOAuthConfigured()) return back("error=oauth_not_configured");

  // CSRF check — cookie set by /connect.
  const cookieState = req.cookies.get("gcal_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    logger.warn(
      { hasCookie: Boolean(cookieState) },
      "google.calendar.callback: state mismatch",
    );
    return back("error=state_mismatch");
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    logger.error({ err }, "google.calendar.callback: exchange failed");
    return back("error=exchange_failed");
  }

  if (!tokens.refresh_token) {
    // Google only returns a refresh_token on the first consent. If the
    // owner had previously connected (token revoked manually) re-prompt
    // with prompt=consent (which buildAuthUrl sets) — but if it still
    // doesn't show up, ask them to revoke at myaccount.google.com.
    return back("error=no_refresh_token");
  }

  let connectedEmail: string;
  try {
    const profile = await fetchUserInfo(tokens.access_token);
    connectedEmail = profile.email;
  } catch (err) {
    logger.warn({ err }, "google.calendar.callback: userinfo failed");
    connectedEmail = "(unknown)";
  }

  const cfg = await getSetting("googleCalendar");
  const sealed = seal(tokens.refresh_token);
  await setSetting(
    "googleCalendar",
    {
      ...cfg,
      connectedEmail,
      refreshTokenSealed: JSON.stringify(sealed),
      connectedAt: new Date().toISOString(),
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );

  const res = back("connected=1");
  res.cookies.delete("gcal_oauth_state");
  return res;
}
