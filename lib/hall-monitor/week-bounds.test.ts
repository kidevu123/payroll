import { describe, expect, it } from "vitest";
import { weekEndingSunday, weekStartFromEnd } from "./week-bounds";

describe("weekEndingSunday", () => {
  it("returns same day when today is Sunday", () => {
    expect(weekEndingSunday("2026-06-07")).toBe("2026-06-07");
  });

  it("returns the Sunday ending the current Mon→Sun week", () => {
    expect(weekEndingSunday("2026-06-03")).toBe("2026-06-07");
  });
});

describe("weekStartFromEnd", () => {
  it("is six days before week end", () => {
    expect(weekStartFromEnd("2026-06-07")).toBe("2026-06-01");
  });
});
