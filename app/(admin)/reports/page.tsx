// Reports landing. YTD totals + trends + CSV exports.

import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { listEmployees } from "@/lib/db/queries/employees";
import { getYtd } from "@/lib/reports/ytd";
import { getPeriodTotals } from "@/lib/reports/period-totals";
import { getSetting } from "@/lib/settings/runtime";
import { TrendsChart } from "./trends-chart";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const year = Number.parseInt(params.year ?? "", 10) || new Date().getFullYear();
  const [ytd, totals, payRules, employees] = await Promise.all([
    getYtd(year),
    getPeriodTotals(),
    getSetting("payRules"),
    listEmployees(),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));

  const grandRounded = ytd.reduce((s, r) => s + r.roundedCents, 0);
  const grandHours = ytd.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-[--text-muted]">
            Year-to-date totals + period trends. CSV exports below.
          </p>
        </div>
        <form method="GET" action="/reports" className="flex items-end gap-2">
          <label className="text-sm">
            Year{" "}
            <input
              type="number"
              name="year"
              defaultValue={year}
              min={2020}
              max={2100}
              className="h-9 w-24 rounded-[--radius-input] border border-[--border] bg-[--surface] px-2"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">YTD totals — {year}</CardTitle>
            <CardDescription>
              {ytd.length} {ytd.length === 1 ? "person" : "people"} paid · {grandHours.toFixed(0)}h ·{" "}
              <MoneyDisplay cents={grandRounded} monospace={false} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm max-h-[24rem] overflow-y-auto">
            {ytd.length === 0 ? (
              <p className="text-[--text-muted]">No published payslips for {year}.</p>
            ) : (
              ytd.map((row) => {
                const e = empById.get(row.employeeId);
                return (
                  <div
                    key={row.employeeId}
                    className="flex items-center justify-between gap-3 border-b border-[--border] last:border-b-0 py-1"
                  >
                    <span className="truncate">{e?.displayName ?? row.employeeId}</span>
                    <span className="text-right text-xs text-[--text-muted]">
                      <HoursDisplay
                        hours={row.hours}
                        decimals={payRules.hoursDecimalPlaces}
                      />{" "}
                      ·{" "}
                      <MoneyDisplay cents={row.roundedCents} monospace={false} />
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Payroll trends</CardTitle>
            <CardDescription>Per-period totals across the available history.</CardDescription>
          </CardHeader>
          <CardContent>
            {totals.length === 0 ? (
              <p className="text-sm text-[--text-muted]">
                Trends light up once payroll publishes its first period.
              </p>
            ) : (
              <TrendsChart
                points={totals.map((t) => ({
                  startDate: t.startDate,
                  hours: t.hours,
                  netDollars: t.roundedCents / 100,
                  employees: t.employeeCount,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Download className="h-5 w-5 text-[--color-brand-700]" />
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

// quiet the unused-import warnings.
void BarChart3;
