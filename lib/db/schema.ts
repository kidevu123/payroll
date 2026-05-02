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

export const payTypeEnum = pgEnum("pay_type", [
  "HOURLY",
  "FLAT_TASK",
  // Salaried (e.g. W2 staff prepared by an external accountant). No
  // punch tracking, no auto-computed payslip — admin uploads the W2 /
  // paystub document for the employee to view. Time-off + portal still
  // apply.
  "SALARIED",
]);

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

export const payrollRunSourceEnum = pgEnum("payroll_run_source", [
  "CRON_AUTO",
  "MANUAL_CSV",
  "LEGACY_IMPORT",
  "AD_HOC",
]);

export const payScheduleKindEnum = pgEnum("pay_schedule_kind", [
  "WEEKLY",
  "BIWEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
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
    // Set true when an admin issues a temporary password. The login flow
    // redirects to /login/change-password until cleared by a user-driven
    // password update. Owner/admin onboarding tools set this; the user
    // cannot lower it without changing the password.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
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
// Pay schedules — owner-defined cadences (Weekly Mon-Sat, Semi-Monthly 1-15
// & 16-EOM, etc). Each Employee is assigned exactly one. The payroll.run.tick
// job fires per schedule's cron and only includes employees on that schedule.
// ─────────────────────────────────────────────────────────────────────────────

export const paySchedules = pgTable("pay_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  periodKind: payScheduleKindEnum("period_kind").notNull(),
  // For WEEKLY/BIWEEKLY: 0=Sun..6=Sat, the day the period begins.
  startDayOfWeek: integer("start_day_of_week"),
  // For BIWEEKLY: anchor that pins the alternating cycle.
  anchorDate: date("anchor_date"),
  // Cron expression (5-field) for when this schedule's payroll run should fire.
  cron: text("cron").notNull(),
  active: boolean("active").notNull().default(true),
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
    // Which cadence this employee is paid on. Nullable until the v1.2 migration
    // sets a default for each existing row; the run-tick job ignores employees
    // without an assignment so onboarding stays explicit.
    payScheduleId: uuid("pay_schedule_id").references(() => paySchedules.id),
    // hourlyRateCents is a denormalized cache of the latest EmployeeRateHistory row.
    // Pay computation always reads from history (as of punch.clockIn). Never edit
    // this field directly; it's updated by the rate-history insert trigger.
    hourlyRateCents: integer("hourly_rate_cents"),
    defaultFlatAmountCents: integer("default_flat_amount_cents"),
    language: languageEnum("language").notNull().default("en"),
    hiredOn: date("hired_on").notNull(),
    ngtecoEmployeeRef: text("ngteco_employee_ref"),
    notes: text("notes"),
    /**
     * When true, payroll for this employee requires the admin to upload a
     * W2/paystub document each period (e.g. external accountant prepares it).
     * Surfaces as an "Upload paystub" slot on the period detail.
     */
    requiresW2Upload: boolean("requires_w2_upload").notNull().default(false),
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
// Temp / manual labor entries
// ─────────────────────────────────────────────────────────────────────────────
//
// People who don't punch in (one-off contractors, day-labor) but whose pay
// must show in the period total. Distinct from taskPayLineItems because
// those are keyed to a real Employee row; temp workers are free-text.

export const tempWorkerEntries = pgTable(
  "temp_worker_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payPeriods.id, { onDelete: "restrict" }),
    workerName: text("worker_name").notNull(),
    description: text("description"),
    // Optional. Many temp jobs are flat-fee with no hour record.
    hours: numeric("hours", { precision: 6, scale: 2 }),
    amountCents: integer("amount_cents").notNull(),
    notes: text("notes"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedById: uuid("deleted_by_id").references(() => users.id),
  },
  (t) => [
    index("temp_worker_period_idx").on(t.periodId),
    index("temp_worker_active_idx")
      .on(t.periodId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Payroll period documents (W2 / paystub uploads)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per-(period, employee) artefacts for employees who need an externally
// prepared paystub or W2. Drives the "your paystub is ready" view on the
// employee portal. Storage is filesystem at PAYROLL_DOC_ROOT (default
// /data/uploads/payroll-docs).

export const payrollPeriodDocumentKindEnum = pgEnum(
  "payroll_period_document_kind",
  ["W2", "PAYSTUB", "OTHER"],
);

export const payrollPeriodDocuments = pgTable(
  "payroll_period_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable: salaried employees are paid externally and their W2 /
     *  paystub uploads aren't tied to a payroll period. Per-period
     *  uploads (the requiresW2Upload flow on the period detail page)
     *  populate this field. The Salaried tab leaves it null. */
    periodId: uuid("period_id").references(() => payPeriods.id, {
      onDelete: "restrict",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    kind: payrollPeriodDocumentKindEnum("kind").notNull().default("PAYSTUB"),
    filePath: text("file_path").notNull(),
    mime: text("mime").notNull(),
    originalFilename: text("original_filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    visibleToEmployee: boolean("visible_to_employee").notNull().default(true),
    /** Pay period the document covers — populated for salaried paystubs so
     *  the employee + admin see "this is for the 4/16–4/30 cycle" without
     *  having to open the PDF. Free-form when periodId isn't set. */
    payPeriodStart: date("pay_period_start"),
    payPeriodEnd: date("pay_period_end"),
    /** Net amount on the paystub, integer cents. Nullable for non-paystub
     *  uploads (W2, OTHER) where amount doesn't apply. */
    amountCents: integer("amount_cents"),
    /** When this doc was successfully pushed to a Zoho expense, the
     *  expense ID. NULL means no push has happened yet (or the last
     *  push failed). Used for idempotency on the "Push to Zoho" button. */
    zohoExpenseId: text("zoho_expense_id"),
    zohoOrganizationId: uuid("zoho_organization_id").references(
      () => zohoOrganizations.id,
    ),
    zohoPushedAt: timestamp("zoho_pushed_at", { withTimezone: true }),
    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedById: uuid("deleted_by_id").references(() => users.id),
  },
  (t) => [
    index("payroll_period_documents_period_idx").on(t.periodId),
    index("payroll_period_documents_employee_idx").on(t.employeeId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// NGTeco poll log
// ─────────────────────────────────────────────────────────────────────────────
//
// Append-only history of every punch.poll run (cron + manual). Surfaces
// "last poll was N min ago, imported X" in the admin UI.

export const ngtecoPollLog = pgTable(
  "ngteco_poll_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Manual button vs scheduled cron. */
    triggeredBy: text("triggered_by").notNull(), // 'CRON' | 'MANUAL'
    triggeredById: uuid("triggered_by_id").references(() => users.id),
    ok: boolean("ok").notNull().default(false),
    eventsScraped: integer("events_scraped"),
    pairsInserted: integer("pairs_inserted"),
    pairsUpdated: integer("pairs_updated"),
    errorMessage: text("error_message"),
  },
  (t) => [index("ngteco_poll_log_started_idx").on(t.startedAt)],
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
    // Distinct from publishedAt: this is when the report becomes visible to
    // employees in /me/pay. Auto-populated for cron-triggered runs at the
    // moment of admin Approve; manual CSV-uploaded runs require an explicit
    // Publish click. Push notifications fire only at Publish.
    publishedToPortalAt: timestamp("published_to_portal_at", { withTimezone: true }),
    source: payrollRunSourceEnum("source").notNull().default("CRON_AUTO"),
    payScheduleId: uuid("pay_schedule_id").references(() => paySchedules.id),
    // For LEGACY_IMPORT rows: the total dollar amount from the historic
    // metadata file. For other sources: NULL (sum of payslips is authoritative).
    totalAmountCents: integer("total_amount_cents"),
    // Display string for the Reports table when the actor was a legacy admin
    // username (e.g. "rita") that doesn't map to a Users row.
    createdByName: text("created_by_name"),
    // Posting date shown on the Reports table — the user-visible "when did
    // this report exist". For legacy: the file mtime. For cron/manual: NULL,
    // and the table falls back to publishedAt or approvedAt.
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // Stored PDF path for legacy reports (and for admin-uploaded report
    // attachments). Served from /api/reports/[id]/pdf.
    pdfPath: text("pdf_path"),
    /**
     * Admin-locked cohort for manual runs. When set, only these employees
     * appear in the run's payslips, regardless of pay schedule. Set during
     * the CSV upload preview step when the admin explicitly checks who to
     * pay this period. NULL = include all employees who match the run's
     * pay schedule (the legacy / cron behavior).
     */
    cohortEmployeeIds: jsonb("cohort_employee_ids").$type<string[]>(),
    retryCount: integer("retry_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("runs_period_idx").on(t.periodId),
    index("runs_source_idx").on(t.source),
    index("runs_published_portal_idx").on(t.publishedToPortalAt),
  ],
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
    /**
     * Soft-delete for individual payslips. When the admin says "this person
     * shouldn't be on this run" (e.g. Juan ended up in the weekly run before
     * his pay-schedule was set), they void the payslip from /payroll/[id].
     * Voided payslips are excluded from listings, totals, the employee
     * portal, and the run's recomputed amount.
     */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: uuid("voided_by_id").references(() => users.id),
    voidReason: text("void_reason"),
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
// Ingest exceptions — promoted from payroll_runs.exception_snapshot to a
// queryable table in Phase 2. Each row is one unmatched / parse-error /
// duplicate-hash candidate from a NGTeco import. The owner resolves them
// (e.g. binds an unmatched ngteco_employee_ref to an existing Employee)
// from /ngteco/[runId]; resolved_at + resolved_by_id close it out.
// ─────────────────────────────────────────────────────────────────────────────

export const ingestExceptions = pgTable(
  "ingest_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'UNMATCHED_REF' | 'PARSE_ERROR' | 'DUPLICATE_HASH'
    ngtecoEmployeeRef: text("ngteco_employee_ref"),
    rawData: jsonb("raw_data"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ingest_exceptions_run_idx").on(t.payrollRunId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Web Push subscriptions — one row per device. Phase 5.
// VAPID keys live in /etc/payroll/.env and are generated by install.sh.
// ─────────────────────────────────────────────────────────────────────────────

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subs_endpoint_unique").on(t.endpoint),
    index("push_subs_user_idx").on(t.userId),
  ],
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
// Zoho organizations — one row per company we push expenses to (Haute,
// Boomin, etc). The OAuth refresh token is encrypted at rest via the same
// AES-GCM vault used for NGTeco credentials.
// ─────────────────────────────────────────────────────────────────────────────

export const zohoOrganizations = pgTable(
  "zoho_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Display label shown in Settings + the Reports push buttons (e.g. "Haute").
    name: text("name").notNull(),
    // Zoho Books organization_id (numeric string). Pinned per company.
    organizationId: text("organization_id").notNull(),
    // OAuth refresh token, sealed via lib/crypto/vault.ts. Stored as the
    // standard `{ ciphertext, iv }` envelope; only lib/zoho/* decrypts.
    refreshTokenEncrypted: jsonb("refresh_token_encrypted"),
    // OAuth client credentials are also sealed (per-org because the legacy app
    // had a different Zoho app per company).
    clientIdEncrypted: jsonb("client_id_encrypted"),
    clientSecretEncrypted: jsonb("client_secret_encrypted"),
    // Zoho data-center domain — defaults to https://www.zohoapis.com but US-EU
    // tenants vary. accountsDomain pairs it for token refresh.
    apiDomain: text("api_domain").notNull().default("https://www.zohoapis.com"),
    accountsDomain: text("accounts_domain")
      .notNull()
      .default("https://accounts.zoho.com"),
    // Mapping for the expense push: which expense account + vendor to charge.
    // Strings to allow either an ID or a friendly name for a one-time lookup.
    defaultExpenseAccountName: text("default_expense_account_name"),
    defaultExpenseAccountId: text("default_expense_account_id"),
    defaultPaidThroughName: text("default_paid_through_name"),
    defaultPaidThroughId: text("default_paid_through_id"),
    defaultVendorName: text("default_vendor_name"),
    defaultVendorId: text("default_vendor_id"),
    active: boolean("active").notNull().default(true),
    lastConnectionTestAt: timestamp("last_connection_test_at", {
      withTimezone: true,
    }),
    lastConnectionTestOk: boolean("last_connection_test_ok"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("zoho_orgs_name_unique").on(t.name),
    index("zoho_orgs_active_idx").on(t.active),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Zoho push log — one row per attempt. Idempotency lives at the (run_id, org_id)
// level: a successful push is unique on those two columns. Re-pressing the
// button on the Reports table loads the existing successful row instead of
// re-pushing.
// ─────────────────────────────────────────────────────────────────────────────

export const zohoPushes = pgTable(
  "zoho_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => zohoOrganizations.id, { onDelete: "restrict" }),
    expenseId: text("expense_id"), // Zoho's returned id when successful
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(), // 'OK' | 'ERROR'
    errorMessage: text("error_message"),
    pushedById: uuid("pushed_by_id").references(() => users.id),
    pushedAt: timestamp("pushed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("zoho_pushes_run_idx").on(t.payrollRunId),
    uniqueIndex("zoho_pushes_run_org_ok_unique")
      .on(t.payrollRunId, t.organizationId)
      .where(sql`${t.status} = 'OK'`),
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
export type NewShift = typeof shifts.$inferInsert;
export type PayPeriod = typeof payPeriods.$inferSelect;
export type NewPayPeriod = typeof payPeriods.$inferInsert;
export type Punch = typeof punches.$inferSelect;
export type NewPunch = typeof punches.$inferInsert;
export type EmployeeRateHistoryRow = typeof employeeRateHistory.$inferSelect;
export type NewEmployeeRateHistory = typeof employeeRateHistory.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type NewPayrollRun = typeof payrollRuns.$inferInsert;
export type IngestException = typeof ingestExceptions.$inferSelect;
export type NewIngestException = typeof ingestExceptions.$inferInsert;
export type MissedPunchAlert = typeof missedPunchAlerts.$inferSelect;
export type NewMissedPunchAlert = typeof missedPunchAlerts.$inferInsert;
export type MissedPunchRequest = typeof missedPunchRequests.$inferSelect;
export type NewMissedPunchRequest = typeof missedPunchRequests.$inferInsert;
export type TimeOffRequest = typeof timeOffRequests.$inferSelect;
export type NewTimeOffRequest = typeof timeOffRequests.$inferInsert;
export type Holiday = typeof holidays.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
export type NewPayslip = typeof payslips.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type PaySchedule = typeof paySchedules.$inferSelect;
export type NewPaySchedule = typeof paySchedules.$inferInsert;
export type ZohoOrganization = typeof zohoOrganizations.$inferSelect;
export type NewZohoOrganization = typeof zohoOrganizations.$inferInsert;
export type ZohoPush = typeof zohoPushes.$inferSelect;
export type NewZohoPush = typeof zohoPushes.$inferInsert;
export type TempWorkerEntry = typeof tempWorkerEntries.$inferSelect;
export type NewTempWorkerEntry = typeof tempWorkerEntries.$inferInsert;
export type NgtecoPollLogRow = typeof ngtecoPollLog.$inferSelect;
export type NewNgtecoPollLogRow = typeof ngtecoPollLog.$inferInsert;
export type PayrollPeriodDocument = typeof payrollPeriodDocuments.$inferSelect;
export type NewPayrollPeriodDocument = typeof payrollPeriodDocuments.$inferInsert;
