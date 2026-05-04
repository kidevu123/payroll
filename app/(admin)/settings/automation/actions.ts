"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";

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
});

export async function updateAutomationAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
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
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/automation");
}
