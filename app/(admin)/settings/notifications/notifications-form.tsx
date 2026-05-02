"use client";

import * as React from "react";
import type { NotificationsSettings } from "@/lib/settings/schemas";
import { Button } from "@/components/ui/button";
import { updateNotificationsAction } from "./actions";

const KIND_LABELS: Record<string, string> = {
  "missed_punch.detected": "Missed punch detected",
  "missed_punch.request_submitted": "Missed-punch request submitted",
  "missed_punch.request_resolved": "Missed-punch request resolved",
  "time_off.request_submitted": "Time-off request submitted",
  "time_off.request_resolved": "Time-off request resolved",
  "payroll_run.ingest_failed": "Payroll run: ingest failed",
  "payroll_run.awaiting_review": "Payroll run: awaiting review",
  "payroll_run.published": "Payroll run: published",
  "period.locked": "Pay period locked",
};

export function NotificationsForm({
  notifications,
}: {
  notifications: NotificationsSettings;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const kinds = Object.keys(notifications.defaults) as Array<keyof typeof notifications.defaults>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            const result = await updateNotificationsAction(form);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
          className="space-y-4"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                <tr>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 px-3 font-medium text-center">In-app</th>
                  <th className="py-2 px-3 font-medium text-center">Email</th>
                  <th className="py-2 px-3 font-medium text-center">Push</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {kinds.map((kind) => {
                  const val = notifications.defaults[kind];
                  if (!val) return null;
                  return (
                    <tr key={kind}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{KIND_LABELS[kind] ?? kind}</div>
                        <div className="text-xs text-text-muted font-mono">{kind}</div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          name={`${kind}|in_app`}
                          defaultChecked={val.in_app}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          name={`${kind}|email`}
                          defaultChecked={val.email}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          name={`${kind}|push`}
                          defaultChecked={val.push}
                          className="h-4 w-4"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
    </div>
  );
}
