-- Repair: clear pay_schedule_id on any SALARIED employee that's been
-- mis-assigned to a WEEKLY pay schedule. Salaried employees are paid
-- on a fixed cycle (semi-monthly / monthly / external) and never on
-- the weekly punch-driven cadence. Stored data picked this up
-- somewhere — owner saw "Seri" surface on the May 4–10 weekly
-- period's W2 upload list because her pay_schedule_id matched the
-- Weekly schedule.
--
-- The defensive UI filter in PayrollDocsSection already hides
-- (SALARIED, WEEKLY) so it doesn't render on a period, but the
-- stored data is still wrong. This migration nulls those rows so
-- they surface on the Salaried tab the way the owner expects.
--
-- Idempotent. Safe to run repeatedly.

UPDATE employees
SET pay_schedule_id = NULL,
    updated_at = NOW()
WHERE pay_type = 'SALARIED'
  AND pay_schedule_id IN (
    SELECT id FROM pay_schedules WHERE period_kind = 'WEEKLY'
  );
