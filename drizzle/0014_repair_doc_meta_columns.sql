-- Idempotent repair for 0012 + 0013. Both silently no-op'd (the recurring
-- Drizzle migrator pattern that bit 0006/0008/0010). Bundling all six
-- columns into one migration with IF NOT EXISTS so the schema lands
-- regardless of which prior migrations ran or didn't.

ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "pay_period_start" date;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "pay_period_end" date;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_expense_id" text;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "zoho_pushed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_documents" ADD CONSTRAINT "payroll_period_documents_zoho_organization_id_zoho_organizations_id_fk" FOREIGN KEY ("zoho_organization_id") REFERENCES "public"."zoho_organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
