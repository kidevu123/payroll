# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run-centric dashboard with a layout that is useful every day of the week — stat strip, today's attendance panel, and the payroll run card showing live period stats even before a run is started.

**Architecture:** Add two new helper queries (`listTodayPunches`, `listApprovedTimeOffForDate`), one pure utility (`localMidnightUtc`), two new display components (`StatStrip`, `AttendancePanel`), and rewire `dashboard/page.tsx` to compute per-schedule gross and feed all new components. No schema changes.

**Tech Stack:** Next.js 15 App Router (RSC), Drizzle ORM, Tailwind v4, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `lib/utils.ts` | Add `localMidnightUtc(dateIso, tz): Date` |
| Modify | `lib/utils.test.ts` | Tests for `localMidnightUtc` |
| Modify | `lib/db/queries/punches.ts` | Add `listTodayPunches(todayIso, tz)` |
| Modify | `lib/db/queries/time-off.ts` | Add `listApprovedTimeOffForDate(dateIso)` |
| Create | `components/domain/stat-strip.tsx` | `StatStrip` server component (6 tiles) |
| Create | `components/domain/attendance-panel.tsx` | `AttendancePanel` display component (3 groups) |
| Modify | `app/(admin)/dashboard/page.tsx` | Wire everything up, ungated computePay, per-schedule gross |

---

## Task 1: `localMidnightUtc` helper + test

**Files:**
- Modify: `lib/utils.ts`
- Modify: `lib/utils.test.ts`

- [ ] **Step 1: Add `localMidnightUtc` to `lib/utils.ts`**

Append after the existing `formatTimeShort` function:

```ts
/**
 * Returns the UTC Date corresponding to midnight (00:00:00) of `dateIso`
 * in `tz`. Uses noon-UTC as a DST-safe probe — DST transitions happen
 * at 2am local, so noon is always unambiguous.
 *
 * Example: localMidnightUtc("2026-05-22", "America/New_York")
 *          → 2026-05-22T04:00:00.000Z  (EDT = UTC-4)
 */
export function localMidnightUtc(dateIso: string, tz: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const noonUtcMs = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtcMs));
  const localH = Number(parts.find((p) => p.type === "hour")!.value);
  const localMin = Number(parts.find((p) => p.type === "minute")!.value);
  // UTC offset in ms = (12:00 UTC - local noon). For UTC-4: +4h. For UTC+5: -5h.
  const offsetMs = (12 * 60 - (localH * 60 + localMin)) * 60 * 1000;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMs);
}
```

- [ ] **Step 2: Write the failing tests in `lib/utils.test.ts`**

Add this `describe` block at the end of the existing test file:

```ts
import { describe, it, expect } from "vitest";
import { localMidnightUtc } from "./utils";

describe("localMidnightUtc", () => {
  it("returns 04:00 UTC for America/New_York in summer (EDT = UTC-4)", () => {
    const result = localMidnightUtc("2026-05-22", "America/New_York");
    expect(result.toISOString()).toBe("2026-05-22T04:00:00.000Z");
  });

  it("returns 05:00 UTC for America/New_York in winter (EST = UTC-5)", () => {
    const result = localMidnightUtc("2026-01-15", "America/New_York");
    expect(result.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("returns 00:00 UTC for UTC timezone", () => {
    const result = localMidnightUtc("2026-05-22", "UTC");
    expect(result.toISOString()).toBe("2026-05-22T00:00:00.000Z");
  });

  it("returns previous-day 06:00 UTC for America/Chicago in summer (CDT = UTC-5)", () => {
    const result = localMidnightUtc("2026-05-22", "America/Chicago");
    expect(result.toISOString()).toBe("2026-05-22T05:00:00.000Z");
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/kidevu/payroll-git && npm test -- --reporter=verbose lib/utils.test.ts
```

Expected: all `localMidnightUtc` tests pass. The rest of `utils.test.ts` should also stay green.

- [ ] **Step 4: Commit**

```bash
git add lib/utils.ts lib/utils.test.ts
git commit -m "feat: add localMidnightUtc timezone helper"
```

---

## Task 2: `listTodayPunches` query

**Files:**
- Modify: `lib/db/queries/punches.ts`

