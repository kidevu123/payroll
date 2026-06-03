---
name: hall-monitor
description: Weekly outside verification for the payroll app — punch integrity, roster coverage, pay math drift, NGTeco sync, and pending approvals. Use when asked to run hall monitor, weekly audit, outside verifier, or reconcile payroll before lock.
---

# Hall monitor (weekly outside verifier)

Independent weekly pass over the Milo payroll app before the owner locks payroll.

## In-app automation

- **Job:** `hall-monitor.weekly` (pg-boss), cron `0 6 * * 1` in company timezone (Monday 6:00 AM).
- **Code:** `lib/hall-monitor/run-weekly-audit.ts`
- **Report JSON:** `{STORAGE_ROOT}/hall-monitor/{weekEnd}.json` (default `/data/hall-monitor/`)
- **Admin UI:** `/hall-monitor` — view latest report or `?run=1` for on-demand run.
- **Notifications:** `hall_monitor.weekly_ready` to admins when any warn/fail findings exist.

## What each check covers

| Category | Checks |
|----------|--------|
| `ngteco_sync` | Last successful poll age; failed polls in the audit week |
| `roster` | Active hourly employees missing `ngtecoEmployeeRef` |
| `punch_integrity` | Open shifts; duplicate punch clusters per open period |
| `coverage` | `detectExceptions` for the Sun–Sat week; unresolved alerts |
| `pending_work` | Pending missed-punch and time-off requests |
| `pay_math` | Payslip hours/cents vs live `computePay` drift (>0.5h or >$1) |

## Manual workflow (you or the owner)

1. Open `/hall-monitor` after Monday 6 AM (or Run now).
2. Resolve **fail** and **warn** items in order: NGTeco sync → open punches → pending requests → pay drift.
3. Cross-check Calendar pending rail for missed-punch approvals (human-readable on-file vs proposed times).
4. Re-run hall monitor until summary shows only ok (or accepted warns documented).

## Cursor / CLI

From repo root with DB reachable:

```bash
# On LX120 inside app container or with DATABASE_URL set locally
node -e "
  require('tsx/cjs').register?.();
" 
```

Prefer the admin **Run now** button — it uses the same `runWeeklyHallMonitorJob()` path as cron.

## Consult the council

For architectural review of hall-monitor gaps or new checks, use the **llm-council** skill:

```
Consult the council: What additional checks should the payroll hall monitor run weekly?
```
