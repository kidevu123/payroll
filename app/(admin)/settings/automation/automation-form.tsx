"use client";

import * as React from "react";
import type { AutomationSettings } from "@/lib/settings/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CronPicker } from "@/components/admin/cron-picker";
import { updateAutomationAction } from "./actions";

export function AutomationForm({ automation }: { automation: AutomationSettings }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <div className="space-y-4">
      <h2 className="text-heading font-semibold tracking-tight text-text">Automation</h2>
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
          <div className="rounded-card border-2 border-danger-200 bg-danger-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="cronEnabled"
                type="checkbox"
                name="cronEnabled"
                defaultChecked={automation.cronEnabled}
                className="h-4 w-4"
              />
              <Label htmlFor="cronEnabled" className="font-semibold">
                Master: cron schedules enabled
              </Label>
            </div>
            <p className="text-xs text-danger-700">
              When OFF, NO scheduled job fires — including period rollover and
              the heartbeat. Use this for full-manual mode while reconciling
              data. After flipping off + saving, also delete the existing
              pg-boss schedule rows once (Database → pgboss.schedule) so any
              currently-armed schedules don&apos;t fire one more time before
              the boss process restarts.
            </p>
          </div>

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
              label="How often should we pull punches?"
              defaultValue={automation.ngtecoPunchPoll.cron}
            />
          </div>

          <div className="space-y-3 rounded-card border border-border bg-surface-2 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <input
                id="ngtecoRosterSyncEnabled"
                type="checkbox"
                name="ngtecoRosterSyncEnabled"
                defaultChecked={automation.ngtecoEmployeeRosterSync.enabled}
                className="h-4 w-4"
              />
              <Label htmlFor="ngtecoRosterSyncEnabled">
                Auto-import new people from NGTeco
              </Label>
            </div>
            <p className="text-xs text-text-muted">
              After a successful punch poll, Milo reads Group Management → Person
              on the time clock and creates inactive employee stubs (ref, name,
              email) so you can finish rate and schedule on Employees.
            </p>
            <div className="flex items-center gap-2">
              <input
                id="ngtecoRosterNotify"
                type="checkbox"
                name="ngtecoRosterNotify"
                defaultChecked={automation.ngtecoEmployeeRosterSync.notifyOnImport}
                className="h-4 w-4"
              />
              <Label htmlFor="ngtecoRosterNotify">Notify admins when new stubs are created</Label>
            </div>
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="ngtecoRosterMinHours">Minimum hours between roster syncs</Label>
              <Input
                id="ngtecoRosterMinHours"
                name="ngtecoRosterMinHours"
                type="number"
                min={1}
                max={168}
                required
                defaultValue={automation.ngtecoEmployeeRosterSync.minHoursBetweenSync}
              />
            </div>
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
    </div>
  );
}
