import { headers } from "next/headers";
import { listOrgs } from "@/lib/db/queries/zoho";
import { ZohoSettings } from "./zoho-settings";
import { SetupChecklist } from "./setup-checklist";

export const dynamic = "force-dynamic";

export default async function Page() {
  const orgs = await listOrgs();

  // Compute the redirect URI we will use at OAuth time so the admin can
  // copy-paste it into the Zoho Developer Console. Mirror the logic in
  // app/api/zoho/oauth/callback/route.ts: prefer APP_URL, fall back to
  // the host header.
  const appUrlEnv = process.env.APP_URL;
  let baseUrl = appUrlEnv;
  if (!baseUrl) {
    const h = await headers();
    const host = h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    baseUrl = `${proto}://${host}`;
  }
  const redirectUri = new URL(
    "/api/zoho/oauth/callback",
    baseUrl,
  ).toString();

  return (
    <div className="space-y-4">
      <SetupChecklist
        redirectUri={redirectUri}
        appUrlConfigured={Boolean(appUrlEnv)}
      />
      <ZohoSettings orgs={orgs} />
    </div>
  );
}
