CREATE TABLE IF NOT EXISTS "ingest_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ngteco_employee_ref" text,
	"raw_data" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingest_exceptions" ADD CONSTRAINT "ingest_exceptions_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingest_exceptions" ADD CONSTRAINT "ingest_exceptions_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_exceptions_run_idx" ON "ingest_exceptions" USING btree ("payroll_run_id");