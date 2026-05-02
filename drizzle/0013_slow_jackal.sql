-- Hand-edited from drizzle-kit's auto-generated SQL: added IF NOT EXISTS
-- guards because this Drizzle migrator on this stack has silently no-op'd
-- before. The guards make the migration idempotent.

ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_expense_id" text;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_pushed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_zoho_organization_id_zoho_organizations_id_fk" FOREIGN KEY ("zoho_organization_id") REFERENCES "public"."zoho_organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
