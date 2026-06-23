-- Cash drawer: petty-cash category + soft-void (edit/delete).
--
-- Hand-trimmed: drizzle-kit generate bundled pre-existing drift (announcements,
-- zoho_admin_report_backups, the UNPAIRED_PUNCH enum value, etc.) that is ALREADY
-- live in prod from migrations 0035/0036. Re-emitting those unguarded statements
-- would fail on boot ("type/column already exists") and break the deploy, so this
-- migration carries ONLY the genuinely-new cash_drawer columns, made idempotent.
ALTER TABLE "cash_drawer_entries" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
ALTER TABLE "cash_drawer_entries" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_drawer_entries" ADD COLUMN IF NOT EXISTS "voided_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_drawer_entries" ADD CONSTRAINT "cash_drawer_entries_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
