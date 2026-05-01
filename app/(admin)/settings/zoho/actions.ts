"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import {
  createOrg,
  deleteOrg,
  updateOrg,
} from "@/lib/db/queries/zoho";
import { testZohoConnection } from "@/lib/zoho/push";

const idSchema = z.string().uuid();

const baseSchema = z.object({
  name: z.string().min(1).max(80),
  organizationId: z.string().min(1).max(40),
  apiDomain: z.string().url().default("https://www.zohoapis.com"),
  accountsDomain: z.string().url().default("https://accounts.zoho.com"),
  defaultExpenseAccountName: z
    .union([z.string().max(160), z.literal("").transform(() => null)])
    .nullable(),
  defaultPaidThroughName: z
    .union([z.string().max(160), z.literal("").transform(() => null)])
    .nullable(),
  defaultVendorName: z
    .union([z.string().max(160), z.literal("").transform(() => null)])
    .nullable(),
});

const createSchema = baseSchema.extend({
  clientId: z.string().min(1).max(120),
  clientSecret: z.string().min(1).max(200),
});

const updateSchema = baseSchema.extend({
  clientId: z.string().max(120).optional(),
  clientSecret: z.string().max(200).optional(),
});

function parseFields(formData: FormData) {
  return {
    name: formData.get("name"),
    organizationId: formData.get("organizationId"),
    apiDomain: formData.get("apiDomain") || "https://www.zohoapis.com",
    accountsDomain: formData.get("accountsDomain") || "https://accounts.zoho.com",
    defaultExpenseAccountName: formData.get("defaultExpenseAccountName") || null,
    defaultPaidThroughName: formData.get("defaultPaidThroughName") || null,
    defaultVendorName: formData.get("defaultVendorName") || null,
  };
}

export async function createOrgAction(
  formData: FormData,
): Promise<{ error?: string; orgId?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    ...parseFields(formData),
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const org = await createOrg(parsed.data, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/zoho");
    return { orgId: org.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Create failed." };
  }
}

export async function updateOrgAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = updateSchema.safeParse({
    ...parseFields(formData),
    ...(formData.get("clientId") ? { clientId: formData.get("clientId") } : {}),
    ...(formData.get("clientSecret") ? { clientSecret: formData.get("clientSecret") } : {}),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const { clientId, clientSecret, ...rest } = parsed.data;
    await updateOrg(
      id,
      {
        ...rest,
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/settings/zoho");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Update failed." };
  }
}

export async function deleteOrgAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await deleteOrg(id, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/zoho");
}

export async function testConnectionAction(
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Invalid id." };
  const result = await testZohoConnection(id, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath("/settings/zoho");
  return result;
}
