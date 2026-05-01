import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./parser";

const sampleCsv = readFileSync(
  join(__dirname, "__fixtures__", "sample-export.csv"),
  "utf8",
);

describe("ngteco/parser — sample-export.csv", () => {
  it("decodes a typical NGTeco punch CSV", () => {
    const result = parse(sampleCsv, "America/New_York");
    expect(result.candidates.length).toBeGreaterThan(0);
    // Errors expected: the duplicate row, the unknown employee is fine
    // (it parses; the orchestrator records UNMATCHED_REF separately).
    const dupErrors = result.errors.filter((e) =>
      e.reason.startsWith("Duplicate row hash"),
    );
    expect(dupErrors.length).toBe(1);
  });

  it("attributes a midnight crossing to the start day", () => {
    const result = parse(sampleCsv, "America/New_York");
    const cross = result.candidates.find(
      (c) => c.ngtecoEmployeeRef === "1003",
    );
    expect(cross).toBeDefined();
    expect(cross!.clockIn).toMatch(/^2026-04-1[34]T0[12]/);
    expect(cross!.clockOut).not.toBeNull();
    expect(Date.parse(cross!.clockOut!) > Date.parse(cross!.clockIn)).toBe(true);
  });

  it("preserves null clockOut for incomplete punches", () => {
    const result = parse(sampleCsv, "America/New_York");
    const incomplete = result.candidates.find(
      (c) => c.ngtecoEmployeeRef === "1001" && c.clockOut === null,
    );
    expect(incomplete).toBeDefined();
  });

  it("dedupes within a single file by hash", () => {
    const result = parse(sampleCsv, "America/New_York");
    const refs = result.candidates.filter((c) => c.ngtecoEmployeeRef === "1002");
    expect(refs).toHaveLength(1);
  });

  it("snapshot of canonical output shape (employee 1001 day 1)", () => {
    const result = parse(sampleCsv, "America/New_York");
    const target = result.candidates.find(
      (c) =>
        c.ngtecoEmployeeRef === "1001" && c.clockIn.startsWith("2026-04-13"),
    );
    expect(target).toMatchObject({
      ngtecoEmployeeRef: "1001",
      ngtecoEmployeeName: "Aaliyah Hernandez",
      clockOut: expect.any(String),
    });
    expect(target!.ngtecoRecordHash).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("ngteco/parser — error paths", () => {
  it("rejects rows missing employee_id", () => {
    const csv = `Employee ID,Date,Punch In\n,2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]?.reason).toMatch(/employee id/i);
  });

  it("rejects rows missing date", () => {
    const csv = `Employee ID,Date,Punch In\n1,,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/date/i);
  });

  it("rejects rows missing clock in", () => {
    const csv = `Employee ID,Date,Punch In\n1,2026-04-13,\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/clock in/i);
  });

  it("rejects unrecognized date format", () => {
    const csv = `Employee ID,Date,Punch In\n1,April 13 2026,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/date/i);
  });

  it("rejects unrecognized clock in format", () => {
    const csv = `Employee ID,Date,Punch In\n1,2026-04-13,8 AM\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/clock in/i);
  });

  it("rejects unrecognized clock out format", () => {
    const csv = `Employee ID,Date,Punch In,Punch Out\n1,2026-04-13,08:00,5pm\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/clock out/i);
  });

  it("accepts US M/D/YYYY date format", () => {
    const csv = `Employee ID,Date,Punch In,Punch Out\n1,4/13/2026,08:00,16:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.clockIn.startsWith("2026-04-13")).toBe(true);
  });

  it("accepts HH:mm:ss times", () => {
    const csv = `Employee ID,Date,Punch In,Punch Out\n1,2026-04-13,08:00:00,16:00:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
  });

  it("accepts full-iso datetime in the punch_in column", () => {
    const csv = `Employee ID,Date,Punch In,Punch Out\n1,2026-04-13,2026-04-13 08:00,2026-04-13 16:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
  });

  it("returns empty result on empty input", () => {
    expect(parse("", "UTC")).toEqual({ candidates: [], errors: [] });
  });

  it("skips entirely-empty rows without erroring", () => {
    const csv = `Employee ID,Date,Punch In\n,,\n1,2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
  });

  it("handles \"\"-escaped quotes inside fields", () => {
    const csv = `Employee ID,Notes,Date,Punch In\n1,"He said ""hi""",2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.raw.notes).toBe('He said "hi"');
  });

  it("handles a CSV with no trailing newline", () => {
    const csv = `Employee ID,Date,Punch In\n1,2026-04-13,08:00`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
  });

  it("rolls clock-out past midnight when only HH:mm is given and out < in", () => {
    const csv = `Employee ID,Date,Punch In,Punch Out\n1,2026-04-13,22:00,02:30\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c.clockIn.startsWith("2026-04-13")).toBe(true);
    expect(c.clockOut!.startsWith("2026-04-14")).toBe(true);
  });

  it("uses null for ngtecoEmployeeName when the CSV has no name column", () => {
    const csv = `Employee ID,Date,Punch In\n1,2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates[0]!.ngtecoEmployeeName).toBeNull();
  });

  it("uses null for ngtecoEmployeeName when the cell is empty", () => {
    const csv = `Employee ID,Employee Name,Date,Punch In\n1,,2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates[0]!.ngtecoEmployeeName).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const csv = `Employee ID,Date,Punch In\r\n1,2026-04-13,08:00\r\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
  });

  it("emits Missing-employee-id error when the CSV has no employee column", () => {
    const csv = `Date,Punch In\n2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]?.reason).toMatch(/employee id/i);
  });

  it("emits Missing-date error when the CSV has no date column", () => {
    const csv = `Employee ID,Punch In\n1,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/date/i);
  });

  it("emits Missing-clock-in error when the CSV has no punch-in column", () => {
    const csv = `Employee ID,Date\n1,2026-04-13\n`;
    const r = parse(csv, "UTC");
    expect(r.errors[0]?.reason).toMatch(/clock in/i);
  });

  it("ignores a missing punch-out column without error", () => {
    const csv = `Employee ID,Date,Punch In\n1,2026-04-13,08:00\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.clockOut).toBeNull();
  });

  it("treats short rows (cells.length < indexes) as missing data", () => {
    // Header order shifted: empIdIdx = 2, but the data row only has 1 cell.
    // The `?.trim()` chain has to short-circuit on the undefined slot.
    const csv = `Date,Punch In,Employee ID\n2026-04-13\n`;
    const r = parse(csv, "UTC");
    expect(r.candidates).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
