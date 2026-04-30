import { getSetting } from "@/lib/settings/runtime";
import { NgtecoForm } from "./ngteco-form";

export default async function Page() {
  const ngteco = await getSetting("ngteco");
  return (
    <NgtecoForm
      portalUrl={ngteco.portalUrl}
      locationId={ngteco.locationId}
      headless={ngteco.headless}
      hasCredentials={!!ngteco.usernameEncrypted && !!ngteco.passwordEncrypted}
    />
  );
}
