"use client";

import * as React from "react";
import { AlertTriangle, Check, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const RESTART_CMD = `ssh root@192.168.1.190 'pct exec 120 -- bash -c "cd /opt/payroll && docker compose up -d --force-recreate app"'`;

export function VapidStatus({
  configured,
  publicKeyHint,
}: {
  configured: boolean;
  /** First/last 4 chars of the public key, or null. Useful for "yes I see it
   * was set" verification without leaking the full key. */
  publicKeyHint: string | null;
}) {
  const [copied, setCopied] = React.useState<string | null>(null);

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {configured ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              VAPID is configured
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              VAPID setup required
            </>
          )}
        </CardTitle>
        <CardDescription>
          Web Push needs three environment variables on the LXC. Without
          them, the &quot;Enable notifications&quot; button in the employee
          portal stays disabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {configured ? (
          <p className="text-text-muted">
            Public key fingerprint:{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">
              {publicKeyHint ?? "?"}
            </code>
            . Notifications will dispatch when payroll publishes or a
            missed-punch alert lands.
          </p>
        ) : (
          <>
            <p className="text-text-muted">
              Generate a VAPID key pair, then add the values to{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5">
                /etc/payroll/.env
              </code>{" "}
              on the LXC (mode 0600) and restart the app.
            </p>

            <div className="space-y-1">
              <p className="text-xs font-medium text-text-muted">
                Generate a key pair (run anywhere with Node)
              </p>
              <CodeRow
                value="npx web-push generate-vapid-keys"
                copied={copied === "gen"}
                onCopy={() => copy("npx web-push generate-vapid-keys", "gen")}
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-text-muted">
                Add to /etc/payroll/.env
              </p>
              <CodeRow
                value={`VAPID_PUBLIC_KEY=<paste public key>
VAPID_PRIVATE_KEY=<paste private key>
VAPID_CONTACT_EMAIL=admin@yourcompany.com`}
                copied={copied === "env"}
                onCopy={() =>
                  copy(
                    `VAPID_PUBLIC_KEY=<paste public key>\nVAPID_PRIVATE_KEY=<paste private key>\nVAPID_CONTACT_EMAIL=admin@yourcompany.com`,
                    "env",
                  )
                }
                multiline
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-text-muted">
                Restart the app on LX120
              </p>
              <CodeRow
                value={RESTART_CMD}
                copied={copied === "restart"}
                onCopy={() => copy(RESTART_CMD, "restart")}
              />
            </div>

            <p className="text-xs text-text-muted">
              The contact email is sent to push services as the{" "}
              <code>mailto:</code> for delivery problem reports. Use any
              admin address.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CodeRow({
  value,
  copied,
  onCopy,
  multiline = false,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
  multiline?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <code
        className={`flex-1 rounded-input border border-border bg-surface px-2 py-1.5 text-xs ${multiline ? "whitespace-pre" : "truncate"}`}
      >
        {value}
      </code>
      <Button
        size="sm"
        variant="secondary"
        onClick={onCopy}
        className="shrink-0"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-700" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" /> Copy
          </>
        )}
      </Button>
    </div>
  );
}
