"use client";

import * as React from "react";
import { RotateCcw, X } from "lucide-react";
import type { Payslip, Employee } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import {
  unvoidPayslipAction,
  voidPayslipAction,
} from "../actions";

type Row = {
  payslip: Pick<
    Payslip,
    | "id"
    | "employeeId"
    | "hoursWorked"
    | "roundedPayCents"
    | "voidedAt"
    | "voidReason"
  >;
  employee: Pick<Employee, "id" | "displayName">;
};

export function PayslipManageSection({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage payslips</CardTitle>
        <CardDescription>
          Manual override. Remove a payslip if the employee shouldn&apos;t
          have been on this run (wrong cohort, wrong schedule, etc.). The
          run&apos;s total recomputes immediately. Works on published runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="min-w-full text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
            <tr>
              <th className="py-2 pr-3 font-medium">Employee</th>
              <th className="py-2 px-3 font-medium text-right">Hours</th>
              <th className="py-2 px-3 font-medium text-right">Amount</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <PayslipRow key={r.payslip.id} row={r} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function PayslipRow({ row }: { row: Row }) {
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isVoided = row.payslip.voidedAt !== null;

  return (
    <>
      <tr className={isVoided ? "opacity-60" : ""}>
        <td className="py-2 pr-3">
          <span className={isVoided ? "line-through" : "font-medium"}>
            {row.employee.displayName}
          </span>
        </td>
        <td className="py-2 px-3 text-right font-mono tabular-nums">
          {Number(row.payslip.hoursWorked).toFixed(2)}
        </td>
        <td className="py-2 px-3 text-right font-mono tabular-nums">
          <MoneyDisplay cents={row.payslip.roundedPayCents} />
        </td>
        <td className="py-2 px-3 text-xs text-text-muted">
          {isVoided ? (
            <>
              <span className="rounded-input bg-red-50 text-red-700 px-1.5 py-0.5">
                Voided
              </span>{" "}
              {row.payslip.voidReason && (
                <span className="ml-1 italic">
                  &ldquo;{row.payslip.voidReason}&rdquo;
                </span>
              )}
            </>
          ) : (
            "Included"
          )}
        </td>
        <td className="py-2 px-3 text-right">
          {isVoided ? (
            <form
              action={async () => {
                setPending(true);
                setError(null);
                const r = await unvoidPayslipAction(row.payslip.id);
                setPending(false);
                if (r?.error) setError(r.error);
              }}
            >
              <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </Button>
            </form>
          ) : !confirming ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(true)}
            >
              <X className="h-3.5 w-3.5 text-red-600" /> Remove
            </Button>
          ) : null}
        </td>
      </tr>
      {confirming && !isVoided && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <form
              action={async (form) => {
                setPending(true);
                setError(null);
                const r = await voidPayslipAction(row.payslip.id, form);
                setPending(false);
                if (r?.error) setError(r.error);
                else setConfirming(false);
              }}
              className="rounded-card border border-amber-300 bg-amber-50/40 p-3 space-y-2"
            >
              <p className="text-xs font-medium">
                Remove {row.employee.displayName} from this run? Reason will
                be audited; the run total will recompute.
              </p>
              <Input
                name="reason"
                required
                minLength={1}
                maxLength={500}
                placeholder="e.g. Juan is on the semi-monthly schedule, not weekly"
              />
              {error && <p className="text-xs text-red-700">{error}</p>}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Removing…" : "Confirm remove"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
