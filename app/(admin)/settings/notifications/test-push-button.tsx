"use client";

import * as React from "react";
import { Bell, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendTestPushAction, type SendTestPushResult } from "./actions";

export function TestPushButton({ disabled }: { disabled?: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<SendTestPushResult | null>(null);

  async function onClick() {
    setPending(true);
    setResult(null);
    try {
      const r = await sendTestPushAction();
      setResult(r);
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          onClick={onClick}
          title="Fires a push to your own subscriptions and reports the delivery result."
        >
          <Bell className="h-3.5 w-3.5" />{" "}
          {pending ? "Sending…" : "Send test push to me"}
        </Button>
        {result?.subscriptionCount !== undefined && (
          <span className="text-xs text-text-muted">
            {result.subscriptionCount} subscription
            {result.subscriptionCount === 1 ? "" : "s"} on file
            {result.pruned ? ` · ${result.pruned} pruned` : ""}
          </span>
        )}
      </div>
      {result && (
        <div
          className={`flex items-start gap-2 rounded-input border px-3 py-2 text-xs ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
          )}
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
