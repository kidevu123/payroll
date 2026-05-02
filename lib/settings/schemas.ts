// Typed schemas for every Setting key. The owner edits these from /admin/settings;
// the action layer validates writes through these schemas. Adding a new lever
// means: (1) define a key here, (2) provide a default in defaults.ts,
// (3) surface it in the appropriate tab.
//
// Keep the surface area small. If something feels like it should be configurable,
// confirm it's actually a lever — many "configurable" things are just code smells.

import { z } from "zod";

// ─── Company ─────────────────────────────────────────────────────────────────

// Company has a default name ("My Company") so that getSetting("company")
// never throws when the settings row is missing — schema.parse({}) returns a
// usable object. Setup + Settings UI still validate user input as min(1)
// since the form submits an explicit value (a deliberate empty string is
// rejected by .min(1)). Tightening this further would require either making
// every getSetting callsite null-aware, or seeding a placeholder row at
// install time; the default is the smaller change.
export const companySchema = z.object({
  name: z.string().min(1).max(120).default("My Company"),
  address: z.string().max(500).default(""),
  logoPath: z.string().nullable().default(null),
  faviconPath: z.string().nullable().default(null),
  // Stamp updated whenever the icon-generator successfully writes new
  // PWA icons (icon-192/512/maskable-512). Used as a cache-buster on
  // /api/branding/icon/[size] and as a manifest revision marker.
  iconsGeneratedAt: z.string().nullable().default(null),
  brandColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color")
    .default("#0f766e"),
  timezone: z.string().default("America/New_York"),
  locale: z.string().default("en-US"),
});
export type CompanySettings = z.infer<typeof companySchema>;

// ─── Pay periods ─────────────────────────────────────────────────────────────

const dayOfWeek = z.number().int().min(0).max(6); // 0=Sunday..6=Saturday

export const payPeriodSchema = z.object({
  lengthDays: z.number().int().min(1).max(31).default(7),
  startDayOfWeek: dayOfWeek.default(1), // Monday
  workingDays: z.array(dayOfWeek).default([1, 2, 3, 4, 5, 6]), // Mon–Sat
  firstStartDate: z.string().date().nullable().default(null),
});
export type PayPeriodSettings = z.infer<typeof payPeriodSchema>;

// ─── Pay rules ───────────────────────────────────────────────────────────────

export const roundingRule = z.enum([
  "NONE",
  "NEAREST_DOLLAR",
  "NEAREST_QUARTER",
  "NEAREST_FIFTEEN_MIN_HOURS",
]);
export type RoundingRule = z.infer<typeof roundingRule>;

export const payRulesSchema = z.object({
  rounding: roundingRule.default("NEAREST_DOLLAR"),
  hoursDecimalPlaces: z.number().int().min(0).max(6).default(2),
  overtime: z
    .object({
      enabled: z.boolean(),
      thresholdHours: z.number().min(0),
      multiplier: z.number().min(1),
    })
    .default({ enabled: false, thresholdHours: 40, multiplier: 1.5 }),
});
export type PayRulesSettings = z.infer<typeof payRulesSchema>;

// ─── Automation ──────────────────────────────────────────────────────────────

export const automationSchema = z.object({
  /**
   * Master kill switch for ALL pg-boss cron schedules. When false, no
   * scheduled work registers — including the always-on noop.heartbeat
   * and period.rollover. The owner can flip this off when they need a
   * fully manual mode (e.g. while reconciling/rebuilding data) without
   * worrying about cron jobs re-creating schedules they just deleted.
   */
  cronEnabled: z.boolean().default(true),
  payrollRun: z.object({
    enabled: z.boolean().default(true),
    // Sunday 7pm ET — confirmed default per §21 #6.
    cron: z.string().default("0 19 * * 0"),
  }),
  // Per-punch poll of NGTeco's View Attendance Punch view. Default every
  // 15 min so /me/time is approximately real-time without hammering the
  // service account. Disable to fall back to weekly-only ingestion.
  ngtecoPunchPoll: z
    .object({
      enabled: z.boolean(),
      cron: z.string(),
    })
    .default({ enabled: true, cron: "*/15 * * * *" }),
  employeeFixWindowHours: z.number().int().min(1).max(168).default(24),
  adminAutoNotifyOnIngestFail: z.boolean().default(true),
  suspiciousDurationMinutesShortThreshold: z.number().int().min(1).default(240),
  suspiciousDurationMinutesLongThreshold: z.number().int().min(1).default(840),
});
export type AutomationSettings = z.infer<typeof automationSchema>;

// ─── NGTeco ──────────────────────────────────────────────────────────────────
// username/password are stored encrypted (AES-GCM); the app never sees plaintext
// outside the immediate request that decrypts them for a Playwright session.

