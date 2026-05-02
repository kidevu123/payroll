// Google OAuth 2.0 helpers for Calendar push. Stand-alone — uses fetch
// directly so we don't pull in the whole googleapis package for a tiny
// surface.
//
// Required env (set in /etc/payroll/.env):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
// (Redirect URI is computed from APP_URL + "/api/google/calendar/callback")

import { logger } from "@/lib/telemetry";

export const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT =
  "https://www.googleapis.com/oauth2/v3/userinfo";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
  "profile",
];

function appBaseUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL not set; cannot build OAuth redirect URI.");
  return url.replace(/\/$/, "");
}

export function calendarRedirectUri(): string {
  return `${appBaseUrl()}/api/google/calendar/callback`;
}

export function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set; OAuth disabled.",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Build the consent URL. `state` is a one-time CSRF token the caller
 * stored alongside the request (cookie); the callback verifies it.
 */
export function buildAuthUrl(state: string): string {
  const { clientId } = clientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_BASE}/v2/auth?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: calendarRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 500) }, "google.oauth.exchange_failed");
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret } = clientCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 500) }, "google.oauth.refresh_failed");
    throw new Error(`Google token refresh failed: ${res.status}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

export async function fetchUserInfo(accessToken: string): Promise<{
  email: string;
  name?: string;
}> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  return (await res.json()) as { email: string; name?: string };
}

export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.APP_URL,
  );
}
