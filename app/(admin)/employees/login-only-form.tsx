"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, KeyRound, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createStaffUserAction } from "../settings/roles/actions";

/**
 * Step 2 of the "Add person" flow for `kind=login`. A minimal form that
 * creates a standalone app login (no Employee row, no clock, no pay type)
 * by reusing the EXISTING createStaffUserAction from the roles settings.
 *
 * The action's Zod schema only accepts ADMIN | PAYROLL_STAFF | ACCOUNTANT,
 * so EMPLOYEE and OWNER are intentionally excluded from the dropdown here.
 * Default is ACCOUNTANT — the canonical "needs a login, not a paycheck"
 * persona (cash-drawer + reports access).
 *
 * On success the action returns a one-time temp password; we surface it
 * with a copy affordance, matching the Staff logins panel UX.
 */

const ROLE_OPTIONS = [
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "PAYROLL_STAFF", label: "Payroll staff" },
  { value: "ADMIN", label: "Admin" },
] as const;

export function LoginOnlyForm() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{
    email: string;
    tempPassword: string;
  } | null>(null);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* manual copy is the fallback */
    }
  }

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const email = String(form.get("email") ?? "");
    const result = await createStaffUserAction(form);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.tempPassword) {
      setCreated({ email, tempPassword: result.tempPassword });
    }
  }

  if (created) {
    return (
      <div className="space-y-4 rounded-card border border-border bg-surface p-5">
        <div className="rounded-card border border-warning-200 bg-warning-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-warning-800">
            Temporary password for {created.email} — share once
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 rounded-input bg-warning-100/70 px-3 py-2 font-mono text-sm">
              {created.tempPassword}
            </code>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => copy(created.tempPassword)}
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
          <p className="mt-1 text-xs text-warning-800">
            They&rsquo;ll be forced to change it on first sign-in.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="ghost" type="button">
            <Link href="/employees">Done</Link>
          </Button>
          <Button type="button" onClick={() => setCreated(null)}>
            Add another login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="rounded-card border border-border bg-surface-2/50 p-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-text">
          <KeyRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
          App login only
        </span>
        <span className="mt-1 block text-xs text-text-muted">
          No Employee record, no shift, no pay type. They sign in directly to
          their allowed admin sections. Manage these logins later under
          Settings &rarr; Roles.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="login-name">Name</Label>
          <Input
            id="login-name"
            name="name"
            maxLength={120}
            placeholder="Jane Accountant"
          />
          <p className="text-xs text-text-muted">
            For your reference. The login is keyed off the email.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            required
            placeholder="accountant@yourcompany.com"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="login-role">Role</Label>
          <select
            id="login-role"
            name="role"
            defaultValue="ACCOUNTANT"
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            Controls which admin sections they can reach. Fine-tune the
            role&rarr;section matrix under Settings &rarr; Roles.
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="ghost" type="button">
          <Link href="/employees/new">Back</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          <UserPlus className="h-4 w-4" />
          {pending ? "Creating…" : "Create login"}
        </Button>
      </div>
    </form>
  );
}
