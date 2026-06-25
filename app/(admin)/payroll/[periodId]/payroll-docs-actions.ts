"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { employees, payPeriods } from "@/lib/db/schema";
import { createDoc, deleteDoc, getDoc } from "@/lib/db/queries/payroll-documents";
import {
  PAYROLL_DOC_MAX_BYTES as MAX_BYTES,
  writePaystubFile,
} from "@/lib/documents/paystub-storage";

const idSchema = z.string().uuid();

const ACCEPT_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const kindSchema = z.enum(["W2", "PAYSTUB", "OTHER"]);

export async function uploadPayrollDocAction(
  periodId: string,
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(periodId).success) return { error: "Invalid period." };
  // PAID guard: server-enforced even though the UI hides the upload
  // slot — a stale form replay or scripted POST can otherwise mutate
  // documents on a paid period.
  {
    const { db } = await import("@/lib/db");
    const { payPeriods } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [pr] = await db
      .select({ state: payPeriods.state })
      .from(payPeriods)
      .where(eq(payPeriods.id, periodId));
    if (pr?.state === "PAID") {
      return { error: "Period is paid. Unmark paid before uploading documents." };
    }
  }
  const employeeId = formData.get("employeeId");
  if (typeof employeeId !== "string" || !idSchema.safeParse(employeeId).success) {
    return { error: "Invalid employee." };
  }
  const kindRaw = formData.get("kind");
  const kind = kindSchema.safeParse(kindRaw);
  if (!kind.success) return { error: "Invalid document kind." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` };
  }
  if (!ACCEPT_MIME.has(file.type)) {
    return {
      error: "Only PDF, PNG, JPG, or XLSX files are accepted.",
    };
  }

  // Net pay amount entered by admin from the accountant's paystub. The
  // paystub gross is on the PDF, but Zoho gets the NET (post-tax) amount
  // because that's what we actually wire to the employee. Required for
  // PAYSTUB; optional for W2 / OTHER.
  const netAmountRaw = formData.get("netAmountDollars");
  let amountCents: number | null = null;
  if (typeof netAmountRaw === "string" && netAmountRaw.trim() !== "") {
    const { optionalDollarsToCents } = await import("@/lib/settings/money-input");
    const parsed = optionalDollarsToCents.safeParse(netAmountRaw);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid net amount." };
    }
    amountCents = parsed.data;
  }
  if (kind.data === "PAYSTUB" && amountCents === null) {
    return {
      error:
        "Net pay amount is required for paystubs (this is what's pushed to Zoho — the net the employee actually receives, not the gross).",
    };
  }

  // Validate the period + employee exist.
  const [period] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, periodId));
  if (!period) return { error: "Period not found." };
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!employee) return { error: "Employee not found." };

  // Persist under PAYROLL_DOC_ROOT/<periodId>/<employeeId> via the shared writer
  // (randomized filename, 0o640). original_filename is stored in the DB.
  const filePath = await writePaystubFile({
    segments: [periodId, employeeId],
    originalFilename: file.name,
    mime: file.type,
    buf: Buffer.from(await file.arrayBuffer()),
  });

  try {
    await createDoc(
      {
        periodId,
        employeeId,
        kind: kind.data,
        filePath,
        mime: file.type,
        originalFilename: file.name,
        sizeBytes: file.size,
        visibleToEmployee: true,
        uploadedById: session.user.id,
        ...(amountCents !== null ? { amountCents } : {}),
        ...(period.startDate ? { payPeriodStart: period.startDate } : {}),
        ...(period.endDate ? { payPeriodEnd: period.endDate } : {}),
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save document.",
    };
  }

  revalidatePath(`/payroll/${periodId}`);
  revalidatePath("/me/pay");
  return { ok: true };
}

export async function deletePayrollDocAction(
  docId: string,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(docId).success) return { error: "Invalid id." };
  const doc = await getDoc(docId);
  if (!doc) return { error: "Document not found." };
  // PAID guard. Skip when the doc isn't tied to a period (free-form
  // salaried paystubs may have a date range only).
  if (doc.periodId) {
    const { db } = await import("@/lib/db");
    const { payPeriods } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [pr] = await db
      .select({ state: payPeriods.state })
      .from(payPeriods)
      .where(eq(payPeriods.id, doc.periodId));
    if (pr?.state === "PAID") {
      return { error: "Period is paid. Unmark paid before deleting documents." };
    }
  }
  try {
    await deleteDoc(docId, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not remove document.",
    };
  }
  revalidatePath(`/payroll/${doc.periodId}`);
  revalidatePath("/me/pay");
  return { ok: true };
}
