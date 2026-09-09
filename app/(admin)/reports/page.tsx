// Payroll Reports — built to the owner's mock (Sep 2026): breadcrumb +
// title with a year picker and Export; four KPI cards (delta vs the prior
// year through the same date, awaiting-payment count, active/inactive
// split); a middle band of Payroll trend (gross vs take-home by month),
// Pay method breakdown, and Needs attention; then tabs over the ledger
// (Pay runs / Employees / Schedules / Payment methods). Every figure is
// real data — where the mock implied a metric the system does not track
// (payout variance, failed payments, departments) the nearest real thing
// stands in (disputes, unsigned payslips, schedules).

import Link from "next/link";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listReports, listSalariedPaystubReports, type ReportRow } from "@/lib/db/queries/payroll-runs";
import { getDrawerBalanceCents } from "@/lib/db/queries/cash-drawer";
import { listEmployees } from "@/lib/db/queries/employees";
import { listOpenDisputes, listSignatureStatusForPeriod } from "@/lib/db/queries/payslips";
import { listPendingMissedPunchRequests } from "@/lib/db/queries/requests";
import { getYtd } from "@/lib/reports/ytd";
import { computeYearSummary } from "@/lib/reports/year-summary";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { db } from "@/lib/db";
import { zohoOrganizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ReportsTable } from "./reports-table";
import { ReportsKpiCards } from "@/components/reports/kpi-cards";
import { PayMethodDonut, PayrollTrendChart } from "@/components/reports/charts-lazy";
import { NeedsAttention, type AttentionItem } from "@/components/reports/needs-attention";
import { YearPicker } from "@/components/reports/year-picker";
import { ReportsTabs } from "@/components/reports/reports-tabs";
import { parseReportsTab } from "@/components/reports/reports-tab-key";
import { EmployeesYtdTable, MethodsTable, SchedulesTable, type EmployeeYtdLine } from "@/components/reports/summary-tables";
import { requireSession } from "@/lib/auth-guards";
import { parseScheduleTab, scheduleTabToKind } from "@/components/domain/schedule-tabs";

