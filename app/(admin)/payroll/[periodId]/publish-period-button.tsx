"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publishLockedPeriodAction } from "../actions";

export function PublishPeriodButton({
  periodId,
  periodState,
  published,
}: {
  periodId: string;
  periodState: "OPEN" | "LOCKED" | "PAID";
  published: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (published) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-input bg-success-50 px-3 py-1.5 text-sm font-medium text-success-700">
        <Eye className="h-4 w-4" /> Visible to employees
      </span>
    );
  }

  if (periodState !== "LOCKED") return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await publishLockedPeriodAction(periodId);
          setPending(false);
          if (result?.error) setError(result.error);
        }}
      >
        <EyeOff className="h-4 w-4" /> {pending ? "Publishing..." : "Publish"}
      </Button>
      {error && <span className="text-xs text-danger-700">{error}</span>}
    </div>
  );
}
