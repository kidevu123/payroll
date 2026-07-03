// Admin calendar — month grid showing approved (and pending) time-off
// across all employees, plus a side rail with pending requests so
// admins can approve/reject without leaving the page. /requests now
// redirects here; this is the single canonical surface for "who's out
// when" + "what's waiting on me". Birthdays render as pink chips.

import Link from "next/link";
import { ChevronLeft, ChevronRight, Cake, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listApprovedInRange,
  listPendingInRange,
  tallyTimeOffByEmployeeForYear,
} from "@/lib/db/queries/time-off";
import { listPendingTimeOffRequests } from "@/lib/db/queries/requests";
import { listEmployees } from "@/lib/db/queries/employees";
import {
  TimeOffActions,
  CancelTimeOffActionButton,
  EditApprovedTimeOffAction,
} from "@/app/(admin)/requests/request-actions";
import { TimeOffOnBehalfForm } from "@/app/(admin)/requests/time-off-on-behalf-form";
import { Plane } from "lucide-react";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { isAdminManageableTimeOff } from "@/lib/time-off/change-request";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0, 1));
}

function endOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0 + 1, 0));
}

function eachDayBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(isoDay(d));
  }
  return out;
}

const TYPE_COLORS: Record<string, string> = {
  PERSONAL: "bg-success-100 text-success-800 border-success-200",
  SICK: "bg-warning-100 text-warning-800 border-warning-200",
  UNPAID: "bg-surface-2 text-text-muted border-border",
  OTHER:
    "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40",
  // Distinct from time-off bars — heads-up only, no payroll impact.
  // Soft blue says "informational" without competing with the
  // amber/emerald/violet bars that count toward time-off totals.
  SCHEDULE_NOTE: "bg-info-50 text-info-800 border-info-200",
};

const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
  SCHEDULE_NOTE: "Note",
};

