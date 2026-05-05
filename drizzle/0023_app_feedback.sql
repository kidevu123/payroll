-- "Report a bug" widget. Captures page URL + user agent + build SHA so
-- the owner can flag issues without a back-and-forth on context.

CREATE TABLE IF NOT EXISTS "app_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_by_id" uuid REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "severity" text,
  "message" text NOT NULL,
  "page_url" text,
  "user_agent" text,
  "viewport" text,
  "build_sha" text,
  "resolved_at" timestamptz,
  "resolved_by_id" uuid REFERENCES "users"("id"),
  "resolution_note" text
);

CREATE INDEX IF NOT EXISTS "app_feedback_submitted_idx" ON "app_feedback" ("submitted_at");
CREATE INDEX IF NOT EXISTS "app_feedback_kind_idx" ON "app_feedback" ("kind");
