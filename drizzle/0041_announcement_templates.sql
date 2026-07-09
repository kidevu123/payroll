CREATE TABLE IF NOT EXISTS "announcement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "announcement_templates" ADD CONSTRAINT "announcement_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "announcement_templates" ADD CONSTRAINT "announcement_templates_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_templates_created_at_idx" ON "announcement_templates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_periods_dates_idx" ON "pay_periods" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punches_clock_in_live_idx" ON "punches" USING btree ("clock_in") WHERE "punches"."voided_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_off_one_pending_change" ON "time_off_requests" USING btree ("change_request_for_id") WHERE "time_off_requests"."status" = 'PENDING' AND "time_off_requests"."change_request_for_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_off_status_dates_idx" ON "time_off_requests" USING btree ("status","start_date","end_date");--> statement-breakpoint
-- Starter templates (owner ask: pre-filled templates out of the box).
-- Plain INSERTs — this migration runs exactly once, and admins can edit
-- or delete these from /notifications afterward.
INSERT INTO "announcement_templates" ("name", "title", "body", "link") VALUES
 ('Weekly reminder', 'Please review your hours', 'Reminder: review your punches for this week and confirm your hours before Monday evening. If something looks wrong, submit a correction from the Time tab.', '/me/time'),
 ('Payroll ready', 'Your payslip is ready', 'This week''s payroll has been processed. Open the Pay tab to review your payslip and acknowledge it.', '/me/pay'),
 ('Policy update', 'Policy update', 'We have updated a company policy. Please read the details below and reach out to your manager with any questions.', NULL),
 ('Schedule change', 'Schedule change notice', 'There is an upcoming change to the work schedule. Check the Calendar tab for the updated days and let us know about any conflicts.', '/me/calendar');