- [ ] **Step 1: Add import and function**

At the top of `lib/db/queries/punches.ts`, the `localMidnightUtc` import does NOT need to be added at the top level — call it from within. Append this function after `listPunches`:

```ts
/**
 * All non-voided punches whose clockIn is on or after midnight of `todayIso`
 * in the given IANA timezone. Returns only the fields the dashboard needs.
 */
export async function listTodayPunches(
  todayIso: string,
  tz: string,
): Promise<{ employeeId: string; clockIn: Date }[]> {
  const { localMidnightUtc } = await import("@/lib/utils");
  const since = localMidnightUtc(todayIso, tz);
  const rows = await listPunches({ clockAfter: since });
  return rows.map((p) => ({ employeeId: p.employeeId, clockIn: p.clockIn }));
}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
cd /Users/kidevu/payroll-git && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/db/queries/punches.ts
git commit -m "feat: add listTodayPunches query"
```

---

## Task 3: `listApprovedTimeOffForDate` query

**Files:**
- Modify: `lib/db/queries/time-off.ts`

- [ ] **Step 1: Add the function**

Append after `listApprovedInRange` in `lib/db/queries/time-off.ts`:

```ts
/**
 * All APPROVED time-off rows that cover `dateIso` (i.e. startDate ≤ date ≤ endDate).
 * Used by the dashboard attendance panel.
 */
export function listApprovedTimeOffForDate(
  dateIso: string,
): Promise<TimeOffRequest[]> {
  return listApprovedInRange(dateIso, dateIso);
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/kidevu/payroll-git && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/db/queries/time-off.ts
git commit -m "feat: add listApprovedTimeOffForDate query"
```

---

## Task 4: `StatStrip` component

**Files:**
- Create: `components/domain/stat-strip.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

export type StatStripProps = {
  inToday: number;
  totalActive: number;
  periodHours: number;
  weeklyGrossCents: number | null;
  semiMonthlyGrossCents: number | null;
  exceptions: number;
  /** Timestamp of the last successful NGTeco poll. Null if never polled. */
  lastPollAt: Date | null;
};

type SyncStatus = { label: string; sub: string; tone: "green" | "amber" | "red" };

function syncStatus(lastPollAt: Date | null): SyncStatus {
  if (!lastPollAt) return { label: "No poll", sub: "Never run", tone: "red" };
  const mins = Math.floor((Date.now() - lastPollAt.getTime()) / 60_000);
  if (mins < 30) return { label: "Live", sub: `${mins}m ago`, tone: "green" };
  if (mins < 60) return { label: `${mins}m ago`, sub: "Check NGTeco", tone: "amber" };
  return { label: "Stale", sub: `${Math.floor(mins / 60)}h ago`, tone: "red" };
}

const TONE_CLASSES: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "bg-success-50 border-success-200",
  amber: "bg-warn-50 border-warn-200",
  red: "bg-danger-50 border-danger-200",
  neutral: "bg-surface border-border",
};
const TONE_LABEL: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "text-success-800",
  amber: "text-warn-800",
  red: "text-danger-800",
  neutral: "text-text",
};
const TONE_SUB: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "text-success-600",
  amber: "text-warn-600",
  red: "text-danger-600",
  neutral: "text-text-muted",
};

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: "green" | "amber" | "red" | "neutral";
}) {
  return (
    <div
      className={`rounded-card border px-3 py-3 ${TONE_CLASSES[tone]}`}
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-text-subtle mb-1">
        {label}
      </div>
      <div
        className={`font-mono text-xl font-semibold tabular-nums leading-tight ${TONE_LABEL[tone]}`}
      >
        {value}
      </div>
      <div className={`text-[10px] mt-0.5 ${TONE_SUB[tone]}`}>{sub}</div>
    </div>
  );
}

export function StatStrip({
  inToday,
  totalActive,
  periodHours,
  weeklyGrossCents,
  semiMonthlyGrossCents,
  exceptions,
  lastPollAt,
}: StatStripProps) {
  const sync = syncStatus(lastPollAt);
  const absent = totalActive - inToday;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label="In today"
        value={
          <>
            {inToday}
            <span className="text-sm font-normal text-text-muted">
              {" "}
              / {totalActive}
            </span>
          </>
        }
        sub={absent === 0 ? "everyone in" : `${absent} not yet in`}
      />
      <StatTile
        label="Hours this period"
        value={<HoursDisplay hours={periodHours} decimals={1} />}
        sub="accrued so far"
      />
      {weeklyGrossCents !== null && (
        <StatTile
          label="Weekly gross"
          value={<MoneyDisplay cents={weeklyGrossCents} monospace />}
          sub="est."
        />
      )}
      {semiMonthlyGrossCents !== null && (
        <StatTile
          label="Semi-mo. gross"
          value={<MoneyDisplay cents={semiMonthlyGrossCents} monospace />}
          sub="est."
        />
      )}
      <StatTile
        label="Exceptions"
        value={String(exceptions)}
        sub={exceptions === 0 ? "all clear" : "unresolved"}
        tone={exceptions > 0 ? "amber" : "green"}
      />
      <StatTile
        label="NGTeco sync"
        value={sync.label}
        sub={sync.sub}
        tone={sync.tone}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/kidevu/payroll-git && npm test
```

