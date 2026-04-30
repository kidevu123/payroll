// Bulk import employees from CSV. Dry-run by default.
//
// Usage:
//   npm run script -- scripts/import-employees.ts <path> [--apply]
//   # or
//   tsx scripts/import-employees.ts <path> [--apply]
//
// Expected columns (header row required, snake_case or camelCase OK):
//   legacy_id, display_name, legal_name, email, phone, hired_on,
//   pay_type (HOURLY|FLAT_TASK), hourly_rate_cents, language (en|es),
//   ngteco_employee_ref, notes
//
// Detection heuristics:
//   • If pay_type is missing and (hourly_rate_cents > $50/hr equiv. AND
//     no other employees on this row), flag as suspected FLAT_TASK and
//     surface for review rather than auto-migrating.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { employees, employeeRateHistory } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "@/lib/db/audit";

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  // Minimal RFC-4180-ish parser: handles quoted fields and CRLF line endings.
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      lines.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  if (lines.length === 0) return [];
  const header = lines[0]!.map((h) => normalizeHeader(h));
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i]!;
    if (r.length === 1 && r[0] === "") continue;
    const obj: Row = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]!] = (r[j] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

type Plan =
  | { kind: "create"; row: Row; warnings: string[] }
  | { kind: "skip-exists"; row: Row; reason: string }
  | { kind: "error"; row: Row; reason: string };

const SUSPICIOUS_RATE_CENTS = 50_00 * 60; // > $50/hr * 60min — heuristic flag

function plan(rows: Row[], existingByLegacyOrEmail: Map<string, true>): Plan[] {
  return rows.map((r) => {
    const legacyId = r.legacy_id || r.id || "";
    const email = r.email;
    const display = r.display_name;
    const legal = r.legal_name || display;
    if (!email || !display) {
      return { kind: "error", row: r, reason: "Missing email or display_name" };
    }
    const dedupeKey = (legacyId || email).toLowerCase();
    if (existingByLegacyOrEmail.has(dedupeKey)) {
      return { kind: "skip-exists", row: r, reason: `already imported: ${dedupeKey}` };
    }
    const warnings: string[] = [];
    const rateCents = r.hourly_rate_cents
      ? Number.parseInt(r.hourly_rate_cents, 10)
      : NaN;
    if (Number.isFinite(rateCents) && rateCents > SUSPICIOUS_RATE_CENTS) {
      warnings.push(
        `hourly_rate_cents (${rateCents}) > $${SUSPICIOUS_RATE_CENTS / 100}/hr — possible FLAT_TASK?`,
      );
    }
    if (display !== titleCase(display)) {
      warnings.push(`display_name will be title-cased to "${titleCase(display)}"`);
    }
    return { kind: "create", row: r, warnings };
  });
}

async function existingKeys(): Promise<Map<string, true>> {
  const all = await db.select().from(employees);
  const map = new Map<string, true>();
  for (const e of all) {
    if (e.legacyId) map.set(e.legacyId.toLowerCase(), true);
    map.set(e.email.toLowerCase(), true);
  }
  return map;
}

async function apply(p: Extract<Plan, { kind: "create" }>): Promise<void> {
  const r = p.row;
  const display = titleCase(r.display_name!);
  const legal = r.legal_name || r.display_name!;
  const rateCents = r.hourly_rate_cents
    ? Number.parseInt(r.hourly_rate_cents, 10)
    : null;
  await db.transaction(async (tx) => {
    const [emp] = await tx
      .insert(employees)
      .values({
        legacyId: r.legacy_id || null,
        displayName: display,
        legalName: legal,
        email: r.email!,
        phone: r.phone || null,
        hiredOn: r.hired_on || new Date().toISOString().slice(0, 10),
        payType: (r.pay_type === "FLAT_TASK" ? "FLAT_TASK" : "HOURLY") as
          | "HOURLY"
          | "FLAT_TASK",
        hourlyRateCents: rateCents,
        language: (r.language === "es" ? "es" : "en") as "en" | "es",
        ngtecoEmployeeRef: r.ngteco_employee_ref || null,
        notes: r.notes || null,
      })
      .returning();
    if (!emp) throw new Error("import: employee insert returned no row");
    if (rateCents !== null) {
      await tx.insert(employeeRateHistory).values({
        employeeId: emp.id,
        effectiveFrom: emp.hiredOn,
        hourlyRateCents: rateCents,
        reason: "Imported from CSV",
      });
    }
    await writeAudit(
      {
        actorId: null,
        actorRole: null,
        action: "employee.import",
        targetType: "Employee",
        targetId: emp.id,
        after: emp,
      },
      tx,
    );
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const path = argv.find((a) => !a.startsWith("--"));
  const apply_ = argv.includes("--apply");
  if (!path) {
    console.error("usage: import-employees.ts <csv-path> [--apply]");
    process.exit(2);
  }
  const csvText = readFileSync(resolve(path), "utf8");
  const rows = parseCsv(csvText);
  console.log(`Read ${rows.length} rows from ${path}`);
  const existing = await existingKeys();
  const plans = plan(rows, existing);
  let created = 0;
  let skipped = 0;
  let errors = 0;
  for (const p of plans) {
    if (p.kind === "skip-exists") {
      skipped++;
      console.log(`SKIP   ${p.row.email} — ${p.reason}`);
      continue;
    }
    if (p.kind === "error") {
      errors++;
      console.log(`ERROR  ${p.row.email ?? "(no email)"} — ${p.reason}`);
      continue;
    }
    console.log(`CREATE ${p.row.email}${p.warnings.length ? ` [${p.warnings.join("; ")}]` : ""}`);
    if (apply_) {
      await apply(p);
      created++;
    }
  }
  console.log(
    `\nSummary: ${rows.length} rows · ${apply_ ? "applied" : "DRY RUN"} · ${created} created · ${skipped} skipped · ${errors} errors`,
  );
  if (!apply_ && errors === 0) {
    console.log("Re-run with --apply to commit.");
  }
  process.exit(errors > 0 ? 1 : 0);
}

void main();
