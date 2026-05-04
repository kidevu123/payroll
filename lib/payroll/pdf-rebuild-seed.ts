// Seed data parsed from the legacy admin-report PDFs by 10 parser agents.
// Owner-only "Rebuild from PDFs" button on /settings/cleanup loads this
// and pipes it through rebuildPeriodsFromPdfs() to wipe + replace.
//
// Sources:
//   /Users/kidevu/Downloads/Weekly/admin_report_2026-{date}.pdf  (16 files)
//   /Users/kidevu/Downloads/Semi Monthly /admin_report_2026-{date}.pdf  (8 files)
//
// Schedule kind is inferred from the printed period length:
//   ≤ 8 days → WEEKLY
//   ≥ 13 days → SEMI_MONTHLY

import type { PdfPeriod } from "./pdf-rebuild";

// Raw JSON dumps from each agent — kept as an array of period objects.
// Field-name variants from different agents (in/out vs inHHMM/outHHMM,
// printedPeriod string vs object, totalPayCents vs totalGrossCents) are
// normalized at action time in normalizeParserOutput().
//
// Loaded lazily by /settings/cleanup → "Rebuild from PDFs" button.
export const PDF_REBUILD_SEED: PdfPeriod[] = [];

/**
 * Load the seed JSON from a sibling JSON file at runtime. Keeping the
 * raw JSON in a separate file (instead of inlining ~150KB into TS)
 * avoids slowing typecheck and keeps the diff readable.
 */
export async function loadPdfRebuildSeed(): Promise<PdfPeriod[]> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");
  // The JSON file ships next to this TS file (same dir).
  const path = join(process.cwd(), "lib/payroll/pdf-rebuild-seed.json");
  const text = await readFile(path, "utf8");
  const raw = JSON.parse(text) as Array<Record<string, unknown>>;
  // Normalize variant field names (some agents emitted "in"/"out"/string
  // printedPeriod/totalPayCents). Mirrored by the form-driven path in
  // app/(admin)/settings/cleanup/actions.ts:normalizeParserOutput.
  return raw.map((p) => normalize(p));
}

function normalize(raw: Record<string, unknown>): PdfPeriod {
  const printed = raw.printedPeriod as
    | { start: string; end: string }
    | string
    | undefined;
  let start = "";
  let end = "";
  if (typeof printed === "string") {
    const m = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/.exec(printed);
    if (m) {
      start = m[1]!;
      end = m[2]!;
    }
  } else if (printed && typeof printed === "object") {
    start = printed.start;
    end = printed.end;
  }
  const filename = String(raw.filename ?? "unknown.pdf");
  const days =
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000),
    ) + 1;
  const scheduleKind: "WEEKLY" | "SEMI_MONTHLY" =
    days <= 8 ? "WEEKLY" : "SEMI_MONTHLY";
  const employeesRaw = (raw.employees as Array<Record<string, unknown>>) ?? [];
  const employees = employeesRaw.map((e) => ({
    personId: String(e.personId ?? ""),
    name: String(e.name ?? ""),
    shift: (e.shift === "Night" ? "Night" : "Day") as "Day" | "Night",
    rateCents: Number(e.rateCents ?? 0),
    totalHours: Number(e.totalHours ?? 0),
    totalGrossCents: Number(e.totalGrossCents ?? e.totalPayCents ?? 0),
    roundedCents: Number(e.roundedCents ?? 0),
    days: ((e.days as Array<Record<string, unknown>>) ?? []).map((d) => ({
      date: String(d.date ?? ""),
      inHHMM: String(d.inHHMM ?? d.in ?? ""),
      outHHMM: String(d.outHHMM ?? d.out ?? ""),
      hours: Number(d.hours ?? 0),
      payCents: Number(d.payCents ?? 0),
    })),
  }));
  const tempRaw = (raw.tempWorkers as Array<Record<string, unknown>>) ?? [];
  const tempWorkers = tempRaw.map((t) => ({
    personId: String(t.personId ?? ""),
    name: String(t.name ?? ""),
    rateCents: Number(t.rateCents ?? 0),
    totalHours: Number(t.totalHours ?? 0),
    date: String(t.date ?? ""),
    amountCents: Number(t.amountCents ?? 0),
  }));
  return {
    filename,
    periodStart: start,
    periodEnd: end,
    scheduleKind,
    employees,
    tempWorkers,
  };
}
