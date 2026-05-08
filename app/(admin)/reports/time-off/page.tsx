// /reports/time-off — admin year-end "is anyone taking too much time
// off?" question, answered as a single sortable table per employee.
//
// Defaults to the current calendar year (in the company timezone).
// Year picker lets admin browse history. Counts are computed in
// tallyTimeOffByEmployeeForYear: full-day rows count as days,
// SCHEDULE_NOTE rows count as hours (since they're partial). Total
// time away normalizes everything to hours so a single column drives
// the sort.

import Link from "next/link";
import { Download, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { tallyTimeOffByEmployeeForYear } from "@/lib/db/queries/time-off";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";

export const dynamic = "force-dynamic";

const HOURS_PER_DAY = 8;

export default async function TimeOffTallyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const sp = await searchParams;
  const company = await getSetting("company");
  const todayInTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  }).format(new Date());
  const currentYear = Number(todayInTz.slice(0, 4));
  const year = (() => {
    const y = Number(sp.year);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) return y;
    return currentYear;
  })();

  const [tally, employees] = await Promise.all([
    tallyTimeOffByEmployeeForYear(year),
    listEmployees(),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e]));

  // Build a row per ACTIVE/INACTIVE employee even when they had zero
  // time off — gives the admin a full attendance picture at year end.
  // Terminated employees only appear if they actually took time off.
  type Row = {
    id: string;
    name: string;
    payType: "HOURLY" | "SALARIED" | "TASK" | "MIXED" | string;
    unpaidDays: number;
    sickDays: number;
    personalDays: number;
    otherDays: number;
    scheduleNoteHours: number;
    totalHours: number;
  };
  const rowsById = new Map<string, Row>();
  for (const e of employees) {
    if (e.status === "TERMINATED") continue;
    rowsById.set(e.id, {
      id: e.id,
      name: e.displayName,
      payType: e.payType,
      unpaidDays: 0,
      sickDays: 0,
      personalDays: 0,
      otherDays: 0,
      scheduleNoteHours: 0,
      totalHours: 0,
    });
  }
  for (const t of tally) {
    const emp = empMap.get(t.employeeId);
    if (!emp) continue; // Orphaned request — skip rather than guess.
    const existing = rowsById.get(t.employeeId) ?? {
      id: t.employeeId,
      name: emp.displayName,
      payType: emp.payType,
      unpaidDays: 0,
      sickDays: 0,
      personalDays: 0,
      otherDays: 0,
      scheduleNoteHours: 0,
      totalHours: 0,
    };
    existing.unpaidDays = t.unpaidDays;
    existing.sickDays = t.sickDays;
    existing.personalDays = t.personalDays;
    existing.otherDays = t.otherDays;
    existing.scheduleNoteHours = t.scheduleNoteHours;
    existing.totalHours =
      (t.unpaidDays + t.sickDays + t.personalDays + t.otherDays) *
        HOURS_PER_DAY +
      t.scheduleNoteHours;
    rowsById.set(t.employeeId, existing);
  }

  const rows = Array.from(rowsById.values()).sort(
    (a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      unpaidDays: acc.unpaidDays + r.unpaidDays,
      sickDays: acc.sickDays + r.sickDays,
      personalDays: acc.personalDays + r.personalDays,
      otherDays: acc.otherDays + r.otherDays,
      scheduleNoteHours: acc.scheduleNoteHours + r.scheduleNoteHours,
      totalHours: acc.totalHours + r.totalHours,
    }),
    {
      unpaidDays: 0,
      sickDays: 0,
      personalDays: 0,
      otherDays: 0,
      scheduleNoteHours: 0,
      totalHours: 0,
    },
  );

  // Year navigation: previous and next years bounded by currentYear.
  // No future-year option — there's no data to look at yet.
  const prevYear = year - 1;
  const nextYear = year + 1 <= currentYear ? year + 1 : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
          >
            <ArrowLeft className="h-3 w-3" /> Reports
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Time off · {year}
          </h1>
          <p className="text-sm text-text-muted">
            Per-employee tally of approved time off. Sorted by total time
            away. Heads-up notes (Schedule note hours) are tracked
            separately so you can see informational hours apart from
            actual time-off totals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/reports/time-off?year=${prevYear}`}>← {prevYear}</Link>
          </Button>
          {nextYear && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/reports/time-off?year=${nextYear}`}>
                {nextYear} →
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/reports/time-off.csv?year=${year}`}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{year} totals</CardTitle>
          <CardDescription className="text-xs">
            Days are calendar days (full-day requests). Schedule note hours
            are partial-day heads-ups — these don&apos;t count toward
            time-off totals but show here so a high number is visible.
            Total time away assumes {HOURS_PER_DAY} hours/day.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border bg-surface-2/60">
              <tr>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Unpaid d</th>
                <th className="px-3 py-2 font-medium text-right">Sick d</th>
                <th className="px-3 py-2 font-medium text-right">PTO d</th>
                <th className="px-3 py-2 font-medium text-right">Other d</th>
                <th className="px-3 py-2 font-medium text-right">
                  Note h
                </th>
                <th className="px-3 py-2 font-medium text-right">
                  Total time away (h)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-text-muted"
                  >
                    No employees on file.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/employees/${r.id}`}
                      className="hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">
                    {r.payType}
                  </td>
                  <td className="px-3 py-2 text-right">{r.unpaidDays || ""}</td>
                  <td className="px-3 py-2 text-right">{r.sickDays || ""}</td>
                  <td className="px-3 py-2 text-right">
                    {r.personalDays || ""}
                  </td>
                  <td className="px-3 py-2 text-right">{r.otherDays || ""}</td>
                  <td className="px-3 py-2 text-right">
                    {r.scheduleNoteHours
                      ? r.scheduleNoteHours.toFixed(1)
                      : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {r.totalHours
                      ? r.totalHours.toFixed(1)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-border bg-surface-2/60">
                <tr>
                  <td className="px-3 py-2 font-medium">Total</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-medium">
                    {totals.unpaidDays}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {totals.sickDays}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {totals.personalDays}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {totals.otherDays}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {totals.scheduleNoteHours.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {totals.totalHours.toFixed(1)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
