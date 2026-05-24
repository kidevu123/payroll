INSERT INTO pay_schedules (name, period_kind, start_day_of_week, anchor_date, cron, active)
SELECT 'Monthly', 'MONTHLY', NULL, NULL, '0 19 1 * *', true
WHERE NOT EXISTS (
  SELECT 1
  FROM pay_schedules
  WHERE period_kind = 'MONTHLY'
    AND active = true
);
