"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { securitySchema } from "@/lib/settings/schemas";

const formSchema = z.object({
  adminTwoFactorRequired: z
    .union([z.literal("on"), z.literal(undefined)])
    .optional(),
  sessionTimeoutDays: z.coerce.number().int().min(1).max(180),
  loginRateLimitMax: z.coerce.number().int().min(1),
  loginRateLimitWindowMinutes: z.coerce.number().int().min(1),
});

export async function saveSecurity(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = formSchema.safeParse({
    adminTwoFactorRequired: formData.get("adminTwoFactorRequired") ?? undefined,
    sessionTimeoutDays: formData.get("sessionTimeoutDays"),
    loginRateLimitMax: formData.get("loginRateLimitMax"),
    loginRateLimitWindowMinutes: formData.get("loginRateLimitWindowMinutes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const value = securitySchema.parse({
    adminTwoFactorRequired: parsed.data.adminTwoFactorRequired === "on",
    sessionTimeoutDays: parsed.data.sessionTimeoutDays,
    loginRateLimit: {
      maxAttempts: parsed.data.loginRateLimitMax,
      windowMinutes: parsed.data.loginRateLimitWindowMinutes,
    },
  });
  await setSetting("security", value, {
    actorId: session.user.id,
    actorRole: session.user.role,
  });
  revalidatePath("/settings/security");
}
