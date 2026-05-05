-- Add PAYROLL_STAFF role. ALTER TYPE ADD VALUE has to live in its own
-- migration file (drizzle silently rolls back the whole bundle if an
-- enum-add transaction fails — see the LX120 memory note from when
-- 0017 wiped). Keep this migration empty of other DDL.

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'PAYROLL_STAFF' BEFORE 'EMPLOYEE';
