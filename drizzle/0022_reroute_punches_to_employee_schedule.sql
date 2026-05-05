-- Repair: re-route punches to the period that matches each employee's
-- pay schedule for that date. Migration 0020 merged duplicate periods
-- by date but didn't consider the employee's schedule — so a Juan
-- (Semi-Monthly) punch on May 4 ended up on the Weekly May 4–10
-- period instead of his Semi-Monthly May 1–15 period.
--
-- This migration:
--   1. For each punch, looks up the employee's pay_schedule_id.
--   2. Finds the period with that schedule_id covering the punch's
--      clock_in date. Creates one if none exists.
--   3. Re-points the punch onto the correct period.
--
-- Idempotent. Safe to run repeatedly. Skipped for punches whose
-- employee has no schedule assigned (the legacy fallback path).

DO $$
DECLARE
  punch RECORD;
  target_period_id uuid;
  schedule_kind text;
  schedule_anchor date;
  punch_date date;
  bounds_start date;
  bounds_end date;
  rerouted int := 0;
BEGIN
  FOR punch IN
    SELECT p.id, p.clock_in, p.period_id, e.pay_schedule_id, e.id AS employee_id
    FROM punches p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.voided_at IS NULL
      AND e.pay_schedule_id IS NOT NULL
      AND p.clock_in >= '2026-05-01'  -- only repair recent
  LOOP
    -- Date the punch belongs to (in UTC for now; matches existing logic).
    punch_date := (punch.clock_in AT TIME ZONE 'UTC')::date;

    -- See if a period already exists with this schedule covering this date.
    SELECT id INTO target_period_id
    FROM pay_periods
    WHERE pay_schedule_id = punch.pay_schedule_id
      AND start_date <= punch_date
      AND end_date >= punch_date
    LIMIT 1;

    -- Create one if missing.
    IF target_period_id IS NULL THEN
      SELECT period_kind::text, anchor_date INTO schedule_kind, schedule_anchor
      FROM pay_schedules WHERE id = punch.pay_schedule_id;

      IF schedule_kind = 'WEEKLY' THEN
        bounds_start := punch_date - ((EXTRACT(DOW FROM punch_date)::int + 6) % 7);
        bounds_end := bounds_start + 6;
      ELSIF schedule_kind = 'SEMI_MONTHLY' THEN
        IF EXTRACT(DAY FROM punch_date)::int <= 15 THEN
          bounds_start := DATE_TRUNC('month', punch_date)::date;
          bounds_end := bounds_start + 14;
        ELSE
          bounds_start := DATE_TRUNC('month', punch_date)::date + 15;
          bounds_end := (DATE_TRUNC('month', punch_date) + INTERVAL '1 month - 1 day')::date;
        END IF;
      ELSIF schedule_kind = 'MONTHLY' THEN
        bounds_start := DATE_TRUNC('month', punch_date)::date;
        bounds_end := (DATE_TRUNC('month', punch_date) + INTERVAL '1 month - 1 day')::date;
      ELSE
        CONTINUE; -- BIWEEKLY etc — skip for now
      END IF;

      INSERT INTO pay_periods (start_date, end_date, state, pay_schedule_id)
      VALUES (bounds_start, bounds_end, 'OPEN', punch.pay_schedule_id)
      ON CONFLICT (pay_schedule_id, start_date) DO NOTHING
      RETURNING id INTO target_period_id;

      -- Conflict path: another transaction won the race; re-fetch.
      IF target_period_id IS NULL THEN
        SELECT id INTO target_period_id
        FROM pay_periods
        WHERE pay_schedule_id = punch.pay_schedule_id
          AND start_date = bounds_start
        LIMIT 1;
      END IF;
    END IF;

    -- Re-point if different.
    IF target_period_id IS NOT NULL AND target_period_id <> punch.period_id THEN
      UPDATE punches SET period_id = target_period_id WHERE id = punch.id;
      rerouted := rerouted + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'punches rerouted: %', rerouted;
END $$;
