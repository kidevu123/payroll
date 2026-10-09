import { describe, expect, it } from "vitest";
import {
  describeNote,
  formatIsoDate,
  formatTenure,
  parseEmployeeNotes,
  summarizePay,
} from "./profile-summary";

const slip = (periodEnd: string, payCents: number, hours: number) => ({
  periodStart: periodEnd,
  periodEnd,
  payCents,
  hours,
});

describe("formatIsoDate", () => {
  it("renders a calendar date without shifting the day", () => {
    expect(formatIsoDate("2025-01-01")).toBe("Jan 1, 2025");
  });

  it("returns the input when it is not a date", () => {
    expect(formatIsoDate("soon")).toBe("soon");
  });
});

describe("formatTenure", () => {
  it("shows years and months", () => {
    expect(formatTenure("2025-01-01", "2026-10-09")).toBe("1 yr 9 mo");
  });

  it("drops the month part on an exact anniversary", () => {
    expect(formatTenure("2024-10-09", "2026-10-09")).toBe("2 yr");
  });

  it("shows months only inside the first year", () => {
    expect(formatTenure("2026-07-20", "2026-10-09")).toBe("2 mo");
  });

  it("shows days inside the first month", () => {
    expect(formatTenure("2026-10-01", "2026-10-09")).toBe("8 days");
    expect(formatTenure("2026-10-08", "2026-10-09")).toBe("1 day");
  });

  it("says when the start date is today or still ahead", () => {
    expect(formatTenure("2026-10-09", "2026-10-09")).toBe("Starts today");
    expect(formatTenure("2026-11-01", "2026-10-09")).toBe("Not started");
  });

  it("returns a dash for a bad date", () => {
    expect(formatTenure("nope", "2026-10-09")).toBe("—");
  });
});

describe("summarizePay", () => {
  it("totals only the current year, by period end date", () => {
    const s = summarizePay(
      [
        slip("2026-08-16", 48900, 37.62),
        slip("2026-08-09", 51600, 39.66),
        slip("2025-12-28", 40000, 30),
      ],
      "2026-10-09",
    );
    expect(s.year).toBe(2026);
    expect(s.ytdPayCents).toBe(100500);
    expect(s.ytdHours).toBeCloseTo(77.28);
    expect(s.ytdPaidCount).toBe(2);
  });

  it("picks the most recent payslip that actually paid something", () => {
    const s = summarizePay(
      [
        slip("2026-08-09", 51600, 39.66),
        slip("2026-09-06", 0, 0),
        slip("2026-08-16", 48900, 37.62),
      ],
      "2026-10-09",
    );
    expect(s.lastPaid?.periodEnd).toBe("2026-08-16");
    // Empty weeks do not count as paid weeks.
    expect(s.ytdPaidCount).toBe(2);
  });

  it("has no last payslip when nothing was ever paid", () => {
    const s = summarizePay([slip("2026-09-06", 0, 0)], "2026-10-09");
    expect(s.lastPaid).toBeNull();
    expect(s.ytdPayCents).toBe(0);
  });

  it("handles an employee with no payslips", () => {
    expect(summarizePay([], "2026-10-09")).toEqual({
      year: 2026,
      lastPaid: null,
      ytdPayCents: 0,
      ytdHours: 0,
      ytdPaidCount: 0,
    });
  });
});

describe("parseEmployeeNotes", () => {
  it("splits system-stamped lines into dated entries", () => {
    const entries = parseEmployeeNotes(
      "[2026-09-09T15:36:36.546Z] terminated: terminated\n[2026-10-09T18:01:30.164Z] reinstated",
    );
    expect(entries).toEqual([
      { at: new Date("2026-09-09T15:36:36.546Z"), text: "terminated: terminated" },
      { at: new Date("2026-10-09T18:01:30.164Z"), text: "reinstated" },
    ]);
  });

  it("keeps free text as undated entries and joins its lines", () => {
    const entries = parseEmployeeNotes(
      "Prefers morning shifts.\nHas a forklift licence.\n[2026-09-09T15:36:36.546Z] terminated: left",
    );
    expect(entries).toEqual([
      { at: null, text: "Prefers morning shifts.\nHas a forklift licence." },
      { at: new Date("2026-09-09T15:36:36.546Z"), text: "terminated: left" },
    ]);
  });

  it("treats a bracket that is not a timestamp as plain text", () => {
    expect(parseEmployeeNotes("[urgent] call back")).toEqual([
      { at: null, text: "[urgent] call back" },
    ]);
  });

  it("returns nothing for empty notes", () => {
    expect(parseEmployeeNotes(null)).toEqual([]);
    expect(parseEmployeeNotes("  \n ")).toEqual([]);
  });
});

describe("describeNote", () => {
  it("splits a termination into event and reason", () => {
    expect(describeNote("terminated: left for school")).toEqual({
      title: "Terminated",
      detail: "left for school",
    });
  });

  it("drops a reason that only repeats the event", () => {
    expect(describeNote("terminated: terminated")).toEqual({
      title: "Terminated",
      detail: null,
    });
  });

  it("capitalizes a bare event", () => {
    expect(describeNote("reinstated")).toEqual({ title: "Reinstated", detail: null });
  });

  it("leaves any other text alone", () => {
    expect(describeNote("Prefers mornings")).toEqual({
      title: "Prefers mornings",
      detail: null,
    });
  });
});
