// Auto-import new NGTeco Person rows into Milo as inactive stubs.
// Runs after a successful punch poll (debounced) or on manual admin sync.

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import {
  createEmployee,
  type Actor,
} from "@/lib/db/queries/employees";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { logger } from "@/lib/telemetry";
import { open as openSealed } from "@/lib/crypto/vault";
import {
  scrapeEmployeeRoster,
  ChallengeDetectedError,
  ScrapeFailure,
  type RawEmployeeRosterRow,
} from "./scraper";
import { sanitizeNgtecoPersonName } from "./person-name";

export const NGTECO_IMPORT_NOTE_PREFIX = "NGTECO_IMPORT:";
export const NGTECO_SETUP_IGNORED_TAG = "setup_ignored";

const STORAGE_ROOT = process.env.NGTECO_STORAGE_DIR ?? "/data/ngteco";
const SYNC_STATE_PATH = `${STORAGE_ROOT}/last-employee-roster-sync.json`;

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ciphertext" in value &&
    "iv" in value
  );
}

function normalizeRef(s: string): string {
  const t = s.trim();
  if (/^\d+$/.test(t)) return String(Number(t));
  return t;
}

const emailSchema = z.string().email();

export type RosterSyncSummary = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  scraped?: number;
  created?: number;
  skippedRows?: number;
  durationMs?: number;
};

async function rosterSyncActor(): Promise<Actor> {
  const admins = await adminUserIds();
  if (admins[0]) return { id: admins[0], role: "ADMIN" };
  throw new Error("employee-roster-sync: no admin user for audit actor");
}

