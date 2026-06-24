// READ-ONLY audit: find Milo punches that don't exist in NGTeco.
//
// The old DOM scraper misaligned NGTeco's virtualized grid and fabricated
// punches (stapling one employee's events onto another). This script pulls the
// REAL events from NGTeco's JSON API and flags every NGTECO_AUTO punch in Milo
// whose clock_in OR clock_out instant has no matching real NGTeco event for
// that employee. It DELETES NOTHING — it only prints a report.
//
// Usage (in the app container, same runner as migrate):
//   node ./node_modules/tsx/dist/cli.mjs scripts/audit-ngteco-punches.ts [days]
//   (days = lookback window, default 21)

import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches, employees, payPeriods } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";
import { open as openSealed } from "@/lib/crypto/vault";
import { writeAudit } from "@/lib/db/audit";
import { ngtecoApiLogin, fetchNgtecoTransactions } from "@/lib/ngteco/api-client";

function normalizeRef(s: string): string {
  // Mirror poll-importer: trim, drop leading zeros, uppercase.
  const t = (s ?? "").trim().replace(/^0+(?=\d)/, "");
  return t.toUpperCase();
}

function isEnvelope(v: unknown): v is { ciphertext: string; iv: string } {
  return typeof v === "object" && v !== null && "ciphertext" in v && "iv" in v;
}