function nameFromMap(
  empMap: Map<string, string>,
  id: string,
): string {
  return empMap.get(id) ?? "Unknown";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const company = await getSetting("company");
  const tab = params.tab === "totals" ? "totals" : "calendar";
  const today = new Date();
  const companyToday = companyTodayIso(today, company.timezone);
  const year = Number(params.year) || Number(companyToday.slice(0, 4));
  const month0 = Math.max(
    0,
    Math.min(11, (Number(params.month) || Number(companyToday.slice(5, 7))) - 1),
  );

  const monthStart = startOfMonth(year, month0);
  const monthEnd = endOfMonth(year, month0);
  const startIso = isoDay(monthStart);
  const endIso = isoDay(monthEnd);

  // Pad the grid to whole weeks. Week starts Sunday — that's the most common
  // US calendar convention. Adjust if the company TZ ever needs Monday-first.
  const padBefore = monthStart.getUTCDay(); // 0=Sun
  const padAfter = 6 - monthEnd.getUTCDay();
  const gridStart = new Date(monthStart.getTime() - padBefore * MS_PER_DAY);
  const gridEnd = new Date(monthEnd.getTime() + padAfter * MS_PER_DAY);

  const [
    approved,
    pending,
    employees,
    pendingTimeOff,
  ] = await Promise.all([
    listApprovedInRange(startIso, endIso),
    listPendingInRange(startIso, endIso),
    listEmployees(),
    listPendingTimeOffRequests(),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e.displayName]));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const todayIso = companyTodayIso(today, company.timezone);

  // Bucket requests by ISO day for fast cell lookup. Birthdays match
  // by month-day across any year.
  type CellEntry = {
    id: string;
    type: string;
    emp: string;
    startDate: string;
    endDate: string;
    reason: string | null;
    /** "11:00–14:00" when partial; null for full-day items. */
    partial: string | null;
    manageable: boolean;
  };
  const cellByDay = new Map<
    string,
    {
      approved: CellEntry[];
      pending: CellEntry[];
      birthdays: { name: string }[];
    }
  >();
  const partialLabel = (
    s: string | null | undefined,
    e: string | null | undefined,
  ): string | null => {
    if (!s && !e) return null;
    const fmt = (t: string | null | undefined): string => {
      if (!t) return "?";
      // "HH:MM:SS" or "HH:MM" → "h:mma" (no leading zero, lowercase am/pm).
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      if (!m) return t;
      const h = Number(m[1]);
      const mm = m[2];
      const ampm = h >= 12 ? "p" : "a";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return mm === "00" ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
    };
    return `${fmt(s)}–${fmt(e)}`;
  };
  for (const r of approved) {
    for (const day of eachDayBetween(r.startDate, r.endDate)) {
      if (day < startIso || day > endIso) continue;
      const cell = cellByDay.get(day) ?? { approved: [], pending: [], birthdays: [] };
      cell.approved.push({
        id: r.id,
        type: r.type,
        emp: nameFromMap(empMap, r.employeeId),
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
        partial: partialLabel(r.partialStartTime, r.partialEndTime),
        manageable: isAdminManageableTimeOff(r, todayIso),
      });
      cellByDay.set(day, cell);
    }
  }
  for (const r of pending) {
    for (const day of eachDayBetween(r.startDate, r.endDate)) {
      if (day < startIso || day > endIso) continue;
      const cell = cellByDay.get(day) ?? { approved: [], pending: [], birthdays: [] };
      cell.pending.push({
        id: r.id,
        type: r.type,
        emp: nameFromMap(empMap, r.employeeId),
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
        partial: partialLabel(r.partialStartTime, r.partialEndTime),
        manageable: false,
      });
      cellByDay.set(day, cell);
    }
  }

  // Birthdays — match employees.birthday MM-DD against each day in the
  // grid (year ignored). Inactive/terminated employees skipped.
  for (const e of employees) {
    if (!e.birthday) continue;
    if (e.status === "TERMINATED") continue;
    const md = e.birthday.slice(5); // "YYYY-MM-DD" -> "MM-DD"
    for (const day of eachDayBetween(startIso, endIso)) {
      if (day.slice(5) !== md) continue;
      const cell = cellByDay.get(day) ?? { approved: [], pending: [], birthdays: [] };
      cell.birthdays.push({ name: e.displayName });
      cellByDay.set(day, cell);
    }
  }

  const days: string[] = eachDayBetween(isoDay(gridStart), isoDay(gridEnd));

  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthStart);

  const prev = new Date(monthStart.getTime() - 1 * MS_PER_DAY);
  const next = new Date(monthEnd.getTime() + 1 * MS_PER_DAY);

  const pendingTotal = pendingTimeOff.length;

  // ── Month overview (drives the rail's stat cards) ──────────────────────
  // Real metrics derived from the data already fetched. There is no
  // "department" concept in the schema, so the fourth tile is "People off"
  // (distinct employees with approved time-off this month) instead.
  const activeEmployees = employees.filter((e) => e.status === "ACTIVE");
  const headcount = Math.max(1, activeEmployees.length);
  const approvedCount = approved.length;
  const peopleOffSet = new Set<string>(approved.map((r) => r.employeeId));
  const outByDay = new Map<string, Set<string>>();
  for (const r of approved) {
    for (const day of eachDayBetween(r.startDate, r.endDate)) {
      if (day < startIso || day > endIso) continue;
      const s = outByDay.get(day) ?? new Set<string>();
      s.add(r.employeeId);
      outByDay.set(day, s);
    }
  }
  let maxOut = 0;
  for (const s of outByDay.values()) maxOut = Math.max(maxOut, s.size);
  const coveragePct = Math.round((1 - maxOut / headcount) * 100);

  // Totals tab — compact YTD list. Computed only when the tab is open
  // so the calendar tab pays no DB cost. listApprovedTimeOffInRange-
  // style joins are intentionally NOT done here; the year-end
  // /reports/time-off page is the place for the full per-type
  // breakdown. This view stays "name + total days" so the cumulative
  // signal is one number per row.
  type TotalRow = { id: string; name: string; days: number };
  let totals: TotalRow[] = [];
  if (tab === "totals") {
    const yearForTotals = today.getUTCFullYear();
    const tally = await tallyTimeOffByEmployeeForYear(yearForTotals);
    totals = tally
      .map((t) => {
        const emp = empById.get(t.employeeId);
        if (!emp) return null;
        // Days = sum of all full-day rows. SCHEDULE_NOTE hours
        // intentionally excluded here — they're heads-up partials,
        // not actual time off, and surfacing them blurs the signal
        // we're trying to preserve. Full breakdown is one click away.
        const days =
          t.unpaidDays + t.sickDays + t.personalDays + t.otherDays;
        return days > 0
          ? { id: t.employeeId, name: emp.displayName, days }
          : null;
      })
      .filter((r): r is TotalRow => r !== null)
      .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Calendar &amp; requests
          </h1>
          <p className="text-sm text-text-muted">
            {tab === "totals"
              ? `Time off taken so far in ${today.getUTCFullYear()}.`
              : "Approved time-off across all employees. Pending requests show as faded bars on the grid and as actionable rows in the rail."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "calendar" && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/calendar?year=${prev.getUTCFullYear()}&month=${prev.getUTCMonth() + 1}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>
              <span className="font-medium">{monthName}</span>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/calendar?year=${next.getUTCFullYear()}&month=${next.getUTCMonth() + 1}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/calendar">Today</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab nav. Two pills, no chrome — keeps the page header light. */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabPill href="/calendar" label="Calendar" active={tab === "calendar"} />
        <TabPill
          href="/calendar?tab=totals"
          label="Time off totals"
          active={tab === "totals"}
        />
      </div>

      {tab === "totals" && (
        <div className="rounded-card border border-border bg-surface">
          {totals.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No approved time-off yet this year.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {totals.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  <Link
                    href={`/employees/${r.id}`}
                    className="text-sm font-medium hover:underline truncate"
                  >
                    {r.name}
                  </Link>
                  <span className="text-sm tabular-nums text-text-muted shrink-0">
                    {r.days} {r.days === 1 ? "day" : "days"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-2.5 text-xs">
            <Link
              href="/reports/time-off"
              className="text-brand-700 hover:underline"
            >
              View full breakdown →
            </Link>
          </div>
        </div>
      )}

      {tab === "calendar" && (

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="sr-only">{monthName}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
            <Legend label="PTO" className={TYPE_COLORS.PERSONAL!} />
            <Legend label="Sick" className={TYPE_COLORS.SICK!} />
            <Legend label="Unpaid" className={TYPE_COLORS.UNPAID!} />
            <Legend label="Other" className={TYPE_COLORS.OTHER!} />
            <Legend label="Note" className={TYPE_COLORS.SCHEDULE_NOTE!} />
            <Legend
              label="Birthday"
              className="bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-500/40"
            />
            <span className="text-text-muted">
              · Faded = pending approval
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-text-subtle border-b border-border pb-1 mb-1">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const cell = cellByDay.get(day) ?? {
                approved: [],
                pending: [],
                birthdays: [],
              };
              const inMonth = day >= startIso && day <= endIso;
              const isToday = day === todayIso;
              // Combine approved + pending into one ordered list so we
              // present a single "people off" stack per day. Approved
              // first, then pending. Cap at MAX_VISIBLE; the rest is
              // summarised with a hover-revealed list.
              const MAX_VISIBLE = 3;
              const stack = [
                ...cell.approved.map((r) => ({ ...r, pending: false })),
                ...cell.pending.map((r) => ({ ...r, pending: true })),
              ];
              const visible = stack.slice(0, MAX_VISIBLE);
              const overflow = stack.slice(MAX_VISIBLE);
              return (
                <div
                  key={day}
                  className={`min-h-16 sm:min-h-24 rounded-card border p-1 sm:p-1.5 ${
                    inMonth ? "bg-surface" : "bg-surface-2/40 opacity-60"
                  } ${
                    isToday ? "ring-2 ring-brand-700" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-muted">
                      {Number(day.slice(8))}
                    </span>
                    {cell.birthdays.length > 0 && (
                      <Cake
                        className="h-3 w-3 text-pink-600"
                        aria-hidden
                      />
                    )}
                  </div>
                  {cell.birthdays.length > 0 && (
                    // Always render the actual name. The previous build
                    // hid them in a `title` tooltip, which doesn't fire
                    // on touch — owner couldn't tell whose birthday it
                    // was without going to the employees page.
                    <div className="mt-1 space-y-0.5">
                      {cell.birthdays.map((b, i) => (
                        <div
                          key={`bday-${day}-${i}`}
                          className="truncate rounded border border-pink-300 bg-pink-50 px-1.5 py-0.5 text-[11px] leading-tight text-pink-800 dark:border-pink-500/40 dark:bg-pink-500/15 dark:text-pink-300"
                          title={`${b.name} — birthday`}
                        >
                          {b.name}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Mobile: colored dots per entry (matches #69). Name bars
                      are too wide for a 7-col phone grid. */}
                  {stack.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                      {stack.slice(0, 4).map((r, i) => (
                        <span
                          key={`dot-${day}-${i}`}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: TYPE_DOT[r.type] ?? TYPE_DOT.OTHER,
                            opacity: r.pending ? 0.45 : 1,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <div className="mt-1 space-y-1 hidden sm:block">
                    {visible.map((r) => (
                      <CalendarEntry
                        key={`${day}-${r.id}`}
                        entry={r}
                      />
                    ))}
                    {overflow.length > 0 && (
                      <details className="group">
                        <summary
                          className="cursor-pointer list-none text-[11px] font-medium text-text-muted hover:text-text"
                          title={overflow.map((r) => r.emp).join(", ")}
                        >
                          +{overflow.length} more
                        </summary>
                        <div className="mt-1 space-y-0.5 rounded-card border border-border bg-surface-2 p-1">
                          {overflow.map((r) => (
                            <CalendarEntry
                              key={`${day}-overflow-${r.id}`}
                              entry={r}
                              compact
                            />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

        {/* Pending requests rail. Sticky on desktop so it stays in view
            as the operator scrolls; collapses below the calendar on
            mobile. Empty-state collapses entirely when nothing's
            pending — calendar gets the full width. */}
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
          {/* Month overview — four stat tiles (matches the #58 rail). */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{monthName} overview</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <OverviewStat tone="emerald" value={approvedCount} label="Approved" sub="Time-off requests" />
              <OverviewStat tone="amber" value={pendingTimeOff.length} label="Pending" sub="Awaiting approval" />
              <OverviewStat tone="violet" value={peopleOffSet.size} label="People off" sub="This month" />
              <OverviewStat tone="indigo" value={`${coveragePct}%`} label="Coverage" sub="Across all shifts" />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Pending {pendingTotal > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-100 px-1.5 text-[11px] font-medium text-warning-900">
                  {pendingTotal}
                </span>
              )}
            </h2>
            <TimeOffOnBehalfForm
              employees={employees
                .filter((e) => e.status !== "TERMINATED")
                .map((e) => ({ id: e.id, displayName: e.displayName }))}
            />
          </div>

          {pendingTotal === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface-2/40 p-6 text-center text-xs text-text-muted">
              Nothing waiting on you. New requests show up here as
              employees submit them.
            </div>
          ) : (
            <>
              {pendingTimeOff.length > 0 && (
                <div className="rounded-card border border-border bg-surface p-3 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-info-800">
                    <Plane className="h-3.5 w-3.5" />
                    Time off ({pendingTimeOff.length})
                  </div>
                  {pendingTimeOff.map((r) => {
                    const emp = empById.get(r.employeeId);
                    const partial = partialLabel(r.partialStartTime, r.partialEndTime);
                    return (
                      <div
                        key={r.id}
                        className="rounded-input border border-border bg-surface-2/40 p-2 space-y-1.5"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium truncate">
                            {emp?.displayName ?? r.employeeId}
                          </span>
                          <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                            {r.startDate}
                            {r.startDate !== r.endDate ? ` – ${r.endDate}` : ""}
                          </span>
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {r.changeRequestAction === "EDIT"
                            ? "change approved time off"
                            : r.changeRequestAction === "CANCEL"
                              ? "cancel approved time off"
                              : (TYPE_LABEL[r.type] ?? r.type).toLowerCase()}
                          {partial ? ` · ${partial}` : ""}
                        </div>
                        {r.reason && (
                          <p className="text-[11px] text-text-muted line-clamp-2">
                            {r.reason}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <TimeOffActions
                            requestId={r.id}
                            employeeId={r.employeeId}
                          />
                          <CancelTimeOffActionButton
                            requestId={r.id}
                            status="PENDING"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Need coverage? — quick jump to the attendance board to fill
              open shifts (matches the #58 rail). */}
          <Card>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Need coverage?</div>
                <p className="mt-0.5 text-xs text-text-muted">
                  Find available team members for open shifts.
                </p>
                <Link
                  href="/time"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Find coverage <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"
              >
                <Users className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        </aside>
      </div>
      )}
    </div>
  );
}

function CalendarEntry({
  entry,
  compact = false,
}: {
  entry: {
    id: string;
    type: string;
    emp: string;
    startDate: string;
    endDate: string;
    reason: string | null;
    partial: string | null;
    pending: boolean;
    manageable: boolean;
  };
  compact?: boolean;
}) {
  const chipClassName =
    (compact ? "text-[10px]" : "text-[11px]") +
    " block w-full truncate rounded border px-1.5 py-0.5 text-left leading-tight " +
    (TYPE_COLORS[entry.type] ?? TYPE_COLORS.OTHER) +
    (entry.pending ? " border-dashed opacity-70" : "");
  const label = entry.partial ? `${entry.emp} · ${entry.partial}` : entry.emp;
  const title = `${entry.emp} — ${TYPE_LABEL[entry.type] ?? entry.type}${entry.partial ? ` ${entry.partial}` : ""}${entry.pending ? " (pending)" : ""}`;

  if (!entry.manageable) {
    return (
      <div className={chipClassName} title={title}>
        {label}
      </div>
    );
  }

  return (
    <details className="group relative">
      <summary className="list-none cursor-pointer" title={`${title} — click to edit or cancel`}>
        <span className={chipClassName}>{label}</span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-2 rounded-card border border-border bg-surface p-2 shadow-pop">
        <div className="text-[11px] font-medium text-text">{entry.emp}</div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {entry.startDate}
          {entry.startDate !== entry.endDate ? ` – ${entry.endDate}` : ""}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <EditApprovedTimeOffAction
            request={{
              id: entry.id,
              startDate: entry.startDate,
              endDate: entry.endDate,
              type: entry.type as "UNPAID" | "SICK" | "PERSONAL" | "OTHER",
              reason: entry.reason,
            }}
          />
          <CancelTimeOffActionButton requestId={entry.id} status="APPROVED" />
        </div>
      </div>
    </details>
  );
}

function TabPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand-700 text-text"
          : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {label}
    </Link>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${className}`}>
      {label}
    </span>
  );
}

// Overview stat tile for the calendar rail. Uses the dash palette tokens
// (defined light + dark in globals.css) so each tile stays a distinct,
// correctly-tinted color in BOTH themes — unlike brand-50, which is
// deliberately pale in dark mode. color-mix over transparent gives a soft
// tint that works on both the white (light) and near-black (dark) card.
// Mobile dot color per time-off type (matches the #69 dot-grid + legend).
const TYPE_DOT: Record<string, string> = {
  PERSONAL: "var(--dash-emerald)",
  SICK: "var(--dash-amber)",
  UNPAID: "var(--dash-text-faint)",
  OTHER: "var(--dash-violet)",
  SCHEDULE_NOTE: "var(--dash-indigo)",
};

const OVERVIEW_TONE: Record<string, string> = {
  emerald: "var(--dash-emerald)",
  amber: "var(--dash-amber)",
  violet: "var(--dash-violet)",
  indigo: "var(--dash-indigo)",
};

function OverviewStat({
  tone,
  value,
  label,
  sub,
}: {
  tone: "emerald" | "amber" | "violet" | "indigo";
  value: string | number;
  label: string;
  sub: string;
}) {
  const c = OVERVIEW_TONE[tone];
  return (
    <div
      className="rounded-input p-3"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    >
      <div className="text-2xl font-bold leading-none tabular-nums" style={{ color: c }}>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-semibold text-text">{label}</div>
      <div className="text-[11px] text-text-muted">{sub}</div>
    </div>
  );
}
