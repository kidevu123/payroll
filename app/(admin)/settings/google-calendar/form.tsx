"use client";

import * as React from "react";
import { AlertTriangle, CalendarRange, CheckCircle2, ExternalLink } from "lucide-react";
import type { GoogleCalendarSettings } from "@/lib/settings/schemas";
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
import { saveGoogleCalendarAction } from "./actions";

export function GoogleCalendarForm({
  settings,
}: {
  settings: GoogleCalendarSettings;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const connected = Boolean(settings.connectedEmail);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Google Calendar</h1>
        <p className="text-sm text-text-muted">
          Push approved time-off requests to a Google Calendar so the team
          can see who&apos;s out at a glance.
        </p>
      </div>

      <Card
        className={
          connected
            ? "border-emerald-200 bg-emerald-50/40"
            : "border-amber-200 bg-amber-50/40"
        }
      >
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {connected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Connected as {settings.connectedEmail}
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                Not connected yet
              </>
            )}
          </CardTitle>
          <CardDescription>
            {connected
              ? "Approved time-off events will be created on the calendar below."
              : "OAuth connect-with-Google flow is queued. Save the target calendar id below now so you don't have to re-enter it later."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!connected && (
            <details className="rounded-card border border-border bg-surface-2/40 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                What admin needs to set up before connect-with-Google goes
                live
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-text-muted">
                <li>
                  Create a Google Cloud project at{" "}
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-brand-700 underline"
                  >
                    console.cloud.google.com{" "}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Enable the <strong>Google Calendar API</strong> on the
                  project.
                </li>
                <li>
                  Create an OAuth 2.0 Client ID (type: Web application).
                  Add this redirect URI:{" "}
                  <code className="rounded bg-surface-3 px-1">
                    https://digitz.duckdns.org/api/google/oauth/callback
                  </code>
                </li>
                <li>
                  Once we ship the connect flow, drop the resulting
                  client id and client secret into{" "}
                  <code className="rounded bg-surface-3 px-1">
                    /etc/payroll/.env
                  </code>{" "}
                  on the LXC as{" "}
                  <code className="rounded bg-surface-3 px-1">
                    GOOGLE_OAUTH_CLIENT_ID
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-surface-3 px-1">
                    GOOGLE_OAUTH_CLIENT_SECRET
                  </code>
                  .
                </li>
                <li>
                  Click &ldquo;Connect Google Calendar&rdquo; on this page
                  (button enables once env vars are present).
                </li>
              </ol>
            </details>
          )}

          <form
            action={async (form) => {
              setPending(true);
              setError(null);
              setSaved(false);
              const r = await saveGoogleCalendarAction(form);
              setPending(false);
              if (r?.error) setError(r.error);
              else setSaved(true);
            }}
            className="space-y-2"
          >
            <div className="space-y-1">
              <Label htmlFor="calendarId">
                Target calendar id
              </Label>
              <Input
                id="calendarId"
                name="calendarId"
                defaultValue={settings.calendarId ?? ""}
                placeholder="primary  (or  abc123@group.calendar.google.com)"
              />
              <p className="text-xs text-text-muted">
                <code>primary</code> targets the connecting user&apos;s
                main calendar. Or paste a shared calendar id from Google
                Calendar &rarr; Settings &rarr; (calendar) &rarr;
                &ldquo;Calendar ID&rdquo;.
              </p>
            </div>

            {settings.lastPushedAt && (
              <p className="text-xs text-text-muted">
                Last event push: {settings.lastPushedAt}
              </p>
            )}

            {error && <p className="text-sm text-red-700">{error}</p>}
            {saved && (
              <p className="text-sm text-emerald-700">Saved.</p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save calendar id"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled
                title="OAuth connect flow not implemented yet"
              >
                <CalendarRange className="h-4 w-4" /> Connect Google Calendar
                (coming soon)
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
