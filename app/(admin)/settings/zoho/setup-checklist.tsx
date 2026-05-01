"use client";

import * as React from "react";
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ZOHO_SCOPES = [
  "ZohoBooks.expenses.CREATE",
  "ZohoBooks.expenses.READ",
  "ZohoBooks.settings.READ",
  "ZohoBooks.contacts.READ",
];

export function SetupChecklist({
  redirectUri,
  appUrlConfigured,
}: {
  redirectUri: string;
  appUrlConfigured: boolean;
}) {
  const [copied, setCopied] = React.useState<string | null>(null);

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card className="border-amber-200/60 bg-amber-50/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Zoho self-client setup
        </CardTitle>
        <CardDescription>
          Register a self-client at{" "}
          <a
            href="https://api-console.zoho.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 underline"
          >
            api-console.zoho.com <ExternalLink className="h-3 w-3" />
          </a>{" "}
          and paste the values below. The redirect URI must match exactly —
          a mismatch produces an &quot;Invalid Redirect Uri&quot; page on
          connect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!appUrlConfigured && (
          <div className="flex items-start gap-2 rounded-card border border-red-300 bg-red-50 p-3 text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">APP_URL is not set.</p>
              <p className="text-xs">
                The redirect URI below was guessed from the request host,
                which may not match what you register in Zoho. Set{" "}
                <code className="rounded bg-red-100 px-1">APP_URL</code>{" "}
                in <code className="rounded bg-red-100 px-1">/etc/payroll/.env</code>{" "}
                on the LXC and restart the app.
              </p>
            </div>
          </div>
        )}

        <Field
          label="Redirect URI to register in Zoho"
          value={redirectUri}
          copied={copied === "uri"}
          onCopy={() => copy(redirectUri, "uri")}
        />
        <p className="text-xs text-text-muted">
          Paste this exactly into the Zoho Developer Console under
          &quot;Authorized Redirect URIs&quot;. No trailing slash.
        </p>

        <details className="rounded-card border border-border bg-surface-2/40 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Required OAuth scopes
          </summary>
          <Field
            label="Scope string (comma-separated)"
            value={ZOHO_SCOPES.join(",")}
            copied={copied === "scopes"}
            onCopy={() => copy(ZOHO_SCOPES.join(","), "scopes")}
          />
          <ul className="mt-2 space-y-0.5 text-xs text-text-muted">
            {ZOHO_SCOPES.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </details>

        <details className="rounded-card border border-border bg-surface-2/40 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Step-by-step
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-text-muted">
            <li>
              Open{" "}
              <a
                href="https://api-console.zoho.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 underline"
              >
                api-console.zoho.com
              </a>{" "}
              and pick &quot;Add Client&quot; → &quot;Self Client&quot;.
              (You can also use &quot;Server-based Application&quot; if you
              want the OAuth dance with redirect; both work.)
            </li>
            <li>
              For Server-based, paste the Redirect URI shown above into the
              authorized URIs field.
            </li>
            <li>Copy the Client ID and Client Secret.</li>
            <li>
              Click <strong>Add organization</strong> below, paste the
              client id/secret, set the data center (most US accounts use{" "}
              <code>https://accounts.zoho.com</code>), and save.
            </li>
            <li>
              Click <strong>Connect</strong> on the saved organization. Zoho
              will ask you to authorize the scopes; on accept it redirects
              back here and the refresh token is sealed in the vault.
            </li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-input border border-border bg-surface px-2 py-1.5 text-xs">
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={onCopy}>
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
    </div>
  );
}
