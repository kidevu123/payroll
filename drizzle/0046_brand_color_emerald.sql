-- Retire the pre-emerald brand color still stored in production.
--
-- Setting('company').brandColorHex seeds the ENTIRE accent ramp (see
-- lib/brand/ramp.ts). Production still carries the value from before the
-- emerald redesign, so brand-driven chrome — primary buttons, the reports
-- accent rails, the "Generate custom report" CTA, the Report-bug launcher,
-- PDF header bars and the FINAL PAY chip on the cut sheet — all rendered in
-- the old hue while the shell's own accents rendered emerald. Two accents,
-- every screen. This is the data half of that fix; the code half (deriving
-- all ten stops from one anchor instead of overriding only brand-700) landed
-- alongside it.
--
-- Only rewrites values that are demonstrably pre-emerald: the violet/indigo
-- family the app shipped before the rebrand, and the orange currently live.
-- Any other value is treated as a deliberate owner choice and left alone, so
-- re-running this after someone picks a new brand color is a no-op.

UPDATE settings
SET value = jsonb_set(value, '{brandColorHex}', '"#067049"'),
    updated_at = NOW()
WHERE key = 'company'
  AND lower(value ->> 'brandColorHex') IN (
    -- pre-rebrand violet / indigo
    '#6d28d9', '#7c3aed', '#8b5cf6', '#5b21b6', '#4f46e5', '#4338ca',
    -- the orange override currently on production
    '#c2410c', '#ea580c', '#f97316', '#fb923c', '#d97706'
  );
