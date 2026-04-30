// NGTeco import orchestrator.
//
// Caller path: pg-boss handler `ngteco.import` (Phase 2) → runImport(runId).
// This module:
//   1. Reads ngteco settings via getSetting + decrypts via vault.open
//      (with role check at the action layer; jobs run as system).
//   2. Calls scrape() to obtain the CSV.
//   3. Parses with parser.parse().
//   4. Matches each candidate to an Employee by ngtecoEmployeeRef.
//   5. Dedupes against existing punches by ngtecoRecordHash.
//   6. Persists Punches; writes IngestExceptions for unmatched / parse / dup.
//   7. Returns a summary the orchestrator can store on the PayrollRun.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payPeriods,
  payrollRuns,
  punches,
  ingestExceptions,
} from "@/lib/db/schema";
import { open as vaultOpen } from "@/lib/crypto/vault";
import { getSetting } from "@/lib/settings/runtime";
import { logger } from "@/lib/telemetry";
import { parse, type ParseError, type PunchCandidate } from "./parser";
import { scrape, type ScrapeOutput } from "./scraper";

export type ImportSummary = {
  punchesImported: number;
  unmatched: number;
  parseErrors: number;
  duplicates: number;
  durationMs: number;
};

type Substituters = {
  /** Override the scrape step with a synthetic CSV (used by tests + runs that
   *  read a pre-fetched export). */
  csv?: string;
};

export async function runImport(
  runId: string,
  override: Substituters = {},
): Promise<ImportSummary> {
  const t0 = Date.now();
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error(`runImport: payrollRun ${runId} not found`);
  const [period] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, run.periodId));
  if (!period) throw new Error(`runImport: pay period ${run.periodId} not found`);

  const ngteco = await getSetting("ngteco");
  const company = await getSetting("company");

  // Source CSV: scrape live, unless caller supplied an override.
  let scraped: ScrapeOutput;
  if (override.csv !== undefined) {
    scraped = { csv: override.csv, durationMs: 0 };
  } else {
    if (!ngteco.usernameEncrypted || !ngteco.passwordEncrypted) {
      throw new Error("runImport: NGTeco credentials not configured.");
    }
    const username = vaultOpen(ngteco.usernameEncrypted);
    const password = vaultOpen(ngteco.passwordEncrypted);
    scraped = await scrape({
      portalUrl: ngteco.portalUrl,
      username,
      password,
      fromDate: period.startDate,
      toDate: period.endDate,
      headless: ngteco.headless,
      runId,
    });
  }

  await db
    .update(payrollRuns)
    .set({ ingestStartedAt: new Date(), state: "INGESTING" })
    .where(eq(payrollRuns.id, runId));

  const parsed = parse(scraped.csv, company.timezone);
  logger.info(
    {
      runId,
      candidates: parsed.candidates.length,
      parseErrors: parsed.errors.length,
    },
    "ngteco.parse: complete",
  );

  // Resolve refs in batch.
  const refs = [...new Set(parsed.candidates.map((c) => c.ngtecoEmployeeRef))];
  const empRows = refs.length
    ? await db
        .select()
        .from(employees)
        .where(inArray(employees.ngtecoEmployeeRef, refs))
    : [];
  const empByRef = new Map(empRows.map((e) => [e.ngtecoEmployeeRef ?? "", e]));

  // Existing hashes for the period — dedupe against past imports.
  const existingPunches = await db
    .select()
    .from(punches)
    .where(eq(punches.periodId, period.id));
  const existingHashes = new Set(
    existingPunches.map((p) => p.ngtecoRecordHash).filter(Boolean) as string[],
  );

  const exceptions: {
    type: "UNMATCHED_REF" | "DUPLICATE_HASH";
    candidate: PunchCandidate;
  }[] = [];

  let imported = 0;
  for (const c of parsed.candidates) {
    const emp = empByRef.get(c.ngtecoEmployeeRef);
    if (!emp) {
      exceptions.push({ type: "UNMATCHED_REF", candidate: c });
      continue;
    }
    if (existingHashes.has(c.ngtecoRecordHash)) {
      exceptions.push({ type: "DUPLICATE_HASH", candidate: c });
      continue;
    }
    await db.insert(punches).values({
      employeeId: emp.id,
      periodId: period.id,
      clockIn: new Date(c.clockIn),
      clockOut: c.clockOut ? new Date(c.clockOut) : null,
      source: "NGTECO_AUTO",
      ngtecoRecordHash: c.ngtecoRecordHash,
    });
    existingHashes.add(c.ngtecoRecordHash);
    imported++;
  }

  // Write IngestExceptions in one batch per (parse errors + match results).
  const exceptionRows: {
    payrollRunId: string;
    type: string;
    ngtecoEmployeeRef: string | null;
    rawData: unknown;
  }[] = [];
  for (const e of parsed.errors) {
    exceptionRows.push({
      payrollRunId: runId,
      type: "PARSE_ERROR",
      ngtecoEmployeeRef: null,
      rawData: { reason: e.reason, raw: e.raw, rowIndex: e.rowIndex },
    });
  }
  for (const ex of exceptions) {
    exceptionRows.push({
      payrollRunId: runId,
      type: ex.type,
      ngtecoEmployeeRef: ex.candidate.ngtecoEmployeeRef,
      rawData: ex.candidate,
    });
  }
  if (exceptionRows.length > 0) {
    await db.insert(ingestExceptions).values(exceptionRows);
  }

  await db
    .update(payrollRuns)
    .set({ ingestCompletedAt: new Date() })
    .where(eq(payrollRuns.id, runId));

  const summary: ImportSummary = {
    punchesImported: imported,
    unmatched: exceptions.filter((e) => e.type === "UNMATCHED_REF").length,
    duplicates: exceptions.filter((e) => e.type === "DUPLICATE_HASH").length,
    parseErrors: parsed.errors.length,
    durationMs: Date.now() - t0,
  };
  logger.info({ runId, ...summary }, "ngteco.import: complete");
  return summary;
}
