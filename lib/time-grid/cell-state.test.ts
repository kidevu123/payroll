
import { describe, expect, it } from "vitest";
import { cellStateFor, summarizeCell, timeOffStateFor, timeOffLabel, timeInitials, cellAriaLabel } from "./cell-state";

const at = (s: string) => new Date(s);
const complete = [{ clockIn: at("2026-10-05T13:00:00Z"), clockOut: at("2026-10-05T21:00:00Z") }];
const open = [{ clockIn: at("2026-10-05T13:00:00Z"), clockOut: null }];
const common = { dayIso: "2026-10-05", today: "2026-10-06", employeeActive: true, offType: undefined };

describe("cellStateFor", () => {
  it("complete when every punch is paired", () => {
    expect(cellStateFor({ ...common, punches: complete })).toBe("complete");
  });
  it("incomplete when a punch is still open", () => {
    expect(cellStateFor({ ...common, punches: open })).toBe("incomplete");
  });
  it("missed for a past day with no punches", () => {
    expect(cellStateFor({ ...common, punches: [] })).toBe("missed");
  });
  it("future, not missed, for a day after today", () => {
    expect(cellStateFor({ ...common, punches: [], dayIso: "2026-10-09" })).toBe("future");
  });
  it("time off beats missed, and maps each type", () => {
    expect(cellStateFor({ ...common, punches: [], offType: "PERSONAL" })).toBe("pto");
    expect(cellStateFor({ ...common, punches: [], offType: "SICK" })).toBe("sick");
    expect(cellStateFor({ ...common, punches: [], offType: "UNPAID" })).toBe("unpaid");
    expect(cellStateFor({ ...common, punches: [], offType: "OTHER" })).toBe("other");
  });
  it("punches beat time off (the day was worked after all)", () => {
    expect(cellStateFor({ ...common, punches: complete, offType: "SICK" })).toBe("complete");
  });
  it("inactive beats everything", () => {
    expect(cellStateFor({ ...common, punches: complete, employeeActive: false })).toBe("inactive");
  });
  it("overnight punch stays on its clock-in day", () => {
    const overnight = [{ clockIn: at("2026-10-05T22:00:00Z"), clockOut: at("2026-10-06T06:00:00Z") }];
    expect(cellStateFor({ ...common, punches: overnight })).toBe("complete");
  });
});

describe("summarizeCell", () => {
  it("sorts by clock-in and sums only closed punches", () => {
    const later = { clockIn: at("2026-10-05T22:00:00Z"), clockOut: null };
    const list = [later, complete[0]!];
    const { sorted, closedMs } = summarizeCell(list);
    expect(sorted[0]).toBe(complete[0]);
    expect(sorted[1]).toBe(later);
    expect(closedMs).toBe(8 * 60 * 60 * 1000);
  });
});

describe("labels", () => {
  it("time-off labels and states", () => {
    expect(timeOffLabel(timeOffStateFor("PERSONAL"))).toBe("PTO");
    expect(timeOffLabel(timeOffStateFor("OTHER"))).toBe("Off");
    expect(timeOffLabel("complete")).toBe("");
  });
  it("initials", () => {
    expect(timeInitials("Aaliyah Hernandez")).toBe("AH");
    expect(timeInitials("Cher")).toBe("CH");
    expect(timeInitials("  ")).toBe("—");
  });
  it("aria label lists each punch span", () => {
    expect(cellAriaLabel("complete", complete, "America/New_York")).toBe("9:00a to 5:00p");
    expect(cellAriaLabel("missed", [], "America/New_York")).toBe("No punches — missed day");
  });
});
