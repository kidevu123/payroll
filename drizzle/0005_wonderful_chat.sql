CREATE TYPE "public"."payroll_period_document_kind" AS ENUM('W2', 'PAYSTUB', 'OTHER');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ngteco_poll_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"triggered_by" text NOT NULL,
	"triggered_by_id" uuid,
	"ok" boolean DEFAULT false NOT NULL,
	"events_scraped" integer,
	"pairs_inserted" integer,
	"pairs_updated" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_period_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "payroll_period_document_kind" DEFAULT 'PAYSTUB' NOT NULL,
	"file_path" text NOT NULL,
	"mime" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"visible_to_employee" boolean DEFAULT true NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "requires_w2_upload" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ngteco_poll_log" ADD CONSTRAINT "ngteco_poll_log_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ngteco_poll_log_started_idx" ON "ngteco_poll_log" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_period_documents_period_idx" ON "payroll_period_documents" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_period_documents_employee_idx" ON "payroll_period_documents" USING btree ("employee_id");