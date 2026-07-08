"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runImportNow, saveNgtecoConfig } from "./actions";

export function NgtecoForm({
  portalUrl,
  locationId,
  headless,
  hasCredentials,
}: {
  portalUrl: string;
  locationId: string | null;
  headless: boolean;
  hasCredentials: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-heading font-semibold tracking-tight text-text">NGTeco connection</h2>
        <p className="text-xs text-text-muted">
          Punches sync through NGTeco&apos;s REST API (browserless — a
          two-second JSON fetch, no Chromium). The headless browser scraper
          remains only as an automatic fallback if the API call fails.
          Credentials are encrypted at rest with AES-GCM; plaintext only
          crosses the boundary the moment a sync runs.
        </p>
          <form
            action={async (form) => {
              setPending(true);
              setError(null);
              setSaved(false);
              const result = await saveNgtecoConfig(form);
              setPending(false);
              if (result?.error) setError(result.error);
              else setSaved(true);
            }}
            className="space-y-4"
          >
            <div className="space-y-1">
              <Label htmlFor="portalUrl">Portal URL</Label>
              <Input
                id="portalUrl"
                name="portalUrl"
                type="url"
                defaultValue={portalUrl}
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="off"
                  placeholder={hasCredentials ? "[stored — leave blank to keep]" : "service account"}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={hasCredentials ? "[stored — leave blank to keep]" : ""}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="locationId">Location ID (optional)</Label>
                <Input
                  id="locationId"
                  name="locationId"
                  defaultValue={locationId ?? ""}
                />
              </div>
              <div className="space-y-1">
                <span className="block text-sm font-medium invisible" aria-hidden>
                  Headless
                </span>
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="headless"
                    defaultChecked={headless}
                  />
                  Run fallback scraper headless
                </label>
                <p className="text-[11px] text-text-subtle">
                  Only applies when the API path fails and the browser
                  fallback kicks in.
                </p>
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
      </div>

      <div className="space-y-2 pt-4 border-t border-border">
        <h2 className="text-heading font-semibold tracking-tight text-text">Run import now</h2>
        <p className="text-xs text-text-muted">
          Creates a PayrollRun against the current open period and enqueues
          ngteco.import. View progress + screenshots on /ngteco.
        </p>
        <form
          action={async () => {
            setRunning(true);
            const result = await runImportNow();
            setRunning(false);
            if (result?.error) setError(result.error);
          }}
        >
          <div className="flex justify-end">
            <Button type="submit" disabled={running || !hasCredentials}>
              <Play className="h-4 w-4" /> {running ? "Starting…" : "Run import now"}
            </Button>
          </div>
          {!hasCredentials && (
            <p className="mt-2 text-xs text-text-muted text-right">
              Save credentials first.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
