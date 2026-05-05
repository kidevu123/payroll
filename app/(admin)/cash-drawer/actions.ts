"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireCashDrawerAccess } from "@/lib/auth-guards";
import { recordDeposit, recordWithdrawal } from "@/lib/db/queries/cash-drawer";

const depositSchema = z.object({
  amountDollars: z.coerce.number().positive().max(1_000_000),
  invoiceNumber: z.string().min(1).max(120),
  notes: z.string().max(500).optional(),
});

export async function recordDepositAction(formData: FormData) {
  const session = await requireCashDrawerAccess();
  const parsed = depositSchema.safeParse({
    amountDollars: formData.get("amountDollars"),
    invoiceNumber: formData.get("invoiceNumber"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await recordDeposit(
      {
        amountCents: Math.round(parsed.data.amountDollars * 100),
        invoiceNumber: parsed.data.invoiceNumber,
        notes: parsed.data.notes ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/cash-drawer");
    return { ok: true as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed." };
  }
}

const withdrawSchema = z.object({
  amountDollars: z.coerce.number().positive().max(1_000_000),
  notes: z.string().max(500).optional(),
});

export async function recordWithdrawalAction(formData: FormData) {
  const session = await requireCashDrawerAccess();
  const parsed = withdrawSchema.safeParse({
    amountDollars: formData.get("amountDollars"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await recordWithdrawal(
      {
        amountCents: Math.round(parsed.data.amountDollars * 100),
        periodId: null,
        notes: parsed.data.notes ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/cash-drawer");
    return { ok: true as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed." };
  }
}