async function readLastSyncAt(): Promise<Date | null> {
  try {
    const { readFileSync, existsSync } = await import(
      /* webpackIgnore: true */ "node:fs"
    );
    if (!existsSync(SYNC_STATE_PATH)) return null;
    const raw = readFileSync(SYNC_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { at?: string };
    if (!parsed.at) return null;
    const d = new Date(parsed.at);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

async function writeLastSyncAt(summary: {
  created: number;
  scraped: number;
}): Promise<void> {
  try {
    const { mkdirSync, writeFileSync, existsSync } = await import(
      /* webpackIgnore: true */ "node:fs"
    );
    const { dirname } = await import(/* webpackIgnore: true */ "node:path");
    const dir = dirname(SYNC_STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      SYNC_STATE_PATH,
      JSON.stringify({
        at: new Date().toISOString(),
        created: summary.created,
        scraped: summary.scraped,
      }),
      "utf8",
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "employee-roster-sync: could not persist debounce state",
    );
  }
}

function placeholderEmail(ref: string): string {
  const safeRef = ref.replace(/[^a-zA-Z0-9_-]/g, "");
  return `legacy.${safeRef.toLowerCase() || "noref"}@local`;
}

async function resolveEmail(
  ref: string,
  rawEmail: string,
): Promise<{ email: string; noteExtra: string }> {
  const trimmed = rawEmail.trim();
  if (trimmed && emailSchema.safeParse(trimmed).success) {
    const [existing] = await db
      .select({ id: employees.id, ref: employees.ngtecoEmployeeRef })
      .from(employees)
      .where(eq(employees.email, trimmed))
      .limit(1);
    if (!existing) return { email: trimmed, noteExtra: "" };
    if (existing.ref && normalizeRef(existing.ref) === normalizeRef(ref)) {
      return { email: trimmed, noteExtra: "" };
    }
    return {
      email: placeholderEmail(ref),
      noteExtra: `email_conflict=${trimmed}`,
    };
  }
  return { email: placeholderEmail(ref), noteExtra: trimmed ? `email_raw=${trimmed}` : "" };
}

export async function importNewEmployeesFromRoster(
  rosterRows: RawEmployeeRosterRow[],
  actor: Actor,
  opts: { notify?: boolean } = {},
): Promise<{ created: number; skipped: number; createdIds: string[] }> {
  const company = await getSetting("company");
  const today = companyTodayIso(new Date(), company.timezone);

  const existing = await db
    .select({
      id: employees.id,
      ref: employees.ngtecoEmployeeRef,
    })
    .from(employees)
    .where(sql`${employees.ngtecoEmployeeRef} IS NOT NULL`);
  const knownRefs = new Set<string>();
  for (const row of existing) {
    if (row.ref) knownRefs.add(normalizeRef(row.ref));
  }

  let created = 0;
  let skipped = 0;
  const createdIds: string[] = [];
  const createdNames: string[] = [];

  for (const row of rosterRows) {
    const ref = normalizeRef(row.personId);
    if (!ref) {
      skipped++;
      continue;
    }
    if (knownRefs.has(ref)) {
      skipped++;
      continue;
    }

    const displayName =
      sanitizeNgtecoPersonName(row.personName) || `Person ${ref}`;
    const { email, noteExtra } = await resolveEmail(ref, row.email);
    const noteParts = [
      NGTECO_IMPORT_NOTE_PREFIX,
      row.department ? `department=${row.department}` : null,
      noteExtra || null,
    ].filter(Boolean);

    try {
      const emp = await createEmployee(
        {
          displayName,
          legalName: displayName,
          email,
          payType: "HOURLY",
          payScheduleId: null,
          language: "en",
          hiredOn: today,
          ngtecoEmployeeRef: ref,
          status: "INACTIVE",
          notes: noteParts.join(" "),
        },
        actor,
      );
      knownRefs.add(ref);
      created++;
      createdIds.push(emp.id);
      createdNames.push(displayName);
    } catch (err) {
      logger.warn(
        {
          ref,
          err: err instanceof Error ? err.message : String(err),
        },
        "employee-roster-sync: create failed for row",
      );
      skipped++;
    }
  }

  if (created > 0 && opts.notify !== false) {
    const automation = await getSetting("automation");
    if (automation.ngtecoEmployeeRosterSync.notifyOnImport) {
      const admins = await adminUserIds();
      const names = createdNames.slice(0, 3);
      await dispatch(
        admins.map((recipientId) => ({
          recipientId,
          kind: "employee.ngteco_imported" as const,
          payload: {
            count: created,
            sampleNames: names,
          },
          push: {
            title: "New people from time clock",
            body:
              created === 1
                ? "1 new person was added — finish their payroll setup on Employees."
                : `${created} new people were added — finish payroll setup on Employees.`,
            url: "/employees?status=INACTIVE",
            tag: "ngteco_employee_import",
          },
        })),
      ).catch(() => undefined);
    }
  }

  return { created, skipped, createdIds };
}

export async function runNgtecoEmployeeRosterSync(opts: {
  runId: string;
  force?: boolean;
}): Promise<RosterSyncSummary> {
  const automation = await getSetting("automation");
  if (!automation.ngtecoEmployeeRosterSync.enabled && !opts.force) {
    return { ok: true, skipped: true, reason: "disabled in settings" };
  }

  const minHours = automation.ngtecoEmployeeRosterSync.minHoursBetweenSync;
  if (!opts.force) {
    const last = await readLastSyncAt();
    if (last) {
      const elapsedH =
        (Date.now() - last.getTime()) / (60 * 60 * 1000);
      if (elapsedH < minHours) {
        return {
          ok: true,
          skipped: true,
          reason: `debounced (${elapsedH.toFixed(1)}h < ${minHours}h)`,
        };
      }
    }
  }

  const ngteco = await getSetting("ngteco").catch(() => null);
  if (
    !ngteco ||
    !isEnvelope(ngteco.usernameEncrypted) ||
    !isEnvelope(ngteco.passwordEncrypted)
  ) {
    return { ok: false, reason: "NGTeco credentials not configured" };
  }

  const username = openSealed(ngteco.usernameEncrypted);
  const password = openSealed(ngteco.passwordEncrypted);
  const actor = await rosterSyncActor();

  try {
    const result = await scrapeEmployeeRoster({
      portalUrl: ngteco.portalUrl,
      username,
      password,
      headless: ngteco.headless,
      runId: opts.runId,
    });
    const imported = await importNewEmployeesFromRoster(result.rows, actor, {
      notify: true,
    });
    await writeLastSyncAt({
      created: imported.created,
      scraped: result.rows.length,
    });
    logger.info(
      {
        runId: opts.runId,
        scraped: result.rows.length,
        created: imported.created,
        skipped: imported.skipped,
        durationMs: result.durationMs,
      },
      "employee-roster-sync: done",
    );
    return {
      ok: true,
      scraped: result.rows.length,
      created: imported.created,
      skippedRows: imported.skipped,
      durationMs: result.durationMs,
    };
  } catch (err) {
    if (err instanceof ChallengeDetectedError) {
      return { ok: false, reason: `challenge: ${err.kind}` };
    }
    if (err instanceof ScrapeFailure) {
      return { ok: false, reason: err.message };
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ runId: opts.runId, reason }, "employee-roster-sync: failed");
    return { ok: false, reason };
  }
}

/** Non-fatal hook for punch.poll after a successful ingest. */
export async function maybeSyncNgtecoEmployeeRoster(runId: string): Promise<void> {
  try {
    const summary = await runNgtecoEmployeeRosterSync({ runId });
    if (!summary.ok && summary.reason) {
      logger.warn(
        { runId, reason: summary.reason },
        "employee-roster-sync: post-poll sync failed (non-fatal)",
      );
    }
  } catch (err) {
    logger.warn(
      { runId, err: err instanceof Error ? err.message : String(err) },
      "employee-roster-sync: post-poll sync threw (non-fatal)",
    );
  }
}