Expected: all tests pass (this file has no tests; check no type errors with `npm run build 2>&1 | head -30`).

- [ ] **Step 3: Commit**

```bash
git add components/domain/stat-strip.tsx
git commit -m "feat: add StatStrip dashboard component"
```

---

## Task 5: `AttendancePanel` component

**Files:**
- Create: `components/domain/attendance-panel.tsx`

- [ ] **Step 1: Create the file**

```tsx
const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

export type AttendancePanelProps = {
  punched: { id: string; name: string; firstPunchAt: string }[];
  approvedOut: { id: string; name: string; type: string }[];
  noPunch: { id: string; name: string }[];
  todayLabel: string; // e.g. "May 22"
};

const MAX_VISIBLE = 4;

function SectionHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "red" | "purple" | "green";
}) {
  const dotCls =
    tone === "red"
      ? "bg-danger-500"
      : tone === "purple"
        ? "bg-violet-500"
        : "bg-success-500";
  const labelCls =
    tone === "red"
      ? "text-danger-700"
      : tone === "purple"
        ? "text-violet-700"
        : "text-success-700";
  const badgeCls =
    tone === "red"
      ? "bg-danger-100 text-danger-800"
      : tone === "purple"
        ? "bg-violet-100 text-violet-800"
        : "bg-success-100 text-success-800";

  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotCls}`} />
        <span
          className={`text-[9px] font-bold uppercase tracking-wider ${labelCls}`}
        >
          {label}
        </span>
      </div>
      <span
        className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${badgeCls}`}
      >
        {count}
      </span>
    </div>
  );
}

export function AttendancePanel({
  punched,
  approvedOut,
  noPunch,
  todayLabel,
}: AttendancePanelProps) {
  const hasAny = punched.length + approvedOut.length + noPunch.length > 0;

  return (
    <div className="rounded-card border border-border bg-surface p-4 space-y-4 lg:sticky lg:top-4 lg:self-start">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Today · {todayLabel}
      </div>

      {noPunch.length > 0 && (
        <section>
          <SectionHeader
            label="Expected · not punched in"
            count={noPunch.length}
            tone="red"
          />
          <ul className="rounded-card border border-danger-300 bg-danger-50 px-3 py-2 space-y-1.5">
            {noPunch.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-danger-800 truncate">
                  {e.name}
                </span>
                <span className="text-danger-600 shrink-0 ml-2">No punch</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {approvedOut.length > 0 && (
        <section>
          <SectionHeader
            label="Out · approved"
            count={approvedOut.length}
            tone="purple"
          />
          <ul className="rounded-card border border-violet-300 bg-violet-50 px-3 py-2 space-y-1.5">
            {approvedOut.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium text-violet-900 truncate">
                  {e.name}
                </span>
                <span className="text-violet-600 shrink-0 ml-2">
                  {TYPE_LABEL[e.type] ?? e.type}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {punched.length > 0 && (
        <section>
          <SectionHeader
            label="Clocked in"
            count={punched.length}
            tone="green"
          />
          <ul className="rounded-card border border-success-300 bg-success-50 px-3 py-2 space-y-1.5">
            {punched.slice(0, MAX_VISIBLE).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium text-success-900 truncate">
                  {e.name}
                </span>
                <span className="font-mono text-success-700 shrink-0 ml-2">
                  {e.firstPunchAt}
                </span>
              </li>
            ))}
            {punched.length > MAX_VISIBLE && (
              <li className="text-center text-[10px] text-success-600 pt-0.5 border-t border-success-200">
                + {punched.length - MAX_VISIBLE} more
              </li>
            )}
          </ul>
        </section>
      )}

      {!hasAny && (
        <p className="text-xs text-text-muted text-center py-4">
          No attendance data yet today.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/kidevu/payroll-git && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add components/domain/attendance-panel.tsx
git commit -m "feat: add AttendancePanel dashboard component"
```

