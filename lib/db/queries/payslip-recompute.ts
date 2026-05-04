// Post-tx payslip recompute hook used by punches.ts after edit/void.
//
// Lives in its own file (not payslips.ts) to avoid a circular module
// load — payslips.ts pulls heavy compute deps that punches.ts shouldn't
// transitively require for an idempotent recompute call.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips } from "@/lib/db/schema";
import type { Actor } from "./employees";

/**
 * Find the active payslip on (employeeId, periodId) and recompute it.
 * No-op when no payslip exists yet. Runs in its own transaction (the
 * caller's punch edit/void tx is already committed).
 */
export async function recomputePayslipForEmployeePeriod(
  employeeId: string,
  periodId: string,
  actor: Actor,
): Promise<void> {
  const [py] = await db
    .select()
    .from(payslips)
    .where(
      and(
        eq(payslips.employeeId, employeeId),
        eq(payslips.periodId, periodId),
        isNull(payslips.voidedAt),
      ),
    );
  if (!py) return;
  const { recomputePayslip } = await import("./payslips");
  await recomputePayslip(py.id, actor);
}
