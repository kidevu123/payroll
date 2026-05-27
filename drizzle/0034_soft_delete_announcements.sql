ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "deleted_by_id" uuid;

DO $$ BEGIN
 ALTER TABLE "announcements" ADD CONSTRAINT "announcements_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
