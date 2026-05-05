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

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payPeriods,
  payrollPeriodDocuments,
  payrollRuns,
  paySchedules,
  payslips,
  zohoOrganizations,
  zohoPushes,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { buildAdminReportArtifacts } from "@/lib/pdf/build-admin-report";
import {
  attachReceipt,
  createExpense,
  deleteExpense,
  validateConnection,
} from "./client";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "EMPLOYEE";
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
  // Look for an existing OK push for THIS RUN AND THIS ORG (idempotency).
  // The previous query keyed only on payrollRunId, so clicking "Push to
  // Boomin" on a run already pushed to Haute returned the Haute expense
  // ID and short-circuited — Boomin never received the push.
  const [existingPush] = await db
    .select()
    .from(zohoPushes)
    .where(
      and(
        eq(zohoPushes.payrollRunId, payrollRunId),
        eq(zohoPushes.organizationId, organizationId),
      ),
    );
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

  // Detect SEMI_MONTHLY periods — they use a different push flow:
  // the accountant prepares the paystub externally, the admin uploads
  // it with the NET amount, and that's what we push to Zoho (NOT the
  // gross we'd compute from punches). The accountant paystub PDF is
  // attached as the receipt alongside the admin report.
  const periodSchedule =
    period?.payScheduleId
      ? (
          await db
            .select()
            .from(paySchedules)
            .where(eq(paySchedules.id, period.payScheduleId))
        )[0]
      : null;
  const isSemiMonthly = periodSchedule?.periodKind === "SEMI_MONTHLY";

  // Pull all PAYSTUB documents on this period so we can total their net
  // amounts and attach them to the Zoho expense.
  const accountantDocs = period
    ? await db
        .select()
        .from(payrollPeriodDocuments)
        .where(
          and(
            eq(payrollPeriodDocuments.periodId, period.id),
            eq(payrollPeriodDocuments.kind, "PAYSTUB"),
          ),
        )
    : [];
  const activeAccountantDocs = accountantDocs.filter((d) => !d.deletedAt);
  const accountantNetTotal = activeAccountantDocs.reduce(
    (s, d) => s + (d.amountCents ?? 0),
    0,
  );
  if (isSemiMonthly && activeAccountantDocs.length === 0) {
    throw new Error(
      "Semi-monthly periods require an accountant paystub upload before pushing to Zoho. Open the period detail and upload the paystub PDF with the net amount.",
    );
  }
  if (isSemiMonthly && accountantNetTotal <= 0) {
    throw new Error(
      "Accountant paystub is uploaded but its net amount is missing or $0. Re-upload with the net pay (post-tax) amount filled in — that's what we wire to the employee.",
    );
  }

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
  // For SEMI_MONTHLY periods, override the gross total with the sum of
  // accountant paystub net amounts. That's the actual cash leaving the
  // business; the admin-report gross is just for record-keeping in the
  // Notes + attached PDF.
  if (isSemiMonthly && accountantNetTotal > 0) {
    totalCents = accountantNetTotal;
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

  // Use the canonical 7-day end for weekly periods so a Mon-Fri short
  // upload's Zoho expense reads as "Mon-Sun" (matching what the admin
  // sees on /reports + /payroll). Semi-monthly periods + non-weekly use
  // their stored end as-is.
  const { canonicalEndForSchedule } = await import(
    "@/lib/payroll/period-boundaries"
  );
  const displayEnd = period
    ? canonicalEndForSchedule(
        period.startDate,
        period.endDate,
        periodSchedule?.periodKind ?? null,
      )
    : null;
  const ref =
    period?.startDate && displayEnd
      ? `PAYROLL-${period.startDate}_to_${displayEnd}`
      : `Payroll run ${payrollRunId}`;
  const cadenceLabel = isSemiMonthly ? "Semi-monthly" : "Weekly";
  const intro =
    period?.startDate && displayEnd
      ? `${cadenceLabel} payroll expense for ${period.startDate} to ${displayEnd} created by ${actor.role.toLowerCase()}\n\n`
      : `Payroll expense created by ${actor.role.toLowerCase()}\n\n`;
  // Semi-monthly: include the net-vs-gross breakdown in the description
  // so the accountant can reconcile against the attached paystub.
  const semiNote =
    isSemiMonthly && accountantNetTotal > 0
      ? `Accountant paystub net total (post-tax): $${(accountantNetTotal / 100).toFixed(2)} — wired to employee.\n\n`
      : "";
  const description = summaryText
    ? `${intro}${semiNote}${summaryText}`
    : `${intro}${semiNote}`.trim();
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
    // Attach admin report PDF first (the per-employee breakdown), then
    // every accountant paystub PDF on this period (one per semi-monthly
    // employee). Each attach is best-effort: a failure on one doesn't
    // block the others or the expense itself.
    const attachments: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
    if (pdfBytes) {
      attachments.push({
        filename: pdfFilename,
        mime: "application/pdf",
        bytes: new Uint8Array(pdfBytes),
      });
    }
    if (activeAccountantDocs.length > 0) {
      const { readFile } = await import("fs/promises");
      const { resolve: pathResolve } = await import("path");
      // Path safety: every accountant paystub MUST live under
      // PAYROLL_DOC_ROOT. A future bug that lets a non-admin set
      // payroll_period_documents.filePath would otherwise become an
      // arbitrary-file-read into a Zoho upload. Resolve absolute and
      // check the prefix before opening.
      const docRoot = pathResolve(
        process.env.PAYROLL_DOC_ROOT ?? "/data/uploads/payroll-docs",
      );
      for (const doc of activeAccountantDocs) {
        const absPath = pathResolve(doc.filePath);
        if (!absPath.startsWith(docRoot + "/") && absPath !== docRoot) {
          logger.warn(
            { payrollRunId, docId: doc.id, filePath: doc.filePath },
            "zoho push: accountant paystub path outside doc root; refusing to attach",
          );
          continue;
        }
        try {
          const buf = await readFile(absPath);
          attachments.push({
            filename: doc.originalFilename,
            mime: doc.mime,
            bytes: new Uint8Array(buf),
          });
        } catch (err) {
          logger.warn(
            { payrollRunId, docId: doc.id, err: err instanceof Error ? err.message : String(err) },
            "zoho push: accountant paystub file missing on disk; skipping attachment",
          );
        }
      }
    }
    for (const att of attachments) {
      try {
        await attachReceipt({
          org,
          expenseId: expense.expenseId,
          filename: att.filename,
          mime: att.mime,
          bytes: att.bytes,
        });
      } catch (err) {
        attachError = err instanceof Error ? err.message : String(err);
        logger.warn(
          { payrollRunId, expenseId: expense.expenseId, file: att.filename, err: attachError },
          "zoho push: one of the attachments failed to upload",
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

/**
 * Re-push a payroll run to Zoho. Existing OK push for (run, org) is
 * resolved atomically:
 *   1. DELETE the orphan expense in Zoho via API (404 = already gone, fine).
 *   2. Delete the zoho_pushes row so the idempotency check in
 *      pushReportToZoho doesn't short-circuit.
 *   3. Call pushReportToZoho fresh — creates a new expense with current
 *      amount + Notes + PDF.
 *
 * Used after a fix that changes the underlying total (e.g. temp labor
 * added, payslip recomputed, etc.) so the admin can re-sync without
 * leaving duplicate expenses in Zoho.
 */
export async function repushReportToZoho(
  payrollRunId: string,
  organizationId: string,
  actor: Actor,
  /**
   * When true, skip the Zoho-side DELETE of the prior expense and just
   * clear our DB record before re-pushing. Use when:
   *  - The expense is already gone from Zoho (admin deleted manually)
   *  - The OAuth scope doesn't include expenses.DELETE (current scope
   *    set is CREATE/READ/settings.READ/contacts.READ — no DELETE), so
   *    the API returns 401 and the normal re-push fails.
   * The orphan expense in Zoho (if any) survives; admin must verify
   * separately.
   */
  options: { force?: boolean } = {},
): Promise<PushResult & { deletedPriorExpenseId: string | null }> {
  // Guard: only re-push runs that have actually been published. A
  // CANCELLED / FAILED / INGEST_FAILED run shouldn't be able to delete
  // a Zoho expense and create a fresh one with stale data.
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, payrollRunId));
  if (!run) throw new Error("Run not found.");
  if (run.state !== "PUBLISHED") {
    throw new Error(
      `Cannot re-push: run is in state ${run.state}. Only PUBLISHED runs can be re-pushed.`,
    );
  }

  const [existingPush] = await db
    .select()
    .from(zohoPushes)
    .where(
      and(
        eq(zohoPushes.payrollRunId, payrollRunId),
        eq(zohoPushes.organizationId, organizationId),
      ),
    );

  let deletedPriorExpenseId: string | null = null;
  if (existingPush?.expenseId && !options.force) {
    const [org] = await db
      .select()
      .from(zohoOrganizations)
      .where(eq(zohoOrganizations.id, organizationId));
    if (!org) throw new Error("Zoho organization not found.");
    const del = await deleteExpense(org, existingPush.expenseId);
    if (!del.ok) {
      throw new Error(
        `Could not delete prior Zoho expense ${existingPush.expenseId}: ${del.message}. If the expense is already gone from Zoho (or your OAuth token can't DELETE), use Force re-push to skip the delete and just post fresh.`,
      );
    }
    deletedPriorExpenseId = existingPush.expenseId;
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "zoho.expense.deleted_for_repush",
      targetType: "PayrollRun",
      targetId: payrollRunId,
      after: {
        organizationId,
        expenseId: existingPush.expenseId,
        alreadyGone: del.alreadyGone,
      },
    });
  }
  if (existingPush) {
    if (options.force) {
      // Audit the force-skip so the orphan expense in Zoho is traceable.
      await writeAudit({
        actorId: actor.id,
        actorRole: actor.role,
        action: "zoho.expense.force_skip_delete",
        targetType: "PayrollRun",
        targetId: payrollRunId,
        after: {
          organizationId,
          expenseId: existingPush.expenseId,
          reason:
            "Admin chose force re-push. Prior Zoho expense (if still present) was NOT deleted by us; admin must verify in Zoho.",
        },
      });
    }
    await db.delete(zohoPushes).where(eq(zohoPushes.id, existingPush.id));
  }
  const result = await pushReportToZoho(payrollRunId, organizationId, actor);
  return { ...result, deletedPriorExpenseId };
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
