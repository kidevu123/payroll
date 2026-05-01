"use client";

import * as React from "react";
import {
  CheckCircle2,
  Plus,
  Plug,
  PlugZap,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import type { ZohoOrganization } from "@/lib/db/schema";
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
  createOrgAction,
  deleteOrgAction,
  testConnectionAction,
  updateOrgAction,
} from "./actions";

export function ZohoSettings({ orgs }: { orgs: ZohoOrganization[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [testStatus, setTestStatus] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Zoho Books</CardTitle>
          <CardDescription>
            One organization per company you push expenses to (Haute, Boomin, …).
            Refresh tokens are sealed via the AES-GCM vault and never logged.
          </CardDescription>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add organization
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {creating && (
          <OrgForm
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              setError(null);
            }}
            onError={setError}
          />
        )}

        {orgs.length === 0 ? (
          <p className="text-sm text-text-muted">
            No Zoho organizations yet. Register a self-client at{" "}
            <a
              href="https://api-console.zoho.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 underline"
            >
              api-console.zoho.com
            </a>{" "}
            and paste the credentials here.
          </p>
        ) : (
          <ul className="space-y-2">
            {orgs.map((o) => {
              const hasRefreshToken = !!o.refreshTokenEncrypted;
              const status = testStatus[o.id];
              return (
                <li
                  key={o.id}
                  className="rounded-card border border-border bg-surface-2 p-4 shadow-sm"
                >
                  {editingId === o.id ? (
                    <OrgForm
                      mode="edit"
                      org={o}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        setError(null);
                      }}
                      onError={setError}
                    />
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text">{o.name}</span>
                          {hasRefreshToken ? (
                            <span className="inline-flex items-center gap-1 rounded-input bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Connected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-input bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> Not connected
                            </span>
                          )}
                          {!o.active && (
                            <span className="rounded-input bg-surface-3 px-2 py-0.5 text-xs text-text-muted">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted">
                          org_id: {o.organizationId} · {o.apiDomain}
                        </div>
                        {(o.defaultExpenseAccountName || o.defaultPaidThroughName) && (
                          <div className="text-xs text-text-muted">
                            expense: {o.defaultExpenseAccountName ?? "—"}
                            {" · paid through: "}
                            {o.defaultPaidThroughName ?? "—"}
                          </div>
                        )}
                        {status && (
                          <div className="text-xs text-text-muted italic">{status}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          asChild
                          disabled={pending !== null}
                        >
                          <a href={`/api/zoho/oauth/start?orgId=${o.id}`}>
                            <Plug className="h-3.5 w-3.5" />{" "}
                            {hasRefreshToken ? "Reconnect" : `Connect ${o.name}`}
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending !== null || !hasRefreshToken}
                          onClick={async () => {
                            setPending(`test-${o.id}`);
                            const result = await testConnectionAction(o.id);
                            setPending(null);
                            setTestStatus((s) => ({
                              ...s,
                              [o.id]: result.ok ? "Connection OK." : `Failed: ${result.message}`,
                            }));
                          }}
                        >
                          <PlugZap className="h-3.5 w-3.5" />
                          {pending === `test-${o.id}` ? "Testing…" : "Test"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(o.id)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!confirm(`Delete the ${o.name} integration?`)) return;
                            setPending(`del-${o.id}`);
                            const result = await deleteOrgAction(o.id);
                            setPending(null);
                            if (result?.error) setError(result.error);
                          }}
                          className="text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

function OrgForm({
  mode,
  org,
  onCancel,
  onSaved,
  onError,
}: {
  mode: "create" | "edit";
  org?: ZohoOrganization;
  onCancel: () => void;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <form
      action={async (form) => {
        setPending(true);
        onError(null);
        const result =
          mode === "create"
            ? await createOrgAction(form)
            : await updateOrgAction(org!.id, form);
        setPending(false);
        if (result?.error) onError(result.error);
        else onSaved();
      }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <div className="space-y-1">
        <Label htmlFor={`name-${org?.id ?? "new"}`}>Display name</Label>
        <Input id={`name-${org?.id ?? "new"}`} name="name" required defaultValue={org?.name ?? ""} placeholder="Haute" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`orgid-${org?.id ?? "new"}`}>Zoho organization_id</Label>
        <Input id={`orgid-${org?.id ?? "new"}`} name="organizationId" required defaultValue={org?.organizationId ?? ""} placeholder="831234567" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`api-${org?.id ?? "new"}`}>API domain</Label>
        <Input id={`api-${org?.id ?? "new"}`} name="apiDomain" defaultValue={org?.apiDomain ?? "https://www.zohoapis.com"} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`acc-${org?.id ?? "new"}`}>Accounts domain</Label>
        <Input id={`acc-${org?.id ?? "new"}`} name="accountsDomain" defaultValue={org?.accountsDomain ?? "https://accounts.zoho.com"} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`cid-${org?.id ?? "new"}`}>Client ID {mode === "edit" && "(leave blank to keep)"}</Label>
        <Input id={`cid-${org?.id ?? "new"}`} name="clientId" type="text" autoComplete="off" required={mode === "create"} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`cs-${org?.id ?? "new"}`}>Client secret {mode === "edit" && "(leave blank to keep)"}</Label>
        <Input id={`cs-${org?.id ?? "new"}`} name="clientSecret" type="password" autoComplete="off" required={mode === "create"} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`exp-${org?.id ?? "new"}`}>Default expense account name</Label>
        <Input id={`exp-${org?.id ?? "new"}`} name="defaultExpenseAccountName" defaultValue={org?.defaultExpenseAccountName ?? ""} placeholder="Salaries Payable" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`pt-${org?.id ?? "new"}`}>Default paid-through account name</Label>
        <Input id={`pt-${org?.id ?? "new"}`} name="defaultPaidThroughName" defaultValue={org?.defaultPaidThroughName ?? ""} placeholder="Operating Account" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`ven-${org?.id ?? "new"}`}>Default vendor name (optional)</Label>
        <Input id={`ven-${org?.id ?? "new"}`} name="defaultVendorName" defaultValue={org?.defaultVendorName ?? ""} />
      </div>
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
