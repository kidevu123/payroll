-- Partial-day fields on time_off_requests + new SCHEDULE_NOTE type.
-- Scope intentionally narrow: drizzle's full diff included a bunch of
-- enum values + tables that already shipped via 0027-0029, but the
-- snapshot wasn't refreshed in lockstep so the auto-generated SQL
-- tried to re-apply them. ALTER TYPE ... ADD VALUE is not idempotent
-- on Postgres, so re-running the unedited drizzle output would crash
-- the migrate script on prod. This file is hand-trimmed to only the
-- new schema deltas + uses IF NOT EXISTS on the enum bump for safety.

ALTER TYPE "public"."time_off_type" ADD VALUE IF NOT EXISTS 'SCHEDULE_NOTE';
--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "partial_start_time" time;
--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD COLUMN IF NOT EXISTS "partial_end_time" time;
