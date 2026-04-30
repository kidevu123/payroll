"use client";

import * as React from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acknowledgePayslipAction } from "./actions";

export function AcknowledgeButton({ payslipId }: { payslipId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      action={async () => {
        setPending(true);
        setError(null);
        const result = await acknowledgePayslipAction(payslipId);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="flex items-center justify-end gap-3"
    >
      {error && <span className="text-sm text-red-700">{error}</span>}
      <Button type="submit" disabled={pending}>
        <CircleCheck className="h-4 w-4" />{" "}
        {pending ? "Recording…" : "I have reviewed this payslip"}
      </Button>
    </form>
  );
}
