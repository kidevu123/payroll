// Canonical NGTeco person-code normalizer.
//
// NGTeco person codes are DISTINCT identifiers — "01" (Erica) and "0001" (the
// owner) are different people, so leading zeros are significant. The old logic
// stripped leading zeros and numeric-parsed, collapsing distinct employees onto
// one and cross-attributing every punch (the production bug fixed in 7a908cc).
// Match the EXACT code: trim + uppercase only. TEMP_ placeholder refs (assigned
// to not-yet-linked employees) pass through unchanged.
//
// This lives in one place so the punch importer and the roster sync can never
// drift apart again — they previously held identical private copies.
export function normalizeRef(s: string): string {
  if (!s) return "";
  if (s.startsWith("TEMP_")) return s;
  return s.trim().toUpperCase();
}
