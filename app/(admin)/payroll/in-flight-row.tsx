"use client";

import * as React from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/domain/status-pill";
import { deleteReportAction } from "../reports/actions";

/**
 * One row in the In-flight runs list. Whole card is a link to the review
 * page; a separate Delete button (with inline confirm) lets the admin
 * scrub stale runs from testing without going through the Reports table.
 */
export function InFlightRow({
  runId,
  href,
  startDate,
  endDate,
  scheduleName,
  state,
  createdAt,
}: {
  runId: string;
  href: string;
  startDate: string;
  endDate: string;
  scheduleName: string | null;
  state: string;
  createdAt: string;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="rounded-card border border-border bg-surface-2 shadow-sm">
      <div className="flex items-center justify-between gap-3 p-3">
        <Link
          href={href}
          className="flex-1 min-w-0 hover:bg-surface-3 -m-1 p-1 rounded"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">
              {startDate} – {endDate}
            </span>
            {scheduleName && (
              <span className="rounded-input bg-surface px-2 py-0.5 text-[11px] text-text-muted">
                {scheduleName}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted">
            Created {createdAt.slice(0, 16).replace("T", " ")}
          </div>
        </Link>
        <StatusPill status={state as never} />
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-700"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const result = await deleteReportAction(runId);
                setPending(false);
                if (result?.error) setError(result.error);
                setConfirming(false);
              }}
            >
              {pending ? "…" : "Confirm delete"}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            title="Delete this run"
            onClick={() => setConfirming(true)}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {error && (
        <div className="border-t border-border px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
