// The /time page's figures: KPI row, today's summary donut, exceptions queue,
// labor-hours rail card and the day strip's issue dots. Same arithmetic and
// thresholds the page computed inline; moved here so they can be tested.

import { companyDayIso } from "@/lib/time/company-day";
import { isAmbiguousSinglePunch, isMissingClockInPunch } from "@/lib/punches/missing-punch";
import type { CellState, PunchLite } from "./cell-state";

const OT_MIN = 40 * 60;

export function fmtHm(mins: number): string {
  return `${Math.floor(mins / 60).toLocaleString()}h ${Math.round(mins % 60)}m`;
}

export type GridKpis = {
  totalMinutes: number; regularMin: number; overtimeMin: number; overtimeRisk: number;
  teamSize: number; clockedInToday: number; teamPct: number; openNow: number;
  unpairedCount: number; staleOpenPunchCount: number;
  todaySummary: { present: number; incomplete: number; missing: number; timeOff: number; unpaid: number };
  summaryTotal: number; hoursByDay: number[]; issuesByDay: Map<string, number>;
};

export function computeGridKpis(args: {
  punches: (PunchLite & { employeeId: string })[];
  employees: { id: string; status: string }[];
  days: string[];
  today: string;
  tz: string;
  cellState: (employeeId: string, dayIso: string) => CellState;
}): GridKpis {
  const { punches, employees, days, today, tz, cellState } = args;
  const dayOf = (d: Date) => companyDayIso(d, tz);
  let totalMinutes = 0;
  const minutesByEmp = new Map<string, number>();
  for (const p of punches) {
    if (!p.clockOut) continue;
    const mins = (p.clockOut.getTime() - p.clockIn.getTime()) / 60000;
    if (mins <= 0) continue;
    totalMinutes += mins;
    minutesByEmp.set(p.employeeId, (minutesByEmp.get(p.employeeId) ?? 0) + mins);
  }
  const active = employees.filter((e) => e.status === "ACTIVE");
  const teamSize = active.length;
  const clockedInToday = new Set(punches.filter((p) => dayOf(p.clockIn) === today).map((p) => p.employeeId)).size;
  const teamPct = teamSize ? Math.round((clockedInToday / teamSize) * 100) : 0;
  const openNow = punches.filter((p) => p.clockOut === null && dayOf(p.clockIn) === today).length;
  let regularMin = 0, overtimeMin = 0;
  for (const m of minutesByEmp.values()) {
    if (m > OT_MIN) { regularMin += OT_MIN; overtimeMin += m - OT_MIN; } else regularMin += m;
  }
  const overtimeRisk = [...minutesByEmp.values()].filter((m) => m >= OT_MIN * 0.875).length;
  const unpairedCount = punches.filter((p) => isAmbiguousSinglePunch(p) || isMissingClockInPunch(p)).length;
  const staleOpenPunchCount = punches.reduce((n, p) => (p.clockOut === null && dayOf(p.clockIn) < today ? n + 1 : n), 0);
  const todaySummary = { present: 0, incomplete: 0, missing: 0, timeOff: 0, unpaid: 0 };
  for (const e of active) {
    const s = cellState(e.id, today);
    if (s === "complete") todaySummary.present++;
    else if (s === "incomplete") todaySummary.incomplete++;
    else if (s === "missed") todaySummary.missing++;
    else if (s === "unpaid") todaySummary.unpaid++;
    else if (s === "pto" || s === "sick" || s === "other") todaySummary.timeOff++;
  }
  const summaryTotal = todaySummary.present + todaySummary.incomplete + todaySummary.missing + todaySummary.timeOff + todaySummary.unpaid;
  const hoursByDay = days.map((d) => {
    let mins = 0;
    for (const p of punches) { if (p.clockOut && dayOf(p.clockIn) === d) mins += (p.clockOut.getTime() - p.clockIn.getTime()) / 60000; }
    return Math.round((mins / 60) * 10) / 10;
  });
  const issuesByDay = new Map(days.map((d) => [d, d === today ? 0 : employees.reduce((n, e) => n + (cellState(e.id, d) === "incomplete" ? 1 : 0), 0)]));
  return { totalMinutes, regularMin, overtimeMin, overtimeRisk, teamSize, clockedInToday, teamPct, openNow, unpairedCount, staleOpenPunchCount, todaySummary, summaryTotal, hoursByDay, issuesByDay };
}

export function mobileSummaryLine(states: CellState[]): string {
  const count = (st: CellState[]) => states.filter((s) => st.includes(s)).length;
  const parts = [[count(["complete"]), "complete"], [count(["incomplete"]), "unpaired"], [count(["missed"]), "missing"], [count(["pto", "sick", "unpaid", "other"]), "off"]] as const;
  return parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ");
}
