import { describe, expect, it } from "vitest";
import { parseScheduleTab, scheduleTabToKind } from "./schedule-tabs";

describe("schedule tabs", () => {
  it("parses monthly and maps it to the MONTHLY schedule kind", () => {
    expect(parseScheduleTab("monthly")).toBe("monthly");
    expect(scheduleTabToKind("monthly")).toBe("MONTHLY");
  });
});
