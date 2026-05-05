-- Employee birthday. Year is informational; the admin calendar surfaces
-- upcoming month-day matches as a chip on the day. Self-editable from
-- /me/profile.

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "birthday" date;
