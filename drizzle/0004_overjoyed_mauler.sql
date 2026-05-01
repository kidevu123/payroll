CREATE TABLE IF NOT EXISTS "temp_worker_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"worker_name" text NOT NULL,
	"description" text,
	"hours" numeric(6, 2),
	"amount_cents" integer NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_id" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "temp_worker_entries" ADD CONSTRAINT "temp_worker_entries_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "temp_worker_entries" ADD CONSTRAINT "temp_worker_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "temp_worker_entries" ADD CONSTRAINT "temp_worker_entries_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "temp_worker_period_idx" ON "temp_worker_entries" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "temp_worker_active_idx" ON "temp_worker_entries" USING btree ("period_id") WHERE "temp_worker_entries"."deleted_at" IS NULL;