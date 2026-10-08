import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Upload } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import { Button } from "@/components/ui/button";
import { PollPunchesNowButton } from "@/components/admin/poll-punches-now";
import { BackfillPunchesButton } from "@/components/admin/backfill-punches";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listApprovedInRange } from "@/lib/db/queries/time-off";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { resolveTimeCellPeriodId } from "@/lib/time/grid-links";
import { formatTimeShort, localMidnightUtc, addDaysIso } from "@/lib/utils";
import { BackfillAlert } from "@/components/admin/backfill-alert";
import { MissedPunchRailCard } from "@/components/domain/missed-punch-rail-card";
import { companyDayIso } from "@/lib/time/company-day";
import { todayInCompanyTz, eachDayIso } from "@/lib/time/format";
import { gridLastDay, type PeriodView } from "@/lib/time-grid/period-select";
import {
  MOBILE_STATUS,
  cellAriaLabel,
  cellStateFor,
  summarizeCell,
  timeInitials,
} from "@/lib/time-grid/cell-state";
import { computeGridKpis, mobileSummaryLine } from "@/lib/time-grid/kpis";
import { ExceptionsQueueCard } from "@/components/time/exceptions-queue-card";
import { MiloInsightCard } from "@/components/time/insight-card";
import { KpiCards } from "@/components/time/kpi-cards";
import { LaborHoursCard } from "@/components/time/labor-hours-card";
import { Legend } from "@/components/time/legend";
import { PunchCell } from "@/components/time/punch-cell";
import { TodaySummaryCard } from "@/components/time/today-summary-card";
import {
  findAdjacentPeriods,
  loadPeriodForTab,
  pickPeriodForTab,
} from "@/lib/db/queries/time-grid";





