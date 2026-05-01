-- Idempotent repair migration. 0008_open_eternals.sql was recorded as
-- applied in __drizzle_migrations on prod but its DDL never ran. Same
-- silent Drizzle migrator pattern that bit 0006 (which 0007 repaired).
-- Production currently restart-loops because legacy-import.ts does a
-- SELECT * on payroll_runs and Drizzle expects the column.
--
-- IF NOT EXISTS guard so this is safe whether 0008 partly applied or not.

ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "cohort_employee_ids" jsonb;
