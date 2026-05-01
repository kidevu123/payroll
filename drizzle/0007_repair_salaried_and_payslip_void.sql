-- Idempotent repair migration. The previous 0006_outstanding_ogun.sql was
-- recorded as applied in __drizzle_migrations on prod but its DDL did not
-- actually take effect (the pay_type enum still only has HOURLY and
-- FLAT_TASK, and payslips.voided_at / voided_by_id / void_reason are
-- absent). Suspected cause: ALTER TYPE ADD VALUE inside the same multi-
-- statement transaction as ALTER TABLE ADD COLUMN got silently rolled
-- back while the bookkeeping row was still inserted.
--
-- This migration uses IF NOT EXISTS / IF NOT EXISTS-equivalent guards so
-- it's safe to run regardless of whether 0006 partly applied. Only the
-- enum-add still needs the IF NOT EXISTS Postgres 9.6+ syntax.

ALTER TYPE "public"."pay_type" ADD VALUE IF NOT EXISTS 'SALARIED';--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
