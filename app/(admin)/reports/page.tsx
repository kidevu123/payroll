// Reports landing — organized like a statement console (owner reference,
// Jul 2026): title + Export on the header row, four KPI stat cards, a
// filter bar (search / schedule / status / payment / sort), then the
// month-grouped report table with aligned columns, and the insight rail
// (mix donut, net trend, summary) on the right.

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
import { ReportsKpis } from "@/components/reports/reports-kpis";
import { ReportsRail } from "@/components/reports/reports-rail";
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

      <ReportsKpis ytd={overview.ytd} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <ReportsTable
            reports={periodRows}
            zohoOrgs={orgs}
            drawerBalanceCents={drawerBalanceCents}
            canManageReports={session.user.role !== "ACCOUNTANT"}
            scheduleTab={tab}
          />
        </div>

        {/* top-4, not the old 3.5rem topbar offset — the admin shell has no
            desktop topbar, so that offset left the rail hanging in space. */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <ReportsRail overview={overview} />
        </aside>
      </div>
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
