// Reports landing — one statement. Title + Time-off tally + Export on the
// header row, a year-to-date stat strip, then a single full-width table:
// toolbar (search / schedule / status / paid-via / sort), sticky column
// header, month bands with subtotals, dense period rows.
//
// Sep 2026 rethink (owner: "busy, wasted white space"): the right rail
// (report-mix donut, net-pay trend, summary) and the four boxed KPI cards
// are gone. The donut described the table's own row counts, the trend
// belongs to the dashboard, and the summary repeated the KPIs.

import Link from "next/link";
import { Download, CalendarRange, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listReports,
  listSalariedPaystubReports,
} from "@/lib/db/queries/payroll-runs";
import { getDrawerBalanceCents } from "@/lib/db/queries/cash-drawer";
import { getYtd } from "@/lib/reports/ytd";
import { computeReportsOverview } from "@/lib/reports/reports-overview";
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";
import { ReportsStatStrip } from "@/components/reports/stat-strip";
import { requireSession } from "@/lib/auth-guards";
import {
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
  const [reports, allReports, salariedPaystubs, ytdRows, orgs, drawerBalanceCents] =
    await Promise.all([
      listReports(200, kind),
      listReports(500),
      listSalariedPaystubReports(200),
      getYtd(currentYear),
      db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
      getDrawerBalanceCents().catch(() => 0),
    ]);

  // Salaried W2 paystubs (uploaded with a pay period but no payroll run) are
  // real payroll — surface them on the "All" and "Salaried" tabs and merge
  // newest-first so they fall into the correct month group + month total.
  const showSalaried = tab === "all" || tab === "salaried";
  const periodRows = showSalaried
    ? [...reports, ...salariedPaystubs].sort((a, b) =>
        a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0,
      )
    : reports;

  const overview = computeReportsOverview(allReports, ytdRows, currentYear);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-title tracking-tight antialiased text-text">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">
            Payroll insights, compliance visibility, and historical runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/reports/time-off">
              <CalendarRange className="h-4 w-4" /> Time-off tally
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Download className="h-4 w-4" /> Export
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              <DropdownMenuLabel>CSV exports</DropdownMenuLabel>
              <ExportItem type="periods" label="Period totals" />
              <ExportItem type="payslips" label="Payslips" />
              <ExportItem type="punches" label="Punches" />
              <ExportItem type="employees" label="Employees" />
              <DropdownMenuSeparator />
              <ExportItem type="audit" label="Audit log" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ReportsStatStrip ytd={overview.ytd} />

      <ReportsTable
        reports={periodRows}
        zohoOrgs={orgs}
        drawerBalanceCents={drawerBalanceCents}
        canManageReports={session.user.role !== "ACCOUNTANT"}
        scheduleTab={tab}
      />
    </div>
  );
}

function ExportItem({ type, label }: { type: string; label: string }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={`/api/reports/csv?type=${type}`}>
        <Download className="h-3.5 w-3.5" /> {label}
      </Link>
    </DropdownMenuItem>
  );
}
