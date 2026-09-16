"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, PlayCircle, RefreshCw, Unlink as UnlinkIcon } from "lucide-react";
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
import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import type { SsoSettings } from "@/lib/settings/schemas";
import type { ProvisionOutcome } from "@/lib/authentik/provision";
import {
  previewSsoSyncAction,
  runSsoReconcileAction,
  saveSsoSettings,
  unlinkSsoAction,
} from "./actions";

type MissingUser = { id: string; email: string; role: string };
type LinkedUser = {
  id: string;
  email: string;
  role: string;
  authentikUsername: string | null;
};

const OUTCOME_LABEL: Record<ProvisionOutcome["status"], string> = {
  created: "Created",
  linked: "Linked",
  skipped: "Skipped",
  "needs-review": "Needs review",
  failed: "Failed",
};

const OUTCOME_TONE: Record<ProvisionOutcome["status"], string> = {
  created: "text-success-700",
  linked: "text-success-700",
  skipped: "text-text-muted",
  "needs-review": "text-warning-700",
  failed: "text-danger-700",
};

/** Username, when the outcome carries one — "—" otherwise. */
function outcomeUsername(o: ProvisionOutcome): string {
  return o.status === "created" || o.status === "linked" || o.status === "needs-review"
    ? o.username
    : "—";
}

/** Reason (skipped/needs-review) or error (failed) — "—" for a clean create/link. */
function outcomeDetail(o: ProvisionOutcome): string {
  if (o.status === "skipped" || o.status === "needs-review") return o.reason;
  if (o.status === "failed") return o.error;
  return "—";
}

