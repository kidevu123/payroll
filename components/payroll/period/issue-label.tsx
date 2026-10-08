// The Issues cell of the employee totals table: incomplete punches, or a
// stored-vs-live hours drift warning, or a dash.
import type React from "react";
import { AlertTriangle } from "lucide-react";

export function issueLabel(row: {
  incomplete: number;
  hoursDrift?: boolean;
  storedHours?: number;
  liveHours?: number;
}): React.ReactNode {
  if (row.incomplete > 0) {
    return (
      <span className="text-warning-700">
        {row.incomplete} incomplete
      </span>
    );
  }
  if (row.hoursDrift) {
    return (
      <span
        className="inline-flex items-center gap-1 text-warning-700"
        title={`Stored hours (${row.storedHours?.toFixed(2)}h) don't match live punch hours (${row.liveHours?.toFixed(2)}h). Open employee row to inspect; expand to see daily punches. Use "Recompute payslip" on the run page to overwrite stored with live.`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        drift: stored {row.storedHours?.toFixed(2)}h vs live{" "}
        {row.liveHours?.toFixed(2)}h
      </span>
    );
  }
  return <span className="text-text-subtle">—</span>;
}
