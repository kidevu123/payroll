"use client";

import * as React from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveMissedPunchAction,
  rejectMissedPunchAction,
  resolveTimeOffAction,
} from "./actions";

export function MissedPunchActions({ requestId }: { requestId: string }) {
  const [mode, setMode] = React.useState<"idle" | "approving" | "rejecting">("idle");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (mode === "approving") {
    return (
      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const r = await approveMissedPunchAction(requestId, form);
          setPending(false);
          if (r?.error) setError(r.error);
        }}
        className="flex items-end gap-2"
      >
        <Input
          name="resolutionNote"
          placeholder="Optional note for the employee"
          maxLength={500}
        />
        <Button type="submit" size="sm" disabled={pending}>
          <CircleCheck className="h-4 w-4" /> {pending ? "Approving…" : "Confirm"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </form>
    );
  }

  if (mode === "rejecting") {
    return (
      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const r = await rejectMissedPunchAction(requestId, form);
          setPending(false);
          if (r?.error) setError(r.error);
        }}
        className="flex items-end gap-2"
      >
        <Input
          name="resolutionNote"
          placeholder="Reason (required)"
          required
          minLength={1}
          maxLength={500}
        />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          <CircleX className="h-4 w-4" /> {pending ? "Rejecting…" : "Confirm reject"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => setMode("approving")}>
        <CircleCheck className="h-4 w-4" /> Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("rejecting")}>
        <CircleX className="h-4 w-4" /> Reject
      </Button>
    </div>
  );
}

export function TimeOffActions({
  requestId,
  employeeId,
}: {
  requestId: string;
  employeeId: string;
}) {
  const [mode, setMode] = React.useState<"idle" | "rejecting">("idle");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function approve() {
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("status", "APPROVED");
    const r = await resolveTimeOffAction(requestId, employeeId, form);
    setPending(false);
    if (r?.error) setError(r.error);
  }

  if (mode === "rejecting") {
    return (
      <form
        action={async (form) => {
          form.set("status", "REJECTED");
          setPending(true);
          setError(null);
          const r = await resolveTimeOffAction(requestId, employeeId, form);
          setPending(false);
          if (r?.error) setError(r.error);
        }}
        className="flex items-end gap-2"
      >
        <Input
          name="resolutionNote"
          placeholder="Reason (required)"
          required
          minLength={1}
          maxLength={500}
        />
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Rejecting…" : "Confirm reject"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={approve} disabled={pending}>
        <CircleCheck className="h-4 w-4" /> {pending ? "Approving…" : "Approve"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("rejecting")}>
        <CircleX className="h-4 w-4" /> Reject
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
