// Legacy data import. Pulls the Flask app's JSON + CSV state into the
// new Drizzle schema. Idempotent: re-running --apply with no new source
// data is a no-op for employees / punches / time-off; the reports section
// always wipes and re-imports (it's keyed off the metadata file, which is
// the authoritative listing).
//
// Source layout (from /data/legacy = ./data/legacy on the host):
//   users.json, pay_rates.json, temp_workers.json, time_off_requests.json
//   uploads/*.csv                              — NGTeco-format punch exports
//   static/reports/reports_metadata.json       — authoritative report listing
//   static/reports/admin_report_<date>.{xlsx|pdf}
//
// Reports — v1.2: rewritten so /reports shows the legacy 24+ rows instead
// of 60 derived periods. We:
//   1. Wipe existing payroll_runs (and their payslips) tagged
//      source = LEGACY_IMPORT.
//   2. For each metadata entry, UPSERT a pay_period (by start_date) and
//      INSERT a payroll_run with source = LEGACY_IMPORT, total_amount_cents,
//      created_by_name, posted_at = mtime, pay_schedule_id (SM if 14+ day
//      span starting on the 1st or 16th, else WEEKLY), and pdf_path if a
//      matching PDF exists.
//   3. Copy the matching PDF (if any) from static/reports/<file>.pdf to
//      /data/payslips/legacy/<startDate>__<endDate>/report.pdf.
//   4. Migrate Juan (legacy_id=9) to the Semi-Monthly schedule.
//
// Per-employee payslips are no longer materialised for legacy reports;
// /payroll/[periodId] computes employee totals on-the-fly from punches.

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql as dsql } from "drizzle-orm";
import {
  employees,
  employeeRateHistory,
  payPeriods,
  payrollRuns,
  payslips,
  punches,
  timeOffRequests,
  paySchedules,
  auditLog,
} from "../lib/db/schema";

const LEGACY_ROOT = process.env.LEGACY_ROOT ?? "/data/legacy";
const PAYSLIP_OUT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";
const REPORTS_DIR = join(LEGACY_ROOT, "static", "reports");
const METADATA_PATH = join(REPORTS_DIR, "reports_metadata.json");

type LegacyUser = {
  password: string;
  role: "admin" | "staff" | "employee";
  name: string;
  employee_id: string;
};
type LegacyRate = { rate: number; shift_type: string; name: string };
type LegacyTempEntry = {
  entry_id: string;
  person_id: string;
  date: string;
  clock_in: string;
  clock_out: string;
  notes: string;
};
type LegacyTempWorkers = {
  workers: Record<
    string,
    { first_name: string; last_name: string; rate: number; shift_type: string }
  >;
  entries: LegacyTempEntry[];
};
type LegacyTimeOff = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  type: string;
  note: string;
  status: "denied" | "approved" | "pending";
  reviewed_by?: string;
};

type ReportMeta = {
  filename: string;
  mtime: number;
  creator: string;
  totalAmount: number;
  startDate: string;
  endDate: string;
};

const TZ_OFFSET_MINUTES = -240;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizePersonId(s: string): string {
  if (s.startsWith("TEMP_")) return s;
  return String(Math.trunc(Number(s.replace(/^0+/, "") || "0")));
}

function parseLegacyDate(s: string): string | null {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) {
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    let y = us[3]!;
    if (y.length === 2) {
      // Same pivot as lib/punches/parser.ts — if 20YY would land more than
      // ~6 months in the future, treat as 19YY. Catches "12/27/25" punches
      // misread as 2026-12-27 by earlier imports.
      const candidate = 2000 + Number(y);
      const candidateMs = new Date(`${candidate}-${m}-${d}T12:00:00Z`).getTime();
      const sixMonths = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
      y = String(candidateMs > sixMonths ? candidate - 100 : candidate);
    }
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseLegacyTime(date: string, hms: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms.trim());
  if (!m) return null;
  const isoLocal = `${date}T${m[1]!.padStart(2, "0")}:${m[2]}:${(m[3] ?? "00").padStart(2, "0")}`;
  const naiveUtc = new Date(`${isoLocal}Z`);
  return new Date(naiveUtc.getTime() + Math.abs(TZ_OFFSET_MINUTES) * 60_000);
}