---

## Task 6: Rewire `dashboard/page.tsx`

**Files:**
- Modify: `app/(admin)/dashboard/page.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
// Admin dashboard — live ops view. Four zones:
// 1. Stat strip (always) — in today, period hours, per-schedule gross, exceptions, NGTeco sync
// 2. Main row — PayrollRunCard (hero) + AttendancePanel (3-group)
// 3. Bottom row — pending requests + recent runs

import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, MessageSquareWarning } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import { StatusPill } from "@/components/domain/status-pill";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { PayrollRunCard } from "@/components/domain/payroll-run-card";
import { StatStrip } from "@/components/domain/stat-strip";
import { AttendancePanel } from "@/components/domain/attendance-panel";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches, listTodayPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import {
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import { getCurrentRun, listRuns } from "@/lib/db/queries/payroll-runs";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { listApprovedTimeOffForDate } from "@/lib/db/queries/time-off";
import { getLastSuccessfulPoll } from "@/lib/db/queries/poll-history";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { formatTimeShort } from "@/lib/utils";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function todayInTz(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** "May 22" style label for the attendance panel header. */
function shortDateLabel(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, m - 1, d)));
}

export default async function DashboardPage() {
  const company = await getSetting("company");
  const today = todayInTz(company.timezone);

  const period =
    (await getCurrentPeriod(today)) ?? (await getMostRecentPeriod());
  const run = await getCurrentRun();

  const [
    employees,
    pendingMissed,
    pendingTimeOff,
    todayPunches,
    approvedOffToday,
    lastPoll,
  ] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
    listTodayPunches(today, company.timezone),
    listApprovedTimeOffForDate(today),
    getLastSuccessfulPoll(),
  ]);

  const pendingTotal = pendingMissed.length + pendingTimeOff.length;

  // ── Period stats ─────────────────────────────────────────────────────────
  // Computed whenever a period exists, regardless of run state. This ensures
  // the PayrollRunCard and StatStrip always show live data (not an empty void).
  let stats:
    | {
        hours: number;
        gross: number;
        rounded: number;
        employeeCount: number;
        unresolvedAlerts: number;
      }
    | undefined;
  let weeklyGrossCents: number | null = null;
  let semiMonthlyGrossCents: number | null = null;

  if (period) {
    const [periodPunches, payRules, alerts, schedules] = await Promise.all([
      listPunches({ periodId: period.id }),
      getSetting("payRules"),
      listAlertsForPeriod(period.id, { unresolvedOnly: true }),
      listSchedules(),
    ]);
    const tasks = await db
      .select()
      .from(taskPayLineItems)
      .where(eq(taskPayLineItems.periodId, period.id));
    const { tempWorkerEntries } = await import("@/lib/db/schema");
    const tempWorkers = await db
      .select()
      .from(tempWorkerEntries)
      .where(eq(tempWorkerEntries.periodId, period.id));

    const punchesByE = new Map<string, typeof periodPunches>();
    for (const p of periodPunches) {
      const list = punchesByE.get(p.employeeId) ?? [];
      list.push(p);
      punchesByE.set(p.employeeId, list);
    }
    const tasksByE = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = tasksByE.get(t.employeeId) ?? [];
      list.push(t);
      tasksByE.set(t.employeeId, list);
    }

    const weeklyIds = new Set(
      schedules.filter((s) => s.periodKind === "WEEKLY").map((s) => s.id),
    );
    const semiMonthlyIds = new Set(
      schedules.filter((s) => s.periodKind === "SEMI_MONTHLY").map((s) => s.id),
    );

    let totals = { hours: 0, gross: 0, rounded: 0 };
    let weeklyGross = 0;
    let semiMonthlyGross = 0;
    let activeWithWork = 0;

    for (const e of employees) {
      const ePunches = punchesByE.get(e.id) ?? [];
      const eTasks = tasksByE.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) continue;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = (
            p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn)
          )
            .toISOString()
            .slice(0, 10);
          for (const r of rates)
            if (r.effectiveFrom <= day) return r.hourlyRateCents;
          return e.hourlyRateCents ?? 0;
        },
        taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
        rules: {
          rounding: payRules.rounding,
          hoursDecimalPlaces: payRules.hoursDecimalPlaces,
          ...(payRules.overtime.enabled
            ? {
                overtime: {
                  thresholdHours: payRules.overtime.thresholdHours,
                  multiplier: payRules.overtime.multiplier,
                },
              }
            : {}),
        },
      });
      totals.hours += result.totalHours;
      totals.gross += result.grossCents;
      totals.rounded += result.roundedCents;
      activeWithWork++;
      if (e.payScheduleId && weeklyIds.has(e.payScheduleId)) {
        weeklyGross += result.grossCents;
      } else if (e.payScheduleId && semiMonthlyIds.has(e.payScheduleId)) {
        semiMonthlyGross += result.grossCents;
      }
    }

    for (const tw of tempWorkers) {
      totals.gross += tw.amountCents;
      totals.rounded += tw.amountCents;
      if (tw.hours !== null) totals.hours += Number(tw.hours);
      activeWithWork += 1;
    }

    stats = {
      ...totals,
      employeeCount: activeWithWork,
      unresolvedAlerts: alerts.length,
    };
    weeklyGrossCents = weeklyGross > 0 ? weeklyGross : null;
    semiMonthlyGrossCents = semiMonthlyGross > 0 ? semiMonthlyGross : null;
  }

  // ── Attendance panel buckets ──────────────────────────────────────────────
  const punchedEmpIds = new Set(todayPunches.map((p) => p.employeeId));
  const firstPunchByEmp = new Map<string, Date>();
  for (const p of todayPunches) {
    const existing = firstPunchByEmp.get(p.employeeId);
    if (!existing || p.clockIn < existing) {
      firstPunchByEmp.set(p.employeeId, p.clockIn);
    }
  }
  const approvedOffEmpIds = new Set(approvedOffToday.map((r) => r.employeeId));

  const punchedList = employees
    .filter((e) => punchedEmpIds.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.displayName,
      firstPunchAt: formatTimeShort(
        firstPunchByEmp.get(e.id)!,
        company.timezone,
      ),
    }));

  const approvedOutList = employees
    .filter((e) => !punchedEmpIds.has(e.id) && approvedOffEmpIds.has(e.id))
    .map((e) => {
      const req = approvedOffToday.find((r) => r.employeeId === e.id);
      return { id: e.id, name: e.displayName, type: req?.type ?? "UNPAID" };
    });

  const noPunchList = employees
    .filter((e) => !punchedEmpIds.has(e.id) && !approvedOffEmpIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.displayName }));

  // ── Recent runs ───────────────────────────────────────────────────────────
  const rawRecent = await listRuns(5);
  const periodIds = Array.from(new Set(rawRecent.map((r) => r.periodId)));
  const scheduleIds = Array.from(
    new Set(
      rawRecent
        .map((r) => r.payScheduleId)
        .filter((s): s is string => Boolean(s)),
    ),
  );
  const { payPeriods: periodsTable, paySchedules: schedulesTable } =
    await import("@/lib/db/schema");
  const { inArray } = await import("drizzle-orm");
  const [periodRows, scheduleRows] = await Promise.all([
    periodIds.length
      ? db.select().from(periodsTable).where(inArray(periodsTable.id, periodIds))
      : [],
    scheduleIds.length
      ? db
          .select()
          .from(schedulesTable)
          .where(inArray(schedulesTable.id, scheduleIds))
      : [],
  ]);
  const periodById = new Map(periodRows.map((p) => [p.id, p]));
  const scheduleById = new Map(scheduleRows.map((s) => [s.id, s]));
  const recentRuns = rawRecent.map((r) => ({
    ...r,
    period: periodById.get(r.periodId) ?? null,
    schedule: r.payScheduleId
      ? (scheduleById.get(r.payScheduleId) ?? null)
      : null,
  }));

  const cardState: Parameters<typeof PayrollRunCard>[0]["state"] = run
    ? run.state
    : "NO_RUN";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-text-muted">
          {period
            ? `Period ${period.startDate} – ${period.endDate}`
            : "No active period"}
        </p>
      </header>

      <StatStrip
        inToday={punchedList.length}
        totalActive={employees.length}
        periodHours={stats?.hours ?? 0}
        weeklyGrossCents={weeklyGrossCents}
        semiMonthlyGrossCents={semiMonthlyGrossCents}
        exceptions={stats?.unresolvedAlerts ?? 0}
        lastPollAt={lastPoll?.finishedAt ?? null}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <PayrollRunCard
          state={cardState}
          {...(period
            ? { period: { startDate: period.startDate, endDate: period.endDate } }
            : {})}
          {...(run?.id ? { runId: run.id } : {})}
          {...(stats ? { stats } : {})}
          {...(run?.employeeFixDeadline
            ? {
                fixDeadline: run.employeeFixDeadline
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " "),
              }
            : {})}
        />
        <AttendancePanel
          punched={punchedList}
          approvedOut={approvedOutList}
          noPunch={noPunchList}
          todayLabel={shortDateLabel(today)}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending requests</CardTitle>
            <CardDescription>
              {pendingTotal === 0
                ? "Nothing awaits your review."
                : `${pendingMissed.length} missed-punch · ${pendingTimeOff.length} time-off`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingTotal === 0 ? (
              <EmptyState
                icon={MessageSquareWarning}
                title="All clear"
                description="No employee submissions waiting on a decision."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/requests">Open requests page</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {pendingMissed.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href="/requests"
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">
                      Missed punch · {r.date}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {r.reason}
                    </div>
                  </Link>
                ))}
                {pendingTimeOff.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href="/requests"
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">
                      Time off · {r.startDate} – {r.endDate} (
                      {r.type.toLowerCase()})
                    </div>
                    {r.reason && (
                      <div className="text-xs text-text-muted truncate">
                        {r.reason}
                      </div>
                    )}
                  </Link>
                ))}
                {pendingTotal > 6 && (
                  <Button asChild variant="ghost" size="sm" className="mt-2">
                    <Link href="/requests">View all {pendingTotal}</Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No runs yet"
                description="The first run kicks off on the configured cron."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={
                        r.period
                          ? `/payroll/${r.period.id}`
                          : `/payroll/run/${r.id}`
                      }
                      className="flex items-center justify-between gap-3 rounded-input border border-border px-3 py-2 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {r.period
                              ? `${r.period.startDate} – ${r.period.endDate}`
                              : `run ${r.id.slice(0, 8)}`}
                          </span>
                          <SchedulePill name={r.schedule?.name ?? null} />
                        </div>
                        {r.totalAmountCents !== null && (
                          <div className="text-xs text-text-muted truncate">
                            <MoneyDisplay
                              cents={r.totalAmountCents}
                              monospace={false}
                            />
                          </div>
                        )}
                      </div>
                      <StatusPill status={r.state as never} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/kidevu/payroll-git && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Type-check**

```bash
cd /Users/kidevu/payroll-git && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/dashboard/page.tsx
git commit -m "feat: dashboard redesign — stat strip, attendance panel, ungated period stats"
```

- [ ] **Step 5: Deploy and smoke test**

```bash
git push origin rebuild/foundation
```

Then wait ~60s for the deploy timer and open `/dashboard` in the browser. Verify:
- Stat strip shows 6 tiles (or 5 if only one schedule has employees)
- PayrollRunCard shows stat tiles even with no active run
- AttendancePanel shows three color-coded groups (red/purple/green); empty groups are hidden
- Pending requests and recent runs render correctly
- No console errors
