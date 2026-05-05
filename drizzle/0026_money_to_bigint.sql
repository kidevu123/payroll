-- Widen every cents column from integer (~$21M cap) to bigint
-- (~$92 quadrillion cap). Aggregates over multi-year history were
-- the practical risk — a SUM(rounded_pay_cents) over a busy period
-- multi-year backfill could overflow. The cast is non-destructive
-- (every int fits in bigint).
--
-- Drizzle schema declarations also need to flip integer -> bigint;
-- this migration updates the DB shape so the next typegen lines
-- up. We keep schema.ts on `integer` for now (Drizzle treats both
-- as `number` in TS), and a follow-up migration can switch the
-- typegen if/when we use bigint-only helpers.

ALTER TABLE "employees"
  ALTER COLUMN "hourly_rate_cents" TYPE bigint,
  ALTER COLUMN "default_flat_amount_cents" TYPE bigint;

ALTER TABLE "employee_rate_history"
  ALTER COLUMN "hourly_rate_cents" TYPE bigint;

ALTER TABLE "task_pay_line_items"
  ALTER COLUMN "amount_cents" TYPE bigint;

ALTER TABLE "temp_worker_entries"
  ALTER COLUMN "amount_cents" TYPE bigint;

ALTER TABLE "payroll_period_documents"
  ALTER COLUMN "amount_cents" TYPE bigint;

ALTER TABLE "payroll_runs"
  ALTER COLUMN "total_amount_cents" TYPE bigint;

ALTER TABLE "payslips"
  ALTER COLUMN "gross_pay_cents" TYPE bigint,
  ALTER COLUMN "rounded_pay_cents" TYPE bigint,
  ALTER COLUMN "task_pay_cents" TYPE bigint;

ALTER TABLE "zoho_pushes"
  ALTER COLUMN "amount_cents" TYPE bigint;