function periodFor(dateIso: string): { start: string; end: string } {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const fwd = (6 - dow + 7) % 7;
  const end = new Date(d.getTime() + fwd * 86_400_000);
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = line.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = (cells[j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

/**
 * Parse the Flask app's reports_metadata.json into a normalized list.
 * Each entry already carries date_range when known; for older rows where
 * the field is missing or null, we derive it from the filename date as
 * the period start and assume a 6-day weekly span.
 */
function loadReportsMetadata(): ReportMeta[] {
  if (!existsSync(METADATA_PATH)) {
    console.warn(`legacy-import: ${METADATA_PATH} not found; skipping reports.`);
    return [];
  }
  const raw = JSON.parse(readFileSync(METADATA_PATH, "utf8")) as Record<
    string,
    {
      mtime: number;
      creator: string;
      total_amount: number;
      date_range?: string | null;
    }
  >;
  const out: ReportMeta[] = [];
  for (const [filename, meta] of Object.entries(raw)) {
    const startFromName = /^admin_report_(\d{4}-\d{2}-\d{2})\./.exec(filename);
    if (!startFromName) continue;
    const fileDate = startFromName[1]!;
    let startDate: string;
    let endDate: string;
    if (meta.date_range) {
      const m = /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/.exec(meta.date_range);
      if (!m) {
        // Malformed date range → fall back to 6-day weekly from filename.
        startDate = fileDate;
        endDate = new Date(new Date(`${fileDate}T00:00:00Z`).getTime() + 5 * 86_400_000)
          .toISOString()
          .slice(0, 10);
      } else {
        startDate = m[1]!;
        endDate = m[2]!;
      }
    } else {
      // No explicit range — use file date as end, assume 6-day weekly window
      // ending on the report's posting/period-end date (legacy convention).
      endDate = fileDate;
      startDate = new Date(new Date(`${fileDate}T00:00:00Z`).getTime() - 5 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    out.push({
      filename,
      mtime: meta.mtime,
      creator: meta.creator || "Unknown",
      totalAmount: meta.total_amount,
      startDate,
      endDate,
    });
  }
  // Sort by posting date, newest first — the import order matches /reports.
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Heuristic: a period is semi-monthly if it spans 14+ days and starts on
 * the 1st or 16th. Otherwise weekly. Matches the legacy app's only two
 * cadences (weekly per shift, semi-monthly for Juan).
 */
function classifySchedule(startDate: string, endDate: string): "WEEKLY" | "SEMI_MONTHLY" {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const dom = start.getUTCDate();
  if (days >= 14 && (dom === 1 || dom === 16)) return "SEMI_MONTHLY";
  return "WEEKLY";
}

type EmpPlan = {
  legacyId: string;
  displayName: string;
  legalName: string;
  rateCents: number;
  payType: "HOURLY" | "FLAT_TASK";
  hiredOn: string;
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`legacy-import: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`legacy-import: source=${LEGACY_ROOT}`);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    if (!existsSync(LEGACY_ROOT)) {
      console.warn(`legacy-import: ${LEGACY_ROOT} not present — nothing to do.`);
      return;
    }

    const users: Record<string, LegacyUser> = JSON.parse(
      readFileSync(join(LEGACY_ROOT, "users.json"), "utf8"),
    );
    const rates: Record<string, LegacyRate> = JSON.parse(
      readFileSync(join(LEGACY_ROOT, "pay_rates.json"), "utf8"),
    );
    const temp: LegacyTempWorkers = JSON.parse(
      readFileSync(join(LEGACY_ROOT, "temp_workers.json"), "utf8"),
    );
    const timeOff: LegacyTimeOff[] = JSON.parse(
      readFileSync(join(LEGACY_ROOT, "time_off_requests.json"), "utf8"),
    );
    const reports = loadReportsMetadata();

    // ── Plan: employees ──────────────────────────────────────────────────────
    const empPlans: EmpPlan[] = [];
    for (const [k, u] of Object.entries(users)) {
      if (u.role !== "employee") continue;
      const legacyId = u.employee_id || k;
      const rate = rates[legacyId];
      if (!rate) continue;
      const realName = u.name && u.name !== legacyId ? u.name : rate.name || `Employee ${legacyId}`;
      empPlans.push({
        legacyId,
        displayName: titleCase(realName),
        legalName: realName,
        rateCents: Math.round(rate.rate * 100),
        payType: legacyId.startsWith("TEMP_") ? "FLAT_TASK" : "HOURLY",
        hiredOn: "2025-01-01",
      });
    }
    for (const [k, w] of Object.entries(temp.workers)) {
      if (empPlans.some((e) => e.legacyId === k)) continue;
      const realName = `${w.first_name} ${w.last_name}`.trim();
      empPlans.push({
        legacyId: k,
        displayName: titleCase(realName),
        legalName: realName,
        rateCents: Math.round(w.rate * 100),
        payType: "FLAT_TASK",
        hiredOn: "2025-01-01",
      });
    }

    // ── Plan: punches (deduped by employee × clockIn) ────────────────────────
    type PunchPlan = {
      legacyId: string;
      clockIn: Date;
      clockOut: Date | null;
      dayIso: string;
    };
    const punchMap = new Map<string, PunchPlan>();

    const uploadsDir = join(LEGACY_ROOT, "uploads");
    const csvs = existsSync(uploadsDir)
      ? readdirSync(uploadsDir).filter((f) => f.toLowerCase().endsWith(".csv"))
      : [];
    let csvSkipped = 0;
    for (const f of csvs) {
      let rows: Record<string, string>[];
      try {
        rows = await readCsv(join(uploadsDir, f));
      } catch {
        csvSkipped++;
        continue;
      }
      for (const r of rows) {
        const pid = normalizePersonId(r["Person ID"] ?? r["person_id"] ?? "");
        if (!pid) continue;
        const dateIso = parseLegacyDate(r.Date ?? r.date ?? "");
        if (!dateIso) continue;
        const inT = parseLegacyTime(dateIso, r["Clock In"] ?? r.clock_in ?? "");
        const outT = parseLegacyTime(dateIso, r["Clock Out"] ?? r.clock_out ?? "");
        if (!inT) continue;
        const key = `${pid}|${inT.toISOString()}`;
        if (!punchMap.has(key)) {
          punchMap.set(key, { legacyId: pid, clockIn: inT, clockOut: outT, dayIso: dateIso });
        }
      }
    }

    for (const e of temp.entries) {
      const inT = parseLegacyTime(e.date, e.clock_in);
      const outT = parseLegacyTime(e.date, e.clock_out);
      if (!inT) continue;
      const key = `${e.person_id}|${inT.toISOString()}`;
      if (!punchMap.has(key)) {
        punchMap.set(key, { legacyId: e.person_id, clockIn: inT, clockOut: outT, dayIso: e.date });
      }
    }

    console.log("");
    console.log("=== PLAN ===");
    console.log(`employees:  ${empPlans.length}`);
    console.log(`punches:    ${punchMap.size} (CSVs read: ${csvs.length}, skipped: ${csvSkipped})`);
    console.log(`time-off:   ${timeOff.length}`);
    console.log(`reports:    ${reports.length}`);
    console.log("");

    if (!apply) {
      console.log("DRY RUN. Re-run with --apply to commit.");
      return;
    }

    // ── APPLY: 1. Employees + initial rate history (idempotent by legacyId).
    const empIdByLegacy = new Map<string, string>();
    for (const e of empPlans) {
      const [existing] = await db
        .select()
        .from(employees)
        .where(eq(employees.legacyId, e.legacyId));
      if (existing) {
        empIdByLegacy.set(e.legacyId, existing.id);
        continue;
      }
      const [row] = await db
        .insert(employees)
        .values({
          legacyId: e.legacyId,
          displayName: e.displayName,
          legalName: e.legalName,
          email: `legacy.${e.legacyId.toLowerCase()}@local`,
          payType: e.payType,
          hourlyRateCents: e.rateCents,
          hiredOn: e.hiredOn,
          ngtecoEmployeeRef: e.legacyId.startsWith("TEMP_") ? null : e.legacyId,
          status: "ACTIVE",
        })
        .returning();
      if (!row) continue;
      empIdByLegacy.set(e.legacyId, row.id);
      await db.insert(employeeRateHistory).values({
        employeeId: row.id,
        effectiveFrom: e.hiredOn,
        hourlyRateCents: e.rateCents,
        reason: "Imported from legacy app",
      });
      await db.insert(auditLog).values({
        actorId: null,
        actorRole: null,
        action: "employee.legacy_import",
        targetType: "Employee",
        targetId: row.id,
        after: row,
      });
    }
    console.log(`[apply] employees: ${empIdByLegacy.size}`);

    // ── APPLY: 2. Wipe legacy reports cleanly so the metadata file is
    //               authoritative for /reports.
    await client`
      DELETE FROM payslips
      WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE source = 'LEGACY_IMPORT')
    `;
    const runWipe = await client`
      DELETE FROM payroll_runs WHERE source = 'LEGACY_IMPORT'
    `;
    console.log(`[apply] wiped legacy runs: ${runWipe.count}`);

    // Also purge ghost pay_periods left behind by earlier imports — periods
    // with no punches AND no payroll_runs. Catches the 2026-12-27 → 2027-01-02
    // row that the v1.2 2-digit-year bug created from a "12/27/26" row in
    // the legacy CSV.
    const ghostWipe = await client`
      DELETE FROM pay_periods p
      WHERE NOT EXISTS (SELECT 1 FROM punches WHERE period_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM payroll_runs WHERE period_id = p.id)
    `;
    console.log(`[apply] purged ghost periods: ${ghostWipe.count}`);

    // One-time: any pay_period that starts AFTER today (which can only
    // happen via the parsed-as-future-year bug) loses its associated
    // punches/payslips/runs and is itself deleted. The Step 6 punch
    // re-import will land them at the correct year via the fixed
    // parseLegacyDate.
    const futureWipe = await client`
      WITH future_periods AS (
        SELECT id FROM pay_periods WHERE start_date > NOW()::date + INTERVAL '60 days'
      )
      , del_payslips AS (
        DELETE FROM payslips WHERE period_id IN (SELECT id FROM future_periods)
      )
      , del_punches AS (
        DELETE FROM punches WHERE period_id IN (SELECT id FROM future_periods)
      )
      , del_runs AS (
        DELETE FROM payroll_runs WHERE period_id IN (SELECT id FROM future_periods)
      )
      DELETE FROM pay_periods WHERE id IN (SELECT id FROM future_periods)
    `;
    console.log(`[apply] purged future-dated periods: ${futureWipe.count}`);

    // ── APPLY: 3. Resolve pay schedules for the run-tagging step.
    const [weeklySchedule] = await db
      .select()
      .from(paySchedules)
      .where(eq(paySchedules.name, "Weekly"));
    const [smSchedule] = await db
      .select()
      .from(paySchedules)
      .where(eq(paySchedules.name, "Semi-Monthly"));
    if (!weeklySchedule || !smSchedule) {
      throw new Error(
        "legacy-import: default pay schedules missing — run scripts/migrate.ts first.",
      );
    }

    // ── APPLY: 4. Migrate Juan (legacy_id=9) to the Semi-Monthly schedule.
    const juanId = empIdByLegacy.get("9");
    if (juanId) {
      await db
        .update(employees)
        .set({ payScheduleId: smSchedule.id, updatedAt: new Date() })
        .where(eq(employees.id, juanId));
      console.log(`[apply] Juan → Semi-Monthly`);
    }
    // Everyone else with no schedule yet → Weekly default.
    await client`
      UPDATE employees
      SET pay_schedule_id = ${weeklySchedule.id}, updated_at = NOW()
      WHERE pay_schedule_id IS NULL
        AND id <> COALESCE(${juanId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    `;

    // Build a quick map filename → on-disk path so PDF copies are cheap.
    const reportFiles = existsSync(REPORTS_DIR) ? readdirSync(REPORTS_DIR) : [];
    const pdfByDate = new Map<string, string>();
    for (const f of reportFiles) {
      const m = /^admin_report_(\d{4}-\d{2}-\d{2})\.pdf$/i.exec(f);
      if (m) pdfByDate.set(m[1]!, join(REPORTS_DIR, f));
    }
    const legacyOutRoot = join(PAYSLIP_OUT, "legacy");

    // ── APPLY: 5. For each metadata entry, ensure a pay_period and create
    //               a payroll_run with source = LEGACY_IMPORT.
    let runsInserted = 0;
    let pdfsCopied = 0;
    let pdfsMissing = 0;
    for (const r of reports) {
      // Resolve / create period.
      const [existingPeriod] = await db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.startDate, r.startDate));
      let periodId: string;
      if (existingPeriod) {
        periodId = existingPeriod.id;
        // Sync end_date / state if drifted.
        if (
          existingPeriod.endDate !== r.endDate ||
          existingPeriod.state !== "PAID"
        ) {
          await db
            .update(payPeriods)
            .set({ endDate: r.endDate, state: "PAID" })
            .where(eq(payPeriods.id, periodId));
        }
      } else {
        const [row] = await db
          .insert(payPeriods)
          .values({
            startDate: r.startDate,
            endDate: r.endDate,
            state: "PAID",
            paidAt: new Date(r.mtime * 1000),
          })
          .returning();
        if (!row) throw new Error("legacy-import: period insert returned no row");
        periodId = row.id;
      }

      // Copy PDF if available. Filename in metadata may be .xlsx; the .pdf
      // sibling (if it exists) is what we serve.
      let pdfPath: string | null = null;
      const baseDate = (/^admin_report_(\d{4}-\d{2}-\d{2})/.exec(r.filename) ?? [, ""])[1]!;
      const pdfSrc = pdfByDate.get(baseDate);
      if (pdfSrc) {
        const outDir = join(legacyOutRoot, `${r.startDate}__${r.endDate}`);
        mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, "report.pdf");
        if (!existsSync(outPath)) {
          copyFileSync(pdfSrc, outPath);
          pdfsCopied++;
        }
        pdfPath = outPath;
      } else {
        // Also accept the .xlsx as a fallback so admins can still download
        // _something_ for older periods that pre-date PDF generation.
        const xlsxSrc = join(REPORTS_DIR, r.filename);
        if (existsSync(xlsxSrc)) {
          const outDir = join(legacyOutRoot, `${r.startDate}__${r.endDate}`);
          mkdirSync(outDir, { recursive: true });
          const ext = extname(r.filename) || ".xlsx";
          const outPath = join(outDir, `report${ext}`);
          if (!existsSync(outPath)) {
            copyFileSync(xlsxSrc, outPath);
            pdfsCopied++;
          }
          pdfPath = outPath;
        } else {
          pdfsMissing++;
        }
      }

      const kind = classifySchedule(r.startDate, r.endDate);
      const scheduleId =
        kind === "SEMI_MONTHLY" ? smSchedule.id : weeklySchedule.id;
      const postedAt = new Date(r.mtime * 1000);

      await db.insert(payrollRuns).values({
        periodId,
        state: "PUBLISHED",
        scheduledFor: postedAt,
        ingestStartedAt: postedAt,
        ingestCompletedAt: postedAt,
        approvedAt: postedAt,
        publishedAt: postedAt,
        publishedToPortalAt: postedAt,
        postedAt,
        source: "LEGACY_IMPORT",
        payScheduleId: scheduleId,
        totalAmountCents: Math.round(r.totalAmount * 100),
        createdByName: r.creator,
        pdfPath,
      });
      runsInserted++;
    }
    console.log(
      `[apply] legacy reports: runs=${runsInserted}, pdfs copied=${pdfsCopied}, missing=${pdfsMissing}`,
    );

    // ── APPLY: 6. Punches (skip if existing punch for the same (employee, clockIn)).
    let punchInserted = 0;
    let punchSkipped = 0;
    // Cache period lookups by week-start.
    const periodCache = new Map<string, string>();
    async function resolveWeeklyPeriodId(dateIso: string): Promise<string | null> {
      const { start, end } = periodFor(dateIso);
      const cached = periodCache.get(start);
      if (cached) return cached;
      const [existing] = await db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.startDate, start));
      if (existing) {
        periodCache.set(start, existing.id);
        return existing.id;
      }
      // Punches landing outside any imported report's period — synthesize a
      // weekly period so the FK can be satisfied. State stays OPEN; there's
      // no payroll_run on it, so it won't show in /reports.
      const [row] = await db
        .insert(payPeriods)
        .values({ startDate: start, endDate: end, state: "OPEN" })
        .returning();
      if (!row) return null;
      periodCache.set(start, row.id);
      return row.id;
    }
    const futureCutoffMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
    for (const p of punchMap.values()) {
      const empId = empIdByLegacy.get(p.legacyId);
      if (!empId) {
        punchSkipped++;
        continue;
      }
      // Drop punches dated more than 60 days in the future. The legacy
      // CSVs contain a few "12/27/2026" rows that are obvious data-entry
      // typos for 2025 — leaving them in the DB creates ghost periods on
      // /payroll. The owner can re-add the punch through the manual
      // editor once that's available (gap item 1 in legacy-feature-gaps).
      if (p.clockIn.getTime() > futureCutoffMs) {
        punchSkipped++;
        continue;
      }
      const periodId = await resolveWeeklyPeriodId(p.dayIso);
      if (!periodId) {
        punchSkipped++;
        continue;
      }
      const dup = await client`
        SELECT 1 FROM punches
        WHERE employee_id = ${empId}
          AND clock_in = ${p.clockIn.toISOString()}::timestamptz
        LIMIT 1
      `;
      if (dup.length > 0) {
        punchSkipped++;
        continue;
      }
      await db.insert(punches).values({
        employeeId: empId,
        periodId,
        clockIn: p.clockIn,
        clockOut: p.clockOut ?? null,
        source: "LEGACY_IMPORT",
      });
      punchInserted++;
    }
    console.log(`[apply] punches: inserted=${punchInserted} skipped=${punchSkipped}`);

    // ── APPLY: 7. Time off (idempotent by employee + dates).
    let toInserted = 0;
    for (const t of timeOff) {
      const empId = empIdByLegacy.get(t.employee_id);
      if (!empId) continue;
      const dup = await client`
        SELECT 1 FROM time_off_requests
        WHERE employee_id = ${empId}
          AND start_date = ${t.start_date}::date
          AND end_date = ${t.end_date}::date
        LIMIT 1
      `;
      if (dup.length > 0) continue;
      const status =
        t.status === "approved" ? "APPROVED" : t.status === "denied" ? "REJECTED" : "PENDING";
      await db.insert(timeOffRequests).values({
        employeeId: empId,
        startDate: t.start_date,
        endDate: t.end_date,
        type:
          t.type.toLowerCase() === "sick"
            ? "SICK"
            : t.type.toLowerCase() === "personal"
              ? "PERSONAL"
              : t.type.toLowerCase() === "unpaid"
                ? "UNPAID"
                : "OTHER",
        reason: t.note || null,
        status,
        resolvedAt: status === "PENDING" ? null : new Date(),
      });
      toInserted++;
    }
    console.log(`[apply] time-off: ${toInserted}`);

    // ── APPLY: 8. Materialize per-employee payslips for every LEGACY_IMPORT
    //               run so /me/pay shows historical paychecks. Per-employee
    //               hours come from punches that fall in [start, end]; rate
    //               is the employee's current hourlyRateCents (close enough
    //               for legacy data — the Flask app didn't track rate
    //               history per-period either). The rounded total respects
    //               the active payRules.rounding rule.
    const { roundCents } = await import("../lib/payroll/rounding");
    const payRulesRow = await client<{ value: { rounding?: string } | null }[]>`
      SELECT value FROM settings WHERE key = 'payRules'
    `;
    const roundingRule = (payRulesRow[0]?.value?.rounding ?? "NEAREST_DOLLAR") as
      | "NONE"
      | "NEAREST_DOLLAR"
      | "NEAREST_QUARTER"
      | "NEAREST_FIFTEEN_MIN_HOURS";
    const legacyRuns = await client<{
      id: string;
      pay_schedule_id: string | null;
      start_date: string;
      end_date: string;
      period_id: string;
    }[]>`
      SELECT r.id, r.pay_schedule_id, p.start_date, p.end_date, r.period_id
      FROM payroll_runs r
      JOIN pay_periods p ON p.id = r.period_id
      WHERE r.source = 'LEGACY_IMPORT'
    `;
    let payslipsInserted = 0;
    for (const r of legacyRuns) {
      const empsOnSchedule = r.pay_schedule_id
        ? await client<{
            id: string;
            display_name: string;
            hourly_rate_cents: number | null;
          }[]>`
            SELECT id, display_name, hourly_rate_cents
            FROM employees
            WHERE pay_schedule_id = ${r.pay_schedule_id}
          `
        : await client<{
            id: string;
            display_name: string;
            hourly_rate_cents: number | null;
          }[]>`
            SELECT id, display_name, hourly_rate_cents FROM employees
          `;
      for (const e of empsOnSchedule) {
        // Hours from punches in [start_date, end_date].
        const hoursRow = await client<{ hours: number | null }[]>`
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0), 0)::float8 AS hours
          FROM punches
          WHERE employee_id = ${e.id}
            AND clock_out IS NOT NULL
            AND voided_at IS NULL
            AND clock_in >= ${r.start_date}::date
            AND clock_in < (${r.end_date}::date + INTERVAL '1 day')
        `;
        const hours = Number(hoursRow[0]?.hours ?? 0);
        if (hours <= 0) continue;
        const rate = e.hourly_rate_cents ?? 0;
        const gross = Math.round(hours * rate);
        const rounded = roundCents(gross, roundingRule);
        // ON CONFLICT on (employee_id, period_id) — overwrites payroll_run_id
        // and re-syncs hours/gross.
        await client`
          INSERT INTO payslips (
            employee_id, period_id, payroll_run_id,
            hours_worked, gross_pay_cents, rounded_pay_cents, task_pay_cents,
            published_at
          )
          VALUES (
            ${e.id}, ${r.period_id}, ${r.id},
            ${hours.toFixed(2)}, ${gross}, ${rounded}, 0,
            NOW()
          )
          ON CONFLICT (employee_id, period_id) DO UPDATE
          SET payroll_run_id = EXCLUDED.payroll_run_id,
              hours_worked = EXCLUDED.hours_worked,
              gross_pay_cents = EXCLUDED.gross_pay_cents,
              rounded_pay_cents = EXCLUDED.rounded_pay_cents,
              published_at = COALESCE(payslips.published_at, EXCLUDED.published_at)
        `;
        payslipsInserted++;
      }
    }
    console.log(`[apply] legacy payslips materialized: ${payslipsInserted}`);

    await db.insert(auditLog).values({
      actorId: null,
      actorRole: null,
      action: "legacy.import.complete",
      targetType: "System",
      targetId: `legacy-${new Date().toISOString().slice(0, 10)}`,
      after: {
        employees: empIdByLegacy.size,
        legacyRunsInserted: runsInserted,
        pdfsCopied,
        pdfsMissing,
        punchInserted,
        punchSkipped,
        timeOffInserted: toInserted,
      },
    });

    // Touch a sentinel so /reports can show "Last legacy import: X"
    void dsql`SELECT 1`; // keep dsql referenced for tree-shaking note

    console.log("");
    console.log("Done.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
