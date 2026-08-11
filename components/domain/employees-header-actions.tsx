"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { syncNgtecoEmployeeRosterAction } from "@/app/(admin)/employees/actions";

type SyncFeedback = {
  tone: "ok" | "error";
  text: string;
} | null;

type EmployeesPageHeaderProps = {
  shownCount: number;
  livingCount: number;
  terminatedCount: number;
};

/** Title row + actions + optional full-width sync feedback. */
export function EmployeesPageHeader({
  shownCount,
  livingCount,
  terminatedCount,
}: EmployeesPageHeaderProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<SyncFeedback>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-title tracking-tight antialiased text-text">Employees</h1>
          <p className="text-sm text-text-muted">
            {shownCount} of {livingCount}{" "}
            {livingCount === 1 ? "person" : "people"}
            {terminatedCount > 0 && (
              <span className="text-text-subtle">
                {" "}
                · {terminatedCount} terminated
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            title="Pull the Person list from NGTeco"
            onClick={async () => {
              setPending(true);
              setFeedback(null);
              const result = await syncNgtecoEmployeeRosterAction();
              setPending(false);
              if ("error" in result && result.error) {
                setFeedback({ tone: "error", text: result.error });
                return;
              }
              if ("ok" in result && result.ok) {
                const created = result.created ?? 0;
                const scraped = result.scraped ?? 0;
                setFeedback({
                  tone: "ok",
                  text:
                    created > 0
                      ? `Imported ${created} new ${created === 1 ? "person" : "people"} from the time clock (${scraped} total there). Open the Inactive tab to finish setup.`
                      : scraped > 0
                        ? `Checked ${scraped} people on the time clock — everyone is already in Milo.`
                        : "No people found on the NGTeco Person page. Check login under Settings → NGTeco.",
                });
                router.refresh();
              }
            }}
          >
            <RefreshCw
              className={cn("h-4 w-4", pending && "animate-spin")}
              aria-hidden
            />
            {pending ? "Syncing…" : "Sync from time clock"}
          </Button>
          <Button asChild>
            <Link href="/employees/new">
              <Plus className="h-4 w-4" /> Add employee
            </Link>
          </Button>
        </div>
      </div>
      {feedback ? (
        <div
          role="status"
          className={cn(
            "rounded-input border px-3 py-2 text-sm",
            feedback.tone === "error"
              ? "border-danger-200 bg-danger-50 text-danger-800"
              : "border-border bg-surface-2 text-text-muted",
          )}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
