"use client";

import * as React from "react";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveRolePermissions, resetRolePermissions } from "./actions";
import type { EditableRole, Surface } from "@/lib/auth/role-matrix";

type Row = {
  role: EditableRole;
  label: string;
  surfaces: Record<Surface, boolean>;
  isOverride: boolean;
};

export function RolesMatrixForm({
  rows,
  surfaces,
}: {
  rows: ReadonlyArray<Row>;
  surfaces: ReadonlyArray<{ key: Surface; label: string }>;
}) {
  // Local state holds the live matrix so the user can toggle freely
  // before saving. Initial state is hydrated from the server-resolved
  // rows (defaults already merged).
  const [matrix, setMatrix] = React.useState<Record<EditableRole, Set<Surface>>>(
    () => ({
      PAYROLL_STAFF: new Set(),
      ACCOUNTANT: new Set(),
      ADMIN: new Set(),
      ...Object.fromEntries(
        rows.map((r) => [
          r.role,
          new Set(
            (Object.entries(r.surfaces) as Array<[Surface, boolean]>)
              .filter(([, v]) => v)
              .map(([k]) => k),
          ),
        ]),
      ),
    } as Record<EditableRole, Set<Surface>>),
  );
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggle(role: EditableRole, surface: Surface) {
    setMatrix((prev) => {
      const next = new Set(prev[role]);
      if (next.has(surface)) next.delete(surface);
      else next.add(surface);
      return { ...prev, [role]: next };
    });
  }

  return (
    <form
      action={async () => {
        setPending(true);
        setMessage(null);
        const fd = new FormData();
        for (const role of ["PAYROLL_STAFF", "ACCOUNTANT", "ADMIN"] as const) {
          for (const surface of matrix[role]) {
            fd.append(`${role}:${surface}`, "on");
          }
        }
        const result = await saveRolePermissions(fd);
        setPending(false);
        if (result?.error) setMessage({ kind: "err", text: result.error });
        else setMessage({ kind: "ok", text: "Saved." });
      }}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-heading font-semibold tracking-tight text-text">Roles &amp; access</h2>
        <p className="text-sm text-text-muted">
          Choose which sections of the admin app each role can see. Changes
          apply on the next page load. Owner always has access to everything;
          employees only see /me.
        </p>
      </header>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Section</th>
              {rows.map((r) => (
                <th key={r.role} className="text-center px-4 py-3 font-medium whitespace-nowrap">
                  {r.label}
                  {r.isOverride && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700">
                      custom
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surfaces.map(({ key, label }, idx) => (
              <tr key={key} className={idx % 2 === 0 ? undefined : "bg-surface-2/40"}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{label}</div>
                  <code className="text-[11px] text-text-subtle">{key}</code>
                </td>
                {rows.map((r) => {
                  const checked = matrix[r.role].has(key);
                  return (
                    <td key={r.role} className="text-center px-4 py-2.5">
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={checked}
                          onChange={() => toggle(r.role, key)}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            if (!confirm("Reset all roles back to defaults?")) return;
            setPending(true);
            setMessage(null);
            await resetRolePermissions();
            setPending(false);
            setMessage({ kind: "ok", text: "Reset. Reload to see defaults." });
          }}
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </Button>
        {message && (
          <span
            className={
              message.kind === "ok"
                ? "text-sm text-emerald-700"
                : "text-sm text-red-700"
            }
          >
            {message.text}
          </span>
        )}
      </div>

      <aside className="rounded-card border border-border bg-surface-2/60 p-4 text-xs text-text-muted">
        <strong className="text-text">Notes.</strong> The OWNER role always
        has access to everything and is intentionally not editable here. The
        Database Browser (/db) is owner-only for safety. Cash Drawer
        (/cash-drawer) is the accountant&rsquo;s default landing page.
      </aside>
    </form>
  );
}
