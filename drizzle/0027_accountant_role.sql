-- Add ACCOUNTANT to user_role. Isolated migration per the
-- drizzle-alter-type gotcha: ALTER TYPE … ADD VALUE inside a larger
-- transaction silently rolls back. Standalone migration + verify via
-- psql after deploy.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
