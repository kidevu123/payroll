-- E1 from Avenger 2 audit. Adds pay_schedule_id to pay_periods so the
-- "two overlapping periods on the same calendar day, same employee
-- gets double-counted" class of bugs can't happen anymore.
--
-- Idempotent. Safe to re-run.

-- 1. Add the column (nullable for backfill).
ALTER TABLE pay_periods
  ADD COLUMN IF NOT EXISTS pay_schedule_id uuid REFERENCES pay_schedules(id);

-- 2. Backfill from payroll_runs. For each pay_period, take the
--    payScheduleId of any attached payroll_run that has one. If a
--    period has multiple runs with different schedules, prefer the
--    most recently created run (admin's most-recent intent).
UPDATE pay_periods pp
SET pay_schedule_id = (
  SELECT pr.pay_schedule_id
  FROM payroll_runs pr
  WHERE pr.period_id = pp.id
    AND pr.pay_schedule_id IS NOT NULL
  ORDER BY pr.created_at DESC
  LIMIT 1
)
WHERE pp.pay_schedule_id IS NULL
  AND EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.period_id = pp.id AND pr.pay_schedule_id IS NOT NULL
  );

-- 3. Drop the old global-unique on start_date (it's incompatible with
--    multi-schedule periods that share calendar dates).
DROP INDEX IF EXISTS pay_periods_start_unique;

-- 4. Add the per-schedule uniqueness. NULL pay_schedule_id rows are
--    excluded from uniqueness by Postgres semantics (NULL != NULL),
--    which is fine — legacy unassigned rows can coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS pay_periods_schedule_start_unique
  ON pay_periods (pay_schedule_id, start_date);

-- 5. Helper index for the join from runs to periods.
CREATE INDEX IF NOT EXISTS pay_periods_schedule_idx
  ON pay_periods (pay_schedule_id);
