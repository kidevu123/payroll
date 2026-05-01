// Reports landing — legacy-style table of every payroll_run, newest first.
// Each row links to the per-period admin detail at /payroll/[periodId].

import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listReports } from "@/lib/db/queries/payroll-runs";
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [reports, orgs] = await Promise.all([
    listReports(200),
    db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-text-muted">
            {reports.length} {reports.length === 1 ? "report" : "reports"}, newest first.
          </p>
        </div>
      </div>

      <ReportsTable reports={reports} zohoOrgs={orgs} />

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Download className="h-5 w-5 text-brand-700" />
          <CardTitle className="text-base">CSV exports</CardTitle>
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
