// Drizzle schema for the payroll platform.
//
// Conventions (locked):
//   • Money is integer cents. Always. Never floats.
//   • Times are timestamptz. Display respects company timezone (Setting).
//   • Soft-delete via voidedAt / archivedAt — nothing leaves the database.
//   • Every mutation must write an AuditLog row before commit.
//   • Table names are snake_case plural; column names snake_case.
//
// Migrations are generated with `pnpm db:generate` and applied via
// `scripts/migrate.ts`. The generated SQL is committed under /drizzle.

import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  bigint,
  numeric,
  boolean,
  date,
  time,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Custom types
// ─────────────────────────────────────────────────────────────────────────────

/** citext — case-insensitive text. Requires the `citext` extension. */
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["OWNER", "ADMIN", "EMPLOYEE"]);

export const employeeStatusEnum = pgEnum("employee_status", [
  "ACTIVE",
  "INACTIVE",
  "TERMINATED",
]);

export const payTypeEnum = pgEnum("pay_type", ["HOURLY", "FLAT_TASK"]);

export const languageEnum = pgEnum("language", ["en", "es"]);

export const payPeriodStateEnum = pgEnum("pay_period_state", [
  "OPEN",
  "LOCKED",
  "PAID",
]);

export const punchSourceEnum = pgEnum("punch_source", [
  "NGTECO_AUTO",
  "MANUAL_ADMIN",
  "MISSED_PUNCH_APPROVED",
  "LEGACY_IMPORT",
]);

