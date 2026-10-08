# Giant Files Split, Part 3 (period detail page) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `app/(admin)/payroll/[periodId]/page.tsx` (1,299 lines, one 1,030-line server component) to fetch → `lib/` → components, pinned DOM identical on the four period goldens.

**Spec:** `docs/superpowers/specs/2026-10-07-giant-files-split-design.md` (step 4).

## Global Constraints

- No visual, wording or behaviour change. A golden changes only by the user's decision; a new golden is recorded from the pre-change code and then checked against the change.
- Anything under `lib/payroll/` is fully unit-tested (the directory carries a 100% coverage threshold).
- Branch `refactor/giant-files-split`; push there; never push to `rebuild/foundation` without the user's go-ahead (it auto-deploys). No emoji.

## Review Focus

1. A PAID / published / legacy-import period where stored payslips are authoritative — rows come from payslips, employees with a payslip but no live row are appended, totals are the payslip sums. Test "stored totals".
2. Stored hours and live punch hours disagree by more than 0.5h — the row is flagged `hoursDrift`; exactly 0.5h is not. Test "drift threshold".
3. A run with a locked cohort — only cohort employees appear, regardless of schedule. Test "cohort beats schedule".
4. A period with a schedule — employees on another schedule are excluded, employees with no schedule are kept (wildcard), salaried always excluded. Test "schedule filter".
5. Sign-off buckets — only payslips that actually pay something count; a disputed payslip is in Disputed even if acknowledged. Test "sign-off buckets".

## Tasks

### Task 1: `lib/payroll/period-view.ts` (formatters)
Tests first for `formatHm`, `formatDayLabel`, `rateLabel`, `formatShortDate`, `periodDayCount`, `ROUNDING_LABEL`; move them verbatim from the page; gate; commit.

### Task 2: `lib/payroll/period-rows.ts` (pure rules)
Tests first (the five Review Focus items), then move verbatim out of the page: the cohort/schedule employee filter, the stored-vs-live display-row builder with drift detection, the totals, and the sign-off bucket computation. The page keeps the database reads and calls these. Gate; commit.

### Task 3: split the JSX into `components/payroll/period/*`
Header/action bar, documents card, sign-off card, disputes block, employee totals table (with `PunchSubTable` and the issue label), W2 section wrapper. Gate after each cut; commit.

### Task 4: close out
Page under 300 lines; lint; full suite; `CLAUDE.md` entry covering parts 2 and 3; version 1.5.5; push; one fresh review of parts 2 and 3.
