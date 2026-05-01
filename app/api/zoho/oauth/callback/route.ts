// Zoho OAuth redirect target. Exchanges `code` for a refresh_token and
// stashes it (encrypted) on the matching zoho_organizations row.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getOrg, setOrgRefreshToken } from "@/lib/db/queries/zoho";
import { open as openSealed } from "@/lib/crypto/vault";
import { writeAudit } from "@/lib/db/audit";

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" && value !== null &&
    "ciphertext" in value && "iv" in value
  );
}

export async function GET(req: Request): Promise<Response> {
  const session = await requireAdmin();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/settings/zoho?error=${encodeURIComponent(errorParam)}`, url),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings/zoho?error=missing_code", url),
    );
  }
  const org = await getOrg(state);
  if (!org) return new NextResponse("org not found", { status: 404 });
  if (!isEnvelope(org.clientIdEncrypted) || !isEnvelope(org.clientSecretEncrypted)) {
    return new NextResponse("client credentials missing", { status: 400 });
  }
  const clientId = openSealed(org.clientIdEncrypted);
  const clientSecret = openSealed(org.clientSecretEncrypted);
  const appUrl = process.env.APP_URL ?? `${url.protocol}//${url.host}`;
  const redirectUri = new URL("/api/zoho/oauth/callback", appUrl).toString();
  const tokenUrl = `${org.accountsDomain}/oauth/v2/token`;
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    return NextResponse.redirect(
      new URL(
        `/settings/zoho?error=${encodeURIComponent(`token_exchange_failed: ${text.slice(0, 120)}`)}`,
        url,
      ),
    );
  }
  const json = (await resp.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
  };
  if (!json.refresh_token) {
    return NextResponse.redirect(
      new URL(
        `/settings/zoho?error=${encodeURIComponent(json.error ?? "no_refresh_token")}`,
        url,
      ),
    );
  }
  await setOrgRefreshToken(org.id, json.refresh_token);
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "zoho_org.connected",
    targetType: "ZohoOrganization",
    targetId: org.id,
  });
  return NextResponse.redirect(new URL("/settings/zoho?connected=1", url));
}
