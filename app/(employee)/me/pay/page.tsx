// Employee Pay tab — list of payslips on runs the admin has published to
// the portal (payroll_runs.published_to_portal_at IS NOT NULL). Internal
// runs never appear here.

import Link from "next/link";
import { Download, FileText, Wallet } from "lucide-react";
import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PayslipCard, type PayslipCardState } from "@/components/domain/payslip-card";
import { requireSession } from "@/lib/auth-guards";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { listEmployeeVisibleDocs } from "@/lib/db/queries/payroll-documents";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { db } from "@/lib/db";
import { payrollRuns, type PayrollPeriodDocument } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";

/**
 * Match a doc to a displayed period via:
 *   1. Direct periodId match (admin uploaded "for this period")
 *   2. payPeriodStart/End range overlap (paystub PDF metadata)
 * Returns docs that belong inside the given period card.
 */
function docsForPeriod(
  allDocs: PayrollPeriodDocument[],
  period: { id: string; startDate: string; endDate: string },
): PayrollPeriodDocument[] {
  return allDocs.filter((d) => {
    if (d.periodId === period.id) return true;
    if (d.payPeriodStart && d.payPeriodEnd) {
      return (
        d.payPeriodStart <= period.endDate &&
        d.payPeriodEnd >= period.startDate
      );
    }
    return false;
  });
}