function dayOf(d: Date, tz: string): string {
  return companyDayIso(d, tz);
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string; period?: string; day?: string }>;
}) {
  const company = await getSetting("company");
  const today = todayInCompanyTz(company.timezone);
  const sp = await searchParams;
  const tab = parseScheduleTab(sp.schedule);
  // Time only filters on punch-bearing cadences. The "SALARIED" synthetic
  // kind (returned by scheduleTabToKind for the Salaried tab) is handled by
  // the early return below, so collapse it to null here — salaried staff have
  // no punches and never reach the period/employee filters that use this.
  const rawKind = scheduleTabToKind(tab);
  const kindFilter: "WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | null =
    rawKind === "SALARIED" ? null : rawKind;

  // Salaried staff don't punch a clock — the Time grid is hourly punches only.
  // Without this guard the Salaried tab falls through (no kind filter) and
  // lists every hourly employee, which looked like data had moved around.
  if (tab === "salaried") {
    return (
      <div className="space-y-5">
        <ScheduleTabs current={tab} basePath="/time" />
        <EmptyState
          icon={CalendarDays}
          title="Salaried staff don't punch a clock"
          description="Salaried employees are paid externally and have no time punches. Manage their paystubs and documents on the Salaried page."
        />
      </div>
    );
  }

  // If a specific period ID is in the URL (?period=UUID), load it directly
  // so the admin can navigate to past/future weeks via the prev/next arrows.
  // Ignore ?period= when it belongs to a different schedule tab.
  // Otherwise fall back to auto-selecting the current period for the tab.
  let period: PeriodView | null = sp.period
    ? await loadPeriodForTab(sp.period, kindFilter)
    : null;
  if (!period) {
    period = await pickPeriodForTab(kindFilter, today);
  }

  const returnToParams = new URLSearchParams();
  if (tab !== "all") returnToParams.set("schedule", tab);
  if (period?.id) returnToParams.set("period", period.id);
  const returnTo = `/time${returnToParams.size ? `?${returnToParams.toString()}` : ""}`;

  if (!period) {
    const payrollHref =
      tab === "semi"
        ? "/payroll?schedule=semi"
        : tab === "monthly"
          ? "/payroll?schedule=monthly"
          : tab === "weekly"
            ? "/payroll?schedule=weekly"
            : "/payroll";
    const clockFirst =
      tab === "monthly" || tab === "semi" || tab === "weekly";
    return (
      <div className="space-y-5">
        <ScheduleTabs current={tab} basePath="/time" />
        <EmptyState
          icon={CalendarDays}
          title={
            clockFirst
              ? "Waiting for clock punches"
              : "No pay periods yet"
          }
          description={
            clockFirst
              ? "Time fills from the NGTeco clock automatically — you do not need a CSV for day-to-day tracking. Make sure employees are on this pay schedule, then run Poll punches now above to sync, or add a manual punch below. CSV upload is only for one-off payroll runs."
              : "Pick a schedule tab (Weekly, Semi-monthly, or Monthly), or add a manual punch to get started."
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {clockFirst ? (
                <Button asChild>
                  <Link href={payrollHref}>Go to Payroll · sync clock</Link>
                </Button>
              ) : null}
              <Button asChild variant={clockFirst ? "secondary" : "default"}>
                <Link href="/punches/new">Add manual punch</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  // Canonical 7-day work week: render Monday → Sunday regardless of
  // how the upload was scoped. Owner pulls punches early sometimes
  // (Mon-Fri because no work happened Sat-Sun) but the displayed
  // grid should still reflect the full pay week so empty Sat/Sun
  // cells are visible. eachDay only goes as far as the stored
  // end_date, so widen it to start+6 days when the stored range is
  // shorter.
  const lastDay = gridLastDay(period);
  const days = eachDayIso(period.startDate, lastDay);
  const [allActive, punches, approvedTimeOff, adjacent] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    // Always load by date range. Filtering by period.id hid punches that
    // were saved under a sibling schedule's overlapping period (e.g. a
    // weekly employee's punch stuck in the semi-monthly Jun 1–30 row).
    listPunches({
      clockAfter: localMidnightUtc(period.startDate, company.timezone),
      clockBefore: new Date(
        localMidnightUtc(addDaysIso(lastDay, 1), company.timezone).getTime() - 1,
      ),
    }),
    // Approved time-off intersecting the displayed grid window. Owner
    // ask: "if I'm looking at Elvia's time it would help to know right
    // away she was off". So the cell shows the time-off type instead
    // of a missed-punch red.
    listApprovedInRange(period.startDate, lastDay),
    findAdjacentPeriods(period),
  ]);
  // Build employeeId+date → time-off-type map for O(1) cell lookup.
  // SCHEDULE_NOTE is a heads-up, not actual time off — skip those so
  // the grid still shows the underlying punches for that day instead
  // of hiding the cell behind a "Sick"-style label.
  const timeOffByDay = new Map<string, "UNPAID" | "SICK" | "PERSONAL" | "OTHER">();
  for (const r of approvedTimeOff) {
    if (r.type === "SCHEDULE_NOTE") continue;
    const start = new Date(`${r.startDate}T00:00:00Z`);
    const end = new Date(`${r.endDate}T00:00:00Z`);
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const dayIso = d.toISOString().slice(0, 10);
      timeOffByDay.set(`${r.employeeId}|${dayIso}`, r.type);
    }
  }
  const punchesInRange = punches;
  // SALARIED staff don't punch — hide them from the grid so the admin
  // doesn't see "missed" red cells for everyone-on-salary every day.
  // Schedule-tab filter: when the admin picks Weekly / Semi-monthly,
  // only show employees on a matching schedule (employees with a NULL
  // schedule are wildcards and stay visible across both tabs).
  const employees = allActive
    .filter((e) => e.payType !== "SALARIED")
    .filter((e) => {
      if (!kindFilter) return true;
      if (e.payScheduleId === null) return true;
      return e.payScheduleId === period.payScheduleId;
    });

  // Group punches by employeeId + day, then dedup near-duplicates within
  // each cell so the grid doesn't show "1" / "2" cells for what's really
  // a single shift represented twice.
  const grid = new Map<string, Map<string, typeof punchesInRange>>();
  for (const e of employees) grid.set(e.id, new Map());
  for (const p of punchesInRange) {
    const day = dayOf(p.clockIn, company.timezone);
    const byDay = grid.get(p.employeeId);
    if (!byDay) continue;
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  for (const byDay of grid.values()) {
    for (const [day, list] of byDay) {
      byDay.set(day, dedupNearDuplicatePunches(list));
    }
  }

  // Mobile day selector — show one day at a time as a vertical list. Default
  // to today when it's in the window, else the last day. URL-driven (?day=).
  const selectedDay =
    sp.day && days.includes(sp.day)
      ? sp.day
      : days.includes(today)
        ? today
        : (days[days.length - 1] ?? today);

  // One cell = one employee on one day. The desktop grid, the phone list and
  // the KPI figures all go through this.
  const cellFor = (e: (typeof employees)[number], d: string) => {
    const list = grid.get(e.id)?.get(d) ?? [];
    const state = cellStateFor({
      punches: list,
      offType: timeOffByDay.get(`${e.id}|${d}`),
      dayIso: d,
      today,
      employeeActive: e.status === "ACTIVE",
    });
    const { sorted, closedMs } = summarizeCell(list);
    return {
      e,
      state,
      sorted,
      closedMs,
      cellPeriodId: resolveTimeCellPeriodId({
        currentPeriodId: period.id,
        punches: sorted,
      }),
    };
  };
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const kpis = computeGridKpis({
    punches: punchesInRange,
    employees,
    days,
    today,
    tz: company.timezone,
    cellState: (employeeId, d) => cellFor(employeeById.get(employeeId)!, d).state,
  });
  const mobileRows = employees.map((e) => cellFor(e, selectedDay));
  const mobileSummary = mobileSummaryLine(mobileRows.map((r) => r.state));

  // Punch sync controls moved here from /payroll (owner: "there is no
  // reason for poll now to be on the payroll page — it belongs on Time").
  const lastPoll = await getLastPoll();

  const stateBadge = (() => {
    switch (period.state) {
      case "UPCOMING":
        return { label: "Upcoming", cls: "bg-brand-50 text-brand-700 border-brand-200/80" };
      case "LOCKED":
        return { label: "Locked", cls: "bg-warning-50 text-warning-700 border-warning-200/80" };
      case "PAID":
        return { label: "Paid", cls: "bg-success-50 text-success-700 border-success-200/80" };
      default:
        return { label: "Open", cls: "bg-success-50 text-success-700 border-success-200/80" };
    }
  })();

  return (
    <div className="space-y-5">
      {/* Page header. Below lg everything stacks in one column: the action
          cluster used to be a shrink-0 right-aligned flex row, which on a
          phone could not wrap and pushed the whole page ~670px wider than
          the screen. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2.5 lg:space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-title tracking-tight antialiased text-text">Time</h1>
            <span
              className={`inline-flex items-center rounded-chip border px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ${stateBadge.cls}`}
            >
              {stateBadge.label}
            </span>
          </div>
          {/* Period range with prev/next navigation. On touch it is one
              full-width segmented control with 44px targets; on desktop it
              collapses back to the quiet inline pager. */}
          <div className="flex items-center gap-1 max-lg:rounded-input max-lg:border max-lg:border-border max-lg:bg-surface max-lg:p-0.5 max-lg:shadow-card">
            {adjacent.prevId ? (
              <Link
                href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.prevId })}`}
                className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center rounded-input lg:rounded hover:bg-surface-2/40 active:bg-surface-2/60 text-text-muted hover:text-text transition-colors"
                aria-label="Previous period"
              >
                <ChevronLeft className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </Link>
            ) : (
              <span className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center text-text-subtle/20">
                <ChevronLeft className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-center text-body font-medium tabular-nums text-text lg:flex-none lg:px-0.5 lg:text-left lg:text-text-muted">
              {formatPeriodRange(period.startDate, lastDay)}
              {period.state === "UPCOMING" && (
                <span className="ml-2.5 hidden text-micro uppercase text-brand-600 lg:inline">
                  live · punches will land here
                </span>
              )}
            </span>
            {adjacent.nextId ? (
              <Link
                href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.nextId })}`}
                className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center rounded-input lg:rounded hover:bg-surface-2/40 active:bg-surface-2/60 text-text-muted hover:text-text transition-colors"
                aria-label="Next period"
              >
                <ChevronRight className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </Link>
            ) : (
              <span className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center text-text-subtle/20">
                <ChevronRight className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </span>
            )}
            {/* Jump straight back to the current period (drops ?period= so the
                page auto-selects today's period for this schedule). */}
            <Link
              href={`/time${tab !== "all" ? `?schedule=${tab}` : ""}`}
              className="h-11 lg:h-6 shrink-0 inline-flex items-center rounded-input lg:rounded px-3 lg:px-2 lg:ml-1 text-micro uppercase text-text-muted hover:bg-surface-2/40 active:bg-surface-2/60 hover:text-text transition-colors max-lg:border-l max-lg:border-border/70 max-lg:rounded-l-none"
            >
              Today
            </Link>
          </div>
          {period.state === "UPCOMING" && (
            <p className="text-caption font-medium text-brand-700 lg:hidden">
              Live period · punches will land here
            </p>
          )}
          <ScheduleTabs current={tab} basePath="/time" />
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-3 lg:items-end">
          {/* Phone: sync is the full-width lead action, the three secondary
              actions share one row beneath it. From sm up it is the original
              wrapping row. */}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end">
            <div className="order-1 col-span-3 min-w-0 sm:order-none">
              <PollPunchesNowButton
                initialLast={
                  lastPoll
                    ? {
                        startedAt: lastPoll.startedAt.toISOString(),
                        finishedAt: lastPoll.finishedAt?.toISOString() ?? null,
                        ok: lastPoll.ok,
                        triggeredBy: lastPoll.triggeredBy,
                        pairsInserted: lastPoll.pairsInserted,
                        pairsUpdated: lastPoll.pairsUpdated,
                        errorMessage: lastPoll.errorMessage,
                      }
                    : null
                }
              />
            </div>
            <div className="order-3 min-w-0 sm:order-none">
              <BackfillPunchesButton />
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="order-3 max-sm:min-h-11 max-sm:border max-sm:border-border max-sm:bg-surface max-sm:px-2 sm:order-none"
            >
              <Link href="/run-payroll/upload">
                <Upload className="h-4 w-4" /> Upload CSV
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="order-2 max-sm:min-h-11 max-sm:px-2 sm:order-none"
            >
              <Link href="/punches/new">
                <Plus className="h-3.5 w-3.5" />
                <span className="sm:hidden">Add punch</span>
                <span className="hidden sm:inline">Add manual punch</span>
              </Link>
            </Button>
          </div>
          {/* The legend decodes the desktop grid's colored cells; the phone
              list labels every row in words, so it is not needed there. */}
          <div className="hidden lg:flex items-center gap-3 text-caption text-text-muted font-medium">
            <Legend label="Complete" state="complete" />
            <Legend label="Incomplete" state="incomplete" />
            <Legend label="Missed" state="missed" />
            <Legend label="Time off" state="pto" />
          </div>
        </div>
      </div>

      <KpiCards kpis={kpis} dayCount={days.length} />

      {kpis.staleOpenPunchCount > 0 && (
        <BackfillAlert openCountFromPriorDays={kpis.staleOpenPunchCount} />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          {/* ── Phone / tablet: day strip + single-day attendance list ──
              The strip is a 7-column grid, so a weekly period fits the
              screen with no sideways scrolling and a monthly period wraps
              into a mini calendar. A weekly strip pins under the top bar so
              the day can be switched from anywhere in the list. */}
          <nav
            aria-label="Day"
            className={`lg:hidden rounded-card border border-border bg-surface p-1.5 shadow-card ${
              days.length <= 7
                ? "sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 md:top-2"
                : ""
            }`}
          >
            <div className="grid grid-cols-7 gap-1">
              {days.length > 7 &&
                ["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="pb-0.5 text-center text-[11px] font-medium text-text-subtle"
                  >
                    {l}
                  </span>
                ))}
              {days.map((d, i) => {
                const isSel = d === selectedDay;
                const isToday = d === today;
                const dt = new Date(`${d}T12:00:00Z`);
                const dow = new Intl.DateTimeFormat("en-US", {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(dt);
                const issues = kpis.issuesByDay.get(d) ?? 0;
                return (
                  <Link
                    key={d}
                    href={`/time?${new URLSearchParams({
                      ...(tab !== "all" ? { schedule: tab } : {}),
                      ...(period.id ? { period: period.id } : {}),
                      day: d,
                    })}`}
                    aria-current={isSel ? "date" : undefined}
                    aria-label={`${new Intl.DateTimeFormat("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(dt)}${issues > 0 ? `, ${issues} incomplete` : ""}`}
                    // Monthly strips start on whatever weekday the 1st is.
                    style={
                      i === 0 && days.length > 7
                        ? { gridColumnStart: ((dt.getUTCDay() + 6) % 7) + 1 }
                        : undefined
                    }
                    className={`relative flex min-h-[3.25rem] flex-col items-center justify-center rounded-input transition-colors ${
                      isSel
                        ? "bg-brand-700 text-white shadow-card"
                        : isToday
                          ? "text-brand-700 active:bg-surface-2/60"
                          : "text-text-muted active:bg-surface-2/60"
                    }`}
                  >
                    {days.length <= 7 && (
                      <span className={`text-[11px] font-medium uppercase tracking-wide ${isSel ? "text-white/80" : ""}`}>
                        {dow}
                      </span>
                    )}
                    <span className={`text-sm tabular-nums ${isSel || isToday ? "font-bold" : "font-semibold text-text"}`}>
                      {dt.getUTCDate()}
                    </span>
                    {issues > 0 && (
                      <span
                        aria-hidden
                        className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSel ? "bg-white" : "bg-warning-500"}`}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="lg:hidden flex items-baseline justify-between gap-3 px-1 pt-1">
            <h2 className="text-subheading text-text">
              {new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(`${selectedDay}T12:00:00Z`))}
              {selectedDay === today && (
                <span className="ml-2 align-middle text-caption font-medium text-brand-700">
                  Today
                </span>
              )}
            </h2>
            <p className="shrink-0 text-caption tabular-nums text-text-muted">
              {mobileSummary}
            </p>
          </div>

          <ul className="lg:hidden divide-y divide-border/60 overflow-hidden rounded-card border border-border bg-surface shadow-card">
            {mobileRows.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-text-muted">
                No hourly employees on this schedule.
              </li>
            )}
            {mobileRows.map(({ e, state, sorted, cellPeriodId, closedMs }) => {
              const first = sorted[0];
              const last = sorted[sorted.length - 1];
              const totalMin = Math.round(closedMs / 60000);
              const meta = MOBILE_STATUS[state];
              const range = first
                ? `${formatTimeShort(first.clockIn, company.timezone)} – ${
                    last && last.clockOut
                      ? formatTimeShort(last.clockOut, company.timezone)
                      : "open"
                  }`
                : state === "future"
                  ? "Not yet worked"
                  : state === "missed"
                    ? "No punches"
                    : "—";
              const hLabel =
                totalMin > 0 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : "";
              const inner = (
                <div className="flex min-h-[3.75rem] items-center gap-3 px-3.5 py-2.5">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-muted"
                  >
                    {timeInitials(e.displayName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {e.displayName}
                    </div>
                    <div className="truncate text-xs tabular-nums text-text-muted">
                      {range}
                      {hLabel ? ` · ${hLabel}` : ""}
                      {sorted.length > 1 ? ` · ${sorted.length} punches` : ""}
                    </div>
                  </div>
                  {state !== "future" && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </span>
                  )}
                  {cellPeriodId ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                  ) : null}
                </div>
              );
              return (
                <li key={e.id}>
                  {cellPeriodId ? (
                    <Link
                      href={`/time/${cellPeriodId}/${selectedDay}/${e.id}?${new URLSearchParams({ returnTo })}`}
                      className="block transition-colors active:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700/60"
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>

          {/* ── Desktop: full employee×day grid (data-grid surface) ──
              A bounded 2-axis scroll region so BOTH the employee column
              (sticky left) and the day header (sticky top) stay pinned while
              scrolling a wide/tall roster. The visible scrollbar is the
              horizontal-more cue. */}
          <div className="hidden lg:block max-h-[72vh] overflow-auto rounded-card border border-border/70 bg-surface shadow-card-strong">
        <table className="min-w-full text-body border-collapse">
          <thead>
            {/* Below md the shell's fixed top bar owns y=0, so a plain
                top-0 pinned this header underneath it and it vanished while
                scrolling on phones. */}
            <tr className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-border/80 bg-surface-2/95 backdrop-blur md:top-0">
              <th className="sticky left-0 z-30 bg-surface-2 text-left px-4 py-2.5 text-micro text-text-subtle uppercase whitespace-nowrap border-r border-border/50">
                Employee
              </th>
              {days.map((d) => {
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    className={`w-28 py-2.5 px-2 text-center whitespace-nowrap border-b border-border/40 ${isToday ? "bg-brand-50" : "bg-surface-2"}`}
                  >
                    <span className={`flex flex-col items-center leading-tight ${isToday ? "text-brand-700" : "text-text-subtle"}`}>
                      <span className="text-micro uppercase">
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T00:00:00Z`))}
                      </span>
                      <span className="tabular-nums text-[11px] font-semibold mt-0.5">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "numeric",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T00:00:00Z`))}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr
                key={e.id}
                className="border-t border-border/40 group hover:bg-surface-2/40 transition-colors"
              >
                <td className="sticky left-0 z-10 bg-surface group-hover:bg-surface-2/40 px-4 py-2 font-medium text-body whitespace-nowrap border-r border-border/40 transition-colors">
                  <Link
                    href={`/employees/${e.id}`}
                    className="text-text hover:text-brand-700 hover:underline underline-offset-2 transition-colors"
                  >
                    {e.displayName}
                  </Link>
                </td>
                {days.map((d) => {
                  const isToday = d === today;
                  const { state, sorted, closedMs, cellPeriodId } = cellFor(e, d);
                  const first = sorted[0];
                  const last = sorted[sorted.length - 1];
                  const hours = closedMs / (1000 * 60 * 60);

                  const cellContent = (
                    <PunchCell
                      state={state}
                      first={first}
                      last={last}
                      count={sorted.length}
                      hours={hours}
                      tz={company.timezone}
                    />
                  );

                  return (
                    <td
                      key={d}
                      className={`py-1.5 px-1.5 align-middle text-center ${isToday ? "bg-brand-50/25 group-hover:bg-brand-50/40" : ""}`}
                    >
                      {cellPeriodId ? (
                        <Link
                          href={`/time/${cellPeriodId}/${d}/${e.id}?${new URLSearchParams({ returnTo })}`}
                          className="block"
                          aria-label={cellAriaLabel(state, sorted, company.timezone)}
                        >
                          {cellContent}
                        </Link>
                      ) : (
                        <span aria-label={cellAriaLabel(state, sorted, company.timezone)}>
                          {cellContent}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </div>

        {/* Right rail — pending reviews, today's summary, exceptions, labor,
            insight (#57). Missed-punch review sits at the top: it's the only
            card that needs an admin decision, and it lives next to the time
            grid it corrects (moved here from the Calendar rail). */}
        {/* Below xl the rail dissolves into the page column (display:
            contents) so the pending-review card — the only one that needs a
            decision — can be ordered ABOVE the attendance list instead of
            sitting under 20+ employee rows. */}
        <aside className="contents xl:block xl:space-y-3">
          <div className="order-first empty:hidden xl:order-none">
            <MissedPunchRailCard timezone={company.timezone} />
          </div>
          <TodaySummaryCard summary={kpis.todaySummary} total={kpis.summaryTotal} />
          <ExceptionsQueueCard
            missing={kpis.staleOpenPunchCount}
            unpaired={kpis.unpairedCount}
            openShifts={kpis.openNow}
          />
          <LaborHoursCard
            regularMin={kpis.regularMin}
            overtimeMin={kpis.overtimeMin}
            totalMin={kpis.totalMinutes}
            spark={kpis.hoursByDay}
          />
          <MiloInsightCard overtimeRisk={kpis.overtimeRisk} />
        </aside>
      </div>
    </div>
  );
}
