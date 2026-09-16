"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { writeAudit } from "@/lib/db/audit";
import { provisionMissingUsers, type ProvisionOutcome } from "@/lib/authentik/provision";
import {
  findUserById,
  unlinkAuthentikAccount,
} from "@/lib/db/queries/users";

const formSchema = z.object({
  autoProvision: z.union([z.literal("on"), z.literal(undefined)]).optional(),
  groupName: z.string().min(1).max(120),
  reconcileCron: z.string().min(1).max(120),
});

export async function saveSsoSettings(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = formSchema.safeParse({
    autoProvision: formData.get("autoProvision") ?? undefined,
    groupName: formData.get("groupName"),
    reconcileCron: formData.get("reconcileCron"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await setSetting(
    "sso",
    {
      autoProvision: parsed.data.autoProvision === "on",
      groupName: parsed.data.groupName,
      reconcileCron: parsed.data.reconcileCron,
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/sso");
}

/** Dry run: reports what a sync WOULD do. Writes nothing, anywhere. */
export async function previewSsoSyncAction(): Promise<{ outcomes: ProvisionOutcome[] }> {
  await requireAdmin();
  return { outcomes: await provisionMissingUsers({ dryRun: true }) };
}

export async function runSsoReconcileAction(): Promise<{ outcomes: ProvisionOutcome[] }> {
  const session = await requireAdmin();
  const outcomes = await provisionMissingUsers();
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "authentik.sync.manual",
    targetType: "Setting",
    targetId: "sso",
    after: { count: outcomes.length },
  });
  revalidatePath("/settings/sso");
  return { outcomes };
}

const idSchema = z.string().uuid();

/**
 * Escape hatch for Task 9's account-takeover protection: once a payroll
 * user is bound to an Authentik subject, sign-in refuses any other subject
 * for that account. If Authentik ever re-creates the employee's identity
 * (deleted and re-added, tenant migration, etc.) the account becomes
 * unreachable by SSO until an admin clears the stale link here — the next
 * SSO sign-in then binds fresh to whichever Authentik identity presents.
 */
export async function unlinkSsoAction(
  userId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = idSchema.safeParse(userId);
  if (!parsed.success) {
    return { error: "Invalid user id." };
  }
  const before = await findUserById(parsed.data);
  if (!before) {
    return { error: "User not found." };
  }
  await unlinkAuthentikAccount(parsed.data);
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "authentik.user.unlinked",
    targetType: "User",
    targetId: parsed.data,
    before: {
      authentikSub: before.authentikSub,
      authentikPk: before.authentikPk,
      authentikUsername: before.authentikUsername,
      authentikSyncedAt: before.authentikSyncedAt,
    },
  });
  revalidatePath("/settings/sso");
}
