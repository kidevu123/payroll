"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Power, PowerOff, RefreshCw, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createStaffUserAction,
  regenerateStaffTempPasswordAction,
  setStaffDisabledAction,
  setStaffRoleAction,
} from "./actions";
import type { EditableRole } from "@/lib/auth/role-matrix";

type Staff = {
  id: string;
  email: string;
  role: EditableRole;
  disabled: boolean;
  mustChangePassword: boolean;
};

const ROLE_LABEL: Record<EditableRole, string> = {
  PAYROLL_STAFF: "Payroll staff",
  ACCOUNTANT: "Accountant",
  ADMIN: "Admin",
};

export function StaffUsersPanel({ staff }: { staff: ReadonlyArray<Staff> }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tempPassword, setTempPassword] = React.useState<{
    label: string;
    value: string;
  } | null>(null);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* manual copy is the fallback */
    }
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-heading font-semibold tracking-tight text-text">Staff logins</h2>
        <p className="text-sm text-text-muted">
          Create a sign-in for an accountant, payroll-staff, or admin
          who doesn&rsquo;t punch a clock. They&rsquo;ll log in directly
          to their allowed admin sections — no Employee record, no
          shift, no pay type.
        </p>
      </header>

      <form
        action={async (form) => {
          setPending("create");
          setError(null);
          setTempPassword(null);
          const result = await createStaffUserAction(form);
          setPending(null);
          if (result?.error) setError(result.error);
          else if (result?.tempPassword) {
            setTempPassword({
              label: String(form.get("email") ?? ""),
              value: result.tempPassword,
            });
            (form as unknown as HTMLFormElement)?.reset?.();
          }
        }}
        className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-3 items-end rounded-card border border-border bg-surface p-4"
      >
        <div className="space-y-1">
          <Label htmlFor="staff-email">Email</Label>
          <Input
            id="staff-email"
            name="email"
            type="email"
            required
            placeholder="accountant@yourcompany.com"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="staff-role">Role</Label>
          <select
            id="staff-role"
            name="role"
            defaultValue="ACCOUNTANT"
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="ACCOUNTANT">Accountant</option>
            <option value="PAYROLL_STAFF">Payroll staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={pending !== null}>
          <UserPlus className="h-4 w-4" />
          {pending === "create" ? "Creating…" : "Create staff login"}
        </Button>
      </form>

      {tempPassword && (
        <div className="rounded-card border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-amber-800">
            Temporary password for {tempPassword.label} — share once
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 rounded-input bg-amber-100/70 px-3 py-2 font-mono text-sm">
              {tempPassword.value}
            </code>
            <Button size="sm" variant="ghost" onClick={() => copy(tempPassword.value)}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
          <p className="mt-1 text-xs text-amber-800">
            They&rsquo;ll be forced to change it on first sign-in.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="rounded-card border border-border bg-surface overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                  No staff logins yet.
                </td>
              </tr>
            ) : (
              staff.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2.5 align-middle">
                    <div className="font-medium">{s.email}</div>
                    {s.mustChangePassword && (
                      <span className="inline-block mt-0.5 rounded-input bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                        Must change password
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-middle">
                    <form
                      key={`role-${s.id}-${s.role}`}
                      action={async (form) => {
                        setPending(`role:${s.id}`);
                        setError(null);
                        const r = await setStaffRoleAction(s.id, form);
                        setPending(null);
                        if (r?.error) setError(r.error);
                        else router.refresh();
                      }}
                      className="flex items-center gap-2"
                    >
                      <select
                        name="role"
                        defaultValue={s.role}
                        className="h-8 rounded-input border border-border bg-surface px-2 text-xs"
                      >
                        {(Object.keys(ROLE_LABEL) as EditableRole[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" variant="ghost" disabled={pending !== null}>
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  </td>
                  <td className="px-4 py-2.5 align-middle">
                    {s.disabled ? (
                      <span className="rounded-input bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                        Disabled
                      </span>
                    ) : (
                      <span className="rounded-input bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending !== null}
                        onClick={async () => {
                          setPending(`pw:${s.id}`);
                          setError(null);
                          const r = await regenerateStaffTempPasswordAction(s.id);
                          setPending(null);
                          if (r?.error) setError(r.error);
                          else if (r?.tempPassword) {
                            setTempPassword({ label: s.email, value: r.tempPassword });
                          }
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Reset password
                      </Button>
                      <Button
                        size="sm"
                        variant={s.disabled ? "default" : "ghost"}
                        disabled={pending !== null}
                        onClick={async () => {
                          setPending(`tog:${s.id}`);
                          setError(null);
                          const r = await setStaffDisabledAction(s.id, !s.disabled);
                          setPending(null);
                          if (r?.error) setError(r.error);
                          else router.refresh();
                        }}
                      >
                        {s.disabled ? (
                          <>
                            <Power className="h-3.5 w-3.5" /> Activate
                          </>
                        ) : (
                          <>
                            <PowerOff className="h-3.5 w-3.5" /> Deactivate
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
