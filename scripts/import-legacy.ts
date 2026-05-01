// Legacy data import. Pulls the Flask app's JSON + CSV state into the
// new Drizzle schema. Dry-run by default; --apply commits.
//
// Source layout (extracted from /root/payroll-legacy-backup-20260430/opt-payroll.tgz):
//   /data/legacy/users.json
//   /data/legacy/pay_rates.json
//   /data/legacy/temp_workers.json
//   /data/legacy/time_off_requests.json
//   /data/legacy/uploads/*.csv         — NGTeco-format punch exports
//   /data/legacy/static/reports/*.xlsx — bulk per-period reports (admin
//                                        + employee + cut-sheet variants)
//
// Idempotency: Employee rows are keyed by legacyId. PayPeriod rows are
// keyed by startDate. Punches are deduped by (employeeId, clockIn).
// Re-running --apply with no new source data is a no-op.
//
// Reports: copied to /data/payslips/legacy/<period-end>/<filename> on the
// host. Each Payslip row's pdfPath points at the period's
// admin_report_<period-end>.xlsx (shared by all employees in the period).
// /me/pay/[periodId] detects non-PDF pdfPath and renders a download link.

import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  employees,
  employeeRateHistory,
  payPeriods,
  payslips,
  punches,
  timeOffRequests,
  auditLog,
} from "../lib/db/schema";

