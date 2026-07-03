-- Performance indexes (additive, boot-safe). All IF NOT EXISTS so re-runs and
-- already-present indexes are no-ops. Tables are small today so Postgres may
-- still prefer seq scans; these pay off as punches / time_off grow over time.

-- Live-row clockIn scans: Time grid range + dashboard "today" punches.
CREATE INDEX IF NOT EXISTS "punches_clock_in_live_idx"
  ON "punches" ("clock_in")
  WHERE "voided_at" IS NULL;
--> statement-breakpoint

-- "Which period covers this day" range-containment lookups (getCurrentPeriod,
-- resolvePeriodIdForEmployeeDay) on every punch create/edit.
CREATE INDEX IF NOT EXISTS "pay_periods_dates_idx"
  ON "pay_periods" ("start_date", "end_date");
--> statement-breakpoint

-- Calendar/Time time-off overlap: status + date window.
CREATE INDEX IF NOT EXISTS "time_off_status_dates_idx"
  ON "time_off_requests" ("status", "start_date", "end_date");
