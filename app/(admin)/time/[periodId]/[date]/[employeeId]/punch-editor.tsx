"use client";

import * as React from "react";
import type { Punch } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { isAmbiguousSinglePunch, isOpenShiftPunch } from "@/lib/punches/missing-punch";
import { findFixTarget, formatWallClock } from "@/lib/punches/editor-format";
import { FixPunchForm } from "./fix-punch-form";
import { BackPayForm } from "./back-pay-form";
import { CreateForm } from "./create-punch-form";
import { EditablePunch } from "./editable-punch";

export function PunchEditor({
  periodId,
  employeeId,
  date,
  timezone,
  punches,
  suggestedClockIn,
  suggestedClockOut,
  periodLocked,
  returnTo,
}: {
  periodId: string;
  employeeId: string;
  date: string;
  timezone: string;
  punches: Punch[];
  suggestedClockIn: string;
  suggestedClockOut: string;
  periodLocked: boolean;
  returnTo: string;
}) {
  const fixTarget = findFixTarget(punches);
  const otherPunches = punches.filter((p) => p.id !== fixTarget?.id);
  const [showAddManual, setShowAddManual] = React.useState(
    punches.length === 0,
  );

  return (
    <div className="space-y-4">
      {fixTarget && !periodLocked ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {isAmbiguousSinglePunch(fixTarget)
              ? "Complete unpaired punch"
              : isOpenShiftPunch(fixTarget)
                ? "Close open shift"
                : "Add missing clock-in"}
          </h2>
          <p className="text-sm text-text-muted">
            {isAmbiguousSinglePunch(fixTarget)
              ? `One punch is on file at ${formatWallClock(fixTarget.clockIn, timezone)}. We are not sure if it was in or out — enter whichever side is missing.`
              : isOpenShiftPunch(fixTarget)
                ? "Clock-in is already on file from the time clock. Enter only the missing clock-out — do not add a new punch below."
                : "Clock-out is on file. Enter only the missing clock-in."}
          </p>
          <FixPunchForm punch={fixTarget} timezone={timezone} />
        </div>
      ) : null}

      {otherPunches.length > 0 || (punches.length > 0 && !fixTarget) ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {fixTarget ? "Other punches this day" : "Existing punches"}
          </h2>
          {otherPunches.length === 0 && !fixTarget ? (
            <p className="text-sm text-text-muted">
              No punches recorded for this day.
            </p>
          ) : (
            (fixTarget ? otherPunches : punches).map((p) => (
              <EditablePunch
                key={p.id}
                punch={p}
                timezone={timezone}
                periodLocked={periodLocked}
              />
            ))
          )}
        </div>
      ) : punches.length === 0 && !fixTarget ? (
        <p className="text-sm text-text-muted">No punches recorded for this day.</p>
      ) : null}

      {!periodLocked && (
        <div className="rounded-card border border-dashed border-border bg-surface p-4">
          {fixTarget && !showAddManual ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowAddManual(true)}
            >
              Add a separate punch (second shift)
            </Button>
          ) : (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                {fixTarget ? "Add a separate punch" : "Add manual punch"}
              </h2>
              {fixTarget ? (
                <p className="text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded-input px-2 py-1.5">
                  Use this only for a second in/out pair the same day — not to
                  close the open shift above.
                </p>
              ) : (
                <p className="text-xs text-text-muted">
                  Times are in {timezone}. Source will be MANUAL_ADMIN.
                </p>
              )}
              <CreateForm
                periodId={periodId}
                employeeId={employeeId}
                date={date}
                timezone={timezone}
                suggestedClockIn={suggestedClockIn}
                suggestedClockOut={suggestedClockOut}
                returnTo={returnTo}
              />
            </div>
          )}
        </div>
      )}
      {periodLocked && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            This week is already paid — its punches are frozen. If a shift
            from this day was missed, add it as back pay below: it keeps
            this date on record but is paid in the current open period.
          </p>
          <BackPayForm
            employeeId={employeeId}
            date={date}
            timezone={timezone}
            suggestedClockIn={suggestedClockIn}
            suggestedClockOut={suggestedClockOut}
            returnTo={returnTo}
          />
        </div>
      )}
    </div>
  );
}

