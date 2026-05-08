// Reports landing — newest first, grouped per pay-period card. Each
// period's runs share a left-edge accent matching the schedule color so
// Weekly vs Semi-monthly vs Salaried separate at a glance.

import Link from "next/link";
import { Download } from "lucide-react";
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
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";
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
  const tab = parseScheduleTab(sp.schedule);
  const kind = scheduleTabToKind(tab);
  const [reports, orgs, drawerBalanceCents] = await Promise.all([
    listReports(200, kind),
    db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
    getDrawerBalanceCents().catch(() => 0),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-xs text-text-muted">
            {reports.length} {reports.length === 1 ? "report" : "reports"}, newest first.{" "}
            <Link
              href="/reports/time-off"
              className="text-brand-700 hover:underline"
            >
              Year-end time-off tally →
            </Link>
          </p>
        </div>
        <ScheduleTabs
          current={tab}
          basePath="/reports"
          hrefs={{ salaried: "/salaried" }}
        />
      </div>

      <ReportsTable
        reports={reports}
        zohoOrgs={orgs}
        drawerBalanceCents={drawerBalanceCents}
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
