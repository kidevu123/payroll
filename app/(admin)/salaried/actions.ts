"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { createDoc, deleteDoc, getDoc } from "@/lib/db/queries/payroll-documents";

const idSchema = z.string().uuid();

const ACCEPT_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const PAYROLL_DOC_ROOT =
  process.env.PAYROLL_DOC_ROOT ?? "/data/uploads/payroll-docs";
const MAX_BYTES = 10 * 1024 * 1024;

const kindSchema = z.enum(["W2", "PAYSTUB", "OTHER"]);

const metaSchema = z.object({
  payPeriodStart: z
    .union([z.string().date(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  payPeriodEnd: z
    .union([z.string().date(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  /** Dollars as the admin types ($2,143.20). Stored as integer cents. */
  amountDollars: z
    .union([
      z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a number"),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional(),
});

/**
 * Salaried-employee document upload. Decoupled from any payroll period
 * (period_id stays NULL on the row) — these are W2s / external paystubs
 * that arrive on their own cadence, not tied to a punch-driven run.
 *
 * Optional metadata (pay period dates + net amount) gets persisted on
 * the document row so the salaried tab card can render "Apr 16–30 ·
 * $2,143" without the admin having to open the PDF.
 */
export async function uploadSalariedDocAction(
  employeeId: string,
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(employeeId).success) return { error: "Invalid employee." };
  const kindRaw = formData.get("kind");
  const kind = kindSchema.safeParse(kindRaw);
  if (!kind.success) return { error: "Invalid document kind." };
  const meta = metaSchema.safeParse({
    payPeriodStart: formData.get("payPeriodStart") || "",
    payPeriodEnd: formData.get("payPeriodEnd") || "",
    amountDollars: formData.get("amountDollars") || "",
  });
  if (!meta.success) {
    return { error: meta.error.issues[0]?.message ?? "Invalid metadata." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` };
  }
  if (!ACCEPT_MIME.has(file.type)) {
    return { error: "Only PDF, PNG, JPG, or XLSX files are accepted." };
  }
  if (
    meta.data.payPeriodStart &&
    meta.data.payPeriodEnd &&
    meta.data.payPeriodEnd < meta.data.payPeriodStart
  ) {
    return { error: "Pay period end can't be before start." };
  }
  const amountCents =
    meta.data.amountDollars && meta.data.amountDollars !== ""
      ? Math.round(Number(meta.data.amountDollars) * 100)
      : null;
  // Verify the employee exists and is actually salaried.
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!employee) return { error: "Employee not found." };
  if (employee.payType !== "SALARIED") {
    return {
      error:
        "This employee isn't classified as Salaried. Switch their classification on the profile first.",
    };
  }

  // Persist to disk under PAYROLL_DOC_ROOT/_salaried/<employeeId>/<filename>.
  // The "_salaried" segment makes it obvious in `find` listings that these
  // aren't tied to a period (vs the period-bound docs at <periodId>/...).
  const { mkdir, writeFile } = await import("fs/promises");
  const { join, extname } = await import("path");
  const { randomUUID } = await import("crypto");

  const dir = join(PAYROLL_DOC_ROOT, "_salaried", employeeId);
  await mkdir(dir, { recursive: true });
  const ext = extname(file.name) || mimeToExt(file.type);
  const stored = `${randomUUID()}${ext}`;
  const filePath = join(dir, stored);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buf, { mode: 0o640 });

  try {
    await createDoc(
      {
        periodId: null,
        employeeId,
        kind: kind.data,
        filePath,
        mime: file.type,
        originalFilename: file.name,
        sizeBytes: file.size,
        visibleToEmployee: true,
        uploadedById: session.user.id,
        payPeriodStart: meta.data.payPeriodStart ?? null,
        payPeriodEnd: meta.data.payPeriodEnd ?? null,
        amountCents,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save document.",
    };
  }

  revalidatePath("/salaried");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/me/pay");
  return { ok: true };
}

export async function deleteSalariedDocAction(
  docId: string,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(docId).success) return { error: "Invalid id." };
  const doc = await getDoc(docId);
  if (!doc) return { error: "Document not found." };
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
  revalidatePath("/salaried");
  if (doc.periodId) revalidatePath(`/payroll/${doc.periodId}`);
  revalidatePath(`/employees/${doc.employeeId}`);
  revalidatePath("/me/pay");
  return { ok: true };
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    default:
      return "";
  }
}
