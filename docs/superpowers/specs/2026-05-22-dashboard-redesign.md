# Dashboard redesign

**Date:** 2026-05-22  
**Status:** Approved for implementation

## Problem

The existing dashboard is built entirely around the payroll run state machine. On any day that is not payroll Sunday, it displays an empty "No payroll run yet" hero card and nothing operationally useful. The system is polling NGTeco every 15 minutes and accumulating punch data all week, but none of that is visible on the dashboard until a run is manually started.

## Goal

Make the dashboard useful every day of the week — not just payroll Sunday. It should answer three questions at a glance: Is the system working? Who showed up today? Where does this week stand heading into payroll?

---

## Layout

Four zones, top to bottom:

### 1. Stat strip (always visible)

Five tiles in a single row:

| Tile | Value | Source |
|------|-------|--------|
| In today | `X / Y` (clocked in / active headcount) | Today's punches vs active employees |
| Hours this period | Total hours accrued so far | `computePay` over current period punches |
| Weekly gross | Running gross for weekly-schedule employees only | `computePay` filtered to weekly pay schedule |
| Semi-mo. gross | Running gross for semi-monthly-schedule employees only | `computePay` filtered to semi-monthly pay schedule |
| Exceptions | Count of unresolved alerts | `listAlertsForPeriod` |
| NGTeco sync | "Live · N min ago" or "Stale" | `ngtecoPollLog` latest row |

The strip becomes 6 tiles when both schedules have employees. If only one schedule is active, the unused tile is hidden and the strip stays at 5.

The Exceptions tile uses an amber background when count > 0; green background otherwise. NGTeco tile is green when last poll < 30 min ago, amber 30–60 min, red > 60 min.

### 2. Main row (two columns)

**Left — Payroll run card (hero, ~65% width)**

The existing `PayrollRunCard` component stays as-is — brand border, gradient backdrop on attention states, progress bar, stat tiles, state-aware CTA.

One change: the stat tiles (Employees, Hours, Gross, Alerts) must render in **all states including `NO_RUN`**, not just when a run exists. Currently `stats` is only computed when `run && period`. Remove that gate — compute stats from the current period's punches regardless of run state. This eliminates the empty void on days 1–6 of the week.

**Right — Today's attendance panel (~35% width)**

Three stacked sections, always in this order:

1. **Expected · not punched in** (red)  
   Employees who are active, not on approved time off today, and have zero punches with `clockIn` >= start of today in company timezone. Red border/background. Shows name + "No punch" label.

2. **Out · approved time off** (purple)  
   Employees with an APPROVED time-off row covering today's date. Purple border/background. Shows name + time-off type (Unpaid / Sick / PTO / Other).

3. **Clocked in** (green)  
   Employees with at least one punch where `clockIn` >= start of today. Green border/background. Shows name + time of first punch today (formatted as `6:15a`). Capped at 4 visible rows; remainder collapsed as "+ N more".

Sections with zero members are hidden entirely (no empty boxes).

### 3. Bottom row (two columns, equal width)

**Left — Pending requests**  
Unchanged from current implementation. Shows up to 3 missed-punch and 3 time-off requests. Inline approve/deny actions. Collapses to a single "All clear" line when empty.

**Right — Recent runs**  
Unchanged from current implementation. Last 5 runs with period dates, schedule pill, amount, status.

---

## Data changes

### New query: `listTodayPunches(todayIso, tz)`

Location: `lib/db/queries/punches.ts`

Returns all punches where `clockIn >= start-of-day(todayIso, tz)`. Used by the attendance panel to determine who has clocked in and to compute "In today" stat strip count.

### New query: `listApprovedTimeOffForDate(dateIso)`

Location: `lib/db/queries/time-off.ts`

Returns all APPROVED time-off rows where `startDate <= dateIso <= endDate`. Used to populate the "Out · approved" bucket and to exclude those employees from the "Expected · not in" bucket.

### New query: `getLastPollLog()`

Location: `lib/db/queries/ngteco.ts` (or inline in dashboard page)

Returns the most recent row from `ngtecoPollLog`. Used for the NGTeco sync tile.

### Dashboard page stat computation

Remove the `if (period && run)` gate around `computePay`. Compute period stats whenever `period` exists, regardless of whether a run has been started. Pass computed stats into `PayrollRunCard` unconditionally.

For the stat strip gross tiles, run `computePay` separately per pay schedule by filtering employees to those assigned to each schedule. The weekly tile shows only employees on the weekly schedule; the semi-monthly tile shows only employees on the semi-monthly schedule. Both use the same current period's punches.

---

## Component changes

### `PayrollRunCard` (existing)

No structural changes. The only change is that the parent page now always passes `stats` when a period exists, so the stat tiles render in `NO_RUN` state.

### New: `AttendancePanel`

Client component. Props:
```ts
type AttendancePanelProps = {
  punched: { id: string; name: string; firstPunchAt: string }[];
  approvedOut: { id: string; name: string; type: string }[];
  noPunch: { id: string; name: string }[];
}
```

Pure display — no server actions, no mutations. Each section only renders if its array is non-empty.

### New: `StatStrip`

Server component. Five `StatTile` children. Tiles are plain divs — no interactivity.

---

## What is not changing

- The `PayrollRunCard` state machine, copy, progress bar, and action buttons — untouched.
- The pending requests card — untouched.
- The recent runs card — untouched.
- The NGTeco poll cron schedule — no change needed. The 15-min default already provides fresh enough data for a daily ops view.
- No new tables or schema migrations required.