export const missedPunchIssueEnum = pgEnum("missed_punch_issue", [
  "MISSING_IN",
  "MISSING_OUT",
  "NO_PUNCH",
  "SUSPICIOUS_DURATION",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const timeOffTypeEnum = pgEnum("time_off_type", [
  "UNPAID",
  "SICK",
  "PERSONAL",
  "OTHER",
]);

export const payrollRunStateEnum = pgEnum("payroll_run_state", [
  "SCHEDULED",
  "INGESTING",
  "INGEST_FAILED",
  "AWAITING_EMPLOYEE_FIXES",
  "AWAITING_ADMIN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "EMAIL",
  "PUSH",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Users (Auth.js subjects)
//
// Every login is a User; an Employee may or may not have a corresponding User.
// (A terminated employee keeps their Employee row but has their User disabled.)
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("EMPLOYEE"),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    twoFactorSecret: text("two_factor_secret"), // null when 2FA disabled
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Sessions (Auth.js Drizzle adapter shape)
// ─────────────────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Shifts — owner-defined, NOT an enum.
// ─────────────────────────────────────────────────────────────────────────────

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  colorHex: text("color_hex").notNull().default("#0f766e"),
  defaultStart: time("default_start"),
  defaultEnd: time("default_end"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Employees
// ─────────────────────────────────────────────────────────────────────────────

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id"), // preserves "TEMP_001", "1", "47"
    displayName: text("display_name").notNull(),
    legalName: text("legal_name").notNull(),
    preferredName: text("preferred_name"),
    email: citext("email").notNull(),
    phone: text("phone"), // E.164
    pinCodeHash: text("pin_code_hash"), // null until kiosk mode
    photoPath: text("photo_path"),
    status: employeeStatusEnum("status").notNull().default("ACTIVE"),
    shiftId: uuid("shift_id").references(() => shifts.id),
    payType: payTypeEnum("pay_type").notNull().default("HOURLY"),
    // hourlyRateCents is a denormalized cache of the latest EmployeeRateHistory row.
    // Pay computation always reads from history (as of punch.clockIn). Never edit
    // this field directly; it's updated by the rate-history insert trigger.
    hourlyRateCents: integer("hourly_rate_cents"),
    defaultFlatAmountCents: integer("default_flat_amount_cents"),
    language: languageEnum("language").notNull().default("en"),
    hiredOn: date("hired_on").notNull(),
    ngtecoEmployeeRef: text("ngteco_employee_ref"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("employees_email_unique").on(t.email),
    uniqueIndex("employees_legacy_id_unique")
      .on(t.legacyId)
      .where(sql`${t.legacyId} IS NOT NULL`),
    uniqueIndex("employees_ngteco_ref_unique")
      .on(t.ngtecoEmployeeRef)
      .where(sql`${t.ngtecoEmployeeRef} IS NOT NULL`),
    index("employees_status_idx").on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Employee rate history (versioned, source of truth for pay computation).
// ─────────────────────────────────────────────────────────────────────────────

export const employeeRateHistory = pgTable(
  "employee_rate_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    changedById: uuid("changed_by_id").references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
  },
  (t) => [
    index("rate_history_employee_idx").on(t.employeeId, t.effectiveFrom),
    uniqueIndex("rate_history_unique_per_day").on(t.employeeId, t.effectiveFrom),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Pay periods
// ─────────────────────────────────────────────────────────────────────────────

export const payPeriods = pgTable(
  "pay_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    state: payPeriodStateEnum("state").notNull().default("OPEN"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedById: uuid("locked_by_id").references(() => users.id),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidById: uuid("paid_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pay_periods_start_unique").on(t.startDate),
    index("pay_periods_state_idx").on(t.state),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Punches
// ─────────────────────────────────────────────────────────────────────────────

export const punches = pgTable(
  "punches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    source: punchSourceEnum("source").notNull(),
    ngtecoRecordHash: text("ngteco_record_hash"),
    originalClockIn: timestamp("original_clock_in", { withTimezone: true }),
    originalClockOut: timestamp("original_clock_out", { withTimezone: true }),
    editedById: uuid("edited_by_id").references(() => users.id),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editReason: text("edit_reason"),
    notes: text("notes"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("punches_ngteco_hash_unique")
      .on(t.ngtecoRecordHash)
      .where(sql`${t.ngtecoRecordHash} IS NOT NULL`),
    index("punches_employee_period_idx").on(t.employeeId, t.periodId),
    index("punches_clock_in_idx").on(t.clockIn),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Task pay (flat-fee work, bonuses)
// ─────────────────────────────────────────────────────────────────────────────

export const taskPayLineItems = pgTable(
  "task_pay_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("task_pay_employee_period_idx").on(t.employeeId, t.periodId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Missed-punch alerts + employee-submitted requests
// ─────────────────────────────────────────────────────────────────────────────

export const missedPunchAlerts = pgTable(
  "missed_punch_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    issue: missedPunchIssueEnum("issue").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    linkedRequestId: uuid("linked_request_id"),
  },
  (t) => [
    index("alerts_employee_period_idx").on(t.employeeId, t.periodId),
    index("alerts_unresolved_idx")
      .on(t.periodId)
      .where(sql`${t.resolvedAt} IS NULL`),
  ],
);

export const missedPunchRequests = pgTable(
  "missed_punch_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    alertId: uuid("alert_id").references(() => missedPunchAlerts.id),
    claimedClockIn: timestamp("claimed_clock_in", { withTimezone: true }),
    claimedClockOut: timestamp("claimed_clock_out", { withTimezone: true }),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("PENDING"),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resultingPunchId: uuid("resulting_punch_id").references(() => punches.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("missed_requests_status_idx").on(t.status)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Time off
// ─────────────────────────────────────────────────────────────────────────────

export const timeOffRequests = pgTable(
  "time_off_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    type: timeOffTypeEnum("type").notNull(),
    reason: text("reason"),
    status: requestStatusEnum("status").notNull().default("PENDING"),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("time_off_status_idx").on(t.status)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Payroll runs (orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    state: payrollRunStateEnum("state").notNull().default("SCHEDULED"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    ingestStartedAt: timestamp("ingest_started_at", { withTimezone: true }),
    ingestCompletedAt: timestamp("ingest_completed_at", { withTimezone: true }),
    ingestLogPath: text("ingest_log_path"),
    ingestScreenshotPath: text("ingest_screenshot_path"),
    exceptionSnapshot: jsonb("exception_snapshot"),
    employeeFixDeadline: timestamp("employee_fix_deadline", {
      withTimezone: true,
    }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("runs_period_idx").on(t.periodId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Payslips
// ─────────────────────────────────────────────────────────────────────────────

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "restrict" }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    hoursWorked: numeric("hours_worked", { precision: 8, scale: 4 }).notNull(),
    grossPayCents: integer("gross_pay_cents").notNull(),
    roundedPayCents: integer("rounded_pay_cents").notNull(),
    taskPayCents: integer("task_pay_cents").notNull().default(0),
    pdfPath: text("pdf_path"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payslips_employee_period_unique").on(t.employeeId, t.periodId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientId, t.readAt),
    index("notifications_kind_idx").on(t.kind),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Audit log — every mutation writes a row here BEFORE commit.
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: userRoleEnum("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_target_idx").on(t.targetType, t.targetId),
    index("audit_actor_idx").on(t.actorId),
    index("audit_created_idx").on(t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Settings (k/jsonb).
//
// Owner-controlled levers. Access is *always* through /lib/settings (typed
// getters/setters). Don't read this table directly from feature code.
// ─────────────────────────────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedById: uuid("updated_by_id").references(() => users.id),
});

// ─────────────────────────────────────────────────────────────────────────────
// Holidays
// ─────────────────────────────────────────────────────────────────────────────

export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("holidays_date_unique").on(t.date)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Login rate limiting (Postgres-backed; no Redis dependency).
// ─────────────────────────────────────────────────────────────────────────────

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    email: citext("email").notNull(),
    ip: text("ip").notNull(),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("login_attempts_email_idx").on(t.email, t.attemptedAt),
    index("login_attempts_ip_idx").on(t.ip, t.attemptedAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Inferred row types — re-export from a single place for ergonomics.
// ─────────────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type PayPeriod = typeof payPeriods.$inferSelect;
export type Punch = typeof punches.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
