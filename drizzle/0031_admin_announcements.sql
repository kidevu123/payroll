-- Admin-composed broadcasts. New enum + table; no changes to existing rows.

DO $$ BEGIN
  CREATE TYPE "public"."announcement_audience_kind" AS ENUM('ALL', 'BY_ROLE', 'BY_SCHEDULE', 'SPECIFIC');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "link" text,
  "audience_kind" "announcement_audience_kind" NOT NULL,
  "audience_labels" jsonb,
  "audience_ids" jsonb,
  "recipient_count" integer NOT NULL DEFAULT 0,
  "sent_by_id" uuid NOT NULL,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "announcements"
    ADD CONSTRAINT "announcements_sent_by_id_users_id_fk"
    FOREIGN KEY ("sent_by_id")
    REFERENCES "public"."users"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "announcements_sent_at_idx"
  ON "announcements" USING btree ("sent_at");
