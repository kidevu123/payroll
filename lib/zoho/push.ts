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
  payPeriods,
  payrollPeriodDocuments,
  payrollRuns,
  payslips,
  zohoOrganizations,
  zohoPushes,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { buildAdminReportArtifacts } from "@/lib/pdf/build-admin-report";
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

  // Pull the period for a human-readable reference like
  // "PAYROLL-2026-04-06_to_2026-04-11" matching the legacy app's format,
  // and to feed the admin-report builder for Notes + PDF attachment.
  const [period] = run.periodId
    ? await db.select().from(payPeriods).where(eq(payPeriods.id, run.periodId))
    : [];

  // Build the admin report once — same artifact powers the Notes table,
  // the receipt PDF Zoho displays, AND the expense amount (the builder
  // already sums payslips + temp workers, matching the period total the
  // admin sees on /reports). Failure here is non-fatal: we still push the
  // expense (without summary/attachment, falling back to the run's stored
  // total) and surface the builder error in audit.
  let summaryText: string | null = null;
  let pdfBytes: Buffer | null = null;
  let pdfFilename = "admin_report.pdf";
  let buildError: string | null = null;
  let totalCents = 0;
  if (run.periodId) {
    try {
      const artifacts = await buildAdminReportArtifacts(run.periodId);
      summaryText = artifacts.summaryText;
      pdfBytes = artifacts.pdfBytes;
      pdfFilename = artifacts.filename;
      totalCents = artifacts.totalRoundedCents;
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { payrollRunId, periodId: run.periodId, err: buildError },
        "zoho push: admin report build failed; will push without summary/attachment",
      );
    }
  }
  // Fallback total when artifact build failed: prefer stored total_amount_cents,
  // else sum the payslips. Note: this fallback does NOT include temp workers;
  // it should rarely be hit since the builder is authoritative.
  if (totalCents <= 0) {
    totalCents = run.totalAmountCents ?? 0;
    if (!totalCents) {
      const slips = await db
        .select()
        .from(payslips)
        .where(eq(payslips.payrollRunId, payrollRunId));
      totalCents = slips.reduce((s, p) => s + p.roundedPayCents, 0);
    }
  }
  if (!totalCents || totalCents <= 0) {
    throw new Error("Run has no positive total — nothing to push.");
  }

  const ref =
    period?.startDate && period?.endDate
      ? `PAYROLL-${period.startDate}_to_${period.endDate}`
      : `Payroll run ${payrollRunId}`;
  const intro =
    period?.startDate && period?.endDate
      ? `Weekly payroll expense for ${period.startDate} to ${period.endDate} created by ${actor.role.toLowerCase()}\n\n`
      : `Payroll expense created by ${actor.role.toLowerCase()}\n\n`;
  const description = summaryText ? `${intro}${summaryText}` : intro.trim();
  const expenseDate =
    period?.endDate ??
    (run.postedAt ?? run.publishedAt ?? new Date()).toISOString().slice(0, 10);

  try {
    const expense = await createExpense({
      org,
      amountCents: totalCents,
      reference: ref,
      date: expenseDate,
      description,
    });

    let attachError: string | null = null;
    if (pdfBytes) {
      try {
        await attachReceipt({
          org,
          expenseId: expense.expenseId,
          filename: pdfFilename,
          mime: "application/pdf",
          bytes: new Uint8Array(pdfBytes),
        });
      } catch (err) {
        attachError = err instanceof Error ? err.message : String(err);
        logger.warn(
          { payrollRunId, expenseId: expense.expenseId, err: attachError },
          "zoho push: receipt attach failed; expense was created without PDF",
        );
      }
    }

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
      after: {
        organizationId,
        expenseId: expense.expenseId,
        amountCents: totalCents,
        attachedReceipt: pdfBytes !== null && attachError === null,
        ...(buildError ? { buildError } : {}),
        ...(attachError ? { attachError } : {}),
      },
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
