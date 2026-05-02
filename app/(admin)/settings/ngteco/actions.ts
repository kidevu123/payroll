"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import { setNgtecoCredentials } from "@/lib/ngteco/credentials";
import { getCurrentPeriod } from "@/lib/db/queries/pay-periods";
import { createRun } from "@/lib/db/queries/payroll-runs";
import { getBoss } from "@/lib/jobs";
import { getSetting } from "@/lib/settings/runtime";

const formSchema = z.object({
  portalUrl: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  locationId: z.string().optional(),
  headless: z.union([z.literal("on"), z.literal(undefined)]).optional(),
});

export async function saveNgtecoConfig(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = formSchema.safeParse({
    portalUrl: formData.get("portalUrl"),
    username: (formData.get("username") as string | null) ?? undefined,
    password: (formData.get("password") as string | null) ?? undefined,
    locationId: (formData.get("locationId") as string | null) ?? undefined,
    headless: formData.get("headless") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await setNgtecoCredentials(
    {
      portalUrl: parsed.data.portalUrl,
      // Empty string means "don't change"; null means "clear" (UI doesn't
      // surface clear yet — Phase 2 keeps it simple).
      ...(parsed.data.username ? { username: parsed.data.username } : {}),
      ...(parsed.data.password ? { password: parsed.data.password } : {}),
      locationId: parsed.data.locationId ?? null,
      headless: parsed.data.headless === "on",
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/ngteco");
}

export async function runImportNow(): Promise<{ error?: string; runId?: string }> {
  const session = await requireAdmin();
  const company = await getSetting("company");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  }).format(new Date());
  // Read-only — auto-create disabled per owner directive. CSV upload
  // is the only path that creates pay periods now.
  const period = await getCurrentPeriod(today);
  if (!period) {
    return {
      error:
        "No current pay period. Upload a CSV at /run-payroll/upload first to establish the period.",
    };
  }
  const run = await createRun(period.id, new Date(), {
    id: session.user.id,
    role: session.user.role,
  });
  const boss = await getBoss();
  await boss.send("ngteco.import", { runId: run.id });
  revalidatePath("/ngteco");
  redirect(`/ngteco/${run.id}`);
}