function OutcomesTable({ outcomes }: { outcomes: ProvisionOutcome[] }) {
  return (
    <div className="rounded-card border border-border overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th className="text-left px-4 py-2.5">
              <MicroLabel as="span">Email</MicroLabel>
            </th>
            <th className="text-left px-4 py-2.5">
              <MicroLabel as="span">Result</MicroLabel>
            </th>
            <th className="text-left px-4 py-2.5">
              <MicroLabel as="span">Username</MicroLabel>
            </th>
            <th className="text-left px-4 py-2.5">
              <MicroLabel as="span">Reason</MicroLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {outcomes.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                Nothing to do.
              </td>
            </tr>
          ) : (
            outcomes.map((o) => (
              <tr key={o.userId} className="border-t border-border/60">
                <td className="px-4 py-2.5">{o.email}</td>
                <td className={cn("px-4 py-2.5 font-medium", OUTCOME_TONE[o.status])}>
                  {OUTCOME_LABEL[o.status]}
                </td>
                <td className="px-4 py-2.5 text-text-muted">{outcomeUsername(o)}</td>
                <td className="px-4 py-2.5 text-text-muted">{outcomeDetail(o)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SsoForm({
  settings,
  configured,
  missing,
  linked,
}: {
  settings: SsoSettings;
  configured: boolean;
  missing: MissingUser[];
  linked: LinkedUser[];
}) {
  const router = useRouter();

  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const [previewOutcomes, setPreviewOutcomes] = React.useState<ProvisionOutcome[] | null>(null);
  const [previewPending, setPreviewPending] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [runOutcomes, setRunOutcomes] = React.useState<ProvisionOutcome[] | null>(null);
  const [runPending, setRunPending] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);

  const [unlinkPending, setUnlinkPending] = React.useState<string | null>(null);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);

  const busy = previewPending || runPending;

  async function onPreview() {
    setPreviewPending(true);
    setPreviewError(null);
    setRunOutcomes(null);
    try {
      const r = await previewSsoSyncAction();
      setPreviewOutcomes(r.outcomes);
    } catch {
      setPreviewError("Preview failed. Check server logs.");
    }
    setPreviewPending(false);
  }

  async function onRunSync() {
    if (
      !window.confirm(
        "Run sync now? Unlike Preview, this writes to Authentik — it creates or links a real account for every user listed below.",
      )
    ) {
      return;
    }
    setRunPending(true);
    setRunError(null);
    setPreviewOutcomes(null);
    try {
      const r = await runSsoReconcileAction();
      setRunOutcomes(r.outcomes);
      router.refresh();
    } catch {
      setRunError("Sync failed. Check server logs.");
    }
    setRunPending(false);
  }

  async function onUnlink(user: LinkedUser) {
    if (
      !window.confirm(
        `Unlink ${user.email} from Authentik?\n\n` +
          "The next SSO sign-in will re-bind this account to whichever " +
          "Authentik identity signs in with it. Only do this if you know " +
          "this person's Authentik identity was deleted and re-created — " +
          "unlinking a live, correctly-bound identity briefly reopens the " +
          "account to whichever identity signs in next.",
      )
    ) {
      return;
    }
    setUnlinkPending(user.id);
    setUnlinkError(null);
    const r = await unlinkSsoAction(user.id);
    setUnlinkPending(null);
    if (r?.error) setUnlinkError(r.error);
    else router.refresh();
  }

  const outcomes = runOutcomes ?? previewOutcomes;
  const outcomesAreLive = runOutcomes !== null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Single sign-on (Authentik)</CardTitle>
          <CardDescription>
            Payroll users can sign in through Authentik instead of a local
            password. New accounts are created there automatically when
            enabled below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <div className="flex items-start gap-2 rounded-card border border-warning-200 bg-warning-50/60 p-3 text-warning-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm">
                <span className="font-medium">
                  AUTHENTIK_API_URL and AUTHENTIK_API_TOKEN are not set on
                  this server.
                </span>{" "}
                Provisioning is inactive.
              </p>
            </div>
          )}

          <form
            action={async (form) => {
              setPending(true);
              setError(null);
              setSaved(false);
              const result = await saveSsoSettings(form);
              setPending(false);
              if (result?.error) setError(result.error);
              else setSaved(true);
            }}
            className="space-y-5"
          >
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="autoProvision"
                defaultChecked={settings.autoProvision}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Automatically provision new accounts</span>
                <span className="block text-xs text-text-muted">
                  When on, a payroll user missing from Authentik is created
                  there as soon as one is needed, plus on the nightly
                  reconcile below. Preview and Run sync stay available for
                  manual, on-demand use either way.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="groupName">Authentik group</Label>
                <Input
                  id="groupName"
                  name="groupName"
                  type="text"
                  defaultValue={settings.groupName}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reconcileCron">Reconcile schedule (cron)</Label>
                <Input
                  id="reconcileCron"
                  name="reconcileCron"
                  type="text"
                  defaultValue={settings.reconcileCron}
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-danger-700">{error}</p>}
            {saved && <p className="text-sm text-success-700">Saved.</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts not yet in Authentik</CardTitle>
          <CardDescription>
            Enabled payroll users with no Authentik account linked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {missing.length === 0 ? (
            <p className="text-sm text-text-muted">
              Every enabled payroll user has an Authentik account.
            </p>
          ) : (
            <div className="rounded-card border border-border overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="text-left px-4 py-2.5">
                      <MicroLabel as="span">Email</MicroLabel>
                    </th>
                    <th className="text-left px-4 py-2.5">
                      <MicroLabel as="span">Role</MicroLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {missing.map((u) => (
                    <tr key={u.id} className="border-t border-border/60">
                      <td className="px-4 py-2.5">{u.email}</td>
                      <td className="px-4 py-2.5 text-text-muted">{u.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!configured || busy}
              onClick={onPreview}
              title={!configured ? "Server has no Authentik credentials configured." : undefined}
            >
              <PlayCircle className="h-4 w-4" />
              {previewPending ? "Previewing…" : "Preview sync"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!configured || busy}
              onClick={onRunSync}
              title={!configured ? "Server has no Authentik credentials configured." : undefined}
            >
              <RefreshCw className="h-4 w-4" />
              {runPending ? "Syncing…" : "Run sync now"}
            </Button>
            {outcomesAreLive && (
              <span className="text-xs text-text-muted">Written to Authentik just now.</span>
            )}
            {!outcomesAreLive && previewOutcomes !== null && (
              <span className="text-xs text-text-muted">
                Preview only — nothing was written.
              </span>
            )}
          </div>
          {previewError && <p className="text-sm text-danger-700">{previewError}</p>}
          {runError && <p className="text-sm text-danger-700">{runError}</p>}

          {outcomes && <OutcomesTable outcomes={outcomes} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked accounts</CardTitle>
          <CardDescription>
            Payroll users bound to an Authentik identity. Once bound,
            sign-in refuses any other Authentik identity for that account —
            Unlink clears the binding so the next SSO sign-in can bind
            fresh. Only use this when a person&rsquo;s Authentik identity
            was deleted and re-created; unlinking a live, correctly-bound
            identity briefly reopens the account to whichever identity
            signs in next.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unlinkError && <p className="text-sm text-danger-700">{unlinkError}</p>}
          {linked.length === 0 ? (
            <p className="text-sm text-text-muted">
              No payroll user has signed in via Authentik yet.
            </p>
          ) : (
            <div className="rounded-card border border-border overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="text-left px-4 py-2.5">
                      <MicroLabel as="span">Email</MicroLabel>
                    </th>
                    <th className="text-left px-4 py-2.5">
                      <MicroLabel as="span">Role</MicroLabel>
                    </th>
                    <th className="text-left px-4 py-2.5">
                      <MicroLabel as="span">Authentik username</MicroLabel>
                    </th>
                    <th className="text-right px-4 py-2.5">
                      <MicroLabel as="span">Actions</MicroLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((u) => (
                    <tr key={u.id} className="border-t border-border/60">
                      <td className="px-4 py-2.5">{u.email}</td>
                      <td className="px-4 py-2.5 text-text-muted">{u.role}</td>
                      <td className="px-4 py-2.5 text-text-muted">
                        {u.authentikUsername ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={unlinkPending !== null}
                          onClick={() => onUnlink(u)}
                          className="text-danger-700 hover:bg-danger-50 hover:text-danger-800"
                        >
                          <UnlinkIcon className="h-3.5 w-3.5" />
                          {unlinkPending === u.id ? "Unlinking…" : "Unlink"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
