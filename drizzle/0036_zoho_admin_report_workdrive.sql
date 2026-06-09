ALTER TABLE "zoho_organizations"
  ADD COLUMN IF NOT EXISTS "workdrive_admin_report_folder_id" text;
--> statement-breakpoint
ALTER TABLE "zoho_organizations"
  ADD COLUMN IF NOT EXISTS "workdrive_admin_report_backup_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoho_admin_report_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "period_id" uuid NOT NULL,
  "payroll_run_id" uuid,
  "organization_id" uuid NOT NULL,
  "folder_id" text NOT NULL,
  "zoho_file_id" text,
  "filename" text NOT NULL,
  "sha256" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_admin_report_backups" ADD CONSTRAINT "zoho_admin_report_backups_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_admin_report_backups" ADD CONSTRAINT "zoho_admin_report_backups_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_admin_report_backups" ADD CONSTRAINT "zoho_admin_report_backups_organization_id_zoho_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."zoho_organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zoho_admin_report_backups_period_idx" ON "zoho_admin_report_backups" USING btree ("period_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zoho_admin_report_backups_org_idx" ON "zoho_admin_report_backups" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zoho_admin_report_backups_ok_unique" ON "zoho_admin_report_backups" USING btree ("period_id","organization_id","sha256") WHERE "zoho_admin_report_backups"."status" = 'OK';
