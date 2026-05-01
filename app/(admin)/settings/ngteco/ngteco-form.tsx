"use client";

import * as React from "react";
import { Play } from "lucide-react";
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>NGTeco connection</CardTitle>
          <CardDescription>
            Credentials are encrypted at rest with AES-GCM. The plaintext only
            crosses the boundary the moment a Playwright session opens.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  name="headless"
                  defaultChecked={headless}
                />
                Run scraper headless
              </label>
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

      <Card>
        <CardHeader>
          <CardTitle>Run import now</CardTitle>
          <CardDescription>
            Creates a PayrollRun against the current open period and enqueues
            ngteco.import. View progress + screenshots on /ngteco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              setRunning(true);
              const result = await runImportNow();
              setRunning(false);
              if (result?.error) setError(result.error);
            }}
          >
            <Button type="submit" disabled={running || !hasCredentials}>
              <Play className="h-4 w-4" /> {running ? "Starting…" : "Run import now"}
            </Button>
            {!hasCredentials && (
              <p className="mt-2 text-xs text-text-muted">
                Save credentials first.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
