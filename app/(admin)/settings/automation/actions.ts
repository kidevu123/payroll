"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";

const schema = z.object({
  enabled: z.union([z.literal("on").transform(() => true), z.literal("off")]).or(z.boolean()).default(false),
  cron: z.string().min(1).max(120).regex(/^[\d*/,\- ]+$/, "Cron must use only digits, *, /, ,, -, and spaces"),
  punchPollEnabled: z.union([z.literal("on").transform(() => true), z.literal("off")]).or(z.boolean()).default(false),
  punchPollCron: z.string().min(1).max(120).regex(/^[\d*/,\- ]+$/, "Cron must use only digits, *, /, ,, -, and spaces"),
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
