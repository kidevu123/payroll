"use client";

import * as React from "react";
import type { AutomationSettings } from "@/lib/settings/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CronPicker } from "@/components/admin/cron-picker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateAutomationAction } from "./actions";

export function AutomationForm({ automation }: { automation: AutomationSettings }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automation</CardTitle>
        <CardDescription>
          Cron schedule, employee fix window, suspicious-duration thresholds.
          Each Pay Schedule has its own cron in Settings → Pay schedules; this
          tab governs the global default.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            const result = await updateAutomationAction(form);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <input
              id="enabled"
              type="checkbox"
              name="enabled"
              defaultChecked={automation.payrollRun.enabled}
              className="h-4 w-4"
            />
            <Label htmlFor="enabled">Run-tick enabled</Label>
          </div>
          <CronPicker
            name="cron"
            label="When should the global payroll run fire?"
            defaultValue={automation.payrollRun.cron}
          />

          <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <input
                id="punchPollEnabled"
                type="checkbox"
                name="punchPollEnabled"
                defaultChecked={automation.ngtecoPunchPoll.enabled}
                className="h-4 w-4"
              />
              <Label htmlFor="punchPollEnabled">Real-time NGTeco punch poll</Label>
            </div>
            <p className="text-xs text-text-muted">
              When on, the worker pulls every individual punch off NGTeco&apos;s
              View Attendance Punch view on a short interval. Pairs in/out
              automatically and lands them on the current pay period — so
              /me/time stays approximately live instead of waiting for the
              weekly aggregator. Default: every 15 minutes.
            </p>
            <CronPicker
              name="punchPollCron"
              label="Poll interval (cron)"
              defaultValue={automation.ngtecoPunchPoll.cron}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="employeeFixWindowHours">Employee fix window (hours)</Label>
              <Input
                id="employeeFixWindowHours"
                name="employeeFixWindowHours"
                type="number"
                min={1}
                max={168}
                required
                defaultValue={automation.employeeFixWindowHours}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                id="notifyFail"
                type="checkbox"
                name="adminAutoNotifyOnIngestFail"
                defaultChecked={automation.adminAutoNotifyOnIngestFail}
                className="h-4 w-4"
              />
              <Label htmlFor="notifyFail">Notify admin on ingest failure</Label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="susShort">Suspicious duration: short threshold (minutes)</Label>
              <Input
                id="susShort"
                name="suspiciousDurationMinutesShortThreshold"
                type="number"
                min={1}
                required
                defaultValue={automation.suspiciousDurationMinutesShortThreshold}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="susLong">Suspicious duration: long threshold (minutes)</Label>
              <Input
                id="susLong"
                name="suspiciousDurationMinutesLongThreshold"
                type="number"
                min={1}
                required
                defaultValue={automation.suspiciousDurationMinutesLongThreshold}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
