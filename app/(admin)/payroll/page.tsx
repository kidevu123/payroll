// /payroll — "Run payroll" launcher. Historical reports moved to /reports;
// this page is for actively driving a run (kick NGTeco scrape, upload a CSV,
// review in-flight runs awaiting admin action).

import Link from "next/link";
import { Wallet, Upload, Play, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/domain/status-pill";
import { listPeriods } from "@/lib/db/queries/pay-periods";
import { db } from "@/lib/db";
import { payrollRuns, payPeriods, paySchedules } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { NgtecoRunNowButton } from "@/components/admin/ngteco-run-now";
import { InFlightRow } from "./in-flight-row";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const [openPeriods, recentInFlight, schedules] = await Promise.all([
    listPeriods({ limit: 5 }),
    db
      .select({
        id: payrollRuns.id,
        periodId: payrollRuns.periodId,
        state: payrollRuns.state,
        startDate: payPeriods.startDate,
        endDate: payPeriods.endDate,
        scheduleName: paySchedules.name,
        createdAt: payrollRuns.createdAt,
      })
      .from(payrollRuns)
      .leftJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
      .leftJoin(paySchedules, eq(payrollRuns.payScheduleId, paySchedules.id))
      .where(
        sql`${payrollRuns.state} IN ('SCHEDULED','INGESTING','INGEST_FAILED','AWAITING_EMPLOYEE_FIXES','AWAITING_ADMIN_REVIEW','APPROVED')`,
      )
      .orderBy(desc(payrollRuns.createdAt))
      .limit(10),
    db.select().from(paySchedules).where(eq(paySchedules.active, true)),
  ]);
  const openCount = openPeriods.filter((p) => p.state === "OPEN").length;
  const lockedCount = openPeriods.filter((p) => p.state === "LOCKED").length;
  const paidCount = openPeriods.filter((p) => p.state === "PAID").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Run payroll</h1>
        <p className="text-sm text-text-muted">
          Trigger an import or upload a CSV. Historical reports live in{" "}
          <Link href="/reports" className="text-brand-700 underline underline-offset-2">
            Reports
          </Link>
          .
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-surface-2 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4 text-brand-700" /> Pull from NGTeco
            </CardTitle>
            <CardDescription>
              Kick the scraper now. Use this to test automation or to catch
              up after a missed run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NgtecoRunNowButton size="md" />
            <p className="text-xs text-text-muted">
              The scheduled cron(s) still fire on their own:{" "}
              {schedules.length === 0
                ? "no active schedules — add one in Settings → Pay schedules."
                : schedules.map((s) => s.name).join(", ")}
              .
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface-2 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-brand-700" /> Upload CSV instead
            </CardTitle>
            <CardDescription>
              For manual backfills or when the NGTeco scraper is offline.
              Accepts the NGTeco export shape and a permissive legacy fallback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/run-payroll/upload">
                Open upload form <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">In-flight runs</CardTitle>
            <CardDescription>
              {recentInFlight.length === 0
                ? "Nothing is awaiting your action right now."
                : `${recentInFlight.length} run${recentInFlight.length === 1 ? "" : "s"} awaiting review or fixes.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentInFlight.length === 0 ? (
            <p className="text-sm text-text-muted">
              {openCount > 0
                ? `${openCount} open period${openCount === 1 ? "" : "s"} ready for the next tick.${
                    lockedCount > 0
                      ? ` ${lockedCount} locked, awaiting payment.`
                      : ""
                  }`
                : lockedCount > 0
                  ? `${lockedCount} locked period${lockedCount === 1 ? "" : "s"} awaiting payment. Mark paid from the period detail page once payment is sent.`
                  : `${paidCount} paid period${paidCount === 1 ? "" : "s"} on file. The next scheduled tick will create a new period.`}
            </p>
          ) : (
            recentInFlight.map((r) => (
              <InFlightRow
                key={r.id}
                runId={r.id}
                href={`/payroll/run/${r.id}`}
                startDate={r.startDate ?? "?"}
                endDate={r.endDate ?? "?"}
                scheduleName={r.scheduleName}
                state={r.state}
                createdAt={r.createdAt.toISOString()}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-brand-700" /> Recent periods
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {openPeriods.length === 0 ? (
            <p className="text-sm text-text-muted">No periods yet.</p>
          ) : (
            openPeriods.map((p) => (
              <Link
                key={p.id}
                href={`/payroll/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
              >
                <div className="font-medium">
                  {p.startDate} – {p.endDate}
                </div>
                <StatusPill status={p.state} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