export default async function EmployeePayList() {
  const session = await requireSession();
  const t = await getTranslations("employee.pay");
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-text-muted">
          {t("notLinkedAccount")}
        </p>
      </div>
    );
  }
  const employee = await getEmployee(session.user.employeeId);
  // Salaried employees are paid externally (accountant) and only ever see
  // uploaded paystub/W2 documents. Skip the punch-driven payslip list
  // entirely so they don't see $0 payslip cards from runs that never
  // touched their pay (and so the self-heal recompute on /me/pay/[id]
  // can't be triggered for salaried records — already guarded there).
  const isSalaried = employee?.payType === "SALARIED";
  const [payslips, payRules, payrollDocs] = await Promise.all([
    isSalaried
      ? Promise.resolve([])
      : listPublishedPayslipsForEmployee(session.user.employeeId),
    getSetting("payRules"),
    listEmployeeVisibleDocs(session.user.employeeId),
  ]);
  const periods = await Promise.all(payslips.map((p) => getPeriodById(p.periodId)));
  // Pull each payslip's parent run source so we can prefer non-legacy
  // when collapsing overlapping payslips.
  const runIds = [...new Set(payslips.map((p) => p.payrollRunId))];
  const runs = runIds.length
    ? await db
        .select({ id: payrollRuns.id, source: payrollRuns.source })
        .from(payrollRuns)
        .where(inArray(payrollRuns.id, runIds))
    : [];
  const sourceByRun = new Map(runs.map((r) => [r.id, r.source]));

  type Row = {
    payslip: (typeof payslips)[number];
    period: NonNullable<(typeof periods)[number]>;
    source: string;
  };

  const allRows: Row[] = payslips
    .map((p, i) => {
      const period = periods[i];
      if (!period) return null;
      return {
        payslip: p,
        period,
        source: sourceByRun.get(p.payrollRunId) ?? "UNKNOWN",
      };
    })
    .filter((r): r is Row => r !== null);

  // Score each row by preferred-ness within an overlap cluster:
  //   non-legacy + has PDF > non-legacy > legacy + has PDF > legacy.
  // Higher score wins. Ties broken by latest startDate (newer record).
  function score(r: Row): number {
    let s = 0;
    if (r.source !== "LEGACY_IMPORT") s += 10;
    if (r.payslip.pdfPath) s += 1;
    return s;
  }

  // Greedy overlap-collapse: walk rows sorted by descending score, keep
  // the first row in each [start, end] interval cluster, drop overlaps.
  const sorted = [...allRows].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return a.period.startDate < b.period.startDate ? 1 : -1;
  });
  const rows: Row[] = [];
  for (const r of sorted) {
    const overlaps = rows.some(
      (kept) =>
        r.period.startDate <= kept.period.endDate &&
        r.period.endDate >= kept.period.startDate,
    );
    if (!overlaps) rows.push(r);
  }
  // Final sort: newest period first, like before.
  rows.sort((a, b) => (a.period.startDate < b.period.startDate ? 1 : -1));

  // Group docs to their matching period. Anything that doesn't match any
  // visible period falls into orphans (e.g. uploaded for a period the
  // employee can't see yet).
  const matchedIds = new Set<string>();
  const docsByPeriodId = new Map<string, PayrollPeriodDocument[]>();
  for (const r of rows) {
    const matches = docsForPeriod(payrollDocs, r.period);
    if (matches.length > 0) {
      docsByPeriodId.set(r.period.id, matches);
      for (const m of matches) matchedIds.add(m.id);
    }
  }
  const orphanDocs = payrollDocs.filter((d) => !matchedIds.has(d.id));

  return (
    <main className="space-y-6 px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto">
      <PageHeader
        density="employee"
        title={t("title")}
        description={t("subtitle")}
      />

      {rows.length === 0 && payrollDocs.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        <div className="space-y-5">
          {rows.map(({ payslip, period }) => {
            const docs = docsByPeriodId.get(period.id) ?? [];
            const state: PayslipCardState =
              payslip.disputedAt && !payslip.disputeResolvedAt
                ? "disputed"
                : payslip.acknowledgedAt
                  ? "acknowledged"
                  : payslip.publishedAt
                    ? "published"
                    : "pending";
            return (
              <PayslipCard
                key={payslip.id}
                payslipId={payslip.id}
                periodStart={period.startDate}
                periodEnd={period.endDate}
                hours={Number(payslip.hoursWorked)}
                roundedCents={payslip.roundedPayCents}
                hoursDecimalPlaces={payRules.hoursDecimalPlaces}
                state={state}
                href={`/me/pay/${payslip.periodId}`}
                docs={docs.map((d) => ({
                  id: d.id,
                  originalFilename: d.originalFilename,
                  kind: d.kind,
                  payPeriodStart: d.payPeriodStart,
                  payPeriodEnd: d.payPeriodEnd,
                  amountCents: d.amountCents,
                }))}
                viewLabel={t("viewDoc")}
              />
            );
          })}

          {orphanDocs.length > 0 && (
            <section className="space-y-3 pt-5 border-t border-border/70">
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-subtle">
                {t("otherDocs")}
              </h2>
              <ul className="space-y-1.5">
                {orphanDocs.map((d) => (
                  <DocPill key={d.id} doc={d} viewLabel={t("viewDoc")} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function DocPill({ doc: d, viewLabel }: { doc: PayrollPeriodDocument; viewLabel: string }) {
  return (
    <li className="group flex items-center justify-between gap-3 rounded-input border border-border/70 bg-surface px-3 py-2.5 shadow-[0_1px_2px_0_rgb(15_23_42_/_0.03)] transition-shadow duration-200 hover:shadow-card">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input bg-brand-50 ring-1 ring-inset ring-brand-100">
          <FileText className="h-3.5 w-3.5 text-brand-700" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text antialiased">
            {d.originalFilename}
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            {d.kind}
            {d.payPeriodStart && d.payPeriodEnd
              ? ` · ${d.payPeriodStart} – ${d.payPeriodEnd}`
              : ""}
            {d.amountCents !== null && d.amountCents > 0
              ? ` · $${(d.amountCents / 100).toFixed(2)}`
              : ""}
          </p>
        </div>
      </div>
      <Link
        href={`/api/payroll-docs/${d.id}`}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1 rounded-input border border-border bg-surface px-2.5 py-1 text-[11px] font-medium tracking-tight text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Download className="h-3 w-3" /> {viewLabel}
      </Link>
    </li>
  );
}
