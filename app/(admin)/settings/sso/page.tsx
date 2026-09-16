import { getSetting } from "@/lib/settings/runtime";
import {
  listUsersMissingAuthentik,
  listLinkedAuthentikUsers,
} from "@/lib/db/queries/users";
import { readAuthentikConfig } from "@/lib/authentik/client";
import { SsoForm } from "./sso-form";

export default async function Page() {
  const settings = await getSetting("sso");
  const missing = await listUsersMissingAuthentik();
  const linked = await listLinkedAuthentikUsers();
  return (
    <SsoForm
      settings={settings}
      configured={readAuthentikConfig() !== null}
      missing={missing.map((u) => ({ id: u.id, email: u.email, role: u.role }))}
      linked={linked.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        authentikUsername: u.authentikUsername,
      }))}
    />
  );
}
