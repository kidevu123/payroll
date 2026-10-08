// The pay-period detail page's rules, as pure functions over rows the page has
// already loaded: who belongs on the period, their punches, whether the table
// shows live computed pay or the stored payslips, and who has signed off.
// Moved verbatim out of app/(admin)/payroll/[periodId]/page.tsx so they can be
// tested; the page keeps the database reads.
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";

/**
 * Who appears on a period, with the precedence the publish handler uses:
 *   cohort     -> exactly the run's locked cohort, no further filter
 *   schedule   -> employees whose pay schedule is exactly this one
 *   neither    -> everyone (periods that pre-date schedule tagging)
 * Salaried staff are always excluded: they are not paid from punches and
 * surface in the W2 section instead.
 *
 * Note: the schedule branch is an EXACT match, so an employee with no
 * schedule is not shown on a scheduled period. (A comment that lived beside
 * this code said unassigned employees were wildcards; the code has not done
 * that. Behaviour preserved; changing it is a product decision.)
 */
export function filterPeriodEmployees<
  E extends { id: string; payScheduleId: string | null; payType: string },
>(all: E[], opts: { cohort: string[] | null; scheduleId: string | null }): E[] {
  const cohortSet = opts.cohort ? new Set(opts.cohort) : null;
  return (
    cohortSet
      ? all.filter((e) => cohortSet.has(e.id))
      : opts.scheduleId
        ? all.filter((e) => e.payScheduleId === opts.scheduleId)
        : all
  ).filter((e) => e.payType !== "SALARIED");
}

/**
 * employeeId -> that employee's punches, with near-duplicates collapsed (the
 * poll and a CSV import can both record one physical shift). When
 * `restrictToEmployees` is set, punches of anyone outside `employeeIds` are
 * dropped.
 */
export function groupPeriodPunches<
  P extends { id: string; employeeId: string; clockIn: Date | string; clockOut: Date | string | null },
>(punches: P[], employeeIds: string[], restrictToEmployees: boolean): Map<string, P[]> {
  const allowed = new Set(employeeIds);
  const byEmployee = new Map<string, P[]>();
  for (const p of punches) {
    if (restrictToEmployees && !allowed.has(p.employeeId)) continue;
    const list = byEmployee.get(p.employeeId) ?? [];
    list.push(p);
    byEmployee.set(p.employeeId, list);
  }
  for (const [empId, list] of byEmployee) {
    byEmployee.set(empId, dedupNearDuplicatePunches(list));
  }
  return byEmployee;
}

/** Hours, gross and rounded pay across the live computed rows. */
export function sumLiveTotals(
  rendered: { result: { totalHours: number; grossCents: number; roundedCents: number } }[],
): { hours: number; gross: number; rounded: number } {
  return rendered.reduce(
    (acc, r) => {
      acc.hours += r.result.totalHours;
      acc.gross += r.result.grossCents;
      acc.rounded += r.result.roundedCents;
      return acc;
    },
    { hours: 0, gross: 0, rounded: 0 },
  );
}

/** Rounded pay and hours across the non-voided stored payslips. */
export function sumStoredPayslips(
  payslips: { voidedAt: Date | null; roundedPayCents: number; hoursWorked: string | number | null }[],
): { sum: number; hours: number } {
  const live = payslips.filter((p) => !p.voidedAt);
  return {
    sum: live.reduce((s, p) => s + p.roundedPayCents, 0),
    hours: live.reduce((s, p) => s + Number(p.hoursWorked ?? 0), 0),
  };
}

/** A table row, optionally stamped with the stored-vs-live hours comparison. */
export type DisplayRow<R> = R & {
  storedHours?: number;
  liveHours?: number;
  hoursDrift?: boolean;
};

/**
 * The employee table's rows. Live (`useStored` false): the computed rows as
 * they are. Stored: one row per non-voided payslip, so a legacy period with
 * sparse punch data still lists everyone who was paid; an employee with a
 * payslip but no computed row gets a synthetic one. Hours, gross and rounded
 * come from the payslip; the regular/overtime/day breakdown stays live.
 *
 * `hoursDrift` is set when stored and live hours disagree by MORE than half
 * an hour, so the table can warn and offer a recompute.
 */
export function buildDisplayRows<
  E extends { id: string; displayName: string },
  Res extends { totalHours: number; grossCents: number; roundedCents: number },
  P,
>(args: {
  rendered: { employee: E; result: Res; incomplete: number; punches: P[] }[];
  payslips: {
    employeeId: string;
    voidedAt: Date | null;
    hoursWorked: string | number | null;
    grossPayCents: number;
    roundedPayCents: number;
  }[];
  allEmployees: E[];
  useStored: boolean;
}): DisplayRow<{ employee: E; result: Res; incomplete: number; punches: P[] }>[] {
  const { rendered, payslips, allEmployees, useStored } = args;
  if (!useStored) return rendered;
  const renderedById = new Map(rendered.map((r) => [r.employee.id, r]));
  const displayRows: DisplayRow<{ employee: E; result: Res; incomplete: number; punches: P[] }>[] = [];
  for (const py of payslips) {
    if (py.voidedAt) continue;
    const emp = allEmployees.find((e) => e.id === py.employeeId);
    if (!emp) continue;
    const existing = renderedById.get(emp.id);
    const storedHours = Number(py.hoursWorked ?? 0);
    const liveHours = existing?.result.totalHours ?? 0;
    const drift = Math.abs(storedHours - liveHours) > 0.5;
    const result = {
      ...(existing?.result ?? {
        regularCents: 0,
        overtimeCents: 0,
        taskCents: 0,
        byDay: [],
      }),
      totalHours: storedHours,
      grossCents: py.grossPayCents,
      roundedCents: py.roundedPayCents,
    } as Res;
    displayRows.push({
      employee: emp,
      result,
      incomplete: existing?.incomplete ?? 0,
      punches: existing?.punches ?? [],
      storedHours,
      liveHours,
      hoursDrift: drift,
    });
  }
  displayRows.sort((a, b) => a.employee.displayName.localeCompare(b.employee.displayName));
  return displayRows;
}

/**
 * Payslip sign-off, bucketed. Only payslips that pay something count: a
 * zero-pay row (did not work this period) is bookkeeping, never something to
 * sign. Signed = drew a signature on the tablet. Acknowledged = tapped OK on
 * the phone but has not signed. A payslip with an open dispute is only in
 * Disputed. A payslip whose dispute was resolved is in none of the four.
 */
export function signOffGroups<
  S extends {
    voidedAt: Date | null;
    signedAt: Date | null;
    acknowledgedAt: Date | null;
    disputedAt: Date | null;
    disputeResolvedAt: Date | null;
  },
>(payslips: S[], hasPay: (p: S) => boolean): { active: S[]; signed: S[]; ackd: S[]; disputed: S[]; pending: S[] } {
  const active = payslips.filter((p) => !p.voidedAt && hasPay(p));
  return {
    active,
    signed: active.filter((p) => p.signedAt && !p.disputedAt),
    ackd: active.filter((p) => p.acknowledgedAt && !p.signedAt && !p.disputedAt),
    disputed: active.filter((p) => p.disputedAt && !p.disputeResolvedAt),
    pending: active.filter((p) => !p.acknowledgedAt && !p.disputedAt),
  };
}
