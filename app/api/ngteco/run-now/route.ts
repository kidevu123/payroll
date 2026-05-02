// POST /api/ngteco/run-now — admin-triggered NGTeco scrape.
//
// Mirrors what the cron-driven payroll.run.tick does: ensures a current
// period exists, creates a SCHEDULED PayrollRun, and enqueues an
// `ngteco.import` job against it. Returns the runId so the caller can
// poll status.
//
// Used by the Dashboard top card and the /settings/ngteco page.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getBoss } from "@/lib/jobs";
import { getSetting } from "@/lib/settings/runtime";
import { getCurrentPeriod } from "@/lib/db/queries/pay-periods";
import { createRun } from "@/lib/db/queries/payroll-runs";

export async function POST(): Promise<Response> {
  const session = await requireAdmin();
  const company = await getSetting("company");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  }).format(new Date());
  // Read-only — auto-create disabled. Admin must upload a CSV first
  // (or add a manual punch) to establish the period.
  const period = await getCurrentPeriod(today);
  if (!period) {
    return NextResponse.json(
      {
        error:
          "No current pay period exists. Upload a CSV at /run-payroll/upload first to establish the period.",
      },
      { status: 409 },
    );
  }
  const run = await createRun(period.id, new Date(), {
    id: session.user.id,
    role: session.user.role,
  });
  const boss = await getBoss();
  await boss.send("ngteco.import", { runId: run.id });
  return NextResponse.json({
    runId: run.id,
    periodId: period.id,
    state: "SCHEDULED",
  });
}
