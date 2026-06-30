-- Boot-safe: first demote any existing duplicate PENDING change-requests
-- (keep the earliest per original) so the unique index can be created even if
-- the double-tap bug already produced duplicates. Almost always a no-op.
UPDATE "time_off_requests" SET "status" = 'REJECTED'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "change_request_for_id" ORDER BY "created_at"
    ) AS rn
    FROM "time_off_requests"
    WHERE "status" = 'PENDING' AND "change_request_for_id" IS NOT NULL
  ) t WHERE t.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_off_one_pending_change"
  ON "time_off_requests" ("change_request_for_id")
  WHERE "status" = 'PENDING' AND "change_request_for_id" IS NOT NULL;
