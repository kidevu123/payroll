"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth-guards";
import {
  backfillNullRunTotals,
  deleteEmptyOrphanPeriods,
  findEmptyOrphanPeriods,
  findOverlappingPeriods,
  getPeriodEmployeeSummary,
  mergeAllOverlapsUsingSuggestion,
  mergeOverlappingPair,
  tagLegacyPeriodsBySchedule,
  type MergeOverlappingPairResult,
  type PeriodEmployeeSummary,
  type TagLegacyResult,
} from "@/lib/db/queries/cleanup";
import {
  rebuildPeriodsFromPdfs,
  type PdfPeriod,
  type RebuildResult,
} from "@/lib/payroll/pdf-rebuild";
import { loadPdfRebuildSeed } from "@/lib/payroll/pdf-rebuild-seed";

/**
 * Owner-only mass rebuild from parsed PDF JSON. Wipes target-period
 * payslips/runs/punches/temp/docs, then writes fresh ones matching the
 * PDFs. Returns per-period totals + any unmatched-employee warnings.
 *
 * Input is the JSON dumped by the parser agents (see lib/payroll/pdf-rebuild.ts
 * for the PdfPeriod shape). The owner pastes the JSON into the form.
 */
export async function rebuildFromPdfJsonAction(input: {
  json: string;
}): Promise<{ result?: RebuildResult; error?: string }> {
  try {
    const session = await requireOwner();
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.json);
    } catch (err) {
      return {
        error:
          "JSON parse failed: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
    if (!Array.isArray(parsed)) {
      return { error: "Top-level JSON must be an array of periods." };
    }
    const periods: PdfPeriod[] = parsed.map((p) =>
      normalizeParserOutput(p as Record<string, unknown>),
    );
    const result = await rebuildPeriodsFromPdfs(periods, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Rebuild failed.",
    };
  }
}

/**
 * Rebuild from the JSON file checked in at lib/payroll/pdf-rebuild-seed.json.
 * Same wipe-and-replace semantics as rebuildFromPdfJsonAction; saves the
 * owner from pasting ~150KB of JSON into a textarea.
 */
export async function rebuildFromBakedSeedAction(): Promise<{
  result?: RebuildResult;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const periods = await loadPdfRebuildSeed();
    if (periods.length === 0) {
      return {
        error:
          "Baked seed is empty — lib/payroll/pdf-rebuild-seed.json hasn't been populated yet.",
      };
    }
    const result = await rebuildPeriodsFromPdfs(periods, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Rebuild failed.",
    };
  }
}

/**
 * Two parser agents disagreed on field names — normalize variants:
 *   printedPeriod: object | "YYYY-MM-DD to YYYY-MM-DD"
 *   totalGrossCents | totalPayCents
 *   day fields: inHHMM/outHHMM | in/out
 */
function normalizeParserOutput(raw: Record<string, unknown>): PdfPeriod {
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
  // Schedule kind heuristic by length: 5-7 = WEEKLY, 13-16 = SEMI_MONTHLY.
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

export async function tagLegacyPeriodsBySchedule_Action(): Promise<{
  result?: TagLegacyResult;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const result = await tagLegacyPeriodsBySchedule({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Tag failed.",
    };
  }
}

export async function backfillNullRunTotalsAction(): Promise<{
  fixed: Array<{ runId: string; previousTotal: number | null; newTotal: number }>;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const fixed = await backfillNullRunTotals({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/reports");
    revalidatePath("/payroll");
    return { fixed };
  } catch (err) {
    return {
      fixed: [],
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}

export async function previewEmptyOrphanPeriodsAction(): Promise<{
  candidates: Array<{ id: string; startDate: string; endDate: string; state: string }>;
  error?: string;
}> {
  try {
    await requireOwner();
    const candidates = await findEmptyOrphanPeriods();
    return { candidates };
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function deleteEmptyOrphanPeriodsAction(): Promise<{
  deleted: Array<{ id: string; startDate: string; endDate: string }>;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const deleted = await deleteEmptyOrphanPeriods({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/reports");
    revalidatePath("/payroll");
    return { deleted };
  } catch (err) {
    return {
      deleted: [],
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

export async function previewOverlappingPeriodsAction(): Promise<{
  pairs: Awaited<ReturnType<typeof findOverlappingPeriods>>;
  error?: string;
}> {
  try {
    await requireOwner();
    const pairs = await findOverlappingPeriods(200);
    return { pairs };
  } catch (err) {
    return {
      pairs: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function mergeAllOverlapsAction(): Promise<{
  result?: { merged: number; skipped: number; errors: Array<{ pair: string; error: string }> };
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const result = await mergeAllOverlapsUsingSuggestion({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Merge-all failed.",
    };
  }
}

export async function previewPeriodEmployeeSummaryAction(
  periodId: string,
): Promise<{ rows: PeriodEmployeeSummary[]; error?: string }> {
  try {
    await requireOwner();
    const rows = await getPeriodEmployeeSummary(periodId);
    return { rows };
  } catch (err) {
    return {
      rows: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function mergeOverlappingPairAction(
  survivorId: string,
  loserId: string,
): Promise<{
  result?: MergeOverlappingPairResult;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const result = await mergeOverlappingPair(survivorId, loserId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Merge failed.",
    };
  }
}
