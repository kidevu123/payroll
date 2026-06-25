// Central punch-control admin surface. Owner: "if this problem is going
// to be on going to need a UI to be able to control punches. almost like
// a manual override so this fucking never happens again". Lists every
// non-voided punch across every period; filterable by employee, date
// range, and source; provides the same Edit + Delete (void) controls
// as the per-day editor, plus a "go to day" deeplink.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth-guards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getSetting } from "@/lib/settings/runtime";
import { companyDayIso } from "@/lib/time/company-day";

type SearchParams = Promise<{
  employeeId?: string;
  from?: string;
  to?: string;
  source?: string;
  includeVoided?: string;
}>;

function fmt(d: Date | null, tz: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function dayKey(d: Date, tz: string): string {
  return companyDayIso(d, tz);
}

export default async function PunchesAdmin({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  const params = await searchParams;
  const company = await getSetting("company");

  const [employees, allPunches] = await Promise.all([
    listEmployees(),
    listPunches({
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
      includeVoided: params.includeVoided === "1",
    }),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Date filter (clock_in falls in [from, to] inclusive, in company tz).
  const fromDay = params.from || null;
  const toDay = params.to || null;
  const sourceFilter = params.source || "";

  const filtered = allPunches
    .filter((p) => {
      if (sourceFilter && p.source !== sourceFilter) return false;
      const day = dayKey(p.clockIn, company.timezone);
      if (fromDay && day < fromDay) return false;
      if (toDay && day > toDay) return false;
      return true;
    })
    .sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime())
    .slice(0, 500);

  // Resolve period dates for "Open day" deeplinks (and for showing
  // out-of-period warnings).
  const periodIds = [...new Set(filtered.map((p) => p.periodId))];
  const periodRows = periodIds.length
    ? await db.select().from(payPeriods).where(inArray(payPeriods.id, periodIds))
    : [];
  const periodById = new Map(periodRows.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All punches</h1>
        <p className="text-sm text-text-muted">
          Manual override surface — search, edit, or void any punch across every period.
          Showing the {filtered.length}{" "}
          {filtered.length === 1 ? "match" : "matches"} (capped at 500).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="GET"
            action="/punches"
            className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end"
          >
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Employee</label>
              <select
                name="employeeId"
                defaultValue={params.employeeId ?? ""}
                className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm"
              >
                <option value="">All</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">From</label>
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ""}
                className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">To</label>
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ""}
                className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Source</label>
              <select
                name="source"
                defaultValue={params.source ?? ""}
                className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm"
              >
                <option value="">All</option>
                <option value="MANUAL_ADMIN">MANUAL_ADMIN</option>
                <option value="NGTECO_REALTIME">NGTECO_REALTIME</option>
                <option value="NGTECO_CSV">NGTECO_CSV</option>
                <option value="LEGACY_IMPORT">LEGACY_IMPORT</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="includeVoided"
                  value="1"
                  defaultChecked={params.includeVoided === "1"}
                />
                Voided
              </label>
              <Button type="submit" size="sm">
                Apply
              </Button>
              <Button type="button" asChild size="sm" variant="ghost">
                <Link href="/punches">Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="rounded-card border border-border/70 bg-surface shadow-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/40 text-xs text-text-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Employee</th>
              <th className="text-left px-3 py-2 font-medium">Clock in (ET)</th>
              <th className="text-left px-3 py-2 font-medium">Clock out (ET)</th>
              <th className="text-right px-3 py-2 font-medium">Hours</th>
              <th className="text-left px-3 py-2 font-medium">Source</th>
              <th className="text-left px-3 py-2 font-medium">Period</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  No punches match.
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const emp = empById.get(p.employeeId);
              const period = periodById.get(p.periodId);
              const day = dayKey(p.clockIn, company.timezone);
              const outOfPeriod =
                period &&
                (day < period.startDate || day > period.endDate);
              const ms = p.clockOut
                ? p.clockOut.getTime() - p.clockIn.getTime()
                : 0;
              const hrs = ms > 0 ? (ms / 3_600_000).toFixed(2) : "—";
              return (
                <tr
                  key={p.id}
                  className={
                    "hover:bg-surface-2/30 " +
                    (p.voidedAt ? "opacity-50 line-through " : "") +
                    (outOfPeriod ? "bg-warning-50/40 " : "")
                  }
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/employees/${p.employeeId}`}
                      className="hover:underline"
                    >
                      {emp?.displayName ?? "Unknown"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmt(p.clockIn, company.timezone)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmt(p.clockOut, company.timezone)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {hrs}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {p.source}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {period ? (
                      <Link
                        href={`/payroll/${period.id}`}
                        className="hover:underline text-text-muted"
                      >
                        {period.startDate} → {period.endDate}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {outOfPeriod && (
                      <div className="text-[10px] text-warning-700 font-medium">
                        Out of period
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild size="sm" variant="secondary">
                      <Link
                        href={`/time/${p.periodId}/${day}/${p.employeeId}`}
                      >
                        Open day <ArrowRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
