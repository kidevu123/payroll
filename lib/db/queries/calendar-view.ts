// Everything the admin calendar shows for one month and tab: the day grid with
// time off and birthdays, the pending queue, the month overview figures and
// the year-to-date totals. Moved verbatim out of app/(admin)/calendar/page.tsx.
import {
  listApprovedInRange,
  listPendingInRange,
  tallyTimeOffByEmployeeForYear,
} from "@/lib/db/queries/time-off";
import { listPendingTimeOffRequests } from "@/lib/db/queries/requests";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { isAdminManageableTimeOff } from "@/lib/time-off/change-request";
import {
  MS_PER_DAY,
  eachDayBetween,
  endOfMonth,
  isoDay,
  nameFromMap,
  startOfMonth,
} from "@/lib/time/calendar-grid";

export async function loadCalendarView(params: { year?: string; month?: string; tab?: string }) {
  const company = await getSetting("company");
  const tab =
    params.tab === "totals"
      ? "totals"
      : params.tab === "agenda"
        ? "agenda"
        : "calendar";
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

  return {
    tab,
    today,
    year,
    startIso,
    endIso,
    approved,
    pending,
    employees,
    pendingTimeOff,
    empMap,
    empById,
    todayIso,
    cellByDay,
    partialLabel,
    days,
    monthName,
    prev,
    next,
    pendingTotal,
    approvedCount,
    peopleOffSet,
    coveragePct,
    totals,
  };
}

/** The loaded calendar month, as the page's sections receive it. */
export type CalendarView = Awaited<ReturnType<typeof loadCalendarView>>;
