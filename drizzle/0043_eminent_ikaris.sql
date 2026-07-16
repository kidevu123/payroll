-- One-time cleanup BEFORE the unique index can land: collapse duplicate
-- PENDING fix requests (same employee + date) down to the ORIGINAL (oldest)
-- one. Later duplicates are cancelled, not deleted — the audit trail and the
-- employee's request history stay intact.
UPDATE "missed_punch_requests" SET
  "status" = 'CANCELLED',
  "resolved_at" = NOW(),
  "resolution_note" = 'Cancelled automatically: duplicate of an earlier pending request for the same date.'
WHERE "status" = 'PENDING'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("employee_id", "date") "id"
    FROM "missed_punch_requests"
    WHERE "status" = 'PENDING'
    ORDER BY "employee_id", "date", "created_at" ASC
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "missed_requests_pending_unique" ON "missed_punch_requests" USING btree ("employee_id","date") WHERE "missed_punch_requests"."status" = 'PENDING';
