-- Repair migration. 0017 bundled an `ALTER TYPE ADD VALUE` together with
-- `ADD COLUMN` for the payslip dispute fields. Per the drizzle-alter-type
-- gotcha (see memory/drizzle-alter-type-gotcha.md), the ALTER TYPE
-- silently rolls back when the value already exists — and on prod the
-- INVERTED_TIMES enum value had already landed via 0015, so 0017's whole
-- transaction reverted. Drizzle still marked 0017 complete in its
-- journal, but the dispute columns never reached the database. Result:
-- the period detail page crashes with "column disputed_at does not
-- exist" (PostgresError 42703 — runtime digest 733144507).
--
-- This migration repeats the column adds on their own. Idempotent — uses
-- IF NOT EXISTS so safe to run on databases where 0017 actually
-- succeeded too.

ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "dispute_resolved_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_dispute_resolved_by_id_users_id_fk" FOREIGN KEY ("dispute_resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
