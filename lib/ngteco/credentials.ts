// NGTeco credential helpers. Plaintext only crosses this boundary at the
// moment of write (sealing) and at the moment of read by the scraper
// (opening). The Settings UI calls setNgtecoCredentials from a server
// action; the scraper calls openNgtecoCredentials from the import job.

import { setSetting, getSetting } from "@/lib/settings/runtime";
import { ngtecoSchema } from "@/lib/settings/schemas";
import { seal, open } from "@/lib/crypto/vault";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export type NgtecoCredentialUpdate = {
  username?: string | null; // null = clear
  password?: string | null;
  portalUrl?: string;
  locationId?: string | null;
  headless?: boolean;
};

/**
 * Update NGTeco settings. Username + password are sealed before write; the
 * existing sealed values are kept when omitted (the form sends them as
 * undefined). To CLEAR a credential, pass null explicitly.
 */
export async function setNgtecoCredentials(
  patch: NgtecoCredentialUpdate,
  actor: Actor,
): Promise<void> {
  const current = await getSetting("ngteco");
  const next = ngtecoSchema.parse({
    portalUrl: patch.portalUrl ?? current.portalUrl,
    usernameEncrypted:
      patch.username === null
        ? null
        : patch.username !== undefined
          ? seal(patch.username)
          : current.usernameEncrypted,
    passwordEncrypted:
      patch.password === null
        ? null
        : patch.password !== undefined
          ? seal(patch.password)
          : current.passwordEncrypted,
    locationId:
      patch.locationId === null
        ? null
        : patch.locationId ?? current.locationId,
    reportPath: current.reportPath,
    headless: patch.headless ?? current.headless,
  });
  await setSetting("ngteco", next, { actorId: actor.id, actorRole: actor.role });
}

/**
 * Decrypt the stored NGTeco credentials. Used ONLY by the scraper (and the
 * "Test Connection" action). Throws if either is missing.
 */
export async function openNgtecoCredentials(): Promise<{
  username: string;
  password: string;
}> {
  const ngteco = await getSetting("ngteco");
  if (!ngteco.usernameEncrypted || !ngteco.passwordEncrypted) {
    throw new Error("NGTeco credentials are not configured.");
  }
  return {
    username: open(ngteco.usernameEncrypted),
    password: open(ngteco.passwordEncrypted),
  };
}
