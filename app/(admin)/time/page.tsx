// /time: the attendance grid. This file only fetches, shapes and lays out:
//   rules and maths  -> lib/time-grid/*  (unit-tested)
//   period queries   -> lib/db/queries/time-grid.ts
//   markup           -> components/time/*
// The rendered DOM is pinned by tests/golden (npm run golden:check).
import Link from "next/link";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listApprovedInRange } from "@/lib/db/queries/time-off";
import { getSetting } from "@/lib/settings/runtime";
import { resolveTimeCellPeriodId } from "@/lib/time/grid-links";
import { localMidnightUtc, addDaysIso } from "@/lib/utils";
import { BackfillAlert } from "@/components/admin/backfill-alert";
import { MissedPunchRailCard } from "@/components/domain/missed-punch-rail-card";
import { todayInCompanyTz, eachDayIso } from "@/lib/time/format";
import { gridLastDay, type PeriodView } from "@/lib/time-grid/period-select";
import {
  cellKey,
  cellStateFor,
  summarizeCell,
  type GridCell,
  type GridRow,
} from "@/lib/time-grid/cell-state";
import { buildTimeOffByDay, groupPunchesByCell } from "@/lib/time-grid/grid-data";
import { computeGridKpis, mobileSummaryLine } from "@/lib/time-grid/kpis";
import { ExceptionsQueueCard } from "@/components/time/exceptions-queue-card";
import { MiloInsightCard } from "@/components/time/insight-card";
import { AttendanceList } from "@/components/time/attendance-list";
import { DayStrip } from "@/components/time/day-strip";
import { DesktopGrid } from "@/components/time/desktop-grid";
import { KpiCards } from "@/components/time/kpi-cards";
import { TimeNoPeriodEmpty, TimeSalariedEmpty } from "@/components/time/empty-states";
import { PeriodPager } from "@/components/time/period-pager";
import { PeriodStateBadge } from "@/components/time/period-state-badge";
import { TimeActions } from "@/components/time/time-actions";
import { LaborHoursCard } from "@/components/time/labor-hours-card";
import { TodaySummaryCard } from "@/components/time/today-summary-card";
import {
  findAdjacentPeriods,
  loadPeriodForTab,
  pickPeriodForTab,
} from "@/lib/db/queries/time-grid";

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
    return <TimeSalariedEmpty tab={tab} />;
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

  if (!period) return <TimeNoPeriodEmpty tab={tab} />;

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
  const timeOffByDay = buildTimeOffByDay(approvedTimeOff);
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

  const grid = groupPunchesByCell(
    punchesInRange,
    employees.map((e) => e.id),
    company.timezone,
  );

  // Mobile day selector — show one day at a time as a vertical list. Default
  // to today when it's in the window, else the last day. URL-driven (?day=).
  const selectedDay =
    sp.day && days.includes(sp.day)
      ? sp.day
      : days.includes(today)
        ? today
        : (days[days.length - 1] ?? today);

  // One cell = one employee on one day. The desktop grid, the phone list, the
  // day strip's dots and the KPI figures all read from here. Computed on
  // demand and cached: "today" is asked for even when the grid is showing a
  // past period that does not contain it.
  const cells = new Map<string, GridCell>();
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const cellOf = (employeeId: string, d: string): GridCell => {
    const key = cellKey(employeeId, d);
    const hit = cells.get(key);
    if (hit) return hit;
    const list = grid.get(employeeId)?.get(d) ?? [];
    const { sorted, closedMs } = summarizeCell(list);
    const cell: GridCell = {
      state: cellStateFor({
        punches: list,
        offType: timeOffByDay.get(`${employeeId}|${d}`),
        dayIso: d,
        today,
        employeeActive: employeeById.get(employeeId)?.status === "ACTIVE",
      }),
      sorted,
      closedMs,
      cellPeriodId: resolveTimeCellPeriodId({
        currentPeriodId: period.id,
        punches: sorted,
      }),
    };
    cells.set(key, cell);
    return cell;
  };
  for (const e of employees) for (const d of days) cellOf(e.id, d);
  const kpis = computeGridKpis({
    punches: punchesInRange,
    employees,
    days,
    today,
    tz: company.timezone,
    cellState: (employeeId, d) => cellOf(employeeId, d).state,
  });
  const mobileRows: GridRow[] = employees.map((e) => ({
    e,
    ...cellOf(e.id, selectedDay),
  }));
  const mobileSummary = mobileSummaryLine(mobileRows.map((r) => r.state));

  // Punch sync controls moved here from /payroll (owner: "there is no
  // reason for poll now to be on the payroll page — it belongs on Time").
  const lastPoll = await getLastPoll();

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
            <PeriodStateBadge state={period.state} />
          </div>
          <PeriodPager period={period} lastDay={lastDay} adjacent={adjacent} tab={tab} />
          {period.state === "UPCOMING" && (
            <p className="text-caption font-medium text-brand-700 lg:hidden">
              Live period · punches will land here
            </p>
          )}
          <ScheduleTabs current={tab} basePath="/time" />
        </div>

        <TimeActions lastPoll={lastPoll} />
      </div>

      <KpiCards kpis={kpis} dayCount={days.length} />

      {kpis.staleOpenPunchCount > 0 && (
        <BackfillAlert openCountFromPriorDays={kpis.staleOpenPunchCount} />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <DayStrip
            days={days}
            selectedDay={selectedDay}
            today={today}
            issuesByDay={kpis.issuesByDay}
            summary={mobileSummary}
            tab={tab}
            periodId={period.id}
          />
          <AttendanceList
            rows={mobileRows}
            selectedDay={selectedDay}
            tz={company.timezone}
            returnTo={returnTo}
          />

          <DesktopGrid
            employees={employees}
            days={days}
            today={today}
            cells={cells}
            tz={company.timezone}
            returnTo={returnTo}
          />
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
