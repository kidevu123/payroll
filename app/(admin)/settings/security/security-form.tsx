"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SecuritySettings } from "@/lib/settings/schemas";
import { saveSecurity } from "./actions";

export function SecurityForm({ settings }: { settings: SecuritySettings }) {
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          Admin 2FA toggle, session lifetime, login rate limit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await saveSecurity(form);
            setPending(false);
            if (result?.error) setError(result.error);
            else setSaved(true);
          }}
          className="space-y-5"
        >
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="adminTwoFactorRequired"
              defaultChecked={settings.adminTwoFactorRequired}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Require 2FA for admin accounts</span>
              <span className="block text-xs text-text-muted">
                Recommended for production, off by default per the rebuild
                contract.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sessionTimeoutDays">Session timeout (days)</Label>
              <Input
                id="sessionTimeoutDays"
                name="sessionTimeoutDays"
                type="number"
                min={1}
                max={180}
                defaultValue={settings.sessionTimeoutDays}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loginRateLimitMax">Max login attempts</Label>
              <Input
                id="loginRateLimitMax"
                name="loginRateLimitMax"
                type="number"
                min={1}
                defaultValue={settings.loginRateLimit.maxAttempts}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loginRateLimitWindowMinutes">Window (minutes)</Label>
              <Input
                id="loginRateLimitWindowMinutes"
                name="loginRateLimitWindowMinutes"
                type="number"
                min={1}
                defaultValue={settings.loginRateLimit.windowMinutes}
                required
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {saved && <p className="text-sm text-emerald-700">Saved.</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
