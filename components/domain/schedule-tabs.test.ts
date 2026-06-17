import { describe, expect, it } from "vitest";
import { parseScheduleTab, scheduleTabToKind } from "./schedule-tabs";

describe("schedule tabs", () => {
  it("parses monthly and maps it to the MONTHLY schedule kind", () => {
    expect(parseScheduleTab("monthly")).toBe("monthly");
    expect(scheduleTabToKind("monthly")).toBe("MONTHLY");
  });

  it("maps the salaried tab to the synthetic SALARIED kind, not null", () => {
    expect(parseScheduleTab("salaried")).toBe("salaried");
    // Regression: previously returned null, which made listReports skip its
    // WHERE clause and return the unfiltered (weekly/semi) list.
    expect(scheduleTabToKind("salaried")).toBe("SALARIED");
  });

  it("maps weekly/semi and the all tab unchanged", () => {
    expect(scheduleTabToKind("weekly")).toBe("WEEKLY");
    expect(scheduleTabToKind("semi")).toBe("SEMI_MONTHLY");
    expect(scheduleTabToKind("all")).toBeNull();
  });
});
