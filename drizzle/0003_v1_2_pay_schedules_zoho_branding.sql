CREATE TYPE "public"."pay_schedule_kind" AS ENUM('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_source" AS ENUM('CRON_AUTO', 'MANUAL_CSV', 'LEGACY_IMPORT', 'AD_HOC');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pay_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"period_kind" "pay_schedule_kind" NOT NULL,
	"start_day_of_week" integer,
	"anchor_date" date,
	"cron" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoho_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"refresh_token_encrypted" jsonb,
	"client_id_encrypted" jsonb,
	"client_secret_encrypted" jsonb,
	"api_domain" text DEFAULT 'https://www.zohoapis.com' NOT NULL,
	"accounts_domain" text DEFAULT 'https://accounts.zoho.com' NOT NULL,
	"default_expense_account_name" text,
	"default_expense_account_id" text,
	"default_paid_through_name" text,
	"default_paid_through_id" text,
	"default_vendor_name" text,
	"default_vendor_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_connection_test_at" timestamp with time zone,
	"last_connection_test_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoho_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"expense_id" text,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"pushed_by_id" uuid,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pay_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "published_to_portal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "source" "payroll_run_source" DEFAULT 'CRON_AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "pay_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "total_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "pdf_path" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_pushes" ADD CONSTRAINT "zoho_pushes_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_pushes" ADD CONSTRAINT "zoho_pushes_organization_id_zoho_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."zoho_organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zoho_pushes" ADD CONSTRAINT "zoho_pushes_pushed_by_id_users_id_fk" FOREIGN KEY ("pushed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zoho_orgs_name_unique" ON "zoho_organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zoho_orgs_active_idx" ON "zoho_organizations" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zoho_pushes_run_idx" ON "zoho_pushes" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zoho_pushes_run_org_ok_unique" ON "zoho_pushes" USING btree ("payroll_run_id","organization_id") WHERE "zoho_pushes"."status" = 'OK';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employees" ADD CONSTRAINT "employees_pay_schedule_id_pay_schedules_id_fk" FOREIGN KEY ("pay_schedule_id") REFERENCES "public"."pay_schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_pay_schedule_id_pay_schedules_id_fk" FOREIGN KEY ("pay_schedule_id") REFERENCES "public"."pay_schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_source_idx" ON "payroll_runs" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_published_portal_idx" ON "payroll_runs" USING btree ("published_to_portal_at");