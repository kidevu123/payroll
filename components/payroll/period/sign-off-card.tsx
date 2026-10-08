// Payslip sign-off: who has signed, acknowledged, is pending, or disputed.
import type React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { payslipHasPay } from "@/lib/payroll/payslip-pay";
import { signOffGroups } from "@/lib/payroll/period-rows";
import type { PeriodReview } from "@/lib/db/queries/period-review";

export function SignOffCard({ review }: { review: PeriodReview }) {
  const { allEmployees, allPayslips } = review;
  return (
    <>
      {/* Acknowledgement roll — owner ask: "where does that go right
          now there is needs to be a distinct place to see they have
          approved their pay slip". Counts active payslips by status
          (acknowledged / disputed / awaiting), with names listed
          under each bucket so admin sees exactly who's outstanding. */}
      {(() => {
        // Only payslips that pay something: zero-pay rows (did not work
        // this week) are internal bookkeeping, never something to sign.
        const { active, signed, ackd, disputed, pending } = signOffGroups(
          allPayslips,
          payslipHasPay,
        );
        const nameOf = (id: string) =>
          allEmployees.find((e) => e.id === id)?.displayName ?? "—";
        if (active.length === 0) return null;
        const buckets = [
          {
            key: "signed",
            label: "Signed",
            dot: "bg-brand-700",
            count: signed.length,
            names: signed.map((p) => nameOf(p.employeeId)).sort(),
          },
          {
            key: "acknowledged",
            label: "Acknowledged, not signed",
            dot: "bg-success-600",
            count: ackd.length,
            names: ackd.map((p) => nameOf(p.employeeId)).sort(),
          },
          {
            key: "pending",
            label: "Pending",
            dot: "bg-warning-600",
            count: pending.length,
            names: pending.map((p) => nameOf(p.employeeId)).sort(),
          },
          ...(disputed.length > 0
            ? [
                {
                  key: "disputed",
                  label: "Disputed",
                  dot: "bg-danger-600",
                  count: disputed.length,
                  names: disputed.map((p) => nameOf(p.employeeId)).sort(),
                },
              ]
            : []),
        ];
        return (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Payslip sign-off</CardTitle>
                <CardDescription>
                  Signatures come from the warehouse tablet and print on the
                  Signature report.
                </CardDescription>
              </div>
              <p className="text-caption text-text-muted tabular-nums">
                <span className="text-subheading font-semibold text-text">
                  {signed.length}
                </span>
                <span className="text-text-subtle"> of {active.length}</span>{" "}
                signed
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stacked bar: every payslip is a segment, colored by its
                  state. A 0% single-fill bar read as an empty gray line. */}
              <div
                className="flex h-2 gap-px overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={active.length}
                aria-valuenow={signed.length}
                aria-label="Payslips signed"
              >
                {buckets
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <div
                      key={b.key}
                      className={`h-full ${b.dot} ${b.key === "pending" ? "opacity-50" : ""}`}
                      style={{ width: `${(b.count / active.length) * 100}%` }}
                      aria-hidden
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                {buckets.map((bucket) => (
                  <div key={bucket.key} className="min-w-[12rem] flex-1 space-y-2">
                    <p className="flex items-center gap-1.5 text-micro uppercase text-text-subtle">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${bucket.dot}`}
                        aria-hidden
                      />
                      {bucket.label}
                      <span className="tabular-nums">({bucket.count})</span>
                    </p>
                    {bucket.names.length === 0 ? (
                      <p className="text-xs text-text-subtle">No one yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {bucket.names.map((name) => (
                          <span
                            key={name}
                            className="inline-flex rounded-chip border border-border/60 bg-surface-2/60 px-2 py-0.5 text-xs text-text-muted"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </>
  );
}
