import { listOrgs } from "@/lib/db/queries/zoho";
import { ZohoSettings } from "./zoho-settings";

export const dynamic = "force-dynamic";

export default async function Page() {
  const orgs = await listOrgs();
  return <ZohoSettings orgs={orgs} />;
}
