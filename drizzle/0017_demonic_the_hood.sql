-- Idempotent: each statement uses IF NOT EXISTS / DO ... EXCEPTION so
-- this can run safely on a database that already has some of these
-- objects from earlier deploys. Drizzle-kit re-flagged stale diffs from
-- 0015/0016 when generating, but those objects are already in prod.

DO $$ BEGIN
 ALTER TYPE "public"."missed_punch_issue" ADD VALUE 'INVERTED_TIMES';
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN invalid_parameter_value THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "pay_periods_start_unique";--> statement-breakpoint
ALTER TABLE "pay_periods" ADD COLUMN IF NOT EXISTS "pay_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_resolved_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_pay_schedule_id_pay_schedules_id_fk" FOREIGN KEY ("pay_schedule_id") REFERENCES "public"."pay_schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_dispute_resolved_by_id_users_id_fk" FOREIGN KEY ("dispute_resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pay_periods_schedule_start_unique" ON "pay_periods" USING btree ("pay_schedule_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_periods_schedule_idx" ON "pay_periods" USING btree ("pay_schedule_id");
