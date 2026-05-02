"use client";

import * as React from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recomputeAllPayslipsForEmployeeAction } from "../actions";

export function RecomputePayslipsButton({
  employeeId,
}: {
  employeeId: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    { recomputed: number; skipped: number } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          setResult(null);
          const r = await recomputeAllPayslipsForEmployeeAction(employeeId);
          setPending(false);
          if ("error" in r) setError(r.error);
          else setResult({ recomputed: r.recomputed, skipped: r.skipped });
        }}
      >
        <Calculator className="h-3.5 w-3.5" />
        {pending ? "Recomputing…" : "Recompute all payslips"}
      </Button>
      {result && (
        <span className="text-xs text-emerald-700">
          Recomputed {result.recomputed}
          {result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}.
          Refresh to see updated numbers.
        </span>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
