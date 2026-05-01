"use client";

import * as React from "react";
import { Copy, Power, PowerOff, KeyRound, RefreshCw, Send } from "lucide-react";
import type { User } from "@/lib/db/schema";
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
import {
  generateTempPasswordAction,
  inviteEmployeeAction,
  setPasswordAction,
  setRoleAction,
  toggleDisabledAction,
} from "./account-actions";

export function AccountSection({
  employeeId,
  employeeEmail,
  user,
}: {
  employeeId: string;
  employeeEmail: string;
  user: User | null;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [tempPassword, setTempPassword] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore — manual copy is the fallback
    }
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            No login account exists for this employee yet. Send them an invite
            to create one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            action={async (form) => {
              setPending("invite");
              setError(null);
              setTempPassword(null);
              const result = await inviteEmployeeAction(employeeId, form);
              setPending(null);
              if (result?.error) setError(result.error);
              else if (result?.tempPassword) setTempPassword(result.tempPassword);
            }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="invite-email">Login email</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                defaultValue={employeeEmail}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                name="role"
                defaultValue="EMPLOYEE"
                className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
              >
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={pending !== null} className="sm:col-span-3 sm:w-auto sm:justify-self-start">
              <Send className="h-4 w-4" /> {pending === "invite" ? "Creating…" : "Send invite"}
            </Button>
          </form>
          {tempPassword && (
            <TempPasswordCallout value={tempPassword} onCopy={handleCopy} />
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          {user.email}
          {user.disabledAt && <span className="ml-2 rounded-input bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Disabled</span>}
          {user.mustChangePassword && (
            <span className="ml-2 rounded-input bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              Must change password
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <form
            action={async (form) => {
              setPending("setpw");
              setError(null);
              setTempPassword(null);
              const result = await setPasswordAction(user.id, form);
              setPending(null);
              if (result?.error) setError(result.error);
            }}
            className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
          >
            <Label htmlFor="set-password" className="font-medium">
              Set password
            </Label>
            <Input
              id="set-password"
              name="password"
              type="password"
              minLength={8}
              required
              placeholder="At least 8 characters"
            />
            <Button type="submit" size="sm" disabled={pending !== null}>
              <KeyRound className="h-4 w-4" /> {pending === "setpw" ? "Saving…" : "Set"}
            </Button>
            <p className="text-xs text-text-muted">
              The user will be required to rotate it on next sign-in.
            </p>
          </form>

          <div className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm">
            <Label className="font-medium">Generate temporary password</Label>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending !== null}
              onClick={async () => {
                setPending("gen");
                setError(null);
                const result = await generateTempPasswordAction(user.id);
                setPending(null);
                if (result?.error) setError(result.error);
                else if (result?.tempPassword) setTempPassword(result.tempPassword);
              }}
            >
              <RefreshCw className="h-4 w-4" />{" "}
              {pending === "gen" ? "Generating…" : "Generate"}
            </Button>
            <p className="text-xs text-text-muted">
              12 characters, displayed once. Copy it before navigating away.
            </p>
          </div>
        </div>

        {tempPassword && <TempPasswordCallout value={tempPassword} onCopy={handleCopy} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <form
            action={async (form) => {
              setPending("role");
              setError(null);
              const result = await setRoleAction(user.id, form);
              setPending(null);
              if (result?.error) setError(result.error);
            }}
            className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
          >
            <Label htmlFor="role-select" className="font-medium">
              Role
            </Label>
            <select
              id="role-select"
              name="role"
              defaultValue={user.role === "OWNER" ? "OWNER" : user.role}
              disabled={user.role === "OWNER"}
              className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
            >
              <option value="EMPLOYEE">Employee</option>
              <option value="ADMIN">Admin</option>
              {user.role === "OWNER" && <option value="OWNER">Owner (fixed)</option>}
            </select>
            {user.role !== "OWNER" && (
              <Button type="submit" size="sm" disabled={pending !== null}>
                {pending === "role" ? "Saving…" : "Update role"}
              </Button>
            )}
            {user.role === "OWNER" && (
              <p className="text-xs text-text-muted">
                The OWNER role is fixed at one user.
              </p>
            )}
          </form>

          <div className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm">
            <Label className="font-medium">Account state</Label>
            <Button
              size="sm"
              variant={user.disabledAt ? "default" : "secondary"}
              disabled={pending !== null}
              onClick={async () => {
                setPending("toggle");
                setError(null);
                const result = await toggleDisabledAction(user.id, !user.disabledAt);
                setPending(null);
                if (result?.error) setError(result.error);
              }}
            >
              {user.disabledAt ? (
                <>
                  <Power className="h-4 w-4" /> Activate account
                </>
              ) : (
                <>
                  <PowerOff className="h-4 w-4" /> Deactivate account
                </>
              )}
            </Button>
            <p className="text-xs text-text-muted">
              Disabled users cannot sign in but their data is preserved.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

function TempPasswordCallout({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (v: string) => void;
}) {
  return (
    <div className="rounded-card border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-amber-800">
        Temporary password — share once, copy now
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-input bg-amber-100/70 px-3 py-2 font-mono text-sm">
          {value}
        </code>
        <Button size="sm" variant="ghost" onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" /> Copy
        </Button>
      </div>
      <p className="mt-1 text-xs text-amber-800">
        The user will be forced to change it on first sign-in.
      </p>
    </div>
  );
}
