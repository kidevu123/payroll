// Warehouse-kiosk sessions. Deliberately NOT Auth.js: a kiosk sign-in is
// a short-lived, single-purpose grant (view hours/payslips, file a punch
// fix) on a shared outdoor device. The token is an HMAC-signed JSON
// payload in an httpOnly cookie scoped to /kiosk, with a hard server-side
// TTL; the client adds a 60-second idle auto-logout on top.

import { createHmac, timingSafeEqual } from "crypto";

/** Hard server-side cap. The client idle timer signs out far sooner. */
export const KIOSK_SESSION_TTL_S = 5 * 60;
export const KIOSK_COOKIE_NAME = "kiosk_session";
/** Client-side inactivity sign-out, in seconds. Kiosk is a shared device. */
export const KIOSK_IDLE_LOGOUT_S = 60;

export type KioskSessionPayload = {
  employeeId: string;
  /** Unix seconds. */
  exp: number;
};

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set.");
  return s;
}

function sign(body: string, key: string): string {
  return createHmac("sha256", `${key}::kiosk`).update(body).digest("base64url");
}

export function sealKioskToken(
  payload: KioskSessionPayload,
  key: string = secret(),
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function openKioskToken(
  token: string | undefined | null,
  key: string = secret(),
  nowS: number = Math.floor(Date.now() / 1000),
): KioskSessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body, key);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (
    macBuf.length !== expectedBuf.length ||
    !timingSafeEqual(macBuf, expectedBuf)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as KioskSessionPayload).employeeId !== "string" ||
    typeof (parsed as KioskSessionPayload).exp !== "number"
  ) {
    return null;
  }
  const payload = parsed as KioskSessionPayload;
  if (payload.exp <= nowS) return null;
  return payload;
}

// ── PIN attempt limiting ────────────────────────────────────────────────
// In-memory per clock-ID counter: 5 failures locks the ID for 5 minutes.
// Process-local (resets on deploy), which is fine for a single warehouse
// kiosk — the goal is stopping PIN guessing at human speed.

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const attempts = new Map<string, { fails: number; lockedUntil: number }>();

export function kioskPinLockedUntil(clockId: string): number | null {
  const entry = attempts.get(clockId);
  if (!entry) return null;
  if (entry.lockedUntil > Date.now()) return entry.lockedUntil;
  return null;
}

export function recordKioskPinFailure(clockId: string): void {
  const entry = attempts.get(clockId) ?? { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.fails = 0;
  }
  attempts.set(clockId, entry);
}

export function clearKioskPinFailures(clockId: string): void {
  attempts.delete(clockId);
}
