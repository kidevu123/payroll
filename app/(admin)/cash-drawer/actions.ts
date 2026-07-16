"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireCashDrawerAccess, requireAdmin } from "@/lib/auth-guards";
import {
  recordDeposit,
  recordWithdrawal,
  recordPettyCash,
  voidEntry,
  updateEntry,
} from "@/lib/db/queries/cash-drawer";

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

const pettyCashSchema = z.object({
  amountDollars: z.coerce.number().positive().max(1_000_000),
  description: z.string().min(1).max(300),
  reference: z.string().max(120).optional(),
});

export async function recordPettyCashAction(formData: FormData) {
  const session = await requireCashDrawerAccess();
  const parsed = pettyCashSchema.safeParse({
    amountDollars: formData.get("amountDollars"),
    description: formData.get("description"),
    reference: formData.get("reference") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Optional receipt upload (image/PDF). Stored before the ledger insert so
  // a failed write never leaves an entry pointing at a missing file.
  let receiptPath: string | null = null;
  const receipt = formData.get("receipt");
  if (receipt instanceof File && receipt.size > 0) {
    const { writeReceiptFile } = await import("@/lib/cash-drawer/receipt-storage");
    try {
      receiptPath = await writeReceiptFile(receipt);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Receipt upload failed." };
    }
  }
  try {
    await recordPettyCash(
      {
        amountCents: Math.round(parsed.data.amountDollars * 100),
        description: parsed.data.description,
        reference: parsed.data.reference ?? null,
        receiptPath,
      },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/cash-drawer");
    return { ok: true as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed." };
  }
}

const idSchema = z.string().uuid();

export async function voidEntryAction(entryId: string) {
  const session = await requireAdmin();
  if (!idSchema.safeParse(entryId).success) return { error: "Invalid id." };
  try {
    await voidEntry(entryId, { id: session.user.id, role: session.user.role });
    revalidatePath("/cash-drawer");
    return { ok: true as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed." };
  }
}

const editSchema = z.object({
  entryId: z.string().uuid(),
  amountDollars: z.coerce.number().positive().max(1_000_000),
  notes: z.string().max(500).optional(),
  invoiceNumber: z.string().max(120).optional(),
});

export async function updateEntryAction(formData: FormData) {
  const session = await requireAdmin();
  const parsed = editSchema.safeParse({
    entryId: formData.get("entryId"),
    amountDollars: formData.get("amountDollars"),
    notes: formData.get("notes") || undefined,
    invoiceNumber: formData.get("invoiceNumber") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await updateEntry(
      parsed.data.entryId,
      {
        amountCents: Math.round(parsed.data.amountDollars * 100),
        notes: parsed.data.notes ?? null,
        invoiceNumber: parsed.data.invoiceNumber ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/cash-drawer");
    return { ok: true as const };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed." };
  }
}
