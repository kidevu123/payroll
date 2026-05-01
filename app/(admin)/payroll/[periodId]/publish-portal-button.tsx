"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import type { PayrollRun } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { publishReportAction } from "../../reports/actions";

export function PublishPortalButton({ run }: { run: PayrollRun }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const published = run.publishedToPortalAt !== null;

  if (published) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-input bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
        <Eye className="h-4 w-4" /> Visible to employees
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await publishReportAction(run.id);
          setPending(false);
          if (result?.error) setError(result.error);
        }}
      >
        <EyeOff className="h-4 w-4" /> {pending ? "Publishing…" : "Publish to employee portal"}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
