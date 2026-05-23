import { describe, expect, it } from "vitest";
import {
  buildManualPunchSyncEvents,
  formatNgtecoManualPunchTimestamp,
} from "./manual-punch-sync";

describe("buildManualPunchSyncEvents", () => {
  it("turns a Milo punch pair into one NGTeco row per timestamp", () => {
    const events = buildManualPunchSyncEvents({
      punchId: "p1",
      personId: "29",
      employeeName: "Claudia Alvarado",
      clockIn: new Date("2026-05-09T21:30:00.000Z"),
      clockOut: new Date("2026-05-10T01:15:00.000Z"),
    });

    expect(events).toEqual([
      {
        kind: "clockIn",
        punchAt: new Date("2026-05-09T21:30:00.000Z"),
        personId: "29",
        employeeName: "Claudia Alvarado",
      },
      {
        kind: "clockOut",
        punchAt: new Date("2026-05-10T01:15:00.000Z"),
        personId: "29",
        employeeName: "Claudia Alvarado",
      },
    ]);
  });

  it("refuses to sync employees without an NGTeco reference", () => {
    expect(() =>
      buildManualPunchSyncEvents({
        punchId: "p1",
        personId: null,
        employeeName: "Missing Ref",
        clockIn: new Date("2026-05-09T21:30:00.000Z"),
        clockOut: null,
      }),
    ).toThrow(/no NGTeco ID/);
  });
});

describe("formatNgtecoManualPunchTimestamp", () => {
  it("formats the wall-clock date, time, and offset for the company timezone", () => {
    expect(
      formatNgtecoManualPunchTimestamp(
        new Date("2026-05-09T21:30:00.000Z"),
        "America/New_York",
      ),
    ).toEqual({
      date: "05/09/2026",
      time: "17:30:00",
      timeZoneOffset: "-04:00",
    });
  });
});
