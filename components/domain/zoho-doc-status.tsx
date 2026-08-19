"use client";

// Zoho push / re-push control for a single paystub document. Shared by the
// Salaried page upload slots and the payroll period page's W2 docs section —
// a paystub must be pushable from wherever the admin can see it (hourly
// employees with requiresW2Upload never appear on the Salaried page, so the
// period page needs the same affordance).

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, PlugZap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listZohoOrgsAction,
  pushDocToZohoAction,
  repushDocToZohoAction,
  type ZohoOrgChoice,
} from "@/app/(admin)/salaried/actions";

export type ZohoDocLite = {
  id: string;
  kind: "W2" | "PAYSTUB" | "OTHER";
  amountCents: number | null;
  zohoExpenseId: string | null;
};

export function ZohoDocStatus({ doc }: { doc: ZohoDocLite }) {
  const [orgs, setOrgs] = React.useState<ZohoOrgChoice[] | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pushedExpenseId, setPushedExpenseId] = React.useState<string | null>(
    doc.zohoExpenseId,
  );

  // W2 docs are legal records, not expenses — no Zoho push.
  if (doc.kind === "W2") return null;

  const needsNet =
    doc.kind === "PAYSTUB" && (doc.amountCents === null || doc.amountCents <= 0);

  async function repush(force = false) {
    setPending(true);
    setError(null);
    try {
      const r = await repushDocToZohoAction(doc.id, force);
      if ("error" in r) setError(r.error);
      else setPushedExpenseId(r.expenseId);
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : "Re-push failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (pushedExpenseId) {
    // Pushed: a dropdown to re-push (delete the stale Zoho expense + post a
    // fresh one with the corrected amount). Use after editing the net.
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "color-mix(in srgb, var(--dash-emerald) 16%, transparent)",
              color: "var(--dash-emerald)",
            }}
            title={`In Zoho: expense ${pushedExpenseId} — click to re-push`}
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}{" "}
            Zoho
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>In Zoho · expense {pushedExpenseId}</DropdownMenuLabel>
          {error ? <p className="px-2 py-1.5 text-xs text-danger-700">{error}</p> : null}
          <DropdownMenuItem
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault();
              void repush(false);
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Re-push (replace the Zoho expense)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault();
              void repush(true);
            }}
          >
            <PlugZap className="mr-1.5 h-3.5 w-3.5" />
            Force re-push (post fresh, keep old in Zoho)
          </DropdownMenuItem>
          <p className="px-2 pb-1.5 pt-1 text-[10px] leading-tight text-text-subtle">
            Delete needs the expenses.DELETE scope — reconnect in Settings →
            Zoho to enable a clean replace.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Without a net, the row's inline-net control prompts for one — keep
  // the Zoho affordance quiet rather than a loud warning.
  if (needsNet) {
    return (
      <span
        className="text-[10px] text-text-subtle"
        title="Add the net amount first, then push to Zoho."
      >
        Net needed
      </span>
    );
  }

  async function loadOrgs() {
    setError(null);
    try {
      setOrgs(await listZohoOrgsAction());
    } catch {
      setOrgs([]);
      setError("Couldn't load Zoho orgs.");
    }
  }

  async function push(orgId: string) {
    setPending(true);
    setError(null);
    try {
      const r = await pushDocToZohoAction(doc.id, orgId);
      if ("error" in r) setError(r.error);
      else setPushedExpenseId(r.expenseId);
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : "Push failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  // Rendered in a Radix DropdownMenu so the org list / errors portal to the
  // body — the old absolute picker was clipped by overflow-hidden on the
  // <ul> and <Card>, so with 2+ Zoho orgs the click "did nothing".
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && orgs === null) void loadOrgs();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={pending}
          title="Push to Zoho Books as an expense"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" />
          )}{" "}
          Zoho
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Push paystub to Zoho</DropdownMenuLabel>
        {error ? (
          <p className="px-2 py-1.5 text-xs text-danger-700">{error}</p>
        ) : orgs === null ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">Loading orgs…</p>
        ) : orgs.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">
            No active Zoho org.{" "}
            <Link
              href="/settings/zoho"
              className="font-medium text-brand-700 underline"
            >
              Connect one
            </Link>
          </p>
        ) : (
          orgs.map((o) => (
            <DropdownMenuItem
              key={o.id}
              disabled={pending}
              onSelect={(e) => {
                e.preventDefault();
                void push(o.id);
              }}
            >
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {o.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
