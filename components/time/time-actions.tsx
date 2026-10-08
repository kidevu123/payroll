// The /time header's action cluster. Phone: sync is the full-width lead
// action and the three secondary actions share one row beneath it. From sm up
// it is one wrapping row. The legend decodes the desktop grid's coloured
// cells, so it only shows from lg.
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { BackfillPunchesButton } from "@/components/admin/backfill-punches";
import { PollPunchesNowButton } from "@/components/admin/poll-punches-now";
import { Legend } from "@/components/time/legend";
import { Button } from "@/components/ui/button";
import type { getLastPoll } from "@/lib/db/queries/poll-history";

export function TimeActions({
  lastPoll,
}: {
  lastPoll: Awaited<ReturnType<typeof getLastPoll>>;
}) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-3 lg:items-end">
      {/* Phone: sync is the full-width lead action, the three secondary
          actions share one row beneath it. From sm up it is the original
          wrapping row. */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end">
        <div className="order-1 col-span-3 min-w-0 sm:order-none">
          <PollPunchesNowButton
            initialLast={
              lastPoll
                ? {
                    startedAt: lastPoll.startedAt.toISOString(),
                    finishedAt: lastPoll.finishedAt?.toISOString() ?? null,
                    ok: lastPoll.ok,
                    triggeredBy: lastPoll.triggeredBy,
                    pairsInserted: lastPoll.pairsInserted,
                    pairsUpdated: lastPoll.pairsUpdated,
                    errorMessage: lastPoll.errorMessage,
                  }
                : null
            }
          />
        </div>
        <div className="order-3 min-w-0 sm:order-none">
          <BackfillPunchesButton />
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="order-3 max-sm:min-h-11 max-sm:border max-sm:border-border max-sm:bg-surface max-sm:px-2 sm:order-none"
        >
          <Link href="/run-payroll/upload">
            <Upload className="h-4 w-4" /> Upload CSV
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="order-2 max-sm:min-h-11 max-sm:px-2 sm:order-none"
        >
          <Link href="/punches/new">
            <Plus className="h-3.5 w-3.5" />
            <span className="sm:hidden">Add punch</span>
            <span className="hidden sm:inline">Add manual punch</span>
          </Link>
        </Button>
      </div>
      {/* The legend decodes the desktop grid's colored cells; the phone
          list labels every row in words, so it is not needed there. */}
      <div className="hidden lg:flex items-center gap-3 text-caption text-text-muted font-medium">
        <Legend label="Complete" state="complete" />
        <Legend label="Incomplete" state="incomplete" />
        <Legend label="Missed" state="missed" />
        <Legend label="Time off" state="pto" />
      </div>
    </div>
  );
}
