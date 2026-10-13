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
    // One full-width toolbar: syncing the clock on the left with its status,
    // the three "add data another way" actions on the right as one uniform
    // group. (Before: a shrink-to-fit cluster that wrapped under the tabs and
    // stopped mid-page, mixing two outlined buttons with two bare text ones.)
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6">
      <div className="min-w-0">
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
      {/* Phone: three equal columns under the full-width sync button. */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
        <div className="order-2 min-w-0 sm:order-none">
          <BackfillPunchesButton />
        </div>
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="order-3 max-sm:min-h-11 max-sm:px-2 sm:order-none"
        >
          <Link href="/run-payroll/upload">
            <Upload className="h-4 w-4" /> Upload CSV
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="order-1 max-sm:min-h-11 max-sm:px-2 sm:order-none"
        >
          <Link href="/punches/new">
            <Plus className="h-3.5 w-3.5" />
            <span className="sm:hidden">Add punch</span>
            <span className="hidden sm:inline">Add manual punch</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Decodes the desktop grid's coloured cells; sits beside the schedule tabs. */
export function TimeLegend() {
  return (
    <div className="hidden items-center gap-3 pb-2 text-caption font-medium text-text-muted lg:flex">
      <Legend label="Complete" state="complete" />
      <Legend label="Incomplete" state="incomplete" />
      <Legend label="Missed" state="missed" />
      <Legend label="Time off" state="pto" />
    </div>
  );
}