const LEGACY_ROOT = process.env.LEGACY_ROOT ?? "/data/legacy";
const PAYSLIP_OUT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

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
  date: string; // YYYY-MM-DD
  clock_in: string; // HH:MM:SS
  clock_out: string;
  notes: string;
};
type LegacyTempWorkers = {
  workers: Record<string, { first_name: string; last_name: string; rate: number; shift_type: string }>;
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

const TZ_OFFSET_MINUTES = -240; // America/New_York EDT in May; close enough for legacy data

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizePersonId(s: string): string {
  // "01", "1", "1.0" → "1"; "TEMP_001" stays as-is.
  if (s.startsWith("TEMP_")) return s;
  return String(Math.trunc(Number(s.replace(/^0+/, "") || "0")));
}

function parseLegacyDate(s: string): string | null {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 1/1/2026 or 9/30/25
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) {
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    const y = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseLegacyTime(date: string, hms: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms.trim());
  if (!m) return null;
  // Build a wall-clock timestamp in America/New_York (EDT/EST).
  // The legacy app stored bare HH:MM:SS without TZ; we tag them as ET.
  const isoLocal = `${date}T${m[1]!.padStart(2, "0")}:${m[2]}:${(m[3] ?? "00").padStart(2, "0")}`;
  // Construct as if UTC, then shift by NY offset.
  const naiveUtc = new Date(`${isoLocal}Z`);
  const t = naiveUtc.getTime() + Math.abs(TZ_OFFSET_MINUTES) * 60_000;
  return new Date(t);
}

/** Period end is the Saturday on-or-after `date`. Periods are Sun..Sat
 *  (legacy convention; admin_report files are dated on Saturdays). */
function periodFor(dateIso: string): { start: string; end: string } {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const fwd = (6 - dow + 7) % 7;
  const end = new Date(d.getTime() + fwd * 86_400_000);
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const text = readFileSync(path, "utf8").replace(/^﻿/, ""); // strip BOM
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    // Naive split — these legacy CSVs don't use quoted fields with commas.
    const cells = line.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = (cells[j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

type Plan = {
  employees: { legacyId: string; displayName: string; legalName: string; rateCents: number; payType: "HOURLY" | "FLAT_TASK"; hiredOn: string }[];
  periods: Set<string>; // start dates
  punchCount: number;
  payslipCount: number;
  timeOff: number;
  reportFiles: number;
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

    // ── Plan: employees ──────────────────────────────────────────────────────
    const empPlans: Plan["employees"] = [];
    for (const [k, u] of Object.entries(users)) {
      if (u.role !== "employee") continue;
      const legacyId = u.employee_id || k;
      const rate = rates[legacyId];
      if (!rate) continue; // No rate → never paid → skip
      const realName = u.name && u.name !== legacyId ? u.name : rate.name || `Employee ${legacyId}`;
      empPlans.push({
        legacyId,
        displayName: titleCase(realName),
        legalName: realName,
        rateCents: Math.round(rate.rate * 100),
        payType: legacyId.startsWith("TEMP_") ? "FLAT_TASK" : "HOURLY",
        hiredOn: "2025-01-01", // first-known-good; CSV punches will be in 2025+
      });
    }
    // Add TEMP_ contractors not already in users.json
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
      source: "LEGACY_IMPORT";
    };
    const punchMap = new Map<string, PunchPlan>(); // key = legacyId|clockInIso

    // CSVs in uploads/.
    const uploadsDir = join(LEGACY_ROOT, "uploads");
    const csvs = readdirSync(uploadsDir).filter((f) => f.toLowerCase().endsWith(".csv"));
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
          punchMap.set(key, {
            legacyId: pid,
            clockIn: inT,
            clockOut: outT,
            dayIso: dateIso,
            source: "LEGACY_IMPORT",
          });
        }
      }
    }

    // TEMP entries from temp_workers.json
    for (const e of temp.entries) {
      const inT = parseLegacyTime(e.date, e.clock_in);
      const outT = parseLegacyTime(e.date, e.clock_out);
      if (!inT) continue;
      const key = `${e.person_id}|${inT.toISOString()}`;
      if (!punchMap.has(key)) {
        punchMap.set(key, {
          legacyId: e.person_id,
          clockIn: inT,
          clockOut: outT,
          dayIso: e.date,
          source: "LEGACY_IMPORT",
        });
      }
    }

    // ── Plan: periods (Sun..Sat) ─────────────────────────────────────────────
    const periodStarts = new Set<string>();
    for (const p of punchMap.values()) {
      const { start } = periodFor(p.dayIso);
      periodStarts.add(start);
    }

    // ── Plan: payslips (one per employee×period that has punches) ────────────
    type PayslipKey = string; // legacyId|periodStart
    const payslipBuckets = new Map<PayslipKey, { hours: number; periodStart: string; periodEnd: string; legacyId: string }>();
    for (const p of punchMap.values()) {
      if (!p.clockOut) continue;
      const ms = p.clockOut.getTime() - p.clockIn.getTime();
      if (ms <= 0) continue;
      const { start, end } = periodFor(p.dayIso);
      const key = `${p.legacyId}|${start}`;
      const ent = payslipBuckets.get(key) ?? { hours: 0, periodStart: start, periodEnd: end, legacyId: p.legacyId };
      ent.hours += ms / 3_600_000;
      payslipBuckets.set(key, ent);
    }

    // Reports — match by period-end date.
    const reportsDir = join(LEGACY_ROOT, "static", "reports");
    const reports = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
    const reportByEndDate = new Map<string, string>(); // YYYY-MM-DD → admin_report path
    for (const f of reports) {
      const m = /^admin_report_(\d{4}-\d{2}-\d{2})\./.exec(f);
      if (m) reportByEndDate.set(m[1]!, join(reportsDir, f));
    }

    const plan: Plan = {
      employees: empPlans,
      periods: periodStarts,
      punchCount: punchMap.size,
      payslipCount: payslipBuckets.size,
      timeOff: timeOff.length,
      reportFiles: reports.length,
    };

    console.log("");
    console.log("=== PLAN ===");
    console.log(`employees:    ${plan.employees.length}`);
    console.log(`periods:      ${plan.periods.size}`);
    console.log(`punches:      ${plan.punchCount} (CSVs read: ${csvs.length}, skipped: ${csvSkipped})`);
    console.log(`payslips:     ${plan.payslipCount}`);
    console.log(`time-off:     ${plan.timeOff}`);
    console.log(`report files: ${plan.reportFiles} (admin_report match by period-end: ${reportByEndDate.size})`);
    console.log("");

    if (!apply) {
      console.log("DRY RUN. Re-run with --apply to commit.");
      return;
    }

    // ── APPLY ────────────────────────────────────────────────────────────────

    // 1. Employees + initial rate history (idempotent by legacyId).
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

    // 2. Periods (idempotent by startDate).
    const periodIdByStart = new Map<string, string>();
    for (const start of periodStarts) {
      const { end } = periodFor(start); // start IS the period start; recompute the end
      const periodEnd = new Date(`${start}T00:00:00Z`).getTime() + 6 * 86_400_000;
      const periodEndIso = new Date(periodEnd).toISOString().slice(0, 10);
      const [existing] = await db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.startDate, start));
      if (existing) {
        periodIdByStart.set(start, existing.id);
        continue;
      }
      const [row] = await db
        .insert(payPeriods)
        .values({
          startDate: start,
          endDate: periodEndIso,
          state: "PAID",
          paidAt: new Date(`${periodEndIso}T22:00:00Z`),
        })
        .returning();
      if (row) periodIdByStart.set(start, row.id);
      // Avoid unused 'end' lint
      void end;
    }
    console.log(`[apply] periods: ${periodIdByStart.size}`);

    // 3. Punches (skip if existing punch for the same (employee, clockIn)).
    let punchInserted = 0;
    let punchSkipped = 0;
    for (const p of punchMap.values()) {
      const empId = empIdByLegacy.get(p.legacyId);
      if (!empId) {
        punchSkipped++;
        continue;
      }
      const { start } = periodFor(p.dayIso);
      const periodId = periodIdByStart.get(start);
      if (!periodId) {
        punchSkipped++;
        continue;
      }
      // Dedupe against existing.
      // Use createdAt index + a manual where on (employeeId, clockIn).
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

    // 4. Copy report files to /data/payslips/legacy/<period-end>/
    let copied = 0;
    const legacyOutRoot = join(PAYSLIP_OUT, "legacy");
    for (const [endDate, srcPath] of reportByEndDate) {
      const outDir = join(legacyOutRoot, endDate);
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, basename(srcPath));
      if (!existsSync(outPath)) {
        copyFileSync(srcPath, outPath);
        copied++;
      }
    }
    console.log(`[apply] report files copied: ${copied}`);

    // 5. Payslips (one per employee × period bucket; pdfPath points at the
    //    period's admin_report XLSX shared across all employees in that period).
    let payslipInserted = 0;
    for (const ent of payslipBuckets.values()) {
      const empId = empIdByLegacy.get(ent.legacyId);
      if (!empId) continue;
      const periodId = periodIdByStart.get(ent.periodStart);
      if (!periodId) continue;
      const reportSrc = reportByEndDate.get(ent.periodEnd);
      const pdfPath = reportSrc
        ? join(legacyOutRoot, ent.periodEnd, basename(reportSrc))
        : null;
      // Find or compute rate.
      const empPlan = empPlans.find((e) => e.legacyId === ent.legacyId);
      const rateCents = empPlan?.rateCents ?? 0;
      const grossCents = Math.round(ent.hours * rateCents);
      const [existing] = await db
        .select()
        .from(payslips)
        .where(eq(payslips.employeeId, empId));
      // Use a per-period unique check.
      const dup = await client`
        SELECT 1 FROM payslips WHERE employee_id = ${empId} AND period_id = ${periodId} LIMIT 1
      `;
      if (dup.length > 0) continue;
      void existing;
      await db.insert(payslips).values({
        employeeId: empId,
        periodId,
        payrollRunId: await ensureLegacyRun(client, periodId),
        hoursWorked: String(ent.hours.toFixed(2)),
        grossPayCents: grossCents,
        roundedPayCents: grossCents,
        taskPayCents: 0,
        pdfPath,
        publishedAt: new Date(`${ent.periodEnd}T22:00:00Z`),
      });
      payslipInserted++;
    }
    console.log(`[apply] payslips: ${payslipInserted}`);

    // 6. Time off
    let toInserted = 0;
    for (const t of timeOff) {
      const empId = empIdByLegacy.get(t.employee_id);
      if (!empId) continue;
      const status = t.status === "approved" ? "APPROVED" : t.status === "denied" ? "REJECTED" : "PENDING";
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

    // 7. Audit row capping the import.
    await db.insert(auditLog).values({
      actorId: null,
      actorRole: null,
      action: "legacy.import.complete",
      targetType: "System",
      targetId: "legacy-2026-04-30",
      after: {
        employees: empIdByLegacy.size,
        periods: periodIdByStart.size,
        punchInserted,
        payslipInserted,
        timeOffInserted: toInserted,
        reportsCopied: copied,
      },
    });

    console.log("");
    console.log("Done.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

// We need a PayrollRun row for each legacy period (Payslip.payrollRunId is NOT NULL).
// Reuse a single "legacy" run per period.
async function ensureLegacyRun(
  sql: ReturnType<typeof postgres>,
  periodId: string,
): Promise<string> {
  const existing = await sql`
    SELECT id FROM payroll_runs WHERE period_id = ${periodId} LIMIT 1
  `;
  if (existing.length > 0 && existing[0]) return existing[0].id as string;
  const inserted = await sql`
    INSERT INTO payroll_runs (period_id, state, scheduled_for, published_at)
    VALUES (${periodId}, 'PUBLISHED', NOW(), NOW())
    RETURNING id
  `;
  return inserted[0]!.id as string;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
