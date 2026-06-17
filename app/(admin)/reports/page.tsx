// Reports landing — a calm payroll statement. Periods roll up into
// month cards (one soft shadow each), with hairline-separated statement
// lines inside. The cadence filter is a sticky segmented control; the
// header carries a slim count + YTD-paid summary derived from the rows
// already fetched.

import Link from "next/link";
import { Download, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listReports, type ReportRow } from "@/lib/db/queries/payroll-runs";
import { getDrawerBalanceCents } from "@/lib/db/queries/cash-drawer";
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";
import { MoneyDisplay } from "@/components/domain/money-display";
import { requireSession } from "@/lib/auth-guards";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";

export const dynamic = "force-dynamic";

/**
 * YTD paid total, derived cheaply from the rows already fetched: sum the
 * NET (run amount + temp labor) of every PAID period whose end date
 * falls in the current calendar year. Temp labor is per-period, so we
 * add it once per period rather than once per run.
 */
function ytdPaidCents(reports: ReportRow[]): number {
  const year = new Date().getUTCFullYear();
  const seenPeriodTemp = new Set<string>();
  let total = 0;
  for (const r of reports) {
    if (r.periodState !== "PAID") continue;
    const endYear = Number((r.endDate || "").slice(0, 4));
    if (endYear !== year) continue;
    total += r.amountCents;
    if (!seenPeriodTemp.has(r.periodId)) {
      seenPeriodTemp.add(r.periodId);
      total += r.tempLaborCents;
    }
  }
  return total;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const tab = parseScheduleTab(sp.schedule);
  const kind = scheduleTabToKind(tab);
  const [reports, orgs, drawerBalanceCents] = await Promise.all([
    listReports(200, kind),
    db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
    getDrawerBalanceCents().catch(() => 0),
  ]);

  const ytdPaid = ytdPaidCents(reports);
  const currentYear = new Date().getUTCFullYear();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        {/* Slim summary line: count · YTD paid · year-end link */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <span className="tabular-nums">
            {reports.length} {reports.length === 1 ? "report" : "reports"}, newest first
          </span>
          {ytdPaid > 0 && (
            <>
              <span className="text-text-subtle" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums">
                <span className="font-medium text-text">
                  <MoneyDisplay cents={ytdPaid} monospace={false} />
                </span>{" "}
                paid in {currentYear}
              </span>
            </>
          )}
          <span className="text-text-subtle" aria-hidden="true">
            ·
          </span>
          <Link
            href="/reports/time-off"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            <CalendarRange className="h-3 w-3" aria-hidden="true" /> Year-end time-off tally
          </Link>
        </p>
      </div>

      {/* Sticky calm segmented control. The admin topbar is fixed/sticky
          at the very top (height 3.5rem + safe-area), so we park the
          filter just beneath it (z-30 stays under the topbar's z-50 and
          its popovers). A translucent page backdrop keeps statement
          lines from bleeding through while scrolling a long history. */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-1 bg-page/85 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-page/70 lg:top-[3.5rem]">
        <ScheduleTabs current={tab} basePath="/reports" />
      </div>

      <ReportsTable
        reports={reports}
        zohoOrgs={orgs}
        drawerBalanceCents={drawerBalanceCents}
        canManageReports={session.user.role !== "ACCOUNTANT"}
      />

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Download className="h-4 w-4 text-brand-700" />
          <CardTitle className="text-base">CSV exports</CardTitle>
          <CardDescription className="ml-auto hidden sm:block">
            Pull the underlying data for any period or audit window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <ExportLink type="employees" label="Employees" />
          <ExportLink type="payslips" label="Payslips" />
          <ExportLink type="punches" label="Punches" />
          <ExportLink type="audit" label="Audit log" />
          <ExportLink type="periods" label="Period totals" />
        </CardContent>
      </Card>
    </div>
  );
}

function ExportLink({ type, label }: { type: string; label: string }) {
  return (
    <Button asChild variant="secondary" className="justify-start">
      <Link href={`/api/reports/csv?type=${type}`}>
        <Download className="h-4 w-4" /> {label}
      </Link>
    </Button>
  );
}
