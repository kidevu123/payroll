"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { payPeriodSchema } from "@/lib/settings/schemas";
import { countPeriods } from "@/lib/db/queries/pay-periods";

const formSchema = z.object({
  lengthDays: z.coerce.number().int().min(1).max(31),
  startDayOfWeek: z.coerce.number().int().min(0).max(6),
  workingDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
  firstStartDate: z
    .union([z.string().date(), z.literal("").transform(() => null)])
    .nullable(),
});

export async function savePayPeriod(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const workingDays = formData.getAll("workingDays").map((v) => Number(v));
  const parsed = formSchema.safeParse({
    lengthDays: formData.get("lengthDays"),
    startDayOfWeek: formData.get("startDayOfWeek"),
    workingDays,
    firstStartDate: formData.get("firstStartDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Guard: firstStartDate cannot be edited once any period exists. Send to
  // /settings/pay-periods/reset (owner-only, with confirmation) instead.
  const existingCount = await countPeriods();
  if (existingCount > 0) {
    // Read current value to compare. We accept a no-op (same value) silently.
    const current = await import("@/lib/settings/runtime").then((m) =>
      m.getSetting("payPeriod"),
    );
    if ((current.firstStartDate ?? null) !== (parsed.data.firstStartDate ?? null)) {
      return {
        error:
          "First start date can't be changed once periods exist. Reach out via /settings/pay-periods/reset (owner-only).",
      };
    }
  }

  const value = payPeriodSchema.parse({
    lengthDays: parsed.data.lengthDays,
    startDayOfWeek: parsed.data.startDayOfWeek,
    workingDays: parsed.data.workingDays,
    firstStartDate: parsed.data.firstStartDate,
  });
  await setSetting("payPeriod", value, {
    actorId: session.user.id,
    actorRole: session.user.role,
  });
  revalidatePath("/settings/pay-periods");
}
