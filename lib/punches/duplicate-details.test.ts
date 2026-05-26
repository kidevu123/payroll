import { describe, expect, it } from "vitest";
import { buildDuplicatePunchDetails } from "./duplicate-details";

describe("buildDuplicatePunchDetails", () => {
  it("names the employee and every duplicate row before merge", () => {
    const details = buildDuplicatePunchDetails({
      timezone: "America/New_York",
      employees: [{ id: "emp-1", displayName: "Jennifer Perez" }],
      clusters: [
        {
          employeeId: "emp-1",
          rows: [
            {
              id: "short-row-id",
              clockIn: new Date("2026-05-22T22:09:05.000Z"),
              clockOut: new Date("2026-05-23T02:00:00.000Z"),
              source: "NGTECO",
              ngtecoRecordHash: "device-hash",
            },
            {
              id: "long-row-id",
              clockIn: new Date("2026-05-22T22:09:15.000Z"),
              clockOut: new Date("2026-05-23T02:09:00.000Z"),
              source: "MANUAL_ADMIN",
              ngtecoRecordHash: null,
            },
          ],
        },
      ],
    });

    expect(details).toEqual([
      {
        employeeName: "Jennifer Perez",
        employeeId: "emp-1",
        localDate: "May 22",
        localTimeRange: "6:09 PM - 10:09 PM",
        keepPunchId: "long-row-id",
        voidPunchIds: ["short-row-id"],
        rows: [
          {
            id: "long-row-id",
            source: "MANUAL_ADMIN",
            localTimeRange: "6:09 PM - 10:09 PM",
            durationHours: "3.996",
            willKeep: true,
          },
          {
            id: "short-row-id",
            source: "NGTECO",
            localTimeRange: "6:09 PM - 10:00 PM",
            durationHours: "3.849",
            willKeep: false,
          },
        ],
      },
    ]);
  });
});
