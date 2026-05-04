-- Fix the stored ngteco.portalUrl when it still points at the legacy
-- timeclock.* host that no longer resolves (NXDOMAIN). The web app is
-- served from office.ngteco.com. Idempotent — a no-op if the value is
-- already correct or the row is missing.

UPDATE settings
SET value = jsonb_set(value, '{portalUrl}', '"https://office.ngteco.com"')
WHERE key = 'ngteco'
  AND value->>'portalUrl' = 'https://timeclock.ngteco.com';
