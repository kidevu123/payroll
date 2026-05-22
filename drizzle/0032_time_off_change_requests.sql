-- Employee edits/cancellations of approved time off become pending change rows.

DO $$ BEGIN
  CREATE TYPE "public"."time_off_change_action" AS ENUM('EDIT', 'CANCEL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "time_off_requests"
  ADD COLUMN IF NOT EXISTS "change_request_for_id" uuid;
--> statement-breakpoint

ALTER TABLE "time_off_requests"
  ADD COLUMN IF NOT EXISTS "change_request_action" "time_off_change_action";
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "time_off_requests"
    ADD CONSTRAINT "time_off_requests_change_request_for_id_time_off_requests_id_fk"
    FOREIGN KEY ("change_request_for_id")
    REFERENCES "public"."time_off_requests"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "time_off_change_request_for_idx"
  ON "time_off_requests" USING btree ("change_request_for_id");
