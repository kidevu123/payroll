"use client";

import * as React from "react";
import { Bell, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSubscribedRecipientsAction,
  sendTestPushAction,
  type SendTestPushResult,
  type SubscribedRecipient,
} from "./actions";

export function TestPushButton({ disabled }: { disabled?: boolean }) {
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<SendTestPushResult | null>(null);
  const [recipients, setRecipients] = React.useState<SubscribedRecipient[]>([]);
  const [recipientId, setRecipientId] = React.useState<string>("");
  const [loadingRecipients, setLoadingRecipients] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingRecipients(true);
    void listSubscribedRecipientsAction()
      .then((rows) => {
        if (cancelled) return;
        setRecipients(rows);
        if (rows[0]) setRecipientId(rows[0].userId);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecipients(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onClick() {
    setPending(true);
    setResult(null);
    try {
      const r = await sendTestPushAction(recipientId || undefined);
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
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          disabled={disabled || loadingRecipients || recipients.length === 0}
          className="rounded-input border border-border bg-surface px-2 py-1.5 text-sm"
        >
          {loadingRecipients ? (
            <option value="">Loading recipients…</option>
          ) : recipients.length === 0 ? (
            <option value="">
              Nobody is subscribed yet — open /me/profile/notifications on a phone first
            </option>
          ) : (
            recipients.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.label} ({r.subscriptionCount} device
                {r.subscriptionCount === 1 ? "" : "s"})
              </option>
            ))
          )}
        </select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending || !recipientId}
          onClick={onClick}
          title="Sends a push to the selected user's subscribed devices and reports the delivery result."
        >
          <Bell className="h-3.5 w-3.5" />{" "}
          {pending ? "Sending…" : "Send test push"}
        </Button>
      </div>
      {result && (
        <div
          className={`flex items-start gap-2 rounded-input border px-3 py-2 text-xs ${
            result.ok
              ? "border-success-200 bg-success-50 text-success-900"
              : "border-warning-200 bg-warning-50 text-warning-900"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-success-700" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning-700" />
          )}
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
