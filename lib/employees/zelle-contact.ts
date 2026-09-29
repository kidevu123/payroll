// Payout preference — how an employee would like to receive their pay
// (cash or Zelle) plus the phone/email their Zelle is registered under.
//
// Display-only: nothing in payroll math, the period BANK/CASH payment
// method, or the cash drawer reads these values. They exist so the office
// does not have to chase people for Zelle details.
//
// Pure logic, no I/O. Both the employee profile action and the admin
// employee form resolve their input through resolvePayoutPreference so the
// two entry points cannot drift.

export const PAYOUT_PREFERENCES = ["CASH", "ZELLE"] as const;
export type PayoutPreference = (typeof PAYOUT_PREFERENCES)[number];

export type PayoutPreferenceError =
  | "PREFERENCE_INVALID"
  | "ZELLE_CONTACT_REQUIRED"
  | "ZELLE_CONTACT_INVALID";

export type ResolvedPayoutPreference =
  | {
      ok: true;
      value: {
        payoutPreference: PayoutPreference | null;
        zelleContact: string | null;
      };
    }
  | { ok: false; error: PayoutPreferenceError };

// RFC 5321 caps an address at 254 characters.
const MAX_CONTACT_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_SEPARATORS = /[\s().-]/g;

/**
 * Normalize a Zelle contact to a lowercase email or an E.164 US phone
 * (+1XXXXXXXXXX). Zelle is US-only, so other country codes are rejected.
 * Returns null when the input is neither.
 */
export function normalizeZelleContact(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_CONTACT_LENGTH) return null;

  if (value.includes("@")) {
    return EMAIL_PATTERN.test(value) ? value.toLowerCase() : null;
  }

  const hasPlus = value.startsWith("+");
  const digits = (hasPlus ? value.slice(1) : value).replace(
    PHONE_SEPARATORS,
    "",
  );
  if (!/^\d+$/.test(digits)) return null;

  const national =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10 && !hasPlus
        ? digits
        : null;
  // NANP area codes never start with 0 or 1.
  if (!national || !/^[2-9]/.test(national)) return null;
  return `+1${national}`;
}

/**
 * Resolve submitted form values into the pair of columns to store.
 * An empty preference means "not set". Anything other than Zelle clears
 * the contact so the office never reads stale Zelle details.
 */
export function resolvePayoutPreference(input: {
  preference: string | null;
  zelleContact: string | null;
}): ResolvedPayoutPreference {
  const preference = input.preference?.trim() ?? "";
  if (!preference) {
    return { ok: true, value: { payoutPreference: null, zelleContact: null } };
  }
  if (preference === "CASH") {
    return {
      ok: true,
      value: { payoutPreference: "CASH", zelleContact: null },
    };
  }
  if (preference !== "ZELLE") return { ok: false, error: "PREFERENCE_INVALID" };

  const contact = input.zelleContact?.trim() ?? "";
  if (!contact) return { ok: false, error: "ZELLE_CONTACT_REQUIRED" };
  const normalized = normalizeZelleContact(contact);
  if (!normalized) return { ok: false, error: "ZELLE_CONTACT_INVALID" };
  return {
    ok: true,
    value: { payoutPreference: "ZELLE", zelleContact: normalized },
  };
}