export const ngtecoSchema = z.object({
  portalUrl: z.string().url().default("https://timeclock.ngteco.com"),
  // These are stored as `{ ciphertext, iv }` envelopes. The Settings UI encrypts
  // on write and decrypts on display (with admin role check).
  usernameEncrypted: z
    .object({ ciphertext: z.string(), iv: z.string() })
    .nullable()
    .default(null),
  passwordEncrypted: z
    .object({ ciphertext: z.string(), iv: z.string() })
    .nullable()
    .default(null),
  locationId: z.string().nullable().default(null),
  reportPath: z.string().default("/lib/ngteco/selectors.json"),
  headless: z.boolean().default(true),
});
export type NgtecoSettings = z.infer<typeof ngtecoSchema>;

// ─── Notifications ───────────────────────────────────────────────────────────
// Per §11. Event kinds → channel toggles. Email is dropped from defaults per
// owner direction (§21 #2: push + in-app only). The schema still allows email,
// in case it's enabled later.

export const notificationKind = z.enum([
  "missed_punch.detected",
  "missed_punch.request_submitted",
  "missed_punch.request_resolved",
  "time_off.request_submitted",
  "time_off.request_resolved",
  "payroll_run.ingest_failed",
  "payroll_run.awaiting_review",
  "payroll_run.published",
  "period.locked",
]);
export type NotificationKind = z.infer<typeof notificationKind>;

export const notificationChannels = z.object({
  in_app: z.boolean().default(true),
  email: z.boolean().default(false),
  push: z.boolean().default(true),
});
export type NotificationChannels = z.infer<typeof notificationChannels>;

export const notificationsSchema = z.object({
  defaults: z.record(notificationKind, notificationChannels).default({
    "missed_punch.detected": { in_app: true, email: false, push: true },
    "missed_punch.request_submitted": { in_app: true, email: false, push: true },
    "missed_punch.request_resolved": { in_app: true, email: false, push: true },
    "time_off.request_submitted": { in_app: true, email: false, push: true },
    "time_off.request_resolved": { in_app: true, email: false, push: true },
    "payroll_run.ingest_failed": { in_app: true, email: false, push: true },
    "payroll_run.awaiting_review": { in_app: true, email: false, push: true },
    "payroll_run.published": { in_app: true, email: false, push: true },
    "period.locked": { in_app: true, email: false, push: false },
  }),
});
export type NotificationsSettings = z.infer<typeof notificationsSchema>;

// ─── Security ────────────────────────────────────────────────────────────────

// ─── Google Calendar ──────────────────────────────────────────────────────
// Phase 1: scaffold the calendar id + status. The OAuth dance + event-push
// implementation is queued — this lets the owner save the target calendar
// id ahead of that work landing so config doesn't have to be reentered.

export const googleCalendarSchema = z.object({
  /** Target Google Calendar ID (e.g. "primary" or a UUID@group.calendar.google.com). */
  calendarId: z.string().max(200).default(""),
  /** Display label of the connected Google account. */
  connectedEmail: z.string().nullable().default(null),
  /** OAuth refresh token, sealed via lib/crypto/vault (AES-GCM). */
  refreshTokenSealed: z.string().nullable().default(null),
  /** ISO timestamp the OAuth connection was established. */
  connectedAt: z.string().nullable().default(null),
  /** ISO timestamp of the last successful event push. */
  lastPushedAt: z.string().nullable().default(null),
});
export type GoogleCalendarSettings = z.infer<typeof googleCalendarSchema>;

export const securitySchema = z.object({
  adminTwoFactorRequired: z.boolean().default(false), // §21 #10 — off by default
  sessionTimeoutDays: z.number().int().min(1).max(180).default(30),
  loginRateLimit: z
    .object({
      maxAttempts: z.number().int().min(1).default(5),
      windowMinutes: z.number().int().min(1).default(15),
    })
    .default({ maxAttempts: 5, windowMinutes: 15 }),
});
export type SecuritySettings = z.infer<typeof securitySchema>;

// ─── Registry ────────────────────────────────────────────────────────────────
// One source of truth that maps a key to its schema. The runtime layer uses this
// to validate reads and writes.

export const settingsRegistry = {
  company: companySchema,
  payPeriod: payPeriodSchema,
  payRules: payRulesSchema,
  automation: automationSchema,
  ngteco: ngtecoSchema,
  notifications: notificationsSchema,
  security: securitySchema,
  googleCalendar: googleCalendarSchema,
} as const;

export type SettingKey = keyof typeof settingsRegistry;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsRegistry)[K]>;
/** Input shape (allows omitting fields that have schema defaults). */
export type SettingInput<K extends SettingKey> = z.input<(typeof settingsRegistry)[K]>;
