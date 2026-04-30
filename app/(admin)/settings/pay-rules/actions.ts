"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { payRulesSchema } from "@/lib/settings/schemas";

const formSchema = z.object({
  rounding: z.enum([
    "NONE",
    "NEAREST_DOLLAR",
    "NEAREST_QUARTER",
    "NEAREST_FIFTEEN_MIN_HOURS",
  ]),
  hoursDecimalPlaces: z.coerce.number().int().min(0).max(6),
  overtimeEnabled: z.union([z.literal("on"), z.literal(undefined)]).optional(),
  overtimeThresholdHours: z.coerce.number().min(0),
  overtimeMultiplier: z.coerce.number().min(1),
});

export async function savePayRules(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = formSchema.safeParse({
    rounding: formData.get("rounding"),
    hoursDecimalPlaces: formData.get("hoursDecimalPlaces"),
    overtimeEnabled: formData.get("overtimeEnabled") ?? undefined,
    overtimeThresholdHours: formData.get("overtimeThresholdHours"),
    overtimeMultiplier: formData.get("overtimeMultiplier"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const value = payRulesSchema.parse({
    rounding: parsed.data.rounding,
    hoursDecimalPlaces: parsed.data.hoursDecimalPlaces,
    overtime: {
      enabled: parsed.data.overtimeEnabled === "on",
      thresholdHours: parsed.data.overtimeThresholdHours,
      multiplier: parsed.data.overtimeMultiplier,
    },
  });
  await setSetting("payRules", value, {
    actorId: session.user.id,
    actorRole: session.user.role,
  });
  revalidatePath("/settings/pay-rules");
}
