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
import { punches, employees, payPeriods, employeeRateHistory } from "@/lib/db/schema";
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
  const impact = process.argv.includes("--impact");
  const debugArg = process.argv.find((a) => a.startsWith("--debug="));
  const debugName = debugArg ? debugArg.slice("--debug=".length).toLowerCase() : null;
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
  // Also keep the raw ms list per ref so --impact can reconstruct the genuine
  // shift behind a partially-fabricated punch.
  const realByRef = new Map<string, Set<number>>();
  const realMsByRef = new Map<string, number[]>();
  for (const ev of fetched.events) {
    const ref = normalizeRef(ev.personId);
    const ms = Date.parse(ev.punchAt);
    if (Number.isNaN(ms)) continue;
    const minute = Math.floor(ms / 60000);
    if (!realByRef.has(ref)) realByRef.set(ref, new Set());
    realByRef.get(ref)!.add(minute);
    if (!realMsByRef.has(ref)) realMsByRef.set(ref, []);
    realMsByRef.get(ref)!.push(ms);
  }
  for (const list of realMsByRef.values()) list.sort((a, b) => a - b);

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

  // ── DEBUG: dump Milo punches vs raw API events for a named employee ───────
  if (debugName) {
    const fmt = (ms: number) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ms));
    const matches = rows.filter((r) => (r.name ?? "").toLowerCase().includes(debugName));
    const refs = new Set(matches.map((r) => (r.ref ? normalizeRef(r.ref) : "")));
    console.log("");
    console.log(`DEBUG for "${debugName}" — local time (${tz}):`);
    console.log(`  matched employees: ${[...new Set(matches.map((r) => r.name))].join(", ")}`);
    console.log(`  ngteco refs: ${[...refs].join(", ")}`);
    console.log("");
    console.log("  MILO punches (source=NGTECO_AUTO, in window):");
    for (const r of matches.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())) {
      console.log(
        `    IN ${fmt(r.clockIn.getTime())}  OUT ${r.clockOut ? fmt(r.clockOut.getTime()) : "(open)"}  [${r.periodState}]`,
      );
    }
    console.log("");
    console.log("  RAW NGTeco API events for these refs (what the API actually returned):");
    const apiForRef = fetched.events
      .filter((e) => refs.has(normalizeRef(e.personId)))
      .sort((a, b) => Date.parse(a.punchAt) - Date.parse(b.punchAt));
    if (apiForRef.length === 0) console.log("    (none — API returned nothing for these refs)");
    for (const e of apiForRef) {
      console.log(
        `    code=${e.personId}  ${fmt(Date.parse(e.punchAt))}  raw[date=${e.rawDate} time=${e.rawTime} tz=${e.rawTz}] verify=${e.verifyType} src=${e.source}`,
      );
    }
    console.log("");
    console.log("(read-only diagnostic)");
    process.exit(0);
  }

  // 3. Flag punches whose in/out instant isn't in the real set for that ref.
  const fabricated: Array<{
    id: string;
    employeeId: string | null;
    name: string;
    ref: string | null;
    inMs: number;
    outMs: number | null;
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
        employeeId: r.employeeId ?? null,
        name: r.name ?? "(unknown)",
        ref: r.ref,
        inMs: r.clockIn.getTime(),
        outMs: r.clockOut?.getTime() ?? null,
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
  // ── IMPACT: dollar value of each fabricated punch ─────────────────────────
  if (impact) {
    const HOUR_MS = 3_600_000;
    // Effective hourly rate per employee on a given date (rate history row with
    // the latest effective_from <= date), falling back to the denormalized cache.
    const rateRows = await db
      .select({
        employeeId: employeeRateHistory.employeeId,
        rate: employeeRateHistory.hourlyRateCents,
        from: employeeRateHistory.effectiveFrom,
      })
      .from(employeeRateHistory);
    const cacheRows = await db
      .select({ id: employees.id, rate: employees.hourlyRateCents })
      .from(employees);
    const cacheById = new Map(cacheRows.map((r) => [r.id, r.rate ?? null]));
    function rateFor(empId: string | null, onMs: number): number | null {
      if (!empId) return null;
      const day = new Date(onMs).toISOString().slice(0, 10);
      let best: { from: string; rate: number } | null = null;
      for (const rr of rateRows) {
        if (rr.employeeId !== empId) continue;
        const from = String(rr.from);
        if (from <= day && (!best || from > best.from)) best = { from, rate: rr.rate };
      }
      return best?.rate ?? cacheById.get(empId) ?? null;
    }

    // For a partial punch, the genuine shift uses the real event closest to the
    // trustworthy boundary; overpay = recorded hours − genuine hours.
    function overpayHours(f: (typeof fabricated)[number]): number {
      if (f.outMs === null) return 0; // open punch — no paid duration to value
      const recorded = (f.outMs - f.inMs) / HOUR_MS;
      if (f.badIn && f.badOut) return recorded; // wholly phantom shift
      const real = (f.ref && realMsByRef.get(normalizeRef(f.ref))) || [];
      if (f.badIn) {
        // Real clock-out, fake clock-in: genuine clock-in = latest real event
        // strictly before the recorded clock-out.
        const candidates = real.filter((ms) => ms < f.outMs! - 60_000);
        if (candidates.length === 0) return recorded;
        const genuineIn = Math.max(...candidates);
        return Math.max(0, (genuineIn - f.inMs) / HOUR_MS);
      }
      // badOut: real clock-in, fake clock-out: genuine clock-out = earliest real
      // event strictly after the recorded clock-in.
      const candidates = real.filter((ms) => ms > f.inMs + 60_000);
      if (candidates.length === 0) return recorded;
      const genuineOut = Math.min(...candidates);
      return Math.max(0, (f.outMs - genuineOut) / HOUR_MS);
    }

    console.log("");
    console.log("Overpay impact (estimate, valued at rate in effect on punch date):");
    console.log("emp | date | recorded | overpay hrs | rate | overpay $ | period");
    const totalByEmp = new Map<string, { hrs: number; cents: number }>();
    let grandCents = 0;
    for (const f of fabricated) {
      const hrs = overpayHours(f);
      const rate = rateFor(f.employeeId, f.inMs);
      const cents = rate != null ? Math.round(hrs * rate) : 0;
      grandCents += cents;
      const agg = totalByEmp.get(f.name) ?? { hrs: 0, cents: 0 };
      totalByEmp.set(f.name, { hrs: agg.hrs + hrs, cents: agg.cents + cents });
      const recHrs = f.outMs ? ((f.outMs - f.inMs) / HOUR_MS).toFixed(2) : "open";
      const rateStr = rate != null ? `$${(rate / 100).toFixed(2)}/h` : "(no rate)";
      console.log(
        `  ${f.name} | ${f.inIso.slice(0, 10)} | ${recHrs}h | ${hrs.toFixed(2)}h | ${rateStr} | $${(cents / 100).toFixed(2)} | ${f.periodState}`,
      );
    }
    console.log("");
    console.log("Per-employee overpay total:");
    for (const [name, t] of [...totalByEmp.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
      console.log(`  ${name}: ${t.hrs.toFixed(2)}h  =  $${(t.cents / 100).toFixed(2)}`);
    }
    console.log("");
    console.log(`GRAND TOTAL estimated overpay: $${(grandCents / 100).toFixed(2)}`);
    console.log("(read-only — no changes made)");
    process.exit(0);
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
