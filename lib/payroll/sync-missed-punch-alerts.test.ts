import { describe, expect, it } from "vitest";
import {
  filterAlertsForPollSync,
  staleAlertsToResolve,
} from "@/lib/payroll/sync-missed-punch-alerts";

describe("filterAlertsForPollSync", () => {
  it("drops same-day missed-punch alerts before 7pm", () => {
    const filtered = filterAlertsForPollSync(
      [
        {
          employeeId: "e1",
          date: "2026-05-30",
          issue: "MISSING_IN",
        },
        {
          employeeId: "e1",
          date: "2026-05-30",
          issue: "UNPAIRED_PUNCH",
        },
      ],
      "America/New_York",
      new Date("2026-05-30T18:00:00-04:00"),
    );
    expect(filtered).toHaveLength(0);
  });

  it("drops same-day NO_PUNCH before 7pm", () => {
    const filtered = filterAlertsForPollSync(
      [
        {
          employeeId: "e1",
          date: "2026-05-30",
          issue: "NO_PUNCH",
        },
      ],
      "America/New_York",
      new Date("2026-05-30T18:00:00-04:00"),
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("staleAlertsToResolve", () => {
  it("finds unresolved alerts that are no longer detected", () => {
    const stale = staleAlertsToResolve(
      [
        { id: "a1", employeeId: "e1", date: "2026-06-09", issue: "UNPAIRED_PUNCH" },
        { id: "a2", employeeId: "e1", date: "2026-06-10", issue: "MISSING_OUT" },
      ],
      [{ employeeId: "e1", date: "2026-06-10", issue: "MISSING_OUT" }],
    );
    expect(stale).toEqual(["a1"]);
  });
});
