// Names only. This list is what the whole warehouse can glance at while
// the tablet goes around, so it never renders an amount or hours.

import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { listPayablePayslipsForPeriod } from "@/lib/db/queries/payslips";
import { requirePaydayPeriod } from "../../actions";

export const dynamic = "force-dynamic";

export default async function PaydayListPage({
  searchParams,
}: {
  searchParams: Promise<{ signed?: string }>;
}) {
  const sp = await searchParams;
  const period = await requirePaydayPeriod();
  if (!period) redirect("/kiosk/payday");

  // Published + real pay only: someone who did not work this period has
  // nothing to sign and must not appear on the list.
  const slips = (await listPayablePayslipsForPeriod(period.id)).filter((p) => p.publishedAt);
  const ids = [...new Set(slips.map((s) => s.employeeId))];
  const people = ids.length
    ? await db
        .select({
          id: employees.id,
          displayName: employees.displayName,
        })
        .from(employees)
        .where(inArray(employees.id, ids))
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
  // Owner ask: once someone has signed, their name leaves the list, so
  // what remains is exactly who still needs to sign. The counter keeps
  // the progress visible.
  const signed = slips.filter((s) => s.signedAt).length;
  const rows = slips
    .filter((s) => !s.signedAt)
    .map((s) => ({ slip: s, name: nameOf.get(s.employeeId) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex flex-1 flex-col gap-4">
      {sp.signed ? (
        <p className="flex items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-4 text-xl font-semibold text-brand-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> Signed. Thank you.
        </p>
      ) : null}
      <p className="text-lg text-text-muted">
        Tap your name, then sign.{" "}
        <span className="font-semibold tabular-nums text-text">
          {signed} of {slips.length}
        </span>{" "}
        signed
      </p>
      {slips.length === 0 ? (
        <p className="rounded-xl border-2 border-border bg-surface px-6 py-8 text-center text-xl text-text-muted">
          No published payslips for this period yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="flex items-center justify-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-6 py-8 text-center text-xl font-semibold text-brand-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> Everyone has signed.
        </p>
      ) : (
        <div className="divide-y-2 divide-border rounded-xl border-2 border-border bg-surface">
          {rows.map(({ slip, name }) => (
            <Link
              key={slip.id}
              href={`/kiosk/payday/sign/${slip.id}`}
              className="flex items-center justify-between gap-3 px-6 py-5 active:bg-surface-2"
            >
              <p className="text-2xl font-bold">{name}</p>
              <ChevronRight className="h-8 w-8 shrink-0 text-text-subtle" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
