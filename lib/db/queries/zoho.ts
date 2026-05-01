// Zoho organization CRUD. Encrypted secrets (refresh_token, client_id,
// client_secret) live in the JSONB columns sealed by lib/crypto/vault.ts.

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  zohoOrganizations,
  type NewZohoOrganization,
  type ZohoOrganization,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { seal } from "@/lib/crypto/vault";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export async function listOrgs(): Promise<ZohoOrganization[]> {
  return db.select().from(zohoOrganizations).orderBy(asc(zohoOrganizations.name));
}

export async function getOrg(id: string): Promise<ZohoOrganization | null> {
  const [row] = await db
    .select()
    .from(zohoOrganizations)
    .where(eq(zohoOrganizations.id, id));
  return row ?? null;
}

export async function getOrgByName(name: string): Promise<ZohoOrganization | null> {
  const [row] = await db
    .select()
    .from(zohoOrganizations)
    .where(eq(zohoOrganizations.name, name));
  return row ?? null;
}

export type CreateOrgInput = {
  name: string;
  organizationId: string;
  apiDomain?: string;
  accountsDomain?: string;
  clientId: string;
  clientSecret: string;
  defaultExpenseAccountName?: string | null;
  defaultExpenseAccountId?: string | null;
  defaultPaidThroughName?: string | null;
  defaultPaidThroughId?: string | null;
  defaultVendorName?: string | null;
  defaultVendorId?: string | null;
};

export async function createOrg(
  input: CreateOrgInput,
  actor: Actor,
): Promise<ZohoOrganization> {
  const values: NewZohoOrganization = {
    name: input.name,
    organizationId: input.organizationId,
    apiDomain: input.apiDomain ?? "https://www.zohoapis.com",
    accountsDomain: input.accountsDomain ?? "https://accounts.zoho.com",
    clientIdEncrypted: seal(input.clientId),
    clientSecretEncrypted: seal(input.clientSecret),
    defaultExpenseAccountName: input.defaultExpenseAccountName ?? null,
    defaultExpenseAccountId: input.defaultExpenseAccountId ?? null,
    defaultPaidThroughName: input.defaultPaidThroughName ?? null,
    defaultPaidThroughId: input.defaultPaidThroughId ?? null,
    defaultVendorName: input.defaultVendorName ?? null,
    defaultVendorId: input.defaultVendorId ?? null,
    active: true,
  };
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(zohoOrganizations).values(values).returning();
    if (!row) throw new Error("createOrg: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "zoho_org.create",
        targetType: "ZohoOrganization",
        targetId: row.id,
        after: { name: row.name, organizationId: row.organizationId },
      },
      tx,
    );
    return row;
  });
}

export type UpdateOrgPatch = Partial<{
  name: string;
  organizationId: string;
  apiDomain: string;
  accountsDomain: string;
  clientId: string;
  clientSecret: string;
  defaultExpenseAccountName: string | null;
  defaultExpenseAccountId: string | null;
  defaultPaidThroughName: string | null;
  defaultPaidThroughId: string | null;
  defaultVendorName: string | null;
  defaultVendorId: string | null;
  active: boolean;
}>;

export async function updateOrg(
  id: string,
  patch: UpdateOrgPatch,
  actor: Actor,
): Promise<ZohoOrganization> {
  const set: Partial<NewZohoOrganization> = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.organizationId !== undefined ? { organizationId: patch.organizationId } : {}),
    ...(patch.apiDomain !== undefined ? { apiDomain: patch.apiDomain } : {}),
    ...(patch.accountsDomain !== undefined ? { accountsDomain: patch.accountsDomain } : {}),
    ...(patch.clientId !== undefined ? { clientIdEncrypted: seal(patch.clientId) } : {}),
    ...(patch.clientSecret !== undefined ? { clientSecretEncrypted: seal(patch.clientSecret) } : {}),
    ...(patch.defaultExpenseAccountName !== undefined
      ? { defaultExpenseAccountName: patch.defaultExpenseAccountName }
      : {}),
    ...(patch.defaultExpenseAccountId !== undefined
      ? { defaultExpenseAccountId: patch.defaultExpenseAccountId }
      : {}),
    ...(patch.defaultPaidThroughName !== undefined
      ? { defaultPaidThroughName: patch.defaultPaidThroughName }
      : {}),
    ...(patch.defaultPaidThroughId !== undefined
      ? { defaultPaidThroughId: patch.defaultPaidThroughId }
      : {}),
    ...(patch.defaultVendorName !== undefined
      ? { defaultVendorName: patch.defaultVendorName }
      : {}),
    ...(patch.defaultVendorId !== undefined
      ? { defaultVendorId: patch.defaultVendorId }
      : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(zohoOrganizations)
      .where(eq(zohoOrganizations.id, id));
    if (!before) throw new Error("updateOrg: not found");
    const [row] = await tx
      .update(zohoOrganizations)
      .set(set)
      .where(eq(zohoOrganizations.id, id))
      .returning();
    if (!row) throw new Error("updateOrg: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "zoho_org.update",
        targetType: "ZohoOrganization",
        targetId: id,
        before: { name: before.name },
        after: { name: row.name },
      },
      tx,
    );
    return row;
  });
}

/** Stash the OAuth refresh_token after a successful exchange. */
export async function setOrgRefreshToken(
  id: string,
  refreshToken: string,
): Promise<void> {
  await db
    .update(zohoOrganizations)
    .set({
      refreshTokenEncrypted: seal(refreshToken),
      updatedAt: new Date(),
    })
    .where(eq(zohoOrganizations.id, id));
}

export async function deleteOrg(id: string, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(zohoOrganizations)
      .where(eq(zohoOrganizations.id, id));
    if (!before) return;
    await tx.delete(zohoOrganizations).where(eq(zohoOrganizations.id, id));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "zoho_org.delete",
        targetType: "ZohoOrganization",
        targetId: id,
        before: { name: before.name },
      },
      tx,
    );
  });
}
