// READ-ONLY: expose the leading-zero employee-code collision.
//
// NGTeco person codes are distinct identifiers — "01" (Erica) and "0001"
// (Nabeel) are different people. Milo's normalizeRef() strips leading zeros and
// numeric-parses, collapsing both to "1", so one employee absorbs the other's
// punches. This script pulls NGTeco's roster (distinct code+name from recent
// transactions) and lines it up against Milo's stored ngteco_employee_ref so we
// can see exactly which employee holds which key. It CHANGES NOTHING.
//
//   node ./node_modules/tsx/dist/cli.mjs scripts/ngteco-ref-check.ts [days]

import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";
import { open as openSealed } from "@/lib/crypto/vault";
import { ngtecoApiLogin, fetchNgtecoTransactions } from "@/lib/ngteco/api-client";

// The CURRENT (buggy) normalization, reproduced so we can show the collision.
function legacyNormalize(s: string): string {
  if (!s) return "";
  if (s.startsWith("TEMP_")) return s;
  const numeric = Number(s.replace(/^0+/, "") || "0");
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : s;
}

function isEnvelope(v: unknown): v is { ciphertext: string; iv: string } {
  return typeof v === "object" && v !== null && "ciphertext" in v && "iv" in v;
}

async function main() {
  const days = Math.max(1, Math.min(120, Number(process.argv[2] ?? 30)));
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

  // 1. NGTeco roster: distinct (exact code, name) from recent transactions.
  const { access } = await ngtecoApiLogin(ngteco.portalUrl, username, password);
  const fetched = await fetchNgtecoTransactions(ngteco.portalUrl, access, {
    startDate: start,
    endDate: end,
  });
  const roster = new Map<string, string>(); // exact code -> name
  for (const ev of fetched.events) {
    const code = ev.personId.trim();
    if (code && !roster.has(code)) roster.set(code, ev.personName || "");
  }

  // 2. Milo employees that carry a ref.
  const emps = await db
    .select({
      id: employees.id,
      name: employees.displayName,
      ref: employees.ngtecoEmployeeRef,
      status: employees.status,
    })
    .from(employees)
    .where(isNotNull(employees.ngtecoEmployeeRef));

  console.log(`NGTeco roster (last ${days}d), exact codes:`);
  for (const [code, name] of [...roster.entries()].sort()) {
    console.log(`  code="${code}"  legacy="${legacyNormalize(code)}"  ${name}`);
  }
  console.log("");
  console.log("Milo employees with a stored ref:");
  for (const e of emps.sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? ""))) {
    console.log(
      `  ref="${e.ref}"  legacy="${legacyNormalize(e.ref ?? "")}"  ${e.name} [${e.status}]`,
    );
  }

  // 3. The collisions: legacy keys shared by >1 NGTeco code.
  console.log("");
  console.log("COLLISIONS (NGTeco codes that collapse to the same legacy key):");
  const byLegacy = new Map<string, string[]>();
  for (const code of roster.keys()) {
    const k = legacyNormalize(code);
    if (!byLegacy.has(k)) byLegacy.set(k, []);
    byLegacy.get(k)!.push(code);
  }
  let any = false;
  for (const [k, codes] of byLegacy) {
    if (codes.length < 2) continue;
    any = true;
    const names = codes.map((c) => `${c}=${roster.get(c)}`).join("  |  ");
    const holder = emps.find((e) => legacyNormalize(e.ref ?? "") === k);
    console.log(`  legacy "${k}" <= ${names}`);
    console.log(
      `      currently all attributed in Milo to: ${holder ? `${holder.name} (ref="${holder.ref}")` : "(no employee holds this key)"}`,
    );
  }
  if (!any) console.log("  (none in this window)");

  // 4. Proposed fix: exact-code mapping by name.
  console.log("");
  console.log("Proposed exact-ref mapping (match Milo employee by name -> NGTeco code):");
  const sanitize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [code, name] of [...roster.entries()].sort()) {
    const matches = emps.filter((e) => sanitize(e.name) === sanitize(name));
    if (matches.length === 1) {
      const m = matches[0]!;
      const change = m.ref === code ? "(already exact)" : `"${m.ref}" -> "${code}"`;
      console.log(`  ${name}: ${m.name} ref ${change}`);
    } else if (matches.length === 0) {
      console.log(`  ${name}: code "${code}" — NO Milo employee with this name`);
    } else {
      console.log(`  ${name}: code "${code}" — ${matches.length} Milo employees share this name (ambiguous)`);
    }
  }
  console.log("");
  console.log("(read-only — nothing changed)");
  process.exit(0);
}

main().catch((e) => {
  console.error("ref-check failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
