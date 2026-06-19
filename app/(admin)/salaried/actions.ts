"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { employees, paySchedules } from "@/lib/db/schema";
import {
  createDoc,
  deleteDoc,
  getDoc,
  updateDocAmount,
} from "@/lib/db/queries/payroll-documents";
import { periodBoundsForSchedule } from "@/lib/db/queries/pay-periods";
import { pushPaystubToZoho } from "@/lib/zoho/push";
import { listOrgs } from "@/lib/db/queries/zoho";
import {
  extractPdfText,
  suggestNetFromText,
  type NetSuggestion,
} from "@/lib/salaried/extract-net";

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
  if (kind.data === "PAYSTUB" && (amountCents === null || amountCents <= 0)) {
    return {
      error:
        "Net pay is required for paystubs — enter the post-tax amount the employee actually receives (this is what Zoho gets, not the gross on the PDF).",
    };
  }
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

export async function setSalariedDocNetAmountAction(
  docId: string,
  amountDollars: string,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(docId).success) return { error: "Invalid id." };
  const trimmed = amountDollars.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { error: "Enter a valid dollar amount (e.g. 1702.42)." };
  }
  const amountCents = Math.round(Number(trimmed) * 100);
  if (amountCents <= 0) {
    return { error: "Net amount must be greater than zero." };
  }
  const doc = await getDoc(docId);
  if (!doc) return { error: "Document not found." };
  if (doc.kind !== "PAYSTUB") {
    return { error: "Only paystubs need a net amount for Zoho." };
  }
  if (doc.zohoExpenseId) {
    return {
      error:
        "This paystub was already pushed to Zoho. Delete the expense in Zoho first, or re-upload a corrected paystub.",
    };
  }
  try {
    await updateDocAmount(docId, amountCents, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save amount.",
    };
  }
  revalidatePath("/salaried");
  revalidatePath(`/employees/${doc.employeeId}`);
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

export type ZohoOrgChoice = { id: string; name: string };

export async function listZohoOrgsAction(): Promise<ZohoOrgChoice[]> {
  await requireAdmin();
  // Never throw to the client — a thrown server action rejects the button's
  // onClick await and the push silently does nothing. On any failure return
  // an empty list; the caller surfaces "connect Zoho in Settings".
  try {
    const orgs = await listOrgs();
    return orgs
      .filter((o) => o.active)
      .map((o) => ({ id: o.id, name: o.name }));
  } catch {
    return [];
  }
}

/**
 * Push an uploaded paystub doc to Zoho Books as an expense with the
 * file attached as the receipt. Idempotent — re-clicking after a
 * successful push returns the existing expense without re-creating.
 */
export async function pushDocToZohoAction(
  docId: string,
  organizationId: string,
): Promise<
  | { error: string }
  | { ok: true; expenseId: string; alreadyExists: boolean }
> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(docId).success) return { error: "Invalid doc id." };
  if (!idSchema.safeParse(organizationId).success) {
    return { error: "Invalid Zoho org id." };
  }
  try {
    const result = await pushPaystubToZoho(docId, organizationId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/salaried");
    return { ok: true, ...result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Push failed.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-pick the pay period for a salaried employee given a reference date.
// Owner directive: "I could easily just give the date I upload the pay
// period paystub and boom done". Reads the employee's payScheduleId and
// returns the (startDate, endDate) of the period containing the date.
//
// Returns { kind: "NONE" } when the employee has no schedule attached;
// admin must enter dates manually for that case.
// ─────────────────────────────────────────────────────────────────────────────

const inferSchema = z.object({
  employeeId: z.string().uuid(),
  referenceDate: z.string().date(),
});

export async function inferSalariedPeriodAction(
  input: { employeeId: string; referenceDate: string },
): Promise<
  | { kind: "NONE" }
  | {
      kind: "OK";
      scheduleName: string;
      periodKind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";
      startDate: string;
      endDate: string;
    }
  | { kind: "ERROR"; error: string }
> {
  await requireAdmin();
  const parsed = inferSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "ERROR", error: "Invalid input." };
  }
  const [emp] = await db
    .select({ payScheduleId: employees.payScheduleId })
    .from(employees)
    .where(eq(employees.id, parsed.data.employeeId));
  if (!emp || !emp.payScheduleId) {
    return { kind: "NONE" };
  }
  const [sched] = await db
    .select()
    .from(paySchedules)
    .where(eq(paySchedules.id, emp.payScheduleId));
  if (!sched) return { kind: "NONE" };
  const bounds = periodBoundsForSchedule(parsed.data.referenceDate, {
    periodKind: sched.periodKind,
    anchorDate: sched.anchorDate,
  });
  return {
    kind: "OK",
    scheduleName: sched.name,
    periodKind: sched.periodKind,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Best-effort net-pay auto-read. Owner directive: "I don't want to type
// the net by hand." On file selection the client posts the chosen PDF
// here; we extract its text layer and ask the on-network Ollama model for
// the post-tax net, then the client PRE-FILLS the (still editable) net
// field. Every failure degrades to "enter manually" — this NEVER blocks
// upload and is purely advisory.
// ─────────────────────────────────────────────────────────────────────────────

export async function suggestNetFromPdfAction(
  formData: FormData,
): Promise<NetSuggestion> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { kind: "NO_MATCH" };
  }
  // Text extraction only supports PDFs. Images/XLSX have no text layer
  // we read here → caller falls back to manual entry.
  if (file.type !== "application/pdf") {
    return { kind: "NO_TEXT" };
  }
  if (file.size > MAX_BYTES) {
    return { kind: "ERROR", error: "File too large to read." };
  }
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const text = await extractPdfText(buf);
    if (!text) return { kind: "NO_TEXT" };
    return await suggestNetFromText(text);
  } catch (err) {
    return {
      kind: "ERROR",
      error: err instanceof Error ? err.message : "Could not read PDF.",
    };
  }
}
