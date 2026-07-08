-- Owner directive (Jul 2026): the punch poll now rides NGTeco's REST API
-- (browserless, ~2s, no Chromium) instead of the headless scrape, so the
-- cadence no longer needs to be conservative. Set the automatic poll to
-- hourly and make sure it's enabled. One-shot data migration — future
-- edits from /settings/automation are not overridden.
UPDATE settings
SET value = jsonb_set(
      jsonb_set(value, '{ngtecoPunchPoll,cron}', '"0 * * * *"'),
      '{ngtecoPunchPoll,enabled}', 'true'
    ),
    updated_at = now()
WHERE key = 'automation'
  AND value ? 'ngtecoPunchPoll';
