# Giant Files Split, Part 2 (reports table) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `app/(admin)/reports/reports-table.tsx` (1,663 lines, one client module) to an orchestrator, with its grouping / filtering / paging maths in a tested `lib/reports/table-model.ts` and its markup in `components/reports/table/*`, pinned DOM identical.

**Architecture:** Same recipe as part 1: tests first for the pure model, move code verbatim, then cut components. Every step ends with `npx next build && npm run golden:check` identical (8 `/reports` goldens).

**Spec:** `docs/superpowers/specs/2026-10-07-giant-files-split-design.md` (step 3).

## Global Constraints

- No visual, wording or behaviour change; a golden changes only by the user's decision.
- The goldens pin the SERVER-RENDERED default state. Filters, sort, pager and collapse are client state: nothing in the client logic is rewritten, only moved, and `matchesFilters` / `pageNumbers` / sort get unit tests.
- Every file under `components/reports/table/` starts with `"use client"` (they are only ever imported by the client `ReportsTable`).
- Work on branch `refactor/giant-files-split`; push there. Never push to `rebuild/foundation` (auto-deploys) without the user's go-ahead.
- No emoji.

## Review Focus

1. A period with BOTH a payroll run and W2 paystub docs — net swaps `replacedRunNetCents` for `docNetPayCents`; pinned by `table-model.test.ts` "net swaps the run net of paystub employees".
2. A salaried-paystub-only period (no run state) — buckets as PAID and BANK unless the period recorded CASH; test "salaried paystub groups".
3. Two runs on one period — one group, temp labor counted once, `employeesPaid`/`hoursWorked` summed, `null` when no run carries them; test "groups runs by period".
4. More than 7 pages — ellipsis gaps; test "pageNumbers".
5. Search text matching the formatted range or the schedule name, case-insensitively, with "salaried" as the fallback name; test "matchesFilters search".

## Tasks

### Task 1: `lib/reports/table-model.ts`
Create `lib/reports/table-model.test.ts` first (RED: module missing), covering the five focus items plus `groupByMonth` (newest-first order kept, month key/label from `periodStart`), `monthNet`/`monthGross`, `groupState`, `groupMethod`, `formatDate`. Then move verbatim from `reports-table.tsx`: `MONTH_SHORT`, `MONTH_LONG`, `formatDate`, `monthLabel`, `monthKey`, `GroupedReport`, `MonthGroup`, `groupByPeriod`, `groupByMonth`, `periodNet`, `periodGross`, `monthNet`, `monthGross`, `StatusFilter`, `MethodFilter`, `SortKey`, `groupState`, `groupMethod`, `matchesFilters`, `PAGE_SIZE`, `pageNumbers`; export each; import them in the table. Gate: tests green, typecheck, build, `golden:check` identical. Commit.

### Task 2: split the components
Cut, in this order, each followed by the gate and a commit: (a) `cells.tsx` (`StatusCell`, `PaymentMethodCell`, `PaymentChip`, `VisibilityChip`, `ZohoBadges`); (b) `row-actions.tsx` (`RunActions`, `RowOverflowMenu`); (c) `filter-bar.tsx` (`FilterBar`, `FilterSelect`) and `pager.tsx`; (d) `period-line.tsx` and `month-card.tsx` with the shared `SharedHandlers` type and `TABLE_GRID`/`ACTIONS_TRACK` in `grid.ts`. `reports-table.tsx` keeps `ReportsTable`. Server actions are imported from `@/app/(admin)/reports/actions` and `@/app/(admin)/payroll/actions`.

### Task 3: close out
`reports-table.tsx` under 300 lines, component files under 250 (a file over that is split by responsibility), lint clean, full suite, briefing entry in `CLAUDE.md`, version 1.5.5, push the branch. Fresh whole-branch review of this part's range.
