-- Time-off requests get a CANCELLED state so an employee who clicked
-- "request" by mistake (or an admin who realized the request was bogus)
-- has a non-destructive way out. We don't hard-delete because:
--   - missed-punch detection cross-references the request set
--   - the calendar/notifications history matters for audit
--   - approved requests pushed to Google Calendar need to know to
--     pull the event back

-- Add CANCELLED to the request_status enum (skip if already there).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'request_status' AND e.enumlabel = 'CANCELLED'
  ) THEN
    ALTER TYPE request_status ADD VALUE 'CANCELLED';
  END IF;
END
$$;
