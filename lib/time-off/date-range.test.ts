import { describe, expect, it } from "vitest";
import { endAfterStartChange } from "./date-range";

describe("endAfterStartChange", () => {
  it("pulls the end date forward when the new start is after it", () => {
    expect(endAfterStartChange("2026-10-20", "2026-10-12")).toBe("2026-10-20");
    expect(endAfterStartChange("2027-01-02", "2026-12-30")).toBe("2027-01-02");
  });
  it("leaves an end date on or after the start alone", () => {
    expect(endAfterStartChange("2026-10-12", "2026-10-12")).toBe("2026-10-12");
    expect(endAfterStartChange("2026-10-12", "2026-10-20")).toBe("2026-10-20");
  });
  it("does nothing while either date is still empty", () => {
    expect(endAfterStartChange("", "2026-10-20")).toBe("2026-10-20");
    expect(endAfterStartChange("2026-10-20", "")).toBe("");
  });
});
