import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/runtime", () => ({
  getSetting: vi.fn(async () => ({ timezone: "America/New_York" })),
}));

import { getSetting } from "@/lib/settings/runtime";
import { parsePunchInput } from "./parse-punch-input";

describe("parsePunchInput", () => {
  it("reads a bare datetime-local value as COMPANY wall-clock time, not the server's zone", async () => {
    // 8 PM in New York on May 4 is midnight UTC on May 5 (EDT, UTC-4).
    expect((await parsePunchInput("2026-05-04T20:00"))?.toISOString()).toBe("2026-05-05T00:00:00.000Z");
    // Standard time (EST, UTC-5).
    expect((await parsePunchInput("2026-01-15T08:30"))?.toISOString()).toBe("2026-01-15T13:30:00.000Z");
  });
  it("passes an explicit instant through untouched and does not look up the timezone for it", async () => {
    vi.mocked(getSetting).mockClear();
    expect((await parsePunchInput("2026-05-04T20:00:00.000Z"))?.toISOString()).toBe("2026-05-04T20:00:00.000Z");
    expect(getSetting).not.toHaveBeenCalled();
  });
  it("is null for something that is not a date", async () => {
    expect(await parsePunchInput("not a time")).toBeNull();
    expect(await parsePunchInput("")).toBeNull();
  });
});
