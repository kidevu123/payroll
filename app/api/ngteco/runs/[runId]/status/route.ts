// GET /api/ngteco/runs/[runId]/status — light polling endpoint for the
// Run Now button. Returns the current state + ingest timing so the UI
// can render "Importing… (12s)" / "Done" / "Failed (reason)".

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getRun } from "@/lib/db/queries/payroll-runs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { runId } = await context.params;
  const run = await getRun(runId);
  if (!run) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({
    id: run.id,
    state: run.state,
    ingestStartedAt: run.ingestStartedAt,
    ingestCompletedAt: run.ingestCompletedAt,
    lastError: run.lastError,
  });
}
