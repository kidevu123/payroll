// Begins the Zoho OAuth flow for one organization. The admin clicks
// "Connect <name>" on the Settings → Zoho tab; we redirect them to
// Zoho's auth URL with the org id baked into `state` so the callback
// knows which row to attach the refresh_token to.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getOrg } from "@/lib/db/queries/zoho";
import { open as openSealed } from "@/lib/crypto/vault";

const SCOPES = "ZohoBooks.expenses.CREATE,ZohoBooks.expenses.READ,ZohoBooks.settings.READ,ZohoBooks.contacts.READ";

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" && value !== null &&
    "ciphertext" in value && "iv" in value
  );
}

export async function GET(req: Request): Promise<Response> {
  await requireAdmin();
  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return new NextResponse("orgId required", { status: 400 });
  const org = await getOrg(orgId);
  if (!org) return new NextResponse("org not found", { status: 404 });
  if (!isEnvelope(org.clientIdEncrypted)) {
    return new NextResponse("client_id missing — set it in Settings → Zoho first", { status: 400 });
  }
  const clientId = openSealed(org.clientIdEncrypted);
  const appUrl = process.env.APP_URL ?? `${url.protocol}//${url.host}`;
  const redirectUri = new URL("/api/zoho/oauth/callback", appUrl).toString();
  const authUrl = new URL(`${org.accountsDomain}/oauth/v2/auth`);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", org.id);
  return NextResponse.redirect(authUrl.toString());
}
