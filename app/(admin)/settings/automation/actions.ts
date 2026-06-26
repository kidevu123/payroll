"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminStrict } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { logger } from "@/lib/telemetry";

// Cron expression: exactly 5 fields (minute hour day-of-month month
// day-of-week), each a digit/range/list/star. Enforces structure;
// pg-boss does final semantic validation at runtime (rejects e.g.
// "99" in the minute field), but this catches obvious typos at save.
const CRON_FIELD = /^(\*|\d+|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$/;
const cronSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (s) => {
      const parts = s.trim().split(/\s+/);
      if (parts.length !== 5) return false;
      return parts.every((p) => CRON_FIELD.test(p));
    },
    'Cron must be 5 fields: "<minute> <hour> <day-of-month> <month> <day-of-week>" (e.g. "0 19 * * 0" for Sundays at 7pm).',
  );

const schema = z.object({
  cronEnabled: z.union([z.literal("on").transform(() => true), z.literal("off")]).or(z.boolean()).default(false),
  enabled: z.union([z.literal("on").transform(() => true), z.literal("off")]).or(z.boolean()).default(false),
  cron: cronSchema,
  punchPollEnabled: z.union([z.literal("on").transform(() => true), z.literal("off")]).or(z.boolean()).default(false),
  punchPollCron: cronSchema,
  employeeFixWindowHours: z.coerce.number().int().min(1).max(168),
  adminAutoNotifyOnIngestFail: z
    .union([z.literal("on").transform(() => true), z.literal("off")])
    .or(z.boolean())
    .default(false),
  suspiciousDurationMinutesShortThreshold: z.coerce.number().int().min(1),
  suspiciousDurationMinutesLongThreshold: z.coerce.number().int().min(1),
  ngtecoRosterSyncEnabled: z
    .union([z.literal("on").transform(() => true), z.literal("off")])
    .or(z.boolean())
    .default(false),
  ngtecoRosterNotify: z
    .union([z.literal("on").transform(() => true), z.literal("off")])
    .or(z.boolean())
    .default(false),
  ngtecoRosterMinHours: z.coerce.number().int().min(1).max(168),
});

export async function updateAutomationAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdminStrict();
  const parsed = schema.safeParse({
    cronEnabled: formData.get("cronEnabled") ?? "off",
    enabled: formData.get("enabled") ?? "off",
    cron: formData.get("cron"),
    punchPollEnabled: formData.get("punchPollEnabled") ?? "off",
    punchPollCron: formData.get("punchPollCron"),
    employeeFixWindowHours: formData.get("employeeFixWindowHours"),
    adminAutoNotifyOnIngestFail: formData.get("adminAutoNotifyOnIngestFail") ?? "off",
    suspiciousDurationMinutesShortThreshold: formData.get(
      "suspiciousDurationMinutesShortThreshold",
    ),
    suspiciousDurationMinutesLongThreshold: formData.get(
      "suspiciousDurationMinutesLongThreshold",
    ),
    ngtecoRosterSyncEnabled: formData.get("ngtecoRosterSyncEnabled") ?? "off",
    ngtecoRosterNotify: formData.get("ngtecoRosterNotify") ?? "off",
    ngtecoRosterMinHours: formData.get("ngtecoRosterMinHours"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  const current = await getSetting("automation");
  await setSetting(
    "automation",
    {
      ...current,
      cronEnabled: v.cronEnabled === true,
      payrollRun: { enabled: v.enabled === true, cron: v.cron },
      ngtecoPunchPoll: {
        enabled: v.punchPollEnabled === true,
        cron: v.punchPollCron,
      },
      employeeFixWindowHours: v.employeeFixWindowHours,
      adminAutoNotifyOnIngestFail: v.adminAutoNotifyOnIngestFail === true,
      suspiciousDurationMinutesShortThreshold: v.suspiciousDurationMinutesShortThreshold,
      suspiciousDurationMinutesLongThreshold: v.suspiciousDurationMinutesLongThreshold,
      ngtecoEmployeeRosterSync: {
        enabled: v.ngtecoRosterSyncEnabled === true,
        notifyOnImport: v.ngtecoRosterNotify === true,
        minHoursBetweenSync: v.ngtecoRosterMinHours,
      },
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );

  // pg-boss schedules are armed at process startup in registerJobs(), so
  // a fresh save here would otherwise be invisible until the next deploy.
  // Re-arm immediately against the running boss instance so the new cron
  // takes effect on the next firing window. Same call shape as
  // registerJobs — boss.schedule is upsert semantics, so calling it again
  // with a new cron updates the row in pgboss.schedule. We unschedule
  // when toggled off so a stale schedule doesn't keep firing.
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    // Cron expressions are interpreted in the company timezone, not
    // UTC. Without this option pg-boss treats "11:15 Mon-Sat" as UTC,
    // which fires at 6/7am ET. Mirror the registerJobs() behavior so
    // the boot path and the live-save path agree.
    const company = await getSetting("company").catch(() => null);
    const tzOpts = { tz: company?.timezone ?? "America/New_York" };
    if (v.cronEnabled === true && v.enabled === true) {
      await boss.schedule("payroll.run.tick", v.cron, undefined, tzOpts);
    } else {
      await boss.unschedule("payroll.run.tick").catch(() => undefined);
    }
    if (v.cronEnabled === true && v.punchPollEnabled === true) {
      await boss.schedule(
        "ngteco.punch.poll",
        v.punchPollCron,
        undefined,
        tzOpts,
      );
    } else {
      await boss.unschedule("ngteco.punch.poll").catch(() => undefined);
    }
    if (v.cronEnabled === true) {
      await boss.schedule("noop.heartbeat", "* * * * *", undefined, tzOpts);
      await boss.schedule("period.rollover", "30 0 * * *", undefined, tzOpts);
    } else {
      await boss.unschedule("noop.heartbeat").catch(() => undefined);
      await boss.unschedule("period.rollover").catch(() => undefined);
    }
    logger.info(
      {
        cronEnabled: v.cronEnabled,
        payrollRunCron: v.cron,
        punchPollCron: v.punchPollCron,
      },
      "automation: live schedule rearmed",
    );
  } catch (err) {
    // Don't fail the save — settings are persisted, the next process
    // start will pick them up. Log so the discrepancy is visible.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "automation: live rearm failed; new cron applies after next restart",
    );
  }

  revalidatePath("/settings/automation");
}
