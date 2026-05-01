"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  lockPeriod,
  markPaid,
  unlockPeriod,
  unmarkPaid,
} from "@/lib/db/queries/pay-periods";

const idSchema = z.string().uuid();

export async function lockPeriodAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await lockPeriod(id, { id: session.user.id, role: session.user.role });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

const unlockSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unlockPeriodAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unlockSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  await unlockPeriod(id, parsed.data.reason, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

export async function markPaidAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  try {
    await markPaid(id, { id: session.user.id, role: session.user.role });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

const unmarkPaidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unmarkPaidAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unmarkPaidSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  try {
    await unmarkPaid(id, parsed.data.reason, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not unmark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}
