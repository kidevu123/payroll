-- Hand-edited from drizzle-kit's auto-generated SQL: added IF NOT EXISTS
-- guards because this Drizzle migrator on this stack has silently no-op'd
-- before (see 0006→0007, 0008→0009, 0010→0011 repair history). The
-- guards make the migration idempotent and safe to re-apply.

ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "pay_period_start" date;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "pay_period_end" date;--> statement-breakpoint
ALTER TABLE "payroll_period_documents" ADD COLUMN IF NOT EXISTS "amount_cents" integer;
