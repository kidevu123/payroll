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
import { listReports } from "@/lib/db/queries/payroll-runs";
import { getDrawerBalanceCents } from "@/lib/db/queries/cash-drawer";
import { getYtd } from "@/lib/reports/ytd";
import { computeReportsOverview } from "@/lib/reports/reports-overview";
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";
import { ReportsKpis } from "@/components/reports/reports-kpis";
import { ReportsRail } from "@/components/reports/reports-rail";
import { requireSession } from "@/lib/auth-guards";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const tab = parseScheduleTab(sp.schedule);
  const kind = scheduleTabToKind(tab);
  const currentYear = new Date().getUTCFullYear();
  // `reports` is filtered by the active tab (drives the period list); the
  // overview is computed over ALL reports + YTD payslips so the KPIs, mix
  // donut and net-pay trend reflect everything, not just the filtered cadence.
  const [reports, allReports, ytdRows, orgs, drawerBalanceCents] = await Promise.all([
    listReports(200, kind),
    listReports(500),
    getYtd(currentYear),
    db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
    getDrawerBalanceCents().catch(() => 0),
  ]);

  const overview = computeReportsOverview(allReports, ytdRows, currentYear);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">
            Payroll insights, compliance visibility, and historical runs.
          </p>
        </div>
        <Link
          href="/reports/time-off"
          className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
        >
          <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" /> Year-end time-off tally
        </Link>
      </div>

      <ReportsKpis kpis={overview.kpis} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
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

        <aside className="lg:sticky lg:top-[calc(3.5rem+env(safe-area-inset-top))] lg:self-start">
          <ReportsRail overview={overview} />
        </aside>
      </div>
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