async function main() {
  // `--apply` flips this from a report into a guarded soft-void. `days` is the
  // first non-flag positional arg.
  const apply = process.argv.includes("--apply");
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const days = Math.max(1, Math.min(120, Number(positional[0] ?? 21)));
  const ngteco = await getSetting("ngteco").catch(() => null);
  if (
    !ngteco ||
    !isEnvelope(ngteco.usernameEncrypted) ||
    !isEnvelope(ngteco.passwordEncrypted)
  ) {
    console.error("NGTeco credentials not configured.");
    process.exit(1);
  }
  const company = await getSetting("company").catch(() => null);
  const tz = company?.timezone ?? "America/New_York";
  const username = openSealed(ngteco.usernameEncrypted);
  const password = openSealed(ngteco.passwordEncrypted);

  // Window: last `days` days through tomorrow (exclusive end).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const start = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  })();
  const end = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  console.log(`Auditing punches ${start} .. ${today} (window ${days}d)…`);

  // 1. Pull REAL NGTeco events via the API.
  const { access } = await ngtecoApiLogin(ngteco.portalUrl, username, password);
  const fetched = await fetchNgtecoTransactions(ngteco.portalUrl, access, {
    startDate: start,
    endDate: end,
  });
  console.log(`NGTeco returned ${fetched.total} records (${fetched.events.length} usable).`);

  // Build real instant set per normalized employee ref. Round to the minute
  // to absorb any second-level formatting drift between the scraper and API.
  const realByRef = new Map<string, Set<number>>();
  for (const ev of fetched.events) {
    const ref = normalizeRef(ev.personId);
    const ms = Date.parse(ev.punchAt);
    if (Number.isNaN(ms)) continue;
    const minute = Math.floor(ms / 60000);
    if (!realByRef.has(ref)) realByRef.set(ref, new Set());
    realByRef.get(ref)!.add(minute);
  }

  // 2. Pull Milo NGTECO_AUTO punches in the same window.
  const startUtc = new Date(`${start}T00:00:00Z`);
  const rows = await db
    .select({
      id: punches.id,
      employeeId: punches.employeeId,
      ref: employees.ngtecoEmployeeRef,
      name: employees.displayName,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
      periodState: payPeriods.state,
    })
    .from(punches)
    .leftJoin(employees, eq(punches.employeeId, employees.id))
    .leftJoin(payPeriods, eq(punches.periodId, payPeriods.id))
    .where(
      and(
        eq(punches.source, "NGTECO_AUTO"),
        isNull(punches.voidedAt),
        gte(punches.clockIn, startUtc),
      ),
    );

  // 3. Flag punches whose in/out instant isn't in the real set for that ref.
  const fabricated: Array<{
    id: string;
    name: string;
    ref: string | null;
    inIso: string;
    outIso: string | null;
    badIn: boolean;
    badOut: boolean;
    periodState: string | null;
  }> = [];

  for (const r of rows) {
    if (!r.ref) continue; // unmapped employee — skip (can't compare)
    const ref = normalizeRef(r.ref);
    const real = realByRef.get(ref);
    const inMin = Math.floor(r.clockIn.getTime() / 60000);
    const outMin = r.clockOut ? Math.floor(r.clockOut.getTime() / 60000) : null;
    // Tolerance: accept ±1 minute.
    const inReal = !!real && (real.has(inMin) || real.has(inMin - 1) || real.has(inMin + 1));
    const outReal =
      outMin === null ||
      (!!real && (real.has(outMin) || real.has(outMin - 1) || real.has(outMin + 1)));
    if (!inReal || !outReal) {
      fabricated.push({
        id: r.id,
        name: r.name ?? "(unknown)",
        ref: r.ref,
        inIso: r.clockIn.toISOString(),
        outIso: r.clockOut?.toISOString() ?? null,
        badIn: !inReal,
        badOut: !outReal,
        periodState: r.periodState ?? null,
      });
    }
  }

  console.log("");
  console.log(`Milo NGTECO_AUTO punches in window: ${rows.length}`);
  console.log(`Punches with NO matching real NGTeco event: ${fabricated.length}`);
  console.log("");
  const byEmp = new Map<string, number>();
  for (const f of fabricated) byEmp.set(f.name, (byEmp.get(f.name) ?? 0) + 1);
  console.log("Suspected-fabricated by employee:");
  for (const [name, n] of [...byEmp.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${name}`);
  }
  console.log("");
  console.log("First 40 suspect rows (id | employee | in | out | bad):");
  for (const f of fabricated.slice(0, 40)) {
    const bad = [f.badIn ? "IN" : "", f.badOut ? "OUT" : ""].filter(Boolean).join("+");
    console.log(`  ${f.id} | ${f.name} | ${f.inIso} | ${f.outIso ?? "(open)"} | ${bad}`);
  }
  if (!apply) {
    console.log("");
    console.log("(read-only — nothing deleted; re-run with --apply to void)");
    process.exit(0);
  }

  // ── APPLY: guarded soft-void ──────────────────────────────────────────────
  // Only touch flagged rows. Skip anything in a LOCKED/PAID period (voiding a
  // finalized run could desync paid payroll) — report those for manual review.
  console.log("");
  console.log("--apply: voiding flagged punches (skipping LOCKED/PAID periods)…");
  let voided = 0;
  const skippedLocked: typeof fabricated = [];
  for (const f of fabricated) {
    if (f.periodState === "LOCKED" || f.periodState === "PAID") {
      skippedLocked.push(f);
      continue;
    }
    await db.transaction(async (tx) => {
      const res = await tx
        .update(punches)
        .set({ voidedAt: new Date() })
        .where(and(eq(punches.id, f.id), isNull(punches.voidedAt)))
        .returning({ id: punches.id });
      if (res.length === 0) return; // already voided concurrently
      await writeAudit(
        {
          actorId: null,
          actorRole: null,
          action: "punch.void.fabricated",
          targetType: "punch",
          targetId: f.id,
          before: { clockIn: f.inIso, clockOut: f.outIso, source: "NGTECO_AUTO" },
          after: {
            voided: true,
            reason: "No matching NGTeco API event (scraper grid-misalignment artifact)",
            badIn: f.badIn,
            badOut: f.badOut,
          },
        },
        tx,
      );
      voided++;
    });
  }
  console.log(`Voided ${voided} fabricated punch(es).`);
  if (skippedLocked.length > 0) {
    console.log(`Skipped ${skippedLocked.length} in LOCKED/PAID periods (need manual review):`);
    for (const f of skippedLocked) {
      console.log(`  ${f.id} | ${f.name} | ${f.inIso} | ${f.periodState}`);
    }
  }
  console.log("");
  console.log("Done. Genuine punches will re-import on the next API poll.");
  process.exit(0);
}

main().catch((e) => {
  console.error("audit failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
