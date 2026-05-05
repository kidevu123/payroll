-- Repair: consolidate duplicate (UNASSIGNED, SCHEDULED) period pairs.
--
-- The schedule-aware ensurePeriodForSchedule helper that landed in
-- 7534332 created freshly-tagged periods alongside any pre-existing
-- UNASSIGNED periods that covered the same date range — they have a
-- different (pay_schedule_id, start_date) tuple under the new unique
-- index so the insert succeeded. Result: the May 4 → 10 weekly week
-- has TWO rows: one without a schedule (22 punches landed here from
-- earlier polls before the fix) and one tagged Weekly (0 punches —
-- this is what the UI shows).
--
-- This migration:
--   1. Detects each pair of (unassigned, scheduled) periods with
--      identical [start_date, end_date].
--   2. Moves punches / payslips / payroll_runs / temp_workers / docs
--      from the unassigned period onto the scheduled one.
--   3. Deletes the unassigned row when it ends up empty.
--   4. For any LEFTOVER unassigned periods (no scheduled twin), tags
--      them by length: 5–8 days = WEEKLY, 13–16 days = SEMI_MONTHLY.
--      Skip ambiguous lengths so the operator can fix manually.
--
-- Idempotent. Safe to run repeatedly.

DO $$
DECLARE
  twin_pair RECORD;
  weekly_id uuid;
  semi_id uuid;
BEGIN
  -- Step 1+2+3: merge each (UNASSIGNED, SCHEDULED) twin pair.
  FOR twin_pair IN
    SELECT u.id AS u_id, s.id AS s_id
    FROM pay_periods u
    JOIN pay_periods s
      ON s.start_date = u.start_date
     AND s.end_date = u.end_date
     AND s.id <> u.id
     AND s.pay_schedule_id IS NOT NULL
    WHERE u.pay_schedule_id IS NULL
  LOOP
    UPDATE punches SET period_id = twin_pair.s_id WHERE period_id = twin_pair.u_id;
    UPDATE payslips SET period_id = twin_pair.s_id WHERE period_id = twin_pair.u_id;
    UPDATE payroll_runs SET period_id = twin_pair.s_id WHERE period_id = twin_pair.u_id;
    UPDATE temp_worker_entries SET period_id = twin_pair.s_id WHERE period_id = twin_pair.u_id;
    UPDATE payroll_period_documents SET period_id = twin_pair.s_id WHERE period_id = twin_pair.u_id;
    -- Hard-delete the now-empty unassigned twin. Audit row written
    -- via Drizzle on a future delete is the canonical path; this
    -- migration is a system-level repair and writes its own log line
    -- via RAISE NOTICE.
    DELETE FROM pay_periods WHERE id = twin_pair.u_id;
    RAISE NOTICE 'merged unassigned period % into %', twin_pair.u_id, twin_pair.s_id;
  END LOOP;

  -- Step 4: tag any solitary UNASSIGNED periods by length.
  SELECT id INTO weekly_id FROM pay_schedules WHERE period_kind = 'WEEKLY' AND active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO semi_id FROM pay_schedules WHERE period_kind = 'SEMI_MONTHLY' AND active = true ORDER BY created_at LIMIT 1;

  IF weekly_id IS NOT NULL THEN
    UPDATE pay_periods
    SET pay_schedule_id = weekly_id
    WHERE pay_schedule_id IS NULL
      AND (end_date - start_date) BETWEEN 4 AND 7;
  END IF;
  IF semi_id IS NOT NULL THEN
    UPDATE pay_periods
    SET pay_schedule_id = semi_id
    WHERE pay_schedule_id IS NULL
      AND (end_date - start_date) BETWEEN 12 AND 15;
  END IF;
END $$;
