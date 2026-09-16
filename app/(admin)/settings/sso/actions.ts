"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { ssoSchema, reconcileCronField } from "@/lib/settings/schemas";
import { writeAudit } from "@/lib/db/audit";
import { provisionMissingUsers, type ProvisionOutcome } from "@/lib/authentik/provision";
import { AUTHENTIK_RECONCILE_QUEUE } from "@/lib/jobs/handlers/authentik-reconcile";
import { logger } from "@/lib/telemetry";
import {
  findUserById,
  unlinkAuthentikAccount,
} from "@/lib/db/queries/users";

// groupName reuses ssoSchema's own field validator. reconcileCron uses the
// standalone `reconcileCronField` (the same regex, exported unwrapped)
// rather than `ssoSchema.shape.reconcileCron` — that field is wrapped in a
// preprocess that degrades an invalid stored cron to the default on read,
// and reusing it here would let a bad value typed into the form silently
// fall back to the default instead of being rejected. Validating here keeps
// a malformed value caught with a friendly {error} return, instead of
// throwing out of setSetting's schema.parse.
const formSchema = z.object({
  autoProvision: z.union([z.literal("on"), z.literal(undefined)]).optional(),
  groupName: ssoSchema.shape.groupName,
  reconcileCron: reconcileCronField,
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
  const autoProvision = parsed.data.autoProvision === "on";
  await setSetting(
    "sso",
    {
      autoProvision,
      groupName: parsed.data.groupName,
      reconcileCron: parsed.data.reconcileCron,
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );

  // pg-boss schedules are armed at process startup in registerJobs(), so a
  // fresh save here would otherwise be invisible until the next restart —
  // same reasoning and shape as updateAutomationAction in
  // app/(admin)/settings/automation/actions.ts. Re-arm immediately against
  // the running boss instance.
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    const automation = await getSetting("automation").catch(() => null);
    const company = await getSetting("company").catch(() => null);
    const cronEnabled = automation?.cronEnabled ?? true;
    const tzOpts = { tz: company?.timezone ?? "America/New_York" };
    if (cronEnabled && autoProvision) {
      await boss.schedule(
        AUTHENTIK_RECONCILE_QUEUE,
        parsed.data.reconcileCron,
        undefined,
        tzOpts,
      );
    } else {
      await boss.unschedule(AUTHENTIK_RECONCILE_QUEUE).catch(() => undefined);
    }
    logger.info(
      { autoProvision, reconcileCron: parsed.data.reconcileCron },
      "sso: live schedule rearmed",
    );
  } catch (err) {
    // Don't fail the save — the setting is persisted, the next process
    // start will pick it up. Log so the discrepancy is visible.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "sso: live rearm failed; new cron applies after next restart",
    );
  }

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
 * unreachable by SSO until an admin clears the stale link here. Clearing it
 * only removes the link — the account is re-bound by the next provisioning
 * sweep (the nightly job, or an admin pressing "Run sync now"), so the user
 * still can't sign in with SSO until that sweep runs.
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