export const dynamic = "force-dynamic";

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-card border border-border/70 bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-subheading font-semibold text-text">{title}</h2>
        {aside}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string; year?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const scheduleTab = parseScheduleTab(sp.schedule);
  const kind = scheduleTabToKind(scheduleTab);
  const activeTab = parseReportsTab(sp.tab);

  const company = await getSetting("company");
  const todayIso = companyTodayIso(new Date(), company.timezone);
  const currentYear = Number(todayIso.slice(0, 4));
  const requestedYear = Number(sp.year);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= currentYear + 1
      ? requestedYear
      : currentYear;

  const [reports, allReports, salariedPaystubs, ytdRows, orgs, drawerBalanceCents, employees, disputes, pendingFixes] =
    await Promise.all([
      listReports(1000, kind),
      listReports(2000),
      listSalariedPaystubReports(1000),
      getYtd(year),
      db.select().from(zohoOrganizations).where(eq(zohoOrganizations.active, true)),
      getDrawerBalanceCents().catch(() => 0),
      listEmployees(),
      listOpenDisputes(),
      listPendingMissedPunchRequests(),
    ]);

  const inYear = (r: ReportRow) => r.endDate.slice(0, 4) === String(year);
  const showSalaried = scheduleTab === "all" || scheduleTab === "salaried";
  const periodRows = (showSalaried ? [...reports, ...salariedPaystubs] : reports)
    .filter(inYear)
    .sort((a, b) => (a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : 0));

  // Year summary over EVERYTHING (all cadences, all years) so the prior-year
  // comparison and the year picker have the full history to draw from.
  const everything = [...allReports, ...salariedPaystubs];
  const summary = computeYearSummary(everything, year, todayIso);
  const years = [...new Set([currentYear, ...everything.map((r) => Number(r.endDate.slice(0, 4)))])]
    .filter((y) => Number.isInteger(y) && y > 2000)
    .sort((a, b) => b - a);

  // Employees paid this year: split by current status.
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  let employeesActive = 0;
  let employeesInactive = 0;
  for (const r of ytdRows) {
    const e = employeeById.get(r.employeeId);
    if (e?.status === "ACTIVE") employeesActive += 1;
    else employeesInactive += 1;
  }
  const employeeLines: EmployeeYtdLine[] = ytdRows
    .map((r) => ({
      employeeId: r.employeeId,
      name: employeeById.get(r.employeeId)?.displayName ?? "—",
      status: employeeById.get(r.employeeId)?.status ?? "TERMINATED",
      hours: r.hours,
      grossCents: r.grossCents,
      netCents: r.roundedCents,
    }))
    .sort((a, b) => b.netCents - a.netCents);

  // Needs attention — real counts only.
  const lockedPeriods = [...new Map(periodRows.filter((r) => r.periodState === "LOCKED").map((r) => [r.periodId, r])).values()];
  const newestRun = periodRows.find((r) => !r.isSalariedPaystub && r.publishedToPortalAt);
  const signature = newestRun ? await listSignatureStatusForPeriod(newestRun.periodId) : null;
  const disputeEmployees = new Set(disputes.map((d) => d.employeeId)).size;
  const attention: AttentionItem[] = [
    {
      key: "locked",
      count: lockedPeriods.length,
      icon: "lock",
      title: lockedPeriods.length === 0 ? "No locked payrolls" : `${lockedPeriods.length} locked payroll${lockedPeriods.length === 1 ? "" : "s"}`,
      detail:
        lockedPeriods.length === 0
          ? "Every period is paid"
          : `${formatPeriodRange(lockedPeriods[0]!.startDate, lockedPeriods[0]!.endDate)}${lockedPeriods.length > 1 ? ` and ${lockedPeriods.length - 1} more` : ""}`,
      href: "/payroll",
    },
    {
      key: "disputes",
      count: disputes.length,
      icon: "warn",
      title: disputes.length === 0 ? "No disputed payslips" : `${disputes.length} disputed payslip${disputes.length === 1 ? "" : "s"}`,
      detail: disputes.length === 0 ? "Nothing reported by employees" : `Across ${disputeEmployees} employee${disputeEmployees === 1 ? "" : "s"}`,
      href: disputes[0] ? `/payroll/${disputes[0].periodId}` : "/payroll",
    },
    {
      key: "fixes",
      count: pendingFixes.length,
      icon: "clock",
      title: pendingFixes.length === 0 ? "No punch fixes waiting" : `${pendingFixes.length} punch fix${pendingFixes.length === 1 ? "" : "es"} waiting`,
      detail: pendingFixes.length === 0 ? "Request queue is clear" : "Awaiting office review",
      href: "/requests",
    },
    ...(signature && newestRun
      ? [
          {
            key: "unsigned",
            count: signature.unsigned.length,
            icon: "sign" as const,
            title:
              signature.unsigned.length === 0
                ? "Latest payroll fully signed"
                : `${signature.unsigned.length} unsigned payslip${signature.unsigned.length === 1 ? "" : "s"}`,
            detail: `${formatPeriodRange(newestRun.startDate, newestRun.endDate)} · ${signature.signed} of ${signature.total} signed`,
            href: `/payroll/${newestRun.periodId}`,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-subtle">
            <span>Reports</span>
            <ChevronRight className="h-3 w-3" aria-hidden />
          </nav>
          <h1 className="mt-0.5 text-title tracking-tight antialiased text-text">Payroll Reports</h1>
          <p className="mt-1 text-sm text-text-muted">Insights, compliance, and historical payroll data.</p>
        </div>
        <div className="flex items-center gap-2">
          <YearPicker year={year} years={years} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-10 bg-text text-page shadow-none hover:bg-text/90">
                <Download className="h-4 w-4" /> Export
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
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
              <DropdownMenuItem asChild>
                <Link href="/reports/time-off">Time-off tally</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ReportsKpiCards summary={summary} employeesActive={employeesActive} employeesInactive={employeesInactive} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Payroll trend"
          aside={
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--dash-emerald)" }} /> Gross pay</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full opacity-60" style={{ background: "var(--dash-emerald-dim)" }} /> Take-home pay</span>
            </div>
          }
        >
          <PayrollTrendChart data={summary.months} />
        </Panel>
        <Panel title="Pay method breakdown">
          <PayMethodDonut total={summary.byMethod.total} slices={summary.byMethod.slices} />
        </Panel>
        <NeedsAttention items={attention} />
      </div>

      <ReportsTabs
        active={activeTab}
        panels={{
          runs: (
            <ReportsTable
              reports={periodRows}
              zohoOrgs={orgs}
              drawerBalanceCents={drawerBalanceCents}
              canManageReports={session.user.role !== "ACCOUNTANT"}
              scheduleTab={scheduleTab}
            />
          ),
          employees: <EmployeesYtdTable rows={employeeLines} year={year} />,
          schedules: <SchedulesTable summary={summary} />,
          methods: <MethodsTable summary={summary} />,
        }}
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
