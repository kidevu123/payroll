// Payday signing mode. The owner mints a 6-digit code on the admin period
// page, types it into the warehouse tablet, and the tablet gets a
// period-scoped session: a names-only list of that period's payslips, one
// signing screen at a time. No employee PIN — the owner is standing there
// handing the tablet over. The admin login never touches the shared device.
//
// Codes are persisted (lib/db/queries/payday-codes.ts): the admin route
// and the kiosk route are separate server bundles, so module-level state
// would not be shared between "mint" and "redeem". The session is an
// HMAC-sealed cookie under its own scope so a kiosk employee token can
// never be replayed as a payday token.

import { randomInt } from "node:crypto";
import { openScopedToken, sealScopedToken } from "./session";

export const PAYDAY_COOKIE_NAME = "kiosk_payday";
/** How long a minted code can sit before it is typed into the tablet. */
export const PAYDAY_CODE_TTL_S = 15 * 60;
/** How long the tablet stays in payday mode after unlock. */
export const PAYDAY_SESSION_TTL_S = 3 * 60 * 60;
/** Idle seconds on a signing screen before the tablet returns to the list. */
export const PAYDAY_IDLE_RETURN_S = 180;

const PAYDAY_SCOPE = "kiosk-payday";

export type PaydaySessionPayload = {
  periodId: string;
  /** Unix seconds. */
  exp: number;
};

/** Six zero-padded digits from a CSPRNG. */
export function generatePaydayCode(
  rand: (max: number) => number = (max) => randomInt(max),
): string {
  return String(rand(1_000_000)).padStart(6, "0");
}

// ── Wrong-code throttle ─────────────────────────────────────────────────
// One tablet, one owner: after 5 wrong codes, wait a minute. Stops a
// bored employee from brute-forcing the six digits at human speed.
// Process-local is fine here — the unlock action is a single route.

const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
let failures = { fails: 0, lockedUntil: 0 };

export function paydayLockedUntil(nowMs: number = Date.now()): number | null {
  return failures.lockedUntil > nowMs ? failures.lockedUntil : null;
}

export function recordPaydayFailure(nowMs: number = Date.now()): void {
  const fails = failures.fails + 1;
  failures =
    fails >= MAX_FAILS
      ? { fails: 0, lockedUntil: nowMs + LOCK_MS }
      : { fails, lockedUntil: failures.lockedUntil };
}

export function clearPaydayFailures(): void {
  failures = { fails: 0, lockedUntil: 0 };
}

// ── Session token ───────────────────────────────────────────────────────

export function sealPaydayToken(
  payload: PaydaySessionPayload,
  key?: string,
): string {
  return sealScopedToken(payload, PAYDAY_SCOPE, key);
}

export function openPaydayToken(
  token: string | undefined | null,
  key?: string,
  nowS: number = Math.floor(Date.now() / 1000),
): PaydaySessionPayload | null {
  const parsed = openScopedToken(token, PAYDAY_SCOPE, key);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as PaydaySessionPayload).periodId !== "string" ||
    typeof (parsed as PaydaySessionPayload).exp !== "number"
  ) {
    return null;
  }
  const payload = parsed as PaydaySessionPayload;
  if (payload.exp <= nowS) return null;
  return payload;
}
