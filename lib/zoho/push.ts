// Zoho Books expense push. Called from /reports → "Push to Haute / Boomin"
// after the admin clicks the button on a payroll_runs row.
//
// Idempotent: a successful push is recorded in zoho_pushes, and the unique
// index (run_id, org_id) where status='OK' prevents double-charging the
// same expense. Re-clicking the button on a successful row returns the
// existing zoho_pushes row instead of issuing a fresh API call.
//
// Implementation lives in lib/zoho/client.ts (token cache + REST calls);
// this file is the orchestration layer that does the DB book-keeping.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payrollPeriodDocuments,
  payrollRuns,
  payslips,
  zohoOrganizations,
  zohoPushes,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { attachReceipt, createExpense, validateConnection } from "./client";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export type PushResult = {
  expenseId: string;
  alreadyExists: boolean;
};

export async function pushReportToZoho(
  payrollRunId: string,
  organizationId: string,
  actor: Actor,
): Promise<PushResult> {
  // Look for an existing OK push first (idempotency).
  const [existingPush] = await db
    .select()
    .from(zohoPushes)
    .where(eq(zohoPushes.payrollRunId, payrollRunId));
  if (existingPush?.status === "OK" && existingPush.expenseId) {
    return { expenseId: existingPush.expenseId, alreadyExists: true };
  }

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, payrollRunId));
  if (!run) throw new Error("Run not found.");

  const [org] = await db
    .select()
    .from(zohoOrganizations)
    .where(eq(zohoOrganizations.id, organizationId));
  if (!org) throw new Error("Zoho organization not found.");
  if (!org.active) throw new Error("Zoho organization is inactive.");

  // Total: prefer explicit total_amount_cents, else sum of payslips.
  let totalCents = run.totalAmountCents;
  if (!totalCents) {
    const slips = await db
      .select()
      .from(payslips)
      .where(eq(payslips.payrollRunId, payrollRunId));
    totalCents = slips.reduce((s, p) => s + p.roundedPayCents, 0);
  }
  if (!totalCents || totalCents <= 0) {
    throw new Error("Run has no positive total — nothing to push.");
  }

  try {
    const expense = await createExpense({
      org,
      amountCents: totalCents,
      reference: `Payroll run ${payrollRunId}`,
      date: (run.postedAt ?? run.publishedAt ?? new Date()).toISOString().slice(0, 10),
    });
    await db.insert(zohoPushes).values({
      payrollRunId,
      organizationId,
      expenseId: expense.expenseId,
      amountCents: totalCents,
      status: "OK",
      pushedById: actor.id,
    });
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "zoho.push.ok",
      targetType: "PayrollRun",
      targetId: payrollRunId,
      after: { organizationId, expenseId: expense.expenseId, amountCents: totalCents },
    });
    return { expenseId: expense.expenseId, alreadyExists: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(zohoPushes).values({
      payrollRunId,
      organizationId,
      amountCents: totalCents,
      status: "ERROR",
      errorMessage: message,
      pushedById: actor.id,
    });
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "zoho.push.error",
      targetType: "PayrollRun",
      targetId: payrollRunId,
      after: { organizationId, error: message },
    });
    throw err;
  }
}

/**
 * Push a salaried-employee paystub upload to Zoho Books as an expense
 * with the original PDF attached as the receipt. Idempotent: a previous
 * successful push (zohoExpenseId + zohoPushedAt populated on the doc
 * row) returns the existing expense ID without re-creating it.
 */
export async function pushPaystubToZoho(
  documentId: string,
  organizationId: string,
  actor: Actor,
): Promise<PushResult> {
  const [doc] = await db
    .select()
    .from(payrollPeriodDocuments)
    .where(eq(payrollPeriodDocuments.id, documentId));
  if (!doc) throw new Error("Document not found.");
  if (doc.deletedAt) throw new Error("Document is deleted.");
  if (doc.zohoExpenseId) {
    return { expenseId: doc.zohoExpenseId, alreadyExists: true };
  }
  if (!doc.amountCents || doc.amountCents <= 0) {
    throw new Error(
      "Document has no positive amount. Set the net amount on upload before pushing.",
    );
  }
  const [org] = await db
    .select()
    .from(zohoOrganizations)
    .where(eq(zohoOrganizations.id, organizationId));
  if (!org) throw new Error("Zoho organization not found.");
  if (!org.active) throw new Error("Zoho organization is inactive.");

  // Pull employee for a useful expense reference like "Paystub — Juan J".
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, doc.employeeId));
  const empName = employee?.displayName ?? "Salaried staff";
  const periodLabel = doc.payPeriodStart && doc.payPeriodEnd
    ? `${doc.payPeriodStart}..${doc.payPeriodEnd}`
    : doc.uploadedAt.toISOString().slice(0, 10);
  const reference = `${doc.kind} — ${empName} ${periodLabel}`.slice(0, 100);

  // Read the PDF (or whatever file kind) into memory so we can multipart it.
  const { readFile } = await import("fs/promises");
  let bytes: Buffer;
  try {
    bytes = await readFile(doc.filePath);
  } catch (err) {
    throw new Error(
      `Document file is missing on disk (${doc.filePath}). Re-upload before pushing.`,
    );
  }

  const expense = await createExpense({
    org,
    amountCents: doc.amountCents,
    reference,
    date:
      doc.payPeriodEnd ??
      doc.uploadedAt.toISOString().slice(0, 10),
  });
  // Attach the file as the expense receipt. If this fails, the expense
  // already exists — log + bail; user can re-attach manually in Zoho.
  await attachReceipt({
    org,
    expenseId: expense.expenseId,
    filename: doc.originalFilename,
    mime: doc.mime,
    bytes: new Uint8Array(bytes),
  });

  await db
    .update(payrollPeriodDocuments)
    .set({
      zohoExpenseId: expense.expenseId,
      zohoOrganizationId: org.id,
      zohoPushedAt: new Date(),
    })
    .where(eq(payrollPeriodDocuments.id, documentId));

  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "payroll_period_document.zoho_push",
    targetType: "PayrollPeriodDocument",
    targetId: documentId,
    after: {
      expenseId: expense.expenseId,
      organizationId: org.id,
    },
  });

  return { expenseId: expense.expenseId, alreadyExists: false };
}

export async function testZohoConnection(
  organizationId: string,
  actor: Actor,
): Promise<{ ok: boolean; message: string }> {
  const [org] = await db
    .select()
    .from(zohoOrganizations)
    .where(eq(zohoOrganizations.id, organizationId));
  if (!org) return { ok: false, message: "Organization not found." };
  const result = await validateConnection(org);
  await db
    .update(zohoOrganizations)
    .set({
      lastConnectionTestAt: new Date(),
      lastConnectionTestOk: result.ok,
      updatedAt: new Date(),
    })
    .where(eq(zohoOrganizations.id, organizationId));
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: result.ok ? "zoho.test.ok" : "zoho.test.error",
    targetType: "ZohoOrganization",
    targetId: organizationId,
    after: { ok: result.ok, message: result.message },
  });
  return result;
}
