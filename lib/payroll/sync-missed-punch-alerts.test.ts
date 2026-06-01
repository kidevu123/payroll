import { describe, expect, it } from "vitest";
import { filterAlertsForPollSync } from "@/lib/payroll/sync-missed-punch-alerts";

describe("filterAlertsForPollSync", () => {
  it("allows MISSING_IN before 7pm", () => {
    const filtered = filterAlertsForPollSync(
      [
        {
          employeeId: "e1",
          date: "2026-05-30",
          issue: "MISSING_IN",
        },
      ],
      "America/New_York",
      new Date("2026-05-30T18:00:00-04:00"),
    );
    expect(filtered).toHaveLength(1);
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
