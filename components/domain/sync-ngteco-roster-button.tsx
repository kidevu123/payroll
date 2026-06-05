"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncNgtecoEmployeeRosterAction } from "@/app/(admin)/employees/actions";

export function SyncNgtecoRosterButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5 max-w-xs">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          setError(null);
          const result = await syncNgtecoEmployeeRosterAction();
          setPending(false);
          if ("error" in result && result.error) {
            setError(result.error);
            return;
          }
          if ("ok" in result && result.ok) {
            const created = result.created ?? 0;
            const scraped = result.scraped ?? 0;
            setMessage(
              created > 0
                ? `Imported ${created} new ${created === 1 ? "person" : "people"} (${scraped} on time clock). Check Inactive tab to finish setup.`
                : scraped > 0
                  ? `Checked ${scraped} on time clock — everyone is already in Milo.`
                  : "Sync finished — no people found on the time clock page. Check NGTeco login or selectors.",
            );
            router.refresh();
          }
        }}
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing employees…" : "Sync employees"}
      </Button>
      {error ? (
        <p className="text-xs text-red-700 text-right">{error}</p>
      ) : message ? (
        <p className="text-xs text-text-muted text-right">{message}</p>
      ) : (
        <p className="text-xs text-text-subtle text-right">
          Pull Person list from NGTeco
        </p>
      )}
    </div>
  );
}
