-- Add INVERTED_TIMES to missed_punch_issue enum.
-- Avenger 4 F3: clock_out < clock_in produces 0 hours silently. Surface
-- it as an exception so the admin sees the row instead of an underpaid
-- employee.
--
-- ALTER TYPE ADD VALUE has historically silently no-op'd through
-- Drizzle on this codebase. Use IF NOT EXISTS and run this as its own
-- migration so the rollback (if any) doesn't pull in unrelated DDL.

ALTER TYPE missed_punch_issue ADD VALUE IF NOT EXISTS 'INVERTED_TIMES';
